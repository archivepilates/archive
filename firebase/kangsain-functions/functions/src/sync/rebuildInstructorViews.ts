import type { BookingDoc, InstructorViewDoc, LectureDoc } from "../types/models";
import { getBookingsByStaffDate } from "../firestore/bookingRepository";
import { getLecturesByStaffDate } from "../firestore/lectureRepository";
import { saveInstructorView } from "../firestore/instructorViewRepository";
import { nowTimestamp } from "../utils/date";

export async function rebuildInstructorView(input: {
  studioId: string;
  staffId: string;
  date: string;
}): Promise<InstructorViewDoc> {
  const [lectures, bookings] = await Promise.all([
    getLecturesByStaffDate(input.studioId, input.staffId, input.date),
    getBookingsByStaffDate(input.studioId, input.staffId, input.date),
  ]);
  const view = buildInstructorView(input.studioId, input.staffId, input.date, lectures, bookings);
  await saveInstructorView(view);
  return view;
}

export async function rebuildInstructorViewsForDates(studioId: string, staffDates: Array<{ staffId: string; date: string }>): Promise<void> {
  const unique = new Map(staffDates.map((item) => [`${item.staffId}_${item.date}`, item]));
  await Promise.all([...unique.values()].map((item) => rebuildInstructorView({ studioId, ...item })));
}

function buildInstructorView(studioId: string, staffId: string, date: string, lectures: LectureDoc[], bookings: BookingDoc[]): InstructorViewDoc {
  const byLecture = new Map<string, BookingDoc[]>();
  bookings.forEach((booking) => {
    const list = byLecture.get(booking.lectureId) || [];
    list.push(booking);
    byLecture.set(booking.lectureId, list);
  });

  const viewLectures = lectures
    .sort((a, b) => String(a.startAt?.toMillis() || 0).localeCompare(String(b.startAt?.toMillis() || 0)))
    .map((lecture) => {
      const lectureBookings = byLecture.get(lecture.lectureId) || [];
      return {
        lectureId: lecture.lectureId,
        timeText: timeText(lecture),
        title: lecture.title,
        roomName: lecture.roomName,
        divisionName: lecture.divisionName,
        lessonType: lecture.lessonType,
        capacity: lecture.capacity,
        bookingCount: lectureBookings.filter((booking) => booking.appStatus === "reserved").length,
        waitCount: lectureBookings.filter((booking) => booking.appStatus === "wait").length,
        uncheckedAttendanceCount: lectureBookings.filter((booking) => booking.appStatus === "reserved" && booking.attendanceStatus === "unchecked").length,
        hasTodayChange: lectureBookings.some((booking) => booking.sourceUpdatedAt && booking.sourceUpdatedAt.toMillis() > startOfKstDate(date).getTime()),
        bookings: lectureBookings.map((booking) => ({
          bookingId: booking.bookingId,
          memberId: booking.memberId,
          memberName: booking.memberName,
          appStatus: booking.appStatus,
          attendanceStatus: booking.attendanceStatus,
          syncStatus: booking.syncStatus,
          ticketName: booking.ticketName,
          ticketRemainingCount: booking.ticketRemainingCount,
          ticketExpiryLevel: booking.ticketExpiryLevel,
          tags: booking.memberTagIds.map((tagId) => ({ tagId, label: tagId, level: "info" })),
          recent30Days: null,
          lastMemoPreview: booking.lastMemoPreview,
        })),
      };
    });

  const activeBookings = bookings.filter((booking) => booking.appStatus === "reserved");
  const groupLectures = lectures.filter((lecture) => lecture.lessonType === "group");
  const groupBookings = activeBookings.filter((booking) => groupLectures.some((lecture) => lecture.lectureId === booking.lectureId));
  const groupAverageMembers = groupLectures.length ? Number((groupBookings.length / groupLectures.length).toFixed(1)) : 0;

  return {
    viewId: `${staffId}_${date}`,
    studioId,
    staffId,
    date,
    summary: {
      totalLectures: lectures.length,
      totalBookings: activeBookings.length,
      uncheckedAttendanceCount: activeBookings.filter((booking) => booking.attendanceStatus === "unchecked").length,
      reservedCount: bookings.filter((booking) => booking.appStatus === "reserved").length,
      cancelCount: bookings.filter((booking) => booking.appStatus === "cancel" || booking.appStatus === "wait_cancel").length,
      waitCount: bookings.filter((booking) => booking.appStatus === "wait").length,
      groupAverageMembers,
    },
    lectures: viewLectures,
    updatedAt: nowTimestamp(),
  };
}

function timeText(lecture: LectureDoc): string {
  const start = lecture.startAt?.toDate();
  const end = lecture.endAt?.toDate();
  if (!start) return "";
  const hhmm = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return end ? `${hhmm(start)} - ${hhmm(end)}` : hhmm(start);
}

function startOfKstDate(date: string): Date {
  return new Date(`${date}T00:00:00+09:00`);
}

