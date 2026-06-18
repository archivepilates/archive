#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const PRIVATE_CHART_API_URL = process.env.PRIVATE_CHART_API_URL || "https://in.archivepilates.com/api/privateChart";
const PRIVATE_CHART_PAGE_URL = process.env.PRIVATE_CHART_PAGE_URL || "https://in.archivepilates.com/private-chart/";
const OUT_DIR = "artifacts/private-report-edit-live-validation";
const TEST_MEMBER = {
  memberId: "1982133",
  memberName: "김기효",
  memberPhone: "01086488585",
  staffId: "1982133",
  staffName: "김기효",
  staffPhone: "01086488585",
};

const confirmed = hasArg("--confirm-live-alimtalk-test");
const triggerQueue = hasArg("--send");
const webhookSecret = process.env.PRIVATE_SURVEY_WEBHOOK_SECRET || "";
const runId = new Date().toISOString().replace(/[:.]/g, "-");

if (!confirmed) throw new Error("Refusing live validation without --confirm-live-alimtalk-test.");
if (!webhookSecret) throw new Error("PRIVATE_SURVEY_WEBHOOK_SECRET is required.");
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const queuedBefore = await queuedCandidates();
if (queuedBefore.length) {
  throw new Error(`Refusing to trigger queue while ${queuedBefore.length} queued/processing candidates exist.`);
}

const request = await createTestRequest();
const pre = await postChartAction({
  requestId: request.requestId,
  token: request.token,
  mode: "pre",
  answers: preAnswers(),
});
const post = await postChartAction({
  requestId: request.requestId,
  token: request.token,
  mode: "post",
  answers: postAnswers(),
});
const convert = await postChartAction({
  requestId: request.requestId,
  token: request.token,
  action: "convertReport",
});
const approveBeforeEdit = await postChartAction({
  requestId: request.requestId,
  token: request.token,
  action: "approveReport",
});
const candidateAfterFirstApprove = await readCandidate(request.requestId);
const edit = await postChartAction({
  requestId: request.requestId,
  token: request.token,
  action: "editReport",
  summary: "라이브 검증: 오늘의 핵심 문장을 발송 전 직접 수정했습니다.",
  nextDirection: "라이브 검증: 다음 수업에서는 호흡과 골반 정렬을 이어서 확인합니다.",
});
const candidateAfterEdit = await readCandidate(request.requestId);
const approveAfterEdit = await postChartAction({
  requestId: request.requestId,
  token: request.token,
  action: "approveReport",
});
const candidateAfterSecondApprove = await readCandidate(request.requestId);

let queueTriggered = false;
if (triggerQueue) {
  execFileSync(
    "gcloud",
    [
      "scheduler",
      "jobs",
      "run",
      "firebase-schedule-scheduledProcessAlimtalkQueue-asia-northeast3",
      "--location=asia-northeast3",
    ],
    { stdio: "inherit" },
  );
  queueTriggered = true;
}

const finalCandidate = triggerQueue
  ? await pollCandidate(`private_lesson_report_${request.requestId}`)
  : await readCandidate(request.requestId);
const sentLocked = triggerQueue ? await expectEditLocked(request) : { ok: null, skipped: true };
const finalRecord = await readRecord(request.requestId);
const pageState = await readChartPageState(request);
const cleanup = await cleanupValidationDocs(request);

const final = {
  ok:
    candidateAfterFirstApprove.status === "queued" &&
    candidateAfterEdit.status === "skipped" &&
    candidateAfterEdit.reasonCode === "private_report_edited_before_send" &&
    candidateAfterSecondApprove.status === "queued" &&
    !candidateAfterSecondApprove.reasonCode &&
    (!triggerQueue ||
      (finalCandidate.status === "sent" && !finalCandidate.reasonCode && sentLocked.ok === true && pageState.locked === true)),
  projectId: PROJECT_ID,
  generatedAt: new Date().toISOString(),
  apiUrl: PRIVATE_CHART_API_URL,
  requestId: request.requestId,
  bookingId: request.bookingId,
  recipient: {
    memberId: TEST_MEMBER.memberId,
    memberName: TEST_MEMBER.memberName,
    phoneLast4: TEST_MEMBER.memberPhone.slice(-4),
  },
  queueTriggered,
  steps: {
    pre,
    post,
    convert,
    approveBeforeEdit,
    edit,
    approveAfterEdit,
  },
  candidates: {
    afterFirstApprove: publicCandidate(candidateAfterFirstApprove),
    afterEdit: publicCandidate(candidateAfterEdit),
    afterSecondApprove: publicCandidate(candidateAfterSecondApprove),
    final: publicCandidate(finalCandidate),
  },
  sentLocked,
  pageState: {
    locked: pageState.locked,
    lockedReason: pageState.lockedReason,
    reportSent: pageState.report?.sent || false,
    reportCanEdit: pageState.report?.canEdit ?? null,
  },
  record: publicRecord(finalRecord),
  cleanup,
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `${runId}.json`);
writeFileSync(outPath, JSON.stringify(final, null, 2));
console.log(JSON.stringify({ ok: final.ok, outPath, requestId: request.requestId, candidates: final.candidates, sentLocked }, null, 2));
if (!final.ok) process.exitCode = 1;

