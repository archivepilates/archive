import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

// Existing identities, GET/query only; no fixtures, credentials or source mutations.
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'archive-pilates');
const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const credential = JSON.parse(await fs.readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
assert.equal(credential.client_email, 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com');
const app = admin.initializeApp({ credential: admin.credential.cert(credential), projectId: 'archive-pilates' }, 'sequence-manager-readonly');
const db = app.firestore();
let browser;
const contexts = new Set();
const base = 'https://core.archivepilates.com';
const results = [], writeAttempts = [];
const fingerprint = snapshot => snapshot.docs.map(doc => [doc.id, doc.updateTime.seconds, doc.updateTime.nanoseconds]).sort();
try {
  const manager = (await db.doc('staffs/operator_01029244425').get()).data();
  const instructor = (await db.doc('staffs/4817346').get()).data();
  assert.equal(manager.role, 'manager'); assert.equal(manager.active, true);
  assert.equal(instructor.name, '정유리'); assert.equal(instructor.role, 'instructor');
  assert.equal(instructor.active, true); assert.equal(instructor.coreMustChangePassword, false);
  assert.equal(instructor.coreAccessEnabled, true); assert.equal(instructor.employmentStatus, 'current');
  const before = await db.collection('sequenceNotes').get();
  const imagesBefore = await db.collection('sequenceNoteImages').get();
  const expected = before.docs.filter(doc => doc.data().deleted === false).map(doc => doc.id).sort();
  const ownExpected = before.docs.filter(doc => doc.data().deleted === false && doc.data().ownerUid === instructor.uid).map(doc => doc.id).sort();
  assert.ok(ownExpected.length >= 6, 'Assigned instructor notes must exist');
  // Hosting releases may finish before the new index is ready. No fallback queries.
  const deadline = Date.now() + 300000;
  for (;;) {
    try {
      await db.collection('sequenceNotes').where('deleted', '==', false).orderBy('updatedAt', 'desc').limit(100).get();
      break;
    } catch (error) {
      if (error.code !== 9 || !/index/i.test(error.message) || Date.now() >= deadline) throw error;
      console.log('Sequence all-owner index still provisioning; waiting 30 seconds.');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
  browser = await chromium.launch({ headless: true });
  async function open(staff, width) {
    const account = await app.auth().getUser(staff.uid);
    assert.equal(account.disabled, false); assert.equal(account.customClaims?.role, staff.role);
    const token = await app.auth().createCustomToken(staff.uid, account.customClaims || {});
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    contexts.add(context);
    await context.route('**/*', route => {
      const url = route.request().url();
      if (/google\.firestore\.v1\.Firestore\/Write|documents:(commit|batchWrite)|accounts:(update|delete|signUp)/.test(url)) {
        writeAttempts.push(url.split('?')[0]); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/sequence/`);
    await page.waitForFunction(() => window.KANGSAIN_FIREBASE_CONFIG?.projectId === 'archive-pilates');
    await page.evaluate(async token => {
      const { getAuth, signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
      const { getApps, initializeApp } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
      await signInWithCustomToken(getAuth(getApps()[0] || initializeApp(window.KANGSAIN_FIREBASE_CONFIG)), token);
    }, token);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.ARCHIVE_TEST && !document.querySelector('iframe').contentDocument.getElementById('title').disabled);
    const frame = page.frameLocator('iframe');
    await frame.getByRole('tab', { name: /시퀀스/ }).click();
    return { page, frame, context, errors };
  }
  for (const width of [390, 1440]) {
    const f = await open(manager, width);
    try {
      assert.equal(await f.frame.getByLabel('시퀀스 조회 범위').inputValue(), 'all');
      const visible = await f.page.evaluate(async () => {
        const store = window.archiveSequenceStore, ids = []; let after;
        for (let page = 0; page < 30; page++) {
          const rows = await store.list('all', after); ids.push(...rows.map(row => row.id));
          if (rows.length < 100) return ids.sort(); after = rows.at(-1);
        }
        throw Error('Unexpected library size');
      });
      assert.deepEqual(visible, expected);
      const card = f.frame.getByTestId(`sequence-record-${ownExpected[0]}`);
      await card.waitFor();
      assert.equal(await card.getByRole('button', { name: '수정', exact: true }).count(), 0);
      assert.equal(await card.getByRole('button', { name: '삭제', exact: true }).count(), 0);
      const draft = await f.page.evaluate(() => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.getState());
      await card.getByRole('button', { name: '보기', exact: true }).click();
      await f.frame.getByRole('dialog', { name: '시퀀스 읽기 전용' }).waitFor();
      await f.frame.getByRole('button', { name: '시퀀스 보기 닫기', exact: true }).click();
      assert.deepEqual(await f.page.evaluate(() => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.getState()), draft);
      const downloading = f.page.waitForEvent('download');
      await card.getByRole('button', { name: 'PDF 저장', exact: true }).click();
      assert.ok((await downloading).suggestedFilename().endsWith('.pdf'));
      const metrics = await f.page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(metrics.scroll <= metrics.width); assert.deepEqual(f.errors, []);
      results.push({ role: 'manager', width, visible: visible.length, assignedInstructorVisible: ownExpected.length, foreignPreviewAndPdf: true, draftUnchanged: true });
    } finally { await f.context.close(); contexts.delete(f.context); }
  }
  const f = await open(instructor, 390);
  try {
    assert.equal(await f.frame.getByLabel('시퀀스 조회 범위').isVisible(), false);
    const own = await f.page.evaluate(async () => (await window.archiveSequenceStore.list()).map(d => d.id).sort());
    assert.deepEqual(own, ownExpected);
    const blocked = await f.page.evaluate(async () => {
      try { await window.archiveSequenceStore.list('all'); return false; }
      catch (error) { return error.code === 'permission-denied'; }
    });
    assert.equal(blocked, true); assert.deepEqual(f.errors, []);
    results.push({ role: 'instructor', width: 390, visible: own.length, allQueryBlocked: true });
  } finally { await f.context.close(); contexts.delete(f.context); }
  assert.deepEqual(fingerprint(await db.collection('sequenceNotes').get()), fingerprint(before), 'No source note changed');
  assert.deepEqual(fingerprint(await db.collection('sequenceNoteImages').get()), fingerprint(imagesBefore), 'No image changed');
  assert.deepEqual(writeAttempts, []);
  console.log(JSON.stringify({ ok: true, readOnly: true, project: 'archive-pilates', results, sourceVersionsUnchanged: true, writeAttempts: 0 }));
} finally {
  for (const context of contexts) await context.close();
  await browser?.close();
  await db.terminate(); await app.delete();
}
