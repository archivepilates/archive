import { db } from "../config/firebase";
import type { AlimtalkCandidateDoc } from "../types/models";
import { todayKst } from "../utils/date";
import {
  alimtalkApprovalId,
  alimtalkApprovalSnapshotKey,
  approvedBatchForCandidate,
  usesAlimtalkBatchApproval,
  type ApprovalBatchSnapshot,
  type AlimtalkApprovalScope,
} from "./approvalPolicy";

export const ALIMTALK_APPROVAL_COLLECTION = "alimtalkSendApprovals";

export function approvalRef(id: string): FirebaseFirestore.DocumentReference {
  return db.collection(ALIMTALK_APPROVAL_COLLECTION).doc(id);
}

export async function readApprovalBatches(
  tx: FirebaseFirestore.Transaction,
  rootId: string,
): Promise<ApprovalBatchSnapshot[]> {
  const root = (await tx.get(approvalRef(rootId))).data() as ApprovalBatchSnapshot | undefined;
  if (!root) return [];
  const batches = [root];
  for (const id of root.deltaApprovalIds || []) {
    if (!id.startsWith(`${rootId}_delta_`)) throw new Error("Invalid approval delta reference");
    const batch = (await tx.get(approvalRef(id))).data() as ApprovalBatchSnapshot | undefined;
    if (
      !batch ||
      batch.approvalId !== id ||
      batch.studioId !== root.studioId ||
      batch.sourceDate !== root.sourceDate ||
      (batch.approvalScope || "daily") !== (root.approvalScope || "daily")
    ) {
      throw new Error("Approval delta missing or mismatched");
    }
    batches.push(batch);
  }
  return batches;
}

export interface AlimtalkApprovalBinding {
  approvalGateId: string;
  approvalSnapshotKey: string;
  approvalGateMode?: "snapshot" | "below_threshold";
}

export function approvalCandidateBinding(candidate: AlimtalkCandidateDoc, today: string): AlimtalkApprovalBinding {
  return {
    approvalGateId: alimtalkApprovalId(candidate.studioId, today, approvalScopeFor(candidate)),
    approvalSnapshotKey: alimtalkApprovalSnapshotKey(candidate),
  };
}

function approvalScopeFor(candidate: AlimtalkCandidateDoc): AlimtalkApprovalScope {
  return candidate.type === "reservation_open" ? "reservation_open" : "daily";
}

/** Read inside the SAME transaction as the queued -> processing claim, before any writes.
 * Empty string permits only the approval dimension; existing source/target guards still apply.
 * Do not cache this decision or bypass it for queuedBy=operator/email approval.
 */
export async function alimtalkApprovalClaimIssue(
  tx: FirebaseFirestore.Transaction,
  candidate: AlimtalkCandidateDoc & Partial<AlimtalkApprovalBinding>,
  today = todayKst(),
): Promise<string> {
  const scope = approvalScopeFor(candidate);
  const binding = candidate.approvalGateId;
  const hasBinding = binding !== undefined || candidate.approvalSnapshotKey !== undefined;
  if (hasBinding && (!binding || !candidate.approvalSnapshotKey)) return "approval_binding_invalid";
  if (!hasBinding && !usesAlimtalkBatchApproval(candidate)) return "";
  // Old queues do not prove which day's approval was checked. Re-review instead
  // of guessing from sourceDate/today, which can miss an intermediate batch.
  if (!hasBinding) return "approval_legacy_binding_required";
  if (binding && candidate.approvalSnapshotKey !== alimtalkApprovalSnapshotKey(candidate)) {
    return "approval_snapshot_changed";
  }
  if (binding) {
    const prefix = `${candidate.studioId}_`;
    const date = binding.slice(prefix.length, prefix.length + 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || binding !== alimtalkApprovalId(candidate.studioId, date, scope)) {
      return "approval_binding_invalid";
    }
  }
  // A fresh below-threshold check remains bound to the exact day and content.
  // A root created later still takes precedence over that earlier small batch.
  const roots = new Set([binding!]);
  for (const rootId of roots) {
    const batches = await readApprovalBatches(tx, rootId);
    if (rootId === binding && !batches.length && candidate.approvalGateMode !== "below_threshold")
      return "approval_snapshot_not_approved";
    if (batches.length && !approvedBatchForCandidate(candidate, batches)) return "approval_snapshot_not_approved";
  }
  return "";
}
