#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const DEFAULT_CREDENTIALS = "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json";
const RESPONSES_CSV_URL =
  process.env.STAFF_EVAL_GOOGLE_RESPONSES_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1wLKPhBzsUNV4g288vWyCgTKi5ZDIU4q3Cu3MHFMpFbI/export?format=csv&gid=455637576";
const QUIZ_ID = "archive-instructor-evaluation-v1";
const LEGACY_QUIZ_VERSION = "google-form-2026-04";
const QUIZ_TITLE = "ARCHIVE 강사평가 퀴즈 A";
const PASS_SCORE = 80;

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(DEFAULT_CREDENTIALS)) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_CREDENTIALS;
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const csv = await fetchText(RESPONSES_CSV_URL);
const rows = parseCsv(csv);
const [headers, ...bodyRows] = rows;
if (!headers?.length) throw new Error("Google Form 응답 CSV 헤더를 찾지 못했습니다.");

const staffs = await loadStaffs();
const importPlans = [];
const skipped = [];

for (const row of bodyRows) {
  const name = clean(row[3]);
  const scoreText = clean(row[2]);
  if (!name || !scoreText) continue;
  const score = parseScore(scoreText);
  if (!score) {
    skipped.push({ name, reason: "score_parse_failed", scoreText });
    continue;
  }
  const submittedAtDate = parseKoreanTimestamp(clean(row[0])) || new Date();
  const submittedAt = admin.firestore.Timestamp.fromDate(submittedAtDate);
  const staff = matchStaff(name, staffs);
  const staffId = staff?.staffId || `legacy_${shortHash(name).slice(0, 12)}`;
  const submissionId = `google_form_staff_eval_a_${shortHash(`${name}|${row[0]}|${row[1]}|${scoreText}`).slice(0, 16)}`;
  const submissionRef = db.collection("staffEvaluationSubmissions").doc(submissionId);
  const existingSubmission = await submissionRef.get();
  if (existingSubmission.exists) {
    skipped.push({ name, staffId, submissionId, reason: "already_imported" });
    continue;
  }

  const answersRaw = buildAnswers(headers, row);
  const status = score.scorePercent >= PASS_SCORE ? "passed" : "review_needed";
  importPlans.push({
    name,
    staffId,
    staffMatched: Boolean(staff),
    submissionId,
    submittedAt,
    submittedAtText: clean(row[0]),
    email: clean(row[1]),
    experience: clean(row[4]),
    score,
    status,
    answersRaw,
    sourceRow: row,
  });
}

const summary = {
  ok: true,
  mode: apply ? "apply" : "dry-run",
  source: "google_form_archive_instructor_evaluation_a",
  projectId: PROJECT_ID,
  studioId: STUDIO_ID,
  rowsRead: bodyRows.filter((row) => clean(row[3])).length,
  plannedImports: importPlans.length,
  skipped: skipped.length,
  unmatchedStaffs: importPlans.filter((plan) => !plan.staffMatched).map((plan) => plan.name),
  plannedScores: importPlans.map((plan) => ({
    name: plan.name,
    staffId: plan.staffId,
    matched: plan.staffMatched,
    scorePercent: plan.score.scorePercent,
    googleScore: plan.score.original,
    status: plan.status,
  })),
  keyNotes: [
    "과거 Google Form 결과는 공식 응답 점수를 보존해 이관합니다.",
    "현재 Firebase 퀴즈는 공개 Form 문항을 기준으로 새 정답키를 사용합니다.",
    "과거 응답에는 Q9 선택지 버전 차이와 Q20 정답키 입력 오류 흔적이 있어 재채점하지 않습니다.",
  ],
};

if (apply && importPlans.length) {
  await applyImports(importPlans);
}

console.log(JSON.stringify(summary, null, 2));

