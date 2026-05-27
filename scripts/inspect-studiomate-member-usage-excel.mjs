#!/usr/bin/env node
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";

const sampleQuery = valueArg("--query") || "강순영";
const shouldDownload = process.argv.includes("--download");

const config = {
  baseUrl: env("STUDIOMATE_BASE_URL", "https://arcpilates.studiomate.kr"),
  profileDir: expandHome(env("STUDIOMATE_PROFILE_DIR", "~/ArchiveIN/automation/browser-profile")),
  downloadDir: expandHome(env("STUDIOMATE_MEMBER_USAGE_DOWNLOAD_DIR", "~/ArchiveIN/emergency/archive/member-usage")),
  headless: env("HEADLESS", "true") !== "false",
};

const startedAt = new Date();
const result = {
  ok: false,
  source: "studiomate_member_usage_excel_inspection",
  startedAt: startedAt.toISOString(),
  sampleQuery,
  shouldDownload,
  steps: [],
};

await mkdir(config.profileDir, { recursive: true });
await mkdir(path.join(config.downloadDir, dateFolder(startedAt)), { recursive: true });

let releaseBrowserLock = null;
let context = null;

try {
  releaseBrowserLock = await acquireStudioMateBrowserLock({ owner: "studiomate-member-usage-excel-inspect" });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(config.profileDir, {
    acceptDownloads: true,
    headless: config.headless,
  });
  const page = await context.newPage();
  await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60000 });
  await closeNoticeDialog(page);
  await assertStudioMateApp(page, "users");
  result.steps.push(await pageSummary(page, "users"));

  await searchMember(page, sampleQuery);
  result.steps.push(await pageSummary(page, "after-search"));

  await openFirstMemberFromSearch(page, sampleQuery);
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  result.memberUrl = page.url();
  result.steps.push(await pageSummary(page, "member-detail"));

  await openUsageTab(page);
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await selectUsageStatus(page, "전체");
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  result.steps.push(await pageSummary(page, "usage-tab"));
  result.usageSnapshot = await usageSnapshot(page);

  if (shouldDownload) {
    const downloaded = await downloadUsageExcel(page);
    result.download = downloaded;
  }

  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = error instanceof Error ? error.stack || error.message : String(error);
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  const manifestPath = path.join(config.downloadDir, dateFolder(startedAt), `member-usage-inspect-${timestamp()}.json`);
  await writeFile(manifestPath, `${JSON.stringify(result, null, 2)}\n`);
  result.manifestPath = manifestPath;
  console.log(JSON.stringify(result, null, 2));
  if (context) await context.close();
  if (releaseBrowserLock) await releaseBrowserLock();
}

async function searchMember(page, query) {
  const searchInput = page.locator('input[placeholder*="이름"], input[placeholder*="전화번호"]').first();
  await searchInput.fill(query, { timeout: 10000 });
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function openFirstMemberFromSearch(page, query) {
  const clicked = await page.evaluate((needle) => {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const candidates = [...document.querySelectorAll("a, button, tr, td, li, span, p, div, .el-table__row, [role='row'], .user-list-item, .member-list-item")]
      .filter(visible)
      .filter((el) => {
        if (el === document.body || el === document.documentElement) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width > 900 || rect.height > 180) return false;
        return (el.innerText || el.textContent || "").includes(needle);
      })
      .sort((a, b) => {
        const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
        const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
        return areaA - areaB;
      });
    let candidate = candidates.find((el) => {
      const text = el.innerText || el.textContent || "";
      return text.includes(needle) && !text.includes("검색");
    });
    if (!candidate) return false;
    candidate = candidate.closest("a, button, tr, li, .el-table__row, [role='row'], .user-list-item, .member-list-item") || candidate;
    const rect = candidate.getBoundingClientRect();
    candidate.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    candidate.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    candidate.click();
    return true;
  }, query);
  if (!clicked) {
    await page.locator(`text=${query}`).first().click({ timeout: 10000 });
  }
}

async function openUsageTab(page) {
  const clicked = await page.evaluate(() => {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const target = [...document.querySelectorAll("a, button, div, span, li")]
      .filter(visible)
      .find((el) => (el.innerText || el.textContent || "").trim() === "이용내역");
    if (!target) return false;
    target.click();
    return true;
  });
  if (!clicked) throw new Error("Usage tab not found.");
}

