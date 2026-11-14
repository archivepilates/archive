import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { chartRepairHash as hash } from './lib/private-chart-member-link-repair.mjs';
import { classifyNotionDocument, queryCoverage } from './lib/system-health-queue-policy.mjs';

assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'archive-pilates');
assert.equal(process.argv.length, 4, 'Before and independent after audit files required');
const directory = path.join(os.homedir(), 'ArchiveIN/operations/private-chart-repair-20261114');
const load = file => {
  assert.equal(path.dirname(fs.realpathSync(file)), fs.realpathSync(directory));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const before = load(process.argv[2]), after = load(process.argv[3]);
assert.ok(Date.parse(after.observedAt) > Date.parse(before.observedAt));
assert.equal(after.proof.nativeMemberId, before.proof.nativeMemberId);
assert.equal(after.proof.phoneSha256, before.proof.phoneSha256);
assert.equal(after.notionProof.rootChildrenHash, before.notionProof.rootChildrenHash);
assert.equal(after.notionProof.matchingFolderIds.length, 0);
assert.equal(after.notionProof.bindings.some(b => b.exists), false);
const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const app = admin.initializeApp({ projectId: 'archive-pilates' }, 'chart-repair-verification');
const db = app.firestore();
try {
  const profileId = before.proof.memberId;
  const profile = (await db.doc(`memberProfiles/${profileId}`).get()).data();
  const { studiomateMemberId, studiomateMemberIdResolvedAt, ...originalProfile } = profile;
  assert.equal(studiomateMemberId, before.proof.nativeMemberId);
  assert.equal(hash(originalProfile), before.profile.sourceHash);
  const lookup = (await db.doc(`studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${profileId}`).get()).data();
  assert.equal(lookup.status, 'done');
  assert.equal(lookup.studiomateMemberId, studiomateMemberId);
  assert.equal(lookup.resolvedAt, studiomateMemberIdResolvedAt);
  const receipt = (await db.doc('workLanes/private-chart-repair-20261114/reports/source-repair').get()).data();
  assert.equal(receipt.outcome, 'linked');
  const changedKeys = ['status', 'studiomateMemberId', 'resolvedAt', 'updatedAt', 'lastError', 'verification', 'source'];
  const preserved = value => Object.fromEntries(Object.entries(value).filter(([k]) => !changedKeys.includes(k)));
  assert.equal(hash(preserved(lookup)), hash(preserved(receipt.lookupBefore)));
  const records = after.records.map(row => {
    const original = before.records.find(r => r.id === row.id);
    assert.equal(row.businessHash, original.businessHash);
    assert.equal(row.requestHash, original.requestHash);
    assert.equal(row.bookingHash, original.bookingHash);
    assert.equal(row.record.notionSync.failedAt, original.record.notionSync.failedAt);
    assert.equal(row.record.notionSync.deferredReason, 'awaiting_submission');
    assert.equal(row.record.notionSync.status, 'pending');
    assert.equal(row.record.notionSync.error, '');
    assert.ok(!row.hasAnswers && !row.record.preSubmittedAt && !row.record.postSubmittedAt);
    assert.equal(classifyNotionDocument(row.record).state, 'awaiting_submission');
    return { id: row.id, state: 'awaiting_submission', businessUnchanged: true,
      requestUnchanged: true, bookingUnchanged: true, failureHistoryPreserved: true, notionPageCreated: false };
  });
  const snap = await db.collection('privateLessonChartRecords').where('notionSync.status', 'in', ['pending', 'failed']).limit(250).get();
  const coverage = queryCoverage({ size: snap.size, limit: 250 });
  const states = snap.docs.map(s => ({ id: s.id, ...classifyNotionDocument(s.data()) }));
  const findingId = 'health_946b34070c610777730146ff4b47';
  const finding = (await db.doc(`codexActionQueue/${findingId}`).get()).data();
  const result = { taskId: 'CORE-CHART-REPAIR-20261114-01', observedAt: new Date().toISOString(), records,
    profileOriginalFieldsPreserved: true, lookupOriginalFieldsPreserved: true,
    notionRootUnchanged: true, notionRootFolderCount: after.notionProof.folderCount,
    healthObservation: { coverage, issueCount: states.filter(s => s.needsAttention).length,
      withinGrace: states.filter(s => s.state === 'within_grace').length,
      findingStatus: finding?.status || null, findingManuallyChanged: false,
      nextAction: 'Existing scheduled health check reconciles its own finding; no manual aggregate resolution.' },
    privateAudit: 'workLanes/private-chart-repair-20261114/reports/source-repair' };
  fs.writeFileSync(path.join(directory, `verification-${Date.now()}.json`), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(result));
} finally { await app.delete(); }
