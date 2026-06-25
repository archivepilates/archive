#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createSign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
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
const FIREBASE_REGION = process.env.FIREBASE_REGION || "asia-northeast3";
const PRIVATE_CHART_RECONCILE_SCHEDULER_JOB =
  process.env.PRIVATE_CHART_RECONCILE_SCHEDULER_JOB ||
  "firebase-schedule-scheduledReconcileCurrentMonthPrivateLessonCharts-asia-northeast3";
const config = {
  operatorEmail: process.env.ARCHIVE_OPERATOR_EMAIL || "home@archivepilates.com",
  delegatedUser: process.env.GOOGLE_DELEGATED_USER || "home@archivepilates.com",
  googleCredentialsPath:
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json",
};

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
    steps.push(
      runCommandStep(
        "privateChartReconcileNow",
        [
          "gcloud",
          "scheduler",
          "jobs",
          "run",
          PRIVATE_CHART_RECONCILE_SCHEDULER_JOB,
          "--location",
          FIREBASE_REGION,
          "--project",
          PROJECT_ID,
        ],
        { optional: true },
      ),
    );
  }
}

const failed = steps.filter((step) => step.exitCode && step.exitCode !== 0 && !step.optional);
const warnings = steps.filter((step) => step.stdoutOk === false || step.requiredFailed || (step.optional && step.exitCode));
const maintenanceOnly = failed.length > 0 && failed.every(isStudioMateMaintenanceStep);
const sourceImportIds = steps
  .map((step) => (step.stdout && typeof step.stdout === "object" ? step.stdout.sourceImportId : ""))
  .filter(Boolean);
