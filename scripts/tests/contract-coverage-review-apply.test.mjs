import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildContractCoverageReview } from '../lib/contract-coverage-review-apply.mjs';
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const now = '2026-11-02T00:50:00.000Z', old = '2026-10-29T00:00:00.000Z';
function fixture() {
  const baseline = { schemaVersion: 1, initializedAt: old, updatedAt: old, downloadedAt: '2026-11-02T00:26:00.000Z',
    sourceImportId: 'canonical-import', fingerprints: {}, rowCounts: {}, observedAtByMember: {}, coverageLossIds: [] };
  const evidence = { sourceFileHash: hash('export'), exportStartedAt: '2026-11-02T00:42:00.000Z',
    exportFinishedAt: '2026-11-02T00:43:00.000Z', records: [] };
  for (const [i, memberId] of ['3045390', '3513809', '5012352'].entries()) {
    const priorHints = [{ productName: `past-${i}` }, { productName: `kept-${i}` }];
    const currentHints = i === 2 ? [] : priorHints.slice(1);
    const id = hash(memberId), fingerprint = hash(priorHints);
    Object.assign(baseline.fingerprints, { [id]: fingerprint });
    Object.assign(baseline.rowCounts, { [id]: 2 });
    Object.assign(baseline.observedAtByMember, { [id]: old });
    baseline.coverageLossIds.push(id);
    evidence.records.push({ memberId, phoneFingerprint: id, priorFingerprint: fingerprint, priorRows: 2,
      priorObservedAt: old, currentHints, priorHints, currentRows: currentHints.length,
      currentFingerprint: currentHints.length ? hash(currentHints) : null, grade: i === 2 ? '강사회원' : '',
      nativeMemberVerified: true, ticketReadStatus: 'verified', contractReadStatus: 'verified',
      nativeObservedAt: '2026-11-02T00:45:00.000Z', selection: i === 2
        ? { status: 'excluded', reason: 'instructor_member_grade_excluded' }
        : { status: 'ignored', reason: 'no_fresh_native_issuance' } });
  }
  baseline.fingerprints.unrelated = hash('unrelated'); baseline.rowCounts.unrelated = 5;
  baseline.observedAtByMember.unrelated = old;
  return { baseline, evidence };
}
test('only exact three reviewed entries change; global bounds and all originals are preserved', () => {
  const { baseline, evidence } = fixture(), before = structuredClone(baseline), source = structuredClone(evidence);
  const { next, originals } = buildContractCoverageReview(baseline, evidence, now);
  assert.deepEqual(baseline, before); assert.deepEqual(evidence, source);
  for (const key of ['schemaVersion', 'initializedAt', 'updatedAt', 'downloadedAt', 'sourceImportId']) assert.equal(next[key], before[key]);
  assert.equal(next.fingerprints.unrelated, before.fingerprints.unrelated);
  assert.equal(next.rowCounts.unrelated, 5);
  assert.equal(originals.length, 3); assert.deepEqual(next.coverageLossIds, []);
  assert.equal(next.rowCounts[hash('3045390')], 1);
  assert.equal(next.observedAtByMember[hash('3045390')], old);
  assert.equal(next.fingerprints[hash('5012352')], undefined);
  assert.deepEqual(next.coverageReconciliations[hash('5012352')].lastRows, {});
});
test('duplicate, changed, stale, submitted-for-action and incomplete sources fail closed', () => {
  for (const change of [f => { f.evidence.records.pop(); }, f => { f.evidence.records[1] = f.evidence.records[0]; },
    f => { f.evidence.records[0].memberId = 'other'; }, f => { f.evidence.records[0].priorRows++; },
    f => { f.evidence.records[0].priorFingerprint = hash('changed'); },
    f => { f.evidence.records[0].nativeMemberVerified = false; },
    f => { f.evidence.records[0].ticketReadStatus = 'review'; },
    f => { f.evidence.records[0].contractReadStatus = 'review'; },
    f => { f.evidence.records[0].nativeObservedAt = old; },
    f => { f.evidence.records[0].selection.status = 'eligible'; },
    f => { f.evidence.records[2].grade = '일반회원'; },
    f => { f.evidence.exportStartedAt = old; },
    f => { f.baseline.downloadedAt = '2026-11-02T00:49:00.000Z'; },
    f => { f.baseline.coverageReconciliations = { [hash('3045390')]: {} }; }]) {
    const f = fixture(); change(f);
    assert.throws(() => buildContractCoverageReview(f.baseline, f.evidence, now));
  }
});
test('unrelated holds remain held and row multiplicity is retained', () => {
  const f = fixture(); f.baseline.coverageLossIds.push(hash('other'));
  const r = f.evidence.records[0]; r.priorHints.push(r.priorHints[0]); r.priorRows++;
  r.priorFingerprint = hash(r.priorHints); f.baseline.fingerprints[r.phoneFingerprint] = r.priorFingerprint;
  f.baseline.rowCounts[r.phoneFingerprint]++;
  const { next } = buildContractCoverageReview(f.baseline, f.evidence, now);
  assert.deepEqual(next.coverageLossIds, [hash('other')]);
  assert.equal(next.coverageReconciliations[r.phoneFingerprint].historicalRows[hash(r.priorHints[0])], 2);
});
