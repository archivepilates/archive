import { logger } from "firebase-functions";
import type { CallableRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import type { StaffDoc } from "../types/models";
import { AppError } from "../utils/errors";
import {
  INSTAGRAM_ACCOUNT_HANDLE,
  composeInstagramCaption,
  normalizeSocialDraftInput,
  socialContentHash,
  socialPublishIdempotencyKey,
  type InstagramPublishContent,
  type SocialContentPillar,
  type SocialContentType,
  type SocialMediaInput,
} from "./socialContracts";
import {
  createInstagramContainer,
  getInstagramConnectionStatus,
  getInstagramMediaMetrics,
  isExpectedInstagramAccount,
  publishInstagramContainer,
  type InstagramConnectionStatus,
} from "./metaInstagramClient";

type SocialContentStatus =
  | "draft"
  | "review"
  | "queued"
  | "publishing"
  | "published"
  | "held"
  | "failed"
  | "cancelled";
type SocialPublishJobStatus =
  | "pending"
  | "processing"
  | "retry"
  | "done"
  | "failed"
  | "manual_review"
  | "blocked_config"
  | "cancelled";

interface SocialContentDoc {
  schemaVersion: 1;
  contentId: string;
  studioId: string;
  channel: "instagram";
  accountHandle: string;
  contentType: SocialContentType;
  pillar: SocialContentPillar;
  caption: string;
  media: SocialMediaInput[];
  location: string;
  cta: string;
  publishAt: Timestamp;
  contentHash: string;
  idempotencyKey: string;
  status: SocialContentStatus;
  createdByUid: string;
  createdByName: string;
  reviewRequestedAt: Timestamp | null;
  approvedByUid: string;
  approvedByName: string;
  approvedAt: Timestamp | null;
  heldByUid: string;
  heldAt: Timestamp | null;
  holdReason: string;
  externalMediaId: string;
  permalink: string;
  publishedAt: Timestamp | null;
  lastError: string;
  metrics?: Record<string, unknown>;
  metricsUpdatedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface SocialPublishJobDoc {
  jobId: string;
  contentId: string;
  studioId: string;
  channel: "instagram";
  accountHandle: string;
  idempotencyKey: string;
  contentHash: string;
  status: SocialPublishJobStatus;
  stage: "pending" | "container_created" | "publish_requested" | "published";
  attempts: number;
  maxAttempts: number;
  nextRunAt: Timestamp;
  creationId: string;
  childCreationIds: string[];
  externalMediaId: string;
  permalink: string;
  lastError: string;
  createdByUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

const contentCollection = db.collection("socialContentDrafts");
const jobCollection = db.collection("socialPublishJobs");
const logCollection = db.collection("socialPublishLogs");
const insightCollection = db.collection("socialInsightsSnapshots");

export async function getInstagramContentDashboardHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const limit = clamp(Number(request.data?.limit || 100), 20, 200);
  const studioId = staff.studioId || DEFAULT_STUDIO_ID;
  const [contentSnapshot, jobSnapshot, logSnapshot, connection] = await Promise.all([
    contentCollection.where("studioId", "==", studioId).limit(limit).get(),
    jobCollection.where("studioId", "==", studioId).limit(50).get(),
    logCollection.where("studioId", "==", studioId).limit(30).get(),
    getInstagramConnectionStatus({ verify: Boolean(request.data?.verifyConnection) }).catch((error) => ({
      configured: false,
      accountHandle: INSTAGRAM_ACCOUNT_HANDLE,
      graphApiVersion: process.env.META_GRAPH_API_VERSION || "v25.0",
      message: safeError(error),
    })),
  ]);

  const items = contentSnapshot.docs
    .map((snapshot) => publicContent(snapshot.data() as SocialContentDoc))
    .sort((a, b) => timestampMillis(b.updatedAt) - timestampMillis(a.updatedAt));
  const jobs = jobSnapshot.docs
    .map((snapshot) => publicJob(snapshot.data() as SocialPublishJobDoc))
    .sort((a, b) => timestampMillis(b.updatedAt) - timestampMillis(a.updatedAt));
  const logs = logSnapshot.docs
    .map((snapshot) => publicLog(snapshot.data()))
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
  const now = Date.now();
  const attentionContentIds = new Set([
    ...items.filter((item) => item.status === "failed").map((item) => String(item.contentId || "")),
    ...jobs
      .filter((job) => ["failed", "manual_review", "blocked_config"].includes(String(job.status)))
      .map((job) => String(job.contentId || job.jobId || "")),
  ]);
  return {
    connection,
    items,
    jobs,
    logs,
    counts: {
      review: items.filter((item) => item.status === "review").length,
      scheduled: items.filter((item) => item.status === "queued" && timestampMillis(item.publishAt) >= now).length,
      published: items.filter((item) => item.status === "published").length,
      attention: attentionContentIds.size,
    },
  };
}

export async function saveInstagramContentDraftHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  let input;
  try {
    input = normalizeSocialDraftInput(request.data);
  } catch (error) {
    throw new AppError("INVALID_ARGUMENT", error instanceof Error ? error.message : "입력값을 확인하세요.");
  }
  const contentRef = input.contentId ? contentCollection.doc(input.contentId) : contentCollection.doc();
  const studioId = staff.studioId || DEFAULT_STUDIO_ID;
  const now = Timestamp.now();
  const contentHash = socialContentHash(input);
  const idempotencyKey = socialPublishIdempotencyKey({
    contentId: contentRef.id,
    contentHash,
    publishAt: input.publishAt,
  });

  const saved = await db.runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(contentRef);
    const existing = existingSnapshot.exists ? (existingSnapshot.data() as SocialContentDoc) : null;
    if (existing && existing.studioId !== studioId) {
      throw new AppError("NOT_FOUND", "콘텐츠를 찾을 수 없습니다.");
    }
    if (existing && ["queued", "publishing"].includes(existing.status)) {
      throw new AppError("INVALID_ARGUMENT", "예약된 콘텐츠는 먼저 보류한 뒤 수정하세요.");
    }
    if (existing?.status === "published") {
      throw new AppError("INVALID_ARGUMENT", "발행 완료 콘텐츠는 수정할 수 없습니다.");
    }
    const status: SocialContentStatus = input.intent === "review" ? "review" : "draft";
    const doc: SocialContentDoc = {
      schemaVersion: 1,
      contentId: contentRef.id,
      studioId,
      channel: "instagram",
      accountHandle: INSTAGRAM_ACCOUNT_HANDLE,
      contentType: input.contentType,
      pillar: input.pillar,
      caption: input.caption,
      media: input.media,
      location: input.location,
      cta: input.cta,
      publishAt: Timestamp.fromDate(input.publishAt),
      contentHash,
      idempotencyKey,
      status,
      createdByUid: existing?.createdByUid || String(request.auth?.uid || ""),
      createdByName: existing?.createdByName || staff.name,
      reviewRequestedAt: status === "review" ? now : null,
      approvedByUid: "",
      approvedByName: "",
      approvedAt: null,
      heldByUid: "",
      heldAt: null,
      holdReason: "",
      externalMediaId: existing?.externalMediaId || "",
      permalink: existing?.permalink || "",
      publishedAt: existing?.publishedAt || null,
      lastError: "",
      ...(existing?.metrics ? { metrics: existing.metrics } : {}),
      ...(existing?.metricsUpdatedAt ? { metricsUpdatedAt: existing.metricsUpdatedAt } : {}),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    transaction.set(contentRef, doc);
    return doc;
  });
  return { ok: true, item: publicContent(saved) };
}

