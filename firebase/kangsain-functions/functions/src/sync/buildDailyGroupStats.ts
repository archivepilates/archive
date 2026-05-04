import type { DailyGroupStatsDoc } from "../types/models";
import { getBookingsByStaffDate } from "../firestore/bookingRepository";
import { getLecturesByDate } from "../firestore/lectureRepository";
import { refs } from "../firestore/refs";
import { nowTimestamp } from "../utils/date";

export async function buildDailyGroupStats(input: { studioId: string; date: string }): Promise<DailyGroupStatsDoc> {
  const lectures = (await getLecturesByDate(input.studioId, input.date)).filter((lecture) => lecture.lessonType === "group");
  const staffIds = [...new Set(lectures.map((lecture) => lecture.staffId).filter(Boolean))];
  const bookingLists = await Promise.all(staffIds.map((staffId) => getBookingsByStaffDate(input.studioId, staffId, input.date)));
  const bookings = bookingLists.flat().filter((booking) => booking.appStatus === "reserved");
  const byStaff: DailyGroupStatsDoc["byStaff"] = {};

  for (const staffId of staffIds) {
    const staffLectures = lectures.filter((lecture) => lecture.staffId === staffId);
    const lectureIds = new Set(staffLectures.map((lecture) => lecture.lectureId));
    const staffBookings = bookings.filter((booking) => lectureIds.has(booking.lectureId));
    byStaff[staffId] = {
      staffName: staffLectures[0]?.staffName || "",
      groupLectureCount: staffLectures.length,
      groupBookingCount: staffBookings.length,
      averageMembers: staffLectures.length ? Number((staffBookings.length / staffLectures.length).toFixed(2)) : 0,
    };
  }

  const doc: DailyGroupStatsDoc = {
    statId: `${input.studioId}_${input.date}`,
    studioId: input.studioId,
    date: input.date,
    groupLectureCount: lectures.length,
    groupBookingCount: bookings.length,
    averageMembers: lectures.length ? Number((bookings.length / lectures.length).toFixed(1)) : 0,
    byStaff,
    updatedAt: nowTimestamp(),
  };
  await refs.dailyGroupStat(input.studioId, input.date).set(doc, { merge: true });
  return doc;
}

