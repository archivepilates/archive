import { createHash } from "node:crypto";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc, BookingDoc, PrivateSurveyRequestDoc } from "../types/models";

export async function privateSurveySendabilityIssue(candidate: AlimtalkCandidateDoc): Promise<string> {
  if (candidate.type !== "private_survey") return "";
  const requestId = String(candidate.payload?.surveyId || candidate.payload?.responseId || "");
  if (!requestId) return "프라이빗 사전설문 요청 ID가 없습니다.";
  const request = (await refs.privateSurveyRequest(requestId).get()).data();
  if (!request) return "프라이빗 사전설문 요청 문서를 찾을 수 없습니다.";
  const bookingId = String(request.bookingId || candidate.payload?.bookingId || "");
  const booking = bookingId ? (await refs.booking(bookingId).get()).data() : undefined;
  const replacementId = String(
    booking?.supersededByBookingId || booking?.sessionOrder?.supersededByBookingId || "",
  ).trim();
  const replacementBooking = replacementId
    ? (await refs.booking(replacementId).get()).data()
    : undefined;
  return privateSurveySourceIssue(candidate, request, booking, Date.now(), replacementBooking);
}

export function privateSurveySourceIssue(
  candidate: AlimtalkCandidateDoc,
  request: PrivateSurveyRequestDoc,
  booking: BookingDoc | undefined,
  nowMs = Date.now(),
  replacementBooking?: BookingDoc,
): string {
  if (request.status === "submitted") return "프라이빗 사전설문이 이미 제출되었습니다.";
  if (request.status === "cancelled") return "취소된 프라이빗 사전설문 요청입니다.";
  if (request.status === "expired" || (request.expiresAt?.toMillis?.() || Number.POSITIVE_INFINITY) < nowMs) {
    return "프라이빗 사전설문 제출 기간이 만료되었습니다.";
  }
  if (request.memberId !== candidate.memberId) return "설문 요청 회원과 발송 후보 회원이 다릅니다.";
  const accessToken = String(candidate.payload?.accessToken || "");
  if (!accessToken) return "프라이빗 사전설문 접근 토큰이 없습니다.";
  if (!request.accessTokenHash || sha256(accessToken) !== request.accessTokenHash) {
    return "프라이빗 사전설문 접근 토큰이 현재 요청과 다릅니다.";
  }
  const effectiveBooking = replacementBooking || booking;
  if (!effectiveBooking || effectiveBooking.memberId !== candidate.memberId) {
    return "연결된 프라이빗 예약을 찾을 수 없습니다.";
  }
  if (effectiveBooking.appStatus !== "reserved") {
    return `프라이빗 예약 상태가 ${effectiveBooking.appStatus || "unknown"}입니다.`;
  }
  if (effectiveBooking.sessionOrder?.counted === false) {
    return `프라이빗 회차 제외 예약입니다: ${
      effectiveBooking.sessionOrder.excludedReason || "session_order_excluded"
    }`;
  }
  if (/cancel|deleted|inactive|stale|missing/i.test(String(effectiveBooking.sourceStatus || ""))) {
    return "취소·삭제·변경된 프라이빗 예약입니다.";
  }
  const lessonStartMs =
    effectiveBooking.lectureStartAt?.toMillis?.() || request.lessonStartAt?.toMillis?.() || 0;
  if (lessonStartMs && lessonStartMs <= nowMs) {
    return "수업 시작 이후 프라이빗 사전설문 발송 제외";
  }
  if (!isPrivateBooking(effectiveBooking)) return "프라이빗 수업 예약이 아닙니다.";
  if (
    replacementBooking &&
    booking &&
    replacementBooking.bookingId === booking.bookingId
  ) {
    return "대체 예약 ID가 기존 예약과 같습니다.";
  }
  return "";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isPrivateBooking(booking: BookingDoc): boolean {
  if (booking.lessonType === "group") return false;
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return true;
  const text = `${booking.ticketName || ""} ${booking.ticketClassType || ""} ${booking.ticketType || ""}`;
  return /프라이빗|개인|1:1|PRIVATE|\bP\b/i.test(text);
}
