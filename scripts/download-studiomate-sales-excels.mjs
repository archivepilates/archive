#!/usr/bin/env node
import crypto from "node:crypto";
import { createSign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply") || process.env.DRY_RUN === "false";
const dryRun = args.has("--dry-run") || !apply;
const kind = valueArg("--kind") || "all";
const monthArg = valueArg("--month");
const startArg = valueArg("--start-date");
const endArg = valueArg("--end-date");

const HOME = os.homedir();
const DRIVE_ROOT = path.join(
  HOME,
  "Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산",
);
const DEFAULT_CREDENTIALS = path.join(HOME, "ArchiveIN/secrets/google/archive-codex-operator.json");
const DEFAULT_PYTHON = path.join(
  HOME,
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
);

const config = {
  baseUrl: env("STUDIOMATE_BASE_URL", "https://arcpilates.studiomate.kr"),
  profileDir: expandHome(env("STUDIOMATE_SALES_PROFILE_DIR", "~/ArchiveIN/automation/browser-profile")),
  downloadDir: expandHome(env("STUDIOMATE_SALES_DOWNLOAD_DIR", "~/ArchiveIN/automation/downloads/sales")),
  driveRoot: expandHome(env("ARCHIVE_SETTLEMENT_DRIVE_ROOT", DRIVE_ROOT)),
  credentialsPath: expandHome(env("GOOGLE_APPLICATION_CREDENTIALS", DEFAULT_CREDENTIALS)),
  python: expandHome(env("PYTHON", DEFAULT_PYTHON)),
  googleProject: env("GOOGLE_CLOUD_PROJECT", "archive-pilates"),
  salesPassword: env("STUDIOMATE_SALES_PASSWORD", "") || env("STUDIOMATE_LOGIN_PASSWORD", ""),
  headless: env("HEADLESS", "true") !== "false",
  waitForLogin: env("WAIT_FOR_LOGIN", "false") === "true",
};

const range = resolveRange({ monthArg, startArg, endArg });
const startedAt = new Date();
const result = {
  ok: false,
  dryRun,
  source: "studiomate_sales_excel_download",
  startedAt: startedAt.toISOString(),
  range,
  baseUrl: config.baseUrl,
  downloads: {},
};

await mkdir(config.profileDir, { recursive: true });
await mkdir(config.downloadDir, { recursive: true });
await mkdir(path.join(config.driveRoot, "수업매출원본데이터"), { recursive: true });
await mkdir(path.join(config.driveRoot, "수강권매출원본데이터"), { recursive: true });

let releaseBrowserLock = null;
let context = null;

try {
  releaseBrowserLock = await acquireStudioMateBrowserLock({ owner: "studiomate-sales-download" });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(config.profileDir, {
    acceptDownloads: true,
    headless: config.headless,
  });
  const page = await context.newPage();
  if (kind === "all" || kind === "lesson-sales") {
    result.downloads.lessonSales = await downloadSalesExcel(page, {
      kind: "lesson-sales",
      titlePattern: /수업\s*매출|수업매출|수업\s*매출\s*현황/,
      menuTexts: ["매출", "수업매출", "수업 매출", "수업매출 현황"],
      tabText: "수업 매출",
      targetDir: "수업매출원본데이터",
      filePrefix: "수업매출_현황",
    });
  }
  if (kind === "all" || kind === "ticket-sales") {
    result.downloads.ticketSales = await downloadSalesExcel(page, {
      kind: "ticket-sales",
      titlePattern: /수강권\s*매출|수강권매출|수강권\s*매출\s*현황/,
      menuTexts: ["매출", "수강권매출", "수강권 매출", "수강권매출 현황"],
      tabText: "수강권 매출",
      targetDir: "수강권매출원본데이터",
      filePrefix: "수강권매출_현황",
    });
  }
  result.ok = Object.values(result.downloads).every((item) => item?.ok);
} catch (error) {
  result.ok = false;
  result.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(config.downloadDir, "last-studiomate-sales-download-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (context) await context.close();
  if (releaseBrowserLock) await releaseBrowserLock();
}

async function downloadSalesExcel(page, target) {
  if (target.kind === "lesson-sales") return await downloadLessonSalesExcelFromApi(page, target);

  await openSalesScreen(page, target);
  const pageText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (dryRun) {
    return {
      ok: target.titlePattern.test(pageText) || (await hasExcelButton(page)),
      dryRun: true,
      kind: target.kind,
      range,
      currentUrl: page.url(),
      hasExcelButton: await hasExcelButton(page),
      textHint: pageText.slice(0, 220),
    };
  }

  await setDateRange(page, range);
  const download = await clickExcelDownload(page);
  const saved = await saveDownload(download, target);
  return { ok: true, kind: target.kind, range, ...saved };
}

async function downloadLessonSalesExcelFromApi(page, target) {
  await warmStudioMateSession(page);
  const token = await studioMateAccessToken(page);
  const rows = await fetchAllFixedLectureSales(token);
  const records = rows.map(formatFixedLectureSaleRow);
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      kind: target.kind,
      range,
      currentUrl: page.url(),
      apiRows: rows.length,
      textHint: "StudioMate report/renew/fix/lecture API",
    };
  }
  const saved = await saveJsonAsExcel(records, target);
  return { ok: true, kind: target.kind, range, apiRows: rows.length, ...saved };
}

