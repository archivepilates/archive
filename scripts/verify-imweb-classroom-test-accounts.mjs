#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const SITE = "https://archivepilates.imweb.me";
const CLASSROOM_PATH = "/48";
const VERSION = "2026-09-01a";
const IMWEB = process.env.IMWEB_CLI || "/Users/archivepilates/.local/bin/imweb";

const BUYER = {
  email: "codex.imweb.test.202607011138@archivepilates.com",
  keychainService: "ARCHIVE PILATES Imweb test member",
};
const NONBUYER = {
  email: "codex.imweb.nobuyer.202607011145@archivepilates.com",
  keychainService: "ARCHIVE PILATES Imweb nonbuyer test member",
};
const TEST_ACCESS = {
  code: "A260829",
  groupCode: "g20260831856d87e46bff5",
  path: "/private-lesson-support-movement-a-260829",
};
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

const originalBuyerGroups = memberGroups(BUYER.email);
const originalNonbuyerGroups = memberGroups(NONBUYER.email);
const results = [];

assert(
  originalNonbuyerGroups.length === 0,
  "The non-buyer test account has groups. Restore it before running the access gate.",
);

const browser = await chromium.launch({ headless: true });
try {
  updateGroups(BUYER.email, [TEST_ACCESS.groupCode]);
  assertGroups(BUYER.email, [TEST_ACCESS.groupCode], "test access assignment");

  const buyerPassword = keychainPassword(BUYER.keychainService);
  const nonbuyerPassword = keychainPassword(NONBUYER.keychainService);

  for (const viewport of VIEWPORTS) {
    results.push(await verifyAccount({
      account: BUYER,
      expectedCodes: [TEST_ACCESS.code],
      password: buyerPassword,
      role: "authorized",
      viewport,
    }));
    results.push(await verifyAccount({
      account: NONBUYER,
      expectedCodes: [],
      password: nonbuyerPassword,
      role: "unauthorized",
      viewport,
    }));
  }
} finally {
  let restorationError;
  try {
    updateGroups(BUYER.email, originalBuyerGroups);
    assertGroups(BUYER.email, originalBuyerGroups, "test account restoration");
  } catch (error) {
    restorationError = error;
  }
  await browser.close();
  if (restorationError) throw restorationError;
}

console.log(
  JSON.stringify(
    {
      ok: results.every((result) => result.ok),
      gate: "imweb-classroom-test-accounts",
      classroomVersion: VERSION,
      temporaryAccess: TEST_ACCESS.code,
      restoredBuyerGroupCount: originalBuyerGroups.length,
      results,
    },
    null,
    2,
  ),
);

