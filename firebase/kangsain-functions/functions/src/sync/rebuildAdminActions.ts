import type { AdminActionDoc, BookingDoc, LectureDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { addDays, nowTimestamp, todayKst } from "../utils/date";

type Action = AdminActionDoc["actions"][number];

export async function rebuildAdminActions(input: {
  studioId: string;
  startDate: string;
  endDate: string;
  lectures: LectureDoc[];
  bookings: BookingDoc[];
}): Promise<void> {
  const actionEndDate = reservationOpenEndDate(todayKst());
  const dates: string[] = [];
  let date = input.startDate;
  while (date <= input.endDate) {
    dates.push(date);
    date = addDays(date, 1);
  }

  await Promise.all(
    dates.map((targetDate) => {
      const periodStart = addDays(targetDate, -27);
      const periodEnd = targetDate;
      const actions =
        targetDate <= actionEndDate
          ? buildActionsForDate({
              studioId: input.studioId,
              targetDate,
              periodStart,
              periodEnd,
              lectures: input.lectures,
              bookings: input.bookings,
            })
          : [];
      const doc: AdminActionDoc = {
        actionId: `${input.studioId}_${targetDate}`,
        studioId: input.studioId,
        date: targetDate,
        periodStart,
        periodEnd,
        actions,
        summary: summarize(actions),
        updatedAt: nowTimestamp(),
      };
      return refs.adminAction(input.studioId, targetDate).set(doc, { merge: true });
    }),
  );
}

function reservationOpenEndDate(baseDate: string): string {
  const base = new Date(`${baseDate}T00:00:00+09:00`);
  const day = base.getDay();
  const daysSinceMonday = (day + 6) % 7;
  return addDays(baseDate, 13 - daysSinceMonday);
}

function buildActionsForDate(input: {
  studioId: string;
  targetDate: string;
  periodStart: string;
  periodEnd: string;
  lectures: LectureDoc[];
  bookings: BookingDoc[];
}): Action[] {
  const currentLectures = input.lectures
    .filter((lecture) => lecture.studioId === input.studioId && lecture.date === input.targetDate)
    .sort((a, b) => (a.startAt?.toMillis() || 0) - (b.startAt?.toMillis() || 0));
  const periodBookings = input.bookings.filter(
    (booking) =>
      booking.studioId === input.studioId &&
      booking.lectureDate >= input.periodStart &&
      booking.lectureDate <= input.periodEnd,
  );
  const actions: Action[] = [];

  currentLectures.forEach((lecture) => {
    const lectureBookings = periodBookings.filter((booking) => booking.lectureId === lecture.lectureId);
    const reserved = lectureBookings.filter((booking) => booking.appStatus === "reserved");

    if (lecture.lessonType === "group") {
      const capacity = Math.max(0, Number(lecture.capacity || 0));
      if (capacity >= 3 && reserved.length <= 3) {
        actions.push({
          actionKey: `low_class_${lecture.lectureId}`,
          type: "low_class",
          label: "예약저조",
          title: `${timeText(lecture)} ${lecture.title || "수업"}`,
          body: `${lecture.staffName || lecture.staffId} · 예약 ${reserved.length}/${capacity}`,
          level: "wait",
          lectureId: lecture.lectureId,
          staffId: lecture.staffId,
          staffName: lecture.staffName,
          sort: `3_${input.targetDate}_${timeText(lecture)}_${lecture.lectureId}`,
        });
      }
    }

    if (isPastLecture(lecture)) {
      reserved
        .filter((booking) => booking.attendanceStatus === "unchecked")
        .forEach((booking) => {
          actions.push({
            actionKey: `attendance_unchecked_${booking.bookingId}`,
            type: "attendance_unchecked",
            label: "출석미체크",
            title: `${booking.memberName || "회원"} · ${timeText(lecture)} ${lecture.title || "수업"}`,
            body: lecture.staffName || lecture.staffId,
            level: "bad",
            memberId: booking.memberId,
            memberName: booking.memberName,
            lectureId: lecture.lectureId,
            staffId: lecture.staffId,
            staffName: lecture.staffName,
            sort: `2_${input.targetDate}_${timeText(lecture)}_${booking.memberName || ""}`,
          });
        });
    }
  });

  actions.push(...memberActions(input.targetDate, periodBookings, input.targetDate <= todayKst()));
  return actions.sort((a, b) => a.sort.localeCompare(b.sort, "ko")).slice(0, 120);
}

function memberActions(targetDate: string, bookings: BookingDoc[], includeAttendanceHistoryActions: boolean): Action[] {
  const grouped = new Map<string, BookingDoc[]>();
  bookings
    .filter((booking) => booking.memberId || booking.memberName)
    .forEach((booking) => {
      const key = booking.memberId || booking.memberName;
      const rows = grouped.get(key) || [];
      rows.push(booking);
      grouped.set(key, rows);
    });

  return [...grouped.values()].flatMap((rows) => {
    const sorted = rows.slice().sort((a, b) => a.lectureDate.localeCompare(b.lectureDate));
    const first = sorted[0];
    const memberName = first.memberName || "회원";
    const memberId = first.memberId;
    const out: Action[] = [];

    const ticketRisk = sorted.find(
      (booking) =>
        booking.appStatus === "reserved" &&
        booking.lectureDate >= targetDate &&
        isTicketActionable(booking) &&
        !hasOtherActiveTicket(sorted, booking, targetDate),
    );
    if (ticketRisk) {
      const expired = ticketRisk.ticketExpiryLevel === "expired" || isTicketExpired(ticketRisk.ticketExpiresAt);
      const remaining = ticketRemainingText(ticketRisk.ticketRemainingCount);
      out.push({
        actionKey: `ticket_expiring_${memberId || memberName}`,
        type: "ticket_expiring",
        label: "수강권",
        title: memberName,
        body: `${expired ? "만료" : "만료임박"}${remaining}`,
        level: expired ? "bad" : "wait",
        memberId,
        memberName,
        sort: `0_${memberName}`,
      });
    }

    if (includeAttendanceHistoryActions) {
      const recentStart = addDays(targetDate, -13);
      const previousStart = addDays(targetDate, -27);
      const previousEnd = addDays(targetDate, -14);
      const previous = sorted.filter((row) => row.lectureDate >= previousStart && row.lectureDate <= previousEnd && row.appStatus === "reserved");
      const recent = sorted.filter((row) => row.lectureDate >= recentStart && row.lectureDate <= targetDate && row.appStatus === "reserved");
      const previousRate = attendanceRate(previous);
      const recentRate = attendanceRate(recent);
      const recentAbsent = recent.filter((row) => ["absent", "late_cancel"].includes(row.attendanceStatus)).length;
      if (previous.length >= 2 && recent.length >= 2 && previousRate >= 0.7 && (recentRate <= 0.5 || previousRate - recentRate >= 0.35)) {
        out.push({
          actionKey: `attendance_drop_${memberId || memberName}`,
          type: "attendance_drop",
          label: "출석률",
          title: memberName,
          body: `${percentText(previousRate)} → ${percentText(recentRate)}`,
          level: "bad",
          memberId,
          memberName,
          sort: `1_${memberName}`,
        });
      } else if (recentAbsent >= 2) {
        out.push({
          actionKey: `attendance_drop_${memberId || memberName}`,
          type: "attendance_drop",
          label: "결석증가",
          title: memberName,
          body: `최근 결석 ${recentAbsent}회`,
          level: "bad",
          memberId,
          memberName,
          sort: `1_${memberName}`,
        });
      }

      const lastAttended = sorted.filter((row) => row.attendanceStatus === "attended").at(-1);
      if (lastAttended && daysBetween(lastAttended.lectureDate, targetDate) >= 21 && hasActiveTicket(sorted, targetDate)) {
        out.push({
          actionKey: `long_absence_${memberId || memberName}`,
          type: "long_absence",
          label: "장기미방문",
          title: memberName,
          body: `${lastAttended.lectureDate} 이후 출석 없음`,
          level: "wait",
          memberId,
          memberName,
          sort: `2_${memberName}`,
        });
      }
    }

    return out;
  });
}

function summarize(actions: Action[]): AdminActionDoc["summary"] {
  return {
    total: actions.length,
    ticketExpiring: actions.filter((action) => action.type === "ticket_expiring").length,
    attendanceDrop: actions.filter((action) => action.type === "attendance_drop").length,
    longAbsence: actions.filter((action) => action.type === "long_absence").length,
    lowClass: actions.filter((action) => action.type === "low_class").length,
    attendanceUnchecked: actions.filter((action) => action.type === "attendance_unchecked").length,
  };
}

function isPastLecture(lecture: LectureDoc): boolean {
  return Boolean((lecture.endAt || lecture.startAt)?.toMillis() && (lecture.endAt || lecture.startAt)!.toMillis() <= Date.now());
}

function isTicketExpiringSoon(value: BookingDoc["ticketExpiresAt"]): boolean {
  if (!value) return false;
  const diffDays = (value.toMillis() - Date.now()) / (24 * 60 * 60 * 1000);
  return diffDays >= 0 && diffDays <= 14;
}

function isTicketExpired(value: BookingDoc["ticketExpiresAt"]): boolean {
  return Boolean(value && value.toMillis() < Date.now());
}

function isTicketActionable(booking: BookingDoc): boolean {
  const remaining = Number(booking.ticketRemainingCount);
  const lowRemaining = Number.isFinite(remaining) && remaining >= 0 && remaining < 5 && Boolean(booking.ticketName);
  return ["soon", "expired"].includes(booking.ticketExpiryLevel) || isTicketExpiringSoon(booking.ticketExpiresAt) || lowRemaining;
}

function ticketRemainingText(value: BookingDoc["ticketRemainingCount"]): string {
  if (value == null) return "";
  const remaining = Number(value);
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > 100) return "";
  return ` · ${remaining}회`;
}

