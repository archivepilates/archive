import assert from 'node:assert/strict';
import test from 'node:test';
import { assertInstructorTicketRecoveryPaidBinding } from '../lib/instructor-ticket-recovery-evidence.mjs';
import { assessInstructorOrder } from '../lib/imweb-instructor-order-policy.mjs';
import { verifyInstructorPaidOrder } from '../lib/imweb-instructor-order-source.mjs';
import { instructorLessonRegistrationId } from '../lib/instructor-lesson-registration-contract.mjs';

// Synthetic orders only. The verifier regression injects both its order reader and database.
const NOW = new Date('2099-06-01T03:00:00.000Z');
const CODE = 'INSTRUCTOR_TICKET_RECOVERY_PAID_BINDING_MISMATCH';
function fixture() {
  const orderNo = '209906010000001';
  const order = {
    orderNo, ordererName: 'Synthetic Instructor A', ordererCall: '010-0000-0001',
    isGift: 'N', currency: 'KRW', saleChannel: 'IMWEB', orderType: 'SHOPPING', orderStatus: 'OPEN',
    totalPaymentPrice: 70000, totalDeliveryPrice: 0, totalPoint: 0,
    totalRefundPendingPrice: 0, totalRefundedPrice: 0, totalRefundPendingPoint: 0, totalRefundedPoint: 0,
    payments: [{ paymentStatus: 'PAYMENT_COMPLETE', isCancel: 'N', method: 'CARD',
      paidPrice: 70000, paymentCompleteTime: NOW.toISOString() }],
    sections: [{ orderSectionStatus: 'SHIPPING_READY', returnInfo: { isRefund: 'N', isExchange: 'N' },
      sectionItems: [{ orderSectionItemNo: `${orderNo}-1`, qty: 1,
        productInfo: { prodNo: 1, prodName: '[오프라인] ARCHIVE METHOD 강사레슨',
          optionInfo: { 수강일: '2099년 6월 15일' } } }] }],
  };
  const assessment = assessInstructorOrder(order, { now: NOW });
  assert.equal(assessment.status, 'ready');
  const registration = {
    registrationId: assessment.registrationId, studioId: '5330', memberName: assessment.memberName,
    memberPhone: assessment.memberPhone, lessonDate: assessment.lessonDate,
    ticketPrice: assessment.paidAmount, source: { type: 'imweb_paid_order' }, externalOrder: { ...assessment },
  };
  return { order, input: { registration, job: structuredClone(registration), assessment } };
}

function freezeTree(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

function bind(input) {
  const before = structuredClone(input);
  freezeTree(input);
  try { return assertInstructorTicketRecoveryPaidBinding(input); }
  finally { assert.deepStrictEqual(input, before, 'Binding must not mutate any evidence, even on rejection.'); }
}

function rejects(label, mutate) {
  test(`paid recovery binding rejects ${label}`, () => {
    const { input } = fixture();
    mutate(input);
    assert.throws(() => bind(input), { code: CODE });
  });
}

test('binds a real single-order assessment shape without an assessment studioId field', () => {
  const { input } = fixture();
  assert.equal(Object.hasOwn(input.assessment, 'studioId'), false);
  assert.equal(bind(input), true);
});

test('normalizes full phones and whitespace in names across both targets and external snapshots', () => {
  const { input } = fixture();
  input.registration.memberPhone = '+82 10 0000 0001';
  input.job.memberPhone = '010-0000-0001';
  input.registration.externalOrder.memberPhone = '821000000001';
  input.job.externalOrder.memberPhone = '010 0000 0001';
  input.registration.memberName = ' Synthetic   Instructor A ';
  input.job.externalOrder.memberName = 'Synthetic\nInstructor A';
  assert.equal(bind(input), true);
});

test('rejects the reproduced paid-B versus actual-A identity/date mismatch after the old verifier accepts it', async () => {
  const { input, order } = fixture();
  const wrongIdentity = {
    memberName: 'Synthetic Instructor B', memberPhone: '01000000002', lessonDate: '2099-06-16',
    registrationId: instructorLessonRegistrationId('5330', '01000000002', '2099-06-16'),
  };
  Object.assign(input.registration, wrongIdentity);
  Object.assign(input.job, wrongIdentity);
  let reads = 0;
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: () => undefined }) }) }) };
  const paid = await verifyInstructorPaidOrder(db, input.registration, {
    now: NOW, read: async () => { reads++; return order; },
  });
  assert.equal(reads, 1);
  assert.equal(paid.assessment.status, 'ready');
  assert.notEqual(paid.assessment.memberPhone, input.registration.memberPhone);
  assert.notEqual(paid.assessment.lessonDate, input.registration.lessonDate);
  input.assessment = paid.assessment;
  assert.throws(() => bind(input), { code: CODE });
});

