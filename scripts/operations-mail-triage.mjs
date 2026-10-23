#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ID = "archive-pilates";
export const SOURCE = "operations-mail-ingress";
export const HEALTH_PATH = "workLanes/operations-mail-ingress/state/mailbox";
export const READ_LIMIT = 101;
const OPERATOR = "archive-codex-operator@archive-pilates.iam.gserviceaccount.com";
const QUEUE_ID = /^ops_mail_[a-f0-9]{64}$/;
const MESSAGE_ID = /^[a-f0-9]{1,64}$/;
const OUTCOMES = ["investigated", "already_handled", "needs_user"];
const STATUSES = ["open", "in_progress", "blocked", "resolved"];
const PRIORITIES = ["high", "normal", "low"];
const AREAS = Object.freeze({ alimtalk: "알림톡", holding: "홀딩 안내", contract: "전자계약",
  system_health: "시스템점검", sync: "동기화", deploy: "배포", site: "사이트",
  instructor_lesson: "강사레슨", automation: "자동화", notification_detection: "알림감지",
  parking: "주차등록", reel: "릴스", settlement: "월말정산", inbody_api: "인바디 API",
  youtube_video_list: "유튜브 영상리스트", inbody: "인바디", system_validation: "시스템검증",
  data_integrity: "데이터정합성", login: "로그인", referral: "친구초대", staff_benefits: "스텝 혜택",
  instructor_lesson_video: "강사레슨영상", staff_video_access: "스텝 영상권한" });
const MESSAGES = Object.freeze({ INVALID_ARGUMENTS: "인수를 확인하세요.",
  INVALID_CREDENTIALS: "전용 운영자 인증서와 프로젝트를 확인하세요.",
  INVALID_TARGET: "허용되지 않은 데이터베이스 대상입니다.",
  QUEUE_NOT_FOUND: "기존 큐 원장이 없어 보류합니다.", SOURCE_MISMATCH: "다른 source 큐는 처리하지 않습니다.",
  INVALID_QUEUE_VERSION: "큐 버전 원장이 불명확하여 보류합니다.",
  QUEUE_VERSION_CONFLICT: "새 수신 또는 버전 변경이 있어 보류합니다. 다시 조회하세요.",
  TRIAGE_FAILED: "처리를 확인하지 못했습니다. 원장을 다시 조회하세요." });

export class TriageError extends Error {
  constructor(code) { super(MESSAGES[code] || MESSAGES.TRIAGE_FAILED); this.code = code; }
}
const fail = code => { throw new TriageError(code); };
const positiveCount = value => Number.isSafeInteger(value) && value > 0;
const reviewedCount = value => Number.isSafeInteger(value) && value >= 0;
const validMessageId = value => typeof value === "string" && MESSAGE_ID.test(value);

export function validateAck(command) {
  if (!command || typeof command.queueId !== "string" || !QUEUE_ID.test(command.queueId)
    || !positiveCount(command.count) || !validMessageId(command.messageId)
    || !OUTCOMES.includes(command.outcome)) fail("INVALID_ARGUMENTS");
  return { queueId: command.queueId, count: command.count, messageId: command.messageId, outcome: command.outcome };
}

export function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.some(arg => typeof arg !== "string" || arg.length > 256)) fail("INVALID_ARGUMENTS");
  if (argv.length === 1 && argv[0] === "--help") return { mode: "help" };
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (flags.has(key)) fail("INVALID_ARGUMENTS");
    if (key === "--include-tests") { flags.set(key, true); continue; }
    if (!["--ack", "--count", "--message-id", "--outcome"].includes(key)) fail("INVALID_ARGUMENTS");
    const value = argv[++i];
    if (!value || value.startsWith("--")) fail("INVALID_ARGUMENTS");
    flags.set(key, value);
  }
  if (!flags.has("--ack")) {
    if ([...flags.keys()].some(key => key !== "--include-tests")) fail("INVALID_ARGUMENTS");
    return { mode: "list", includeTests: flags.has("--include-tests") };
  }
  if (flags.size !== 4 || !/^[1-9]\d{0,15}$/.test(flags.get("--count") || "")) fail("INVALID_ARGUMENTS");
  return { mode: "ack", ...validateAck({ queueId: flags.get("--ack"), count: Number(flags.get("--count")),
    messageId: flags.get("--message-id"), outcome: flags.get("--outcome") }) };
}

