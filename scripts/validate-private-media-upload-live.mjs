#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const PRIVATE_CHART_API_URL = process.env.PRIVATE_CHART_API_URL || "https://in.archivepilates.com/api/privateChart";
const PRIVATE_CHART_PAGE_URL = process.env.PRIVATE_CHART_PAGE_URL || "https://in.archivepilates.com/private-chart/";
const OUT_DIR = "artifacts/private-media-upload-live-validation";
const TEST_MEMBER = {
  memberId: "1982133",
  memberName: "김기효",
  memberPhone: "01086488585",
  staffId: "1982133",
  staffName: "김기효",
  staffPhone: "01086488585",
};

const confirmed = hasArg("--confirm-live-media-test");
const webhookSecret = process.env.PRIVATE_SURVEY_WEBHOOK_SECRET || "";
const runId = new Date().toISOString().replace(/[:.]/g, "-");

if (!confirmed) throw new Error("Refusing live media validation without --confirm-live-media-test.");
if (!webhookSecret) throw new Error("PRIVATE_SURVEY_WEBHOOK_SECRET is required.");
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const tmpDir = mkdtempSync(path.join(os.tmpdir(), "archive-private-media-"));
let validationRequest = null;

try {
  validationRequest = await createTestRequest();
  const request = validationRequest;
  await postChartAction({ requestId: request.requestId, token: request.token, mode: "pre", answers: preAnswers() });
  await postChartAction({ requestId: request.requestId, token: request.token, mode: "post", answers: postAnswers() });

  const files = [
    {
      fileName: `codex-live-validation-${runId}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      ),
    },
    {
      fileName: `codex-live-validation-${runId}.mp4`,
      mimeType: "video/mp4",
      buffer: createTinyVideoBuffer(),
    },
  ];

  const uploads = [];
  for (const file of files) uploads.push(await uploadMediaFile(request, file));
  const convert = await postChartActionWithRetry(
    {
      requestId: request.requestId,
      token: request.token,
      action: "convertReport",
    },
    { attempts: 3, retryMs: 8000 },
  );
  const record = await readRecord(request.requestId);
  const reportUrl = record?.publicReportCanonicalUrl || record?.publicReportUrl || convert.reportUrl || "";
  const reportHtml = reportUrl ? await fetchText(reportUrl) : "";
  const reportContainsMedia =
    reportHtml.includes("수업 사진·영상") &&
    files.every((file) => reportHtml.includes(file.fileName));
  const cleanup = await cleanupValidationDocs(request);

  const final = {
    ok:
      uploads.length === files.length &&
      uploads.every((row) => row.done && row.file?.driveFileId && row.file?.previewUrl) &&
      record?.media?.files?.length >= files.length &&
      reportContainsMedia,
    projectId: PROJECT_ID,
    generatedAt: new Date().toISOString(),
    apiUrl: PRIVATE_CHART_API_URL,
    requestId: request.requestId,
    bookingId: request.bookingId,
    reportUrl,
    uploads: uploads.map((row) => ({
      done: row.done,
      bytesUploaded: row.bytesUploaded,
      mediaId: row.file?.mediaId || "",
      fileName: row.file?.fileName || "",
      mimeType: row.file?.mimeType || "",
      uploadMode: row.uploadMode || "",
      chunkSize: row.chunkSize || 0,
      driveFileId: row.file?.driveFileId || "",
      driveUrl: row.file?.driveUrl || "",
      previewUrl: row.file?.previewUrl || "",
    })),
    recordMediaFiles: (record?.media?.files || []).map((file) => ({
      mediaId: file.mediaId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      driveFileId: file.driveFileId,
      previewUrl: file.previewUrl,
    })),
    reportContainsMedia,
    cleanup,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${runId}.json`);
  writeFileSync(outPath, JSON.stringify(final, null, 2));
  console.log(JSON.stringify({ ok: final.ok, outPath, requestId: request.requestId, uploads: final.uploads, reportUrl }, null, 2));
  if (!final.ok) process.exitCode = 1;
} catch (error) {
  if (validationRequest) {
    await cleanupValidationDocs(validationRequest).catch((cleanupError) => {
      console.error(`cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    });
  }
  throw error;
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

async function createTestRequest() {
  const requestId = `plc_mediaval-${runId.slice(0, 10).replaceAll("-", "")}-${runId.slice(11, 17).replaceAll("-", "")}`;
  const bookingId = `live_validation_${requestId}`;
  const token = accessTokenFor(requestId);
  const tokenHash = tokenHashFor(token);
  const lessonStart = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const lessonEnd = new Date(lessonStart.getTime() + 50 * 60 * 1000);
  const lessonDate = kstDate(lessonStart);
  const now = Timestamp.now();
  const booking = {
    bookingId,
    lectureId: bookingId,
    studioId: "5330",
    memberId: TEST_MEMBER.memberId,
    memberName: TEST_MEMBER.memberName,
    memberPhone: TEST_MEMBER.memberPhone,
    staffId: TEST_MEMBER.staffId,
    staffName: TEST_MEMBER.staffName,
    lectureDate: lessonDate,
    lectureStartAt: Timestamp.fromDate(lessonStart),
    lectureEndAt: Timestamp.fromDate(lessonEnd),
    lessonType: "private",
    sourceStatus: "live_validation",
    appStatus: "reserved",
    attendanceStatus: "attended",
    ticketName: "프라이빗 라이브 검증권",
    ticketClassType: "프라이빗",
    ticketType: "private",
    sessionOrder: {
      category: "private",
      privateCumulativeRound: 1,
      counted: true,
      computedFrom: "live_validation",
      computedAt: now,
    },
    lastChangedBy: "codex:media-live-validation",
    sourceHash: requestId,
    sourceUpdatedAt: now,
    syncedAt: now,
    updatedAt: now,
  };
  const chartRequest = {
    requestId,
    studioId: "5330",
    bookingId,
    lectureId: bookingId,
    memberId: TEST_MEMBER.memberId,
    memberName: TEST_MEMBER.memberName,
    memberPhone: TEST_MEMBER.memberPhone,
    memberPhoneLast4: TEST_MEMBER.memberPhone.slice(-4),
    staffId: TEST_MEMBER.staffId,
    staffName: TEST_MEMBER.staffName,
    staffPhone: TEST_MEMBER.staffPhone,
    lessonDate,
    lessonStartAt: Timestamp.fromDate(lessonStart),
    lessonEndAt: Timestamp.fromDate(lessonEnd),
    sessionNumber: 1,
    accessTokenHash: tokenHash,
    preUrl: chartUrl("pre", requestId, token),
    postUrl: chartUrl("post", requestId, token),
    mediaUploadUrl: chartUrl("post", requestId, token, { focus: "media" }),
    status: "pending",
    preStatus: "pending",
    postStatus: "pending",
    alimtalk: { status: "skipped", templateName: "live media validation", lastError: null },
    intakeSummary: {
      goal: "라이브 검증",
      focusArea: "호흡과 정렬",
      painOrMedicalNote: "특이사항 없음",
      exerciseLevel: "운영 테스트",
    },
    createdAt: now,
    updatedAt: now,
  };
  await db.collection("bookings").doc(bookingId).set(booking);
  await db.collection("privateLessonChartRequests").doc(requestId).set(chartRequest);
  return { ...chartRequest, token, bookingId };
}

async function uploadMediaFile(request, file) {
  const init = await postChartAction({
    action: "initMediaUpload",
    requestId: request.requestId,
    token: request.token,
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.buffer.length,
  });
  const chunkSize = Number(init.chunkSize || 16 * 1024 * 1024);
  if (init.directUpload?.uploadUrl) {
    try {
      const direct = await uploadMediaFileDirect(request, file, init, chunkSize);
      return { ...direct, uploadMode: "drive_direct", chunkSize };
    } catch (error) {
      console.warn(`direct upload failed; falling back to function proxy: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const fallback = await uploadMediaFileViaFunction(request, file, init, chunkSize);
  return { ...fallback, uploadMode: "function_proxy", chunkSize };
}

async function uploadMediaFileDirect(request, file, init, chunkSize) {
  let offset = 0;
  let driveFile = null;
  while (offset < file.buffer.length) {
    const endExclusive = Math.min(offset + chunkSize, file.buffer.length);
    const response = await fetch(init.directUpload.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.mimeType,
        "Content-Range": `bytes ${offset}-${endExclusive - 1}/${file.buffer.length}`,
      },
      body: file.buffer.subarray(offset, endExclusive),
    });
    if (response.status === 308) {
      const range = response.headers.get("range") || "";
      const match = range.match(/bytes=0-(\d+)/i);
      offset = match ? Number(match[1]) + 1 : endExclusive;
      continue;
    }
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok || !json.id) {
      throw new Error(json?.error?.message || `Drive direct upload failed ${response.status}`);
    }
    driveFile = json;
    offset = file.buffer.length;
  }
  return await postChartAction({
    action: "completeMediaUpload",
    requestId: request.requestId,
    token: request.token,
    uploadId: init.uploadId,
    driveFile,
  });
}

async function uploadMediaFileViaFunction(request, file, init, chunkSize) {
  let offset = 0;
  let result = null;
  while (offset < file.buffer.length) {
    const endExclusive = Math.min(offset + chunkSize, file.buffer.length);
    result = await postChartAction({
      action: "uploadMediaChunk",
      requestId: request.requestId,
      token: request.token,
      uploadId: init.uploadId,
      start: offset,
      end: endExclusive - 1,
      total: file.buffer.length,
      chunkBase64: file.buffer.subarray(offset, endExclusive).toString("base64"),
    });
    offset = Number(result.bytesUploaded || endExclusive);
  }
  return result;
}

function createTinyVideoBuffer() {
  const filePath = path.join(tmpDir, "codex-live-validation.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:d=0.5",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      filePath,
    ],
    { stdio: "pipe" },
  );
  return readFileSync(filePath);
}

async function postChartAction(body) {
  const response = await fetch(PRIVATE_CHART_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(`privateChart API failed ${response.status}: ${json.error || JSON.stringify(json)}`);
  }
  return json;
}

async function postChartActionWithRetry(body, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await postChartAction(body);
    } catch (error) {
      lastError = error;
      const retryable = /503|high demand|temporar/i.test(error instanceof Error ? error.message : String(error));
      if (!retryable || attempt >= options.attempts) break;
      await sleep(options.retryMs);
    }
  }
  throw lastError;
}

