import { createHash } from "node:crypto";
import { AppError } from "../utils/errors";

export const MEMBER_OPERATION_PROGRESS_VERSION = "member-operation-progress-v1";
const operationPattern = /^holding_operator_notice_[a-f0-9]{64}$/;
const policies = ["holding_delivery_memo_v1", "holding_acceptance_memo_v2"];
const collections = ["holdingNoticeEvents", "alimtalkCandidates", "alimtalkSends", "holdingNoticeClaims",
  "memberMemos", "studiomateMemoWriteJobs"] as const;
const stageNames = ["detection", "sourceCheck", "providerAcceptance", "providerDelivery", "memoQueued", "memoSynced"] as const;
type Row = Record<string, any>;
type Stage = { status: "unknown" | "verified" | "pending" | "blocked" | "failed"; at: string | null; reasonCode: string };
export interface MemberOperationInspectorDependencies {
  readDocument(path: string): Promise<Row | undefined>;
  now(): Date;
}

function instant(value: any): string | null {
  try {
    const ms = typeof value === "string" ? Date.parse(value) : value?.toMillis?.();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  } catch { return null; }
}
const observed = (row?: Row) => instant(row?.updatedAt) || instant(row?.createdAt) || instant(row?.registeredAt);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const has = (value: unknown): value is string => typeof value === "string" && value.length > 0;
function validateInput(input: { kind: "holding"; operationId: string }, studioId: string) {
    if (!input || input.kind !== "holding" || typeof input.operationId !== "string" || !operationPattern.test(input.operationId)
      || Object.keys(input).some(key => !["kind", "operationId"].includes(key)))
      throw new AppError("INVALID_ARGUMENT", "Exact holding operation ID required.");
    if (studioId !== "5330") throw new AppError("PERMISSION_DENIED", "Studio permission required.");
}