async function selectUsageStatus(page, statusText) {
  const clicked = await page.evaluate((status) => {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const candidates = [...document.querySelectorAll("a, button, span, div, li")]
      .filter(visible)
      .filter((el) => {
        const text = (el.innerText || el.textContent || "").trim();
        const rect = el.getBoundingClientRect();
        return text.startsWith(`${status}(`) && rect.width < 160 && rect.height < 80;
      })
      .sort((a, b) => {
        const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
        const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
        return areaA - areaB;
      });
    const target = candidates[0];
    if (!target) return false;
    const clickable = target.closest("a, button, li") || target;
    clickable.click();
    return true;
  }, statusText);
  if (!clicked) throw new Error(`Usage status tab not found: ${statusText}`);
}

async function downloadUsageExcel(page) {
  const beforeUrl = page.url();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    clickByExactText(page, "엑셀 다운로드"),
  ]);
  const suggested = download.suggestedFilename();
  const savedPath = path.join(config.downloadDir, dateFolder(startedAt), `${safeName(suggested.replace(/\.[^.]+$/, ""))}-${shortHash()}${path.extname(suggested) || ".xlsx"}`);
  await download.saveAs(savedPath);
  return {
    beforeUrl,
    suggestedFilename: suggested,
    savedPath,
    sha256: await sha256File(savedPath),
  };
}

async function clickByExactText(page, text) {
  const exactButton = page.locator("button.round", { hasText: text }).last();
  if (await exactButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await exactButton.scrollIntoViewIfNeeded();
    await exactButton.click({ timeout: 5000, force: true });
    return;
  }
  const clicked = await page.evaluate((targetText) => {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const candidates = [...document.querySelectorAll("button, a, span, div")]
      .filter(visible)
      .filter((el) => {
        const ownText = (el.innerText || el.textContent || "").trim();
        const rect = el.getBoundingClientRect();
        return ownText === targetText && rect.top > 250 && rect.width < 240 && rect.height < 80;
      })
      .sort((a, b) => {
        const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
        const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
        return areaA - areaB;
      });
    const target = candidates[0];
    if (!target) return false;
    const clickable = target.closest("button, a") || target;
    clickable.scrollIntoView({ block: "center", inline: "center" });
    const rect = clickable.getBoundingClientRect();
    clickable.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    clickable.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    clickable.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Button not found: ${text}`);
}

async function usageSnapshot(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || "";
    const counts = {};
    for (const match of text.matchAll(/(전체|예약|출석|결석|노쇼|취소)\((\d+)\)/g)) {
      counts[match[1]] = Number(match[2]);
    }
    const hasExcelDownload = /엑셀\s*다운로드|엑셀다운로드/.test(text);
    const visibleCards = [...document.querySelectorAll("body *")]
      .filter((el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length))
      .map((el) => (el.innerText || el.textContent || "").trim())
      .filter((textValue) => /예약|출석|결석|취소|노쇼/.test(textValue))
      .slice(0, 20);
    const downloadCandidates = [...document.querySelectorAll("button, a, span, div")]
      .filter((el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          className: String(el.className || ""),
          text: (el.innerText || el.textContent || "").trim(),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      })
      .filter((item) => item.text.includes("엑셀"))
      .slice(0, 30);
    return { counts, hasExcelDownload, downloadCandidates, visibleCards };
  });
}

async function pageSummary(page, label) {
  return {
    label,
    url: page.url(),
    title: await page.title().catch(() => ""),
    bodySample: await page.locator("body").innerText({ timeout: 10000 }).then((text) => text.slice(0, 1500)).catch(() => ""),
  };
}

async function assertStudioMateApp(page, label) {
  const body = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (!/회원|수업|일정|스튜디오|StudioMate|로그인|이름 또는 전화번호/.test(body)) {
    throw new Error(`StudioMate ${label} screen did not load.`);
  }
}

async function closeNoticeDialog(page) {
  for (const text of ["닫기", "오늘 하루 보지 않기", "확인"]) {
    await page.locator(`text=${text}`).last().click({ timeout: 1500 }).catch(() => {});
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function valueArg(name) {
  const prefix = `${name}=`;
  const item = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : "";
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

function expandHome(value) {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function dateFolder(date) {
  return date.toISOString().slice(0, 10);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function shortHash() {
  return crypto.randomBytes(6).toString("hex");
}

function safeName(value) {
  return String(value || "download").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
}
