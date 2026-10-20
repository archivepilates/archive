import { createHash } from "node:crypto";
import { membershipContractObservationHistory } from "./studiomate-membership-contract-completion-state.mjs";
import { membershipContractJobKey,normalizeMembershipPhone } from "./studiomate-membership-contract-policy.mjs";
import { membershipContractMemberGradeDecision } from "./studiomate-membership-contract-native-selection.mjs";

export const CONTRACT_REMINDER_POLICY = "contract_signature_reminder_24h_v1";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const instant = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? Date.parse(value) : NaN;
const nativeId = value => typeof value === "string" && /^[1-9]\d{0,63}$/.test(value);
const fail = diagnostic => {
  const error = new Error("contract_reminder_source_unverified");
  if (diagnostic) error.code = diagnostic;
  throw error;
};
const bindingKeys = ["studioId","memberId","userTicketId","productId","selectionJobKey","selectedAt"];

export function contractReminderEnabled(config) {
  return config?.studioId === "5330" && config.observeEnabled === true && config.sourcePromoted === true
    && config.mode === "live" && config.nativeE2eVerified === true
    && config.signatureReminderEnabled === true && config.signatureReminderPolicy === CONTRACT_REMINDER_POLICY;
}

export function planContractSignatureReminder(source, id, now = new Date()) {
  const b = source?.binding, ms = now.getTime(), skip = reason => ({status:"skipped",reason});
  if (!Number.isFinite(ms) || !/^[a-f0-9]{64}$/.test(id || "") || source?.schemaVersion !== 1
    || source.source !== "studiomate_native_contract" || source.studioId !== "5330" || source.contractId !== id
    || source.bindingVerified !== true || b?.verified !== true || b.contractId !== id || b.studioId !== "5330"
    || ![b.memberId,b.userTicketId,b.productId].every(nativeId) || !/^01[016789]\d{7,8}$/.test(b.memberPhone || "")
    || b.selectionJobKey !== membershipContractJobKey(b.memberId,b.userTicketId)
    || !["first_purchase_contract","renewal_purchase_confirmation"].includes(b.contractAction)
    || !source.memberName?.trim() || !b.title?.trim() || !Number.isFinite(instant(b.selectedAt))) return skip("invalid_source");
  if (source.status !== "waiting" || source.observationStatus !== "waiting" || source.observationHold === true
    || source.completion || source.signatureReceipt || source.invalidatedCompletion) return skip("not_unsigned");
  if (source.signatureReminder != null) return skip("reminder_already_recorded");
  let history;
  try { history = membershipContractObservationHistory(source); } catch { return skip("invalid_history"); }
  if (history.some(row=>["signed","cancelled","expired"].includes(row.status) || row.memberSignaturePresent===true
    || row.signedDate != null || row.signedDateText != null)) return skip("historical_signature_conflict");
  const sent = history.filter(row => row.schemaVersion === 1 && row.source === "studiomate_contract_dom"
    && row.verified === true && row.complete === true && row.status === "sent" && row.statusText === "요청대기"
    && row.contractId === id && row.memberName === source.memberName && row.memberPhone === b.memberPhone
    && row.title === b.title && row.centerSignaturePresent === true && row.memberSignaturePresent === false
    && row.signedDate == null && row.signedDateText == null
    && bindingKeys.every(key => row.bindingIdentity?.[key] === b[key])
    && instant(row.observedAt) >= instant(b.selectedAt) && instant(row.observedAt) <= ms);
  if (!sent.length) return skip("original_send_time_unverified");
  const firstConfirmedAt = sent.map(row=>row.observedAt).sort()[0];
  if (ms - instant(firstConfirmedAt) < 86400_000) return skip("under_24_hours");
  const hour = new Date(ms+9*3600_000).getUTCHours();
  if (hour < 9 || hour >= 20) return skip("outside_send_window");
  const smsTitle = "아카이브필라테스 전자계약서 서명 안내";
  const smsMessage = `[아카이브필라테스] ${source.memberName}님, 전달드린 전자계약서 서명이 아직 완료되지 않았습니다.\n아래 링크에서 내용을 확인하고 서명해 주세요.\nhttps://sign.studiomate.kr/${id}`;
  const key = `contract_signature_reminder_${id}`;
  const fingerprint = digest([key,source.memberName,Object.fromEntries(Object.entries(b).filter(([key])=>key!=="previousObservations").sort(([a],[b])=>a.localeCompare(b))),firstConfirmedAt,smsTitle,smsMessage]);
  return {status:"ready",key,contractId:id,memberId:b.memberId,memberPhone:b.memberPhone,memberName:source.memberName,
    studioId:b.studioId,firstConfirmedAt,timingBasis:"first_verified_sent_observation",smsTitle,smsMessage,fingerprint};
}