export function createMemberOperationInspector(deps: MemberOperationInspectorDependencies) {
  return async (input: { kind: "holding"; operationId: string }, studioId: string) => {
    validateInput(input, studioId);
    const operationId = input.operationId, memoId = `holding_notice_memo_${operationId.slice("holding_operator_notice_".length)}`;
    const stages = Object.fromEntries(stageNames.map(name => [name,
      { status: "unknown", at: null, reasonCode: "evidence_missing" }])) as Record<typeof stageNames[number], Stage>;
    const evidence: { collection: string; exists: boolean | null; observedAt: string | null }[] = [];
    const result = { version: MEMBER_OPERATION_PROGRESS_VERSION, kind: "holding" as const, operationId,
      checkedAt: deps.now().toISOString(), readOnly: true, liveReadback: false, allowedForExternalActions: false,
      status: "unknown", policy: null as string | null, stages,
      source: { kind: "canonical_document_snapshot", freshness: "unknown", liveReadback: false, evidence },
      codes: [] as string[], nextAction: "review_source_records" };
    const issue = (code: string) => { if (!result.codes.includes(code)) result.codes.push(code); result.status = "review_required"; };
    const finish = () => ({ ...result, checkedAt: deps.now().toISOString(), status: result.status === "unknown" ? "not_found" : result.status === "complete" ? "completed" : result.status,
      stages: stageNames.map((name, index) => ({ stage: ["detection", "source_check", "provider_acceptance", "provider_delivery", "memo_queued", "memo_synced"][index],
        ...stages[name], status: stages[name].status === "verified" ? "confirmed" : stages[name].status === "blocked" ? "review_required" : stages[name].status })) });
    const set = (name: typeof stageNames[number], status: Stage["status"], at: string | null, reasonCode: string) => {
      if (status === "verified" && !at) issue("timestamp_missing");
      stages[name] = { status: status === "verified" && !at ? "unknown" : status, at,
        reasonCode: status === "verified" && !at ? "timestamp_missing" : reasonCode };
    };
    const rows: (Row | undefined)[] = [];
    // Six fixed document gets only. No caller-supplied path, query, fallback, or provider read.
    for (const [index, collection] of collections.entries()) {
      try {
        const row = await deps.readDocument(`${collection}/${index < 4 ? operationId : memoId}`);
        rows.push(row);
        evidence.push({ collection, exists: Boolean(row), observedAt: observed(row) });
      } catch {
        rows.push(undefined); evidence.push({ collection, exists: null, observedAt: null }); issue("source_read_failed");
      }
    }
    const [event, candidate, send, claim, memo, job] = rows;
    if (rows.some(row => row?.studioId !== undefined && row.studioId !== studioId)) {
      // Do not expose foreign-studio existence or timestamps.
      result.source.evidence = collections.map(collection => ({ collection, exists: null, observedAt: null }));
      issue("source_binding_mismatch"); return finish();
    }
    if (!rows.some(Boolean)) return finish();
    if (!result.codes.length) result.status = "in_progress";
    if ([candidate, send, claim].some(Boolean) && ![candidate, send, claim].every(Boolean)
      || Boolean(memo) !== Boolean(job)) issue("evidence_missing");
    if (event) {
      if (event.id !== operationId || event.canonical !== true || event.source !== "studiomate_live_ticket_readback") {
        issue("source_binding_mismatch"); set("detection", "blocked", observed(event), "source_binding_mismatch"); return finish();
      }
      // This is a stored event/registration time, not an invented discovery time.
      set("detection", "verified", instant(event.createdAt) || instant(event.registeredAt), "canonical_event_recorded");
    }
    if (!candidate || !send || !claim) return finish();
    if (!event && send.payload?.deliveryMode === "automatic_live_readback") issue("evidence_missing");
    if (!memo && !job && send.holdingMemoStatus === "queued") issue("memo_evidence_unverified");
    if (send.status === "failed" || candidate.status === "failed" || ["failed", "reconciliation_required"].includes(claim.status)
      || event?.status === "reconciliation_required") issue("operation_review_required");
    if (send.holdingMemoStatus === "review") issue("memo_evidence_unverified");
    const memberId = send.memberId;
    const bound = send.studioId === studioId && candidate.studioId === studioId && /^[1-9]\d{0,15}$/.test(memberId || "")
      && [event, candidate, claim].filter(Boolean).every(row => row!.memberId === memberId
        && row!.memberPhone === send.memberPhone && row!.issuanceFingerprint === send.issuanceFingerprint
        && row!.creationEvidenceFingerprint === send.creationEvidenceFingerprint)
      && /^01[016789]\d{7,8}$/.test(send.memberPhone || "")
      && /^[a-f0-9]{64}$/.test(send.issuanceFingerprint || "") && /^[a-f0-9]{64}$/.test(send.creationEvidenceFingerprint || "")
      && operationId === `holding_operator_notice_${digest(JSON.stringify([studioId, memberId, send.issuanceFingerprint, send.creationEvidenceFingerprint]))}`
      && send.id === operationId && send.sendId === operationId && send.candidateId === operationId
      && candidate.id === operationId && candidate.candidateId === operationId && claim.candidateId === operationId
      && [event, candidate, claim].filter(Boolean).every(row => row!.sendId === undefined || row!.sendId === operationId)
      && candidate.templateCode === send.templateCode && has(send.templateCode) && candidate.isTest === false && send.isTest === false
      && candidate.calculationMode === "live_studiomate_readback" && send.calculationMode === candidate.calculationMode
      && candidate.payload?.holdingNotice === true && send.payload?.holdingNotice === true
      && candidate.payload?.source === "studiomate_live_ticket_readback" && send.payload?.source === candidate.payload.source
      && ["automatic_live_readback", "operator_verified_one_off"].includes(send.payload?.deliveryMode)
      && candidate.payload?.deliveryMode === send.payload?.deliveryMode
      && JSON.stringify(candidate.payload) === JSON.stringify(send.payload)
      && candidate.variables && typeof candidate.variables === "object" && !Array.isArray(candidate.variables)
      && candidate.summary && typeof candidate.summary === "object" && !Array.isArray(candidate.summary)
      && send.attempts === 1 && send.maxAttempts === 1
      && [candidate, send].every(row => (row.payload?.holdingEventId === undefined || row.payload.holdingEventId === operationId)
        && (row.holdingNoticeId === undefined || row.holdingNoticeId === operationId))
      && (!event || send.payload?.deliveryMode !== "automatic_live_readback" || has(event.policyId)
        && candidate.payload?.policyId === event.policyId && send.payload?.policyId === event.policyId)
      && candidate.memberName === send.memberName && has(send.memberName)
      && has(send.message) && candidate.message === send.message
      && JSON.stringify(candidate.variables) === JSON.stringify(send.variables)
      && JSON.stringify(candidate.summary) === JSON.stringify(send.summary);
    if (!bound) { issue("source_binding_mismatch"); set("sourceCheck", "blocked", null, "source_binding_mismatch"); return finish(); }
    if (!policies.includes(send.holdingMemoPolicy) || [candidate, claim, event].filter(Boolean).some(row =>
      row!.holdingMemoPolicy !== undefined && row!.holdingMemoPolicy !== send.holdingMemoPolicy)) {
      issue("policy_mismatch"); set("sourceCheck", "blocked", null, "policy_mismatch"); return finish();
    }
    result.policy = send.holdingMemoPolicy;
    set("sourceCheck", "verified", instant(send.observedAt), "source_links_verified");
    const messageId = send.solapiMessageId;
    if ([candidate, claim].some(row => row.solapiMessageId !== undefined && row.solapiMessageId !== messageId)
      || (send.holdingMemoAcceptedMessageId !== undefined && send.holdingMemoAcceptedMessageId !== messageId)
      || (send.holdingMemoId !== undefined && send.holdingMemoId !== memoId)) {
      issue("message_link_mismatch"); return finish();
    }
    const receiptBound = has(messageId) && claim.solapiMessageId === messageId;
    const delivered = receiptBound && send.status === "done" && candidate.status === "sent"
      && send.providerStatus === "COMPLETE" && String(send.providerStatusCode) === "4000" && claim.status === "delivered";
    const acceptanceFingerprint = digest(JSON.stringify([send.id, memberId, send.memberPhone, send.templateCode, send.message,
      Object.entries(send.variables).sort(([a], [b]) => a.localeCompare(b)), send.issuanceFingerprint, send.creationEvidenceFingerprint, messageId]));
    const acceptedMarker = result.policy === policies[1] && receiptBound && Boolean(instant(send.holdingMemoAcceptedAt))
      && instant(send.holdingMemoAcceptedAt) === instant(claim.holdingMemoAcceptedAt)
      && send.holdingMemoAcceptedMessageId === messageId && claim.holdingMemoAcceptedMessageId === messageId
      && send.holdingMemoAcceptanceEvidence === "verified_provider_receipt" && claim.holdingMemoAcceptanceEvidence === "verified_provider_receipt"
      && send.holdingMemoAcceptanceFingerprint === acceptanceFingerprint && claim.holdingMemoAcceptanceFingerprint === acceptanceFingerprint;
    const accepted = result.policy === policies[1] ? acceptedMarker : delivered || receiptBound && candidate.status === "sent" && send.status === "done"
      && send.providerOutcome === "accepted_verified" && ["accepted", "delivered"].includes(claim.status);
    if (result.policy === policies[1] && !acceptedMarker && (send.holdingMemoAcceptedAt !== undefined || memo || job)) issue("acceptance_marker_unverified");
    const acceptedAt = instant(send.holdingMemoAcceptedAt) || instant(send.acceptedAt) || instant(candidate.sentAt) || observed(send);
    const acceptanceConfirmed = accepted && stages.sourceCheck.status === "verified";
    set("providerAcceptance", acceptanceConfirmed ? "verified" : "unknown", acceptanceConfirmed ? acceptedAt : null,
      acceptanceConfirmed ? "acceptance_verified" : "acceptance_unverified");
    const deliveryFailed = receiptBound && (send.providerStatus === "FAILED" || send.providerOutcome === "delivery_failed"
      || claim.status === "failed" || send.providerStatus === "COMPLETE" && /^\d{4}$/.test(String(send.providerStatusCode))
        && String(send.providerStatusCode) !== "4000");
    const deliveryConfirmed = delivered && stages.providerAcceptance.status === "verified";
    set("providerDelivery", deliveryConfirmed ? "verified" : deliveryFailed ? "failed" : accepted ? "pending" : "unknown",
      delivered || deliveryFailed ? instant(send.deliveredAt) || instant(send.providerCheckedAt) || observed(send) : null,
      deliveryConfirmed ? "delivery_complete_4000" : deliveryFailed ? "delivery_failed" : "delivery_unconfirmed");
    if (deliveryFailed) issue("delivery_failed");
    if (memo || job) {
      const expectedSource = "holding_notice_delivery";
      const memoBound = memo && job && memo.memoId === memoId && job.jobId === memoId
        && [memo, job].every(row => row.studioId === studioId && row.memberId === memberId
          && row.holdingNoticeId === operationId && row.solapiMessageId === messageId && row.source === expectedSource
          && row.holdingMemoPolicy === result.policy && row.memberName === send.memberName)
        && job.memberPhone === send.memberPhone && job.studiomateMemberId === memberId && !job.profileUpdate && !job.registrationId
        && has(memo.content) && memo.content === job.content && /^[a-f0-9]{64}$/.test(memo.contentHash || "")
        && memo.contentHash === job.contentHash && digest(memo.content) === memo.contentHash;
      if (!memoBound) { issue("memo_link_mismatch"); set("memoQueued", "blocked", null, "memo_link_mismatch"); return finish(); }
      // Acceptance audit is durable even when later delivery reconciliation fails.
      const memoEligible = result.policy === policies[0] ? delivered : acceptedMarker;
      if (!memoEligible || stages.providerAcceptance.status !== "verified" || send.holdingMemoStatus !== "queued" || send.holdingMemoId !== memoId) {
        issue("memo_evidence_unverified"); return finish();
      }
      set("memoQueued", "verified", instant(send.holdingMemoQueuedAt) || instant(job.createdAt), "memo_queue_recorded");
      const synced = stages.memoQueued.status === "verified" && job.status === "done" && memo.syncStatus === "synced" && instant(job.writtenAt) && instant(memo.syncedAt);
      const failed = job.status === "failed" || memo.syncStatus === "failed";
      set("memoSynced", synced ? "verified" : failed ? "failed" : ["pending", "retry", "processing"].includes(job.status)
        && ["pending", "retry"].includes(memo.syncStatus) ? "pending" : "unknown",
      synced ? instant(memo.syncedAt) : observed(job), synced ? "memo_synced" : failed ? "memo_sync_failed" : "memo_sync_unconfirmed");
      if (failed) issue("memo_sync_failed");
    }
    if (result.codes.length) result.status = "review_required";
    else if (stageNames.every(name => stages[name].status === "verified")) result.status = "complete";
    else result.status = "in_progress";
    result.nextAction = result.status === "complete" ? "none" : result.status === "review_required" ? "review_source_records"
      : stages.providerAcceptance.status !== "verified" ? "review_acceptance" : stages.providerDelivery.status !== "verified"
        ? "check_delivery_record" : stages.memoQueued.status !== "verified" ? "check_memo_queue" : "check_memo_sync";
    return finish();
  };
}

export async function inspectMemberOperationProgress(input: { kind: "holding"; operationId: string }, studioId: string) {
  // Lazy import keeps synthetic dependency-injected inspection free of credentials and initialization.
  validateInput(input, studioId);
  const { db } = await import("../config/firebase");
  return db.runTransaction(async transaction => createMemberOperationInspector({
    readDocument: async path => (await transaction.get(db.doc(path))).data(), now: () => new Date(),
  })(input, studioId), { readOnly: true });
}
