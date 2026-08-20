import { createHash } from "node:crypto";

export const EFORMSIGN_REFUND_TEMPLATE_ID = "fbdd279c2d7447938bc4e997f249c7b5";
export const EFORMSIGN_REFUND_TEMPLATE_URL =
  `https://www.eformsign.com/eform/document/view_service.html?form_id=${EFORMSIGN_REFUND_TEMPLATE_ID}`;
export const EFORMSIGN_PROGRESS_DOCUMENTS_URL =
  "https://www.eformsign.com/eform/document/document_list.html?mode=ip";

export const EFORMSIGN_REFUND_FIELD_IDS = Object.freeze({
  memberName: "ozinput_24",
  memberPhone: "ozinput_27",
  paymentAmount: "ozinput_29",
  penaltyAmount: "ozinput_30",
  usedAmount: "ozinput_31",
  refundAmount: "ozinput_32",
  companySignerName: "ozinput_38",
  companySignature: "oziviw_39",
});

export function normalizeRefundJob(raw = {}) {
  const memberName = cleanText(raw.memberName, 40);
  const memberPhone = normalizePhone(raw.memberPhone);
  const templateId = cleanText(raw.templateId, 80);
  const ticketExpiresAt = cleanText(raw.ticketExpiresAt, 40);
  const memberId = cleanText(raw.memberId, 120);
  const studioId = cleanText(raw.studioId, 120);
  if (!memberName) throw new Error("환불동의서 회원명이 없습니다.");
  if (!/^010\d{8}$/.test(memberPhone)) throw new Error("환불동의서 연락처가 올바르지 않습니다.");
  if (templateId !== EFORMSIGN_REFUND_TEMPLATE_ID) throw new Error("승인되지 않은 환불동의서 템플릿입니다.");
  if (!memberId || !studioId) throw new Error("환불동의서 회원·스튜디오 원천이 없습니다.");
  const job = {
    jobId: cleanText(raw.jobId, 120),
    caseId: cleanText(raw.caseId, 120),
    memberName,
    memberPhone,
    memberId,
    studioId,
    ticketName: cleanText(raw.ticketName, 120),
    ticketKey: cleanText(raw.ticketKey, 160),
    ticketExpiresAt,
    ticketSourceSnapshot: normalizeQueuedTicketSourceSnapshot(raw.ticketSourceSnapshot),
    paymentAmount: money(raw.paymentAmount, "결제금액"),
    penaltyAmount: money(raw.penaltyAmount, "위약금"),
    usedAmount: money(raw.usedAmount, "사용·혜택 공제액"),
    refundAmount: money(raw.refundAmount, "예상 환불금액"),
    calculationHash: cleanText(raw.calculationHash, 80),
    templateId,
  };
  assertRefundJobStillWithinValidity(job);
  return job;
}

export function assertRefundJobStillWithinValidity(job, now = new Date()) {
  if (!job.ticketExpiresAt) throw new Error("수강권 유효기간 원천이 없어 환불동의서 발송을 중단했습니다.");
  const expiresAtMs = new Date(job.ticketExpiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) throw new Error("환불동의서 수강권 만료일이 올바르지 않습니다.");
  if (now.getTime() > expiresAtMs) throw new Error("수강권이 만료되어 환불동의서 발송을 중단했습니다.");
}

export function currentRefundTicketSourceSnapshot(ticket) {
  const snapshot = {
    ticketKey: refundTicketKey(ticket),
    ticketName: cleanText(ticket?.name, 120),
    status: cleanText(ticket?.status || "active", 40),
    paymentAmount: sourcePaymentAmount(ticket),
    totalCount: nullableSourceNumber(ticket?.maxCount ?? ticket?.usableCount),
    remainingCount: nullableSourceNumber(ticket?.remainingCount),
    availableFrom: timestampIso(ticket?.availableFrom),
    purchasedAt: timestampIso(ticket?.purchasedAt),
    paymentAt: timestampIso(ticket?.paymentAt),
    expiresAt: timestampIso(ticket?.expiresAt),
  };
  if (!snapshot.ticketKey || !snapshot.ticketName) throw new Error("수강권 원천 식별자가 없습니다.");
  return snapshot;
}

export function assertRefundSourceUnchanged(job, profile) {
  if (!profile || cleanText(profile.studioId, 120) !== job.studioId) {
    throw new Error("회원의 스튜디오 원천이 변경되어 환불동의서 발송을 중단했습니다.");
  }
  const tickets = Array.isArray(profile.activeTickets) ? profile.activeTickets : [];
  const liveTicket = tickets.find((ticket) => refundTicketKey(ticket) === job.ticketKey);
  if (!liveTicket) throw new Error("환불 대상 수강권을 현재 원천에서 찾지 못했습니다.");
  const liveSnapshot = currentRefundTicketSourceSnapshot(liveTicket);
  if (!isRefundCandidateStatus(liveSnapshot.status)) {
    throw new Error("환불 대상 수강권 상태가 변경되어 발송을 중단했습니다.");
  }
  assertRefundJobStillWithinValidity({ ticketExpiresAt: liveSnapshot.expiresAt });
  if (JSON.stringify(liveSnapshot) !== JSON.stringify(job.ticketSourceSnapshot)) {
    throw new Error("환불 대상 수강권의 금액·사용·유효기간 원천이 변경되었습니다. 다시 계산하세요.");
  }
  return liveSnapshot;
}

