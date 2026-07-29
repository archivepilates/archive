#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const APPLY = process.argv.includes("--apply");
const MAX_LOG_BYTES = 20 * 1024 * 1024;
const RETAIN_LOG_BYTES = 2 * 1024 * 1024;

const result = {
  ok: true,
  mode: APPLY ? "apply" : "dry-run",
  source: "operational_artifact_retention",
  emptyAdminReports: pruneEmptyAdminReports(),
  jsonlCompaction: [
    compactJsonl(path.join(HOME, "ArchiveIN/emergency/runs/onsite-welcome.jsonl")),
    compactJsonl(path.join(HOME, "ArchiveIN/emergency/runs/studiomate-memo-write.jsonl")),
  ],
  logTrims: [
    trimLargeLog(path.join(HOME, "ArchiveIN/emergency/logs/archivein-admin-emergency-sync.out.log")),
    trimLargeLog(path.join(HOME, "ArchiveIN/emergency/logs/onsite-welcome-requests.out.log")),
    trimLargeLog(path.join(HOME, "ArchiveIN/automation/logs/studiomate-memo-write-queue.out.log")),
    trimLargeLog(path.join(HOME, "ArchiveIN/emergency/logs/studiomate-excel-emergency-mode.out.log")),
  ],
  finishedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));

function pruneEmptyAdminReports() {
  const dir = path.join(HOME, "ArchiveIN/automation/reports/admin-emergency-sync");
  if (!existsSync(dir)) return { directory: dir, candidates: 0, deleted: 0, bytes: 0 };
  let candidates = 0;
  let deleted = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name === "idle-heartbeat.json") continue;
    const filePath = path.join(dir, name);
    let payload;
    try {
      payload = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    if (payload?.ok !== true || !Array.isArray(payload?.processed) || payload.processed.length !== 0) continue;
    candidates += 1;
    bytes += statSync(filePath).size;
    if (APPLY) {
      unlinkSync(filePath);
      deleted += 1;
    }
  }
  return { directory: dir, candidates, deleted, bytes };
}

function compactJsonl(filePath) {
  if (!existsSync(filePath)) return { filePath, rows: 0, retained: 0, removed: 0, bytesSaved: 0 };
  const source = readFileSync(filePath, "utf8");
  const lines = source.split("\n").filter(Boolean);
  const retained = [];
  let latestIdle = "";
  for (const line of lines) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      retained.push(line);
      continue;
    }
    const hasWork =
      payload?.ok === false ||
      Number(payload?.processed || 0) > 0 ||
      Number(payload?.failed || 0) > 0 ||
      (Array.isArray(payload?.jobs) && payload.jobs.length > 0) ||
      (Array.isArray(payload?.requests) && payload.requests.length > 0);
    if (hasWork) retained.push(line);
    else latestIdle = line;
  }
  if (latestIdle) retained.push(latestIdle);
  const next = retained.length ? `${retained.join("\n")}\n` : "";
  if (APPLY && next !== source) writeFileSync(filePath, next);
  return {
    filePath,
    rows: lines.length,
    retained: retained.length,
    removed: lines.length - retained.length,
    bytesSaved: Math.max(0, Buffer.byteLength(source) - Buffer.byteLength(next)),
  };
}

function trimLargeLog(filePath) {
  if (!existsSync(filePath)) return { filePath, trimmed: false, bytesSaved: 0 };
  const size = statSync(filePath).size;
  if (size <= MAX_LOG_BYTES) return { filePath, trimmed: false, size, bytesSaved: 0 };
  const source = readFileSync(filePath);
  const start = Math.max(0, source.length - RETAIN_LOG_BYTES);
  const newline = source.indexOf(0x0a, start);
  const next = source.subarray(newline >= 0 ? newline + 1 : start);
  if (APPLY) writeFileSync(filePath, next);
  return {
    filePath,
    trimmed: APPLY,
    size,
    retainedBytes: next.length,
    bytesSaved: size - next.length,
  };
}
