import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";

const DEFAULT_SPREADSHEET_ID = "1RyMJfy0GRFT9O8Sh8Hv6DhMm-kBIMttMX_FCJ542bTA";
const DEFAULT_PROFILE_DIR = path.join(os.homedir(), "ArchiveIN/automation/browser-profile");

const DAY_INDEX = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const DAY_NAME = ["일", "월", "화", "수", "목", "금", "토"];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const month = args.month || currentNextMonthKst();
  const sourceSheet = args.sourceSheet || `${Number(month.slice(5, 7))}월 고정수업 리스트`;
  const spreadsheetId = args.spreadsheetId || process.env.MONTHLY_FIXED_BOOKING_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const output =
    args.output ||
    path.join(
      "artifacts",
      "studiomate-monthly-ops",
      `preflight-${month}-${timestampForFile(new Date())}.json`,
    );
  const headless = args.headless === true;
  const sampleNames = String(args.samples || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const source = await readSheetValues(spreadsheetId, sourceSheet, "A1:G220");
  const queue = buildFixedBookingQueue(source.values || [], month);
  const groups = groupsForSamples(queue, sampleNames);
  const studioMate = await runStudioMateReadOnlyPreflight(groups, { headless });

  const report = {
    checkedAt: new Date().toISOString(),
    mode: "read_only_preflight",
    noStudioMateWrites: true,
    spreadsheetId,
    sourceSheet,
    month,
    sourceRows: Math.max((source.values || []).length - 2, 0),
    targetRows: queue.length,
    uniqueLessons: new Set(queue.map((row) => `${row.date}|${row.timeRange}|${row.teacher}`)).size,
    sampledMembers: groups.map((group) => ({
      name: group.name,
      phone: group.phone,
      targetRows: group.rows.length,
    })),
    checks: studioMate,
    summary: summarize(studioMate),
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, summary: report.summary }, null, 2));
}

async function runStudioMateReadOnlyPreflight(groups, input = {}) {
  if (!groups.length) return [];
  const { chromium } = await loadPlaywright();
  const release = await acquireStudioMateBrowserLock({ owner: "studiomate-monthly-ops-preflight", waitMs: 10 * 60 * 1000 });
  let context;
  try {
    context = await chromium.launchPersistentContext(DEFAULT_PROFILE_DIR, {
      headless: input.headless === true,
      viewport: { width: 1440, height: 1100 },
      locale: "ko-KR",
    });
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(30_000);
    const results = [];
    for (const group of groups) {
      const result = {
        name: group.name,
        phone: group.phone,
        targetRows: group.rows.length,
        memberUrl: "",
        status: "pending",
        reason: "",
        bulkSurface: null,
        ticketStatus: null,
        exactMatches: [],
      };
      try {
        result.memberUrl = await openMemberDetail(page, group);
        result.ticketStatus = await inspectTicketStatus(page, group.rows, { surface: "member_detail" });
        result.bulkSurface = await openBulkBookingSurface(page);
        result.ticketStatus = mergeTicketStatuses(
          result.ticketStatus,
          await inspectTicketStatus(page, group.rows, { surface: "bulk_booking" }),
        );
        if (result.bulkSurface.status !== "opened") {
          result.status = "surface_failed";
          result.reason = withTicketReason(result.bulkSurface.reason, result.ticketStatus);
          results.push(result);
          continue;
        }
        result.exactMatches = await collectExactMatches(page, group.rows);
        result.ticketStatus = mergeTicketStatuses(result.ticketStatus, ticketStatusFromExactMatches(result.exactMatches, group.rows));
        const missing = result.exactMatches.filter((match) => match.matchCount === 0);
        const blocked = result.exactMatches.filter((match) => match.blockedCount > 0 && match.availableCount === 0);
        if (missing.length) {
          result.status = "exact_match_missing";
          result.reason = withTicketReason(`${missing.length}개 대상 수업이 일괄예약 화면에 없습니다.`, result.ticketStatus);
        } else if (blocked.length) {
          result.status = "exact_match_blocked";
          result.reason = withTicketReason(`${blocked.length}개 대상 수업은 있으나 선택 불가/정원마감 상태입니다.`, result.ticketStatus);
        } else {
          result.status = "ready";
          result.reason = withTicketReason("샘플 회원의 일괄예약 화면과 정확 매칭 수업카드가 확인되었습니다.", result.ticketStatus);
        }
      } catch (error) {
        result.status = "error";
        result.reason = withTicketReason(error?.message || String(error), result.ticketStatus);
      }
      results.push(result);
    }
    return results;
  } finally {
    if (context) await context.close().catch(() => {});
    await release();
  }
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    const require = createRequire(import.meta.url);
    const candidates = [
      path.join(process.cwd(), "node_modules", "playwright"),
      "/Users/archivepilates/Documents/ARCHIVE-IN/node_modules/playwright",
    ];
    for (const candidate of candidates) {
      try {
        return require(candidate);
      } catch {
        // Try the next known Mac mini workspace dependency path.
      }
    }
    throw error;
  }
}

