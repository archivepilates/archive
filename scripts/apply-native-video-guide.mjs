import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'artifacts/native-video-guide');
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
const [mode, idList] = process.argv.slice(2);
assert.equal(mode, '--apply-native-linked');
assert(idList && /^\d+(,\d+)*$/.test(idList));
const ids = idList.split(',').map(Number);
const plan = read('plan.json');
const linked = read('native-linked.json');
assert.equal(new Set(ids).size, ids.length);
assert(ids.every(id => plan.some(row => row.id === id)));
assert(ids.every(id => linked.ids.includes(id)), 'Native footer must be saved in Imweb before cleanup');
assert.equal(linked.siteCode, 'S20260516852c71a014d08');
for (const folder of ['after', 'preflight']) fs.mkdirSync(path.join(dir, folder), { recursive: true });
let lastCall = 0;

async function cli(command, retryRead = false) {
  for (let attempt = 0; ; attempt++) {
    await delay(Math.max(0, 1600 - (Date.now() - lastCall)));
    lastCall = Date.now();
    const result = spawnSync('imweb', ['--output', 'json', ...command], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
    const body = JSON.parse(result.stdout || '{}');
    if (result.status === 0 && !body.error) return body;
    if (retryRead && body.error?.status_code === 429 && attempt < 2) {
      await delay(65000);
      continue;
    }
    throw new Error(JSON.stringify({ command: command.slice(0, 4), status: result.status, error: body.error?.code }));
  }
}

for (const id of ids) {
  const before = read(`before/${id}.json`).data;
  const payload = read(`cleaned/${id}.json`);
  assert.deepEqual(Object.keys(payload).sort(), ['description', 'unitCode']);
  assert.equal(payload.unitCode, 'u2026051698c99ea234719');
  const preflight = await cli(['product', 'get', String(id)], true);
  write(`preflight/${id}.json`, preflight);
  const current = preflight.data;
  assert.equal(current.prodNo, id);
  assert.equal(current.siteCode, linked.siteCode);
  assert.equal(current.prodType, 'subscribe');
  assert.equal(current.prodDigitalData.subscribeData.period, 40);
  assert.equal(current.prodStatus, before.prodStatus);
  if (current.content === payload.description) {
    write(`after/${id}.json`, preflight);
    console.log(JSON.stringify({ id, status: 'already-cleaned' }));
    continue;
  }
  assert.equal(current.content, before.content, `Concurrent description edit for ${id}`);
  const command = ['product', 'update', 'info', String(id), '--data', `@${path.join(dir, 'cleaned', `${id}.json`)}`];
  const dry = await cli([...command, '--dry-run']);
  assert.deepEqual(dry.request.body, payload);
  assert.equal(dry.command_path, 'product update info');
  assert.equal(dry.safety.execute_ready, true);
  const flags = ['--yes', '--confirm-token', dry.confirmation_token];
  if (dry.safety.bulk_confirmation_required_for_execute) flags.push('--bulk-confirm-token', dry.bulk_confirmation_token);
  let outcome = 'written';
  // Read back an uncertain write without resubmitting it.
  try { write(`write-${id}.json`, await cli([...command, ...flags])); }
  catch (error) { outcome = 'uncertain-response'; write(`write-${id}.json`, { error: error.message }); }
  const after = await cli(['product', 'get', String(id)], true);
  write(`after/${id}.json`, after);
  assert.equal(after.data.content, payload.description, `Cleanup not verified: ${id}`);
  const changed = Object.keys(current).filter(key => JSON.stringify(current[key]) !== JSON.stringify(after.data[key]));
  assert(changed.every(key => ['content', 'editTime'].includes(key)), `Unexpected fields: ${id} ${changed}`);
  fs.appendFileSync(path.join(dir, 'ledger.jsonl'), JSON.stringify({ id, outcome, changed, verified: true, at: new Date().toISOString() }) + '\n');
  console.log(JSON.stringify({ id, status: 'verified', changed }));
}
