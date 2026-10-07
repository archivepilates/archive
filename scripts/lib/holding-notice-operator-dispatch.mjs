import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID, holdingTemplateIssue } from "./holding-allowance-notice.mjs";
import { holdingFingerprint, normalizeHoldingObservation } from "./studiomate-holding-source.mjs";
import { completeProviderRows } from "./holding-notice-test-dispatch.mjs";
import { calculateLiveHolding, verifyHoldingAtDispatch } from "./holding-notice-live-readback.mjs";
import { HOLDING_AUTO_EVENTS, automaticHoldingEventIssue } from "./holding-notice-automatic.mjs";

const FAMILY = new Set([HOLDING_NOTICE_TEMPLATE_ID, "KA01TP261006054728079NtSGrYdtSQH"]);
export const isHoldingLedger = row => FAMILY.has(row?.templateCode) || row?.payload?.holdingNotice === true;

function knownOtherHoldingSend(row, plan) {
  if (!row || row.id === plan.id || row.status !== "done" || row.providerStatus !== "COMPLETE" ||
      row.providerStatusCode !== "4000" || row.templateCode !== HOLDING_NOTICE_TEMPLATE_ID ||
      row.memberId !== plan.memberId || row.memberPhone !== plan.memberPhone || row.studioId !== plan.studioId ||
      !["operator_verified_one_off", "automatic_live_readback"].includes(row.payload?.deliveryMode) || !row.solapiMessageId ||
      !/^[a-f0-9]{64}$/.test(row.issuanceFingerprint || "") || !/^[a-f0-9]{64}$/.test(row.creationEvidenceFingerprint || "")) return false;
  const expected = `holding_operator_notice_${holdingFingerprint([row.studioId, row.memberId, row.issuanceFingerprint, row.creationEvidenceFingerprint])}`;
  return row.id === expected && row.candidateId === expected && row.sendId === expected &&
    row.issuanceFingerprint === plan.issuanceFingerprint && row.creationEvidenceFingerprint !== plan.creationEvidenceFingerprint &&
    normalizeHoldingObservation(plan.sourceEvidence).history.some(history => history.fingerprint === row.creationEvidenceFingerprint);
}

export function verifiedOperatorHoldingPlan(raw, member, approval, now = new Date()) {
  const { observation: obs, summary, selected: current } = calculateLiveHolding(raw,
    { creationEvidenceFingerprint: approval?.creationEvidenceFingerprint, now });
  if (!current) throw new Error("approved_current_hold_required");
  if (obs.studioId !== "5330" || member?.memberId !== obs.memberId || member.studioId !== obs.studioId ||
      member.name !== obs.memberName || !/^01[016789]\d{7,8}$/.test(member.phone || "")) throw new Error("operator_member_identity_mismatch");
  const age = now.getTime() - Date.parse(obs.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 120_000) throw new Error("fresh_operator_readback_required");
  if (approval?.confirmed !== true || !approval.reason?.trim() || !approval.approvedBy?.trim() ||
      approval.observationFingerprint !== obs.observationFingerprint ||
      approval.memberId !== obs.memberId || approval.memberPhone !== member.phone)
    throw new Error("observation_bound_operator_approval_required");
  const id = `holding_operator_notice_${holdingFingerprint([obs.studioId, obs.memberId, obs.issuanceFingerprint, current.id])}`;
  const variables = {
    "#{이름}": obs.memberName, "#{수강권명}": obs.ticketName,
    "#{홀딩시작일}": current.start, "#{홀딩종료일}": current.end,
    "#{이번홀딩일수}": String((Date.parse(current.end) - Date.parse(current.start)) / 86_400_000 + 1),
    "#{전체홀딩일수}": String(summary.totalDays), "#{사용홀딩일수}": String(summary.usedDays),
    "#{잔여홀딩일수}": String(summary.remainingDays),
  };
  return { id, memberId: obs.memberId, memberName: obs.memberName, memberPhone: member.phone, studioId: obs.studioId,
    summary, variables, observationFingerprint: obs.observationFingerprint, issuanceFingerprint: obs.issuanceFingerprint,
    creationEvidenceFingerprint: current.id, observedAt: obs.observedAt, sourceDate: current.start,
    message: HOLDING_NOTICE_TEMPLATE.content.replace(/#\{[^}]+\}/g, key => variables[key]),
    approval, sourceEvidence: raw };
}

function verifiedReceipt(provider, plan, messageId) {
  const rows = completeProviderRows(provider).filter(row => row.messageId === messageId);
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || row.messageId !== messageId || row.to !== plan.memberPhone || row.kakaoOptions?.templateId !== HOLDING_NOTICE_TEMPLATE_ID ||
      row.kakaoOptions?.disableSms !== true || row.text !== plan.message ||
      JSON.stringify(Object.entries(row.kakaoOptions?.variables || {}).sort()) !== JSON.stringify(Object.entries(plan.variables).sort()))
    throw new Error("operator_receipt_identity_or_content_mismatch");
  return row;
}

