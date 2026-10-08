#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Presentation only: never import a verifier with top-level browser side effects.
const core = path.resolve(fileURLToPath(new URL("../core/", import.meta.url)));
const output = "/tmp/archive-core-crm-motion";
const routes = ["home", "private", "instructor-lessons", "member-registration", "refunds", "recommended-meals", "messages"];
const widths = [320, 390, 768, 1440];
const motions = ["no-preference", "reduce"];
const results = [];
const blocked = [];
const errors = [];
const cleanup = { contextsClosed: 0, browserClosed: false, serverClosed: false };
const snapshot = new Map();
let server;
let browser;

await fs.mkdir(output, { recursive: true });
try {
  // A worktree need not install or modify packages to use the existing runtime.
  const require = createRequire(import.meta.url);
  const runtimeRequire = createRequire("/Users/archivepilates/dev/archive-in-runtime/package.json");
  let playwright;
  try { playwright = require("playwright"); }
  catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    playwright = runtimeRequire("playwright");
  }
  server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({ headless: true });
  for (const motion of motions) for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: width === 768 ? 1024 : 900 },
      serviceWorkers: "block", reducedMotion: motion, locale: "ko-KR", timezoneId: "Asia/Seoul",
    });
    try {
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin || request.method() !== "GET") {
          blocked.push({ url: request.url(), method: request.method() });
          await route.abort("blockedbyclient");
        } else await route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(10000);
      await page.clock.setFixedTime(new Date("2026-10-08T03:00:00Z"));
      page.on("pageerror", (error) => errors.push(`${motion}/${width}/${page.url()}: ${error.message}`));
      for (const route of routes) {
        const result = { route, width, motion, checks: [], measurements: {}, failures: [] };
        const check = async (label, operation) => {
          try {
            const evidence = await operation();
            result.checks.push(label);
            if (evidence !== undefined) result.measurements[label] = evidence;
          } catch (error) { result.failures.push(`${label}: ${error.message}`); }
        };
        const screenshot = (state) => page.screenshot({ path: path.join(output, `${route}-${width}-${motion}-${state}.png`), fullPage: true, timeout: 10000 });
        try {
          await page.goto(`${origin}/${route === "home" ? "" : `${route}/`}`, { waitUntil: "load" });
          const login = page.getByRole("button", { name: "로그인", exact: true });
          await login.waitFor({ state: "visible" });
          await page.evaluate(() => {
            if (Object.keys(window.KANGSAIN_FIREBASE_CONFIG || {}).length) throw Error("Expected empty Firebase config");
            document.querySelector(".login-card").dataset.testid = "qa-motion-login";
            // Expose genuine width problems rather than relying on body clipping.
            for (const element of [document.documentElement, document.body]) element.style.setProperty("overflow-x", "visible", "important");
          });
          await check("anonymous gate", async () => {
            assert.equal(await login.count(), 1);
            const form = page.getByTestId("qa-motion-login");
            assert.equal(await form.getByLabel("휴대폰번호", { exact: true }).count(), 1);
            assert.equal(await form.getByLabel("비밀번호", { exact: true }).count(), 1);
            await keyboardFocus(form.getByLabel("휴대폰번호", { exact: true }));
          });
          await check("main entrance", () => entrance(page, ".main", motion, "core-content-enter"));
          await check("login reduced motion", () => reducedScope(page, ".shell,.login-gate", motion));
          await check("login layout", () => layout(page, ".login-card"));
          await settle(page);
          await screenshot("login");
          await page.evaluate(populate, route);
          await settle(page);
          await check("mobile navigation", async () => {
            const menu = page.getByRole("button", { name: "메뉴", exact: true });
            const nav = page.getByRole("navigation");
            const mobile = width < 1041;
            assert.equal(await menu.isVisible(), mobile);
            if (mobile) {
              await menu.click();
              assert.equal(await menu.getAttribute("aria-expanded"), "true");
              await nav.waitFor({ state: "visible" });
              await settle(page);
              await layout(page, ".sidebar");
              await screenshot("navigation");
            } else await nav.waitFor({ state: "visible" });
            assert.equal(await nav.getByRole("link").evaluateAll((links) => links.filter((link) => link.getAttribute("aria-current") === "page").length), 1, "one active local route");
            if (mobile) {
              await menu.press("Enter");
              assert.equal(await menu.getAttribute("aria-expanded"), "false");
              await nav.waitFor({ state: "hidden" });
              assert.ok(await menu.evaluate((element) => element === document.activeElement), "menu toggle retains focus after closing");
            }
          });
          await check("native details entrance", async () => {
            const summary = page.getByTestId("qa-motion-summary");
            await summary.focus();
            await summary.press("Enter");
            assert.ok(await summary.evaluate((element) => element.parentElement.open));
            const evidence = await entrance(page, '[data-testid="qa-motion-body"]', motion);
            await layout(page, ".shell");
            await screenshot("details");
            await summary.press("Enter");
            assert.equal(await summary.evaluate((element) => element.parentElement.open), false);
            assert.ok(await summary.evaluate((element) => element === document.activeElement), "details summary retains focus");
            return evidence;
          });
          await check("search entrance and focus restoration", async () => {
            const search = page.getByRole("button", { name: "회원 또는 업무 검색", exact: true });
            await search.click();
            // Home owns pre-existing dialog markup; other routes generate the card.
            const dialog = page.getByRole("dialog");
            assert.equal(await dialog.count(), 1, "one search dialog");
            await dialog.waitFor({ state: "visible" });
            const evidence = await entrance(page, ".command-palette-card", motion);
            await page.waitForFunction(() => document.activeElement?.id === "commandPaletteInput");
            const input = dialog.getByRole("searchbox");
            // A local menu match never requests the member directory.
            await input.fill("환불");
            assert.ok(await dialog.getByRole("link").count(), "local menu results");
            await keyboardFocus(input);
            const close = dialog.getByRole("button", { name: "검색 닫기", exact: true });
            const first = await close.count() ? close : input;
            await first.focus();
            await page.keyboard.press("Shift+Tab");
            assert.ok(await dialog.getByRole("link").last().evaluate((element) => element === document.activeElement), "focus trapped at dialog start");
            await page.keyboard.press("Tab");
            assert.ok(await first.evaluate((element) => element === document.activeElement), "focus trapped at dialog end");
            await reducedScope(page, ".command-palette", motion);
            await layout(page, ".command-palette-card");
            await screenshot("search");
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
            assert.ok(await search.evaluate((element) => element === document.activeElement), "search opener regains focus");
            return evidence;
          });
          // Restore shell state even if an interaction assertion failed.
          await page.keyboard.press("Escape");
          await page.evaluate(() => {
            document.querySelectorAll(".sidebar.is-open").forEach((element) => element.classList.remove("is-open"));
            document.querySelector(".mobile-nav-toggle")?.setAttribute("aria-expanded", "false");
          });
          await check("button feedback", () => buttonFeedback(page, motion));
          await check("busy refresh exception", async () => {
            const refresh = page.getByRole("button", { name: "새로고침", exact: true });
            try {
              await refresh.evaluate((element) => element.setAttribute("aria-busy", "true"));
              const value = await refresh.evaluate((element) => {
                const style = getComputedStyle(element.querySelector(".ui-icon"));
                return { name: style.animationName, count: style.animationIterationCount };
              });
              assert.equal(value.name, motion === "reduce" ? "none" : "core-refresh");
              if (motion !== "reduce") assert.equal(value.count, "infinite");
              return value;
            } finally { await refresh.evaluate((element) => element.removeAttribute("aria-busy")); }
          });
          await check("shell reduced motion", () => reducedScope(page, ".shell", motion));
          await check("populated layout", () => layout(page, ".shell"));
          await settle(page);
          await screenshot("populated");
        } catch (error) { result.failures.push(error.stack || String(error)); }
        results.push(result);
      }
    } finally { await context.close(); cleanup.contextsClosed += 1; }
  }
} catch (error) { errors.push(error.stack || String(error)); }
finally {
  try {
    if (browser) {
      await browser.close();
      cleanup.browserClosed = !browser.isConnected();
    }
  } catch (error) { errors.push(`browser cleanup: ${error.message}`); }
  finally {
    if (server) {
      try {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
        cleanup.serverClosed = !server.listening;
      } catch (error) { errors.push(`server cleanup: ${error.message}`); }
    }
  }
  const failures = results.flatMap((result) => result.failures.map((failure) => `${result.route}/${result.width}/${result.motion}: ${failure}`));
  failures.push(...errors);
  // Blocked requests are evidence too; a prevented write attempt is a failure.
  failures.push(...blocked.map((request) => `forbidden request: ${request.method} ${request.url}`));
  const expected = routes.length * widths.length * motions.length;
  if (results.length !== expected) failures.push(`incomplete matrix: ${results.length}/${expected}`);
  if (cleanup.contextsClosed !== widths.length * motions.length || !cleanup.browserClosed || !cleanup.serverClosed) failures.push("browser/context/server cleanup incomplete");
  const report = {
    ok: !failures.length, syntheticOnly: true, checked: results.length, expected, routes, widths, motions,
    cleanup, blocked, failures, results, output,
    sourceHashes: Object.fromEntries([...snapshot].map(([file, data]) => [path.relative(core, file), createHash("sha256").update(data).digest("hex")])),
    limitations: [
      "No authentication, Firebase SDK, production network/data or external writes; GET-only loopback server.",
      "Inert fixtures mirror verify-core-ui-refinement.mjs, with a synthetic meal review and disclosure probe.",
      "Sequence editor is neither visited nor changed; this verifier owns CRM presentation only.",
      "Focus/layout/motion checks do not replace full accessibility, production rendering or data verification.",
    ],
  };
  await fs.writeFile(path.join(output, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: report.ok, checked: report.checked, failures: failures.length, cleanup, report: path.join(output, "results.json") }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

async function entrance(page, selector, motion, expectedName) {
  const value = await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) throw Error(`Motion target missing: ${selector}`);
    const style = getComputedStyle(element);
    return { name: style.animationName, duration: style.animationDuration, delay: style.animationDelay, count: style.animationIterationCount, easing: style.animationTimingFunction };
  }, selector);
  if (motion === "reduce") assert.equal(value.name, "none", `${selector}: reduced motion disables entrance`);
  else {
    assert.notEqual(value.name, "none", `${selector}: entrance missing`);
    if (expectedName) assert.equal(value.name, expectedName);
    for (const duration of value.duration.split(",")) assert.ok(milliseconds(duration) > 0 && milliseconds(duration) <= 200, `${selector}: duration ${duration} must be within 200ms`);
    for (const delay of value.delay.split(",")) assert.equal(milliseconds(delay), 0, `${selector}: entrance delay`);
    for (const count of value.count.split(",")) assert.equal(Number(count), 1, `${selector}: one entrance only`);
  }
  await settle(page);
  return value;
}

