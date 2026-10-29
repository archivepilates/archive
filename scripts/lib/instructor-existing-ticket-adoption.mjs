import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveInstructorLessonRegistrationState, instructorLessonRegistrationId,
  normalizeInstructorLessonName, normalizeInstructorLessonPhone, isInstructorMemberGrade } from './instructor-lesson-registration-contract.mjs';

const ACTION = 'adopt_existing_paid_returning_ticket_notice';
const recent = (value, now, maxAge) => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) && now - ms >= -60000 && now - ms <= maxAge;
};
const nativeId = v => typeof v === 'string' && /^[1-9]\d{0,63}$/.test(v);

export function planInstructorExistingTicketAdoption({ source: s, approval, now = new Date() }) {
  assert(s && Number.isFinite(now.getTime()));
  const phone = normalizeInstructorLessonPhone(s.phone), name = normalizeInstructorLessonName(s.name);
  assert(/^010\d{8}$/.test(phone) && name);
  assert(['2026-11-28', '2026-11-29'].includes(s.date));
  assert(s.date > new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10));
  const id = instructorLessonRegistrationId('5330', phone, s.date);
  assert.equal(s.registrationId, id);
  assert(approval?.action === ACTION && approval.registrationId === id && approval.actor && approval.operationKey
    && recent(approval.approvedAt, now.getTime(), 48 * 3600000), 'Exact scoped approval required.');
  assert(recent(s.checkedAt, now.getTime(), 120000) && recent(s.providerCheckedAt, now.getTime(), 120000), 'Fresh independent source required.');
  assert.equal(s.ticketName, '강사레슨 (2T)');
  assert(isInstructorMemberGrade(s.grade) && isInstructorMemberGrade(s.member?.memberGrade));
  assert.equal(s.excelPaidAmount, 70000);
  assert(['사용예정', '사용 예정', '사용중', '사용 중'].includes(s.excelStatus));
  assert.equal(s.nativeStatus, 'verified');
  assert.equal(s.ticketReadStatus, 'verified');
  assert(nativeId(s.member?.memberId) && s.member.inactive === false);
  assert.equal(normalizeInstructorLessonName(s.member.name), name);
  assert.equal(normalizeInstructorLessonPhone(s.member.phone), phone);
  assert.equal(s.currentRegistration, null);
  for (const field of ['candidates', 'sends', 'providerRows']) assert(Array.isArray(s[field]) && s[field].length === 0, 'Prior or ambiguous notice is not replayable.');
  assert(Array.isArray(s.priorRegistrations) && s.priorRegistrations.some(r => r.status === 'completed'
    && r.mode === 'returning_member' && r.memberId === s.member.memberId && r.date < s.date
    && r.eformStatus === 'not_required'), 'Returning-member source is required; do not skip new signup.');
  assert(!s.priorRegistrations.some(r => r.mode === 'new_member'
    && (r.status !== 'completed' || r.eformStatus !== 'verified')), 'Unfinished signup requires reconciliation.');
  assert(!s.priorRegistrations.some(r => !['new_member', 'returning_member'].includes(r.mode)), 'Unknown prior member mode requires reconciliation.');
  assert(Array.isArray(s.tickets) && s.tickets.length === 1, 'Exactly one source ticket required.');
  const t = s.tickets[0], p = t.payment;
  assert(nativeId(t.userTicketId) && t.memberId === s.member.memberId && t.studioId === '5330');
  assert(t.verified === true && t.complete === true && t.usable === true && t.active === true
    && t.cancelled === false && t.refunded === false);
  assert(t.title === '강사레슨 (2T)' && t.availabilityStartAt === s.date && t.expireAt === s.date);
  assert(p?.verified === true && p.complete === true && p.status === 'paid' && p.paidAmount === 70000
    && p.totalAmount === 70000 && p.outstandingAmount === 0 && p.refundedAmount === 0);
  assert(Array.isArray(p.transactions) && p.transactions.length > 0
    && p.transactions.every(r => r.status === 'paid' && Number.isSafeInteger(r.amount) && r.amount > 0)
    && p.transactions.reduce((sum, r) => sum + r.amount, 0) === 70000);
  const methods = new Set(p.transactions.map(r => r.method));
  assert.equal(methods.size, 1);
  const paymentMethod = { bank_transfer: 'wiretransfer', card: 'card', cash: 'cash' }[[...methods][0]];
  assert(paymentMethod, 'Unsupported payment method.');
  const step = (status, label, detail) => ({ status, label, detail });
  const steps = {
    member: step('verified', '회원·등급 확인', '현재 원본 신원과 과거 완료된 재수강 원장 일치'),
    ticket: step('verified', '강사레슨 (2T) 발급', '기존 원본 수강권 고유번호·수강일·결제 검증 · 신규 발급 없음'),
    confirmation: step('pending', '예약확정 안내', '누락된 최초 안내만 기존 승인 처리기로 접수'),
    eformsign: step('not_required', '강사회원 가입서', '과거 완료된 재수강 원장으로 기존 강사회원 확인'),
    memo: step('not_required', '가입서 완료 메모', '재수강 건 · 신규 가입서나 메모 생성 없음'),
    bookings: step('not_required', '반배정·예약(수동)', '기존 예약을 보존하며 새 예약을 생성하지 않음'),
  };
  const registration = { registrationId: id, idempotencyKey: id, studioId: '5330', memberName: name, memberPhone: phone,
    phoneLast4: phone.slice(-4), lessonDate: s.date, paymentMethod, ticketPrice: 70000, ticketName: t.title,
    mode: 'returning_member', ...deriveInstructorLessonRegistrationState({ mode: 'returning_member', steps }), steps,
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
    source: { type: 'studiomate_existing_paid_ticket_operator', sourceId: t.userTicketId,
      checkedAt: s.checkedAt, approvalKey: approval.operationKey },
    evidence: { studiomateMemberId: s.member.memberId, ticketId: t.userTicketId, ticketPaymentAmount: 70000,
      existingTicketAdopted: true, priorReturningRegistrationIds: s.priorRegistrations.filter(r => r.status === 'completed'
        && r.mode === 'returning_member' && r.memberId === s.member.memberId).map(r => r.id),
      nativeSourceHash: createHash('sha256').update(JSON.stringify({ member: s.member, ticket: t, checkedAt: s.checkedAt })).digest('hex') },
    createdBy: { staffId: '1979746', name: 'ARCHIVE PILATES OPS', approvalActor: approval.actor }, lastError: null };
  return { registration, createsStudioMateJob: false, issuesTicket: false, createsEformJob: false, manualSend: false };
}

