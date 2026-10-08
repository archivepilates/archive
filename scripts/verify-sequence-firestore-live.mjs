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
// Hosting releases do not wait for new composite indexes to finish provisioning.
// Check only synthetic ownership before creating the temporary Auth identity.
try {
  const deadline = Date.now() + 300000;
  for (;;) {
    try {
      await db.collection('sequenceNotes').where('ownerUid', '==', 'codex-sequence-index-readiness').where('deleted', '==', false).orderBy('updatedAt', 'desc').limit(1).get();
      await db.collection('sequenceNoteImages').where('ownerUid', '==', 'codex-sequence-index-readiness').where('noteId', '==', 'no-note').get();
      break;
    } catch (error) {
      if (error.code !== 9 || !/index/i.test(error.message) || Date.now() >= deadline) throw error;
      console.log('Sequence indexes still provisioning; waiting 30 seconds.');
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }
  }
} catch (error) {
  await app.delete();
  throw error;
}
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
    await page.waitForFunction(() => window.KANGSAIN_FIREBASE_CONFIG?.projectId === 'archive-pilates');
    await page.evaluate(async (customToken) => {
      const { getAuth, signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
      const { getApps, initializeApp } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
      // Reuse the default app or initialize the exact public CORE config.
      const firebaseApp = getApps()[0] || initializeApp(window.KANGSAIN_FIREBASE_CONFIG);
      await signInWithCustomToken(getAuth(firebaseApp), customToken);
    }, token);
    await page.reload();
    try {
      await page.waitForFunction(() => {
        const frame = document.querySelector('iframe')?.contentWindow;
        return frame?.ARCHIVE_TEST && !frame.document.querySelector('#title').disabled;
      });
    } catch (error) {
      const diagnostic = await page.evaluate(() => {
        const frame = document.querySelector('iframe')?.contentDocument;
        return { frame: !!frame, status: frame?.querySelector('#saveStatus')?.textContent, notice: frame?.querySelector('#toast')?.textContent, login: document.querySelector('#coreLoginError')?.textContent };
      });
      throw Error(`Studio readiness failed: ${JSON.stringify(diagnostic)}`, { cause: error });
    }
    return page;
  }
  async function editSaved(page, id) {
    const frame = page.frameLocator('iframe');
    const fresh = await page.evaluate(() => {
      const test = document.querySelector('iframe').contentWindow.ARCHIVE_TEST;
      return { state: test.getState(), revision: test.getRevision(), dirty: test.dirty() };
    });
    assert.notEqual(fresh.state.id, id, 'Startup must use a fresh ID');
    assert.equal(fresh.state.title, '', 'Startup must not auto-open the most recent note');
    assert.equal(fresh.revision, 0);
    assert.equal(fresh.dirty, false);
    await frame.getByRole('tab', { name: /내 시퀀스/ }).click();
    const source = await db.collection('sequenceNotes').doc(id).get();
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = formatter.formatToParts(source.data().createdAt.toDate());
    const day = ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type).value).join('.');
    await frame.getByTestId(`sequence-record-${id}`).filter({ hasText: `작성일 ${day}` }).waitFor();
    const downloadReady = page.waitForEvent('download');
    await frame.getByTestId(`sequence-record-${id}`).getByRole('button', { name: 'PDF 저장', exact: true }).click();
    const download = await downloadReady;
    assert.ok(download.suggestedFilename().endsWith('.pdf'));
    await fs.mkdir('/tmp/archive-core-sequence-pdf-delete-live', { recursive: true });
    const pdfPath = `/tmp/archive-core-sequence-pdf-delete-live/library-${page.viewportSize().width}.pdf`;
    await download.saveAs(pdfPath);
    const pdf = await fs.readFile(pdfPath);
    assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.7');
    assert.ok(pdf.includes(Buffer.from('/Subtype /Image')), 'Saved attachment must be included');
    const text = [...pdf.toString('latin1').matchAll(/<([0-9A-F]+)> Tj/g)].map((match) => match[1].match(/.{4}/g).map((hex) => String.fromCharCode(parseInt(hex, 16))).join('')).join('\n');
    assert.ok(text.includes(source.data().title), 'PDF uses selected canonical record');
    const unchangedEditor = await page.evaluate(() => {
      const test = document.querySelector('iframe').contentWindow.ARCHIVE_TEST;
      return { state: test.getState(), revision: test.getRevision(), dirty: test.dirty() };
    });
    assert.deepEqual(unchangedEditor, fresh, 'Library PDF download must not open or overwrite the editor');
    assert.deepEqual((await source.ref.get()).data(), source.data(), 'PDF download must not write the source');
    await page.screenshot({ path: `/tmp/archive-core-sequence-pdf-delete-live/library-${page.viewportSize().width}.png`, fullPage: true });
    await frame.getByTestId(`sequence-record-${id}`).getByRole('button', { name: '수정', exact: true }).click();
    await frame.getByRole('tabpanel', { name: '02 노트 보기', exact: true }).waitFor();
    await page.waitForFunction((noteId) => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.getState().id === noteId, id);
    await frame.getByRole('tab', { name: '01 작성하기', exact: true }).click();
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
  assert.ok(canonical.data().createdAt instanceof admin.firestore.Timestamp, 'Server creation time must exist');
  assert.ok(!canonical.data().payload.includes('data:image'));
  assert.ok(Buffer.from(record.image.split(',')[1], 'base64').length <= 65536);
  const imageRows = await db.collection('sequenceNoteImages').where('ownerUid', '==', testUid).get();
  assert.equal(imageRows.size, 1);
  await pageA.reload();
  await pageA.waitForFunction(() => {
    const frame = document.querySelector('iframe')?.contentWindow;
    return frame?.ARCHIVE_TEST && !frame.document.querySelector('#title').disabled;
  });
  const blankAfterReload = await pageA.evaluate(() => {
    const test = document.querySelector('iframe').contentWindow.ARCHIVE_TEST;
    return { state: test.getState(), revision: test.getRevision(), dirty: test.dirty() };
  });
  assert.notEqual(blankAfterReload.state.id, record.id);
  assert.equal(blankAfterReload.state.title, '');
  assert.equal(blankAfterReload.revision, 0);
  assert.equal(blankAfterReload.dirty, false);
  await pageA.frameLocator('iframe').getByLabel('수업명', { exact: true }).fill('Codex 격리된 저장 테스트 B');
  assert.equal(await pageA.evaluate(() => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.flush()), true);
  await pageA.waitForFunction(() => {
    const test = document.querySelector('iframe').contentWindow.ARCHIVE_TEST;
    return !test.dirty() && test.getRevision() === 1;
  });
  const recordB = await pageA.evaluate(() => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.getState());
  assert.notEqual(recordB.id, record.id, 'B must use a distinct Firestore document');
  const canonicalB = await db.collection('sequenceNotes').doc(recordB.id).get();
  assert.equal(canonicalB.data().ownerUid, testUid);
  assert.equal(canonicalB.data().revision, 1);
  assert.ok(canonicalB.data().createdAt instanceof admin.firestore.Timestamp);
  assert.deepEqual(JSON.parse(canonicalB.data().payload), recordB);
  assert.equal((await db.collection('sequenceNotes').doc(record.id).get()).data().payload, canonical.data().payload, 'Saving B must preserve A payload');
  const pair = await db.collection('sequenceNotes').where('ownerUid', '==', testUid).get();
  assert.deepEqual(pair.docs.filter((doc) => !doc.data().deleted).map((doc) => doc.id).sort(), [record.id, recordB.id].sort(), 'Both originals must coexist in real Firestore');
  await pageA.frameLocator('iframe').getByRole('button', { name: '새 시퀀스', exact: true }).click();
  await pageA.waitForFunction((id) => {
    const test = document.querySelector('iframe').contentWindow.ARCHIVE_TEST;
    return test.getState().id !== id && test.getState().title === '' && test.getRevision() === 0 && !test.dirty();
  }, recordB.id);
  await editSaved(pageA, record.id);
  const pageB = await open(second);
  await editSaved(pageB, record.id);
  assert.equal(await pageB.evaluate(() => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.getState().moves.warm[0].image), record.image);
  await pageA.frameLocator('iframe').getByLabel('수업 목표', { exact: true }).fill('기기 A의 미저장 변경');
  await pageB.frameLocator('iframe').getByLabel('수업 목표', { exact: true }).fill('기기 B의 확정 변경');
  assert.equal(await pageB.evaluate(() => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.flush()), true);
  await pageA.frameLocator('iframe').getByRole('status').filter({ hasText: '다른 기기에서 변경됨' }).waitFor();
  assert.equal(await pageA.evaluate(() => document.querySelector('iframe').contentWindow.ARCHIVE_TEST.flush()), false);
  assert.equal((await db.collection('sequenceNotes').doc(record.id).get()).data().goal, '기기 B의 확정 변경');
  assert.ok((await db.collection('sequenceNotes').doc(record.id).get()).data().createdAt.isEqual(canonical.data().createdAt), 'Editing must preserve creation time');
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
  const staleCopy = await pageB.evaluate((id) => window.archiveSequenceStore.get(id), copyId);
  await pageA.frameLocator('iframe').getByRole('tab', { name: /내 시퀀스/ }).click();
  pageA.once('dialog', (dialog) => dialog.accept());
  await pageA.frameLocator('iframe').getByTestId(`sequence-record-${copyId}`).getByRole('button', { name: '삭제', exact: true }).click();
  await pageA.frameLocator('iframe').getByTestId(`sequence-record-${copyId}`).waitFor({ state: 'hidden' });
  assert.equal((await db.collection('sequenceNotes').doc(copyId).get()).data().deleted, true);
  assert.equal((await db.collection('sequenceNoteImages').where('noteId', '==', copyId).get()).size, 0);
  const tombstone = await db.collection('sequenceNotes').doc(copyId).get();
  const staleAttempt = await pageB.evaluate(async (loaded) => {
    try { await window.archiveSequenceStore.save(loaded.state, loaded.revision); return 'unexpected-save'; }
    catch (error) { return error.code; }
  }, staleCopy);
  assert.equal(staleAttempt, 'sequence/conflict', 'Other device must not recreate the deleted ID');
  await pageA.evaluate((state) => {
    const storage = document.querySelector('iframe').contentWindow.localStorage;
    storage.setItem('archive.sequence.studio.draft.v1', JSON.stringify(state));
    storage.setItem('archive.sequence.studio.library.v1', JSON.stringify([state]));
  }, staleCopy.state);
  await pageA.reload();
  await pageA.waitForFunction(() => {
    const frame = document.querySelector('iframe')?.contentWindow;
    return frame?.ARCHIVE_TEST && !frame.document.querySelector('#title').disabled;
  });
  const afterReload = await pageA.evaluate(async () => ({
    rows: (await window.archiveSequenceStore.list()).map((row) => row.id),
    freshId: document.querySelector('iframe').contentWindow.ARCHIVE_TEST.getState().id,
    flushed: await document.querySelector('iframe').contentWindow.ARCHIVE_TEST.flush(),
  }));
  assert.ok(!afterReload.rows.includes(copyId));
  assert.notEqual(afterReload.freshId, copyId);
  assert.equal(afterReload.flushed, true);
  assert.deepEqual((await tombstone.ref.get()).data(), tombstone.data(), 'Reload, old localStorage and stale save preserve tombstone');
  await pageA.frameLocator('iframe').getByRole('tab', { name: /내 시퀀스/ }).click();
  assert.equal(await pageA.frameLocator('iframe').getByTestId(`sequence-record-${copyId}`).count(), 0);
  assert.equal((await db.collection('sequenceNotes').doc(recordB.id).get()).data().payload, canonicalB.data().payload, 'Explicit A editing and conflict recovery must preserve B');
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
console.log(JSON.stringify({ ok: completed, base, testUid, checks: ['real-auth', 'real-firestore-note-and-image', 'library-pdf-download-390-1440', 'pdf-korean-and-image', 'pdf-keeps-editor-and-source', 'blank-reload', 'distinct-A-B-originals', 'original-A-preserved-after-B-save', 'actual-new-button', 'blank-second-context', 'explicit-edit', 'cross-device', 'conflict-preservation', 'copy-recovery', 'original-B-preserved', 'ui-delete', 'stale-device-cannot-restore', 'reload-and-legacy-cannot-restore', 'photo-delete', 'responsive', 'exact-test-cleanup'], browserClosed: true }));
