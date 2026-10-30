import * as contract from './instructor-lesson-registration-contract.mjs';

const {
  INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID: TEMPLATE_ID,
  normalizeInstructorLessonPhone: phone,
} = contract;
export const INSTRUCTOR_SIGNUP_SOURCE_DOCUMENTS_URL = contract.EFORMSIGN_PROGRESS_DOCUMENTS_URL;
const PROGRESS_URL = INSTRUCTOR_SIGNUP_SOURCE_DOCUMENTS_URL;
// Use the shared export when available; older contract modules only export the template.
const COMPANY_ID = contract.EFORMSIGN_COMPANY_ID ?? '848f6dc7fa024a6cb28a2994c0835e53';
const STATUS_ORIGIN = 'https://kr-service.eformsign.com';
const UI_ORIGIN = new URL(PROGRESS_URL).origin;
const statusPath = id => `/v1.0/companies/${COMPANY_ID}/documents/${id}/status`;
const nativeId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const emptyOwners = value => value == null || (Array.isArray(value) && value.length === 0);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const name = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const safeCodes = new Set([
  'source_invalid', 'response_unverified', 'schema_unverified', 'recipient_unverified',
  'date_unverified', 'session_unverified', 'row_unverified', 'read_failed',
].map(code => `instructor_signature_reminder_${code}`));

function fail(reason) {
  const code = `instructor_signature_reminder_${reason}`;
  const error = new Error(code);
  error.code = code;
  throw error;
}

function instant(value) {
  try {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
      return Date.parse(value);
    }
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    const seconds = value?.seconds ?? value?._seconds;
    const nanos = value?.nanoseconds ?? value?._nanoseconds;
    if (Number.isSafeInteger(seconds) && Number.isInteger(nanos) && nanos >= 0 && nanos < 1e9) {
      return seconds * 1000 + nanos / 1e6;
    }
  } catch { return NaN; }
  return NaN;
}

function assertJob(job) {
  if (!nativeId(job?.documentId) || typeof job.documentName !== 'string' || !job.documentName.trim()
    || job.documentName !== job.documentName.trim() || /[\x00-\x1f\x7f]/.test(job.documentName)
    || !name(job.memberName) || name(job.memberName).length > 40
    || typeof job.memberPhone !== 'string' || !/^010\d{8}$/.test(phone(job.memberPhone))
    || (job.templateId != null && job.templateId !== TEMPLATE_ID)) fail('source_invalid');
}

