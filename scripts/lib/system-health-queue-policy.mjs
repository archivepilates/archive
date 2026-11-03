import { memberDispatchActiveElapsedMs } from "./member-dispatch-window.mjs";

export function healthTimestampMs(value) {
  if (value === null || value === undefined || value === "") return null;
  let ms;
  try {
    if (typeof value?.toMillis === "function") ms = value.toMillis();
    else if (typeof value?.toDate === "function") ms = value.toDate().getTime();
    else if (value instanceof Date) ms = value.getTime();
    else if (typeof value === "number") ms = value;
    else if (typeof value === "string") ms = Date.parse(value);
    else if (Number.isFinite(value?.seconds)) ms = value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
  } catch { return null; }
  return Number.isFinite(ms) ? ms : null;
}

export function isExplicitlyRetired(data) {
  return healthTimestampMs(data?.retiredAt) !== null && Boolean(String(data?.retirementReason || "").trim());
}

export function classifyQueueDocument(data, {
  nowMs = Date.now(), staleMinutes = 30, staleStatuses = ["processing", "running"],
  failureStatuses = ["failed", "error"], worker, memberFacing = false,
} = {}) {
  const status = String(data?.status || "");
  if (isExplicitlyRetired(data)) return { state: "retired", needsAttention: false };
  if (failureStatuses.includes(status)) return { state: "failed", needsAttention: true };
  const waiting = ["pending", "retry"].includes(status);
  if (!waiting && !staleStatuses.includes(status)) return { state: "inactive", needsAttention: false };
  const value = waiting
    ? data.nextRunAt ?? data.createdAt
    : data.updatedAt ?? data.startedAt ?? data.createdAt;
  const time = healthTimestampMs(value);
  if (time === null) return { state: "timestamp_unavailable", needsAttention: true };
  let ageMinutes = (nowMs - time) / 60000;
  if (waiting && ageMinutes < 0) return { state: "future_due", ageMinutes, needsAttention: false };
  if (memberFacing && waiting && !data.sendClickedAt && !data.externalEffectStarted && Number(data.attempts || 0) === 0)
    ageMinutes = memberDispatchActiveElapsedMs(time, nowMs) / 60000;
  if (ageMinutes <= staleMinutes) return { state: "within_grace", ageMinutes, needsAttention: false };
  const workerState = worker?.state || "";
  return {
    state: waiting ? "overdue_waiting" : "stuck_processing", ageMinutes, needsAttention: true,
    workerState,
    reason: workerState === "intentionally_retired" ? "retired_worker_backlog"
      : workerState && workerState !== "enabled" ? "worker_unavailable" : "overdue",
  };
}

export function canAutoRetryQueueDocument(collection, data, options = {}) {
  // Retired intake and legacy API writes must never be revived, even in repair mode.
  if (collection === "writeQueue" || collection === "onsiteWelcomeRequests" || isExplicitlyRetired(data)) return false;
  if (options.worker && options.worker.state !== "enabled") return false;
  return classifyQueueDocument(data, options).state === "stuck_processing";
}