function hasActiveTicket(rows: BookingDoc[], targetDate: string): boolean {
  return rows.some((row) => {
    if (!row.ticketName) return false;
    if (row.ticketExpiryLevel === "expired" || isTicketExpired(row.ticketExpiresAt)) return false;
    if (row.ticketExpiresAt && row.ticketExpiresAt.toMillis() < new Date(`${targetDate}T00:00:00+09:00`).getTime()) return false;
    const remaining = Number(row.ticketRemainingCount);
    return !Number.isFinite(remaining) || remaining > 0;
  });
}

function hasOtherActiveTicket(rows: BookingDoc[], target: BookingDoc, targetDate: string): boolean {
  const targetTicketKey = ticketIdentity(target);
  return rows.some((row) => {
    if (row === target) return false;
    if (!row.ticketName) return false;
    if (ticketIdentity(row) === targetTicketKey) return false;
    if (row.ticketExpiryLevel === "expired" || isTicketExpired(row.ticketExpiresAt)) return false;
    if (row.ticketExpiresAt && row.ticketExpiresAt.toMillis() < new Date(`${targetDate}T00:00:00+09:00`).getTime()) return false;
    const remaining = Number(row.ticketRemainingCount);
    return !Number.isFinite(remaining) || remaining > 0;
  });
}

function ticketIdentity(booking: BookingDoc): string {
  const row = booking as BookingDoc & { userTicketId?: string; ticketId?: string };
  if (row.userTicketId) return `user:${row.userTicketId}`;
  const expiresAt = booking.ticketExpiresAt?.toMillis() || "";
  return [row.ticketId || "", booking.ticketName || "", expiresAt].filter(Boolean).join("|");
}

function attendanceRate(rows: BookingDoc[]): number {
  const checked = rows.filter((row) => ["attended", "absent", "late_cancel"].includes(row.attendanceStatus));
  if (!checked.length) return 0;
  return checked.filter((row) => row.attendanceStatus === "attended").length / checked.length;
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00+09:00`);
  const end = new Date(`${endDate}T00:00:00+09:00`);
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function percentText(value: number): string {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function timeText(lecture: LectureDoc): string {
  const date = lecture.startAt?.toDate();
  if (!date) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
