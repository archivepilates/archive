import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID, holdingTemplateIssue, planHoldingNotice } from "./holding-allowance-notice.mjs";

export const HOLDING_V2_TEST_KEY = "holding_v2_operator_test_20261006";
export const HOLDING_V2_TEST_DATE = "2026-10-06";

export function completeProviderRows(provider) {
  if (!provider || !provider.messageList || typeof provider.messageList !== "object" || provider.nextKey)
    throw new Error("Incomplete provider history; do not send");
  const rows = Object.values(provider.messageList);
  if (rows.some((row) => !row || typeof row !== "object" || !row.messageId || !row.to || !row.kakaoOptions?.templateId))
    throw new Error("Malformed provider history; do not send");
  return rows;
}

export function holdingNoticeSample(recipient, date) {
  if (recipient?.memberId !== "1982133" || recipient?.name !== "김기효" || recipient?.phone !== "01086488585")
    throw new Error("Only the registered Kim Ki-hyo test recipient is allowed");
  const start = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== date) throw new Error("Invalid sample date");
  const end = new Date(start.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
  return {
    studioId: "5330", memberId: recipient.memberId, ticketId: "1", memberName: recipient.name,
    ticketName: "[테스트] 12주 수강권", currentHoldId: "sample", holdsComplete: true,
    originalPeriod: { days: 84, source: "operator_verified_original", evidenceRef: "synthetic_test_only_not_a_real_ticket" },
    holds: [{ id: "sample", start: date, end, kind: "member", status: "registered", evidenceRef: "synthetic_test_only_not_a_real_hold" }],
  };
}

export function holdingNoticeSamplePlan(recipient, date, template) {
  holdingNoticeSample(recipient, date);
  const snapshot = holdingNoticeSample(recipient, HOLDING_V2_TEST_DATE);
  const plan = planHoldingNotice({ snapshot, previousHoldIds: [], history: { complete: true, keys: [] }, template });
  if (!plan.ok) throw new Error(plan.reason);
  const id = HOLDING_V2_TEST_KEY;
  return { ...plan, id, snapshot };
}

// This sample never enters the automatic queue or creates a real ticket/hold source.
export async function dispatchHoldingNoticeSample({ db, stamp, recipient, date, template, request, confirmed }) {
  if (confirmed !== true) throw new Error("Explicit live-test confirmation required");
  const issue = holdingTemplateIssue(template);
  if (issue) throw new Error(issue);
  const plan = holdingNoticeSamplePlan(recipient, date, template);
  const candidateRef = db.collection("alimtalkCandidates").doc(plan.id);
  const sendRef = db.collection("alimtalkSends").doc(plan.id);
  const claimed = await db.runTransaction(async (tx) => {
    const [candidate, send] = await Promise.all([tx.get(candidateRef), tx.get(sendRef)]);
    if (candidate.exists || send.exists) return false;
    tx.create(candidateRef, {
      candidateId: plan.id, studioId: "5330", memberId: recipient.memberId, memberName: recipient.name,
      memberPhone: recipient.phone, type: "manual_review", status: "reviewed", templateCode: HOLDING_NOTICE_TEMPLATE_ID,
      title: HOLDING_NOTICE_TEMPLATE.name, reason: "운영자 승인 단건 합성 테스트 · 실제 홀딩 아님",
      sourceActionKey: plan.id, sourceDate: HOLDING_V2_TEST_DATE, dedupeKey: plan.id, queuedBy: "operator",
      reviewedByUid: "codex:operator-approved-holding-test", reviewedAt: stamp(),
      payload: { deliveryMode: "sample", source: "holding_notice_operator_sample" },
      isTest: true, attempts: 1, maxAttempts: 1, lastError: null, createdAt: stamp(), updatedAt: stamp(),
    });
    tx.create(sendRef, {
      sendId: plan.id, candidateId: plan.id, studioId: "5330", memberId: recipient.memberId,
      memberName: recipient.name, memberPhone: recipient.phone, templateCode: HOLDING_NOTICE_TEMPLATE_ID,
      status: "processing", dedupeKey: plan.id, dedupePolicy: "운영자 승인 v2 합성 테스트 전체 1회 · 날짜 변경 재발송 금지",
      dedupeWindowDays: null, attempts: 1, maxAttempts: 1, variables: plan.variables,
      isTest: true, createdByUid: "codex:operator-approved-holding-test", nextRunAt: stamp(),
      lastError: null, createdAt: stamp(), updatedAt: stamp(),
    });
    return true;
  });
  if (!claimed) return { ok: true, duplicateBlocked: true, id: plan.id, providerPostCount: 0 };
  let accepted = false;
  let receipt = null;
  try {
    const result = await request("/messages/v4/send-many/detail", "POST", {
      messages: [{ to: recipient.phone, type: "ATA", kakaoOptions: {
        pfId: HOLDING_NOTICE_TEMPLATE.channelId, templateId: HOLDING_NOTICE_TEMPLATE_ID,
        disableSms: true, variables: plan.variables,
      } }], strict: true, allowDuplicates: false, showMessageList: true,
    });
    const messages = Array.isArray(result.messageList) ? result.messageList : Object.values(result.messageList || {});
    let message = null;
    const failures = Array.isArray(result.failedMessageList) ? result.failedMessageList : Object.values(result.failedMessageList || {});
    if (!failures.length && messages.length === 1 && messages[0].messageId &&
        (!messages[0].to || messages[0].to === recipient.phone) &&
        (!messages[0].kakaoOptions?.templateId || messages[0].kakaoOptions.templateId === HOLDING_NOTICE_TEMPLATE_ID)) {
      const provisional = messages[0];
      receipt = { solapiMessageId: provisional.messageId, solapiGroupId: provisional.groupId || result.groupInfo?.groupId || "" };
      message = provisional;
      // Preserve the provisional receipt even if independent identity lookup times out.
      if (!message.to || !message.kakaoOptions?.templateId) {
        const provider = await request(`/messages/v4/list?messageIds=${encodeURIComponent(JSON.stringify([provisional.messageId]))}`);
        const rows = completeProviderRows(provider);
        message = rows.length === 1 ? rows[0] : null;
      }
      if (message?.messageId !== provisional.messageId || message?.to !== recipient.phone ||
          message?.kakaoOptions?.templateId !== HOLDING_NOTICE_TEMPLATE_ID) message = null;
    }
    if (failures.length || !message?.messageId) throw new Error("Provider acceptance not proven; reconcile before retry");
    accepted = true;
    receipt = { solapiMessageId: message.messageId, solapiGroupId: message.groupId || result.groupInfo?.groupId || "" };
    const batch = db.batch();
    batch.update(candidateRef, { status: "sent", sentAt: stamp(), lastError: null, updatedAt: stamp() });
    batch.update(sendRef, { status: "done", solapiMessageId: message.messageId,
      solapiGroupId: message.groupId || result.groupInfo?.groupId || "", lastError: null, updatedAt: stamp() });
    await batch.commit();
    return { ok: true, id: plan.id, providerPostCount: 1, messageId: message.messageId,
      groupId: message.groupId || result.groupInfo?.groupId || "", summary: plan.summary, message: plan.message };
  } catch (error) {
    const batch = db.batch();
    const detail = accepted ? "Provider accepted; ledger persistence requires reconciliation" : "Provider outcome unknown; do not resend";
    batch.update(candidateRef, { status: "failed", reasonCode: "holding_test_reconciliation_required", lastError: detail, updatedAt: stamp() });
    batch.update(sendRef, { status: "failed", providerOutcome: accepted ? "accepted_ledger_error" : "unknown",
      ...(receipt || {}), lastError: detail, updatedAt: stamp() });
    await batch.commit().catch(() => {});
    throw error;
  }
}

