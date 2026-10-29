import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_CONFIRMATION_TARGETS as targets, TEAM_CONFIRMATION_TEMPLATE as template, teamConfirmationVariables as variables,
  teamConfirmationKey as key, teamConfirmationSendId as sendId, isTeamConfirmationHistory as relevant, teamConfirmationReceipt as receipt } from '../lib/team-261121-confirmation.mjs';

function fixture(target = targets[0]) {
  return { member: { memberId: target.memberId, name: target.name, phone: '010' + target.memberId.padStart(8, '0'), inactive: false, memberGrade: '강사회원' },
    tickets: [{ memberId: target.memberId, studioId: '5330', userTicketId: target.ticketId, productId: '468880', title: 'Team 강사레슨',
      type: 'T', availableClassType: 'G', availabilityStartAt: '2026-11-21', expireAt: '2026-11-21', verified: true, complete: true,
      active: true, usable: true, cancelled: false, refunded: false, isShared: false,
      payment: { verified: true, complete: true, status: 'paid', totalAmount: 80000, paidAmount: 80000, outstandingAmount: 0, refundedAmount: 0,
        transactions: [{ status: 'paid', amount: 80000 }] } }] };
}
test('only five exact Team identities and tickets produce the approved non-test variables', () => {
  assert.equal(targets.length, 5); assert.equal(new Set(targets.map(t => key(t.memberId, fixture(t).member.phone))).size, 5);
  for (const t of targets) assert.match(sendId(t.memberId, fixture(t).member.phone), /^[a-f0-9]{64}$/);
  for (const t of targets) { const f = fixture(t), v = variables(f.member, f.tickets); assert.equal(v['#{이름}'], t.name);
    assert.equal(v['#{수업시간}'], '13:30~15:20'); assert.equal(v['#{관리번호}'], 'team-261121'); assert.doesNotMatch(v['#{이름}'], /테스트/); }
  assert.throws(() => key('unapproved'));
});
for (const [name, change] of Object.entries({ wrongName: f => { f.member.name = 'other'; }, wrongId: f => { f.member.memberId = '123'; },
  trial: f => { f.member.memberGrade = '체험회원'; }, inactive: f => { f.member.inactive = true; }, wrongPhone: f => { f.member.phone = ''; },
  noTicket: f => { f.tickets = []; }, twoTickets: f => { f.tickets.push(structuredClone(f.tickets[0])); },
  cancelled: f => { f.tickets[0].cancelled = true; }, refunded: f => { f.tickets[0].refunded = true; },
  wrongTicket: f => { f.tickets[0].userTicketId = 'other'; }, wrongProduct: f => { f.tickets[0].productId = 'other'; },
  wrongDate: f => { f.tickets[0].expireAt = '2026-11-28'; }, wrongType: f => { f.tickets[0].title = '강사레슨 (2T)'; },
  incomplete: f => { f.tickets[0].complete = false; }, unpaid: f => { f.tickets[0].payment.outstandingAmount = 80000; },
  paymentMismatch: f => { f.tickets[0].payment.transactions[0].amount = 1; }, shared: f => { f.tickets[0].isShared = true; },
})) test('rejects ' + name, () => { const f = fixture(); change(f); assert.throws(() => variables(f.member, f.tickets)); });
test('canonical and cross-channel same-date/unknown confirmation history blocks replay', () => {
  for (const r of [{ templateCode: template, variables: { '#{수업일}': '2026년 11월 21일(토)' } },
    { type: 'instructor_lesson_confirmation', payload: { lessonDate: '2026-11-21' } },
    { kakaoOptions: { templateId: template }, text: '2026년 11월 21일' },
    { text: '강사 레슨 예약확정 2026-11-21' }, { templateCode: template },
    { type: 'legacy_notice', payload: { classDate: '2026-11-21' } }]) assert(relevant(r));
  for (const r of [{ templateCode: template, payload: { lessonDate: '2026-11-28' }, variables: { '#{수업일}': '2026년 11월 21일' } },
    { payload: { lessonDate: '2026-11-28' }, text: '2026년 11월 21일' },
    { payload: { lessonDate: '2026-11-28', classDate: '2026-11-29' } },
    { payload: { lessonDate: 'unknown' } }, { payload: { lessonDate: {} } },
    { templateCode: template, text: '본문 누락 확인필요' }]) assert(relevant(r));
  assert(!relevant({ templateCode: template, payload: { lessonDate: '2026-11-28' } }));
  assert(!relevant({ text: '다른 내용' }));
});
test('unrelated old material notices are not unknown-date reservation confirmations', () => {
  assert(!relevant({ kakaoOptions: { templateId: 'KA01TP260825074722212ylmndmsB3V4' }, text: '강사레슨 수업 안내, 다음 예약 안내를 참고해 주세요.' }));
  assert(!relevant({ text: '자료 변경 2026-10-16, 제출일 2026-10-17' }));
  assert(relevant({ text: '강사레슨 예약이 확정되었어요. 날짜 확인필요' }));
});
test('one provisional receipt supports provider maps and rejects failures/multiple/wrong identities', () => {
  const row = { messageId: 'MEXAMPLE' };
  for (const messageList of [[row], { MEXAMPLE: row }]) assert.equal(receipt({ messageList }, '01012345678'), row.messageId);
  for (const r of [{ messageList: [row, row] }, { messageList: [row], failedMessageList: { x: {} } },
    { messageList: [{ ...row, to: '01000000000' }] }, { messageList: [{ ...row, kakaoOptions: { templateId: 'other' } }] }]) assert.throws(() => receipt(r, '01012345678'));
});
