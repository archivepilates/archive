import { createHash, createHmac } from "node:crypto";
import { logger } from "firebase-functions";
import type { AlimtalkCandidateDoc, BookingDoc, MemberProfileDoc } from "../types/models";
import { db } from "../config/firebase";
import { privateSurveyWebhookSecret } from "../config/secrets";
import { refs } from "../firestore/refs";
import { addDays, dateRange, nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";
import { shortLinkIdForTarget, shortUrlForId } from "../utils/shortLinks";
import {
  ALIMTALK_MEMBER_EXCLUSION_REASONS,
  CANDIDATE_TEMPLATE_CODES,
  GROUP_SURVEY_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_WINDOW_DAYS,
  PRIVATE_SURVEY_ALIMTALK_START_DATE,
  alimtalkDedupePolicy,
  type SendableAlimtalkCandidateType,
} from "./templates";
import { alimtalkDedupeKey, findCompletedDuplicateForCandidate } from "./dedupe";

export async function rebuildAlimtalkCandidatesForRange(input: {
  studioId: string;
  startDate: string;
  endDate: string;
}): Promise<{ candidates: number; candidateIds: string[] }> {
  const profilesSnap = await refs.memberProfiles().where("studioId", "==", input.studioId).get();

  const writes: Array<Promise<unknown>> = [];
  const candidateIds: string[] = [];
  const profiles = profilesSnap.docs.map((snap) => snap.data());
  for (const sourceDate of dateRange(input.startDate, input.endDate)) {
    for (const profile of profiles) {
      for (const candidate of directTicketCandidates(profile, sourceDate)) {
        await enqueueSendableCandidate(candidate, candidateIds, writes);
      }
      const privateSurveyCandidate = await privateSurveyCandidateForDate(profile, sourceDate);
      if (privateSurveyCandidate) {
        await enqueueSendableCandidate(privateSurveyCandidate, candidateIds, writes);
      }
      const groupSurveyCandidate = await groupSurveyCandidateForDate(profile, sourceDate);
      if (groupSurveyCandidate) {
        const enqueued = await enqueueSendableCandidate(groupSurveyCandidate, candidateIds, writes);
        if (enqueued) writes.push(upsertGroupSurveyRequest(groupSurveyCandidate));
      }
    }
  }

  for (const profile of profiles.filter(
    (profile) =>
      profile.isNewMember &&
      !ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId] &&
      activeProfileTickets(profile, input.endDate).length > 0 &&
      registeredDate(profile) >= NEW_MEMBER_ALIMTALK_START_DATE &&
      registeredDate(profile) >= newMemberWindowStartDate(input.endDate) &&
      registeredDate(profile) <= input.endDate,
  )) {
    const sourceDate = registeredDate(profile);
    if (!sourceDate || !profile.phone) continue;
    const candidateId = `new_member_${profile.memberId}_${sourceDate}`;
    await enqueueSendableCandidate(
      {
        candidateId,
        studioId: profile.studioId,
        memberId: profile.memberId,
        memberName: profile.name,
        memberPhone: profile.phone,
        type: "new_member",
        status: "candidate",
        templateCode: CANDIDATE_TEMPLATE_CODES.new_member,
        title: "신규회원",
        reason: `최초등록 ${sourceDate}`,
        sourceDate,
        payload: {
          memberName: profile.name,
          registeredDate: sourceDate,
          activeTicketNames: activeProfileTickets(profile, input.endDate)
            .map((ticket) => ticket.name)
            .filter(Boolean)
            .join(", "),
        },
        attempts: 0,
        maxAttempts: 2,
        lastError: null,
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      candidateIds,
      writes,
    );
  }

  await Promise.all(writes);
  await markStaleCandidatesSkipped({
    studioId: input.studioId,
    startDate: input.startDate,
    endDate: input.endDate,
    currentCandidateIds: new Set(candidateIds),
  });
  logger.info("rebuildAlimtalkCandidatesForRange completed", {
    studioId: input.studioId,
    candidates: candidateIds.length,
  });
  return { candidates: candidateIds.length, candidateIds };
}

async function markStaleCandidatesSkipped(input: {
  studioId: string;
  startDate: string;
  endDate: string;
  currentCandidateIds: Set<string>;
}): Promise<void> {
  const writes: Array<Promise<unknown>> = [];
  for (const sourceDate of dateRange(input.startDate, input.endDate)) {
    const snap = await refs.alimtalkCandidates().where("sourceDate", "==", sourceDate).limit(500).get();
    snap.docs.forEach((doc) => {
      const candidate = doc.data();
      if (candidate.studioId !== input.studioId) return;
      if (input.currentCandidateIds.has(candidate.candidateId)) return;
      if (!["candidate", "reviewed", "failed"].includes(candidate.status)) return;
      writes.push(
        refs.alimtalkCandidate(candidate.candidateId).set(
          {
            status: "skipped",
            lastError: "현재 수강권 상태 재계산 결과 발송 대상 아님",
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        ),
      );
    });
  }
  await Promise.all(writes);
}

async function enqueueSendableCandidate(
  candidate: AlimtalkCandidateDoc,
  candidateIds: string[],
  writes: Array<Promise<unknown>>,
): Promise<boolean> {
  const dedupeKey = alimtalkDedupeKey(candidate);
  const dedupePolicy = alimtalkDedupePolicy(candidate.templateCode);
  const duplicate = await findCompletedDuplicateForCandidate(candidate, dedupeKey, dedupePolicy.windowDays);
  if (duplicate) {
    writes.push(markDuplicateSkipped(candidate, dedupeKey, `중복 발송 차단(${dedupePolicy.label}): ${duplicate}`));
    return false;
  }
  candidateIds.push(candidate.candidateId);
  writes.push(upsertCandidate({ ...candidate, dedupeKey }));
  return true;
}

function directTicketCandidates(profile: MemberProfileDoc, sourceDate: string): AlimtalkCandidateDoc[] {
  if (!profile.memberId || !profile.name || !profile.phone) return [];
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId]) return [];
  return activeProfileTickets(profile, sourceDate)
    .map((ticket) => directTicketCandidate(profile, ticket, sourceDate))
    .filter((candidate): candidate is AlimtalkCandidateDoc => Boolean(candidate));
}