async function createTestRequest() {
  const requestId = `plc_editval-${runId.slice(0, 10).replaceAll("-", "")}-${runId.slice(11, 17).replaceAll("-", "")}`;
  const bookingId = `live_validation_${requestId}`;
  const token = accessTokenFor(requestId);
  const tokenHash = tokenHashFor(token);
  const lessonStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
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
    memberRegisteredAt: null,
    staffId: TEST_MEMBER.staffId,
    staffName: TEST_MEMBER.staffName,
    lectureDate: lessonDate,
    lectureStartAt: Timestamp.fromDate(lessonStart),
    lectureEndAt: Timestamp.fromDate(lessonEnd),
    lessonType: "private",
    sourceStatus: "live_validation",
    appStatus: "reserved",
    attendanceStatus: "attended",
    syncStatus: "synced",
    ticketName: "프라이빗 라이브 검증권",
    ticketClassType: "프라이빗",
    ticketType: "private",
    ticketRemainingCount: 1,
    ticketExpiresAt: null,
    ticketExpiryLevel: "normal",
    sessionOrder: {
      category: "private",
      privateCumulativeRound: 1,
      counted: true,
      computedFrom: "live_validation",
      computedAt: now,
    },
    memberTagIds: [],
    lastMemoPreview: "",
    lastMemoAt: null,
    lastChangedBy: "codex:live-validation",
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
    preShortUrl: "",
    postShortUrl: "",
    mediaUploadShortUrl: "",
    status: "pending",
    preStatus: "pending",
    postStatus: "pending",
    alimtalk: {
      status: "skipped",
      templateName: "live validation",
      lastError: null,
    },
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

async function expectEditLocked(request) {
  const response = await fetch(PRIVATE_CHART_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: request.requestId,
      token: request.token,
      action: "editReport",
      summary: "발송 후 수정 시도",
      nextDirection: "발송 후 수정 시도",
    }),
  });
  const json = await response.json().catch(() => ({}));
  return {
    ok: response.status >= 400 && /발송 완료 후에는/.test(String(json.error || "")),
    status: response.status,
    error: json.error || "",
  };
}

async function readChartPageState(request) {
  const url = new URL(PRIVATE_CHART_API_URL);
  url.searchParams.set("r", request.requestId);
  url.searchParams.set("t", request.token);
  url.searchParams.set("mode", "post");
  const response = await fetch(url);
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(`privateChart GET failed ${response.status}: ${json.error || JSON.stringify(json)}`);
  }
  return json;
}

async function readCandidate(requestId) {
  const candidateId = `private_lesson_report_${requestId}`;
  const snap = await db.collection("alimtalkCandidates").doc(candidateId).get();
  return { candidateId, ...(snap.data() || {}) };
}

async function pollCandidate(candidateId) {
  const deadline = Date.now() + 120000;
  let row = {};
  while (Date.now() < deadline) {
    const snap = await db.collection("alimtalkCandidates").doc(candidateId).get();
    row = { candidateId, ...(snap.data() || {}) };
    if (["sent", "failed", "skipped"].includes(String(row.status || ""))) return row;
    await sleep(4000);
  }
  return row;
}

async function queuedCandidates() {
  const snap = await db.collection("alimtalkCandidates").where("status", "in", ["queued", "processing"]).limit(50).get();
  return snap.docs.map((doc) => ({ candidateId: doc.id, ...(doc.data() || {}) }));
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
      sessionOrderCorrection: {
        fromPrivateCumulativeRound: 1,
        toPrivateCumulativeRound: null,
        fromCounted: true,
        toCounted: false,
        reason: "live validation cleanup",
        correctedAt: now,
      },
      updatedAt: now,
    },
    { merge: true },
  );
  batch.set(
    db.collection("privateLessonChartRequests").doc(request.requestId),
    {
      status: "cancelled",
      cancellationReason: "live_validation_cleanup",
      cancelledAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
  batch.set(
    db.collection("privateLessonChartRecords").doc(request.requestId),
    {
      sessionStatus: "cancelled",
      cancellationReason: "live_validation_cleanup",
      cancelledAt: now,
      updatedAt: now,
    },
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
    memo: "발송 전 수정 플로우 검증용 수업 전 계획입니다.",
  };
}

function postAnswers() {
  return {
    condition: "안정적",
    painChange: "불편감 변화 없음",
    focusAreas: ["호흡", "중심 안정"],
    equipment: ["리포머"],
    changes: ["움직임 흐름이 안정적으로 기록됨"],
    movementObservations: ["흉곽 호흡이 자연스럽게 이어짐"],
    memberResponses: ["동작 이해가 좋았음"],
    nextMemo: "다음 수업에서는 호흡과 골반 정렬을 이어서 확인합니다.",
  };
}

function publicCandidate(candidate) {
  return {
    candidateId: candidate.candidateId || "",
    type: candidate.type || "",
    status: candidate.status || "",
    memberName: candidate.memberName || "",
    phoneLast4: String(candidate.memberPhone || "").slice(-4),
    templateCode: candidate.templateCode || "",
    solapiMessageId: candidate.solapiMessageId || "",
    reasonCode: candidate.reasonCode || "",
    lastError: candidate.lastError || null,
  };
}

function publicRecord(record) {
  return record
    ? {
      recordId: record.recordId || "",
      gptStatus: record.gptStatus || "",
      reportApprovalStatus: record.publicReportApproval?.status || "",
      reportUrl: record.publicReportUrl || record.publicReportCanonicalUrl || "",
      manualReportEdit: record.manualReportEdit || null,
      summary: record.publicSummary || "",
      nextDirection: record.publicNextDirection || "",
    }
    : null;
}

function chartUrl(mode, requestId, token) {
  const url = new URL(PRIVATE_CHART_PAGE_URL);
  url.searchParams.set("mode", mode);
  url.searchParams.set("r", requestId);
  url.searchParams.set("t", token);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasArg(name) {
  return process.argv.includes(name);
}
