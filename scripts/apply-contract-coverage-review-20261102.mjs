import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildContractCoverageReview } from './lib/contract-coverage-review-apply.mjs';
import { contractObservationGroups } from './lib/studiomate-membership-contract-observer.mjs';
import { validateCoverageReconciliations } from './lib/studiomate-contract-coverage-reconciliation.mjs';

const args = process.argv.slice(2), apply = args.includes('--apply');
const expected = args.find(a => a.startsWith('--expected='))?.slice(11);
if (new Set(args).size !== args.length || args.some(a => a !== '--apply' && a !== `--expected=${expected}`)
  || expected && !/^[a-f0-9]{64}$/.test(expected) || apply && !expected) throw Error('Invalid apply arguments');
const git = a => execFileSync('git', a, { encoding: 'utf8' }).trim();
if (apply && (git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])
  || git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main']))) throw Error('Apply requires clean main at origin/main');
if (apply && (git(['-C', '/Users/archivepilates/dev/archive-in-runtime', 'rev-parse', 'HEAD']) !== git(['rev-parse', 'HEAD'])
  || git(['-C', '/Users/archivepilates/dev/archive-in-runtime', 'status', '--porcelain'])))
  throw Error('Runtime must be clean and on the reviewed implementation before metadata apply');
const directory = path.join(os.homedir(), 'ArchiveIN/operations/contract-coverage-review-20261102');
const source = path.join(directory, 'native-evidence.json'), info = fs.lstatSync(source);
if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077) throw Error('Unsafe evidence file');
const evidence = JSON.parse(fs.readFileSync(source, 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const require = createRequire(path.resolve('firebase/kangsain-functions/functions/package.json'));
const admin = require('firebase-admin');
const { stableHash: checksum } = require(path.resolve('firebase/kangsain-functions/functions/lib/utils/hash.js'));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(os.homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json');
admin.initializeApp({ projectId: 'archive-pilates' });
const db = admin.firestore(), lane = db.doc('workLanes/studiomate-membership-contract-automation');
const baselineRef = lane.collection('state').doc('excelBaseline');
const auditRef = lane.collection('reports').doc('coverage-reconciliation-20261102-v1');
async function readPlan(reader) {
  const snap = await reader(baselineRef), baseline = snap.data();
  const config = (await reader(db.doc('systemSettings/membershipContractAutomation'))).data();
  if (hash(config) !== evidence.configHash) throw Error('Contract policy changed');
  const hints = [];
  for (const r of evidence.records) {
    const p = (await reader(db.doc(`memberProfiles/${r.profileId}`))).data();
    const fingerprint = contractObservationGroups([{ 전화번호: p?.phone, 수강권명: 'lookup' }])[0]?.id;
    if (hash({ memberId: p?.memberId, nativeMemberId: p?.studiomateMemberId || p?.memberId,
      phoneFingerprint: fingerprint, grade: p?.memberGrade || '' }) !== r.profileIdentityHash) throw Error('Member identity changed');
    const q = await reader(lane.collection('purchaseHints').where('phoneFingerprint', '==', r.phoneFingerprint).limit(20));
    if (q.size >= 20) throw Error('Hint coverage incomplete');
    for (const d of q.docs) {
      const data = d.data(), decision = r.hintDecisions?.find(h => h.hintId === d.id);
      if (data.status === 'native_verification_required' && (!decision || decision.hintHash !== hash(data)
        || decision.previousDownloadedAt !== data.previousDownloadedAt))
        throw Error('Pending hint lacks current native verification');
      hints.push({ ref: d.ref, id: d.id, data, decision });
    }
  }
  const plan = buildContractCoverageReview(baseline, evidence);
  if (!validateCoverageReconciliations(plan.next.coverageReconciliations)) throw Error('Invalid reviewed coverage shape');
  const fingerprint = checksum({ baseline, hints: hints.map(h => ({ id: h.id, data: h.data })), evidence: hash(evidence) });
  return { ...plan, baseline, hints, fingerprint };
}
try {
  const plan = await readPlan(ref => ref.get());
  if (!apply) console.log(JSON.stringify({ mode: 'plan', fingerprint: plan.fingerprint, targets: evidence.records.map(r => ({
    name: r.name, beforeRows: r.priorRows, afterRows: r.currentRows, sourceDecision: r.selection })),
    pendingHintsToReview: plan.hints.filter(h => h.data.status === 'native_verification_required').map(h => ({ id: h.id,
      nativeStatus: h.decision.status, nativeReason: h.decision.reason })),
    baselineReset: false, memberActions: 0 }));
  else {
    if (plan.fingerprint !== expected) throw Error('Changed review plan');
    const receipt = await db.runTransaction(async tx => {
      if ((await tx.get(auditRef)).exists) throw Error('Prior apply intent exists; read back, do not replay');
      const current = await readPlan(ref => tx.get(ref));
      if (current.fingerprint !== expected) throw Error('Concurrent source change');
      const nextHash = checksum(current.next);
      tx.create(auditRef, { operation: 'exact_three_native_verified_coverage_reconciliation', at: new Date().toISOString(),
        sourceCommit: git(['rev-parse', 'HEAD']), expected, evidenceHash: hash(evidence),
        exportSourceHash: evidence.sourceFileHash, originalEntries: current.originals, afterHash: nextHash,
        nativeDecisions: evidence.records.map(r => ({ memberId: r.memberId, phoneFingerprint: r.phoneFingerprint,
          checkedAt: r.nativeObservedAt, selection: r.selection, priorRows: r.priorRows, currentRows: r.currentRows })),
        hintOriginals: current.hints.map(h => ({ id: h.id, status: h.data.status, reason: h.data.reason })),
        memberActions: 0, globalBaselineReset: false });
      tx.set(baselineRef, current.next);
      const changedHints = [];
      for (const h of current.hints) if (h.data.status === 'native_verification_required') {
        const noAction = h.decision.status === 'ignored' && h.decision.reason === 'no_fresh_native_issuance'
          || h.decision.status === 'excluded' && h.decision.reason === 'instructor_member_grade_excluded';
        if (!noAction && h.decision.status !== 'review') throw Error('New eligible contract needs separate approval');
        const patch = { status: noAction ? 'ignored' : 'review',
          reason: noAction ? 'native_verified_coverage_reconciliation_no_new_contract' : h.decision.reason,
          coverageReviewId: auditRef.id, coverageReviewedAt: new Date().toISOString(),
          nativeSourceReviewStatus: h.decision.status, nativeSourceReviewReason: h.decision.reason };
        tx.update(h.ref, patch);
        changedHints.push({ id: h.id, status: patch.status, afterHash: checksum({ ...h.data, ...patch }) });
      }
      return { nextHash, changedHints };
    });
    const after = (await baselineRef.get()).data();
    if (checksum(after) !== receipt.nextHash) throw Error('Baseline readback conflict; do not replay');
    for (const { id, afterHash } of receipt.changedHints) if (checksum((await lane.collection('purchaseHints').doc(id).get()).data()) !== afterHash)
      throw Error('Hint review readback mismatch; do not replay');
    console.log(JSON.stringify({ mode: 'apply', verified: true, reviewedTargets: 3, reviewedHints: receipt.changedHints.length,
      remainingCoverageHolds: after.coverageLossIds.length,
      hintsRequiringSeparateReview: receipt.changedHints.filter(h => h.status === 'review').length,
      memberActions: 0, globalBaselineReset: false }));
  }
} finally { await admin.app().delete(); }
