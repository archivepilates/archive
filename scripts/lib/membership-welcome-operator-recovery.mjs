import { createHash } from "node:crypto";
import { membershipContractMemberGradeDecision } from "./studiomate-membership-contract-native-selection.mjs";

export const RECOVERY_APPROVAL = "call_b0b9bc1e791041e2aec2ff0afa2007eb";
export const RECOVERY_APPROVAL_EXPIRES_AT = "2026-10-22T15:00:00.000Z";
export const RECOVERY_TARGETS = Object.freeze([
  ["5041630", "3bfa512dfdcf7560015d98645fc1b70bcf31335ce8029132d7afeba005731fe5", "심예슬"],
  ["5052201", "7b2467a9703b6ceb4e57373a8f34992bd2b7dd12c3b5521277aeb0d75e0f4280", "이소정"],
  ["5044408", "70f31d7818af47864f0bf674022bfddaac2122f6aaef7eaf0587ca1041a942bb", "정수빈2"],
  ["5037618", "92d3ba8e53fbc95625a9604b8829fc1d961c1a36ca6e029f743763713f555668", "김성환"],
  ["5031579", "abcd1ecae17048cedde7d62d8df779475da666ad9a004c026f4961eaabe8d1e5", "정세진"],
]);
export const recoveryHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = reason => { throw new Error(reason); };
const fresh = (at, now) => Number.isFinite(Date.parse(at)) && Date.parse(at) <= now && now - Date.parse(at) < 120000;
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function assertRecoveryEvidence({ source, memberResult, ticketRead, signature, readback, config, now }) {
  if(!Number.isFinite(now)||now>=Date.parse(RECOVERY_APPROVAL_EXPIRES_AT))fail("recovery_operator_approval_expired");
  const target = RECOVERY_TARGETS.find(([memberId,id,name]) => id === source?.contractId &&
    memberId === source.binding?.memberId && name === source.memberName);
  if (!target || source.source !== "studiomate_native_contract" || source.schemaVersion !== 1 ||
      source.bindingVerified !== true || source.status !== "signed" || source.studioId !== "5330" ||
      source.binding.contractAction !== "first_purchase_contract" || source.selection?.action !== "first_purchase_contract" ||
      source.selection?.member?.memberId !== target[0] ||
      source.selection?.ticket?.userTicketId !== source.binding.userTicketId ||
      source.selection?.ticket?.productId !== source.binding.productId) fail("recovery_source_outside_approval");
  if (config?.enabled !== true || config.mode !== "live" || config.sourcePromoted !== true ||
      config.nativeE2eVerified !== true || config.activationScope !== "production" || config.studioId !== "5330" ||
      !Number.isFinite(Date.parse(config.cutoverAt)))
    fail("recovery_live_config_required");
  const member = memberResult?.member;
  if (memberResult?.status !== "verified" || memberResult.matchCount !== 1 || member?.memberId !== target[0] ||
      member.name !== target[2] || member.phone !== source.binding.memberPhone || member.inactive ||
      membershipContractMemberGradeDecision(null,member).status !== "eligible" ||
      !Number.isFinite(Date.parse(member.registeredAt)) || Date.parse(member.registeredAt) <= Date.parse(config.cutoverAt))
    fail("recovery_current_recipient_ineligible");
  if (ticketRead?.status !== "verified" || !Array.isArray(ticketRead.tickets)) fail("recovery_complete_tickets_required");
  const tickets = ticketRead.tickets.filter(t => t.userTicketId === source.binding.userTicketId && t.productId === source.binding.productId);
  const ticket = tickets[0];
  if (tickets.length !== 1 || !config.regularProductIds?.includes(ticket.productId) ||
      ticket.memberId !== target[0] || ticket.studioId !== "5330" || !["active","scheduled"].includes(ticket.status) ||
      ticket.refunded !== false || ticket.cancelled !== false || ticket.payment?.verified !== true ||
      ticket.payment.complete !== true || ticket.payment.status !== "paid" || ticket.payment.refundedAmount !== 0 ||
      ticket.payment.outstandingAmount !== 0 || ticket.payment.totalAmount !== source.binding.expectedTotalAmount ||
      ticket.payment.paidAmount !== source.binding.expectedPaidAmount) fail("recovery_current_ticket_payment_ineligible");
  if (ticketRead.tickets.some(t => t.userTicketId !== ticket.userTicketId && config.regularProductIds.includes(t.productId) &&
      Date.parse(t.issuedAt) <= Date.parse(ticket.issuedAt))) fail("recovery_not_first_regular_purchase");
  if (signature?.status !== "signed" || !signature.receipt || signature.receipt.contractId !== target[1] ||
      signature.receipt.memberId !== target[0] || signature.receipt.userTicketId !== ticket.userTicketId ||
      signature.receipt.productId !== ticket.productId || !fresh(signature.receipt.checkedAt, now) ||
      !fresh(readback?.member?.checkedAt, now) || readback?.providerSignature?.signedAt !== signature.receipt.signedAt)
    fail("recovery_fresh_bound_signature_required");
  // Preserve the actual historic signing time. This permit is not a new completion event.
  if (source.signatureReceipt?.signedAt && source.signatureReceipt.signedAt !== signature.receipt.signedAt)
    fail("recovery_signature_time_changed");
  return target;
}

