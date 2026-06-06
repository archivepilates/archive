#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const NOTION_API_VERSION = "2022-06-28";
const PRIVATE_CHART_API_URL =
  process.env.PRIVATE_CHART_API_URL || "https://in.archivepilates.com/api/privateChart";
const PRIVATE_CHART_PAGE_URL = process.env.PRIVATE_CHART_PAGE_URL || "https://in.archivepilates.com/private-chart/";
const KIM_STAFF_PAGE_ID = "36ed49eae4bf8161a0d3edd9f30643b9";
const OUT_DIR = "artifacts/private-report-live-validation";
const TEST_MEMBER = {
  memberId: "1982133",
  memberName: "김기효",
  memberPhone: "01086488585",
  staffId: "1982133",
  staffName: "김기효",
  staffPhone: "01086488585",
};
const REPORT_TEMPLATE_CODE = "KA01TP260528081225871Fr92FW901Vo";

const runs = Number(valueArg("--runs") || "3");
const confirmed = hasArg("--confirm-live-alimtalk-test");
const triggerQueue = !hasArg("--skip-queue-trigger");
const notionToken = process.env.NOTION_TOKEN || "";
const webhookSecret = process.env.PRIVATE_SURVEY_WEBHOOK_SECRET || "";
const runId = new Date().toISOString().replace(/[:.]/g, "-");

if (!confirmed) throw new Error("Refusing live member Alimtalk validation without --confirm-live-alimtalk-test.");
if (!notionToken) throw new Error("NOTION_TOKEN is required.");
if (!webhookSecret) throw new Error("PRIVATE_SURVEY_WEBHOOK_SECRET is required.");
if (!Number.isFinite(runs) || runs < 1 || runs > 5) throw new Error("--runs must be 1-5.");

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const queuedBefore = await queuedCandidates();
if (queuedBefore.length) {
  throw new Error(`Refusing to trigger queue while ${queuedBefore.length} queued/processing candidates exist.`);
}

const memberPage = await ensureKimTestMemberPage();
const results = [];
for (let index = 1; index <= runs; index += 1) {
  const request = await createTestRequest(index);
  const pre = await postChartAction({
    requestId: request.requestId,
    token: request.token,
    mode: "pre",
    answers: preAnswers(index),
  });
  const post = await postChartAction({
    requestId: request.requestId,
    token: request.token,
    mode: "post",
    answers: postAnswers(index),
  });
  const convert = await postChartAction({
    requestId: request.requestId,
    token: request.token,
    action: "convertReport",
  });
  const approve = await postChartAction({
    requestId: request.requestId,
    token: request.token,
    action: "approveReport",
  });
  results.push({
    requestId: request.requestId,
    sessionNumber: request.sessionNumber,
    memberPageId: memberPage.pageId,
    pre,
    post,
    convert,
    approve,
  });
}

const queuedAfterApprove = await queuedCandidates();
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
}

const finalCandidates = await pollCandidates(results.map((row) => `private_lesson_report_${row.requestId}`));
const finalRecords = await Promise.all(results.map((row) => readRecord(row.requestId)));
const final = {
  ok: finalCandidates.every((row) => row.status === "sent") &&
    finalRecords.every(
      (row) =>
        row?.notionSync?.status === "synced" &&
        row?.notionSync?.instructorPageId &&
        row?.gptStatus === "published" &&
        row?.publicReportApproval?.status === "sent",
    ),
  projectId: PROJECT_ID,
  generatedAt: new Date().toISOString(),
  apiUrl: PRIVATE_CHART_API_URL,
  recipient: {
    memberId: TEST_MEMBER.memberId,
    memberName: TEST_MEMBER.memberName,
    phoneLast4: TEST_MEMBER.memberPhone.slice(-4),
  },
  memberPage,
  queuedBefore: queuedBefore.length,
  queuedAfterApprove: queuedAfterApprove.map(publicCandidate),
  candidates: finalCandidates.map(publicCandidate),
  records: finalRecords.map((record) => ({
    recordId: record?.recordId || "",
    sessionNumber: record?.sessionNumber || null,
    gptStatus: record?.gptStatus || "",
    reportApproval: record?.publicReportApproval?.status || "",
    reportUrl: record?.publicReportUrl || record?.publicReportCanonicalUrl || "",
    notionStatus: record?.notionSync?.status || "",
    notionPageId: record?.notionSync?.pageId || "",
    instructorPageId: record?.notionSync?.instructorPageId || "",
    instructorPageUrl: record?.notionSync?.instructorPageUrl || "",
  })),
  steps: results,
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `${runId}.json`);
writeFileSync(outPath, JSON.stringify(final, null, 2));
console.log(JSON.stringify({ ok: final.ok, outPath, candidates: final.candidates, records: final.records }, null, 2));
if (!final.ok) process.exitCode = 1;

