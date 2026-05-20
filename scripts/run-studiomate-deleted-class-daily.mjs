#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const download = args.has("--download");
const file = valueArg("--file");
const reportDir = path.join(os.homedir(), "ArchiveIN/automation/reports/deleted-class-daily");

const steps = [];
let downloadedFile = "";

if (download) {
  const downloadStep = runStep("downloadDeletedClass", [
    "scripts/emergency-download-studiomate-excels.mjs",
    "--kind",
    "deleted-class",
    ...(apply ? ["--apply"] : ["--dry-run"]),
  ]);
  steps.push(downloadStep);
  downloadedFile =
    downloadStep.stdout?.downloads?.deletedClass?.archivePath ||
    downloadStep.stdout?.downloads?.deletedClass?.stagingPath ||
    "";
}

if (!download || apply || file || downloadedFile) {
  steps.push(
    runStep("importDeletedClassLogs", [
      "scripts/emergency-import-studiomate-deleted-class-excel.mjs",
      ...(file || downloadedFile ? ["--file", file || downloadedFile] : []),
      ...(apply ? ["--apply"] : []),
    ]),
  );
} else {
  steps.push({
    name: "importDeletedClassLogs",
    skipped: true,
    reason: "dry-run download does not create a file",
  });
}

const failed = steps.filter((step) => (step.exitCode && step.exitCode !== 0) || step.requiredFailed);
const summary = {
  ok: failed.length === 0,
  mode: apply ? "apply" : "dry-run",
  download,
  source: "studiomate_deleted_class_daily",
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
    maxBuffer: 64 * 1024 * 1024,
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
  const parsed = parseJsonOrText(value);
  return parsed && typeof parsed === "object" && "ok" in parsed ? parsed.ok : undefined;
}
