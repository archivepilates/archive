import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { refs } from "../firestore/refs";
import { upsertBookingIfChanged } from "../firestore/bookingRepository";
import { upsertLectureIfChanged } from "../firestore/lectureRepository";
import { upsertStaff } from "../firestore/staffRepository";
import { StudioMateClient } from "../studiomate/studiomateClient";
import { asArray, normalizeBooking, normalizeLecture } from "../studiomate/normalizers";
import type { BookingDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { rebuildInstructorViewsForDates } from "./rebuildInstructorViews";
import { rebuildAttendanceSummaries } from "./rebuildAttendanceSummaries";
import { rebuildMemberInsights } from "./rebuildMemberInsights";

export async function syncLecturesRange(input: {
  studioId?: string;
  startDate: string;
  endDate: string;
}): Promise<{ lecturesChanged: number; bookingsChanged: number; totalLectures: number; totalBookings: number }> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  let phase = "create client";
  try {
    const client = new StudioMateClient(studioId);
    phase = "fetch lectures";
    const rawLectures = await client.getLectures({ startDate: input.startDate, endDate: input.endDate });

    let lecturesChanged = 0;
    let bookingsChanged = 0;
    const allBookings: BookingDoc[] = [];
    const staffDates: Array<{ staffId: string; date: string }> = [];

    for (const rawLecture of rawLectures) {
      phase = "normalize lecture";
      const lecture = normalizeLecture(rawLecture, studioId);
      if (!lecture.lectureId || !lecture.date) continue;
      if (lecture.staffId) {
        phase = `upsert staff ${lecture.staffId}`;
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
      phase = `upsert lecture ${lecture.lectureId}`;
      if (await upsertLectureIfChanged(lecture)) lecturesChanged++;
      staffDates.push({ staffId: lecture.staffId, date: lecture.date });

      for (const rawBooking of asArray(rawLecture.bookings)) {
        phase = "normalize booking";
        const booking = normalizeBooking(rawLecture, rawBooking, studioId);
        if (!booking.bookingId) continue;
        allBookings.push(booking);
        phase = `upsert booking ${booking.bookingId}`;
        if (await upsertBookingIfChanged(booking)) bookingsChanged++;
      }
    }

    phase = "rebuild attendance summaries";
    await rebuildAttendanceSummaries({
      studioId,
      endDate: input.endDate > todayKst() ? todayKst() : input.endDate,
      bookings: allBookings,
    });
    phase = "rebuild member insights";
    await rebuildMemberInsights({
      studioId,
      endDate: input.endDate > todayKst() ? todayKst() : input.endDate,
      bookings: allBookings,
    });
    phase = "rebuild instructor views";
    await rebuildInstructorViewsForDates(studioId, staffDates);
    phase = "write sync state";
    await refs.syncState(`lecturesRange_${studioId}`).set(
      {
        syncName: `lecturesRange_${studioId}`,
        studioId,
        status: "success",
        lastRunAt: nowTimestamp(),
        lastSuccessAt: nowTimestamp(),
        range: { startDate: input.startDate, endDate: input.endDate },
        errorCount: 0,
        lastError: null,
      },
      { merge: true },
    );

    logger.info("syncLecturesRange completed", { studioId, ...input, lecturesChanged, bookingsChanged });
    return { lecturesChanged, bookingsChanged, totalLectures: rawLectures.length, totalBookings: allBookings.length };
  } catch (err) {
    logger.error("syncLecturesRange failed", {
      studioId,
      ...input,
      phase,
      code: typeof err === "object" && err && "code" in err ? (err as { code?: unknown }).code : undefined,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}
