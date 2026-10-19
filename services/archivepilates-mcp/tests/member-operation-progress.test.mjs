import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createService } from '../src/service.mjs';
import { TOOLS, validate } from '../src/catalog.mjs';
import { createOperationProgressReader, operationProgressView } from '../src/operation-progress.mjs';
import { readMemberOperationProgress } from '../../../scripts/read-member-operation-progress.mjs';
import { fixture, inspect, stage, at, secret } from './member-operation-progress-fixture.mjs';

const input = fixture().input;
const snapshot = async () => (await inspect()).result;
const rejectsUnavailable = promise => assert.rejects(promise, error => {
  assert.equal(error.code, 'SOURCE_UNAVAILABLE'); assert.ok(!error.message.includes(secret)); return true;
});
function childFixture(t, options = {}) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = t.mock.fn(() => true);
  const spawnImpl = t.mock.fn(() => child);
  const run = createOperationProgressReader({ credentialPath: `/private/${secret}.json`, spawnImpl,
    timeoutMs: 1000, killGraceMs: 1000, ...options });
  return { child, spawnImpl, run };
}

test('progress catalog is strictly holding-only, read-only and rejects extra arguments', () => {
  const tool = TOOLS.find(row => row.name === 'operations_get_progress');
  assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false);
  assert.equal(validate(tool.name, input), true);
  for (const args of [{ ...input, kind: 'refund' }, { ...input, operationId: '../bad' }, { ...input, jobId: 'x' },
    { ...input, operationId: `holding_operator_notice_${'a'.repeat(63)}` }, { ...input, operationId: `holding_operator_notice_${'A'.repeat(64)}` }]) {
    assert.equal(validate(tool.name, args), false);
  }
});

test('same active owner-manager studio guard precedes reader; no store job, member or write access', async t => {
  const data = await snapshot();
  for (const actor of [null, { studioId: 'other', active: true, role: 'owner' }, { studioId: '5330', active: false, role: 'owner' },
    { studioId: '5330', active: true, role: 'teacher' }, { studioId: '5330', active: true, role: 'owner' },
    { studioId: '5330', active: true, role: 'manager' }]) {
    const calls = [], reader = t.mock.fn(async args => { calls.push('reader'); assert.deepEqual(args, input); return data; });
    const service = createService({ staffId: 'operator', readOnly: true,
      store: { getOperator: async id => { calls.push('actor'); assert.equal(id, 'operator'); return actor; } }, operationProgressReader: reader });
    if (actor?.studioId === '5330' && actor.active && ['owner', 'manager'].includes(actor.role)) {
      const controller = new AbortController();
      assert.deepEqual(await service.callTool('operations_get_progress', input, { signal: controller.signal }), data);
      assert.equal(reader.mock.calls[0].arguments[1].signal, controller.signal); assert.deepEqual(calls, ['actor', 'reader']);
    } else {
      await assert.rejects(service.callTool('operations_get_progress', input), { code: 'PERMISSION_DENIED' });
      assert.deepEqual(calls, ['actor']);
    }
  }
});

test('invalid input, missing reader, raw read failures and malformed output fail closed', async () => {
  let actorReads = 0;
  const store = { getOperator: async () => { actorReads++; return { studioId: '5330', active: true, role: 'owner' }; } };
  const service = createService({ staffId: 'operator', store });
  await assert.rejects(service.callTool('operations_get_progress', { ...input, operationId: secret }), { code: 'INVALID_ARGUMENT' });
  assert.equal(actorReads, 0); await rejectsUnavailable(service.callTool('operations_get_progress', input));
  for (const reader of [async () => { throw new Error(secret); }, async () => ({ raw: secret })]) {
    await rejectsUnavailable(createService({ staffId: 'operator', store, operationProgressReader: reader }).callTool('operations_get_progress', input));
  }
});

test('response whitelist redacts arbitrary member, phone, memo, variable and error fields at every level', async () => {
  const data = await snapshot();
  data.memberName = data.phone = data.memoBody = data.variables = data.lastError = secret;
  data.source.privateData = secret;
  for (const row of [...data.stages, ...data.source.evidence]) row.privateData = secret;
  const result = operationProgressView(data, input);
  assert.ok(!JSON.stringify(result).includes(secret)); assert.equal(result.liveReadback, false);
});

