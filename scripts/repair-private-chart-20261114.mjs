import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { repairPrivateChartMemberLink, chartRepairHash as hash } from './lib/private-chart-member-link-repair.mjs';

assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'archive-pilates');
const auditFile = process.argv[2];
const apply = process.argv[3] === '--apply';
assert.ok(process.argv.length === 4 && apply, 'Exact private audit and --apply required');
const directory = path.join(os.homedir(), 'ArchiveIN/operations/private-chart-repair-20261114');
assert.equal(path.dirname(fs.realpathSync(auditFile)), fs.realpathSync(directory));
const info = fs.lstatSync(auditFile);
assert.ok(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077) && info.uid === process.getuid());
const before = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
const runtime = path.join(os.homedir(), 'dev/archive-in-runtime');
// Deliberately execute the existing operational handler, not unapproved local prevention changes.
const require = createRequire(path.join(runtime, 'firebase/kangsain-functions/functions/package.json'));
require('tsx/cjs');
const { db } = require('./src/config/firebase.ts');
const { syncPrivateNotionByRecordId } = require('./src/privateLessonChart/privateLessonChart.ts');
const scope = { taskId: 'CORE-CHART-REPAIR-20261114-01', profileId: 'excel_6d84bbaa36f30f05', nativeId: '5114917',
  recordIds: ['plc_283112173', 'plc_283112178'], auditPath: 'workLanes/private-chart-repair-20261114/reports/source-repair' };
const receipt = path.join(directory, 'apply-intent.json');
fs.writeFileSync(receipt, JSON.stringify({ taskId: scope.taskId, auditFile: path.basename(auditFile), auditHash: hash(before), startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
let notionMutationsBlocked = 0, notionReads = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url || input.href);
  if (url.hostname === 'api.notion.com') {
    const method = init?.method || input.method || 'GET';
    if (method !== 'GET') { notionMutationsBlocked++; throw Error('Task forbids Notion mutation for empty preparations'); }
    notionReads++;
  }
  return originalFetch(input, init);
};
try {
  const linked = await repairPrivateChartMemberLink({ db, scope, audit: before });
  const results = [];
  for (const id of scope.recordIds) {
    const result = await syncPrivateNotionByRecordId(id, true);
    const [r, q, b] = await db.getAll(db.doc(`privateLessonChartRecords/${id}`), db.doc(`privateLessonChartRequests/${id}`), db.doc(`bookings/${id.slice(4)}`));
    const record = r.data(), evidence = before.records.find(row => row.id === id);
    const business = Object.fromEntries(Object.entries(record).filter(([key]) => !['notionSync', 'notionProjectionLease'].includes(key)));
    assert.equal(hash(business), evidence.businessHash, 'Business content changed');
    assert.equal(hash(q.data()), evidence.requestHash, 'Request changed');
    assert.equal(hash(b.data()), evidence.bookingHash, 'Booking changed');
    assert.equal(record.notionSync?.status, 'pending');
    assert.equal(record.notionSync?.deferredReason, 'awaiting_submission');
    assert.equal(record.notionSync?.error, '');
    assert.equal(record.notionSync?.failedAt, evidence.record.notionSync.failedAt, 'Historical failure lost');
    assert.ok(!record.notionSync?.syncedAt && !record.notionSync?.instructorPageId && !record.notionSync?.creationTitle && !record.notionProjectionLease?.token);
    results.push({ id, handlerResult: result, businessUnchanged: true, requestUnchanged: true, bookingUnchanged: true, notionSync: record.notionSync, finalHash: hash(record) });
  }
  assert.equal(notionMutationsBlocked, 0, 'Unexpected Notion mutation attempted');
  const result = { taskId: scope.taskId, observedAt: new Date().toISOString(), linked, results, notionReads, notionMutationsBlocked,
    memberMessages: 0, deployment: false };
  fs.writeFileSync(path.join(directory, 'apply-result.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  await db.doc('workLanes/private-chart-repair-20261114/reports/projection-result').create(result);
  console.log(JSON.stringify(result));
} finally {
  globalThis.fetch = originalFetch;
  const { getApps } = require('firebase-admin/app');
  for (const app of getApps()) await app.delete();
}
