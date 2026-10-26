import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID, holdingTemplateIssue } from "./holding-allowance-notice.mjs";
import { randomUUID } from "node:crypto";
import { memberDispatchWindow, assertMemberDispatchAllowed, isMemberDispatchDeferred } from "./member-dispatch-window.mjs";
import { holdingFingerprint, normalizeHoldingObservation } from "./studiomate-holding-source.mjs";
import { completeProviderRows } from "./holding-notice-test-dispatch.mjs";
import { calculateLiveHolding, verifyHoldingAtDispatch } from "./holding-notice-live-readback.mjs";
import { HOLDING_AUTO_EVENTS, automaticHoldingEventIssue } from "./holding-notice-automatic.mjs";
import { readHoldingMemberProfile } from "./holding-member-identity.mjs";
import { HOLDING_MEMO_POLICY, HOLDING_ACCEPTANCE_MEMO_POLICY, holdingMemoAcceptanceFingerprint, hasHoldingMemoAcceptance } from "./holding-delivery-memo.mjs";
import { holdingOperatorNoticeId, holdingPeriodChangeFingerprint } from "./holding-notice-identity.mjs";

const FAMILY = new Set([HOLDING_NOTICE_TEMPLATE_ID, "KA01TP261006054728079NtSGrYdtSQH"]);
export const isHoldingLedger = row => FAMILY.has(row?.templateCode) || row?.payload?.holdingNotice === true;

function sameChangeMetadata(row, source, claim = false) {
  if (row.noticePurpose !== source.noticePurpose || row.changeFingerprint !== source.changeFingerprint) return false;
  if (source.noticePurpose !== "holding_period_change") return true;
  if (row.originalNoticeId !== source.originalNoticeId) return false;
  return claim || row.periodChange && source.periodChange &&
    Object.keys(row.periodChange).length === Object.keys(source.periodChange).length &&
    Object.entries(source.periodChange).every(([key, value]) => row.periodChange[key] === value);
}

function safeQuietHolding(row, plan) {
  const proof = Array.isArray(row?.dispatchDeferrals) ? row.dispatchDeferrals.at(-1) : null;
  return row?.candidateId === plan.id && row.status === "deferred" && row.attempts === 0
    && typeof row.dispatchToken === "string" && row.dispatchToken.length > 0 && proof != null
    && row.providerOutcome === "quiet_deferred_no_transport" && !row.solapiMessageId
    && row.memberId === plan.memberId && row.memberPhone === plan.memberPhone
    && row.issuanceFingerprint === plan.issuanceFingerprint && row.creationEvidenceFingerprint === plan.creationEvidenceFingerprint
    && (row.noticePurpose || null) === (plan.noticePurpose || null) && (row.changeFingerprint || null) === (plan.changeFingerprint || null)
    && proof?.dispatchToken === row.dispatchToken && proof.providerPostCount === 0;
}

function knownOtherHoldingSend(row, plan) {
  if (!row || row.id === plan.id || row.status !== "done" || row.providerStatus !== "COMPLETE" ||
      row.providerStatusCode !== "4000" || row.templateCode !== HOLDING_NOTICE_TEMPLATE_ID ||
      row.memberId !== plan.memberId || row.memberPhone !== plan.memberPhone || row.studioId !== plan.studioId ||
      !["operator_verified_one_off", "automatic_live_readback"].includes(row.payload?.deliveryMode) || !row.solapiMessageId ||
      !/^[a-f0-9]{64}$/.test(row.issuanceFingerprint || "") || !/^[a-f0-9]{64}$/.test(row.creationEvidenceFingerprint || "")) return false;
  let expected;
  try { expected = holdingOperatorNoticeId(row); } catch { return false; }
  if (row.id !== expected || row.candidateId !== expected || row.sendId !== expected || row.isTest !== false ||
      row.issuanceFingerprint !== plan.issuanceFingerprint ||
      !normalizeHoldingObservation(plan.sourceEvidence).history.some(history => history.fingerprint === row.creationEvidenceFingerprint)) return false;
  if (row.noticePurpose === "holding_period_change") {
    let changes;
    try { changes = calculateLiveHolding(plan.sourceEvidence, { now: new Date(plan.observedAt) }).periodChanges; } catch { return false; }
    const source = changes.find(change => change.id === row.changeFingerprint);
    if (!source || !row.periodChange || Object.keys(source).length !== Object.keys(row.periodChange).length ||
        Object.entries(source).some(([key, value]) => row.periodChange[key] !== value) ||
        row.originalNoticeId !== holdingOperatorNoticeId({ ...row, noticePurpose: undefined, changeFingerprint: undefined })) return false;
    if (row.creationEvidenceFingerprint === plan.creationEvidenceFingerprint)
      return plan.noticePurpose === "holding_period_change" && source.changedAt < plan.periodChange.changedAt;
  } else if (row.noticePurpose != null || row.changeFingerprint != null || row.periodChange != null || row.originalNoticeId != null) return false;
  if (row.creationEvidenceFingerprint !== plan.creationEvidenceFingerprint) return true;
  return plan.noticePurpose === "holding_period_change" && !row.noticePurpose &&
    Number.isFinite(Date.parse(row.observedAt)) && Date.parse(row.observedAt) < Date.parse(plan.periodChange.changedAt);
}

