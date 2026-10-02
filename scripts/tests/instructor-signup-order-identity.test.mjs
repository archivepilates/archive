import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { buildOrderContactBinding, assertOrderContactBinding, canRecheckCompletedSignup, readSignupMemberIdentity, parseCompletedRecipientStatus } from '../lib/instructor-signup-order-identity.mjs';
import { parseSignupProfile, canonicalSignupPhone, assertSignupProfileSource, signupProfileMemo } from '../lib/instructor-signup-profile.mjs';
import { assessInstructorOrder } from '../lib/imweb-instructor-order-policy.mjs';
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE } from '../lib/instructor-lesson-registration-contract.mjs';

const NOW = new Date('2026-10-02T00:00:00Z'), DOC = 'a'.repeat(32), ORDER = '209901010000001';
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: NOW }));
function fixture() {
  const order = {
    orderNo: ORDER, ordererName: 'Synthetic Learner', ordererCall: '01000000001', isGift: 'N',
    currency: 'KRW', saleChannel: 'IMWEB', orderType: 'SHOPPING', orderStatus: 'OPEN',
    totalPaymentPrice: 70000, totalDeliveryPrice: 0, totalPoint: 0, totalRefundPendingPrice: 0,
    totalRefundedPrice: 0, totalRefundPendingPoint: 0, totalRefundedPoint: 0,
    payments: [{ paymentStatus: 'PAYMENT_COMPLETE', isCancel: 'N', method: 'CARD', paidPrice: 70000,
      paymentCompleteTime: '2026-09-27T12:25:00Z' }],
    sections: [{ orderSectionStatus: 'SHIPPING_READY', returnInfo: { isRefund: 'N', isExchange: 'N' },
      sectionItems: [{ orderSectionItemNo: `${ORDER}-1`, qty: 1, productInfo: { prodNo: 1,
        prodName: '[오프라인] ARCHIVE METHOD 강사레슨', optionInfo: { 수강일: '2026년 10월 25일(일)' } } }] }],
  };
  const externalOrder = assessInstructorOrder(order); assert.equal(externalOrder.status, 'ready');
  const job = { registrationId: externalOrder.registrationId, studioId: '5330', studiomateMemberId: '123456',
    memberName: order.ordererName, memberPhone: order.ordererCall, documentId: DOC,
    lessonDate: '2026-10-25', sentAt: '2026-10-01T13:57:00Z', status: 'send_review_required',
    lastError: '완료 가입서 답변·회원 일치·생년월일 확인필요. 원본 확인 후 재처리하세요.' };
  const registration = { ...job, source: { type: 'imweb_paid_order', sourceId: ORDER }, externalOrder,
    evidence: { eformsignDocumentId: DOC }, operatorChecks: { paymentConfirmed: true } };
  const member = { status: 'verified', member: { memberId: '123456', name: job.memberName, phone: job.memberPhone } };
  const document = { documentId: DOC, selectedDocumentId: DOC, templateId: TEMPLATE, status: 'completed',
    recipients: [{ name: job.memberName, phone: '+82 10-0000-0001' }], observedAt: NOW.toISOString() };
  const fields = { memberName: job.memberName, memberPhone: '010-0000-0002', birthDate: '1990/1/2',
    affiliation: ' Synthetic Studio ', career: '', address: '' };
  return { job, registration, order, member, document, submittedPhone: fields.memberPhone, fields };
}
function completedFixture() {
  const f = fixture(), binding = buildOrderContactBinding(f);
  const profile = parseSignupProfile(f.fields, f.job, DOC, NOW, binding);
  const source = { ...f.job, status: 'done', submittedProfile: profile, profileMemoJobId: `instructor_member_profile_${DOC}` };
  const memo = { jobId: source.profileMemoJobId, registrationId: source.registrationId,
    source: 'instructor_member_eformsign', studioId: '5330', memberId: '123456', studiomateMemberId: '123456',
    memberName: source.memberName, memberPhone: source.memberPhone,
    profileUpdate: { version: profile.version, birthDate: profile.birthDate, documentId: DOC }, content: signupProfileMemo(profile) };
  return { ...f, binding, profile, source, memo };
}
function statusFixture() {
  const { job } = fixture(); job.documentName = 'Synthetic signed signup';
  return { job, method: 'GET', httpStatus: 200, selectedDocumentId: DOC, templateId: TEMPLATE,
    responseUrl: `https://kr-service.eformsign.com/v1.0/companies/848f6dc7fa024a6cb28a2994c0835e53/documents/${DOC}/status?mode=ai`,
    body: { code: '-1', status: '200', result: { status: { document_title: job.documentName, parallelizable: true,
      steps: [{ seq: 1, action: 'doc_create' }, { seq: 2, action: 'doc_accept_participant', execute_date: 1790860000000,
        owner: { members: [`${job.memberName}(+821000000001)`], groups: null, external_creators: null } },
      { seq: 3, action: 'doc_complete', execute_date: 1790860000000 }],
      current_infos: [{ step_seq: 3, current_writer: null, waitingExternalApproval: false }],
    } } } };
}
test('recipient evidence uses the exact completed-document response, including parallelizable template', () => {
  const f = statusFixture(), result = parseCompletedRecipientStatus(f);
  assert.deepEqual(result.recipients, [{ name: f.job.memberName, phone: f.job.memberPhone }]);
  assert.equal(result.documentId, DOC); assert.equal(result.status, 'completed');
});
for (const [label, change] of [
  ['stale other-document response', f => { f.responseUrl = f.responseUrl.replace(DOC, 'b'.repeat(32)); }],
  ['different company', f => { f.responseUrl = f.responseUrl.replace('848f6dc7fa024a6cb28a2994c0835e53', 'b'.repeat(32)); }],
  ['different origin', f => { f.responseUrl = f.responseUrl.replace('kr-service.eformsign.com', 'example.invalid'); }],
  ['wrong request method', f => { f.method = 'POST'; }],
  ['failed HTTP response', f => { f.httpStatus = 500; }],
  ['failed provider response', f => { f.body.code = '400'; }],
  ['wrong selected row', f => { f.selectedDocumentId = 'b'.repeat(32); }],
  ['wrong template', f => { f.templateId = 'b'.repeat(32); }],
  ['document title mismatch', f => { f.body.result.status.document_title = 'Other document'; }],
  ['unsigned participant', f => { f.body.result.status.steps[1].execute_date = 0; }],
  ['unsigned completion', f => { f.body.result.status.steps[2].execute_date = 0; }],
  ['wrong completion action', f => { f.body.result.status.steps[2].action = 'doc_reject'; }],
  ['current participant step', f => { f.body.result.status.current_infos[0].step_seq = 2; }],
  ['pending current writer', f => { f.body.result.status.current_infos[0].current_writer = 'writer'; }],
  ['external approval pending', f => { f.body.result.status.current_infos[0].waitingExternalApproval = true; }],
  ['unknown approval state', f => { delete f.body.result.status.current_infos[0].waitingExternalApproval; }],
  ['multiple recipients', f => { f.body.result.status.steps[1].owner.members.push('Other Person(01000000003)'); }],
  ['group recipient', f => { f.body.result.status.steps[1].owner.groups = ['group']; }],
  ['unknown group shape', f => { f.body.result.status.steps[1].owner.groups = { member: 'other' }; }],
  ['unknown external creator shape', f => { f.body.result.status.steps[1].owner.external_creators = { member: 'other' }; }],
  ['unknown member collection shape', f => { f.body.result.status.steps[1].owner.members = { 0: 'Synthetic Learner(01000000001)', length: 1 }; }],
  ['masked recipient', f => { f.body.result.status.steps[1].owner.members[0] = 'Synthetic Learner(010****0001)'; }],
]) test(`recipient response rejects ${label}`, () => { const f = statusFixture(); change(f); assert.throws(() => parseCompletedRecipientStatus(f)); });
test('verified recipient/order/member binding preserves submitted original and uses order contact downstream', () => {
  const f = fixture(), before = structuredClone(f), binding = buildOrderContactBinding(f);
  const p = parseSignupProfile(f.fields, f.job, DOC, NOW, binding);
  assert.equal(p.memberPhone, '01000000002'); assert.equal(p.rawFields.memberPhone, '010-0000-0002');
  assert.equal(p.rawFields.birthDate, '1990/1/2'); assert.equal(p.rawFields.affiliation, ' Synthetic Studio ');
  assert.equal(canonicalSignupPhone(p, f.job, f.registration), '01000000001'); assert.deepEqual(f, before);
  const c = completedFixture(); assert.equal(assertSignupProfileSource(c.memo, c.source, c.registration), c.profile);
});
for (const [label, change] of [
  ['unpaid order', f => { f.order.payments[0].paymentStatus = 'PAYMENT_PENDING'; }],
  ['refunded order', f => { f.order.totalRefundedPrice = 70000; }],
  ['order contact changed', f => { f.order.ordererCall = '01000000003'; }],
  ['wrong order', f => { f.registration.source.sourceId = '209901010000002'; }],
  ['manual registration', f => { f.registration.source.type = 'manual'; }],
  ['registration contact changed', f => { f.registration.memberPhone = '01000000003'; }],
  ['registration member changed', f => { f.registration.studiomateMemberId = '999'; }],
  ['registration source item changed', f => { f.registration.externalOrder.itemNo = `${ORDER}-2`; }],
  ['review required order', f => { f.registration.externalOrderReviewRequired = true; }],
  ['cancelled registration', f => { f.registration.status = 'cancelled'; }],
  ['no prior send', f => { delete f.job.sentAt; }],
  ['invalid prior send timestamp', f => { f.job.sentAt = 'invalid'; }],
  ['native member unverified', f => { f.member.status = 'review'; }],
  ['native ID mismatch', f => { f.member.member.memberId = '999'; }],
  ['native phone mismatch', f => { f.member.member.phone = '01000000003'; }],
  ['native name mismatch', f => { f.member.member.name = 'Other Person'; }],
  ['different document', f => { f.document.documentId = 'b'.repeat(32); }],
  ['different selected row', f => { f.document.selectedDocumentId = 'b'.repeat(32); }],
  ['different template', f => { f.document.templateId = 'b'.repeat(32); }],
  ['unsigned document', f => { f.document.status = 'pending'; }],
  ['recipient absent', f => { f.document.recipients = []; }],
  ['multiple recipients', f => { f.document.recipients.push({ ...f.document.recipients[0] }); }],
  ['recipient phone different', f => { f.document.recipients[0].phone = f.submittedPhone; }],
  ['masked recipient phone', f => { f.document.recipients[0].phone = '010-****-0001'; }],
  ['same name alone', f => { f.document.recipients[0].phone = ''; }],
  ['recipient name different', f => { f.document.recipients[0].name = 'Other Person'; }],
  ['stale document evidence', f => { f.document.observedAt = '2026-10-01T00:00:00Z'; }],
  ['future document evidence', f => { f.document.observedAt = '2026-10-03T00:00:00Z'; }],
]) test(`order-contact binding blocks ${label}`, () => { const f = fixture(); change(f); assert.throws(() => buildOrderContactBinding(f)); });