async function openMemberDetail(page, group) {
  await page.goto("https://arcpilates.studiomate.kr/users", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await ensureStudioMateLoggedIn(page, { headless: false, waitForLogin: false, timeoutMs: 15_000 });
  await page.waitForSelector('input[placeholder="회원 이름 또는 전화번호 검색"]', { timeout: 30_000 });
  const input = page.locator('input[placeholder="회원 이름 또는 전화번호 검색"]').first();
  await input.click();
  await input.fill("");
  await input.fill(digits(group.phone));
  await input.press("Enter");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1_500);

  let row = page.locator("tr.el-table__row").filter({ hasText: group.name }).filter({ hasText: group.phone.slice(-4) }).first();
  if ((await row.count()) === 0) row = page.locator("tr.el-table__row").filter({ hasText: group.name }).first();
  if ((await row.count()) === 0) throw new Error(`회원 검색 결과 없음: ${group.name} ${group.phone}`);
  await row.dblclick();
  await page.waitForURL(/\/users\/detail\?id=/, { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1_000);
  return page.url();
}

async function openBulkBookingSurface(page) {
  await dismissVisibleOverlays(page);
  const beforeUrl = page.url();
  const buttons = page.locator('button, a, [role="button"]').filter({ hasText: "일괄예약" });
  const count = await buttons.count();
  if (!count) {
    return { status: "not_found", reason: "회원 상세에서 일괄예약 버튼을 찾지 못했습니다.", beforeUrl, afterUrl: page.url() };
  }

  await buttons.last().scrollIntoViewIfNeeded();
  await buttons.last().click();
  const deadline = Date.now() + 45_000;
  let last = { body: "", cardCount: 0, completeButtonVisible: false, url: page.url() };
  while (Date.now() < deadline) {
    await page.waitForTimeout(750);
    last = {
      body: await page.locator("body").innerText().catch(() => ""),
      cardCount: await page.locator(".lecture-item").count().catch(() => 0),
      completeButtonVisible: await page
        .locator('button, [role="button"]')
        .filter({ hasText: /수업 예약 완료|예약 완료/ })
        .first()
        .isVisible()
        .catch(() => false),
      url: page.url(),
    };
    if (last.cardCount > 0 && last.completeButtonVisible) {
      return {
        status: "opened",
        reason: "일괄예약 화면과 수업카드가 확인되었습니다.",
        beforeUrl,
        afterUrl: last.url,
        cardCount: last.cardCount,
        completeButtonVisible: true,
      };
    }
    if (last.cardCount > 0) {
      return {
        status: "opened",
        reason: "수업카드는 확인됐지만 예약 완료 버튼 확인은 불완전합니다.",
        beforeUrl,
        afterUrl: last.url,
        cardCount: last.cardCount,
        completeButtonVisible: last.completeButtonVisible,
      };
    }
  }
  return {
    status: "surface_not_open",
    reason: "일괄예약 클릭 후 수업카드가 확인되지 않았습니다. 실패 사유를 수강권 문제로 단정하지 말고 화면 진입 실패로 처리해야 합니다.",
    beforeUrl,
    afterUrl: last.url,
    cardCount: last.cardCount,
    completeButtonVisible: last.completeButtonVisible,
    bodySnippet: last.body.replace(/\s+/g, " ").slice(0, 1200),
  };
}

async function dismissVisibleOverlays(page) {
  for (const selector of [
    '.el-message-box__close',
    '.el-dialog__headerbtn',
    'button[aria-label="Close"]',
    'button:has-text("닫기")',
  ]) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) await locator.click().catch(() => {});
  }
  await page.keyboard.press("Escape").catch(() => {});
}