function milliseconds(value) { return parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000); }

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Snapshot running animations after style/layout flush; never sleep a guessed duration.
    document.documentElement.getBoundingClientRect();
    const animations = document.getAnimations();
    for (const animation of animations) {
      const timing = animation.effect.getComputedTiming();
      const busy = animation.animationName === "core-refresh" && animation.effect.target?.closest('.refresh-button[aria-busy="true"]');
      if (!busy && (!Number.isFinite(timing.endTime) || timing.endTime > 200)) throw Error(`Unbounded motion: ${animation.animationName || animation.transitionProperty} (${timing.endTime}ms)`);
    }
    await Promise.all(animations.filter((animation) => Number.isFinite(animation.effect.getComputedTiming().endTime)).map((animation) => animation.finished.catch((error) => { if (error.name !== "AbortError") throw error; })));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function reducedScope(page, selector, motion) {
  if (motion !== "reduce") return;
  const offenders = await page.evaluate((selector) => {
    const roots = [...document.querySelectorAll(selector)];
    return [...new Set(roots.flatMap((root) => [root, ...root.querySelectorAll("*")]))].flatMap((element) => {
      return [null, "::before", "::after"].flatMap((pseudo) => {
        const style = getComputedStyle(element, pseudo);
        if (style.animationName === "none" && (style.transitionProperty === "none" || style.transitionDuration.split(",").every((value) => parseFloat(value) === 0))) return [];
        return [`${element.id || element.tagName}.${element.className}${pseudo || ""}: ${style.animationName}/${style.transitionProperty}/${style.transitionDuration}`];
      });
    });
  }, selector);
  assert.deepEqual(offenders, [], "reduced motion disables shell/dialog/login animations and transitions");
}

