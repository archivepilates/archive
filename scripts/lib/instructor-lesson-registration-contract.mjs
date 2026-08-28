import { createHash } from "node:crypto";

export const INSTRUCTOR_LESSON_TICKET_NAME = "강사레슨 (2T)";
export const INSTRUCTOR_LESSON_TICKET_PRICE = 70_000;
export const INSTRUCTOR_LESSON_NEW_MEMBER_TEST_PHONE = "01086488585";
export const INSTRUCTOR_MEMBER_EFORMSIGN_OPERATOR_FIELD_IDS = Object.freeze({
  ticketName: "ozinput_33",
  paymentAmount: "ozinput_34",
});
export const INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID = "a5b5ea6b85ec44c8bcb4af1e980e94eb";
export const INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_URL =
  `https://www.eformsign.com/eform/document/view_service.html?form_id=${INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID}`;
export const EFORMSIGN_PROGRESS_DOCUMENTS_URL =
  "https://www.eformsign.com/eform/document/document_list.html?mode=ip";
export const EFORMSIGN_COMPLETED_DOCUMENTS_URL =
  "https://www.eformsign.com/eform/document/document_list.html?mode=ai";

export function normalizeInstructorLessonPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^8210\d{8}$/.test(digits) ? `0${digits.slice(2)}` : digits;
}

export function normalizeInstructorLessonName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

export function instructorLessonRegistrationId(studioId, phone, lessonDate) {
  return `ilr_${createHash("sha256")
    .update(`${String(studioId || "").trim()}|${normalizeInstructorLessonPhone(phone)}|${String(lessonDate || "").trim()}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function exactMemberCandidates(candidates, { phone }) {
  const normalizedPhone = normalizeInstructorLessonPhone(phone);
  return (Array.isArray(candidates) ? candidates : []).filter((candidate) => {
    const candidatePhone = normalizeInstructorLessonPhone(candidate.phone || candidate.text);
    return candidatePhone === normalizedPhone;
  });
}

export function paymentMethodLabel(value) {
  return {
    card: "카드",
    cash: "현금",
    wiretransfer: "계좌이체",
  }[String(value || "")] || "";
}

export function isInstructorMemberGrade(value) {
  return /(^|\s)강사회원($|\s)|강사\s*회원/i.test(String(value || ""));
}

export function isInstructorLessonNewMemberTestRecipient(job) {
  return normalizeInstructorLessonName(job?.memberName) === "김기효"
    && normalizeInstructorLessonPhone(job?.memberPhone) === INSTRUCTOR_LESSON_NEW_MEMBER_TEST_PHONE;
}

export function selectExactInstructorLessonTicket(tickets, ticketName = INSTRUCTOR_LESSON_TICKET_NAME) {
  const expected = normalizeComparable(ticketName);
  const matches = (Array.isArray(tickets) ? tickets : []).filter(
    (ticket) => normalizeComparable(ticket.title || ticket.name || ticket.text) === expected,
  );
  if (matches.length !== 1) {
    throw new Error(`StudioMate ${ticketName} 수강권이 ${matches.length}건입니다. 정확히 1건이어야 합니다.`);
  }
  return matches[0];
}

export function deriveInstructorLessonRegistrationState({ mode, steps = {} }) {
  const status = (key) => String(steps?.[key]?.status || "pending");
  const normalizedMode = String(mode || "");
  const requiredSteps = ["member", "ticket", "confirmation"];
  if (normalizedMode === "new_member") requiredSteps.push("eformsign", "memo");
  if (requiredSteps.some((key) => ["review_required", "failed"].includes(status(key)))) {
    return { status: "action_required", nextAction: "확인필요 항목 검토" };
  }
  if (!["new_member", "returning_member"].includes(normalizedMode)) {
    return { status: "processing", nextAction: "StudioMate 회원 유형 확인" };
  }
  if (status("member") !== "verified" || status("ticket") !== "verified") {
    return { status: "processing", nextAction: "회원·수강권 검증 중" };
  }

  if (normalizedMode === "new_member") {
    if (status("eformsign") !== "verified") {
      return { status: "waiting_signature", nextAction: "강사회원 가입서 발송·작성 대기" };
    }
    if (status("memo") !== "verified") {
      return { status: "memo_pending", nextAction: "StudioMate 가입서 완료 메모 반영 대기" };
    }
  }
  if (["verified", "not_required"].includes(status("confirmation"))) {
    return { status: "completed", nextAction: "없음" };
  }
  return { status: "confirmation_pending", nextAction: "수강권 발급 후 예약확정 알림톡 자동 발송 대기" };
}

export function buildInstructorMemberDocumentName(job, date = new Date()) {
  const dateText = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const suffix = String(job.registrationId || job.jobId || "").replace(/[^a-zA-Z0-9]/g, "").slice(-8);
  return `${dateText}_강사회원가입서_${normalizeInstructorLessonName(job.memberName)}_${suffix || "member"}`;
}

export function buildInstructorMemberRecipientMessage() {
  return "ARCHIVE PILATES 강사레슨 참여를 위한 강사회원 가입서를 작성해 주세요.";
}

export function staleExternalActionStatus(job, reviewStatus = "review_required") {
  if (job?.externalEffectStarted || job?.effectStartedAt || /^(sending|writing)$/i.test(String(job?.status || ""))) {
    return reviewStatus;
  }
  return Number(job?.attempts || 0) >= Number(job?.maxAttempts || 3) ? "failed" : "retry";
}

export function formatInstructorLessonPhone(phone) {
  return normalizeInstructorLessonPhone(phone).replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
}

function normalizeComparable(value) {
  return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
}
