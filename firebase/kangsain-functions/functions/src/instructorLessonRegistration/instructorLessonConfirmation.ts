import type { CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import { requireManager, requireStaff } from "../security/authGuards";
import type { AlimtalkCandidateDoc, BookingDoc, StaffDoc } from "../types/models";
import { canonicalizeBookings } from "../utils/canonicalBooking";
import { nowTimestamp, todayKst } from "../utils/date";
import { AppError } from "../utils/errors";
import { stableHash } from "../utils/hash";
import { ALIMTALK_MEMBER_EXCLUSION_REASONS, ALIMTALK_TEMPLATES } from "../alimtalk/templates";
import { hasExplicitAlimtalkTestOverride, isAlimtalkTestRecipient } from "../alimtalk/testRecipients";
import { instructorLessonRegistrationId } from "./instructorLessonRegistration";
import { deriveInstructorLessonRegistrationState } from "./instructorLessonRegistrationState";

const REGISTRATIONS = "instructorLessonRegistrations";
const TICKET_NAME = "강사레슨 (2T)";
const REQUIRED_BOOKING_COUNT = 2;

export type InstructorLessonConfirmationSchedule = {
  lessonDate: string;
  managementNumber: string;
  lessonDateText: string;
  lessonTimeText: string;
  lessonComposition: string;
  expectedStartTime: string;
  expectedEndTime: string;
  calendarUrl: string;
  icsUrl: string;
  icsStart: string;
  icsEnd: string;
};

const CONFIRMATION_SCHEDULES: Readonly<Record<string, InstructorLessonConfirmationSchedule>> = Object.freeze({
  "2026-09-19": schedule({
    lessonDate: "2026-09-19",
    managementNumber: "external-feedback-260919",
    lessonDateText: "2026년 9월 19일(토)",
    icsStart: "20260919T040000Z",
    icsEnd: "20260919T061000Z",
  }),
  "2026-09-20": schedule({
    lessonDate: "2026-09-20",
    managementNumber: "external-feedback-260920",
    lessonDateText: "2026년 9월 20일(일)",
    icsStart: "20260920T040000Z",
    icsEnd: "20260920T061000Z",
  }),
});

export async function confirmInstructorLessonBookingAndQueueAlimtalkHandler(
  request: CallableRequest,
): Promise<Record<string, unknown>> {
  const staff = await manager(request);
  const registrationId = cleanText(request.data?.registrationId, 80);
  if (!/^ilr_[a-f0-9]{24}$/.test(registrationId)) {
    throw new AppError("INVALID_ARGUMENT", "강사레슨 등록 ID를 확인하세요.");
  }
  const registrationRef = db.collection(REGISTRATIONS).doc(registrationId);
  const registrationSnapshot = await registrationRef.get();
  if (!registrationSnapshot.exists) throw new AppError("NOT_FOUND", "강사레슨 등록 건을 찾지 못했습니다.");
  const registration = registrationSnapshot.data() || {};
  if (cleanText(registration.studioId, 80) !== staff.studioId) {
    throw new AppError("PERMISSION_DENIED", "다른 스튜디오의 강사레슨 등록 건입니다.");
  }
  const lessonDate = cleanText(registration.lessonDate, 10);
  const config = instructorLessonConfirmationScheduleFor(lessonDate);
  if (!config) {
    throw new AppError("INVALID_ARGUMENT", `${lessonDate || "해당 수업일"} 예약확정 안내 설정이 없습니다.`);
  }
  const bookings = await loadConfirmedBookings(registration);
  assertConfirmedBookingSet(bookings, registration, config);
  await assertCalendarReady(config);

  const candidateId = instructorLessonConfirmationCandidateId({
    phone: normalizePhone(registration.memberPhone),
    lessonDate,
    managementNumber: config.managementNumber,
  });
  const candidateRef = refs.alimtalkCandidate(candidateId);
  const now = nowTimestamp();
  const result = await db.runTransaction(async (transaction) => {
    const [freshRegistrationSnapshot, candidateSnapshot] = await Promise.all([
      transaction.get(registrationRef),
      transaction.get(candidateRef),
    ]);
    if (!freshRegistrationSnapshot.exists) throw new AppError("NOT_FOUND", "강사레슨 등록 건이 삭제되었습니다.");
    const freshRegistration = freshRegistrationSnapshot.data() || {};
    const existingCandidate = candidateSnapshot.data();
    const retryableSourceBlock =
      existingCandidate?.status === "skipped" &&
      existingCandidate.reasonCode === "instructor_lesson_confirmation_source_blocked";
    if (
      existingCandidate &&
      !retryableSourceBlock &&
      ["failed", "skipped"].includes(String(existingCandidate.status || ""))
    ) {
      throw new AppError(
        "INVALID_ARGUMENT",
        `기존 예약확정 안내가 ${existingCandidate.status} 상태입니다. ${existingCandidate.lastError || "알림톡 이력을 확인하세요."}`,
      );
    }
    const bookingIds = bookings.map((booking) => booking.bookingId).sort();
    const memberId = cleanText(freshRegistration.evidence?.studiomateMemberId || bookings[0]?.memberId, 80);
    const nextSteps = {
      ...(freshRegistration.steps || {}),
      bookings: {
        status: "verified",
        label: "StudioMate 예약",
        detail: `활성 예약 ${bookingIds.length}개 세션 확인`,
        updatedAt: now,
      },
      confirmation: {
        status: existingCandidate?.status === "sent" ? "verified" : "queued",
        label: "예약확정 안내",
        detail: existingCandidate?.status === "sent" ? "알림톡 발송 완료" : "승인 템플릿 발송 대기",
        updatedAt: now,
      },
    };
    const nextState = deriveInstructorLessonRegistrationState({
      mode: freshRegistration.mode,
      steps: nextSteps,
    });
    transaction.set(
      registrationRef,
      {
        steps: nextSteps,
        evidence: {
          ...(freshRegistration.evidence || {}),
          bookingIds,
          confirmationCandidateId: candidateId,
          confirmationManagementNumber: config.managementNumber,
        },
        status: nextState.status,
        nextAction: nextState.nextAction,
        lastError: null,
        updatedAt: now,
      },
      { merge: true },
    );
    if (!candidateSnapshot.exists || retryableSourceBlock) {
      const candidate: AlimtalkCandidateDoc = {
        candidateId,
        studioId: staff.studioId,
        memberId,
        memberName: cleanText(freshRegistration.memberName, 40),
        memberPhone: normalizePhone(freshRegistration.memberPhone),
        type: "instructor_lesson_confirmation",
        status: "queued",
        templateCode: ALIMTALK_TEMPLATES.instructor_lesson_confirmation.code,
        title: "강사레슨 예약확정",
        reason: `${config.lessonDateText} StudioMate 활성 예약 ${bookingIds.length}개 세션 확인`,
        sourceActionKey: candidateId,
        sourceDate: todayKst(),
        payload: {
          registrationId,
          memberName: cleanText(freshRegistration.memberName, 40),
          lessonDate,
          lessonDateText: config.lessonDateText,
          lessonTimeText: config.lessonTimeText,
          lessonComposition: config.lessonComposition,
          managementNumber: config.managementNumber,
          bookingIds: bookingIds.join(","),
          operatorStaffId: staff.staffId,
          operatorUid: staff.uid || "",
        },
        attempts: 0,
        maxAttempts: 2,
        queuedBy: "auto",
        reviewedByUid: "system:core-instructor-lesson-confirmation",
        reviewedAt: now,
        lastError: null,
        createdAt: existingCandidate?.createdAt || now,
        updatedAt: now,
      };
      transaction.set(candidateRef, candidate);
    }
    return {
      duplicate: candidateSnapshot.exists,
      requeued: retryableSourceBlock,
      candidateStatus: existingCandidate?.status || "queued",
      bookingIds,
      memberId,
    };
  });

  return {
    ok: true,
    registrationId,
    candidateId,
    lessonDate,
    managementNumber: config.managementNumber,
    ...result,
  };
}

export async function instructorLessonConfirmationSendabilityIssue(candidate: AlimtalkCandidateDoc): Promise<string> {
  if (candidate.type !== "instructor_lesson_confirmation") return "";
  const registrationId = cleanText(candidate.payload?.registrationId, 80);
  const registrationSnapshot = registrationId ? await db.collection(REGISTRATIONS).doc(registrationId).get() : null;
  if (!registrationSnapshot?.exists) return "강사레슨 등록 원천 없음";
  const registration = registrationSnapshot.data() || {};
  const lessonDate = cleanText(candidate.payload?.lessonDate, 10);
  const config = instructorLessonConfirmationScheduleFor(lessonDate);
  if (!config || config.managementNumber !== cleanText(candidate.payload?.managementNumber, 100)) {
    return "강사레슨 예약확정 일정·관리번호 계약 불일치";
  }
  const bookingIds = cleanText(candidate.payload?.bookingIds, 1000).split(",").filter(Boolean);
  if (bookingIds.length !== REQUIRED_BOOKING_COUNT) return "강사레슨 활성 예약 두 세션 확인 안 됨";
  const snapshots = await db.getAll(...bookingIds.map((bookingId) => refs.booking(bookingId)));
  const bookings = snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.data() as BookingDoc);
  try {
    assertConfirmedBookingSet(bookings, registration, config);
    await assertCalendarReady(config);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

export async function syncInstructorLessonConfirmationOutcome(
  candidate: AlimtalkCandidateDoc,
  outcome: {
    status: "queued" | "processing" | "sent" | "skipped" | "failed";
    reasonCode?: string;
    detail?: string;
    solapiMessageId?: string;
  },
): Promise<void> {
  if (candidate.type !== "instructor_lesson_confirmation") return;
  const registrationId = cleanText(candidate.payload?.registrationId, 80);
  if (!registrationId) return;
  const registrationRef = db.collection(REGISTRATIONS).doc(registrationId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(registrationRef);
    if (!snapshot.exists) return;
    const registration = snapshot.data() || {};
    const memberExcluded =
      Boolean(ALIMTALK_MEMBER_EXCLUSION_REASONS[candidate.memberId]) ||
      (isAlimtalkTestRecipient(candidate) && !hasExplicitAlimtalkTestOverride(candidate));
    const duplicate = outcome.reasonCode === "duplicate_send_blocked";
    const stepStatus =
      outcome.status === "sent" || duplicate
        ? "verified"
        : outcome.status === "skipped" && memberExcluded
          ? "not_required"
          : outcome.status === "queued" || outcome.status === "processing"
            ? "queued"
            : outcome.status === "failed"
              ? "failed"
              : "review_required";
    const detail =
      outcome.detail ||
      (stepStatus === "verified"
        ? duplicate
          ? "기존 성공 발송 확인"
          : "알림톡 발송 완료"
        : stepStatus === "not_required"
          ? ALIMTALK_MEMBER_EXCLUSION_REASONS[candidate.memberId]
          : "알림톡 발송 상태 확인 필요");
    const steps = {
      ...(registration.steps || {}),
      confirmation: {
        status: stepStatus,
        label: "예약확정 안내",
        detail,
        updatedAt: nowTimestamp(),
      },
    };
    const nextState = deriveInstructorLessonRegistrationState({ mode: registration.mode, steps });
    transaction.set(
      registrationRef,
      {
        steps,
        status: nextState.status,
        nextAction: nextState.nextAction,
        lastError: ["failed", "review_required"].includes(stepStatus) ? detail : null,
        evidence: {
          ...(registration.evidence || {}),
          confirmationCandidateId: candidate.candidateId,
          confirmationSolapiMessageId:
            outcome.solapiMessageId || registration.evidence?.confirmationSolapiMessageId || "",
        },
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  });
}

export function instructorLessonConfirmationScheduleFor(
  lessonDate: string,
): InstructorLessonConfirmationSchedule | null {
  return CONFIRMATION_SCHEDULES[cleanText(lessonDate, 10)] || null;
}

export function instructorLessonConfirmationCandidateId(input: {
  phone: string;
  lessonDate: string;
  managementNumber: string;
}): string {
  return `instructor_lesson_confirmation_${stableHash({
    phone: normalizePhone(input.phone),
    lessonDate: cleanText(input.lessonDate, 10),
    managementNumber: cleanText(input.managementNumber, 100),
    templateCode: ALIMTALK_TEMPLATES.instructor_lesson_confirmation.code,
  }).slice(0, 24)}`;
}

export function activeInstructorLessonBooking(booking: BookingDoc): boolean {
  if (booking.appStatus !== "reserved") return false;
  if ((booking as BookingDoc & { active?: boolean }).active === false) return false;
  if ((booking as BookingDoc & { archiveBooking?: { isCanonical?: boolean } }).archiveBooking?.isCanonical === false)
    return false;
  if (cleanText(booking.supersededByBookingId, 100)) return false;
  return !/(missing_from_latest_reservation_import|superseded|duplicate|stale|lecture_deleted|deleted|cancel)/i.test(
    cleanText(booking.sourceStatus, 160),
  );
}

async function loadConfirmedBookings(registration: Record<string, any>): Promise<BookingDoc[]> {
  const lessonDate = cleanText(registration.lessonDate, 10);
  const phone = normalizePhone(registration.memberPhone);
  const memberId = cleanText(registration.evidence?.studiomateMemberId, 80);
  const snapshot = await refs.bookings().where("lectureDate", "==", lessonDate).get();
  const matches = snapshot.docs
    .map((doc) => doc.data())
    .filter((booking) => booking.studioId === registration.studioId)
    .filter((booking) => normalizePhone(booking.memberPhone) === phone || (memberId && booking.memberId === memberId));
  return canonicalizeBookings(matches)
    .filter(activeInstructorLessonBooking)
    .filter(isInstructorLessonBooking)
    .sort((a, b) => timestampMillis(a.lectureStartAt) - timestampMillis(b.lectureStartAt));
}

function assertConfirmedBookingSet(
  bookings: BookingDoc[],
  registration: Record<string, any>,
  config: InstructorLessonConfirmationSchedule,
): void {
  if (bookings.length !== REQUIRED_BOOKING_COUNT) {
    throw new AppError(
      "INVALID_ARGUMENT",
      `StudioMate 활성 강사레슨 예약이 ${bookings.length}건입니다. 두 세션 예약을 완료한 뒤 다시 확인하세요.`,
    );
  }
  const phone = normalizePhone(registration.memberPhone);
  const memberId = cleanText(registration.evidence?.studiomateMemberId, 80);
  const lessonIds = new Set<string>();
  for (const booking of bookings) {
    if (!activeInstructorLessonBooking(booking))
      throw new AppError("INVALID_ARGUMENT", "취소되거나 유효하지 않은 예약이 포함되어 있습니다.");
    if (booking.lectureDate !== config.lessonDate)
      throw new AppError("INVALID_ARGUMENT", "예약 수업일이 등록 수업일과 다릅니다.");
    if (normalizePhone(booking.memberPhone) !== phone && (!memberId || booking.memberId !== memberId)) {
      throw new AppError("INVALID_ARGUMENT", "예약 회원이 강사레슨 등록 회원과 다릅니다.");
    }
    if (!isInstructorLessonBooking(booking))
      throw new AppError("INVALID_ARGUMENT", "강사레슨 수강권 예약이 아닌 항목이 포함되어 있습니다.");
    lessonIds.add(booking.lectureId || `${timestampMillis(booking.lectureStartAt)}`);
  }
  if (lessonIds.size !== REQUIRED_BOOKING_COUNT) {
    throw new AppError("INVALID_ARGUMENT", "같은 세션의 중복 예약이 감지되었습니다.");
  }
  const startTime = kstTime(Math.min(...bookings.map((booking) => timestampMillis(booking.lectureStartAt))));
  const endTime = kstTime(Math.max(...bookings.map((booking) => timestampMillis(booking.lectureEndAt))));
  if (startTime !== config.expectedStartTime || endTime !== config.expectedEndTime) {
    throw new AppError(
      "INVALID_ARGUMENT",
      `예약 시간 ${startTime || "-"}~${endTime || "-"}이 안내 시간 ${config.lessonTimeText}과 다릅니다.`,
    );
  }
}

async function assertCalendarReady(config: InstructorLessonConfirmationSchedule): Promise<void> {
  const [pageResponse, icsResponse] = await Promise.all([
    fetch(config.calendarUrl, { signal: AbortSignal.timeout(8_000) }),
    fetch(config.icsUrl, { signal: AbortSignal.timeout(8_000) }),
  ]);
  if (!pageResponse.ok) throw new AppError("INVALID_ARGUMENT", `캘린더 안내 페이지 HTTP ${pageResponse.status}`);
  if (!icsResponse.ok) throw new AppError("INVALID_ARGUMENT", `캘린더 파일 HTTP ${icsResponse.status}`);
  const ics = await icsResponse.text();
  for (const marker of [
    "BEGIN:VCALENDAR",
    `DTSTART:${config.icsStart}`,
    `DTEND:${config.icsEnd}`,
    "LOCATION:ARCHIVE PILATES 명지",
  ]) {
    if (!ics.includes(marker)) throw new AppError("INVALID_ARGUMENT", `캘린더 파일 계약 불일치: ${marker}`);
  }
}

function schedule(input: {
  lessonDate: string;
  managementNumber: string;
  lessonDateText: string;
  icsStart: string;
  icsEnd: string;
}): InstructorLessonConfirmationSchedule {
  const base = `https://in.archivepilates.com/method/${input.managementNumber}/calendar`;
  return {
    ...input,
    lessonTimeText: "13:00~15:10",
    lessonComposition: "민진T 리포머 + 폼롤러\n은영T 바렐 + 토닝볼",
    expectedStartTime: "13:00",
    expectedEndTime: "15:10",
    calendarUrl: `${base}/`,
    icsUrl: `${base}/archive-method-${input.lessonDate.slice(2).replace(/-/g, "")}.ics`,
  };
}

function isInstructorLessonBooking(booking: BookingDoc): boolean {
  return /강사\s*레슨/i.test(
    [booking.ticketName, booking.ticketClassType, booking.ticketType].filter(Boolean).join(" "),
  );
}

function kstTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function timestampMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return Number((value as { toMillis: () => number }).toMillis()) || 0;
  }
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return Number((value as { toDate: () => Date }).toDate().getTime()) || 0;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function manager(request: CallableRequest): Promise<StaffDoc> {
  const staff = await requireStaff(request);
  requireManager(staff);
  return staff;
}

function normalizePhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  return /^8210\d{8}$/.test(digits) ? `0${digits.slice(2)}` : digits;
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

export function registrationIdForConfirmation(studioId: string, phone: string, lessonDate: string): string {
  return instructorLessonRegistrationId(studioId, phone, lessonDate);
}
