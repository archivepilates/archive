#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { appendFile, readFile, stat, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;
const runAll = args.has("--all");
const shouldResume = args.has("--resume");
const limit = Number(valueArg("--limit") || valueArg("--max") || 0) || 0;
const queryArg = valueArg("--query") || valueArg("--name") || "";
const phoneFilterArg = valueArg("--phone") || "";
const sourceArg = valueArg("--source") || "";
const resumeStateArg = valueArg("--resume-state") || "";
const HOME = os.homedir();
const DEFAULT_DRY_RUN_LIMIT = 5;

const CONFIG = {
  baseUrl: env("STUDIOMATE_BASE_URL", "https://arcpilates.studiomate.kr"),
  profileDir: expandHome(env("STUDIOMATE_PROFILE_DIR", "~/ArchiveIN/automation/browser-profile")),
  downloadRoot: expandHome(env("STUDIOMATE_MEMBER_USAGE_DOWNLOAD_ROOT", "~/ArchiveIN/emergency/archive/member-usage")),
  sourceDir: expandHome(env("STUDIOMATE_MEMBER_SOURCE_DIR", "~/ArchiveIN/emergency/archive/member")),
  runLogDir: expandHome(env("STUDIOMATE_MEMBER_USAGE_RUN_LOG_DIR", "~/ArchiveIN/emergency/runs/member-usage")),
  python: env(
    "ARCHIVEIN_PYTHON",
    "/Users/archivepilates/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
  ),
  headless: env("HEADLESS", "true") !== "false",
  waitForLogin: env("WAIT_FOR_LOGIN", "false") === "true",
};

const startedAt = new Date();
const runDate = toDateFolder(startedAt);
const runId = `member-usage-${timestamp()}`;
const runDir = path.join(CONFIG.downloadRoot, runDate);
const statePath = resumeStateArg
  ? expandHome(resumeStateArg)
  : path.join(runDir, `member-usage-resume-${runDate}.json`);
const progressPath = path.join(runDir, `${runId}-progress.jsonl`);
const failuresPath = path.join(runDir, `${runId}-failures.json`);
const manifestPath = path.join(runDir, `${runId}-manifest.json`);

const result = {
  ok: false,
  source: "studiomate_member_usage_backfill",
  startedAt: startedAt.toISOString(),
  runId,
  mode: dryRun ? "dry-run" : "apply",
  baseUrl: CONFIG.baseUrl,
  apply,
  runAll,
  limit: limit || null,
  query: queryArg || null,
  phoneFilter: phoneFilterArg || null,
  downloadRoot: runDir,
  sourcePath: null,
  files: {
    progressJsonl: progressPath,
    failuresJson: failuresPath,
    manifest: manifestPath,
    resumeState: statePath,
  },
  totals: {
    discovered: 0,
    considered: 0,
    attempted: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    dryRunDone: 0,
    downloaded: 0,
  },
  members: [],
  failures: [],
};

mkdirSync(CONFIG.profileDir, { recursive: true });
mkdirSync(CONFIG.downloadRoot, { recursive: true });
mkdirSync(runDir, { recursive: true });
mkdirSync(CONFIG.runLogDir, { recursive: true });

let candidates;
const queryFilters = parseCommaList(queryArg);
const resumeState = shouldResume ? await loadResumeState(statePath) : { completed: {} };
try {
  candidates = await collectMembers({
    queryFilters,
    phoneFilter: phoneFilterArg,
    sourceArg,
    limit,
    apply,
    queryProvided: Boolean(queryArg),
    phoneProvided: Boolean(phoneFilterArg),
  });
  result.sourcePath = candidates.sourcePath;
  result.totals.discovered = candidates.members.length;
} catch (collectError) {
  result.ok = false;
  result.error = collectError instanceof Error ? collectError.message : String(collectError);
  result.finishedAt = new Date().toISOString();
  await finalizeResult();
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
  process.exit(1);
}