function noProviderMarker(value, depth=0) {
  if (depth > 6) return false;
  if (!value || typeof value !== "object") return true;
  return Object.entries(value).every(([key,entry]) => {
    if (entry == null || entry === "" || entry === false) return true;
    if (/provider|solapi|outbound|messageId|groupId|sentAt|delivered|dispatch|acceptedAt|attemptedAt|attemptStartedAt|sendingStartedAt|lastAttempt|sendStartedAt|response|receipt/i.test(key)) return false;
    return typeof entry !== "object" || noProviderMarker(entry, depth+1);
  });
}

export function assertRecoveryHistories({ local, provider, candidateId, candidate, send, source }) {
  if (local?.complete !== true || !local.memberIds.includes(source.binding.memberId) || provider?.complete !== true)
    fail("recovery_complete_local_and_provider_history_required");
  if (provider.records.length) fail("recovery_prior_provider_welcome_do_not_send");
  for (const row of local.records) {
    const old = row.sourceCollection === "alimtalkCandidates" ? candidate : row.sourceCollection === "alimtalkSends" ? send : null;
    // Only the independently diagnosed exact pre-transport failure may be recovered.
    if (source.binding.memberId !== "5041630" || row.sourceId !== candidateId || row.status !== "failed" ||
        !old || old.status !== "failed" || old.attempts !== 1 || old.maxAttempts !== 1 ||
        old.lastError !== "history_time_limit" || !noProviderMarker(old) ||
        old.candidateId !== candidateId || old.memberId !== source.binding.memberId ||
        old.memberPhone !== source.binding.memberPhone || old.studioId !== source.studioId ||
        old.templateCode !== "KA01TP260914091233543JoFDsn7KfCr") fail("recovery_prior_local_attempt_do_not_send");
  }
  if (Boolean(candidate) !== local.records.some(r => r.sourceCollection === "alimtalkCandidates" && r.sourceId === candidateId) ||
      Boolean(send) !== local.records.some(r => r.sourceCollection === "alimtalkSends" && r.sourceId === candidateId))
    fail("recovery_exact_history_not_reconciled");
}