test('response validator rejects mismatched identity, version, stage/reason/time, flags, source and false completion', async () => {
  const changes = [v => { v.operationId = 'other'; }, v => { v.kind = 'refund'; }, v => { v.version = 'v0'; },
    v => { v.liveReadback = true; }, v => { v.readOnly = false; }, v => { v.allowedForExternalActions = true; },
    v => { v.checkedAt = secret; }, v => { v.policy = secret; }, v => { v.codes = [secret]; },
    v => { v.nextAction = secret; }, v => { v.stages.pop(); }, v => { v.stages[0].stage = 'other'; },
    v => { v.stages[0].status = 'done'; }, v => { v.stages[0].reasonCode = secret; }, v => { v.stages[0].at = null; },
    v => { v.stages[0].at = secret; }, v => { v.source.liveReadback = true; },
    v => { v.source.evidence[0].collection = secret; }, v => { v.source.evidence[0].exists = false; v.source.evidence[0].observedAt = null; },
    v => { v.stages[4].status = 'pending'; v.stages[4].reasonCode = 'evidence_missing'; }];
  const data = await snapshot();
  for (const mutate of changes) {
    const copy = structuredClone(data); mutate(copy);
    assert.throws(() => operationProgressView(copy, input), { code: 'SOURCE_UNAVAILABLE' });
  }
  const partial = (await inspect(fixture({ queued: false, delivered: false }))).result;
  partial.status = 'completed'; partial.nextAction = 'none';
  assert.throws(() => operationProgressView(partial, input), { code: 'SOURCE_UNAVAILABLE' });
});

test('fixed-child client spawns only Node CLI with kind/id, no shell or user credential arguments', async t => {
  const data = await snapshot(), f = childFixture(t), pending = f.run(input);
  const [command, args, options] = f.spawnImpl.mock.calls[0].arguments;
  assert.equal(command, process.execPath); assert.match(args[0], /\/scripts\/read-member-operation-progress\.mjs$/);
  assert.deepEqual(args.slice(1), ['holding', input.operationId]); assert.equal(options.shell, false);
  assert.equal(options.env.GOOGLE_APPLICATION_CREDENTIALS, `/private/${secret}.json`);
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']); assert.ok(!JSON.stringify(args).includes(secret));
  f.child.stdout.write(JSON.stringify({ ...data, privateData: secret })); f.child.emit('close', 0);
  assert.deepEqual(await pending, data); assert.equal(f.child.kill.mock.callCount(), 0);
});

test('invalid kind/id, missing credentials and pre-aborted calls spawn no child', async t => {
  const f = childFixture(t);
  await assert.rejects(f.run({ ...input, operationId: '../x' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.run({ ...input, kind: 'refund' }), { code: 'INVALID_ARGUMENT' });
  await rejectsUnavailable(f.run(input, { signal: AbortSignal.abort() }));
  await rejectsUnavailable(createOperationProgressReader({ spawnImpl: f.spawnImpl })(input));
  assert.equal(f.spawnImpl.mock.callCount(), 0);
});

test('child stdout/stderr limits, cancellation and timeout kill owned child and await close', async t => {
  for (const trigger of ['stdout', 'stderr', 'abort', 'timeout']) {
    let killed;
    const escalated = new Promise(resolve => { killed = resolve; });
    const f = childFixture(t, { maxOutputBytes: 8, timeoutMs: trigger === 'timeout' ? 1 : 1000, killGraceMs: 1 });
    f.child.kill.mock.mockImplementation(signal => { if (signal === 'SIGKILL') killed(); return true; });
    const controller = new AbortController(); let settled = false;
    const pending = rejectsUnavailable(f.run(input, { signal: controller.signal })).then(() => { settled = true; });
    if (['stdout', 'stderr'].includes(trigger)) f.child[trigger].write(secret);
    if (trigger === 'abort') controller.abort(new Error(secret));
    await escalated; assert.equal(settled, false);
    assert.deepEqual(f.child.kill.mock.calls.map(call => call.arguments[0]), ['SIGTERM', 'SIGKILL']);
    f.child.emit('close', null); await pending;
  }
});

test('spawn errors, failed CLI exit and invalid JSON are sanitized without fallback', async t => {
  await rejectsUnavailable(createOperationProgressReader({ credentialPath: secret, spawnImpl: () => { throw new Error(secret); } })(input));
  for (const mode of ['error', 'exit', 'json']) {
    const f = childFixture(t), pending = rejectsUnavailable(f.run(input));
    if (mode === 'error') f.child.emit('error', new Error(secret));
    f.child.stderr.write(secret); f.child.stdout.write(secret); f.child.emit('close', mode === 'json' ? 0 : 1);
    await pending; assert.equal(f.spawnImpl.mock.callCount(), 1);
  }
});

test('real timed-out synthetic child is reaped before reader rejects', async () => {
  let child;
  const reader = createOperationProgressReader({ credentialPath: secret, timeoutMs: 15, killGraceMs: 15,
    spawnImpl: (_command, _args, options) => { child = spawn(process.execPath,
      ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], options); return child; } });
  try {
    await rejectsUnavailable(reader(input)); assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve));
    }
  }
});

