import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID, normalizeInstructorLessonName as name, normalizeInstructorLessonPhone as phone, instructorLessonRegistrationId } from './instructor-lesson-registration-contract.mjs';
import { assertSamePaidOrder } from './imweb-instructor-order-policy.mjs';

export const ORDER_CONTACT_POLICY = 'imweb_order_verified_recipient_v1';
const fail = () => { throw new Error('가입서 주문·문서·수신자·회원 연결 확인필요'); };
const memberId = value => String(value?.studiomateMemberId || value?.evidence?.studiomateMemberId || '');
const hasSendTimestamp = value => {
  try { return Boolean(value) && Number.isFinite(new Date(value?.toDate ? value.toDate() : value).getTime()); }
  catch { return false; }
};

export function assertOrderContactBinding(binding, job, submittedPhone, registration) {
  if (!binding || binding.policy !== ORDER_CONTACT_POLICY || binding.version !== 1
    || binding.documentId !== job.documentId || !/^[a-f0-9]{32}$/.test(binding.documentId || '')
    || binding.templateId !== INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID
    || binding.studioId !== '5330' || job.studioId !== binding.studioId
    || !/^[1-9]\d*$/.test(binding.memberId || '') || memberId(job) !== binding.memberId
    || !/^010\d{8}$/.test(binding.canonicalPhone || '') || phone(job.memberPhone) !== binding.canonicalPhone
    || binding.recipientPhone !== binding.canonicalPhone || binding.memberName !== name(job.memberName)
    || binding.submittedPhone !== phone(submittedPhone) || !/^010\d{8}$/.test(binding.submittedPhone || '')
    || !hasSendTimestamp(job.sentAt) || binding.registrationId !== job.registrationId || binding.lessonDate !== job.lessonDate
    || binding.registrationId !== instructorLessonRegistrationId('5330', binding.canonicalPhone, binding.lessonDate)
    || !/^\d{15}$/.test(binding.orderNo || '') || !String(binding.itemNo || '').startsWith(`${binding.orderNo}-`)
    || binding.documentStatus !== 'completed' || binding.recipientCount !== 1
    || !Number.isFinite(Date.parse(binding.verifiedAt || ''))) fail();
  if (registration && (registration.registrationId !== binding.registrationId
    || registration.studioId !== binding.studioId || memberId(registration) !== binding.memberId
    || registration.lessonDate !== binding.lessonDate || phone(registration.memberPhone) !== binding.canonicalPhone
    || name(registration.memberName) !== binding.memberName
    || registration.source?.type !== 'imweb_paid_order' || String(registration.source?.sourceId) !== binding.orderNo
    || registration.externalOrder?.orderNo !== binding.orderNo || registration.externalOrder?.itemNo !== binding.itemNo
    || phone(registration.externalOrder?.memberPhone) !== binding.canonicalPhone
    || name(registration.externalOrder?.memberName) !== binding.memberName
    || registration.externalOrder?.lessonDate !== binding.lessonDate
    || registration.evidence?.eformsignDocumentId !== binding.documentId
    || registration.operatorChecks?.paymentConfirmed !== true || registration.externalOrderReviewRequired
    || ['cancelled', 'canceled', 'rejected'].includes(registration.status))) fail();
  return binding.canonicalPhone;
}