async function fetchText(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`report fetch failed ${response.status}: ${text.slice(0, 200)}`);
  return text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readRecord(requestId) {
  const snap = await db.collection("privateLessonChartRecords").doc(requestId).get();
  return snap.exists ? snap.data() : null;
}

async function cleanupValidationDocs(request) {
  const now = Timestamp.now();
  const batch = db.batch();
  batch.set(
    db.collection("bookings").doc(request.bookingId),
    {
      appStatus: "cancel",
      attendanceStatus: "cancel",
      sourceStatus: "live_validation_cancelled",
      sessionOrder: {
        category: "private",
        cumulativeRound: null,
        privateCumulativeRound: null,
        counted: false,
        excludedReason: "live_validation_cleanup",
        computedFrom: "live_validation_cleanup",
        computedAt: now,
      },
      updatedAt: now,
    },
    { merge: true },
  );
  batch.set(
    db.collection("privateLessonChartRequests").doc(request.requestId),
    { status: "cancelled", cancellationReason: "live_validation_cleanup", cancelledAt: now, updatedAt: now },
    { merge: true },
  );
  batch.set(
    db.collection("privateLessonChartRecords").doc(request.requestId),
    { sessionStatus: "cancelled", cancellationReason: "live_validation_cleanup", cancelledAt: now, updatedAt: now },
    { merge: true },
  );
  await batch.commit();
  return { status: "excluded", reason: "live_validation_cleanup" };
}

