#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const SITE = "https://archivepilates.imweb.me";
const ACCOUNT = {
  email: "codex.imweb.nobuyer.202607011145@archivepilates.com",
  keychainService: "ARCHIVE PILATES Imweb nonbuyer test member",
};
const ROUTES = [
  { name: "home", path: "/", expected: /아카이브|ARCHIVE/i, header: true },
  { name: "offline", path: "/18", expected: /강사레슨|오프라인 클래스/i, header: true },
  { name: "video", path: "/17", expected: /영상구매|온라인 클래스/i, header: true },
  { name: "shop", path: "/16?ap_shop=knitido", expected: /knitido|니티도/i, header: true },
  { name: "community", path: "/community", expected: /COMMUNITY|커뮤니티/i, header: true },
  { name: "classroom", path: "/48", expected: /내 강의실/i, header: false },
];
const VIEWPORTS = [
  { name: "mobile-320", width: 320, height: 740 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const OUTPUT_ROOT = path.resolve("output/playwright/imweb-member-site-smoke-20260901");
const REPORT_PATH = path.resolve("artifacts/imweb-member-site-smoke-20260901/report.json");

mkdirSync(OUTPUT_ROOT, { recursive: true });
mkdirSync(path.dirname(REPORT_PATH), { recursive: true });

const password = keychainPassword(ACCOUNT.keychainService);
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport });
    try {
      const loginPage = await context.newPage();
      await login(loginPage, ACCOUNT.email, password);
      await loginPage.close();

      for (const route of ROUTES) {
        results.push(await inspectRoute(context, viewport, route));
      }

      results.push(await inspectMenuInteractions(context, viewport));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const report = {
  createdAt: new Date().toISOString(),
  gate: "imweb-general-member-site-smoke",
  accountRole: "ordinary-nonbuyer-test-member",
  resultCount: results.length,
  failureCount: results.filter((result) => !result.ok).length,
  warningCount: results.reduce((sum, result) => sum + (result.warnings?.length || 0), 0),
  ok: results.every((result) => result.ok),
  results,
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...report, reportPath: REPORT_PATH }, null, 2));
process.exit(report.ok ? 0 : 1);

