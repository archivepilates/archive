import { createHash, randomUUID } from "node:crypto";
import { isMemberDispatchDeferred } from "./member-dispatch-window.mjs";
import { contractReminderDispatchWindow, assertContractReminderDispatchAllowed } from "./contract-signature-reminder-window.mjs";
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
function safeReminderDeferral(row, id) {
  const proof = Array.isArray(row?.deferrals) ? row.deferrals.at(-1) : null;
  return row?.policy === CONTRACT_REMINDER_POLICY && row.key === `contract_signature_reminder_${id}`
    && typeof row.dispatchToken === "string" && row.dispatchToken.length > 0 && proof != null
    && row.status === "deferred" && row.attempts === 0 && row.deferredBeforeTransport === true && !row.smsId
    && proof?.dispatchToken === row.dispatchToken && proof.attemptedAt === row.attemptedAt
    && proof.fingerprint === row.fingerprint && proof.providerPostCount === 0;
}
const preclaimDiagnostics = Object.freeze({
  native_contract_signature_images_unavailable: "전자계약 직인·서명 이미지 로딩을 확인하지 못했습니다.",
  native_contract_center_signature_unverified: "전자계약 화면에서 센터 직인을 확인하지 못했습니다.",
  contract_reminder_member_page_not_ready: "문자 작성 전 회원 상세의 이름·전체 연락처 로딩을 확인하지 못했습니다.",
  contract_reminder_member_page_mismatch: "문자 작성 화면과 원본 회원이 일치하지 않습니다.",
  contract_reminder_message_action_unavailable: "회원 상세의 메시지 보내기 버튼을 사용할 수 없습니다.",
  contract_reminder_compose_unavailable: "문자 작성창이 준비되지 않았습니다.",
  contract_reminder_sms_input_missing: "문자 제목·본문 또는 수신자 입력칸을 확인하지 못했습니다.",
  contract_reminder_recipient_mismatch: "문자 작성창의 수신자가 원본 회원과 다릅니다.",
  contract_reminder_confirmation_unavailable: "최종 전송 전 문자 확인창이 준비되지 않았습니다.",
  contract_reminder_recipient_count_mismatch: "최종 문자 확인창이 정확히 1명인지 확인하지 못했습니다.",
});