const sourceFileCleanup = await cleanupDownloadedCounterparts();
const summary = {
  ok: failed.length === 0 || maintenanceOnly,
  mode: apply ? "apply" : "dry-run",
  download,
  source: "studiomate_excel_emergency_mode",
  skippedImports: maintenanceOnly
    ? "StudioMate maintenance window; next scheduled run will retry"
    : downloadFailedWithoutMember
      ? "download failed or produced no member Excel file"
      : "",
  maintenanceOnly,
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
  status: maintenanceOnly ? "maintenance" : failed.length ? "failed" : warnings.length ? "warning" : "healthy",
  lastResult: maintenanceOnly
    ? maintenanceResultText(failed)
    : failed.length
    ? `${failed.length}개 단계 실패: ${failed.map((step) => step.name).join(", ")}`
    : warnings.length
      ? `${warnings.length}개 단계 확인 필요: ${warnings.map((step) => step.name).join(", ")}`
      : `${apply ? "apply" : "dry-run"} 완료 · ${steps.length}단계`,
  sourceImportIds,
  runId: path.basename(reportPath, ".json"),
  warnings: [
    maintenanceOnly ? maintenanceResultText(failed) : "",
    !maintenanceOnly && downloadFailedWithoutMember ? "download failed or produced no member Excel file" : "",
    ...warnings.map((step) => `${step.name}: ok=false`),
    ...steps.filter((step) => step.stderr).map((step) => `${step.name}: ${step.stderr.slice(0, 180)}`),
  ].filter(Boolean),
});
console.log(JSON.stringify({ ...summary, reportPath }, null, 2));
if (failed.length && !maintenanceOnly) {
  if (apply) {
    try {
      await sendFailureEmail({ summary, failed, reportPath });
    } catch (err) {
      console.error(`failure email send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  process.exitCode = 1;
}

function isStudioMateMaintenanceStep(step) {
  const stdout = step.stdout && typeof step.stdout === "object" ? step.stdout : {};
  const errorText = [
    stdout.error,
    stdout.errorCode,
    stdout.maintenance?.message,
    stdout.maintenance?.startTime,
    stdout.maintenance?.endTime,
    step.stderr,
  ]
    .filter(Boolean)
    .join(" ");
  return /STUDIOMATE_MAINTENANCE|서비스\s*점검중|service\s*maintenance/i.test(errorText);
}

function maintenanceResultText(steps) {
  const maintenance = steps.map((step) => step.stdout?.maintenance).find(Boolean);
  const windowText = maintenance ? [maintenance.startTime, maintenance.endTime].filter(Boolean).join(" ~ ") : "";
  return `StudioMate 점검중으로 회원동기화 보류${windowText ? ` (${windowText})` : ""}`;
}

function runStep(name, command) {
  return runCommandStep(name, [process.execPath, ...command]);
}

function runCommandStep(name, command, options = {}) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    name,
    command,
    exitCode: result.status ?? 0,
    stdout: parseJsonOrText(result.stdout),
    stderr: String(result.stderr || result.error?.message || "").trim(),
    stdoutOk: parsedOk(result.stdout),
    requiredFailed: name === "memberProfiles" && parsedOk(result.stdout) === false,
    optional: Boolean(options.optional),
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

async function sendFailureEmail({ summary, failed, reportPath }) {
  const subject = `[회원동기화][실패] 엑셀 다운로드/import 중단 · ${formatKoreaDate(new Date())}`;
  const failedLines = failed.map((step) => {
    const reason =
      step.stderr ||
      (step.stdout && typeof step.stdout === "object" ? step.stdout.error || step.stdout.skippedImports || "" : String(step.stdout || ""));
    return `- ${step.name}: exitCode=${step.exitCode}${reason ? ` / ${String(reason).slice(0, 220)}` : ""}`;
  });
  const body = [
    "주체: ARCHIVE IN / StudioMate 엑셀 회원동기화 LaunchAgent",
    "결론: StudioMate 회원목록 다운로드 또는 회원정보/연락처 import가 실패했습니다.",
    "",
    "핵심:",
    `- 모드: ${summary.mode}`,
    `- 다운로드 포함: ${summary.download ? "예" : "아니오"}`,
    `- 실패 단계: ${failed.map((step) => step.name).join(", ")}`,
    "- 외부 발송/알림톡은 실행하지 않았습니다.",
    "",
    "검증:",
    `- 실행 리포트: ${reportPath}`,
    "",
    "실패 상세:",
    ...failedLines,
    "",
    "주의:",
    "- 신규등록 회원의 Firestore 반영이 다음 성공 실행까지 지연될 수 있습니다.",
    "",
    "다음:",
    "- StudioMate 로그인 상태, 브라우저 다운로드 상태, Firebase 권한을 확인한 뒤 같은 명령을 재실행하세요.",
  ].join("\n");
  const accessToken = await googleAccessToken([
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
  ]);
  const raw = Buffer.from(
    [
      `From: ARCHIVE IN <${config.delegatedUser}>`,
      `To: ${config.operatorEmail}`,
      `Subject: ${encodeMimeHeader(subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
    ].join("\r\n"),
  ).toString("base64url");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Gmail failure email send failed ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  if (data.id) {
    await applyGmailLabels(accessToken, data.id, ["동기화 보고", "자동화 실패"]);
  }
}

async function googleAccessToken(scopes) {
  const key = JSON.parse(await readFile(config.googleCredentialsPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: key.client_email,
      scope: scopes.join(" "),
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
      sub: config.delegatedUser,
    },
    key.private_key,
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google token failed ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token;
}

async function applyGmailLabels(accessToken, messageId, names) {
  const labelsResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const labelsData = await labelsResponse.json();
  if (!labelsResponse.ok) {
    throw new Error(`Gmail labels list failed ${labelsResponse.status}: ${JSON.stringify(labelsData).slice(0, 300)}`);
  }
  const labels = new Map((labelsData.labels || []).map((label) => [label.name, label.id]));
  const labelIds = [];
  for (const name of names) {
    labelIds.push(labels.get(name) || (await createGmailLabel(accessToken, name)));
  }
  const modifyResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ addLabelIds: labelIds.filter(Boolean) }),
  });
  if (!modifyResponse.ok) {
    throw new Error(`Gmail labels apply failed ${modifyResponse.status}: ${(await modifyResponse.text()).slice(0, 300)}`);
  }
}

async function createGmailLabel(accessToken, name) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Gmail label create failed ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.id;
}

function signJwt(header, payload, privateKey) {
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(privateKey, "base64url")}`;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function formatKoreaDate(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  }).format(date);
}