const rows = [
  ['registration', input => input.registration], ['job', input => input.job],
  ['registration external order', input => input.registration.externalOrder],
  ['job external order', input => input.job.externalOrder], ['paid assessment', input => input.assessment],
];
for (const [label, row] of rows) {
  for (const [field, value] of Object.entries({ registrationId: 'ilr_wrong', memberName: 'Synthetic Other Instructor',
    memberPhone: '01012340001', lessonDate: '2099-06-16' })) {
    rejects(`${label} ${field} mismatch`, input => { row(input)[field] = value; });
    rejects(`${label} missing ${field}`, input => { delete row(input)[field]; });
  }
  for (const [field, value] of [['memberName', ''], ['memberName', 'x'.repeat(41)],
    ['memberPhone', '0001'], ['memberPhone', ''], ['memberPhone', 1000000001]]) {
    rejects(`${label} invalid ${field} ${JSON.stringify(value)}`, input => { row(input)[field] = value; });
  }
  rejects(`${label} conflicting studio`, input => { row(input).studioId = '5331'; });
}

for (const target of ['registration', 'job']) {
  rejects(`missing ${target} studio`, input => { delete input[target].studioId; });
  rejects(`${target} missing external order`, input => { delete input[target].externalOrder; });
  for (const value of [undefined, 0, 69999, 140000, '70000']) {
    rejects(`${target} ticket amount ${JSON.stringify(value)}`, input => { input[target].ticketPrice = value; });
  }
}
for (const [label, row] of [rows[2], rows[3], rows[4]]) {
  for (const [field, value] of [['orderNo', '209906010000002'], ['itemNo', '209906010000001-2'], ['paidAmount', 140000]]) {
    rejects(`${label} ${field} mismatch`, input => { row(input)[field] = value; });
    rejects(`${label} missing ${field}`, input => { delete row(input)[field]; });
  }
  rejects(`${label} string paid amount`, input => { row(input).paidAmount = '70000'; });
}
for (const value of [undefined, 'review_required', 'ignored', 'paid']) {
  rejects(`assessment status ${JSON.stringify(value)}`, input => { input.assessment.status = value; });
}
for (const value of ['2099-02-30', '2099-6-15', '', null]) {
  rejects(`invalid lesson date ${JSON.stringify(value)} even when all rows agree`, input => {
    for (const [, row] of rows) row(input).lessonDate = value;
  });
}
for (const [field, value] of [['orderNo', ''], ['orderNo', 'not-an-order'], ['itemNo', ''],
  ['itemNo', '209906010000002-1'], ['itemNo', '209906010000001-']]) {
  rejects(`invalid shared ${field} ${JSON.stringify(value)}`, input => {
    input.assessment[field] = input.registration.externalOrder[field] = input.job.externalOrder[field] = value;
  });
}
rejects('matching but noncanonical registration IDs', input => {
  for (const [, row] of rows) row(input).registrationId = 'ilr_000000000000000000000000';
});
rejects('matching but unsupported studio', input => {
  for (const [, row] of rows) row(input).studioId = '5331';
});
rejects('matching but unsupported amount', input => {
  input.registration.ticketPrice = input.job.ticketPrice = 140000;
  input.assessment.paidAmount = input.registration.externalOrder.paidAmount = input.job.externalOrder.paidAmount = 140000;
});
for (const key of ['registration', 'job', 'assessment']) {
  rejects(`missing ${key}`, input => { delete input[key]; });
}
test('missing input fails closed with a non-sensitive error', () => {
  assert.throws(() => assertInstructorTicketRecoveryPaidBinding(), { code: CODE });
  const { input } = fixture();
  input.job.memberName = 'PRIVATE_MEMBER_MARKER';
  assert.throws(() => bind(input), error => error.code === CODE && !error.message.includes('PRIVATE_MEMBER_MARKER'));
});
