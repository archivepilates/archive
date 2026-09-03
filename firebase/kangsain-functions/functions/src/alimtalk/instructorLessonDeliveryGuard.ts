import type { AlimtalkCandidateDoc } from "../types/models";

export function genericInstructorLessonQueueBlock(candidate: AlimtalkCandidateDoc): {
  status: "skipped" | "failed";
  reasonCode: string;
  lastError: string;
} | null {
  if (candidate.type !== "instructor_lesson_material") return null;
  if (candidate.payload?.deliveryMode === "approved_live") {
    return {
      status: "failed",
      reasonCode: "instructor_lesson_provider_outcome_unknown",
      lastError: "강사레슨 승인 전용 발송이 중단된 뒤 결과가 불명확해 자동 재시도하지 않음",
    };
  }
  return {
    status: "skipped",
    reasonCode: "instructor_lesson_sample_approval_required",
    lastError: "강사레슨 D-1 알림톡은 샘플 성공과 명시적 승인 전용 경로에서만 발송 가능",
  };
}
