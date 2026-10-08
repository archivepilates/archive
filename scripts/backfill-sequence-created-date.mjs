#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const owner = args[args.indexOf('--owner') + 1];
const apply = args.includes('--apply');
const planFile = args.includes('--plan') ? args[args.indexOf('--plan') + 1] : null;
if (apply && (!planFile || !path.isAbsolute(planFile))) throw Error('Apply requires the reviewed absolute --plan file.');
if (!args.includes('--owner') || !owner || owner.startsWith('--')) throw Error('An explicit operator --owner is required.');
if (process.env.GOOGLE_CLOUD_PROJECT !== 'archive-pilates') throw Error('Expected archive-pilates.');
const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const key = JSON.parse(await fs.readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
assert.equal(key.client_email, 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com');
const app = admin.initializeApp({ credential: admin.credential.cert(key), projectId: 'archive-pilates' }, 'sequence-created-date');
const db = app.firestore();
const directory = process.env.SEQUENCE_DATE_AUDIT_DIR;
if (!directory || !path.isAbsolute(directory)) throw Error('An absolute private SEQUENCE_DATE_AUDIT_DIR is required.');
try {
  const rows = await db.collection('sequenceNotes').where('ownerUid', '==', owner).get();
  const plan = rows.docs.filter((row) => row.data().deleted === false && !('createdAt' in row.data()));
  assert(plan.length <= 100, 'Unexpected scope; review manually.');
  if (apply) {
    const reviewed = JSON.parse(await fs.readFile(planFile, 'utf8'));
    assert.equal(reviewed.owner, owner);
    const reviewedIds = reviewed.records.map((row) => row.id);
    const currentIds = rows.docs.filter((row) => !row.data().deleted).map((row) => row.id);
    assert(reviewedIds.every((id) => currentIds.includes(id)), 'Reviewed live note missing; audit again.');
    assert(plan.every((row) => reviewedIds.includes(row.id)), 'Unreviewed candidate; audit again.');
    for (const row of plan) assert.equal(row.createTime.toDate().toISOString(), reviewed.records.find((entry) => entry.id === row.id).createdAt);
  }
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reviewedPlanPath = path.join(directory, `${stamp}-plan.json`);
  if (!apply) await fs.writeFile(reviewedPlanPath, JSON.stringify({ owner, records: plan.map((row) => ({ id: row.id, createdAt: row.createTime.toDate().toISOString() })) }, null, 2), { flag: 'wx', mode: 0o600 });
  await fs.writeFile(path.join(directory, `${stamp}-${apply ? 'apply' : 'audit'}-before.json`), JSON.stringify(
    rows.docs.map((row) => ({ id: row.id, createTime: row.createTime, updateTime: row.updateTime, data: row.data() })), null, 2), { flag: 'wx', mode: 0o600 });
  const results = [];
  for (const original of plan) {
    assert(original.createTime instanceof admin.firestore.Timestamp, 'Missing authoritative createTime.');
    if (apply) {
      await db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(original.ref);
        assert(fresh.exists && fresh.updateTime.isEqual(original.updateTime), 'Record changed after audit; stop without overwriting.');
        assert.deepEqual(fresh.data(), original.data());
        transaction.update(original.ref, { createdAt: original.createTime });
      });
      const result = await original.ref.get();
      const { createdAt, ...unchanged } = result.data();
      assert(createdAt.isEqual(original.createTime));
      assert.deepEqual(unchanged, original.data(), 'Only createdAt may change.');
    }
    results.push({ id: original.id, label: original.id.startsWith('recovered_') ? '복구일' : '작성일', createdAt: original.createTime.toDate().toISOString(), applied: apply });
  }
  await fs.writeFile(path.join(directory, `${stamp}-result.json`), JSON.stringify({ apply, results }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ok: true, apply, active: rows.docs.filter((row) => !row.data().deleted).length, deletedUntouched: rows.docs.filter((row) => row.data().deleted).length, missing: plan.length, dates: results.map(({ label, createdAt }) => ({ label, createdAt })), privateAudit: directory, ...(apply ? {} : { reviewedPlanPath }) }));
} finally {
  await app.delete();
}