export async function approveInstagramContentHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const contentId = requiredId(request.data?.contentId, "콘텐츠");
  const connection = await getInstagramConnectionStatus({ verify: true }).catch((error) => {
    throw new AppError("INVALID_ARGUMENT", `Meta 연결을 확인할 수 없습니다. ${safeError(error)}`);
  });
  if (!connection.configured) throw new AppError("INVALID_ARGUMENT", "Meta 연결 후 승인할 수 있습니다.");
  if (!isExpectedInstagramAccount(connection)) {
    throw new AppError(
      "INVALID_ARGUMENT",
      `연결 계정이 @${INSTAGRAM_ACCOUNT_HANDLE}인지 확인하세요.`,
    );
  }

  const contentRef = contentCollection.doc(contentId);
  const studioId = staff.studioId || DEFAULT_STUDIO_ID;
  const now = Timestamp.now();
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(contentRef);
    if (!snapshot.exists) throw new AppError("NOT_FOUND", "콘텐츠를 찾을 수 없습니다.");
    const content = snapshot.data() as SocialContentDoc;
    if (content.studioId !== studioId) throw new AppError("NOT_FOUND", "콘텐츠를 찾을 수 없습니다.");
    if (content.status !== "review") throw new AppError("INVALID_ARGUMENT", "검토 요청 상태에서만 승인할 수 있습니다.");
    if (content.publishAt.toMillis() < now.toMillis() + 60_000) {
      throw new AppError("INVALID_ARGUMENT", "발행 일시는 현재보다 1분 이후로 지정하세요.");
    }

    const jobRef = jobCollection.doc(content.idempotencyKey);
    const jobSnapshot = await transaction.get(jobRef);
    if (jobSnapshot.exists) {
      const existingJob = jobSnapshot.data() as SocialPublishJobDoc;
      if (!["failed", "cancelled", "blocked_config"].includes(existingJob.status)) {
        throw new AppError("INVALID_ARGUMENT", "같은 내용과 발행 일시의 작업이 이미 있습니다.");
      }
    }
    const uid = String(request.auth?.uid || "");
    const job: SocialPublishJobDoc = {
      jobId: jobRef.id,
      contentId,
      studioId: content.studioId,
      channel: "instagram",
      accountHandle: content.accountHandle,
      idempotencyKey: content.idempotencyKey,
      contentHash: content.contentHash,
      status: "pending",
      stage: "pending",
      attempts: 0,
      maxAttempts: 2,
      nextRunAt: content.publishAt,
      creationId: "",
      childCreationIds: [],
      externalMediaId: "",
      permalink: "",
      lastError: "",
      createdByUid: uid,
      createdAt: now,
      updatedAt: now,
    };
    transaction.set(jobRef, job);
    transaction.update(contentRef, {
      status: "queued",
      approvedByUid: uid,
      approvedByName: staff.name,
      approvedAt: now,
      lastError: "",
      updatedAt: now,
    });
    return { content, job };
  });
  return {
    ok: true,
    contentId,
    jobId: result.job.jobId,
    publishAt: result.job.nextRunAt.toDate().toISOString(),
    connection: { accountHandle: connection.accountHandle, username: connection.username || "" },
  };
}