async function inspectRoute(context, viewport, route) {
  const page = await context.newPage();
  const diagnostics = createDiagnostics(page);
  const failures = [];
  const warnings = [];
  try {
    if (route.name === "classroom") {
      await page.route("**/*", async (browserRoute) => {
        const url = new URL(browserRoute.request().url());
        if (
          url.searchParams.has("ap_classroom_probe") ||
          url.searchParams.has("ap_classroom_fetch_probe")
        ) {
          await browserRoute.fulfill({
            status: 204,
          });
          return;
        }
        await browserRoute.continue();
      });
    }
    const response = await gotoWithRetry(page, `${SITE}${route.path}`);
    await settle(page);
    const state = await page.evaluate(() => {
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const headerCandidates = [
        document.querySelector("#inline_header_mobile"),
        document.querySelector("#inline_header_normal"),
        document.querySelector("#doz_header_wrap"),
      ];
      const header = headerCandidates.find(visible) || null;
      const main = document.querySelector("#doz_content") || document.querySelector("main");
      const headerRect = header ? header.getBoundingClientRect() : null;
      const mainRect = main ? main.getBoundingClientRect() : null;
      const visibleImages = Array.from(document.images).filter((image) => {
        const rect = image.getBoundingClientRect();
        return visible(image) && rect.top < innerHeight && rect.bottom > 0;
      });
      const brokenImages = visibleImages
        .filter((image) => image.complete && image.naturalWidth === 0)
        .map((image) => image.currentSrc || image.src || "(missing src)");
      const menuTexts = Array.from(
        document.querySelectorAll(
          "#doz_header_wrap .viewport-nav.desktop>li>a,#mobile_carousel_menu_0>.nav-item>a",
        ),
      )
        .filter(visible)
        .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      return {
        bodyText: String(document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 8000),
        brokenImages,
        headerPrecedesContent: !headerRect || !mainRect || headerRect.top <= mainRect.top,
        headerTop: headerRect ? Math.round(headerRect.top) : null,
        headerVisible: Boolean(header),
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        isGuest: globalThis.IS_GUEST,
        menuTexts,
        title: document.title,
      };
    });

    if (!response || response.status() >= 400) failures.push(`HTTP ${response?.status() || "no-response"}`);
    if (state.isGuest !== false) failures.push("ordinary member session became guest");
    if (!route.expected.test(state.bodyText)) failures.push("expected page text missing");
    if (route.header && !state.headerVisible) failures.push("header missing");
    if (route.header && !state.headerPrecedesContent) failures.push("header rendered below page content");
    if (state.horizontalOverflow) failures.push("horizontal overflow");
    if (state.brokenImages.length) failures.push(`broken visible images: ${state.brokenImages.length}`);
    if (diagnostics.pageErrors.length) failures.push(`page errors: ${diagnostics.pageErrors.length}`);
    if (diagnostics.firstPartyFailures.length) {
      failures.push(`first-party request failures: ${diagnostics.firstPartyFailures.length}`);
    }
    if (diagnostics.legacyClassroomProbeAttempts.length) {
      failures.push(
        `duplicate legacy classroom probes: ${diagnostics.legacyClassroomProbeAttempts.length}`,
      );
    }
    if (diagnostics.consoleErrors.length) warnings.push(`console errors: ${diagnostics.consoleErrors.length}`);

    const screenshot = path.join(OUTPUT_ROOT, `${viewport.name}-${route.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });

    return {
      ok: failures.length === 0,
      type: "route",
      viewport: viewport.name,
      route: route.name,
      finalUrl: page.url(),
      status: response?.status() || null,
      title: state.title,
      headerVisible: state.headerVisible,
      headerTop: state.headerTop,
      menuTexts: state.menuTexts,
      horizontalOverflow: state.horizontalOverflow,
      brokenImageCount: state.brokenImages.length,
      pageErrors: diagnostics.pageErrors,
      firstPartyFailures: diagnostics.firstPartyFailures,
      legacyClassroomProbeAttempts: diagnostics.legacyClassroomProbeAttempts,
      fetchClassroomProbeAttemptCount: diagnostics.fetchClassroomProbeAttempts.length,
      consoleErrors: diagnostics.consoleErrors,
      failures,
      warnings,
      screenshot,
    };
  } finally {
    await page.close();
  }
}

async function inspectMenuInteractions(context, viewport) {
  const page = await context.newPage();
  const failures = [];
  const warnings = [];
  try {
    await gotoWithRetry(page, `${SITE}/`);
    await settle(page);

    const trigger = page
      .locator('[aria-label="메뉴 열기"]:visible')
      .first();
    if (!(await trigger.isVisible().catch(() => false))) {
      failures.push(`${viewport.name} side-menu trigger missing`);
    } else {
      await trigger.click();
      await page
        .waitForFunction(
          () =>
            Array.from(document.querySelectorAll("a.ap-sidebar-primary-link")).some((link) => {
              const rect = link.getBoundingClientRect();
              const style = getComputedStyle(link);
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.width > 0 &&
                rect.height > 0 &&
                rect.right > 0
              );
            }),
          null,
          { timeout: 5000 },
        )
        .catch(() => {});
      const sideState = await page.evaluate(() => {
        const visible = (element) => {
          if (!element) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0
          );
        };
        const links = Array.from(document.querySelectorAll("a.ap-sidebar-primary-link")).filter(
          visible,
        );
        const contentLefts = links.map((link) => {
          const content = link.querySelector(".plain_name,.ap-knitido-logo-wrap") || link;
          return Math.round(content.getBoundingClientRect().left);
        });
        const heights = links.map((link) => Math.round(link.getBoundingClientRect().height));
        return {
          contentLeftSpread: contentLefts.length
            ? Math.max(...contentLefts) - Math.min(...contentLefts)
            : null,
          heights,
          hrefs: links.map((link) => link.getAttribute("href") || ""),
          labels: links.map((link) => link.getAttribute("aria-label") || ""),
        };
      });
      if (sideState.labels.length < 4) failures.push(`${viewport.name} side-menu primary links missing`);
      if (sideState.contentLeftSpread !== null && sideState.contentLeftSpread > 2) {
        failures.push(
          `${viewport.name} side-menu content misalignment ${sideState.contentLeftSpread}px`,
        );
      }
      if (sideState.heights.some((height) => height < 44)) {
        failures.push(`${viewport.name} side-menu touch target below 44px`);
      }
      if (!sideState.hrefs.some((href) => href.includes("ap_shop=knitido"))) {
        failures.push(`${viewport.name} side-menu Knitido entry missing`);
      }
    }

    const screenshot = path.join(OUTPUT_ROOT, `${viewport.name}-menu-interaction.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    return {
      ok: failures.length === 0,
      type: "menu-interaction",
      viewport: viewport.name,
      failures,
      warnings,
      screenshot,
    };
  } finally {
    await page.close();
  }
}

async function equipmentRects(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#doz_header_wrap .ap-equipment-menu>li>a")).map((link) => {
      const rect = link.getBoundingClientRect();
      const label = link.querySelector(".plain_name") || link;
      const labelRect = label.getBoundingClientRect();
      return {
        height: Math.round(rect.height),
        labelLeft: Math.round(labelRect.left),
        labelTop: Math.round(labelRect.top),
        left: Math.round(rect.left),
        text: String(label.textContent || "").trim(),
        width: Math.round(rect.width),
      };
    }),
  );
}

