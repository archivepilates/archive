#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "../../../scripts/lib/studiomate-browser-lock.mjs";

const config = {
  baseUrl: env("STUDIOMATE_BASE_URL", "https://arcpilates.studiomate.kr"),
  operationInfoPath: env("STUDIOMATE_OPERATION_INFO_PATH", "/settings/operations"),
  profileDir: expandHome(env("STUDIOMATE_PROFILE_DIR", "~/ArchiveIN/automation/browser-profile")),
  outputDir: expandHome(env("STUDIOMATE_OUTPUT_DIR", "~/ArchiveIN/automation/studiomate-results")),
  headless: env("HEADLESS", "false") === "true",
  waitForLogin: env("WAIT_FOR_LOGIN", "false") === "true",
  dryRun: env("DRY_RUN", "true") !== "false",
  confirm: env("CONFIRM", "false") === "true",
  availableUntil: env("STUDIOMATE_RESERVATION_AVAILABLE_UNTIL", ""),
  restoreExpectedExtensionDays: env("STUDIOMATE_RESERVATION_RESTORE_EXTENSION_DAYS", "true") === "true",
  expectedPrivateExtensionDays: Number(env("STUDIOMATE_PRIVATE_RESERVATION_EXTENSION_DAYS", "60")),
  expectedGroupExtensionDays: Number(env("STUDIOMATE_GROUP_RESERVATION_EXTENSION_DAYS", "13")),
  allowFutureVisibleUntil: env("STUDIOMATE_RESERVATION_ALLOW_FUTURE_VISIBLE_UNTIL", "false") === "true",
};

const startedAt = new Date();
const targetAvailableUntil = config.availableUntil || formatKoreanDate(startedAt);
const reservationDeadlineTabs = [
  {
    key: "private",
    label: "프라이빗 수업",
    tabPattern: /프라이빗\s*수업|프라이빗|개인|Private/i,
    expectedExtensionDays: config.expectedPrivateExtensionDays,
  },
  {
    key: "group",
    label: "그룹 수업",
    tabPattern: /그룹\s*수업|그룹|Group/i,
    expectedExtensionDays: config.expectedGroupExtensionDays,
  },
];
const result = {
  ok: false,
  dryRun: config.dryRun,
  confirmed: config.confirm,
  startedAt: startedAt.toISOString(),
  baseUrl: config.baseUrl,
  operationInfoPath: config.operationInfoPath || "(auto)",
  profileDir: config.profileDir,
  outputDir: config.outputDir,
  target: {
    appliesTo: reservationDeadlineTabs.map((item) => item.label),
    availableUntil: targetAvailableUntil,
    mode: "date-only",
    preserveExtensionTime: true,
    restoreExpectedExtensionDays: config.restoreExpectedExtensionDays,
    lessons: reservationDeadlineTabs.map((item) => ({
      key: item.key,
      label: item.label,
      expectedExtensionDays: item.expectedExtensionDays,
    })),
  }
};

if (!config.dryRun && !config.confirm) {
  throw new Error("Real StudioMate setting update requires CONFIRM=true. Use DRY_RUN=true to inspect only.");
}

await mkdir(config.profileDir, { recursive: true });
await mkdir(config.outputDir, { recursive: true });

const { chromium } = await import("playwright");
let releaseBrowserLock = null;
let context = null;
let page = null;

