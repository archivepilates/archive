#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT_DIR = "/Users/archivepilates/Documents/Codex/2026-05-07/archive";
const CONTACTS_DIR = "/Users/archivepilates/Documents/New project 2";
const LAST_RESULT = path.join(os.homedir(), "ArchiveIN/automation/studiomate-results/last-reservation-deadline-result.json");
const REPORT_DIR = path.join(os.homedir(), "ArchiveIN/automation/reports/reservation-deadline-job");

const startedAt = new Date();
const date = formatDate(startedAt);
const result = { ok: false, startedAt: startedAt.toISOString(), steps: [] };

await mkdir(REPORT_DIR, { recursive: true });

try {
  const dryRun = await runWithRetry("dry-run", "/usr/local/bin/node", ["firebase/kangsain-functions/macmini-studiomate/set-reservation-deadline.mjs"], ROOT_DIR, {
    TZ: "Asia/Seoul",
    HEADLESS: "true",
    DRY_RUN: "true",
  });
  result.steps.push({ name: "dry-run", ok: dryRun.code === 0, code: dryRun.code, output: dryRun.output });
  if (dryRun.code !== 0) throw new Error(extractError(dryRun.output) || "StudioMate reservation deadline dry-run failed.");

  const realRun = await runWithRetry("save", "/usr/local/bin/node", ["firebase/kangsain-functions/macmini-studiomate/set-reservation-deadline.mjs"], ROOT_DIR, {
    TZ: "Asia/Seoul",
    HEADLESS: "true",
    DRY_RUN: "false",
    CONFIRM: "true",
    STUDIOMATE_RESERVATION_EXTENSION_DAYS: "13",
    STUDIOMATE_RESERVATION_EXTENSION_TIME: "13:00",
  });
  result.steps.push({ name: "save", ok: realRun.code === 0, code: realRun.code, output: realRun.output });
  if (realRun.code !== 0) throw new Error(extractError(realRun.output) || "StudioMate reservation deadline save failed.");

  const latest = await readJson(LAST_RESULT);
  if (!latest.ok) throw new Error(latest.error || "Latest reservation deadline result is not ok.");

  result.ok = true;
  result.deadline = latest;
  await sendReport(`[예약가능기한 갱신 완료] ${date}`, successBody(latest));
} catch (error) {
  result.ok = false;
  result.error = error.message;
  await sendReport(`[예약가능기한 갱신 실패] ${date}`, failureBody(error.message));
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(REPORT_DIR, `${timestamp(new Date())}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ok: result.ok, error: result.error || null }, null, 2));
}

function successBody(latest) {
  const targetDate = latest.target?.dateText || latest.targetDateText || "실행일 월요일";
  const time = latest.target?.time || latest.extensionTime || "13:00";
  const days = latest.target?.days || latest.extensionDays || "13";
  return [
    "대상: 프라이빗/그룹",
    `설정: ${targetDate} / ${time} / ${days}일`,
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
    `실패사유: ${message}`,
  ].join("\n");
}

async function sendReport(subject, body) {
  const report = await run("/usr/local/bin/node", ["scripts/send_automation_report.mjs"], CONTACTS_DIR, {
    AUTOMATION_REPORT_SUBJECT: subject,
    AUTOMATION_REPORT_BODY: body,
  });
  result.steps.push({ name: "email-report", ok: report.code === 0, code: report.code, output: report.output });
  if (report.code !== 0) throw new Error(extractError(report.output) || "Completion email failed.");
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
  return /Unknown system error -11|EAGAIN|ETIMEDOUT|ECONNRESET|net::ERR_|Target page, context or browser has been closed/i.test(String(output || ""));
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