export function classifyNotionDocument(data, { nowMs = Date.now(), staleMinutes = 60 } = {}) {
  if (data?.notionProjectionControl?.aliasOfRecordId) return { state: "alias", needsAttention: false };
  const sync = data?.notionSync;
  // Request.status describes lesson workflow, never the Notion projection queue.
  if (!["pending", "failed"].includes(sync?.status)) return { state: "inactive", needsAttention: false };
  if (data.surveyType === "group") return { state: "not_applicable", needsAttention: false };
  const hasAnswers = [data.prePlan, data.postRecord, data.preAnswers, data.postAnswers]
    .some((answers) => answers && (typeof answers !== "object" || Object.keys(answers).length > 0));
  if (sync.status === "pending" && sync.deferredReason === "cancelled_without_submission" &&
    sync.deferredVersion && !sync.error && data.cancelledAt && data.gptStatus === "waiting_post" &&
    ![data.gptTaskId, data.gptSourceHash, data.gptDraftSummary, data.gptDraftNextDirection,
      data.publicSummary, data.publicNextDirection, data.publicReportUrl, data.publicReportCanonicalUrl,
      data.media, data.publicReportApproval, data.approvedReportSnapshot, data.sentReportSnapshot,
      data.legacySentReportSnapshot, data.manualReportEdit].some(Boolean) &&
    !data.preSubmittedAt && !data.postSubmittedAt && !hasAnswers && !data.notionPageId && !data.notionPageUrl &&
    !data.notionProjectionControl?.memberPageId && !sync.instructorPageId && !sync.instructorPageUrl &&
    !sync.pageId && !sync.pageUrl && !sync.creationTitle && !sync.syncedAt && !sync.sourceVersion &&
    !data.notionProjectionLease?.token && !sync.leaseToken) {
    return { state: "cancelled_without_submission", syncStatus: sync.status, needsAttention: false };
  }
  if (sync.status === "pending" && sync.deferredReason === "awaiting_submission" && !sync.error &&
    data.gptStatus === "waiting_post" && !data.preSubmittedAt && !data.postSubmittedAt && !hasAnswers &&
    !data.cancelledAt && !data.notionProjectionControl?.memberPageId && !sync.instructorPageId && !sync.pageId &&
    !sync.creationTitle && !data.notionProjectionLease?.token && !sync.leaseToken) {
    return { state: "awaiting_submission", syncStatus: sync.status, needsAttention: false };
  }
  const timestamps = sync.status === "failed"
    ? [sync.failedAt, sync.attemptedAt, sync.updatedAt, data.updatedAt, data.createdAt]
    : [sync.pendingAt, sync.attemptedAt, sync.updatedAt, data.updatedAt, data.createdAt];
  const time = timestamps.map(healthTimestampMs).find((value) => value !== null && value <= nowMs);
  if (time === undefined) return { state: "timestamp_unavailable", syncStatus: sync.status, needsAttention: true };
  const ageMinutes = (nowMs - time) / 60000;
  return { state: ageMinutes > staleMinutes ? `overdue_${sync.status}` : "within_grace", syncStatus: sync.status,
    ageMinutes, needsAttention: ageMinutes > staleMinutes };
}

export function queryCoverage({ size = 0, limit, error = null } = {}) {
  const capped = size >= limit;
  return { complete: !error && !capped, capped, unavailable: Boolean(error), countIsLowerBound: Boolean(error) || capped };
}

export function recentQueueFailure(data, { nowMs = Date.now(), recentMinutes = 7 * 24 * 60 } = {}) {
  if (isExplicitlyRetired(data)) return false;
  // updatedAt is the queue writers' state-change timestamp and the indexed query field.
  const time = [data.updatedAt, data.failedAt, data.completedAt, data.processedAt, data.sentAt, data.createdAt, data.requestedAt]
    .map(healthTimestampMs).find((value) => value !== null);
  return time === undefined || (time <= nowMs && time >= nowMs - recentMinutes * 60000);
}

export async function loadRecentQueueFailures(db, collection, statuses, {
  nowMs = Date.now(), recentMinutes = 7 * 24 * 60, limit = 50,
} = {}) {
  const rows = new Map();
  const queries = [];
  for (const kind of ["recent", "unknown_timestamp_fallback"]) {
    try {
      let query = db.collection(collection).where("status", "in", statuses);
      if (kind === "recent") query = query
        .where("updatedAt", ">=", new Date(nowMs - recentMinutes * 60000))
        .where("updatedAt", "<=", new Date(nowMs)).orderBy("updatedAt", "desc");
      const snap = await query.limit(limit).get();
      queries.push({ kind, size: snap.size, ...queryCoverage({ size: snap.size, limit }) });
      for (const doc of snap.docs) {
        const data = doc.data();
        // The fallback is bounded and cannot prove absence beyond its cap.
        if (kind === "recent" || recentQueueFailure(data, { nowMs, recentMinutes })) rows.set(doc.id, { id: doc.id, data, status: data.status });
      }
    } catch (error) {
      queries.push({ kind, ...queryCoverage({ limit, error }), errorCode: String(error?.code || "unknown") });
    }
  }
  const complete = queries.every((query) => query.complete);
  return {
    docs: [...rows.values()].filter((doc) => recentQueueFailure(doc.data, { nowMs, recentMinutes })),
    coverage: { complete, countIsLowerBound: !complete, timestampField: "updatedAt", limitPerQuery: limit, queries },
  };
}
