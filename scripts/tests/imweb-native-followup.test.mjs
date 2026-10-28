import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createImwebNativeFollowupStore, imwebPayloadDigest, runApprovedImwebWrite } from '../lib/imweb-native-followup.mjs';
import { imwebRequestFailure } from '../lib/imweb-read-failure.mjs';

const START = '2026-10-28T03:00:00.000Z';
const quota = () => ({ stdout: JSON.stringify({ ok: false, error: { classification: 'write_quota_exceeded',
  message: 'private token=synthetic-secret', context: { email: 'synthetic@example.test' } } }) });
function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'imweb-native-synthetic-')));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let time = START;
  const create = io => createImwebNativeFollowupStore({ directory, now: () => time, ...(io ? { io } : {}) });
  const operation = {
    canonicalActionKey: 'synthetic_product_88_status_v1', siteCode: 'synthetic-site', unitCode: 'synthetic-unit',
    approvedScope: { action: 'product.update.status', targetIds: ['product-88'], fields: ['prodStatus'] },
    payloadDigest: imwebPayloadDigest({ prodStatus: 'nosale' }),
    approvalRef: 'chat:synthetic-approval', ledgerRef: 'ledger:synthetic-product-88',
    approvedAt: '2026-10-28T02:00:00Z', approvalExpiresAt: '2026-10-28T04:00:00Z',
  };
  const readback = (outcome = 'not_applied', patch = {}) => ({ siteCode: operation.siteCode, unitCode: operation.unitCode,
    scopeDigest: imwebPayloadDigest(operation.approvedScope), source: 'independent_readback',
    evidenceRef: outcome === 'not_applied' ? 'proof:preflight' : 'proof:after-save', observedAt: time, outcome,
    canonicalOutcome: outcome === 'applied' ? 'applied' : 'not_dispatched',
    observedPayloadDigest: outcome === 'applied' ? operation.payloadDigest : null,
    invariantsPreserved: true, ...patch });
  const store = create();
  return { directory, operation, store, create, readback, setTime: value => { time = value; },
    prepare: () => store.prepare({ operation, failure: quota() }),
    claim: (patch = {}) => store.claim({ operation, executor: { kind: 'active_codex_turn', turnId: 'synthetic-turn' },
      readback: readback(), ...patch }),
    key: operation.canonicalActionKey };
}

test('payload digests are canonical JSON and reject lossy or non-JSON inputs', () => {
  assert.equal(imwebPayloadDigest({ b: [1, true], a: null }), imwebPayloadDigest({ a: null, b: [1, true] }));
  assert.notEqual(imwebPayloadDigest(['a', 'b']), imwebPayloadDigest(['b', 'a']));
  const circular = {}; circular.loop = circular;
  const sparseWithExtra = [, 1]; sparseWithExtra.extra = 'synthetic';
  for (const value of [undefined, NaN, Infinity, new Date(), { absent: undefined }, [, 1], sparseWithExtra, circular]) {
    assert.throws(() => imwebPayloadDigest(value), { code: 'INVALID_PAYLOAD' });
  }
});

test('contradictory applied readback cannot mark an action verified',t=>{
  const f=fixture(t);f.prepare();const claim=f.claim();
  for(const canonicalOutcome of ['unknown','not_dispatched']){
    const readback=f.readback('applied',{canonicalOutcome});
    assert.throws(()=>f.store.verify({canonicalActionKey:f.key,claimId:claim.claimId,readback}),{code:'READBACK_BINDING_CONFLICT'});
    assert.throws(()=>f.store.reconcile({canonicalActionKey:f.key,readback}),{code:'READBACK_BINDING_CONFLICT'});
    assert.equal(f.store.get(f.key).status,'claimed');
  }
});

test('prepare persists only private metadata, survives reopen and deduplicates identical actions', t => {
  const f = fixture(t);
  assert.equal(f.prepare().created, true);
  assert.equal(f.create().prepare({ operation: f.operation, failure: imwebRequestFailure(quota()) }).created, false);
  const files = fs.readdirSync(f.directory);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  const file = path.join(f.directory, files[0]);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const saved = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(saved, /synthetic-secret|@|stdout|stderr|message|nosale|confirmation_token/);
  assert.equal(f.create().get(f.key).status, 'prepared');
  assert.equal(f.store.get('synthetic-missing'), null);
});

