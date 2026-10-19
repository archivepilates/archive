import { createHash } from "node:crypto";
import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID, calculateHoldingAllowance } from "./holding-allowance-notice.mjs";
import { holdingFingerprint } from "./studiomate-holding-source.mjs";
import { readHoldingMemberProfile } from "./holding-member-identity.mjs";

export const HOLDING_MEMO_POLICY = "holding_delivery_memo_v1";
const source = "holding_notice_delivery";
const fail = () => { throw new Error("holding_delivery_memo_source_mismatch"); };
const digest = text => createHash("sha256").update(text).digest("hex");
const validDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const shortDate = value => `${Number(value.slice(5,7))}/${Number(value.slice(8,10))}`;
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

/** The sent calculation is an audit snapshot, never a source for a later allowance. */
export function holdingDeliveryMemoPlan(send, candidate, claim) {
  if (send?.holdingMemoPolicy !== HOLDING_MEMO_POLICY || send.studioId !== "5330" || !/^[1-9]\d*$/.test(send.memberId || "") ||
      !/^01[016789]\d{7,8}$/.test(send.memberPhone || "") || !send.memberName?.trim() || send.isTest !== false ||
      send.templateCode !== HOLDING_NOTICE_TEMPLATE_ID || send.calculationMode !== "live_studiomate_readback" ||
      send.payload?.holdingNotice !== true || send.payload.source !== "studiomate_live_ticket_readback" ||
      !["automatic_live_readback","operator_verified_one_off"].includes(send.payload.deliveryMode) ||
      !/^[a-f0-9]{64}$/.test(send.issuanceFingerprint || "") || !/^[a-f0-9]{64}$/.test(send.creationEvidenceFingerprint || "") ||
      send.attempts !== 1 || send.maxAttempts !== 1 || send.status !== "done" || send.providerStatus !== "COMPLETE" ||
      send.providerStatusCode !== "4000" || !send.solapiMessageId || candidate?.status !== "sent" || claim?.status !== "delivered") fail();
  const expected = `holding_operator_notice_${holdingFingerprint([send.studioId,send.memberId,send.issuanceFingerprint,send.creationEvidenceFingerprint])}`;
  if (send.id !== expected || send.sendId !== expected || send.candidateId !== expected || candidate.id !== expected || candidate.candidateId !== expected ||
      claim.candidateId !== expected || claim.solapiMessageId !== send.solapiMessageId ||
      [candidate,claim].some(row=>row.memberId !== send.memberId || row.memberPhone !== send.memberPhone ||
        row.issuanceFingerprint !== send.issuanceFingerprint || row.creationEvidenceFingerprint !== send.creationEvidenceFingerprint) ||
      candidate.studioId !== send.studioId || candidate.templateCode !== send.templateCode || candidate.memberName !== send.memberName ||
      candidate.isTest !== false || candidate.calculationMode !== send.calculationMode || candidate.message !== send.message ||
      !same(candidate.variables,send.variables) || !same(candidate.summary,send.summary) || !same(candidate.payload,send.payload)) fail();
  const ranges = send.holdingMemoRanges;
  if (!Array.isArray(ranges) || ranges.length < 1 || ranges.length > 100 || ranges.some(r=>!r || !validDay(r.start) || !validDay(r.end) || r.start > r.end)) fail();
  const sorted = [...ranges].sort((a,b)=>a.start.localeCompare(b.start));
  if (sorted.some((r,i)=>i>0 && r.start<=sorted[i-1].end)) fail();
  const summary = calculateHoldingAllowance({originalPeriod:{days:send.summary?.originalDays,source:"issuance_record",evidenceRef:send.id},holdsComplete:true,
    holds:sorted.map((r,i)=>({...r,id:String(i),status:"registered",kind:"member",evidenceRef:send.id}))});
  if (!summary.ok || summary.overageDays !== 0 || Object.keys(summary).some(key=>summary[key] !== send.summary?.[key])) fail();
  const v=send.variables, start=v?.["#{홀딩시작일}"], end=v?.["#{홀딩종료일}"];
  if (!v || v["#{이름}"] !== send.memberName || typeof v["#{수강권명}"] !== "string" || !v["#{수강권명}"].trim() ||
      !sorted.some(r=>r.start===start && r.end===end) ||
      v["#{이번홀딩일수}"] !== String((Date.parse(end)-Date.parse(start))/86400000+1) ||
      v["#{전체홀딩일수}"] !== String(summary.totalDays) || v["#{사용홀딩일수}"] !== String(summary.usedDays) ||
      v["#{잔여홀딩일수}"] !== String(summary.remainingDays) || Object.keys(v).length !== 8 ||
      send.message !== HOLDING_NOTICE_TEMPLATE.content.replace(/#\{[^}]+\}/g,key=>v[key])) fail();
  const observed = Date.parse(send.observedAt);
  if (typeof send.observedAt!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(send.observedAt) ||
      !Number.isFinite(observed) || new Date(observed).toISOString()!==send.observedAt) fail();
  const checkedDate = new Date(observed+9*3600_000).toISOString().slice(0,10);
  const memoId = `holding_notice_memo_${expected.slice("holding_operator_notice_".length)}`;
  const content = [`[홀딩 안내] ${v["#{수강권명}"]} · 최초 ${summary.originalDays}일권`,
    `홀딩 가능 ${summary.totalDays}일 · 사용 ${summary.usedDays}일 (${sorted.map(r=>`${shortDate(r.start)}~${shortDate(r.end)}`).join(", ")})`,
    `잔여 ${summary.remainingDays}일`, `이번 홀딩: ${start}~${end}`, `확인일: ${checkedDate}`,
    `[홀딩기록: ${memoId}]`].join("\n");
  return {memoId,content,contentHash:digest(content),studioId:send.studioId,memberId:send.memberId,memberName:send.memberName,
    memberPhone:send.memberPhone,holdingNoticeId:expected,solapiMessageId:send.solapiMessageId};
}

function matchesRecord(row, plan, job) {
  const keys=["studioId","memberId","memberName","holdingNoticeId","solapiMessageId","content","contentHash"];
  return row && keys.every(k=>row[k]===plan[k]) && row.source===source && row.holdingMemoPolicy===HOLDING_MEMO_POLICY &&
    (job ? row.jobId===plan.memoId && row.memberPhone===plan.memberPhone && row.studiomateMemberId===plan.memberId : row.memoId===plan.memoId);
}

export function assertHoldingMemoWriteSource({job,memo,send,candidate,claim}) {
  const plan=holdingDeliveryMemoPlan(send,candidate,claim);
  if (send.holdingMemoStatus!=="queued" || !matchesRecord(job,plan,true) || !matchesRecord(memo,plan,false) || job.profileUpdate || job.registrationId ||
      job.studiomateMemberId !== job.memberId) fail();
  return plan;
}

export function holdingMemoContentPresent(body, content) {
  const normalize = value => String(value || "").replace(/\s+/g," ").trim();
  return content?.startsWith("[홀딩 안내]") && content.includes("[홀딩기록: holding_notice_memo_") && normalize(body).includes(normalize(content));
}

export function assertHoldingMemoMemberProfile(profile, plan) {
  if (!profile || profile.memberId!==plan.memberId || profile.name!==plan.memberName || profile.phone!==plan.memberPhone ||
      profile.studioId!==plan.studioId || profile.status==="merged" || profile.externalActionEligible===false ||
      profile.canonicalMemberId && profile.canonicalMemberId!==plan.memberId || profile.mergedInto && profile.mergedInto!==plan.memberId) fail();
}

export async function enqueueDeliveredHoldingMemo({db,stamp,id}) {
  if (!/^holding_operator_notice_[a-f0-9]{64}$/.test(id)) fail();
  return db.runTransaction(async tx=>{
    const sendRef=db.doc(`alimtalkSends/${id}`), send=(await tx.get(sendRef)).data();
    if (send?.holdingMemoPolicy !== HOLDING_MEMO_POLICY) return {status:"not_enabled"};
    if (!["ready","queued"].includes(send.holdingMemoStatus)) return {status:"held"};
    const candidate=(await tx.get(db.doc(`alimtalkCandidates/${id}`))).data();
    const claim=(await tx.get(db.doc(`holdingNoticeClaims/${id}`))).data();
    const plan=holdingDeliveryMemoPlan(send,candidate,claim);
    const profile=await readHoldingMemberProfile({db,memberId:plan.memberId,reader:tx});
    assertHoldingMemoMemberProfile(profile,plan);
    const memoRef=db.doc(`memberMemos/${plan.memoId}`), jobRef=db.doc(`studiomateMemoWriteJobs/${plan.memoId}`);
    const memo=await tx.get(memoRef), job=await tx.get(jobRef);
    if (memo.exists || job.exists) {
      if (!matchesRecord(memo.data(),plan,false) || !matchesRecord(job.data(),plan,true)) fail();
      if (send.holdingMemoStatus !== "queued") tx.update(sendRef,{holdingMemoStatus:"queued",holdingMemoId:plan.memoId});
      return {status:"existing",memoId:plan.memoId};
    }
    if (send.holdingMemoStatus!=="ready") fail();
    const at=stamp(), common={studioId:plan.studioId,memberId:plan.memberId,memberName:plan.memberName,source,
      holdingMemoPolicy:HOLDING_MEMO_POLICY,holdingNoticeId:id,solapiMessageId:plan.solapiMessageId,
      content:plan.content,contentHash:plan.contentHash,createdAt:at,updatedAt:at};
    tx.create(memoRef,{...common,memoId:plan.memoId,lectureId:"",bookingId:"",lectureDate:"",staffId:"",staffName:"",
      memoType:"member_note",visibility:"staff_and_manager",syncStatus:"pending",createdByUid:"system:holding_notice"});
    tx.create(jobRef,{...common,jobId:plan.memoId,memberPhone:plan.memberPhone,studiomateMemberId:plan.memberId,
      status:"pending",writeMode:"playwright",attempts:0,maxAttempts:3,lastError:null});
    tx.update(sendRef,{holdingMemoStatus:"queued",holdingMemoId:plan.memoId,holdingMemoQueuedAt:at});
    return {status:"queued",memoId:plan.memoId};
  });
}

/** Exact new-policy ready outbox only; no historical scan, send retry or browser work. */
export async function enqueuePendingHoldingMemos({db,stamp,limit=10}) {
  if (!Number.isSafeInteger(limit) || limit<1 || limit>10) throw new Error("holding_memo_limit_invalid");
  const rows=await db.collection("alimtalkSends").where("holdingMemoPolicy","==",HOLDING_MEMO_POLICY)
    .where("holdingMemoStatus","==","ready").limit(limit).get();
  const results=[];
  for (const doc of rows.docs) {
    try { results.push({id:doc.id,...await enqueueDeliveredHoldingMemo({db,stamp,id:doc.id})}); }
    catch (error) {
      const status=await db.runTransaction(async tx=>{
        const ref=db.doc(`alimtalkSends/${doc.id}`), current=(await tx.get(ref)).data();
        if (current?.holdingMemoPolicy!==HOLDING_MEMO_POLICY || current.holdingMemoStatus!=="ready" ||
            holdingFingerprint(current)!==holdingFingerprint(doc.data())) return "changed";
        const attempts=Number(current.holdingMemoProjectionAttempts || 0)+1;
        const invalid=/^(holding_delivery_memo_|operator_member_changed|holding_(native_member|unique_linked|verified_member|member_lookup|member_phone))/.test(error.message || "");
        const next=invalid || attempts>=3 ? "review" : "ready";
        tx.update(ref,{holdingMemoStatus:next,holdingMemoProjectionAttempts:attempts,
          holdingMemoError:"holding_delivery_memo_source_or_queue_unavailable",holdingMemoCheckedAt:stamp(),
          ...(next==="review"?{holdingMemoAlertStatus:"pending"}:{})});
        return next==="ready"?"retry":"review";
      });
      results.push({id:doc.id,status,reason:"holding_delivery_memo_source_or_queue_unavailable"});
    }
  }
  return results;
}

export async function pendingHoldingMemoAlerts(db) {
  const rows=await db.collection("alimtalkSends").where("holdingMemoPolicy","==",HOLDING_MEMO_POLICY)
    .where("holdingMemoAlertStatus","==","pending").limit(10).get();
  return rows.docs.map(doc=>({id:doc.id,status:"review",reason:doc.data().holdingMemoError || "holding_delivery_memo_source_or_queue_unavailable"}));
}

export async function settleHoldingMemoAlert({db,stamp,id,observed,status}) {
  if (!/^holding_operator_notice_[a-f0-9]{64}$/.test(id) || !["sent","resolved"].includes(status)) fail();
  return db.runTransaction(async tx=>{
    const ref=db.doc(`alimtalkSends/${id}`), current=(await tx.get(ref)).data();
    if (!current || current.holdingMemoPolicy!==HOLDING_MEMO_POLICY || current.holdingMemoAlertStatus!=="pending" ||
        holdingFingerprint(current)!==holdingFingerprint(observed) || status==="resolved" && current.holdingMemoStatus==="review") return false;
    tx.update(ref,{holdingMemoAlertStatus:status,...(status==="sent" && !current.holdingMemoFailureEmailSentAt
      ?{holdingMemoFailureEmailSentAt:stamp()}:{})});
    return true;
  });
}
