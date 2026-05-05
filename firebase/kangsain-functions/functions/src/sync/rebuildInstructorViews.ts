import type { BookingDoc, InstructorViewDoc, LectureDoc, MemberTagDoc } from "../types/models";
import { getBookingsByStaffDate } from "../firestore/bookingRepository";
import { getLecturesByStaffDate } from "../firestore/lectureRepository";
import { saveInstructorView } from "../firestore/instructorViewRepository";
import { getMemberTagsMap } from "../firestore/memberTagRepository";
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
  const tagsByMember = await getMemberTagsMap(bookings.map((booking) => booking.memberId));
  const view = buildInstructorView(input.studioId, input.staffId, input.date, lectures, bookings, tagsByMember);
  await saveInstructorView(view);
  return view;
}

export async function rebuildInstructorViewsForDates(
  studioId: string,
  staffDates: Array<{ staffId: string; date: string }>,
): Promise<void> {
  const unique = new Map(staffDates.map((item) => [`${item.staffId}_${item.date}`, item]));
  await Promise.all([...unique.values()].map((item) => rebuildInstructorView({ studioId, ...item })));
}

function buildInstructorView(
  studioId: string,
  staffId: string,
  date: string,
  lectures: LectureDoc[],
  bookings: BookingDoc[],
  tagsByMember: Map<string, MemberTagDoc["tags"]>,
): InstructorViewDoc {
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
        startAt: lecture.startAt,
        endAt: lecture.endAt,
        title: lecture.title,
        roomName: lecture.roomName,
        divisionName: lecture.divisionName,
        lessonType: resolvedLessonType(lecture),
        capacity: lecture.capacity,
        bookingCount: lectureBookings.filter((booking) => booking.appStatus === "reserved").length,
        waitCount: lectureBookings.filter((booking) => booking.appStatus === "wait").length,
        uncheckedAttendanceCount: lectureBookings.filter(
          (booking) => booking.appStatus === "reserved" && booking.attendanceStatus === "unchecked",
        ).length,
        hasTodayChange: lectureBookings.some(
          (booking) => booking.sourceUpdatedAt && booking.sourceUpdatedAt.toMillis() > startOfKstDate(date).getTime(),
        ),
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
          tags: instructorVisibleTags(tagsByMember.get(booking.memberId) || []),
          lastMemoPreview: booking.lastMemoPreview.slice(0, 60),
          lastMemoAt: booking.lastMemoAt,
        })),
      };
    });

  const activeBookings = bookings.filter((booking) => booking.appStatus === "reserved");

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
      cancelCount: bookings.filter((booking) => booking.appStatus === "cancel" || booking.appStatus === "wait_cancel")
        .length,
      waitCount: bookings.filter((booking) => booking.appStatus === "wait").length,
    },
    lectures: viewLectures,
    updatedAt: nowTimestamp(),
  };
}

function timeText(lecture: LectureDoc): string {
  const start = lecture.startAt?.toDate();
  const end = lecture.endAt?.toDate();
  if (!start) return "";
  const hhmm = (date: Date) =>
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  return end ? `${hhmm(start)} - ${hhmm(end)}` : hhmm(start);
}

function resolvedLessonType(lecture: LectureDoc): LectureDoc["lessonType"] {
  return lecture.lessonType;
}

function instructorVisibleTags(tags: MemberTagDoc["tags"]): MemberTagDoc["tags"] {
  return tags.filter((tag) => tag.source === "auto_attendance" || tag.label.startsWith("30일 출석"));
}

function startOfKstDate(date: string): Date {
  return new Date(`${date}T00:00:00+09:00`);
}
