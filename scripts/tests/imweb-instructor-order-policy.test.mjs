import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMWEB_LESSON_POLICY,
  assessInstructorOrder,
  assertSamePaidOrder,
  orderFingerprint,
  orderLedgerId,
} from '../lib/imweb-instructor-order-policy.mjs';
import { instructorLessonRegistrationId } from '../lib/instructor-lesson-registration-contract.mjs';

const NOW = '2026-09-27T12:30:00.000Z';
const ORDER_NO = '209901010000001';
const LESSON_DATE = '2026-10-10';
const reasons = {
  product: '오프라인 강사레슨 대상 상품 아님',
  cutoff: '자동화 시작 전 결제',
  quantity: '복수 상품·인원 또는 선물 주문은 실제 수강자 확인필요',
  status: '취소·환불·교환 상태 확인필요',
  payment: '결제 완료 원본 확인필요',
  member: '수강자 이름·휴대폰 확인필요',
  date: '미래 수강일 옵션 확인필요',
  amount: '할인·포인트·금액 변경 주문은 구매조건 확인필요',
};

function fixture(change = () => {}) {
  const order = {
    orderNo: ORDER_NO,
    ordererName: 'Synthetic Learner',
    ordererCall: '010-0000-0001',
    isGift: 'N', currency: 'KRW', saleChannel: 'IMWEB', orderType: 'SHOPPING', orderStatus: 'OPEN',
    totalPaymentPrice: 70000, totalDeliveryPrice: 0, totalPoint: 0,
    totalRefundPendingPrice: 0, totalRefundedPrice: 0,
    totalRefundPendingPoint: 0, totalRefundedPoint: 0,
    payments: [{
      paymentStatus: 'PAYMENT_COMPLETE', isCancel: 'N', method: 'CARD',
      paidPrice: 70000, paymentCompleteTime: '2026-09-27T12:25:00.000Z',
    }],
    sections: [{
      orderSectionStatus: 'SHIPPING_READY', returnInfo: { isRefund: 'N', isExchange: 'N' },
      sectionItems: [{
        orderSectionItemNo: `${ORDER_NO}-1`, qty: 1,
        productInfo: {
          prodNo: 1, prodName: '[오프라인] ARCHIVE METHOD 강사레슨',
          optionInfo: { 수강일: '2026년 10월 10일(토)' },
        },
      }],
    }],
  };
  change(order);
  return order;
}

const item = order => order.sections[0].sectionItems[0];
const assess = (order, now = NOW) => assessInstructorOrder(order, { now: new Date(now) });
function expectReview(order, reason) {
  const result = assess(order);
  assert.equal(result.status, 'review_required');
  assert.equal(result.reason, reason);
}

test('one future offline product 1 paid by CARD for KRW 70000 is ready without mutating the source', () => {
  const order = fixture();
  const before = structuredClone(order);
  const result = assess(order);
  assert.equal(result.status, 'ready');
  assert.equal(result.orderNo, ORDER_NO);
  assert.equal(result.itemNo, `${ORDER_NO}-1`);
  assert.equal(result.productNo, 1);
  assert.equal(result.memberName, 'Synthetic Learner');
  assert.equal(result.memberPhone, '01000000001');
  assert.equal(result.lessonDate, LESSON_DATE);
  assert.equal(result.paidAmount, 70000);
  assert.equal(result.paymentMethod, 'card');
  assert.equal(result.paymentCompleteTime, order.payments[0].paymentCompleteTime);
  assert.equal(result.registrationId, instructorLessonRegistrationId(IMWEB_LESSON_POLICY.studioId, '01000000001', LESSON_DATE));
  assert.deepEqual(order, before);
});

for (const [name, change] of [
  ['unknown product', order => { item(order).productInfo.prodNo = 999; }],
  ['online product with target number', order => { item(order).productInfo.prodName = '[온라인] ARCHIVE METHOD 강사레슨'; }],
  ['unrelated product name', order => { item(order).productInfo.prodName = '[오프라인] Synthetic Other Product'; }],
  ['no sections', order => { order.sections = []; }],
]) {
  test(`${name} is ignored`, () => {
    assert.deepEqual(assess(fixture(change)), { status: 'ignored', reason: reasons.product });
  });
}

test('activation cutoff ignores one millisecond before and accepts the exact cutoff', () => {
  const cutoff = Date.parse(IMWEB_LESSON_POLICY.activatedAt);
  assert.deepEqual(assess(fixture(order => {
    order.payments[0].paymentCompleteTime = new Date(cutoff - 1).toISOString();
  })), { status: 'ignored', reason: reasons.cutoff });
  assert.equal(assess(fixture(order => {
    order.payments[0].paymentCompleteTime = new Date(cutoff).toISOString();
  })).status, 'ready');
  assert.equal(assess(fixture(order => {
    order.payments[0].paymentCompleteTime = '2026-09-27T21:22:00+09:00';
  })).status, 'ready');
});

