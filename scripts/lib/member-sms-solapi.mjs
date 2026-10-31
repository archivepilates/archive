import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assertMemberDispatchAllowed } from './member-dispatch-window.mjs';
import { makeLessonVideoSolapiRequest } from './lesson-video-notice-solapi.mjs';

export const MEMBER_SMS_PROVIDER_POLICY = 'solapi_direct_sms_v1';
export const MEMBER_SMS_CONFIG_PATH = path.join(os.homedir(), 'ArchiveIN/automation/config/member-sms-solapi.json');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const messageId = value => typeof value === 'string' && /^M[A-Za-z0-9]{20,80}$/.test(value);
const groupId = value => typeof value === 'string' && /^G[A-Za-z0-9]{20,80}$/.test(value);
const phone = value => typeof value === 'string' && /^0\d{7,10}$/.test(value);
const contentHash = (plan, subject = plan.smsTitle) => hash([subject, plan.smsMessage, plan.imageId || '']);
const stop = code => { throw Object.assign(new Error(code), { code }); };
const assert = (ok, code) => { if (!ok) stop(code); };

export function acceptedMemberSmsMarker(row) {
  if (row?.provider === 'solapi') return messageId(row.providerMessageId) && groupId(row.providerGroupId)
    && row.providerReceipt?.messageId === row.providerMessageId
    && row.providerReceipt.groupId === row.providerGroupId && row.providerReceipt.actionKey === row.key
    && row.providerReceipt.policy === MEMBER_SMS_PROVIDER_POLICY
    && ['2000', '4000'].includes(row.providerReceipt.statusCode)
    && /^[a-f0-9]{64}$/.test(row.providerReceipt.recipientHash || '')
    && /^[a-f0-9]{64}$/.test(row.providerReceipt.contentHash || '');
  return !row?.provider && Number.isSafeInteger(row?.smsId) && row.smsId > 0;
}

export function memberSmsReceiptFields(receipt, plan, { subject = plan.smsTitle } = {}) {
  if (receipt?.provider !== 'solapi') {
    assert(!receipt?.provider && Number.isSafeInteger(receipt?.smsId) && receipt.smsId > 0, 'member_sms_receipt_unverified');
    return { smsId: receipt.smsId };
  }
  const proof = receipt.providerReceipt;
  assert(messageId(receipt.providerMessageId) && groupId(receipt.providerGroupId)
    && proof?.policy === MEMBER_SMS_PROVIDER_POLICY && proof.actionKey === plan.key
    && proof.messageId === receipt.providerMessageId && proof.groupId === receipt.providerGroupId
    && proof.recipientHash === hash(plan.memberPhone) && proof.contentHash === contentHash(plan, subject)
    && ['2000', '4000'].includes(proof.statusCode), 'member_sms_receipt_unverified');
  return { provider: 'solapi', providerMessageId: receipt.providerMessageId,
    providerGroupId: receipt.providerGroupId, providerReceipt: proof };
}