export function verifiedOperatorHoldingPlan(raw, member, approval, now = new Date()) {
  const { observation: obs, summary, selected: current, periodChanges } = calculateLiveHolding(raw,
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
  if (approval.noticePurpose != null && approval.noticePurpose !== "holding_period_change") throw new Error("holding_notice_purpose_invalid");
  const identity = { studioId: obs.studioId, memberId: obs.memberId, issuanceFingerprint: obs.issuanceFingerprint, creationEvidenceFingerprint: current.id };
  const originalNoticeId = holdingOperatorNoticeId(identity);
  let changeFields = {};
  if (approval.noticePurpose === "holding_period_change") {
    const change = periodChanges.filter(row => row.creationEvidenceFingerprint === current.id).at(-1);
    if (!change || change.id !== approval.changeFingerprint || change.id !== holdingPeriodChangeFingerprint(change) ||
        change.start !== current.start || change.end !== current.end) throw new Error("holding_period_change_current_evidence_required");
    changeFields = { noticePurpose: "holding_period_change", changeFingerprint: change.id, periodChange: change, originalNoticeId };
  } else if (approval.changeFingerprint != null) throw new Error("holding_notice_purpose_invalid");
  const id = holdingOperatorNoticeId({ ...identity, ...changeFields });
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
    ...changeFields, approval, sourceEvidence: raw };
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
  automatic = false, now = () => new Date(Date.now()), memoPolicy = HOLDING_ACCEPTANCE_MEMO_POLICY }) {
  const deferred = () => ({ ...memberDispatchWindow(now()), ok: true, status: "deferred", providerPostCount: 0 });
  if (!memberDispatchWindow(now()).allowed) return deferred();
  let postStarted = false;
  try {
    const dispatchToken = randomUUID();
    if (![HOLDING_MEMO_POLICY, HOLDING_ACCEPTANCE_MEMO_POLICY].includes(memoPolicy)) throw new Error("holding_memo_policy_invalid");
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
      if (doc.id === plan.id && safeQuietHolding(row,plan)) continue;
      if (!knownOtherHoldingSend(row, plan) || known.has(row.solapiMessageId))
        throw new Error("prior_holding_local_attempt_do_not_resend");
      known.set(row.solapiMessageId, row);
    }
    if (plan.noticePurpose === "holding_period_change" && !local.docs.some(doc =>
      doc.id === plan.originalNoticeId && knownOtherHoldingSend(doc.data(), plan)))
      throw new Error("holding_period_change_delivered_original_required");
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
    assertMemberDispatchAllowed(now());
    const guardedReadLatest = typeof readLatest === "function" ? async (...args) => {
      const latest = await readLatest(...args);
      assertMemberDispatchAllowed(now());
      return latest;
    } : readLatest;
    if (typeof guardedReadLatest === "function")
      Object.defineProperty(guardedReadLatest, "length", { value: readLatest.length });
    plan = await verifyHoldingAtDispatch(plan, guardedReadLatest, verifiedOperatorHoldingPlan, now);
    const candidateRef = db.doc(`alimtalkCandidates/${plan.id}`), sendRef = db.doc(`alimtalkSends/${plan.id}`);
    const claimRef = db.doc(`holdingNoticeClaims/${plan.id}`);
    const claimed = await db.runTransaction(async tx => {
      const config = (await tx.get(db.doc("settings/holdingNotice"))).data();
      if (automatic) {
        const event = (await tx.get(db.doc(`${HOLDING_AUTO_EVENTS}/${plan.id}`))).data();
        const originalSend = plan.noticePurpose === "holding_period_change"
          ? (await tx.get(db.doc(`alimtalkSends/${plan.originalNoticeId}`))).data() : undefined;
        const issue = automaticHoldingEventIssue(event, plan, config, now(), originalSend, local.docs.map(doc => doc.data()));
        if (issue) throw new Error(issue);
      } else if (plan.noticePurpose === "holding_period_change") {
        throw new Error("holding_period_change_requires_automatic_policy");
      } else if (config?.autoSendEnabled !== false || config?.canonicalSourcePromoted !== false || config?.templateId !== HOLDING_NOTICE_TEMPLATE_ID)
        throw new Error("operator_dispatch_requires_separate_inactive_automation");
      const profile = await readHoldingMemberProfile({ db, memberId: plan.memberId, reader: tx });
      if (!profile || profile.memberId !== plan.memberId || profile.name !== plan.memberName || profile.phone !== plan.memberPhone || profile.studioId !== plan.studioId)
        throw new Error("operator_member_changed");
      const exclusion = await recipientIssue(tx, profile);
      if (exclusion) throw new Error(exclusion);
      for (const old of local.docs.filter(doc => isHoldingLedger(doc.data()) && !(doc.id === plan.id && safeQuietHolding(doc.data(),plan)))) {
        const row = old.data();
        const current = (await tx.get(db.doc(`alimtalkSends/${old.id}`))).data();
        const claim = (await tx.get(db.doc(`holdingNoticeClaims/${row.id}`))).data();
        if (!knownOtherHoldingSend(current, plan) || holdingFingerprint(current) !== holdingFingerprint(row) ||
            claim?.status !== "delivered" || claim.solapiMessageId !== row.solapiMessageId)
          throw new Error("prior_holding_claim_reconciliation_required");
      }
      const existing = [];
      for (const collection of ["alimtalkCandidates", "alimtalkSends", "holdingNoticeClaims"])
        existing.push(await tx.get(db.doc(`${collection}/${plan.id}`)));
      const resume = existing.every(row => row.exists && safeQuietHolding(row.data(),plan))
        && existing.every(row => row.data().dispatchToken === existing[0].data().dispatchToken);
      if (existing.some(row => row.exists) && !resume) return false;
      for (const collection of ["alimtalkCandidates", "alimtalkSends"]) {
        for (const [field, value] of [["memberId", plan.memberId], ["memberPhone", plan.memberPhone]]) {
          const rows = await tx.get(db.collection(collection).where(field, "==", value).limit(500));
          if (rows.size === 500 || rows.docs.some(doc => isHoldingLedger(doc.data()) && !(doc.id === plan.id && safeQuietHolding(doc.data(),plan)) &&
            !(collection === "alimtalkSends" ? local.docs.some(send => send.id === doc.id &&
                knownOtherHoldingSend(doc.data(), plan) && holdingFingerprint(send.data()) === holdingFingerprint(doc.data())) :
              doc.data().candidateId !== plan.id && doc.data().status === "sent" &&
              local.docs.some(send => send.id === doc.data().candidateId && knownOtherHoldingSend(send.data(), plan)))))
            throw new Error("prior_holding_local_attempt_do_not_resend");
        }
      }
      if (now().getTime() - Date.parse(plan.observedAt) > 120_000) throw new Error("fresh_operator_readback_required");
      if (!memberDispatchWindow(now()).allowed) return null;
      const { sourceEvidence, ...auditPlan } = plan;
      const dispatchDeferrals = resume ? existing[1].data().dispatchDeferrals : [];
      const common = { ...auditPlan, calculationMode: "live_studiomate_readback", templateCode: HOLDING_NOTICE_TEMPLATE_ID, title: HOLDING_NOTICE_TEMPLATE.name,
        type: "manual_review", dedupeKey: plan.id, sourceActionKey: plan.id, isTest: false,
        dispatchToken, dispatchDeferrals, attempts: 1, maxAttempts: 1, reviewedByUid: plan.approval.approvedBy, reviewedAt: stamp(),
        payload: { holdingNotice: true, deliveryMode: automatic ? "automatic_live_readback" : "operator_verified_one_off",
          source: "studiomate_live_ticket_readback", ...(automatic ? { holdingEventId: plan.id,
            policyId: plan.noticePurpose === "holding_period_change" ? config.periodChangeNotice.policyId : config.automaticPolicyId } : {}) },
        ...(resume ? {} : {createdAt: stamp()}), updatedAt: stamp(), lastError: null };
      const write = (ref, fields) => resume ? tx.update(ref, fields) : tx.create(ref, fields);
      write(candidateRef, { ...common, candidateId: plan.id, status: "processing", providerOutcome: "claimed_no_retry" });
      write(sendRef, { ...common, candidateId: plan.id, sendId: plan.id, status: "processing", providerOutcome: "claimed_no_retry",
        holdingMemoPolicy: memoPolicy, holdingMemoStatus: memoPolicy === HOLDING_MEMO_POLICY ? "waiting_delivery" : "waiting_acceptance",
        holdingMemoRanges: calculateLiveHolding(plan.sourceEvidence, {now:now()}).holds.map(({start,end})=>({start,end})) });
      write(claimRef, { dispatchToken, dispatchDeferrals, candidateId: plan.id, memberId: plan.memberId, memberPhone: plan.memberPhone,
        issuanceFingerprint: plan.issuanceFingerprint, creationEvidenceFingerprint: plan.creationEvidenceFingerprint,
        ...(plan.noticePurpose === "holding_period_change" ? { noticePurpose: plan.noticePurpose, changeFingerprint: plan.changeFingerprint,
          originalNoticeId: plan.originalNoticeId } : {}),
        approvedBy: plan.approval.approvedBy, status: "claimed", ...(resume ? {} : {createdAt: stamp()}) });
      return true;
    });
    if (claimed === null) return deferred();
    if (!claimed) return { ok: true, duplicateBlocked: true, id: plan.id, providerPostCount: 0 };
    let receipt;
    try {
      assertMemberDispatchAllowed(now());
      postStarted = true;
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
      const accepted = delivered || row.status === "SENDING" && /^[23]\d{3}$/.test(String(row.statusCode));
      if (memoPolicy === HOLDING_ACCEPTANCE_MEMO_POLICY && !accepted) throw new Error("holding_memo_acceptance_unverified");
      const acceptedAt = stamp();
      const acceptance = memoPolicy === HOLDING_ACCEPTANCE_MEMO_POLICY && accepted ? {
        holdingMemoAcceptedAt: acceptedAt, holdingMemoAcceptedMessageId: receipt.solapiMessageId,
        holdingMemoAcceptanceEvidence: "verified_provider_receipt",
        holdingMemoAcceptanceFingerprint: holdingMemoAcceptanceFingerprint({...plan, templateCode:HOLDING_NOTICE_TEMPLATE_ID, ...receipt}),
      } : {};
      const deliveryComplete = await db.runTransaction(async tx => {
        const current = (await tx.get(sendRef)).data(), claim = (await tx.get(claimRef)).data();
        const candidate = (await tx.get(candidateRef)).data();
        if (!current || current.solapiMessageId !== receipt.solapiMessageId || claim?.solapiMessageId !== receipt.solapiMessageId ||
            !candidate || !sameChangeMetadata(candidate, current) || !sameChangeMetadata(claim, current, true) ||
            current.holdingMemoPolicy !== memoPolicy || current.id !== plan.id || current.memberId !== plan.memberId ||
            current.memberPhone !== plan.memberPhone || current.message !== plan.message ||
            holdingMemoAcceptanceFingerprint(current) !== holdingMemoAcceptanceFingerprint({...plan,templateCode:HOLDING_NOTICE_TEMPLATE_ID,...receipt}))
          throw new Error("holding_acceptance_ledger_changed");
        const existingAcceptance = current.holdingMemoAcceptedMessageId ? {
          holdingMemoAcceptedAt:current.holdingMemoAcceptedAt, holdingMemoAcceptedMessageId:current.holdingMemoAcceptedMessageId,
          holdingMemoAcceptanceEvidence:current.holdingMemoAcceptanceEvidence,
          holdingMemoAcceptanceFingerprint:current.holdingMemoAcceptanceFingerprint,
        } : acceptance;
        if (current.holdingMemoAcceptedMessageId && (!hasHoldingMemoAcceptance(current,claim) ||
            current.holdingMemoAcceptanceFingerprint !== acceptance.holdingMemoAcceptanceFingerprint))
          throw new Error("holding_acceptance_ledger_changed");
        const finalDelivery = delivered || current.status === "done" && current.providerStatus === "COMPLETE" &&
          current.providerStatusCode === "4000" && claim.status === "delivered";
        const ready = (memoPolicy === HOLDING_MEMO_POLICY ? finalDelivery : accepted) &&
          ["waiting_acceptance","waiting_delivery"].includes(current.holdingMemoStatus);
        tx.update(candidateRef, { status: "sent", sentAt: stamp(), updatedAt: stamp() });
        tx.update(sendRef, { status: "done", providerOutcome: finalDelivery ? "delivered_reconciled" : "accepted_verified",
          providerStatus: finalDelivery ? "COMPLETE" : row.status, providerStatusCode: finalDelivery ? "4000" : String(row.statusCode),
          ...existingAcceptance, ...(ready ? {holdingMemoStatus:"ready"} : {}), updatedAt: stamp() });
        tx.update(claimRef, { status: finalDelivery ? "delivered" : "accepted", ...existingAcceptance, updatedAt: stamp() });
        return finalDelivery;
      });
      return { ok: true, id: plan.id, ...receipt, providerPostCount: 1, deliveryComplete, summary: plan.summary };
    } catch (error) {
      if (isMemberDispatchDeferred(error) && !postStarted) {
        await db.runTransaction(async tx => {
          const refs = [candidateRef, sendRef, claimRef];
          const rows = await Promise.all(refs.map(ref => tx.get(ref)));
          if (rows.some(row => row.data()?.dispatchToken !== dispatchToken || row.data()?.solapiMessageId))
            throw new Error("holding_quiet_claim_changed");
          if (rows[0].data().status !== "processing" || rows[1].data().status !== "processing" || rows[2].data().status !== "claimed")
            throw new Error("holding_quiet_claim_changed");
          const window = memberDispatchWindow(now());
          const proof = { dispatchToken, deferredAt: stamp(), providerPostCount: 0, reason: window.reason, nextAllowedAt: window.nextAllowedAt };
          for (const [index,ref] of refs.entries()) tx.update(ref, {
            status: "deferred", attempts: 0, providerOutcome: "quiet_deferred_no_transport", nextAllowedAt: window.nextAllowedAt,
            dispatchDeferrals: [...(rows[index].data().dispatchDeferrals || []),proof], updatedAt: stamp(),
          });
        });
        return deferred();
      }
      const verified = await db.runTransaction(async tx => {
        const send = (await tx.get(sendRef)).data(), claim = (await tx.get(claimRef)).data();
        const candidate = (await tx.get(candidateRef)).data();
        if (!send || !claim || !candidate || !sameChangeMetadata(candidate, send) || !sameChangeMetadata(claim, send, true))
          throw new Error("holding_acceptance_ledger_changed");
        if (send?.status === "done" && send.providerStatus === "COMPLETE" && send.providerStatusCode === "4000" &&
            send.solapiMessageId && claim?.status === "delivered" && claim.solapiMessageId === send.solapiMessageId)
          return { solapiMessageId: send.solapiMessageId, solapiGroupId: send.solapiGroupId, deliveryComplete:true };
        if (send?.holdingMemoPolicy===HOLDING_ACCEPTANCE_MEMO_POLICY && send.status==="done" &&
            candidate?.status==="sent" && claim?.status==="accepted" && hasHoldingMemoAcceptance(send,claim))
          return { solapiMessageId:send.solapiMessageId,solapiGroupId:send.solapiGroupId,deliveryComplete:false };
        tx.update(candidateRef, { status: "failed", reasonCode: "holding_operator_reconciliation_required", lastError: error.message, updatedAt: stamp() });
        tx.update(sendRef, { ...(receipt || {}), status: "failed", providerOutcome: "unknown_do_not_retry", lastError: error.message, updatedAt: stamp() });
        tx.update(claimRef, { ...(receipt || {}), status: "reconciliation_required", updatedAt: stamp() });
        return null;
      }).catch(() => null);
      if (verified) return { ok: true, id: plan.id, ...verified, providerPostCount: 1, summary: plan.summary };
      throw error;
    }
  } catch (error) {
    if (isMemberDispatchDeferred(error) && !postStarted) return deferred();
    throw error;
  }
}

