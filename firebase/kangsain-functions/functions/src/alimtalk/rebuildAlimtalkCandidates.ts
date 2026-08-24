import { createHash, createHmac } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import type { AlimtalkCandidateDoc, BookingDoc, LectureDoc, MemberProfileDoc, RenewalCaseDoc } from "../types/models";
import { db } from "../config/firebase";
import { privateSurveyWebhookSecret } from "../config/secrets";
import { refs } from "../firestore/refs";
import { addDays, dateRange, nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";
import { shortLinkIdForTarget, shortUrlForId } from "../utils/shortLinks";
import { canonicalizeBookings } from "../utils/canonicalBooking";
import {
  ALIMTALK_MEMBER_EXCLUSION_REASONS,
  CANDIDATE_TEMPLATE_CODES,
  GROUP_SURVEY_ALIMTALK_START_DATE,
  LONG_ABSENCE_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_WINDOW_DAYS,
  PRIVATE_SURVEY_ALIMTALK_START_DATE,
  alimtalkDedupePolicy,
  type SendableAlimtalkCandidateType,
} from "./templates";
import { alimtalkDedupeKey, findCompletedDuplicateForCandidate } from "./dedupe";
import { instructorLessonManagementNumberFor } from "./instructorLessonManagement";
import { isAlimtalkTestRecipient } from "./testRecipients";
import {
  assessRenewalTicket,
  hasSameKindAlternativeTicket,
  isRenewalManagedTicket,
  renewalBookingKind,
  renewalSourceTicketKey,
  renewalTicketKind,
  renewalUsageSummary,
} from "../renewal/renewalPolicy";

export async function rebuildAlimtalkCandidatesForRange(input: {
  studioId: string;
  startDate: string;
  endDate: string;
  mode?: "daily" | "reservation_open";
}): Promise<{ candidates: number; candidateIds: string[] }> {
  const mode = input.mode || "daily";
  const profilesPromise = refs.memberProfiles().where("studioId", "==", input.studioId).get();
  const [profilesSnap, bookingIndex, lectureIndex] =
    mode === "reservation_open"
      ? [await profilesPromise, new Map<string, BookingDoc[]>(), new Map<string, LectureDoc>()]
      : await Promise.all([profilesPromise, loadBookingIndex(input.studioId), loadLectureIndex(input.studioId)]);

  const writes: Array<Promise<unknown>> = [];
  const candidateIds: string[] = [];
  const profiles = profilesSnap.docs.map((snap) => snap.data());
  if (mode === "daily") {
    // Keep the operator renewal ledger current even if later candidate work fails.
    await syncRenewalCases(profiles, bookingIndex, input.endDate);
  }
  for (const sourceDate of dateRange(input.startDate, input.endDate)) {
    for (const profile of profiles) {
      if (mode === "reservation_open") {
        const reservationOpenCandidate = reservationOpenCandidateForDate(profile, sourceDate);
        if (reservationOpenCandidate) {
          await enqueueSendableCandidate(reservationOpenCandidate, candidateIds, writes);
        }
        continue;
      }
      for (const candidate of directTicketCandidates(profile, sourceDate, memberBookings(bookingIndex, profile.memberId))) {
        await enqueueSendableCandidate(candidate, candidateIds, writes);
      }
      const privateSurveyCandidate = await privateSurveyCandidateForDate(profile, sourceDate, bookingIndex);
      if (privateSurveyCandidate) {
        const enqueued = await enqueueSendableCandidate(privateSurveyCandidate, candidateIds, writes);
        if (enqueued) writes.push(upsertPrivateSurveyRequest(privateSurveyCandidate));
      }
      const groupSurveyCandidate = await groupSurveyCandidateForDate(profile, sourceDate, bookingIndex);
      if (groupSurveyCandidate) {
        const enqueued = await enqueueSendableCandidate(groupSurveyCandidate, candidateIds, writes);
        if (enqueued) writes.push(upsertGroupSurveyRequest(groupSurveyCandidate));
      }
      for (const candidate of instructorLessonMaterialCandidatesForDate(profile, sourceDate, bookingIndex, lectureIndex)) {
        await enqueueSendableCandidate(candidate, candidateIds, writes);
      }
      const longAbsenceCandidate = await longAbsenceCandidateForDate(profile, sourceDate, bookingIndex);
      if (longAbsenceCandidate) {
        await enqueueSendableCandidate(longAbsenceCandidate, candidateIds, writes);
      }
    }
  }

  if (mode === "daily" && CANDIDATE_TEMPLATE_CODES.new_member) {
    for (const profile of profiles.filter(
      (profile) =>
        profile.isNewMember &&
        (!ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId] || isAlimtalkTestRecipient(profile)) &&
        currentOrUpcomingLessonProfileTickets(profile, input.endDate).length > 0 &&
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
            activeTicketNames: currentOrUpcomingLessonProfileTickets(profile, input.endDate)
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
  }

  await Promise.all(writes);
  await markStaleCandidatesSkipped({
    studioId: input.studioId,
    startDate: input.startDate,
    endDate: input.endDate,
    currentCandidateIds: new Set(candidateIds),
    candidateTypes: mode === "reservation_open" ? ["reservation_open"] : DAILY_ALIMTALK_CANDIDATE_TYPES,
  });
  logger.info("rebuildAlimtalkCandidatesForRange completed", {
    studioId: input.studioId,
    candidates: candidateIds.length,
    mode,
  });
  return { candidates: candidateIds.length, candidateIds };
}

const DAILY_ALIMTALK_CANDIDATE_TYPES: SendableAlimtalkCandidateType[] = [
  "new_member",
  "private_survey",
  "group_survey",
  "instructor_lesson_material",
  "ticket_expiring",
  "remaining_low",
  "private_count_low",
  "private_ticket_expiring",
  "long_absence",
];

type BookingIndex = Map<string, BookingDoc[]>;
type LectureIndex = Map<string, LectureDoc>;

async function loadBookingIndex(studioId: string): Promise<BookingIndex> {
  const snap = await refs
    .bookings()
    .where("studioId", "==", studioId)
    .select(
      "bookingId",
      "lectureId",
      "studioId",
      "memberId",
      "memberName",
      "memberPhone",
      "staffId",
      "staffName",
      "lectureDate",
      "lectureStartAt",
      "lessonType",
      "appStatus",
      "attendanceStatus",
      "ticketName",
      "ticketClassType",
      "ticketType",
    )
    .get();
  const index: BookingIndex = new Map();
  for (const doc of snap.docs) {
    const booking = doc.data() as BookingDoc;
    if (!booking.memberId) continue;
    const list = index.get(booking.memberId) || [];
    list.push(booking);
    index.set(booking.memberId, list);
  }
  for (const [memberId, bookingList] of index.entries()) {
    index.set(memberId, canonicalizeBookings(bookingList));
  }
  return index;
}

async function loadLectureIndex(studioId: string): Promise<LectureIndex> {
  const snap = await refs.lectures().where("studioId", "==", studioId).get();
  const index: LectureIndex = new Map();
  for (const doc of snap.docs) {
    const lecture = doc.data();
    if (!lecture.lectureId) continue;
    index.set(lecture.lectureId, lecture);
  }
  return index;
}

function memberBookings(bookingIndex: BookingIndex, memberId: string): BookingDoc[] {
  return bookingIndex.get(memberId) || [];
}

async function markStaleCandidatesSkipped(input: {
  studioId: string;
  startDate: string;
  endDate: string;
  currentCandidateIds: Set<string>;
  candidateTypes: SendableAlimtalkCandidateType[];
}): Promise<void> {
  const writes: Array<Promise<unknown>> = [];
  const candidateTypes = new Set(input.candidateTypes);
  for (const sourceDate of dateRange(input.startDate, input.endDate)) {
    const snap = await refs.alimtalkCandidates().where("sourceDate", "==", sourceDate).limit(500).get();
    snap.docs.forEach((doc) => {
      const candidate = doc.data();
      if (candidate.studioId !== input.studioId) return;
      if (!candidateTypes.has(candidate.type as SendableAlimtalkCandidateType)) return;
      if (input.currentCandidateIds.has(candidate.candidateId)) return;
      if (!["candidate", "reviewed", "failed"].includes(candidate.status)) return;
      writes.push(
        refs.alimtalkCandidate(candidate.candidateId).set(
          {
            status: "skipped",
            reasonCode: "not_current_target",
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
  const duplicate = isAlimtalkTestRecipient(candidate)
    ? ""
    : await findCompletedDuplicateForCandidate(candidate, dedupeKey, dedupePolicy.windowDays);
  if (duplicate) {
    writes.push(markDuplicateSkipped(candidate, dedupeKey, `중복 발송 차단(${dedupePolicy.label}): ${duplicate}`));
    return false;
  }
  candidateIds.push(candidate.candidateId);
  writes.push(upsertCandidate({ ...candidate, dedupeKey }));
  return true;
}

function directTicketCandidates(
  profile: MemberProfileDoc,
  sourceDate: string,
  bookings: BookingDoc[],
): AlimtalkCandidateDoc[] {
  if (!profile.memberId || !profile.name || !profile.phone) return [];
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId] && !isAlimtalkTestRecipient(profile)) return [];
  return currentLessonProfileTickets(profile, sourceDate)
    .map((ticket) => directTicketCandidate(profile, ticket, sourceDate, bookings))
    .filter((candidate): candidate is AlimtalkCandidateDoc => Boolean(candidate));
}

function reservationOpenCandidateForDate(profile: MemberProfileDoc, sourceDate: string): AlimtalkCandidateDoc | null {
  if (!isReservationOpenSendDate(sourceDate)) return null;
  if (!profile.memberId || !profile.name || !profile.phone) return null;
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId] && !isAlimtalkTestRecipient(profile)) return null;
  const reservationStartDate = reservationOpenStartDate(sourceDate);
  const reservationEndDate = reservationOpenEndDate(sourceDate);
  const eligibleTickets = reservationOpenEligibleGroupTickets(profile, reservationStartDate, reservationEndDate);
  if (!eligibleTickets.length) return null;
  const reservationWeek = reservationWeekLabel(reservationStartDate, reservationEndDate);
  const candidateId = `reservation_open_${profile.memberId}_${reservationStartDate}`;
  return {
    candidateId,
    studioId: profile.studioId,
    memberId: profile.memberId,
    memberName: profile.name,
    memberPhone: profile.phone,
    type: "reservation_open",
    status: "candidate",
    templateCode: CANDIDATE_TEMPLATE_CODES.reservation_open,
    title: "예약 안내",
    reason: `예약 오픈 안내 · ${reservationWeek}`,
    sourceDate,
    payload: {
      memberName: profile.name,
      reservationWeek,
      weekLabel: reservationWeek,
      reservationStartDate,
      reservationEndDate,
      activeTicketNames: eligibleTickets
        .map((ticket) => ticket.name)
        .filter(Boolean)
        .join(", "),
    },
    attempts: 0,
    maxAttempts: 2,
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

function instructorLessonMaterialCandidatesForDate(
  profile: MemberProfileDoc,
  sourceDate: string,
  bookingIndex: BookingIndex,
  lectureIndex: LectureIndex,
): AlimtalkCandidateDoc[] {
  if (!profile.memberId || !profile.name || !profile.phone) return [];
  const lessonDate = addDays(sourceDate, 1);
  const candidates = memberBookings(bookingIndex, profile.memberId)
    .filter(
      (booking) =>
        booking.appStatus === "reserved" && booking.lectureDate === lessonDate && isInstructorLessonBooking(booking),
    )
    .map((booking) => instructorLessonMaterialCandidate(profile, booking, sourceDate, lectureIndex))
    .filter((candidate): candidate is AlimtalkCandidateDoc => Boolean(candidate));
  const byManagementNumber = new Map<string, AlimtalkCandidateDoc>();
  for (const candidate of candidates) {
    const managementNumber = String(candidate.payload?.managementNumber || "");
    if (managementNumber && !byManagementNumber.has(managementNumber)) {
      byManagementNumber.set(managementNumber, candidate);
    }
  }
  return [...byManagementNumber.values()];
}

function instructorLessonMaterialCandidate(
  profile: MemberProfileDoc,
  booking: BookingDoc,
  sourceDate: string,
  lectureIndex: LectureIndex,
): AlimtalkCandidateDoc | null {
  const lecture = lectureIndex.get(booking.lectureId);
  const title = lecture?.title || "";
  const managementNumber = instructorLessonManagementNumberFor({ title, lessonDate: booking.lectureDate });
  if (!managementNumber) return null;
  const targetUrl = `https://in.archivepilates.com/method/${encodeURIComponent(managementNumber)}`;
  const shortLinkId = shortLinkIdForTarget("method_material", targetUrl);
  return {
    candidateId: `instructor_lesson_material_${stableHash({
      memberId: profile.memberId,
      bookingId: booking.bookingId,
      managementNumber,
    }).slice(0, 24)}`,
    studioId: profile.studioId,
    memberId: profile.memberId,
    memberName: profile.name,
    memberPhone: profile.phone || "",
    type: "instructor_lesson_material",
    status: "candidate",
    templateCode: CANDIDATE_TEMPLATE_CODES.instructor_lesson_material,
    title: "강사레슨 수업자료",
    reason: `강사레슨 D-1 · ${managementNumber}`,
    sourceDate,
    payload: {
      memberName: profile.name,
      bookingId: booking.bookingId,
      lectureId: booking.lectureId,
      lectureDate: booking.lectureDate,
      lessonDate: booking.lectureDate,
      lessonTitle: title,
      ticketName: booking.ticketName || "",
      staffId: booking.staffId || "",
      staffName: booking.staffName || lecture?.staffName || "",
      managementNumber,
      materialNumber: managementNumber,
      archiveMethodId: managementNumber,
      shortLinkId,
      shortUrl: shortUrlForId(shortLinkId),
    },
    attempts: 0,
    maxAttempts: 2,
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

async function groupSurveyCandidateForDate(
  profile: MemberProfileDoc,
  sourceDate: string,
  bookingIndex: BookingIndex,
): Promise<AlimtalkCandidateDoc | null> {
  if (sourceDate < GROUP_SURVEY_ALIMTALK_START_DATE) return null;
  if (!profile.memberId || !profile.name || !profile.phone) return null;
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId] && !isAlimtalkTestRecipient(profile)) return null;
  const booking = firstUpcomingGroupBookingInReservationWindow(profile.memberId, sourceDate, bookingIndex);
  if (!booking) return null;
  if (await hasSubmittedGroupSurvey(profile.memberId, profile.phone)) return null;
  if (hasAttendedGroupBookingOnOrBefore(profile.memberId, sourceDate, bookingIndex)) return null;
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

function firstUpcomingGroupBookingInReservationWindow(
  memberId: string,
  sourceDate: string,
  bookingIndex: BookingIndex,
): BookingDoc | null {
  const endDate = reservationOpenEndDate(sourceDate);
  const bookings = memberBookings(bookingIndex, memberId)
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

function hasAttendedGroupBookingOnOrBefore(
  memberId: string,
  sourceDate: string,
  bookingIndex: BookingIndex,
): boolean {
  return memberBookings(bookingIndex, memberId).some(
      (booking) =>
        booking.lectureDate <= sourceDate &&
        booking.attendanceStatus === "attended" &&
        isGroupAttendanceHistory(booking),
  );
}

function isGroupAttendanceHistory(booking: BookingDoc): boolean {
  if (isInstructorLessonBooking(booking)) return false;
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return false;
  if (/프라이빗|개인|1:1|듀엣|duet|세미/i.test(booking.ticketName || "")) return false;
  return true;
}

function isGroupBooking(booking: BookingDoc): boolean {
  if (isInstructorLessonBooking(booking)) return false;
  if (booking.lessonType === "group") return true;
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return false;
  const ticketKind = bookingTicketKind(booking);
  if (ticketKind === "group") return true;
  if (ticketKind === "private" || ticketKind === "instructor") return false;
  if (/프라이빗|개인|1:1|듀엣|duet|세미/i.test(booking.ticketName || "")) return false;
  return /그룹|체험|소그룹/i.test(booking.ticketName || "") || booking.ticketName === "";
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
  bookingIndex: BookingIndex,
): Promise<AlimtalkCandidateDoc | null> {
  if (sourceDate < PRIVATE_SURVEY_ALIMTALK_START_DATE) return null;
  if (!profile.memberId || !profile.name || !profile.phone) return null;
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId] && !isAlimtalkTestRecipient(profile)) return null;
  const booking = firstUpcomingPrivateBookingInReservationWindow(profile.memberId, sourceDate, bookingIndex);
  if (!booking) return null;
  if (await hasSubmittedPrivateSurvey(profile.memberId, profile.phone)) return null;
  if (hasAttendedPrivateBookingOnOrBefore(profile.memberId, sourceDate, bookingIndex)) return null;
  const requestId = privateSurveyRequestId(profile.memberId, booking.bookingId);
  const accessToken = privateSurveyAccessToken(requestId);
  const targetUrl = privateSurveyTargetUrl(requestId, accessToken);
  const shortLinkId = shortLinkIdForTarget("private_survey", targetUrl);
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
      staffId: booking.staffId,
      staffName: booking.staffName,
      surveyId: requestId,
      responseId: requestId,
      accessToken,
      shortLinkId,
      shortUrl: shortUrlForId(shortLinkId),
      privateSurveyWindowEndDate: reservationOpenEndDate(sourceDate),
    },
    attempts: 0,
    maxAttempts: 2,
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

function privateSurveyRequestId(memberId: string, bookingId: string): string {
  return `psr-${stableHash({ memberId, bookingId }).slice(0, 12)}`;
}

function privateSurveyAccessToken(requestId: string): string {
  return createHmac("sha256", privateSurveyWebhookSecret.value())
    .update(`native-private-survey:${requestId}`)
    .digest("hex")
    .slice(0, 32);
}

function privateSurveyTargetUrl(requestId: string, accessToken: string): string {
  const url = new URL("https://in.archivepilates.com/privateSurvey");
  url.searchParams.set("id", requestId);
  url.searchParams.set("token", accessToken);
  return url.toString();
}

async function upsertPrivateSurveyRequest(candidate: AlimtalkCandidateDoc): Promise<void> {
  const requestId = String(candidate.payload.surveyId || candidate.payload.responseId || "");
  const accessToken = String(candidate.payload.accessToken || "");
  if (!requestId || !accessToken) return;
  const ref = refs.privateSurveyRequest(requestId);
  const previous = (await ref.get()).data();
  if (previous?.status === "submitted") {
    await ref.set({ updatedAt: nowTimestamp() }, { merge: true });
    return;
  }
  const bookingId = String(candidate.payload.bookingId || "");
  const booking = bookingId ? (await refs.booking(bookingId).get()).data() : undefined;
  const expiresAt = booking?.lectureStartAt
    ? Timestamp.fromMillis(booking.lectureStartAt.toMillis() + 24 * 60 * 60 * 1000)
    : null;
  await ref.set(
    {
      requestId,
      schemaVersion: 1,
      studioId: candidate.studioId,
      memberId: candidate.memberId,
      memberName: candidate.memberName,
      memberPhone: candidate.memberPhone,
      memberPhoneLast4: candidate.memberPhone.slice(-4),
      bookingId,
      lectureId: candidate.payload.lectureId || "",
      lectureDate: booking?.lectureDate || candidate.payload.lectureDate || "",
      lessonStartAt: booking?.lectureStartAt || null,
      staffId: booking?.staffId || candidate.payload.staffId || "",
      staffName: booking?.staffName || candidate.payload.staffName || "",
      sourceCandidateId: candidate.candidateId,
      shortLinkId: candidate.payload.shortLinkId || "",
      shortUrl: candidate.payload.shortUrl || "",
      accessTokenHash: sha256(accessToken),
      tokenVersion: 1,
      status: previous?.status || "pending",
      expiresAt,
      createdAt: previous?.createdAt || nowTimestamp(),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

async function longAbsenceCandidateForDate(
  profile: MemberProfileDoc,
  sourceDate: string,
  bookingIndex: BookingIndex,
): Promise<AlimtalkCandidateDoc | null> {
  if (sourceDate < LONG_ABSENCE_ALIMTALK_START_DATE) return null;
  if (!profile.memberId || !profile.name || !profile.phone) return null;
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId] && !isAlimtalkTestRecipient(profile)) return null;
  if (hasHoldingTicket(profile)) return null;
  const activeTickets = currentLessonProfileTickets(profile, sourceDate).filter(isRenewalManagedTicket);
  if (!activeTickets.length) return null;
  if (hasUpcomingReservedBooking(profile.memberId, sourceDate, bookingIndex)) return null;
  const lastAttendance = lastAttendedBooking(profile.memberId, sourceDate, bookingIndex);
  if (!lastAttendance) return null;
  const absenceDays = daysBetweenDateStrings(lastAttendance.lectureDate, sourceDate);
  if (!Number.isFinite(absenceDays) || absenceDays < 7) return null;
  const primaryTicket = activeTickets[0];
  return {
    candidateId: `long_absence_${profile.memberId}_${sourceDate}`,
    studioId: profile.studioId,
    memberId: profile.memberId,
    memberName: profile.name,
    memberPhone: profile.phone,
    type: "long_absence",
    status: "candidate",
    templateCode: CANDIDATE_TEMPLATE_CODES.long_absence,
    title: "장기 미방문",
    reason: `마지막 출석 ${lastAttendance.lectureDate} · ${absenceDays}일`,
    sourceDate,
    payload: {
      memberName: profile.name,
      ticketName: primaryTicket.name || "",
      activeTicketNames: activeTickets
        .map((ticket) => ticket.name)
        .filter(Boolean)
        .join(", "),
      absenceDays: String(absenceDays),
      daysSinceLastVisit: String(absenceDays),
      lastAttendanceDate: lastAttendance.lectureDate,
      lastAttendanceDateText: formatKoreanDateText(lastAttendance.lectureDate),
      bookingId: lastAttendance.bookingId || "",
      lectureId: lastAttendance.lectureId || "",
    },
    attempts: 0,
    maxAttempts: 2,
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

function lastAttendedBooking(memberId: string, sourceDate: string, bookingIndex: BookingIndex): BookingDoc | null {
  const attended = memberBookings(bookingIndex, memberId)
    .filter(
      (booking) =>
        booking.attendanceStatus === "attended" &&
        booking.lectureDate &&
        booking.lectureDate <= sourceDate &&
        !isInstructorLessonBooking(booking),
    )
    .sort((a, b) => {
      if (a.lectureDate !== b.lectureDate) return b.lectureDate.localeCompare(a.lectureDate);
      return (b.lectureStartAt?.toMillis() || 0) - (a.lectureStartAt?.toMillis() || 0);
    });
  return attended[0] || null;
}

function hasUpcomingReservedBooking(memberId: string, sourceDate: string, bookingIndex: BookingIndex): boolean {
  return memberBookings(bookingIndex, memberId).some(
    (booking) =>
      booking.appStatus === "reserved" &&
      booking.lectureDate >= sourceDate &&
      !isInstructorLessonBooking(booking),
  );
}

function firstUpcomingPrivateBookingInReservationWindow(
  memberId: string,
  sourceDate: string,
  bookingIndex: BookingIndex,
): BookingDoc | null {
  const endDate = reservationOpenEndDate(sourceDate);
  const bookings = memberBookings(bookingIndex, memberId)
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
      (doc) => (doc.data().surveyType || "private") === "private",
    )
  )
    return true;
  const byPhone = await refs.privateSurveyResponses().where("memberPhone", "==", memberPhone).limit(10).get();
  return byPhone.docs.some(
    (doc) => (doc.data().surveyType || "private") === "private",
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

function hasAttendedPrivateBookingOnOrBefore(
  memberId: string,
  sourceDate: string,
  bookingIndex: BookingIndex,
): boolean {
  return memberBookings(bookingIndex, memberId).some(
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
    if (upper === "P" || upper === "PRIVATE" || /프라이빗|개인|1:1|듀엣|duet|세미/i.test(value)) return "private";
    if (upper === "G" || upper === "GROUP" || /그룹|체험|소그룹/i.test(value)) return "group";
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
  bookings: BookingDoc[] = [],
): AlimtalkCandidateDoc | null {
  if (!isRenewalManagedTicket(ticket)) return null;
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
  const assessment = assessRenewalTicket({ ticket, bookings, sourceDate });
  const ticketKind = renewalTicketKind(ticket);
  const renewalCaseId = renewalCaseIdFor(
    profile.memberId,
    ticketKind,
    renewalSourceTicketKey(profile.memberId, ticketKind, ticket),
  );
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
      renewalCaseId,
      predictedDepletionDate: assessment?.predictedDepletionDate || "",
      weeklyUsagePace: assessment ? String(assessment.usage.weeklyPace) : "",
      nextBookingDate: assessment?.usage.nextBookingDate || "",
      recommendation: assessment?.recommendation || "",
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
  return hasSameKindAlternativeTicket(currentOrUpcomingLessonProfileTickets(profile, sourceDate), target, sourceDate);
}

function hasHoldingTicket(profile: MemberProfileDoc | undefined): boolean {
  return Boolean(profile?.ticketStatusSummary?.hasHoldingTicket);
}

function currentLessonProfileTickets(
  profile: MemberProfileDoc | undefined,
  sourceDate: string,
): NonNullable<MemberProfileDoc["activeTickets"]> {
  return (profile?.activeTickets || []).filter((ticket) => isCurrentLessonProfileTicket(ticket, sourceDate));
}

function currentOrUpcomingLessonProfileTickets(
  profile: MemberProfileDoc | undefined,
  sourceDate: string,
): NonNullable<MemberProfileDoc["activeTickets"]> {
  return (profile?.activeTickets || []).filter((ticket) => isCurrentOrUpcomingLessonProfileTicket(ticket, sourceDate));
}

function isCurrentLessonProfileTicket(
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): boolean {
  if (!isCurrentOrUpcomingLessonProfileTicket(ticket, sourceDate)) return false;
  if (ticket.availableFrom && expiryDateText(ticket.availableFrom) > sourceDate) return false;
  return true;
}

function isCurrentOrUpcomingLessonProfileTicket(
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

function reservationOpenEligibleGroupTickets(
  profile: MemberProfileDoc | undefined,
  reservationStartDate: string,
  reservationEndDate: string,
): NonNullable<MemberProfileDoc["activeTickets"]> {
  return (profile?.activeTickets || []).filter((ticket) =>
    isReservationOpenEligibleGroupTicket(ticket, reservationStartDate, reservationEndDate),
  );
}

function isReservationOpenEligibleGroupTicket(
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  reservationStartDate: string,
  reservationEndDate: string,
): boolean {
  if (!ticket.name) return false;
  if (!isLessonProfileTicket(ticket)) return false;
  if (!isGroupOrMixedProfileTicket(ticket)) return false;
  if (ticket.expiryLevel === "expired") return false;
  if (ticket.availableFrom && expiryDateText(ticket.availableFrom) > reservationEndDate) return false;
  if (ticket.expiresAt && expiryDateText(ticket.expiresAt) < reservationStartDate) return false;
  const remaining = ticket.remainingCount == null ? Number.NaN : Number(ticket.remainingCount);
  return !Number.isFinite(remaining) || remaining > 0;
}

function isGroupOrMixedProfileTicket(ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number]): boolean {
  const classType = String(ticket.classType || "").toUpperCase();
  const name = String(ticket.name || "");
  if (classType === "G" || classType === "GROUP") return true;
  if (/듀엣|duet|세미/i.test(name)) return false;
  if (/그룹|소그룹|혼합/.test(name)) return true;
  return !isPrivateProfileTicket(ticket);
}

function isPrivateProfileTicket(ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number]): boolean {
  return renewalTicketKind(ticket) === "private";
}

async function syncRenewalCases(
  profiles: MemberProfileDoc[],
  bookingIndex: BookingIndex,
  sourceDate: string,
): Promise<void> {
  if (!profiles.length) return;
  const studioId = profiles[0]?.studioId || "";
  if (!studioId) return;
  const existingSnap = await refs.renewalCases().where("studioId", "==", studioId).get();
  const existingById = new Map(existingSnap.docs.map((doc) => [doc.id, doc.data()]));
  const currentCaseIds = new Set<string>();
  const currentMemberKinds = new Set<string>();
  const freshMemberIds = new Set(
    profiles.filter((profile) => memberProfileIsFresh(profile)).map((profile) => profile.memberId),
  );
  const writes: Array<Promise<unknown>> = [];

  for (const profile of profiles) {
    if (!profile.memberId || !profile.name) continue;
    const bookings = memberBookings(bookingIndex, profile.memberId);
    const tickets = currentLessonProfileTickets(profile, sourceDate).filter(isRenewalManagedTicket);
    const currentOrUpcomingTickets = currentOrUpcomingLessonProfileTickets(profile, sourceDate).filter(isRenewalManagedTicket);
    const assessments = tickets
      .map((ticket) => ({ ticket, assessment: assessRenewalTicket({ ticket, bookings, sourceDate }) }))
      .filter(
        (item): item is { ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number]; assessment: NonNullable<ReturnType<typeof assessRenewalTicket>> } =>
          Boolean(item.assessment) && !hasSameKindActiveBackup(currentOrUpcomingTickets, item.ticket, sourceDate),
      );

    const bestByKind = new Map<string, (typeof assessments)[number]>();
    for (const item of assessments) {
      const current = bestByKind.get(item.assessment.kind);
      if (!current || renewalAssessmentRank(item.assessment) > renewalAssessmentRank(current.assessment)) {
        bestByKind.set(item.assessment.kind, item);
      }
    }

    for (const { ticket, assessment } of bestByKind.values()) {
      const ticketIdentity = renewalSourceTicketKey(profile.memberId, assessment.kind, ticket);
      const caseId = renewalCaseIdFor(profile.memberId, assessment.kind, ticketIdentity);
      const existing = existingById.get(caseId);
      const sourceCandidate = directTicketCandidate(profile, ticket, sourceDate, bookings);
      const value: Partial<RenewalCaseDoc> = {
        caseId,
        studioId: profile.studioId,
        memberId: profile.memberId,
        memberName: profile.name,
        kind: assessment.kind,
        active: true,
        ticketIdentity,
        ticketName: ticket.name,
        priority: assessment.priority,
        reason: assessment.reason,
        remainingCount: assessment.remainingCount,
        remainingDays: assessment.remainingDays,
        predictedDepletionDate: assessment.predictedDepletionDate,
        weeklyUsagePace: assessment.usage.weeklyPace,
        nextBookingDate: assessment.usage.nextBookingDate,
        recommendation: assessment.recommendation,
        sourceDate,
        sourceCollection: "memberProfiles",
        sourceCandidateId: sourceCandidate?.candidateId || "",
        autoResolvedReason: "",
        updatedAt: nowTimestamp(),
      };
      if (!existing) {
        Object.assign(value, {
          workflowStatus: "open",
          operatorNote: "",
          nextActionAt: null,
          operatorUpdatedAt: null,
          operatorUpdatedByUid: "",
          createdAt: nowTimestamp(),
        });
      }
      currentCaseIds.add(caseId);
      currentMemberKinds.add(`${profile.memberId}|${assessment.kind}`);
      writes.push(refs.renewalCase(caseId).set(value, { merge: true }));
    }

    if (!tickets.length) {
      const lastBooking = bookings
        .filter(
          (booking) =>
            booking.lectureDate <= sourceDate &&
            ["attended", "absent", "late_cancel"].includes(String(booking.attendanceStatus || "")),
        )
        .sort((a, b) => b.lectureDate.localeCompare(a.lectureDate))[0];
      if (lastBooking && daysBetweenDateStrings(lastBooking.lectureDate, sourceDate) <= 45) {
        const kind = renewalBookingKind(lastBooking);
        const ticketIdentity = `waiting:${lastBooking.bookingId || lastBooking.lectureDate}`;
        const caseId = renewalCaseIdFor(profile.memberId, kind, ticketIdentity);
        const existing = existingById.get(caseId);
        const usage = renewalUsageSummary(bookings, kind, sourceDate);
        currentCaseIds.add(caseId);
        currentMemberKinds.add(`${profile.memberId}|${kind}`);
        writes.push(
          refs.renewalCase(caseId).set(
            {
              caseId,
              studioId: profile.studioId,
              memberId: profile.memberId,
              memberName: profile.name,
              kind,
              active: true,
              ticketIdentity,
              ticketName: "활성 수강권 없음",
              priority: "waiting",
              reason: `최근 이용 ${lastBooking.lectureDate}`,
              remainingCount: null,
              remainingDays: null,
              predictedDepletionDate: "",
              weeklyUsagePace: usage.weeklyPace,
              nextBookingDate: usage.nextBookingDate,
              recommendation: kind === "private" ? "프라이빗 복귀 상담" : "그룹 복귀 상담",
              sourceDate,
              sourceCollection: "memberProfiles",
              sourceCandidateId: "",
              autoResolvedReason: "",
              ...(existing
                ? {}
                : {
                    workflowStatus: "open" as const,
                    operatorNote: "",
                    nextActionAt: null,
                    operatorUpdatedAt: null,
                    operatorUpdatedByUid: "",
                    createdAt: nowTimestamp(),
                  }),
              updatedAt: nowTimestamp(),
            },
            { merge: true },
          ),
        );
      }
    }
  }

  for (const [caseId, existing] of existingById.entries()) {
    if (!existing.active || currentCaseIds.has(caseId)) continue;
    if (!freshMemberIds.has(existing.memberId)) continue;
    const replacementExists = currentMemberKinds.has(`${existing.memberId}|${existing.kind}`);
    writes.push(
      refs.renewalCase(caseId).set(
        {
          active: false,
          autoResolvedReason: replacementExists
            ? "동일 유형 새 수강권 확인"
            : "최신 수강권·예약 상태에서 재등록 관리 대상 해소",
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      ),
    );
  }
  await Promise.all(writes);
}

function renewalCaseIdFor(memberId: string, kind: string, sourceTicketKey: string): string {
  return `renewal_${stableHash({ memberId, kind, sourceTicketKey }).slice(0, 24)}`;
}

function memberProfileIsFresh(profile: MemberProfileDoc): boolean {
  const updatedAt = profile.sourceUpdatedAt || profile.syncedAt || profile.updatedAt;
  const updatedAtMs = updatedAt?.toMillis?.() || 0;
  return updatedAtMs > 0 && Date.now() - updatedAtMs <= 72 * 60 * 60 * 1000;
}

function renewalAssessmentRank(assessment: NonNullable<ReturnType<typeof assessRenewalTicket>>): number {
  const priority = { urgent: 3000, warning: 2000, follow: 1000 }[assessment.priority] || 0;
  const depletion = assessment.predictedDepletionDays == null ? 999 : assessment.predictedDepletionDays;
  const expiry = assessment.remainingDays == null ? 999 : assessment.remainingDays;
  return priority + Math.max(0, 999 - Math.min(depletion, expiry));
}

function hasSameKindActiveBackup(
  tickets: NonNullable<MemberProfileDoc["activeTickets"]>,
  target: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): boolean {
  return hasSameKindAlternativeTicket(tickets, target, sourceDate);
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

function formatKoreanDateText(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  })
    .format(date)
    .replace(/\s/g, " ");
}

function daysBetweenDateStrings(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00+09:00`).getTime();
  const end = new Date(`${endDate}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN;
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
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

function compactDate6(value: string): string {
  const normalized = normalizedDateText(value);
  if (!normalized) return "";
  return `${normalized.slice(2, 4)}${normalized.slice(5, 7)}${normalized.slice(8, 10)}`;
}

function normalizedDateText(value: string): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function reservationOpenEndDate(baseDate: string): string {
  const daysSinceMonday = (kstWeekday(baseDate) + 6) % 7;
  return addDays(baseDate, 13 - daysSinceMonday);
}

function reservationOpenStartDate(baseDate: string): string {
  return addDays(reservationOpenEndDate(baseDate), -6);
}

function isReservationOpenSendDate(sourceDate: string): boolean {
  return kstWeekday(sourceDate) === 1;
}

function reservationWeekLabel(startDate: string, endDate: string): string {
  const start = kstNoonDate(startDate);
  const weekNumber = Math.ceil(start.getUTCDate() / 7);
  return `${start.getUTCMonth() + 1}월${weekNumber}주차(${shortMonthDayWithWeekday(startDate)}~${shortMonthDayWithWeekday(endDate)})`;
}

function shortMonthDayWithWeekday(value: string): string {
  const date = kstNoonDate(value);
  if (Number.isNaN(date.getTime())) return value;
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${weekdays[date.getUTCDay()]})`;
}

function kstWeekday(value: string): number {
  const date = kstNoonDate(value);
  return Number.isNaN(date.getTime()) ? Number.NaN : date.getUTCDay();
}

function kstNoonDate(value: string): Date {
  return new Date(`${value}T12:00:00+09:00`);
}

async function upsertCandidate(candidate: AlimtalkCandidateDoc): Promise<void> {
  const ref = refs.alimtalkCandidate(candidate.candidateId);
  const previous = (await ref.get()).data();
  const recoverPrivateSurvey =
    candidate.type === "private_survey" &&
    previous?.status === "skipped" &&
    ["auto_sendability_blocked", "private_survey_booking_blocked"].includes(
      String(previous.reasonCode || ""),
    );
  if (previous && ["queued", "sent"].includes(previous.status)) {
    await ref.set({ updatedAt: nowTimestamp() }, { merge: true });
    return;
  }
  if (previous?.status === "skipped" && !recoverPrivateSurvey) {
    await ref.set({ updatedAt: nowTimestamp() }, { merge: true });
    return;
  }
  await ref.set(
    {
      ...candidate,
      status: recoverPrivateSurvey ? candidate.status : previous?.status || candidate.status,
      reasonCode: recoverPrivateSurvey ? "" : previous?.reasonCode || candidate.reasonCode || "",
      lastError: recoverPrivateSurvey ? null : previous?.lastError ?? candidate.lastError,
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
