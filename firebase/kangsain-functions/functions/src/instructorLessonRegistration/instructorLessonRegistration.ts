import { createHash } from "node:crypto";
import type { CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { requireManager, requireStaff } from "../security/authGuards";
import type { StaffDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { AppError } from "../utils/errors";
import {
  buildInstructorLessonRegistrationCounts,
  buildInstructorLessonScheduleSummaries,
  INSTRUCTOR_LESSON_DEFAULT_CAPACITY,
  instructorLessonScheduleDateRange,
  isInstructorLessonSyntheticTest,
} from "./instructorLessonSchedule";

const REGISTRATIONS = "instructorLessonRegistrations";
const STUDIOMATE_JOBS = "studiomateInstructorLessonJobs";
const TICKET_NAME = "강사레슨 (2T)";
const MAX_DASHBOARD_ITEMS = 100;
const MAX_DASHBOARD_QUERY_ITEMS = 200;
const DASHBOARD_STATUSES = [
  "queued",
  "processing",
  "retry",
  "waiting_signature",
  "memo_pending",
  "booking_pending",
  "confirmation_pending",
  "action_required",
  "review_required",
  "failed",
  "completed",
] as const;

type RegistrationStepStatus =
  | "not_required"
  | "pending"
  | "processing"
  | "queued"
  | "sent"
  | "waiting_external"
  | "verified"
  | "review_required"
  | "failed";

type RegistrationStep = {
  status: RegistrationStepStatus;
  label: string;
  detail?: string | null;
  updatedAt?: unknown;
};

type RegistrationInput = {
  memberName: string;
  memberPhone: string;
  lessonDate: string;
  paymentMethod: "card" | "cash" | "wiretransfer";
  paymentConfirmed: boolean;
  seatConfirmed: boolean;
};

export async function operatorCreateInstructorLessonRegistrationHandler(
  request: CallableRequest,
): Promise<Record<string, unknown>> {
  const staff = await manager(request);
  const input = parseRegistrationInput(request.data);
  const registrationId = instructorLessonRegistrationId(staff.studioId, input.memberPhone, input.lessonDate);
  const registrationRef = db.collection(REGISTRATIONS).doc(registrationId);
  const jobRef = db.collection(STUDIOMATE_JOBS).doc(registrationId);
  const now = nowTimestamp();

  const result = await db.runTransaction(async (transaction) => {
    const [registrationSnapshot, jobSnapshot] = await Promise.all([
      transaction.get(registrationRef),
      transaction.get(jobRef),
    ]);
    const existing = registrationSnapshot.data() || {};
    const existingStatus = cleanText(existing.status, 40);
    if (registrationSnapshot.exists && existingStatus !== "cancelled") {
      assertSameRegistration(existing, input);
      return {
        duplicate: true,
        registrationId,
        status: existingStatus || "queued",
      };
    }

    const steps: Record<string, RegistrationStep> = {
      member: step("pending", "회원·등급 확인"),
      ticket: step("pending", `${TICKET_NAME} 발급`),
      bookings: {
        ...step("not_required", "반배정·예약(수동)"),
        detail: "수강권 발급 후 운영자가 StudioMate에서 직접 처리",
      },
      eformsign: step("pending", "강사회원 가입서 판정"),
      memo: step("pending", "가입서 완료 메모"),
      confirmation: {
        ...step("pending", "예약확정 안내"),
        detail: "수강권 발급 검증 후 승인 템플릿으로 자동 1회 발송",
      },
    };
    const source = {
      type: "archive_core_operator",
      sourceId: registrationId,
    };
    transaction.set(registrationRef, {
      registrationId,
      idempotencyKey: registrationId,
      studioId: staff.studioId,
      memberName: input.memberName,
      memberPhone: input.memberPhone,
      phoneLast4: input.memberPhone.slice(-4),
      lessonDate: input.lessonDate,
      paymentMethod: input.paymentMethod,
      ticketName: TICKET_NAME,
      mode: "unresolved",
      status: "queued",
      operatorChecks: {
        paymentConfirmed: true,
        seatConfirmed: true,
      },
      steps,
      source,
      createdBy: {
        staffId: staff.staffId,
        name: staff.name,
        email: staff.email || null,
      },
      lastError: null,
      nextAction: "StudioMate 회원·등급 확인",
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(
      jobRef,
      {
        jobId: registrationId,
        registrationId,
        studioId: staff.studioId,
        memberName: input.memberName,
        memberPhone: input.memberPhone,
        lessonDate: input.lessonDate,
        paymentMethod: input.paymentMethod,
        ticketName: TICKET_NAME,
        status: "pending",
        currentStep: "member",
        attempts: jobSnapshot.exists ? Number(jobSnapshot.data()?.attempts || 0) : 0,
        maxAttempts: 3,
        externalEffectStarted: false,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    return { duplicate: false, registrationId, status: "queued" };
  });

  return {
    ok: true,
    ...result,
    phoneLast4: input.memberPhone.slice(-4),
    lessonDate: input.lessonDate,
  };
}

export async function getInstructorLessonRegistrationDashboardHandler(
  request: CallableRequest,
): Promise<Record<string, unknown>> {
  const staff = await manager(request);
  const requestedLimit = Math.max(1, Math.min(MAX_DASHBOARD_ITEMS, Number(request.data?.limit || 50)));
  const registrations = db.collection(REGISTRATIONS).where("studioId", "==", staff.studioId);
  const [snapshot, schedule] = await Promise.all([
    registrations.orderBy("updatedAt", "desc").limit(MAX_DASHBOARD_QUERY_ITEMS).get(),
    loadInstructorLessonSchedule(staff.studioId),
  ]);
  const productionRows = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((item) => !isInstructorLessonSyntheticTest(item.data));
  const allItems = productionRows.map((item) => safeRegistration(item.id, item.data));
  const counts = buildInstructorLessonRegistrationCounts(
    productionRows.map((item) => item.data),
    DASHBOARD_STATUSES,
  );
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    counts,
    countsLimited: snapshot.size === MAX_DASHBOARD_QUERY_ITEMS,
    items: allItems.slice(0, requestedLimit),
    schedule,
  };
}

async function loadInstructorLessonSchedule(studioId: string): Promise<Record<string, unknown>> {
  const { startDate, endDate } = instructorLessonScheduleDateRange();
  const [lecturesSnapshot, bookingsSnapshot, holdersSnapshot, registrationsSnapshot] = await Promise.all([
    db
      .collection("lectures")
      .where("studioId", "==", studioId)
      .where("date", ">=", startDate)
      .where("date", "<=", endDate)
      .get(),
    db
      .collection("bookings")
      .where("studioId", "==", studioId)
      .where("ticketName", "==", TICKET_NAME)
      .where("lectureDate", ">=", startDate)
      .where("lectureDate", "<=", endDate)
      .get(),
    db
      .collection("memberProfiles")
      .where("studioId", "==", studioId)
      .where("activeTicketNames", "array-contains", TICKET_NAME)
      .get(),
    db.collection(REGISTRATIONS).where("lessonDate", ">=", startDate).where("lessonDate", "<=", endDate).get(),
  ]);
  const items = buildInstructorLessonScheduleSummaries({
    startDate,
    endDate,
    defaultCapacity: INSTRUCTOR_LESSON_DEFAULT_CAPACITY,
    lectures: lecturesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    bookings: bookingsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    ticketHolders: holdersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    registrations: registrationsSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((item) => cleanText((item as Record<string, unknown>).studioId, 80) === studioId),
  });
  return {
    startDate,
    endDate,
    defaultCapacity: INSTRUCTOR_LESSON_DEFAULT_CAPACITY,
    items,
  };
}

export function instructorLessonRegistrationId(studioId: string, phone: string, lessonDate: string): string {
  return `ilr_${createHash("sha256")
    .update(`${cleanText(studioId, 80)}|${normalizePhone(phone)}|${cleanText(lessonDate, 10)}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function parseRegistrationInput(data: unknown): RegistrationInput {
  const value = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const memberName = cleanText(value.memberName, 40);
  const memberPhone = normalizePhone(value.memberPhone);
  const lessonDate = cleanText(value.lessonDate, 10);
  const paymentMethod = cleanText(value.paymentMethod, 20);
  if (memberName.length < 2) throw new AppError("INVALID_ARGUMENT", "강사 이름을 두 글자 이상 입력하세요.");
  if (!/^010\d{8}$/.test(memberPhone)) throw new AppError("INVALID_ARGUMENT", "010 휴대폰번호 11자리를 입력하세요.");
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(lessonDate) || Number.isNaN(Date.parse(`${lessonDate}T00:00:00+09:00`))) {
    throw new AppError("INVALID_ARGUMENT", "강사레슨 수강일을 확인하세요.");
  }
  if (!isPaymentMethod(paymentMethod)) {
    throw new AppError("INVALID_ARGUMENT", "StudioMate에 기록할 결제수단을 선택하세요.");
  }
  if (value.paymentConfirmed !== true || value.seatConfirmed !== true) {
    throw new AppError("INVALID_ARGUMENT", "입금과 수강 접수를 확인한 뒤 등록을 확정하세요.");
  }
  return { memberName, memberPhone, lessonDate, paymentMethod, paymentConfirmed: true, seatConfirmed: true };
}

function safeRegistration(id: string, data: Record<string, unknown>): Record<string, unknown> {
  const steps =
    data.steps && typeof data.steps === "object"
      ? Object.fromEntries(
          Object.entries(data.steps as Record<string, unknown>).map(([key, value]) => [key, safeStep(value)]),
        )
      : {};
  const phoneLast4 = cleanText(data.phoneLast4, 4) || normalizePhone(data.memberPhone).slice(-4);
  return {
    registrationId: id,
    memberName: cleanText(data.memberName, 40),
    phoneLast4,
    lessonDate: cleanText(data.lessonDate, 10),
    paymentMethod: cleanText(data.paymentMethod, 20),
    ticketName: cleanText(data.ticketName, 80),
    mode: cleanText(data.mode, 40),
    status: cleanText(data.status, 40),
    nextAction: cleanText(data.nextAction, 160),
    lastError: cleanText(data.lastError, 300),
    steps,
    evidence: safeEvidence(data.evidence),
    createdAt: timestampIso(data.createdAt),
    updatedAt: timestampIso(data.updatedAt),
  };
}

function safeStep(value: unknown): Record<string, unknown> {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    status: cleanText(data.status, 40),
    label: cleanText(data.label, 80),
    detail: cleanText(data.detail, 200),
    updatedAt: timestampIso(data.updatedAt),
  };
}

function safeEvidence(value: unknown): Record<string, unknown> {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    studiomateMemberId: cleanText(data.studiomateMemberId, 80),
    ticketId: cleanText(data.ticketId, 80),
    bookingIds: Array.isArray(data.bookingIds)
      ? data.bookingIds
          .map((item) => cleanText(item, 80))
          .filter(Boolean)
          .slice(0, 10)
      : [],
    eformsignDocumentId: cleanText(data.eformsignDocumentId, 160),
    confirmationCandidateId: cleanText(data.confirmationCandidateId, 160),
    confirmationManagementNumber: cleanText(data.confirmationManagementNumber, 160),
    confirmationSolapiMessageId: cleanText(data.confirmationSolapiMessageId, 160),
  };
}

function assertSameRegistration(existing: Record<string, unknown>, input: RegistrationInput): void {
  if (
    cleanText(existing.memberName, 40) !== input.memberName ||
    normalizePhone(existing.memberPhone) !== input.memberPhone ||
    cleanText(existing.lessonDate, 10) !== input.lessonDate ||
    cleanText(existing.paymentMethod, 20) !== input.paymentMethod
  ) {
    throw new AppError("INVALID_ARGUMENT", "같은 중복키의 등록 정보가 다릅니다. 기존 건을 먼저 확인하세요.");
  }
}

function isPaymentMethod(value: string): value is RegistrationInput["paymentMethod"] {
  return ["card", "cash", "wiretransfer"].includes(value);
}

function step(status: RegistrationStepStatus, label: string): RegistrationStep {
  return { status, label, detail: null };
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

function timestampIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  const data = value as { seconds?: number; _seconds?: number };
  const seconds = Number(data.seconds ?? data._seconds);
  if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