if (!candidates.members.length) {
  result.ok = true;
  result.totals.considered = 0;
  result.totals.attempted = 0;
  await finalizeResult();
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const hasExplicitLiveScope = runAll || limit > 0 || queryFilters.length > 0 || phoneFilterArg;
if (apply && !hasExplicitLiveScope) {
  result.error =
    "Live run safety guard triggered: --apply requires --all or explicit --query/--phone/--limit to avoid full-member automatic backfill. Use --dry-run for safe verification.";
  result.finishedAt = new Date().toISOString();
  await appendProgress({ status: "blocked", message: result.error });
  await finalizeResult();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
  process.exit(1);
}

const filteredByScope = candidates.members.slice();
const consideredMembers =
  apply && !runAll && limit > 0 && filteredByScope.length > limit ? filteredByScope.slice(0, limit) : filteredByScope;

let membersToRun = shouldResume
  ? consideredMembers.filter((member) => !resumeState.completed?.[member.memberKey])
  : consideredMembers.slice();
result.totals.considered = filteredByScope.length;
result.totals.attempted = membersToRun.length;

if (!dryRun && !runAll && membersToRun.length && limit === 0 && queryFilters.length === 0 && !phoneFilterArg && candidates.fromSource) {
  // additional guard just in case; keep a safe default window for source-driven live runs.
  result.error = "Live run was scoped to 0 by default; use --limit or --all for source-driven apply runs.";
  result.ok = false;
  result.finishedAt = new Date().toISOString();
  await finalizeResult();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
  process.exit(1);
}

if (!membersToRun.length) {
  result.ok = true;
  result.totals.skipped = consideredMembers.length - membersToRun.length;
  result.totals.considered = consideredMembers.length;
  await finalizeResult();
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

let releaseLock = null;
let context = null;
let page = null;
let order = 0;

try {
  releaseLock = await acquireStudioMateBrowserLock({ owner: "studiomate-member-usage-collector" });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(CONFIG.profileDir, {
    acceptDownloads: true,
    headless: CONFIG.headless,
  });
  page = await context.newPage();
  await page.goto(new URL("/users", CONFIG.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60000 });
  await closeNoticeDialog(page);
  await assertStudioMateApp(page, "members");
  await assertLoggedIn(page);

  for (const member of membersToRun) {
    order += 1;
    const memberResult = {
      runId,
      memberKey: member.memberKey,
      name: member.name,
      phone: member.phone || "",
      sourceType: member.sourceType,
      sourceRowIndex: member.sourceRowIndex || null,
      query: member.query || "",
      status: "pending",
      startedAt: new Date().toISOString(),
    };

    try {
      await openUsersPage(page);
      await searchMember(page, member);
      const found = await openMemberFromSearch(page, member);
      if (!found) throw new Error(`Search result did not open a detail card for ${member.name || member.query || "unknown"}`);

      await openUsageTab(page);
      await selectUsageStatus(page, "전체");

      if (dryRun) {
        memberResult.status = "dry-run";
        memberResult.usageSnapshot = await usageHint(page);
        result.totals.dryRunDone += 1;
      } else {
        const download = await downloadMemberUsage(page, member, order);
        memberResult.status = "downloaded";
        memberResult.download = download;
        result.totals.downloaded += 1;
      }

      memberResult.memberUrl = page.url();
      memberResult.finishedAt = new Date().toISOString();
      result.members.push(memberResult);
      result.totals.completed += 1;

      resumeState.completed = resumeState.completed || {};
      resumeState.completed[member.memberKey] = {
        status: memberResult.status,
        name: member.name || member.query,
        phone: member.phone || "",
        finishedAt: memberResult.finishedAt,
        downloadPath: memberResult.download?.savedPath || "",
      };
      await persistResumeState(statePath, resumeState);
      await appendProgress(memberResult);
      await page.waitForTimeout(500);
    } catch (memberError) {
      const message = memberError instanceof Error ? memberError.stack || memberError.message : String(memberError);
      memberResult.status = "failed";
      memberResult.error = message;
      memberResult.finishedAt = new Date().toISOString();
      result.members.push(memberResult);
      result.totals.failed += 1;
      result.failures.push({
        memberKey: member.memberKey,
        name: member.name || member.query,
        phone: member.phone || "",
        error: message,
      });
      await appendProgress(memberResult);
    }
  }

  result.ok = result.totals.failed === 0;
} catch (error) {
  result.ok = false;
  result.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFailures();
  await finalizeResult();

  if (page) {
    await page.close().catch(() => {});
  }
  if (context) {
    await context.close();
  }
  if (releaseLock) await releaseLock();

  if (result.error) console.error(JSON.stringify(result, null, 2));
  else console.log(JSON.stringify(result, null, 2));
}

async function collectMembers({ queryFilters, phoneFilter, sourceArg, limit, apply: collectApply, queryProvided, phoneProvided }) {
  if (sourceArg) {
    const explicitSource = expandHome(sourceArg);
    try {
      await stat(explicitSource);
    } catch {
      throw new Error(`Explicit --source file was not found: ${explicitSource}`);
    }
    const explicitRows = await loadMembersFromSource(explicitSource);
    const candidates = rowsToMembers(explicitRows);
    return {
      fromSource: true,
      sourcePath: explicitSource,
      members: applyFilterAndLimit({
        members: candidates,
        queryFilters,
        phoneFilter,
        apply: collectApply,
        limit,
        queryProvided,
        phoneProvided,
        isDefaultDryRun: !dryRun,
        hasSource: true,
      }),
    };
  }

  const discovered = findLatestSource();
  if (!discovered) {
    if (queryFilters.length) {
      const queryMembers = queryFilters.map((name, index) => ({
        sourceType: "query",
        name,
        phone: phoneFilter || "",
        query: name,
        memberKey: `query_${index + 1}_${normalizeName(name)}`,
        sourceRowIndex: null,
      }));
      return {
        fromSource: false,
        sourcePath: null,
        members: applyFilterAndLimit({
          members: queryMembers,
          queryFilters: [],
          phoneFilter,
          apply: collectApply,
          limit,
          queryProvided,
          phoneProvided,
          isDefaultDryRun: !dryRun,
          hasSource: false,
        }),
      };
    }
    return { fromSource: false, sourcePath: null, members: [] };
  }

  const sourceRows = await loadMembersFromSource(discovered);
  const candidates = rowsToMembers(sourceRows);
  return {
    fromSource: true,
    sourcePath: discovered,
    members: applyFilterAndLimit({
      members: candidates,
      queryFilters,
      phoneFilter,
      apply: collectApply,
      limit,
      queryProvided,
      phoneProvided,
      isDefaultDryRun: dryRun,
      hasSource: true,
    }),
  };
}

function applyFilterAndLimit({
  members,
  queryFilters,
  phoneFilter,
  apply: collectApply,
  limit,
  queryProvided,
  phoneProvided,
  isDefaultDryRun,
  hasSource,
}) {
  let out = members.slice();
  if (queryFilters.length) {
    const normalizedQueries = queryFilters.map((q) => normalizeName(q)).filter(Boolean);
    out = out.filter((member) => {
      const nName = normalizeName(member.name);
      if (!normalizedQueries.length) return true;
      return normalizedQueries.some((term) => nName.includes(term));
    });
  }

  if (phoneFilter) {
    const normalizedPhone = normalizePhone(phoneFilter);
    out = out.filter((member) => normalizePhone(member.phone).includes(normalizedPhone));
  }

  if (limit > 0) out = out.slice(0, limit);
  if (!collectApply && isDefaultDryRun && !queryProvided && !phoneProvided && !limit && hasSource) {
    out = out.slice(0, DEFAULT_DRY_RUN_LIMIT);
  }
  return out;
}

async function loadMembersFromSource(sourcePath) {
  if (!sourcePath) return [];
  try {
    await stat(sourcePath);
  } catch {
    return [];
  }
  const ext = path.extname(sourcePath).toLowerCase();
  if (![".xlsx", ".xls", ".csv"].includes(ext)) return [];

  const script = String.raw`
from pathlib import Path
import json
source = Path(${JSON.stringify(sourcePath)})
if source.suffix.lower() == ".csv":
    import pandas as pd
    df = pd.read_csv(source, dtype=str)
else:
    import pandas as pd
    df = pd.read_excel(source, sheet_name=0, dtype=str)
df = df.where(df.notna(), "")
rows = []
for row in df.to_dict(orient="records"):
    rows.append({str(k): ("" if v is None else str(v).strip()) for k, v in row.items()})
print(json.dumps(rows, ensure_ascii=False))
`;
  const result = spawnSync(CONFIG.python, ["-c", script], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to read member source");
  }
  const output = (result.stdout || "").trim();
  if (!output) return [];
  return JSON.parse(output);
}

function rowsToMembers(rows) {
  const dedupe = new Set();
  const out = [];
  for (const row of rows) {
    const name = firstNonEmpty(row, ["이름", "성명", "회원명", "name", "memberName", "member_name"]);
    const phone = firstNonEmpty(row, ["전화번호", "연락처", "휴대폰", "휴대전화", "핸드폰", "phone", "memberPhone", "연락처번호"]);
    if (!name) continue;
    const memberKey = `${normalizeName(name)}|${normalizePhone(phone)}`;
    if (dedupe.has(memberKey)) continue;
    dedupe.add(memberKey);
    out.push({
      sourceType: "member-excel",
      name,
      phone,
      query: "",
      memberKey,
      sourceRowIndex: Number(row.__rowIndex || out.length + 1),
      raw: row,
    });
  }
  return out;
}

function findLatestSource() {
  const roots = [
    path.join(HOME, "ArchiveIN", "emergency", "archive", "member"),
    CONFIG.sourceDir,
    path.join(HOME, "ArchiveIN", "emergency", "downloads"),
    path.join(HOME, "Library", "CloudStorage", "GoogleDrive-home@archivepilates.com"),
  ];
  const py = String.raw`
from pathlib import Path
import json
roots = ${JSON.stringify(roots)}
files = []
for root in roots:
    p = Path(root)
    if not p.exists():
        continue
    for item in p.rglob("*"):
        if not item.is_file():
            continue
        if item.suffix.lower() not in {".xlsx", ".xls", ".csv"}:
            continue
        if item.name.startswith("~$"):
            continue
        name = item.name.lower()
        if "회원목록" in name or "member" in name:
            files.append((item.stat().st_mtime, str(item)))
files.sort(key=lambda item: item[0])
print(json.dumps(files[-1][1] if files else "", ensure_ascii=False))
`;
  const result = spawnSync(CONFIG.python, ["-c", py], { encoding: "utf8", timeout: 20000 });
  if (result.status !== 0) return "";
  try {
    const parsed = JSON.parse(result.stdout || "\"\"");
    return typeof parsed === "string" && parsed ? parsed : "";
  } catch {
    return "";
  }
}

async function loadResumeState(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // ignore
  }
  return { completed: {} };
}

async function persistResumeState(filePath, state) {
  await writeFile(filePath, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

async function openUsersPage(page) {
  await page.goto(new URL("/users", CONFIG.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await closeNoticeDialog(page);
  await page.waitForTimeout(500);
}

async function searchMember(page, member) {
  const queryText = (member.query || member.name || member.phone || "").trim();
  if (!queryText) throw new Error("No member query text available.");
  const searchInput = page.locator('input[placeholder*="이름"], input[placeholder*="전화번호"]').first();
  if (!(await searchInput.isVisible({ timeout: 10000 }).catch(() => false))) {
    throw new Error("Member search input was not found.");
  }
  await searchInput.fill("");
  await searchInput.fill(queryText, { timeout: 10000 });
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function openMemberFromSearch(page, member) {
  const expectedName = normalizeName(member.name || member.query || "");
  const foundByScript = await page.evaluate((payload) => {
    const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const candidates = [...document.querySelectorAll("a, button, tr, td, li, span, p, div, .el-table__row, [role='row'], .user-list-item, .member-list-item")]
      .filter(visible)
      .filter((el) => {
        if (el === document.body || el === document.documentElement) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width > 900 || rect.height > 180) return false;
        return true;
      })
      .map((el) => ({ el, text: normalize(el.innerText || el.textContent || "") }))
      .filter((entry) => {
        if (payload.expectedName && !entry.text.includes(payload.expectedName)) return false;
        return true;
      })
      .sort((a, b) => {
        const aRect = a.el.getBoundingClientRect();
        const bRect = b.el.getBoundingClientRect();
        return (aRect.width * aRect.height) - (bRect.width * bRect.height);
      });
    if (!candidates.length) return false;
    const target = candidates[0].el.closest("a, button, tr, li, .el-table__row, [role='row'], .user-list-item, .member-list-item") || candidates[0].el;
    const clickable = target.closest("button, a") || target;
    clickable.scrollIntoView({ block: "center", inline: "center" });
    const rect = clickable.getBoundingClientRect();
    clickable.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    clickable.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    clickable.click();
    return true;
  }, { expectedName });
  if (foundByScript) {
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1200);
    if (/\/users\/detail/.test(page.url())) return true;
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (text.includes("회원 회원 정보") || text.includes("기본정보") || text.includes("이용내역")) return true;
  }

  return false;
}

async function assertLoggedIn(page) {
  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (/로그인/.test(text) && !/회원|수업|일정/.test(text)) {
    throw new Error("StudioMate login is required before member usage collection.");
  }
}

async function assertStudioMateApp(page, label) {
  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (!/회원|수업|일정|스튜디오|StudioMate|로그인/.test(text)) {
    throw new Error(`StudioMate ${label} screen did not load.`);
  }
}

async function openUsageTab(page) {
  const clicked = await page.evaluate(() => {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const candidates = [...document.querySelectorAll("a, button, div, span, li")].filter(visible);
    const target = candidates.find((el) => (el.innerText || el.textContent || "").trim() === "이용내역");
    if (!target) return false;
    target.click();
    return true;
  });
  if (!clicked) {
    await clickByText(page, "이용내역");
    await page.waitForTimeout(600);
  }
}

async function selectUsageStatus(page, statusText) {
  const clicked = await page.evaluate((text) => {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const candidates = [...document.querySelectorAll("a, button, span, div, li")]
      .filter(visible)
      .filter((el) => (el.innerText || el.textContent || "").trim().startsWith(`${text}(`) || (el.innerText || el.textContent || "").trim() === text)
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.width * aRect.height - bRect.width * bRect.height;
      });
    if (!candidates.length) return false;
    const target = candidates[0];
    const clickable = target.closest("a, button, li") || target;
    clickable.click();
    return true;
  }, statusText);
  if (!clicked) {
    throw new Error(`Usage status tab not found: ${statusText}`);
  }
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function usageHint(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || "";
    const counts = {};
    for (const match of text.matchAll(/(전체|예약|출석|결석|노쇼|취소)\((\d+)\)/g)) {
      counts[match[1]] = Number(match[2]);
    }
    return {
      url: location.href,
      counts,
      hasExcelDownload: /엑셀\s*다운로드|엑셀다운로드/.test(text),
    };
  });
}

async function downloadMemberUsage(page, member, order) {
  const beforeUrl = page.url();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    clickByText(page, "엑셀 다운로드"),
  ]);
  const suggested = sanitizeFileName(download.suggestedFilename() || "member-usage.xlsx");
  const ext = path.parse(suggested).ext || ".xlsx";
  const savedName = `${sanitizeFileName(member.name || member.query || "member")}_${sanitizeFileName(
    member.phone || "no-phone",
  )}_${String(order).padStart(3, "0")}_${timestamp()}${ext}`;
  const savedPath = path.join(runDir, savedName);
  await download.saveAs(savedPath);
  await waitForStableFile(savedPath);
  return {
    beforeUrl,
    suggestedFilename: suggested,
    savedPath,
    sha256: await sha256File(savedPath),
  };
}

