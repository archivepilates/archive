#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";

const args = new Set(process.argv.slice(2));
const kind = valueArg("--kind") || "all";
const dryRun = args.has("--dry-run") || process.env.DRY_RUN === "true";
const apply = args.has("--apply") || process.env.DRY_RUN === "false";
const requestedStartDate = valueArg("--start-date");
const requestedEndDate = valueArg("--end-date");

const config = {
  baseUrl: env("STUDIOMATE_BASE_URL", "https://arcpilates.studiomate.kr"),
  profileDir: expandHome(env("STUDIOMATE_EMERGENCY_PROFILE_DIR", "~/ArchiveIN/automation/browser-profile")),
  downloadDir: expandHome(env("STUDIOMATE_EMERGENCY_DOWNLOAD_DIR", "~/ArchiveIN/emergency/downloads")),
  archiveRoot: expandHome(env("STUDIOMATE_EMERGENCY_ARCHIVE_DIR", "~/ArchiveIN/emergency/archive")),
  runLogPath: expandHome(env("STUDIOMATE_EMERGENCY_RUN_LOG", "~/ArchiveIN/emergency/runs.jsonl")),
  headless: env("HEADLESS", "true") !== "false",
  waitForLogin: env("WAIT_FOR_LOGIN", "false") === "true",
  python: env(
    "ARCHIVEIN_PYTHON",
    "/Users/archivepilates/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
  ),
};

const startedAt = new Date();
const result = {
  ok: false,
  dryRun: dryRun || !apply,
  startedAt: startedAt.toISOString(),
  source: "studiomate_excel_emergency_download",
  baseUrl: config.baseUrl,
  profileDir: config.profileDir,
  downloadDir: config.downloadDir,
  downloads: {},
};

await mkdir(config.profileDir, { recursive: true });
await mkdir(config.downloadDir, { recursive: true });
await mkdir(config.archiveRoot, { recursive: true });
await mkdir(path.dirname(config.runLogPath), { recursive: true });

let releaseBrowserLock = null;
let context = null;
let capturedAuthorization = "";

try {
  releaseBrowserLock = await acquireStudioMateBrowserLock({ owner: "studiomate-excel-emergency-mode" });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(config.profileDir, {
    acceptDownloads: true,
    headless: config.headless,
  });
  const page = await context.newPage();
  page.on("request", (request) => {
    if (!request.url().includes("api.studiomate.kr")) return;
    capturedAuthorization = request.headers().authorization || capturedAuthorization;
  });
  if (kind === "all" || kind === "member") {
    result.downloads.member = await downloadMemberExcel(page);
  }
  if (kind === "all" || kind === "reservation") {
    result.downloads.reservation = await downloadReservationExcel(page);
  }
  if (kind === "all" || kind === "deleted-class") {
    result.downloads.deletedClass = await downloadDeletedClassExcel(page);
  }
  result.ok = Object.values(result.downloads).every((item) => item?.ok);
} catch (error) {
  result.ok = false;
  result.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(config.downloadDir, "last-emergency-excel-download-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await appendFile(config.runLogPath, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (context) await context.close();
  if (releaseBrowserLock) await releaseBrowserLock();
}

async function downloadMemberExcel(page) {
  await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60000 });
  await closeNoticeDialog(page);
  await assertLoggedIn(page);
  if (result.dryRun) return inspectOnly(page, "member", /회원/);

  const button = locatorByText(page, /엑셀\s*다운로드|엑셀다운로드|엑셀\s*다운/i);
  if (!(await button.isVisible().catch(() => false))) throw new Error("Member Excel download button not found.");
  await button.click();
  await page.waitForTimeout(800);
  await tryEnsureCheckbox(page, "잔여 포인트");
  await tryEnsureCheckbox(page, "만료된 수강권 포함");
  const download = await clickDownloadConfirmation(page);
  return saveDownload(download, "member");
}