async function studioMateAccessToken(page) {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem("accessToken");
    try {
      return raw ? JSON.parse(raw) : "";
    } catch {
      return raw || "";
    }
  });
  if (!token) throw new Error("StudioMate access token not found in the automation browser profile.");
  return token;
}

async function fetchAllFixedLectureSales(token) {
  const first = await fetchFixedLectureSalesPage(token, { page: 1, limit: 100 });
  const total = Number(first?.meta?.total || first?.count || first?.data?.length || 0);
  const pageCount = Math.max(1, Math.ceil(total / 100));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => fetchFixedLectureSalesPage(token, { page: index + 2, limit: 100 })),
  );
  return [first, ...rest].flatMap((body) => body?.data || []);
}

async function fetchFixedLectureSalesPage(token, { page, limit }) {
  const params = new URLSearchParams({
    start_date: range.startDate,
    end_date: range.endDate,
    limit: String(limit),
    page: String(page),
    search: "",
    order_by: "asc",
  });
  const response = await fetch(`https://api.studiomate.kr/v2/staff/report/renew/fix/lecture?${params}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "Cache-control": "no-cache",
      "Content-Encoding": "gzip",
      "X-SM-Signature": Date.now().toString(36),
      "web-version": "1.0.23",
    },
  });
  if (!response.ok) throw new Error(`StudioMate fixed lecture sales API failed ${response.status}: ${await response.text()}`);
  return await response.json();
}

function formatFixedLectureSaleRow(row) {
  const ticketType = row.type === "A" ? "D" : row.type;
  const isPeriod = ticketType === "P";
  const startOn = row.status ? row.lecture?.start_on || row.action_at || row.created_at : row.action_at || row.created_at;
  const endOn = row.status ? row.lecture?.end_on || "" : "";
  return {
    수업: row.class_type === "P" ? "프라이빗" : "그룹",
    수강권: ({ T: "횟수제", P: "기간제", D: "차감제" })[ticketType] || ticketType || "",
    날짜: formatDate(startOn),
    수업시작: formatTime(startOn),
    수업종료: formatTime(endOn),
    요일: formatWeekday(startOn),
    회원명: stringValue(row.member?.name),
    수강권명: stringValue(row.user_ticket?.title),
    "회당 금액": isPeriod ? "-" : Math.ceil(Number(row.per?.per_amount || 0)),
    "전체 횟수": isPeriod ? "-" : Number(row.per?.total_count || row.user_ticket?.max_coupon || 0),
    "차감 금액": isPeriod ? "-" : Math.ceil(Number(row.deduct?.deduct_amount || 0)),
    "차감 횟수": isPeriod ? "-" : Number(row.deduct?.deduct_count || 0),
    "누적사용 금액": isPeriod ? "-" : Math.ceil(Number(row.used?.used_amount || 0)),
    "누적사용 횟수": isPeriod ? "-" : Number(row.used?.used_count || 0),
    미수업금: isPeriod ? "-" : Math.ceil(Number(row.remain?.remain_amount || 0)),
    "잔여 횟수": isPeriod ? "-" : Number(row.remain?.remain_count || 0),
    "결제 금액": Number(row.total_price || 0),
    "수업 강사": stringValue(row.staff?.name),
    출결: row.status ? bookingStatusText(row.status) : "차감",
  };
}

async function saveJsonAsExcel(records, target) {
  const canonicalName = `${target.filePrefix}${range.startDate}~${range.endDate}.xlsx`;
  const stagingPath = path.join(config.downloadDir, `${timestamp()}-${target.kind}-${canonicalName}`);
  const jsonPath = `${stagingPath}.json`;
  await writeFile(jsonPath, JSON.stringify(records));
  const script = `
import json
import pandas as pd
with open(${JSON.stringify(jsonPath)}, "r", encoding="utf-8") as f:
    rows = json.load(f)
df = pd.DataFrame(rows)
df.to_excel(${JSON.stringify(stagingPath)}, index=False)
`;
  const result = spawnSync(config.python, ["-c", script], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Lesson sales Excel write failed: ${result.stderr || result.stdout}`);
  const hash = await sha256File(stagingPath);
  const drivePath = path.join(config.driveRoot, target.targetDir, canonicalName);
  await copyFile(stagingPath, drivePath);
  return { suggestedFilename: canonicalName, stagingPath, drivePath, sha256: hash };
}

