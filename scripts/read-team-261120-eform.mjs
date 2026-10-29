import assert from 'node:assert/strict';
import { readFile, mkdir, open, lstat, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { acquireEformsignBrowserLock } from './lib/eformsign-browser-lock.mjs';
import { assertEformEmptySearchResponse } from './lib/instructor-eform-search-evidence.mjs';
import { readCompletedRecipientEvidence } from './lib/instructor-signup-order-identity.mjs';
import { readCompletedSignupProfile } from './lib/instructor-signup-profile.mjs';
import { parseSignupProfile } from './lib/instructor-signup-profile.mjs';
import { parseInstructorEformProgress } from './lib/instructor-eform-progress-evidence.mjs';
import {
  INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID, instructorLessonRegistrationId,
  normalizeInstructorLessonName, normalizeInstructorLessonPhone,
} from './lib/instructor-lesson-registration-contract.mjs';

const PROJECT = 'archive-pilates';
const ACCOUNT = 'archivepilates@gmail.com';
const COMPANY = '848f6dc7fa024a6cb28a2994c0835e53';
const TEMPLATE = 'a5b5ea6b85ec44c8bcb4af1e980e94eb';
const PROFILE = '/Users/archivepilates/ArchiveIN/automation/eformsign-browser-profile';
const DIRECTORY = '/Users/archivepilates/ArchiveIN/operations/team-instructor-fulfillment-20261029';
const IDS = Object.freeze([
  'ilr_6685071b1f94a42a4a2b9cc2', 'ilr_11220626f43287e672165c95', 'ilr_0882918f3696516a12e99baa',
  'ilr_5645aa92361ec38ac3341284', 'ilr_1a419dab0dc80e8c175f0096', 'ilr_a48e0e3d5c7e4b8c5c65cb13',
]);
const HINT = Object.freeze({ documentId: '3b5c233b8d62478ba04c76b0d95a1070',
  documentName: '2026-10-06_강사회원가입서_하언진_63912d0d' });
const listPath = `/v1.0/companies/${COMPANY}/documents`;
const origins = new Set(['https://www.eformsign.com', 'https://kr-service.eformsign.com']);
const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const evidence = {
  version: 1, source: 'team_261120_native_eform_readonly', projectId: PROJECT, studioId: '5330',
  account: ACCOUNT, templateId: TEMPLATE, registrationIds: IDS, lessonDate: '2026-11-20',
  startedAt: new Date().toISOString(), finishedAt: null, ok: false, complete: false,
  sendAllowed: false, memberSends: 0, rows: [], errors: [], blockedRequests: [],
  knownDocumentHint: { ...HINT, observed: false, refreshed: false },
  cleanup: { contextClosed: false, lockReleased: false, appDeleted: false },
};
let app, context, release, output, location = { stage: 'initialization' };

function recordError(code, where = location) {
  const entry = { code, location: { ...where }, checkedAt: new Date().toISOString() };
  evidence.errors.push(entry);
  return entry;
}

// Persist necessary document proof, never transport credentials, headers or raw exceptions.
function privateProof(value) {
  if (Array.isArray(value)) return value.map(privateProof);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /token|password|secret|authorization|cookie|api[_-]?key/i.test(key) ? '[redacted]' : privateProof(item)]));
  return value;
}

function assertQuery(query, name, mode) {
  assert.deepEqual(Object.keys(query || {}).sort(), ['limit', 'search', 'skip', 'sort', 'sort_type', 'type']);
  assert.equal(query.search, name);
  assert.equal(query.type, mode);
  assert.equal(query.skip, 0);
  assert.equal(query.limit, 20);
  assert.equal(query.sort, 'update_date');
  assert.equal(query.sort_type, 'desc');
}

function responseDocumentId(document) {
  const values = [document?.document_id, document?.id, document?.documentId].filter(value => value != null && value !== '');
  assert(values.length > 0 && values.every(value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)));
  assert.equal(new Set(values).size, 1);
  return values[0];
}