export function validateServiceAccount(key) {
  if (!key || key.type !== "service_account" || key.project_id !== PROJECT_ID || key.client_email !== OPERATOR
    || typeof key.private_key !== "string" || !key.private_key.startsWith("-----BEGIN PRIVATE KEY-----\n")
    || !key.private_key.trimEnd().endsWith("-----END PRIVATE KEY-----")) fail("INVALID_CREDENTIALS");
  return key;
}

export function validateEnvironment(env) {
  if (["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "FIREBASE_PROJECT_ID"].some(key => env[key] && env[key] !== PROJECT_ID)
    || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_DATABASE_EMULATOR_HOST) fail("INVALID_TARGET");
}

export function timestamp(value) {
  try {
    const date = value instanceof Date ? value : typeof value?.toDate === "function" ? value.toDate()
      : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null;
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  } catch { return null; }
}

export function sanitizeSourceRefs(refs) {
  if (!Array.isArray(refs)) return [];
  const safe = new Set();
  for (const ref of refs) {
    if (typeof ref !== "string" || ref.length > 256) continue;
    if (/^gmail:[a-f0-9]{1,64}$/.test(ref)
      || /^https:\/\/mail\.google\.com\/mail\/u\/\?authuser=home%40archivepilates\.com#all\/[a-f0-9]{1,64}$/.test(ref)
      || /^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/[a-f0-9]{1,64}$/.test(ref)) safe.add(ref);
    if (safe.size === 10) break;
  }
  return [...safe];
}

export function sanitizeHealth(data) {
  return { enabled: typeof data?.enabled === "boolean" ? data.enabled : null,
    activatedAt: timestamp(data?.activatedAt), lastSyncAt: timestamp(data?.lastSyncAt),
    lastErrorCode: typeof data?.lastErrorCode === "string" && /^(?:mail_[a-z0-9_]{1,80}|gmail_http_\d{3})$/.test(data.lastErrorCode)
      ? data.lastErrorCode : null,
    lastErrorAt: timestamp(data?.lastErrorAt), watchExpiresAt: timestamp(data?.watchExpiresAt) };
}

export function isUnreviewed(data) {
  return !positiveCount(data?.messageCount) || !reviewedCount(data?.reviewedMessageCount)
    || data.messageCount > data.reviewedMessageCount || data.reviewedMessageCount > data.messageCount;
}

export function safeQueueItem(id, data) {
  if (!QUEUE_ID.test(id) || data?.source !== SOURCE || data.needsReview !== true || !STATUSES.includes(data.status)) return null;
  const area = Object.hasOwn(AREAS, data.area) ? data.area : "operations";
  const label = AREAS[area] || "운영";
  // The pipeline's fixed titles are safe; never fall back to an email subject or arbitrary queue title.
  const titles = ["실패", "긴급", "확인필요", "성공", "진행중"].map(status => `${label} ${status} 보고`);
  return { id, title: titles.includes(data.title) ? data.title : `${label} 메일 확인 필요`, area,
    status: data.status, priority: PRIORITIES.includes(data.priority) ? data.priority : "unknown",
    messageCount: positiveCount(data.messageCount) ? data.messageCount : null,
    reviewedMessageCount: reviewedCount(data.reviewedMessageCount) ? data.reviewedMessageCount : null,
    lastMessageId: validMessageId(data.lastMessageId) ? data.lastMessageId : null,
    lastSeenAt: timestamp(data.lastSeenAt), sourceRefs: sanitizeSourceRefs(data.sourceRefs),
    isTest: data.isTest === true, unreviewed: isUnreviewed(data),
    outcome: OUTCOMES.includes(data.outcome) ? data.outcome : null };
}

export function summarizeQueue(docs, { includeTests = false } = {}) {
  const items = docs.map(doc => safeQueueItem(doc.id, doc.data())).filter(Boolean)
    .filter(item => item.unreviewed && (includeTests || !item.isTest));
  items.sort((a, b) => {
    const rank = item => { const index = PRIORITIES.indexOf(item.priority); return index < 0 ? 99 : index; };
    return rank(a) - rank(b) || (b.lastSeenAt || "").localeCompare(a.lastSeenAt || "") || a.id.localeCompare(b.id);
  });
  return { source: SOURCE, includeTests, scannedCount: docs.length, complete: docs.length < READ_LIMIT,
    truncated: docs.length >= READ_LIMIT, items: items.slice(0, 100) };
}

export async function listOperationsMail(db, options = {}) {
  // Filter before limiting so reviewed history cannot starve newly received incidents, including resolved ones.
  const snapshot = await db.collection("codexActionQueue").where("source", "==", SOURCE)
    .where("needsReview", "==", true).limit(READ_LIMIT).get();
  const health = await db.doc(HEALTH_PATH).get();
  return { ...summarizeQueue(snapshot.docs, options), health: sanitizeHealth(health.exists ? health.data() : null) };
}

export function buildAckPatch(data, command, now) {
  validateAck(command);
  if (data?.source !== SOURCE) fail("SOURCE_MISMATCH");
  if (!positiveCount(data.messageCount) || !validMessageId(data.lastMessageId)
    || (data.reviewedMessageCount != null && (!reviewedCount(data.reviewedMessageCount)
      || data.reviewedMessageCount > data.messageCount))) fail("INVALID_QUEUE_VERSION");
  if (data.messageCount !== command.count || data.lastMessageId !== command.messageId) fail("QUEUE_VERSION_CONFLICT");
  if (data.reviewedMessageCount === data.messageCount && data.needsReview === false) {
    if (!OUTCOMES.includes(data.outcome)) fail("INVALID_QUEUE_VERSION");
    if (data.outcome !== command.outcome) fail("QUEUE_VERSION_CONFLICT");
    if (!timestamp(data.reviewedAt) || !STATUSES.includes(data.status)) fail("INVALID_QUEUE_VERSION");
    return { reviewedMessageCount: data.reviewedMessageCount, reviewedAt: data.reviewedAt,
      outcome: data.outcome, needsReview: false, status: data.status };
  }
  const at = timestamp(now);
  if (!at) fail("INVALID_ARGUMENTS");
  return { reviewedMessageCount: command.count, reviewedAt: at, outcome: command.outcome, needsReview: false,
    status: command.outcome === "needs_user" ? "blocked" : "resolved" };
}

export async function acknowledgeOperationsMail(db, command, now = () => new Date()) {
  const validated = validateAck(command);
  const ref = db.collection("codexActionQueue").doc(validated.queueId);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) fail("QUEUE_NOT_FOUND");
    const patch = buildAckPatch(snapshot.data(), validated, now());
    tx.update(ref, patch);
    return { id: validated.queueId, ...patch };
  });
}