export async function holdInstagramContentHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const contentId = requiredId(request.data?.contentId, "콘텐츠");
  const reason = String(request.data?.reason || "운영자 보류").trim().slice(0, 300);
  const contentRef = contentCollection.doc(contentId);
  const studioId = staff.studioId || DEFAULT_STUDIO_ID;
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(contentRef);
    if (!snapshot.exists) throw new AppError("NOT_FOUND", "콘텐츠를 찾을 수 없습니다.");
    const content = snapshot.data() as SocialContentDoc;
    if (content.studioId !== studioId) throw new AppError("NOT_FOUND", "콘텐츠를 찾을 수 없습니다.");
    if (content.status === "published") throw new AppError("INVALID_ARGUMENT", "발행 완료 콘텐츠는 보류할 수 없습니다.");
    if (content.status === "publishing") throw new AppError("INVALID_ARGUMENT", "발행 처리 중에는 보류할 수 없습니다.");
    transaction.update(contentRef, {
      status: "held",
      heldByUid: String(request.auth?.uid || ""),
      heldByName: staff.name,
      heldAt: now,
      holdReason: reason,
      updatedAt: now,
    });
    if (content.idempotencyKey) {
      const jobRef = jobCollection.doc(content.idempotencyKey);
      const jobSnapshot = await transaction.get(jobRef);
      if (jobSnapshot.exists && ["pending", "retry", "blocked_config"].includes(jobSnapshot.get("status"))) {
        transaction.update(jobRef, { status: "cancelled", lastError: reason, updatedAt: now });
      }
    }
  });
  return { ok: true, contentId, status: "held" };
}

export async function publishDueInstagramContent(): Promise<{
  scanned: number;
  published: number;
  failed: number;
  blocked: number;
}> {
  const now = Timestamp.now();
  const snapshot = await jobCollection.where("status", "in", ["pending", "retry", "processing"]).limit(30).get();
  const due = snapshot.docs
    .map((doc) => ({ ref: doc.ref, data: doc.data() as SocialPublishJobDoc }))
    .filter(({ data }) => {
      if (data.status === "processing") return data.updatedAt.toMillis() < now.toMillis() - 30 * 60_000;
      return data.nextRunAt.toMillis() <= now.toMillis();
    })
    .sort((a, b) => a.data.nextRunAt.toMillis() - b.data.nextRunAt.toMillis());

  const summary = { scanned: due.length, published: 0, failed: 0, blocked: 0 };
  if (!due.length) return summary;
  const connection = await getInstagramConnectionStatus({ verify: true }).catch(() => ({
    configured: false,
    accountHandle: INSTAGRAM_ACCOUNT_HANDLE,
    graphApiVersion: process.env.META_GRAPH_API_VERSION || "v25.0",
    message: "Meta 연결을 확인할 수 없습니다.",
  }));
  for (const candidate of due) {
    if (!connection.configured || !isExpectedInstagramAccount(connection)) {
      const reason = connection.configured
        ? `연결 계정이 @${INSTAGRAM_ACCOUNT_HANDLE}이 아닙니다.`
        : "Meta 연결이 필요합니다.";
      await markJobBlocked(candidate.data, reason);
      summary.blocked += 1;
      continue;
    }
    const claimed = await claimPublishJob(candidate.data.jobId);
    if (!claimed) continue;
    try {
      await publishClaimedJob(claimed);
      summary.published += 1;
    } catch (error) {
      await failPublishJob(claimed, error);
      summary.failed += 1;
    }
  }
  return summary;
}