test('CLI loads only compiled inspector with exact kind/id/studio and deletes all apps even on failure', async t => {
  const data = await snapshot();
  for (const mode of ['success', 'inspect_error', 'missing_build', 'cleanup_error']) {
    const apps = [{ name: 'default' }, { name: 'secondary' }];
    const admin = { getApps: () => apps, deleteApp: t.mock.fn(async app => {
      if (mode === 'cleanup_error' && app === apps[0]) throw new Error(secret);
    }) };
    const inspector = t.mock.fn(async (args, studioId) => {
      assert.deepEqual(args, input); assert.equal(studioId, '5330');
      if (mode === 'inspect_error') throw new Error(secret); return data;
    });
    const pending = readMemberOperationProgress(input, { loadAdmin: () => admin, loadInspect: () => {
      if (mode === 'missing_build') throw new Error(secret); return inspector;
    } });
    if (mode === 'success') assert.deepEqual(await pending, data); else await assert.rejects(pending);
    assert.deepEqual(admin.deleteApp.mock.calls.map(call => call.arguments[0]), apps);
    assert.equal(inspector.mock.callCount(), mode === 'missing_build' ? 0 : 1);
  }
});

test('CLI cancellation drains inspection before completing Firebase app deletion', async t => {
  const data = await snapshot(), controller = new AbortController();
  let finishInspect, finishDelete, deletionStarted;
  const deleting = new Promise(resolve => { deletionStarted = resolve; });
  const admin = { getApps: () => [{}], deleteApp: t.mock.fn(() => {
    deletionStarted(); return new Promise(resolve => { finishDelete = resolve; });
  }) };
  let settled = false;
  const pending = assert.rejects(readMemberOperationProgress(input, { loadAdmin: () => admin,
    loadInspect: () => () => new Promise(resolve => { finishInspect = resolve; }), signal: controller.signal }))
    .then(() => { settled = true; });
  controller.abort(); assert.equal(admin.deleteApp.mock.callCount(), 0); assert.equal(settled, false);
  finishInspect(data); await deleting; assert.equal(settled, false); finishDelete(); await pending;
});

test('unsafe real CLI arguments exit with generic output and no backend loading', async () => {
  const child = spawn(process.execPath, [new URL('../../../scripts/read-member-operation-progress.mjs', import.meta.url).pathname,
    'holding', `../${secret}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 1); assert.equal(stdout, ''); assert.equal(stderr, 'Member operation progress unavailable.\n');
});

test('CLI and runtime use fixed compiled module and injected reader without sender or TypeScript fallback', async () => {
  const source = await readFile(new URL('../../../scripts/read-member-operation-progress.mjs', import.meta.url), 'utf8');
  assert.match(source, /functions\/lib\/operations\/memberOperationProgress\.js/);
  assert.doesNotMatch(source, /processAlimtalkQueue|queueDailyAlimtalk|\.ts['"]|execSync|shell:/);
  const entry = await readFile(new URL('../src/index.mjs', import.meta.url), 'utf8');
  assert.match(entry, /operationProgressReader: createOperationProgressReader\(\{ credentialPath: settings.credentialPath \}\)/);
});