async function keyboardFocus(control) {
  await control.focus();
  await control.page().keyboard.press("Tab");
  await control.page().keyboard.press("Shift+Tab");
  assert.ok(await control.evaluate((element) => {
    const style = getComputedStyle(element);
    const outlined = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 1 && !["transparent", "rgba(0, 0, 0, 0)"].includes(style.outlineColor);
    return document.activeElement === element && element.matches(":focus-visible") && (outlined || style.boxShadow !== "none");
  }), "visible keyboard focus");
}

async function buttonFeedback(page, motion) {
  const search = page.getByRole("button", { name: "회원 또는 업무 검색", exact: true });
  const sample = () => search.evaluate((element) => ({ transform: getComputedStyle(element).transform, width: element.offsetWidth, height: element.offsetHeight }));
  await page.mouse.move(0, 0);
  await settle(page);
  const base = await sample();
  await search.hover();
  await settle(page);
  const hover = await sample();
  let press;
  try {
    await page.mouse.down();
    await settle(page);
    press = await sample();
  } finally {
    // Release outside the button so checking :active never opens a dialog.
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
  for (const state of [hover, press]) {
    assert.equal(state.width, base.width, "feedback does not change layout width");
    assert.equal(state.height, base.height, "feedback does not change layout height");
  }
  if (motion !== "reduce") assert.ok(hover.transform !== base.transform || press.transform !== base.transform, "bounded button hover/press feedback exists");
  const nonButtons = await page.getByRole("navigation").getByRole("link").evaluateAll((links) => links.filter((link) => getComputedStyle(link).transform !== "none").map((link) => link.textContent));
  assert.deepEqual(nonButtons, [], "navigation links do not transform");
  return { base, hover, press };
}

async function layout(page, selector) {
  const value = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) throw Error(`Layout target missing: ${selector}`);
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 1 && rect.height > 1 && style.visibility !== "hidden" && !element.closest("[hidden]");
    };
    const label = (element) => element.id || `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}`;
    const nodes = [...root.querySelectorAll("h1,h2,h3,p,label,small,strong,button,a,input,select,textarea,summary,.pill,img,video,canvas")].filter(visible);
    const viewport = document.documentElement.clientWidth;
    const documentWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
    const outside = nodes.filter((element) => {
      const rect = element.getBoundingClientRect();
      // Explicit local scrolling containers may contain wider tables/nav content.
      let parent = element.parentElement;
      while (parent && parent !== root) {
        if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) return false;
        parent = parent.parentElement;
      }
      return rect.left < -1 || rect.right > viewport + 1;
    }).map(label);
    const clipped = nodes.filter((element) => !element.matches("input,select,textarea,summary") && element.clientWidth && element.scrollWidth > element.clientWidth + 2 && ["hidden", "clip"].includes(getComputedStyle(element).overflowX)).map(label);
    const touch = nodes.filter((element) => element.matches("button,summary,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea,.nav a")).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width < 43.5 || rect.height < 43.5;
    }).map(label);
    const images = nodes.filter((element) => element.tagName === "IMG").filter((element) => !element.complete || !element.naturalWidth).map(label);
    return { viewport, documentWidth, outside, clipped, touch, images };
  }, selector);
  assert.ok(value.documentWidth <= value.viewport + 1, `document overflow ${value.documentWidth} > ${value.viewport}`);
  for (const key of ["outside", "clipped", "touch", "images"]) assert.deepEqual(value[key], [], `${selector}: ${key}`);
  return value;
}

