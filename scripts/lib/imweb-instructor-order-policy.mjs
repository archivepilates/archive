import { createHash } from 'node:crypto';
import { instructorLessonRegistrationId, normalizeInstructorLessonPhone } from './instructor-lesson-registration-contract.mjs';

export const IMWEB_LESSON_POLICY = Object.freeze({
  siteCode: 'S20260516852c71a014d08', unitCode: 'u2026051698c99ea234719', studioId: '5330',
  activatedAt: '2026-09-27T12:22:00.000Z', productNos: [1], expectedPrice: 70000,
  intervalMs: 10 * 60 * 1000, capacity: 10,
});
export const orderFingerprint = order => createHash('sha256').update(JSON.stringify(order)).digest('hex');
export const orderLedgerId = orderNo => `imweb_${String(orderNo).replace(/[^0-9]/g, '')}`;

export function assessInstructorOrder(order, { now = new Date(), policy = IMWEB_LESSON_POLICY } = {}) {
  const items = (order.sections || []).flatMap(section => (section.sectionItems || []).map(item => ({ ...item, section })));
  const targets = items.filter(item => policy.productNos.includes(Number(item.productInfo?.prodNo))
    && /^\[오프라인\].*ARCHIVE METHOD.*강사레슨/.test(item.productInfo?.prodName || ''));
  if (!targets.length) return { status: 'ignored', reason: '오프라인 강사레슨 대상 상품 아님' };
  const paid = (order.payments || []).filter(p => p.paymentStatus === 'PAYMENT_COMPLETE' && p.isCancel === 'N');
  const paidAt = Math.max(0, ...paid.map(p => Date.parse(p.paymentCompleteTime) || 0));
  if (paidAt && paidAt < Date.parse(policy.activatedAt)) return { status: 'ignored', reason: '자동화 시작 전 결제' };
  const item = targets[0];
  const dateText = String(item.productInfo?.optionInfo?.['수강일'] || '');
  const match = dateText.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\([월화수목금토일]\))?$/);
  const lessonDate = match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
  const memberPhone = normalizeInstructorLessonPhone(order.ordererCall);
  const memberName = String(order.ordererName || '').trim().slice(0, 40);
  const input = {
    orderNo: String(order.orderNo || ''), itemNo: String(item.orderSectionItemNo || ''),
    productNo: Number(item.productInfo?.prodNo), productName: String(item.productInfo?.prodName || ''),
    memberName, memberPhone, lessonDate, paidAmount: Number(order.totalPaymentPrice),
    paymentMethod: 'card', paymentCompleteTime: paidAt ? new Date(paidAt).toISOString() : null,
    registrationId: /^010\d{8}$/.test(memberPhone) && lessonDate
      ? instructorLessonRegistrationId(policy.studioId, memberPhone, lessonDate) : orderLedgerId(order.orderNo),
  };
  const review = reason => ({ status: 'review_required', reason, ...input });
  if (!/^\d{15}$/.test(input.orderNo) || !input.itemNo.startsWith(`${input.orderNo}-`)) return review('주문 식별자 확인필요');
  if (items.length !== 1 || targets.length !== 1 || item.qty !== 1 || order.isGift !== 'N') return review('복수 상품·인원 또는 선물 주문은 실제 수강자 확인필요');
  if (order.currency !== 'KRW' || order.saleChannel !== 'IMWEB' || order.orderType !== 'SHOPPING') return review('주문 원천·통화 확인필요');
  if (!['OPEN', 'CLOSED'].includes(order.orderStatus)
    || !['SHIPPING_READY', 'SHIPPING_COMPLETE', 'PURCHASE_CONFIRMATION'].includes(item.section.orderSectionStatus)
    || ['totalRefundPendingPrice', 'totalRefundedPrice', 'totalRefundPendingPoint', 'totalRefundedPoint'].some(k => Number(order[k]) !== 0)
    || item.section.returnInfo?.isRefund === 'Y' || item.section.returnInfo?.isExchange === 'Y') return review('취소·환불·교환 상태 확인필요');
  if (paid.length !== 1 || (order.payments || []).length !== 1 || !paidAt) return review('결제 완료 원본 확인필요');
  if (paid[0].method !== 'CARD') return review('홈페이지 결제수단 매핑 확인필요');
  if (!memberName || !/^010\d{8}$/.test(memberPhone)) return review('수강자 이름·휴대폰 확인필요');
  if (!lessonDate || !Number.isFinite(Date.parse(`${lessonDate}T00:00:00Z`))
    || new Date(`${lessonDate}T00:00:00Z`).toISOString().slice(0, 10) !== lessonDate
    || lessonDate <= new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)) return review('미래 수강일 옵션 확인필요');
  if (input.paidAmount !== policy.expectedPrice || Number(paid[0].paidPrice) !== input.paidAmount
    || Number(order.totalDeliveryPrice) !== 0 || Number(order.totalPoint) !== 0) return review('할인·포인트·금액 변경 주문은 구매조건 확인필요');
  return { status: 'ready', reason: '홈페이지 카드 결제·수강일 확인', ...input };
}

export function assertSamePaidOrder(job, order) {
  const current = assessInstructorOrder(order);
  for (const key of ['orderNo', 'itemNo', 'memberName', 'memberPhone', 'lessonDate', 'paidAmount']) {
    if (current.status !== 'ready' || current[key] !== job.externalOrder?.[key]) {
      throw new Error(`홈페이지 주문 재검증 중단: ${current.reason}; ${key} 확인필요`);
    }
  }
  return current;
}
