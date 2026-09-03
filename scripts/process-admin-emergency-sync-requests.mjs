#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { writeIdleHeartbeatIfDue } from "./lib/idle-heartbeat.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const NODE = process.execPath;
const REPORT_DIR = path.join(os.homedir(), "ArchiveIN/automation/reports/admin-emergency-sync");
const MAX_REQUESTS = Number(process.env.ADMIN_EMERGENCY_SYNC_MAX_REQUESTS || "1");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

mkdirSync(REPORT_DIR, { recursive: true });

const processed = [];

for (let index = 0; index < MAX_REQUESTS; index += 1) {
  const claimed = await claimNextRequest();
  if (!claimed) break;
  processed.push(await processRequest(claimed));
}

const summary = {
  ok: processed.every((item) => item.ok),
  source: "archivein_admin_emergency_excel_sync_runner",
  processed,
  finishedAt: new Date().toISOString(),
};

if (processed.length) {
  writeReport(summary);
  console.log(JSON.stringify(summary, null, 2));
} else {
  writeIdleHeartbeatIfDue(
    path.join(REPORT_DIR, "idle-heartbeat.json"),
    summary,
    30 * 60 * 1000,
  );
}
if (!summary.ok) process.exitCode = 1;

async function claimNextRequest() {
  const snap = await db
    .collection("adminSyncRequests")
    .where("status", "==", "pending")
    .limit(20)
    .get();
  const docSnap = snap.docs
    .filter((item) => item.data()?.requestMode === "emergency_excel")
    .sort((a, b) => timestampMillis(a.data()?.createdAt) - timestampMillis(b.data()?.createdAt))[0];
  if (!docSnap) return null;

  const ref = docSnap.ref;
  return await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return null;
    const data = fresh.data() || {};
    if (data.status !== "pending" || data.requestMode !== "emergency_excel") return null;
    tx.set(
      ref,
      {
        status: "running",
        progressPercent: 8,
        progressLabel: "맥미니 엑셀 동기화 시작",
        startedAt: FieldValue.serverTimestamp(),
        claimedBy: os.hostname(),
        lastError: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { id: ref.id, ref, data };
  });
}

async function processRequest(request) {
  const { ref, id } = request;
  const steps = [];
  try {
    await updateProgress(ref, 15, "스튜디오메이트 엑셀 다운로드 준비");
    const result = runEmergencyExcelMode();
    steps.push(result);
    if (result.exitCode !== 0 || result.stdout?.ok === false) {
      throw new Error(result.stderr || result.stdout?.error || "엑셀 동기화 실패");
    }
    await updateProgress(ref, 96, "앱 데이터 반영 완료 확인");
    await ref.set(
      {
        status: "success",
        progressPercent: 100,
        progressLabel: "동기화 완료",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        result: result.stdout || {},
        lastError: null,
      },
      { merge: true },
    );
    return { id, ok: true, result: result.stdout || {} };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ref.set(
      {
        status: "error",
        progressPercent: 100,
        progressLabel: "동기화 실패",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastError: message,
        result: { steps },
      },
      { merge: true },
    );
    return { id, ok: false, error: message, steps };
  }
}

function runEmergencyExcelMode() {
  const result = spawnSync(NODE, ["scripts/run-studiomate-excel-emergency-mode.mjs", "--download", "--apply"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 96 * 1024 * 1024,
  });
  return {
    name: "run-studiomate-excel-emergency-mode",
    command: [NODE, "scripts/run-studiomate-excel-emergency-mode.mjs", "--download", "--apply"],
    exitCode: result.status ?? 0,
    stdout: parseJsonOrText(result.stdout),
    stderr: String(result.stderr || "").trim(),
  };
}

async function updateProgress(ref, progressPercent, progressLabel) {
  await ref.set(
    {
      progressPercent,
      progressLabel,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
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

function writeReport(payload) {
  const reportPath = path.join(REPORT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-admin-emergency-sync.json`);
  writeFileSync(reportPath, `${JSON.stringify({ ...payload, reportPath }, null, 2)}\n`);
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
}