function populate(route) {
  if (location.hostname !== "127.0.0.1" || Object.keys(window.KANGSAIN_FIREBASE_CONFIG || {}).length) throw Error("Fixture requires empty-config loopback");
  document.querySelector("#coreLoginGate")?.remove();
  const member = "합성검증긴이름회원";
  const row = `<article class="status-row"><div><strong>${member}</strong><p>2026.10.08 12:00 · 합성검증담당강사 · 프라이빗 수강권 30회</p></div><span class="pill warn">확인필요</span></article>`;
  const put = (id, html) => {
    const element = document.getElementById(id);
    if (!element) throw Error(`Fixture target missing: ${id}`);
    element.innerHTML = html;
    element.hidden = false;
  };
  document.querySelectorAll(".metric-value, .private-metric strong").forEach((element) => { element.textContent = "12"; });
  const targets = {
    home: ["homeDecisionList", "renewalPipelineList"], private: ["privateInstructorPendingList"],
    messages: ["messagesDecisionList", "messagesSendList", "messagesCandidateList"],
    "member-registration": ["memberRegistrationList"], "instructor-lessons": ["instructorLessonRegistrationList"],
    "recommended-meals": ["recommendedMealQueue"],
  };
  for (const id of targets[route] || []) put(id, row.repeat(2));
  if (route === "private") put("privateProgressList", ["recording", "review", "complete"].map((stage) => `<section class="stage-column stage-${stage}"><div class="stage-column-header"><strong>합성 검증 단계</strong><span>2건</span></div><div class="stage-card"><strong>${member}</strong><p>긴 수업명과 기록 상태 확인</p><details><summary>기록 상세</summary><p>합성 검증 기록</p></details></div></section>`).join(""));
  if (route === "member-registration" || route === "instructor-lessons") {
    put(route === "member-registration" ? "memberRegistrationList" : "instructorLessonRegistrationList", `<article class="instructor-registration-item member-registration-item"><div class="instructor-registration-item-head"><div><strong>${member}</strong><span>010-0000-0000 · 2026.10.08</span></div><span class="pill danger">확인필요</span></div><div class="instructor-registration-meta"><span>합성 검증 수강권 30회</span><span>가입서 대기</span></div><ol class="instructor-registration-progress">${["회원", "수강권", "안내", "가입서", "예약"].map((label, i) => `<li class="${i < 2 ? "is-done" : "is-pending"}"><span>${i + 1}</span><small>${label}</small><em>${i < 2 ? "완료" : "대기"}</em></li>`).join("")}</ol></article>`);
    if (route === "instructor-lessons") put("instructorLessonScheduleList", '<article class="instructor-seat-item"><div class="instructor-seat-item-head"><div><strong>10월 8일 (목)</strong><span>12:00 - 14:10</span></div><span class="pill">잔여 2석</span></div><div class="instructor-seat-counts"><span><small>예약</small><strong>8</strong></span><span><small>정원</small><strong>10</strong></span><span><small>잔여</small><strong>2</strong></span></div><button type="button" class="secondary-action" disabled>수강 명단 보기</button></article>');
  }
  if (route === "refunds") {
    for (const id of ["refundCalculationPanel", "refundResult", "refundSendPanel"]) document.getElementById(id).hidden = false;
    put("refundMemberSummary", `<strong>${member} · 010-0000-0000</strong><span>합성 검증 수강권</span>`);
    put("refundTicketList", '<legend>수강권</legend><label class="refund-ticket-option"><input type="radio" checked disabled><span><strong>합성 검증 긴 프라이빗 30회 수강권</strong><small>잔여 17 / 총 30</small></span><span class="pill">1,650,000원</span></label>');
    for (const id of ["refundResultPaid", "refundResultBalance", "refundResultPenalty", "refundResultUsed", "refundResultAmount"]) document.getElementById(id).textContent = "770,000원";
    document.getElementById("refundMessage").value = "합성 검증 안내. 실제 발송 대상이나 환불 계산 결과가 아닙니다.";
  }
  if (route === "recommended-meals") {
    document.getElementById("mealReviewEmpty").hidden = true;
    document.getElementById("mealReviewBody").hidden = false;
    put("mealReviewTitle", member);
    put("mealInbodySummary", "<p>합성 검증 참고 기록 · 실제 건강 정보 아님</p>");
    put("mealSurveySummary", "<p>합성 검증 응답 · 실제 설문 정보 아님</p>");
  }
  // A shared inert probe covers the exact disclosure contract on every route.
  const disclosure = document.createElement("details");
  disclosure.className = "action-disclosure";
  disclosure.innerHTML = '<summary data-testid="qa-motion-summary"><span><strong>합성 검증 상세</strong></span></summary><div class="disclosure-body" data-testid="qa-motion-body"><p>합성 검증 기록</p></div>';
  document.querySelector("main").appendChild(disclosure);
}

