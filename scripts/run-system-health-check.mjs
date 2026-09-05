#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { recordAutomationStatus } from "./lib/archive-core-ops-logging.mjs";
import { shouldApplyOperationalDataPurge } from "./lib/operational-data-retention-policy.mjs";
import { isActionableAlimtalkFailure } from "./lib/system-health-alimtalk.mjs";
import { monthlySettlementIndexPath } from "./lib/system-health-schedule-evidence.mjs";
import {
  canResolveHealthFinding,
  classifyPrivateRoundIssues,
  inspectHeadlessRuntime,
  loadSyncRunEvidence,
  recoveredMainFailureIds,
  unresolvedMainWorkflowFailures,
} from "./lib/system-health-current-state.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const HOME = os.homedir();
const ROOT = process.cwd();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const KEY_FILE =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(HOME, "ArchiveIN/secrets/google/archive-codex-operator.json");
const REPORT_DIR = path.join(HOME, "ArchiveIN/automation/reports/system-health-check");
const PLIST_DIR = path.join(HOME, "Library/LaunchAgents");
const UID = String(process.getuid?.() || execText("id", ["-u"]).trim() || "501");
const GH = process.env.GH_BIN || "/opt/homebrew/bin/gh";
const args = parseArgs(process.argv.slice(2));
const MODE = String(args.mode || "quick");
const READ_ONLY = Boolean(args["read-only"]);
if (READ_ONLY && (args.repair || args.apply || args["purge-operational-data"])) {
  throw new Error("--read-only cannot be combined with mutation flags.");
}
const REPAIR = Boolean(args.repair);
const APPLY = Boolean(args.apply || REPAIR);
const PURGE_OPERATIONAL_DATA = shouldApplyOperationalDataPurge(args);
const NO_EMAIL = READ_ONLY || Boolean(args["no-email"]);
const now = new Date();
const RECENT_FAILURE_MINUTES = 7 * 24 * 60;

process.env.GOOGLE_APPLICATION_CREDENTIALS = KEY_FILE;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const runId = `health_${kstDateTimeCompact(now)}_${MODE}${READ_ONLY ? "_read_only" : ""}`;
const findings = [];
const repairs = [];
const checked = [];
const completedChecks = new Set();
const syncEvidence = new Map();
let headlessRuntime;

const AUTOMATIONS = [
  {
    id: "studiomate-excel-sync",
    label: "com.archive.studiomate-excel-emergency-mode",
    title: "StudioMate Excel sync",
    area: "studiomate",
    reportDir: path.join(HOME, "ArchiveIN/automation/reports/excel-emergency-mode"),
    maxAgeMinutes: 95,
    syncEvidence: true,
    plist: path.join(PLIST_DIR, "com.archive.studiomate-excel-emergency-mode.plist"),
    repair: "kickstart",
  },
  {
    id: "archive-dashboard-db-sync",
    label: "com.archive.archive-dashboard-db-sync",
    title: "ARCHIVE dashboard DB sync",
    area: "settlement",
    reportDir: path.join(HOME, "ArchiveIN/automation/reports/archive-dashboard-sales-daily"),
    maxAgeMinutes: 26 * 60,
    syncEvidence: true,
    plist: path.join(PLIST_DIR, "com.archive.archive-dashboard-db-sync.plist"),
    repair: "kickstart",
  },
  {
    id: "archivein-admin-emergency-sync",
    label: "com.archive.archivein-admin-emergency-sync",
    title: "Admin emergency sync queue",
    area: "studiomate",
    reportDir: path.join(HOME, "ArchiveIN/automation/reports/admin-emergency-sync"),
    maxAgeMinutes: 45,
    plist: path.join(PLIST_DIR, "com.archive.archivein-admin-emergency-sync.plist"),
    repair: "bootstrap",
  },
  {
    id: "onsite-welcome-requests",
    label: "com.archive.onsite-welcome-requests",
    title: "Onsite welcome request queue",
    area: "welcome",
    runLog: path.join(HOME, "ArchiveIN/emergency/runs/onsite-welcome.jsonl"),
    maxAgeMinutes: 45,
    plist: path.join(PLIST_DIR, "com.archive.onsite-welcome-requests.plist"),
    repair: "bootstrap",
  },
  {
    id: "studiomate-memo-write-queue",
    label: "com.archive.studiomate-memo-write-queue",
    title: "StudioMate memo write queue",
    area: "studiomate",
    runLog: path.join(HOME, "ArchiveIN/emergency/runs/studiomate-memo-write.jsonl"),
    maxAgeMinutes: 20,
    plist: path.join(PLIST_DIR, "com.archive.studiomate-memo-write-queue.plist"),
    repair: "bootstrap",
  },
  {
    id: "eformsign-refund-queue",
    label: "com.archive.eformsign-refund-queue",
    title: "eformsign refund agreement queue",
    area: "refunds",
    resultFile: path.join(HOME, "ArchiveIN/automation/reports/eformsign-refund-queue/latest.json"),
    maxAgeMinutes: 45,
    plist: path.join(PLIST_DIR, "com.archive.eformsign-refund-queue.plist"),
    repair: "bootstrap",
  },
  {
    id: "instructor-lesson-registration-queue",
    label: "com.archive.instructor-lesson-registration-queue",
    title: "Instructor lesson registration queue",
    area: "instructor-lessons",
    resultFile: path.join(HOME, "ArchiveIN/automation/reports/instructor-lesson-registration/latest.json"),
    maxAgeMinutes: 45,
    plist: path.join(PLIST_DIR, "com.archive.instructor-lesson-registration-queue.plist"),
    repair: "bootstrap",
  },
  {
    id: "eformsign-instructor-member-queue",
    label: "com.archive.eformsign-instructor-member-queue",
    title: "eformsign instructor member queue",
    area: "instructor-lessons",
    resultFile: path.join(HOME, "ArchiveIN/automation/reports/eformsign-instructor-member/latest.json"),
    maxAgeMinutes: 45,
    plist: path.join(PLIST_DIR, "com.archive.eformsign-instructor-member-queue.plist"),
    repair: "bootstrap",
  },
  {
    id: "studiomate-refund-sms-queue",
    label: "com.archive.studiomate-refund-sms-queue",
    title: "StudioMate refund SMS queue",
    area: "refunds",
    resultFile: path.join(HOME, "ArchiveIN/automation/reports/studiomate-refund-sms/latest.json"),
    maxAgeMinutes: 45,
    plist: path.join(PLIST_DIR, "com.archive.studiomate-refund-sms-queue.plist"),
    repair: "bootstrap",
  },
  {
    id: "monthly-settlement-statements",
    label: "com.archive.monthly-settlement-statements",
    title: "Monthly settlement statements",
    area: "settlement",
    resultFile: monthlySettlementIndexPath(HOME, now),
    maxAgeMinutes: 40 * 24 * 60,
    plist: path.join(PLIST_DIR, "com.archive.monthly-settlement-statements.plist"),
    repair: "none",
  },
  {
    id: "monthly-ticket-liability",
    label: "com.archive.monthly-ticket-liability",
    title: "Monthly ticket liability",
    area: "business",
    resultFile: path.join(HOME, "ArchiveIN/automation/reports/ticket-liability/latest.json"),
    maxAgeMinutes: 35 * 24 * 60,
    plist: path.join(PLIST_DIR, "com.archive.monthly-ticket-liability.plist"),
    repair: "none",
  },
  {
    id: "archive-ai-server",
    label: "com.archive.archive-ai-server",
    title: "Archive AI server",
    area: "service",
    plist: path.join(PLIST_DIR, "com.archive.archive-ai-server.plist"),
    repair: "bootstrap",
    keepAlive: true,
  },
  {
    id: "drive-mcp",
    label: "com.archive.drive-mcp",
    title: "Drive MCP",
    area: "service",
    plist: path.join(PLIST_DIR, "com.archive.drive-mcp.plist"),
    repair: "bootstrap",
    keepAlive: true,
  },
];

