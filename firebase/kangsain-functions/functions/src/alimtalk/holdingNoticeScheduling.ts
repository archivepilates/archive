import { isHoldingNoticeCandidate } from "./holdingNoticeQueue";
import { auditedNonWelcomeTemplates } from "../memberSignup/membershipWelcomeProvider";
import { HOLDING_TEMPLATE } from "./holdingNoticeProvider";

export function holdingWelcomeInteropIssue(config: Record<string, any> | undefined) {
  const allowed = auditedNonWelcomeTemplates(config?.providerHistoryCoverage?.nonWelcomeTemplateAllowlist);
  return allowed?.has(HOLDING_TEMPLATE.templateId) ? "" : "holding_welcome_provider_allowlist_audit_required";
}

export function holdingRecoveryPatch(candidate: Record<string, any>, now: number, hasClaim: boolean, hasSend: boolean) {
  const updated = candidate.updatedAt?.toMillis?.();
  if (!isHoldingNoticeCandidate(candidate) || candidate.status !== "processing" ||
    !Number.isFinite(now) || !Number.isFinite(updated) || now - updated < 10 * 60_000) return null;
  if (hasClaim || hasSend || candidate.attempts !== 0) return { status: "failed", maxAttempts: 1,
    reasonCode: "holding_reconciliation_required", lastError: "홀딩 발송 중단 · 원장 대조 필요 · 재발송 금지" };
  return { status: "reviewed", queuedBy: null, holdingApprovalSnapshot: null, reviewedByUid: null, reviewedAt: null,
    reasonCode: "holding_interrupted_before_dispatch_review_required" };
}

export function holdingReadyScopeIssue(value: unknown): string {
  return !Array.isArray(value) || !value.length || value.length > 1000 ||
    value.some(id => typeof id !== "string" || !id || id.includes("/")) || new Set(value).size !== value.length
    ? "holding_event_scope_invalid" : "";
}

export function holdingReadyBatch(holds: string[], progress: any, version: string) {
  const completed = progress?.sourceVersion === version && Array.isArray(progress.completedHoldIds)
    ? new Set(progress.completedHoldIds.filter((id: unknown) => holds.includes(id as string))) : new Set<string>();
  return holds.filter(id => !completed.has(id)).slice(0, 10);
}

export function holdingQueueOutcomeTerminal(outcome: { status: string; reason: string }) {
  return outcome.status !== "blocked" || outcome.reason === "holding_prior_send_or_claim";
}