async function startServer() {
  // Pin presentation sources once; parallel main edits cannot mix CSS/app versions mid-matrix.
  for (const name of ["assets/interface.css", "assets/styles.css", "assets/app.js", "assets/ui-icons.js", "private/private.css", ...routes.map((route) => route === "home" ? "index.html" : `${route}/index.html`)]) {
    const file = path.join(core, name);
    snapshot.set(file, await fs.readFile(file));
  }
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== "GET") { response.writeHead(405); response.end("GET only"); return; }
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname === "/firebase-config.js") {
        response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
        response.end("window.KANGSAIN_FIREBASE_CONFIG = {};");
        return;
      }
      const file = path.resolve(core, `.${pathname}`, pathname.endsWith("/") ? "index.html" : "");
      assert.ok(file.startsWith(`${core}${path.sep}`));
      assert.ok((await fs.realpath(file)).startsWith(`${core}${path.sep}`), "no symlink escape");
      const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
      if (!snapshot.has(file)) snapshot.set(file, await fs.readFile(file));
      const data = snapshot.get(file);
      response.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; worker-src 'none'; form-action 'none'",
      });
      response.end(data);
    } catch { response.writeHead(404); response.end("Not found"); }
  });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    return server;
  } catch (error) { server.close(); throw error; }
}