async function applyImports(plans) {
  for (const plan of plans) {
    const now = admin.firestore.Timestamp.now();
    const cardRef = db.collection("staffHrCards").doc(plan.staffId);
    const submissionRef = db.collection("staffEvaluationSubmissions").doc(plan.submissionId);
    const cardResultRef = cardRef.collection("quizResults").doc(plan.submissionId);
    const cardSnap = await cardRef.get();
    const current = cardSnap.data() || {};
    const currentLatestAt = timestampMs(current.latestQuiz?.submittedAt);
    const importedAt = timestampMs(plan.submittedAt);
    const shouldReplaceLatest = !currentLatestAt || importedAt >= currentLatestAt;
    const previousBest = Number(current.quizSummary?.bestScorePercent || 0);
    const previousAttempts = Number(current.quizSummary?.attempts || 0);
    const submission = {
      submissionId: plan.submissionId,
      studioId: STUDIO_ID,
      staffId: plan.staffId,
      staffName: plan.name,
      staffRole: "instructor",
      quizId: QUIZ_ID,
      quizVersion: LEGACY_QUIZ_VERSION,
      quizTitle: QUIZ_TITLE,
      source: "google_form_legacy_import",
      sourceSpreadsheetId: "1wLKPhBzsUNV4g288vWyCgTKi5ZDIU4q3Cu3MHFMpFbI",
      sourceSheetName: "설문지 응답 시트1",
      legacyGoogleForm: true,
      legacyGoogleScoreText: plan.score.original,
      status: plan.status,
      scorePercent: plan.score.scorePercent,
      earnedPointTotal: plan.score.earned,
      scoredPointTotal: plan.score.total,
      passScore: PASS_SCORE,
      staffMatched: plan.staffMatched,
      submittedEmail: plan.email,
      staffExperience: plan.experience,
      submittedAt: plan.submittedAt,
      submittedAtText: plan.submittedAtText,
      answersRaw: plan.answersRaw,
      keyReviewNotes: [
        "Google Form 공식 점수를 보존한 과거 결과입니다.",
        "Q9/Q20은 과거 Form 문항/정답키 이슈가 있어 Firebase 최신 정답키로 재채점하지 않았습니다.",
      ],
      updatedAt: now,
      importedAt: now,
    };
    const cardPatch = {
      staffId: plan.staffId,
      staffName: plan.name,
      staffRole: "instructor",
      studioId: STUDIO_ID,
      active: current.active ?? plan.staffMatched,
      source: "staff_evaluation_google_form_import",
      quizSummary: {
        attempts: previousAttempts + 1,
        bestScorePercent: Math.max(previousBest, plan.score.scorePercent),
        lastScorePercent: shouldReplaceLatest ? plan.score.scorePercent : current.quizSummary?.lastScorePercent || plan.score.scorePercent,
        lastStatus: shouldReplaceLatest ? plan.status : current.quizSummary?.lastStatus || plan.status,
        lastSubmittedAt: shouldReplaceLatest ? plan.submittedAt : current.quizSummary?.lastSubmittedAt || plan.submittedAt,
      },
      updatedAt: now,
      createdAt: current.createdAt || now,
    };
    if (shouldReplaceLatest) {
      cardPatch.latestQuiz = {
        submissionId: plan.submissionId,
        quizId: QUIZ_ID,
        quizVersion: LEGACY_QUIZ_VERSION,
        quizTitle: QUIZ_TITLE,
        source: "google_form_legacy_import",
        scorePercent: plan.score.scorePercent,
        earnedPointTotal: plan.score.earned,
        scoredPointTotal: plan.score.total,
        status: plan.status,
        submittedAt: plan.submittedAt,
        submittedByName: "Google Form legacy import",
      };
    }

    const batch = db.batch();
    batch.set(submissionRef, submission, { merge: true });
    batch.set(cardResultRef, submission, { merge: true });
    batch.set(cardRef, cardPatch, { merge: true });
    batch.set(
      db.collection("auditLogs").doc(`staff_eval_import_${plan.submissionId}`),
      {
        auditId: `staff_eval_import_${plan.submissionId}`,
        studioId: STUDIO_ID,
        type: "staff_evaluation_google_form_imported",
        staffId: plan.staffId,
        staffName: plan.name,
        scorePercent: plan.score.scorePercent,
        source: "google_form_archive_instructor_evaluation_a",
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    await batch.commit();
  }
}

async function loadStaffs() {
  const snap = await db.collection("staffs").where("studioId", "==", STUDIO_ID).get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      staffId: data.staffId || doc.id,
      name: clean(data.name),
      active: data.active !== false,
      role: data.role || "instructor",
    };
  });
}

function matchStaff(name, staffs) {
  const normalized = normalizeName(name);
  return (
    staffs.find((staff) => staff.active && normalizeName(staff.name) === normalized) ||
    staffs.find((staff) => normalizeName(staff.name) === normalized) ||
    null
  );
}

function buildAnswers(headers, row) {
  const answers = [];
  for (let index = 5; index <= 26; index += 1) {
    const questionTitle = clean(headers[index]);
    if (!questionTitle) continue;
    answers.push({
      questionId: questionTitle.match(/^Q(\d+)/)?.[1] ? `q${questionTitle.match(/^Q(\d+)/)?.[1].padStart(2, "0")}` : `col_${index}`,
      questionTitle,
      answerText: clean(row[index]),
    });
  }
  return answers;
}

function parseScore(value) {
  const match = String(value || "").match(/([\d.]+)\s*\/\s*([\d.]+)/);
  if (!match) return null;
  const earned = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(earned) || !Number.isFinite(total) || total <= 0) return null;
  return {
    original: value,
    earned,
    total,
    scorePercent: Math.round((earned / total) * 100),
  };
}

function parseKoreanTimestamp(value) {
  const match = String(value || "").match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*(오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, meridiem, hourText, minute, second] = match;
  let hour = Number(hourText);
  if (meridiem === "오전" && hour === 12) hour = 0;
  if (meridiem === "오후" && hour < 12) hour += 12;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hour - 9, Number(minute), Number(second)));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google Sheet CSV fetch failed: ${response.status} ${response.statusText}`);
  return response.text();
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeName(value) {
  return clean(value).replace(/\s+/g, "");
}

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function shortHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