async function openSalesScreen(page, target) {
  await warmStudioMateSession(page);
  if (await revealTargetByMenu(page, target)) return;
  const candidates = ["/sales", "/sale", "/payments", "/payment", "/reports", "/statistics", "/"];
  for (const pathname of candidates) {
    await page.goto(new URL(pathname, config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await closeNoticeDialog(page);
    try {
      await assertLoggedIn(page);
    } catch {
      await warmStudioMateSession(page);
      continue;
    }
    if (await revealTargetByMenu(page, target)) return;
  }
  throw new Error(`${target.kind} screen not found. Open StudioMate sales screen once with this browser profile, then rerun.`);
}

async function warmStudioMateSession(page) {
  await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60000 });
  await closeNoticeDialog(page);
  await assertLoggedIn(page);
}

async function revealTargetByMenu(page, target) {
  for (const text of target.menuTexts) {
    await clickTextByScript(page, text);
    await page.waitForTimeout(700);
  }
  await unlockGuardedSalesIfNeeded(page);
  await clickSalesTab(page, target.tabText);
  const body = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  if ((await isSalesTabActive(page, target.tabText)) && target.titlePattern.test(body) && (await hasExcelButton(page))) return true;

  const clicked = await page.evaluate((patterns) => {
    const regexes = patterns.map((pattern) => new RegExp(pattern));
    const nodes = [...document.querySelectorAll("button, a, li, [role=button], .el-menu-item, .el-tabs__item, .main-nav__item")];
    const node = nodes.find((item) => {
      const text = (item.innerText || item.textContent || "").replace(/\s+/g, "");
      return regexes.some((regex) => regex.test(text));
    });
    if (!node) return false;
    node.click();
    return true;
  }, target.kind === "lesson-sales" ? ["수업매출", "수업매출현황"] : ["수강권매출", "수강권매출현황"]);
  if (clicked) await page.waitForTimeout(1200);
  await unlockGuardedSalesIfNeeded(page);
  await clickSalesTab(page, target.tabText);
  const text = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  return (await isSalesTabActive(page, target.tabText)) && target.titlePattern.test(text) && (await hasExcelButton(page));
}

async function clickSalesTab(page, tabText) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clicked = await page.evaluate((targetText) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, "");
      const wanted = normalize(targetText);
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const nodes = [...document.querySelectorAll("li, button, a, [role=button], .el-tabs__item, .sales-type li")];
      const node = nodes.find((item) => visible(item) && normalize(item.innerText || item.textContent) === wanted);
      if (!node) return false;
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      node.click();
      return true;
    }, tabText);
    if (clicked) await page.waitForTimeout(900);
    if (await isSalesTabActive(page, tabText)) return true;
  }
  return false;
}

async function isSalesTabActive(page, tabText) {
  return await page.evaluate((targetText) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, "");
    const wanted = normalize(targetText);
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return [...document.querySelectorAll("li, .el-tabs__item, .sales-type li")]
      .some((item) => visible(item) && normalize(item.innerText || item.textContent) === wanted && /active|is-active/.test(String(item.className || "")));
  }, tabText);
}

async function unlockGuardedSalesIfNeeded(page) {
  const passwordInput = page.locator('input[type="password"], input[placeholder*="비밀번호"]').first();
  if (!(await passwordInput.isVisible().catch(() => false))) return false;
  const password = config.salesPassword || (await readSecret("STUDIOMATE_LOGIN_PASSWORD").catch(() => ""));
  if (!password) {
    throw new Error("StudioMate sales password required. Set STUDIOMATE_SALES_PASSWORD/STUDIOMATE_LOGIN_PASSWORD or allow Secret Manager access to STUDIOMATE_LOGIN_PASSWORD.");
  }
  await passwordInput.fill(password);
  const confirm = page.locator("button, [role=button]").filter({ hasText: /^확인$|입장|인증/ }).last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click({ timeout: 5000 });
  else await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  if (await passwordInput.isVisible().catch(() => false)) {
    throw new Error("StudioMate sales password was rejected or sales screen remained locked.");
  }
  return true;
}