test('same canonical action cannot silently change payload, target, scope, approval or ledger', t => {
  const f = fixture(t); f.prepare();
  for (const change of [
    op => { op.payloadDigest = imwebPayloadDigest({ prodStatus: 'sale' }); },
    op => { op.siteCode = 'other-site'; }, op => { op.unitCode = 'other-unit'; },
    op => { op.approvedScope.targetIds = ['product-89']; }, op => { op.approvedScope.fields = ['price']; },
    op => { op.approvedScope.action = 'product.create'; },
    op => { op.approvalRef = 'chat:other-approval'; }, op => { op.ledgerRef = 'ledger:other'; },
    op => { op.approvalExpiresAt = '2026-10-28T05:00:00Z'; },
  ]) {
    const operation = structuredClone(f.operation); change(operation);
    assert.throws(() => f.store.prepare({ operation, failure: quota() }), { code: 'OPERATION_CONFLICT' });
    assert.throws(() => f.claim({ operation }), { code: 'OPERATION_CONFLICT' });
  }
});

test('invalid metadata, unknown failures and unapproved or expired windows never create a handoff', t => {
  const f = fixture(t);
  for (const failure of [Error('write_quota_exceeded'), { code: 'ECONNRESET' },
    { error: { classification: 'write_quota_exceeded', status_code: 429 } }]) {
    assert.throws(() => f.store.prepare({ operation: f.operation, failure }), { code: 'QUOTA_NOT_PROVEN_LOCAL' });
  }
  for (const patch of [{ payload: { secret: 'not-allowed' } }, { payloadDigest: 'not-a-digest' },
    { approvalRef: 'token=not-allowed' }, { ledgerRef: 'https://example.test/?token=secret' },
    { approvedScope: { action: 'product.update', targetIds: ['p', 'p'], fields: ['price'] } }]) {
    assert.throws(() => f.store.prepare({ operation: { ...f.operation, ...patch }, failure: quota() }));
  }
  f.setTime('2026-10-28T01:59:59Z');
  assert.throws(f.prepare, { code: 'STALE_APPROVAL' });
  f.setTime('2026-10-28T04:00:00Z');
  assert.throws(f.prepare, { code: 'STALE_APPROVAL' });
  assert.deepEqual(fs.readdirSync(f.directory), []);
});

test('only a fresh, exactly bound active Codex turn can claim once across store instances', t => {
  const f = fixture(t); f.prepare();
  assert.throws(() => f.claim({ executor: { kind: 'unattended_script', turnId: 'synthetic-turn' } }),
    { code: 'CLAIM_REQUIRES_ACTIVE_CODEX_TURN' });
  for (const patch of [{ siteCode: 'other' }, { unitCode: 'other' }, { scopeDigest: '0'.repeat(64) },
    { source: 'write_response' }, { outcome: 'unknown' }, { canonicalOutcome: 'unknown' },
    { canonicalOutcome: 'applied' }, { invariantsPreserved: false },
    { observedAt: '2026-10-28T02:57:59Z' }, { observedAt: '2026-10-28T03:00:01Z' }]) {
    assert.throws(() => f.claim({ readback: f.readback('not_applied', patch) }));
    assert.equal(f.store.get(f.key).status, 'prepared');
  }
  const claim = f.claim();
  assert.equal(claim.canonicalActionKey, f.key);
  assert.equal(f.create().get(f.key).claim.id, claim.claimId);
  assert.throws(f.claim, { code: 'RECONCILIATION_REQUIRED' });
  assert.equal(f.prepare().record.status, 'claimed');
});

test('expiry blocks a prepared claim even with unchanged approval reference', t => {
  const f = fixture(t); f.prepare(); f.setTime('2026-10-28T04:00:00Z');
  assert.throws(f.claim, { code: 'STALE_APPROVAL' });
  assert.equal(f.store.get(f.key).status, 'prepared');
});

test('verify requires the claim and independent post-claim readback, preserving first verification', t => {
  const f = fixture(t); f.prepare(); const claim = f.claim();
  const verify = readback => f.store.verify({ canonicalActionKey: f.key, claimId: claim.claimId, readback });
  assert.throws(() => f.store.verify({ canonicalActionKey: f.key, claimId: 'other', readback: f.readback('applied') }),
    { code: 'CLAIM_MISMATCH' });
  assert.throws(() => verify(f.readback()), { code: 'RECONCILIATION_REQUIRED' });
  for (const patch of [{ observedPayloadDigest: '0'.repeat(64) }, { invariantsPreserved: false },
    { evidenceRef: 'proof:preflight' }, { observedAt: '2026-10-28T02:59:59Z' }, { source: 'write_response' }]) {
    assert.throws(() => verify(f.readback('applied', patch)));
  }
  f.setTime('2026-10-28T03:00:01Z');
  const first = verify(f.readback('applied'));
  assert.equal(first.status, 'verified');
  f.setTime('2026-10-28T03:00:02Z');
  assert.deepEqual(verify(f.readback('applied')), first);
  assert.throws(f.claim, { code: 'RECONCILIATION_REQUIRED' });
});

