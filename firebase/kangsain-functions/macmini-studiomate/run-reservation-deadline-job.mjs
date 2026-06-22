#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT_DIR = path.resolve(new URL("../../..", import.meta.url).pathname);
const REPORT_SCRIPT = path.join(ROOT_DIR, "firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs");
const DEFAULT_NODE = firstExisting([
  process.env.STUDIOMATE_AUTOMATION_NODE,
  "/opt/homebrew/bin/node",
  "/usr/local/bin/node",
  "/Applications/Codex.app/Contents/Resources/node",
  process.execPath,
]);
const BROWSER_NODE = DEFAULT_NODE;
const LAST_RESULT = path.join(os.homedir(), "ArchiveIN/automation/studiomate-results/last-reservation-deadline-result.json");
const REPORT_DIR = path.join(os.homedir(), "ArchiveIN/automation/reports/reservation-deadline-job");

const startedAt = new Date();
const date = formatDate(startedAt);
const result = { ok: false, startedAt: startedAt.toISOString(), steps: [] };

await mkdir(REPORT_DIR, { recursive: true });

try {
  const latest = await runDeadlineSequence("");
  result.ok = true;
  result.deadline = latest;
  await sendReport(`[예약가능기한][성공] 설정 갱신 · ${date}`, successBody(latest), "자동화 성공");
} catch (error) {
  result.initialError = error.message;
  const recovery = await runRecoveryAttempt(error.message);
  if (recovery.ok) {
    result.ok = true;
    result.recovered = true;
    result.deadline = recovery.latest;
    await sendReport(`[예약가능기한][성공] 재시도 복구 · ${date}`, recoveryBody(error.message, recovery.latest), "자동화 성공");
  } else {
    result.ok = false;
    result.error = recovery.error || error.message;
    await sendReport(`[예약가능기한][실패] 설정 실패 · ${date}`, failureBody(result.error, error.message), "자동화 실패");
    process.exitCode = 1;
  }
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(REPORT_DIR, `${timestamp(new Date())}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ok: result.ok, error: result.error || null }, null, 2));
}

function successBody(latest) {
  const targetDate = latest.target?.availableUntil || latest.target?.dateText || latest.targetDateText || "실행일 월요일";
  const rows = reservationDeadlineRows(latest);
  return [
    "대상: 프라이빗/그룹 예약 가능 기한",
    `설정일자: ${targetDate}`,
    ...rows,
    "결과: 성공",
    "자동화: 매주 월요일 12:30 활성",
  ].join("\n");
}

function failureBody(message) {
  return [
    "대상: 프라이빗/그룹",
    "설정: 실패",
    "결과: 수동 확인 필요",
    "자동화: 매주 월요일 12:30 활성",
    "",
    "자동복구: 1회 재시도 후 실패",
    "",
    `실패사유: ${message}`,
  ].join("\n");
}

function recoveryBody(initialMessage, latest) {
  return [
    ...successBody(latest).split("\n"),
    "",
    "자동복구: 최초 실패 후 1회 재시도로 성공",
    `최초 실패사유: ${initialMessage}`,
  ].join("\n");
}

async function sendReport(subject, body, label = "자동화 완료보고") {
  const report = await runWithRetry("email-report", DEFAULT_NODE, [REPORT_SCRIPT], ROOT_DIR, {
    AUTOMATION_REPORT_SUBJECT: subject,
    AUTOMATION_REPORT_BODY: body,
    AUTOMATION_REPORT_FROM: "home@archivepilates.com",
    AUTOMATION_REPORT_TO: "home@archivepilates.com",
    AUTOMATION_REPORT_LABEL: label,
  });
  result.steps.push({ name: "email-report", ok: report.code === 0, code: report.code, output: report.output });
  if (report.code !== 0) throw new Error(extractError(report.output) || "Completion email failed.");
}

async function runDeadlineSequence(prefix) {
  const suffix = prefix ? `${prefix}-` : "";
  const dryRun = await runWithRetry(`${suffix}dry-run`, BROWSER_NODE, ["firebase/kangsain-functions/macmini-studiomate/set-reservation-deadline.mjs"], ROOT_DIR, {
    TZ: "Asia/Seoul",
    HEADLESS: "true",
    DRY_RUN: "true",
  });
  result.steps.push({ name: `${suffix}dry-run`, ok: dryRun.code === 0, code: dryRun.code, output: dryRun.output });
  if (dryRun.code !== 0) throw new Error(extractError(dryRun.output) || "StudioMate reservation deadline dry-run failed.");

  const realRun = await runWithRetry(`${suffix}save`, BROWSER_NODE, ["firebase/kangsain-functions/macmini-studiomate/set-reservation-deadline.mjs"], ROOT_DIR, {
    TZ: "Asia/Seoul",
    HEADLESS: "true",
    DRY_RUN: "false",
    CONFIRM: "true",
    STUDIOMATE_RESERVATION_RESTORE_EXTENSION_DAYS: "true",
  });
  result.steps.push({ name: `${suffix}save`, ok: realRun.code === 0, code: realRun.code, output: realRun.output });
  if (realRun.code !== 0) throw new Error(extractError(realRun.output) || "StudioMate reservation deadline save failed.");

  const latest = await readJson(LAST_RESULT);
  if (!latest.ok) throw new Error(latest.error || "Latest reservation deadline result is not ok.");
  return latest;
}

function reservationDeadlineRows(latest) {
  const changed = Array.isArray(latest.changed) ? latest.changed : [];
  const tabs = Array.isArray(latest.postSave?.deadlineTabs)
    ? latest.postSave.deadlineTabs
    : Array.isArray(latest.screen?.deadlineTabs)
      ? latest.screen.deadlineTabs
      : [];
  const source = changed.length ? changed.map((item) => item.after || item) : tabs;
  if (!source.length) return ["탭별 상태: 확인 안됨"];

  return source.map((item) => {
    const restored = changed.find((change) => change.key === item.key)?.restoredExtensionDays;
    const restorationText = restored ? " · 깨진 연장일 복구" : "";
    return `${item.label || item.key}: ${item.availableUntil || "날짜 확인 안됨"} / ${item.extensionTime || "시간 확인 안됨"} / ${item.extensionDays || "일수 확인 안됨"}일 유지${restorationText}`;
  });
}

async function runRecoveryAttempt(initialMessage) {
  result.steps.push({
    name: "auto-recovery-start",
    ok: false,
    code: 0,
    output: `Initial failure: ${initialMessage}. Retrying once before sending failure email.`,
  });
  try {
    const latest = await runDeadlineSequence("recovery");
    return { ok: true, latest };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function run(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve) => {
    const timeoutMs = Number(extraEnv.STUDIOMATE_JOB_STEP_TIMEOUT_MS || process.env.STUDIOMATE_JOB_STEP_TIMEOUT_MS || "300000");
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      output += `\nStep timed out after ${Math.round(timeoutMs / 1000)} seconds.\n`;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk) => output += chunk.toString());
    child.stderr.on("data", (chunk) => output += chunk.toString());
    child.on("error", (error) => {
      clearTimeout(timer);
      output += `\nSpawn failed: ${error.message}\n`;
      resolve({ code: 127, output });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 124 : code, output });
    });
  });
}

async function runWithRetry(name, command, args, cwd, extraEnv = {}) {
  const maxAttempts = Number(process.env.STUDIOMATE_JOB_RETRIES || "3");
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await run(command, args, cwd, extraEnv);
    if (last.code === 0 || !isRetryableOutput(last.output) || attempt === maxAttempts) {
      return last;
    }
    result.steps.push({
      name: `${name}-retry-${attempt}`,
      ok: false,
      code: last.code,
      output: `Retrying after transient failure: ${extractError(last.output)}`,
    });
    await delay(5000 * attempt);
  }
  return last;
}

function isRetryableOutput(output) {
  return /Unknown system error -11|EAGAIN|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed|Spawn failed|net::ERR_|Target page, context or browser has been closed/i.test(String(output || ""));
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return candidates.at(-1);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function extractError(output) {
  const lines = String(output || "").split("\n").filter(Boolean);
  const important = lines.find((line) => /Step timed out|Unknown system error -11|EAGAIN|Permission denied|bootstrap_check_in|login required|captcha|ENOTFOUND|GaxiosError/i.test(line));
  const fallback = lines.findLast((line) => !/^Node\.js v/i.test(line));
  return important || fallback || "";
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function timestamp(value) {
  return value.toISOString().replace(/[:.]/g, "-");
}
