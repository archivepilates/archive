#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

if (!process.argv.includes('--apply')) throw Error('Synthetic live test requires --apply; never uses member records.');
if (process.env.GOOGLE_CLOUD_PROJECT !== 'archive-pilates') throw Error('Expected archive-pilates service-account environment.');
const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const key = JSON.parse(await fs.readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
if (key.client_email !== 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com') throw Error('Unexpected service account.');
const app = admin.initializeApp({ credential: admin.credential.cert(key), projectId: 'archive-pilates' }, 'sequence-live-test');
const db = app.firestore();
const testUid = `codex-sequence-qa-${Date.now()}`;
const base = process.env.ARCHIVE_CORE_BASE_URL || 'https://core.archivepilates.com';
let browser;
let completed = false;
try {
  const token = await app.auth().createCustomToken(testUid, { role: 'manager' });
  browser = await chromium.launch({ headless: true });
  const first = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const second = await browser.newContext({ viewport: { width: 390, height: 900 } });
  async function open(context) {
    const page = await context.newPage();
    await page.goto(`${base}/sequence/`);
    await page.waitForFunction(async () => {
      const { getApps } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
      return getApps().length > 0;
    });
    await page.evaluate(async (customToken) => {
      const { getAuth, signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
      const { getApps } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
      // Wait for the normal CORE bootstrap rather than creating another app.
      if (!getApps().length) throw Error('CORE Firebase app is not ready.');
      await signInWithCustomToken(getAuth(getApps()[0]), customToken);
    }, token);
    await page.reload();
    await page.waitForFunction(() => {
      const frame = document.querySelector('iframe')?.contentWindow;
      return frame?.ARCHIVE_TEST && !frame.document.querySelector('#title').disabled;
    });
    return page;
  }
  const pageA = await open(first);
  const record = await pageA.evaluate(async () => {
    const frame = document.querySelector('iframe').contentWindow;
    const state = frame.ARCHIVE_TEST.sample();
    state.id = `qa_${Date.now()}`;
    state.title = 'Codex 격리된 저장 테스트';
    const canvas = document.createElement('canvas');
    canvas.width = 1600; canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e9322c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    state.moves.warm[0].image = await window.archiveSequenceStore.compressImage(canvas.toDataURL('image/png'));
    frame.ARCHIVE_TEST.setState(state);
    if (!(await frame.ARCHIVE_TEST.flush())) throw Error('First server save failed.');
    return { id: state.id, image: state.moves.warm[0].image, revision: frame.ARCHIVE_TEST.getRevision() };
  });
  const canonical = await db.collection('sequenceNotes').doc(record.id).get();
  assert.equal(canonical.data().ownerUid, testUid);
  assert.equal(canonical.data().revision, 1);
  assert.ok(!canonical.data().payload.includes('data:image'));
  assert.ok(Buffer.from(record.image.split(',')[1], 'base64').length <= 65536);
  const imageRows = await db.collection('sequenceNoteImages').where('ownerUid', '==', testUid).get();
  assert.equal(imageRows.size, 1);
  const pageB = await open(second);
  await pageB.waitForFunction((id) => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.getState().id === id, record.id);
  assert.equal(await pageB.evaluate(() => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.getState().moves.warm[0].image), record.image);
  await pageA.frameLocator('iframe').getByLabel('수업 목표', { exact: true }).fill('기기 A의 미저장 변경');
  await pageB.frameLocator('iframe').getByLabel('수업 목표', { exact: true }).fill('기기 B의 확정 변경');
  assert.equal(await pageB.evaluate(() => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.flush()), true);
  await pageA.frameLocator('iframe').getByRole('status').filter({ hasText: '다른 기기에서 변경됨' }).waitFor();
  assert.equal(await pageA.evaluate(() => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.flush()), false);
  assert.equal((await db.collection('sequenceNotes').doc(record.id).get()).data().goal, '기기 B의 확정 변경');
  await pageA.frameLocator('iframe').getByRole('button', { name: '사본으로 저장', exact: true }).click();
  await pageA.frameLocator('iframe').getByRole('status').filter({ hasText: 'Firestore 저장 완료' }).waitFor();
  const copyId = await pageA.evaluate(() => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.getState().id);
  assert.notEqual(copyId, record.id);
  assert.equal((await db.collection('sequenceNotes').doc(copyId).get()).data().goal, '기기 A의 미저장 변경');
  const dimensions = await pageB.evaluate(() => {
    const inner = document.querySelector('iframe').contentDocument.documentElement;
    return { outer: document.documentElement.scrollWidth <= innerWidth + 1, inner: inner.scrollWidth <= inner.clientWidth + 1 };
  });
  assert.deepEqual(dimensions, { outer: true, inner: true });
  await pageA.evaluate(async (id) => {
    const loaded = await window.archiveSequenceStore.get(id);
    await window.archiveSequenceStore.remove(id, loaded.revision);
  }, copyId);
  assert.equal((await db.collection('sequenceNotes').doc(copyId).get()).data().deleted, true);
  assert.equal((await db.collection('sequenceNoteImages').where('noteId', '==', copyId).get()).size, 0);
  completed = true;
} finally {
  await browser?.close();
  // Exact test UID only; never delete real operators or member documents.
  for (const collection of ['sequenceNoteImages', 'sequenceNotes']) {
    const rows = await db.collection(collection).where('ownerUid', '==', testUid).get();
    for (let i = 0; i < rows.docs.length; i += 400) {
      const batch = db.batch();
      rows.docs.slice(i, i + 400).forEach((item) => batch.delete(item.ref));
      await batch.commit();
    }
    assert.equal((await db.collection(collection).where('ownerUid', '==', testUid).get()).size, 0);
  }
  try { await app.auth().deleteUser(testUid); } catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  await app.delete();
}
console.log(JSON.stringify({ ok: completed, base, testUid, checks: ['real-auth', 'real-firestore-note-and-image', 'cross-device', 'conflict-preservation', 'copy-recovery', 'photo-delete', 'responsive', 'exact-test-cleanup'], browserClosed: true }));