function receiptLookup(plan) {
  // Use the verified recipient/date list API; JSON-array messageIds silently returns no rows.
  return `/messages/v4/list?${new URLSearchParams({ to: plan.memberPhone, type: "ATA", dateType: "CREATED",
    startDate: plan.observedAt, endDate: new Date().toISOString(), limit: "500" })}`;
}

export async function dispatchVerifiedOperatorHolding({ db, stamp, plan, template, request, recipientIssue, readLatest,
  automatic = false, now = () => new Date() }) {
  plan = structuredClone(plan);
  const issue = holdingTemplateIssue(template);
  if (issue) throw new Error(issue);
  const verified = verifiedOperatorHoldingPlan(plan.sourceEvidence, { memberId: plan.memberId, name: plan.memberName, phone: plan.memberPhone, studioId: plan.studioId }, plan.approval, now());
  if (holdingFingerprint(verified) !== holdingFingerprint(plan)) throw new Error("operator_plan_changed_after_approval");
  // The whole holding-template family is audited, not just this version or this execution date.
  const params = new URLSearchParams({ to: plan.memberPhone, type: "ATA", dateType: "CREATED", limit: "500",
    startDate: "2026-10-06T00:00:00+09:00", endDate: now().toISOString() });
  const local = await db.collection("alimtalkSends").where("memberPhone", "==", plan.memberPhone).limit(500).get();
  if (local.size === 500) throw new Error("incomplete_holding_receipt_history");
  const known = new Map();
  for (const doc of local.docs) {
    const row = doc.data();
    if (!isHoldingLedger(row)) continue;
    if (!knownOtherHoldingSend(row, plan) || known.has(row.solapiMessageId))
      throw new Error("prior_holding_local_attempt_do_not_resend");
    known.set(row.solapiMessageId, row);
  }
  const prior = completeProviderRows(await request(`/messages/v4/list?${params}`));
  for (const row of prior.filter(row => FAMILY.has(row.kakaoOptions.templateId))) {
    const ledger = known.get(row.messageId);
    if (!ledger) throw new Error("prior_holding_provider_receipt_do_not_resend");
    const checked = verifiedReceipt({ messageList: [row] }, ledger, row.messageId);
    if (checked.status !== "COMPLETE" || String(checked.statusCode) !== "4000")
      throw new Error("prior_holding_provider_receipt_do_not_resend");
    known.delete(row.messageId);
  }
  if (known.size) throw new Error("incomplete_holding_receipt_history");
  plan = await verifyHoldingAtDispatch(plan, readLatest, verifiedOperatorHoldingPlan, now);
  const candidateRef = db.doc(`alimtalkCandidates/${plan.id}`), sendRef = db.doc(`alimtalkSends/${plan.id}`);
  const claimRef = db.doc(`holdingNoticeClaims/${plan.id}`);
  const claimed = await db.runTransaction(async tx => {
    const config = (await tx.get(db.doc("settings/holdingNotice"))).data();
    if (automatic) {
      const event = (await tx.get(db.doc(`${HOLDING_AUTO_EVENTS}/${plan.id}`))).data();
      const issue = automaticHoldingEventIssue(event, plan, config, now());
      if (issue) throw new Error(issue);
    } else if (config?.autoSendEnabled !== false || config?.canonicalSourcePromoted !== false || config?.templateId !== HOLDING_NOTICE_TEMPLATE_ID)
      throw new Error("operator_dispatch_requires_separate_inactive_automation");
    const profile = (await tx.get(db.doc(`memberProfiles/${plan.memberId}`))).data();
    if (!profile || profile.memberId !== plan.memberId || profile.name !== plan.memberName || profile.phone !== plan.memberPhone || profile.studioId !== plan.studioId)
      throw new Error("operator_member_changed");
    const exclusion = await recipientIssue(tx, profile);
    if (exclusion) throw new Error(exclusion);
    for (const old of local.docs.filter(doc => isHoldingLedger(doc.data()))) {
      const row = old.data();
      const current = (await tx.get(db.doc(`alimtalkSends/${old.id}`))).data();
      const claim = (await tx.get(db.doc(`holdingNoticeClaims/${row.id}`))).data();
      if (!knownOtherHoldingSend(current, plan) || holdingFingerprint(current) !== holdingFingerprint(row) ||
          claim?.status !== "delivered" || claim.solapiMessageId !== row.solapiMessageId)
        throw new Error("prior_holding_claim_reconciliation_required");
    }
    for (const collection of ["alimtalkCandidates", "alimtalkSends", "holdingNoticeClaims"]) {
      const existing = await tx.get(db.doc(`${collection}/${plan.id}`));
      if (existing.exists) return false;
    }
    for (const collection of ["alimtalkCandidates", "alimtalkSends"]) {
      for (const [field, value] of [["memberId", plan.memberId], ["memberPhone", plan.memberPhone]]) {
        const rows = await tx.get(db.collection(collection).where(field, "==", value).limit(500));
        if (rows.size === 500 || rows.docs.some(doc => isHoldingLedger(doc.data()) &&
          !(collection === "alimtalkSends" ? local.docs.some(send => send.id === doc.id &&
              knownOtherHoldingSend(doc.data(), plan) && holdingFingerprint(send.data()) === holdingFingerprint(doc.data())) :
            doc.data().candidateId !== plan.id && doc.data().status === "sent" &&
            local.docs.some(send => send.id === doc.data().candidateId && knownOtherHoldingSend(send.data(), plan)))))
          throw new Error("prior_holding_local_attempt_do_not_resend");
      }
    }
    if (now().getTime() - Date.parse(plan.observedAt) > 120_000) throw new Error("fresh_operator_readback_required");
    const { sourceEvidence, ...auditPlan } = plan;
    const common = { ...auditPlan, calculationMode: "live_studiomate_readback", templateCode: HOLDING_NOTICE_TEMPLATE_ID, title: HOLDING_NOTICE_TEMPLATE.name,
      type: "manual_review", dedupeKey: plan.id, sourceActionKey: plan.id, isTest: false,
      attempts: 1, maxAttempts: 1, reviewedByUid: plan.approval.approvedBy, reviewedAt: stamp(),
      payload: { holdingNotice: true, deliveryMode: automatic ? "automatic_live_readback" : "operator_verified_one_off",
        source: "studiomate_live_ticket_readback", ...(automatic ? { holdingEventId: plan.id, policyId: config.automaticPolicyId } : {}) },
      createdAt: stamp(), updatedAt: stamp(), lastError: null };
    tx.create(candidateRef, { ...common, candidateId: plan.id, status: "processing" });
    tx.create(sendRef, { ...common, candidateId: plan.id, sendId: plan.id, status: "processing", providerOutcome: "claimed_no_retry" });
    tx.create(claimRef, { candidateId: plan.id, memberId: plan.memberId, memberPhone: plan.memberPhone,
      issuanceFingerprint: plan.issuanceFingerprint, creationEvidenceFingerprint: plan.creationEvidenceFingerprint,
      approvedBy: plan.approval.approvedBy, status: "claimed", createdAt: stamp() });
    return true;
  });
  if (!claimed) return { ok: true, duplicateBlocked: true, id: plan.id, providerPostCount: 0 };
  let receipt;
  try {
    const response = await request("/messages/v4/send-many/detail", "POST", {
      messages: [{ to: plan.memberPhone, type: "ATA", kakaoOptions: { pfId: HOLDING_NOTICE_TEMPLATE.channelId,
        templateId: HOLDING_NOTICE_TEMPLATE_ID, disableSms: true, variables: plan.variables } }],
      strict: true, allowDuplicates: false, showMessageList: true,
    });
    const rows = Array.isArray(response.messageList) ? response.messageList : Object.values(response.messageList || {});
    if (Object.keys(response.failedMessageList || {}).length || rows.length !== 1 || !rows[0]?.messageId ||
        (rows[0].to && rows[0].to !== plan.memberPhone)) throw new Error("operator_provider_acceptance_unknown");
    receipt = { solapiMessageId: rows[0].messageId, solapiGroupId: rows[0].groupId || response.groupInfo?.groupId || "" };
    const batch = db.batch();
    batch.update(sendRef, { ...receipt, providerOutcome: "accepted_pending_readback", updatedAt: stamp() });
    batch.update(claimRef, { ...receipt, status: "accepted_pending_readback", updatedAt: stamp() });
    await batch.commit();
    const row = verifiedReceipt(await request(receiptLookup(plan)), plan, receipt.solapiMessageId);
    const delivered = row.status === "COMPLETE" && String(row.statusCode) === "4000";
    const final = db.batch();
    final.update(candidateRef, { status: "sent", sentAt: stamp(), updatedAt: stamp() });
    final.update(sendRef, { status: "done", providerOutcome: delivered ? "delivered_reconciled" : "accepted_verified",
      providerStatus: row.status, providerStatusCode: String(row.statusCode), updatedAt: stamp() });
    final.update(claimRef, { status: delivered ? "delivered" : "accepted", updatedAt: stamp() });
    await final.commit();
    return { ok: true, id: plan.id, ...receipt, providerPostCount: 1, deliveryComplete: delivered, summary: plan.summary };
  } catch (error) {
    const delivered = await db.runTransaction(async tx => {
      const send = (await tx.get(sendRef)).data(), claim = (await tx.get(claimRef)).data();
      if (send?.status === "done" && send.providerStatus === "COMPLETE" && send.providerStatusCode === "4000" &&
          send.solapiMessageId && claim?.status === "delivered" && claim.solapiMessageId === send.solapiMessageId)
        return { solapiMessageId: send.solapiMessageId, solapiGroupId: send.solapiGroupId };
      tx.update(candidateRef, { status: "failed", reasonCode: "holding_operator_reconciliation_required", lastError: error.message, updatedAt: stamp() });
      tx.update(sendRef, { ...(receipt || {}), status: "failed", providerOutcome: "unknown_do_not_retry", lastError: error.message, updatedAt: stamp() });
      tx.update(claimRef, { ...(receipt || {}), status: "reconciliation_required", updatedAt: stamp() });
      return null;
    }).catch(() => null);
    if (delivered) return { ok: true, id: plan.id, ...delivered, providerPostCount: 1, deliveryComplete: true, summary: plan.summary };
    throw error;
  }
}

