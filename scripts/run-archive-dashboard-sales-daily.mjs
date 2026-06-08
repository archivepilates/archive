#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const syncFirebase = args.has("--sync-firebase");
const skipDownload = args.has("--skip-download");
const cleanupClosedMonths = !args.has("--no-cleanup-closed-months");
const month = valueArg("--month");
const startDate = valueArg("--start-date");
const endDate = valueArg("--end-date");

const reportDir = path.join(os.homedir(), "ArchiveIN/automation/reports/archive-dashboard-sales-daily");
const steps = [];

if (!skipDownload) {
  steps.push(
    runStep("downloadSalesExcels", [
      "scripts/download-studiomate-sales-excels.mjs",
      "--kind",
      "all",
      ...(month ? [`--month=${month}`] : []),
      ...(startDate ? [`--start-date=${startDate}`] : []),
      ...(endDate ? [`--end-date=${endDate}`] : []),
      ...(cleanupClosedMonths ? ["--cleanup-closed-months"] : []),
      ...(apply ? ["--apply"] : ["--dry-run"]),
    ]),
  );
}

const downloadFailed = steps.some((step) => step.name === "downloadSalesExcels" && !parsedOk(step.stdout));
const shouldRunDbSync = skipDownload || apply;
if (!downloadFailed && shouldRunDbSync) {
  steps.push(
    runStep("syncArchiveDashboardDb", [
      "scripts/sync-archive-dashboard-db.mjs",
      ...(month ? [`--month=${month}`] : []),
      ...(apply ? ["--apply"] : []),
      ...(apply && syncFirebase ? ["--sync-firebase"] : []),
    ]),
  );
}

const failed = steps.filter((step) => (step.exitCode && step.exitCode !== 0) || step.requiredFailed);
const summary = {
  ok: failed.length === 0,
  mode: apply ? "apply" : "dry-run",
  source: "archive_dashboard_sales_daily",
  skippedDbSync: downloadFailed ? "sales Excel download failed" : shouldRunDbSync ? "" : "dry-run download does not create source Excel files",
  steps,
  finishedAt: new Date().toISOString(),
};

mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-run-${apply ? "apply" : "dry-run"}.json`);
writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, reportPath }, null, 2));
if (failed.length) process.exitCode = 1;

function runStep(name, command) {
  const result = spawnSync(process.execPath, command, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    name,
    command: [process.execPath, ...command],
    exitCode: result.status ?? 0,
    stdout: parseJsonOrText(result.stdout),
    stderr: result.stderr.trim(),
    requiredFailed: parsedOk(result.stdout) === false,
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
  if (value && typeof value === "object" && "ok" in value) return value.ok;
  const parsed = parseJsonOrText(value);
  return parsed && typeof parsed === "object" && "ok" in parsed ? parsed.ok : undefined;
}