async function downloadReservationExcel(page) {
  await page.goto(config.baseUrl, { waitUntil: "networkidle", timeout: 60000 });
  await closeNoticeDialog(page);
  await assertLoggedIn(page);
  await navigateReservationHistory(page);
  const range = emergencyDateRange();
  if (result.dryRun) {
    return {
      ...(await inspectOnly(page, "reservation", /예약내역|예약\s*내역|수업/)),
      range,
    };
  }

  const rows = await reservationRows(range);
  return saveGeneratedRows(rows, "reservation", `예약내역_${range.startDate}_${range.endDate}.xlsx`, range);
}

async function downloadDeletedClassExcel(page) {
  await page.goto(config.baseUrl, { waitUntil: "networkidle", timeout: 60000 });
  await closeNoticeDialog(page);
  await assertLoggedIn(page);
  await navigateDeletedClasses(page);
  const range = emergencyDateRange();
  if (result.dryRun) {
    return {
      ...(await inspectOnly(page, "deleted-class", /삭제된\s*수업|삭제\s*수업|수업/)),
      range,
    };
  }

  const rows = await deletedClassRows(range);
  return saveGeneratedRows(rows, "deleted-class", `삭제된수업_${range.startDate}_${range.endDate}.xlsx`, range);
}

async function navigateReservationHistory(page) {
  const directPaths = [
    "/lectures",
    "/lessons",
    "/schedule",
  ];
  for (const target of directPaths) {
    await page.goto(new URL(target, config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await closeNoticeDialog(page);
    await clickExactTextByScript(page, "예약내역");
    await page.waitForTimeout(1200);
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/예약내역|예약\s*내역/.test(text) && (await hasExcelButton(page))) return;
  }

  await clickExactTextByScript(page, "수업");
  await page.waitForTimeout(1200);
  await clickExactTextByScript(page, "예약내역");
  await page.waitForTimeout(1200);
  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (!/예약내역|예약\s*내역/.test(text) && !(await hasExcelButton(page))) {
    throw new Error("Reservation history screen not found. Open StudioMate 수업 > 예약내역 once, then rerun emergency mode.");
  }
}

async function navigateDeletedClasses(page) {
  const directPaths = [
    "/lectures",
    "/lessons",
    "/schedule",
  ];
  for (const target of directPaths) {
    await page.goto(new URL(target, config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await closeNoticeDialog(page);
    await clickExactTextByScript(page, "삭제된 수업");
    await page.waitForTimeout(1200);
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/삭제된\s*수업|삭제\s*수업/.test(text) && (await hasExcelButton(page))) return;
  }

  await clickExactTextByScript(page, "수업");
  await page.waitForTimeout(1200);
  await clickExactTextByScript(page, "삭제된 수업");
  await page.waitForTimeout(1200);
  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (!/삭제된\s*수업|삭제\s*수업/.test(text) && !(await hasExcelButton(page))) {
    throw new Error("Deleted class screen not found. Open StudioMate 수업 > 삭제된 수업 once, then rerun deleted-class emergency download.");
  }
}

async function inspectOnly(page, name, expectedText) {
  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  return {
    ok: expectedText.test(text) || (await hasExcelButton(page)),
    dryRun: true,
    currentUrl: page.url(),
    hasExcelButton: await hasExcelButton(page),
    textHint: text.slice(0, 160),
    kind: name,
  };
}

async function assertLoggedIn(page) {
  await ensureStudioMateLoggedIn(page, { headless: config.headless, waitForLogin: config.waitForLogin });
}

async function closeNoticeDialog(page) {
  for (const candidate of [
    page.getByRole("button", { name: "닫기" }).last(),
    page.getByText("닫기", { exact: true }).last(),
    page.locator(".el-dialog__headerbtn").first(),
  ]) {
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
}

async function clickIfVisible(page, pattern) {
  const target = locatorByText(page, pattern);
  if (await target.isVisible().catch(() => false)) {
    await target.click({ timeout: 5000 });
    return true;
  }
  return false;
}

async function clickExactTextByScript(page, text) {
  return await page.evaluate((targetText) => {
    const nodes = [
      ...document.querySelectorAll("button, a, li, [role=button], .el-menu-item, .el-tabs__item, .main-nav__item"),
    ];
    const exact = nodes.find((node) => (node.innerText || node.textContent || "").trim() === targetText);
    if (!exact) return false;
    exact.click();
    return true;
  }, text);
}

function locatorByText(page, pattern) {
  return page.locator("button, a, [role=button], .el-tabs__item, .menu-item, li").filter({ hasText: pattern }).first();
}

async function hasExcelButton(page) {
  return await locatorByText(page, /엑셀\s*다운로드|엑셀다운로드|엑셀\s*다운/i).isVisible().catch(() => false);
}

async function tryEnsureCheckbox(page, labelText) {
  const label = page.locator("label").filter({ hasText: labelText }).first();
  if (!(await label.isVisible().catch(() => false))) return false;
  const checked = await label.locator("input").first().isChecked().catch(() => null);
  if (checked !== true) await label.click().catch(() => {});
  return true;
}

async function clickDownloadConfirmation(page) {
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  const finalButton = page.locator("button").filter({ hasText: /^다운로드$|확인|내려받기/ }).last();
  if (await finalButton.isVisible().catch(() => false)) await finalButton.click();
  else await locatorByText(page, /다운로드|내려받기/).click();
  return downloadPromise;
}

async function saveDownload(download, name) {
  const suggested = sanitizeFileName(download.suggestedFilename() || `${name}.xlsx`);
  const stagingPath = path.join(config.downloadDir, `${timestamp()}-${name}-${suggested}`);
  await download.saveAs(stagingPath);
  await waitForStableFile(stagingPath);
  const hash = await sha256File(stagingPath);
  const archiveDir = path.join(config.archiveRoot, name, dateFolder(startedAt));
  await mkdir(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, `${path.parse(suggested).name}-${hash.slice(0, 12)}${path.parse(suggested).ext || ".xlsx"}`);
  await copyFile(stagingPath, archivePath);
  return { ok: true, kind: name, suggestedFilename: suggested, stagingPath, archivePath, sha256: hash };
}

async function saveGeneratedRows(rows, name, suggestedFilename, range) {
  const suggested = sanitizeFileName(suggestedFilename);
  const stagingPath = path.join(config.downloadDir, `${timestamp()}-${name}-${suggested}`);
  const jsonPath = path.join(config.downloadDir, `${timestamp()}-${name}-rows.json`);
  await writeFile(jsonPath, `${JSON.stringify(rows)}\n`);
  const py = String.raw`
from pathlib import Path
import json
import pandas as pd
rows = json.loads(Path(${JSON.stringify(jsonPath)}).read_text())
target = Path(${JSON.stringify(stagingPath)})
df = pd.DataFrame(rows)
df.to_excel(target, index=False)
`;
  const result = spawnSync(config.python, ["-c", py], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Failed to write ${name} Excel`);
  await waitForStableFile(stagingPath);
  const hash = await sha256File(stagingPath);
  const archiveDir = path.join(config.archiveRoot, name, dateFolder(startedAt));
  await mkdir(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, `${path.parse(suggested).name}-${hash.slice(0, 12)}${path.parse(suggested).ext || ".xlsx"}`);
  await copyFile(stagingPath, archivePath);
  return { ok: true, kind: name, suggestedFilename: suggested, stagingPath, archivePath, sha256: hash, range, rows: rows.length };
}

async function reservationRows(range) {
  const out = [];
  let pageNumber = 1;
  let lastPage = 1;
  do {
    const json = await apiJson(`/staff/booking?start_date=${range.startDate}&end_date=${range.endDate}&page=${pageNumber}&limit=100`);
    const page = json?.bookings || {};
    const rows = Array.isArray(page.data) ? page.data : [];
    out.push(...rows.map(reservationRow));
    lastPage = Number(page.last_page || pageNumber);
    pageNumber += 1;
  } while (pageNumber <= lastPage);
  return out;
}

async function deletedClassRows(range) {
  const json = await apiJson(`/staff/lecture?start_date=${range.startDate}&end_date=${range.endDate}&is_trashed=1&is_min=1`);
  const lectures = Array.isArray(json?.lectures) ? json.lectures : [];
  return lectures.flatMap(deletedClassRow);
}

async function apiJson(pathname) {
  if (!capturedAuthorization) throw new Error("StudioMate API authorization header not captured.");
  const response = await fetch(new URL(pathname, "https://api.studiomate.kr").toString(), {
    headers: { authorization: capturedAuthorization, accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`StudioMate API request failed: ${response.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

function reservationRow(booking) {
  const lecture = booking.lecture || {};
  const member = booking.member || {};
  const profile = member.profile || {};
  const userTicket = booking.user_ticket || {};
  const ticket = userTicket.ticket || {};
  return {
    수업일: datePart(lecture.start_on),
    수업시작: timePart(lecture.start_on),
    수업종료: timePart(lecture.end_on),
    강사: lecture.staff?.profile?.name || "",
    수업구분: lecture.course?.type === "P" ? "개인" : lecture.course?.type === "G" ? "그룹" : "",
    수업명: lecture.title || "",
    룸: lecture.room?.name || "",
    예약상태: bookingStatusText(booking.status),
    상태변경일시: booking.updated_at || "",
    회원명: profile.name || "",
    휴대폰번호: member.mobile || "",
    수강권명: ticket.title || "",
    수강권잔여횟수: userTicket.remaining_coupon ?? "",
    수강권전체횟수: userTicket.max_coupon ?? "",
    수강권종료일: datePart(userTicket.expire_at),
    수강권상태: userTicket.is_holding ? "정지" : "",
    예약ID: booking.id || "",
  };
}

function deletedClassRow(lecture) {
  const base = {
    수업일: datePart(lecture.start_on),
    수업시작: timePart(lecture.start_on),
    수업종료: timePart(lecture.end_on),
    강사: lecture.staff?.profile?.name || lecture.staff?.name || "",
    수업구분: lecture.type === "P" ? "개인" : lecture.type === "G" ? "그룹" : "",
    수업명: lecture.title || lecture.course?.title || "",
    룸: lecture.room?.name || "",
    삭제시간: lecture.deleted_at || "",
    삭제한사람: lecture.deleter?.profile?.name || lecture.deleter?.name || "",
    삭제이유: lecture.deleted_for || "",
  };
  const bookings = Array.isArray(lecture.bookings) ? lecture.bookings : [];
  if (!bookings.length) return [{ ...base, 예약상태: "", 회원명: "", 휴대폰번호: "" }];
  return bookings.map((booking) => {
    const member = booking.member || booking.user || booking.trainee || {};
    const profile = member.profile || {};
    return {
      ...base,
      예약상태: bookingStatusText(booking.status || booking.attendance_status),
      회원명: profile.name || member.name || "",
      휴대폰번호: member.mobile || "",
    };
  });
}

function bookingStatusText(status) {
  const value = String(status || "");
  if (/cancel|deleted/.test(value)) return "취소";
  if (/wait/.test(value)) return "대기";
  if (/absence|absent|noshow/.test(value)) return "결석";
  if (/attendance|attend|check/.test(value)) return "출석";
  return value || "예약";
}

function emergencyDateRange() {
  const startDate = requestedStartDate || kstDate(new Date());
  return {
    startDate,
    endDate: requestedEndDate || reservationOpenEndDate(startDate),
  };
}

function reservationOpenEndDate(baseDate) {
  const base = new Date(`${baseDate}T00:00:00+09:00`);
  const daysSinceMonday = (base.getDay() + 6) % 7;
  return addDays(baseDate, 13 - daysSinceMonday);
}

function datePart(value) {
  return String(value || "").slice(0, 10);
}

function timePart(value) {
  const text = String(value || "");
  return text.length >= 16 ? text.slice(11, 16) : "";
}

async function waitForStableFile(filePath) {
  let lastSize = -1;
  for (let i = 0; i < 20; i += 1) {
    const { size } = await stat(filePath);
    if (size > 0 && size === lastSize) return;
    lastSize = size;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Downloaded file did not become stable: ${filePath}`);
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function valueArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function dateFolder(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function kstDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(date, days) {
  const base = new Date(`${date}T00:00:00+09:00`);
  base.setDate(base.getDate() + days);
  return kstDate(base);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeFileName(value) {
  return String(value).replace(/[/:\\?%*"<>|]/g, "_");
}