export async function reconcileVerifiedOperatorHolding({ db, stamp, id, request }) {
  const sendRef = db.doc(`alimtalkSends/${id}`), ledger = (await sendRef.get()).data();
  if (!ledger || ledger.isTest !== false || !["operator_verified_one_off", "automatic_live_readback"].includes(ledger.payload?.deliveryMode) ||
      ledger.templateCode !== HOLDING_NOTICE_TEMPLATE_ID || !ledger.solapiMessageId || ledger.id !== id)
    throw new Error("matching_operator_receipt_required");
  const row = verifiedReceipt(await request(receiptLookup(ledger)), ledger, ledger.solapiMessageId);
  if (row.status !== "COMPLETE" || String(row.statusCode) !== "4000")
    return { ok: true, id, deliveryComplete: false, providerStatus: row.status, providerStatusCode: row.statusCode, providerPostCount: 0 };
  const batch = db.batch();
  batch.update(db.doc(`alimtalkCandidates/${id}`), { status: "sent", lastError: null, sentAt: stamp(), updatedAt: stamp() });
  batch.update(sendRef, { status: "done", providerOutcome: "delivered_reconciled", providerStatus: row.status,
    providerStatusCode: "4000", lastError: null, reconciledAt: stamp(), updatedAt: stamp() });
  batch.update(db.doc(`holdingNoticeClaims/${id}`), { status: "delivered", updatedAt: stamp() });
  await batch.commit();
  return { ok: true, id, messageId: row.messageId, groupId: row.groupId, deliveryComplete: true, providerPostCount: 0 };
}
