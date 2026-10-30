import { createHash } from "node:crypto";
import type { CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import { requireManager, requireStaff } from "../security/authGuards";
import type { AlimtalkCandidateDoc, StaffDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { AppError } from "../utils/errors";
import { stableHash } from "../utils/hash";
import { ALIMTALK_MEMBER_EXCLUSION_REASONS, ALIMTALK_TEMPLATES } from "../alimtalk/templates";
import { hasExplicitAlimtalkTestOverride, isAlimtalkTestRecipient } from "../alimtalk/testRecipients";
import { instructorLessonRegistrationId } from "./instructorLessonRegistration";
import { deriveInstructorLessonRegistrationState } from "./instructorLessonRegistrationState";
import { resolveNotionLessonSchedule } from "./instructorLessonNotionSchedule";
import { cancellationBlocksRegistration } from "./instructorLessonCancellationPolicy";
import { isInstructorLessonWaitlist } from "./instructorLessonWaitlist";

const REGISTRATIONS = "instructorLessonRegistrations";
const TICKET_NAME = "강사레슨 (2T)";

type ConfirmationQueueSource = "ticket_verified_trigger" | "core_recovery";

type ConfirmationQueueContext = {
  source: ConfirmationQueueSource;
  expectedStudioId?: string;
  operatorStaffId?: string;
  operatorUid?: string;
  allowRetry?: boolean;
};

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
  return queueInstructorLessonConfirmationForIssuedTicket(registrationId, {
    source: "core_recovery",
    expectedStudioId: staff.studioId,
    operatorStaffId: staff.staffId,
    operatorUid: staff.uid || "",
    allowRetry: true,
  });
}

export async function queueInstructorLessonConfirmationOnTicketVerifiedHandler(input: {
  registrationId: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
}): Promise<Record<string, unknown>> {
  const registrationId = cleanText(input.registrationId, 80);
  if (isInstructorLessonWaitlist(input.after)) return { ok: true, skipped: "waitlist_only" };
  if (input.after?.intakeOnly === true) return { ok: true, skipped: "team_intake_only" };
  const beforeTicketStatus = cleanText(input.before?.steps?.ticket?.status, 40);
  const afterTicketStatus = cleanText(input.after?.steps?.ticket?.status, 40);
  if (afterTicketStatus !== "verified") return { ok: true, skipped: "ticket_not_verified" };
  if (beforeTicketStatus === "verified") return { ok: true, skipped: "ticket_already_verified" };
  try {
    return await queueInstructorLessonConfirmationForIssuedTicket(registrationId, {
      source: "ticket_verified_trigger",
    });
  } catch (error) {
    if (!(error instanceof AppError) || error.retryable) throw error;
    await markConfirmationQueueFailure(registrationId, error.message);
    return { ok: false, registrationId, error: error.message };
  }
}

export async function queueInstructorLessonConfirmationForIssuedTicket(
  registrationId: string,
  context: ConfirmationQueueContext,
): Promise<Record<string, unknown>> {
  const registrationRef = db.collection(REGISTRATIONS).doc(registrationId);
  const now = nowTimestamp();
  const initial = (await registrationRef.get()).data();
  if (!initial) throw new AppError("NOT_FOUND", "강사레슨 등록 건이 삭제되었습니다.");
  if (context.expectedStudioId && initial.studioId !== context.expectedStudioId) throw new AppError("PERMISSION_DENIED", "다른 스튜디오의 강사레슨 등록 건입니다.");
  const initialIssue = instructorLessonTicketConfirmationIssue(initial);
  if (initialIssue) throw new AppError("INVALID_ARGUMENT", initialIssue);
  const sourceDate = cleanText(initial.lessonDate, 10);
  const config = await resolveConfirmationSchedule(sourceDate);
  await assertCalendarReady(config);
  const result = await db.runTransaction(async (transaction) => {
    const freshRegistrationSnapshot = await transaction.get(registrationRef);
    if (!freshRegistrationSnapshot.exists) throw new AppError("NOT_FOUND", "강사레슨 등록 건이 삭제되었습니다.");
    const freshRegistration = freshRegistrationSnapshot.data() || {};
    if (
      context.expectedStudioId &&
      cleanText(freshRegistration.studioId, 80) !== cleanText(context.expectedStudioId, 80)
    ) {
      throw new AppError("PERMISSION_DENIED", "다른 스튜디오의 강사레슨 등록 건입니다.");
    }
    const ticketIssue = instructorLessonTicketConfirmationIssue(freshRegistration);
    if (ticketIssue) throw new AppError("INVALID_ARGUMENT", ticketIssue);
    const attendeeGuard = await instructorOrderAttendeeGuard(registrationId, freshRegistration, async (path) => {
      const snapshot = await transaction.get(db.doc(path));
      return snapshot.exists ? snapshot.data() || {} : null;
    });
    if (attendeeGuard.issue) throw new AppError("INVALID_ARGUMENT", attendeeGuard.issue);
    const lessonDate = cleanText(freshRegistration.lessonDate, 10);
    if (lessonDate !== sourceDate) throw new AppError("INVALID_ARGUMENT", "일정 확인 중 수업일이 변경되었습니다. 다시 처리하세요.");
    const candidateId = instructorLessonConfirmationCandidateId({
      phone: normalizePhone(freshRegistration.memberPhone),
      lessonDate,
      managementNumber: config.managementNumber,
    });
    const candidateRef = refs.alimtalkCandidate(candidateId);
    const candidateSnapshot = await transaction.get(candidateRef);
    const existingCandidate = candidateSnapshot.data();
    const retryableSourceBlock =
      existingCandidate?.status === "skipped" &&
      existingCandidate.reasonCode === "instructor_lesson_confirmation_source_blocked";
    const managerRetry =
      context.allowRetry === true &&
      ["failed", "skipped"].includes(String(existingCandidate?.status || "")) &&
      existingCandidate?.reasonCode !== "duplicate_send_blocked";
    const shouldWriteCandidate = !candidateSnapshot.exists || retryableSourceBlock || managerRetry;
    const existingStatus = String(existingCandidate?.status || "");
    const confirmationStatus =
      shouldWriteCandidate || ["queued", "processing"].includes(existingStatus)
        ? "queued"
        : existingStatus === "sent" || existingCandidate?.reasonCode === "duplicate_send_blocked"
          ? "verified"
          : ["failed", "skipped"].includes(existingStatus)
            ? "review_required"
            : "queued";
    const memberId = cleanText(freshRegistration.evidence?.studiomateMemberId, 80);
    const ticketId = cleanText(freshRegistration.evidence?.ticketId, 80);
    const nextSteps = {
      ...(freshRegistration.steps || {}),
      confirmation: {
        status: confirmationStatus,
        label: "예약확정 안내",
        detail:
          confirmationStatus === "verified"
            ? "알림톡 발송 완료"
            : confirmationStatus === "review_required"
              ? existingCandidate?.lastError || "기존 알림톡 이력 확인 필요"
              : "수강권 발급 확인 · 승인 템플릿 발송 대기",
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
          confirmationCandidateId: candidateId,
          confirmationManagementNumber: config.managementNumber,
        },
        status: nextState.status,
        nextAction: nextState.nextAction,
        lastError: confirmationStatus === "review_required" ? nextSteps.confirmation.detail : null,
        updatedAt: now,
      },
      { merge: true },
    );
    if (shouldWriteCandidate) {
      const candidate: AlimtalkCandidateDoc = {
        candidateId,
        studioId: cleanText(freshRegistration.studioId, 80),
        memberId,
        memberName: cleanText(freshRegistration.memberName, 40),
        memberPhone: normalizePhone(freshRegistration.memberPhone),
        type: "instructor_lesson_confirmation",
        status: "queued",
        templateCode: ALIMTALK_TEMPLATES.instructor_lesson_confirmation.code,
        title: "강사레슨 예약확정",
        reason: `${config.lessonDateText} ${TICKET_NAME} 수강권 발급 검증 완료`,
        sourceActionKey: candidateId,
        sourceDate: todayKst(),
        payload: {
          registrationId,
          ...(attendeeGuard.resolutionKey ? { attendeeResolutionKey: attendeeGuard.resolutionKey } : {}),
          memberName: cleanText(freshRegistration.memberName, 40),
          lessonDate,
          lessonDateText: config.lessonDateText,
          lessonTimeText: config.lessonTimeText,
          lessonComposition: config.lessonComposition,
          managementNumber: config.managementNumber,
          ticketName: TICKET_NAME,
          ticketId,
          operatorStaffId: cleanText(context.operatorStaffId || freshRegistration.createdBy?.staffId, 80),
          operatorUid: cleanText(context.operatorUid, 160),
          queueSource: context.source,
          scheduleSnapshot: JSON.stringify(config),
        },
        attempts: 0,
        maxAttempts: 2,
        queuedBy: "auto",
        reviewedByUid:
          context.source === "ticket_verified_trigger"
            ? "system:instructor-lesson-ticket-issued"
            : "system:core-instructor-lesson-confirmation",
        reviewedAt: now,
        lastError: null,
        createdAt: existingCandidate?.createdAt || now,
        updatedAt: now,
      };
      transaction.set(candidateRef, candidate);
    }
    return {
      duplicate: candidateSnapshot.exists,
      requeued: retryableSourceBlock || managerRetry,
      candidateStatus: shouldWriteCandidate ? "queued" : existingStatus || "queued",
      memberId,
      ticketId,
      candidateId,
      lessonDate,
      managementNumber: config.managementNumber,
    };
  });

  return {
    ok: true,
    registrationId,
    ...result,
  };
}