export function planInstructorComplimentaryTicketAdoption({ source: s, approval, now = new Date() }) {
  const allowed = { '4342056': '안소은', '4818049': '정유리' };
  assert(s && Number.isFinite(now.getTime()));
  const memberId = s.member?.memberId, name = normalizeInstructorLessonName(s.name);
  const phone = normalizeInstructorLessonPhone(s.phone);
  assert(allowed[memberId] === name && normalizeInstructorLessonName(s.member.name) === name);
  assert(/^010\d{8}$/.test(phone) && normalizeInstructorLessonPhone(s.member.phone) === phone);
  assert(s.date === '2026-11-28' && s.date > new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10));
  const id = instructorLessonRegistrationId('5330', phone, s.date);
  assert(s.registrationId === id && approval?.registrationId === id && approval.action === 'adopt_existing_complimentary_ticket_notice'
    && approval.actor && approval.operationKey && approval.complimentaryConfirmed === true
    && approval.expectedAmount === 0 && approval.memberId === memberId
    && recent(approval.approvedAt, now.getTime(), 48 * 3600000));
  assert(recent(s.checkedAt, now.getTime(), 120000) && recent(s.providerCheckedAt, now.getTime(), 120000));
  assert(s.nativeStatus === 'verified' && s.ticketReadStatus === 'verified' && s.member.inactive === false);
  assert(s.ticketName === '강사레슨 (2T)' && s.excelPaidAmount === 0 && ['사용예정', '사용 예정'].includes(s.excelStatus));
  assert(memberId === '4818049' ? s.member.memberGrade === '스텝' && s.grade === '스텝'
    : isInstructorMemberGrade(s.member.memberGrade) && isInstructorMemberGrade(s.grade));
  assert.equal(s.currentRegistration, null);
  for (const field of ['candidates', 'sends', 'providerRows']) assert(Array.isArray(s[field]) && s[field].length === 0);
  assert(Array.isArray(s.tickets) && s.tickets.length === 1 && Array.isArray(s.priorRegistrations));
  const t = s.tickets[0], p = t.payment;
  assert(nativeId(t.userTicketId) && t.memberId === memberId && t.studioId === '5330' && t.verified === true && t.complete === true
    && t.active === true && t.usable === true && t.cancelled === false && t.refunded === false
    && t.title === s.ticketName && t.availabilityStartAt === s.date && t.expireAt === s.date);
  // A zero-price approval is not a paid receipt; preserve the native review classification.
  assert(p?.status === 'review' && p.reason === 'invalid_payment_total' && p.totalAmount === 0 && p.paidAmount === 0
    && p.outstandingAmount === 0 && p.refundedAmount === 0 && Array.isArray(p.transactions) && p.transactions.length === 0);
  const returning = s.priorRegistrations.some(r => r.status === 'completed' && r.mode === 'returning_member'
    && r.memberId === memberId && r.eformStatus === 'not_required');
  const conflict = s.priorRegistrations.some(r => !['returning_member', 'new_member'].includes(r.mode)
    || r.mode === 'new_member' && (r.status !== 'completed' || r.eformStatus !== 'verified'));
  assert(!conflict, 'Prior signup ambiguity requires reconciliation.');
  const mode = returning ? 'returning_member' : 'unresolved';
  const step = (status, label, detail) => ({ status, label, detail });
  const steps = {
    member: step('verified', '회원·등급 확인', '현재 원본 신원·무료 수강 대상 승인 확인'),
    ticket: step('verified', '강사레슨 (2T) 발급', '기존 0원 수강권 독립 확인 · 유료 결제로 표기하지 않음'),
    confirmation: step('pending', '예약확정 안내', '무료 수강 대상 별도 승인 · 기존 최초 안내 처리기 사용'),
    bookings: step('not_required', '반배정·예약(수동)', '기존 예약 보존'),
    eformsign: step(returning ? 'not_required' : 'review_required', '강사회원 가입서', returning ? '과거 완료된 재수강 원장 유지' : '기존 가입서 대상·이력 별도 확인 필요 · 발송하지 않음'),
    memo: step(returning ? 'not_required' : 'pending', '가입서 완료 메모', '가입서 완료를 추정하거나 새 메모를 생성하지 않음'),
  };
  return { registration: { registrationId: id, idempotencyKey: id, studioId: '5330', memberName: name, memberPhone: phone,
    phoneLast4: phone.slice(-4), lessonDate: s.date, ticketName: t.title, ticketPrice: 0, paymentMethod: null, mode,
    ...deriveInstructorLessonRegistrationState({ mode, steps }), steps,
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true, paymentBasis: 'operator_approved_complimentary', complimentaryConfirmed: true },
    source: { type: 'studiomate_existing_complimentary_ticket_operator', sourceId: t.userTicketId, checkedAt: s.checkedAt, approvalKey: approval.operationKey },
    evidence: { studiomateMemberId: memberId, ticketId: t.userTicketId, ticketPaymentAmount: 0, existingTicketAdopted: true,
      complimentaryApproval: { operationKey: approval.operationKey, actor: approval.actor, approvedAt: approval.approvedAt, expectedAmount: 0 } },
    createdBy: { staffId: '1979746', name: 'ARCHIVE PILATES OPS', approvalActor: approval.actor }, lastError: null },
    createsStudioMateJob: false, issuesTicket: false, createsEformJob: false, manualSend: false };
}
