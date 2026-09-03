import {
  assertRefundJobStillWithinValidity,
  assertRefundSourceUnchanged,
  staleRefundJobRecoveryStatus,
} from "./eformsign-refund-browser-contract.mjs";

export function normalizeRefundSmsJob(raw = {}) {
  const job = {
    jobId: cleanText(raw.jobId, 120),
    caseId: cleanText(raw.caseId, 120),
    studioId: cleanText(raw.studioId, 120),
    memberId: cleanText(raw.memberId, 120),
    studiomateMemberId: cleanText(raw.studiomateMemberId, 120),
    memberName: cleanText(raw.memberName, 40),
    memberPhone: normalizePhone(raw.memberPhone),
    ticketKey: cleanText(raw.ticketKey, 160),
    ticketName: cleanText(raw.ticketName, 120),
    ticketExpiresAt: cleanText(raw.ticketExpiresAt, 40),
    ticketSourceSnapshot: raw.ticketSourceSnapshot,
    calculationHash: cleanText(raw.calculationHash, 80),
    smsTitle: cleanText(raw.smsTitle, 80),
    smsMessage: String(raw.smsMessage || "").trim().slice(0, 3000),
  };
  if (!job.jobId || !job.caseId || !job.studioId || !job.memberId) {
    throw new Error("환불 문자 작업 식별자가 없습니다.");
  }
  if (!job.memberName || !/^010\d{8}$/.test(job.memberPhone)) {
    throw new Error("환불 문자 회원 원천이 올바르지 않습니다.");
  }
  if (!job.ticketKey || !job.calculationHash || !job.ticketSourceSnapshot) {
    throw new Error("환불 문자 수강권·계산 원천이 없습니다.");
  }
  if (job.smsTitle !== "ARCHIVE PILATES 환불 안내") {
    throw new Error("승인되지 않은 환불 문자 제목입니다.");
  }
  if (!job.smsMessage.startsWith("[ARCHIVE PILATES 환불 예상금액 안내]")) {
    throw new Error("승인되지 않은 환불 문자 본문입니다.");
  }
  assertRefundJobStillWithinValidity(job);
  return job;
}

export function assertRefundSmsSourceUnchanged(job, profile, refundCase) {
  assertRefundSourceUnchanged(job, profile);
  if (!refundCase || String(refundCase.studioId || "") !== job.studioId) {
    throw new Error("환불 케이스 원천이 없어 문자 발송을 중단했습니다.");
  }
  if (String(refundCase.calculationHash || "") !== job.calculationHash) {
    throw new Error("환불 계산값이 변경되었습니다. 다시 계산한 뒤 문자를 요청하세요.");
  }
  if (String(refundCase.smsNotice?.jobId || "") !== job.jobId) {
    throw new Error("현재 환불 문자 요청과 대기열 작업이 일치하지 않습니다.");
  }
}

export function staleRefundSmsJobRecoveryStatus(job) {
  return staleRefundJobRecoveryStatus(job);
}

export function classifyStudioMateSmsSendEvidence({ responseUrl = "", responseStatus = 0, dialogClosed = false } = {}) {
  const likelyMessageEndpoint = /message|sms|notification|send/i.test(String(responseUrl || ""));
  if (likelyMessageEndpoint && Number(responseStatus) >= 200 && Number(responseStatus) < 300 && dialogClosed) {
    return "sent";
  }
  return "send_review_required";
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^8210\d{8}$/.test(digits) ? `0${digits.slice(2)}` : digits;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}
