#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { recordAutomationStatus } from "./lib/archive-core-ops-logging.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const download = args.has("--download");
const reservationFile = valueArg("--reservation-file");
const memberFile = valueArg("--member-file");
const reportDir = path.join(os.homedir(), "ArchiveIN/automation/reports/excel-emergency-mode");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";

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
      "--new-excel-profile-max-age-days",
      "3",
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
}

const failed = steps.filter((step) => step.exitCode && step.exitCode !== 0);
const warnings = steps.filter((step) => step.stdoutOk === false || step.requiredFailed);
const sourceImportIds = steps
  .map((step) => (step.stdout && typeof step.stdout === "object" ? step.stdout.sourceImportId : ""))
  .filter(Boolean);
const summary = {
  ok: failed.length === 0,
  mode: apply ? "apply" : "dry-run",
  download,
  source: "studiomate_excel_emergency_mode",
  skippedImports: downloadFailedWithoutMember ? "download failed or produced no member Excel file" : "",
  sourceImportIds,
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
  const result = spawnSync(process.execPath, command, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    name,
    command: [process.execPath, ...command],
    exitCode: result.status ?? 0,
    stdout: parseJsonOrText(result.stdout),
    stderr: result.stderr.trim(),
    stdoutOk: parsedOk(result.stdout),
    requiredFailed: name === "memberProfiles" && parsedOk(result.stdout) === false,
  };
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
