import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { CallableRequest, Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";

export const VIDEO_WATCH_EVENT_COLLECTION = "videoWatchEvents";
export const VIDEO_WATCH_SESSION_COLLECTION = "videoWatchSessions";
export const VIDEO_WATCH_RATE_LIMIT_COLLECTION = "videoWatchRateLimits";

const ALLOWED_ORIGINS = new Set([
  "https://archivepilates.imweb.me",
  "https://shop.archivepilates.com",
]);
const EVENT_TYPES = new Set([
  "page_view",
  "play",
  "pause",
  "heartbeat",
  "progress_25",
  "progress_50",
  "progress_75",
  "progress_90",
  "complete",
  "pagehide",
  "player_error",
]);
const START_EVENT_TYPES = new Set([
  "play",
  "pause",
  "heartbeat",
  "progress_25",
  "progress_50",
  "progress_75",
  "progress_90",
  "complete",
  "pagehide",
]);
const COMPLETE_EVENT_TYPES = new Set(["progress_90", "complete"]);
const MAX_EVENTS_PER_BUYER_HOUR = 240;
const MAX_EVENTS_PER_NETWORK_HOUR = 600;
const RAW_EVENT_RETENTION_DAYS = 180;
const SESSION_RETENTION_DAYS = 365;
const DASHBOARD_SESSION_LIMIT = 2000;

export interface NormalizedVideoWatchEvent {
  eventId: string;
  sessionId: string;
  buyerKey: string;
  accountHint: string;
  videoCode: string;
  videoTitle: string;
  eventType: string;
  pagePath: string;
  positionSeconds: number;
  durationSeconds: number;
  progressPercent: number;
  activeDeltaSeconds: number;
  clientOccurredAt: Date;
  watchDate: string;
  trackerVersion: string;
}

export interface VideoWatchSessionRow {
  id: string;
  buyerKey: string;
  accountHint: string;
  videoCode: string;
  videoTitle: string;
  sourcePage: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  started: boolean;
  completed: boolean;
  playCount: number;
  activeWatchSeconds: number;
  maxProgressPercent: number;
  watchDates: string[];
}

export async function videoWatchEventApiHandler(request: Request, response: Response): Promise<void> {
  setCors(request, response);
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }
  response.set("Cache-Control", "no-store");
  response.set("X-Content-Type-Options", "nosniff");
  if (request.method !== "POST") {
    response.set("Allow", "POST, OPTIONS").status(405).json({ ok: false, error: "POST 요청만 지원합니다." });
    return;
  }

  const origin = String(request.get("origin") || "");
  const referer = String(request.get("referer") || "");
  if (!ALLOWED_ORIGINS.has(origin) || (referer && !referer.startsWith(origin))) {
    response.status(403).json({ ok: false, error: "허용되지 않은 영상 시청 페이지입니다." });
    return;
  }

  try {
    const payload = parseRequestBody(request.body);
    const event = normalizeVideoWatchEvent(payload);
    const networkKey = requestNetworkKey(request);
    const result = await storeVideoWatchEvent(event, networkKey);
    response.status(202).json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "시청 기록을 저장하지 못했습니다.";
    const status = message.includes("수집 한도") ? 429 : 400;
    response.status(status).json({ ok: false, error: message });
  }
}