async function createTestRequest(index) {
  const requestId = `plc_liveval-${runId.slice(0, 10).replaceAll("-", "")}-${runId.slice(11, 17).replaceAll("-", "")}-${index}`;
  const token = accessTokenFor(requestId);
  const tokenHash = tokenHashFor(token);
  const lessonStart = new Date(Date.now() + (index + 1) * 60 * 60 * 1000);
  const lessonDate = kstDate(lessonStart);
  const sessionNumber = index;
  const preUrl = chartUrl("pre", requestId, token);
  const postUrl = chartUrl("post", requestId, token);
  const now = Timestamp.now();
  const doc = {
    requestId,
    studioId: "5330",
    bookingId: `live_validation_${requestId}`,
    lectureId: `live_validation_${requestId}`,
    memberId: TEST_MEMBER.memberId,
    memberName: TEST_MEMBER.memberName,
    memberPhone: TEST_MEMBER.memberPhone,
    memberPhoneLast4: TEST_MEMBER.memberPhone.slice(-4),
    staffId: TEST_MEMBER.staffId,
    staffName: TEST_MEMBER.staffName,
    staffPhone: TEST_MEMBER.staffPhone,
    lessonDate,
    lessonStartAt: Timestamp.fromDate(lessonStart),
    lessonEndAt: Timestamp.fromDate(new Date(lessonStart.getTime() + 50 * 60 * 1000)),
    sessionNumber,
    accessTokenHash: tokenHash,
    preUrl,
    postUrl,
    preShortUrl: "",
    postShortUrl: "",
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
  await db.collection("privateLessonChartRequests").doc(requestId).set(doc);
  return { ...doc, token };
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

async function readRecord(requestId) {
  const snap = await db.collection("privateLessonChartRecords").doc(requestId).get();
  return snap.exists ? snap.data() : null;
}

async function queuedCandidates() {
  const snap = await db.collection("alimtalkCandidates").where("status", "in", ["queued", "processing"]).limit(50).get();
  return snap.docs.map((doc) => ({ candidateId: doc.id, ...(doc.data() || {}) }));
}

async function pollCandidates(candidateIds) {
  const deadline = Date.now() + 120000;
  let rows = [];
  while (Date.now() < deadline) {
    rows = [];
    for (const candidateId of candidateIds) {
      const snap = await db.collection("alimtalkCandidates").doc(candidateId).get();
      rows.push({ candidateId, ...(snap.data() || {}) });
    }
    if (rows.every((row) => ["sent", "failed", "skipped"].includes(String(row.status || "")))) return rows;
    await sleep(4000);
  }
  return rows;
}

async function ensureKimTestMemberPage() {
  const children = await notionChildren(KIM_STAFF_PAGE_ID);
  const existing = children.find((child) => normalizeName(child.child_page?.title || "") === normalizeName("김기효"));
  if (existing?.id) {
    return { pageId: String(existing.id), pageUrl: notionPageUrl(String(existing.id)), created: false };
  }
  const page = await notionRequest("pages", "POST", {
    parent: { page_id: KIM_STAFF_PAGE_ID },
    properties: notionTitle("김기효님"),
    children: [callout("프라이빗 리포트 자동화 라이브 검증용 테스트 수신자 페이지입니다.")],
  });
  return { pageId: String(page.id || ""), pageUrl: String(page.url || notionPageUrl(String(page.id || ""))), created: true };
}

async function notionChildren(pageId) {
  const out = [];
  let cursor = "";
  do {
    const query = cursor ? `?start_cursor=${encodeURIComponent(cursor)}&page_size=100` : "?page_size=100";
    const body = await notionRequest(`blocks/${pageId}/children${query}`, "GET");
    out.push(...(body.results || []));
    cursor = body.has_more ? body.next_cursor : "";
  } while (cursor);
  return out;
}

async function notionRequest(path, method, body) {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Notion API ${path} failed ${response.status}: ${parsed.message || text}`);
  return parsed;
}

function preAnswers(index) {
  return {
    goals: [`${index}차 라이브 검증`, "호흡 안정"],
    focusAreas: ["흉곽", "골반 정렬"],
    equipment: ["리포머", "캐딜락"],
    intensity: "중간",
    cautions: ["통증 유발 동작 피하기"],
    memo: "자동화 라이브 검증용 수업 전 계획입니다.",
  };
}

function postAnswers(index) {
  return {
    condition: "안정적",
    painChange: "불편감 변화 없음",
    focusAreas: ["호흡", "중심 안정"],
    equipment: ["리포머"],
    changes: [`${index}차 검증에서 움직임 흐름이 안정적으로 기록됨`],
    movementObservations: ["흉곽 호흡이 자연스럽게 이어짐"],
    memberResponses: ["동작 이해가 좋았음"],
    nextMemo: "다음 수업에서는 호흡과 골반 정렬을 이어서 확인합니다.",
  };
}

function publicCandidate(candidate) {
  return {
    candidateId: candidate.candidateId,
    type: candidate.type || "",
    status: candidate.status || "",
    memberName: candidate.memberName || "",
    phoneLast4: String(candidate.memberPhone || "").slice(-4),
    templateCode: candidate.templateCode || "",
    solapiMessageId: candidate.solapiMessageId || "",
    lastError: candidate.lastError || null,
  };
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

function notionTitle(value) {
  return { title: [{ text: { content: String(value || "").slice(0, 2000) } }] };
}

function callout(text) {
  return {
    object: "block",
    type: "callout",
    callout: {
      icon: { type: "emoji", emoji: "📎" },
      color: "gray_background",
      rich_text: [{ type: "text", text: { content: String(text || "").slice(0, 2000) } }],
    },
  };
}

function notionPageUrl(pageId) {
  return `https://www.notion.so/${String(pageId || "").replaceAll("-", "")}`;
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, "").replace(/님$/g, "").replace(/\d+$/g, "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function valueArg(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || "";
  const prefix = `${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : "";
}

function hasArg(name) {
  return process.argv.includes(name);
}