export function buildOrderContactBinding({ job, registration, order, member, document, submittedPhone, now = new Date() }) {
  if (!registration?.externalOrder) fail();
  assertSamePaidOrder(registration, order);
  const canonicalPhone = phone(order.ordererCall);
  if (member?.status !== 'verified' || String(member.member?.memberId) !== memberId(job)
    || phone(member.member?.phone) !== canonicalPhone || name(member.member?.name) !== name(job.memberName)
    || document?.documentId !== job.documentId || document?.selectedDocumentId !== job.documentId
    || document?.templateId !== INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID
    || document?.status !== 'completed' || document?.recipients?.length !== 1
    || !Number.isFinite(Date.parse(document.observedAt || ''))
    || now.getTime() - Date.parse(document.observedAt) > 5 * 60000 || Date.parse(document.observedAt) > now.getTime() + 60000
    || phone(document.recipients[0]?.phone) !== canonicalPhone
    || name(document.recipients[0]?.name) !== name(job.memberName)) fail();
  const binding = {
    version: 1, policy: ORDER_CONTACT_POLICY, studioId: job.studioId, registrationId: job.registrationId,
    memberId: memberId(job), memberName: name(job.memberName), lessonDate: job.lessonDate,
    orderNo: String(order.orderNo), itemNo: registration.externalOrder.itemNo,
    documentId: job.documentId, templateId: document.templateId, documentStatus: document.status,
    recipientCount: 1, recipientPhone: canonicalPhone, canonicalPhone, submittedPhone: phone(submittedPhone),
    verifiedAt: now.toISOString(),
  };
  assertOrderContactBinding(binding, job, submittedPhone, registration);
  return binding;
}

const EFORMSIGN_STATUS_ORIGIN = 'https://kr-service.eformsign.com';
const EFORMSIGN_COMPANY_ID = '848f6dc7fa024a6cb28a2994c0835e53';
const statusPath = documentId => `/v1.0/companies/${EFORMSIGN_COMPANY_ID}/documents/${documentId}/status`;
const noRecipients = value => value == null || (Array.isArray(value) && value.length === 0);

export function parseCompletedRecipientStatus({ responseUrl, method, httpStatus, body, selectedDocumentId, templateId, job, observedAt = new Date().toISOString() }) {
  const url = new URL(responseUrl);
  const state = body?.result?.status;
  if (url.origin !== EFORMSIGN_STATUS_ORIGIN || url.pathname !== statusPath(job.documentId)
    || method !== 'GET' || httpStatus !== 200 || String(body?.code) !== '-1' || String(body?.status) !== '200'
    || templateId !== INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID || selectedDocumentId !== job.documentId
    || state?.document_title !== job.documentName || !Array.isArray(state?.steps) || state.steps.length !== 3
    || !Array.isArray(state?.current_infos) || state.current_infos.length !== 1) fail();
  const [start, participant, complete] = state.steps, current = state.current_infos[0];
  if (start.action !== 'doc_create' || participant.action !== 'doc_accept_participant' || complete.action !== 'doc_complete'
    || Number(start.seq) !== 1 || Number(participant.seq) !== 2
    || Number(current.step_seq) !== Number(complete.seq) || Number(complete.seq) !== 3
    || current.current_writer !== null || current.waitingExternalApproval !== false
    || !Number.isFinite(Number(participant.execute_date)) || Number(participant.execute_date) <= 0
    || !Number.isFinite(Number(complete.execute_date)) || Number(complete.execute_date) <= 0
    || !Array.isArray(participant.owner?.members) || participant.owner.members.length !== 1
    || !noRecipients(participant.owner.groups) || !noRecipients(participant.owner.external_creators)) fail();
  const recipient = String(participant.owner.members[0]).match(/^(.+?)\s*\((\+?[\d\s-]+)\)$/);
  if (!recipient || !/^010\d{8}$/.test(phone(recipient[2]))) fail();
  return { documentId: job.documentId, selectedDocumentId, templateId, status: 'completed',
    recipients: [{ name: name(recipient[1]), phone: phone(recipient[2]) }], observedAt };
}