async function verifyAccount({ account, expectedCodes, password, role, viewport }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  try {
    await login(page, account.email, password);
    await page.goto(`${SITE}${CLASSROOM_PATH}?ap_test_account_gate=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForFunction(
      (version) =>
        document.documentElement.getAttribute("data-ap-classroom-v2-complete") === version,
      VERSION,
      { timeout: 70000 },
    );

    const state = await page.evaluate(() => {
      const root = document.documentElement;
      const codes = Array.from(document.querySelectorAll(".apc-code"), (node) =>
        String(node.textContent || "").trim(),
      );
      const links = Array.from(document.querySelectorAll(".apc-card"), (node) =>
        String(node.getAttribute("href") || ""),
      );
      return {
        cardCount: codes.length,
        codes,
        links,
        emptyVisible: Boolean(document.querySelector(".apc-empty")),
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        isGuest: globalThis.IS_GUEST,
        source: root.getAttribute("data-ap-classroom-last-source") || "",
        version: root.getAttribute("data-ap-classroom-v2-complete") || "",
      };
    });

    const expected = [...expectedCodes].sort();
    const actual = [...state.codes].sort();
    assert(state.isGuest === false, `${role}/${viewport.name}: session is guest.`);
    assert(state.version === VERSION, `${role}/${viewport.name}: stale classroom version.`);
    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      `${role}/${viewport.name}: expected ${expected.join(",") || "no cards"}, got ${actual.join(",") || "no cards"}.`,
    );
    assert(!state.horizontalOverflow, `${role}/${viewport.name}: horizontal overflow detected.`);
    assert(state.source !== "manual", `${role}/${viewport.name}: admin/manual bypass was used.`);

    if (role === "authorized") {
      assert(!state.emptyVisible, `${role}/${viewport.name}: empty state is visible.`);
      assert(state.links.includes(TEST_ACCESS.path), `${role}/${viewport.name}: expected watch link missing.`);
      await page.goto(`${SITE}${TEST_ACCESS.path}?ap_test_account_gate=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForFunction(
        () =>
          Boolean(
            document.querySelector(
              '.ap-private-watch,.ap-private-watch__video,iframe[src*="youtube.com/embed"],iframe[src*="youtube-nocookie.com/embed"]',
            ),
          ),
        null,
        { timeout: 15000 },
      );
      const watchVisible = await page
        .getByRole("heading", { name: /지지와 움직임|수강생 공유/i })
        .count()
        .catch(() => 0);
      const protectedMedia = await page.evaluate(() =>
        Boolean(
          document.querySelector(
            '.ap-private-watch,.ap-private-watch__video,iframe[src*="youtube.com/embed"],iframe[src*="youtube-nocookie.com/embed"]',
          ),
        ),
      );
      assert(watchVisible > 0 || protectedMedia, `${role}/${viewport.name}: watch page did not render.`);
    } else {
      assert(state.emptyVisible, `${role}/${viewport.name}: empty state is missing.`);
      await page.goto(`${SITE}${TEST_ACCESS.path}?ap_test_account_gate=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const leakedMedia = await page.evaluate(() =>
        Boolean(
          document.querySelector(
            '.ap-private-watch,.ap-private-watch__video,iframe[src*="youtube.com/embed"],iframe[src*="youtube-nocookie.com/embed"]',
          ),
        ),
      );
      assert(!leakedMedia, `${role}/${viewport.name}: protected media leaked to non-buyer.`);
    }

    return {
      ok: true,
      role,
      viewport: viewport.name,
      cardCount: state.cardCount,
      codes: state.codes,
      discoverySource: state.source || "none",
      horizontalOverflow: state.horizontalOverflow,
    };
  } finally {
    await context.close();
  }
}

async function login(page, email, password) {
  await page.goto(`${SITE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("textbox", { name: "이메일" }).fill(email);
  await page.locator('input[name="passwd"]').fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForFunction(
    () => globalThis.IS_GUEST === false && Boolean(globalThis.MEMBER_UID),
    null,
    { timeout: 30000 },
  );
  const loggedIn = await page.evaluate(() => globalThis.IS_GUEST === false && Boolean(globalThis.MEMBER_UID));
  assert(loggedIn, "Test-account login failed.");
}

function memberGroups(email) {
  const result = runJson(["member", "get", email]);
  return Array.isArray(result?.data?.group) ? result.data.group : [];
}

function assertGroups(email, expectedGroups, label) {
  const actual = memberGroups(email);
  assert(
    JSON.stringify([...actual].sort()) === JSON.stringify([...expectedGroups].sort()),
    `${label}: Imweb group readback mismatch.`,
  );
}

function updateGroups(email, groupCodes) {
  const data = JSON.stringify({ groupCodes });
  const dryRun = runJson(["member", "update", "groups", email, "--dry-run", "--data", data]);
  assert(dryRun?.confirmation_token, "Imweb group update dry-run did not return a confirmation token.");
  runJson([
    "member",
    "update",
    "groups",
    email,
    "--yes",
    "--confirm-token",
    dryRun.confirmation_token,
    "--data",
    data,
  ]);
}

function keychainPassword(service) {
  const result = spawnSync("security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert(result.status === 0, `Missing macOS Keychain password for ${service}.`);
  return String(result.stdout || "").trim();
}

function runJson(args) {
  const result = spawnSync(IMWEB, ["--output", "json", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Imweb CLI failed: ${String(result.stderr || result.stdout || "").trim()}`);
  }
  return JSON.parse(result.stdout);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