for (const [name, change, reason] of [
  ['canceled order', order => { order.orderStatus = 'CANCEL'; }, reasons.status],
  ['canceled payment', order => { order.payments[0].isCancel = 'Y'; }, reasons.payment],
  ['pending payment', order => { order.payments[0].paymentStatus = 'PAYMENT_PENDING'; }, reasons.payment],
  ['missing payment', order => { order.payments = []; }, reasons.payment],
  ['multiple payments', order => { order.payments.push(structuredClone(order.payments[0])); }, reasons.payment],
  ['invalid payment timestamp', order => { order.payments[0].paymentCompleteTime = 'invalid'; }, reasons.payment],
  ['pending section', order => { order.sections[0].orderSectionStatus = 'PAYMENT_PENDING'; }, reasons.status],
  ['canceled section', order => { order.sections[0].orderSectionStatus = 'CANCEL_COMPLETE'; }, reasons.status],
  ['refund flag', order => { order.sections[0].returnInfo.isRefund = 'Y'; }, reasons.status],
  ['exchange flag', order => { order.sections[0].returnInfo.isExchange = 'Y'; }, reasons.status],
  ...['totalRefundPendingPrice', 'totalRefundedPrice', 'totalRefundPendingPoint', 'totalRefundedPoint']
    .map(field => [field, order => { order[field] = 1; }, reasons.status]),
]) {
  test(`${name} requires review`, () => expectReview(fixture(change), reason));
}

test('completed delivery and purchase confirmation remain eligible', () => {
  for (const status of ['SHIPPING_COMPLETE', 'PURCHASE_CONFIRMATION']) {
    assert.equal(assess(fixture(order => {
      order.orderStatus = 'CLOSED';
      order.sections[0].orderSectionStatus = status;
    })).status, 'ready');
  }
});

for (const phone of [undefined, '', '0000', '0101234567', '0212345678']) {
  test(`invalid phone ${String(phone)} requires review`, () => {
    expectReview(fixture(order => { order.ordererCall = phone; }), reasons.member);
  });
}
test('blank learner name requires review', () => {
  expectReview(fixture(order => { order.ordererName = '   '; }), reasons.member);
});

for (const date of ['', '2026-10-10', '2027년 2월 30일', '2027년 2월 29일', '2026년 13월 1일', '2026년 10월 0일', '2026년 9월 26일', '2026년 9월 27일']) {
  test(`invalid or nonfuture lesson date ${JSON.stringify(date)} requires review`, () => {
    expectReview(fixture(order => { item(order).productInfo.optionInfo.수강일 = date; }), reasons.date);
  });
}
test('real leap date and single-digit date components normalize correctly', () => {
  const result = assess(fixture(order => { item(order).productInfo.optionInfo.수강일 = '2028년 2월 29일'; }));
  assert.equal(result.status, 'ready');
  assert.equal(result.lessonDate, '2028-02-29');
});
test('future-date cutoff follows KST midnight rather than UTC midnight', () => {
  assert.equal(assess(fixture(), '2026-10-09T14:59:59.999Z').status, 'ready');
  const midnight = assess(fixture(), '2026-10-09T15:00:00.000Z');
  assert.equal(midnight.status, 'review_required');
  assert.equal(midnight.reason, reasons.date);
});

for (const [name, change] of [
  ['gift', order => { order.isGift = 'Y'; }],
  ['multiple quantity', order => { item(order).qty = 2; }],
  ['zero quantity', order => { item(order).qty = 0; }],
  ['multiple target items', order => { order.sections[0].sectionItems.push(structuredClone(item(order))); }],
  ['additional unrelated item', order => {
    const extra = structuredClone(item(order));
    extra.productInfo.prodNo = 999;
    order.sections[0].sectionItems.push(extra);
  }],
  ['multiple sections', order => { order.sections.push(structuredClone(order.sections[0])); }],
]) {
  test(`${name} requires learner review`, () => expectReview(fixture(change), reasons.quantity));
}

for (const [name, change] of [
  ['discounted payment', order => { order.totalPaymentPrice = order.payments[0].paidPrice = 65000; }],
  ['overpayment', order => { order.totalPaymentPrice = order.payments[0].paidPrice = 75000; }],
  ['receipt amount mismatch', order => { order.payments[0].paidPrice = 69000; }],
  ['points', order => { order.totalPoint = 1000; }],
  ['delivery charge', order => { order.totalDeliveryPrice = 3000; }],
]) {
  test(`${name} requires purchase-condition review`, () => expectReview(fixture(change), reasons.amount));
}
for (const method of ['CARD', 'TOSSPAY', 'KAKAOPAY', 'NAVERPAY', 'BANK', 'VBANK', 'CASH', 'POINT', '']) {
  test(`paid website method ${JSON.stringify(method)} maps to card while preserving source`, () => {
    const order = fixture(order => { order.payments[0].method = method; });
    const before = structuredClone(order);
    const result = assess(order);
    assert.equal(result.status, 'ready');
    assert.equal(result.paymentMethod, 'card');
    assert.equal(result.sourcePaymentMethod, method);
    assert.deepEqual(order, before);
    expectReview(fixture(order => {
      order.payments[0].method = method;
      order.payments[0].paymentStatus = 'PAYMENT_PENDING';
    }), reasons.payment);
    expectReview(fixture(order => {
      order.payments[0].method = method;
      order.payments[0].isCancel = 'Y';
    }), reasons.payment);
  });
}

