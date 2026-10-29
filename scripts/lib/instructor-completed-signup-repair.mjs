import assert from 'node:assert/strict';
import {
  INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID,
  deriveInstructorLessonRegistrationState,
  isInstructorMemberGrade,
  normalizeInstructorLessonName,
  normalizeInstructorLessonPhone,
} from './instructor-lesson-registration-contract.mjs';

const REGISTRATION_ID = 'ilr_b4c0fd50f082d92a1735f196';
const MEMBER_ID = '4342056';
const MEMBER_NAME = '안소은';
const LESSON_DATE = '2026-11-28';
const DOCUMENT_ID = 'f3a607291be0429c8add02b4ddcbb893';
const DOCUMENT_NAME = '2025-12-30_강사회원가입서__안소은';
const COMPLETED_MINUTE = Math.floor(Date.parse('2025-12-30T15:36:00+09:00') / 60000);
const TEN_MINUTES = 10 * 60 * 1000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const present = value => typeof value === 'string' && value.trim().length > 0;
const nameMatches = value => typeof value === 'string' && normalizeInstructorLessonName(value) === MEMBER_NAME;

function fullPhone(value) {
  assert(typeof value === 'string' && /^[+\d\s().-]+$/.test(value), 'FULL_PHONE_REQUIRED');
  const normalized = normalizeInstructorLessonPhone(value);
  assert(/^010\d{8}$/.test(normalized), 'FULL_PHONE_REQUIRED');
  return normalized;
}

function instant(value) {
  assert(typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'INVALID_PROOF_TIMESTAMP');
  const ms = Date.parse(value);
  assert(Number.isFinite(ms), 'INVALID_PROOF_TIMESTAMP');
  return ms;
}