for (const [label, change] of [
  ['current job phone', f => { f.source.memberPhone = '01000000003'; }],
  ['current job member', f => { f.source.studiomateMemberId = '999'; }],
  ['current registration order', f => { f.registration.source.sourceId = '209901010000002'; }],
  ['current registration document', f => { f.registration.evidence.eformsignDocumentId = 'b'.repeat(32); }],
  ['binding document', f => { f.profile.orderContactBinding.documentId = 'b'.repeat(32); }],
  ['binding canonical phone', f => { f.profile.orderContactBinding.canonicalPhone = '01000000003'; }],
  ['original phone overwritten', f => { f.profile.rawFields.memberPhone = '01000000001'; }],
  ['original DOB changed', f => { f.profile.rawFields.birthDate = '1991-01-02'; }],
  ['original address changed', f => { f.profile.rawFields.address = 'different'; }],
  ['original optional key removed', f => { delete f.profile.rawFields.career; }],
]) test(`memo/source revalidation blocks ${label}`, () => { const f = completedFixture(); change(f); assert.throws(() => assertSignupProfileSource(f.memo, f.source, f.registration)); });

test('mismatched form phone still fails without independent binding', () => {
  const f = fixture(); assert.throws(() => parseSignupProfile(f.fields, f.job, DOC));
});
test('targeted completed-document recovery cannot select sends, another document or already done work', () => {
  const f = fixture(), target = { jobId: f.job.registrationId, documentId: DOC };
  assert.equal(canRecheckCompletedSignup(f.job, target), true);
  for (const status of ['pending', 'retry', 'sending', 'processing', 'waiting_completion', 'done'])
    assert.equal(canRecheckCompletedSignup({ ...f.job, status }, target), false);
  for (const change of [{ documentId: 'b'.repeat(32) }, { registrationId: 'other' }, { sentAt: null }, { externalEffectStarted: true }, { lastError: 'Send unknown' }])
    assert.equal(canRecheckCompletedSignup({ ...f.job, ...change }, target), false);
  assert.equal(canRecheckCompletedSignup(f.job, { ...target, jobId: '' }), false);
});

