#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { recordAutomationStatus } from "./lib/archive-core-ops-logging.mjs";
import { cleanupImportedSourceFiles } from "./lib/imported-source-retention.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const download = args.has("--download");
const reservationFile = valueArg("--reservation-file");
const memberFile = valueArg("--member-file");
const reportDir = path.join(os.homedir(), "ArchiveIN/automation/reports/excel-emergency-mode");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || "5330";
const FIREBASE_REGION = process.env.FIREBASE_REGION || "asia-northeast3";
const GCLOUD = process.env.GCLOUD_BIN || "/opt/homebrew/bin/gcloud";
const PRIVATE_CHART_RECONCILE_SCHEDULER_JOB =
  process.env.PRIVATE_CHART_RECONCILE_SCHEDULER_JOB ||
  "firebase-schedule-scheduledReconcileCurrentMonthPrivateLessonCharts-asia-northeast3";

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const steps = [];
let downloadedMemberFile = "";
let downloadedReservationFile = "";
let downloadedDeletedClassFile = "";

let downloadFailedWithoutMember = false;
if (download) {
  const downloadStep = runStep("download", [
    "scripts/emergency-download-studiomate-excels.mjs",
    "--kind",
    "all",
    ...(apply ? ["--apply"] : ["--dry-run"]),
  ]);
  steps.push(downloadStep);
  downloadedMemberFile = downloadStep.stdout?.downloads?.member?.archivePath || downloadStep.stdout?.downloads?.member?.stagingPath || "";
  downloadedReservationFile =
    downloadStep.stdout?.downloads?.reservation?.archivePath || downloadStep.stdout?.downloads?.reservation?.stagingPath || "";
  downloadedDeletedClassFile =
    downloadStep.stdout?.downloads?.deletedClass?.archivePath || downloadStep.stdout?.downloads?.deletedClass?.stagingPath || "";
  downloadFailedWithoutMember = apply && !downloadedMemberFile;
}

if (!downloadFailedWithoutMember) {
  steps.push(
    runStep("memberProfiles", [
      "scripts/emergency-import-studiomate-member-excel.mjs",
      ...(memberFile || downloadedMemberFile ? ["--file", memberFile || downloadedMemberFile] : []),
      "--allow-new-excel-profiles",
      "--queue-contact-sync",
      ...(apply ? ["--apply"] : []),
    ]),
  );

  steps.push(
    runStep("memberPhoneDedupe", [
      "scripts/reconcile-member-phone-duplicates.mjs",
      ...(apply ? ["--apply"] : []),
    ]),
  );

  steps.push(
    runStep("reservations", [
      "scripts/emergency-import-studiomate-reservation-excel.mjs",
      ...(reservationFile || downloadedReservationFile ? ["--file", reservationFile || downloadedReservationFile] : []),
      ...(apply ? ["--apply"] : []),
    ]),
  );

  if (downloadedDeletedClassFile) {
    steps.push(
      runStep("deletedClassLogs", [
        "scripts/emergency-import-studiomate-deleted-class-excel.mjs",
        "--file",
        downloadedDeletedClassFile,
        ...(apply ? ["--apply"] : []),
      ]),
    );
  }

  if (apply) {
    const trigger = runCommandStep("privateChartReconcileTrigger", [
      GCLOUD,
      "scheduler",
      "jobs",
      "run",
      PRIVATE_CHART_RECONCILE_SCHEDULER_JOB,
      "--location",
      FIREBASE_REGION,
      "--project",
      PROJECT_ID,
    ]);
    steps.push(trigger);
    if (trigger.exitCode === 0) {
      const reservationStep = steps.find((step) => step.name === "reservations");
      steps.push(await waitForPrivateChartReconcile(reservationStep?.stdout?.dateRange));
    }
  }
}

const failed = steps.filter((step) => step.exitCode && step.exitCode !== 0);
const warnings = steps.filter((step) => step.stdoutOk === false || step.requiredFailed);
const sourceImportIds = steps
  .map((step) => (step.stdout && typeof step.stdout === "object" ? step.stdout.sourceImportId : ""))
  .filter(Boolean);
