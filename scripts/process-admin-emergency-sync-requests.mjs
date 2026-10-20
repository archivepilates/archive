#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { writeIdleHeartbeatIfDue } from "./lib/idle-heartbeat.mjs";
import { observeStudioMateNotifications } from "./observe-studiomate-notifications.mjs";
import { recordNotificationIngressHealth } from "./lib/studiomate-notification-health.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const NODE = process.execPath;
const REPORT_DIR = path.join(os.homedir(), "ArchiveIN/automation/reports/admin-emergency-sync");
const MAX_REQUESTS = Number(process.env.ADMIN_EMERGENCY_SYNC_MAX_REQUESTS || "1");
const SUPPORTED_REQUEST_MODES = new Set([
  "emergency_excel",
  "membership_contract_readback",
]);

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

mkdirSync(REPORT_DIR, { recursive: true });

const processed = [];

// Reuse this existing timer. Notification hints can request canonical refresh, never sends.
let notificationIngress = null;
if (process.env.STUDIOMATE_NOTIFICATION_INGRESS === "enabled") {
  try { notificationIngress = await observeStudioMateNotifications({ apply: true }); }
  catch { notificationIngress = { ok: false, status: 'review', code: 'NOTIFICATION_OBSERVER_CLEANUP_FAILED' }; }
}
if (notificationIngress) {
  try { await recordNotificationIngressHealth(db, notificationIngress); }
  catch { console.error('알림 감지 상태 기록 확인 필요. 기존 요청 처리는 계속합니다.'); }
}

for (let index = 0; index < MAX_REQUESTS; index += 1) {
  const claimed = await claimNextRequest();
  if (!claimed) break;
  processed.push(await processRequest(claimed));
}

const summary = {
  ok: processed.every((item) => item.ok),
  source: "archivein_admin_emergency_excel_sync_runner",
  processed,
  ...(notificationIngress ? { notificationIngress } : {}),
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
    .filter((item) => SUPPORTED_REQUEST_MODES.has(item.data()?.requestMode))
    .sort((a, b) => timestampMillis(a.data()?.createdAt) - timestampMillis(b.data()?.createdAt))[0];
  if (!docSnap) return null;

  const ref = docSnap.ref;
  return await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return null;
    const data = fresh.data() || {};
    if (data.status !== "pending" || !SUPPORTED_REQUEST_MODES.has(data.requestMode))
      return null;
    tx.set(
      ref,
      {
        status: "running",
        progressPercent: 8,
        progressLabel:
          data.requestMode === "membership_contract_readback"
            ? "계약 원본 재확인 시작"
            : "맥미니 엑셀 동기화 시작",
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
    if (request.data.requestMode === "membership_contract_readback") {
      const contractId = String(request.data.contractId || "");
      if (!/^[a-f0-9]{64}$/.test(contractId))
        throw new Error("유효하지 않은 계약 원본 재확인 요청");
      await updateProgress(ref, 20, "회원·수강권·결제 원본 재확인");
      const result = runMembershipContractReadback(contractId);
      steps.push(result);
      if (
        result.exitCode !== 0 ||
        result.stdout?.status !== "checked" ||
        result.stdout?.review > 0 ||
        result.stdout?.checked !== 1
      )
        throw new Error(
          result.stderr ||
            result.stdout?.reason ||
            "계약 원본 재확인 실패",
        );
      await ref.set(
        {
          status: "success",
          progressPercent: 100,
          progressLabel: "계약 원본 재확인 완료",
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          result: result.stdout,
          lastError: null,
        },
        { merge: true },
      );
      return { id, ok: true, result: result.stdout };
    }
    await updateProgress(ref, 15, "스튜디오메이트 엑셀 다운로드 준비");
    const result = runEmergencyExcelMode(request.data.source === 'studiomate-notification-hints-v1');
    steps.push(result);
    if (result.stdout?.skipped === 'excel_sync_already_running') {
      await ref.set({ status: 'pending', progressPercent: 0, progressLabel: '기존 동기화 종료 대기',
        updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { id, ok: true, deferred: true };
    }
    if (result.exitCode !== 0 || result.stdout?.ok !== true || !['success', 'partial'].includes(result.stdout?.status)) {
      throw new Error(result.stderr || result.stdout?.error || "엑셀 동기화 실패");
    }
    await updateProgress(ref, 96, "앱 데이터 반영 완료 확인");
    await ref.set(
      {
        status: result.stdout.status === 'partial' ? 'error' : 'success',
        progressPercent: 100,
        progressLabel: result.stdout.status === 'partial' ? '동기화 일부 확인 필요' : '동기화 완료',
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        result: result.stdout || {},
        lastError: result.stdout.status === 'partial' ? '동기화 일부 단계 확인 필요. 결과의 steps를 확인하세요.' : null,
      },
      { merge: true },
    );
    return { id, ok: result.stdout.status !== 'partial', partial: result.stdout.status === 'partial', result: result.stdout || {} };
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

function runEmergencyExcelMode(notificationRefresh = false) {
  const command = ["scripts/run-studiomate-excel-emergency-mode.mjs", "--download", "--apply",
    ...(notificationRefresh ? ['--notification-refresh'] : [])];
  const result = spawnSync(NODE, command, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 96 * 1024 * 1024,
  });
  return {
    name: "run-studiomate-excel-emergency-mode",
    command: [NODE, ...command],
    exitCode: result.error || result.signal ? 1 : result.status ?? 1,
    stdout: parseJsonOrText(result.stdout),
    stderr: String(result.stderr || "").trim(),
  };
}

function runMembershipContractReadback(contractId) {
  const result = spawnSync(
    NODE,
    [
      "scripts/process-studiomate-membership-contract-completions.mjs",
      "--apply",
      "--contract-id",
      contractId,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        STUDIOMATE_MEMBERSHIP_CONTRACT_COMPLETION: "enabled",
      },
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return {
    name: "membership-contract-readback",
    command: [
      NODE,
      "scripts/process-studiomate-membership-contract-completions.mjs",
      "--apply",
      "--contract-id",
      contractId,
    ],
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
