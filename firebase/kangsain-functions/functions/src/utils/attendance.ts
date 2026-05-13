import type { BookingDoc } from "../types/models";

export interface AttendanceTotals {
  attended: number;
  absent: number;
  cancel: number;
  waitCancel: number;
  total: number;
}

export function actualAttendanceBookings(bookings: BookingDoc[], endDate?: string): BookingDoc[] {
  const endMs = endDate ? new Date(`${endDate}T23:59:59.999+09:00`).getTime() : Date.now();
  const map = new Map<string, BookingDoc>();

  bookings
    .filter((booking) => booking.lectureDate && booking.lectureDate <= (endDate || booking.lectureDate))
    .filter((booking) => isPastBooking(booking, endMs))
    .filter(isActualAttendanceBooking)
    .forEach((booking) => {
      const key = attendanceKey(booking);
      const current = map.get(key);
      if (!current || bookingPriority(booking) > bookingPriority(current) || bookingUpdatedAt(booking) > bookingUpdatedAt(current)) {
        map.set(key, booking);
      }
    });

  return [...map.values()];
}

export function attendanceTotals(bookings: BookingDoc[], endDate?: string): AttendanceTotals {
  const actual = actualAttendanceBookings(bookings, endDate);
  return {
    attended: actual.filter((booking) => booking.attendanceStatus === "attended").length,
    absent: actual.filter((booking) => booking.attendanceStatus === "absent" || booking.attendanceStatus === "late_cancel").length,
    cancel: bookings.filter((booking) => booking.appStatus === "cancel" && booking.attendanceStatus !== "late_cancel").length,
    waitCancel: bookings.filter((booking) => booking.appStatus === "wait_cancel").length,
    total: actual.length,
  };
}

function isActualAttendanceBooking(booking: BookingDoc): boolean {
  if (booking.appStatus === "wait" || booking.appStatus === "wait_cancel") return false;
  if (booking.attendanceStatus === "attended") return booking.appStatus === "reserved";
  return booking.attendanceStatus === "absent" || booking.attendanceStatus === "late_cancel";
}

function isPastBooking(booking: BookingDoc, endMs: number): boolean {
  const bookingEnd = booking.lectureEndAt?.toMillis() || booking.lectureStartAt?.toMillis();
  if (bookingEnd) return bookingEnd <= endMs;
  if (!booking.lectureDate) return false;
  return new Date(`${booking.lectureDate}T23:59:59.999+09:00`).getTime() <= endMs;
}

function attendanceKey(booking: BookingDoc): string {
  const lectureKey =
    booking.lectureId ||
    `${booking.lectureDate}_${booking.lectureStartAt?.toMillis() || ""}_${booking.staffId || booking.staffName || ""}`;
  return `${booking.memberId || booking.memberName}_${lectureKey}`;
}

function bookingPriority(booking: BookingDoc): number {
  if (booking.attendanceStatus === "attended") return 4;
  if (booking.attendanceStatus === "absent") return 3;
  if (booking.attendanceStatus === "late_cancel") return 2;
  return 1;
}

function bookingUpdatedAt(booking: BookingDoc): number {
  return booking.updatedAt?.toMillis() || booking.sourceUpdatedAt?.toMillis() || booking.syncedAt?.toMillis() || 0;
}
