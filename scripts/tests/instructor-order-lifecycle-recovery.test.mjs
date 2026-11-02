import assert from 'node:assert/strict';
import { serialize } from 'node:v8';
import { beforeEach, test } from 'node:test';
import { planInstructorOrderLifecycleRecovery } from '../lib/instructor-order-lifecycle-recovery.mjs';
import { createInstructorOrderAttendeeResolution, orderFingerprint,
  assertInstructorOrderAttendeeFamily } from '../lib/imweb-instructor-order-policy.mjs';
import { deriveInstructorLessonRegistrationState } from '../lib/instructor-lesson-registration-contract.mjs';

// All source, member, document, provider and approval values are synthetic.
const NOW = new Date('2099-06-01T03:00:00.000Z');
const HOLD_REASON = '다인 주문 변경·환불·취소 또는 수강자 연결 불일치: 공동 처리 보류';
const STEPS = ['member', 'ticket', 'eformsign', 'memo', 'confirmation'];
const at = offset => new Date(NOW.getTime() + offset).toISOString();
const clone = value => structuredClone(value);

beforeEach(t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No external actions allowed'));
});

function fixture() {
  const orderNo = '209905310000001';
  const order = {
    orderNo, ordererName: 'Synthetic Buyer', ordererCall: '01000000001',
    isGift: 'N', currency: 'KRW', saleChannel: 'IMWEB', orderType: 'SHOPPING', orderStatus: 'OPEN',
    totalPaymentPrice: 140000, totalDeliveryPrice: 0, totalPoint: 0,
    totalRefundPendingPrice: 0, totalRefundedPrice: 0, totalRefundPendingPoint: 0, totalRefundedPoint: 0,
    payments: [{ paymentStatus: 'PAYMENT_COMPLETE', isCancel: 'N', method: 'CARD', paidPrice: 140000,
      paymentCompleteTime: at(-86400000) }],
    sections: [{ orderSectionStatus: 'SHIPPING_READY', returnInfo: { isRefund: 'N', isExchange: 'N' },
      sectionItems: [{ orderSectionItemNo: `${orderNo}-1`, qty: 2,
        productInfo: { prodNo: 1, prodName: '[오프라인] ARCHIVE METHOD 강사레슨',
          optionInfo: { 수강일: '2099년 6월 15일' } } }] }],
  };
  const resolution = createInstructorOrderAttendeeResolution(order, [
    { memberName: 'Synthetic Buyer', memberPhone: order.ordererCall },
    { memberName: 'Synthetic Attendee', memberPhone: '01000000002' },
  ], { actor: 'synthetic-original-operator', basis: 'synthetic family approval', now: new Date(at(-86400000)) });
  const registrations = resolution.attendees.map((attendee, index) => ({
    ...attendee, studioId: resolution.studioId, lessonDate: resolution.lessonDate,
    mode: 'new_member', status: 'action_required', ticketPrice: attendee.paidAmount,
    source: { type: 'imweb_paid_order', sourceId: orderNo, itemNo: resolution.itemNo },
    externalOrder: { ...attendee, orderNo, itemNo: resolution.itemNo, lessonDate: resolution.lessonDate,
      paidAmount: attendee.paidAmount, totalPaidAmount: resolution.totalPaidAmount,
      attendeeResolutionKey: resolution.resolutionKey, sourcePaymentMethod: 'CARD' },
    operatorChecks: { paymentConfirmed: false, seatConfirmed: true, basis: 'synthetic original checks' },
    externalOrderReviewRequired: true, lastError: HOLD_REASON,
    nextAction: 'synthetic stale action',
    steps: Object.fromEntries([...STEPS.map(step => [step, { status: 'verified', detail: `synthetic ${step}` }]),
      ['bookings', { status: 'not_required', detail: 'synthetic untouched step' }]]),
    evidence: { studiomateMemberId: `90000000${index + 1}`, eformsignDocumentId: `synthetic-document-${index}`,
      confirmationCandidateId: `synthetic-candidate-${index}`, confirmationSolapiMessageId: `synthetic-message-${index}`,
      ...(index ? { ticketId: '900000099' } : {}) },
  }));
  const jobs = registrations.map(r => ({
    jobId: r.registrationId, registrationId: r.registrationId, status: 'done', currentStep: 'complete',
    mode: 'new_member', studiomateMemberId: r.evidence.studiomateMemberId, studioId: r.studioId,
    memberName: r.memberName, memberPhone: r.memberPhone, lessonDate: r.lessonDate,
    externalOrder: clone(r.externalOrder), ticketId: r.evidence.ticketId || '900000098',
    attempts: 2, claimToken: null, externalEffectStarted: false, completedAt: at(-3600000),
    attemptHistory: [{ result: 'synthetic original completion' }],
  }));
  const eformJobs = registrations.map(r => ({
    jobId: r.registrationId, registrationId: r.registrationId, status: 'done',
    documentId: r.evidence.eformsignDocumentId, studiomateMemberId: r.evidence.studiomateMemberId,
    studioId: r.studioId, memberName: r.memberName, memberPhone: r.memberPhone, lessonDate: r.lessonDate,
    claimToken: null, completedAt: at(-3600000), providerMessageId: 'synthetic-native-receipt',
  }));
  const ledger = { orderNo, itemNo: resolution.itemNo, status: 'review_required', reason: HOLD_REASON,
    fingerprint: resolution.sourceFingerprint, attendeeResolution: { ...resolution, status: 'blocked' },
    registrationIds: registrations.map(r => r.registrationId), registrationId: registrations[0].registrationId,
    lastObservedFingerprint: 'synthetic-stale-observation', paymentAmount: resolution.totalPaidAmount };
  const approval = { orderNo, registrationIds: [...ledger.registrationIds], actor: 'synthetic-recovery-operator',
    operationKey: 'synthetic-once-only-operation', approvedAt: at(-1000) };
  // Source progressed after admission; the original fingerprint and resolution key stay unchanged.
  order.orderStatus = 'CLOSED';
  order.sections[0].orderSectionStatus = 'PURCHASE_CONFIRMATION';
  return { order, ledger, registrations, jobs, eformJobs, approval, now: new Date(NOW) };
}