function documentUrl(row) {
  const url = new URL(row.href, 'https://www.eformsign.com');
  assert.equal(url.origin, 'https://www.eformsign.com');
  assert.equal(url.pathname, '/eform/document/view_service.html');
  assert.equal(url.searchParams.get('document_id'), row.documentId);
  assert.equal(url.searchParams.get('form_id'), TEMPLATE);
  return `https://www.eformsign.com/eform/document/view_service.html?document_id=${row.documentId}&form_id=${TEMPLATE}`;
}

async function assertAccount(page) {
  const url = new URL(page.url());
  assert.equal(url.origin, 'https://www.eformsign.com');
  assert((await page.locator('body').innerText()).includes(ACCOUNT));
}

async function searchDocuments(page, registration, mode, proof) {
  location = { stage: 'search_navigation', registrationId: registration.registrationId, mode };
  await page.goto(`https://www.eformsign.com/eform/document/document_list.html?mode=${mode}`,
    { waitUntil: 'networkidle', timeout: 60000 });
  await assertAccount(page);
  await page.locator('#simpleSearchKey').fill(registration.memberName);
  location.stage = 'search_response';
  const waiting = page.waitForResponse(response => {
    const url = new URL(response.url());
    if (!origins.has(url.origin) || url.pathname !== listPath || response.request().method() !== 'POST') return false;
    try {
      const query = response.request().postDataJSON()?.input?.query;
      return query?.search === registration.memberName && query?.type === mode;
    } catch { return false; }
  }, { timeout: 20000 });
  // Attach the waiter before the native click; consume both failures without leaking payloads.
  const [response] = await Promise.all([waiting, page.locator('#simpleSearchButton').click()]);
  const request = response.request().postDataJSON();
  const body = await response.json();
  proof.request = { input: { query: request?.input?.query } };
  proof.response = privateProof({ httpStatus: response.status(), status: body?.status, code: body?.code, result: body?.result });
  proof.checkedAt = new Date().toISOString();
  assertQuery(request?.input?.query, registration.memberName, mode);
  assert.equal(response.status(), 200);
  assert.equal(body?.status, '200');
  assert.equal(body?.code, '-1');
  const total = body?.result?.total_rows, documents = body?.result?.documents;
  assert(Number.isInteger(total) && total >= 0 && total <= 20);
  assert(Array.isArray(documents) && documents.length === total, 'Incomplete search page');
  proof.totalRows = total;
  proof.documentIds = documents.map(responseDocumentId);
  assert.equal(new Set(proof.documentIds).size, total);
  if (total === 0) Object.assign(proof, assertEformEmptySearchResponse({
    httpStatus: response.status(), request, body, name: registration.memberName, mode,
  }));
  location.stage = 'search_dom';
  await page.waitForFunction(({ ids, name }) => {
    if (document.querySelector('#simpleSearchKey')?.value !== name) return false;
    const rows = [...document.querySelectorAll('#RWDtable tbody tr, #RWDtable tr')]
      .filter(row => row.getClientRects().length && row.querySelector('a[href*="view_service.html"]'));
    const actual = [...new Set(rows.map(row => row.id || row.getAttribute('data-document-id') || ''))].sort();
    return JSON.stringify(actual) === JSON.stringify([...ids].sort());
  }, { ids: proof.documentIds, name: registration.memberName }, { timeout: 20000 });
  if (total === 0) await page.getByText('No search results found.', { exact: true }).filter({ visible: true }).first()
    .waitFor({ state: 'visible', timeout: 20000 });
  proof.domRows = await page.evaluate(() => [...document.querySelectorAll('#RWDtable tr')]
    .filter(row => row.getClientRects().length && row.querySelector('a[href*="view_service.html"]'))
    .map(row => {
      const link = row.querySelector('a[href*="view_service.html"]');
      return { documentId: row.id || row.getAttribute('data-document-id') || '',
        documentName: String(link.textContent || '').replace(/\s+/g, ' ').trim(),
        href: link.getAttribute('href'), text: String(row.innerText || '').replace(/\s+/g, ' ').trim() };
    }));
  assert.equal(proof.domRows.length, total);
  assert.deepEqual(proof.domRows.map(row => row.documentId).sort(), [...proof.documentIds].sort());
  await assertAccount(page);
  const expectedName = registration.memberName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namePattern = new RegExp(`(?:^|[_\\s(])${expectedName}(?:$|[_\\s)])`);
  proof.matches = [];
  proof.excluded = [];
  proof.unverified = [];
  for (const row of proof.domRows) {
    const sourceRows = documents.filter(document => responseDocumentId(document) === row.documentId);
    assert.equal(sourceRows.length, 1);
    assert(typeof sourceRows[0].title === 'string' && row.text.includes(sourceRows[0].title));
    row.documentName = sourceRows[0].title;
    const url = new URL(row.href, page.url());
    row.href = `${url.origin}${url.pathname}?document_id=${encodeURIComponent(url.searchParams.get('document_id') || '')}&form_id=${encodeURIComponent(url.searchParams.get('form_id') || '')}`;
    if (url.searchParams.get('form_id') !== TEMPLATE) {
      proof.excluded.push({ documentId: row.documentId, reason: 'other_template' });
      continue;
    }
    if (/(?:^|\s)(?:Cancelled|Canceled|Cancel|Rejected|취소(?:됨|된)?|반려)(?:\s|$)/i.test(row.text)) {
      proof.excluded.push({ documentId: row.documentId, reason: 'cancelled_or_rejected' });
      continue;
    }
    documentUrl(row);
    if (!namePattern.test(row.documentName) || !row.text.includes(row.documentName)
      || (mode === 'ai' && !/^(?:완료|Completed)\s/i.test(row.text))) {
      proof.unverified.push({ documentId: row.documentId, reason: 'row_name_or_status_unverified' });
      continue;
    }
    if (row.documentId === HINT.documentId) {
      evidence.knownDocumentHint.observed = true;
      evidence.knownDocumentHint.titleMatches = row.documentName === HINT.documentName;
    }
    proof.matches.push(row);
  }
  proof.accountVerified = true;
  proof.queryMatches = true;
  proof.complete = true;
}

