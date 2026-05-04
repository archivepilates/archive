import type { BookingDoc, LectureDoc, NoticeDoc } from "../types/models";
import { noticeIdFor } from "../utils/idempotency";
import { nowTimestamp, parseStudioMateDateTime } from "../utils/date";
import { stableHash } from "../utils/hash";

export function normalizeLecture(raw: any, studioId: string): LectureDoc {
  const lectureId = stringValue(raw.id ?? raw.lecture_id);
  const startRaw = stringValue(raw.start_on ?? raw.start_at ?? raw.start_time ?? raw.date);
  const endRaw = stringValue(raw.end_on ?? raw.end_at ?? raw.end_time);
  const startAt = parseStudioMateDateTime(startRaw);
  const date = startRaw ? startRaw.slice(0, 10) : "";
  const bookings = asArray(raw.bookings);
  const staff = raw.staff || raw.instructor || {};
  const division = raw.division || {};
  const room = raw.room || {};
  const staffId = stringValue(staff.id ?? raw.staff_id ?? raw.instructor_id ?? raw.staffId ?? raw.staff_name ?? staff.name);
  const staffName = stringValue(staff.name ?? staff.profile?.name ?? raw.staff_name ?? raw.instructor_name);
  const normalizedBookings = bookings.map((booking) => normalizeBooking(raw, booking, studioId));

  return {
    lectureId,
    studioId,
    date,
    startAt,
    endAt: parseStudioMateDateTime(endRaw),
    roomName: stringValue(room.name ?? raw.room_name),
    divisionName: stringValue(division.name ?? raw.division_name),
    lessonType: normalizeLessonType(raw.type ?? raw.class_type ?? division.type ?? division.name ?? raw.title),
    staffId,
    staffName,
    title: stringValue(raw.title ?? raw.name ?? raw.course?.title),
    status: stringValue(raw.status || "open"),
    capacity: numberValue(raw.max_trainee ?? raw.capacity),
    bookingCount: normalizedBookings.filter((booking) => booking.appStatus === "reserved").length,
    waitCount: normalizedBookings.filter((booking) => booking.appStatus === "wait").length,
    cancelCount: normalizedBookings.filter((booking) => booking.appStatus === "cancel" || booking.appStatus === "wait_cancel").length,
    sourceHash: stableHash(stripVolatile(raw)),
    sourceUpdatedAt: parseStudioMateDateTime(raw.updated_at),
    syncedAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

export function normalizeBooking(rawLecture: any, rawBooking: any, studioId: string): BookingDoc {
  const member = rawBooking.member || rawBooking.user || {};
  const ticket = rawBooking.userTicket?.ticket || rawBooking.ticket || {};
  const lectureId = stringValue(rawLecture.id ?? rawLecture.lecture_id);
  const bookingId = stringValue(rawBooking.id ?? rawBooking.booking_id);
  const staff = rawLecture.staff || rawLecture.instructor || {};
  const status = stringValue(rawBooking.status);
  const appStatus = normalizeBookingStatus(status, rawBooking.updated_for);
  const startRaw = stringValue(rawLecture.start_on ?? rawLecture.start_at ?? rawLecture.start_time);
  const endRaw = stringValue(rawLecture.end_on ?? rawLecture.end_at ?? rawLecture.end_time);

  return {
    bookingId,
    lectureId,
    studioId,
    memberId: stringValue(member.id ?? rawBooking.user_id ?? rawBooking.member_id),
    memberName: stringValue(member.name ?? rawBooking.name),
    memberPhone: digitsOnly(member.mobile ?? member.phone ?? rawBooking.mobile ?? rawBooking.phone),
    staffId: stringValue(staff.id ?? rawLecture.staff_id ?? rawLecture.instructor_id ?? rawLecture.staff_name ?? staff.name),
    staffName: stringValue(staff.name ?? staff.profile?.name ?? rawLecture.staff_name ?? rawLecture.instructor_name),
    lectureDate: startRaw ? startRaw.slice(0, 10) : "",
    lectureStartAt: parseStudioMateDateTime(startRaw),
    lectureEndAt: parseStudioMateDateTime(endRaw),
    sourceStatus: status,
    appStatus,
    attendanceStatus: normalizeAttendanceStatus(status),
    syncStatus: "synced",
    ticketName: stringValue(ticket.title ?? rawBooking.ticket_title),
    ticketRemainingCount: nullableNumber(rawBooking.userTicket?.remaining_coupon ?? rawBooking.remaining_coupon),
    ticketExpiresAt: parseStudioMateDateTime(rawBooking.userTicket?.expire_at),
    ticketExpiryLevel: "unknown",
    memberTagIds: [],
    lastMemoPreview: "",
    lastMemoAt: null,
    lastChangedBy: "system",
    sourceHash: stableHash(stripVolatile(rawBooking)),
    sourceUpdatedAt: parseStudioMateDateTime(rawBooking.updated_at),
    syncedAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

export function normalizeManagerNotice(raw: any, studioId: string, staffId: string): NoticeDoc {
  const ref = raw.ref || {};
  const refLectureId = stringValue(ref.lecture_id ?? raw.lecture_id);
  const sourceCreatedAt = stringValue(raw.created_at);
  const msgType = stringValue(raw.msg_type);
  return {
    noticeId: noticeIdFor({ studioId, staffId, msgType, refLectureId, sourceCreatedAt }),
    studioId,
    staffId,
    msgType,
    label: stringValue(raw.label),
    refType: stringValue(raw.ref_type),
    refStatus: stringValue(ref.status),
    refLectureId,
    refBookingId: stringValue(ref.id ?? raw.ref_id),
    updatedFor: stringValue(ref.updated_for),
    sourceCreatedAt,
    sourceUpdatedAt: stringValue(ref.updated_at ?? raw.updated_at),
    processed: false,
    processedAt: null,
    raw: raw as Record<string, unknown>,
    createdAt: nowTimestamp(),
  };
}

export function normalizeLessonType(value: unknown): LectureDoc["lessonType"] {
  const text = stringValue(value).toLowerCase();
  if (/[gp]roup|그룹|\bG\b/.test(text)) return "group";
  if (/private|프라이|개인|\bP\b/.test(text)) return "private";
  if (/semi|듀엣|세미/.test(text)) return "semi_private";
  return "unknown";
}

function normalizeBookingStatus(status: string, updatedFor: unknown): BookingDoc["appStatus"] {
  const text = `${status} ${stringValue(updatedFor)}`.toLowerCase();
  if (/예약대기취소|wait_cancel/.test(text)) return "wait_cancel";
  if (/booking_waiting|waiting|wait|대기/.test(text)) return "wait";
  if (/cancel|취소/.test(text)) return "cancel";
  if (/book|attendance|reserved|예약|checkin|check_in/.test(text)) return "reserved";
  return "unknown";
}

function normalizeAttendanceStatus(status: string): BookingDoc["attendanceStatus"] {
  const text = status.toLowerCase();
  if (/attendance|checkin|check_in|attended/.test(text)) return "attended";
  if (/absence|absent|noshow/.test(text)) return "absent";
  return "unchecked";
}

function stripVolatile(value: any): unknown {
  if (!value || typeof value !== "object") return value;
  const clone = JSON.parse(JSON.stringify(value));
  delete clone.syncedAt;
  return clone;
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function numberValue(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function nullableNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function digitsOnly(value: unknown): string {
  return stringValue(value).replace(/\D/g, "");
}

export { asArray };
