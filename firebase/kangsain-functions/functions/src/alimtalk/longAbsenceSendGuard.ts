import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc, BookingDoc } from "../types/models";
import { canonicalizeBookings } from "../utils/canonicalBooking";
import { assessLongAbsenceTarget } from "./longAbsencePolicy";

export async function longAbsenceCandidateSendabilityIssue(
  candidate: AlimtalkCandidateDoc,
): Promise<string> {
  if (candidate.type !== "long_absence") return "";
  if (!candidate.memberId) return "장기 미출석 회원 ID 없음";

  const [profileSnap, bookingsSnap] = await Promise.all([
    refs.memberProfile(candidate.memberId).get(),
    refs
      .bookings()
      .where("memberId", "==", candidate.memberId)
      .select(
        "bookingId",
        "memberId",
        "memberName",
        "staffId",
        "staffName",
        "lectureDate",
        "lectureStartAt",
        "ticketName",
        "ticketClassType",
        "ticketType",
        "appStatus",
        "attendanceStatus",
      )
      .get(),
  ]);
  const profile = profileSnap.data();
  if (!profile) return "장기 미출석 회원 원천 없음";

  const bookings = canonicalizeBookings(bookingsSnap.docs.map((doc) => doc.data() as BookingDoc));
  const assessment = assessLongAbsenceTarget({
    profile,
    sourceDate: candidate.sourceDate,
    bookings,
  });
  if (!assessment.eligible) return `장기 미출석 발송 직전 제외: ${assessment.issue}`;

  const sourceLastAttendance = String(candidate.payload?.lastAttendanceDate || "");
  if (sourceLastAttendance !== assessment.lastAttendance?.lectureDate) {
    return "장기 미출석 마지막 출석 원천 변경";
  }
  return "";
}