export function contractReminderDiagnosticText(code) {
  return typeof code === "string" && Object.hasOwn(preclaimDiagnostics,code) ? preclaimDiagnostics[code] : "";
}

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
  if (source.operatorSignatureReRequest != null) return skip("operator_signature_rerequest_recorded");
  if (source.signatureReminder != null && !safeReminderDeferral(source.signatureReminder,id)) return skip("reminder_already_recorded");
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
  if (source.signatureReminder && source.signatureReminder.fingerprint !== fingerprint) return skip("deferred_reminder_binding_changed");
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
export async function processContractSignatureReminder({db,source,id,readLive,sendSms,now=()=>new Date(Date.now()),apply=false,scheduled=false}) {
  const deferred = () => ({...contractReminderDispatchWindow(now()),status:"deferred",contractId:id});
  if (!contractReminderDispatchWindow(now()).allowed) return deferred();
  const plan = planContractSignatureReminder(source,id,now());
  if (["attempting","review"].includes(source?.signatureReminder?.status))
    return {status:"review",contractId:id,stage:"postclaim",reason:"prior_attempt_requires_reconciliation"};
  if (plan.status !== "ready") return plan;
  if (!apply || !scheduled) return {status:"dry_run",reason:"no_dispatch",contractId:id};
  if (!contractReminderEnabled((await db.doc("systemSettings/membershipContractAutomation").get()).data())) return {status:"disabled"};
  let claimed = false;
  let dispatchStarted = false;
  const dispatchToken = randomUUID();
  let attemptedAt;
  const ref = db.doc(`studiomateMembershipContracts/${id}`);
  const settle = async patch => db.runTransaction(async tx=>{
    const row = (await tx.get(ref)).data()?.signatureReminder;
    if (row?.key !== plan.key || row.fingerprint !== plan.fingerprint) fail();
    if (row.status === "accepted") return row;
    tx.update(ref,{signatureReminder:{...row,...patch,updatedAt:now().toISOString()}});
    return {...row,...patch};
  });
  try {
    const live = await readLive();
    assertContractReminderDispatchAllowed(now());
    assertContractReminderLive(source,plan,live,now());
    const receipt = await sendSms(plan,async()=>{
      assertContractReminderDispatchAllowed(now());
      const fresh = await readLive();
      assertContractReminderDispatchAllowed(now());
      assertContractReminderLive(source,plan,fresh,now());
      await db.runTransaction(async tx=>{
        const latest=(await tx.get(ref)).data(),config=(await tx.get(db.doc("systemSettings/membershipContractAutomation"))).data();
        assertContractReminderDispatchAllowed(now());
        const current=planContractSignatureReminder(latest,id,now());
        if (!contractReminderEnabled(config) || current.status!=="ready" || current.fingerprint!==plan.fingerprint) fail();
        assertContractReminderDispatchAllowed(now());
        attemptedAt = now().toISOString();
        tx.update(ref,{signatureReminder:{policy:CONTRACT_REMINDER_POLICY,key:plan.key,fingerprint:plan.fingerprint,
          status:"attempting",attempts:1,firstConfirmedAt:plan.firstConfirmedAt,timingBasis:plan.timingBasis,
          dispatchToken,deferrals:latest.signatureReminder?.deferrals || [],
          attemptedAt,memberId:plan.memberId,updatedAt:now().toISOString()}});
      });
      claimed = true;
      assertContractReminderDispatchAllowed(now());
      return () => { dispatchStarted = true; };
    });
    if (!claimed || !Number.isSafeInteger(receipt?.smsId) || receipt.smsId <= 0) fail();
    const settled = await settle({status:"accepted",smsId:receipt.smsId,acceptedAt:now().toISOString(),deliveryStatus:"not_verified"});
    return {status:"accepted",contractId:id,stage:"postclaim",smsId:settled.smsId};
  } catch (error) {
    if (isMemberDispatchDeferred(error) && !dispatchStarted) {
      if (claimed) {
        const settled = await db.runTransaction(async tx=>{
          const row = (await tx.get(ref)).data()?.signatureReminder;
          if (row?.key !== plan.key || row.fingerprint !== plan.fingerprint) fail();
          if (row.status === "accepted") return row;
          if (row.status !== "attempting" || row.dispatchToken !== dispatchToken || row.attemptedAt !== attemptedAt) fail();
          const at = now().toISOString();
          tx.update(ref,{signatureReminder:{...row,status:"deferred",attempts:0,deferredBeforeTransport:true,
            reason:contractReminderDispatchWindow(now()).reason,nextAllowedAt:contractReminderDispatchWindow(now()).nextAllowedAt,
            deferrals:[...(row.deferrals || []),{dispatchToken,attemptedAt,fingerprint:plan.fingerprint,deferredAt:at,providerPostCount:0}],updatedAt:at}});
          return null;
        });
        if (settled?.status === "accepted") return {status:"accepted",contractId:id,stage:"postclaim",smsId:settled.smsId};
      }
      return deferred();
    }
    let reason = claimed ? "send_outcome_unknown" : "source_or_claim_unverified";
    if (claimed) {
      try {
        const settled = await settle({status:"review",reason});
        if (settled.status === "accepted") return {status:"accepted",contractId:id,stage:"postclaim",smsId:settled.smsId};
      } catch { reason = "send_outcome_unknown_journal_unavailable"; }
    }
    const errorCode = error?.code || error?.message;
    const diagnostic = !claimed && contractReminderDiagnosticText(errorCode) ? errorCode : null;
    return {status:"review",contractId:id,stage:claimed?"postclaim":"preclaim",reason,
      ...(diagnostic ? {diagnostic} : {})};
  }
}
