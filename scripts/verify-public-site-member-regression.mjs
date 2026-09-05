#!/usr/bin/env node
// Post-deploy execution belongs to the main task. Never run alongside another
// fixture writer. Browsing can emit normal site analytics/session requests.
// No argument: verify existing exact fixtures without changing groups.
// --apply-test-fixtures: temporarily replace ONLY the two pinned test accounts'
// groups, then restore both snapshots with API readback, including on failure.
// SIGINT/SIGTERM request cleanup; SIGKILL/host loss cannot run a finally block.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://archivepilates.imweb.me";
const SITE_CODE = "S20260516852c71a014d08";
const VERSION = "2026-09-04c";
const IMWEB = process.env.IMWEB_CLI || "/Users/archivepilates/.local/bin/imweb";
const LOCK = path.join(tmpdir(), "archive-pilates-public-site-member-regression.lock");
const CASES = Object.freeze([
  { code: "A260829", group: "g20260831856d87e46bff5", path: "/private-lesson-support-movement-a-260829" },
  { code: "B260829", group: "g20260831285f4ebae0f7d", path: "/private-lesson-support-movement-b-260829" },
  { code: "C260830", group: "g2026083145148b595b4dd", path: "/private-lesson-support-movement-c-260830" },
  { code: "D260830", group: "g202608311da9acbcaf394", path: "/private-lesson-support-movement-d-260830" },
  { code: "ACA6", group: "g20260904cd391d32c1196", path: "/archive-method-watch-aca6" },
  { code: "ACH9", group: "g202609044ef28afed03be", path: "/archive-method-watch-ach9" },
].map(Object.freeze));
const ACCOUNTS = Object.freeze([
  Object.freeze({
    role: "BUYER",
    email: "codex.imweb.test.202607011138@archivepilates.com",
    service: "ARCHIVE PILATES Imweb test member",
    groups: Object.freeze(CASES.map((item) => item.group)),
  }),
  Object.freeze({
    role: "NONBUYER",
    email: "codex.imweb.nobuyer.202607011145@archivepilates.com",
    service: "ARCHIVE PILATES Imweb nonbuyer test member",
    groups: Object.freeze([]),
  }),
]);
const VIEWPORTS = [
  { code: "MOBILE390", width: 390, height: 844 },
  { code: "DESKTOP1440", width: 1440, height: 900 },
];
const PROTECTED = '.ap-watch,.ap-private-watch,.ap-private-watch__video,[data-archive-pilates-watch-code],[data-widget-type="video"],iframe[src*="youtube.com/embed"],iframe[src*="youtube-nocookie.com/embed"],iframe[src*="player.vimeo.com/video"],video';
// Native Imweb paid-video widgets create the iframe only after a real play click.
// The visible native launch control is a player surface, not a playback claim.
const MEDIA = 'iframe[src*="youtube.com/embed"],iframe[src*="youtube-nocookie.com/embed"],iframe[src*="player.vimeo.com/video"],video[src],video:has(source[src]),[data-widget-type="video"] ._img_box';
const DENIED = /(?:\uad8c\ud55c\uc774?\s*\uc5c6|\uc811\uadfc\s*\uad8c\ud55c|\uc811\uadfc\uc774?\s*\uc81c\ud55c|\uc774\uc6a9\s*\uad8c\ud55c|\uad8c\ud55c\uc774\s*\ud544\uc694|access\s*denied|permission\s*denied|forbidden)/i;

