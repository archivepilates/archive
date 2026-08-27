import { createHash } from "node:crypto";

export const INSTRUCTOR_LESSON_TICKET_NAME = "강사레슨 (2T)";
export const INSTRUCTOR_LESSON_EXPECTED_SESSIONS = 2;
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

export function selectInstructorLessonSessionCards(cards, lessonDate) {
  const expectedDate = String(lessonDate || "").slice(0, 10);
  const matches = (Array.isArray(cards) ? cards : []).filter((card) => card.date === expectedDate);
  if (matches.some((card) => card.full || card.disabled)) {
    throw new Error("강사레슨 두 세션 중 예약 마감 또는 선택 불가 수업이 있습니다.");
  }
  const unique = new Map(matches.map((card) => [`${card.date}|${card.time}|${card.instructor}|${card.title}`, card]));
  if (unique.size !== INSTRUCTOR_LESSON_EXPECTED_SESSIONS) {
    throw new Error(`선택 가능한 강사레슨 세션이 ${unique.size}건입니다. 정확히 2건이어야 합니다.`);
  }
  return [...unique.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

export function validateCanonicalInstructorLessonBookings(
  bookings,
  { phone, lessonDate, expectedSessions = [], notBeforeMs = 0 },
) {
  const normalizedPhone = normalizeInstructorLessonPhone(phone);
  const active = (Array.isArray(bookings) ? bookings : []).filter((booking) => {
    const sourceStatus = String(booking.sourceStatus || "").toLowerCase();
    const supersededBy = booking.supersededByBookingId || booking.sessionOrder?.supersededByBookingId;
    const sourceUpdatedAtMs = timestampMillis(booking.sourceUpdatedAt || booking.syncedAt || booking.updatedAt);
    return normalizeInstructorLessonPhone(booking.memberPhone) === normalizedPhone
      && String(booking.lectureDate || "").slice(0, 10) === lessonDate
      && String(booking.appStatus || "").toLowerCase() === "reserved"
      && normalizeComparable(booking.ticketName) === normalizeComparable(INSTRUCTOR_LESSON_TICKET_NAME)
      && !/(cancel|canceled|취소|deleted|삭제|superseded|duplicate|중복|제외)/i.test(sourceStatus)
      && !supersededBy
      && booking.archiveBooking?.isCanonical !== false
      && (!notBeforeMs || sourceUpdatedAtMs >= notBeforeMs);
  });
  const keys = active.map((booking) => canonicalBookingEvidenceKey(booking));
  const unique = new Set(keys);
  const expectedKeys = (Array.isArray(expectedSessions) ? expectedSessions : [])
    .map((session) => expectedSessionEvidenceKey(session))
    .filter(Boolean)
    .sort();
  const actualSessionKeys = active.map((booking) => bookingSessionEvidenceKey(booking)).sort();
  const expectedMatch = expectedKeys.length === 0
    || (expectedKeys.length === actualSessionKeys.length
      && expectedKeys.every((key, index) => key === actualSessionKeys[index]));
  return {
    ok: active.length === INSTRUCTOR_LESSON_EXPECTED_SESSIONS
      && unique.size === INSTRUCTOR_LESSON_EXPECTED_SESSIONS
      && expectedMatch,
    count: active.length,
    duplicate: unique.size !== active.length,
    expectedMatch,
    bookingIds: active.map((booking) => String(booking.bookingId || booking.id || "")).filter(Boolean),
    keys,
    expectedSessionKeys: expectedKeys,
    actualSessionKeys,
  };
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

function canonicalBookingEvidenceKey(booking) {
  return [
    normalizeInstructorLessonPhone(booking.memberPhone),
    bookingSessionEvidenceKey(booking),
  ].join("|");
}

function bookingSessionEvidenceKey(booking) {
  return [
    String(booking.lectureDate || "").slice(0, 10),
    seoulTime(booking.lectureStartAt || booking.startAt || booking.startOn),
    normalizeComparable(booking.staffName || booking.instructor),
    normalizeComparable(booking.lectureTitle || booking.title),
  ].join("|");
}

function expectedSessionEvidenceKey(session) {
  const date = String(session?.date || session?.lectureDate || "").slice(0, 10);
  const time = String(session?.time || "").slice(0, 5);
  const instructor = normalizeComparable(session?.instructor || session?.staffName);
  const title = normalizeComparable(session?.title || session?.lectureTitle);
  return date && time && instructor && title ? [date, time, instructor, title].join("|") : "";
}

function seoulTime(value) {
  const date = timestampDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function timestampDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const seconds = Number(value.seconds ?? value._seconds);
  if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function timestampMillis(value) {
  return timestampDate(value)?.getTime() || 0;
}

function normalizeComparable(value) {
  return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
}