export async function reconcileVerifiedOperatorHolding({ db, stamp, id, request }) {
  const sendRef = db.doc(`alimtalkSends/${id}`), ledger = (await sendRef.get()).data();
  if (!ledger || ledger.isTest !== false || !["operator_verified_one_off", "automatic_live_readback"].includes(ledger.payload?.deliveryMode) ||
      ledger.templateCode !== HOLDING_NOTICE_TEMPLATE_ID || !ledger.solapiMessageId || ledger.id !== id)
    throw new Error("matching_operator_receipt_required");
  if (holdingOperatorNoticeId(ledger) !== id || ledger.noticePurpose === "holding_period_change" &&
      (ledger.periodChange?.id !== ledger.changeFingerprint ||
       holdingPeriodChangeFingerprint(ledger.periodChange) !== ledger.changeFingerprint ||
       ledger.originalNoticeId !== holdingOperatorNoticeId({ ...ledger, noticePurpose: undefined, changeFingerprint: undefined })))
    throw new Error("matching_operator_receipt_required");
  const row = verifiedReceipt(await request(receiptLookup(ledger)), ledger, ledger.solapiMessageId);
  const delivered = row.status === "COMPLETE" && String(row.statusCode) === "4000";
  const recoverableAcceptance = ledger.holdingMemoPolicy===HOLDING_ACCEPTANCE_MEMO_POLICY &&
    ledger.holdingMemoStatus==="waiting_acceptance" && !ledger.holdingMemoAcceptedMessageId &&
    row.status==="SENDING" && /^[23]\d{3}$/.test(String(row.statusCode));
  if (!delivered && !recoverableAcceptance)
    return { ok: true, id, deliveryComplete: false, providerStatus: row.status, providerStatusCode: row.statusCode, providerPostCount: 0 };
  const deliveryComplete = await db.runTransaction(async tx => {
    const candidateRef = db.doc(`alimtalkCandidates/${id}`), claimRef = db.doc(`holdingNoticeClaims/${id}`);
    const current = (await tx.get(sendRef)).data();
    const candidate = (await tx.get(candidateRef)).data(), claim = (await tx.get(claimRef)).data();
    const identityKeys = ["id", "candidateId", "sendId", "memberId", "memberPhone", "studioId", "templateCode", "isTest",
      "message", "variables", "issuanceFingerprint", "creationEvidenceFingerprint", "payload", "observedAt", "solapiMessageId", "holdingMemoPolicy",
      "noticePurpose", "changeFingerprint", "periodChange", "originalNoticeId"];
    if (!current || identityKeys.some(key => holdingFingerprint(current[key] ?? null) !== holdingFingerprint(ledger[key] ?? null)) ||
        !candidate || !claim || candidate.candidateId !== id || claim.candidateId !== id ||
        !sameChangeMetadata(candidate, current) || !sameChangeMetadata(claim, current, true) ||
        claim.solapiMessageId !== current.solapiMessageId || [candidate,claim].some(other=>
          ["memberId","memberPhone","issuanceFingerprint","creationEvidenceFingerprint"].some(key=>other[key]!==current[key])))
      throw new Error("holding_receipt_ledger_changed");
    const needsAcceptance = current.holdingMemoPolicy===HOLDING_ACCEPTANCE_MEMO_POLICY &&
      current.holdingMemoStatus==="waiting_acceptance" && !current.holdingMemoAcceptedMessageId;
    if (!needsAcceptance && current.status === "done" && current.providerStatus === "COMPLETE" && current.providerStatusCode === "4000" &&
        candidate.status === "sent" && claim.status === "delivered" && claim.solapiMessageId === ledger.solapiMessageId) return true;
    if (!delivered && !needsAcceptance) return false;
    const finalDelivery = delivered || current.providerStatus === "COMPLETE" && current.providerStatusCode === "4000" && claim.status === "delivered";
    const at = stamp();
    const recoveredAcceptance = needsAcceptance ? {
        holdingMemoAcceptedAt:at, holdingMemoAcceptedMessageId:current.solapiMessageId,
        holdingMemoAcceptanceEvidence:"verified_provider_receipt",
        holdingMemoAcceptanceFingerprint:holdingMemoAcceptanceFingerprint(current),
      } : {};
    tx.update(candidateRef, { status: "sent", lastError: null, ...(candidate.sentAt ? {} : { sentAt: at }), updatedAt: at });
    tx.update(sendRef, { status: "done", providerOutcome: finalDelivery ? "delivered_reconciled" : "accepted_verified",
      providerStatus: finalDelivery ? "COMPLETE" : row.status,
      providerStatusCode: finalDelivery ? "4000" : String(row.statusCode), lastError: null, reconciledAt: at, updatedAt: at,
      ...recoveredAcceptance,
      ...(current.holdingMemoPolicy===HOLDING_MEMO_POLICY && current.holdingMemoStatus==="waiting_delivery" ||
          recoveredAcceptance.holdingMemoAcceptedMessageId ? {holdingMemoStatus:"ready"} : {}) });
    tx.update(claimRef, { status: finalDelivery ? "delivered" : "accepted", ...recoveredAcceptance, updatedAt: at });
    return finalDelivery;
  });
  return { ok: true, id, messageId: row.messageId, groupId: row.groupId, deliveryComplete,
    providerStatus:deliveryComplete ? "COMPLETE" : row.status,providerStatusCode:deliveryComplete ? "4000" : row.statusCode, providerPostCount: 0 };
}