try {
  console.error("reservation-deadline: acquiring StudioMate browser profile lock");
  releaseBrowserLock = await acquireStudioMateBrowserLock({ owner: "studiomate-reservation-deadline" });
  console.error("reservation-deadline: launching Playwright persistent context");
  context = await chromium.launchPersistentContext(config.profileDir, {
    acceptDownloads: false,
    headless: config.headless,
    timeout: 60000
  });
  page = await context.newPage();
  console.error("reservation-deadline: navigating to operation settings");
  await navigateToOperationInfo(page);
  await closeNoticeDialog(page);
  await assertLoggedIn(page);
  await ensureReservationDeadlineSection(page);
  await scrollReservationDeadlineIntoView(page);

  result.screen = await inspectScreen(page);
  result.preview = {
    message: `Set reservation availability date only until ${targetAvailableUntil}; preserve private/group auto-extension values.`,
    currentUrl: page.url()
  };

  if (config.dryRun) {
    result.ok = true;
    result.message = "DRY_RUN: operation-info reservation deadline screen inspected. Save click skipped.";
  } else {
    result.changed = await updateReservationDeadlineSetting(page);
    await clickSave(page);
    await page.waitForTimeout(1000);
    await navigateToOperationInfo(page);
    await closeNoticeDialog(page);
    await scrollReservationDeadlineIntoView(page);
    result.postSave = await inspectScreen(page);
    assertVisibleMemberAvailability(result.postSave);
    result.ok = true;
    result.message = "StudioMate reservation deadline settings saved.";
  }
} catch (error) {
  result.ok = false;
  result.error = error.message;
  result.diagnostic = {
    currentUrl: page?.url?.() || "",
    visibleSummary: page ? compactText(await bodyText(page)).slice(0, 1200) : ""
  };
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeLastResult(result);
  console.log(JSON.stringify(result, null, 2));
  await context?.close?.();
  await releaseBrowserLock?.();
}

async function navigateToOperationInfo(page) {
  const firstPath = config.operationInfoPath;
  await page.goto(new URL(firstPath, config.baseUrl).toString(), {
    waitUntil: "networkidle",
    timeout: 60000
  });

  if (await hasOperationInfoSection(page)) return;

  const paths = [
    "/setting",
    "/settings",
    "/settings/operations",
    "/settings/operation",
    "/settings/operation-info",
    "/setting/operation",
    "/setting/operation-info",
    "/setting/studio",
    "/settings/studio"
  ];

  for (const candidatePath of paths) {
    if (candidatePath === firstPath) continue;
    await page.goto(new URL(candidatePath, config.baseUrl).toString(), {
      waitUntil: "networkidle",
      timeout: 60000
    }).catch(() => {});
    await closeNoticeDialog(page);
    if (await hasOperationInfoSection(page)) return;
    if (await isLoginScreen(page, await bodyText(page))) return;
  }

  await clickByText(page, "설정");
  await page.waitForTimeout(1000);
  await clickByText(page, "운영정보");
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
}

async function ensureReservationDeadlineSection(page) {
  const text = await bodyText(page);
  if (!/예약\s*가능\s*기한/.test(text)) {
    throw new Error("Reservation availability deadline section not found. Set STUDIOMATE_OPERATION_INFO_PATH to the exact StudioMate operation-info URL after checking the UI once.");
  }
}

async function hasOperationInfoSection(page) {
  const text = await bodyText(page);
  return /운영정보|예약\s*가능\s*기한/.test(text);
}

async function updateReservationDeadlineSetting(page) {
  await scrollReservationDeadlineIntoView(page);
  const changes = [];

  for (const target of reservationDeadlineTabs) {
    await selectReservationDeadlineTab(page, target);
    const before = await currentReservationDeadlineState(page, target);
    await page.locator("input").nth(before.indices.date).fill(targetAvailableUntil);

    let restoredExtensionDays = false;
    const expectedExtensionDays = String(target.expectedExtensionDays);
    if (
      config.restoreExpectedExtensionDays &&
      before.indices.days >= 0 &&
      before.extensionDays &&
      before.extensionDays !== expectedExtensionDays
    ) {
      await page.locator("input").nth(before.indices.days).fill(expectedExtensionDays);
      restoredExtensionDays = true;
    }

    const after = await currentReservationDeadlineState(page, target);
    changes.push({
      key: target.key,
      label: target.label,
      before: stripIndices(before),
      after: stripIndices(after),
      expectedExtensionDays: target.expectedExtensionDays,
      restoredExtensionDays,
    });
  }

  return changes;
}

async function clickSave(page) {
  const saveButton = page.getByRole("button", { name: /정보\s*수정\s*완료|저장|수정|완료|적용/ }).last();
  if (!(await saveButton.isVisible().catch(() => false))) {
    throw new Error("Save button not found on StudioMate operation-info page.");
  }
  await saveButton.scrollIntoViewIfNeeded();
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
    saveButton.click()
  ]);
  await page.waitForTimeout(2500);
}