for (const outcome of ['unknown', 'not_applied']) test(`${outcome} after claim remains reconciliation-only, never replayable`, t => {
  const f = fixture(t); f.prepare(); const claim = f.claim();
  f.setTime('2026-10-28T03:00:01Z');
  const record = f.store.reconcile({ canonicalActionKey: f.key,
    readback: f.readback(outcome, { evidenceRef: 'proof:reconcile', canonicalOutcome: 'unknown' }) });
  assert.equal(record.status, 'result_unknown');
  assert.equal(record.claim.id, claim.claimId);
  assert.throws(f.claim, { code: 'RECONCILIATION_REQUIRED' });
  assert.equal(f.prepare().record.status, 'result_unknown');
  f.setTime('2026-10-28T04:30:00Z');
  assert.equal(f.store.reconcile({ canonicalActionKey: f.key, readback: f.readback('applied') }).status, 'verified');
});

test('already-applied preflight is reconciled without issuing a claim', t => {
  const f = fixture(t); f.prepare();
  assert.throws(() => f.claim({ readback: f.readback('applied') }), { code: 'RECONCILIATION_REQUIRED' });
  const record = f.store.reconcile({ canonicalActionKey: f.key, readback: f.readback('applied') });
  assert.equal(record.status, 'verified'); assert.equal(record.claim, null);
  assert.throws(f.claim, { code: 'RECONCILIATION_REQUIRED' });
  assert.throws(() => f.store.reconcile({ canonicalActionKey: f.key, readback: f.readback() }), { code: 'ALREADY_VERIFIED' });
});

test('lock contention is explicit and does not remove another owner lock', t => {
  const f = fixture(t), lock = path.join(f.directory, '.native-followup.lock');
  fs.writeFileSync(lock, 'synthetic-owner', { mode: 0o600 });
  assert.throws(f.prepare, { code: 'FOLLOWUP_BUSY' });
  assert.equal(fs.readFileSync(lock, 'utf8'), 'synthetic-owner');
});

for (const phase of ['writeFileSync', 'fsyncSync', 'renameSync']) test(`prepare ${phase} failure is sanitized and creates no executable handoff`, t => {
  const f = fixture(t);
  const store = f.create({ ...fs, [phase]() { throw Error('private filesystem diagnostic secret'); } });
  assert.throws(() => store.prepare({ operation: f.operation, failure: quota() }), error => {
    assert.equal(error.code, 'FOLLOWUP_PERSISTENCE_FAILED');
    assert.doesNotMatch(error.message, /private|secret/); return true;
  });
  assert.equal(f.store.get(f.key), null);
  assert.deepEqual(fs.readdirSync(f.directory), []);
});

test('failed claim persistence gives no claim and leaves the prepared record unchanged', t => {
  const f = fixture(t); f.prepare();
  const store = f.create({ ...fs, renameSync() { throw Error('synthetic disk full'); } });
  assert.throws(() => store.claim({ operation: f.operation,
    executor: { kind: 'active_codex_turn', turnId: 'synthetic-turn' }, readback: f.readback() }),
  { code: 'FOLLOWUP_PERSISTENCE_FAILED' });
  assert.equal(f.store.get(f.key).status, 'prepared');
});

test('uncertain directory fsync after claim rename cannot lead to a second claim', t => {
  const f = fixture(t); f.prepare();
  const store = f.create({ ...fs, fsyncSync(fd) {
    if (fs.fstatSync(fd).isDirectory()) throw Error('synthetic directory sync failure');
    return fs.fsyncSync(fd);
  } });
  assert.throws(() => store.claim({ operation: f.operation,
    executor: { kind: 'active_codex_turn', turnId: 'synthetic-turn' }, readback: f.readback() }),
  { code: 'FOLLOWUP_PERSISTENCE_FAILED' });
  assert.equal(f.store.get(f.key).status, 'claimed');
  assert.throws(f.claim, { code: 'RECONCILIATION_REQUIRED' });
});

