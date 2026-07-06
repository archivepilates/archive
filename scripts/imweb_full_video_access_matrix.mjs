#!/usr/bin/env node
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/archivepilates/Documents/ARCHIVE-IN";
const IMWEB = "/Users/archivepilates/.local/bin/imweb";
const SITE = "https://archivepilates.imweb.me";
const BUYER_EMAIL = "codex.imweb.test.202607011138@archivepilates.com";
const NONBUYER_EMAIL = "codex.imweb.nobuyer.202607011145@archivepilates.com";
const BUYER_KEYCHAIN_SERVICE = "ARCHIVE PILATES Imweb test member";
const NONBUYER_KEYCHAIN_SERVICE = "ARCHIVE PILATES Imweb nonbuyer test member";
const OUT_DIR = process.env.IMWEB_ACCESS_MATRIX_OUT_DIR || join(ROOT, "artifacts", "imweb-full-video-access-matrix-2026-07-01");
const SHOT_DIR = process.env.IMWEB_ACCESS_MATRIX_SHOT_DIR || join(ROOT, "output", "playwright", "imweb-full-video-access-matrix-2026-07-01");
const SKIP_BUYER_MATRIX = process.argv.includes("--skip-buyer-matrix");
const DIRECT_OPENAPI_WRITES = process.argv.includes("--direct-openapi-writes");
const IMWEB_AUTH_PATH = "/Users/archivepilates/Library/Application Support/me.imweb.imweb-cli/auth.json";

const VIDEO_PRODUCTS = [
  { prodNo: 28, code: "ACH7", groupCode: "g202606280088d48c168dd", videoId: "UR2c0z7op8M" },
  { prodNo: 29, code: "ACA4", groupCode: "g202606286a5f40cd97cff", videoId: "2nfEIKt92Bc" },
  { prodNo: 30, code: "AB7", groupCode: "g2026062844c875efbe83d", videoId: "FZ960TW_GmU" },
  { prodNo: 31, code: "AR3", groupCode: "g20260628d909ece7b18d4", videoId: "VzNiehvLZdk" },
  { prodNo: 32, code: "AB6", groupCode: "g202606284da349b19a03c", videoId: "xPQM4kuDb4o" },
  { prodNo: 33, code: "ACH6", groupCode: "g20260628f72b1c85bfa18", videoId: "7iYTJQ1fdGM" },
  { prodNo: 50, code: "ACH8", groupCode: "g2026062956772b09976a1", videoId: "_pTvw4neHZk" },
  { prodNo: 34, code: "AR2-1", groupCode: "g202606287f9e5ff5d4a21", videoId: "8a9y3T-9ZZE" },
  { prodNo: 35, code: "ACH5", groupCode: "g2026062882ccaeca13ec3", videoId: "uDttiPcoLJM" },
  { prodNo: 36, code: "ACA2", groupCode: "g202606282754ea4191b73", videoId: "5gNW6DS1ITc" },
  { prodNo: 37, code: "ACA3", groupCode: "g202606288eb28ae436e92", videoId: "6U0HhZPgalo" },
  { prodNo: 51, code: "ACA5", groupCode: "g202606290bc066cba328e", videoId: "ranZEI7SAYg" },
  { prodNo: 38, code: "ACA1", groupCode: "g20260628d8695c0317b89", videoId: "WE5qk_28gRc" },
  { prodNo: 39, code: "AB3", groupCode: "g20260628f4948711ee506", videoId: "UrNS7WfkMWc" },
  { prodNo: 40, code: "ACH2", groupCode: "g202606289e121e49cda3a", videoId: "LhfM0aHhp-A" },
  { prodNo: 41, code: "AB2", groupCode: "g202606288c436b61462d1", videoId: "tTPd8uZbzxs" },
  { prodNo: 42, code: "ACH1", groupCode: "g202606283c4a5a9fb9d58", videoId: "TmUz69gWVJs" },
  { prodNo: 43, code: "ACH4", groupCode: "g20260628b653d3fe5713d", videoId: "Pj5u4pAB2OQ" },
  { prodNo: 44, code: "ACH3", groupCode: "g20260628dee74ff7404b2", videoId: "f4qKBcQfwDI" },
  { prodNo: 45, code: "AB5", groupCode: "g20260628bfc1f7dd5bb5f", videoId: "B8fCeYATptE" },
  { prodNo: 46, code: "AB1", groupCode: "g2026062817b8d0582b57e", videoId: "bp-DZ_UEwFo" },
  { prodNo: 27, code: "AR1", groupCode: "g2026062802f1f8a665b83", videoId: "hqmbqTHgO6s" },
  { prodNo: 47, code: "AR4", groupCode: "g202606288f208548cea6b", videoId: "RSJpy2ncQPE" },
  { prodNo: 48, code: "AB4", groupCode: "g2026062875aa3901a0e22", videoId: "8MNTjnr-vTo" },
  { prodNo: 49, code: "AB8", groupCode: "g20260628258a4b03dc237", videoId: "Rro16e1EKcM" },
];

