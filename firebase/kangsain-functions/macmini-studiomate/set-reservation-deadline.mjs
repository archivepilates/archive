#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const config = {
  baseUrl: env("STUDIOMATE_BASE_URL", "https://arcpilates.studiomate.kr"),
  operationInfoPath: env("STUDIOMATE_OPERATION_INFO_PATH", ""),
  profileDir: expandHome(env("STUDIOMATE_PROFILE_DIR", "~/ArchiveIN/automation/browser-profile")),
  outputDir: expandHome(env("STUDIOMATE_OUTPUT_DIR", "~/ArchiveIN/automation/studiomate-results")),
  headless: env("HEADLESS", "false") === "true",
  waitForLogin: env("WAIT_FOR_LOGIN", "false") === "true",
  dryRun: env("DRY_RUN", "true") !== "false",
  confirm: env("CONFIRM", "false") === "true",
  availableUntil: env("STUDIOMATE_RESERVATION_AVAILABLE_UNTIL", ""),
  extensionDays: Number(env("STUDIOMATE_RESERVATION_EXTENSION_DAYS", "13")),
  extensionTime: env("STUDIOMATE_RESERVATION_EXTENSION_TIME", "13:00")
};

const startedAt = new Date();
const targetAvailableUntil = config.availableUntil || formatKoreanDate(addDays(startedAt, config.extensionDays));
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
    appliesTo: ["프라이빗 수업", "그룹 수업"],
    availableUntil: targetAvailableUntil,
    extensionDays: config.extensionDays,
    extensionTime: config.extensionTime
  }
};

if (!config.dryRun && !config.confirm) {
  throw new Error("Real StudioMate setting update requires CONFIRM=true. Use DRY_RUN=true to inspect only.");
}

await mkdir(config.profileDir, { recursive: true });
await mkdir(config.outputDir, { recursive: true });

const { chromium } = await import("playwright");
const context = await chromium.launchPersistentContext(config.profileDir, {
  acceptDownloads: false,
  headless: config.headless
});
const page = await context.newPage();

try {
  await navigateToOperationInfo(page);
  await closeNoticeDialog(page);
  await assertLoggedIn(page);
  await ensureReservationDeadlineSection(page);

  result.screen = await inspectScreen(page);
  result.preview = {
    message: `Set private/group reservation availability until ${targetAvailableUntil}; auto-extend ${config.extensionDays} days at ${config.extensionTime}.`,
    currentUrl: page.url()
  };

  if (config.dryRun) {
    result.ok = true;
    result.message = "DRY_RUN: operation-info reservation deadline screen inspected. Save click skipped.";
  } else {
    result.changed = await updateReservationDeadlineSetting(page);
    await clickSave(page);
    result.ok = true;
    result.message = "StudioMate reservation deadline settings saved.";
  }
} catch (error) {
  result.ok = false;
  result.error = error.message;
  result.diagnostic = {
    currentUrl: page.url(),
    visibleSummary: compactText(await bodyText(page)).slice(0, 1200)
  };
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeLastResult(result);
  console.log(JSON.stringify(result, null, 2));
  await context.close();
}

async function navigateToOperationInfo(page) {
  const firstPath = config.operationInfoPath || "/settings";
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
  const inputs = await visibleInputMeta(page);
  const date = inputs.find((input) => /예약\s*가능\s*일자/.test(input.placeholder) || /^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?$/.test(input.value));
  if (!date) throw new Error("Reservation availability date input not found.");

  const time = inputs.find((input) => input.index > date.index && /^\d{1,2}:\d{2}$/.test(input.value));
  if (!time) throw new Error("Reservation auto-extension time input not found.");

  const days = inputs.find((input) => input.index > time.index && /^\d+$/.test(input.value));
  if (!days) throw new Error("Reservation auto-extension days input not found.");

  await page.locator("input").nth(date.index).fill(targetAvailableUntil);
  await page.locator("input").nth(time.index).fill(config.extensionTime);
  await page.locator("input").nth(days.index).fill(String(config.extensionDays));

  return {
    before: {
      availableUntil: date.value,
      extensionTime: time.value,
      extensionDays: days.value
    },
    after: {
      availableUntil: targetAvailableUntil,
      extensionTime: config.extensionTime,
      extensionDays: String(config.extensionDays)
    }
  };
}

async function clickSave(page) {
  const saveButton = page
    .locator("button, a")
    .filter({ hasText: /저장|수정|완료|적용/ })
    .last();
  if (!(await saveButton.isVisible().catch(() => false))) {
    throw new Error("Save button not found on StudioMate operation-info page.");
  }
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
    saveButton.click()
  ]);
}

async function inspectScreen(page) {
  const text = await bodyText(page);
  const inputs = await visibleInputMeta(page).catch(() => []);
  return {
    currentUrl: page.url(),
    hasOperationInfo: /운영정보/.test(text),
    hasReservationDeadline: /예약\s*가능\s*기한/.test(text),
    hasPrivateLesson: /프라이빗|Private|개인/.test(text),
    hasGroupLesson: /그룹|Group/.test(text),
    visibleInputs: inputs
      .filter((input) => /예약\s*가능\s*일자/.test(input.placeholder) || /^\d{4}\.|^\d{1,2}:\d{2}$|^\d+$/.test(input.value))
      .slice(0, 10),
    visibleSummary: compactText(text).slice(0, 1200)
  };
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

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatKoreanDate(date) {
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}