async function readSecret(secretName) {
  const key = JSON.parse(await readFile(config.credentialsPath, "utf8"));
  const token = await googleAccessToken(key, ["https://www.googleapis.com/auth/cloud-platform"]);
  const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(config.googleProject)}/secrets/${encodeURIComponent(
    secretName,
  )}/versions/latest:access`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Secret Manager access failed ${response.status}: ${await response.text()}`);
  const body = await response.json();
  return Buffer.from(body?.payload?.data || "", "base64").toString("utf8").trim();
}

async function googleAccessToken(key, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: key.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const assertion = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(assertion).sign(key.private_key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${assertion}.${base64url(signature)}`,
    }),
  });
  if (!response.ok) throw new Error(`Google token request failed ${response.status}: ${await response.text()}`);
  const body = await response.json();
  if (!body.access_token) throw new Error("Google token response did not include access_token");
  return body.access_token;
}

async function setDateRange(page, range) {
  if (range.startDate.endsWith("-01")) {
    await selectDateMode(page, "월간");
    await setSingleVisibleDate(page, range.endDate);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(700);
    await clickSearchButton(page);
    return;
  }
  await selectPeriodMode(page);
  const values = [range.startDate, range.endDate];
  const filled = await page.evaluate((inputValues) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const inputs = [...document.querySelectorAll("input")].filter((input) => {
      const text = `${input.placeholder || ""} ${input.ariaLabel || ""} ${input.value || ""}`;
      return visible(input) && (/날짜|기간|시작|종료|date/i.test(text) || /20\d{2}-\d{2}-\d{2}/.test(text) || input.type === "date");
    });
    const targets = inputs.filter((input) => !/일간|주간|월간|기간/.test(input.value || "")).slice(0, 2);
    if (targets.length === 1) {
      const input = targets[0];
      input.focus();
      input.value = `${inputValues[0]} - ${inputValues[1]}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      return 2;
    }
    targets.forEach((input, index) => {
      input.focus();
      input.value = inputValues[index];
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
    });
    return targets.length;
  }, values);
  if (filled < 2) {
    const diagnostic = await visibleInputDiagnostic(page);
    throw new Error(`Could not set sales date range. Found ${filled} date inputs. Visible inputs: ${diagnostic}`);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(700);
  await clickSearchButton(page);
}

async function visibleInputDiagnostic(page) {
  return await page.evaluate(() =>
    [...document.querySelectorAll("input")]
      .filter((input) => {
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((input) => `${input.type || "text"}:${input.placeholder || ""}:${input.value || ""}`)
      .join(" | ")
      .slice(0, 500),
  );
}

async function selectDateMode(page, modeText) {
  const changed = await page.evaluate((targetMode) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const input = [...document.querySelectorAll("input.el-input__inner")].find((item) => visible(item) && /^(일간|주간|월간|기간)$/.test(item.value || ""));
    if (!input) return false;
    if (input.value === targetMode) return true;
    input.click();
    return true;
  }, modeText);
  if (!changed) return false;
  await page.waitForTimeout(500);
  const optionClicked = await page.evaluate((targetMode) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const options = [...document.querySelectorAll("li, .el-select-dropdown__item")].filter(
      (item) => (item.innerText || item.textContent || "").trim() === targetMode,
    );
    const option = options.find(visible) || options.at(-1);
    if (!option) return false;
    option.click();
    return true;
  }, modeText);
  if (optionClicked) await page.waitForTimeout(800);
  return optionClicked;
}

async function setSingleVisibleDate(page, dateValue) {
  return await page.evaluate((value) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const input = [...document.querySelectorAll("input")].find((item) => visible(item) && /20\d{2}-\d{2}-\d{2}/.test(item.value || ""));
    if (!input) return false;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
    return true;
  }, dateValue);
}