async function captureStatus(page, row, action, target) {
  const pending = [];
  const listener = response => {
    const url = new URL(response.url());
    if (url.origin !== 'https://kr-service.eformsign.com'
      || url.pathname !== `${listPath}/${row.documentId}/status` || response.request().method() !== 'GET') return;
    pending.push((async () => {
      target.statusResponse = privateProof({ origin: url.origin, path: url.pathname, method: 'GET',
        httpStatus: response.status(), body: await response.json(), observedAt: new Date().toISOString() });
    })().catch(() => { target.statusResponseError = 'status_response_unreadable'; }));
  };
  page.on('response', listener);
  try { return await action(); }
  finally { page.off('response', listener); await Promise.all(pending); }
}

async function inspectCompleted(page, registration, row, proof) {
  location = { stage: 'completed_recipient', registrationId: registration.registrationId, documentId: row.documentId };
  const memberId = String(registration.studiomateMemberId || registration.evidence?.studiomateMemberId || '');
  const job = { registrationId: registration.registrationId, studioId: '5330',
    memberName: registration.memberName, memberPhone: registration.memberPhone,
    studiomateMemberId: memberId, documentId: row.documentId, documentName: row.documentName };
  proof.recipient = await captureStatus(page, row, () => readCompletedRecipientEvidence(page, job), proof);
  assert(proof.statusResponse && !proof.statusResponseError, 'Exact status response proof required');
  await assertAccount(page);
  assert.equal(proof.recipient.recipients.length, 1);
  const recipient = proof.recipient.recipients[0];
  assert.equal(normalizeInstructorLessonName(recipient.name), registration.memberName);
  assert.equal(normalizeInstructorLessonPhone(recipient.phone), registration.memberPhone);
  proof.recipientVerified = true;
  location.stage = 'completed_profile';
  assert(/^[1-9]\d*$/.test(memberId), 'Canonical native member ID required; never invent one');
  const previousJobId = registration.evidence?.eformsignJobId;
  if (previousJobId && previousJobId !== registration.registrationId) {
    assert(/^ilr_[a-f0-9]{24}$/.test(previousJobId));
    const previous = (await app.firestore().doc('eformsignInstructorMemberJobs/' + previousJobId).get()).data();
    assert(previous?.status === 'done' && previous.documentId === row.documentId
      && previous.memberName === registration.memberName && previous.memberPhone === registration.memberPhone
      && previous.studiomateMemberId === memberId);
    parseSignupProfile(previous.submittedProfile, previous, row.documentId);
    proof.profileSource = 'existing_canonical_completed_job';
    proof.profileReference = 'eformsignInstructorMemberJobs/' + previousJobId;
    proof.answersReReadFromViewer = false;
  } else {
    proof.profile = await readCompletedSignupProfile(page, job, { ...row, found: true, href: documentUrl(row) });
    assert.equal(proof.profile.memberName, registration.memberName);
    assert.equal(proof.profile.memberPhone, registration.memberPhone);
    assert.equal(proof.profile.documentId, row.documentId);
    proof.profileSource = 'live_completed_document_viewer';
    proof.answersReReadFromViewer = true;
  }
  proof.profileVerified = true;
  proof.status = 'completed_verified';
  proof.checkedAt = new Date().toISOString();
  if (row.documentId === HINT.documentId) evidence.knownDocumentHint.refreshed = true;
}

