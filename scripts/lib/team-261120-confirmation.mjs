import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TEAM_EVENT } from '../build-team-261120-calendar.mjs';
import { TEAM_IDS, assertTeamRegistration, assertTeamLectures, selectTeamTicket } from './team-261120-scope.mjs';
import { instructorLessonRegistrationId, isInstructorMemberGrade } from './instructor-lesson-registration-contract.mjs';

const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const { require: tsRequire } = require('tsx/cjs/api');
export const { stableHash } = tsRequire(fileURLToPath(new URL('../../firebase/kangsain-functions/functions/src/utils/hash.ts', import.meta.url)), import.meta.url);
export const TEMPLATE = 'KA01TP2608241233353269Jgtoiwnzi6';
export const CHANNEL = 'KA01PF260511123407631PSoAflYAVXs';
export const MANAGEMENT = 'team-261120';
export const APPROVAL = Object.freeze({ source: 'human_current_chat', instructionDate: '2026-10-29',
  action: 'send_exact_six_registration_linked_team_confirmations_once', registrationIds: TEAM_IDS,
  lessonDate: TEAM_EVENT.date, managementNumber: MANAGEMENT, templateId: TEMPLATE, channelId: CHANNEL,
  composition: `${TEAM_EVENT.topic}\n${TEAM_EVENT.composition}`, revision: 'team-261120-six-confirmations-v1' });

export function assertRegistration(id, r, registrationIdFor = instructorLessonRegistrationId) {
  assertTeamRegistration(id, r);
  assert.equal(registrationIdFor('5330', r.memberPhone, TEAM_EVENT.date), id, 'CANONICAL_REGISTRATION_REQUIRED');
  assert(r.registrationId === id && /^[1-9]\d{0,15}$/.test(r.studiomateMemberId || ''), 'NATIVE_ID_REQUIRED');
  assert(r.steps?.member?.status === 'verified' && r.steps?.ticket?.status === 'verified', 'MEMBER_TICKET_NOT_VERIFIED');
  assert(['sent', 'verified'].includes(r.steps?.eformsign?.status), 'EFORMSIGN_NOT_SENT_OR_VERIFIED');
  const ticketId = r.evidence?.studiomateUserTicketId;
  assert(/^[1-9]\d{0,15}$/.test(ticketId || '') && r.evidence?.studiomateTicketId === ticketId, 'TICKET_BINDING_REQUIRED');
  assert(!r.evidence?.studiomateMemberId || r.evidence.studiomateMemberId === r.studiomateMemberId, 'NATIVE_ID_CONFLICT');
  assert(!r.refunded && !r.refund && !['refunded', 'refund_pending'].includes(r.status), 'REFUND_BLOCK');
  assert(!r.source?.type?.startsWith('workLanes') && !String(r.source?.path || '').startsWith('workLanes/'), 'CANONICAL_SOURCE_REQUIRED');
  return { registrationId: id, memberId: r.studiomateMemberId, phone: r.memberPhone, name: r.memberName,
    ticketId, lessonDate: r.lessonDate, lessonTime: r.lessonTime, lessonTopic: r.lessonTopic,
    paymentAmount: r.paymentAmount, paymentMethod: r.paymentMethod, eformsignStatus: r.steps.eformsign.status };
}

export function confirmationVariables(id, r, native, tickets, lectures, registrationIdFor) {
  const binding = assertRegistration(id, r, registrationIdFor);
  assert(native?.status === 'verified' && native.member?.memberId === binding.memberId
    && native.member.phone === binding.phone && native.member.name === binding.name
    && native.member.inactive === false && isInstructorMemberGrade(native.member.memberGrade), 'NATIVE_MEMBER_MISMATCH');
  const ticket = selectTeamTicket(tickets, binding.memberId);
  assert(ticket?.userTicketId === binding.ticketId && ticket.payment.transactions.every(p => Number.isSafeInteger(p.amount) && p.amount > 0), 'NATIVE_TICKET_MISMATCH');
  assertTeamLectures(lectures);
  assert(lectures.meta.current_page === 1, 'LECTURES_INCOMPLETE');
  return { '#{이름}': binding.name, '#{수업일}': TEAM_EVENT.dateText, '#{수업시간}': TEAM_EVENT.timeText,
    '#{수업구성}': APPROVAL.composition, '#{관리번호}': MANAGEMENT };
}

export function confirmationKey(memberId, phone) {
  assert(/^[1-9]\d{0,15}$/.test(memberId || '') && /^010\d{8}$/.test(phone || ''), 'NATIVE_IDENTITY_REQUIRED');
  return 'instructor_lesson_confirmation_' + stableHash({ phone, lessonDate: TEAM_EVENT.date,
    managementNumber: MANAGEMENT, templateCode: TEMPLATE }).slice(0, 24);
}
export function confirmationSendId(memberId, phone) {
  confirmationKey(memberId, phone);
  return stableHash({ studioId: '5330', memberPhone: phone, type: 'instructor_lesson_confirmation',
    templateCode: TEMPLATE, scope: { lessonDate: TEAM_EVENT.date, managementNumber: MANAGEMENT } });
}

