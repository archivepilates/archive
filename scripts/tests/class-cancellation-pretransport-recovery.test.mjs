import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClassCorrectionLedger} from '../lib/class-cancellation-correction-ledger.mjs';
import {evaluateClassCancellation} from '../lib/class-cancellation-policy.mjs';
import {runClassCancellationCorrection} from '../lib/class-cancellation-correction-worker.mjs';
import {fingerprintClassCorrectionRecord, createApprovedPretransportRecovery, withResolvedPretransportRecoveries} from '../lib/class-cancellation-pretransport-recovery.mjs';

const KEY = 'f5e3f1ddfe13a4f87a9ac844cc4b9da07974831d3adae0913f863de2a6261a3b';
const OTHER = 'b'.repeat(64);
const APPROVAL_REF = 'call_d627988c9804489da845fbc483aa2e0e';
const NOW = '2026-11-13T14:00:00+09:00';
const clone = value => structuredClone(value);

async function fixture(t, patch = {}, originalKey = KEY) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'class-pretransport-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const baseDirectory = path.join(directory, 'base'), childDirectory = path.join(directory, 'child');
  const resolutionDirectory = path.join(directory, 'resolutions');
  const baseLedger = createClassCorrectionLedger(baseDirectory), recoveryLedger = createClassCorrectionLedger(childDirectory);
  const row = {date: '2026-12-05', startTime: '09:00', staffName: 'Synthetic Instructor', lessonType: '\uadf8\ub8f9',
    category: '\uadf8\ub8f9', title: 'Synthetic Group', room: '', cancelDeadline: '2026-12-05 03:00:00'};
  const policy = evaluateClassCancellation(row);
  await baseLedger.claim(originalKey, {row, policy});
  await baseLedger.update(originalKey, {status: 'unknown', reason: 'before_submit_blocked', ...patch});
  const parentFile = path.join(baseDirectory, originalKey + '.json'), resolutionFile = path.join(resolutionDirectory, originalKey + '.json');
  const original = await baseLedger.read(originalKey), raw = await fs.readFile(parentFile);
  const approval = {version: 'class_cancellation_pretransport_recovery_v1', approvalRef: APPROVAL_REF,
    originalKey, originalDigest: fingerprintClassCorrectionRecord(original), approvedAt: '2026-11-13T13:00:00+09:00',
    expiresAt: '2026-11-14T13:00:00+09:00', proof: 'before_submit_blocked_transport_gate_never_armed',
    date: row.date, startTime: row.startTime, expectedDeadline: policy.expectedDeadline};
  const f = {baseLedger, recoveryLedger, resolutionDirectory, parentFile, resolutionFile, childDirectory, original, raw, approval,
    clock: NOW, evidence: {status: 'intent', row: clone(row), policy: clone(policy)}};
  f.options = (extra = {}) => ({baseLedger, recoveryLedger, resolutionDirectory, approval: clone(approval), now: () => f.clock, ...extra});
  f.view = () => withResolvedPretransportRecoveries({baseLedger, recoveryLedger, resolutionDirectory});
  f.verified = async () => {
    const recovery = await createApprovedPretransportRecovery(f.options());
    assert.equal(await recovery.ledger.claim(originalKey, f.evidence), true);
    await recovery.ledger.update(originalKey, {status: 'submitted', submittedAt: NOW});
    await recovery.ledger.update(originalKey, {status: 'verified', verifiedAt: NOW});
    return recovery;
  };
  return f;
}