export async function syncInstagramInsights(): Promise<{ synced: number; configured: boolean }> {
  const connection: InstagramConnectionStatus = await getInstagramConnectionStatus({ verify: true }).catch((error) => ({
    configured: false,
    accountHandle: INSTAGRAM_ACCOUNT_HANDLE,
    graphApiVersion: process.env.META_GRAPH_API_VERSION || "v25.0",
    message: safeError(error),
  }));
  if (!connection.configured) return { synced: 0, configured: false };

  const published = await contentCollection.where("status", "==", "published").limit(50).get();
  let synced = 0;
  for (const snapshot of published.docs) {
    const content = snapshot.data() as SocialContentDoc;
    if (!content.externalMediaId) continue;
    try {
      const metrics = await getInstagramMediaMetrics(content.externalMediaId);
      await snapshot.ref.set({ metrics, metricsUpdatedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
      synced += 1;
    } catch (error) {
      logger.warn("Instagram metrics sync skipped", {
        contentId: content.contentId,
        error: safeError(error),
      });
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  await insightCollection.doc(`${INSTAGRAM_ACCOUNT_HANDLE}_${date}`).set(
    {
      snapshotId: `${INSTAGRAM_ACCOUNT_HANDLE}_${date}`,
      studioId: DEFAULT_STUDIO_ID,
      accountHandle: connection.accountHandle,
      username: connection.username || "",
      followersCount: connection.followersCount ?? null,
      mediaCount: connection.mediaCount ?? null,
      syncedMediaCount: synced,
      capturedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: true },
  );
  return { synced, configured: true };
}

async function claimPublishJob(jobId: string): Promise<SocialPublishJobDoc | null> {
  const jobRef = jobCollection.doc(jobId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) return null;
    const job = snapshot.data() as SocialPublishJobDoc;
    const now = Timestamp.now();
    if (job.status === "processing" && job.stage === "publish_requested") {
      transaction.update(jobRef, {
        status: "manual_review",
        lastError: "발행 요청 이후 응답이 확정되지 않아 자동 재시도를 중단했습니다.",
        updatedAt: now,
      });
      transaction.update(contentCollection.doc(job.contentId), {
        status: "failed",
        lastError: "발행 결과 확인이 필요합니다.",
        updatedAt: now,
      });
      return null;
    }
    if (!["pending", "retry", "processing"].includes(job.status)) return null;
    transaction.update(jobRef, {
      status: "processing",
      attempts: job.attempts + 1,
      updatedAt: now,
    });
    transaction.update(contentCollection.doc(job.contentId), {
      status: "publishing",
      updatedAt: now,
    });
    return { ...job, status: "processing", attempts: job.attempts + 1, updatedAt: now };
  });
}

async function publishClaimedJob(job: SocialPublishJobDoc): Promise<void> {
  const contentSnapshot = await contentCollection.doc(job.contentId).get();
  if (!contentSnapshot.exists) throw new Error("콘텐츠 문서가 없습니다.");
  const content = contentSnapshot.data() as SocialContentDoc;
  if (content.contentHash !== job.contentHash || content.idempotencyKey !== job.idempotencyKey) {
    throw new Error("승인 이후 콘텐츠가 변경되어 발행을 중단했습니다.");
  }
  if (!["queued", "publishing"].includes(content.status)) {
    throw new Error(`발행 가능한 상태가 아닙니다: ${content.status}`);
  }

  let creationId = job.creationId;
  let childCreationIds = job.childCreationIds || [];
  if (!creationId) {
    const publishContent: InstagramPublishContent = {
      contentType: content.contentType,
      media: content.media,
      caption: composeInstagramCaption(content.caption, content.cta),
    };
    const prepared = await createInstagramContainer(publishContent);
    creationId = prepared.creationId;
    childCreationIds = prepared.childCreationIds;
    await jobCollection.doc(job.jobId).set(
      {
        stage: "container_created",
        creationId,
        childCreationIds,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }

  await jobCollection.doc(job.jobId).set(
    {
      stage: "publish_requested",
      updatedAt: Timestamp.now(),
    },
    { merge: true },
  );
  const published = await publishInstagramContainer(creationId);
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    transaction.update(contentCollection.doc(job.contentId), {
      status: "published",
      externalMediaId: published.id,
      permalink: published.permalink || "",
      publishedAt: now,
      lastError: "",
      updatedAt: now,
    });
    transaction.update(jobCollection.doc(job.jobId), {
      status: "done",
      stage: "published",
      externalMediaId: published.id,
      permalink: published.permalink || "",
      lastError: "",
      updatedAt: now,
    });
    transaction.set(logCollection.doc(), {
      studioId: content.studioId,
      channel: "instagram",
      accountHandle: content.accountHandle,
      contentId: content.contentId,
      jobId: job.jobId,
      status: "published",
      externalMediaId: published.id,
      permalink: published.permalink || "",
      createdAt: now,
    });
  });
}

async function failPublishJob(job: SocialPublishJobDoc, error: unknown): Promise<"failed"> {
  const message = safeError(error);
  const latest = await jobCollection.doc(job.jobId).get();
  const current = latest.exists ? (latest.data() as SocialPublishJobDoc) : job;
  const ambiguousPublish = current.stage === "publish_requested";
  const retryable = !ambiguousPublish && current.attempts < current.maxAttempts;
  const status: SocialPublishJobStatus = ambiguousPublish ? "manual_review" : retryable ? "retry" : "failed";
  const contentStatus: SocialContentStatus = retryable ? "queued" : "failed";
  const now = Timestamp.now();
  const nextRunAt = Timestamp.fromMillis(now.toMillis() + Math.max(5, current.attempts * 10) * 60_000);
  await db.runTransaction(async (transaction) => {
    transaction.update(jobCollection.doc(job.jobId), {
      status,
      nextRunAt,
      lastError: message,
      updatedAt: now,
    });
    transaction.update(contentCollection.doc(job.contentId), {
      status: contentStatus,
      lastError: message,
      updatedAt: now,
    });
    transaction.set(logCollection.doc(), {
      studioId: job.studioId,
      channel: "instagram",
      accountHandle: job.accountHandle,
      contentId: job.contentId,
      jobId: job.jobId,
      status,
      error: message,
      createdAt: now,
    });
  });
  logger.error("Instagram publish failed", {
    contentId: job.contentId,
    jobId: job.jobId,
    status,
    stage: current.stage,
    error: message,
  });
  return "failed";
}

async function markJobBlocked(job: SocialPublishJobDoc, reason: string): Promise<void> {
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    transaction.update(jobCollection.doc(job.jobId), {
      status: "blocked_config",
      lastError: reason,
      updatedAt: now,
    });
    transaction.update(contentCollection.doc(job.contentId), {
      status: "failed",
      lastError: reason,
      updatedAt: now,
    });
  });
}