async function inspectProgress(page, registration, row, proof) {
  location = { stage: 'progress_recipient', registrationId: registration.registrationId, documentId: row.documentId };
  proof.status = 'progress_unverified';
  proof.reconciliationRequired = true;
  // Repeat the exact search before selecting its row; never open a send or edit control.
  const refresh = { mode: 'ip', complete: false };
  proof.refresh = refresh;
  await captureStatus(page, row, async () => {
    await searchDocuments(page, registration, 'ip', refresh);
    location = { stage: 'progress_status', registrationId: registration.registrationId, documentId: row.documentId };
    const current = refresh.matches.find(item => item.documentId === row.documentId && item.documentName === row.documentName);
    assert(current, 'Progress document changed');
    const element = page.locator('#RWDtable tr').filter({ hasText: row.documentName });
    assert.equal(await element.count(), 1);
    assert.equal(await element.getAttribute('id'), row.documentId);
    // Fresh navigation can fetch the exact first row before search completion.
    if (proof.statusResponse && await element.getAttribute('aria-selected') === 'true') return;
    const waiting = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === 'https://kr-service.eformsign.com' && url.pathname === `${listPath}/${row.documentId}/status`
        && response.request().method() === 'GET';
    }, { timeout: 15000 });
    const [response] = await Promise.all([waiting, element.click({ position: { x: 15, y: 15 } })]);
    await response.finished();
  }, proof);
  await page.waitForFunction(id => document.querySelector('#RWDtable tr[aria-selected="true"]')?.id === id,
    row.documentId, { timeout: 10000 });
  await assertAccount(page);
  const response = proof.statusResponse, body = response?.body, status = body?.result?.status;
  assert.equal(response?.httpStatus, 200);
  assert.equal(body?.status, '200');
  assert.equal(body?.code, '-1');
  assert.equal(status?.document_title, row.documentName);
  proof.recipient = parseInstructorEformProgress({httpStatus:response.httpStatus,body,documentName:row.documentName,
    memberName:registration.memberName,memberPhone:registration.memberPhone});
  assert.equal(proof.recipient.name, registration.memberName);
  assert.equal(proof.recipient.phone, registration.memberPhone);
  proof.recipientVerified = true;
  proof.status = 'progress_verified';
  proof.checkedAt = new Date().toISOString();
}

