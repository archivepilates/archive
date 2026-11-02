import { randomUUID } from "node:crypto";
import type { PrivateLessonChartRecordDoc, PrivateLessonChartRequestDoc } from "../types/models";
import { stableHash } from "../utils/hash";

export const PRIVATE_NOTION_DEBOUNCE_MS = 5_000;
// Longer than the event handler's maximum lifetime, including provider timeouts.
export const PRIVATE_NOTION_LEASE_MS = 600_000;

export type PrivateNotionState = NonNullable<PrivateLessonChartRecordDoc["notionSync"]> & {
  leaseToken?: string;
  leaseUntilMs?: number;
  attemptedVersion?: string;
  attemptedAt?: string;
  targetVersion?: string;
  creationTitle?: string;
  pendingAt?: string;
  failedAt?: string;
  deferredReason?: "awaiting_submission" | "";
  deferredVersion?: string;
};

export class PrivateNotionAwaitingSubmission extends Error {
  constructor() { super("Notion member folder awaits lesson submission"); }
}

export function privateNotionHasSubmittedContent(record: any, request?: any): boolean {
  if (!record) return false;
  return Boolean(record.preSubmittedAt || record.postSubmittedAt || request?.preStatus === "submitted" ||
    request?.postStatus === "submitted" || [record.prePlan, record.postRecord, record.preAnswers, record.postAnswers]
      .some((answers) => answers && (typeof answers !== "object" || Object.keys(answers).length > 0)));
}

export function privateNotionCanAwaitSubmission(record: any, request?: any): boolean {
  if (!record) return false;
  const sync = record.notionSync;
  return record.gptStatus === "waiting_post" && !privateNotionHasSubmittedContent(record, request) &&
    !record.cancelledAt && request?.status !== "cancelled" && !record.notionProjectionControl?.aliasOfRecordId &&
    !record.notionProjectionControl?.memberPageId && !sync?.instructorPageId && !sync?.pageId && !sync?.creationTitle;
}

export function privateNotionDeferredVersion(record: any, request: any): string {
  const source = (doc: any) => {
    const { notionSync, notionProjectionLease, updatedAt, ...fields } = doc;
    return fields;
  };
  // Include identity/source changes that do not alter the rendered Notion page.
  return stableHash({ record: source(record), request: source(request) });
}

export interface PrivateNotionSource {
  record: PrivateLessonChartRecordDoc;
  request?: PrivateLessonChartRequestDoc;
  control?: { aliasOfRecordId?: string; reviewReason?: string };
}

export function assertPrivateNotionPageOwner(recordId: string, ownerId: string, peers: string[]): void {
  if ((ownerId && ownerId !== recordId) || (!ownerId && peers.some((id) => id !== recordId))) {
    throw new Error("Notion 페이지 공유 연결 확인 필요: 다른 차트의 덮어쓰기를 차단했습니다.");
  }
}

export interface PrivateNotionStore {
  transact<T>(id: string, update: (source: PrivateNotionSource | null) => {
    state?: PrivateNotionState;
    result: T;
  }): Promise<T>;
}

export const PRIVATE_NOTION_REPAIR_LANES = ["pending", "failed", "all"] as const;
export type PrivateNotionRepairLane = typeof PRIVATE_NOTION_REPAIR_LANES[number];
export interface PrivateNotionRepairCursor {
  nextLane: number;
  cursors: Partial<Record<PrivateNotionRepairLane, string>>;
}

