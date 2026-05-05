import { getMessaging } from "firebase-admin/messaging";
import type { Timestamp } from "firebase-admin/firestore";
import { getFcmTokensByStaff } from "../firestore/fcmTokenRepository";
import { getBookingsByLecture } from "../firestore/bookingRepository";
import { getLecturesByDate } from "../firestore/lectureRepository";
import { refs } from "../firestore/refs";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { nowTimestamp, todayKst } from "../utils/date";

export async function sendAttendanceReminder(input?: {
  studioId?: string;
  date?: string;
}): Promise<{ sentLectures: number }> {
  const studioId = input?.studioId || DEFAULT_STUDIO_ID;
  const date = input?.date || todayKst();
  const lectures = await getLecturesByDate(studioId, date);
  let sentLectures = 0;

  for (const lecture of lectures) {
    if (!lecture.endAt || Date.now() - lecture.endAt.toMillis() < 60 * 60 * 1000) continue;
    const flagRef = refs.syncState(`attendanceReminder_${lecture.lectureId}_${date}`);
    if ((await flagRef.get()).exists) continue;
    const bookings = await getBookingsByLecture(studioId, lecture.lectureId);
    const unchecked = bookings.filter(
      (booking) => booking.appStatus === "reserved" && booking.attendanceStatus === "unchecked",
    ).length;
    if (!unchecked) continue;
    const tokens = await getFcmTokensByStaff(studioId, lecture.staffId);
    if (!tokens.length) continue;
    await getMessaging().sendEachForMulticast({
      tokens: tokens.map((item) => item.token),
      notification: {
        title: "출석 체크 미완료",
        body: `아직 출석 미체크 ${unchecked}명: ${timeText(lecture.startAt)}`,
      },
      data: { type: "attendance_reminder", lectureId: lecture.lectureId },
    });
    await flagRef.set({ studioId, lectureId: lecture.lectureId, date, sentAt: nowTimestamp() });
    sentLectures++;
  }
  return { sentLectures };
}

function timeText(value: Timestamp | null): string {
  const date = value?.toDate();
  if (!date) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
