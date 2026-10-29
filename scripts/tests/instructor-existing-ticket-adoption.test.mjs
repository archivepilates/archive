import test from 'node:test';
import assert from 'node:assert/strict';
import { planInstructorExistingTicketAdoption } from '../lib/instructor-existing-ticket-adoption.mjs';
import { instructorLessonRegistrationId } from '../lib/instructor-lesson-registration-contract.mjs';
const now = new Date('2026-10-29T06:00:00Z');
function fixture() {
  const id = instructorLessonRegistrationId('5330', '01012345678', '2026-11-29');
  return { now, approval: { action: 'adopt_existing_paid_returning_ticket_notice', registrationId: id,
    actor: 'operator', operationKey: 'one-approved-key', approvedAt: now.toISOString() },
    source: { name: 'Test Member', phone: '01012345678', date: '2026-11-29', registrationId: id,
      ticketName: '강사레슨 (2T)', grade: '강사회원', excelPaidAmount: 70000, excelStatus: '사용예정',
      checkedAt: now.toISOString(), providerCheckedAt: now.toISOString(), nativeStatus: 'verified', ticketReadStatus: 'verified',
      member: { memberId: '1234567', name: 'Test Member', phone: '01012345678', memberGrade: '강사회원', inactive: false },
      currentRegistration: null, candidates: [], sends: [], providerRows: [],
      priorRegistrations: [{ id: 'prior-canonical-registration', date: '2026-09-20', mode: 'returning_member', status: 'completed', memberId: '1234567', eformStatus: 'not_required' }],
      tickets: [{ userTicketId: '7654321', memberId: '1234567', studioId: '5330', verified: true, complete: true,
        usable: true, active: true, cancelled: false, refunded: false, title: '강사레슨 (2T)', availabilityStartAt: '2026-11-29', expireAt: '2026-11-29',
        payment: { verified: true, complete: true, status: 'paid', paidAmount: 70000, totalAmount: 70000,
          outstandingAmount: 0, refundedAmount: 0, transactions: [{ method: 'bank_transfer', status: 'paid', amount: 70000 }] } }] } };
}
test('adopts only a verified existing returning ticket and preserves original source', () => {
  const p = fixture(), before = structuredClone(p.source), plan = planInstructorExistingTicketAdoption(p);
  assert.deepEqual(p.source, before);
  assert.equal(plan.registration.status, 'confirmation_pending');
  assert.equal(plan.registration.evidence.ticketId, '7654321');
  assert.equal(plan.registration.steps.confirmation.status, 'pending');
  assert.equal(plan.registration.steps.eformsign.status, 'not_required');
  assert.equal(plan.createsStudioMateJob, false); assert.equal(plan.issuesTicket, false); assert.equal(plan.manualSend, false);
});
const cases = [
  ['wrong approval', p => { p.approval.registrationId = 'other'; }],
  ['expired approval', p => { p.approval.approvedAt = '2026-10-20T00:00:00Z'; }],
  ['stale native proof', p => { p.source.checkedAt = '2026-10-29T05:57:00Z'; }],
  ['future native proof', p => { p.source.checkedAt = '2026-10-29T06:02:00Z'; }],
  ['stale provider proof', p => { p.source.providerCheckedAt = '2026-10-29T05:57:00Z'; }],
  ['unknown source', p => { p.source.nativeStatus = 'review'; }],
  ['wrong member', p => { p.source.member.memberId = '999'; }],
  ['wrong full phone', p => { p.source.member.phone = '01012345679'; }],
  ['wrong name', p => { p.source.member.name = 'Other'; }],
  ['inactive member', p => { p.source.member.inactive = true; }],
  ['staff', p => { p.source.member.memberGrade = '스텝'; }],
  ['free', p => { p.source.excelPaidAmount = 0; }],
  ['Team course', p => { p.source.ticketName = 'Team 강사레슨'; }],
  ['different month', p => { p.source.date = '2026-12-29'; }],
  ['existing cancelled record', p => { p.source.currentRegistration = { status: 'cancelled' }; }],
  ['existing candidate', p => { p.source.candidates.push({ status: 'queued' }); }],
  ['ambiguous send', p => { p.source.sends.push({ status: 'sending' }); }],
  ['provider prior send', p => { p.source.providerRows.push({ status: 'SENDING' }); }],
  ['no returning history', p => { p.source.priorRegistrations = []; }],
  ['new signup history', p => { p.source.priorRegistrations[0].mode = 'new_member'; }],
  ['cancelled history', p => { p.source.priorRegistrations[0].status = 'cancelled'; }],
  ['signup incomplete', p => { p.source.priorRegistrations[0].eformStatus = 'pending'; }],
  ['duplicate tickets', p => { p.source.tickets.push(structuredClone(p.source.tickets[0])); }],
  ['no ticket', p => { p.source.tickets = []; }],
  ['wrong studio', p => { p.source.tickets[0].studioId = '9999'; }],
  ['unverified ticket', p => { p.source.tickets[0].verified = false; }],
  ['inactive ticket', p => { p.source.tickets[0].active = false; }],
  ['cancelled ticket', p => { p.source.tickets[0].cancelled = true; }],
  ['refunded ticket', p => { p.source.tickets[0].refunded = true; }],
  ['wrong end date', p => { p.source.tickets[0].expireAt = '2026-11-28'; }],
  ['unverified payment', p => { p.source.tickets[0].payment.verified = false; }],
  ['wrong payment amount', p => { p.source.tickets[0].payment.paidAmount = 0; }],
  ['outstanding', p => { p.source.tickets[0].payment.outstandingAmount = 1; }],
  ['partial refund', p => { p.source.tickets[0].payment.refundedAmount = 1; }],
  ['no transactions', p => { p.source.tickets[0].payment.transactions = []; }],
  ['unsupported method', p => { p.source.tickets[0].payment.transactions[0].method = 'points'; }],
  ['transaction sum mismatch', p => { p.source.tickets[0].payment.transactions[0].amount = 50000; }],
];
for (const [label, change] of cases) test(label + ' stops without mutation', () => {
  const p = fixture(); change(p); assert.throws(() => planInstructorExistingTicketAdoption(p));
});
test('a cancelled different day does not restore that day or remove its history', () => {
  const p = fixture(); p.source.priorRegistrations.push({ id: 'old-cancelled', date: '2026-11-28', mode: 'returning_member', status: 'cancelled', memberId: '1234567' });
  const plan = planInstructorExistingTicketAdoption(p);
  assert.equal(plan.registration.lessonDate, '2026-11-29');
  assert.deepEqual(plan.registration.evidence.priorReturningRegistrationIds, ['prior-canonical-registration']);
});
for (const [mode, status, eformStatus] of [
  ['new_member', 'waiting_signature', 'pending'],
  ['new_member', 'completed', 'pending'],
  ['unresolved', 'processing', 'pending'],
]) test('older returning completion cannot suppress conflicting ' + mode + '/' + status, () => {
  const p = fixture();
  p.source.priorRegistrations.push({ id: 'conflicting-signup', date: '2026-10-24', memberId: '1234567', mode, status, eformStatus });
  assert.throws(() => planInstructorExistingTicketAdoption(p));
});