class GateError extends Error {}
function requireGate(condition, code) {
  if (!condition) throw new GateError(code);
}
function errorCode(error) {
  return error instanceof GateError ? error.message : "UNEXPECTED_FAILURE";
}
function equalGroups(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
function knownAccount(account) {
  requireGate(ACCOUNTS.includes(account), "UNKNOWN_ACCOUNT_FORBIDDEN");
}
function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  requireGate(args.every((arg) => ["--help", "--apply-test-fixtures"].includes(arg)), "UNKNOWN_ARGUMENT");
  requireGate(new Set(args).size === args.length, "DUPLICATE_ARGUMENT");
  if (args.includes("--help")) {
    emit({ code: "READ_ONLY_DEFAULT", fixtureFlag: "--apply-test-fixtures", accountCount: 2, caseCount: 6, viewportCount: 2 });
    return;
  }
  const apply = args.includes("--apply-test-fixtures");
  // Playwright debug logs can contain fill values; never enable them in this helper.
  for (const key of ["DEBUG", "PWDEBUG", "NODE_DEBUG", "NODE_OPTIONS"]) delete process.env[key];
  let locked = false;
  let browser;
  let interrupted = false;
  const snapshots = [];
  const results = [];
  const failures = [];
  let evidence;
  const checkActive = () => requireGate(!interrupted, "INTERRUPTED");
  const stop = () => {
    interrupted = true;
    if (browser) void browser.close().catch(() => {});
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    try {
      mkdirSync(LOCK, { mode: 0o700 });
      locked = true;
    } catch {
      throw new GateError("FIXTURE_LOCK_UNAVAILABLE");
    }
    const runCode = new Date().toISOString().replace(/[^0-9]/g, "");
    evidence = path.join(ROOT, "artifacts/public-site-ux-20260905", `member-regression-${runCode}`);
    mkdirSync(evidence, { recursive: true, mode: 0o700 });
    emit({ code: apply ? "PINNED_TEST_FIXTURES_ONLY" : "READ_ONLY_GROUPS", accountCount: 2 });
    assertTarget();
    for (const account of ACCOUNTS) {
      const member = readMember(account);
      snapshots.push({ account, groups: [...member.group], attempted: false, member, restored: false });
    }
    if (!apply) {
      requireGate(snapshots.every(({ account, groups }) => equalGroups(groups, account.groups)), "EXACT_FIXTURES_REQUIRED_USE_APPLY_TEST_FIXTURES");
    }
    const passwords = ACCOUNTS.map((account) => keychainPassword(account));
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--autoplay-policy=user-gesture-required"] });
    checkActive();
    if (apply) {
      for (const snapshot of snapshots) {
        checkActive();
        requireGate(equalGroups(readMember(snapshot.account).group, snapshot.groups), "FIXTURE_CHANGED_SINCE_SNAPSHOT");
        if (!equalGroups(snapshot.groups, snapshot.account.groups)) {
          // Mark before the write: an uncertain CLI result must still be restored.
          snapshot.attempted = true;
          setGroups(snapshot.account, snapshot.account.groups, apply);
        }
        assertGroups(snapshot.account, snapshot.account.groups);
      }
    }
    for (const [index, snapshot] of snapshots.entries()) {
      checkActive();
      assertGroups(snapshot.account, snapshot.account.groups);
      // Authenticate once per role. Keep storageState and identity only in memory.
      const state = await loginState(browser, snapshot.account, passwords[index]);
      passwords[index] = "";
      for (const viewport of VIEWPORTS) {
        checkActive();
        results.push(await verifyAccount(browser, snapshot, state, viewport, evidence, checkActive));
      }
    }
  } catch (error) {
    failures.push(errorCode(error));
  } finally {
    // Each cleanup is independent: one restoration failure must not skip the other.
    if (browser) {
      try { await browser.close(); } catch { failures.push("BROWSER_CLOSE_FAILED"); }
    }
    for (const snapshot of [...snapshots].reverse()) {
      let restoreWriteFailed = false;
      if (snapshot.attempted) {
        try { setGroups(snapshot.account, snapshot.groups, apply); } catch { restoreWriteFailed = true; }
      }
      try {
        assertGroups(snapshot.account, snapshot.groups);
        snapshot.restored = true;
        emit({ code: "ORIGINAL_GROUPS_VERIFIED", role: snapshot.account.role, groupCount: snapshot.groups.length });
        if (restoreWriteFailed) emit({ code: "RESTORE_CLI_UNCERTAIN_READBACK_MATCHED", role: snapshot.account.role });
      } catch {
        failures.push(`${snapshot.account.role}_RESTORE_READBACK_FAILED`);
      }
    }
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (locked) {
      try { rmdirSync(LOCK); } catch { failures.push("FIXTURE_LOCK_RELEASE_FAILED"); }
    }
  }
  if (interrupted) failures.push("INTERRUPTED");
  const summary = {
    code: "PUBLIC_SITE_MEMBER_REGRESSION",
    mode: apply ? "TEMPORARY_TEST_GROUPS" : "READ_ONLY_GROUPS",
    expectedCaseCount: 6,
    expectedMatrixCount: 4,
    completedMatrixCount: results.length,
    restoredAccountCount: snapshots.filter((snapshot) => snapshot.restored).length,
    failureCodes: [...new Set(failures)],
    results,
  };
  summary.failureCount = summary.failureCodes.length + results.filter((result) => result.failureCodes.length > 0).length;
  summary.ok = summary.failureCount === 0 && results.length === 4 && summary.restoredAccountCount === 2;
  if (evidence) {
    try {
      writeFileSync(path.join(evidence, "member-regression.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
    } catch {
      summary.failureCodes.push("EVIDENCE_REPORT_WRITE_FAILED");
      summary.failureCount += 1;
      summary.ok = false;
    }
  }
  emit(summary);
  process.exitCode = summary.ok ? 0 : 1;
}

function assertTarget() {
  const context = runJson(["config", "context"]);
  requireGate(context?.resolved_profile?.site_code === SITE_CODE && Boolean(context.resolved_profile.unit_code), "IMWEB_TARGET_MISMATCH");
}
function readMember(account) {
  knownAccount(account);
  assertTarget();
  const member = runJson(["member", "get", account.email])?.data;
  requireGate(member && String(member.uid || "").trim().toLowerCase() === account.email, "PINNED_MEMBER_IDENTITY_MISMATCH");
  requireGate(Array.isArray(member.group) && member.group.every((group) => typeof group === "string" && /^g[0-9a-z]+$/i.test(group)), "INVALID_GROUP_READBACK");
  requireGate(new Set(member.group).size === member.group.length, "DUPLICATE_GROUP_READBACK");
  for (const key of ["is_admin", "isAdmin", "is_owner", "isOwner", "is_staff", "isStaff"]) {
    requireGate(![true, 1, "1", "Y", "true"].includes(member[key]), "PRIVILEGED_MEMBER_FORBIDDEN");
  }
  return member;
}
function assertGroups(account, expected) {
  requireGate(equalGroups(readMember(account).group, expected), "GROUP_READBACK_MISMATCH");
}
function setGroups(account, groupCodes, apply) {
  requireGate(apply === true, "FIXTURE_MUTATION_FLAG_REQUIRED");
  knownAccount(account);
  readMember(account);
  const data = JSON.stringify({ groupCodes });
  const preview = runJson(["member", "update", "groups", account.email, "--dry-run", "--data", data]);
  requireGate(typeof preview?.confirmation_token === "string" && preview.confirmation_token.length > 0, "GROUP_CONFIRMATION_MISSING");
  assertTarget();
  runJson(["member", "update", "groups", account.email, "--yes", "--confirm-token", preview.confirmation_token, "--data", data]);
}
function runJson(args) {
  const result = spawnSync(IMWEB, ["--output", "json", ...args], {
    cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
  requireGate(!result.error && result.status === 0, "IMWEB_CLI_FAILED");
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw new GateError("IMWEB_JSON_INVALID"); }
  requireGate(value && value.ok !== false && value.success !== false && !value.error, "IMWEB_RESPONSE_FAILED");
  return value;
}
function keychainPassword(account) {
  knownAccount(account);
  const result = spawnSync("/usr/bin/security", ["find-generic-password", "-s", account.service, "-w"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000,
  });
  requireGate(!result.error && result.status === 0 && String(result.stdout || "").trim().length > 0, "TEST_KEYCHAIN_UNAVAILABLE");
  return result.stdout.trim();
}

async function loginState(browser, account, password) {
  knownAccount(account);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const response = await page.goto(`${SITE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
    requireGate(response?.ok() && new URL(page.url()).origin === SITE, "LOGIN_PAGE_FAILED");
    await page.getByRole("textbox", { name: "\uc774\uba54\uc77c", exact: true }).fill(account.email);
    await page.getByRole("textbox", { name: "\ube44\ubc00\ubc88\ud638", exact: true }).fill(password);
    await page.getByRole("button", { name: "\ub85c\uadf8\uc778", exact: true }).click();
    await page.waitForFunction((email) => globalThis.IS_GUEST === false && String(globalThis.MEMBER_UID || "").toLowerCase() === email, account.email, { timeout: 30000 });
    requireGate(await ordinarySession(page, account), "LOGIN_IDENTITY_MISMATCH");
    return await context.storageState();
  } catch (error) {
    throw new GateError(error instanceof GateError ? error.message : "TEST_MEMBER_LOGIN_FAILED");
  } finally {
    await context.close();
  }
}

async function ordinarySession(page, account) {
  return page.evaluate((email) => {
    const privileged = [globalThis.IS_ADMIN, globalThis.IS_OWNER, globalThis.IS_STAFF].some((value) => [true, 1, "1", "Y", "true"].includes(value));
    return !privileged && globalThis.IS_GUEST === false && String(globalThis.MEMBER_UID || "").toLowerCase() === email;
  }, account.email);
}

async function verifyAccount(browser, snapshot, storageState, viewport, evidence, checkActive) {
  const { account, member } = snapshot;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.code === "MOBILE390", hasTouch: viewport.code === "MOBILE390", storageState,
  });
  const result = { role: account.role, viewport: viewport.code, failureCodes: [], warningCodes: [], classroom: null, protectedPages: [] };
  const fail = (condition, code) => { if (!condition) result.failureCodes.push(code); };
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    let denialDialogCount = 0;
    page.on("dialog", async (dialog) => {
      if (DENIED.test(dialog.message())) denialDialogCount += 1;
      await dialog.dismiss().catch(() => {});
    });
    const diagnostics = observeNetwork(page);
    let response = await page.goto(`${SITE}/48`, { waitUntil: "domcontentloaded", timeout: 45000 });
    requireGate(response?.ok() && atPath(page, "/48"), "CLASSROOM_HTTP_FAILED");
    await page.waitForFunction((version) => document.documentElement.getAttribute("data-ap-classroom-v2-complete") === version, VERSION, { timeout: 90000 });
    requireGate(await ordinarySession(page, account), "CLASSROOM_SESSION_MISMATCH");
    const classroom = await page.evaluate((cases) => {
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0;
      };
      const cards = Array.from(document.querySelectorAll(".apc-card"));
      const codes = cards.map((card) => String(card.querySelector(".apc-code")?.textContent || "").trim());
      const expected = new Map(cases.map((item) => [item.code, item.path]));
      const source = document.documentElement.getAttribute("data-ap-classroom-last-source") || "none";
      return {
        cardCount: cards.length,
        visibleCardCount: cards.filter(visible).length,
        codes: codes.filter((code) => expected.has(code)),
        unknownCardCount: codes.filter((code) => !expected.has(code)).length,
        linkMismatchCount: cards.filter((card, index) => {
          try {
            const url = new URL(card.getAttribute("href"), location.href);
            return url.origin !== location.origin || url.pathname.replace(/\/$/, "") !== expected.get(codes[index]) || Boolean(url.search || url.hash);
          } catch { return true; }
        }).length,
        source: ["none", "fetch", "profile", "manual"].includes(source) ? source.toUpperCase() : "UNKNOWN",
        emptyVisible: Array.from(document.querySelectorAll(".apc-empty")).some(visible),
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    }, CASES);
    result.classroom = classroom;
    const expectedCodes = account.role === "BUYER" ? CASES.map((item) => item.code) : [];
    // Compare the complete list first; filtering to just expected cards would hide leaks.
    fail(classroom.cardCount === expectedCodes.length && classroom.unknownCardCount === 0 && equalGroups(classroom.codes, expectedCodes), "CLASSROOM_EXACT_CODES_MISMATCH");
    fail(classroom.visibleCardCount === expectedCodes.length, "CLASSROOM_HIDDEN_CARDS");
    fail(classroom.linkMismatchCount === 0, "CLASSROOM_WATCH_LINK_MISMATCH");
    fail(!classroom.horizontalOverflow, "CLASSROOM_HORIZONTAL_OVERFLOW");
    fail(classroom.emptyVisible === (account.role === "NONBUYER"), "CLASSROOM_EMPTY_STATE_MISMATCH");
    fail(account.role === "BUYER" ? ["FETCH", "PROFILE"].includes(classroom.source) : classroom.source === "NONE", "CLASSROOM_DISCOVERY_NOT_ORDINARY");
    fail(diagnostics.probeRequests > 0, "REAL_DISCOVERY_NETWORK_MISSING");
    await screenshot(page, member, `${account.role}-${viewport.code}-CLASSROOM`, evidence);

    for (const item of CASES) {
      checkActive();
      denialDialogCount = 0;
      try {
        response = await page.goto(`${SITE}${item.path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        const status = response?.status() || 0;
        if (account.role === "BUYER" && response?.ok() && atPath(page, item.path)) {
          await page.waitForFunction((selector) => Boolean(document.querySelector(selector)), MEDIA, { timeout: 15000 });
        }
        const media = await page.evaluate(({ protectedSelector, mediaSelector, denialSource, email }) => {
          const mediaNodes = Array.from(document.querySelectorAll(mediaSelector));
          return {
            protectedPresent: Boolean(document.querySelector(protectedSelector)),
            mediaCount: mediaNodes.length,
            visibleMediaCount: mediaNodes.filter((node) => {
              const rect = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility === "visible";
            }).length,
            denied: new RegExp(denialSource, "i").test(document.body?.innerText || ""),
            sessionRejected: globalThis.IS_GUEST === true || Boolean(globalThis.MEMBER_UID && String(globalThis.MEMBER_UID).toLowerCase() !== email),
            autoplayCount: mediaNodes.filter((node) => node.autoplay || /[?&]autoplay=1(?:&|$)/.test(node.getAttribute("src") || "")).length,
            playingCount: Array.from(document.querySelectorAll("video,audio")).filter((node) => !node.paused || node.currentTime > 0).length,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          };
        }, { protectedSelector: PROTECTED, mediaSelector: MEDIA, denialSource: DENIED.source, email: account.email });
        const expectedAccess = account.role === "BUYER";
        const accessible = Boolean(response?.ok() && atPath(page, item.path) && media.mediaCount > 0 && media.visibleMediaCount > 0);
        // A missing video on a timeout, login redirect, 404, 429 or 5xx is NOT denial proof.
        const denied = [200, 403].includes(status) && atPath(page, item.path) && !media.protectedPresent && (status === 403 || media.denied || denialDialogCount > 0);
        const passed = expectedAccess ? accessible && !media.denied && await ordinarySession(page, account) : denied && !media.sessionRejected;
        result.protectedPages.push({ code: item.code, status, expectedAccess, accessible, denied, mediaCount: media.mediaCount, ok: passed });
        fail(passed, `${item.code}_ACCESS_MISMATCH`);
        fail(!media.horizontalOverflow, `${item.code}_HORIZONTAL_OVERFLOW`);
        fail(media.autoplayCount === 0 && media.playingCount === 0, `${item.code}_AUTOPLAY_DETECTED`);
        await screenshot(page, member, `${account.role}-${viewport.code}-${item.code}`, evidence);
      } catch (error) {
        result.failureCodes.push(`${item.code}_${error instanceof GateError ? error.message : "WATCH_CHECK_FAILED"}`);
      }
    }
    checkActive();
    // Reconfirm the ordinary session after the denied-page matrix, including 403 shells.
    response = await page.goto(`${SITE}/48`, { waitUntil: "domcontentloaded", timeout: 45000 });
    requireGate(response?.ok() && atPath(page, "/48") && await ordinarySession(page, account), "FINAL_MEMBER_SESSION_FAILED");
    await page.waitForFunction((version) => document.documentElement.getAttribute("data-ap-classroom-v2-complete") === version, VERSION, { timeout: 90000 });
    assertGroups(account, account.groups);
    fail(result.protectedPages.length === CASES.length, "INCOMPLETE_PROTECTED_MATRIX");
    result.network = structuredClone(diagnostics);
    // Captured on the untouched live baseline before this UI release. Keep it
    // visible as a warning; never suppress page errors in the production site.
    const baselineMenuRace = diagnostics.pageErrorKinds.filter(message =>
      message.startsWith("TypeError: Cannot read properties of undefined (reading 'querySelector')") &&
      message.includes("at calculateMenuWidth (https://archivepilates.imweb.me/js/header_more_menu.js?")
    );
    if (baselineMenuRace.length) result.warningCodes.push("PREEXISTING_IMWEB_HEADER_MORE_MENU_RACE");
    fail(diagnostics.pageErrorKinds.length === baselineMenuRace.length, "NEW_PAGE_ERRORS");
    fail(diagnostics.failedFirstPartyRequests === 0, "FIRST_PARTY_REQUEST_FAILURES");
    fail(diagnostics.unexpectedHttpFailures === 0, "UNEXPECTED_HTTP_FAILURES");
    fail(diagnostics.probeResponses > 0, "REAL_DISCOVERY_RESPONSES_MISSING");
    fail(diagnostics.legacyProbeRequests === 0, "LEGACY_PROBES_OBSERVED");
  } catch (error) {
    result.failureCodes.push(errorCode(error));
  } finally {
    try { await context.close(); } catch { result.failureCodes.push("CONTEXT_CLOSE_FAILED"); }
  }
  result.failureCodes = [...new Set(result.failureCodes)];
  emit({ code: "MATRIX_COMPLETE", role: account.role, viewport: viewport.code, failureCount: result.failureCodes.length, protectedPageCount: result.protectedPages.length });
  return result;
}

function atPath(page, expected) {
  const url = new URL(page.url());
  return url.origin === SITE && url.pathname.replace(/\/$/, "") === expected;
}

function observeNetwork(page) {
  const counters = { probeRequests: 0, probeResponses: 0, legacyProbeRequests: 0, failedFirstPartyRequests: 0, unexpectedHttpFailures: 0, pageErrors: 0, pageErrorKinds: [], consoleErrors: 0, statusCounts: {} };
  const isProbe = (url) => url.searchParams.has("ap_classroom_probe") || url.searchParams.has("ap_classroom_fetch_probe");
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== SITE) return;
    if (isProbe(url)) counters.probeRequests += 1;
    if (url.searchParams.has("ap_classroom_probe")) counters.legacyProbeRequests += 1;
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== SITE) return;
    const status = response.status();
    counters.statusCounts[status] = (counters.statusCounts[status] || 0) + 1;
    if (isProbe(url)) counters.probeResponses += 1;
    const deniedWatch = status === 403 && (isProbe(url) || CASES.some((item) => item.path === url.pathname.replace(/\/$/, "")));
    if (status >= 400 && !deniedWatch) counters.unexpectedHttpFailures += 1;
  });
  page.on("requestfailed", (request) => { if (new URL(request.url()).origin === SITE) counters.failedFirstPartyRequests += 1; });
  page.on("pageerror", error => {
    counters.pageErrors += 1;
    const message = String(error.stack || error.message).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]").replace(/\b\d{7,}\b/g, "[redacted]");
    if (!counters.pageErrorKinds.includes(message)) counters.pageErrorKinds.push(message.slice(0, 1000));
  });
  page.on("console", (message) => { if (message.type() === "error") counters.consoleErrors += 1; });
  return counters;
}

