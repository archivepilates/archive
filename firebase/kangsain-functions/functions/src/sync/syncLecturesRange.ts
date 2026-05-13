import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { refs } from "../firestore/refs";
import { markBookingsCanceledForLectures, upsertBookingIfChanged } from "../firestore/bookingRepository";
import { markMissingLecturesDeleted, upsertLectureIfChanged } from "../firestore/lectureRepository";
import { saveRawMirrorBatch } from "../firestore/rawMirrorRepository";
import { getActiveStaffs, upsertStaff } from "../firestore/staffRepository";
import { StudioMateClient } from "../studiomate/studiomateClient";
import { asArray, normalizeBooking, normalizeLecture } from "../studiomate/normalizers";
import type { BookingDoc, LectureDoc } from "../types/models";
import { addDays, dateRange, nowTimestamp, todayKst } from "../utils/date";
import { rebuildInstructorViewsForDates } from "./rebuildInstructorViews";
import { rebuildAttendanceSummaries } from "./rebuildAttendanceSummaries";
import { rebuildMemberInsights } from "./rebuildMemberInsights";
import { syncStudioMateMemberMemos } from "./syncStudioMateMemberMemos";
import { syncStudioMateMemberProfiles } from "./syncStudioMateMemberProfiles";
import { rebuildAdminActions } from "./rebuildAdminActions";
import { syncConsultationsRange } from "./syncConsultationsRange";
import { syncOtherSchedulesRange } from "./syncOtherSchedulesRange";

export async function syncLecturesRange(input: {
  studioId?: string;
  startDate: string;
  endDate: string;
}): Promise<{
  lecturesChanged: number;
  bookingsChanged: number;
  totalLectures: number;
  totalBookings: number;
  consultationsChanged: number;
  consultationsDeleted: number;
  totalConsultations: number;
  otherSchedulesChanged: number;
  otherSchedulesDeleted: number;
  totalOtherSchedules: number;
  otherSchedulesWarning?: string;
}> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  let phase = "create client";
  try {
    const client = new StudioMateClient(studioId);
    phase = "fetch lectures";
    const rawLectures = await client.getLectures({ startDate: input.startDate, endDate: input.endDate });
    await saveRawMirrorBatch({
      studioId,
      dataset: "staffLectures",
      sourcePath: "/v2/staff/lectures",
      records: rawLectures,
      mirrorDate: input.startDate === input.endDate ? input.startDate : todayKst(),
    });

    let lecturesChanged = 0;
    let bookingsChanged = 0;
    const allBookings: BookingDoc[] = [];
    const allLectures: LectureDoc[] = [];
    const staffDates: Array<{ staffId: string; date: string }> = [];
    const lectureIdsByDate = new Map<string, Set<string>>();

    for (const rawLecture of rawLectures) {
      phase = "normalize lecture";
      const lecture = normalizeLecture(rawLecture, studioId);
      if (!lecture.lectureId || !lecture.date) continue;
      allLectures.push(lecture);
      const dateLectureIds = lectureIdsByDate.get(lecture.date) || new Set<string>();
      dateLectureIds.add(lecture.lectureId);
      lectureIdsByDate.set(lecture.date, dateLectureIds);
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

    phase = "mark missing lectures deleted";
    const deletedLectureIds: string[] = [];
    for (const date of dateRange(input.startDate, input.endDate)) {
      deletedLectureIds.push(
        ...(await markMissingLecturesDeleted({
          studioId,
          date,
          activeLectureIds: lectureIdsByDate.get(date) || new Set<string>(),
        })),
      );
    }
    if (deletedLectureIds.length) {
      phase = "mark deleted lecture bookings canceled";
      bookingsChanged += await markBookingsCanceledForLectures(studioId, deletedLectureIds);
    }

    phase = "rebuild attendance summaries";
    await rebuildAttendanceSummaries({
      studioId,
      endDate: input.endDate > todayKst() ? todayKst() : input.endDate,
      bookings: allBookings,
    });
    phase = "sync studiomate member memos";
    await syncStudioMateMemberMemos({
      studioId,
      bookings: allBookings,
    });
    phase = "sync studiomate member profiles";
    await syncStudioMateMemberProfiles({
      studioId,
      bookings: allBookings,
    });
    phase = "rebuild member insights";
    await rebuildMemberInsights({
      studioId,
      endDate: input.endDate > todayKst() ? todayKst() : input.endDate,
      bookings: allBookings,
    });
    phase = "rebuild instructor views";
    await rebuildInstructorViewsForDates(studioId, [
      ...staffDates,
      ...(await activeStaffDates(studioId, input.startDate, input.endDate)),
    ]);
    phase = "rebuild admin actions";
    await rebuildAdminActions({
      studioId,
      startDate: input.startDate,
      endDate: input.endDate,
      lectures: allLectures,
      bookings: allBookings,
    });
    phase = "sync consultations";
    const consultationResult = await syncConsultationsRange({
      studioId,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    phase = "sync other schedules";
    const otherScheduleResult = await syncOtherSchedulesRange({
      studioId,
      startDate: input.startDate,
      endDate: input.endDate,
    });
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

    logger.info("syncLecturesRange completed", {
      studioId,
      ...input,
      lecturesChanged,
      bookingsChanged,
      deletedLectures: deletedLectureIds.length,
      ...consultationResult,
      ...otherScheduleResult,
    });
    return {
      lecturesChanged,
      bookingsChanged,
      totalLectures: rawLectures.length,
      totalBookings: allBookings.length,
      ...consultationResult,
      ...otherScheduleResult,
    };
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

async function activeStaffDates(
  studioId: string,
  startDate: string,
  endDate: string,
): Promise<Array<{ staffId: string; date: string }>> {
  const today = todayKst();
  const boundedStart = startDate < today ? today : startDate;
  const boundedEnd = endDate > addDays(today, 14) ? addDays(today, 14) : endDate;
  const dates = dateRange(boundedStart, boundedEnd);
  const staffs = await getActiveStaffs(studioId);
  return staffs.flatMap((staff) => dates.map((date) => ({ staffId: staff.staffId, date })));
}