async function auditRegistration(page, registration) {
  const row = { registrationId: registration.registrationId, memberName: registration.memberName,
    canonicalPhone: registration.memberPhone, canonicalMemberId: registration.studiomateMemberId || registration.evidence?.studiomateMemberId || null,
    status: 'unverified', searches: [], completed: [], progress: [], sendAllowed: false };
  evidence.rows.push(row);
  for (const mode of ['ai', 'ip']) {
    const proof = { mode, complete: false };
    row.searches.push(proof);
    try { await searchDocuments(page, registration, mode, proof); }
    catch { proof.error = recordError('SEARCH_NOT_VERIFIED'); }
  }
  for (const search of row.searches.filter(proof => proof.complete)) {
    for (const match of search.matches) {
      const proof = { documentId: match.documentId, documentName: match.documentName,
        templateId: TEMPLATE, href: documentUrl(match), status: 'unverified', recipientVerified: false, profileVerified: false };
      (search.mode === 'ai' ? row.completed : row.progress).push(proof);
      try {
        if (search.mode === 'ai') await inspectCompleted(page, registration, match, proof);
        else await inspectProgress(page, registration, match, proof);
      } catch { proof.error = recordError('DOCUMENT_NOT_VERIFIED'); }
    }
  }
  const completeSearch = row.searches.every(proof => proof.complete && proof.unverified.length === 0);
  const documentIds = [...row.completed, ...row.progress].map(proof => proof.documentId);
  const ambiguous = row.completed.length > 1 || row.progress.length > 1 || (row.completed.length > 0 && row.progress.length > 0)
    || new Set(documentIds).size !== documentIds.length;
  row.searchComplete = completeSearch;
  row.counts = { completed: row.completed.length, progress: row.progress.length,
    excluded: row.searches.reduce((sum, proof) => sum + (proof.excluded?.length || 0), 0) };
  row.status = !completeSearch ? 'search_unverified' : ambiguous ? 'ambiguous_reconcile'
    : row.progress.length ? (row.progress[0].status === 'progress_verified' ? 'progress_reconcile' : 'progress_unverified')
      : row.completed.length ? (row.completed[0].status === 'completed_verified' ? 'completed_verified' : 'completed_unverified')
        : 'not_found_in_verified_search';
  row.reconciliationRequired = row.status !== 'completed_verified';
  row.checkedAt = new Date().toISOString();
}

