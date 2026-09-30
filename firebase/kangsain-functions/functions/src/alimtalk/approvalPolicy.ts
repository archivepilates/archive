import { createHash } from "node:crypto";
import type { AlimtalkCandidateDoc } from "../types/models";
import { normalizeRecipientPhone } from "./testRecipients";

export type AlimtalkApprovalScope = "daily" | "reservation_open";

// Instructor samples, reports, meal flows and contract welcomes have independent approvals.
const BATCH_TYPES = new Set([
  "new_member",
  "private_survey",
  "group_survey",
  "ticket_expiring",
  "remaining_low",
  "private_count_low",
  "private_ticket_expiring",
  "long_absence",
  "reservation_open",
]);

export function usesAlimtalkBatchApproval(candidate: AlimtalkCandidateDoc): boolean {
  return BATCH_TYPES.has(candidate.type);
}

export interface ApprovalTargetSnapshot {
  candidateId: string;
  snapshotKey: string;
  status?: "included" | "excluded" | "cancelled";
}

export interface ApprovalBatchSnapshot {
  approvalId: string;
  studioId: string;
  sourceDate: string;
  approvalScope?: AlimtalkApprovalScope;
  status: string;
  snapshotVersion?: number;
  targets?: ApprovalTargetSnapshot[];
  deltaApprovalIds?: string[];
}

export function alimtalkApprovalId(studioId: string, date: string, scope: AlimtalkApprovalScope = "daily"): string {
  return scope === "daily" ? `${studioId}_${date}` : `${studioId}_${date}_${scope}`;
}

// Only lifecycle metadata and the generated candidate ID are omitted. Unknown payload
// fields stay bound too, so new send variables cannot accidentally inherit approval.
export function alimtalkApprovalSnapshotKey(candidate: AlimtalkCandidateDoc): string {
  const snapshot = {
    studioId: candidate.studioId,
    memberId: String(candidate.memberId || "").trim(),
    memberPhone: normalizeRecipientPhone(candidate.memberPhone),
    memberName: candidate.memberName,
    type: candidate.type,
    templateCode: candidate.templateCode,
    sourceDate: candidate.sourceDate,
    sourceActionKey: candidate.sourceActionKey || "",
    payload: Object.fromEntries(
      Object.entries(candidate.payload || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function approvalTargetBlocked(candidate: AlimtalkCandidateDoc, batches: ApprovalBatchSnapshot[]): boolean {
  const key = alimtalkApprovalSnapshotKey(candidate);
  return batches.some((batch) =>
    batch.targets?.some(
      (target) =>
        (target.snapshotKey === key || target.candidateId === candidate.candidateId) &&
        (target.status === "excluded" || target.status === "cancelled"),
    ),
  );
}

export function approvedBatchForCandidate(
  candidate: AlimtalkCandidateDoc,
  batches: ApprovalBatchSnapshot[],
): ApprovalBatchSnapshot | undefined {
  if (approvalTargetBlocked(candidate, batches)) return undefined;
  const key = alimtalkApprovalSnapshotKey(candidate);
  return batches.find(
    (batch) =>
      batch.snapshotVersion === 1 &&
      batch.status === "approved" &&
      batch.studioId === candidate.studioId &&
      (batch.approvalScope || "daily") === (candidate.type === "reservation_open" ? "reservation_open" : "daily") &&
      batch.targets?.some((target) => target.snapshotKey === key && target.candidateId === candidate.candidateId),
  );
}

export function partitionApprovalCandidates(
  candidates: AlimtalkCandidateDoc[],
  batches: ApprovalBatchSnapshot[],
): { allowed: AlimtalkCandidateDoc[]; pending: AlimtalkCandidateDoc[]; additions: AlimtalkCandidateDoc[] } {
  const knownKeys = new Set(
    batches
      .filter((batch) => batch.snapshotVersion === 1)
      .flatMap((batch) => (batch.targets || []).map((target) => target.snapshotKey)),
  );
  const result = {
    allowed: [] as AlimtalkCandidateDoc[],
    pending: [] as AlimtalkCandidateDoc[],
    additions: [] as AlimtalkCandidateDoc[],
  };
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = alimtalkApprovalSnapshotKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    if (approvedBatchForCandidate(candidate, batches)) result.allowed.push(candidate);
    else if (knownKeys.has(key) || approvalTargetBlocked(candidate, batches)) result.pending.push(candidate);
    else result.additions.push(candidate);
  }
  return result;
}

export function approvalDeltaId(rootId: string, candidates: AlimtalkCandidateDoc[]): string {
  const keys = [...new Set(candidates.map(alimtalkApprovalSnapshotKey))].sort();
  return `${rootId}_delta_${createHash("sha256").update(JSON.stringify(keys)).digest("hex")}`;
}
