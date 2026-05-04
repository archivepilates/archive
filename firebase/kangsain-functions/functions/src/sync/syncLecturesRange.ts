import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { refs } from "../firestore/refs";
import { upsertBookingIfChanged } from "../firestore/bookingRepository";
import { upsertLectureIfChanged } from "../firestore/lectureRepository";
import { upsertStaff } from "../firestore/staffRepository";
import { StudioMateClient } from "../studiomate/studiomateClient";
import { asArray, normalizeBooking, normalizeLecture } from "../studiomate/normalizers";
import type { BookingDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { rebuildInstructorViewsForDates } from "./rebuildInstructorViews";
import { buildDailyGroupStats } from "./buildDailyGroupStats";
import { rebuildAttendanceSummaries } from "./rebuildAttendanceSummaries";

export async function syncLecturesRange(input: {
  studioId?: string;
  startDate: string;
  endDate: string;
}): Promise<{ lecturesChanged: number; bookingsChanged: number; totalLectures: number; totalBookings: number }> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const client = new StudioMateClient(studioId);
  const rawLectures = await client.getLectures({ startDate: input.startDate, endDate: input.endDate });

  let lecturesChanged = 0;
  let bookingsChanged = 0;
  const allBookings: BookingDoc[] = [];
  const staffDates: Array<{ staffId: string; date: string }> = [];
  const dates = new Set<string>();

  for (const rawLecture of rawLectures) {
    const lecture = normalizeLecture(rawLecture, studioId);
    if (!lecture.lectureId || !lecture.date) continue;
    if (lecture.staffId) {
      await upsertStaff({
        staffId: lecture.staffId,
        studioId,
        name: lecture.staffName || lecture.staffId,
        role: "instructor",
        active: true,
        studiomateStaffId: lecture.staffId,
        visibleLectureStaffNames: [lecture.staffName || lecture.staffId],
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      });
    }
    if (await upsertLectureIfChanged(lecture)) lecturesChanged++;
    staffDates.push({ staffId: lecture.staffId, date: lecture.date });
    dates.add(lecture.date);

    for (const rawBooking of asArray(rawLecture.bookings)) {
      const booking = normalizeBooking(rawLecture, rawBooking, studioId);
      if (!booking.bookingId) continue;
      allBookings.push(booking);
      if (await upsertBookingIfChanged(booking)) bookingsChanged++;
    }
  }

  await rebuildAttendanceSummaries({ studioId, endDate: input.endDate, bookings: allBookings });
  await Promise.all([...dates].map((date) => buildDailyGroupStats({ studioId, date })));
  await rebuildInstructorViewsForDates(studioId, staffDates);
  await refs.syncState(`lecturesRange_${studioId}`).set({
    syncName: `lecturesRange_${studioId}`,
    studioId,
    status: "success",
    lastRunAt: nowTimestamp(),
    lastSuccessAt: nowTimestamp(),
    range: { startDate: input.startDate, endDate: input.endDate },
    errorCount: 0,
    lastError: null,
  }, { merge: true });

  logger.info("syncLecturesRange completed", { studioId, ...input, lecturesChanged, bookingsChanged });
  return { lecturesChanged, bookingsChanged, totalLectures: rawLectures.length, totalBookings: allBookings.length };
}