await main();

async function main() {
  if (!READ_ONLY) mkdirSync(REPORT_DIR, { recursive: true });
  await refreshRuntimeCheckout();
  checkBrowserRuntime();
  await checkLaunchAgents();
  await checkWebSurfaces();
  await checkAdminAccess();
  await checkQueues();
  await checkPrivateLessonConsistency();
  await checkAlimtalk();
  await checkDataSourceAndReports();
  await checkGitAndCi();
  await runWeeklyArtifactRetention();
  await writeResults();
}

function checkBrowserRuntime() {
  headlessRuntime = inspectHeadlessRuntime(require);
  checked.push({ id: "browser-runtime", ...headlessRuntime });
  completedChecks.add("browser-runtime");
  if (!headlessRuntime.ok) {
    addFinding({
      checkKey: "browser-runtime",
      area: "automation",
      severity: "action_required",
      title: "StudioMate 자동화 브라우저 실행 파일 확인 필요",
      cause: headlessRuntime.error || `실행 파일 없음: ${headlessRuntime.executable}`,
      impact: "예약·회원·매출 다운로드와 브라우저 작업 큐가 실행되지 못할 수 있습니다.",
      suggestedAction: "운영 런타임의 Playwright 버전에 맞는 chromium-headless-shell을 복구하고 실제 조회를 검증하세요. 캐시 정리 시 사용 중인 실행 파일은 보존합니다.",
      sourceRefs: [headlessRuntime.executable || "node_modules/playwright-core"],
      autoRepairable: false,
    });
  }
}

async function refreshRuntimeCheckout() {
  const runtimeRoot = path.join(HOME, "dev/archive-in-runtime");
  if (path.resolve(ROOT) !== runtimeRoot) return;
  if (!READ_ONLY && ["weekly", "deep", "e2e"].includes(MODE)) {
    spawnSync("git", ["fetch", "origin", "main", "--prune"], {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
    });
  }
  const dirty = gitDirty(ROOT);
  const counts = execText("git", ["rev-list", "--left-right", "--count", "HEAD...origin/main"], ROOT)
    .trim()
    .split(/\s+/)
    .map(Number);
  const [ahead = 0, behind = 0] = counts;
  if (!dirty && ahead === 0 && behind > 0 && REPAIR) {
    const update = spawnSync("git", ["merge", "--ff-only", "origin/main"], {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
    });
    const ok = update.status === 0;
    repairs.push({
      findingId: "runtime-checkout-current",
      action: "git merge --ff-only origin/main",
      ok,
      output: String(update.stderr || update.stdout || "").slice(0, 800),
    });
    checked.push({ id: "runtime-checkout", dirty, ahead, behind, repaired: ok });
    if (ok) return;
  } else {
    checked.push({ id: "runtime-checkout", dirty, ahead, behind, repaired: false });
  }
  if (dirty || ahead > 0 || behind > 0) {
    addFinding({
      id: "runtime-checkout-current",
      area: "automation",
      severity: dirty || ahead > 0 ? "action_required" : "warning",
      title: "Mac mini 자동화 런타임이 origin/main과 다름",
      cause: `dirty=${dirty}, ahead=${ahead}, behind=${behind}`,
      impact: "LaunchAgent가 최신 검증 코드를 사용하지 않거나 로컬 전용 변경을 실행할 수 있습니다.",
      suggestedAction: "런타임 전용 변경을 main에 승격한 뒤 깨끗한 origin/main으로 fast-forward하세요.",
      sourceRefs: [runtimeRoot],
      autoRepairable: !dirty && ahead === 0 && behind > 0,
    });
  }
}

