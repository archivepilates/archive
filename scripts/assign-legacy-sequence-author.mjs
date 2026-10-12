#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { validateAssignmentIdentity, buildAssignmentPlan, assignmentPatch, verifyAssignment, fingerprint } from './lib/sequence-author-assignment.mjs';

const args = process.argv.slice(2);
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const author = value('--author'), staffId = value('--staff-id'), sourceUid = value('--source-uid');
const apply = args.includes('--apply'), planPath = value('--plan');
assert(author && /^\d+$/.test(staffId || '') && sourceUid, 'Explicit author, staff-id and source-uid required');
assert(process.env.GOOGLE_CLOUD_PROJECT === 'archive-pilates', 'Expected archive-pilates');
const directory = process.env.SEQUENCE_ASSIGNMENT_AUDIT_DIR;
assert(directory && path.isAbsolute(directory), 'Private absolute audit directory required');
if (apply) assert(planPath && path.isAbsolute(planPath), 'Apply requires a reviewed absolute plan');
const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const key = JSON.parse(await fs.readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
assert(key.client_email === 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com', 'Wrong operator');
const app = admin.initializeApp({ credential: admin.credential.cert(key), projectId: 'archive-pilates' }, 'sequence-assignment');
const db = app.firestore();
const version = snapshot => ({ seconds: snapshot.updateTime.seconds, nanoseconds: snapshot.updateTime.nanoseconds });
const row = snapshot => ({ id: snapshot.id, data: snapshot.data(), updateTime: version(snapshot) });
try {
  const staffRef = db.doc(`staffs/${staffId}`), staffSnapshot = await staffRef.get();
  assert(staffSnapshot.exists, 'Missing staff');
  const staff = staffSnapshot.data();
  const sources = await db.collection('staffs').where('uid', '==', sourceUid).get();
  assert(sources.size === 1, 'Ambiguous legacy owner');
  const sourceRef = sources.docs[0].ref, source = sources.docs[0].data();
  const auth = await app.auth().getUser(staff.uid);
  const identity = { author, staffId, sourceUid, staff, source, auth };
  validateAssignmentIdentity(identity);
  const allNotes = await db.collection('sequenceNotes').get();
  const allImages = await db.collection('sequenceNoteImages').get();
  const notes = allNotes.docs.map(row), images = allImages.docs.map(row);
  const plan = buildAssignmentPlan({ author, staffId, sourceUid, targetUid: staff.uid, notes, images });
  const before = { notes: notes.filter(item => plan.notes.some(selected => selected.id === item.id)), images: images.filter(item => plan.images.some(selected => selected.id === item.id)) };
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPlan = path.join(directory, `${stamp}-plan.json`);
  if (!apply) await fs.writeFile(outputPlan, JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 });
  if (apply) {
    assert.deepEqual(JSON.parse(await fs.readFile(planPath, 'utf8')), plan, 'Reviewed plan drifted; rerun audit');
    assert(plan.notes.length > 0, 'No eligible notes');
    await fs.writeFile(path.join(directory, `${stamp}-before.json`), JSON.stringify(before, null, 2), { flag: 'wx', mode: 0o600 });
    await db.runTransaction(async transaction => {
      const refs = [...plan.notes.map(item => db.doc(`sequenceNotes/${item.id}`)), ...plan.images.map(item => db.doc(`sequenceNoteImages/${item.id}`))];
      const [freshStaff, freshSource, ...records] = await transaction.getAll(staffRef, sourceRef, ...refs);
      assert(freshStaff.exists && freshSource.exists, 'Identity disappeared');
      const freshImages = [];
      for (let start = 0; start < plan.notes.length; start += 30) {
        const snapshot = await transaction.get(db.collection('sequenceNoteImages').where('noteId', 'in', plan.notes.slice(start, start + 30).map(item => item.id)));
        freshImages.push(...snapshot.docs.map(row));
      }
      assert.deepEqual(freshImages.map(item => ({ id: item.id, beforeHash: fingerprint(item.data), updateTime: item.updateTime })).sort((a, b) => a.id.localeCompare(b.id)), plan.images, 'Image membership changed after audit');
      // Auth cannot participate in a Firestore transaction; recheck just before writes.
      const freshAuth = await app.auth().getUser(plan.targetUid);
      validateAssignmentIdentity({ ...identity, auth: freshAuth, staff: freshStaff.data(), source: freshSource.data() });
      assert(freshStaff.data().uid === plan.targetUid, 'Target UID changed');
      for (const [index, snapshot] of records.entries()) {
        const planned = [...plan.notes, ...plan.images][index];
        assert(snapshot.exists && fingerprint(snapshot.data()) === planned.beforeHash, 'Record changed after audit');
        assert.deepEqual(version(snapshot), planned.updateTime, 'Record version changed after audit');
      }
      for (const [index, snapshot] of records.entries()) transaction.update(snapshot.ref, assignmentPatch(index < plan.notes.length ? 'note' : 'image', snapshot.data(), plan.targetUid));
    });
    for (const kind of ['notes', 'images']) for (const original of before[kind]) {
      const current = await db.doc(`${kind === 'notes' ? 'sequenceNotes' : 'sequenceNoteImages'}/${original.id}`).get();
      assert(current.exists, 'Transferred document missing');
      verifyAssignment(kind === 'notes' ? 'note' : 'image', original.data, current.data(), plan.targetUid);
    }
    const untouched = new Map([...notes.filter(item => !plan.notes.some(x => x.id === item.id)).map(item => [`sequenceNotes/${item.id}`, item]),
      ...images.filter(item => !plan.images.some(x => x.id === item.id)).map(item => [`sequenceNoteImages/${item.id}`, item])]);
    for (const [ref, original] of untouched) assert.deepEqual(version(await db.doc(ref).get()), original.updateTime, 'Unrelated record changed; inspect concurrent activity');
    const visible = await db.collection('sequenceNotes').where('ownerUid', '==', plan.targetUid).where('deleted', '==', false).orderBy('updatedAt', 'desc').limit(100).get();
    assert(plan.notes.every(item => visible.docs.some(snapshot => snapshot.id === item.id)), 'Transferred note missing from My Sequences query');
    const finalStaff = (await staffRef.get()).data();
    validateAssignmentIdentity({ ...identity, staff: finalStaff, auth: await app.auth().getUser(plan.targetUid) });
    await fs.writeFile(path.join(directory, `${stamp}-result.json`), JSON.stringify({ applied: true, plan, visibleCount: visible.size, contentUnchanged: true, unrelatedUnchanged: true }), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ ok: true, apply: true, assigned: plan.notes.length, images: plan.images.length, visibleCount: visible.size, contentAndDatesUnchanged: true, unrelatedUnchanged: true, auditDirectory: directory }));
  } else console.log(JSON.stringify({ ok: true, apply: false, author: plan.author, targetUid: plan.targetUid, eligible: plan.notes.length, images: plan.images.length, reviewedPlanPath: outputPlan, planHash: fingerprint(plan) }));
} finally { await app.delete(); }