async function screenshot(page, member, code, evidence) {
  // Redaction is screenshot-only CSS after assertions. Never rewrite DOM, inject
  // cards, save HTML/storageState, record traces/HAR, or log browser/CLI errors.
  const privateValues = [member.uid, member.email, member.name, member.phone, member.tel, member.mobile]
    .filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim());
  const masks = ["iframe", "input", "textarea", "[contenteditable]", ".apc-account", "#member_profile", ".member_profile", ".profile-area", ".member-info", ".profile-info", ".dropdown-profile", "[class*=avatar]"];
  try {
    requireGate(new URL(page.url()).origin === SITE, "SCREENSHOT_ORIGIN_MISMATCH");
    for (const frame of [page.mainFrame()]) {
      const selectors = await frame.evaluate((values) => {
        const pattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+82[ -]?)?0?1[016789][ -]?\d{3,4}[ -]?\d{4}/i;
        const matches = (text) => pattern.test(text) || values.some((value) => text.includes(value));
        const cssPath = (element) => {
          const parts = [];
          for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
            parts.unshift(`:nth-child(${Array.prototype.indexOf.call(node.parentElement.children, node) + 1})`);
          }
          return `html>${parts.join(">")}`;
        };
        return Array.from(document.querySelectorAll("body *")).filter((node) => {
          if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.tagName)) return false;
          const ownText = Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent || "").join(" ");
          return matches(ownText) || matches(node.getAttribute("alt") || "");
        }).map(cssPath);
      }, privateValues);
      masks.push(...selectors);
    }
    await page.screenshot({ path: path.join(evidence, `${code}.png`), fullPage: true, style: `${masks.join(",")} { visibility: hidden !important; }` });
  } catch {
    // Do not fall back to an unredacted screenshot when a frame cannot be inspected.
    throw new GateError("SANITIZED_SCREENSHOT_FAILED");
  }
}

main().catch((error) => {
  emit({ code: errorCode(error), failureCount: 1 });
  process.exitCode = 1;
});
