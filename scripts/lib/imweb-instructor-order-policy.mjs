import { createHash } from 'node:crypto';
import { instructorLessonRegistrationId, normalizeInstructorLessonPhone } from './instructor-lesson-registration-contract.mjs';

export const IMWEB_LESSON_POLICY = Object.freeze({
  siteCode: 'S20260516852c71a014d08', unitCode: 'u2026051698c99ea234719', studioId: '5330',
  activatedAt: '2026-09-27T12:22:00.000Z', productNos: [1], expectedPrice: 70000,
  intervalMs: 10 * 60 * 1000, capacity: 10,
});
export const orderFingerprint = order => createHash('sha256').update(JSON.stringify(order)).digest('hex');
export const orderLedgerId = orderNo => `imweb_${String(orderNo).replace(/[^0-9]/g, '')}`;
export const LEGACY_PAYMENT_METHOD_REVIEW = '홈페이지 결제수단 매핑 확인필요';
export const needsPaymentMethodReassessment = reason => reason === LEGACY_PAYMENT_METHOD_REVIEW;

export function assessInstructorOrder(order, { now = new Date(), policy = IMWEB_LESSON_POLICY } = {}) {
  return assessOrderQuantity(order, { now, policy, quantity: 1 });
}

function assessOrderQuantity(order, { now, policy, quantity }) {
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
    sourcePaymentMethod: paid.length === 1 ? String(paid[0].method || '') : null,
    registrationId: /^010\d{8}$/.test(memberPhone) && lessonDate
      ? instructorLessonRegistrationId(policy.studioId, memberPhone, lessonDate) : orderLedgerId(order.orderNo),
  };
  const review = reason => ({ status: 'review_required', reason, ...input });
  if (!/^\d{15}$/.test(input.orderNo) || !input.itemNo.startsWith(`${input.orderNo}-`)) return review('주문 식별자 확인필요');
  if (items.length !== 1 || targets.length !== 1 || item.qty !== quantity || order.isGift !== 'N') return review('복수 상품·인원 또는 선물 주문은 실제 수강자 확인필요');
  if (order.currency !== 'KRW' || order.saleChannel !== 'IMWEB' || order.orderType !== 'SHOPPING') return review('주문 원천·통화 확인필요');
  if (!['OPEN', 'CLOSED'].includes(order.orderStatus)
    || !['SHIPPING_READY', 'SHIPPING_COMPLETE', 'PURCHASE_CONFIRMATION'].includes(item.section.orderSectionStatus)
    || ['totalRefundPendingPrice', 'totalRefundedPrice', 'totalRefundPendingPoint', 'totalRefundedPoint'].some(k => Number(order[k]) !== 0)
    || item.section.returnInfo?.isRefund === 'Y' || item.section.returnInfo?.isExchange === 'Y') return review('취소·환불·교환 상태 확인필요');
  if (paid.length !== 1 || (order.payments || []).length !== 1 || !paidAt) return review('결제 완료 원본 확인필요');
  if (!memberName || !/^010\d{8}$/.test(memberPhone)) return review('수강자 이름·휴대폰 확인필요');
  if (!lessonDate || !Number.isFinite(Date.parse(`${lessonDate}T00:00:00Z`))
    || new Date(`${lessonDate}T00:00:00Z`).toISOString().slice(0, 10) !== lessonDate
    || lessonDate <= new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)) return review('미래 수강일 옵션 확인필요');
  if (input.paidAmount !== policy.expectedPrice * quantity || Number(paid[0].paidPrice) !== input.paidAmount
    || Number(order.totalDeliveryPrice) !== 0 || Number(order.totalPoint) !== 0) return review('할인·포인트·금액 변경 주문은 구매조건 확인필요');
  return { status: 'ready', reason: '홈페이지 결제·수강일 확인 / StudioMate 신용카드 분류', ...input };
}