function patch(source, values) {
  const result = clone(source);
  for (const [key, value] of Object.entries(values)) {
    const parts = key.split('.'), last = parts.pop();
    let parent = result;
    for (const part of parts) parent = parent[part];
    parent[last] = clone(value);
  }
  return result;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test('plans only family hold removal, restoring derived completed state with original evidence intact', () => {
  const input = fixture(), before = clone(input);
  const plan = planInstructorOrderLifecycleRecovery(freeze(input));
  assert.deepEqual(input, before);
  assert.deepEqual(Object.keys(plan).sort(), ['ledgerPatch', 'registrationPatches']);
  assert.deepEqual(plan.ledgerPatch, { status: 'queued', 'attendeeResolution.status': 'approved',
    reason: '실제 수강자 공동 승인·개인별 결제 연결 완료' });
  const restoredLedger = patch(input.ledger, plan.ledgerPatch);
  assert.equal(restoredLedger.fingerprint, input.ledger.fingerprint);
  assert.notEqual(orderFingerprint(input.order), restoredLedger.fingerprint);
  assert.equal(restoredLedger.attendeeResolution.resolutionKey, input.ledger.attendeeResolution.resolutionKey);
  const restored = plan.registrationPatches.map(({ registrationId, patch: values }) => {
    const original = input.registrations.find(r => r.registrationId === registrationId);
    assert.deepEqual(values, { externalOrderReviewRequired: false, 'operatorChecks.paymentConfirmed': true,
      lastError: null, ...deriveInstructorLessonRegistrationState(original) });
    const result = patch(original, values);
    assert.equal(result.status, 'completed');
    for (const key of ['steps', 'evidence', 'externalOrder', 'source', 'registrationId', 'memberPhone', 'memberName']) {
      assert.deepEqual(result[key], original[key]);
    }
    return result;
  });
  assert.equal(Object.hasOwn(restored[0].evidence, 'ticketId'), false);
  assert.equal(assertInstructorOrderAttendeeFamily(restoredLedger.attendeeResolution, restored), true);
  assert.deepEqual(input.jobs, before.jobs);
  assert.deepEqual(input.eformJobs, before.eformJobs);
});

test('set order does not matter; exact 48-hour approval boundary is accepted', () => {
  const input = fixture();
  for (const key of ['registrations', 'jobs', 'eformJobs']) input[key].reverse();
  input.ledger.registrationIds.reverse();
  input.approval.registrationIds.reverse();
  input.approval.approvedAt = at(-48 * 3600000);
  assert.equal(planInstructorOrderLifecycleRecovery(input).registrationPatches.length, 2);
});

test('approval Date timestamps and normalized job phones retain all original source fields', () => {
  const input = fixture();
  input.approval.approvedAt = new Date(at(-1000));
  input.jobs[0].memberPhone = input.jobs[0].memberPhone.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
  input.eformJobs[0].memberPhone = '+82 10 0000 ' + input.eformJobs[0].memberPhone.slice(-4);
  const before = clone(input);
  assert.equal(planInstructorOrderLifecycleRecovery(freeze(input)).registrationPatches.length, 2);
  assert.deepEqual(input, before);
});

test('historical blank job ticket ids are preserved; unique native ticket verification belongs to caller', () => {
  const input = fixture();
  for (const job of input.jobs) job.ticketId = '';
  for (const r of input.registrations) r.evidence.newMemberSimulation = false;
  const before = clone(input);
  const plan = planInstructorOrderLifecycleRecovery(freeze(input));
  assert.deepEqual(input, before);
  assert.equal(plan.registrationPatches.length, 2);
  assert.ok(input.jobs.every(job => job.ticketId === ''));
  assert.equal(Object.hasOwn(input.registrations[0].evidence, 'ticketId'), false);
  assert.equal(input.registrations[1].evidence.ticketId, '900000099');
  for (const { registrationId, patch: values } of plan.registrationPatches) {
    const r = input.registrations.find(row => row.registrationId === registrationId);
    assert.deepEqual(patch(r, values).evidence, r.evidence);
    assert.deepEqual(Object.keys(values).sort(), ['externalOrderReviewRequired', 'lastError',
      'nextAction', 'operatorChecks.paymentConfirmed', 'status']);
  }
});

test('independently validates canonical order bindings while preserving differing assessment metadata', () => {
  const input = fixture();
  for (const job of input.jobs) {
    job.externalOrder.status = 'ready';
    job.externalOrder.reason = 'synthetic transient job assessment';
  }
  for (const r of input.registrations) {
    r.externalOrder.status = 'queued';
    r.externalOrder.reason = 'synthetic transient registration assessment';
  }
  const before = clone(input);
  assert.equal(planInstructorOrderLifecycleRecovery(freeze(input)).registrationPatches.length, 2);
  assert.deepEqual(input, before);
});

const negatives = [
  ['missing order', f => { delete f.order; }],
  ['invalid clock', f => { f.now = new Date('invalid'); }],
  ['non-Date clock', f => { f.now = NOW.toISOString(); }],
  ['missing approval', f => { delete f.approval; }],
  ['blank approval actor', f => { f.approval.actor = ' '; }],
  ['missing operation key', f => { delete f.approval.operationKey; }],
  ['blank operation key', f => { f.approval.operationKey = ' '; }],
  ['wrong approved order', f => { f.approval.orderNo = '209905310000002'; }],
  ['invalid approval timestamp', f => { f.approval.approvedAt = 'invalid'; }],
  ['missing approval timestamp', f => { delete f.approval.approvedAt; }],
  ['stale approval', f => { f.approval.approvedAt = at(-48 * 3600000 - 1); }],
  ['future approval', f => { f.approval.approvedAt = at(1); }],
  ['missing ledger', f => { delete f.ledger; }],
  ['wrong ledger state', f => { f.ledger.status = 'queued'; }],
  ['wrong ledger reason', f => { f.ledger.reason += ' other issue'; }],
  ['missing ledger reason', f => { delete f.ledger.reason; }],
  ['wrong ledger order', f => { f.ledger.orderNo = '209905310000002'; }],
  ['wrong ledger item', f => { f.ledger.itemNo += '-other'; }],
  ['wrong ledger payment amount', f => { f.ledger.paymentAmount = 70000; }],
  ['missing ledger payment amount', f => { delete f.ledger.paymentAmount; }],
  ['string ledger payment amount', f => { f.ledger.paymentAmount = String(f.ledger.paymentAmount); }],
  ['wrong resolution state', f => { f.ledger.attendeeResolution.status = 'approved'; }],
  ['missing resolution', f => { delete f.ledger.attendeeResolution; }],
  ['mismatched raw fingerprint', f => { f.ledger.fingerprint = orderFingerprint(f.order); }],
  ['wrong raw field sourceFingerprint is not fingerprint', f => {
    f.ledger.sourceFingerprint = f.ledger.fingerprint; delete f.ledger.fingerprint;
  }],
  ['tampered resolution fingerprint', f => { f.ledger.attendeeResolution.sourceFingerprint = 'tampered'; }],
  ['tampered resolution key', f => { f.ledger.attendeeResolution.resolutionKey = 'tampered'; }],
  ['changed raw buyer', f => { f.order.ordererName = 'Changed Buyer'; }],
  ['changed raw payment', f => { f.order.totalPaymentPrice = 139999; }],
  ['raw refund', f => { f.order.totalRefundedPrice = 70000; }],
  ['raw cancellation', f => { f.order.orderStatus = 'CANCELED'; }],
  ['raw return', f => { f.order.sections[0].returnInfo.isRefund = 'Y'; }],
  ['source lifecycle rollback', f => {
    const original = clone(f.order);
    original.orderStatus = 'CLOSED'; original.sections[0].orderSectionStatus = 'PURCHASE_CONFIRMATION';
    const resolution = createInstructorOrderAttendeeResolution(original, f.ledger.attendeeResolution.attendees,
      { actor: 'synthetic', basis: 'synthetic', now: NOW });
    f.ledger.attendeeResolution = { ...resolution, status: 'blocked' };
    f.ledger.fingerprint = resolution.sourceFingerprint;
    f.order.orderStatus = 'OPEN'; f.order.sections[0].orderSectionStatus = 'SHIPPING_READY';
  }],
  ['wrong mode', f => { f.registrations[0].mode = 'returning_member'; }],
  ['not held registration', f => { f.registrations[0].status = 'completed'; }],
  ['unknown registration error', f => { f.registrations[0].lastError = 'another failure'; }],
  ['not review required', f => { f.registrations[0].externalOrderReviewRequired = false; }],
  ['payment not explicitly false', f => { delete f.registrations[0].operatorChecks.paymentConfirmed; }],
  ['payment already true', f => { f.registrations[0].operatorChecks.paymentConfirmed = true; }],
  ['seat unconfirmed', f => { f.registrations[0].operatorChecks.seatConfirmed = false; }],
  ['registration cancellation', f => { f.registrations[0].cancellation = { jobId: 'synthetic-cancel' }; }],
  ['wrong source type', f => { f.registrations[0].source.type = 'mirror'; }],
  ['wrong canonical order', f => { f.registrations[0].source.sourceId = 'other-order'; }],
  ['wrong registration studio', f => { f.registrations[0].studioId = 'other-studio'; }],
  ['wrong allocation key on reg and job', f => {
    f.registrations[0].externalOrder.attendeeResolutionKey = 'tampered';
    f.jobs[0].externalOrder = clone(f.registrations[0].externalOrder);
  }],
  ['wrong individual price on reg and job', f => {
    f.registrations[0].externalOrder.paidAmount = 140000;
    f.jobs[0].externalOrder = clone(f.registrations[0].externalOrder);
  }],
  ['wrong registration ticket price', f => { f.registrations[0].ticketPrice = 140000; }],
  ['simulation registration', f => { f.registrations[0].newMemberSimulation = true; }],
  ['simulation evidence', f => { f.registrations[0].evidence.newMemberSimulation = true; }],
  ['wrong top-level member pointer', f => { f.registrations[0].studiomateMemberId = 'other-member'; }],
  ['incomplete job', f => { f.jobs[0].status = 'pending'; }],
  ['incomplete current step', f => { f.jobs[0].currentStep = 'ticket'; }],
  ['wrong job id', f => { f.jobs[0].jobId = 'other-job'; }],
  ['wrong job mode', f => { f.jobs[0].mode = 'returning_member'; }],
  ['wrong job member id', f => { f.jobs[0].studiomateMemberId = 'other-member'; }],
  ['wrong job member name', f => { f.jobs[0].memberName = 'Other Member'; }],
  ['wrong job phone', f => { f.jobs[0].memberPhone = '01000000003'; }],
  ['wrong job date', f => { f.jobs[0].lessonDate = '2099-06-16'; }],
  ['wrong job studio', f => { f.jobs[0].studioId = 'other-studio'; }],
  ['job cancellation', f => { f.jobs[0].cancellation = { jobId: 'synthetic-cancel' }; }],
  ['simulation job', f => { f.jobs[0].newMemberSimulation = true; }],
  ['missing job original source', f => { delete f.jobs[0].externalOrder; }],
  ['conflicting retained ticket id', f => { f.registrations[1].evidence.ticketId = '900000100'; }],
  ['blank retained ticket id', f => { f.registrations[1].evidence.ticketId = ' '; }],
  ['incomplete eform job', f => { f.eformJobs[0].status = 'sent'; }],
  ['wrong eform job id', f => { f.eformJobs[0].jobId = 'other-job'; }],
  ['wrong eform document', f => { f.eformJobs[0].documentId = 'other-document'; }],
  ['wrong eform member', f => { f.eformJobs[0].studiomateMemberId = 'other-member'; }],
  ['wrong eform phone', f => { f.eformJobs[0].memberPhone = '01000000003'; }],
  ['wrong eform name', f => { f.eformJobs[0].memberName = 'Other Member'; }],
  ['wrong eform studio', f => { f.eformJobs[0].studioId = 'other-studio'; }],
  ['wrong eform date', f => { f.eformJobs[0].lessonDate = '2099-06-16'; }],
  ['eform cancellation', f => { f.eformJobs[0].cancellation = { jobId: 'synthetic-cancel' }; }],
  ['reused native member', f => {
    f.registrations[1].evidence.studiomateMemberId = f.registrations[0].evidence.studiomateMemberId;
    f.jobs[1].studiomateMemberId = f.jobs[0].studiomateMemberId;
    f.eformJobs[1].studiomateMemberId = f.eformJobs[0].studiomateMemberId;
  }],
  ['reused eform document', f => {
    f.registrations[1].evidence.eformsignDocumentId = f.registrations[0].evidence.eformsignDocumentId;
    f.eformJobs[1].documentId = f.eformJobs[0].documentId;
  }],
];

for (const collection of ['registrations', 'jobs']) {
  for (const field of ['orderNo', 'itemNo', 'attendeeResolutionKey', 'memberName', 'memberPhone',
    'registrationId', 'lessonDate', 'paidAmount', 'totalPaidAmount']) {
    negatives.push([`${collection} independent externalOrder ${field} mismatch`, f => {
      f[collection][0].externalOrder[field] = 'synthetic-wrong-binding';
    }]);
  }
}

for (const step of STEPS) {
  for (const status of ['pending', 'queued', 'sent', 'not_required', 'failed', 'review_required']) {
    negatives.push([`${step} is ${status}`, f => { f.registrations[1].steps[step].status = status; }]);
  }
  negatives.push([`missing ${step}`, f => { delete f.registrations[1].steps[step]; }]);
}
for (const field of ['studiomateMemberId', 'eformsignDocumentId', 'confirmationCandidateId', 'confirmationSolapiMessageId']) {
  negatives.push([`missing evidence ${field}`, f => { delete f.registrations[1].evidence[field]; }]);
  negatives.push([`blank evidence ${field}`, f => { f.registrations[1].evidence[field] = ' '; }]);
}
for (const [name, get, set] of [
  ['ledger ids', f => f.ledger.registrationIds, (f, value) => { f.ledger.registrationIds = value; }],
  ['approval ids', f => f.approval.registrationIds, (f, value) => { f.approval.registrationIds = value; }],
  ...['registrations', 'jobs', 'eformJobs'].map(name => [name, f => f[name], (f, value) => { f[name] = value; }]),
]) {
  for (const [issue, edit] of [
    ['missing', () => undefined], ['not an array', () => ({})], ['empty', () => []],
    ['partial', rows => rows.slice(0, 1)], ['duplicate', rows => [rows[0], rows[0]]],
    ['extra', rows => [...rows, typeof rows[0] === 'string' ? 'foreign-registration'
      : { ...rows[0], registrationId: 'foreign-registration' }]],
    ['foreign', rows => [rows[0], typeof rows[0] === 'string' ? 'foreign-registration'
      : { ...rows[1], registrationId: 'foreign-registration' }]],
  ]) negatives.push([`${name} ${issue}`, f => set(f, edit(get(f)))]);
}

for (const [name, mutate] of negatives) {
  test(`fails closed without mutation: ${name}`, () => {
    const input = fixture(); mutate(input);
    const before = clone(input);
    assert.throws(() => planInstructorOrderLifecycleRecovery(freeze(input)), Error);
    assert.deepEqual(serialize(input), serialize(before));
  });
}

test('recovery cannot be replayed against already-restored ledger and registrations', () => {
  const input = fixture(), plan = planInstructorOrderLifecycleRecovery(input);
  input.ledger = patch(input.ledger, plan.ledgerPatch);
  input.registrations = plan.registrationPatches.map(({ registrationId, patch: values }) =>
    patch(input.registrations.find(r => r.registrationId === registrationId), values));
  assert.throws(() => planInstructorOrderLifecycleRecovery(input));
});