test('approved recovery claims a deterministic isolated child and never modifies the original unknown', async t => {
  const f = await fixture(t), recovery = await createApprovedPretransportRecovery(f.options());
  assert.equal(fingerprintClassCorrectionRecord(f.original), createHash('sha256').update(JSON.stringify(f.original)).digest('hex'));
  assert.equal(recovery.targetKey, KEY);
  assert.equal(recovery.recoveryKey, createHash('sha256').update(JSON.stringify([
    KEY, f.approval.originalDigest, APPROVAL_REF, f.approval.version,
  ])).digest('hex'));
  assert.notEqual(recovery.recoveryKey, KEY);
  assert.equal(await recovery.ledger.read(KEY), null);
  assert.equal(await recovery.ledger.claim(KEY, f.evidence), true);
  assert.equal(await recovery.ledger.claim(KEY, f.evidence), false);
  const child = await recovery.ledger.read(KEY);
  assert.equal(child.key, recovery.recoveryKey);
  assert.equal(child.parentKey, KEY);
  assert.equal(child.parentDigest, f.approval.originalDigest);
  assert.deepEqual(child.approval, f.approval);
  assert.deepEqual(await fs.readFile(f.parentFile), f.raw);
  for (const method of ['read', 'claim', 'update']) await assert.rejects(recovery.ledger[method](OTHER, f.evidence), /single-key/);
  for (const field of ['parentKey', 'parentDigest', 'approvalRef', 'approval', 'row', 'policy', 'key']) {
    await assert.rejects(recovery.ledger.update(KEY, {status: 'submitted', [field]: 'changed'}), /immutable/);
  }
});

for (const patch of [{reason: 'correction_not_verified'}, {reason: undefined}, {status: 'submitted'}, {status: 'verified'},
  {status: 'review'}, {submittedAt: NOW}, {transport: {accepted: true}}, {transportArmed: true}]) {
  test(`generic or possibly dispatched records cannot be recovered: ${JSON.stringify(patch)}`, async t => {
    const f = await fixture(t, patch);
    await assert.rejects(createApprovedPretransportRecovery(f.options()), /before-submit unknown/);
    assert.deepEqual(await fs.readFile(f.parentFile), f.raw);
    assert.deepEqual(await f.view().read(KEY), f.original);
  });
}

test('explicit proof, exact schema, identity, digest and computed deadline are mandatory', async t => {
  const f = await fixture(t);
  for (const change of [{proof: undefined}, {proof: 'unknown_is_safe'}, {approvalRef: ''}, {version: 'other'},
    {originalDigest: 'f'.repeat(64)}, {originalKey: OTHER}, {date: '2026-12-06'}, {startTime: '10:00'},
    {expectedDeadline: '2026-12-04 22:00:00'}, {extra: 'not approved'}]) {
    await assert.rejects(createApprovedPretransportRecovery(f.options({approval: {...f.approval, ...change}})));
  }
  const withoutProof = clone(f.approval); delete withoutProof.proof;
  await assert.rejects(createApprovedPretransportRecovery(f.options({approval: withoutProof})), /proof/);
  await assert.rejects(createApprovedPretransportRecovery(f.options({now: undefined})), /clock/);
  await assert.rejects(createApprovedPretransportRecovery(f.options({recoveryLedger: f.baseLedger})), /separate/);
  assert.equal(await f.recoveryLedger.read(KEY), null);
});

test('zoned ISO validation, calendar dates, positive intervals and the 24h maximum fail closed', async t => {
  const f = await fixture(t);
  for (const change of [{approvedAt: '2026-11-13T13:00:00'}, {approvedAt: '2026-02-30T13:00:00+09:00'},
    {approvedAt: '2026-11-13T24:00:00+09:00'}, {approvedAt: '0000-11-13T13:00:00Z'},
    {expiresAt: '2026-11-14T13:00:00.001+09:00'}, {expiresAt: f.approval.approvedAt},
    {approvedAt: '2026-11-13T15:00:00+09:00'}, {expiresAt: NOW}]) {
    await assert.rejects(createApprovedPretransportRecovery(f.options({approval: {...f.approval, ...change}})));
  }
  const recovery = await createApprovedPretransportRecovery(f.options());
  f.clock = f.approval.expiresAt;
  for (const method of ['read', 'claim', 'update']) await assert.rejects(recovery.ledger[method](KEY, f.evidence), /expired/);
  await assert.rejects(recovery.complete(), /expired/);
});

test('cloned approval and live nonregressing clock cannot be replaced by caller mutation', async t => {
  const f = await fixture(t), options = f.options(), recovery = await createApprovedPretransportRecovery(options);
  options.approval.proof = 'changed';
  assert.equal(await recovery.ledger.claim(KEY, f.evidence), true);
  f.clock = '2026-11-13T13:59:59+09:00';
  await assert.rejects(recovery.ledger.read(KEY), /regressing/);
});

