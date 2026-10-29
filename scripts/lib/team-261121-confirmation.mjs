import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TEAM_EVENT } from '../build-team-261121-calendar.mjs';
import { isInstructorMemberGrade } from './instructor-lesson-registration-contract.mjs';

export const TEAM_CONFIRMATION_TEMPLATE = 'KA01TP2608241233353269Jgtoiwnzi6';
export const TEAM_CONFIRMATION_CHANNEL = 'KA01PF260511123407631PSoAflYAVXs';
const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const { require: tsRequire } = require('tsx/cjs/api');
const { stableHash } = tsRequire(fileURLToPath(new URL('../../firebase/kangsain-functions/functions/src/utils/hash.ts', import.meta.url)), import.meta.url);
export const TEAM_CONFIRMATION_TARGETS = Object.freeze([
  ['5003535', '변고은', '11782632'], ['5003531', '장영은', '11782636'],
  ['5003533', '정지혜', '11782639'], ['5003530', '조하린', '11782634'],
  ['5003534', '최다솜', '11782640'],
].map(([memberId, name, ticketId]) => Object.freeze({ memberId, name, ticketId })));

export function teamConfirmationKey(memberId, phone) {
  assert(TEAM_CONFIRMATION_TARGETS.some(t => t.memberId === memberId) && /^010\d{8}$/.test(phone));
  return 'instructor_lesson_confirmation_' + stableHash({ phone, lessonDate: TEAM_EVENT.date,
    managementNumber: 'team-261121', templateCode: TEAM_CONFIRMATION_TEMPLATE }).slice(0, 24);
}
export function teamConfirmationSendId(memberId, phone) {
  teamConfirmationKey(memberId, phone);
  return stableHash({ studioId: '5330', memberPhone: phone, type: 'instructor_lesson_confirmation',
    templateCode: TEAM_CONFIRMATION_TEMPLATE, scope: { lessonDate: TEAM_EVENT.date, managementNumber: 'team-261121' } });
}

export function teamConfirmationVariables(member, tickets) {
  const expected = TEAM_CONFIRMATION_TARGETS.find(t => t.memberId === member?.memberId);
  assert(expected && member.name === expected.name && /^010\d{8}$/.test(member.phone)
    && member.inactive === false && isInstructorMemberGrade(member.memberGrade));
  const rows = tickets.filter(t => t.title === 'Team 강사레슨'
    && t.availabilityStartAt === TEAM_EVENT.date && t.expireAt === TEAM_EVENT.date);
  assert.equal(rows.length, 1, 'Exactly one current Team ticket required.');
  const t = rows[0], p = t.payment;
  assert(t.memberId === member.memberId && t.studioId === '5330' && t.userTicketId === expected.ticketId
    && t.productId === '468880' && t.type === 'T' && t.availableClassType === 'G'
    && t.verified === true && t.complete === true && t.active === true && t.usable === true
    && t.cancelled === false && t.refunded === false && t.isShared === false);
  assert(p?.verified === true && p.complete === true && p.status === 'paid'
    && p.totalAmount === 80000 && p.paidAmount === 80000 && p.outstandingAmount === 0 && p.refundedAmount === 0
    && Array.isArray(p.transactions) && p.transactions.length > 0
    && p.transactions.every(r => r.status === 'paid' && Number.isSafeInteger(r.amount) && r.amount > 0)
    && p.transactions.reduce((sum, r) => sum + r.amount, 0) === 80000);
  return { '#{이름}': member.name, '#{수업일}': TEAM_EVENT.dateText, '#{수업시간}': TEAM_EVENT.timeText,
    '#{수업구성}': TEAM_EVENT.composition, '#{관리번호}': 'team-261121' };
}

export function isTeamConfirmationHistory(row) {
  const sameFamily = row?.type === 'instructor_lesson_confirmation'
    || row?.templateCode === TEAM_CONFIRMATION_TEMPLATE || row?.kakaoOptions?.templateId === TEAM_CONFIRMATION_TEMPLATE
    || /강사\s*레슨/.test(row?.text || '') && /예약\s*(?:이\s*)?확정|확정\s*(?:안내|되었)/.test(row.text);
  const fields = [row?.payload?.lessonDate, row?.payload?.classDate, row?.lessonDate, row?.variables?.['#{수업일}']]
    .filter(x => x !== undefined && x !== null && x !== '');
  if (!sameFamily && !fields.length) return false;
  const evidence = [...fields, ...(row?.text ? [row.text] : [])];
  if (evidence.some(x => typeof x !== 'string')) return true;
  const dates = new Set(evidence.flatMap(value => [...value.matchAll(/(\d{4})(?:년\s*|[-./])(\d{1,2})(?:월\s*|[-./])(\d{1,2})(?:일)?/g)]
    .map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`)));
  if (dates.size > 1 || dates.has(TEAM_EVENT.date)) return true;
  if (dates.size === 1) return false;
  // Missing/unparseable or contradictory evidence cannot prove a different lesson.
  return sameFamily || fields.length > 0;
}

export function teamConfirmationReceipt(result, phone) {
  const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  assert(record(result) && /^010\d{8}$/.test(phone));
  const rows = Array.isArray(result.messageList) ? result.messageList : record(result.messageList) ? Object.values(result.messageList) : [];
  const failed = result.failedMessageList;
  assert(failed == null || Array.isArray(failed) || record(failed));
  assert(!Object.keys(failed || {}).length && rows.length === 1 && record(rows[0]));
  const m = rows[0];
  assert(/^M[A-Za-z0-9]+$/.test(m.messageId || '') && (m.to == null || m.to === phone)
    && (m.kakaoOptions?.templateId == null || m.kakaoOptions.templateId === TEAM_CONFIRMATION_TEMPLATE));
  return m.messageId;
}