try {
  assert.equal(process.argv.length, 2, 'This exact six-record audit accepts no arguments');
  assert.equal(INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID, TEMPLATE);
  assert(!process.env.FIRESTORE_EMULATOR_HOST);
  for (const variable of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']) assert(!process.env[variable] || process.env[variable] === PROJECT);
  await mkdir(DIRECTORY, { recursive: true, mode: 0o700 });
  const directory = await lstat(DIRECTORY);
  assert(directory.isDirectory() && !directory.isSymbolicLink() && (directory.mode & 0o077) === 0);
  assert.equal(await realpath(DIRECTORY), DIRECTORY);
  output = await open(`${DIRECTORY}/eform-${Date.now()}.json`, 'wx', 0o600);
  location = { stage: 'service_account' };
  const serviceAccount = JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'));
  assert.equal(serviceAccount.project_id, PROJECT);
  assert.equal(serviceAccount.client_email, 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com');
  const admin = require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
  app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: PROJECT }, `team-eform-read-${Date.now()}`);
  location = { stage: 'canonical_source' };
  const db = app.firestore();
  const snapshots = await db.getAll(...IDS.map(id => db.doc(`instructorLessonRegistrations/${id}`)));
  assert.equal(snapshots.length, 6);
  const registrations = snapshots.map((snapshot, index) => {
    assert(snapshot.exists && snapshot.id === IDS[index]);
    const r = snapshot.data();
    assert(r.studioId === '5330' && r.courseKind === 'team' && r.lessonDate === '2026-11-20'
      && r.lessonTime === '14:00' && r.lessonTopic === 'ARCHIVE METHOD #1 직장인 증후군'
      && r.paymentAmount === 80000 && r.paymentMethod === 'wiretransfer' && !r.cancellation
      && !['cancelled', 'canceled', 'rejected', 'cancellation_pending', 'cancellation_review'].includes(r.status));
    const name = normalizeInstructorLessonName(r.memberName), phone = normalizeInstructorLessonPhone(r.memberPhone);
    assert(name && name === r.memberName && /^010\d{8}$/.test(phone));
    assert.equal(instructorLessonRegistrationId('5330', phone, r.lessonDate), snapshot.id);
    assert(!r.registrationId || r.registrationId === snapshot.id);
    return { ...r, registrationId: snapshot.id, memberName: name, memberPhone: phone };
  });
  assert.equal(new Set(registrations.map(r => r.memberPhone)).size, 6);
  location = { stage: 'browser_lock' };
  release = await acquireEformsignBrowserLock({ owner: 'team-261120-eform-readonly', waitMs: 120000 });
  const { chromium } = require('playwright');
  context = await chromium.launchPersistentContext(PROFILE, { headless: true, serviceWorkers: 'block', acceptDownloads: false });
  await context.route('**/*', async route => {
    try {
      const request = route.request(), url = new URL(request.url());
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { await route.continue(); return; }
      // The documents POST is a native read endpoint. All other non-read requests stay blocked.
      if (request.method() === 'POST' && origins.has(url.origin) && url.pathname === listPath) {
        const payload = request.postDataJSON(), query = payload?.input?.query;
        if (['ai', 'ip'].includes(query?.type) && query.skip === 0 && Number.isInteger(query.limit) && query.limit > 0 && query.limit <= 20
          && (query.search == null || query.search === '' || registrations.some(r => r.memberName === query.search))) { await route.continue(); return; }
      }
      if (request.method() === 'POST' && url.origin === 'https://kr-service.eformsign.com'
        && [listPath.replace('/documents', '/members/archivepilates@gmail.com/unstructured_forms'),
          listPath.replace('/documents', '/multi_category_by_permission')].includes(url.pathname)) { await route.continue(); return; }
      evidence.blockedRequests.push({ method: request.method(), kind: 'non_read_request', location: { ...location } });
      await route.abort('blockedbyclient');
    } catch {
      recordError('READ_REQUEST_GUARD_FAILED');
      await route.abort('blockedbyclient').catch(() => {});
    }
  });
  await context.routeWebSocket('**/*', socket => { evidence.blockedRequests.push({ kind: 'websocket', location: { ...location } }); socket.close(); });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
  for (const registration of registrations) await auditRegistration(page, registration);
  location = { stage: 'source_revalidation' };
  const latest = await db.getAll(...IDS.map(id => db.doc(`instructorLessonRegistrations/${id}`)));
  evidence.sourceUnchanged = latest.every((snapshot, index) => {
    const current = snapshot.data(), prior = registrations[index];
    return snapshot.exists && !current.cancellation && !current.externalOrderReviewRequired
      && ['memberName','memberPhone','studiomateMemberId','lessonDate','lessonTime','lessonTopic','paymentMethod','paymentAmount','courseKind']
        .every(key => current[key] === prior[key]);
  });
  assert(evidence.sourceUnchanged);
  evidence.complete = evidence.rows.length === 6 && evidence.rows.every(row => row.searchComplete);
  evidence.ok = evidence.complete && evidence.errors.length === 0;
} catch {
  recordError('TEAM_EFORM_AUDIT_STOPPED');
  evidence.ok = false;
} finally {
  // Each cleanup runs even if a preceding cleanup fails. Never leak raw SDK/browser errors.
  try { if (context) await context.close(); evidence.cleanup.contextClosed = true; }
  catch { recordError('CLEANUP_FAILED', { stage: 'context_close' }); evidence.ok = false; }
  try { if (release) await release(); evidence.cleanup.lockReleased = true; }
  catch { recordError('CLEANUP_FAILED', { stage: 'lock_release' }); evidence.ok = false; }
  try { if (app) await app.delete(); evidence.cleanup.appDeleted = true; }
  catch { recordError('CLEANUP_FAILED', { stage: 'app_delete' }); evidence.ok = false; }
  evidence.finishedAt = new Date().toISOString();
  try {
    assert(output, 'Private evidence file unavailable');
    await output.writeFile(JSON.stringify(privateProof(evidence), null, 2));
    await output.sync();
  } catch { evidence.ok = false; }
  finally { try { await output?.close(); } catch { evidence.ok = false; } }
  console.log(JSON.stringify({ status: evidence.ok ? 'audit_complete' : 'audit_review_required', count: evidence.rows.length,
    rows: evidence.rows.map(row => ({ name: row.memberName, status: row.status, counts: row.counts,
      documentIds: [...row.completed, ...row.progress].map(proof => proof.documentId) })) }));
  if (!evidence.ok) process.exitCode = 1;
}