for (const [label, options, success] of [
  ['existing-member edit route', {}, true],
  ['wrong editor member ID', { id: '999' }, false],
  ['different editor origin', { origin: 'https://example.invalid' }, false],
  ['unrecognized editor route', { route: 'import' }, false],
  ['different member name', { name: 'Other Person' }, false],
  ['different member phone', { phone: '01000000003' }, false],
]) test(`read-only member identity: ${label}`, async () => {
  const { job } = fixture(); let url = '', edits = 0;
  const input = key => ({ filter: () => input(key), waitFor: async () => {},
    inputValue: async () => key === '휴대폰 번호' ? options.phone || job.memberPhone : options.name || job.memberName });
  const page = {
    goto: async value => { url = value; }, url: () => url,
    getByPlaceholder: text => text,
    getByRole: role => role === 'heading' ? { waitFor: async () => {} }
      : role === 'textbox' ? { and: key => input(key) }
        : { click: async () => { edits++; url = `${options.origin || 'https://arcpilates.studiomate.kr'}/users/${options.route || 'create'}?id=${options.id || job.studiomateMemberId}`; } },
    waitForFunction: async (_fn, expected) => { assert.equal(expected, job.memberPhone); if (options.phone) throw new Error('identity wait blocked'); },
  };
  if (success) { const result = await readSignupMemberIdentity(page, job); assert.equal(result.status, 'verified'); assert.equal(result.member.memberId, job.studiomateMemberId); }
  else await assert.rejects(readSignupMemberIdentity(page, job));
  assert.equal(edits, 1); // The mock exposes only opening the editor; no save or fill operation exists.
});