function matchesStatusUrl(value, id) {
  try {
    const url = new URL(value);
    const keys = [...url.searchParams.keys()].sort();
    return url.origin === STATUS_ORIGIN && url.pathname === statusPath(id)
      && JSON.stringify(keys) === JSON.stringify(['_', 'lang', 'mode'])
      && url.searchParams.get('mode') === 'ip' && url.searchParams.get('lang') === 'en'
      && /^\d{13}$/.test(url.searchParams.get('_'))
      && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

export function parsePendingInstructorSignupStatus({
  responseUrl, method, httpStatus, body, selectedDocumentId, templateId, job,
  observedAt = new Date().toISOString(),
}) {
  assertJob(job);
  if (!matchesStatusUrl(responseUrl, job.documentId) || method !== 'GET' || httpStatus !== 200
    || body?.code !== '-1' || body?.status !== '200' || templateId !== TEMPLATE_ID
    || selectedDocumentId !== job.documentId) fail('response_unverified');
  const state = body?.result?.status;
  if (state?.document_title !== job.documentName || !Array.isArray(state.steps) || state.steps.length !== 3
    || !Array.isArray(state.current_infos) || state.current_infos.length !== 1) fail('schema_unverified');
  const [created, participant, final] = state.steps;
  const current = state.current_infos[0];
  if (created?.seq !== 1 || created.action !== 'doc_create'
    || participant?.seq !== 2 || participant.action !== 'doc_request_participant' || participant.execute_date !== -1
    || final?.seq !== 3 || final.action !== '' || final.execute_date !== -1
    || current?.step_seq !== 2 || current.current_writer !== null || current.waitingExternalApproval !== false
    || !object(final.owner) || !emptyOwners(final.owner.members)
    || !emptyOwners(final.owner.groups) || !emptyOwners(final.owner.external_creators)) fail('schema_unverified');
  const owner = participant.owner;
  if (!Array.isArray(owner?.members) || owner.members.length !== 1 || typeof owner.members[0] !== 'string'
    || !emptyOwners(owner.groups) || !emptyOwners(owner.external_creators)) fail('recipient_unverified');
  const recipient = owner.members[0].match(/^([^\r\n()]+?)\s*\((\+8210\d{8})\)$/);
  if (!recipient || name(recipient[1]) !== name(job.memberName) || phone(recipient[2]) !== phone(job.memberPhone)) {
    fail('recipient_unverified');
  }
  const observed = instant(observedAt), sent = instant(job.sentAt), now = Date.now();
  const createdAt = created.execute_date, expires = current.expired_date;
  if (typeof observedAt !== 'string' || !Number.isFinite(observed) || observed > now || now - observed > 60_000
    || !Number.isFinite(sent) || sent <= 0 || sent > observed
    || !Number.isSafeInteger(createdAt) || createdAt <= 0 || createdAt > sent || createdAt > observed
    || !Number.isSafeInteger(expires) || expires <= observed || expires <= now
    || !Number.isFinite(new Date(expires).getTime())) fail('date_unverified');
  return {
    source: 'eformsign_document_status', verified: true,
    documentId: job.documentId, templateId, documentName: job.documentName, status: 'waiting',
    recipientName: name(recipient[1]), recipientPhone: phone(recipient[2]), recipientCount: 1,
    checkedAt: observedAt, expiresAt: new Date(expires).toISOString(),
  };
}

async function assertSession(page) {
  const url = new URL(page.url());
  const expected = new URL(PROGRESS_URL);
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  if (url.origin !== UI_ORIGIN || url.pathname !== expected.pathname || url.search !== expected.search
    || url.hash || url.username || url.password
    || !/(?:^|[^\w.+-])archivepilates@gmail\.com(?![\w.-])/i.test(text)
    || !/(Documents|문서)/i.test(text) || !/(In progress|진행 중)/i.test(text)
    || /login|sign\s*in|log\s*in|captcha|security verification|verify you are human|로그인|보안 확인|자동입력 방지|비정상적인 접근/i.test(text)) {
    fail('session_unverified');
  }
}

export async function readPendingInstructorSignupEvidence(page, job) {
  let observeRequest, observeResponse, stage = 'source', exactRequests = 0, exactResponses = 0;
  try {
    assertJob(job);
    let captured;
    const requests = new WeakSet();
    const observed = new WeakMap();
    const matches = response => requests.has(response.request())
      && response.request().method() === 'GET' && matchesStatusUrl(response.url(), job.documentId);
    // Capture before navigation: the list can auto-select a row before search/row-click waits.
    // Only requests started in this invocation qualify, not late responses from an earlier read.
    observeRequest = request => {
      if (request.method() === 'GET' && matchesStatusUrl(request.url(), job.documentId)) { requests.add(request); exactRequests++; }
    };
    observeResponse = response => {
      if (matches(response)) {
        exactResponses++;
        captured = response;
        observed.set(response, new Date().toISOString());
      }
    };
    page.on('request', observeRequest);
    page.on('response', observeResponse);
    stage = 'navigation';
    await page.goto(PROGRESS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    stage = 'session';
    await page.waitForFunction(() => {
      const text = document.body?.innerText?.replace(/\s+/g, ' ') || '';
      return /(?:^|[^\w.+-])archivepilates@gmail\.com(?![\w.-])/i.test(text)
        && /(Documents|문서)/i.test(text) && /(In progress|진행 중)/i.test(text);
    }, undefined, { timeout: 20_000 });
    await assertSession(page);
    const search = page.locator('#simpleSearchKey');
    stage = 'search';
    await search.waitFor({ state: 'visible', timeout: 15_000 });
    stage = 'search_submit';
    await search.fill(job.memberName);
    await page.locator('#simpleSearchButton').click();
    const row = page.locator('#RWDtable tr[id]').filter({ hasText: job.documentName });
    stage = 'row';
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    if (await row.count() !== 1 || await row.getAttribute('id') !== job.documentId) fail('row_unverified');
    const link = row.locator('a[href*="view_service.html"]');
    if (await link.count() !== 1) fail('row_unverified');
    const href = await link.getAttribute('href');
    if (!href) fail('row_unverified');
    const url = new URL(href, UI_ORIGIN);
    if (url.origin !== UI_ORIGIN || url.pathname !== '/eform/document/view_service.html'
      || url.username || url.password || url.hash
      || url.searchParams.getAll('document_id').length !== 1 || url.searchParams.get('document_id') !== job.documentId
      || url.searchParams.getAll('form_id').length !== 1 || url.searchParams.get('form_id') !== TEMPLATE_ID) fail('row_unverified');
    await assertSession(page);
    stage = 'status';
    let response = await row.getAttribute('aria-selected') === 'true' ? captured : null;
    stage = 'status_response';
    if (!response) [response] = await Promise.all([
      page.waitForResponse(matches, { timeout: 15_000 }),
      row.getByText(job.documentName, { exact: true }).click(),
    ]);
    stage = 'status_transport';
    if (await response.finished()) fail('response_unverified');
    if (!observed.has(response)) fail('response_unverified');
    stage = 'status_selection';
    await page.waitForFunction(id => {
      const selected = document.querySelectorAll('#RWDtable tr[id][aria-selected="true"]');
      return selected.length === 1 && selected[0].id === id;
    }, job.documentId, { timeout: 10_000 });
    stage = 'status_json';
    const body = await response.json();
    stage = 'parse';
    await assertSession(page);
    const selected = page.locator('#RWDtable tr[id][aria-selected="true"]');
    if (await selected.count() !== 1) fail('row_unverified');
    return parsePendingInstructorSignupStatus({
      responseUrl: response.url(), method: response.request().method(), httpStatus: response.status(), body,
      selectedDocumentId: await selected.getAttribute('id'), templateId: url.searchParams.get('form_id'), job,
      observedAt: observed.get(response),
    });
  } catch (error) {
    if (safeCodes.has(error?.code) && error.message === error.code) throw error;
    const sanitized = new Error('instructor_signature_reminder_read_failed');
    sanitized.code = sanitized.message;
    sanitized.stage = stage;
    sanitized.observation = { exactRequests, exactResponses };
    throw sanitized;
  } finally {
    if (observeRequest) page.off('request', observeRequest);
    if (observeResponse) page.off('response', observeResponse);
  }
}