/** Exact canonical attempt only. This path cannot create a candidate, claim or provider POST. */
export async function reconcileExistingHoldingAttempt({ db, stamp, plan, request }) {
  const send = (await db.doc(`alimtalkSends/${plan.id}`).get()).data();
  const claim = (await db.doc(`holdingNoticeClaims/${plan.id}`).get()).data();
  const candidate = (await db.doc(`alimtalkCandidates/${plan.id}`).get()).data();
  if (!send && !claim && !candidate) return null;
  if ([candidate, send, claim].every(row => safeQuietHolding(row, plan)) &&
      candidate.dispatchToken === send.dispatchToken && send.dispatchToken === claim.dispatchToken &&
      sameChangeMetadata(candidate, plan) && sameChangeMetadata(send, plan) && sameChangeMetadata(claim, plan, true)) return null;
  const matches = row => row && row.memberId === plan.memberId && row.memberPhone === plan.memberPhone &&
    row.issuanceFingerprint === plan.issuanceFingerprint && row.creationEvidenceFingerprint === plan.creationEvidenceFingerprint &&
    (row.noticePurpose || null) === (plan.noticePurpose || null) && (row.changeFingerprint || null) === (plan.changeFingerprint || null) &&
    row.candidateId === plan.id;
  if (!matches(send) || !matches(claim) || !matches(candidate) || send.id !== plan.id || send.sendId !== plan.id ||
      send.studioId !== plan.studioId || send.isTest !== false || send.templateCode !== HOLDING_NOTICE_TEMPLATE_ID ||
      !["operator_verified_one_off", "automatic_live_readback"].includes(send.payload?.deliveryMode) ||
      !send.solapiMessageId || claim.solapiMessageId !== send.solapiMessageId)
    throw new Error("holding_prior_claim_reconciliation_required");
  if (plan.noticePurpose === "holding_period_change" && (holdingOperatorNoticeId(send) !== plan.id ||
      !sameChangeMetadata(candidate, plan) || !sameChangeMetadata(claim, plan, true) ||
      send.originalNoticeId !== plan.originalNoticeId || !send.periodChange ||
      Object.keys(send.periodChange).length !== Object.keys(plan.periodChange).length ||
      Object.entries(plan.periodChange).some(([key, value]) => send.periodChange[key] !== value)))
    throw new Error("holding_prior_claim_reconciliation_required");
  const needsAcceptance = send.holdingMemoPolicy===HOLDING_ACCEPTANCE_MEMO_POLICY &&
    send.holdingMemoStatus==="waiting_acceptance" && !send.holdingMemoAcceptedMessageId;
  if (!needsAcceptance && send.status === "done" && send.providerStatus === "COMPLETE" && send.providerStatusCode === "4000" &&
      candidate.status === "sent" && claim.status === "delivered")
    return { id: plan.id, deliveryComplete: true, duplicateBlocked: true, providerPostCount: 0 };
  const receipt = await reconcileVerifiedOperatorHolding({ db, stamp, id: plan.id, request: (url, method) => {
    if (method && method !== "GET") throw new Error("holding_receipt_get_only");
    return request(url, "GET");
  } });
  if (["FAILED", "DELETED", "REJECTED"].includes(receipt.providerStatus) ||
      receipt.providerStatus === "COMPLETE" && String(receipt.providerStatusCode) !== "4000")
    throw new Error(`holding_receipt_terminal_failure:${receipt.providerStatusCode}`);
  return { ...receipt, duplicateBlocked: true };
}
