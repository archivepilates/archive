import { assertSamePaidOrder, assertInstructorOrderAttendeeFamily, orderLedgerId } from './imweb-instructor-order-policy.mjs';

export async function verifyInstructorPaidOrder(db, job, { read, now = new Date() } = {}) {
  if (!job.externalOrder) {
    if (job.externalOrderReviewRequired || job.operatorOrderAllocation || job.orderAllocation
      || ['imweb_paid_order', 'imweb_order_review'].includes(job.source?.type)) throw new Error('다인 주문 원본 연결 누락: 처리 중단');
    return null;
  }
  if (job.externalOrderReviewRequired) throw new Error('홈페이지 주문 변경 확인필요: 처리 중단');
  const allocationMarked = job.operatorOrderAllocation || job.orderAllocation
    || Number(job.externalOrder.quantity) > 1 || Number(job.externalOrder.totalPaidAmount) > 70000;
  if (allocationMarked && !job.externalOrder.attendeeResolutionKey) throw new Error('다인 주문 승인키 누락: 단건 처리 금지');
  const readOrder = read || (await import('./imweb-instructor-orders.mjs')).readImwebOrder;
  const order = await readOrder(job.externalOrder.orderNo);
  if (!job.externalOrder.attendeeResolutionKey) {
    const source = (await db.collection('imwebInstructorLessonOrders').doc(orderLedgerId(job.externalOrder.orderNo)).get()).data();
    if (source?.attendeeResolution || source?.registrationIds?.length > 1) throw new Error('다인 주문 승인키 누락: 단건 처리 금지');
  }
  let attendeeResolution;
  if (job.externalOrder.attendeeResolutionKey) {
    attendeeResolution = await db.runTransaction(async tx => {
      const ledger = await tx.get(db.collection('imwebInstructorLessonOrders').doc(orderLedgerId(job.externalOrder.orderNo)));
      const source = ledger.data();
      const attendeeResolution = source?.attendeeResolution;
      if (!attendeeResolution || source.status !== 'queued'
        || source.orderNo !== attendeeResolution.orderNo || source.itemNo !== attendeeResolution.itemNo
        || source.fingerprint !== attendeeResolution.sourceFingerprint || source.paymentAmount !== attendeeResolution.totalPaidAmount
        || !Array.isArray(source.registrationIds) || source.registrationIds.length !== attendeeResolution.attendees?.length
        || new Set(source.registrationIds).size !== source.registrationIds.length
        || source.registrationIds.some(id => !attendeeResolution.attendees.some(a => a.registrationId === id))) {
        throw new Error('다인 주문 공동 승인 원장 확인필요');
      }
      assertSamePaidOrder(job, order, { attendeeResolution, now });
      const registrations = [];
      for (const a of attendeeResolution.attendees || []) {
        const snapshot = await tx.get(db.collection('instructorLessonRegistrations').doc(a.registrationId));
        if (!snapshot.exists) throw new Error('다인 주문 수강자 원장 누락');
        registrations.push(snapshot.data());
      }
      assertInstructorOrderAttendeeFamily(attendeeResolution, registrations);
      return attendeeResolution;
    });
  }
  return { order, assessment: assertSamePaidOrder(job, order, { attendeeResolution, now }), attendeeResolution };
}