async function clickByText(page, text) {
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
      .filter((el) => (el.innerText || el.textContent || "").trim() === targetText)
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.width * aRect.height - bRect.width * bRect.height;
      });
    const target = candidates[0];
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.getBoundingClientRect();
    const clickable = target.closest("button, a") || target;
    clickable.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    clickable.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    clickable.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Button not found: ${text}`);
}

async function closeNoticeDialog(page) {
  for (const text of ["닫기", "오늘 하루 보지 않기", "확인"]) {
    await page.locator(`text=${text}`).last().click({ timeout: 1200 }).catch(() => {});
  }
}

async function appendProgress(entry) {
  await appendFile(progressPath, `${JSON.stringify(entry)}\n`);
}

async function writeFailures() {
  await writeFile(failuresPath, `${JSON.stringify(result.failures, null, 2)}\n`);
}

async function finalizeResult() {
  const runLogPath = path.join(CONFIG.runLogDir, "member-usage-runs.jsonl");
  result.files = {
    progressJsonl: progressPath,
    failuresJson: failuresPath,
    resumeState: statePath,
    manifest: manifestPath,
  };
  if (shouldResume) {
    result.resume = { enabled: true, resumeStatePath: statePath };
  }
  await appendFile(runLogPath, `${JSON.stringify(result)}\n`);
  await writeFile(manifestPath, `${JSON.stringify(result, null, 2)}\n`);
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

function parseCommaList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function sanitizeFileName(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function firstNonEmpty(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) {
      const value = String(row[key]).trim();
      if (value) return value;
    }
  }
  return "";
}

function valueArg(name) {
  const pref = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(pref));
  if (inline) return inline.slice(pref.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return HOME;
  return value.startsWith("~/") ? path.join(HOME, value.slice(2)) : value;
}

function toDateFolder(date) {
  return date.toISOString().slice(0, 10);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
