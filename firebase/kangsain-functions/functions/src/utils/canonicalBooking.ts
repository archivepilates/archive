import type { BookingDoc } from "../types/models";

export type CanonicalBookingDecision = {
  key: string;
  bookingId: string;
  selected: boolean;
  sourcePriority: number;
  excludedReason?: string;
};

export function canonicalizeBookings(bookings: BookingDoc[]): BookingDoc[] {
  const grouped = new Map<string, BookingDoc>();
  for (const booking of bookings) {
    const key = bookingOccurrenceKey(booking);
    const current = grouped.get(key);
    if (!current || shouldPreferCanonicalBooking(booking, current)) grouped.set(key, booking);
  }
  return [...grouped.values()].sort(compareBookingsByTime);
}

export function canonicalBookingDecisions(bookings: BookingDoc[]): CanonicalBookingDecision[] {
  const selected = new Map<string, BookingDoc>();
  for (const booking of bookings) {
    const key = bookingOccurrenceKey(booking);
    const current = selected.get(key);
    if (!current || shouldPreferCanonicalBooking(booking, current)) selected.set(key, booking);
  }
  return bookings.map((booking) => {
    const key = bookingOccurrenceKey(booking);
    const winner = selected.get(key);
    const isSelected = winner?.bookingId === booking.bookingId;
    return {
      key,
      bookingId: booking.bookingId,
      selected: isSelected,
      sourcePriority: bookingSourcePriority(booking.bookingId),
      excludedReason: isSelected ? undefined : duplicateExclusionReason(booking, winner),
    };
  });
}

export function bookingOccurrenceKey(booking: BookingDoc): string {
  return [
    booking.memberId || normalizeKoreanName(booking.memberName || ""),
    booking.staffId || normalizeKoreanName(booking.staffName || ""),
    timestampMillisFromValue(booking.lectureStartAt) || booking.lectureDate,
  ].join("|");
}

export function shouldPreferCanonicalBooking(next: BookingDoc, current: BookingDoc): boolean {
  const nextPriority = bookingSourcePriority(next.bookingId);
  const currentPriority = bookingSourcePriority(current.bookingId);
  if (nextPriority !== currentPriority) return nextPriority < currentPriority;
  const nextAttendanceScore = attendanceScore(next.attendanceStatus);
  const currentAttendanceScore = attendanceScore(current.attendanceStatus);
  if (nextAttendanceScore !== currentAttendanceScore) return nextAttendanceScore > currentAttendanceScore;
  if (next.appStatus !== current.appStatus) {
    if (next.appStatus === "reserved") return true;
    if (current.appStatus === "reserved") return false;
  }
  return String(next.bookingId || "") < String(current.bookingId || "");
}

export function bookingSourcePriority(bookingId: string): number {
  const id = String(bookingId || "");
  if (id.startsWith("usage_booking_")) return 1;
  if (id.startsWith("excel_booking_")) return 2;
  if (id.startsWith("excel_") || id.startsWith("usage_")) return 3;
  return 0;
}

export function isFallbackBookingId(bookingId: string): boolean {
  const id = String(bookingId || "");
  return id.startsWith("usage_booking_") || id.startsWith("excel_booking_") || id.startsWith("excel_") || id.startsWith("usage_");
}

export function isExcelBookingId(bookingId: string): boolean {
  return String(bookingId || "").startsWith("excel_booking_");
}

function compareBookingsByTime(a: BookingDoc, b: BookingDoc): number {
  if (a.lectureDate !== b.lectureDate) return a.lectureDate.localeCompare(b.lectureDate);
  return timestampMillisFromValue(a.lectureStartAt) - timestampMillisFromValue(b.lectureStartAt);
}

function duplicateExclusionReason(booking: BookingDoc, winner?: BookingDoc): string {
  if (!winner) return "canonical_booking_unresolved";
  if (bookingSourcePriority(booking.bookingId) > bookingSourcePriority(winner.bookingId)) return "fallback_source_superseded";
  if (booking.appStatus !== winner.appStatus) return "lower_status_priority";
  if (attendanceScore(booking.attendanceStatus) < attendanceScore(winner.attendanceStatus)) return "lower_attendance_priority";
  return "duplicate_booking_occurrence";
}

function attendanceScore(status: BookingDoc["attendanceStatus"]): number {
  if (status === "attended") return 3;
  if (status === "absent") return 2;
  if (status === "late_cancel") return 1;
  return 0;
}

function normalizeKoreanName(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

function timestampMillisFromValue(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as any).toMillis === "function") return (value as any).toMillis();
  if (typeof (value as any).toDate === "function") return (value as any).toDate().getTime();
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