async function groupSurveyCandidateForDate(
  profile: MemberProfileDoc,
  sourceDate: string,
): Promise<AlimtalkCandidateDoc | null> {
  if (sourceDate < GROUP_SURVEY_ALIMTALK_START_DATE) return null;
  if (!profile.memberId || !profile.name || !profile.phone) return null;
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId]) return null;
  const booking = await firstUpcomingGroupBookingInReservationWindow(profile.memberId, sourceDate);
  if (!booking) return null;
  if (await hasSubmittedGroupSurvey(profile.memberId, profile.phone)) return null;
  if (await hasAttendedGroupBookingOnOrBefore(profile.memberId, sourceDate)) return null;
  const requestId = groupSurveyRequestId(profile.memberId, booking.bookingId);
  const accessToken = groupSurveyAccessToken(requestId);
  const targetUrl = groupSurveyTargetUrl(requestId, accessToken);
  const shortLinkId = shortLinkIdForTarget("group_survey", targetUrl);
  const timing = groupSurveyTiming(booking, sourceDate);
  return {
    candidateId: `group_survey_${profile.memberId}_${sourceDate}`,
    studioId: profile.studioId,
    memberId: profile.memberId,
    memberName: profile.name,
    memberPhone: profile.phone,
    type: "group_survey",
    status: "candidate",
    templateCode: CANDIDATE_TEMPLATE_CODES.group_survey,
    title: "그룹 첫 수업 사전확인",
    reason: `첫 그룹수업 예약 ${booking.lectureDate}`,
    sourceDate,
    payload: {
      memberName: profile.name,
      ticketName: booking.ticketName || "",
      bookingId: booking.bookingId,
      lectureId: booking.lectureId,
      lectureDate: booking.lectureDate,
      staffId: booking.staffId,
      staffName: booking.staffName,
      surveyId: requestId,
      responseId: requestId,
      accessToken,
      shortLinkId,
      shortUrl: shortUrlForId(shortLinkId),
      groupSurveyWindowEndDate: reservationOpenEndDate(sourceDate),
      groupSurveyDeliveryMode: timing.deliveryMode,
      minutesUntilLesson: timing.minutesUntilLesson,
    },
    attempts: 0,
    maxAttempts: 2,
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

async function firstUpcomingGroupBookingInReservationWindow(
  memberId: string,
  sourceDate: string,
): Promise<BookingDoc | null> {
  const endDate = reservationOpenEndDate(sourceDate);
  const snap = await refs.bookings().where("memberId", "==", memberId).get();
  const bookings = snap.docs
    .map((doc) => doc.data())
    .filter(
      (booking) =>
        booking.appStatus === "reserved" &&
        booking.lectureDate >= sourceDate &&
        booking.lectureDate <= endDate &&
        isGroupBooking(booking),
    )
    .sort((a, b) => {
      if (a.lectureDate !== b.lectureDate) return a.lectureDate.localeCompare(b.lectureDate);
      return (a.lectureStartAt?.toMillis() || 0) - (b.lectureStartAt?.toMillis() || 0);
    });
  return bookings[0] || null;
}

async function hasSubmittedGroupSurvey(memberId: string, memberPhone: string): Promise<boolean> {
  const byMember = await refs.privateSurveyResponses().where("matching.memberId", "==", memberId).limit(10).get();
  if (byMember.docs.some((doc) => doc.data().surveyType === "group" && isRecentSurveyResponse(doc.data()))) return true;
  const byPhone = await refs.privateSurveyResponses().where("memberPhone", "==", memberPhone).limit(10).get();
  return byPhone.docs.some((doc) => doc.data().surveyType === "group" && isRecentSurveyResponse(doc.data()));
}

async function hasAttendedGroupBookingOnOrBefore(memberId: string, sourceDate: string): Promise<boolean> {
  const snap = await refs.bookings().where("memberId", "==", memberId).get();
  return snap.docs
    .map((doc) => doc.data())
    .some(
      (booking) =>
        booking.lectureDate <= sourceDate &&
        booking.attendanceStatus === "attended" &&
        isGroupAttendanceHistory(booking),
    );
}

function isGroupAttendanceHistory(booking: BookingDoc): boolean {
  if (isInstructorLessonBooking(booking)) return false;
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return false;
  if (/프라이빗|개인|1:1/i.test(booking.ticketName || "")) return false;
  return true;
}

function isGroupBooking(booking: BookingDoc): boolean {
  if (isInstructorLessonBooking(booking)) return false;
  if (booking.lessonType === "group") return true;
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return false;
  const ticketKind = bookingTicketKind(booking);
  if (ticketKind === "group") return true;
  if (ticketKind === "private" || ticketKind === "instructor") return false;
  if (/프라이빗|개인|1:1/i.test(booking.ticketName || "")) return false;
  return /그룹|체험|듀엣|소그룹/i.test(booking.ticketName || "") || booking.ticketName === "";
}

function groupSurveyTiming(
  booking: BookingDoc,
  sourceDate: string,
): { deliveryMode: string; minutesUntilLesson: string } {
  if (booking.lectureDate !== sourceDate) return { deliveryMode: "advance", minutesUntilLesson: "" };
  const startMs = booking.lectureStartAt?.toMillis?.() || 0;
  if (!startMs) return { deliveryMode: "same_day", minutesUntilLesson: "" };
  const minutes = Math.floor((startMs - Date.now()) / (60 * 1000));
  if (minutes < 30) return { deliveryMode: "too_late", minutesUntilLesson: String(minutes) };
  if (minutes < 180) return { deliveryMode: "same_day_urgent", minutesUntilLesson: String(minutes) };
  return { deliveryMode: "same_day", minutesUntilLesson: String(minutes) };
}

function groupSurveyRequestId(memberId: string, bookingId: string): string {
  return `gsr-${stableHash({ memberId, bookingId }).slice(0, 12)}`;
}

function groupSurveyAccessToken(requestId: string): string {
  return createHmac("sha256", privateSurveyWebhookSecret.value()).update(requestId).digest("hex").slice(0, 16);
}

function groupSurveyTargetUrl(requestId: string, accessToken: string): string {
  const url = new URL("https://in.archivepilates.com/groupSurvey");
  url.searchParams.set("id", requestId);
  url.searchParams.set("token", accessToken);
  return url.toString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function upsertGroupSurveyRequest(candidate: AlimtalkCandidateDoc): Promise<void> {
  const requestId = String(candidate.payload.surveyId || candidate.payload.responseId || "");
  const accessToken = String(candidate.payload.accessToken || "");
  if (!requestId || !accessToken) return;
  const ref = db.collection("groupSurveyRequests").doc(requestId);
  const previous = (await ref.get()).data();
  if (previous?.status === "submitted") {
    await ref.set({ updatedAt: nowTimestamp() }, { merge: true });
    return;
  }
  await ref.set(
    {
      requestId,
      studioId: candidate.studioId,
      memberId: candidate.memberId,
      memberName: candidate.memberName,
      memberPhone: candidate.memberPhone,
      memberPhoneLast4: candidate.memberPhone.slice(-4),
      bookingId: candidate.payload.bookingId || "",
      lectureId: candidate.payload.lectureId || "",
      lectureDate: candidate.payload.lectureDate || "",
      staffId: candidate.payload.staffId || "",
      staffName: candidate.payload.staffName || "",
      sourceCandidateId: candidate.candidateId,
      shortLinkId: candidate.payload.shortLinkId || "",
      shortUrl: candidate.payload.shortUrl || "",
      accessTokenHash: sha256(accessToken),
      status: previous?.status || "pending",
      createdAt: previous?.createdAt || nowTimestamp(),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

async function privateSurveyCandidateForDate(
  profile: MemberProfileDoc,
  sourceDate: string,
): Promise<AlimtalkCandidateDoc | null> {
  if (sourceDate < PRIVATE_SURVEY_ALIMTALK_START_DATE) return null;
  if (!profile.memberId || !profile.name || !profile.phone) return null;
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId]) return null;
  const booking = await firstUpcomingPrivateBookingInReservationWindow(profile.memberId, sourceDate);
  if (!booking) return null;
  if (await hasSubmittedPrivateSurvey(profile.memberId, profile.phone)) return null;
  if (await hasAttendedPrivateBookingOnOrBefore(profile.memberId, sourceDate)) return null;
  return {
    candidateId: `private_survey_${profile.memberId}_${sourceDate}`,
    studioId: profile.studioId,
    memberId: profile.memberId,
    memberName: profile.name,
    memberPhone: profile.phone,
    type: "private_survey",
    status: "candidate",
    templateCode: CANDIDATE_TEMPLATE_CODES.private_survey,
    title: "프라이빗 사전설문",
    reason: `첫 프라이빗 예약 ${booking.lectureDate}`,
    sourceDate,
    payload: {
      memberName: profile.name,
      ticketName: booking.ticketName || "",
      bookingId: booking.bookingId,
      lectureId: booking.lectureId,
      lectureDate: booking.lectureDate,
      privateSurveyWindowEndDate: reservationOpenEndDate(sourceDate),
    },
    attempts: 0,
    maxAttempts: 2,
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

async function firstUpcomingPrivateBookingInReservationWindow(
  memberId: string,
  sourceDate: string,
): Promise<BookingDoc | null> {
  const endDate = reservationOpenEndDate(sourceDate);
  const snap = await refs.bookings().where("memberId", "==", memberId).get();
  const bookings = snap.docs
    .map((doc) => doc.data())
    .filter(
      (booking) =>
        booking.appStatus === "reserved" &&
        booking.lectureDate >= sourceDate &&
        booking.lectureDate <= endDate &&
        isPrivateBookingTicket(booking),
    )
    .sort((a, b) => {
      if (a.lectureDate !== b.lectureDate) return a.lectureDate.localeCompare(b.lectureDate);
      return (a.lectureStartAt?.toMillis() || 0) - (b.lectureStartAt?.toMillis() || 0);
    });
  return bookings[0] || null;
}

async function hasSubmittedPrivateSurvey(memberId: string, memberPhone: string): Promise<boolean> {
  const byMember = await refs.privateSurveyResponses().where("matching.memberId", "==", memberId).limit(10).get();
  if (
    byMember.docs.some(
      (doc) => (doc.data().surveyType || "private") === "private" && isRecentSurveyResponse(doc.data()),
    )
  )
    return true;
  const byPhone = await refs.privateSurveyResponses().where("memberPhone", "==", memberPhone).limit(10).get();
  return byPhone.docs.some(
    (doc) => (doc.data().surveyType || "private") === "private" && isRecentSurveyResponse(doc.data()),
  );
}

function isRecentSurveyResponse(response: {
  submittedAt?: FirebaseFirestore.Timestamp | null;
  createdAt?: FirebaseFirestore.Timestamp | null;
}): boolean {
  const responseMs = response.submittedAt?.toMillis?.() || response.createdAt?.toMillis?.() || 0;
  if (!responseMs) return true;
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  return Date.now() - responseMs < oneYearMs;
}

async function hasAttendedPrivateBookingOnOrBefore(memberId: string, sourceDate: string): Promise<boolean> {
  const snap = await refs.bookings().where("memberId", "==", memberId).get();
  return snap.docs
    .map((doc) => doc.data())
    .some(
      (booking) =>
        booking.appStatus === "reserved" &&
        booking.lectureDate <= sourceDate &&
        booking.attendanceStatus === "attended" &&
        isPrivateBookingTicket(booking),
    );
}

function isPrivateBookingTicket(booking: BookingDoc): boolean {
  if (isInstructorLessonBooking(booking)) return false;
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return true;
  if (booking.lessonType === "group") return false;
  const ticketKind = bookingTicketKind(booking);
  if (ticketKind === "private") return true;
  if (ticketKind === "group" || ticketKind === "instructor") return false;
  return /프라이빗|개인|1:1/i.test(booking.ticketName || "");
}

function bookingTicketKind(booking: BookingDoc): "group" | "private" | "instructor" | "" {
  const values = [booking.ticketClassType, booking.ticketType].map((value) => String(value || "").trim());
  for (const value of values) {
    const upper = value.toUpperCase();
    if (!upper) continue;
    if (upper === "P" || upper === "PRIVATE" || /프라이빗|개인|1:1/i.test(value)) return "private";
    if (upper === "G" || upper === "GROUP" || /그룹|체험|듀엣|소그룹/i.test(value)) return "group";
    if (upper === "I" || upper === "INSTRUCTOR" || /강사레슨/i.test(value)) return "instructor";
  }
  return "";
}

function isInstructorLessonBooking(booking: BookingDoc): boolean {
  if (/강사레슨/i.test(booking.ticketName || "")) return true;
  return bookingTicketKind(booking) === "instructor";
}

function directTicketCandidate(
  profile: MemberProfileDoc,
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): AlimtalkCandidateDoc | null {
  if (hasOtherActiveTicket(profile, ticket, sourceDate)) return null;
  const memberId = profile.memberId;
  const memberName = profile.name;
  const memberPhone = profile.phone;
  if (!memberId || !memberName || !memberPhone) return null;
  const type = alimtalkTypeFromTicket(ticket, sourceDate);
  if (!type) return null;
  const templateCode = CANDIDATE_TEMPLATE_CODES[type];
  if (!templateCode) return null;
  const payload = ticketPayload(ticket, sourceDate);
  const candidateId = `ticket_${stableHash({
    date: sourceDate,
    memberId,
    type,
    ticketName: payload.ticketName,
  }).slice(0, 24)}`;
  return {
    candidateId,
    studioId: profile.studioId,
    memberId,
    memberName,
    memberPhone,
    type,
    status: "candidate",
    templateCode,
    title: "수강권",
    reason: ticketReason(type, payload),
    sourceDate,
    payload: {
      memberName: profile.name,
      reason: ticketReason(type, payload),
      date: sourceDate,
      ...payload,
    },
    attempts: 0,
    maxAttempts: 2,
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

function alimtalkTypeFromTicket(
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): SendableAlimtalkCandidateType | null {
  const remaining = ticket.remainingCount == null ? Number.NaN : Number(ticket.remainingCount);
  if (Number.isFinite(remaining) && remaining >= 0) {
    if (isPrivateProfileTicket(ticket) && remaining <= 3) return "private_count_low";
    if (!isPrivateProfileTicket(ticket) && remaining < 5) return "remaining_low";
  }
  const days = Number(remainingDays(ticket.expiresAt, sourceDate));
  if (Number.isFinite(days) && days <= 14) {
    if (isPrivateProfileTicket(ticket)) return "private_ticket_expiring";
    return "ticket_expiring";
  }
  return null;
}

function ticketReason(type: SendableAlimtalkCandidateType, payload: Record<string, string>): string {
  if (type === "remaining_low" || type === "private_count_low") return `잔여횟수 부족 · ${payload.remainingCount}회`;
  return `기간만료 임박 · ${payload.remainingDays}일`;
}

function hasOtherActiveTicket(
  profile: MemberProfileDoc | undefined,
  target: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): boolean {
  const targetKey = profileTicketIdentity(target);
  return activeProfileTickets(profile, sourceDate).some((ticket) => profileTicketIdentity(ticket) !== targetKey);
}

function activeProfileTickets(
  profile: MemberProfileDoc | undefined,
  sourceDate: string,
): NonNullable<MemberProfileDoc["activeTickets"]> {
  return (profile?.activeTickets || []).filter((ticket) => isActiveProfileTicket(ticket, sourceDate));
}

function isActiveProfileTicket(
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): boolean {
  if (!ticket.name) return false;
  if (!isLessonProfileTicket(ticket)) return false;
  if (ticket.expiryLevel === "expired") return false;
  if (ticket.expiresAt && expiryDateText(ticket.expiresAt) < sourceDate) return false;
  const remaining = ticket.remainingCount == null ? Number.NaN : Number(ticket.remainingCount);
  return !Number.isFinite(remaining) || remaining > 0;
}

function isLessonProfileTicket(ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number]): boolean {
  const classType = String(ticket.classType || "").toUpperCase();
  const name = String(ticket.name || "");
  if (classType === "I") return false;
  if (/토삭스|삭스|양말|기간연장|체험|체험권|강사레슨/.test(name)) return false;
  return true;
}

function isPrivateProfileTicket(ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number]): boolean {
  const classType = String(ticket.classType || "").toUpperCase();
  const name = String(ticket.name || "");
  return classType === "P" || classType === "PRIVATE" || /프라이빗|개인/.test(name);
}

function profileTicketIdentity(ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number]): string {
  if (ticket.userTicketId) return `user:${ticket.userTicketId}`;
  const expiresAt = ticket.expiresAt?.toMillis() || "";
  return [ticket.ticketId || "", ticket.name || "", expiresAt].filter(Boolean).join("|");
}

function ticketPayload(
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): Record<string, string> {
  return {
    ticketId: ticket.ticketId || "",
    userTicketId: ticket.userTicketId || "",
    ticketName: ticket.name || "",
    remainingCount: ticket.remainingCount == null ? "" : String(ticket.remainingCount),
    expiresAt: formatKoreanDate(ticket.expiresAt),
    remainingDays: remainingDays(ticket.expiresAt, sourceDate),
  };
}

function formatKoreanDate(value: NonNullable<MemberProfileDoc["activeTickets"]>[number]["expiresAt"]): string {
  const date = value?.toDate?.();
  if (!date) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  })
    .format(date)
    .replace(/\s/g, " ");
}

function remainingDays(
  value: NonNullable<MemberProfileDoc["activeTickets"]>[number]["expiresAt"],
  sourceDate: string,
): string {
  const date = value?.toDate?.();
  if (!date) return "";
  const expiryText = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
  const today = new Date(`${sourceDate}T00:00:00+09:00`).getTime();
  const expiry = new Date(`${expiryText}T00:00:00+09:00`).getTime();
  return String(Math.max(0, Math.ceil((expiry - today) / (24 * 60 * 60 * 1000))));
}

function expiryDateText(value: NonNullable<MemberProfileDoc["activeTickets"]>[number]["expiresAt"]): string {
  const date = value?.toDate?.();
  if (!date) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

function reservationOpenEndDate(baseDate: string): string {
  const base = new Date(`${baseDate}T00:00:00+09:00`);
  const daysSinceMonday = (base.getDay() + 6) % 7;
  return addDays(baseDate, 13 - daysSinceMonday);
}

async function upsertCandidate(candidate: AlimtalkCandidateDoc): Promise<void> {
  const ref = refs.alimtalkCandidate(candidate.candidateId);
  const previous = (await ref.get()).data();
  if (previous && ["queued", "sent", "skipped"].includes(previous.status)) {
    await ref.set({ updatedAt: nowTimestamp() }, { merge: true });
    return;
  }
  await ref.set(
    {
      ...candidate,
      status: previous?.status || candidate.status,
      createdAt: previous?.createdAt || candidate.createdAt,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

async function markDuplicateSkipped(candidate: AlimtalkCandidateDoc, dedupeKey: string, reason: string): Promise<void> {
  const ref = refs.alimtalkCandidate(candidate.candidateId);
  const previous = (await ref.get()).data();
  if (previous && ["queued", "processing", "sent"].includes(previous.status)) {
    await ref.set({ updatedAt: nowTimestamp() }, { merge: true });
    return;
  }
  await ref.set(
    {
      ...candidate,
      dedupeKey,
      status: "skipped",
      lastError: reason,
      createdAt: previous?.createdAt || candidate.createdAt,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

function registeredDate(profile: MemberProfileDoc): string {
  const date = profile.registeredAt?.toDate();
  if (!date) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

function newMemberWindowStartDate(endDate: string): string {
  return addDays(endDate, -(NEW_MEMBER_ALIMTALK_WINDOW_DAYS - 1));
}
