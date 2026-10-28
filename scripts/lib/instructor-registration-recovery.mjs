import { deriveInstructorLessonRegistrationState, normalizeInstructorLessonPhone, isInstructorMemberGrade } from './instructor-lesson-registration-contract.mjs';
const millis = v => v?.toMillis ? v.toMillis() : v?._seconds ? v._seconds * 1000 : Date.parse(v || '');
const legacyFamilyError = '다인 주문 수강자 중 취소·변경·미확인 건이 있어 공동 처리 중단';

export function isKnownUnsentInstructorEformFailure(message) {
  if (message === legacyFamilyError) return true;
  const prefix = '[eformsign:send_transition] TimeoutError timeoutMs=30000 ';
  if (typeof message !== 'string' || !message.startsWith(prefix)) return false;
  try {
    const state = JSON.parse(message.slice(prefix.length));
    return state.path === '/eform/document/view_service.html' && state.framePresent === true
      && ['Next', '다음'].includes(state.processText);
  } catch { return false; }
}

export function planInstructorRegistrationRecovery({ action, registration: r, job, native, approval, now = new Date() }) {
  if (!approval?.operationKey || approval.action !== action || approval.registrationId !== r?.registrationId
    || !approval.actor || !Number.isFinite(millis(approval.approvedAt))
    || now - millis(approval.approvedAt) > 48 * 3600000 || millis(approval.approvedAt) > now.getTime() + 60000)
    throw new Error('정확한 복구 건·단계의 운영자 승인 필요');
  if (!r || !job || job.registrationId !== r.registrationId || r.cancellation || r.externalOrderReviewRequired
    || r.source?.type !== 'imweb_paid_order' || !r.externalOrder || r.operatorChecks?.paymentConfirmed !== true
    || r.operatorChecks?.seatConfirmed !== true || r.steps?.member?.status !== 'verified'
    || r.status !== 'action_required') throw new Error('복구 원본·취소·결제 상태 확인필요');
  if (!native || !Number.isFinite(millis(native.checkedAt)) || now - millis(native.checkedAt) > 120000
    || millis(native.checkedAt) > now.getTime() + 60000 || native.member?.status !== 'verified'
    || String(native.member.member?.memberId) !== String(r.evidence?.studiomateMemberId)
    || normalizeInstructorLessonPhone(native.member.member?.phone) !== normalizeInstructorLessonPhone(r.memberPhone)
    || !isInstructorMemberGrade(native.member.member?.memberGrade) || native.ticketRead?.status !== 'verified')
    throw new Error('최신 원본 신원·수강권 전체 재조회 증거 필요');
  const matching = native.ticketRead.tickets.filter(t => t.title === '강사레슨 (2T)'
    && t.availabilityStartAt === r.lessonDate && t.expireAt === r.lessonDate && t.usable && t.active
    && !t.cancelled && !t.refunded);
  if (matching.length !== 1) throw new Error('동일 수강일 원본 수강권이 정확히 한 건이 아님');
  const ticket = matching[0];
  if (!/^[1-9]\d*$/.test(ticket.userTicketId) || ticket.memberId !== String(r.evidence.studiomateMemberId)
    || (r.evidence.ticketId && String(r.evidence.ticketId) !== ticket.userTicketId)
    || ticket.studioId !== r.studioId || !ticket.verified || !ticket.complete || !ticket.payment?.verified
    || !ticket.payment.complete || ticket.payment.status !== 'paid' || ticket.payment.refundedAmount !== 0
    || ticket.payment.paidAmount !== r.externalOrder.paidAmount || ticket.payment.totalAmount !== r.ticketPrice)
    throw new Error('수강권 고유번호·신원·개인별 결제액 연결 불일치');
  const steps = { ...r.steps };
  if (job.ticketIssueReceipt) {
    const receipt = job.ticketIssueReceipt;
    if (receipt.ticketId !== ticket.userTicketId || receipt.memberId !== ticket.memberId
      || receipt.lessonDate !== r.lessonDate || receipt.orderNo !== r.externalOrder.orderNo
      || receipt.paidAmount !== r.externalOrder.paidAmount)
      throw new Error('보존된 발급 접수 증거가 원본과 달라 복구 중단');
  }
  if (action === 'bind_existing_ticket') {
    if (job.status !== 'review_required' || job.currentStep !== 'ticket' || job.effectType !== 'ticket_issue'
      || !job.externalEffectStarted || r.mode !== 'returning_member' || job.mode !== 'returning_member'
      || !Number.isFinite(millis(job.effectStartedAt)) || !Number.isFinite(millis(ticket.issuedAt))
      || Math.abs(millis(ticket.issuedAt) - millis(job.effectStartedAt)) > 120000
      || (job.ticketId && String(job.ticketId) !== ticket.userTicketId)
      || (r.evidence.ticketId && String(r.evidence.ticketId) !== ticket.userTicketId))
      throw new Error('해당 발급 요청과 원본 수강권의 한정 연결을 증명하지 못함');
    steps.ticket = { status: 'verified', label: '강사레슨 (2T) 발급', detail: '기존 발급 원본 고유번호·결제·수강일 독립 검증 완료 · 신규 발급 없음' };
    steps.eformsign = { status: 'not_required', label: '강사회원 가입서', detail: '재수강 강사회원은 재발송하지 않음' };
    steps.memo = { status: 'not_required', label: '가입서 완료 메모', detail: '재수강 건' };
    return { jobPatch: { status: 'done', currentStep: 'complete', ticketId: ticket.userTicketId,
      externalEffectStarted: false, effectType: null, effectStartedAt: null, claimToken: null,
      claimedAt: null, claimedBy: null, leaseExpiresAt: null, nextRunAt: null, lastError: null,
      ticketIssueReceipt: { version: 1, status: 'verified_by_operator_readback', ticketId: ticket.userTicketId,
        memberId: ticket.memberId, lessonDate: r.lessonDate, paidAmount: r.externalOrder.paidAmount,
        orderNo: r.externalOrder.orderNo, checkedAt: native.checkedAt } },
      registrationPatch: { ...deriveInstructorLessonRegistrationState({ mode: r.mode, steps }), steps,
        lastError: null, 'evidence.ticketId': ticket.userTicketId,
        'evidence.ticketPaymentAmount': ticket.payment.paidAmount } };
  }
  if (action !== 'retry_unsent_eform' || r.mode !== 'new_member' || r.steps.ticket?.status !== 'verified'
    || r.steps.eformsign?.status !== 'failed' || job.status !== 'failed' || !isKnownUnsentInstructorEformFailure(job.lastError)
    || ['externalEffectStarted', 'effectStartedAt', 'sendStartedAt', 'sendClickedAt', 'sentAt', 'documentId', 'documentUrl',
      'completedAt', 'providerMessageId'].some(k => Boolean(job[k])) || r.evidence.eformsignDocumentId
    || !native.eformAbsence?.complete || native.eformAbsence.account !== 'archivepilates@gmail.com'
    || native.eformAbsence.registrationId !== r.registrationId || native.eformAbsence.memberName !== r.memberName
    || native.eformAbsence.templateId !== 'a5b5ea6b85ec44c8bcb4af1e980e94eb'
    || native.eformAbsence.progressCount !== 0 || native.eformAbsence.completedCount !== 0
    || !Number.isFinite(millis(native.eformAbsence.checkedAt)) || now - millis(native.eformAbsence.checkedAt) > 120000
    || millis(native.eformAbsence.checkedAt) > now.getTime() + 60000
    || r.steps.confirmation?.status !== 'verified' || !native.confirmation?.verified
    || !String(r.evidence.confirmationCandidateId || '').trim() || !String(r.evidence.confirmationSolapiMessageId || '').trim()
    || native.confirmation.candidateId !== r.evidence.confirmationCandidateId
    || native.confirmation.messageId !== r.evidence.confirmationSolapiMessageId)
    throw new Error('가입서 발송·불명 결과 또는 원본 문서 부재를 확인하지 못해 재요청 차단');
  steps.eformsign = { status: 'queued', label: '강사회원 가입서', detail: '미발송·원본 주문 재검증 후 승인된 단일 복구 대기' };
  return { jobPatch: { status: 'pending', maxAttempts: Number(job.attempts || 0) + 1,
    claimToken: null, claimedAt: null, claimedBy: null, nextSourceCheckAt: null, lastError: null },
    registrationPatch: { ...deriveInstructorLessonRegistrationState({ mode: r.mode, steps }), steps, lastError: null,
      'evidence.ticketId': ticket.userTicketId } };
}