const sourceFileCleanup = await cleanupDownloadedCounterparts();
const summary = {
  ok: failed.length === 0,
  mode: apply ? "apply" : "dry-run",
  download,
  source: "studiomate_excel_emergency_mode",
  skippedImports: downloadFailedWithoutMember ? "download failed or produced no member Excel file" : "",
  sourceImportIds,
  sourceFileCleanup,
  steps,
  finishedAt: new Date().toISOString(),
};

mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-run-${apply ? "apply" : "dry-run"}.json`);
writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
await recordAutomationStatus(db, {
  automationId: "studiomate-excel-sync",
  title: "StudioMate Excel sync",
  ownerArea: "studiomate",
  status: failed.length ? "failed" : warnings.length ? "warning" : "healthy",
  lastResult: failed.length
    ? `${failed.length}개 단계 실패: ${failed.map((step) => step.name).join(", ")}`
    : warnings.length
      ? `${warnings.length}개 단계 확인 필요: ${warnings.map((step) => step.name).join(", ")}`
    : `${apply ? "apply" : "dry-run"} 완료 · ${steps.length}단계`,
  sourceImportIds,
  runId: path.basename(reportPath, ".json"),
  warnings: [
    downloadFailedWithoutMember ? "download failed or produced no member Excel file" : "",
    ...warnings.map((step) => `${step.name}: ok=false`),
    ...steps.filter((step) => step.stderr).map((step) => `${step.name}: ${step.stderr.slice(0, 180)}`),
  ].filter(Boolean),
});
console.log(JSON.stringify({ ...summary, reportPath }, null, 2));
if (failed.length) process.exitCode = 1;

function runStep(name, command) {
  return runCommandStep(name, [process.execPath, ...command]);
}

function runCommandStep(name, command) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    name,
    command,
    exitCode: result.status ?? (result.error ? 1 : 0),
    stdout: parseJsonOrText(result.stdout),
    stderr: String(result.error?.message || result.stderr || "").trim(),
    stdoutOk: parsedOk(result.stdout),
    requiredFailed: name === "memberProfiles" && parsedOk(result.stdout) === false,
  };
}

async function waitForPrivateChartReconcile(dateRange) {
  const range = currentMonthIntersection(dateRange);
  if (!range) {
    return {
      name: "privateChartReconcileVerify",
      command: ["firestore", "bookings", "sessionOrder"],
      exitCode: 0,
      stdout: { ok: true, skipped: "import range is outside current month" },
      stderr: "",
      stdoutOk: true,
      requiredFailed: false,
    };
  }
  let result = null;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    result = await inspectPrivateSessionOrders(range);
    if (result.ok) break;
    await sleep(3000);
  }
  return {
    name: "privateChartReconcileVerify",
    command: ["firestore", "bookings", "sessionOrder", range.startDate, range.endDate],
    exitCode: result?.ok ? 0 : 1,
    stdout: result || { ok: false, error: "verification did not run" },
    stderr: result?.ok ? "" : "private session order reconcile verification failed",
    stdoutOk: Boolean(result?.ok),
    requiredFailed: !result?.ok,
  };
}

async function inspectPrivateSessionOrders(range) {
  const docs = [];
  for (const date of dateRange(range.startDate, range.endDate)) {
    const snap = await db.collection("bookings").where("studioId", "==", STUDIO_ID).where("lectureDate", "==", date).get();
    docs.push(...snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })));
  }
  const privateDocs = docs.filter((doc) => isPrivateBooking(doc.data));
  const countable = privateDocs.filter((doc) => !isExcludedPrivateBooking(doc.data));
  const excluded = privateDocs.filter((doc) => isExcludedPrivateBooking(doc.data));
  const missingOrder = countable.filter((doc) => !positiveNumber(doc.data?.sessionOrder?.privateCumulativeRound));
  const excludedWithOrder = excluded.filter((doc) => positiveNumber(doc.data?.sessionOrder?.privateCumulativeRound));
  const duplicateRounds = duplicatePrivateRounds(countable);
  return {
    ok: missingOrder.length === 0 && excludedWithOrder.length === 0 && duplicateRounds.length === 0,
    startDate: range.startDate,
    endDate: range.endDate,
    privateBookings: privateDocs.length,
    missingOrder: missingOrder.length,
    excludedWithOrder: excludedWithOrder.length,
    duplicateRounds: duplicateRounds.length,
    sourceRefs: [
      ...missingOrder.slice(0, 5).map((doc) => `bookings/${doc.id}`),
      ...excludedWithOrder.slice(0, 5).map((doc) => `bookings/${doc.id}`),
      ...duplicateRounds.slice(0, 5).map((doc) => `bookings/${doc.id}`),
    ],
  };
}

function currentMonthIntersection(input) {
  const startDate = String(input?.startDate || "");
  const endDate = String(input?.endDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const currentMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const monthStart = `${currentMonth}-01`;
  const monthEndDate = new Date(`${monthStart}T00:00:00+09:00`);
  monthEndDate.setMonth(monthEndDate.getMonth() + 1);
  monthEndDate.setDate(0);
  const monthEnd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(monthEndDate);
  const intersectStart = startDate > monthStart ? startDate : monthStart;
  const intersectEnd = endDate < monthEnd ? endDate : monthEnd;
  return intersectStart <= intersectEnd ? { startDate: intersectStart, endDate: intersectEnd } : null;
}

function dateRange(startDate, endDate) {
  const result = [];
  const cursor = new Date(`${startDate}T00:00:00+09:00`);
  const end = new Date(`${endDate}T00:00:00+09:00`);
  while (cursor <= end) {
    result.push(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function isPrivateBooking(data) {
  const text = [data?.lessonType, data?.ticketClassType, data?.ticketName, data?.title, data?.lectureTitle, data?.divisionName]
    .join(" ")
    .toLowerCase();
  return /private|semi_private|프라이빗|개인|1:1|세미/.test(text);
}

function isExcludedPrivateBooking(data) {
  if (data?.sessionOrder?.counted === false) return true;
  if (["cancel", "wait", "wait_cancel", "superseded"].includes(String(data?.appStatus || ""))) return true;
  if (["cancelled", "canceled", "superseded"].includes(String(data?.status || ""))) return true;
  return ["absent", "late_cancel"].includes(String(data?.attendanceStatus || ""));
}

function duplicatePrivateRounds(bookings) {
  const byKey = new Map();
  for (const doc of bookings) {
    const round = positiveNumber(doc.data?.sessionOrder?.privateCumulativeRound);
    if (!round) continue;
    const key = `${doc.data.memberId || doc.data.memberPhone || doc.data.memberName}|${round}`;
    byKey.set(key, [...(byKey.get(key) || []), doc]);
  }
  return [...byKey.values()].filter((items) => items.length > 1).flat();
}

function positiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function valueArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function parseJsonOrText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parsedOk(value) {
  const parsed = parseJsonOrText(value);
  return parsed && typeof parsed === "object" && "ok" in parsed ? parsed.ok : undefined;
}

async function cleanupDownloadedCounterparts() {
  if (!download || !apply) return [];
  const downloadStep = steps.find((step) => step.name === "download");
  const downloads = downloadStep?.stdout?.downloads || {};
  const cleanupTargets = [
    {
      importStep: "memberProfiles",
      kind: "memberProfiles_download_counterparts",
      paths: [downloads.member?.stagingPath, downloads.member?.archivePath],
    },
    {
      importStep: "reservations",
      kind: "bookings_download_counterparts",
      paths: [downloads.reservation?.stagingPath, downloads.reservation?.archivePath],
    },
  ];
  const results = [];
  for (const target of cleanupTargets) {
    const step = steps.find((item) => item.name === target.importStep);
    if (!step || step.exitCode !== 0 || step.stdoutOk === false) continue;
    results.push(
      await cleanupImportedSourceFiles({
        apply,
        db,
        importId: "",
        kind: target.kind,
        paths: target.paths,
      }),
    );
  }
  return results;
}