async function confirmationSource(candidate: AlimtalkCandidateDoc, allocationOnly = false): Promise<{
  registration: Record<string, any>; issue: string;
}> {
  const registrationId = cleanText(candidate.payload?.registrationId, 80);
  const missing = { registration: {}, issue: "강사레슨 등록 원천 없음" };
  if (!registrationId) return missing;
  try {
    return await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(db.collection(REGISTRATIONS).doc(registrationId));
      if (!snapshot.exists) return missing;
      const registration = snapshot.data() || {};
      const guard = await instructorOrderAttendeeGuard(registrationId, registration, async (path) => {
        const linked = await transaction.get(db.doc(path));
        return linked.exists ? linked.data() || {} : null;
      });
      if (allocationOnly && !guard.allocated && !candidate.payload?.attendeeResolutionKey) return { registration, issue: "" };
      if (guard.issue) return { registration, issue: guard.issue };
      const ticketIssue = instructorLessonTicketConfirmationIssue(registration);
      if (ticketIssue) return { registration, issue: ticketIssue };
      if (guard.resolutionKey || candidate.payload?.attendeeResolutionKey) {
        if (candidate.payload?.attendeeResolutionKey !== guard.resolutionKey
          || candidate.studioId !== registration.studioId || candidate.memberName !== registration.memberName
          || candidate.payload?.memberName !== registration.memberName
          || candidate.memberId !== registration.evidence?.studiomateMemberId
          || normalizePhone(candidate.memberPhone) !== normalizePhone(registration.memberPhone)
          || candidate.payload?.lessonDate !== registration.lessonDate
          || cleanText(candidate.payload?.ticketId, 80) !== cleanText(registration.evidence?.ticketId, 80)) {
          return { registration, issue: "다인 주문 승인키·실제 수신자 불일치" };
        }
        if (allocationOnly) {
          const live = (await transaction.get(refs.alimtalkCandidate(candidate.candidateId))).data() as
            (AlimtalkCandidateDoc & { queueLeaseId?: string }) | undefined;
          const send = await transaction.get(refs.alimtalkSend(candidate.candidateId));
          const lease = (candidate as AlimtalkCandidateDoc & { queueLeaseId?: string }).queueLeaseId;
          if (!lease || live?.status !== "processing" || live.queueLeaseId !== lease
            || live.attempts !== candidate.attempts || send.exists
            || stableHash([live.studioId, live.memberId, live.memberName, live.memberPhone, live.type, live.templateCode, live.payload])
              !== stableHash([candidate.studioId, candidate.memberId, candidate.memberName, candidate.memberPhone,
                candidate.type, candidate.templateCode, candidate.payload])) {
            return { registration, issue: "다인 주문 발송 선점·후보·기존 발송 이력 변경 확인필요" };
          }
        }
      }
      return { registration, issue: "" };
    });
  } catch {
    return { registration: {}, issue: "강사레슨 등록·공동 주문 원천 재조회 확인필요" };
  }
}