async function inspectScreen(page) {
  const text = await bodyText(page);
  const inputs = await visibleInputMeta(page).catch(() => []);
  const deadlineFields = reservationDeadlineInputState(inputs);
  const visibleMemberAvailability = extractVisibleMemberAvailability(text) || deadlineFields.effectiveAvailableUntil;
  const deadlineTabs = await inspectReservationDeadlineTabs(page).catch((error) => ({
    error: error.message,
  }));
  return {
    currentUrl: page.url(),
    hasOperationInfo: /운영정보/.test(text),
    hasReservationDeadline: /예약\s*가능\s*기한/.test(text),
    hasPrivateLesson: /프라이빗|Private|개인/.test(text),
    hasGroupLesson: /그룹|Group/.test(text),
    visibleMemberAvailability,
    deadlineFields,
    deadlineTabs,
    visibleInputs: inputs
      .filter((input) => /예약\s*가능\s*일자/.test(input.placeholder) || /^\d{4}\.|^\d{1,2}:\d{2}$|^\d+$/.test(input.value))
      .slice(0, 10),
    visibleSummary: compactText(text).slice(0, 1200)
  };
}

function assertVisibleMemberAvailability(screen) {
  const tabs = Array.isArray(screen?.deadlineTabs) ? screen.deadlineTabs : [];
  if (!tabs.length) {
    throw new Error("StudioMate private/group reservation deadline tab state was not found after save.");
  }
  const failures = [];
  for (const tab of tabs) {
    const expectedDates = acceptablePostSaveAvailableUntilValues(tab);
    if (!expectedDates.some((value) => normalizeDateText(value) === normalizeDateText(tab.availableUntil))) {
      failures.push(`${tab.label} date expected ${expectedDates.join(" or ")}, got ${tab.availableUntil || "(blank)"}`);
    }
    if (String(tab.extensionDays || "") !== String(tab.expectedExtensionDays)) {
      failures.push(`${tab.label} extension days expected ${tab.expectedExtensionDays}, got ${tab.extensionDays || "(blank)"}`);
    }
  }
  if (!failures.length) return;
  if (config.allowFutureVisibleUntil) return;
  throw new Error(`StudioMate reservation deadline mismatch: ${failures.join("; ")}`);
}

function acceptablePostSaveAvailableUntilValues(tab) {
  const values = [targetAvailableUntil];
  if (isAfterAutoExtensionMoment(tab)) {
    const autoExtended = addDaysToKoreanDate(targetAvailableUntil, Number(tab.expectedExtensionDays));
    if (autoExtended) values.push(autoExtended);
  }
  return values;
}

function isAfterAutoExtensionMoment(tab) {
  const date = parseKoreanDate(targetAvailableUntil);
  const time = String(tab.extensionTime || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!date || !time) return false;
  date.setHours(Number(time[1]), Number(time[2]), 0, 0);
  return Date.now() >= date.getTime();
}

function extractVisibleMemberAvailability(text) {
  const match = compactText(text).match(/회원은\s*(20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.?)\s*까지\s*예약\s*가능합니다/);
  return match?.[1] || "";
}

function reservationDeadlineInputState(inputs) {
  const date = inputs.find((input) => /예약\s*가능\s*일자/.test(input.placeholder) || /^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?$/.test(input.value));
  const time = inputs.find((input) => date && input.index > date.index && /^\d{1,2}:\d{2}$/.test(input.value));
  const days = inputs.find((input) => time && input.index > time.index && /^\d+$/.test(input.value));
  const extensionDays = days ? Number(days.value) : Number.NaN;
  const effectiveAvailableUntil =
    date && Number.isFinite(extensionDays) ? addDaysToKoreanDate(date.value, extensionDays) : "";
  return {
    availableUntil: date?.value || "",
    extensionTime: time?.value || "",
    extensionDays: days?.value || "",
    effectiveAvailableUntil,
    indices: {
      date: date?.index ?? -1,
      time: time?.index ?? -1,
      days: days?.index ?? -1,
    },
  };
}

async function inspectReservationDeadlineTabs(page) {
  const out = [];
  for (const target of reservationDeadlineTabs) {
    await selectReservationDeadlineTab(page, target);
    const state = await currentReservationDeadlineState(page, target);
    out.push(stripIndices(state));
  }
  return out;
}