export function assertContractReminderLive(source, plan, live, now = new Date()) {
  const b = source.binding, c = live?.contract, dom = live?.dom, member = live?.memberResult?.member;
  if (dom && dom.centerSignaturePresent !== true) fail("native_contract_center_signature_unverified");
  if (!live || instant(live.checkedAt) > now.getTime() || now.getTime()-instant(live.checkedAt) > 60_000
    || !Number.isFinite(instant(live.checkedAt)) || live.memberResult?.status !== "verified" || live.memberResult.matchCount !== 1
    || member?.memberId !== b.memberId || member.phone !== b.memberPhone || member.name !== source.memberName || member.inactive === true
    || membershipContractMemberGradeDecision(null,member).status !== "eligible"
    || !c?.verified || !c.complete || c.contractId !== plan.contractId || c.studioId !== b.studioId || c.memberId !== b.memberId
    || c.title !== b.title || c.categoryId !== 1 || c.memberPhone !== b.memberPhone || c.memberName !== source.memberName
    || !["sent","opened"].includes(c.status) || c.memberSignaturePresent !== false || c.centerSignaturePresent !== true || c.signedAt
    || dom?.contractId !== plan.contractId || dom.title !== b.title || dom.memberName !== source.memberName || normalizeMembershipPhone(dom.memberPhone) !== b.memberPhone
    || dom.statusText !== "요청대기" || dom.memberSignaturePresent !== false || dom.centerSignaturePresent !== true || dom.signedDateText != null
    || !Number.isFinite(instant(dom.observedAt)) || dom.observedAt > live.checkedAt || now.getTime()-instant(dom.observedAt) > 60_000
    || live.ticketRead?.status !== "verified") fail();
  const tickets = live.ticketRead.tickets.filter(t=>t.userTicketId===b.userTicketId && t.productId===b.productId);
  if (tickets.length !== 1) fail();
  const t = tickets[0], p = t.payment;
  if (t.memberId !== b.memberId || t.studioId !== b.studioId || t.verified !== true || t.complete !== true
    || !["active","scheduled"].includes(t.status) || t.refunded !== false || t.cancelled !== false
    || !p?.verified || !p.complete || p.refundedAmount !== 0 || p.totalAmount !== b.expectedTotalAmount
    || !c.ticket || c.ticket.userTicketId !== b.userTicketId || c.ticket.productId !== b.productId
    || c.ticket.amount !== b.expectedPaidAmount || c.ticket.unpaidAmount !== b.expectedOutstandingAmount) fail();
}

/** One irreversible contract-scoped attempt; neither lost responses nor later runs resend. */
export async function processContractSignatureReminder({db,source,id,readLive,sendSms,now=()=>new Date(),apply=false,scheduled=false}) {
  const plan = planContractSignatureReminder(source,id,now());
  if (["attempting","review"].includes(source?.signatureReminder?.status))
    return {status:"review",contractId:id,stage:"postclaim",reason:"prior_attempt_requires_reconciliation"};
  if (plan.status !== "ready") return plan;
  if (!apply || !scheduled) return {status:"dry_run",reason:"no_dispatch",contractId:id};
  if (!contractReminderEnabled((await db.doc("systemSettings/membershipContractAutomation").get()).data())) return {status:"disabled"};
  let claimed = false;
  const ref = db.doc(`studiomateMembershipContracts/${id}`);
  const settle = async patch => db.runTransaction(async tx=>{
    const row = (await tx.get(ref)).data()?.signatureReminder;
    if (row?.key !== plan.key || row.fingerprint !== plan.fingerprint) fail();
    if (row.status === "accepted") return row;
    tx.update(ref,{signatureReminder:{...row,...patch,updatedAt:now().toISOString()}});
    return {...row,...patch};
  });
  try {
    assertContractReminderLive(source,plan,await readLive(),now());
    const receipt = await sendSms(plan,async()=>{
      assertContractReminderLive(source,plan,await readLive(),now());
      await db.runTransaction(async tx=>{
        const latest=(await tx.get(ref)).data(),config=(await tx.get(db.doc("systemSettings/membershipContractAutomation"))).data();
        const current=planContractSignatureReminder(latest,id,now());
        if (!contractReminderEnabled(config) || current.status!=="ready" || current.fingerprint!==plan.fingerprint) fail();
        tx.update(ref,{signatureReminder:{policy:CONTRACT_REMINDER_POLICY,key:plan.key,fingerprint:plan.fingerprint,
          status:"attempting",attempts:1,firstConfirmedAt:plan.firstConfirmedAt,timingBasis:plan.timingBasis,
          attemptedAt:now().toISOString(),memberId:plan.memberId,updatedAt:now().toISOString()}});
      });
      claimed = true;
    });
    if (!claimed || !Number.isSafeInteger(receipt?.smsId) || receipt.smsId <= 0) fail();
    const settled = await settle({status:"accepted",smsId:receipt.smsId,acceptedAt:now().toISOString(),deliveryStatus:"not_verified"});
    return {status:"accepted",contractId:id,stage:"postclaim",smsId:settled.smsId};
  } catch (error) {
    let reason = claimed ? "send_outcome_unknown" : "source_or_claim_unverified";
    if (claimed) {
      try {
        const settled = await settle({status:"review",reason});
        if (settled.status === "accepted") return {status:"accepted",contractId:id,stage:"postclaim",smsId:settled.smsId};
      } catch { reason = "send_outcome_unknown_journal_unavailable"; }
    }
    const diagnostic = !claimed && ["native_contract_signature_images_unavailable", "native_contract_center_signature_unverified"]
      .includes(error?.code) ? error.code : null;
    return {status:"review",contractId:id,stage:claimed?"postclaim":"preclaim",reason,
      ...(diagnostic ? {diagnostic} : {})};
  }
}
