import { createHash } from "node:crypto";
import { AppError } from "../utils/errors";

export const INSTRUCTOR_CANCELLATIONS = "studiomateInstructorLessonCancellations";
export const CANCELLATION_REGISTRATION_STATUSES = new Set(["cancellation_pending", "cancellation_review", "cancelled"]);

export function parseInstructorCancellation(data: any, today: string) {
  const memberId = String(data?.memberId || "");
  const lessonDate = String(data?.lessonDate || "");
  const reason = String(data?.reason || "").trim();
  const registrationId = String(data?.registrationId || "");
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(lessonDate)
    && Number.isFinite(Date.parse(`${lessonDate}T00:00:00Z`))
    && new Date(`${lessonDate}T00:00:00Z`).toISOString().slice(0, 10) === lessonDate;
  if (!/^[1-9]\d{0,15}$/.test(memberId) || !validDate || lessonDate < today
    || (registrationId && !/^ilr_[a-f0-9]{24}$/.test(registrationId))
    || data?.confirmed !== true || reason.length < 2 || reason.length > 200) {
    throw new AppError("INVALID_ARGUMENT", "회원·수강일·취소 사유와 수강권 및 예약 취소 확인을 확인하세요.");
  }
  return { memberId, lessonDate, reason, registrationId };
}

export function instructorCancellationId(studioId: string, memberId: string, lessonDate: string) {
  return `ilc_${createHash("sha256").update(`${studioId}|${memberId}|${lessonDate}`).digest("hex").slice(0, 32)}`;
}

export function assertInstructorCancellationIdle(registration: any, job: any, candidate: any) {
  if (job?.status === "processing" || job?.externalEffectStarted === true || job?.effectStartedAt
    || registration?.externalEffectStarted === true || candidate?.status === "processing") {
    throw new AppError("INVALID_ARGUMENT", "등록·발송 작업이 실행 중입니다. 결과를 확인한 뒤 취소하세요.");
  }
}

export function cancellationBlocksRegistration(value: any): boolean {
  return CANCELLATION_REGISTRATION_STATUSES.has(String(value?.status || "")) || Boolean(value?.cancellation?.jobId);
}
