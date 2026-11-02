import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ids = new Set(['3045390', '3513809', '5012352']);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const digests = rows => rows.reduce((out, row) => { const key = hash(row); out[key] = (out[key] || 0) + 1; return out; }, {});

export function buildContractCoverageReview(baseline, evidence, now = new Date().toISOString()) {
  if (!baseline || !evidence || !timestamp(now) || !timestamp(evidence.exportStartedAt)
    || !timestamp(evidence.exportFinishedAt) || evidence.exportStartedAt > evidence.exportFinishedAt
    || Date.parse(now) < Date.parse(evidence.exportFinishedAt)
    || Date.parse(now) - Date.parse(evidence.exportStartedAt) > 30 * 60000
    || Date.parse(baseline.downloadedAt) > Date.parse(evidence.exportStartedAt)
    || !/^[a-f0-9]{64}$/.test(evidence.sourceFileHash || '') || evidence.records?.length !== 3
    || new Set(evidence.records.map(r => r.memberId)).size !== 3) throw Error('Stale or incomplete coverage evidence');
  const next = structuredClone(baseline), originals = [];
  next.coverageReconciliations = { ...(next.coverageReconciliations || {}) };
  for (const r of evidence.records) {
    const id = r.phoneFingerprint;
    if (!ids.has(r.memberId) || !/^[a-f0-9]{64}$/.test(id || '') || !baseline.coverageLossIds.includes(id)
      || r.nativeMemberVerified !== true || r.ticketReadStatus !== 'verified' || r.contractReadStatus !== 'verified'
      || !timestamp(r.nativeObservedAt) || Date.parse(r.nativeObservedAt) < Date.parse(evidence.exportFinishedAt)
      || Date.parse(now) - Date.parse(r.nativeObservedAt) > 10 * 60000 || Date.parse(r.nativeObservedAt) > Date.parse(now)
      || baseline.fingerprints[id] !== r.priorFingerprint || baseline.rowCounts[id] !== r.priorRows
      || baseline.observedAtByMember[id] !== r.priorObservedAt || !timestamp(r.priorObservedAt)
      || hash(r.priorHints) !== r.priorFingerprint || r.priorHints.length !== r.priorRows
      || r.currentHints.length !== r.currentRows || r.currentRows >= r.priorRows
      || (r.currentRows ? hash(r.currentHints) !== r.currentFingerprint : r.currentFingerprint !== null)
      || next.coverageReconciliations[id]) throw Error('Coverage target or original source changed');
    const excluded = r.memberId === '5012352';
    if (excluded ? r.grade !== '강사회원' || r.currentRows !== 0 || r.selection.status !== 'excluded'
      || r.selection.reason !== 'instructor_member_grade_excluded'
      : r.selection.status !== 'ignored' || r.selection.reason !== 'no_fresh_native_issuance')
      throw Error('Unresolved native contract candidate');
    const before = digests(r.priorHints), current = digests(r.currentHints), historical = { ...before };
    for (const [key, count] of Object.entries(current)) historical[key] = Math.max(historical[key] || 0, count);
    originals.push({ phoneFingerprint: id, fingerprint: baseline.fingerprints[id], rowCount: baseline.rowCounts[id],
      observedAt: baseline.observedAtByMember[id] });
    next.coverageReconciliations[id] = { schemaVersion: 1, reviewId: hash([id, r.priorFingerprint, r.currentFingerprint,
      evidence.sourceFileHash, r.nativeObservedAt]), reviewedAt: now, originalObservedAt: r.priorObservedAt,
      historicalRows: historical, minimumRows: current, lastRows: current };
    if (r.currentRows) { next.fingerprints[id] = r.currentFingerprint; next.rowCounts[id] = r.currentRows; }
    else { delete next.fingerprints[id]; delete next.rowCounts[id]; delete next.observedAtByMember[id]; }
  }
  const reviewed = new Set(evidence.records.map(r => r.phoneFingerprint));
  next.coverageLossIds = baseline.coverageLossIds.filter(id => !reviewed.has(id));
  if (Buffer.byteLength(JSON.stringify(next)) > 700000) throw Error('Coverage state exceeds safe size');
  return { next, originals };
}