async function currentReservationDeadlineState(page, target) {
  await scrollReservationDeadlineIntoView(page);
  const inputs = await visibleInputMeta(page);
  const state = reservationDeadlineInputState(inputs);
  if (state.indices.date < 0) throw new Error(`${target.label} reservation availability date input not found.`);
  if (state.indices.time < 0) throw new Error(`${target.label} reservation auto-extension time input not found.`);
  if (state.indices.days < 0) throw new Error(`${target.label} reservation auto-extension days input not found.`);
  return {
    key: target.key,
    label: target.label,
    expectedExtensionDays: target.expectedExtensionDays,
    availableUntil: state.availableUntil,
    extensionTime: state.extensionTime,
    extensionDays: state.extensionDays,
    effectiveAvailableUntil: state.effectiveAvailableUntil,
    indices: state.indices,
  };
}

async function selectReservationDeadlineTab(page, target) {
  await scrollReservationDeadlineIntoView(page);
  const candidates = [
    page.getByRole("tab", { name: target.tabPattern }).first(),
    page.locator("[role='tab']").filter({ hasText: target.tabPattern }).first(),
    page.locator(".el-tabs__item").filter({ hasText: target.tabPattern }).first(),
    page.locator("button, a, label").filter({ hasText: target.tabPattern }).first(),
  ];

  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.scrollIntoViewIfNeeded().catch(() => {});
      await candidate.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      await scrollReservationDeadlineIntoView(page);
      return;
    }
  }

  throw new Error(`${target.label} reservation deadline tab not found.`);
}

function stripIndices(value) {
  const { indices, ...rest } = value;
  return rest;
}

function addDaysToKoreanDate(value, days) {
  const date = parseKoreanDate(value);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return formatKoreanDate(date);
}

function parseKoreanDate(value) {
  const match = String(value || "").match(/(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function normalizeDateText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/\.$/, "");
}

async function scrollReservationDeadlineIntoView(page) {
  const heading = page.getByText("예약 가능 기한 설정", { exact: false }).first();
  if (await heading.isVisible().catch(() => false)) {
    await heading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }
}

async function visibleInputMeta(page) {
  return page.locator("input").evaluateAll((nodes) =>
    nodes
      .map((node, index) => {
        const rect = node.getBoundingClientRect();
        return {
          index,
          value: node.value || "",
          placeholder: node.getAttribute("placeholder") || "",
          type: node.getAttribute("type") || "",
          visible: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight
        };
      })
      .filter((input) => input.visible)
  );
}

async function assertLoggedIn(page) {
  const text = await bodyText(page);
  if (await isLoginScreen(page, text)) {
    if (config.waitForLogin && !config.headless) {
      await waitForManualLogin(page);
      return;
    }
    throw new Error("StudioMate login required. Run HEADLESS=false WAIT_FOR_LOGIN=true DRY_RUN=true npm run studiomate:reservation-deadline, then log in manually in the opened browser.");
  }
  if (/captcha|보안문자|인증번호/i.test(text)) {
    throw new Error("StudioMate security/captcha/verification screen detected. Manual operator action required.");
  }
}

async function waitForManualLogin(page) {
  console.log("StudioMate login required. Log in manually in the opened browser; automation will resume after the operation-info screen loads.");
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const text = await bodyText(page);
    if (/captcha|보안문자|인증번호/i.test(text)) {
      throw new Error("StudioMate security/captcha/verification screen detected. Manual operator action required.");
    }
    if (!(await isLoginScreen(page, text))) {
      await navigateToOperationInfo(page);
      await closeNoticeDialog(page);
      if (await hasOperationInfoSection(page)) return;
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

async function clickByText(page, text) {
  const target = page.getByText(text, { exact: false }).first();
  if (await target.isVisible().catch(() => false)) {
    await target.click({ timeout: 5000 }).catch(() => {});
  }
}

async function bodyText(page) {
  return page.locator("body").innerText({ timeout: 15000 }).catch(() => "");
}

async function safeText(locator) {
  return compactText(await locator.innerText({ timeout: 5000 }).catch(() => ""));
}

function compactText(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

async function writeLastResult(value) {
  const resultPath = path.join(config.outputDir, "last-reservation-deadline-result.json");
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

function formatKoreanDate(date) {
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}