export async function getVideoWatchDashboardHandler(request: CallableRequest): Promise<Record<string, unknown>> {
  const rangeDays = normalizeRangeDays(request.data?.rangeDays);
  const cutoff = Timestamp.fromMillis(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  const snapshot = await db
    .collection(VIDEO_WATCH_SESSION_COLLECTION)
    .where("lastSeenAt", ">=", cutoff)
    .orderBy("lastSeenAt", "desc")
    .limit(DASHBOARD_SESSION_LIMIT)
    .get();
  const sessions = snapshot.docs
    .map((doc) => sessionRow(doc.id, doc.data()))
    .filter((row): row is VideoWatchSessionRow => Boolean(row));
  return buildVideoWatchDashboard(sessions, rangeDays, snapshot.size === DASHBOARD_SESSION_LIMIT);
}

export function normalizeVideoWatchEvent(
  input: Record<string, unknown>,
  now = new Date(),
): NormalizedVideoWatchEvent {
  const eventId = cleanId(input.eventId, "eventId", 24, 80);
  const sessionId = cleanId(input.sessionId, "sessionId", 16, 80);
  const buyerKey = String(input.buyerKey || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(buyerKey)) throw new Error("구매자 식별값 형식이 올바르지 않습니다.");

  const videoCode = String(input.videoCode || "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,24}$/.test(videoCode)) throw new Error("영상 코드 형식이 올바르지 않습니다.");
  const pagePath = String(input.pagePath || "").trim().toLowerCase();
  if (!/^\/archive-method-watch-[a-z0-9-]{2,60}$/.test(pagePath) || !pagePath.endsWith(videoCode.toLowerCase())) {
    throw new Error("영상 페이지와 코드가 일치하지 않습니다.");
  }

  const eventType = String(input.eventType || "").trim().toLowerCase();
  if (!EVENT_TYPES.has(eventType)) throw new Error("지원하지 않는 시청 이벤트입니다.");

  const accountHint = cleanAccountHint(input.accountHint);
  const videoTitle = cleanText(input.videoTitle, 120) || `ARCHIVE METHOD ${videoCode}`;
  const positionSeconds = boundedNumber(input.positionSeconds, 0, 8 * 60 * 60);
  const durationSeconds = boundedNumber(input.durationSeconds, 0, 8 * 60 * 60);
  const activeDeltaSeconds = boundedNumber(input.activeDeltaSeconds, 0, 130);
  const progressPercent = milestoneProgress(eventType, positionSeconds, durationSeconds);
  const trackerVersion = cleanText(input.trackerVersion, 32) || "unknown";
  const requestedClientTime = new Date(String(input.clientOccurredAt || ""));
  const withinOneDay =
    !Number.isNaN(requestedClientTime.getTime()) && Math.abs(requestedClientTime.getTime() - now.getTime()) <= 86_400_000;
  const clientOccurredAt = withinOneDay ? requestedClientTime : now;

  return {
    eventId,
    sessionId,
    buyerKey,
    accountHint,
    videoCode,
    videoTitle,
    eventType,
    pagePath,
    positionSeconds,
    durationSeconds,
    progressPercent,
    activeDeltaSeconds,
    clientOccurredAt,
    watchDate: kstDate(now),
    trackerVersion,
  };
}

export function buildVideoWatchDashboard(
  sessionRows: VideoWatchSessionRow[],
  rangeDays: number,
  truncated = false,
): Record<string, unknown> {
  const sessions = sessionRows.filter((row) => row.started);
  const videos = new Map<string, DashboardBucket>();
  const buyers = new Map<string, DashboardBucket>();
  const daily = new Map<string, { date: string; sessions: number; completions: number; buyers: Set<string> }>();

  for (const row of sessions) {
    updateBucket(videos, row.videoCode, row.videoTitle || row.videoCode, row);
    updateBucket(buyers, row.buyerKey, row.accountHint || buyerAlias(row.buyerKey), row);
    const dates = row.watchDates.length ? row.watchDates : [kstDate(row.lastSeenAt)];
    for (const date of new Set(dates)) {
      const current = daily.get(date) || { date, sessions: 0, completions: 0, buyers: new Set<string>() };
      current.sessions += 1;
      current.completions += row.completed ? 1 : 0;
      current.buyers.add(row.buyerKey);
      daily.set(date, current);
    }
  }

  const totalWatchSeconds = sessions.reduce((sum, row) => sum + row.activeWatchSeconds, 0);
  const completions = sessions.filter((row) => row.completed).length;
  const uniqueBuyers = new Set(sessions.map((row) => row.buyerKey)).size;
  const uniqueWatchDays = new Set(sessions.flatMap((row) => row.watchDates)).size;
  const videoRows = [...videos.entries()]
    .map(([videoCode, bucket]) => ({ videoCode, ...bucketOutput(bucket) }))
    .sort(bucketSort);
  const buyerRows = [...buyers.entries()]
    .map(([buyerKey, bucket]) => ({ buyerId: buyerAlias(buyerKey), ...bucketOutput(bucket) }))
    .sort(bucketSort);
  const repeatBuyers = buyerRows.filter((row) => Number(row.sessions || 0) >= 2).length;
  const recentSessions = sessions.slice(0, 40).map((row) => ({
    sessionId: row.id.slice(0, 12),
    buyerId: buyerAlias(row.buyerKey),
    accountHint: row.accountHint || buyerAlias(row.buyerKey),
    videoCode: row.videoCode,
    videoTitle: row.videoTitle,
    startedAt: row.firstSeenAt.toISOString(),
    lastWatchedAt: row.lastSeenAt.toISOString(),
    activeWatchSeconds: row.activeWatchSeconds,
    playCount: row.playCount,
    maxProgressPercent: row.maxProgressPercent,
    completed: row.completed,
  }));

  return {
    generatedAt: new Date().toISOString(),
    rangeDays,
    truncated,
    totals: {
      activeBuyers: uniqueBuyers,
      repeatBuyers,
      repeatRate: uniqueBuyers ? Math.round((repeatBuyers / uniqueBuyers) * 1000) / 10 : 0,
      watchedVideos: videos.size,
      watchSessions: sessions.length,
      sessionsPerBuyer: uniqueBuyers ? Math.round((sessions.length / uniqueBuyers) * 100) / 100 : 0,
      uniqueWatchDays,
      playStarts: sessions.reduce((sum, row) => sum + row.playCount, 0),
      completions,
      completionRate: sessions.length ? Math.round((completions / sessions.length) * 1000) / 10 : 0,
      totalWatchSeconds,
    },
    videos: videoRows,
    buyers: buyerRows,
    recentSessions,
    daily: [...daily.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({ ...row, buyers: row.buyers.size })),
  };
}

async function storeVideoWatchEvent(event: NormalizedVideoWatchEvent, networkKey: string): Promise<{ duplicate: boolean }> {
  const now = Timestamp.now();
  const eventRef = db.collection(VIDEO_WATCH_EVENT_COLLECTION).doc(event.eventId);
  const sessionDocumentId = createHash("sha256")
    .update(`${event.buyerKey}|${event.videoCode}|${event.sessionId}`)
    .digest("hex");
  const sessionRef = db.collection(VIDEO_WATCH_SESSION_COLLECTION).doc(sessionDocumentId);
  const hour = utcHour(now.toDate());
  const buyerRateRef = db.collection(VIDEO_WATCH_RATE_LIMIT_COLLECTION).doc(`buyer_${event.buyerKey}_${hour}`);
  const networkRateRef = db.collection(VIDEO_WATCH_RATE_LIMIT_COLLECTION).doc(`network_${networkKey}_${hour}`);

  return db.runTransaction(async (transaction) => {
    const [existingEvent, existingSession, buyerRateLimit, networkRateLimit] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(sessionRef),
      transaction.get(buyerRateRef),
      transaction.get(networkRateRef),
    ]);
    if (existingEvent.exists) return { duplicate: true };
    const buyerRateCount = Number(buyerRateLimit.data()?.count || 0);
    const networkRateCount = Number(networkRateLimit.data()?.count || 0);
    if (buyerRateCount >= MAX_EVENTS_PER_BUYER_HOUR || networkRateCount >= MAX_EVENTS_PER_NETWORK_HOUR) {
      throw new Error("시간당 시청 기록 수집 한도를 초과했습니다.");
    }

    const current = existingSession.data() || {};
    const started = Boolean(current.started) || START_EVENT_TYPES.has(event.eventType);
    const completed = Boolean(current.completed) || COMPLETE_EVENT_TYPES.has(event.eventType);
    const watchDates = [...new Set([...(Array.isArray(current.watchDates) ? current.watchDates : []), event.watchDate])].sort();
    const firstSeenAt = current.firstSeenAt instanceof Timestamp ? current.firstSeenAt : now;
    const currentProgress = Number(current.maxProgressPercent || 0);
    const currentWatchSeconds = Number(current.activeWatchSeconds || 0);
    const currentPlayCount = Number(current.playCount || 0);
    const currentPageViews = Number(current.pageViewCount || 0);
    const currentEventCount = Number(current.eventCount || 0);

    transaction.create(eventRef, {
      studioId: DEFAULT_STUDIO_ID,
      ...event,
      clientOccurredAt: Timestamp.fromDate(event.clientOccurredAt),
      serverOccurredAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + RAW_EVENT_RETENTION_DAYS * 86_400_000),
    });
    transaction.set(
      sessionRef,
      {
        studioId: DEFAULT_STUDIO_ID,
        buyerKey: event.buyerKey,
        accountHint: event.accountHint || current.accountHint || "",
        videoCode: event.videoCode,
        videoTitle: event.videoTitle,
        sourcePage: event.pagePath,
        trackerVersion: event.trackerVersion,
        firstSeenAt,
        lastSeenAt: now,
        started,
        startedAt: current.startedAt || (started ? now : null),
        completed,
        completedAt: current.completedAt || (completed ? now : null),
        pageViewCount: currentPageViews + (event.eventType === "page_view" ? 1 : 0),
        playCount: currentPlayCount + (event.eventType === "play" ? 1 : 0),
        eventCount: currentEventCount + 1,
        activeWatchSeconds: Math.round((currentWatchSeconds + event.activeDeltaSeconds) * 10) / 10,
        maxProgressPercent: Math.max(currentProgress, event.progressPercent),
        lastPositionSeconds: event.positionSeconds,
        durationSeconds: Math.max(Number(current.durationSeconds || 0), event.durationSeconds),
        watchDates,
        updatedAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + SESSION_RETENTION_DAYS * 86_400_000),
      },
      { merge: true },
    );
    transaction.set(
      buyerRateRef,
      {
        scope: "buyer",
        subjectKey: event.buyerKey,
        count: FieldValue.increment(1),
        updatedAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + 2 * 86_400_000),
      },
      { merge: true },
    );
    transaction.set(
      networkRateRef,
      {
        scope: "network",
        subjectKey: networkKey,
        count: FieldValue.increment(1),
        updatedAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + 2 * 86_400_000),
      },
      { merge: true },
    );
    return { duplicate: false };
  });
}

