import type { AttendanceSummaryDoc, BookingDoc } from "../types/models";
import { getRecentMemberBookings } from "../firestore/bookingRepository";
import { refs } from "../firestore/refs";
import { attendanceTotals } from "../utils/attendance";
import { addDays, nowTimestamp } from "../utils/date";

export async function rebuildAttendanceSummaries(input: {
  studioId: string;
  endDate: string;
  bookings: BookingDoc[];
}): Promise<void> {
  const periodStart = addDays(input.endDate, -29);
  const targetMemberIds = uniqueMemberIds(input.bookings);
  if (!targetMemberIds.length) return;

  const recentBookings = await getRecentMemberBookings(input.studioId, targetMemberIds, periodStart, input.endDate);
  const sourceBookings = mergeBookings(input.bookings, recentBookings);
  const targetMemberSet = new Set(targetMemberIds);
  const grouped = new Map<string, BookingDoc[]>();
  sourceBookings
    .filter((booking) => targetMemberSet.has(booking.memberId))
    .filter((booking) => booking.lectureDate >= periodStart && booking.lectureDate <= input.endDate)
    .forEach((booking) => {
      const list = grouped.get(booking.memberId) || [];
      list.push(booking);
      grouped.set(booking.memberId, list);
    });

  await Promise.all(
    [...grouped.entries()].map(([memberId, rows]) => {
      const totals = attendanceTotals(rows, input.endDate);
      const doc: AttendanceSummaryDoc = {
        summaryId: `${memberId}_${input.endDate.replaceAll("-", "")}`,
        studioId: input.studioId,
        memberId,
        periodStart,
        periodEnd: input.endDate,
        attended: totals.attended,
        absent: totals.absent,
        cancel: totals.cancel,
        waitCancel: totals.waitCancel,
        total: totals.total,
        updatedAt: nowTimestamp(),
      };
      return refs.attendanceSummary(memberId, input.endDate.replaceAll("-", "")).set(doc, { merge: true });
    }),
  );
}

function uniqueMemberIds(bookings: BookingDoc[]): string[] {
  return [...new Set(bookings.map((booking) => booking.memberId).filter(Boolean))];
}

function mergeBookings(primary: BookingDoc[], secondary: BookingDoc[]): BookingDoc[] {
  const map = new Map<string, BookingDoc>();
  [...secondary, ...primary].forEach((booking) => {
    const key = booking.bookingId || `${booking.memberId}_${booking.lectureId}_${booking.lectureDate}`;
    if (key) map.set(key, booking);
  });
  return [...map.values()];
}
