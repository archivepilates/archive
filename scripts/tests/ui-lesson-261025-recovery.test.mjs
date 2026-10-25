import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertApprovedFive, assertPendingUi, acquireUiLaneLock } from '../ui-lesson-261025-recovery.mjs';
import os from 'node:os';
import { C261025_SHARE, D261025_SHARE } from '../lib/imweb-student-share-policy.mjs';
import { SITE, UNIT } from '../lib/imweb-staff-video-policy.mjs';
import { retainUiShareWindow } from '../ui-lesson-261024-recovery.mjs';
const APPROVAL = 'call_3062285e017a44979da0dc8ac60f75d8:approved-five-native-ui';
const NOW = Date.parse('2026-10-25T16:30:00Z');
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const approvalHash = m => hash(m.targets.map(t => [t.team, t.memberCode, t.uid]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
function fixture(team = 'C') {
  const manifest = { approval: APPROVAL, approvedAt: '2026-10-25T16:20:00Z', targets:
    ['C', 'C', 'D', 'D', 'D'].map((team, i) => ({ team, memberCode: `m000${i}`, uid: `synthetic-${i}` })) };
  const allowed = manifest.targets.find(t => t.team === team), source = team === 'C' ? C261025_SHARE : D261025_SHARE;
  const before = { siteCode: SITE, unitCode: UNIT, memberCode: allowed.memberCode, uid: allowed.uid, grade: 'ordinary', group: ['prior-paid', 'prior-share'] };
  const afterGroups = [...before.group, source.groupCode];
  const receipt = { status: 'intent', intentAt: '2026-10-25T16:25:00Z', memberCode: allowed.memberCode,
    beforeGrade: before.grade, beforeGroups: before.group, afterGroups,
    execution: 'native_admin_ui_user_resume_20261026_cd_five', approval: APPROVAL,
    memberInvariantHash: hash(Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'group'))) };
  return { manifest, source, receipt, snapshot: { team, before, afterGroups, receipt: structuredClone(receipt) } };
}
test('approval pins exactly five distinct accounts and C2/D3', () => {
  assert.equal(assertApprovedFive(fixture().manifest, approvalHash(fixture().manifest)).length, 5);
  for (const change of [
    f => f.targets.pop(), f => f.targets.push({ ...f.targets[0] }),
    f => { f.targets[0].team = 'A'; }, f => { f.targets[0].team = 'D'; },
    f => { f.targets[0].memberCode = f.targets[1].memberCode; },
    f => { f.targets[0].uid = f.targets[1].uid; }, f => { f.targets[0].uid = ''; },
    f => { f.targets[0].memberCode = 'not-a-code'; }, f => { f.approval = 'unapproved'; },
    f => { f.approvedAt = '2026-10-25'; },
  ]) { const f = fixture().manifest, expected = approvalHash(f); change(f); assert.throws(() => assertApprovedFive(f, expected)); }
  const substituted = fixture().manifest, expected = approvalHash(substituted); substituted.targets[2].memberCode = 'm9999';
  assert.throws(() => assertApprovedFive(substituted, expected));
});
for (const team of ['C', 'D']) {
  test(`${team}: saved intent and unknown readback remain pinned to one approved account`, () => {
    for (const status of ['intent', 'result_unknown']) {
      const f = fixture(team); f.receipt.status = status;
      const original = structuredClone(f);
      assert.equal(assertPendingUi(f.snapshot, f.manifest, f.receipt, approvalHash(f.manifest)).memberCode, f.snapshot.before.memberCode);
      assert.deepEqual(f, original);
    }
  });
  test(`${team}: wrong account, scope or preserved-group evidence cannot recover`, () => {
    for (const mutate of [
      f => { f.snapshot.before.uid = 'other'; }, f => { f.snapshot.before.memberCode = 'm9999'; },
      f => { f.snapshot.team = team === 'C' ? 'D' : 'C'; },
      f => { f.snapshot.before.siteCode = 'other'; }, f => { f.snapshot.before.unitCode = 'other'; },
      f => { f.snapshot.before.group.push(f.source.groupCode); },
      f => { f.snapshot.afterGroups = [f.source.groupCode]; }, f => { f.receipt.beforeGroups = []; },
      f => { f.receipt.afterGroups = [f.source.groupCode]; }, f => { f.receipt.beforeGrade = 'staff'; },
      f => { f.receipt.execution = 'other'; }, f => { f.receipt.approval = 'other'; },
      f => { f.receipt.intentAt = '2026-10-25T16:26:00Z'; }, f => { f.receipt.memberInvariantHash = 'bad'; },
      f => { f.receipt.status = 'group_verified'; },
    ]) { const f = fixture(team), expected = approvalHash(f.manifest); mutate(f); assert.throws(() => assertPendingUi(f.snapshot, f.manifest, f.receipt, expected)); }
  });
  test(`${team}: first readback starts 960h; retries preserve the original clock`, () => {
    const f = fixture(team), result = retainUiShareWindow(f.receipt, undefined, f.source, NOW);
    assert.equal(Date.parse(result.entitlement.expiresAt) - Date.parse(result.entitlement.grantedAt), 960 * 3600000);
    const retry = retainUiShareWindow({ ...result.receipt, status: 'result_unknown' }, result.entitlement, f.source, NOW + 3600000);
    assert.deepEqual(retry.entitlement, result.entitlement);
  });
}
test('adapter only reads/dry-runs CLI and gates another write on persisted readback', () => {
  const source = readFileSync(new URL('../ui-lesson-261025-recovery.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /['"]--yes['"]|--confirm-token|write_quota_exceeded/);
  assert.match(source, /'--dry-run'/);
  assert.match(source, /if \(pending\) throw Error\('verify_prior_intent_first'\)/);
  assert.ok(source.indexOf('save(recoveryFile, snapshot)') < source.indexOf('state.manualImmediateGrants[allowed.memberCode] = receipt; save'));
  assert.match(source, /await releaseUiShareLocks\(locks, release\)/);
  assert.ok(source.indexOf('Object.assign(receipt, result.receipt)') < source.indexOf('save(fileFor(source), state); ledgerSet()'));
  assert.match(source, /finalAttendance = readLessonAttendance\(\)/);
  assert.match(source, /isDeepStrictEqual\(finalAttendance.evidence, evidence\)/);
});
test('lane lock recovery requires old, dead, local, identical owned evidence', () => {
  const meta = { pid: 123456, host: os.hostname(), operation: 'native_admin_ui_user_resume_20261026_cd_five', startedAt: '2026-10-25T16:00:00Z' };
  for (const mode of ['dead', 'alive', 'eperm', 'recent', 'foreign', 'changed']) {
    let opens = 0, removed = 0, reads = 0;
    const owner = { ...meta, ...(mode === 'foreign' ? { host: 'elsewhere' } : {}), ...(mode === 'recent' ? { startedAt: new Date(NOW).toISOString() } : {}) };
    const io = {
      openSync() { if (++opens === 1) throw Object.assign(Error(), { code: 'EEXIST' }); return 77; },
      lstatSync() { return { isFile: () => true, isSymbolicLink: () => false, uid: process.getuid(), mode: 0o600, ino: 7 }; },
      readFileSync() { reads++; return JSON.stringify({ ...owner, ...(mode === 'changed' && reads > 1 ? { pid: 777 } : {}) }); },
      unlinkSync() { removed++; },
    };
    const probe = () => { if (mode !== 'alive') throw Object.assign(Error(), { code: mode === 'eperm' ? 'EPERM' : 'ESRCH' }); };
    if (mode === 'dead') { assert.equal(acquireUiLaneLock('synthetic', io, NOW, probe), 77); assert.equal(removed, 1); }
    else { assert.throws(() => acquireUiLaneLock('synthetic', io, NOW, probe)); assert.equal(removed, 0); }
  }
});
