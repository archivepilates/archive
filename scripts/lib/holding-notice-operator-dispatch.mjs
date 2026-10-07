import { calculateHoldingAllowance, HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID, holdingTemplateIssue } from "./holding-allowance-notice.mjs";
import { holdingFingerprint, normalizeHoldingObservation, sourceDate, sourceInstant } from "./studiomate-holding-source.mjs";
import { completeProviderRows } from "./holding-notice-test-dispatch.mjs";

const FAMILY = new Set([HOLDING_NOTICE_TEMPLATE_ID, "KA01TP261006054728079NtSGrYdtSQH"]);
export const isHoldingLedger = row => FAMILY.has(row?.templateCode) || row?.payload?.holdingNotice === true;

// Deliberately narrower than automatic reconciliation: only unchanged creation events are supported.
export function verifiedOperatorHoldingPlan(raw, member, approval, now = new Date()) {
  const obs = normalizeHoldingObservation(raw);
  if (obs.studioId !== "5330" || member?.memberId !== obs.memberId || member.studioId !== obs.studioId ||
      member.name !== obs.memberName || !/^01[016789]\d{7,8}$/.test(member.phone || "")) throw new Error("operator_member_identity_mismatch");
  const age = now.getTime() - Date.parse(obs.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 120_000) throw new Error("fresh_operator_readback_required");
  if (approval?.confirmed !== true || !approval.reason?.trim() || !approval.approvedBy?.trim() ||
      approval.observationFingerprint !== obs.observationFingerprint ||
      approval.memberId !== obs.memberId || approval.memberPhone !== member.phone)
    throw new Error("observation_bound_operator_approval_required");
  const rows = obs.history.filter(row => /정지|홀딩/.test(row.type) || row.changes.some(c => /정지|홀딩/.test(c.field)));
  if (!rows.length || rows.some(row => row.type.replace(/\s/g, "") !== "수강권정지"))
    throw new Error("hold_edit_or_cancellation_requires_identity_review");
  const holds = rows.map(row => {
    const start = row.changes.find(c => c.field === "정지시작일");
    const end = row.changes.find(c => c.field === "정지종료일");
    if (start?.before !== "내역없음" || end?.before !== "내역없음") throw new Error("hold_creation_evidence_required");
    return { id: row.fingerprint, creationEvidenceFingerprint: row.fingerprint,
      start: sourceDate(start.after), end: sourceDate(end.after), registeredAt: sourceInstant(row.at),
      status: "registered", kind: "member", evidenceRef: `${obs.memberUrl}#hold-${row.fingerprint}` };
  });
  const ranges = holds.map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  if (JSON.stringify(ranges) !== JSON.stringify(obs.activeHolds)) throw new Error("operator_history_and_controls_mismatch");
  const current = holds.find(hold => hold.creationEvidenceFingerprint === approval.creationEvidenceFingerprint);
  if (!current) throw new Error("approved_hold_creation_missing");
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start <= ranges[i - 1].end) throw new Error("overlapping_hold_identity_review_required");
  }
  const summary = calculateHoldingAllowance({ originalPeriod: obs.originalPeriod, holds, holdsComplete: true });
  if (!summary.ok || summary.overageDays) throw new Error(summary.reason || "holding_allowance_overage");
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

export async function dispatchVerifiedOperatorHolding({ db, stamp, plan, template, request, recipientIssue, now = () => new Date() }) {
  plan = structuredClone(plan);
  const issue = holdingTemplateIssue(template);
  if (issue) throw new Error(issue);
  const verified = verifiedOperatorHoldingPlan(plan.sourceEvidence, { memberId: plan.memberId, name: plan.memberName, phone: plan.memberPhone, studioId: plan.studioId }, plan.approval, now());
  if (holdingFingerprint(verified) !== holdingFingerprint(plan)) throw new Error("operator_plan_changed_after_approval");
  // The whole holding-template family is audited, not just this version or this execution date.
  const params = new URLSearchParams({ to: plan.memberPhone, type: "ATA", dateType: "CREATED", limit: "500",
    startDate: "2026-10-06T00:00:00+09:00", endDate: now().toISOString() });
  const prior = completeProviderRows(await request(`/messages/v4/list?${params}`));
  if (prior.some(row => FAMILY.has(row.kakaoOptions.templateId))) throw new Error("prior_holding_provider_receipt_do_not_resend");
  const candidateRef = db.doc(`alimtalkCandidates/${plan.id}`), sendRef = db.doc(`alimtalkSends/${plan.id}`);
  const claimRef = db.doc(`holdingNoticeClaims/${plan.id}`);
  const claimed = await db.runTransaction(async tx => {
    const config = (await tx.get(db.doc("settings/holdingNotice"))).data();
    if (config?.autoSendEnabled !== false || config?.canonicalSourcePromoted !== false || config?.templateId !== HOLDING_NOTICE_TEMPLATE_ID)
      throw new Error("operator_dispatch_requires_separate_inactive_automation");
    const profile = (await tx.get(db.doc(`memberProfiles/${plan.memberId}`))).data();
    if (!profile || profile.memberId !== plan.memberId || profile.name !== plan.memberName || profile.phone !== plan.memberPhone || profile.studioId !== plan.studioId)
      throw new Error("operator_member_changed");
    const exclusion = await recipientIssue(tx, profile);
    if (exclusion) throw new Error(exclusion);
    for (const collection of ["alimtalkCandidates", "alimtalkSends", "holdingNoticeClaims"]) {
      const existing = await tx.get(db.doc(`${collection}/${plan.id}`));
      if (existing.exists) return false;
    }
    for (const collection of ["alimtalkCandidates", "alimtalkSends"]) {
      for (const [field, value] of [["memberId", plan.memberId], ["memberPhone", plan.memberPhone]]) {
        const rows = await tx.get(db.collection(collection).where(field, "==", value).limit(500));
        if (rows.size === 500 || rows.docs.some(doc => isHoldingLedger(doc.data())))
          throw new Error("prior_holding_local_attempt_do_not_resend");
      }
    }
    if (now().getTime() - Date.parse(plan.observedAt) > 120_000) throw new Error("fresh_operator_readback_required");
    const common = { ...plan, templateCode: HOLDING_NOTICE_TEMPLATE_ID, title: HOLDING_NOTICE_TEMPLATE.name,
      type: "manual_review", dedupeKey: plan.id, sourceActionKey: plan.id, isTest: false,
      attempts: 1, maxAttempts: 1, reviewedByUid: plan.approval.approvedBy, reviewedAt: stamp(),
      payload: { holdingNotice: true, deliveryMode: "operator_verified_one_off", source: "studiomate_verified_normalized_file" },
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
    const batch = db.batch();
    batch.update(candidateRef, { status: "failed", reasonCode: "holding_operator_reconciliation_required", lastError: error.message, updatedAt: stamp() });
    batch.update(sendRef, { ...(receipt || {}), status: "failed", providerOutcome: "unknown_do_not_retry", lastError: error.message, updatedAt: stamp() });
    batch.update(claimRef, { ...(receipt || {}), status: "reconciliation_required", updatedAt: stamp() });
    await batch.commit().catch(() => {});
    throw error;
  }
}

export async function reconcileVerifiedOperatorHolding({ db, stamp, id, request }) {
  const sendRef = db.doc(`alimtalkSends/${id}`), ledger = (await sendRef.get()).data();
  if (!ledger || ledger.isTest !== false || ledger.payload?.deliveryMode !== "operator_verified_one_off" ||
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