test('every operation rejects a changed parent, including complete after verified child', async t => {
  const f = await fixture(t), recovery = await f.verified();
  const changed = {...f.original, reasonDetail: 'source record changed'};
  await fs.writeFile(f.parentFile, JSON.stringify(changed));
  for (const method of ['read', 'claim', 'update']) await assert.rejects(recovery.ledger[method](KEY, f.evidence), /unchanged/);
  await assert.rejects(recovery.complete(), /unchanged/);
  await assert.rejects(fs.access(f.resolutionFile), {code: 'ENOENT'});
});

for (const status of ['intent', 'submitted', 'unknown', 'review']) {
  test(`approval alone or ${status} child cannot produce a resolution`, async t => {
    const f = await fixture(t), recovery = await createApprovedPretransportRecovery(f.options());
    await assert.rejects(recovery.complete(), /binding/);
    await recovery.ledger.claim(KEY, f.evidence);
    if (status !== 'intent') await recovery.ledger.update(KEY, {status});
    await assert.rejects(recovery.complete(), /verified child/);
    assert.deepEqual(await f.view().read(KEY), f.original);
    await assert.rejects(fs.access(f.resolutionFile), {code: 'ENOENT'});
  });
}

test('child class/policy binding is checked at claim and at verified completion', async t => {
  const f = await fixture(t), recovery = await createApprovedPretransportRecovery(f.options());
  for (const change of [{row: {...f.evidence.row, staffName: 'Other'}},
    {row: {...f.evidence.row, startTime: '10:00'}}, {policy: {...f.evidence.policy, expectedDeadline: 'wrong'}}]) {
    await assert.rejects(recovery.ledger.claim(KEY, {...f.evidence, ...change}), /target/);
  }
  await recovery.ledger.claim(KEY, f.evidence);
  await assert.rejects(recovery.ledger.update(KEY, {status: 'verified'}), /timestamp/);
  await assert.rejects(recovery.ledger.update(KEY, {status: 'verified', verifiedAt: f.approval.expiresAt}), /interval/);
  const childFile = path.join(f.childDirectory, recovery.recoveryKey + '.json');
  const child = await f.recoveryLedger.read(recovery.recoveryKey);
  await fs.writeFile(childFile, JSON.stringify({...child, status: 'verified', verifiedAt: NOW, parentDigest: OTHER}));
  await assert.rejects(recovery.complete(), /binding/);
});

test('verified child yields an immutable private resolution and repeat reads preserve raw unknown forever', async t => {
  const f = await fixture(t), recovery = await f.verified();
  assert.deepEqual(await f.view().read(KEY), f.original, 'verified child without resolution is not adopted');
  const resolution = await recovery.complete(), rawResolution = await fs.readFile(f.resolutionFile);
  assert.equal(resolution.originalDigest, f.approval.originalDigest);
  assert.equal(resolution.childKey, recovery.recoveryKey);
  assert.equal(resolution.childDigest, fingerprintClassCorrectionRecord(await f.recoveryLedger.read(recovery.recoveryKey)));
  assert.equal((await fs.stat(f.resolutionFile)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(f.resolutionDirectory)).mode & 0o777, 0o700);
  for (let index = 0; index < 3; index++) {
    const record = await f.view().read(KEY);
    assert.equal(record.status, 'verified'); assert.equal(record.originalStatus, 'unknown');
    assert.equal(record.recoveryKey, recovery.recoveryKey);
    assert.deepEqual(await fs.readFile(f.parentFile), f.raw);
    assert.deepEqual(await fs.readFile(f.resolutionFile), rawResolution);
  }
  f.clock = '2026-12-01T14:00:00+09:00';
  assert.equal((await f.view().read(KEY)).status, 'verified', 'historical resolution does not expire');
  await assert.rejects(createApprovedPretransportRecovery(f.options({now: () => NOW})), /existing resolution/);
  await assert.rejects(recovery.complete(), /expired/);
  f.clock = NOW;
  await assert.rejects(createApprovedPretransportRecovery(f.options({approval: {...f.approval, approvalRef: 'call_other'}})), /existing resolution/);
});