function createDiagnostics(page) {
  const diagnostics = {
    consoleErrors: [],
    fetchClassroomProbeAttempts: [],
    firstPartyFailures: [],
    legacyClassroomProbeAttempts: [],
    pageErrors: [],
  };
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "archivepilates.imweb.me") return;
    if (url.searchParams.has("ap_classroom_probe")) {
      diagnostics.legacyClassroomProbeAttempts.push(request.url());
    }
    if (url.searchParams.has("ap_classroom_fetch_probe")) {
      diagnostics.fetchClassroomProbeAttempts.push(request.url());
    }
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(String(error.message || error)));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    const isClassroomProbe =
      url.searchParams.has("ap_classroom_probe") ||
      url.searchParams.has("ap_classroom_fetch_probe");
    if (
      url.hostname === "archivepilates.imweb.me" &&
      response.status() >= 400 &&
      !isClassroomProbe
    ) {
      diagnostics.firstPartyFailures.push({ status: response.status(), url: response.url() });
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const isClassroomProbe =
      url.searchParams.has("ap_classroom_probe") ||
      url.searchParams.has("ap_classroom_fetch_probe");
    if (url.hostname === "archivepilates.imweb.me" && !isClassroomProbe) {
      diagnostics.firstPartyFailures.push({ error: request.failure()?.errorText || "failed", url: request.url() });
    }
  });
  return diagnostics;
}

async function gotoWithRetry(page, url, attempts = 2) {
  let response;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    response = await page.goto(`${url}${url.includes("?") ? "&" : "?"}ap_member_smoke=20260901`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (response?.status() !== 429 || attempt === attempts) return response;
    await delay(75000);
  }
  return response;
}

async function settle(page) {
  await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 15000 });
  await nextFrames(page, 3);
}

async function nextFrames(page, count) {
  await page.evaluate(
    (frames) =>
      new Promise((resolve) => {
        let remaining = frames;
        const step = () => {
          remaining -= 1;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    count,
  );
}

async function login(page, email, password) {
  const response = await gotoWithRetry(page, `${SITE}/login`);
  if (!response || response.status() >= 400) {
    throw new Error(`Test-account login page returned HTTP ${response?.status() || "no-response"}.`);
  }
  await page.getByRole("textbox", { name: "이메일" }).fill(email);
  await page.locator('input[name="passwd"]').fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForFunction(
    () => globalThis.IS_GUEST === false && Boolean(globalThis.MEMBER_UID),
    null,
    { timeout: 30000 },
  );
}

function keychainPassword(service) {
  const result = spawnSync("security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error(`Missing macOS Keychain password for ${service}.`);
  return String(result.stdout || "").trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
