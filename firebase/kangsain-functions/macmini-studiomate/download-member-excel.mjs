#!/usr/bin/env node
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const config = {
  baseUrl: env("STUDIOMATE_BASE_URL", "https://arcpilates.studiomate.kr"),
  memberPath: env("STUDIOMATE_MEMBER_EXPORT_PATH", "/users"),
  profileDir: expandHome(env("STUDIOMATE_PROFILE_DIR", "~/ArchiveIN/automation/browser-profile")),
  downloadDir: expandHome(env("STUDIOMATE_DOWNLOAD_DIR", "~/ArchiveIN/automation/downloads")),
  archiveRoot: expandHome(env("STUDIOMATE_DRIVE_ARCHIVE_DIR", "~/ArchiveIN/automation/StudioMate Excel Archive")),
  runLogPath: expandHome(env("STUDIOMATE_IMPORT_RUN_LOG", "~/ArchiveIN/automation/member-excel-runs.jsonl")),
  headless: env("HEADLESS", "false") === "true",
  waitForLogin: env("WAIT_FOR_LOGIN", "false") === "true",
  dryRun: env("DRY_RUN", "true") !== "false",
  confirm: env("CONFIRM", "false") === "true"
};

const startedAt = new Date();
const result = {
  ok: false,
  dryRun: config.dryRun,
  confirmed: config.confirm,
  startedAt: startedAt.toISOString(),
  baseUrl: config.baseUrl,
  memberPath: config.memberPath,
  profileDir: config.profileDir,
  downloadDir: config.downloadDir,
  archiveRoot: config.archiveRoot
};

if (!config.dryRun && !config.confirm) {
  throw new Error("Real StudioMate Excel download requires CONFIRM=true. Use DRY_RUN=true to inspect only.");
}

await mkdir(config.profileDir, { recursive: true });
await mkdir(config.downloadDir, { recursive: true });
await mkdir(path.dirname(config.runLogPath), { recursive: true });

const { chromium } = await import("playwright");
const context = await chromium.launchPersistentContext(config.profileDir, {
  acceptDownloads: true,
  headless: config.headless
});
const page = await context.newPage();

try {
  await page.goto(new URL(config.memberPath, config.baseUrl).toString(), {
    waitUntil: "networkidle",
    timeout: 60000
  });
  await closeNoticeDialog(page);
  await assertLoggedIn(page);

  const bodyText = await page.locator("body").innerText({ timeout: 15000 });
  result.screen = {
    currentUrl: page.url(),
    hasMembersPage: bodyText.includes("회원"),
    hasExcelButton: await hasExcelButton(page),
    memberCountText: (bodyText.match(/필터된\s*회원\s*\d+명/) || [])[0] || ""
  };

  if (config.dryRun) {
    result.ok = true;
    result.message = "DRY_RUN: member page inspected. Excel download click skipped.";
  } else {
    const download = await clickExcelDownload(page);
    const suggested = sanitizeFileName(download.suggestedFilename() || "studiomate-members.xlsx");
    const stagingPath = path.join(config.downloadDir, `${timestamp()}-${suggested}`);
    await download.saveAs(stagingPath);
    await waitForStableFile(stagingPath);

    const hash = await sha256File(stagingPath);
    const archiveDir = path.join(config.archiveRoot, dateFolder(startedAt));
    await mkdir(archiveDir, { recursive: true });
    const archivePath = uniqueArchivePath(archiveDir, suggested, hash);
    await copyFile(stagingPath, archivePath);

    const runRecord = {
      runId: `studiomate-member-excel-${timestamp()}`,
      sourceFileName: suggested,
      sourceFileHash: hash,
      stagingPath,
      archivePath,
      sourceSize: (await stat(stagingPath)).size,
      status: "downloaded",
      createdAt: new Date().toISOString()
    };
    await appendFile(config.runLogPath, `${JSON.stringify(runRecord)}\n`);

    result.ok = true;
    result.message = "StudioMate member Excel downloaded and archived.";
    result.download = {
      suggestedFilename: suggested,
      sha256: hash,
      stagingPath,
      archivePath
    };
  }
} catch (error) {
  result.ok = false;
  result.error = error.message;
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeLastResult(result);
  console.log(JSON.stringify(result, null, 2));
  await context.close();
}

async function assertLoggedIn(page) {
  const text = await page.locator("body").innerText({ timeout: 15000 }).catch(() => "");
  if (await isLoginScreen(page, text)) {
    if (config.waitForLogin && !config.headless) {
      await waitForManualLogin(page);
      return;
    }
    throw new Error("StudioMate login required. Run HEADLESS=false WAIT_FOR_LOGIN=true DRY_RUN=true npm run studiomate:member-excel, then log in manually in the opened browser.");
  }
  if (/captcha|보안문자|인증번호/i.test(text)) {
    throw new Error("StudioMate security/captcha/verification screen detected. Manual operator action required.");
  }
}

async function waitForManualLogin(page) {
  console.log("StudioMate login required. Log in manually in the opened browser; automation will resume after the members page loads.");
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/captcha|보안문자|인증번호/i.test(text)) {
      throw new Error("StudioMate security/captcha/verification screen detected. Manual operator action required.");
    }
    const memberPageReady = (await hasExcelButton(page)) || /필터된\s*회원|회원\s*목록|회원관리/.test(text);
    if (memberPageReady && !(await isLoginScreen(page, text))) {
      await closeNoticeDialog(page);
      return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error("Timed out waiting for manual StudioMate login.");
}

async function isLoginScreen(page, text) {
  const hasPasswordInput = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  return hasPasswordInput || (/로그인/.test(text) && /아이디|비밀번호|이메일|비번/.test(text));
}

async function closeNoticeDialog(page) {
  const closeCandidates = [
    page.getByRole("button", { name: "닫기" }).last(),
    page.getByText("닫기", { exact: true }).last(),
    page.locator(".noti-dialog .el-dialog__headerbtn").first()
  ];
  for (const candidate of closeCandidates) {
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function hasExcelButton(page) {
  return await excelDownloadButton(page).isVisible().catch(() => false);
}

async function clickExcelDownload(page) {
  const button = excelDownloadButton(page);
  if (!(await button.isVisible().catch(() => false))) {
    throw new Error("Excel download button not found on StudioMate members page.");
  }
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await button.click();
  return downloadPromise;
}

function excelDownloadButton(page) {
  return page
    .locator("button, a")
    .filter({ hasText: /엑셀\s*다운로드|엑셀다운로드|엑셀\s*다운/i })
    .first();
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

function uniqueArchivePath(archiveDir, fileName, hash) {
  const parsed = path.parse(fileName);
  return path.join(archiveDir, `${parsed.name}-${hash.slice(0, 12)}${parsed.ext || ".xlsx"}`);
}

async function writeLastResult(value) {
  const resultPath = path.join(config.downloadDir, "last-member-excel-download-result.json");
  await writeFile(resultPath, `${JSON.stringify(value, null, 2)}\n`);
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
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeFileName(value) {
  return String(value).replace(/[/:\\?%*"<>|]/g, "_");
}
