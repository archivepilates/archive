import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createService } from '../src/service.mjs';
import { createMcpServer } from '../src/transport.mjs';
import { createTargetValidator } from '../src/target-validator.mjs';
import { validate } from '../src/catalog.mjs';
import { readAlimtalkTargetValidation } from '../../../scripts/read-alimtalk-target-validation.mjs';

const candidateId = '5330_candidate-1';
const secret = 'PRIVATE_FIXTURE_PAYLOAD_CREDENTIAL';
const phone = '01012345678';
const checkedAt = '2026-10-16T03:00:00.000Z';
const operator = { studioId: '5330', active: true, role: 'manager' };
function snapshot(status = 'preflight_passed') {
  return { version: 'alimtalk-target-validation-v1', checkedAt, readOnly: true,
    liveReadback: false, allowedForExternalActions: false,
    results: [{ candidateId, status, checks: [{ stage: 'eligibility', status: 'passed', reasonCode: 'ok' }],
      source: { collection: 'alimtalkCandidates', observedAt: null, freshness: 'unknown', liveReadback: false } }] };
}
function fixture(t, current = operator, validator = async () => snapshot()) {
  const getOperator = t.mock.fn(async () => current);
  const targetValidator = t.mock.fn(validator);
  const forbidden = () => { assert.fail('Read-only validation accessed a write or unrelated member source.'); };
  const store = new Proxy({ getOperator }, { get: (target, key) => target[key] || forbidden });
  return { getOperator, targetValidator, ...createService({ store, approvals: new Proxy({}, { get: () => forbidden }),
    staffId: 'operator', readOnly: true, targetValidator }) };
}
async function connect(t, service) {
  const server = createMcpServer(service);
  const client = new Client({ name: 'target-validation-tests', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

test('transport discovers and dispatches only the read-only preflight tool', async t => {
  const f = fixture(t);
  const client = await connect(t, f);
  const definition = (await client.listTools()).tools.find(tool => tool.name === 'messages_validate_target');
  assert.deepEqual(definition.inputSchema.required, ['candidateId']);
  assert.equal(definition.inputSchema.additionalProperties, false);
  assert.equal(definition.annotations.readOnlyHint, true);
  assert.equal(definition.annotations.destructiveHint, false);
  const result = await client.callTool({ name: definition.name, arguments: { candidateId } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.preflightOnly, true);
  assert.equal(result.structuredContent.allowedForExternalActions, false);
  assert.equal(result.structuredContent.liveReadback, false);
  assert.equal(result.structuredContent.results[0].status, 'preflight_passed');
  assert.equal(f.targetValidator.mock.callCount(), 1);
  assert.equal(f.getOperator.mock.callCount(), 1);
  for (const name of ['messages_send', 'messages_approve', 'messages_queue']) {
    const response = await client.callTool({ name, arguments: { candidateId } });
    assert.equal(response.structuredContent.error.code, 'UNKNOWN_TOOL');
  }
  assert.equal(f.targetValidator.mock.callCount(), 1);
});

test('each validation rechecks operator permissions before invoking the backend', async t => {
  for (const current of [null, { ...operator, active: false }, { ...operator, role: 'instructor' },
    { ...operator, studioId: 'other' }]) {
    const f = fixture(t, current);
    await assert.rejects(f.callTool('messages_validate_target', { candidateId }), { code: 'PERMISSION_DENIED' });
    assert.equal(f.targetValidator.mock.callCount(), 0);
  }
  const f = fixture(t);
  await f.callTool('messages_validate_target', { candidateId });
  f.getOperator.mock.mockImplementation(async () => null);
  await assert.rejects(f.callTool('messages_validate_target', { candidateId }), { code: 'PERMISSION_DENIED' });
  assert.equal(f.targetValidator.mock.callCount(), 1);
});

test('MCP and CLI share the exact backend ID regex and reject invalid IDs before loading', async t => {
  const f = fixture(t);
  for (const value of ['', '../candidate', 'a/b', 'a.b', 'a:b', 'a b', 'a\n', '--id=1', 'x'.repeat(161), null, 1, [], {}]) {
    assert.equal(validate('messages_validate_target', { candidateId: value }), false);
    await assert.rejects(f.callTool('messages_validate_target', { candidateId: value }), { code: 'INVALID_ARGUMENT' });
    await assert.rejects(readAlimtalkTargetValidation(value, { loadAdmin: () => assert.fail('Invalid ID loaded backend.') }),
      { code: 'INVALID_ARGUMENT' });
  }
  for (const value of ['a', 'A_0-z', 'x'.repeat(160)]) {
    assert.equal(validate('messages_validate_target', { candidateId: value }), true);
    assert.equal(await readAlimtalkTargetValidation(value, { loadAdmin: () => ({ getApps: () => [] }),
      loadInspect: () => async ids => ids[0] }), value);
  }
  for (const args of [{}, { candidateId, approved: true }, { candidateId, send: true }, { candidateIds: [candidateId] }]) {
    assert.equal(validate('messages_validate_target', args), false);
    await assert.rejects(f.callTool('messages_validate_target', args), { code: 'INVALID_ARGUMENT' });
  }
  assert.equal(f.targetValidator.mock.callCount(), 0);
});

test('new eligibility codes preserve staff blocks and unknown-template/unsupported review states', async t => {
  for (const [reasonCode, status, checkStatus] of [['staff_excluded', 'blocked', 'blocked'],
    ['template_snapshot_unverified', 'review_required', 'not_checked'],
    ['unsupported_candidate_type', 'review_required', 'not_checked']]) {
    const value = snapshot(status);
    value.results[0].checks = [{ stage: 'eligibility', status: checkStatus, reasonCode }];
    const result = await fixture(t, operator, async () => value).callTool('messages_validate_target', { candidateId });
    assert.equal(result.results[0].status, status);
    assert.deepEqual(result.results[0].checks, value.results[0].checks);
    assert.equal(result.preflightOnly, true);
    assert.equal(result.allowedForExternalActions, false);
  }
});

test('instructor confirmation retains specialized final-guard review without granting send permission', async t => {
  const value = snapshot('review_required');
  value.results[0].checks.push({ stage: 'specialized_final_guard', status: 'not_checked',
    reasonCode: 'existing_runtime_readback_required' });
  const result = await fixture(t, operator, async () => value).callTool('messages_validate_target', { candidateId });
  assert.deepEqual(result.results[0].checks.at(-1), value.results[0].checks.at(-1));
  assert.equal(result.results[0].status, 'review_required');
  assert.equal(result.allowedForExternalActions, false);
});

test('backend errors, including unsafe safe-marked exceptions, expose no private details', async t => {
  for (const validator of [undefined, async () => { throw Object.assign(new Error(`${secret}:${phone}`),
    { safe: true, code: secret }); }]) {
    const f = fixture(t);
    const client = await connect(t, validator ? fixture(t, operator, validator) : createService({
      store: { getOperator: f.getOperator }, staffId: 'operator', readOnly: true }));
    const response = await client.callTool({ name: 'messages_validate_target', arguments: { candidateId } });
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent.error.code, 'SOURCE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(response), new RegExp(`${secret}|${phone}`));
  }
});

test('projects only fixed snapshot fields, never raw payloads, phones, approval or arbitrary errors', async t => {
  for (const status of ['not_found', 'blocked', 'review_required', 'preflight_passed']) {
    const value = snapshot(status);
    Object.assign(value, { phone, error: secret, permission: true });
    Object.assign(value.results[0], { phone, payload: { answers: secret }, lastError: secret,
      remainingChecks: [secret], sendAllowed: true });
    Object.assign(value.results[0].checks[0], { message: secret });
    Object.assign(value.results[0].source, { phone });
    const f = fixture(t, operator, async () => value);
    const controller = new AbortController();
    const result = await f.callTool('messages_validate_target', { candidateId }, { signal: controller.signal });
    assert.equal(f.targetValidator.mock.calls[0].arguments[1].signal, controller.signal);
    assert.equal(result.results[0].status, status);
    assert.equal(result.readOnly, true);
    assert.equal(result.preflightOnly, true);
    assert.equal(result.allowedForExternalActions, false);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(`${secret}|${phone}|payload|lastError|sendAllowed|permission`));
  }
});

test('malformed, foreign, or non-snapshot backend results fail closed', async t => {
  const values = [null, {}, { ...snapshot(), liveReadback: true }, { ...snapshot(), allowedForExternalActions: true },
    { ...snapshot(), results: [] }, { ...snapshot(), checkedAt: secret }];
  for (const modify of [row => { row.candidateId = 'other'; }, row => { row.status = secret; },
    row => { row.checks[0].reasonCode = phone; }, row => { row.checks[0].stage = '__proto__'; },
    row => { row.source.collection = 'member360Cards'; }]) {
    const value = snapshot(); modify(value.results[0]); values.push(value);
  }
  for (const value of values) {
    const f = fixture(t, operator, async () => value);
    await assert.rejects(f.callTool('messages_validate_target', { candidateId }), { code: 'SOURCE_UNAVAILABLE' });
  }
});

function childFixture(t, options = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 12345;
  child.kill = t.mock.fn(() => true);
  const spawnImpl = t.mock.fn(() => child);
  const run = createTargetValidator({ credentialPath: `/private/${secret}.json`, spawnImpl,
    timeoutMs: 1000, killGraceMs: 1000, ...options });
  return { child, spawnImpl, run };
}
test('spawns only Node + fixed CLI without shell, passes config credentials only in child env', async t => {
  const f = childFixture(t);
  const pending = f.run(candidateId);
  const [command, args, options] = f.spawnImpl.mock.calls[0].arguments;
  assert.equal(command, process.execPath);
  assert.match(args[0], /\/scripts\/read-alimtalk-target-validation\.mjs$/);
  assert.deepEqual(args.slice(1), [candidateId]);
  assert.doesNotMatch(JSON.stringify(args), new RegExp(secret));
  assert.equal(options.shell, false);
  assert.equal(options.env.GOOGLE_APPLICATION_CREDENTIALS, `/private/${secret}.json`);
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
  f.child.stdout.write(JSON.stringify(snapshot())); f.child.emit('close', 0);
  assert.deepEqual(await pending, snapshot());
  assert.equal(f.child.kill.mock.callCount(), 0);
});

test('output limits, cancellation and timeout kill only owned child and await close', async t => {
  for (const trigger of ['stdout', 'stderr', 'abort', 'timeout']) {
    const f = childFixture(t, { maxOutputBytes: 16, timeoutMs: trigger === 'timeout' ? 5 : 1000, killGraceMs: 5 });
    const controller = new AbortController();
    let settled = false;
    const pending = assert.rejects(f.run(candidateId, { signal: controller.signal }), { code: 'SOURCE_UNAVAILABLE' })
      .then(() => { settled = true; });
    if (trigger === 'stdout' || trigger === 'stderr') f.child[trigger].write(secret);
    if (trigger === 'abort') controller.abort(new Error(secret));
    // Deterministic process-event double: wait for the escalation callback, not a guessed delay.
    await new Promise(resolve => {
      f.child.kill.mock.mockImplementation(signal => { if (signal === 'SIGKILL') resolve(); return true; });
    });
    assert.equal(settled, false);
    assert.deepEqual(f.child.kill.mock.calls.map(call => call.arguments[0]), ['SIGTERM', 'SIGKILL']);
    f.child.emit('close', null);
    await pending;
  }
});

test('failed spawns, unavailable build exit and malformed JSON are sanitized with no fallback', async t => {
  const throwing = createTargetValidator({ credentialPath: secret, spawnImpl: () => { throw new Error(secret); } });
  await assert.rejects(throwing(candidateId), { code: 'SOURCE_UNAVAILABLE' });
  for (const mode of ['spawn_error', 'missing_build', 'invalid_json']) {
    const f = childFixture(t);
    const pending = assert.rejects(f.run(candidateId), error => {
      assert.equal(error.code, 'SOURCE_UNAVAILABLE');
      assert.ok(!error.message.includes(secret)); return true;
    });
    if (mode === 'spawn_error') { f.child.pid = undefined; f.child.emit('error', new Error(secret)); }
    f.child.stderr.write(secret);
    f.child.stdout.write(secret);
    f.child.emit('close', mode === 'invalid_json' ? 0 : 1);
    await pending;
    assert.equal(f.spawnImpl.mock.callCount(), 1);
  }
});

test('pre-aborted and invalid requests spawn no process', async t => {
  const f = childFixture(t);
  await assert.rejects(f.run('../bad'), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.run(candidateId, { signal: AbortSignal.abort() }), { code: 'SOURCE_UNAVAILABLE' });
  assert.equal(f.spawnImpl.mock.callCount(), 0);
});

test('real timed-out Node child is reaped before the validator rejects', async () => {
  let child;
  const run = createTargetValidator({ credentialPath: secret, timeoutMs: 20, killGraceMs: 20,
    spawnImpl: (_command, _args, options) => {
      child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'], options);
      return child;
    } });
  try {
    await assert.rejects(run(candidateId), { code: 'SOURCE_UNAVAILABLE' });
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise(resolve => child.once('close', resolve));
    }
  }
});

test('CLI calls only compiled inspector for one ID + studio and always deletes all Firebase apps', async t => {
  for (const mode of ['success', 'inspect_error', 'missing_build']) {
    const apps = [{ name: 'default' }, { name: 'secondary' }];
    const admin = { getApps: () => apps, deleteApp: t.mock.fn(async () => {}) };
    const inspect = t.mock.fn(async (ids, studio) => {
      assert.deepEqual(ids, [candidateId]); assert.equal(studio, '5330');
      if (mode === 'inspect_error') throw new Error(secret);
      return snapshot();
    });
    const pending = readAlimtalkTargetValidation(candidateId, { loadAdmin: () => admin,
      loadInspect: () => { if (mode === 'missing_build') throw new Error('MODULE_NOT_FOUND'); return inspect; } });
    if (mode === 'success') assert.deepEqual(await pending, snapshot());
    else await assert.rejects(pending);
    assert.deepEqual(admin.deleteApp.mock.calls.map(call => call.arguments[0]), apps);
    assert.equal(inspect.mock.callCount(), mode === 'missing_build' ? 0 : 1);
  }
  let loaded = false;
  await assert.rejects(readAlimtalkTargetValidation('a/b', { loadAdmin: () => { loaded = true; } }), { code: 'INVALID_ARGUMENT' });
  assert.equal(loaded, false);
});

test('CLI cancellation drains inspection before awaiting deletion of all apps', async t => {
  const controller = new AbortController();
  let completeInspect, completeDelete, deletionStarted;
  const deleting = new Promise(resolve => { deletionStarted = resolve; });
  const admin = { getApps: () => [{}], deleteApp: t.mock.fn(() => {
    deletionStarted(); return new Promise(resolve => { completeDelete = resolve; });
  }) };
  let settled = false;
  const pending = assert.rejects(readAlimtalkTargetValidation(candidateId, { loadAdmin: () => admin,
    loadInspect: () => () => new Promise(resolve => { completeInspect = resolve; }), signal: controller.signal }))
    .then(() => { settled = true; });
  controller.abort();
  assert.equal(admin.deleteApp.mock.callCount(), 0);
  assert.equal(settled, false);
  completeInspect(snapshot());
  await deleting;
  assert.equal(settled, false);
  completeDelete(); await pending;
  assert.equal(admin.deleteApp.mock.callCount(), 1);
});

test('CLI cleanup attempts every app and reports deletion failure instead of success', async t => {
  const apps = [{ name: 'default' }, { name: 'secondary' }];
  const admin = { getApps: () => apps, deleteApp: t.mock.fn(async app => {
    if (app === apps[0]) throw new Error(secret);
  }) };
  await assert.rejects(readAlimtalkTargetValidation(candidateId, { loadAdmin: () => admin,
    loadInspect: () => async () => snapshot() }), { message: 'validation_cleanup_failed' });
  assert.equal(admin.deleteApp.mock.callCount(), 2);
});

test('CLI rejects unsafe arguments without loading production backend or reflecting private data', async () => {
  const child = spawn(process.execPath, [new URL('../../../scripts/read-alimtalk-target-validation.mjs', import.meta.url).pathname,
    `../${secret}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 1); assert.equal(stdout, '');
  assert.equal(stderr, 'Alimtalk preflight validation unavailable.\n');
  assert.ok(!stderr.includes(secret));
});

test('CLI has a fixed compiled backend entry with no TypeScript or sender fallback', async () => {
  const source = await readFile(new URL('../../../scripts/read-alimtalk-target-validation.mjs', import.meta.url), 'utf8');
  assert.match(source, /functions\/lib\/alimtalk\/targetValidation\.js/);
  assert.doesNotMatch(source, /processAlimtalkQueue|queueDailyAlimtalk|\.ts['"]|execSync|shell:/);
});