export async function claimOperatorRecovery({ db, sourceSnap, configSnap, candidateSnap, sendSnap, local,
  candidateId, evidence, templateCode, profileSnapshots, stamp, now }) {
  const source = sourceSnap.data();
  const claimIds = [candidateId, ...local.memberIds.map(id => `member_${recoveryHash({studio:source.studioId,id})}`)];
  const refs = claimIds.map(id => db.doc(`membershipWelcomeClaims/${id}`));
  const approval = { reference: RECOVERY_APPROVAL, memberId:source.binding.memberId, contractId:source.contractId,
    candidateId, templateCode, reason:"operator_approved_historical_signed_welcome_once", evidenceHash:recoveryHash(evidence),
    checkedAt:evidence.checkedAt, signedAt:evidence.signedAt, expiresAt:new Date(now()+120000).toISOString() };
  await db.runTransaction(async tx => {
    const current = await tx.getAll(sourceSnap.ref, configSnap.ref, candidateSnap.ref, sendSnap.ref, ...refs);
    for (const [index,snapshot] of [sourceSnap,configSnap,candidateSnap,sendSnap].entries()) {
      if (snapshot.exists !== current[index].exists || (snapshot.exists &&
          !snapshot.updateTime.isEqual(current[index].updateTime))) fail("recovery_source_or_ledgers_changed");
    }
    if (current.slice(4).some(doc => doc.exists)) fail("recovery_permanent_claim_exists_do_not_send");
    if (!fresh(evidence.checkedAt,now())) fail("recovery_evidence_expired");
    if(now()>=Date.parse(RECOVERY_APPROVAL_EXPIRES_AT))fail("recovery_operator_approval_expired");
    const profiles=await tx.getAll(...local.memberIds.map(id=>db.doc(`memberProfiles/${id}`)));
    if(!Array.isArray(profileSnapshots)||profiles.some(doc=>{
      const initial=profileSnapshots.find(s=>s.id===doc.id);
      return !initial||!initial.updateTime.isEqual(doc.updateTime);
    }))fail("recovery_member_alias_graph_changed");
    if(profiles.some(doc=>!doc.exists || doc.data().studioId!==source.studioId || doc.data().phone.replace(/\D/g,"")!==source.binding.memberPhone ||
      doc.data().name!==source.memberName || membershipContractMemberGradeDecision(null,doc.data()).status!=="eligible"))
      fail("recovery_current_profile_changed");
    if (!fresh(evidence.checkedAt,now())||now()>=Date.parse(RECOVERY_APPROVAL_EXPIRES_AT))fail("recovery_evidence_expired");
    const at = stamp();
    const common = {candidateId,studioId:source.studioId,memberId:source.binding.memberId,memberName:source.memberName,
      memberPhone:source.binding.memberPhone,type:"membership_welcome",templateCode,
      title:"아카이브 신규회원 가입완료 웰컴 안내 v6",payload:{sourceContractId:source.contractId},dedupeKey:candidateId,
      attempts:1,maxAttempts:1,providerAttemptedAt:at,operatorRecovery:approval,updatedAt:at};
    for (const [snapshot,kind] of [[candidateSnap,"candidate"],[sendSnap,"send"]]) {
      const patch = {...common,status:"processing",...(kind==="send"?{sendId:candidateId}:{}),
        ...(snapshot.exists?{preRecoveryEvidence:snapshot.data()}:{createdAt:at})};
      if (snapshot.exists) tx.update(snapshot.ref,patch); else tx.create(snapshot.ref,patch);
    }
    for (const ref of refs) tx.create(ref,{candidateId,status:"attempting",attemptedAt:at,operatorRecovery:approval});
    tx.update(sourceSnap.ref,{welcomeCandidateId:candidateId,welcomeStatus:"review",welcomeReason:"operator_recovery_claimed_no_retry",
      operatorWelcomeRecovery:approval,updatedAt:at});
  });
  return {claimRefs:refs,approval};
}

export function assertRecoveryReceipt(row, source, template, messageId) {
  const expectedText = template.content.replaceAll("#{이름}",source.memberName);
  if (!row || row.messageId !== messageId || row.to !== source.binding.memberPhone ||
      row.kakaoOptions?.templateId !== template.templateId || row.kakaoOptions?.pfId !== template.channelId ||
      row.kakaoOptions?.disableSms !== true || row.text !== expectedText ||
      !same(row.kakaoOptions.variables,{"#{이름}":source.memberName})) fail("recovery_provider_receipt_mismatch");
  return row.status === "COMPLETE" && String(row.statusCode) === "4000";
}
