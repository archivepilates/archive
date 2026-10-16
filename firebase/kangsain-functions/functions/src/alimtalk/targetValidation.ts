import { db } from "../config/firebase";
import type { AlimtalkCandidateDoc } from "../types/models";
import { todayKst } from "../utils/date";
import { AppError } from "../utils/errors";
import { alimtalkDedupeKey } from "./dedupe";
import { alimtalkDedupePolicy } from "./templates";
import { isHoldingNoticeCandidate } from "./holdingNoticeQueue";
import { ALIMTALK_TEMPLATE_TARGET_RULES } from "./templateTargetRules";
import {
  targetEligibilityIssue, targetDuplicateIssue, privateSurveySendabilityIssue,
  renewalCandidateSendabilityIssue, longAbsenceCandidateSendabilityIssue,
} from "./targetValidationChecks";

export const TARGET_VALIDATION_VERSION = "alimtalk-target-validation-v1";
type Candidate = AlimtalkCandidateDoc;
type Check = { stage: string; status: "passed" | "blocked" | "not_checked"; reasonCode: string };
interface Dependencies {
  loadCandidate(id: string): Promise<Candidate | undefined>;
  loadSend(id: string): Promise<unknown>;
  eligibility(candidate: Candidate, today: string): Promise<string>;
  source(candidate: Candidate): Promise<string>;
  duplicate(candidate: Candidate): Promise<string>;
  now(): Date;
  today(): string;
}

export function validationCandidateIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 10
    || value.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(id))) {
    throw new AppError("INVALID_ARGUMENT", "후보 ID를 1~10개 입력하세요.");
  }
  return [...new Set(value)];
}

function sourceTime(value: unknown): string | null {
  try {
    const ms = (value as { toMillis?: () => number })?.toMillis?.();
    return ms && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  } catch { return null; }
}

export function createTargetInspector(deps: Dependencies) {
  return async (input: unknown, studioId: string): Promise<Record<string, unknown>> => {
    const ids = validationCandidateIds(input);
    if (studioId !== "5330") throw new AppError("PERMISSION_DENIED", "센터 권한을 확인하세요.");
    const results: Record<string, unknown>[] = [];
    for (const candidateId of ids) {
      const checks: Check[] = [];
      const remainingChecks = ["발송 시점 승인 확인", "기존 큐 선점·동시 실행 차단", "업무별 최종 원본·리포트 검증"];
      const result: Record<string, unknown> = { candidateId, status: "review_required", checks, remainingChecks };
      results.push(result);
      try {
        const candidate = await deps.loadCandidate(candidateId);
        // Foreign-studio records are indistinguishable from absent records.
        if (!candidate || candidate.studioId !== studioId) { result.status = "not_found"; continue; }
        result.source = { collection: "alimtalkCandidates", observedAt: sourceTime(candidate.updatedAt),
          freshness: "unknown", liveReadback: false };
        const bound = candidate.candidateId === candidateId && typeof candidate.memberId === "string"
          && /^[A-Za-z0-9_-]{1,160}$/.test(candidate.memberId);
        checks.push({ stage: "canonical_identity", status: bound ? "passed" : "blocked", reasonCode: bound ? "ok" : "source_identity_mismatch" });
        if (!bound) { result.status = "blocked"; continue; }
        const attempt = await deps.loadSend(candidateId);
        const unattempted = ["candidate", "reviewed", "queued"].includes(candidate.status)
          && !attempt && !((candidate.attempts || 0) > 0) && !candidate.sentAt;
        checks.push({ stage: "attempt_ledger", status: unattempted ? "passed" : "blocked",
          reasonCode: unattempted ? "ok" : "existing_attempt_requires_reconciliation" });
        if (!unattempted) { result.status = "blocked"; continue; }
        if (!isHoldingNoticeCandidate(candidate) && (typeof candidate.type !== "string"
          || !Object.hasOwn(ALIMTALK_TEMPLATE_TARGET_RULES, candidate.type))) {
          checks.push({ stage: "eligibility", status: "not_checked", reasonCode: "unsupported_candidate_type" });
          continue;
        }
        for (const [stage, evaluate] of [
          ["eligibility", () => deps.eligibility(candidate, deps.today())],
          ["source", () => deps.source(candidate)],
          ["duplicate", () => deps.duplicate(candidate)],
        ] as const) {
          const issue = await evaluate();
          const unknown = issue.startsWith("템플릿 상태 확인 일시 실패:");
          const reasonCode = unknown ? "template_snapshot_unverified"
            : /스텝|근무.*강사|직원/.test(issue) ? "staff_excluded" : issue ? `${stage}_blocked` : "ok";
          checks.push({ stage, status: unknown ? "not_checked" : issue ? "blocked" : "passed", reasonCode });
          if (issue) { result.status = unknown ? "review_required" : "blocked"; break; }
        }
        if (checks.some(check => check.status !== "passed")) continue;
        const special = isHoldingNoticeCandidate(candidate) || ["membership_welcome", "instructor_lesson_material", "instructor_lesson_confirmation",
          "private_lesson_report", "recommended_meal_report", "inbody_report", "group_survey"].includes(candidate.type);
        if (special) checks.push({ stage: "specialized_final_guard", status: "not_checked", reasonCode: "existing_runtime_readback_required" });
        result.status = special ? "review_required" : "preflight_passed";
      } catch {
        // Provider errors and survey-bearing exception text must never escape inspection.
        checks.push({ stage: "inspection", status: "not_checked", reasonCode: "source_read_failed" });
        result.status = "review_required";
      }
    }
    return { version: TARGET_VALIDATION_VERSION, checkedAt: deps.now().toISOString(),
      readOnly: true, liveReadback: false, allowedForExternalActions: false, results };
  };
}

export const inspectAlimtalkTargets = createTargetInspector({
  loadCandidate: async id => (await db.collection("alimtalkCandidates").doc(id).get()).data() as Candidate | undefined,
  loadSend: async id => (await db.collection("alimtalkSends").doc(id).get()).data(),
  eligibility: (candidate, today) => targetEligibilityIssue(candidate, today, { readOnly: true }),
  source: async candidate => (await privateSurveySendabilityIssue(candidate))
    || (await renewalCandidateSendabilityIssue(candidate))
    || (await longAbsenceCandidateSendabilityIssue(candidate)),
  duplicate: candidate => targetDuplicateIssue(candidate, alimtalkDedupeKey(candidate), alimtalkDedupePolicy(candidate.templateCode).windowDays),
  now: () => new Date(), today: todayKst,
});
