import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { INCIDENT_CHART_IDS, notionIncidentDeferral } from './lib/ops-health-notion-deferral.mjs';

const args = process.argv.slice(2), apply = args.includes('--apply');
const expected = args.find(a => a.startsWith('--expected='))?.slice(11);
if (new Set(args).size !== args.length || args.some(a => a !== '--apply' && a !== `--expected=${expected}`)
  || expected && !/^[a-f0-9]{64}$/.test(expected) || apply && !expected) throw Error('Invalid repair arguments');
const git = a => execFileSync('git', a, { encoding: 'utf8' }).trim();
if (apply && (git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])
  || git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main']))) throw Error('Apply requires clean main equal to origin/main');
const require = createRequire(path.resolve('firebase/kangsain-functions/functions/package.json'));
const admin = require('firebase-admin');
const { privateNotionDeferredVersion } = require(path.resolve('firebase/kangsain-functions/functions/lib/privateLessonChart/privateLessonNotionSync.js'));
const { privateNotionMemberIdentity } = require(path.resolve('firebase/kangsain-functions/functions/lib/privateLessonChart/privateLessonNotionMemberPage.js'));
const { stableHash } = require(path.resolve('firebase/kangsain-functions/functions/lib/utils/hash.js'));
const ts = require('typescript');
const tree = ts.createSourceFile('privateLessonChart.ts', readFileSync('firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts', 'utf8'), ts.ScriptTarget.ES2022, true);
const declaration = tree.statements.filter(ts.isVariableStatement).flatMap(n => [...n.declarationList.declarations])
  .find(n => n.name.getText(tree) === 'NOTION_INSTRUCTOR_CHART_PAGE_IDS');
if (!declaration || !ts.isObjectLiteralExpression(declaration.initializer)) throw Error('Configured parent map unavailable');
const roots = Object.fromEntries(declaration.initializer.properties.map(p => {
  if (!ts.isPropertyAssignment(p) || !ts.isStringLiteral(p.initializer)) throw Error('Unexpected parent mapping');
  return [p.name.text, p.initializer.text];
}));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(os.homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json');
admin.initializeApp({ projectId: 'archive-pilates' });
const db = admin.firestore(), hash = d => createHash('sha256').update(JSON.stringify(d)).digest('hex');
const businessHash = d => { const { notionSync, ...rest } = d; return hash(rest); };
const auditRef = db.doc('workLanes/ops-health-errors-20261102/reports/notion-awaiting-submission');
const fingerprintFor = rows => hash(rows.map(r => ({ id: r.id, record: hash(r.d), request: hash(r.request),
  identitySources: r.identitySources, updateTime: r.updateTime })));
async function readRows(reader) {
  const rows = [];
  for (const id of INCIDENT_CHART_IDS) {
    const ref = db.doc(`privateLessonChartRecords/${id}`), snap = await reader(ref), d = snap.data();
    if (!snap.exists || d?.requestId !== id) throw Error('Incident record changed or unavailable');
    const request = await reader(db.doc(`privateLessonChartRequests/${id}`));
    if (!request.exists) throw Error('Canonical request unavailable');
    const next = notionIncidentDeferral(d, request.data());
    let identitySources = null;
    if (next) {
      if (![d.memberId, d.staffId].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v))) throw Error('Unsafe canonical identity');
      const profile = await reader(db.doc(`memberProfiles/${d.memberId}`));
      const staff = await reader(db.doc(`staffs/${d.staffId}`));
      identitySources = hash({ profile: profile.data(), staff: staff.data() });
      const root = roots[d.staffName];
      const identity = privateNotionMemberIdentity(d, request.data(), profile.data(), staff.data(), root,
        roots[staff.data()?.name], { deferUnsubmitted: true });
      if (!identity.awaitingSubmission) throw Error('Incident is no longer an empty shell');
      for (const key of [
        `privateNotionMember_${stableHash({ root: identity.rootPageId, memberId: identity.memberId })}`,
        `privateNotionMemberTitle_${stableHash({ root: identity.rootPageId, title: identity.title.replace(/\s+/g, '') })}`,
      ]) {
        const binding = await reader(db.doc(`syncStates/${key}`));
        if (binding.exists) throw Error('Existing member-folder binding requires independent review');
      }
      next.deferredVersion = privateNotionDeferredVersion(d, request.data());
    }
    rows.push({ id, ref, d, request: request.data(), next, identitySources,
      updateTime: snap.updateTime.toDate().toISOString(), beforeHash: businessHash(d) });
  }
  return rows;
}
try {
  const rows = await readRows(ref => ref.get());
  const fingerprint = fingerprintFor(rows);
  if (!apply) {
    console.log(JSON.stringify({ mode: 'plan', count: rows.length, eligible: rows.filter(r => r.next).length, fingerprint }));
  } else {
    if (fingerprint !== expected || rows.some(r => !r.next)) throw Error('Source changed or incident guard failed');
    const expectedAfter = await db.runTransaction(async tx => {
      const audit = await tx.get(auditRef);
      if (audit.exists) throw Error('Prior repair intent exists; read back instead of replay');
      const current = await readRows(ref => tx.get(ref));
      const actual = fingerprintFor(current);
      if (actual !== expected || current.some(r => !r.next)) throw Error('Concurrent source change');
      tx.create(auditRef, { sourceCommit: git(['rev-parse', 'HEAD']), at: new Date().toISOString(),
        operation: 'metadata_only_awaiting_submission', expected, records: current.map(r => ({ id: r.id,
          beforeBusinessHash: r.beforeHash, beforeSyncHash: hash(r.d.notionSync), afterSyncHash: hash(r.next) })) });
      for (const row of current) tx.update(row.ref, { notionSync: row.next });
      return current.map(r => hash(r.next));
    });
    const after = await readRows(ref => ref.get());
    if (after.some((r, i) => r.beforeHash !== rows[i].beforeHash || hash(r.d.notionSync) !== expectedAfter[i]))
      throw Error('Repair readback mismatch; do not replay');
    console.log(JSON.stringify({ mode: 'apply', count: after.length, verified: true, businessFieldsUnchanged: true,
      externalWrites: 0, state: 'awaiting_submission' }));
  }
} finally { await admin.app().delete(); }