// Pure plan only. The caller owns CAS, job-absence checks and any eventual transaction.
export function planCompletedInstructorSignupRepair({ registration: r, proof, now = new Date() } = {}) {
  assert(now instanceof Date && Number.isFinite(now.getTime()), 'INVALID_REPAIR_CLOCK');
  assert(record(r) && record(proof), 'REGISTRATION_AND_PROOF_REQUIRED');
  assert(r.registrationId === REGISTRATION_ID && proof.registrationId === REGISTRATION_ID
    && r.studioId === '5330' && r.lessonDate === LESSON_DATE && nameMatches(r.memberName), 'EXACT_REPAIR_SCOPE_REQUIRED');
  assert(r.mode === 'unresolved' && r.steps?.eformsign?.status === 'review_required', 'SIGNUP_REVIEW_STATE_CHANGED');
  assert(r.cancellation == null && !r.cancellationJobId && !r.refund && !r.refunded
    && !['cancelled', 'canceled', 'rejected', 'cancellation_pending', 'cancellation_review', 'refunded', 'refund_pending', 'completed'].includes(r.status), 'CANCELLATION_OR_CLOSED_SOURCE');
  assert(!r.externalOrderReviewRequired && !r.externalEffectStarted && !r.effectStartedAt, 'SOURCE_BUSY_OR_HELD');
  for (const step of ['member', 'ticket', 'confirmation']) assert(r.steps?.[step]?.status === 'verified', 'REQUIRED_STEP_NOT_VERIFIED');
  assert(['pending', 'not_required'].includes(r.steps?.memo?.status), 'MEMO_STATE_CHANGED');
  assert(record(r.evidence) && r.evidence.studiomateMemberId === MEMBER_ID
    && (r.studiomateMemberId == null || r.studiomateMemberId === MEMBER_ID), 'CANONICAL_MEMBER_MISMATCH');
  assert(r.ticketName === '강사레슨 (2T)' && r.ticketPrice === 0 && r.paymentMethod === null
    && r.evidence.ticketPaymentAmount === 0 && /^[1-9]\d*$/.test(r.evidence.ticketId || '')
    && r.evidence.existingTicketAdopted === true, 'EXISTING_FREE_TICKET_REQUIRED');
  assert(r.source?.type === 'studiomate_existing_complimentary_ticket_operator'
    && r.source.sourceId === r.evidence.ticketId && r.operatorChecks?.paymentConfirmed === true
    && r.operatorChecks.seatConfirmed === true && r.operatorChecks.complimentaryConfirmed === true
    && r.operatorChecks.paymentBasis === 'operator_approved_complimentary', 'COMPLIMENTARY_SOURCE_CHANGED');
  assert(present(r.evidence.confirmationCandidateId) && present(r.evidence.confirmationSolapiMessageId), 'CONFIRMATION_BINDING_REQUIRED');
  assert(!r.evidence.eformsignDocumentId && !r.evidence.eformsignJobId && !r.evidence.signupReconciliation, 'EXISTING_SIGNUP_BINDING_REQUIRES_REVIEW');
  // Do not clear an unrelated operational error while resolving only the signup review.
  assert(r.lastError == null || r.lastError === r.steps.eformsign.detail, 'UNRELATED_ERROR_MUST_BE_PRESERVED');

  const phone = fullPhone(r.memberPhone), member = proof.member, signup = proof.completedSignup;
  assert(record(member) && member.memberId === MEMBER_ID && nameMatches(member.name)
    && member.inactive === false && isInstructorMemberGrade(member.memberGrade), 'NATIVE_MEMBER_MISMATCH');
  assert(fullPhone(member.phone) === phone, 'NATIVE_PHONE_MISMATCH');
  assert(record(signup) && signup.documentId === DOCUMENT_ID && signup.documentName === DOCUMENT_NAME
    && signup.templateId === INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID && signup.status === 'completed'
    && signup.recipientCount === 1 && signup.searchTotal === 1 && nameMatches(signup.memberName), 'EXACT_COMPLETED_SIGNUP_REQUIRED');
  assert(fullPhone(signup.memberPhone) === phone, 'SIGNUP_PHONE_MISMATCH');
  assert(typeof signup.historyHash === 'string' && /^[a-f0-9]{64}$/.test(signup.historyHash), 'HISTORY_PROOF_REQUIRED');
  assert(Math.floor(instant(signup.completedAt) / 60000) === COMPLETED_MINUTE, 'COMPLETION_TIME_MISMATCH');
  const nativeAt = instant(proof.nativeCheckedAt), documentAt = instant(signup.checkedAt), proofAt = instant(proof.checkedAt);
  for (const ms of [nativeAt, documentAt, proofAt]) assert(now.getTime() - ms >= 0
    && now.getTime() - ms <= TEN_MINUTES, 'STALE_OR_FUTURE_PROOF');
  assert(nativeAt <= documentAt && documentAt <= proofAt, 'PROOF_CHRONOLOGY_MISMATCH');

  const eformsign = { ...r.steps.eformsign, status: 'verified', label: '강사회원 가입서',
    detail: '기존 완료 가입서·실제 수신자 재확인 · 신규 발송 없음' };
  const memo = { ...r.steps.memo, status: 'not_required', label: '가입서 완료 메모',
    detail: '기존 완료 가입서 재사용 · 신규 가입서·메모 생성 없음' };
  const state = deriveInstructorLessonRegistrationState({ mode: 'returning_member', steps: { ...r.steps, eformsign, memo } });
  return {
    mode: 'returning_member',
    'steps.eformsign': eformsign,
    'steps.memo': memo,
    'evidence.eformsignDocumentId': DOCUMENT_ID,
    'evidence.signupReconciliation': {
      version: 1, source: 'operator_verified_native_completed_signup', registrationId: REGISTRATION_ID,
      memberId: MEMBER_ID, documentId: DOCUMENT_ID, templateId: signup.templateId, documentName: DOCUMENT_NAME,
      completedAt: signup.completedAt, recipientCount: 1, searchTotal: 1, historyHash: signup.historyHash,
      nativeCheckedAt: proof.nativeCheckedAt, documentCheckedAt: signup.checkedAt, proofCheckedAt: proof.checkedAt,
      reconciledAt: now.toISOString(), action: 'reuse_completed_signup_without_new_send', memoAction: 'not_required_no_new_signup',
    },
    lastError: null,
    status: state.status,
    nextAction: state.nextAction,
  };
}