export async function reconcileHoldingNoticeSample({ db, stamp, recipient, date, template, request }) {
  const plan = holdingNoticeSamplePlan(recipient, date, template);
  const candidateRef = db.doc(`alimtalkCandidates/${plan.id}`), sendRef = db.doc(`alimtalkSends/${plan.id}`);
  const [candidateSnapshot, sendSnapshot] = await Promise.all([candidateRef.get(), sendRef.get()]);
  const candidate = candidateSnapshot.data(), ledger = sendSnapshot.data();
  const variablesMatch = (variables) => variables && Object.keys(variables).length === Object.keys(plan.variables).length &&
    Object.entries(plan.variables).every(([key, value]) => variables[key] === value);
  if (candidate?.isTest !== true || candidate.memberId !== recipient.memberId || candidate.memberPhone !== recipient.phone ||
    candidate.templateCode !== HOLDING_NOTICE_TEMPLATE_ID || candidate.dedupeKey !== plan.id ||
    ledger?.isTest !== true || ledger.memberPhone !== recipient.phone || ledger.memberId !== recipient.memberId ||
    ledger.templateCode !== HOLDING_NOTICE_TEMPLATE_ID || ledger.dedupeKey !== plan.id ||
    ledger.createdByUid !== "codex:operator-approved-holding-test" ||
    !variablesMatch(ledger.variables))
    throw new Error("Matching durable test claim required");
  const params = new URLSearchParams({ startDate: `${HOLDING_V2_TEST_DATE}T00:00:00+09:00`, endDate: new Date().toISOString(),
    dateType: "CREATED", type: "ATA", to: recipient.phone, limit: "500" });
  const provider = await request(`/messages/v4/list?${params}`);
  const rows = completeProviderRows(provider).filter((row) => row.to === recipient.phone &&
    row.kakaoOptions?.templateId === HOLDING_NOTICE_TEMPLATE_ID && row.text === plan.message &&
    row.kakaoOptions?.disableSms === true && row.messageId && row.groupId &&
    variablesMatch(row.kakaoOptions?.variables));
  if (rows.length !== 1) throw new Error("Provider evidence ambiguous; do not resend");
  const row = rows[0];
  if ((ledger.solapiMessageId && ledger.solapiMessageId !== row.messageId) ||
      (ledger.solapiGroupId && ledger.solapiGroupId !== row.groupId))
    throw new Error("Provider receipt differs from durable claim; do not resend");
  if (String(row.statusCode) !== "4000" || row.status !== "COMPLETE") throw new Error("Delivery not complete; do not resend");
  const batch = db.batch();
  batch.update(candidateRef, { status: "sent", sentAt: stamp(), lastError: null, updatedAt: stamp() });
  batch.update(sendRef, { status: "done", solapiMessageId: row.messageId, solapiGroupId: row.groupId,
    providerOutcome: "delivered_reconciled", providerStatusCode: "4000", lastError: null, reconciledAt: stamp(), updatedAt: stamp() });
  await batch.commit();
  return { ok: true, id: plan.id, providerPostCount: 0, messageId: row.messageId, groupId: row.groupId, deliveryComplete: true };
}