function publicContent(content: SocialContentDoc): Record<string, unknown> {
  return {
    contentId: content.contentId,
    studioId: content.studioId,
    accountHandle: content.accountHandle,
    contentType: content.contentType,
    pillar: content.pillar,
    caption: content.caption,
    media: content.media,
    location: content.location,
    cta: content.cta,
    publishAt: content.publishAt,
    status: content.status,
    createdByName: content.createdByName,
    approvedByName: content.approvedByName,
    approvedAt: content.approvedAt,
    holdReason: content.holdReason,
    externalMediaId: content.externalMediaId,
    permalink: content.permalink,
    publishedAt: content.publishedAt,
    lastError: content.lastError,
    metrics: content.metrics || null,
    metricsUpdatedAt: content.metricsUpdatedAt || null,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
  };
}

function publicJob(job: SocialPublishJobDoc): Record<string, unknown> {
  return {
    jobId: job.jobId,
    contentId: job.contentId,
    status: job.status,
    stage: job.stage,
    attempts: job.attempts,
    nextRunAt: job.nextRunAt,
    permalink: job.permalink,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function publicLog(value: FirebaseFirestore.DocumentData): Record<string, unknown> {
  return {
    contentId: value.contentId || "",
    status: value.status || "",
    permalink: value.permalink || "",
    error: value.error || "",
    createdAt: value.createdAt || null,
  };
}

function requiredId(value: unknown, label: string): string {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(id)) throw new AppError("INVALID_ARGUMENT", `${label} ID를 확인하세요.`);
  return id;
}

function timestampMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  const parsed = new Date(String(value || "")).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{80,}/g, "[redacted]")
    .slice(0, 500);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