export async function readCompletedRecipientEvidence(page, job) {
  const { EFORMSIGN_COMPLETED_DOCUMENTS_URL } = await import('./instructor-lesson-registration-contract.mjs');
  await page.goto(EFORMSIGN_COMPLETED_DOCUMENTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const row = page.locator('#RWDtable tr').filter({ hasText: job.documentName });
  await row.waitFor({ state: 'visible', timeout: 15000 });
  if (await row.count() !== 1 || await row.getAttribute('id') !== job.documentId) fail();
  const href = await row.locator('a[href*="view_service.html"]').getAttribute('href');
  const url = new URL(href || '', 'https://www.eformsign.com');
  if (url.origin !== 'https://www.eformsign.com' || url.searchParams.get('document_id') !== job.documentId
    || url.searchParams.get('form_id') !== INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID) fail();
  // The panel can briefly retain another document's data. Bind the response generated by this
  // row click to the exact company/document URL; never read a stale global panel or reuse a token.
  const [response] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.origin === EFORMSIGN_STATUS_ORIGIN
        && url.pathname === statusPath(job.documentId);
    }, { timeout: 15000 }),
    row.click({ position: { x: 15, y: 15 } }),
  ]);
  await response.finished();
  await page.waitForFunction(id => document.querySelector('#RWDtable tr[aria-selected="true"]')?.id === id,
    job.documentId, { timeout: 10000 });
  return parseCompletedRecipientStatus({ responseUrl: response.url(), method: response.request().method(), httpStatus: response.status(),
    body: await response.json(), selectedDocumentId: await page.locator('#RWDtable tr[aria-selected="true"]').getAttribute('id'),
    templateId: url.searchParams.get('form_id'), job });
}

export function canRecheckCompletedSignup(data, { jobId, documentId }) {
  return Boolean(jobId && /^[a-f0-9]{32}$/.test(documentId || '')
    && data?.registrationId === jobId && data?.documentId === documentId && hasSendTimestamp(data?.sentAt)
    && data?.status === 'send_review_required' && !data?.externalEffectStarted
    && String(data?.lastError || '').startsWith('완료 가입서 답변·회원 일치·생년월일 확인필요.'));
}

// Uses the same supported member editor as DOB writes, but never saves it.
export async function readSignupMemberIdentity(page, job) {
  const id = memberId(job);
  if (!/^[1-9]\d*$/.test(id) || job.studioId !== '5330') fail();
  const url = `https://arcpilates.studiomate.kr/users/detail?id=${id}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  const detailUrl = new URL(page.url());
  if (detailUrl.origin !== 'https://arcpilates.studiomate.kr' || !/^\/users\/detail\/?$/.test(detailUrl.pathname)
    || detailUrl.searchParams.get('id') !== id) fail();
  await page.getByRole('heading', { name: job.memberName, exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '회원정보 수정', exact: true }).click();
  const input = placeholder => page.getByRole('textbox').and(page.getByPlaceholder(placeholder, { exact: true })).filter({ visible: true });
  const phoneInput = input('휴대폰 번호'); await phoneInput.waitFor({ state: 'visible' });
  await page.waitForFunction(expected => {
    const e = [...document.querySelectorAll('input[placeholder="휴대폰 번호"]')].find(e => e.getClientRects().length);
    return String(e?.value || '').replace(/\D/g, '') === expected;
  }, phone(job.memberPhone), { timeout: 20000 });
  const actual = { memberId: id, phone: phone(await phoneInput.inputValue()), name: name(await input('이름을 입력해주세요').inputValue()) };
  const actualUrl = new URL(page.url());
  // StudioMate uses /users/create?id=<existing ID> for its edit screen.
  if (actualUrl.origin !== 'https://arcpilates.studiomate.kr' || !/^\/users\/(?:detail|create)\/?$/.test(actualUrl.pathname)
    || actualUrl.searchParams.get('id') !== id || actual.phone !== phone(job.memberPhone) || actual.name !== name(job.memberName)) {
    throw new Error('실제 회원 화면 검증 실패: ' + JSON.stringify({ originMatches: actualUrl.origin === 'https://arcpilates.studiomate.kr',
      path: actualUrl.pathname, idMatches: actualUrl.searchParams.get('id') === id,
      phoneMatches: actual.phone === phone(job.memberPhone), nameMatches: actual.name === name(job.memberName) }));
  }
  return { status: 'verified', member: actual };
}