export function safeError(error) {
  const code = error instanceof TriageError && Object.hasOwn(MESSAGES, error.code) ? error.code : "TRIAGE_FAILED";
  return { error: { code, message: MESSAGES[code] } };
}

async function connectOperator() {
  validateEnvironment(process.env);
  let key;
  try {
    key = validateServiceAccount(JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS
      || path.join(os.homedir(), "ArchiveIN/secrets/google/archive-codex-operator.json"), "utf8")));
  } catch { fail("INVALID_CREDENTIALS"); }
  const require = createRequire(import.meta.url);
  const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
  const app = admin.initializeApp({ projectId: PROJECT_ID, credential: admin.credential.cert(key) }, `operations-mail-triage-${process.pid}`);
  try { return { db: app.firestore(), close: () => app.delete() }; }
  catch (error) { await app.delete(); throw error; }
}

export async function runCli(argv, { connect = connectOperator, now = () => new Date() } = {}) {
  const args = parseArgs(argv);
  if (args.mode === "help") return { usage: "node scripts/operations-mail-triage.mjs [--include-tests] | --ack QUEUEID --count N --message-id ID --outcome investigated|already_handled|needs_user" };
  const connection = await connect();
  try {
    return args.mode === "ack" ? await acknowledgeOperationsMail(connection.db, args, now)
      : await listOperationsMail(connection.db, args);
  } finally { await connection.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runCli(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; }
}