export function isConfirmationHistory(row) {
  const family = row?.type === 'instructor_lesson_confirmation' || row?.templateCode === TEMPLATE
    || row?.kakaoOptions?.templateId === TEMPLATE
    || /강사\s*레슨/.test(row?.text || '') && /예약\s*(?:이\s*)?확정|확정\s*(?:안내|되었)/.test(row.text);
  const fields = [row?.payload?.lessonDate, row?.payload?.classDate, row?.lessonDate,
    row?.variables?.['#{수업일}'], row?.kakaoOptions?.variables?.['#{수업일}']]
    .filter(x => x !== undefined && x !== null && x !== '');
  if (!family && !fields.length) return false;
  const evidence = [...fields, ...(row?.text ? [row.text] : [])];
  if (evidence.some(x => typeof x !== 'string')) return true;
  const dates = new Set(evidence.flatMap(value => [...value.matchAll(/(\d{4})(?:년\s*|[-./])(\d{1,2})(?:월\s*|[-./])(\d{1,2})(?:일)?/g)]
    .map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`)));
  // Unknown, short-form, or contradictory dates cannot prove a different booking.
  const shortDate = evidence.some(value => /(?:^|\D)(?:11월\s*20일|11[./-]20)(?:\D|$)/.test(value));
  if (dates.size > 1 || dates.has(TEAM_EVENT.date) || shortDate) return true;
  if (dates.size === 1) return false;
  return family || fields.length > 0;
}

export function receiptMessageId(result, phone) {
  assert(result && typeof result === 'object' && !Array.isArray(result), 'INVALID_RECEIPT');
  const list = result.messageList;
  assert(list && typeof list === 'object', 'RECEIPT_MISSING');
  const rows = Array.isArray(list) ? list : Object.values(list);
  assert(rows.length === 1 && /^M[A-Za-z0-9]+$/.test(rows[0]?.messageId || ''), 'AMBIGUOUS_RECEIPT');
  assert(result.failedMessageList == null || typeof result.failedMessageList === 'object', 'INVALID_FAILURE_LIST');
  assert(!Object.keys(result.failedMessageList || {}).length, 'FAILED_RECEIPT');
  assert(rows[0].to == null || rows[0].to === phone, 'RECEIPT_RECIPIENT_MISMATCH');
  assert(rows[0].kakaoOptions?.templateId == null || rows[0].kakaoOptions.templateId === TEMPLATE, 'RECEIPT_TEMPLATE_MISMATCH');
  return rows[0].messageId;
}

export function renderedText(template, variables) {
  let text = template.content;
  for (const [key, value] of Object.entries(variables)) text = text.split(key).join(value);
  assert(!/#\{[^}]+\}/.test(text), 'UNRESOLVED_TEMPLATE_VARIABLE');
  return text;
}
export function verifyProviderMessage(row, plan, template, messageId) {
  assert(row?.messageId === messageId && row.to === plan.binding.phone && row.type === 'ATA'
    && row.kakaoOptions?.templateId === TEMPLATE && row.kakaoOptions.pfId === CHANNEL, 'PROVIDER_IDENTITY_MISMATCH');
  assert.equal(row.text, renderedText(template, plan.variables), 'PROVIDER_TEXT_MISMATCH');
  assert.deepEqual(row.customFields, { archiveActionKey: plan.key, purpose: 'approved_team_confirmation',
    registrationId: plan.binding.registrationId, sourceTicketId: plan.binding.ticketId }, 'PROVIDER_CUSTOM_FIELDS_MISMATCH');
  assert(Number.isFinite(Date.parse(row.dateCreated)), 'PROVIDER_CREATED_AT_MISSING');
  assert(typeof row.status === 'string' && /^\d{4}$/.test(String(row.statusCode)), 'PROVIDER_STATUS_MISSING');
  return { deliveryStatus: row.status === 'COMPLETE' && String(row.statusCode) === '4000' ? 'delivered'
    : row.status === 'FAILED' || row.status === 'COMPLETE' ? 'failed' : 'pending',
  providerStatus: row.status, providerStatusCode: String(row.statusCode) };
}

export function templateHash(template) {
  return stableHash({ templateId: template.templateId, channelId: template.channelId,
    content: template.content, buttons: template.buttons, imageId: template.imageId });
}
export function approvalFor(template) {
  return { ...APPROVAL, templateHash: templateHash(template), contentHash: stableHash({ templateHash: templateHash(template), approval: APPROVAL }) };
}
export function d1PromiseVerified(proof, template, now) {
  const age = now - Date.parse(proof?.checkedAt);
  return proof?.status === 'verified' && proof.reviewedBy === 'main_current_chat'
    && proof.scope === 'existing_template_d1_promise' && proof.managementNumber === MANAGEMENT
    && proof.lessonDate === TEAM_EVENT.date && proof.templateId === TEMPLATE && proof.channelId === CHANNEL
    && proof.templateHash === templateHash(template) && proof.approvalHash === stableHash(approvalFor(template))
    && typeof proof.evidenceRef === 'string' && proof.evidenceRef.length > 0 && !proof.evidenceRef.includes('workLanes')
    && Number.isFinite(age) && age >= 0 && age < 86400000;
}