export function assertSamePaidOrder(job, order, { attendeeResolution, now = new Date() } = {}) {
  if (job.externalOrder?.attendeeResolutionKey) {
    const assessment = validateInstructorOrderAttendeeResolution(order, attendeeResolution, { now });
    const attendee = attendeeResolution.attendees.find(a => a.registrationId === job.registrationId);
    if (!attendee || job.studioId !== attendeeResolution.studioId
      || job.memberName !== attendee.memberName || normalizeInstructorLessonPhone(job.memberPhone) !== attendee.memberPhone
      || job.lessonDate !== attendeeResolution.lessonDate
      || job.externalOrder.attendeeResolutionKey !== attendeeResolution.resolutionKey
      || job.externalOrder.orderNo !== attendeeResolution.orderNo || job.externalOrder.itemNo !== attendeeResolution.itemNo
      || job.externalOrder.memberName !== attendee.memberName || job.externalOrder.memberPhone !== attendee.memberPhone
      || job.externalOrder.registrationId !== attendee.registrationId
      || job.externalOrder.lessonDate !== attendeeResolution.lessonDate
      || job.externalOrder.paidAmount !== attendee.paidAmount
      || job.externalOrder.totalPaidAmount !== attendeeResolution.totalPaidAmount) {
      throw new Error('다인 주문 수강자·개인별 결제 연결 확인필요');
    }
    return { ...assessment, ...attendee, paidAmount: attendee.paidAmount,
      totalPaidAmount: attendeeResolution.totalPaidAmount, attendeeResolutionKey: attendeeResolution.resolutionKey };
  }
  const current = assessInstructorOrder(order, { now });
  for (const key of ['orderNo', 'itemNo', 'memberName', 'memberPhone', 'lessonDate', 'paidAmount']) {
    if (current.status !== 'ready' || current[key] !== job.externalOrder?.[key]) {
      throw new Error(`홈페이지 주문 재검증 중단: ${current.reason}; ${key} 확인필요`);
    }
  }
  return current;
}

export const INSTRUCTOR_ORDER_ATTENDEE_POLICY = 'imweb_instructor_attendees_v1';
const resolutionBinding = value => ({
  policy: value.policy, version: value.version, studioId: value.studioId,
  orderNo: value.orderNo, itemNo: value.itemNo, lessonDate: value.lessonDate,
  sourceFingerprint: value.sourceFingerprint, totalPaidAmount: value.totalPaidAmount,
  attendees: value.attendees,
});

export function createInstructorOrderAttendeeResolution(order, attendees, { actor, basis, now = new Date() } = {}) {
  if (!String(actor || '').trim() || !String(basis || '').trim()) throw new Error('실제 수강자 확인자·승인 근거 필요');
  if (!Array.isArray(attendees) || attendees.length < 2 || attendees.length > IMWEB_LESSON_POLICY.capacity) {
    throw new Error('다인 주문 수강자 수 확인필요');
  }
  const assessment = assessOrderQuantity(order, { now, policy: IMWEB_LESSON_POLICY, quantity: attendees.length });
  if (assessment.status !== 'ready') throw new Error(`다인 주문 원본 확인필요: ${assessment.reason}`);
  const normalized = attendees.map(a => {
    const memberName = String(a.memberName || '').replace(/\s+/g, ' ').trim();
    const memberPhone = normalizeInstructorLessonPhone(a.memberPhone);
    if (!memberName || memberName.length > 40 || !/^010\d{8}$/.test(memberPhone)) throw new Error('실제 수강자 신원 확인필요');
    if (a.paidAmount != null && a.paidAmount !== IMWEB_LESSON_POLICY.expectedPrice) throw new Error('개인별 금액 확인필요');
    return { memberName, memberPhone, paidAmount: IMWEB_LESSON_POLICY.expectedPrice,
      registrationId: instructorLessonRegistrationId(IMWEB_LESSON_POLICY.studioId, memberPhone, assessment.lessonDate) };
  }).sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  if (new Set(normalized.map(a => a.memberPhone)).size !== normalized.length
    || !normalized.some(a => a.memberPhone === assessment.memberPhone && a.memberName === assessment.memberName)) {
    throw new Error('중복 수강자 또는 구매자 연결 확인필요');
  }
  const result = {
    version: 1, policy: INSTRUCTOR_ORDER_ATTENDEE_POLICY, status: 'approved', studioId: IMWEB_LESSON_POLICY.studioId,
    orderNo: assessment.orderNo, itemNo: assessment.itemNo, lessonDate: assessment.lessonDate,
    sourceFingerprint: orderFingerprint(order), totalPaidAmount: assessment.paidAmount,
    attendees: normalized, approval: { actor: String(actor).trim(), basis: String(basis).trim(), approvedAt: now.toISOString() },
  };
  result.resolutionKey = orderFingerprint(resolutionBinding(result));
  return result;
}

