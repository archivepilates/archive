import { createHash } from "node:crypto";

export const INSTRUCTOR_LESSON_DEFAULT_CAPACITY = 10;
export const INSTRUCTOR_LESSON_SCHEDULE_WINDOW_DAYS = 120;

type SourceRecord = Record<string, any>;
type ScheduleMembers = Map<string, Map<string, SourceRecord[]>>;

export type InstructorLessonScheduleRosterRow = {
  memberKey: string;
  memberId: string | null;
  memberName: string;
  registrationId?: string;
};

export type InstructorLessonScheduleSummary = {
  date: string;
  startAt: string | null;
  endAt: string | null;
  sessionCount: number;
  capacity: number;
  capacitySource: "lecture" | "default";
  occupiedCount: number;
  remainingSeats: number;
  overbookedCount: number;
  countSource: "bookings" | "tickets" | "registrations" | "none";
  bookingMemberCount: number;
  ticketHolderCount: number;
  registrationCount: number;
  roster?: InstructorLessonScheduleRosterRow[];
};

export function isInstructorLessonSyntheticTest(item: SourceRecord): boolean {
  return item?.newMemberSimulation === true || item?.evidence?.newMemberSimulation === true;
}

export function buildInstructorLessonRegistrationCounts(
  registrations: SourceRecord[],
  statuses: readonly string[],
): Record<string, number> {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const registration of registrations) {
    if (isInstructorLessonSyntheticTest(registration)) continue;
    const status = cleanText(registration.status).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
  }
  return counts;
}

