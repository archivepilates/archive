import type { BookingDoc, MemberProfileDoc } from "../types/models";
import { isRenewalManagedTicket } from "../renewal/renewalPolicy";

export const LONG_ABSENCE_MIN_DAYS = 7;

type ActiveTicket = NonNullable<MemberProfileDoc["activeTickets"]>[number];

export interface LongAbsenceAssessment {
  eligible: boolean;
  issueCode:
    | ""
    | "holding_ticket"
    | "no_active_ticket"
    | "upcoming_reservation"
    | "upcoming_wait"
    | "no_attendance"
    | "new_ticket_cycle"
    | "recent_attendance";
  issue: string;
  activeTickets: ActiveTicket[];
  lastAttendance: BookingDoc | null;
  absenceDays: number | null;
  latestTicketCycleStartDate: string;
}

export function assessLongAbsenceTarget(input: {
  profile: MemberProfileDoc;
  sourceDate: string;
  bookings: BookingDoc[];
}): LongAbsenceAssessment {
  const { profile, sourceDate, bookings } = input;
  const activeTickets = currentLongAbsenceTickets(profile, sourceDate);
  const base = {
    activeTickets,
    lastAttendance: null,
    absenceDays: null,
    latestTicketCycleStartDate: latestTicketCycleStartDate(activeTickets, sourceDate),
  };

  if (profile.ticketStatusSummary?.hasHoldingTicket) {
    return blocked("holding_ticket", "수강권 정지 또는 홀딩 상태", base);
  }
  if (!activeTickets.length) {
    return blocked("no_active_ticket", "활성 수업 수강권 없음", base);
  }

  const upcomingIntent = bookings
    .filter(
      (booking) =>
        booking.lectureDate >= sourceDate &&
        ["reserved", "wait"].includes(String(booking.appStatus || "")) &&
        !isInstructorLessonBooking(booking),
    )
    .sort(compareBookingAsc)[0];
  if (upcomingIntent?.appStatus === "reserved") {
    return blocked("upcoming_reservation", `예정 예약 있음 · ${upcomingIntent.lectureDate}`, base);
  }
  if (upcomingIntent?.appStatus === "wait") {
    return blocked("upcoming_wait", `수업 대기 신청 있음 · ${upcomingIntent.lectureDate}`, base);
  }

  const lastAttendance = bookings
    .filter(
      (booking) =>
        booking.attendanceStatus === "attended" &&
        Boolean(booking.lectureDate) &&
        booking.lectureDate <= sourceDate &&
        !isInstructorLessonBooking(booking),
    )
    .sort(compareBookingDesc)[0];
  if (!lastAttendance) {
    return blocked("no_attendance", "출석 완료 이력 없음", base);
  }

  const assessmentBase = { ...base, lastAttendance };
  if (
    base.latestTicketCycleStartDate &&
    base.latestTicketCycleStartDate > lastAttendance.lectureDate
  ) {
    return blocked(
      "new_ticket_cycle",
      `새 수강권 시작 ${base.latestTicketCycleStartDate} 이후 출석 전`,
      assessmentBase,
    );
  }

  const absenceDays = daysBetweenDateStrings(lastAttendance.lectureDate, sourceDate);
  if (!Number.isFinite(absenceDays) || absenceDays < LONG_ABSENCE_MIN_DAYS) {
    return blocked(
      "recent_attendance",
      `마지막 출석 후 ${Number.isFinite(absenceDays) ? absenceDays : 0}일`,
      { ...assessmentBase, absenceDays: Number.isFinite(absenceDays) ? absenceDays : null },
    );
  }

  return {
    eligible: true,
    issueCode: "",
    issue: "",
    activeTickets,
    lastAttendance,
    absenceDays,
    latestTicketCycleStartDate: base.latestTicketCycleStartDate,
  };
}

function currentLongAbsenceTickets(profile: MemberProfileDoc, sourceDate: string): ActiveTicket[] {
  return (profile.activeTickets || []).filter((ticket) => {
    if (!isRenewalManagedTicket(ticket)) return false;
    if (/토삭스|삭스|양말|기간연장|체험|체험권|강사레슨/.test(String(ticket.name || ""))) return false;
    const classType = String(ticket.classType || "").toUpperCase();
    if (classType === "I" || classType === "INSTRUCTOR") return false;
    if (ticket.expiryLevel === "expired") return false;
    const availableFrom = dateText(ticket.availableFrom);
    if (availableFrom && availableFrom > sourceDate) return false;
    const expiresAt = dateText(ticket.expiresAt);
    if (expiresAt && expiresAt < sourceDate) return false;
    const remainingCount = ticket.remainingCount == null ? Number.NaN : Number(ticket.remainingCount);
    return !Number.isFinite(remainingCount) || remainingCount > 0;
  });
}

function latestTicketCycleStartDate(tickets: ActiveTicket[], sourceDate: string): string {
  return tickets
    .map((ticket) => {
      const availableFrom = dateText(ticket.availableFrom);
      if (availableFrom) return availableFrom;
      return [dateText(ticket.paymentAt), dateText(ticket.purchasedAt)]
        .filter((value) => value && value <= sourceDate)
        .sort()
        .at(-1) || "";
    })
    .filter((value) => value && value <= sourceDate)
    .sort()
    .at(-1) || "";
}

function dateText(value: ActiveTicket["availableFrom"]): string {
  const date = value?.toDate?.();
  if (!date) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

function isInstructorLessonBooking(booking: BookingDoc): boolean {
  const text = `${String(booking.ticketClassType || "")} ${String(booking.ticketType || "")} ${String(
    booking.ticketName || "",
  )}`.toLowerCase();
  return /(^|\s)(i|instructor)(\s|$)|강사레슨/.test(text);
}

function compareBookingAsc(a: BookingDoc, b: BookingDoc): number {
  if (a.lectureDate !== b.lectureDate) return a.lectureDate.localeCompare(b.lectureDate);
  return (a.lectureStartAt?.toMillis() || 0) - (b.lectureStartAt?.toMillis() || 0);
}

function compareBookingDesc(a: BookingDoc, b: BookingDoc): number {
  return compareBookingAsc(b, a);
}

function daysBetweenDateStrings(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00+09:00`).getTime();
  const end = new Date(`${endDate}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN;
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function blocked(
  issueCode: Exclude<LongAbsenceAssessment["issueCode"], "">,
  issue: string,
  base: Pick<
    LongAbsenceAssessment,
    "activeTickets" | "lastAttendance" | "absenceDays" | "latestTicketCycleStartDate"
  >,
): LongAbsenceAssessment {
  return {
    eligible: false,
    issueCode,
    issue,
    ...base,
  };
}