async function runWeeklyArtifactRetention() {
  if (READ_ONLY) return;
  if (!["weekly", "deep", "e2e"].includes(MODE)) return;
  const command = ["scripts/prune-operational-artifacts.mjs", ...(APPLY ? ["--apply"] : [])];
  const run = spawnSync(process.execPath, command, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  const payload = safeJson(run.stdout, {});
  checked.push({
    id: "operational-artifact-retention",
    ok: run.status === 0 && payload.ok !== false,
    mode: payload.mode || (APPLY ? "apply" : "dry-run"),
    emptyAdminReports: payload.emptyAdminReports || null,
    jsonlCompaction: payload.jsonlCompaction || [],
    logTrims: payload.logTrims || [],
  });
  if (run.status !== 0 || payload.ok === false) {
    addFinding({
      area: "automation",
      severity: "warning",
      title: "운영 로그 보존 정리 실패",
      cause: String(run.stderr || run.stdout || `exit=${run.status}`).slice(0, 800),
      impact: "빈 실행 보고서와 장기 로그가 계속 누적될 수 있습니다.",
      suggestedAction: "prune-operational-artifacts dry-run 결과와 파일 권한을 확인하세요.",
      sourceRefs: ["scripts/prune-operational-artifacts.mjs"],
      autoRepairable: false,
    });
  }

  const dataCommand = [
    "scripts/purge-expired-operational-data.mjs",
    ...(PURGE_OPERATIONAL_DATA ? ["--apply"] : []),
  ];
  const dataRun = spawnSync(process.execPath, dataCommand, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  const dataPayload = safeJson(dataRun.stdout, {});
  checked.push({
    id: "expired-operational-data-retention",
    ok: dataRun.status === 0 && dataPayload.ok !== false,
    mode: dataPayload.mode || (PURGE_OPERATIONAL_DATA ? "apply" : "dry-run"),
    liveValidation: dataPayload.liveValidation || null,
    mediaUploadSessions: dataPayload.mediaUploadSessions || null,
    unsignedSignupContracts: dataPayload.unsignedSignupContracts || null,
    plannedDeletes: dataPayload.plannedDeletes || 0,
    appliedDeletes: dataPayload.appliedDeletes || 0,
  });
  if (dataRun.status !== 0 || dataPayload.ok === false) {
    addFinding({
      area: "data",
      severity: "warning",
      title: "만료 운영 데이터 정리 실패",
      cause: String(dataRun.stderr || dataRun.stdout || `exit=${dataRun.status}`).slice(0, 800),
      impact: "합성 E2E 문서와 만료된 업로드 세션이 계속 남을 수 있습니다.",
      suggestedAction: "purge-expired-operational-data dry-run 조건과 Firestore 권한을 확인하세요.",
      sourceRefs: ["scripts/purge-expired-operational-data.mjs"],
      autoRepairable: false,
    });
  }
}

async function checkWebSurfaces() {
  const targets = [
    { area: "core", title: "ARCHIVE CORE home", url: "https://core.archivepilates.com/" },
    { area: "core", title: "ARCHIVE CORE staff", url: "https://core.archivepilates.com/staff/" },
    { area: "archivein", title: "ARCHIVE IN domain", url: "https://in.archivepilates.com/" },
    { area: "private", title: "Private survey", url: "https://in.archivepilates.com/privateSurvey/" },
    { area: "private", title: "Private chart", url: "https://in.archivepilates.com/private-chart/" },
    { area: "welcome", title: "Onsite welcome", url: "https://in.archivepilates.com/onsiteWelcome/" },
    { area: "welcome", title: "Member signup", url: "https://in.archivepilates.com/memberSignup/" },
  ];
  const checks = await Promise.all(targets.map(async (target) => {
    const started = Date.now();
    try {
      const response = await fetch(target.url, { redirect: "manual" });
      const text = await response.text().catch(() => "");
      return { ...target, ok: response.status < 500 && response.status !== 404, status: response.status, ms: Date.now() - started, text: text.slice(0, 240) };
    } catch (error) {
      return { ...target, ok: false, status: 0, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  checked.push({ id: "web-surfaces", checks: checks.map(({ text, ...rest }) => rest) });
  for (const check of checks.filter((item) => !item.ok)) {
    addFinding({
      area: check.area,
      severity: "critical",
      title: `${check.title} live route 오류`,
      cause: check.error || `HTTP ${check.status}`,
      impact: "운영자 또는 회원/강사용 페이지 접근이 실패할 수 있습니다.",
      suggestedAction: "최근 Hosting/Functions rewrite 배포와 Firebase target을 확인하세요.",
      sourceRefs: [check.url],
      autoRepairable: false,
    });
  }
}

async function checkAdminAccess() {
  if (READ_ONLY) {
    checked.push({ id: "archivein-admin-access", skipped: "read-only: credential-creating verifier excluded" });
    return;
  }
  if (!["weekly", "deep", "e2e"].includes(MODE)) return;
  const result = spawnSync(process.execPath, ["scripts/verify-archivein-admin-firestore-access.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  checked.push({
    id: "archivein-admin-access",
    ok: result.status === 0,
    code: result.status ?? 1,
    signal: result.signal || "",
    error: result.error?.message || "",
  });
  if (result.status !== 0) {
    addFinding({
      area: "core",
      severity: "critical",
      title: "운영자 Firestore 권한 검증 실패",
      cause: String(result.error?.message || result.stderr || result.stdout || `exit=${result.status} signal=${result.signal || ""}`).slice(0, 800),
      impact: "ARCHIVE CORE 또는 운영 도구에서 필요한 데이터 읽기가 실패할 수 있습니다.",
      suggestedAction: "Firestore rules 배포 상태, 관리자 custom claims, 운영자 read 컬렉션을 함께 확인하세요.",
      sourceRefs: ["scripts/verify-archivein-admin-firestore-access.mjs"],
      autoRepairable: false,
    });
  }
}

async function checkLaunchAgents() {
  for (const item of AUTOMATIONS) {
    const plistExists = existsSync(item.plist);
    const launchState = launchAgentState(item.label);
    const pipeline = item.syncEvidence ? loadSyncRunEvidence(item.reportDir, { nowMs: now.getTime(), maxAgeMinutes: item.maxAgeMinutes }) : null;
    if (pipeline) syncEvidence.set(item.id, pipeline);
    const latest = pipeline ? fileEvidence(pipeline.latestPath || item.reportDir) : latestEvidence(item);
    const stale = pipeline ? pipeline.stale : item.maxAgeMinutes && latest.exists && latest.ageMinutes > item.maxAgeMinutes;
    const missingEvidence = pipeline ? !pipeline.lastSuccessAt : item.maxAgeMinutes && !latest.exists && !item.keepAlive;
    const evidenceAge = pipeline ? pipeline.successAgeMinutes : latest.ageMinutes;
    const checkKey = item.syncEvidence ? `sync:${item.id}` : "";
    if (checkKey) {
      completedChecks.add(checkKey);
      completedChecks.add(`${checkKey}:availability`);
    }

    checked.push({
      id: item.id,
      title: item.title,
      area: item.area,
      launchLoaded: launchState.loaded,
      plistExists,
      evidencePath: latest.path || "",
      evidenceAgeMinutes: latest.ageMinutes ?? null,
      state: launchState.state,
      runs: launchState.runs,
      lastExitCode: launchState.lastExitCode,
      ...(pipeline ? { syncEvidence: pipeline } : {}),
    });

    const executionFailed = Boolean((pipeline?.latestPath && !pipeline.latestAttemptSucceeded) || (launchState.loaded &&
      launchState.state !== "running" &&
      launchState.runs > 0 &&
      launchState.lastExitCode !== null &&
      launchState.lastExitCode !== 0));

    if (!plistExists) {
      addFinding({
        checkKey: checkKey ? `${checkKey}:availability` : "",
        area: item.area,
        severity: "critical",
        title: `${item.title} LaunchAgent plist 없음`,
        cause: `${item.plist} 파일이 없습니다.`,
        impact: `${item.title} 자동화가 스케줄대로 실행되지 않습니다.`,
        suggestedAction: "LaunchAgent plist를 설치하고 launchctl bootstrap을 실행하세요.",
        sourceRefs: [item.plist],
        autoRepairable: false,
      });
      continue;
    }

    if (!launchState.loaded) {
      const repaired = REPAIR && item.repair !== "none" ? repairLaunchAgent(item) : null;
      addFinding({
        checkKey: checkKey ? `${checkKey}:availability` : "",
        area: item.area,
        severity: item.keepAlive ? "critical" : "warning",
        title: `${item.title} LaunchAgent 미로드`,
        cause: launchState.error || "launchctl print에서 서비스를 찾지 못했습니다.",
        impact: `${item.title} 자동화가 실행되지 않을 수 있습니다.`,
        suggestedAction: repaired?.ok ? "자동 reload 후 재검증 필요" : "LaunchAgent를 수동 확인하세요.",
        sourceRefs: [item.plist],
        autoRepairable: item.repair !== "none",
        repairStatus: repaired?.ok ? "repaired" : repaired ? "failed" : "not_attempted",
      });
    }

    if (executionFailed) {
      addFinding({
        checkKey: checkKey ? `${checkKey}:execution` : "",
        area: item.area,
        severity: pipeline && stale ? "action_required" : "warning",
        title: `${item.title} 최근 실행 실패`,
        cause: pipeline?.error || `LaunchAgent last exit code ${launchState.lastExitCode}`,
        impact: pipeline
          ? `마지막 정상 동기화 ${pipeline.lastSuccessAt || "확인 불가"} · 연속 실패 ${pipeline.consecutiveFailures}${pipeline.failureCountIsLowerBound ? "회 이상" : "회"}`
          : `${item.title}의 최근 예약 실행이 정상 완료되지 않았습니다.`,
        suggestedAction: pipeline?.missingBrowserExecutable
          ? headlessRuntime.ok
            ? "브라우저 실행 파일은 현재 존재합니다. 중단 기간을 포함해 동기화를 재실행하고 DB 반영 성공을 확인하세요."
            : "누락된 Playwright 실행 파일을 복구한 뒤 중단 기간을 포함해 동기화를 재실행하세요."
          : "실패 단계와 실행 결과를 확인하고 정상 반영 완료 후 다시 점검하세요.",
        sourceRefs: [latest.path || item.plist],
        autoRepairable: false,
      });
    }

    if (stale || missingEvidence) {
      const repaired = REPAIR && item.repair === "kickstart" && launchState.state !== "running" && headlessRuntime.ok
        ? kickstartLaunchAgent(item) : null;
      addFinding({
        checkKey,
        area: item.area,
        severity: missingEvidence || evidenceAge > item.maxAgeMinutes * 2 ? "action_required" : "warning",
        title: `${item.title} 실행 결과 최신성 확인 필요`,
        cause: missingEvidence
          ? "정상 완료된 실행 결과를 찾지 못했습니다."
          : `마지막 ${pipeline ? "정상 반영 원천" : "결과"}이 ${Math.round(evidenceAge)}분 전입니다.`,
        impact: "후속 데이터나 관제 화면이 오래된 원천을 볼 수 있습니다.",
        suggestedAction: repaired?.ok ? "자동 재실행을 요청했습니다. 다음 Health Check에서 재확인합니다." : "로그와 실행 결과를 확인하세요.",
        sourceRefs: [pipeline?.lastSuccessPath || latest.path || item.reportDir || item.runLog || item.resultFile || item.plist],
        autoRepairable: item.repair === "kickstart",
        repairStatus: repaired?.ok ? "requested" : repaired ? "failed" : "not_attempted",
      });
    }

    if (checkKey) completedChecks.add(`${checkKey}:execution`);
    if (!READ_ONLY) await recordAutomationStatus(db, {
      automationId: item.id,
      title: item.title,
      ownerArea: item.area,
      status: !plistExists || !launchState.loaded || executionFailed ? "failed" : stale || missingEvidence ? "warning" : "healthy",
      lastRunAt: latest.mtimeIso || new Date().toISOString(),
      runId,
      lastResult: !plistExists
        ? "LaunchAgent plist 없음"
        : !launchState.loaded
          ? "LaunchAgent 미로드"
          : executionFailed
            ? `최근 실행 실패${pipeline?.failedStep ? ` · ${pipeline.failedStep}` : ` · exit ${launchState.lastExitCode}`}`
          : stale
            ? `마지막 정상 반영 ${evidenceAge === null ? "확인 불가" : `${Math.round(evidenceAge)}분 전`}`
            : "Health Check 통과",
      warnings: [
        launchState.error,
        executionFailed ? `last exit code ${launchState.lastExitCode}` : "",
        stale ? "stale evidence" : "",
        missingEvidence ? "missing evidence" : "",
        pipeline?.lastSuccessAt ? `last success ${pipeline.lastSuccessAt}` : "",
      ].filter(Boolean),
    });
  }
}

async function checkQueues() {
  await inspectQueue({
    collection: "adminSyncRequests",
    area: "studiomate",
    title: "관리자 긴급 동기화 큐",
    activeStatuses: ["pending", "running"],
    staleStatuses: ["running"],
    staleMinutes: 30,
    repairStatus: "pending",
  });
  await inspectQueue({
    collection: "onsiteWelcomeRequests",
    area: "welcome",
    title: "현장 웰컴 가입 큐",
    activeStatuses: ["pending", "running"],
    staleStatuses: ["running"],
    staleMinutes: 20,
    repairStatus: "pending",
  });
  await inspectQueue({
    collection: "studiomateMemoWriteJobs",
    area: "studiomate",
    title: "StudioMate 메모 쓰기 큐",
    activeStatuses: ["pending", "retry", "processing"],
    staleStatuses: ["processing"],
    staleMinutes: 20,
    repairStatus: "retry",
  });
  await inspectQueue({
    collection: "studiomateInstructorLessonJobs",
    area: "instructor_lessons",
    title: "강사레슨 StudioMate 처리 큐",
    activeStatuses: ["pending", "retry", "processing"],
    staleStatuses: ["processing"],
    staleMinutes: 40,
    repairStatus: "retry",
    failureStatuses: ["failed", "error", "review_required"],
  });
  await inspectQueue({
    collection: "eformsignInstructorMemberJobs",
    area: "instructor_lessons",
    title: "강사회원 가입서 처리 큐",
    activeStatuses: ["pending", "retry", "processing", "sending", "checking_completion"],
    staleStatuses: ["processing", "sending", "checking_completion"],
    staleMinutes: 40,
    repairStatus: "retry",
    failureStatuses: ["failed", "error", "send_review_required"],
  });
  await inspectQueue({
    collection: "eformsignRefundJobs",
    area: "refunds",
    title: "이폼싸인 환불동의서 발송 큐",
    activeStatuses: ["pending", "retry", "processing", "sending"],
    staleStatuses: ["processing"],
    staleMinutes: 20,
    repairStatus: "retry",
    failureStatuses: ["failed", "error", "send_review_required"],
  });
  await inspectQueue({
    collection: "contactSyncJobs",
    area: "contacts",
    title: "Google Contacts 동기화 큐",
    activeStatuses: ["pending", "retry", "processing"],
    staleStatuses: ["processing"],
    staleMinutes: 30,
    repairStatus: "retry",
  });
  await inspectQueue({
    collection: "writeQueue",
    area: "studiomate",
    title: "ARCHIVE IN 쓰기 큐",
    activeStatuses: ["pending", "retry", "processing"],
    staleStatuses: ["processing"],
    staleMinutes: 30,
    repairStatus: "retry",
  });
}

async function inspectQueue(input) {
  const docs = await loadStatusDocs(input.collection, input.activeStatuses, 250);
  const stale = docs.filter((doc) => input.staleStatuses.includes(doc.status) && minutesSince(doc.data.updatedAt || doc.data.startedAt || doc.data.createdAt) > input.staleMinutes);
  const failedAll = await loadStatusDocs(input.collection, input.failureStatuses || ["failed", "error"], 50).catch(() => []);
  const failed = recentOrUndatedDocs(failedAll, RECENT_FAILURE_MINUTES);
  checked.push({
    id: input.collection,
    area: input.area,
    active: docs.length,
    stale: stale.length,
    failedRecent: failed.length,
    failedTotalSample: failedAll.length,
  });

  if (stale.length) {
    const repair = REPAIR ? await repairStaleQueue(input, stale.slice(0, 20)) : null;
    addFinding({
      area: input.area,
      severity: "action_required",
      title: `${input.title} stuck ${stale.length}건`,
      cause: `${input.staleMinutes}분 이상 ${input.staleStatuses.join("/")} 상태입니다.`,
      impact: "운영 요청이 멈춰 보이거나 다음 자동화가 같은 작업을 처리하지 못할 수 있습니다.",
      suggestedAction: repair?.ok ? `${repair.updated}건을 ${input.repairStatus} 상태로 복구했습니다.` : "중복 실행 가능성을 확인한 뒤 retry 처리하세요.",
      sourceRefs: stale.slice(0, 5).map((doc) => `${input.collection}/${doc.id}`),
      autoRepairable: true,
      repairStatus: repair?.ok ? "repaired" : REPAIR ? "failed" : "not_attempted",
    });
  }

  if (failed.length) {
    addFinding({
      area: input.area,
      severity: "warning",
      title: `${input.title} 실패 기록 ${failed.length}건`,
      cause: "최근 7일 이내 또는 발생일을 알 수 없는 failed/error 상태 문서가 있습니다.",
      impact: "이미 실패로 종료된 작업은 자동 재실행하지 않고 운영자 검토 대상으로 둡니다.",
      suggestedAction: "ARCHIVE CORE 자동화 관제에서 실패 원인을 확인하고 필요 시 재시도하세요.",
      sourceRefs: failed.slice(0, 5).map((doc) => `${input.collection}/${doc.id}`),
      autoRepairable: false,
    });
  }
}

async function checkPrivateLessonConsistency() {
  const recentBookings = await loadRecentBookings(700);
  const { privateBookings, countable, missingOrder, cancelledWithOrder, excludedWithOrder, pastUnchecked, pastUncheckedWithOrder } =
    classifyPrivateRoundIssues(recentBookings, { now });
  const source = syncEvidence.get("studiomate-excel-sync");
  const sourceFresh = Boolean(source && !source.stale && source.latestAttemptSucceeded);
  const attendanceSinceKst = kstDate(new Date(now.getTime() - RECENT_FAILURE_MINUTES * 60_000));
  const attendanceNeedsVerification = pastUnchecked.filter((doc) =>
    positiveNumber(doc.data?.sessionOrder?.privateCumulativeRound) || String(doc.data.lectureDate || "") >= attendanceSinceKst);
  const duplicateRounds = duplicatePrivateRounds(countable);
  completedChecks.add("private-session-order");
  completedChecks.add("private-attendance");
  for (const doc of recentBookings) completedChecks.add(`bookings/${doc.id}`);
  checked.push({
    id: "private-session-order",
    privateBookings: privateBookings.length,
    missingOrder: missingOrder.length,
    cancelledWithOrder: cancelledWithOrder.length,
    excludedWithOrder: excludedWithOrder.length,
    pastUncheckedWithOrder: pastUncheckedWithOrder.length,
    pastUnchecked: pastUnchecked.length,
    attendanceNeedsVerification: attendanceNeedsVerification.length,
    attendanceSinceKst,
    duplicateRounds: duplicateRounds.length,
    sourceFresh,
    lastSourceSuccessAt: source?.lastSuccessAt || "",
    verification: sourceFresh ? "internal_consistency_only" : "source_refresh_required",
    reservationRange: source?.reservationRange || null,
  });

  const needsReconcile = missingOrder.length || cancelledWithOrder.length || excludedWithOrder.length || duplicateRounds.length;
  if (needsReconcile) {
    addFinding({
      checkKey: "private-session-order",
      area: "private",
      severity: "action_required",
      title: "프라이빗 회차/취소 정합성 확인 필요",
      cause: [
        missingOrder.length ? `회차 누락 ${missingOrder.length}건` : "",
        cancelledWithOrder.length ? `취소 수업 회차 잔존 ${cancelledWithOrder.length}건` : "",
        excludedWithOrder.length ? `집계 제외 수업 회차 잔존 ${excludedWithOrder.length}건` : "",
        duplicateRounds.length ? `동일 회원 회차 중복 ${duplicateRounds.length}건` : "",
      ].filter(Boolean).join(", "),
      impact: "강사용 설문, 노션 차트, 회원 리포트 회차가 틀어질 수 있습니다.",
      suggestedAction: "StudioMate Excel 동기화의 privateChartReconcile 결과와 사후 검증을 확인하세요.",
      sourceRefs: [
        ...missingOrder.slice(0, 3).map((doc) => `bookings/${doc.id}`),
        ...cancelledWithOrder.slice(0, 3).map((doc) => `bookings/${doc.id}`),
        ...excludedWithOrder.slice(0, 3).map((doc) => `bookings/${doc.id}`),
        ...duplicateRounds.slice(0, 3).map((row) => `bookings/${row.bookingId}`),
      ],
      autoRepairable: false,
      repairStatus: "not_attempted",
    });
  }

  if (attendanceNeedsVerification.length) {
    const dates = [...new Set(attendanceNeedsVerification.map((doc) => doc.data.lectureDate))].filter(Boolean).sort();
    const range = source?.reservationRange;
    const rangeCovered = Boolean(range && dates.every((date) => date >= range.startDate && date <= range.endDate));
    addFinding({
      checkKey: "private-attendance",
      area: "private",
      severity: "action_required",
      title: "지난 프라이빗 수업 출석 확인 필요",
      cause: `최근 출석 미체크 또는 회차 잔존 ${attendanceNeedsVerification.length}건 · ${dates.join(", ")}`,
      impact: sourceFresh && rangeCovered
        ? "최신 원천에서도 출석이 미확인입니다. 취소로 단정하거나 회차를 자동 삭제하지 않습니다."
        : "해당 수업일의 최신 원천 확인이 부족해 실제 출석·취소와 회차를 확정할 수 없습니다.",
      suggestedAction: sourceFresh && rangeCovered
        ? "StudioMate 실제 출석 상태를 확인한 후 회차를 재검증하세요."
        : `${dates.join(", ")}을 포함한 예약 자료를 다시 내려받아 반영한 후 출석과 회차를 재검증하세요. 오늘 이후 범위 동기화만으로는 완료 처리하지 않습니다.`,
      sourceRefs: attendanceNeedsVerification.map((doc) => `bookings/${doc.id}`),
      autoRepairable: false,
    });
  }

  const staleRequests = await loadChartRequestsNeedingAttention();
  if (staleRequests.length) {
    addFinding({
      area: "private",
      severity: "warning",
      title: `프라이빗 차트 요청 확인필요 ${staleRequests.length}건`,
      cause: "취소/리포트/노션 동기 상태가 예약 원천과 다시 확인되어야 합니다.",
      impact: "수업 전/후 설문 또는 리포트 상태 표시가 운영자가 기대한 단계와 다를 수 있습니다.",
      suggestedAction: "자동 reconcile 후에도 남으면 해당 요청을 수동 확인하세요.",
      sourceRefs: staleRequests.slice(0, 5).map((doc) => `privateLessonChartRequests/${doc.id}`),
      autoRepairable: false,
    });
  }
}

async function checkAlimtalk() {
  const active = await loadStatusDocs("alimtalkCandidates", ["queued", "processing"], 200).catch(() => []);
  const failedSample = await loadStatusDocs("alimtalkSends", ["failed", "error"], 80).catch(() => []);
  const failedAll = failedSample.filter((doc) => isActionableAlimtalkFailure(doc.data));
  const resolvedFailureSample = failedSample.length - failedAll.length;
  const failed = recentOrUndatedDocs(failedAll, RECENT_FAILURE_MINUTES);
  const missingDedupe = active.filter((doc) => !doc.data?.dedupeKey && !doc.data?.sourceActionKey);
  checked.push({
    id: "alimtalk",
    active: active.length,
    failedRecent: failed.length,
    failedTotalSample: failedAll.length,
    rawFailureSample: failedSample.length,
    resolvedFailureSample,
    missingDedupe: missingDedupe.length,
  });

  if (missingDedupe.length) {
    addFinding({
      area: "alimtalk",
      severity: "critical",
      title: `알림톡 중복방지 키 누락 ${missingDedupe.length}건`,
      cause: "queued/processing 후보에 dedupeKey/sourceActionKey가 없습니다.",
      impact: "중복 발송 방지 규칙이 작동하지 않을 수 있어 자동 발송을 보류해야 합니다.",
      suggestedAction: "해당 후보를 발송하지 말고 후보 재생성/매칭 규칙을 먼저 고치세요.",
      sourceRefs: missingDedupe.slice(0, 5).map((doc) => `alimtalkCandidates/${doc.id}`),
      autoRepairable: false,
    });
  }
  if (failed.length) {
    addFinding({
      area: "alimtalk",
      severity: "action_required",
      title: `알림톡 실패 기록 ${failed.length}건`,
      cause: "최근 7일 이내 또는 발생일을 알 수 없는 실패 발송 로그가 있습니다.",
      impact: "회원 안내 누락 가능성이 있습니다.",
      suggestedAction: "실패 사유를 확인하고 같은 dedupeKey 중복 발송 여부를 검토하세요.",
      sourceRefs: failed.slice(0, 5).map((doc) => `alimtalkSends/${doc.id}`),
      autoRepairable: false,
    });
  }
}

async function checkDataSourceAndReports() {
  const imports = await db.collection("sourceImports").orderBy("importedAt", "desc").limit(40).get().catch(() => null);
  const latestByKind = new Map();
  for (const doc of imports?.docs || []) {
    const data = doc.data();
    const kind = String(data.sourceKind || "unknown");
    if (!latestByKind.has(kind)) latestByKind.set(kind, { id: doc.id, data });
  }
  for (const kind of ["studiomate_member_excel", "studiomate_reservation_excel", "studiomate_deleted_class_excel"]) {
    const latest = latestByKind.get(kind);
    if (!latest) {
      addFinding({
        area: "data",
        severity: "warning",
        title: `${kind} sourceImport 없음`,
        cause: "최근 sourceImports 기록에서 원본 import를 찾지 못했습니다.",
        impact: "원본 최신성 판단이 어려워 후속 자동화가 오래된 데이터를 볼 수 있습니다.",
        suggestedAction: "StudioMate Excel sync 결과와 sourceImports 기록을 확인하세요.",
        sourceRefs: ["sourceImports"],
        autoRepairable: false,
      });
      continue;
    }
    const age = minutesSince(latest.data.importedAt || latest.data.updatedAt);
    if (age > 26 * 60) {
      addFinding({
        area: "data",
        severity: "warning",
        title: `${kind} 원본 기록 오래됨`,
        cause: `마지막 import가 약 ${Math.round(age / 60)}시간 전입니다.`,
        impact: "예약/회원/삭제수업 기준이 최신 StudioMate 상태와 다를 수 있습니다.",
        suggestedAction: "Excel sync 재실행 또는 StudioMate 로그인 상태 확인",
        sourceRefs: [`sourceImports/${latest.id}`],
        autoRepairable: false,
      });
    }
  }
}

async function checkGitAndCi() {
  const worktrees = gitWorktrees();
  const dirty = worktrees.filter((wt) => wt.path && gitDirty(wt.path));
  checked.push({
    id: "git-worktrees",
    dirtyCount: dirty.length,
    dirtyPaths: dirty.map((wt) => wt.path).slice(0, 12),
    operationalFinding: false,
  });
  const gh = spawnSync(GH, ["run", "list", "--branch", "main", "--limit", "50", "--json", "databaseId,workflowDatabaseId,conclusion,status,workflowName,headBranch,headSha,createdAt"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (gh.status === 0) {
    const runs = JSON.parse(gh.stdout);
    if (!Array.isArray(runs) || !runs.length) throw new Error("GitHub main workflow evidence is empty");
    const failed = unresolvedMainWorkflowFailures(runs);
    completedChecks.add("github-ci");
    completedChecks.add("github-ci-lookup");
    for (const id of recoveredMainFailureIds(runs)) completedChecks.add(`github-run:${id}`);
    checked.push({ id: "github-ci", runsChecked: runs.length, unresolvedFailures: failed.length });
    if (failed.length) {
      addFinding({
        checkKey: "github-ci",
        area: "github",
        severity: "warning",
        title: `GitHub Actions 미해결 실패 ${failed.length}건`,
        cause: "같은 workflow의 main 검사에서 후속 성공으로 해소되지 않은 실패가 있습니다.",
        impact: "배포/검증 기준이 깨졌을 수 있습니다.",
        suggestedAction: "실패 workflow와 branch를 확인하고 같은 변경의 배포 여부를 점검하세요.",
        sourceRefs: failed.slice(0, 5).map((run) => `${run.workflowName || "workflow"}:${run.headBranch || ""}:${run.databaseId || ""}`),
        autoRepairable: false,
      });
    }
  } else {
    addFinding({
      checkKey: "github-ci-lookup",
      area: "github",
      severity: "warning",
      title: "GitHub Actions 상태 조회 실패",
      cause: String(gh.stderr || gh.error?.message || "GitHub 조회 실패").slice(0, 300),
      impact: "기존 GitHub 실패 항목을 해결 완료로 처리하지 않습니다.",
      suggestedAction: "GitHub 조회 연결을 확인한 후 다시 점검하세요.",
    });
  }
}

async function writeResults() {
  const severityRank = { info: 0, warning: 1, action_required: 2, critical: 3 };
  const worst = findings.reduce((max, item) => Math.max(max, effectiveSeverityRank(item, severityRank)), 0);
  const status = worst >= 3 ? "critical" : worst >= 2 ? "action_required" : worst >= 1 ? "warning" : "success";
  const openFindings = findings.filter((item) => item.repairStatus !== "repaired");
  const summary = {
    ok: status === "success" || status === "warning",
    runId,
    mode: MODE,
    repair: REPAIR,
    readOnly: READ_ONLY,
    status,
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
    checkedCount: checked.length,
    findingCount: findings.length,
    criticalCount: openFindings.filter((item) => item.severity === "critical").length,
    actionRequiredCount: openFindings.filter((item) => item.severity === "action_required").length,
    warningCount: findings.filter((item) => effectiveSeverityRank(item, severityRank) === severityRank.warning).length,
    codexActionCount: findings.filter(needsCodexAction).length,
    repairedCount: repairs.filter((item) => item.ok && item.action !== "kickstart").length,
    restartRequestedCount: repairs.filter((item) => item.ok && item.action === "kickstart").length,
    checked,
    findings,
    repairs,
  };
  const reportPath = path.join(REPORT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${MODE}${REPAIR ? "-repair" : ""}${READ_ONLY ? "-read-only" : ""}.json`);
  if (READ_ONLY) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  // Save evidence before closing either finding store; a failed run must not resolve old incidents.
  await db.collection("systemHealthRuns").doc(runId).set({ ...summary, reportPath, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const queueSyncResult = await syncCodexActionQueue(findings);
  checked.push({ id: "codex-action-queue", ...queueSyncResult });
  summary.checkedCount = checked.length;
  let batch = db.batch();
  const oldFindings = await db.collection("systemHealthFindings").where("status", "==", "open").get();
  const activeIds = new Set(findings.map((finding) => finding.findingId));
  let writes = 0;
  for (const doc of oldFindings.docs) {
    if (!canResolveHealthFinding({ ...doc.data(), findingId: doc.id }, activeIds, completedChecks)) continue;
    batch.set(doc.ref, { status: "resolved", resolvedReason: "not_detected_in_verified_latest_check", resolvedRunId: runId, resolvedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    writes++;
    if (writes === 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  for (const finding of findings) {
    batch.set(db.collection("systemHealthFindings").doc(finding.findingId), {
      ...finding,
      runId,
      status: finding.severity === "info" ? "resolved" : finding.repairStatus === "repaired" ? "auto_repaired" : "open",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    writes++;
    if (writes === 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
  await db.collection("systemHealthRuns").doc(runId).set({ checked, checkedCount: checked.length, reconciliationCompletedAt: FieldValue.serverTimestamp() }, { merge: true });
  writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);

  await recordAutomationStatus(db, {
    automationId: "system-health-check",
    title: "ARCHIVE Systems Health Check",
    ownerArea: "system",
    status: status === "success" ? "healthy" : status,
    lastResult: `${findings.length}건 발견 · 자동복구 ${summary.repairedCount}건`,
    runId,
    warnings: findings.slice(0, 10).map((item) => `${item.severity}: ${item.title}`),
  });

  if (!NO_EMAIL && ["critical", "action_required"].includes(status)) await sendAttentionEmail(summary, reportPath).catch((err) => {
    console.error(`health email failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  console.log(JSON.stringify({ ...summary, reportPath }, null, 2));
  if (status === "critical") process.exitCode = 2;
}

async function syncCodexActionQueue(currentFindings) {
  const actionable = currentFindings.filter(needsCodexAction);
  const activeIds = new Set(currentFindings.map((finding) => finding.findingId));
  for (const finding of actionable) {
    const ref = db.collection("codexActionQueue").doc(finding.findingId);
    const existing = await ref.get();
    await ref.set({
      queueId: finding.findingId,
      source: "system-health-check",
      sourceType: "systemHealthFinding",
      sourceRunId: runId,
      sourceFindingId: finding.findingId,
      checkKey: finding.checkKey || "",
      status: existing.exists && ["in_progress", "blocked"].includes(String(existing.data()?.status || ""))
        ? String(existing.data()?.status || "open")
        : "open",
      owner: "codex",
      priority: finding.severity === "critical" ? "high" : "normal",
      area: finding.area,
      title: finding.title,
      cause: finding.cause,
      impact: finding.impact,
      suggestedAction: finding.suggestedAction,
      sourceRefs: finding.sourceRefs || [],
      repairStatus: finding.repairStatus || "",
      firstSeenAt: existing.exists ? existing.data()?.firstSeenAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  const openSnap = await db.collection("codexActionQueue")
    .where("source", "==", "system-health-check")
    .where("status", "in", ["open", "in_progress", "blocked"])
    .limit(100)
    .get()
    .catch(() => null);
  const batch = db.batch();
  let resolved = 0;
  for (const doc of openSnap?.docs || []) {
    if (!canResolveHealthFinding({ ...doc.data(), queueId: doc.id }, activeIds, completedChecks)) continue;
    batch.set(doc.ref, {
      status: "resolved",
      resolvedReason: "not_detected_in_latest_health_check",
      resolvedRunId: runId,
      resolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    resolved += 1;
  }
  if (resolved) await batch.commit();
  return { opened: actionable.length, autoResolved: resolved };
}

function needsCodexAction(finding) {
  if (finding.repairStatus === "repaired") return false;
  return ["critical", "action_required"].includes(String(finding.severity || ""));
}

function effectiveSeverityRank(item, severityRank) {
  if (item.repairStatus === "repaired" && item.severity !== "critical") return severityRank.warning;
  return severityRank[item.severity] ?? severityRank.warning;
}

function addFinding(input) {
  const findingId = `health_${stableId(input.checkKey ? [input.area, input.checkKey] : [input.area, input.title, input.cause, input.sourceRefs?.[0] || ""]).slice(0, 28)}`;
  findings.push({
    findingId,
    checkKey: input.checkKey || "",
    area: input.area || "system",
    severity: input.severity || "warning",
    title: input.title || "시스템 점검 항목",
    cause: input.cause || "",
    impact: input.impact || "",
    suggestedAction: input.suggestedAction || "",
    sourceRefs: cleanArray(input.sourceRefs),
    autoRepairable: Boolean(input.autoRepairable),
    repairStatus: input.repairStatus || "",
  });
}

function latestEvidence(item) {
  if (item.resultFile) return fileEvidence(item.resultFile);
  if (item.runLog) return fileEvidence(item.runLog);
  if (item.reportDir) return newestFileEvidence(item.reportDir);
  return { exists: true, ageMinutes: 0, path: "" };
}

function newestFileEvidence(dir) {
  try {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => path.join(dir, entry.name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return files[0] ? fileEvidence(files[0]) : { exists: false, path: dir };
  } catch {
    return { exists: false, path: dir };
  }
}

function fileEvidence(file) {
  try {
    const stat = statSync(file);
    return { exists: true, path: file, mtimeIso: stat.mtime.toISOString(), ageMinutes: (Date.now() - stat.mtimeMs) / 60000 };
  } catch {
    return { exists: false, path: file };
  }
}

function launchAgentState(label) {
  const result = spawnSync("launchctl", ["print", `gui/${UID}/${label}`], { encoding: "utf8" });
  const output = String(result.stdout || "");
  const state = output.match(/^\s*state = (.+)$/m)?.[1]?.trim() || "";
  const runs = Number(output.match(/^\s*runs = (\d+)$/m)?.[1] || 0);
  const exitMatch = output.match(/^\s*last exit code = (-?\d+)$/m);
  return {
    loaded: result.status === 0,
    state,
    runs,
    lastExitCode: exitMatch ? Number(exitMatch[1]) : null,
    error: result.status === 0 ? "" : String(result.error?.message || result.stderr || result.stdout || "").trim().slice(0, 300),
  };
}

function repairLaunchAgent(item) {
  const unload = spawnSync("launchctl", ["bootout", `gui/${UID}`, item.plist], { encoding: "utf8" });
  const load = spawnSync("launchctl", ["bootstrap", `gui/${UID}`, item.plist], { encoding: "utf8" });
  const ok = load.status === 0 || launchAgentState(item.label).loaded;
  const result = { item: item.id, action: "bootstrap", ok, code: load.status ?? 0, stderr: `${unload.stderr || ""}${load.stderr || ""}`.trim().slice(0, 500) };
  repairs.push(result);
  return result;
}

function kickstartLaunchAgent(item) {
  const result = spawnSync("launchctl", ["kickstart", `gui/${UID}/${item.label}`], { encoding: "utf8" });
  const ok = result.status === 0;
  const repair = { item: item.id, action: "kickstart", ok, code: result.status ?? 0, stderr: String(result.stderr || result.stdout || "").trim().slice(0, 500) };
  repairs.push(repair);
  return repair;
}

async function repairStaleQueue(input, staleDocs) {
  if (!APPLY) return { ok: false, updated: 0 };
  let updated = 0;
  const batch = db.batch();
  for (const doc of staleDocs) {
    batch.set(db.collection(input.collection).doc(doc.id), {
      status: input.repairStatus,
      lastError: `system-health-check: stale ${doc.status} -> ${input.repairStatus}`,
      healthRecoveredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    updated += 1;
  }
  if (updated) await batch.commit();
  const result = { item: input.collection, action: "stale-queue-retry", ok: true, updated };
  repairs.push(result);
  return result;
}

async function loadStatusDocs(collectionName, statuses, limit) {
  const snap = await db.collection(collectionName).where("status", "in", statuses).limit(limit).get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data(), status: String(doc.data().status || "") }));
}

async function loadRecentBookings(limit) {
  const snap = await db.collection("bookings").orderBy("lectureStartAt", "desc").limit(limit).get();
  const rows = new Map(snap.docs.map((doc) => [doc.id, { id: doc.id, data: doc.data() }]));
  // A previously flagged booking must not disappear just because newer reservations fill the sample.
  const open = await db.collection("systemHealthFindings").where("status", "==", "open").get();
  const trackedIds = [...new Set(open.docs.filter((doc) => doc.data().area === "private")
    .flatMap((doc) => doc.data().sourceRefs || [])
    .filter((ref) => /^bookings\/[^/]+$/.test(ref)).map((ref) => ref.split("/")[1]))];
  const missing = trackedIds.filter((id) => !rows.has(id));
  for (let offset = 0; offset < missing.length; offset += 100) {
    const docs = await db.getAll(...missing.slice(offset, offset + 100).map((id) => db.collection("bookings").doc(id)));
    for (const doc of docs) if (doc.exists) rows.set(doc.id, { id: doc.id, data: doc.data() });
  }
  checked.push({ id: "private-booking-coverage", recentSample: snap.size, trackedFollowups: missing.length, loadedBookings: rows.size });
  return [...rows.values()];
}

async function loadChartRequestsNeedingAttention() {
  const snap = await db.collection("privateLessonChartRequests").orderBy("lessonDate", "desc").limit(250).get().catch(() => null);
  return (snap?.docs || [])
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((doc) => {
      const status = String(doc.data.status || "");
      const reportStatus = String(doc.data.reportStatus || doc.data.gptStatus || "");
      const sent = Boolean(doc.data.reportSentAt || doc.data.alimtalkSentAt);
      if (status === "cancelled" && reportStatus === "generated") return true;
      if (status === "pre_survey_submitted" && reportStatus === "generated" && !sent) return true;
      return false;
    });
}

function duplicatePrivateRounds(bookings) {
  const byKey = new Map();
  for (const doc of bookings) {
    const round = positiveNumber(doc.data?.sessionOrder?.privateCumulativeRound);
    if (!round) continue;
    const key = `${doc.data.memberId || doc.data.memberPhone || doc.data.memberName}|${round}`;
    const list = byKey.get(key) || [];
    list.push({ bookingId: doc.id, startAt: timestampText(doc.data.lectureStartAt), appStatus: doc.data.appStatus });
    byKey.set(key, list);
  }
  return [...byKey.values()].filter((list) => list.length > 1).flat();
}

function positiveNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function minutesSince(value) {
  const date = toDate(value);
  if (!date) return Infinity;
  return (Date.now() - date.getTime()) / 60000;
}

function recentOrUndatedDocs(docs, maxAgeMinutes) {
  return docs.filter((doc) => {
    const age = documentAgeMinutes(doc.data);
    return age === null || age <= maxAgeMinutes;
  });
}

function documentAgeMinutes(data) {
  const candidates = [
    data?.failedAt,
    data?.completedAt,
    data?.processedAt,
    data?.sentAt,
    data?.updatedAt,
    data?.createdAt,
    data?.requestedAt,
  ];
  for (const value of candidates) {
    const date = toDate(value);
    if (date) return (Date.now() - date.getTime()) / 60000;
  }
  return null;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.toDate) return value.toDate();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number") return new Date(value);
  return null;
}

function timestampText(value) {
  const date = toDate(value);
  return date ? date.toISOString() : "";
}

function gitWorktrees() {
  const text = execText("git", ["worktree", "list", "--porcelain"], ROOT);
  const result = [];
  let current = {};
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) result.push(current);
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    }
  }
  if (current.path) result.push(current);
  return result;
}

function gitDirty(cwd) {
  return execText("git", ["status", "--porcelain"], cwd).trim().length > 0;
}

async function sendAttentionEmail(summary, reportPath) {
  const top = summary.findings.slice(0, 6).map((item) => `- [${item.severity}] ${item.title}: ${item.suggestedAction || item.cause}`);
  const subject = `[시스템점검][${summary.status === "critical" ? "긴급" : "확인필요"}] 자동복구 ${summary.repairedCount}건 · ${kstDate(new Date())}`;
  const body = [
    "주체: ARCHIVE IN / Mac mini 시스템 점검 자동화",
    `결론: ${summary.findingCount}건 감지 · 직접 복구 ${summary.repairedCount}건 · 재실행 요청 ${summary.restartRequestedCount}건입니다.`,
    "",
    "핵심:",
    `- 긴급: ${summary.criticalCount}건`,
    `- 확인필요: ${summary.actionRequiredCount}건`,
    `- 경고: ${summary.warningCount}건`,
    "- 재실행 요청은 복구 완료가 아닙니다. 실제 정상 반영 결과로 재검증합니다.",
    `- 모드: ${summary.mode}${summary.repair ? " / repair" : ""}`,
    "",
    "주요 항목:",
    ...(top.length ? top : ["- 없음"]),
    "",
    "검증:",
    `- 실행 리포트: ${reportPath}`,
    `- Firestore: systemHealthRuns/${summary.runId}`,
    "",
    "주의:",
    "- 회원 발송, 예약 생성/삭제, 정산 금액 변경은 자동복구 대상에서 제외했습니다.",
    "",
    "다음:",
    summary.criticalCount || summary.actionRequiredCount ? "- ARCHIVE CORE 자동화 관제에서 open 항목을 확인하세요." : "- 없음",
  ].join("\n");
  const report = spawnSync(process.execPath, ["firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      AUTOMATION_REPORT_SUBJECT: subject,
      AUTOMATION_REPORT_BODY: body,
      AUTOMATION_REPORT_FROM: "home@archivepilates.com",
      AUTOMATION_REPORT_TO: "home@archivepilates.com",
      AUTOMATION_REPORT_LABEL: summary.status === "critical" ? "자동화 긴급" : "자동화 확인필요",
      GOOGLE_SERVICE_ACCOUNT_KEY: KEY_FILE,
    },
  });
  if (report.status !== 0) throw new Error(report.stderr || report.stdout || "send-automation-report failed");
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    if (arg.includes("=")) {
      const [key, ...rest] = arg.slice(2).split("=");
      parsed[key] = rest.join("=");
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      parsed[arg.slice(2)] = argv[++i];
    } else {
      parsed[arg.slice(2)] = true;
    }
  }
  return parsed;
}

function stableId(values) {
  return require("node:crypto").createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function safeJson(text, fallback = null) {
  try {
    return JSON.parse(text || "");
  } catch {
    return fallback;
  }
}

function cleanArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function execText(command, args, cwd = ROOT) {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function kstDate(date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function kstDateTimeCompact(date) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return parts.replace(/\D/g, "").slice(0, 12);
}