export function buildInstructorLessonScheduleSummaries(input: {
  startDate: string;
  endDate: string;
  lectures?: SourceRecord[];
  bookings?: SourceRecord[];
  ticketHolders?: SourceRecord[];
  registrations?: SourceRecord[];
  defaultCapacity?: number;
}): InstructorLessonScheduleSummary[] {
  const startDate = dateKey(input.startDate);
  const endDate = dateKey(input.endDate);
  const defaultCapacity = positiveInteger(input.defaultCapacity) || INSTRUCTOR_LESSON_DEFAULT_CAPACITY;
  const lectures = (input.lectures || []).filter(
    (item) => inRange(item.date, startDate, endDate) && isInstructorLesson(item),
  );
  const lectureIds = new Set(lectures.map((item) => cleanText(item.lectureId || item.id)).filter(Boolean));
  const dates = new Set(lectures.map((item) => dateKey(item.date)).filter(Boolean));

  const bookingMembers: ScheduleMembers = new Map();
  const canonicalOccurrences = new Map<string, SourceRecord>();
  for (const booking of input.bookings || []) {
    if (!activeBooking(booking) || !inRange(booking.lectureDate, startDate, endDate)) continue;
    if (!isInstructorLesson(booking) && !lectureIds.has(cleanText(booking.lectureId))) continue;
    const occurrenceKey = bookingOccurrenceKey(booking);
    if (!occurrenceKey) continue;
    const current = canonicalOccurrences.get(occurrenceKey);
    if (!current || bookingSourcePriority(booking) < bookingSourcePriority(current)) {
      canonicalOccurrences.set(occurrenceKey, booking);
    }
  }
  for (const booking of canonicalOccurrences.values()) {
    const date = dateKey(booking.lectureDate);
    const memberKey = memberIdentity(booking);
    if (!date || !memberKey) continue;
    addScheduleMember(bookingMembers, date, memberKey, booking);
    dates.add(date);
  }

  const syntheticMembers = new Map<string, Set<string>>();
  for (const registration of input.registrations || []) {
    if (!isInstructorLessonSyntheticTest(registration)) continue;
    const date = dateKey(registration.lessonDate);
    const memberKey = memberIdentity(registration);
    if (inRange(date, startDate, endDate) && memberKey) addSetValue(syntheticMembers, date, memberKey);
  }

  const ticketMembers: ScheduleMembers = new Map();
  for (const holder of input.ticketHolders || []) {
    if (!hasInstructorLessonTicket(holder)) continue;
    const memberKey = memberIdentity(holder);
    if (!memberKey) continue;
    for (const rawDate of currentInstructorLessonTicketDates(holder)) {
      const date = dateKey(rawDate);
      if (!inRange(date, startDate, endDate)) continue;
      if (syntheticMembers.get(date)?.has(memberKey)) continue;
      addScheduleMember(ticketMembers, date, memberKey, holder);
      dates.add(date);
    }
  }

  const registrationMembers: ScheduleMembers = new Map();
  for (const registration of input.registrations || []) {
    if (isInstructorLessonSyntheticTest(registration)) continue;
    const date = dateKey(registration.lessonDate);
    const status = cleanText(registration.status).toLowerCase();
    if (!inRange(date, startDate, endDate) || ["cancelled", "canceled", "rejected"].includes(status)) continue;
    const memberKey = memberIdentity(registration) || cleanText(registration.registrationId || registration.id);
    if (!memberKey) continue;
    addScheduleMember(registrationMembers, date, memberKey, registration);
    dates.add(date);
  }

  return [...dates].sort().map((date) => {
    const dateLectures = lectures.filter((lecture) => dateKey(lecture.date) === date);
    const bookingMemberCount = bookingMembers.get(date)?.size || 0;
    const ticketHolderCount = ticketMembers.get(date)?.size || 0;
    const registrationCount = registrationMembers.get(date)?.size || 0;
    const countSource = ticketHolderCount
      ? "tickets"
      : bookingMemberCount
        ? "bookings"
        : registrationCount
          ? "registrations"
          : "none";
    const occupiedMembers =
      countSource === "bookings"
        ? bookingMembers.get(date)
        : countSource === "tickets"
          ? ticketMembers.get(date)
          : registrationMembers.get(date);
    const occupiedCount = occupiedMembers?.size || 0;
    const roster = [...(occupiedMembers || [])].map(([memberKey, members]) => {
      const sources =
        countSource === "bookings"
          ? [...members].sort((a, b) => bookingSourcePriority(a) - bookingSourcePriority(b))
          : members;
      const registrations = registrationMembers.get(date)?.get(memberKey) || [];
      const registrationIds = new Set(
        registrations.map((item) => cleanText(item.registrationId || item.id)).filter(Boolean),
      );
      // Link only an unambiguous, eligible registration with the same date and identity.
      const registrationId = registrationIds.size === 1 ? [...registrationIds][0] : undefined;
      const registration = registrationId
        ? registrations.find((item) => cleanText(item.registrationId || item.id) === registrationId)
        : undefined;
      return {
        // The internal identity may contain a full phone number; keep it out of the response.
        memberKey: `member:${createHash("sha256").update(memberKey).digest("hex")}`,
        memberId:
          sources.map((item) => rosterMemberId(item, countSource === "tickets")).find(Boolean) ||
          (registration ? rosterMemberId(registration) : null),
        memberName:
          sources.map((item) => cleanText(item.memberName || item.name)).find(Boolean) ||
          cleanText(registration?.memberName || registration?.name) ||
          "이름 미확인",
        ...(registrationId ? { registrationId } : {}),
      } satisfies InstructorLessonScheduleRosterRow;
    });
    const lectureCapacity = concurrentLectureCapacity(dateLectures);
    const capacity = lectureCapacity || defaultCapacity;
    const timestamps = dateLectures
      .flatMap((lecture) => [millis(lecture.startAt), millis(lecture.endAt)])
      .filter(Boolean);
    const starts = dateLectures.map((lecture) => millis(lecture.startAt)).filter(Boolean);
    const ends = dateLectures.map((lecture) => millis(lecture.endAt)).filter(Boolean);
    return {
      date,
      startAt: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
      endAt: ends.length
        ? new Date(Math.max(...ends)).toISOString()
        : timestamps.length
          ? new Date(Math.max(...timestamps)).toISOString()
          : null,
      sessionCount: dateLectures.length,
      capacity,
      capacitySource: lectureCapacity ? "lecture" : "default",
      occupiedCount,
      remainingSeats: Math.max(0, capacity - occupiedCount),
      overbookedCount: Math.max(0, occupiedCount - capacity),
      countSource,
      bookingMemberCount,
      ticketHolderCount,
      registrationCount,
      roster,
    } satisfies InstructorLessonScheduleSummary;
  });
}

export function instructorLessonScheduleDateRange(now = new Date()): { startDate: string; endDate: string } {
  const startDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const base = new Date(`${startDate}T12:00:00+09:00`);
  base.setUTCDate(base.getUTCDate() + INSTRUCTOR_LESSON_SCHEDULE_WINDOW_DAYS);
  const endDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
  return { startDate, endDate };
}

function activeBooking(booking: SourceRecord): boolean {
  if (cleanText(booking.appStatus).toLowerCase() !== "reserved") return false;
  if (booking.active === false || booking.archiveBooking?.isCanonical === false) return false;
  if (cleanText(booking.supersededByBookingId)) return false;
  return !/(missing_from_latest_reservation_import|superseded|duplicate|stale|lecture_deleted|deleted|cancel)/i.test(
    cleanText(booking.sourceStatus || booking.reconcileStatus),
  );
}

function isInstructorLesson(item: SourceRecord): boolean {
  return /강사\s*레슨|archive\s*method|아카이브\s*메소드/i.test(
    [item.title, item.lectureTitle, item.lessonTitle, item.ticketName, item.divisionName].filter(Boolean).join(" "),
  );
}