test('verification persistence failure retains non-replayable claim for reconciliation', t => {
  const f = fixture(t); f.prepare(); const claim = f.claim();
  const store = f.create({ ...fs, renameSync() { throw Error('synthetic disk full'); } });
  assert.throws(() => store.verify({ canonicalActionKey: f.key, claimId: claim.claimId, readback: f.readback('applied') }),
    { code: 'FOLLOWUP_PERSISTENCE_FAILED' });
  assert.equal(f.store.get(f.key).status, 'claimed');
  assert.throws(f.claim, { code: 'RECONCILIATION_REQUIRED' });
});

test('unsafe directories, symlink records and corrupt files fail closed', t => {
  const f = fixture(t); f.prepare();
  fs.chmodSync(f.directory, 0o755);
  assert.throws(f.prepare, { code: 'UNSAFE_DIRECTORY' }); fs.chmodSync(f.directory, 0o700);
  const file = path.join(f.directory, fs.readdirSync(f.directory)[0]);
  fs.writeFileSync(file, '{broken');
  assert.throws(() => f.store.get(f.key), { code: 'FOLLOWUP_PERSISTENCE_FAILED' });
  fs.unlinkSync(file); fs.symlinkSync('does-not-exist', file);
  assert.throws(f.prepare, { code: 'FOLLOWUP_PERSISTENCE_FAILED' });
});

test('approved CLI executes once, quota creates durable handoff and repeats never call CLI', async t => {
  const f = fixture(t); let calls = 0;
  const run = () => runApprovedImwebWrite({ operation: f.operation, payload: { prodStatus: 'nosale' }, store: f.store,
    execute() { calls++; throw quota(); } });
  for (let repeat = 0; repeat < 2; repeat++) {
    await assert.rejects(run, error => {
      assert.equal(error.code, 'IMWEB_NATIVE_ADMIN_REQUIRED');
      assert.equal(error.canonicalActionKey, f.key);
      assert.equal(error.status, 'prepared');
      assert.doesNotMatch(JSON.stringify(error), /nosale|secret|payload|stdout|@/);
      return true;
    });
  }
  assert.equal(calls, 1);
  assert.equal(f.store.get(f.key).trigger.dispatchState, 'blocked_before_dispatch');
});

for (const prior of ['prepared', 'claimed', 'result_unknown', 'verified']) {
  test(`approved wrapper never executes a prior ${prior} operation`, async t => {
    const f = fixture(t); f.prepare();
    if (prior === 'claimed' || prior === 'result_unknown') f.claim();
    if (prior === 'result_unknown') f.store.reconcile({ canonicalActionKey: f.key,
      readback: f.readback('unknown', { evidenceRef: 'proof:reconcile' }) });
    if (prior === 'verified') f.store.reconcile({ canonicalActionKey: f.key, readback: f.readback('applied') });
    let calls = 0;
    await assert.rejects(() => runApprovedImwebWrite({ operation: f.operation, payload: { prodStatus: 'nosale' }, store: f.store,
      execute() { calls++; return {}; } }), {
      code: prior === 'prepared' ? 'IMWEB_NATIVE_ADMIN_REQUIRED' : 'IMWEB_WRITE_RECONCILIATION_REQUIRED', status: prior,
    });
    assert.equal(calls, 0);
  });
}

test('approved payload mismatch and stale approval fail before CLI or journal creation', async t => {
  const f = fixture(t); let calls = 0;
  const execute = () => { calls++; };
  await assert.rejects(() => runApprovedImwebWrite({ operation: f.operation,
    payload: { prodStatus: 'sale' }, execute, store: f.store }), { code: 'OPERATION_PAYLOAD_MISMATCH' });
  f.setTime('2026-10-28T04:00:00Z');
  await assert.rejects(() => runApprovedImwebWrite({ operation: f.operation,
    payload: { prodStatus: 'nosale' }, execute, store: f.store }), { code: 'STALE_APPROVAL' });
  assert.equal(calls, 0); assert.deepEqual(fs.readdirSync(f.directory), []);
});

for (const failure of [
  { error: { status_code: 401 } }, { error: { status_code: 429 } }, { code: 'ECONNRESET' },
  { error: { classification: 'write_quota_exceeded', dispatched: true } }, Error('unknown outcome'),
]) test('non-local CLI failures propagate without native handoff and cannot be automatically replayed', async t => {
  const f = fixture(t); let calls = 0;
  const run = () => runApprovedImwebWrite({ operation: f.operation, payload: { prodStatus: 'nosale' }, store: f.store,
    execute() { calls++; throw failure; } });
  await assert.rejects(run, error => error === failure);
  const record = f.store.get(f.key);
  assert.equal(record.status, 'cli_pending'); assert.equal(record.trigger, null);
  await assert.rejects(run, { code: 'IMWEB_WRITE_RECONCILIATION_REQUIRED' });
  assert.equal(calls, 1);
});