async function collectExactMatches(page, rows) {
  const cards = await page
    .locator(".lecture-item")
    .evaluateAll((nodes) =>
      nodes.map((node, index) => ({
        index,
        text: node.innerText,
        className: node.className,
      })),
    )
    .catch(() => []);
  return rows.map((row) => {
    const dateLabel = studioMateDateLabel(row.date, row.day);
    const exact = cards.filter(
      (card) =>
        card.text.includes(dateLabel) &&
        card.text.includes(row.timeRange) &&
        card.text.includes(`${row.teacher} 강사`),
    );
    const blockedReasons = exact.map(cardUnavailableReason).filter(Boolean);
    const available = exact.filter((card) => !cardUnavailableReason(card));
    return {
      date: row.date,
      day: row.day,
      timeRange: row.timeRange,
      teacher: row.teacher,
      matchCount: exact.length,
      availableCount: available.length,
      blockedCount: exact.length - available.length,
      blockedReasons: [...new Set(blockedReasons)],
      sample: exact.slice(0, 2).map((card) => card.text.replace(/\n/g, " | ")),
    };
  });
}

function cardUnavailableReason(card) {
  const text = normalizeText(card.text);
  const className = normalizeText(card.className);
  if (/정지|일시정지|pause|suspend/.test(text)) return "ticket_paused";
  if (/기간만료|수강권만료|만료|expired/.test(text)) return "ticket_expired";
  if (/예약가능\s*0|잔여\s*0\s*회|잔여횟수\s*0|남은횟수\s*0|0\s*회\s*(잔여|남음)/.test(text)) return "ticket_count_exhausted";
  if (/정원마감|마감|full/.test(text) || className.includes("full")) return "class_full";
  if (/예약불가|선택불가|불가|disabled|disable|unavailable|impossible/.test(text) || /disabled|disable|unavailable|impossible/.test(className)) {
    return "booking_unavailable";
  }
  return "";
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function inspectTicketStatus(page, rows, input = {}) {
  const body = await page.locator("body").innerText().catch(() => "");
  const ticketTexts = await collectTicketTexts(page);
  return analyzeTicketText([body, ...ticketTexts].join("\n"), rows, input.surface || "unknown");
}

async function collectTicketTexts(page) {
  return page
    .locator("body")
    .evaluate((body) =>
      [...body.querySelectorAll("button,a,div,li,span,p,td")]
        .map((node) => (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .filter((text) => text.length <= 600)
        .filter((text) => /수강권|기간제|횟수제|사용중|사용예정|만료|정지|잔여|예약가능|회권|그룹형|프라이빗|듀엣/.test(text))
        .slice(0, 300),
    )
    .catch(() => []);
}

function analyzeTicketText(text, rows, surface) {
  const target = targetDateWindow(rows);
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const compact = normalizeText(lines.join(" "));
  const reasons = [];
  const add = (code, label, evidence = []) => {
    if (reasons.some((reason) => reason.code === code)) return;
    reasons.push({ code, label, evidence: evidence.slice(0, 3) });
  };

  const explicitExpiryLines = contextLines(lines, ["기간만료", "수강권 만료", "만료된 수강권"]);
  const ticketDateLines = lines
    .filter((line) => /기간제|횟수제|수강권\s*선택|사용중|사용예정|그룹형|프라이빗|듀엣|회권/.test(line))
    .filter((line) => extractIsoDates(line).length >= 2 || line.includes("~"));
  const expiryLines = [...explicitExpiryLines, ...ticketDateLines];
  const expiryDates = expiryLines.flatMap(extractIsoDates);
  const latestExpiryDate = maxIsoDate(expiryDates);
  if (explicitExpiryLines.length || /기간만료|수강권\s*만료|만료된\s*수강권|expired/.test(explicitExpiryLines.join(" "))) {
    add("ticket_expired", "수강권 기간만료", expiryLines);
  } else if (latestExpiryDate && target.endIso && latestExpiryDate < target.endIso) {
    add("ticket_expired", "수강권 기간만료", expiryLines);
  }

  const pauseLines = contextLines(lines, ["정지기간", "수강권 정지", "일시정지", "정지 중", "정지중"]);
  if (pauseLines.length) {
    const pauseDates = pauseLines.flatMap(extractIsoDates);
    const pauseStart = minIsoDate(pauseDates);
    const pauseEnd = maxIsoDate(pauseDates);
    if (!pauseStart || !pauseEnd || dateRangesOverlap(pauseStart, pauseEnd, target.startIso, target.endIso)) {
      add("ticket_paused", "수강권 정지기간", pauseLines);
    }
  }

  const countLines = contextLines(lines, ["예약가능", "잔여", "잔여횟수", "남은횟수", "남은 횟수"]);
  if (/예약가능\s*0|잔여\s*0\s*회|잔여횟수\s*0|남은횟수\s*0|0\s*회\s*(잔여|남음)/.test(compact)) {
    add("ticket_count_exhausted", "수강권 횟수/예약가능 0", countLines);
  }

  const noTicketLines = contextLines(lines, ["사용중인 수강권이 없습니다", "사용 가능한 수강권", "예약 가능한 수강권", "수강권을 찾을 수"]);
  if (/사용중인\s*수강권이\s*없|사용\s*가능한\s*수강권이\s*없|예약\s*가능한\s*수강권이\s*없|수강권을\s*찾을\s*수\s*없/.test(compact)) {
    add("no_usable_ticket", "사용 가능한 수강권 없음", noTicketLines);
  }

  return {
    surface,
    status: reasons.length ? "issue" : compact.includes("수강권") || compact.includes("예약가능") ? "checked_no_issue" : "unknown",
    targetDateRange: target.startIso && target.endIso ? `${target.startIso}~${target.endIso}` : "",
    summary: reasons.map((reason) => reason.label).join(", "),
    reasons,
  };
}

function ticketStatusFromExactMatches(matches, rows) {
  const target = targetDateWindow(rows);
  const labels = {
    ticket_expired: "수강권 기간만료",
    ticket_paused: "수강권 정지기간",
    ticket_count_exhausted: "수강권 횟수/예약가능 0",
    no_usable_ticket: "사용 가능한 수강권 없음",
  };
  const reasons = [];
  for (const match of matches) {
    for (const code of match.blockedReasons || []) {
      if (!labels[code] || reasons.some((reason) => reason.code === code)) continue;
      reasons.push({
        code,
        label: labels[code],
        evidence: [`${match.date} ${match.timeRange} ${match.teacher} ${code}`],
      });
    }
  }
  return {
    surface: "exact_match_cards",
    status: reasons.length ? "issue" : "unknown",
    targetDateRange: target.startIso && target.endIso ? `${target.startIso}~${target.endIso}` : "",
    summary: reasons.map((reason) => reason.label).join(", "),
    reasons,
  };
}

function mergeTicketStatuses(...statuses) {
  const usable = statuses.filter(Boolean);
  if (!usable.length) return null;
  const reasonMap = new Map();
  const surfaces = [];
  for (const status of usable) {
    if (status.surface) surfaces.push(status.surface);
    for (const reason of status.reasons || []) {
      if (!reasonMap.has(reason.code)) reasonMap.set(reason.code, { ...reason, evidence: [...(reason.evidence || [])] });
      else {
        const existing = reasonMap.get(reason.code);
        existing.evidence = [...new Set([...(existing.evidence || []), ...(reason.evidence || [])])].slice(0, 5);
      }
    }
  }
  const reasons = [...reasonMap.values()];
  const firstRange = usable.find((status) => status.targetDateRange)?.targetDateRange || "";
  return {
    surface: [...new Set(surfaces)].join(","),
    status: reasons.length ? "issue" : usable.some((status) => status.status === "checked_no_issue") ? "checked_no_issue" : "unknown",
    targetDateRange: firstRange,
    summary: reasons.map((reason) => reason.label).join(", "),
    reasons,
  };
}

function withTicketReason(reason, ticketStatus) {
  if (!ticketStatus || ticketStatus.status !== "issue" || !ticketStatus.summary) return reason;
  return `${reason} 수강권 확인: ${ticketStatus.summary}.`;
}

function contextLines(lines, keywords) {
  return lines.filter((line) => keywords.some((keyword) => line.includes(keyword))).slice(0, 8);
}

function extractIsoDates(value) {
  const dates = [];
  const regex = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g;
  let match;
  while ((match = regex.exec(String(value || "")))) {
    const [, year, month, day] = match;
    dates.push(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
  }
  return dates;
}

function targetDateWindow(rows) {
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  return { startIso: dates[0] || "", endIso: dates.at(-1) || "" };
}

function minIsoDate(dates) {
  return dates.length ? [...dates].sort()[0] : "";
}

function maxIsoDate(dates) {
  return dates.length ? [...dates].sort().at(-1) : "";
}

function dateRangesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return startA <= endB && startB <= endA;
}

async function readSheetValues(spreadsheetId, sheetTitle, range) {
  const token = execFileSync("gcloud", [
    "auth",
    "print-access-token",
    "--scopes=https://www.googleapis.com/auth/spreadsheets.readonly",
  ], { encoding: "utf8" }).trim();
  const a1 = `'${sheetTitle.replaceAll("'", "''")}'!${range}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(a1)}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Sheets read failed ${response.status}: ${await response.text()}`);
  return response.json();
}

function buildFixedBookingQueue(values, month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const queue = [];
  for (let index = 2; index < values.length; index += 1) {
    const [name, phone, sourceDays, sourceTime, teacher, sessions, memo = ""] = values[index] || [];
    if (!name || !phone || !sourceDays || !sourceTime || !teacher) continue;
    const days = [...String(sourceDays).replace(/\s/g, "")].filter((day) => DAY_INDEX[day] !== undefined);
    const time = normalizeTime(sourceTime);
    const timeRange = `${time}~${addMinutes(time, 50)}`;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(Date.UTC(year, monthNumber - 1, day));
      const dayName = DAY_NAME[date.getUTCDay()];
      if (!days.includes(dayName)) continue;
      const iso = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      queue.push({
        date: iso,
        day: dayName,
        time,
        timeRange,
        name: String(name).trim(),
        phone: String(phone).trim(),
        teacher: String(teacher).trim(),
        sourceRow: index + 1,
        sourceDays,
        sourceTime,
        sessions,
        memo,
      });
    }
  }
  return queue;
}

function groupsForSamples(queue, sampleNames) {
  const grouped = new Map();
  for (const row of queue) {
    if (sampleNames.length && !sampleNames.includes(row.name)) continue;
    const key = `${row.name}|${row.phone}`;
    if (!grouped.has(key)) grouped.set(key, { name: row.name, phone: row.phone, rows: [] });
    grouped.get(key).rows.push(row);
  }
  if (grouped.size) return [...grouped.values()];
  return [...new Map(queue.map((row) => [`${row.name}|${row.phone}`, { name: row.name, phone: row.phone, rows: [] }])).values()]
    .slice(0, 2)
    .map((group) => ({ ...group, rows: queue.filter((row) => row.name === group.name && row.phone === group.phone) }));
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] || 0) + 1;
    return acc;
  }, {});
}

function normalizeTime(value) {
  const match = String(value || "").match(/(오전|오후)?\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) throw new Error(`Invalid time: ${value}`);
  let hour = Number(match[2]);
  const minute = Number(match[3] || 0);
  if (match[1] === "오전" && hour === 12) hour = 0;
  if (match[1] === "오후" && hour < 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutes(value, minutes) {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date(Date.UTC(2026, 0, 1, hour, minute + minutes));
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function studioMateDateLabel(isoDate, day) {
  const [year, month, date] = isoDate.split("-").map(Number);
  return `${year}. ${month}. ${date}. (${day})`;
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function currentNextMonthKst() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 2;
  const target = new Date(Date.UTC(year, month - 1, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
}

function timestampForFile(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [rawKey, inlineValue] = value.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