test('completed resolution is exclusive and cannot be overwritten or used to retry an unknown child', async t => {
  const f = await fixture(t), recovery = await f.verified();
  await recovery.complete(); const raw = await fs.readFile(f.resolutionFile);
  await assert.rejects(recovery.complete(), {code: 'EEXIST'});
  assert.deepEqual(await fs.readFile(f.resolutionFile), raw);
  const other = await fixture(t), pending = await createApprovedPretransportRecovery(other.options());
  await pending.ledger.claim(KEY, other.evidence); await pending.ledger.update(KEY, {status: 'unknown'});
  assert.equal(await pending.ledger.claim(KEY, other.evidence), false);
  await assert.rejects(pending.ledger.update(KEY, {status: 'intent'}), /Terminal/);
});

test('corrupt resolution references, JSON, bindings and child drift always throw rather than hiding unknown', async t => {
  const f = await fixture(t), recovery = await f.verified(), resolution = await recovery.complete();
  for (const patch of [{version: 'other'}, {originalKey: OTHER}, {originalDigest: OTHER}, {childKey: OTHER},
    {childDigest: OTHER}, {approvalRef: 'call_wrong'}, {approvalDigest: OTHER}, {resolvedAt: '2026-11-13T12:00:00+09:00'},
    {resolvedAt: f.approval.expiresAt}, {extra: 'not canonical'}]) {
    await fs.writeFile(f.resolutionFile, JSON.stringify({...resolution, ...patch}));
    await assert.rejects(f.view().read(KEY));
  }
  for (const corrupt of ['{invalid json', 'null', '[]', '0']) {
    await fs.writeFile(f.resolutionFile, corrupt); await assert.rejects(f.view().read(KEY));
  }
  await fs.writeFile(f.resolutionFile, JSON.stringify(resolution));
  const childFile = path.join(f.childDirectory, recovery.recoveryKey + '.json');
  const child = await f.recoveryLedger.read(recovery.recoveryKey);
  await fs.writeFile(childFile, JSON.stringify({...child, extra: 'changed'}));
  await assert.rejects(f.view().read(KEY), /child reference/);
  await fs.writeFile(childFile, JSON.stringify(child));
  await fs.writeFile(f.parentFile, JSON.stringify({...f.original, extra: 'changed'}));
  await assert.rejects(f.view().read(KEY), /parent reference/);
});

test('even a matching child digest cannot substitute a different target, proof, parent or nonverified child', async t => {
  const f = await fixture(t), recovery = await f.verified(), resolution = await recovery.complete();
  const childFile = path.join(f.childDirectory, recovery.recoveryKey + '.json');
  const child = await f.recoveryLedger.read(recovery.recoveryKey);
  for (const patch of [{status: 'unknown'}, {parentKey: OTHER}, {parentDigest: OTHER}, {approvalRef: 'call_wrong'},
    {approval: {...child.approval, proof: 'unproved'}}, {approval: {...child.approval, approvedAt: NOW}},
    {row: {...child.row, startTime: '10:00'}}, {row: {...child.row, staffName: 'Other'}},
    {policy: {...child.policy, expectedDeadline: '2026-12-04 22:00:00'}}]) {
    const changed = {...child, ...patch};
    await fs.writeFile(childFile, JSON.stringify(changed));
    await fs.writeFile(f.resolutionFile, JSON.stringify({...resolution, childDigest: fingerprintClassCorrectionRecord(changed)}));
    await assert.rejects(f.view().read(KEY));
  }
});

test('resolution file permissions, directory permissions, symlinks and corrupt files fail closed', async t => {
  const f = await fixture(t), recovery = await f.verified(); await recovery.complete();
  await fs.chmod(f.resolutionFile, 0o644); await assert.rejects(f.view().read(KEY), /0600/);
  await fs.chmod(f.resolutionFile, 0o600); await fs.chmod(f.resolutionDirectory, 0o755);
  await assert.rejects(f.view().read(KEY), /private/);
  await fs.chmod(f.resolutionDirectory, 0o700);
  const copy = f.resolutionFile + '.copy'; await fs.rename(f.resolutionFile, copy); await fs.symlink(copy, f.resolutionFile);
  await assert.rejects(f.view().read(KEY), /unsafe/);
});