async function selectPeriodMode(page) {
  const changed = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const input = [...document.querySelectorAll("input.el-input__inner")].find((item) => visible(item) && /^(일간|주간|월간)$/.test(item.value || ""));
    if (!input) return false;
    input.click();
    return true;
  });
  if (!changed) return false;
  await page.waitForTimeout(500);
  const optionClicked = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const options = [...document.querySelectorAll("li, .el-select-dropdown__item")].filter(
      (item) => (item.innerText || item.textContent || "").trim() === "기간",
    );
    const option = options.find(visible) || options.at(-1);
    if (!option) return false;
    option.click();
    return true;
  });
  if (optionClicked) {
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

async function clickSearchButton(page) {
  for (const pattern of [/조회/, /검색/, /적용/]) {
    const button = page.locator("button, [role=button]").filter({ hasText: pattern }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      return true;
    }
  }
  return false;
}

async function clickExcelDownload(page) {
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  const first = page.locator("button, a, [role=button]").filter({ hasText: /엑셀\s*다운로드|엑셀다운로드|엑셀\s*다운|Excel|다운로드/i }).first();
  if (!(await first.isVisible().catch(() => false))) throw new Error("Sales Excel download button not found.");
  await first.click({ timeout: 5000 });
  await page.waitForTimeout(800);
  const confirm = page.locator("button, [role=button]").filter({ hasText: /^다운로드$|확인|내려받기/ }).last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click({ timeout: 5000 }).catch(() => {});
  return downloadPromise;
}

async function saveDownload(download, target) {
  const suggested = sanitizeFileName(download.suggestedFilename() || `${target.filePrefix}${range.startDate}~${range.endDate}.xlsx`);
  const stagingPath = path.join(config.downloadDir, `${timestamp()}-${target.kind}-${suggested}`);
  await download.saveAs(stagingPath);
  await waitForStableFile(stagingPath);
  const hash = await sha256File(stagingPath);
  const ext = path.parse(suggested).ext || ".xlsx";
  const canonicalName = `${target.filePrefix}${range.startDate}~${range.endDate}${ext}`;
  const drivePath = path.join(config.driveRoot, target.targetDir, canonicalName);
  await copyFile(stagingPath, drivePath);
  return { suggestedFilename: suggested, stagingPath, drivePath, sha256: hash };
}

async function assertLoggedIn(page) {
  const text = await page.locator("body").innerText({ timeout: 15000 }).catch(() => "");
  const hasPasswordInput = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  if (hasPasswordInput || (/로그인/.test(text) && /아이디|비밀번호|이메일|비번/.test(text))) {
    if (config.waitForLogin && !config.headless) {
      await waitForManualLogin(page);
      return;
    }
    throw new Error("StudioMate login required. Run HEADLESS=false WAIT_FOR_LOGIN=true node scripts/download-studiomate-sales-excels.mjs --dry-run, then log in manually.");
  }
  if (/captcha|보안문자|인증번호/i.test(text)) {
    throw new Error("StudioMate security/captcha/verification screen detected. Manual operator action required.");
  }
}

async function waitForManualLogin(page) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/captcha|보안문자|인증번호/i.test(text)) throw new Error("StudioMate security screen detected.");
    if (!(await page.locator('input[type="password"]').first().isVisible().catch(() => false)) && /회원|수업|매출|예약/.test(text)) return;
    await page.waitForTimeout(2000);
  }
  throw new Error("Timed out waiting for manual StudioMate login.");
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

async function clickTextByScript(page, text) {
  return await page.evaluate((targetText) => {
    const nodes = [...document.querySelectorAll("button, a, li, [role=button], .el-menu-item, .el-tabs__item, .main-nav__item")];
    const target = nodes.find((node) => (node.innerText || node.textContent || "").trim() === targetText);
    if (!target) return false;
    target.click();
    return true;
  }, text);
}

async function hasExcelButton(page) {
  return await page.locator("button, a, [role=button]").filter({ hasText: /엑셀\s*다운로드|엑셀다운로드|엑셀\s*다운|Excel|다운로드/i }).first().isVisible().catch(() => false);
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

function resolveRange({ monthArg, startArg, endArg }) {
  if (startArg && endArg) return { startDate: startArg, endDate: endArg };
  const today = kstDate(new Date());
  const month = monthArg || today.slice(0, 7);
  const startDate = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;
  const endDate = month === today.slice(0, 7) ? today : monthEnd;
  return { startDate, endDate };
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
  if (value === "~") return HOME;
  if (value.startsWith("~/")) return path.join(HOME, value.slice(2));
  return value;
}

function kstDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatDate(value) {
  const date = stringValue(value).match(/(20\d{2})-(\d{2})-(\d{2})/);
  return date ? `${date[1]}-${date[2]}-${date[3]}` : "";
}

function formatTime(value) {
  const time = stringValue(value).match(/\b(\d{2}):(\d{2})/);
  return time ? `${time[1]}:${time[2]}` : "";
}

function formatWeekday(value) {
  const date = formatDate(value);
  if (!date) return "";
  return ["일", "월", "화", "수", "목", "금", "토"][new Date(`${date}T00:00:00+09:00`).getDay()];
}

function bookingStatusText(value) {
  return { attendance: "출석", absence: "결석", noshow: "노쇼", cancel: "취소" }[value] || stringValue(value);
}

function stringValue(value) {
  return String(value || "").trim();
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeFileName(value) {
  return String(value).replace(/[/:\\?%*"<>|]/g, "_");
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
