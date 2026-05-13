import type { BookingDoc, ConsultationDoc, LectureDoc, NoticeDoc, OtherScheduleDoc } from "../types/models";
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
  const staffId = stringValue(
    staff.id ?? raw.staff_id ?? raw.instructor_id ?? raw.staffId ?? raw.staff_name ?? staff.name,
  );
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
    lessonType: normalizeLessonType(
      raw.type ??
        raw.course?.type ??
        raw.class_type ??
        raw.lesson_type ??
        raw.lecture_type ??
        division.type ??
        division.name ??
        raw.division ??
        raw.title,
    ),
    staffId,
    staffName,
    title: stringValue(raw.title ?? raw.name ?? raw.course?.title),
    status: stringValue(raw.status || "open"),
    capacity: numberValue(raw.max_trainee ?? raw.capacity),
    bookingCount: normalizedBookings.filter((booking) => booking.appStatus === "reserved").length,
    waitCount: normalizedBookings.filter((booking) => booking.appStatus === "wait").length,
    cancelCount: normalizedBookings.filter(
      (booking) => booking.appStatus === "cancel" || booking.appStatus === "wait_cancel",
    ).length,
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
  const ticketExpiresAt = parseStudioMateDateTime(rawBooking.userTicket?.expire_at);

  return {
    bookingId,
    lectureId,
    studioId,
    memberId: stringValue(member.id ?? rawBooking.user_id ?? rawBooking.member_id),
    memberName: stringValue(member.name ?? rawBooking.name),
    memberPhone: digitsOnly(member.mobile ?? member.phone ?? rawBooking.mobile ?? rawBooking.phone),
    memberRegisteredAt: parseStudioMateDateTime(member.registered_at ?? rawBooking.registered_at),
    staffId: stringValue(
      staff.id ?? rawLecture.staff_id ?? rawLecture.instructor_id ?? rawLecture.staff_name ?? staff.name,
    ),
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
    ticketExpiresAt,
    ticketExpiryLevel: ticketExpiryLevel(ticketExpiresAt),
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

export function normalizeConsultation(raw: any, studioId: string): ConsultationDoc {
  const consultationId = stringValue(raw.id ?? raw.counsel_id ?? raw.consultation_id);
  const startRaw = stringValue(raw.start_on ?? raw.start_at ?? raw.start_time ?? raw.date);
  const endRaw = stringValue(raw.end_on ?? raw.end_at ?? raw.end_time);
  const staffs = scheduleStaffs(raw);
  const staff = raw.staff || raw.instructor || staffs[0] || {};
  const staffIds = uniqueStrings(staffs.map((item) => stringValue(item.id ?? item.staff_id ?? item.user_id)));
  const staffNames = uniqueStrings(staffs.map((item) => stringValue(item.name ?? item.profile?.name ?? item.staff_name)));
  const primaryStaffId = stringValue(staff.id ?? raw.staff_id ?? raw.instructor_id);
  const primaryStaffName = stringValue(staff.name ?? staff.profile?.name ?? raw.staff_name ?? raw.instructor_name);
  const member = raw.member || raw.user || {};
  const status = raw.deleted_at ? "deleted" : startRaw ? "scheduled" : "unknown";

  return {
    consultationId,
    studioId,
    date: startRaw ? startRaw.slice(0, 10) : "",
    startAt: parseStudioMateDateTime(startRaw),
    endAt: parseStudioMateDateTime(endRaw),
    staffId: primaryStaffId || staffIds[0] || "",
    staffName: primaryStaffName || staffNames[0] || "",
    staffIds: uniqueStrings([primaryStaffId, ...staffIds]),
    staffNames: uniqueStrings([primaryStaffName, ...staffNames]),
    memberId: objectId(member.id) || objectId(raw.user_id) || objectId(raw.member_id),
    memberName: stringValue(member.name ?? raw.name ?? raw.member_name),
    memberPhone: digitsOnly(member.mobile ?? member.phone ?? raw.mobile ?? raw.phone),
    channel: stringValue(raw.channel ?? raw.register_type ?? raw.type),
    status,
    memo: stringValue(raw.memo ?? raw.note ?? raw.content ?? raw.contents),
    sourceHash: stableHash(stripVolatile(raw)),
    sourceUpdatedAt: parseStudioMateDateTime(raw.updated_at),
    syncedAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

export function normalizeOtherSchedule(raw: any, studioId: string): OtherScheduleDoc {
  const scheduleId = stringValue(raw.id ?? raw.etc_schedule_time_id ?? raw.schedule_id ?? raw.etc_id ?? raw.event_id);
  const startRaw = stringValue(raw.start_on ?? raw.start_at ?? raw.start_time ?? raw.date);
  const endRaw = stringValue(raw.end_on ?? raw.end_at ?? raw.end_time);
  const staffs = scheduleStaffs(raw);
  const staff = raw.staff || raw.instructor || staffs[0] || raw.register || {};
  const staffIds = uniqueStrings(staffs.map((item) => stringValue(item.id ?? item.staff_id ?? item.user_id)));
  const staffNames = uniqueStrings(staffs.map((item) => stringValue(item.name ?? item.profile?.name ?? item.staff_name)));
  const primaryStaffId = stringValue(staff.id ?? raw.staff_id ?? raw.instructor_id);
  const firstStaffName = stringValue(staff.name ?? staff.profile?.name ?? raw.staff_name ?? raw.instructor_name);
  const staffName =
    staffNames.length > 1
      ? `${staffNames[0]} 외 ${staffNames.length - 1}명`
      : staffNames[0] || firstStaffName;
  const status = raw.deleted_at ? "deleted" : startRaw ? "scheduled" : "unknown";

  return {
    scheduleId,
    studioId,
    date: startRaw ? startRaw.slice(0, 10) : "",
    startAt: parseStudioMateDateTime(startRaw),
    endAt: parseStudioMateDateTime(endRaw),
    staffId: primaryStaffId || staffIds[0] || "",
    staffName,
    staffIds: uniqueStrings([primaryStaffId, ...staffIds]),
    staffNames: uniqueStrings([firstStaffName, ...staffNames]),
    title: stringValue(raw.title ?? raw.name ?? raw.subject ?? raw.content ?? raw.contents) || "기타일정",
    category: stringValue(raw.category ?? raw.type ?? raw.schedule_type ?? raw.kind) || "기타",
    status,
    memo: stringValue(raw.memo ?? raw.note ?? raw.content ?? raw.contents),
    sourceHash: stableHash(stripVolatile(raw)),
    sourceUpdatedAt: parseStudioMateDateTime(raw.updated_at),
    syncedAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

function scheduleStaffs(raw: any): any[] {
  return [
    ...asArray(raw.staffs),
    ...asArray(raw.staff_members),
    ...asArray(raw.staff_memberships),
    ...asArray(raw.members),
    ...asArray(raw.shared_staffs),
    ...asArray(raw.users),
  ].filter(Boolean);
}

function ticketExpiryLevel(expiresAt: BookingDoc["ticketExpiresAt"]): BookingDoc["ticketExpiryLevel"] {
  if (!expiresAt) return "unknown";
  const diffDays = (expiresAt.toMillis() - Date.now()) / (24 * 60 * 60 * 1000);
  if (diffDays < 0) return "expired";
  if (diffDays <= 14) return "soon";
  return "normal";
}

export function normalizeManagerNotice(raw: any, studioId: string, staffId: string): NoticeDoc {
  const ref = raw.ref || {};
  const refLectureId = stringValue(ref.lecture_id ?? raw.lecture_id);
  const sourceCreatedAt = stringValue(raw.created_at);
  const msgType = stringValue(raw.msg_type);
  const refDates = noticeDates(raw);
  const refDate = refDates[0] || sourceCreatedAt.slice(0, 10);
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
    refDate,
    refDates,
    updatedFor: stringValue(ref.updated_for),
    sourceCreatedAt,
    sourceUpdatedAt: stringValue(ref.updated_at ?? raw.updated_at),
    processed: false,
    processedAt: null,
    raw: raw as Record<string, unknown>,
    createdAt: nowTimestamp(),
  };
}

function noticeDates(raw: any): string[] {
  const ref = raw?.ref || {};
  const direct = stringValue(
    ref.start_on ??
      ref.start_at ??
      ref.date ??
      raw.start_on ??
      raw.start_at ??
      raw.date ??
      raw.lecture_date ??
      raw.ref_date,
  );
  const dates = new Set<string>();
  if (/^\d{4}-\d{2}-\d{2}/.test(direct)) dates.add(direct.slice(0, 10));
  const text = JSON.stringify(raw);
  for (const match of text.matchAll(/(\d{4})\.(\d{1,2})\.(\d{1,2})/g)) {
    dates.add(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
  }
  for (const match of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    dates.add(`${match[1]}-${match[2]}-${match[3]}`);
  }
  return [...dates].sort();
}

export function normalizeLessonType(value: unknown): LectureDoc["lessonType"] {
  const text = stringValue(value).toLowerCase();
  if (/^g$|group|그룹/.test(text)) return "group";
  if (/^p$|private|프라이|개인/.test(text)) return "private";
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
  if (/late_cancel|예약취소\(결석\)|취소\(결석\)/.test(text)) return "late_cancel";
  if (/attendance|checkin|check_in|attended/.test(text)) return "attended";
  if (/absence|absent|noshow|결석/.test(text)) return "absent";
  return "unchecked";
}

function stripVolatile(value: any): unknown {
  if (!value || typeof value !== "object") return value;
  const clone = JSON.parse(JSON.stringify(value));
  delete clone.syncedAt;
  return clone;
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  return [];
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function objectId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return stringValue(obj.id ?? obj.value ?? obj.user_id ?? obj.member_id);
  }
  return stringValue(value);
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