export function createMemberSmsSender({ request, senderNumber, now = () => new Date(),
  assertAllowed = () => assertMemberDispatchAllowed(now()) }) {
  assert(typeof request === 'function' && phone(senderNumber), 'member_sms_sender_unverified');
  return async (plan, beforeFinalSend, { subject = plan.smsTitle } = {}) => {
    assertAllowed();
    assert(typeof plan.key === 'string' && /^[\w:-]{1,180}$/.test(plan.key)
      && typeof plan.memberPhone === 'string' && /^01\d{8,9}$/.test(plan.memberPhone)
      && typeof plan.smsTitle === 'string' && typeof plan.smsMessage === 'string'
      && plan.smsMessage.trim() && Buffer.byteLength(plan.smsMessage, 'utf8') <= 2000
      && typeof subject === 'string' && Buffer.byteLength(subject, 'utf8') <= 40
      && !/[\x00-\x1f\x7f]/.test(subject) && typeof beforeFinalSend === 'function', 'member_sms_input_unverified');
    if (plan.imageId != null) assert(typeof plan.imageId === 'string' && /^[A-Za-z0-9_-]{10,150}$/.test(plan.imageId), 'member_sms_image_unverified');
    plan = Object.freeze({ key: plan.key, memberPhone: plan.memberPhone, smsTitle: plan.smsTitle,
      smsMessage: plan.smsMessage, ...(plan.imageId ? { imageId: plan.imageId } : {}) });
    const type = plan.imageId ? 'MMS' : !subject && Buffer.byteLength(plan.smsMessage, 'utf8') <= 90 ? 'SMS' : 'LMS';
    // No provider POST occurs before source revalidation and the durable canonical claim.
    try {
      const active = await request('/senderid/v1/numbers/active', 'GET');
      assert(Array.isArray(active) && active.some(row => typeof row === 'string' ? row === senderNumber
        : row?.phoneNumber === senderNumber && row.status === 'ACTIVE'
          && (row.expireAt == null || Date.parse(row.expireAt) > now().getTime())), 'member_sms_sender_inactive');
      let cursor, page = 0; const seen = new Set();
      do {
        const params = new URLSearchParams({ to: plan.memberPhone, limit: '500',
          ...(cursor ? { startKey: cursor } : {}) });
        const history = await request('/messages/v4/list?' + params, 'GET');
        assert(history && !Array.isArray(history) && history.messageList && typeof history.messageList === 'object'
          && !Array.isArray(history.messageList), 'member_sms_history_unverified');
        for (const [id, row] of Object.entries(history.messageList)) {
          assert(messageId(id) && row?.messageId === id && row.to === plan.memberPhone
            && typeof row.type === 'string', 'member_sms_history_unverified');
          if (row.customFields?.archiveActionKey === plan.key) stop('member_sms_prior_provider_message');
          if (!['SMS', 'LMS', 'MMS'].includes(row.type)) continue;
          assert(phone(row.from) && typeof row.text === 'string', 'member_sms_history_unverified');
          const otherCanonicalAction = row.customFields?.archivePolicy === MEMBER_SMS_PROVIDER_POLICY
            && typeof row.customFields?.archiveActionKey === 'string'
            && /^[\w:-]{1,180}$/.test(row.customFields.archiveActionKey) && row.customFields.archiveActionKey !== plan.key;
          if (row.customFields?.archiveActionKey === plan.key || !otherCanonicalAction && row.text === plan.smsMessage)
            stop('member_sms_prior_provider_message');
        }
        cursor = history.nextKey;
        assert(cursor == null || typeof cursor === 'string' && messageId(cursor) && !seen.has(cursor), 'member_sms_history_unverified');
        if (cursor) seen.add(cursor);
        assert(++page <= 10 && !(page === 10 && cursor), 'member_sms_history_incomplete');
      } while (cursor);
    } catch (error) {
      if (/^member_sms_/.test(error.code || error.message)) throw error;
      stop('member_sms_provider_preflight_unverified');
    }
    const markStarted = await beforeFinalSend();
    assert(typeof markStarted === 'function', 'member_sms_claim_unverified');
    assertAllowed();
    markStarted();
    try { assertAllowed(); } catch (error) { error.providerPostCount = 0; throw error; }
    const response = await request('/messages/v4/send-many/detail', 'POST', {
      messages: [{ to: plan.memberPhone, from: senderNumber, type, ...(subject ? { subject } : {}), text: plan.smsMessage,
        ...(plan.imageId ? { imageId: plan.imageId } : {}), customFields: { archiveActionKey: plan.key,
          archivePolicy: MEMBER_SMS_PROVIDER_POLICY } }], strict: true, allowDuplicates: false, showMessageList: true,
    });
    const rows = response?.messageList;
    assert(Array.isArray(rows) && rows.length === 1 && rows[0] && Array.isArray(response.failedMessageList)
      && response.failedMessageList.length === 0 && messageId(rows[0].messageId)
      && groupId(response.groupInfo?.groupId) && ['2000', '4000'].includes(rows[0].statusCode)
      && (rows[0].groupId == null || rows[0].groupId === response.groupInfo.groupId)
      && (rows[0].to == null || rows[0].to === plan.memberPhone)
      && (rows[0].from == null || rows[0].from === senderNumber)
      && (rows[0].type == null || rows[0].type === type)
      && (rows[0].text == null || rows[0].text === plan.smsMessage)
      && (rows[0].subject == null || rows[0].subject === subject)
      && (rows[0].customFields == null || rows[0].customFields.archiveActionKey === plan.key
        && rows[0].customFields.archivePolicy === MEMBER_SMS_PROVIDER_POLICY), 'member_sms_receipt_unverified');
    return { provider: 'solapi', providerMessageId: rows[0].messageId, providerGroupId: response.groupInfo.groupId,
      providerReceipt: { policy: MEMBER_SMS_PROVIDER_POLICY, actionKey: plan.key, messageId: rows[0].messageId,
        groupId: response.groupInfo.groupId, recipientHash: hash(plan.memberPhone), contentHash: contentHash(plan, subject),
        statusCode: rows[0].statusCode, acceptedAt: now().toISOString() } };
  };
}

export async function sendMemberSms(plan, beforeFinalSend, options = {}) {
  (options.assertAllowed || (() => assertMemberDispatchAllowed()))();
  let send;
  try {
    const stat = lstatSync(MEMBER_SMS_CONFIG_PATH);
    assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'member_sms_config_unverified');
    const config = JSON.parse(readFileSync(MEMBER_SMS_CONFIG_PATH, 'utf8'));
    assert(config.policy === MEMBER_SMS_PROVIDER_POLICY && phone(config.senderNumber), 'member_sms_config_unverified');
    send = createMemberSmsSender({ request: makeLessonVideoSolapiRequest({ gcloudPath: '/opt/homebrew/bin/gcloud' }), senderNumber: config.senderNumber,
      assertAllowed: options.assertAllowed });
  } catch { stop('member_sms_provider_configuration_unverified'); }
  return send(plan, beforeFinalSend, options);
}
