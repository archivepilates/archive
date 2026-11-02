import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { contractObservationGroups } from './lib/studiomate-membership-contract-observer.mjs';
const root = '/Users/archivepilates/dev/archive-in-runtime';
const require = createRequire(`${root}/package.json`);
const admin = require(`${root}/firebase/kangsain-functions/functions/node_modules/firebase-admin`);
process.env.GOOGLE_APPLICATION_CREDENTIALS = '/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json';
admin.initializeApp({ projectId: 'archive-pilates' });
const db = admin.firestore(), lane = db.doc('workLanes/studiomate-membership-contract-automation');
try {
  const baseline = (await lane.collection('state').doc('excelBaseline').get()).data();
  console.log(JSON.stringify({ kind: 'baseline', sourceImportId: baseline?.sourceImportId, downloadedAt: baseline?.downloadedAt,
    initializedAt: baseline?.initializedAt, heldCount: baseline?.coverageLossIds?.length }));
  for (const id of baseline?.coverageLossIds || []) {
    const snap = await lane.collection('purchaseHints').where('phoneFingerprint', '==', id).limit(20).get();
    console.log(JSON.stringify({ kind: 'held', id, expectedRows: baseline.rowCounts[id],
      expectedFingerprint: baseline.fingerprints[id], lastCompleteObservedAt: baseline.observedAtByMember?.[id],
      hints: snap.docs.map(d => { const h = d.data(); return { id: d.id, keys: Object.keys(h),
        status: h.status, reason: h.reason, memberId: h.memberId || h.nativeMemberId || h.selection?.memberId,
        rowCount: h.hints?.length,
        sourceImportId: h.sourceImportId }; }) }));
  }
  const held = new Set(baseline?.coverageLossIds || []);
  const profiles = await db.collection('memberProfiles').where('studioId', '==', '5330')
    .select('memberId', 'name', 'phone', 'studiomateMemberId', 'memberGrade').get();
  for (const doc of profiles.docs) {
    const p = doc.data();
    const id = contractObservationGroups([{ 전화번호: p.phone, 수강권명: 'lookup' }])[0]?.id;
    if (held.has(id)) console.log(JSON.stringify({ kind: 'identity', fingerprint: id, profileId: doc.id,
      memberId: p.memberId, nativeMemberId: p.studiomateMemberId, name: p.name, grade: p.memberGrade }));
  }
  const dir = '/Users/archivepilates/ArchiveIN/automation/reports/excel-emergency-mode';
  const file = fs.readdirSync(dir).filter(n => n.endsWith('run-apply.json')).sort().at(-1);
  const report = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const step = report.steps.find(s => s.name === 'memberProfiles');
  const summary = typeof step.stdout === 'string' ? JSON.parse(step.stdout) : step.stdout;
  console.log(JSON.stringify({ kind: 'source', file, exists: fs.existsSync(summary.sourceFile),
    sourceFile: summary.sourceFile, sourceImportId: summary.sourceImportId, retention: summary.sourceFileRetention }));
} finally { await admin.app().delete(); }