export async function instructorLessonConfirmationAllocationSendabilityIssue(candidate: AlimtalkCandidateDoc): Promise<string> {
  if (candidate.type !== "instructor_lesson_confirmation") return "";
  return (await confirmationSource(candidate, true)).issue;
}

export async function instructorLessonConfirmationSendabilityIssue(candidate: AlimtalkCandidateDoc): Promise<string> {
  if (candidate.type !== "instructor_lesson_confirmation") return "";
  const source = await confirmationSource(candidate);
  if (source.issue) return source.issue;
  const registration = source.registration;
  const lessonDate = cleanText(candidate.payload?.lessonDate, 10);
  let config: InstructorLessonConfirmationSchedule;
  try { config = await resolveConfirmationSchedule(lessonDate); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  if (!config || config.managementNumber !== cleanText(candidate.payload?.managementNumber, 100)) {
    return "강사레슨 예약확정 일정·관리번호 계약 불일치";
  }
  if (lessonDate !== cleanText(registration.lessonDate, 10)) return "강사레슨 등록 수업일이 변경되었습니다.";
  if (candidate.payload?.lessonDateText !== config.lessonDateText || candidate.payload?.lessonTimeText !== config.lessonTimeText || candidate.payload?.lessonComposition !== config.lessonComposition) {
    return "노션 강사레슨 일정이 변경되었습니다. 안내 재처리로 최신 내용을 확인하세요.";
  }
  if (normalizePhone(candidate.memberPhone) !== normalizePhone(registration.memberPhone)) {
    return "강사레슨 수강권 회원과 알림톡 수신자 불일치";
  }
  const candidateTicketId = cleanText(candidate.payload?.ticketId, 80);
  const currentTicketId = cleanText(registration.evidence?.ticketId, 80);
  if (candidateTicketId && currentTicketId && candidateTicketId !== currentTicketId) {
    return "강사레슨 수강권 발급 증거 불일치";
  }
  try {
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
    if (cancellationBlocksRegistration(registration)) return;
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

async function resolveConfirmationSchedule(lessonDate: string): Promise<InstructorLessonConfirmationSchedule> {
  return instructorLessonConfirmationScheduleFor(lessonDate) || await resolveNotionLessonSchedule(lessonDate);
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

export function instructorLessonTicketConfirmationIssue(registration: Record<string, any>): string {
  if (isInstructorLessonWaitlist(registration)) return "수강대기 · 미입금·좌석 미확정 · 발급·발송 대상 아님";
  if (registration.intakeOnly === true) return "팀레슨 접수 전용 · 일정·가입서·발급 확인 대기";
  if (cancellationBlocksRegistration(registration)) return "취소 요청·처리된 강사레슨 등록 건";
  if (registration.externalOrderReviewRequired) return "홈페이지 주문 변경 확인필요";
  if (registration.operatorChecks?.paymentConfirmed !== true || registration.operatorChecks?.seatConfirmed !== true) {
    return "입금·수강 접수 운영자 확인 없음";
  }
  if (cleanText(registration.steps?.member?.status, 40) !== "verified") return "StudioMate 회원 확인 안 됨";
  if (cleanText(registration.steps?.ticket?.status, 40) !== "verified") {
    return `${TICKET_NAME} 수강권 발급 확인 안 됨`;
  }
  if (normalizeComparable(registration.ticketName) !== normalizeComparable(TICKET_NAME)) {
    return "강사레슨 수강권 종류 불일치";
  }
  if (!cleanText(registration.evidence?.studiomateMemberId, 80)) return "StudioMate 회원 ID 없음";
  return "";
}

async function markConfirmationQueueFailure(registrationId: string, detail: string): Promise<void> {
  const registrationRef = db.collection(REGISTRATIONS).doc(registrationId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(registrationRef);
    if (!snapshot.exists) return;
    const registration = snapshot.data() || {};
    if (cancellationBlocksRegistration(registration)) return;
    const steps = {
      ...(registration.steps || {}),
      confirmation: {
        status: "review_required",
        label: "예약확정 안내",
        detail: cleanText(detail, 240),
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
        lastError: cleanText(detail, 500),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  });
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

function normalizeComparable(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

export function registrationIdForConfirmation(studioId: string, phone: string, lessonDate: string): string {
  return instructorLessonRegistrationId(studioId, phone, lessonDate);
}

type Document = Record<string, any>;
type ReadDocument = (path: string) => Promise<Document | null>;
type GuardResult = { issue: string; resolutionKey?: string; allocated?: boolean };

const POLICY = "imweb_instructor_attendees_v1";
const PRICE = 70000;
const STUDIO = "5330";
const ISSUE = "다인 주문 승인·원본·수강자 연결 확인필요";
const FAMILY_ISSUE = "다인 주문 수강자 중 취소·변경·미확인 건이 있어 공동 처리 중단";

export async function instructorOrderAttendeeGuard(
  registrationId: string,
  registration: Document,
  read: ReadDocument,
  now = new Date(),
): Promise<GuardResult> {
  const external = registration.externalOrder || {};
  const imwebSource = ["imweb_paid_order", "imweb_order_review"].includes(registration.source?.type);
  const allocation = Boolean(external.attendeeResolutionKey || registration.operatorOrderAllocation || registration.orderAllocation
    || Number(external.totalPaidAmount) > PRICE || Number(external.quantity) > 1);
  if (!imwebSource && !registration.externalOrder && !allocation) return { issue: "" };
  const orderNo = external.orderNo || (imwebSource ? registration.source?.sourceId : "");
  if (!/^\d{15}$/.test(String(orderNo || ""))) return { issue: ISSUE, allocated: allocation };
  if (imwebSource && external.orderNo && registration.source?.sourceId !== external.orderNo) return { issue: ISSUE, allocated: allocation };
  const ledger = await read(`imwebInstructorLessonOrders/imweb_${orderNo}`);
  const manifest = ledger?.attendeeResolution;
  if (!allocation && !manifest && !(Array.isArray(ledger?.registrationIds) && ledger.registrationIds.length > 1)) return { issue: "" };
  if (!ledger || ledger.status !== "queued" || !validManifest(manifest, now)
    || ledger.orderNo !== manifest.orderNo || ledger.itemNo !== manifest.itemNo
    || ledger.fingerprint !== manifest.sourceFingerprint || ledger.paymentAmount !== manifest.totalPaidAmount
    || external.attendeeResolutionKey !== manifest.resolutionKey
    || !manifest.attendees.some((attendee: Document) => attendee.registrationId === registrationId)
    || (ledger.registrationIds !== undefined && (!Array.isArray(ledger.registrationIds)
      || ledger.registrationIds.length !== manifest.attendees.length
      || new Set(ledger.registrationIds).size !== manifest.attendees.length
      || ledger.registrationIds.some((id: string) => !manifest.attendees.some((attendee: Document) => attendee.registrationId === id))))) {
    return { issue: ISSUE, allocated: true };
  }

  // Exact manifest IDs only; the transaction supplied by the caller owns all family reads.
  for (const attendee of manifest.attendees) {
    const id = attendee.registrationId;
    const linked = id === registrationId ? registration : await read(`instructorLessonRegistrations/${id}`);
    if (!linked || !matchesAttendee(linked, attendee, manifest)) return { issue: FAMILY_ISSUE, allocated: true };
  }
  return { issue: "", resolutionKey: manifest.resolutionKey, allocated: true };
}

function validManifest(value: any, now: Date): boolean {
  if (!value || value.version !== 1 || value.policy !== POLICY || value.status !== "approved"
    || value.studioId !== STUDIO || !/^\d{15}$/.test(value.orderNo || "")
    || typeof value.itemNo !== "string" || !value.itemNo.startsWith(`${value.orderNo}-`)
    || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint || "")
    || !Array.isArray(value.attendees) || value.attendees.length < 2 || value.attendees.length > 10
    || value.totalPaidAmount !== PRICE * value.attendees.length
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.lessonDate || "")) return false;
  const date = Date.parse(`${value.lessonDate}T00:00:00Z`);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== value.lessonDate
    || value.lessonDate <= today || typeof value.approval?.actor !== "string" || !value.approval.actor.trim()
    || typeof value.approval?.basis !== "string" || !value.approval.basis.trim()) return false;
  const approvedAt = Date.parse(value.approval?.approvedAt || "");
  if (!Number.isFinite(approvedAt) || approvedAt > now.getTime() + 60000) return false;
  const phones = new Set<string>();
  const attendees = [];
  for (const attendee of value.attendees) {
    if (!attendee || typeof attendee.memberName !== "string" || !attendee.memberName
      || attendee.memberName.length > 40 || attendee.memberName !== attendee.memberName.replace(/\s+/g, " ").trim()
      || typeof attendee.memberPhone !== "string" || !/^010\d{8}$/.test(attendee.memberPhone)
      || attendee.paidAmount !== PRICE || phones.has(attendee.memberPhone)
      || attendee.registrationId !== `ilr_${hashText(`${STUDIO}|${attendee.memberPhone}|${value.lessonDate}`).slice(0, 24)}`) return false;
    phones.add(attendee.memberPhone);
    attendees.push({ memberName: attendee.memberName, memberPhone: attendee.memberPhone,
      paidAmount: PRICE, registrationId: attendee.registrationId });
  }
  attendees.sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  if (attendees.some((attendee, index) => attendee.registrationId !== value.attendees[index].registrationId)) return false;
  // Keep field order identical to scripts/lib/imweb-instructor-order-policy.mjs.
  const binding = { policy: value.policy, version: value.version, studioId: value.studioId,
    orderNo: value.orderNo, itemNo: value.itemNo, lessonDate: value.lessonDate,
    sourceFingerprint: value.sourceFingerprint, totalPaidAmount: value.totalPaidAmount, attendees };
  return value.resolutionKey === hashText(JSON.stringify(binding));
}

function hasVerifiedTicketFollowupAttention(registration: Document): boolean {
  const steps = registration.steps || {};
  return registration.status === "action_required"
    && steps.member?.status === "verified" && steps.ticket?.status === "verified"
    && ["eformsign", "memo", "confirmation"].some(name => ["failed", "review_required"].includes(steps[name]?.status));
}

function matchesAttendee(registration: Document, attendee: Document, manifest: Document): boolean {
  const external = registration.externalOrder || {};
  return registration.registrationId === attendee.registrationId && registration.studioId === manifest.studioId
    && registration.memberName === attendee.memberName && phone(registration.memberPhone) === attendee.memberPhone
    && registration.lessonDate === manifest.lessonDate && registration.ticketPrice === attendee.paidAmount
    && registration.source?.type === "imweb_paid_order" && registration.source?.sourceId === manifest.orderNo
    && registration.source?.itemNo === manifest.itemNo && external.orderNo === manifest.orderNo
    && external.itemNo === manifest.itemNo && external.attendeeResolutionKey === manifest.resolutionKey
    && external.registrationId === attendee.registrationId && external.memberName === attendee.memberName
    && phone(external.memberPhone) === attendee.memberPhone && external.lessonDate === manifest.lessonDate
    && external.paidAmount === attendee.paidAmount && external.totalPaidAmount === manifest.totalPaidAmount
    && (!registration.orderAllocation || registration.orderAllocation.resolutionKey === manifest.resolutionKey)
    && registration.operatorChecks?.paymentConfirmed === true && registration.operatorChecks?.seatConfirmed === true
    && !registration.externalOrderReviewRequired && !registration.cancellation && !cancellationBlocksRegistration(registration)
    && !["cancelled", "canceled", "rejected", "review_required", "failed"].includes(registration.status)
    && (registration.status !== "action_required" || hasVerifiedTicketFollowupAttention(registration));
}

function phone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  return /^8210\d{8}$/.test(digits) ? `0${digits.slice(2)}` : digits;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