function preAnswers() {
  return {
    goals: ["라이브 검증", "호흡 안정"],
    focusAreas: ["흉곽", "골반 정렬"],
    equipment: ["리포머"],
    intensity: "중간",
    cautions: ["통증 유발 동작 피하기"],
    memo: "미디어 업로드 라이브 검증용 수업 전 계획입니다.",
  };
}

function postAnswers() {
  return {
    condition: "안정적",
    painChange: "불편감 변화 없음",
    focusAreas: ["호흡", "중심 안정"],
    equipment: ["리포머"],
    changes: ["사진과 영상이 리포트에 함께 연결되는지 확인"],
    movementObservations: ["흉곽 호흡이 자연스럽게 이어짐"],
    memberResponses: ["동작 이해가 좋았음"],
    nextMemo: "다음 수업에서는 호흡과 골반 정렬을 이어서 확인합니다.",
  };
}

function chartUrl(mode, requestId, token, extra = {}) {
  const url = new URL(PRIVATE_CHART_PAGE_URL);
  url.searchParams.set("mode", mode);
  url.searchParams.set("r", requestId);
  url.searchParams.set("t", token);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url.toString();
}

function accessTokenFor(requestId) {
  return createHmac("sha256", webhookSecret).update(`private-chart:${requestId}`).digest("hex").slice(0, 16);
}

function tokenHashFor(token) {
  return createHmac("sha256", webhookSecret).update(token).digest("hex");
}

function kstDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function hasArg(name) {
  return process.argv.includes(name);
}