interface DashboardBucket {
  label: string;
  sessions: number;
  playStarts: number;
  completions: number;
  totalWatchSeconds: number;
  maxProgressPercent: number;
  firstWatchedAt: Date;
  lastWatchedAt: Date;
  activeDays: Set<string>;
  relatedBuyers: Set<string>;
  relatedCodes: Set<string>;
}

interface DashboardBucketOutput {
  label: string;
  sessions: number;
  playStarts: number;
  completions: number;
  completionRate: number;
  totalWatchSeconds: number;
  maxProgressPercent: number;
  activeDays: number;
  uniqueBuyers: number;
  firstWatchedAt: string;
  lastWatchedAt: string;
  videoCodes: string[];
}

function updateBucket(
  target: Map<string, DashboardBucket>,
  key: string,
  label: string,
  row: VideoWatchSessionRow,
): void {
  const current = target.get(key) || {
    label,
    sessions: 0,
    playStarts: 0,
    completions: 0,
    totalWatchSeconds: 0,
    maxProgressPercent: 0,
    firstWatchedAt: row.firstSeenAt,
    lastWatchedAt: row.lastSeenAt,
    activeDays: new Set<string>(),
    relatedBuyers: new Set<string>(),
    relatedCodes: new Set<string>(),
  };
  current.label = label || current.label;
  current.sessions += 1;
  current.playStarts += row.playCount;
  current.completions += row.completed ? 1 : 0;
  current.totalWatchSeconds += row.activeWatchSeconds;
  current.maxProgressPercent = Math.max(current.maxProgressPercent, row.maxProgressPercent);
  if (row.firstSeenAt < current.firstWatchedAt) current.firstWatchedAt = row.firstSeenAt;
  if (row.lastSeenAt > current.lastWatchedAt) current.lastWatchedAt = row.lastSeenAt;
  row.watchDates.forEach((date) => current.activeDays.add(date));
  current.relatedBuyers.add(row.buyerKey);
  current.relatedCodes.add(row.videoCode);
  target.set(key, current);
}

