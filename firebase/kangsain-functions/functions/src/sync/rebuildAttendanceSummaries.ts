import type { AttendanceSummaryDoc, BookingDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { addDays, nowTimestamp } from "../utils/date";

export async function rebuildAttendanceSummaries(input: {
  studioId: string;
  endDate: string;
  bookings: BookingDoc[];
}): Promise<void> {
  const periodStart = addDays(input.endDate, -29);
  const grouped = new Map<string, BookingDoc[]>();
  input.bookings
    .filter((booking) => booking.memberId && booking.lectureDate >= periodStart && booking.lectureDate <= input.endDate)
    .forEach((booking) => {
      const list = grouped.get(booking.memberId) || [];
      list.push(booking);
      grouped.set(booking.memberId, list);
    });

  await Promise.all([...grouped.entries()].map(([memberId, rows]) => {
    const doc: AttendanceSummaryDoc = {
      summaryId: `${memberId}_${input.endDate.replaceAll("-", "")}`,
      studioId: input.studioId,
      memberId,
      periodStart,
      periodEnd: input.endDate,
      attended: rows.filter((row) => row.attendanceStatus === "attended").length,
      absent: rows.filter((row) => row.attendanceStatus === "absent").length,
      cancel: rows.filter((row) => row.appStatus === "cancel").length,
      waitCancel: rows.filter((row) => row.appStatus === "wait_cancel").length,
      total: rows.length,
      updatedAt: nowTimestamp(),
    };
    return refs.attendanceSummary(memberId, input.endDate.replaceAll("-", "")).set(doc, { merge: true });
  }));
}