test('canonical ledger permission checks remain in force for parent and recovery files', async t => {
  const f = await fixture(t), recovery = await f.verified(); await recovery.complete();
  for (const file of [f.parentFile, path.join(f.childDirectory, recovery.recoveryKey + '.json')]) {
    await fs.chmod(file, 0o644); await assert.rejects(f.view().read(KEY), /Unsafe/);
    await fs.chmod(file, 0o600);
    await fs.chmod(path.dirname(file), 0o755); await assert.rejects(f.view().read(KEY), /private/);
    await fs.chmod(path.dirname(file), 0o700);
  }
  assert.equal((await f.view().read(KEY)).status, 'verified');
});

test('normal resolved-view claim/update delegate unchanged; missing resolution returns raw records', async t => {
  const f = await fixture(t), view = f.view();
  assert.deepEqual(await view.read(KEY), f.original);
  assert.equal(await view.claim(KEY, {}), false);
  await assert.rejects(view.update(KEY, {status: 'intent'}), /Terminal/);
  assert.equal(await view.read(OTHER), null);
  assert.equal(await view.claim(OTHER, {marker: 'normal'}), true);
  await view.update(OTHER, {status: 'submitted'});
  assert.deepEqual(await view.read(OTHER), await f.baseLedger.read(OTHER));
  assert.deepEqual(await fs.readFile(f.parentFile), f.raw);
});

test('synthetic worker completes the child only; later policy drift remains review without replay', async t => {
  const seed = await fixture(t), identity = ['date', 'startTime', 'staffName', 'lessonType', 'category', 'title', 'room'];
  const canonicalKey = createHash('sha256').update(JSON.stringify(['5330', 'weekend_cancellation_correction_v1',
    'class_cancellation_policy_v1', ...identity.map(field => seed.original.row[field]), seed.approval.expectedDeadline])).digest('hex');
  const f = await fixture(t, {}, canonicalKey), recovery = await createApprovedPretransportRecovery(f.options());
  const row = clone(f.original.row);
  row.nativeCells = [row.date, row.startTime, '09:50', row.staffName, row.lessonType, row.title, row.category, row.room,
    '6', '1', '4', '2026-11-01 09:00:00', row.cancelDeadline, '2026-12-05 07:00:00'];
  let submits = 0;
  const adapter = {
    async exportClasses({from, through}) {return {from, through, rows: [clone(row)], total: 1,
      observedAt: NOW, sourceHash: createHash('sha256').update(JSON.stringify(row)).digest('hex')};},
    async readClass() {return clone(row);},
    async correctClass(target, policy, {beforeSubmit}) {
      assert.equal((await beforeSubmit()).ok, true); submits++;
      row.cancelDeadline = policy.expectedDeadline; row.nativeCells[12] = policy.expectedDeadline;
      return {accepted: true};
    },
  };
  const options = {adapter, ledger: recovery.ledger, from: '2026-11-13', through: '2026-12-31',
    now: () => NOW, apply: true, onlyKeys: [canonicalKey], maxCorrections: 1};
  const result = await runClassCancellationCorrection(options);
  assert.equal(result.status, 'success'); assert.equal(result.correctedCount, 1); assert.equal(submits, 1);
  assert.equal((await f.baseLedger.read(canonicalKey)).status, 'unknown');
  assert.equal((await f.recoveryLedger.read(recovery.recoveryKey)).status, 'verified');
  await recovery.complete();
  assert.equal((await runClassCancellationCorrection({...options, ledger: f.view()})).status, 'success');
  row.cancelDeadline = f.original.row.cancelDeadline; row.nativeCells[12] = row.cancelDeadline;
  const drift = await runClassCancellationCorrection({...options, ledger: f.view()});
  assert.equal(drift.status, 'review'); assert.equal(drift.details[0].reason, 'verified_policy_drift');
  assert.equal(drift.correctedCount, 0); assert.equal(submits, 1);
  assert.deepEqual(await fs.readFile(f.parentFile), f.raw);
});
