import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'artifacts/video-guide-rollout');
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
const args = process.argv.slice(2);
assert.fail('Retired: native common footers are live. Do not restore individual guides; see 2026-09-13-video-guide-rollout.md.');
assert.deepEqual(args, ['--apply-reviewed-plan'], 'Live writes require --apply-reviewed-plan');
assert(!fs.existsSync(path.join(dir, 'PAUSED')), 'Rollout paused for native common-footer review; do not resume this individual-description batch.');
const plan = read('plan.json');
const expectedIds = [...Array.from({ length: 25 }, (_, i) => i + 27), 79, 80, 84, 85];
assert.deepEqual(plan.map(row => row.id), expectedIds);
fs.mkdirSync(path.join(dir, 'after'), { recursive: true });
fs.mkdirSync(path.join(dir, 'preflight'), { recursive: true });
let lastCall = 0;

async function cli(command, { retryRead = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    await delay(Math.max(0, 1600 - (Date.now() - lastCall)));
    lastCall = Date.now();
    const result = spawnSync('imweb', ['--output', 'json', ...command], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
    const body = JSON.parse(result.stdout || '{}');
    if (result.status === 0 && !body.error) return body;
    if (retryRead && body.error?.status_code === 429 && attempt < 2) {
      console.log('Read rate limit: waiting 65 seconds before retry.');
      await delay(65000);
      continue;
    }
    throw new Error(JSON.stringify({ command: command.slice(0, 4), status: result.status, error: body.error?.code }));
  }
}

for (const row of plan) {
  const before = read(`before/${row.id}.json`).data;
  const payload = read(`payloads/${row.id}.json`);
  assert.deepEqual(Object.keys(payload).sort(), ['description', 'unitCode']);
  assert.equal(payload.unitCode, 'u2026051698c99ea234719');
  const preflight = await cli(['product', 'get', String(row.id)], { retryRead: true });
  write(`preflight/${row.id}.json`, preflight);
  const current = preflight.data;
  assert.equal(current.prodNo, row.id);
  assert.equal(current.prodType, 'subscribe');
  assert.equal(current.siteCode, 'S20260516852c71a014d08');
  assert.equal(current.prodDigitalData.subscribeData.period, 40);
  assert.equal(current.prodStatus, before.prodStatus);
  if (current.content === payload.description) {
    write(`after/${row.id}.json`, preflight);
    console.log(JSON.stringify({ id: row.id, status: 'already-applied-and-verified' }));
    continue;
  }
  const pilotDescription = row.id === 85 ? read('pilot-dry-run.json').request.body.description : null;
  assert(current.content === before.content || current.content === pilotDescription,
    `Concurrent description edit for ${row.id}; stopping`);
  const dataFile = `@${path.join(dir, 'payloads', `${row.id}.json`)}`;
  const base = ['product', 'update', 'info', String(row.id), '--data', dataFile];
  const dryRun = await cli([...base, '--dry-run']);
  assert.equal(dryRun.command_path, 'product update info');
  assert.deepEqual(dryRun.request.body, payload);
  assert.equal(dryRun.safety.execute_ready, true);
  const flags = ['--yes', '--confirm-token', dryRun.confirmation_token];
  if (dryRun.safety.bulk_confirmation_required_for_execute) flags.push('--bulk-confirm-token', dryRun.bulk_confirmation_token);
  // Do not retry an uncertain write. Read back first, then stop if it differs.
  let outcome = 'written';
  try {
    const saved = await cli([...base, ...flags]);
    write(`write-${row.id}.json`, saved);
  } catch (error) {
    outcome = 'write-response-uncertain';
    write(`write-${row.id}.json`, { error: error.message, outcome });
  }
  const after = await cli(['product', 'get', String(row.id)], { retryRead: true });
  write(`after/${row.id}.json`, after);
  assert.equal(after.data.content, payload.description, `Description verification failed for ${row.id}; no retry`);
  const changed = Object.keys(current).filter(key => JSON.stringify(current[key]) !== JSON.stringify(after.data[key]));
  assert(changed.every(key => ['content', 'editTime'].includes(key)), `Unexpected changed fields for ${row.id}: ${changed}`);
  fs.appendFileSync(path.join(dir, 'ledger.jsonl'), JSON.stringify({ id: row.id, outcome, verified: true, changed, at: new Date().toISOString() }) + '\n');
  console.log(JSON.stringify({ id: row.id, status: 'verified', changed }));
}
console.log('All 29 video descriptions verified.');