function sh(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    const error = new Error(
      [
        `Command failed: ${cmd} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.status = result.status;
    throw error;
  }
  return result.stdout;
}

function readPassword(service) {
  return sh("security", ["find-generic-password", "-s", service, "-w"]).trim();
}

function imweb(args, data = null, confirm = false) {
  const base = [IMWEB, "--output", "json", ...args];
  if (!data) {
    return JSON.parse(sh(base[0], base.slice(1)));
  }
  const body = JSON.stringify(data);
  const dry = JSON.parse(sh(base[0], [...base.slice(1), "--dry-run", "--data", body]));
  const token = dry.confirmation_token;
  if (!confirm || !token) return dry;
  return JSON.parse(
    sh(base[0], [...base.slice(1), "--yes", "--confirm-token", token, "--data", body]),
  );
}

function refreshAuth() {
  try {
    sh(IMWEB, ["auth", "refresh"]);
  } catch {
    // A still-valid access token is enough; the direct API call will fail loudly if auth is stale.
  }
}

function readAccessToken() {
  const auth = JSON.parse(readFileSync(IMWEB_AUTH_PATH, "utf8"));
  const token = auth?.profiles?.default?.access_token;
  if (!token) throw new Error("missing Imweb access token in local auth file");
  return token;
}

async function updateGroupsDirect(uid, groupCodes) {
  const token = readAccessToken();
  const url = `https://openapi.imweb.me/member-info/members/${encodeURIComponent(uid)}/groups`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ unitCode: "u2026051698c99ea234719", groupCodes }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`direct Imweb group update failed ${response.status}: ${text.slice(0, 1000)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function updateGroups(uid, groupCodes) {
  if (DIRECT_OPENAPI_WRITES) {
    return await updateGroupsDirect(uid, groupCodes);
  }
  return imweb(["member", "update", "groups", uid], { groupCodes }, true);
}

function watchUrl(product) {
  return `${SITE}/archive-method-watch-${product.code.toLowerCase()}`;
}

async function login(page, email, password) {
  await page.goto(`${SITE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("form input[name='uid']").fill(email);
  await page.locator("form input[name='passwd']").fill(password);
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page.locator("form").locator("button, input[type='submit'], a").filter({ hasText: /로그인|Login/i }).first().click(),
  ]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  const state = await page.evaluate(() => ({
    isGuest: globalThis.IS_GUEST,
    memberUid: globalThis.MEMBER_UID,
    url: location.href,
    loginInputs: document.querySelectorAll("input[name='uid'], input[name='passwd']").length,
  }));
  if (state.isGuest === true || state.loginInputs > 0) {
    throw new Error(`login failed for ${email}: ${JSON.stringify(state)}`);
  }
  return state;
}

async function inspect(page, product) {
  const url = watchUrl(product);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  return await page.evaluate(
    ({ code, videoId }) => {
      const body = document.body ? document.body.innerText : "";
      const html = document.documentElement ? document.documentElement.innerHTML : "";
      const iframes = Array.from(document.querySelectorAll("iframe")).map((iframe) => iframe.src || "");
      const youtubeIframes = iframes.filter((src) => /youtube\\.com|youtu\\.be/.test(src));
      const apVideos = Array.from(document.querySelectorAll(".ap-video"));
      return {
        code,
        expectedVideoId: videoId,
        finalUrl: location.href,
        title: document.title,
        isGuest: globalThis.IS_GUEST,
        memberUid: globalThis.MEMBER_UID,
        markerCount: document.querySelectorAll(`[data-archive-pilates-watch-code="${code}"]`).length,
        apWatchCount: document.querySelectorAll(".ap-watch").length,
        apVideoCount: apVideos.length,
        expectedApVideoCount: apVideos.filter((el) => el.innerHTML.includes(videoId)).length,
        youtubeIframeCount: youtubeIframes.length,
        expectedVideoIframeCount: youtubeIframes.filter((src) => src.includes(videoId)).length,
        hasExpectedVideoIdInHtml: html.includes(videoId),
        hasLoginForm: document.querySelectorAll("input[name='uid'], input[name='passwd']").length > 0,
        hasDeniedText: /권한|접근|이용 권한|permission|Permission|로그인/.test(body),
        textSample: body.replace(/\\s+/g, " ").slice(0, 360),
      };
    },
    { code: product.code, videoId: product.videoId },
  );
}

function assertGuestOrNonbuyer(result) {
  return result.markerCount === 0 && result.apWatchCount === 0 && result.youtubeIframeCount === 0 && !result.hasExpectedVideoIdInHtml;
}

function assertBuyerMatch(result) {
  return (
    result.markerCount === 1 &&
    result.apWatchCount === 1 &&
    result.apVideoCount === 1 &&
    result.expectedApVideoCount === 1 &&
    result.youtubeIframeCount <= 1 &&
    result.hasExpectedVideoIdInHtml
  );
}

async function screenshotFailure(page, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true }).catch(() => {});
  return path;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(SHOT_DIR, { recursive: true });

  const buyerPassword = readPassword(BUYER_KEYCHAIN_SERVICE);
  const nonbuyerPassword = readPassword(NONBUYER_KEYCHAIN_SERVICE);
  if (DIRECT_OPENAPI_WRITES) refreshAuth();
  const originalBuyer = imweb(["member", "get", BUYER_EMAIL]).data;

  const browser = await chromium.launch({ headless: true });
  const summary = {
    createdAt: new Date().toISOString(),
    site: SITE,
    productCount: VIDEO_PRODUCTS.length,
    buyerEmail: BUYER_EMAIL,
    nonbuyerEmail: NONBUYER_EMAIL,
    originalBuyerGroups: originalBuyer.group || [],
    guest: [],
    nonbuyer: [],
    buyerMatrix: [],
    buyerCurrentGroupChecks: [],
    failures: [],
  };

  try {
    const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const guestPage = await guestContext.newPage();
    for (const product of VIDEO_PRODUCTS) {
      const result = await inspect(guestPage, product);
      const ok = assertGuestOrNonbuyer(result) && (result.hasLoginForm || result.finalUrl.includes("/login"));
      summary.guest.push({ code: product.code, ok, ...result });
      if (!ok) {
        const screenshot = await screenshotFailure(guestPage, `guest-${product.code}`);
        summary.failures.push({ phase: "guest", code: product.code, screenshot, result });
      }
    }
    await guestContext.close();

    const nonbuyerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const nonbuyerPage = await nonbuyerContext.newPage();
    summary.nonbuyerLogin = await login(nonbuyerPage, NONBUYER_EMAIL, nonbuyerPassword);
    for (const product of VIDEO_PRODUCTS) {
      const result = await inspect(nonbuyerPage, product);
      const ok = assertGuestOrNonbuyer(result) && result.isGuest === false;
      summary.nonbuyer.push({ code: product.code, ok, ...result });
      if (!ok) {
        const screenshot = await screenshotFailure(nonbuyerPage, `nonbuyer-${product.code}`);
        summary.failures.push({ phase: "nonbuyer", code: product.code, screenshot, result });
      }
    }
    await nonbuyerContext.close();

    const buyerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const buyerPage = await buyerContext.newPage();
    summary.buyerLogin = await login(buyerPage, BUYER_EMAIL, buyerPassword);

    if (SKIP_BUYER_MATRIX) {
      const readback = imweb(["member", "get", BUYER_EMAIL]).data;
      const currentGroups = Array.isArray(readback.group) ? readback.group : [];
      for (const target of VIDEO_PRODUCTS) {
        const result = await inspect(buyerPage, target);
        const shouldOpen = currentGroups.includes(target.groupCode);
        const ok = shouldOpen ? assertBuyerMatch(result) : assertGuestOrNonbuyer(result);
        summary.buyerCurrentGroupChecks.push({ targetCode: target.code, shouldOpen, ok, currentGroups, ...result });
        if (!ok) {
          const screenshot = await screenshotFailure(buyerPage, `buyer-current-groups-target-${target.code}`);
          summary.failures.push({
            phase: "buyerCurrentGroup",
            targetCode: target.code,
            shouldOpen,
            screenshot,
            result,
          });
        }
      }
    } else {
      for (const allowed of VIDEO_PRODUCTS) {
        await updateGroups(BUYER_EMAIL, [allowed.groupCode]);
        const readback = imweb(["member", "get", BUYER_EMAIL]).data;
        const assignedOk = Array.isArray(readback.group) && readback.group.length === 1 && readback.group[0] === allowed.groupCode;
        const row = { allowedCode: allowed.code, assignedOk, checks: [] };
        for (const target of VIDEO_PRODUCTS) {
          const result = await inspect(buyerPage, target);
          const shouldOpen = target.code === allowed.code;
          const ok = shouldOpen ? assertBuyerMatch(result) : assertGuestOrNonbuyer(result);
          row.checks.push({ targetCode: target.code, shouldOpen, ok, ...result });
          if (!ok) {
            const screenshot = await screenshotFailure(buyerPage, `buyer-${allowed.code}-target-${target.code}`);
            summary.failures.push({
              phase: "buyerMatrix",
              allowedCode: allowed.code,
              targetCode: target.code,
              shouldOpen,
              screenshot,
              result,
            });
          }
        }
        summary.buyerMatrix.push(row);
      }
    }
    await buyerContext.close();
  } finally {
    if (!SKIP_BUYER_MATRIX) {
      await updateGroups(BUYER_EMAIL, originalBuyer.group || []);
    }
    await browser.close();
  }

  const guestPassed = summary.guest.every((row) => row.ok);
  const nonbuyerPassed = summary.nonbuyer.every((row) => row.ok);
  const buyerAssignedPassed = summary.buyerMatrix.every((row) => row.assignedOk);
  const buyerMatrixPassed = summary.buyerMatrix.every((row) => row.checks.every((check) => check.ok));
  const buyerCurrentGroupPassed = summary.buyerCurrentGroupChecks.every((row) => row.ok);
  summary.result = {
    mode: SKIP_BUYER_MATRIX ? "read_only_current_buyer_groups" : "write_full_buyer_matrix",
    writeMode: DIRECT_OPENAPI_WRITES ? "direct_openapi" : "imweb_cli",
    guestPassed,
    nonbuyerPassed,
    buyerAssignedPassed,
    buyerMatrixPassed,
    buyerCurrentGroupPassed,
    allPassed:
      guestPassed &&
      nonbuyerPassed &&
      (SKIP_BUYER_MATRIX ? buyerCurrentGroupPassed : buyerAssignedPassed && buyerMatrixPassed) &&
      summary.failures.length === 0,
    guestChecks: summary.guest.length,
    nonbuyerChecks: summary.nonbuyer.length,
    buyerMatrixRows: summary.buyerMatrix.length,
    buyerMatrixChecks: summary.buyerMatrix.reduce((sum, row) => sum + row.checks.length, 0),
    buyerCurrentGroupChecks: summary.buyerCurrentGroupChecks.length,
    failureCount: summary.failures.length,
  };

  const out = join(OUT_DIR, "full-access-matrix.json");
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ result: summary.result, out }, null, 2));
  process.exit(summary.result.allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