function hasInstructorLessonTicket(holder: SourceRecord): boolean {
  const names = Array.isArray(holder.activeTicketNames)
    ? holder.activeTicketNames
    : Array.isArray(holder.activeTickets)
      ? holder.activeTickets.map((ticket: SourceRecord) => ticket?.name)
      : [];
  return names.some((name: unknown) => /강사\s*레슨/i.test(cleanText(name)));
}

function currentInstructorLessonTicketDates(holder: SourceRecord): unknown[] {
  if (Array.isArray(holder.activeTickets)) {
    return holder.activeTickets
      .filter((ticket: SourceRecord) => /강사\s*레슨/i.test(cleanText(ticket?.name || ticket?.ticketName)))
      .map((ticket: SourceRecord) => ticket?.availableFrom || ticket?.startAt || ticket?.startDate)
      .filter(Boolean);
  }
  return Array.isArray(holder.instructorLessonDates) ? holder.instructorLessonDates : [];
}

function concurrentLectureCapacity(lectures: SourceRecord[]): number {
  const slots = new Map<string, SourceRecord[]>();
  for (const lecture of lectures) {
    const start = millis(lecture.startAt);
    if (!start) continue;
    const key = String(start);
    const rows = slots.get(key) || [];
    rows.push(lecture);
    slots.set(key, rows);
  }
  const capacities = [...slots.values()]
    .filter((rows) => rows.length > 0 && rows.every((row) => positiveInteger(row.capacity) > 0))
    .map((rows) => rows.reduce((sum, row) => sum + positiveInteger(row.capacity), 0));
  return capacities.length ? Math.max(...capacities) : 0;
}

function bookingOccurrenceKey(booking: SourceRecord): string {
  const date = dateKey(booking.lectureDate);
  const start = millis(booking.lectureStartAt) || cleanText(booking.startTime);
  const staff = cleanText(booking.staffId || booking.staffName).replace(/\s+/g, "");
  const member = memberIdentity(booking);
  return date && start && member ? [date, start, staff, member].join("|") : "";
}

function bookingSourcePriority(booking: SourceRecord): number {
  const id = cleanText(booking.bookingId || booking.id);
  if (id.startsWith("usage_booking_")) return 1;
  if (id.startsWith("excel_booking_")) return 2;
  if (id.startsWith("excel_") || id.startsWith("usage_")) return 3;
  return 0;
}

function memberIdentity(item: SourceRecord): string {
  const phone = normalizePhone(item.memberPhone || item.phone);
  if (phone) return `phone:${phone}`;
  const memberId = cleanText(item.memberId || item.id);
  if (memberId) return `member:${memberId}`;
  const name = cleanText(item.memberName || item.name).replace(/\s+/g, "");
  return name ? `name:${name}` : "";
}

function addSetValue(map: Map<string, Set<string>>, key: string, value: string): void {
  const rows = map.get(key) || new Set<string>();
  rows.add(value);
  map.set(key, rows);
}

function addScheduleMember(map: ScheduleMembers, date: string, memberKey: string, item: SourceRecord): void {
  const members = map.get(date) || new Map<string, SourceRecord[]>();
  const records = members.get(memberKey) || [];
  records.push(item);
  members.set(memberKey, records);
  map.set(date, members);
}

function rosterMemberId(item: SourceRecord, isProfile = false): string | null {
  const phone = normalizePhone(item.memberPhone || item.phone);
  return (
    [item.studiomateMemberId, item.evidence?.studiomateMemberId, item.memberId, isProfile ? item.id : null]
      .map(cleanText)
      .find((id) => id && !/^(excel_|usage_)/i.test(id) && (!phone || normalizePhone(id) !== phone)) || null
  );
}

function inRange(value: unknown, startDate: string, endDate: string): boolean {
  const date = dateKey(value);
  return Boolean(date && date >= startDate && date <= endDate);
}

function dateKey(value: unknown): string {
  const text = typeof value === "string" ? cleanText(value) : "";
  const match = text.match(/^(20\d{2})[-./]?(\d{2})[-./]?(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const timestamp = millis(value);
  return timestamp
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(timestamp))
    : "";
}

function normalizePhone(value: unknown): string {
  const digits = cleanText(value).replace(/\D/g, "");
  return /^8210\d{8}$/.test(digits) ? `0${digits.slice(2)}` : digits;
}

function positiveInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function millis(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as SourceRecord).toMillis === "function") return Number((value as SourceRecord).toMillis()) || 0;
  if (typeof (value as SourceRecord).toDate === "function")
    return Number((value as SourceRecord).toDate()?.getTime?.()) || 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: unknown): string {
  return String(value || "").trim();
}