export async function reconcilePrivateNotionPages(deps: {
  cursor: PrivateNotionRepairCursor;
  list: (lane: PrivateNotionRepairLane, after: string) => Promise<string[]>;
  save: (cursor: PrivateNotionRepairCursor) => Promise<void>;
  process: (id: string) => Promise<void>;
  now?: () => number;
  budgetMs?: number;
  maxRecords?: number;
}): Promise<void> {
  const now = deps.now || Date.now;
  const deadline = now() + (deps.budgetMs ?? 450_000);
  const progress: PrivateNotionRepairCursor = {
    nextLane: Math.max(0, Math.trunc(Number(deps.cursor.nextLane) || 0)) % 3,
    cursors: { ...deps.cursor.cursors },
  };
  const done = new Set<PrivateNotionRepairLane>();
  const buffers = new Map<PrivateNotionRepairLane, string[]>();
  const seen = new Set<string>();
  while (now() < deadline && done.size < 3 && seen.size < (deps.maxRecords ?? 300)) {
    const lane = PRIVATE_NOTION_REPAIR_LANES[progress.nextLane];
    progress.nextLane = (progress.nextLane + 1) % 3;
    if (done.has(lane)) continue;
    let buffer = buffers.get(lane);
    if (!buffer?.length) {
      buffer = await deps.list(lane, progress.cursors[lane] || "");
      buffers.set(lane, buffer);
    }
    const id = buffer.shift();
    progress.cursors[lane] = id || "";
    // Advance before external work so a slow/failed item cannot starve the tail.
    await deps.save({ ...progress, cursors: { ...progress.cursors } });
    if (!id) { done.add(lane); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    await deps.process(id);
  }
}

export function privateNotionSourceChanged(before: any, after: any): boolean {
  if (!after) return false;
  if (!before) return true;
  const source = (doc: any) => {
    const { notionSync, notionProjectionLease, updatedAt, ...fields } = doc;
    return fields;
  };
  if (stableHash(source(before)) !== stableHash(source(after))) return true;
  // A completed stale write wakes one more pass; lease/ack writes never loop.
  const beforeToken = before.notionProjectionLease?.token || before.notionSync?.leaseToken;
  const afterToken = after.notionProjectionLease?.token || after.notionSync?.leaseToken;
  if (after.notionSync?.deferredReason === "awaiting_submission" && !after.notionSync.error &&
    privateNotionCanAwaitSubmission(after)) return false;
  return after.notionSync?.status === "pending" && !afterToken &&
    (Boolean(beforeToken) || before.notionSync?.status === "failed");
}

export async function runPrivateNotionProjection(id: string, deps: {
  store: PrivateNotionStore;
  version: (source: PrivateNotionSource) => string;
  project: (source: PrivateNotionSource, checkpoint: (page: Partial<PrivateNotionState>) => Promise<void>) => Promise<PrivateNotionState>;
  now?: () => number;
  retryFailures?: boolean;
}): Promise<"synced" | "failed" | "pending" | "skipped"> {
  const now = deps.now || Date.now;
  const token = randomUUID();
  const claimed = await deps.store.transact<PrivateNotionSource | null>(id, (source) => {
    if (!source || source.control?.aliasOfRecordId) return { result: null };
    const state: PrivateNotionState = source.record.notionSync || { status: "pending" };
    if ((state.leaseUntilMs || 0) > now()) return { result: null };
    if (!source.request) return {
      state: { ...state, status: "failed", error: "차트 요청 없음", failedAt: new Date(now()).toISOString(),
        deferredReason: "", deferredVersion: "", leaseToken: "", leaseUntilMs: 0 },
      result: null,
    };
    const version = deps.version(source);
    if (!state.leaseToken && state.status === "pending" && state.deferredReason === "awaiting_submission" &&
      !state.error && state.deferredVersion === privateNotionDeferredVersion(source.record, source.request) &&
      privateNotionCanAwaitSubmission(source.record, source.request)) {
      return { result: null };
    }
    if (!state.leaseToken && state.status !== "failed" && state.sourceVersion === version) return {
      state: state.status === "pending" ? { ...state, status: "synced", error: "" } : undefined,
      result: null,
    };
    if (!deps.retryFailures && state.status === "failed" && state.attemptedVersion === version) return { result: null };
    const next: PrivateNotionState = {
      ...state, status: "pending", error: "", targetVersion: version,
      deferredReason: "", deferredVersion: "",
      attemptedVersion: version, attemptedAt: new Date(now()).toISOString(),
      leaseToken: token, leaseUntilMs: now() + PRIVATE_NOTION_LEASE_MS,
    };
    return { state: next, result: { ...source, record: { ...source.record, notionSync: next } } };
  });
  if (!claimed) return "skipped";
  const version = deps.version(claimed);
  const checkpoint = async (page: Partial<PrivateNotionState>) => {
    await deps.store.transact(id, (current) => {
      const state = current?.record.notionSync as PrivateNotionState | undefined;
      if (current?.control?.aliasOfRecordId || !state || state.leaseToken !== token || (state.leaseUntilMs || 0) <= now()) {
        throw new Error("Notion projection lease lost");
      }
      return { state: { ...state, ...page }, result: undefined };
    });
  };
  let projected: PrivateNotionState;
  try {
    projected = await deps.project(claimed, checkpoint);
  } catch (err) {
    projected = err instanceof PrivateNotionAwaitingSubmission
      ? { status: "pending", deferredReason: "awaiting_submission", error: "" }
      : { status: "failed", error: err instanceof Error ? err.message : String(err), failedAt: new Date(now()).toISOString() };
  }
  return deps.store.transact(id, (current) => {
    const state = current?.record.notionSync as PrivateNotionState | undefined;
    if (!current || current.control?.aliasOfRecordId || !state || state.leaseToken !== token || (state.leaseUntilMs || 0) <= now()) return { result: "skipped" as const };
    const currentVersion = current.request ? deps.version(current) : "";
    const changed = Boolean(currentVersion && currentVersion !== version);
    const status = changed ? "pending" : current.request ? projected.status : "failed";
    const deferred = status === "pending" && !changed && projected.deferredReason === "awaiting_submission" &&
      current.request && privateNotionDeferredVersion(current.record, current.request) ===
        privateNotionDeferredVersion(claimed.record, claimed.request) &&
      privateNotionCanAwaitSubmission(current.record, current.request);
    return {
      state: {
        ...state, ...projected, status,
        sourceVersion: projected.status === "synced" ? version : "",
        targetVersion: currentVersion,
        deferredReason: deferred ? "awaiting_submission" : "",
        deferredVersion: deferred ? privateNotionDeferredVersion(current.record, current.request) : "",
        ...(status === "failed" ? { failedAt: projected.failedAt || new Date(now()).toISOString() } : {}),
        error: changed ? "" : current.request ? projected.error || "" : "차트 요청 없음",
        leaseToken: "", leaseUntilMs: 0,
      },
      result: status,
    };
  });
}