test('accepted CLI result is distinct from verified and never re-executes', async t => {
  const f = fixture(t); let calls = 0;
  const run = () => runApprovedImwebWrite({ operation: f.operation, payload: { prodStatus: 'nosale' }, store: f.store,
    async execute() { calls++; return { accepted: true }; } });
  assert.deepEqual(await run(), { accepted: true });
  assert.equal(f.store.get(f.key).status, 'cli_accepted');
  await assert.rejects(run, { code: 'IMWEB_WRITE_RECONCILIATION_REQUIRED' });
  assert.equal(calls, 1);
  assert.equal(f.store.reconcile({ canonicalActionKey: f.key, readback: f.readback('applied') }).status, 'verified');
});

test('concurrent approved wrappers share one durable CLI reservation', async t => {
  const f = fixture(t); let release, calls = 0;
  const result = new Promise(resolve => { release = resolve; });
  const run = () => runApprovedImwebWrite({ operation: f.operation, payload: { prodStatus: 'nosale' }, store: f.create(),
    execute() { calls++; return result; } });
  const first = run();
  await assert.rejects(run, { code: 'IMWEB_WRITE_RECONCILIATION_REQUIRED', status: 'cli_pending' });
  release({ accepted: true }); await first;
  assert.equal(calls, 1);
});

test('CLI intent persistence failure prevents execute; handoff persistence failure is never implicit success', async t => {
  const f = fixture(t); let calls = 0;
  const broken = f.create({ ...fs, renameSync() { throw Error('synthetic disk full'); } });
  await assert.rejects(() => runApprovedImwebWrite({ operation: f.operation, payload: { prodStatus: 'nosale' }, store: broken,
    execute() { calls++; } }), { code: 'FOLLOWUP_PERSISTENCE_FAILED' });
  assert.equal(calls, 0);
  let renames = 0;
  const failHandoff = f.create({ ...fs, renameSync(...args) {
    if (++renames === 2) throw Error('synthetic disk full');
    return fs.renameSync(...args);
  } });
  await assert.rejects(() => runApprovedImwebWrite({ operation: f.operation, payload: { prodStatus: 'nosale' }, store: failHandoff,
    execute() { calls++; throw quota(); } }), { code: 'FOLLOWUP_PERSISTENCE_FAILED' });
  assert.equal(calls, 1);
  assert.equal(f.store.get(f.key).status, 'cli_pending');
});

test('wrapper rejects a different approved payload under an existing canonical key before execute', async t => {
  const f = fixture(t); f.prepare(); let calls = 0;
  await assert.rejects(() => runApprovedImwebWrite({
    operation: { ...f.operation, payloadDigest: imwebPayloadDigest({ prodStatus: 'sale' }) },
    payload: { prodStatus: 'sale' }, store: f.store, execute() { calls++; },
  }), { code: 'OPERATION_CONFLICT' });
  assert.equal(calls, 0);
});

test('failure to persist CLI acceptance cannot permit replay of the accepted write', async t => {
  const f = fixture(t); let renames = 0, calls = 0;
  const store = f.create({ ...fs, renameSync(...args) {
    if (++renames === 2) throw Error('synthetic disk full');
    return fs.renameSync(...args);
  } });
  const run = () => runApprovedImwebWrite({ operation: f.operation, payload: { prodStatus: 'nosale' }, store,
    execute() { calls++; return { accepted: true }; } });
  await assert.rejects(run, { code: 'FOLLOWUP_PERSISTENCE_FAILED' });
  await assert.rejects(run, { code: 'IMWEB_WRITE_RECONCILIATION_REQUIRED' });
  assert.equal(calls, 1);
});

test('approval expiring during durable claim persistence returns no execution capability', t => {
  const f = fixture(t); f.prepare();
  const store = f.create({ ...fs, renameSync(...args) {
    const result = fs.renameSync(...args);
    f.setTime('2026-10-28T04:00:00Z');
    return result;
  } });
  assert.throws(() => store.claim({ operation: f.operation,
    executor: { kind: 'active_codex_turn', turnId: 'synthetic-turn' }, readback: f.readback() }),
  { code: 'STALE_APPROVAL' });
  assert.equal(f.store.get(f.key).status, 'claimed');
});