function bucketOutput(bucket: DashboardBucket): DashboardBucketOutput {
  return {
    label: bucket.label,
    sessions: bucket.sessions,
    playStarts: bucket.playStarts,
    completions: bucket.completions,
    completionRate: bucket.sessions ? Math.round((bucket.completions / bucket.sessions) * 1000) / 10 : 0,
    totalWatchSeconds: Math.round(bucket.totalWatchSeconds),
    maxProgressPercent: Math.round(bucket.maxProgressPercent * 10) / 10,
    activeDays: bucket.activeDays.size,
    uniqueBuyers: bucket.relatedBuyers.size,
    firstWatchedAt: bucket.firstWatchedAt.toISOString(),
    lastWatchedAt: bucket.lastWatchedAt.toISOString(),
    videoCodes: [...bucket.relatedCodes].sort(),
  };
}

function bucketSort(a: DashboardBucketOutput, b: DashboardBucketOutput): number {
  return b.sessions - a.sessions || b.lastWatchedAt.localeCompare(a.lastWatchedAt);
}

function sessionRow(id: string, data: FirebaseFirestore.DocumentData): VideoWatchSessionRow | null {
  const firstSeenAt = timestampDate(data.firstSeenAt);
  const lastSeenAt = timestampDate(data.lastSeenAt);
  if (!firstSeenAt || !lastSeenAt || !data.buyerKey || !data.videoCode) return null;
  return {
    id,
    buyerKey: String(data.buyerKey),
    accountHint: String(data.accountHint || ""),
    videoCode: String(data.videoCode),
    videoTitle: String(data.videoTitle || data.videoCode),
    sourcePage: String(data.sourcePage || ""),
    firstSeenAt,
    lastSeenAt,
    started: Boolean(data.started),
    completed: Boolean(data.completed),
    playCount: Number(data.playCount || 0),
    activeWatchSeconds: Number(data.activeWatchSeconds || 0),
    maxProgressPercent: Number(data.maxProgressPercent || 0),
    watchDates: Array.isArray(data.watchDates) ? data.watchDates.map(String) : [],
  };
}

function parseRequestBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) return body as Record<string, unknown>;
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body || "");
  if (!text || text.length > 8_192) throw new Error("시청 기록 요청 크기를 확인하세요.");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("시청 기록 형식이 올바르지 않습니다.");
  return parsed as Record<string, unknown>;
}

function setCors(request: Request, response: Response): void {
  const origin = String(request.get("origin") || "");
  if (ALLOWED_ORIGINS.has(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Vary", "Origin");
  }
  response.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
}

function requestNetworkKey(request: Request): string {
  const forwarded = String(request.get("x-forwarded-for") || "").split(",")[0].trim();
  const source = String(request.ip || forwarded || "unknown");
  return createHash("sha256").update(`archive-pilates-video-watch-network:v1:${source}`).digest("hex").slice(0, 32);
}

function normalizeRangeDays(value: unknown): number {
  const days = Number(value || 30);
  return [7, 30, 90, 365].includes(days) ? days : 30;
}

function cleanId(value: unknown, field: string, min: number, max: number): string {
  const cleaned = String(value || "").trim();
  if (cleaned.length < min || cleaned.length > max || !/^[A-Za-z0-9_-]+$/.test(cleaned)) {
    throw new Error(`${field} 형식이 올바르지 않습니다.`);
  }
  return cleaned;
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value || "")
    .replace(/[<>\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanAccountHint(value: unknown): string {
  const hint = cleanText(value, 80);
  if (!hint) return "";
  if (/\d{10,11}/.test(hint)) throw new Error("연락처는 시청 기록에 저장할 수 없습니다.");
  if (hint.includes("@") && !hint.includes("*")) throw new Error("이메일은 마스킹해서 전송해야 합니다.");
  return hint;
}

function boundedNumber(value: unknown, min: number, max: number): number {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return min;
  return Math.round(Math.min(max, Math.max(min, number)) * 10) / 10;
}

function milestoneProgress(eventType: string, positionSeconds: number, durationSeconds: number): number {
  const milestone = { progress_25: 25, progress_50: 50, progress_75: 75, progress_90: 90, complete: 100 }[eventType];
  if (milestone) return milestone;
  return durationSeconds > 0 ? Math.min(100, Math.max(0, (positionSeconds / durationSeconds) * 100)) : 0;
}

function timestampDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

function kstDate(value: Date): string {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function utcHour(value: Date): string {
  return value.toISOString().slice(0, 13).replace(/[-T:]/g, "");
}

function buyerAlias(buyerKey: string): string {
  return `구매자 ${buyerKey.slice(-6).toUpperCase()}`;
}