export function staleRefundJobRecoveryStatus(job) {
  if (job?.sendClickedAt || String(job?.status || "") === "sending") return "send_review_required";
  return Number(job?.attempts || 0) >= Number(job?.maxAttempts || 3) ? "failed" : "retry";
}

export function buildRefundDocumentName(job, date = new Date()) {
  const dateText = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const caseSuffix = String(job.caseId || job.jobId || "").replace(/[^a-zA-Z0-9]/g, "").slice(-8);
  return `${dateText}_환불동의서_${cleanText(job.memberName, 20)}_${caseSuffix || "case"}`;
}

export function buildRefundRecipientMessage() {
  return "ARCHIVE PILATES 환불 예상금액을 확인한 뒤 환불동의서를 작성해 주세요. 실제 환불은 서명과 운영자 확인 후 처리됩니다.";
}

export function formatInputWon(value) {
  return `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
}

export function isUnambiguousSendSuccess({ url = "", bodyText = "", documentName = "", documentId = "" } = {}) {
  const text = String(bodyText || "").replace(/\s+/g, " ");
  const normalizedName = String(documentName || "").trim();
  if (!normalizedName || !text.includes(normalizedName) || !String(documentId || "").trim()) return false;
  const explicitSuccess = /문서(?:가|를)?\s*전송(?:되었습니다|했습니다| 완료)/.test(text)
    || /전송이\s*완료(?:되었습니다|됐습니다)/.test(text);
  const documentInSentList = /\/eform\/document\/(?:document_list\.html|list|doc_list|sent)/.test(String(url || ""))
    && /진행 중|처리 중|완료|수신자|문서함/.test(text);
  return explicitSuccess || documentInSentList;
}

export function extractEformsignDocumentId(url = "") {
  try {
    const parsed = new URL(String(url || ""));
    for (const key of ["document_id", "documentId", "doc_id"]) {
      const value = parsed.searchParams.get(key);
      if (value) return value.slice(0, 160);
    }
    return parsed.pathname.match(/\/document\/(?:view|detail)\/([^/?#]+)/)?.[1]?.slice(0, 160) || "";
  } catch {
    return "";
  }
}

function normalizeQueuedTicketSourceSnapshot(value) {
  if (!value || typeof value !== "object") throw new Error("환불동의서 수강권 원천 스냅샷이 없습니다.");
  return {
    ticketKey: cleanText(value.ticketKey, 160),
    ticketName: cleanText(value.ticketName, 120),
    status: cleanText(value.status || "active", 40),
    paymentAmount: nullableSourceNumber(value.paymentAmount),
    totalCount: nullableSourceNumber(value.totalCount),
    remainingCount: nullableSourceNumber(value.remainingCount),
    availableFrom: cleanText(value.availableFrom, 40) || null,
    purchasedAt: cleanText(value.purchasedAt, 40) || null,
    paymentAt: cleanText(value.paymentAt, 40) || null,
    expiresAt: cleanText(value.expiresAt, 40) || null,
  };
}

function refundTicketKey(ticket) {
  const userTicketId = cleanText(ticket?.userTicketId, 120);
  if (userTicketId) return `userTicket:${userTicketId}`;
  const ticketId = cleanText(ticket?.ticketId, 120);
  if (ticketId) return `ticket:${ticketId}`;
  return `derived:${createHash("sha256")
    .update(JSON.stringify({
      name: ticket?.name,
      availableFrom: timestampIso(ticket?.availableFrom),
      purchasedAt: timestampIso(ticket?.purchasedAt),
      paymentAt: timestampIso(ticket?.paymentAt),
    }))
    .digest("hex")
    .slice(0, 24)}`;
}

function sourcePaymentAmount(ticket) {
  for (const value of [ticket?.paymentAmount, ticket?.amountTotal, ticket?.price]) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) return Math.round(amount);
  }
  return null;
}

function nullableSourceNumber(value) {
  const numberValue = Number(value);
  return value == null || value === "" || !Number.isFinite(numberValue) ? null : numberValue;
}

function timestampIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  const seconds = Number(value._seconds ?? value.seconds);
  if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isRefundCandidateStatus(status) {
  return !["refunded", "cancelled", "canceled", "deleted", "inactive", "환불", "취소"]
    .includes(String(status || "active").toLowerCase());
}

function money(value, label) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return Math.round(numberValue);
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^8210\d{8}$/.test(digits) ? `0${digits.slice(2)}` : digits;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}
