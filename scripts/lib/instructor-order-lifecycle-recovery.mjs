import { assertInstructorOrderAttendeeFamily, assertSamePaidOrder,
  validateInstructorOrderAttendeeResolution } from './imweb-instructor-order-policy.mjs';
import { deriveInstructorLessonRegistrationState,
  normalizeInstructorLessonPhone } from './instructor-lesson-registration-contract.mjs';

const HOLD_REASON = '다인 주문 변경·환불·취소 또는 수강자 연결 불일치: 공동 처리 보류';
const RESTORED_REASON = '실제 수강자 공동 승인·개인별 결제 연결 완료';
const REQUIRED_STEPS = ['member', 'ticket', 'eformsign', 'memo', 'confirmation'];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const millis = value => value instanceof Date ? value.getTime()
  : typeof value?.toMillis === 'function' ? value.toMillis()
    : typeof value === 'string' ? Date.parse(value) : NaN;

function sameIds(ids, expected) {
  return Array.isArray(ids) && ids.length === expected.length
    && ids.every(nonempty) && new Set(ids).size === ids.length
    && ids.every(id => expected.includes(id));
}

function indexFamily(rows, ids, label) {
  if (!Array.isArray(rows) || !sameIds(rows.map(row => row?.registrationId), ids)) {
    throw new Error(`${label}: 정확한 공동 등록 전체 필요`);
  }
  return new Map(rows.map(row => [row.registrationId, row]));
}

// Pure patch planning only. The caller owns fresh native evidence, CAS, audit and writes.
export function planInstructorOrderLifecycleRecovery({ order, ledger, registrations,
  jobs, eformJobs, approval, now = new Date() } = {}) {
  const currentTime = millis(now), approvedAt = millis(approval?.approvedAt);
  if (!(now instanceof Date) || !Number.isFinite(currentTime)
    || !nonempty(approval?.actor) || !nonempty(approval?.operationKey)
    || !Number.isFinite(approvedAt) || approvedAt > currentTime
    || currentTime - approvedAt > 48 * 3600000) {
    throw new Error('48시간 이내 정확한 공동 복구 운영자 승인 필요');
  }
  const original = ledger?.attendeeResolution;
  if (!order || ledger?.status !== 'review_required' || ledger.reason !== HOLD_REASON
    || original?.status !== 'blocked' || !nonempty(original.sourceFingerprint)
    || ledger.fingerprint !== original.sourceFingerprint
    || ledger.paymentAmount !== original.totalPaidAmount
    || ledger.orderNo !== original.orderNo || ledger.itemNo !== original.itemNo
    || approval.orderNo !== original.orderNo) {
    throw new Error('알려진 공동 보류 원장·원본 지문·주문 연결 확인필요');
  }
  const resolution = { ...original, status: 'approved' };
  validateInstructorOrderAttendeeResolution(order, resolution, { now });
  const ids = resolution.attendees.map(attendee => attendee.registrationId);
  if (!sameIds(ids, ids) || !sameIds(ledger.registrationIds, ids)
    || !sameIds(approval.registrationIds, ids)) {
    throw new Error('공동 승인·원장 등록 집합 불일치');
  }
  const regs = indexFamily(registrations, ids, '등록');
  const work = indexFamily(jobs, ids, '회원·수강권 작업');
  const forms = indexFamily(eformJobs, ids, '가입서 작업');
  const members = new Set(), documents = new Set();
  const registrationPatches = ids.map(registrationId => {
    const r = regs.get(registrationId), job = work.get(registrationId), form = forms.get(registrationId);
    const evidence = r.evidence || {}, memberId = evidence.studiomateMemberId;
    if (r.mode !== 'new_member' || r.status !== 'action_required' || r.cancellation
      || r.externalOrderReviewRequired !== true || r.operatorChecks?.paymentConfirmed !== false
      || r.operatorChecks?.seatConfirmed !== true || r.lastError !== HOLD_REASON
      || r.source?.type !== 'imweb_paid_order' || r.newMemberSimulation || evidence.newMemberSimulation
      || REQUIRED_STEPS.some(step => r.steps?.[step]?.status !== 'verified')
      || !nonempty(memberId) || !nonempty(evidence.eformsignDocumentId)
      || !nonempty(evidence.confirmationCandidateId) || !nonempty(evidence.confirmationSolapiMessageId)
      || (r.studiomateMemberId != null && r.studiomateMemberId !== memberId)) {
      throw new Error('완료된 신규 회원의 정확한 공동 보류·증거만 복구 가능');
    }
    if (job.jobId !== registrationId || job.status !== 'done' || job.currentStep !== 'complete'
      || job.mode !== 'new_member' || job.cancellation || job.newMemberSimulation
      || job.studiomateMemberId !== memberId || job.studioId !== r.studioId
      || job.memberName !== r.memberName
      || normalizeInstructorLessonPhone(job.memberPhone) !== normalizeInstructorLessonPhone(r.memberPhone)
      || (evidence.ticketId != null && !nonempty(evidence.ticketId))
      || (nonempty(job.ticketId) && nonempty(evidence.ticketId) && evidence.ticketId !== job.ticketId)
      || job.lessonDate !== r.lessonDate) {
      throw new Error('완료 작업의 등록·회원·수강일·기존 주문 연결 불일치');
    }
    assertSamePaidOrder(r, order, { attendeeResolution: resolution, now });
    assertSamePaidOrder(job, order, { attendeeResolution: resolution, now });
    if (form.status !== 'done' || form.cancellation || form.studiomateMemberId !== memberId
      || (form.jobId != null && form.jobId !== registrationId)
      || form.documentId !== evidence.eformsignDocumentId || form.studioId !== r.studioId
      || form.lessonDate !== r.lessonDate || form.memberName !== r.memberName
      || normalizeInstructorLessonPhone(form.memberPhone) !== normalizeInstructorLessonPhone(r.memberPhone)
      || members.has(memberId) || documents.has(form.documentId)) {
      throw new Error('완료 가입서의 등록·문서·회원 연결 불일치');
    }
    members.add(memberId);
    documents.add(form.documentId);
    return { registrationId, patch: {
      externalOrderReviewRequired: false,
      'operatorChecks.paymentConfirmed': true,
      lastError: null,
      ...deriveInstructorLessonRegistrationState(r),
    } };
  });
  const restored = registrationPatches.map(({ registrationId, patch }) => {
    const r = regs.get(registrationId);
    return { ...r, ...patch, operatorChecks: { ...r.operatorChecks, paymentConfirmed: true } };
  });
  assertInstructorOrderAttendeeFamily(resolution, restored);
  return { ledgerPatch: { status: 'queued', 'attendeeResolution.status': 'approved', reason: RESTORED_REASON },
    registrationPatches };
}