test('registration and ledger identities remain stable across replay and normalized phone formatting', () => {
  const order = fixture();
  assert.equal(orderLedgerId(order.orderNo), `imweb_${ORDER_NO}`);
  assert.equal(orderFingerprint(order), orderFingerprint(structuredClone(order)));
  assert.equal(assess(order).registrationId, assess(structuredClone(order)).registrationId);
  const formatted = fixture(order => { order.ordererCall = '+82 10-0000-0001'; });
  assert.equal(assess(formatted).registrationId, assess(order).registrationId);
  const otherOrder = fixture(order => {
    order.orderNo = '209901010000002';
    item(order).orderSectionItemNo = `${order.orderNo}-1`;
  });
  assert.notEqual(orderLedgerId(otherOrder.orderNo), orderLedgerId(order.orderNo));
  assert.equal(assess(otherOrder).registrationId, assess(order).registrationId);
  for (const change of [
    order => { order.ordererCall = '010-0000-0002'; },
    order => { item(order).productInfo.optionInfo.수강일 = '2026년 10월 11일'; },
  ]) {
    assert.notEqual(assess(fixture(change)).registrationId, assess(order).registrationId);
    assert.notEqual(orderFingerprint(fixture(change)), orderFingerprint(order));
  }
});

test('assertSamePaidOrder accepts an unchanged ready order and normalized phone formatting', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(NOW) });
  const order = fixture();
  const job = { externalOrder: assess(order) };
  assert.deepEqual(assertSamePaidOrder(job, structuredClone(order)), job.externalOrder);
  assert.equal(assertSamePaidOrder(job, fixture(order => {
    order.ordererCall = '+82 10-0000-0001';
  })).registrationId, job.externalOrder.registrationId);
});

for (const [key, change] of [
  ['orderNo', order => { order.orderNo = '209901010000002'; item(order).orderSectionItemNo = `${order.orderNo}-1`; }],
  ['itemNo', order => { item(order).orderSectionItemNo = `${ORDER_NO}-2`; }],
  ['memberName', order => { order.ordererName = 'Different Synthetic Learner'; }],
  ['memberPhone', order => { order.ordererCall = '010-0000-0002'; }],
  ['lessonDate', order => { item(order).productInfo.optionInfo.수강일 = '2026년 10월 11일'; }],
]) {
  test(`assertSamePaidOrder rejects changed ${key} even when the new order is ready`, t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(NOW) });
    const job = { externalOrder: assess(fixture()) };
    const changed = fixture(change);
    assert.equal(assess(changed).status, 'ready');
    assert.throws(() => assertSamePaidOrder(job, changed), new RegExp(`${key} 확인필요`));
  });
}

test('assertSamePaidOrder rejects a stored paidAmount mismatch and a newly discounted order', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(NOW) });
  const job = { externalOrder: assess(fixture()) };
  assert.throws(() => assertSamePaidOrder({ externalOrder: { ...job.externalOrder, paidAmount: 65000 } }, fixture()), /paidAmount 확인필요/);
  assert.throws(() => assertSamePaidOrder(job, fixture(order => {
    order.totalPaymentPrice = order.payments[0].paidPrice = 65000;
  })), /할인·포인트·금액 변경/);
});

test('assertSamePaidOrder blocks orders that became refunded, canceled, pending or ineligible', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(NOW) });
  const job = { externalOrder: assess(fixture()) };
  for (const change of [
    order => { order.totalRefundedPrice = 70000; },
    order => { order.payments[0].isCancel = 'Y'; },
    order => { order.sections[0].orderSectionStatus = 'PAYMENT_PENDING'; },
    order => { item(order).productInfo.prodNo = 999; },
    order => { order.payments[0].paymentCompleteTime = '2026-09-27T12:21:59.999Z'; },
  ]) {
    assert.throws(() => assertSamePaidOrder(job, fixture(change)), /홈페이지 주문 재검증 중단/);
  }
  t.mock.timers.setTime(new Date('2026-10-09T15:00:00.000Z').getTime());
  assert.throws(() => assertSamePaidOrder(job, fixture()), /미래 수강일 옵션/);
});