export function validateInstructorOrderAttendeeResolution(order, resolution, { now = new Date() } = {}) {
  if (!resolution || resolution.status !== 'approved' || resolution.policy !== INSTRUCTOR_ORDER_ATTENDEE_POLICY
    || resolution.version !== 1 || resolution.studioId !== IMWEB_LESSON_POLICY.studioId
    || resolution.resolutionKey !== orderFingerprint(resolutionBinding(resolution))
    || resolution.sourceFingerprint !== orderFingerprint(order)
    || !Number.isFinite(Date.parse(resolution.approval?.approvedAt || ''))
    || Date.parse(resolution.approval.approvedAt) > now.getTime() + 60000) throw new Error('다인 주문 승인·원본 변경 확인필요');
  const expected = createInstructorOrderAttendeeResolution(order, resolution.attendees,
    { ...resolution.approval, now });
  if (expected.resolutionKey !== resolution.resolutionKey) throw new Error('다인 주문 금액·수강자 배분 확인필요');
  return assessOrderQuantity(order, { now, policy: IMWEB_LESSON_POLICY, quantity: resolution.attendees.length });
}

export function assertInstructorOrderAttendeeFamily(resolution, registrations) {
  if (!resolution || resolution.status !== 'approved' || !Array.isArray(resolution.attendees)
    || resolution.attendees.length !== registrations.length) throw new Error('다인 주문 공동 원장 확인필요');
  for (const attendee of resolution.attendees) {
    const r = registrations.find(r => r.registrationId === attendee.registrationId);
    if (!r || r.studioId !== resolution.studioId || r.memberName !== attendee.memberName
      || normalizeInstructorLessonPhone(r.memberPhone) !== attendee.memberPhone || r.lessonDate !== resolution.lessonDate
      || r.source?.type !== 'imweb_paid_order' || r.source?.sourceId !== resolution.orderNo
      || r.externalOrder?.orderNo !== resolution.orderNo || r.externalOrder?.itemNo !== resolution.itemNo
      || r.externalOrder?.attendeeResolutionKey !== resolution.resolutionKey
      || r.externalOrder?.memberName !== attendee.memberName || r.externalOrder?.memberPhone !== attendee.memberPhone
      || r.externalOrder?.registrationId !== attendee.registrationId || r.externalOrder?.lessonDate !== resolution.lessonDate
      || r.externalOrder?.totalPaidAmount !== resolution.totalPaidAmount
      || r.externalOrder?.paidAmount !== attendee.paidAmount || r.ticketPrice !== attendee.paidAmount
      || r.operatorChecks?.paymentConfirmed !== true || r.operatorChecks?.seatConfirmed !== true
      || r.externalOrderReviewRequired || r.cancellation || ['cancelled', 'canceled', 'rejected', 'action_required', 'review_required', 'failed'].includes(r.status)) {
      throw new Error('다인 주문 수강자 중 취소·변경·미확인 건이 있어 공동 처리 중단');
    }
  }
  return true;
}
