#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Local assets + empty Firebase config only. No external base URL or real auth.
// The older responsive verifier has top-level browser/network side effects;
// importing it is not safe. Keep this companion focused on presentation.
const core = path.resolve(fileURLToPath(new URL("../core/", import.meta.url)));
const output = "/tmp/archive-core-ui-refinement";
const routes = ["home", "private", "sequence", "messages", "refunds", "member-registration", "instructor-lessons", "staff"];
const widths = [320, 390, 768, 1440];
const results = [];
const blocked = [];
const errors = [];
let server;
let browser;

await fs.mkdir(output, { recursive: true });
try {
  server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : 900 }, serviceWorkers: "block", reducedMotion: "reduce", locale: "ko-KR", timezoneId: "Asia/Seoul" });
    try {
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin || !["GET", "HEAD"].includes(request.method())) {
          blocked.push({ url: request.url(), method: request.method() });
          await route.abort("blockedbyclient");
        } else if (url.pathname === "/firebase-config.js") {
          await route.fulfill({ contentType: "text/javascript", body: "window.KANGSAIN_FIREBASE_CONFIG = {};" });
        } else await route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      await page.clock.setFixedTime(new Date("2026-10-08T03:00:00Z"));
      page.on("pageerror", (error) => errors.push(`${width}/${page.url()}: ${error.message}`));
      for (const route of routes) {
        const routeErrors = [];
        const check = async (label, operation) => {
          try { await operation(); } catch (error) { routeErrors.push(`${label}: ${error.message.split("\n")[0]}`); }
        };
        await page.goto(`${origin}/${route === "home" ? "" : `${route}/`}`, { waitUntil: "load" });
        await page.getByRole("button", { name: "로그인", exact: true }).waitFor({ state: "visible" });
        await page.evaluate(() => {
          // Detect actual layout overflow, not the body's defensive clipping.
          document.documentElement.style.setProperty("overflow", "visible", "important");
          document.body.style.setProperty("overflow", "visible", "important");
          document.querySelector(".login-card").dataset.testid = "qa-login";
        });
        const loginForm = page.getByTestId("qa-login");
        await check("login labels", async () => {
          assert.equal(await loginForm.getByLabel("휴대폰번호", { exact: true }).count(), 1);
          assert.equal(await loginForm.getByLabel("비밀번호", { exact: true }).count(), 1);
        });
        const login = await measure(page, "login");
        await page.screenshot({ path: path.join(output, `${route}-${width}-login.png`), fullPage: true });
        await check("login keyboard focus", () => checkFocus(loginForm.getByLabel("휴대폰번호", { exact: true })));
        await page.evaluate(populate, route);
        await page.evaluate(() => document.fonts.ready);
        await check("navigation", async () => {
          const menu = page.getByRole("button", { name: "메뉴", exact: true });
          const sidebar = page.getByRole("complementary", { name: "ARCHIVE CORE navigation", exact: true });
          if (width === 1440) {
            assert.ok(await sidebar.isVisible(), "desktop sidebar visible");
            for (const name of ["홈", "회원등록", "강사레슨", "프라이빗", "시퀀스 노트", "강사", "알림톡", "환불"]) {
              assert.ok(await sidebar.getByRole("link", { name, exact: true }).isVisible(), `desktop navigation link visible: ${name}`);
            }
          }
          if (await menu.isVisible()) {
            await menu.click();
            assert.equal(await menu.getAttribute("aria-expanded"), "true");
          }
          const active = await page.getByRole("navigation").getByRole("link").evaluateAll((links) => links.filter((link) => link.getAttribute("aria-current") === "page").length);
          assert.equal(active, 1, "one active local route");
          if (await menu.isVisible()) {
            await menu.click();
            assert.equal(await menu.getAttribute("aria-expanded"), "false");
          }
        });
        await check("native details", async () => {
          const disclosure = await page.evaluate(() => {
            const item = [...document.querySelectorAll("main details")].find((element) => element.getBoundingClientRect().width);
            if (!item) return null;
            item.querySelector("summary").dataset.testid = "qa-disclosure";
            return item.open;
          });
          if (disclosure === null) return;
          const summary = page.getByTestId("qa-disclosure");
          await summary.click();
          assert.equal(await summary.evaluate((element) => element.parentElement.open), !disclosure);
          await summary.press("Enter");
          assert.equal(await summary.evaluate((element) => element.parentElement.open), disclosure);
        });
        await check("search dialog", async () => {
          const search = page.getByRole("button", { name: /회원 또는 업무 검색/ });
          if (!await search.count()) {
            assert.equal(route, "sequence", "search control missing");
            return;
          }
          await search.click();
          const dialog = page.getByRole("dialog");
          await dialog.waitFor({ state: "visible" });
          const searchInput = dialog.getByRole("searchbox");
          await page.waitForFunction(() => document.activeElement?.id === "commandPaletteInput");
          await searchInput.fill("환불");
          assert.ok(await dialog.getByRole("link").count(), "local command results");
          await checkFocus(searchInput);
          const dialogMetrics = await measure(page, "dialog");
          routeErrors.push(...dialogMetrics.failures.map((failure) => `dialog: ${failure}`));
          await page.screenshot({ path: path.join(output, `${route}-${width}-dialog.png`), fullPage: true });
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "hidden" });
          assert.equal(await search.evaluate((element) => element === document.activeElement), true, "focus restored");
        });
        // A failed dialog assertion must not cover the populated screenshot.
        await page.keyboard.press("Escape");
        await check("local icons and refresh identity", async () => {
          const controls = await page.evaluate(() => [...document.querySelectorAll("#refreshButton,.mobile-nav-toggle,#commandPaletteOpen")].map((element) => ({ id: element.id || "menu", name: element.getAttribute("aria-label"), icon: Boolean(element.querySelector("svg.ui-icon")) })));
          for (const control of controls) {
            assert.ok(control.icon, `${control.id}: local Lucide icon missing`);
            if (control.id === "refreshButton") assert.equal(control.name, "새로고침");
            if (control.id === "menu") assert.equal(control.name, "메뉴");
          }
        });
        const populated = await measure(page, "populated");
        await page.screenshot({ path: path.join(output, `${route}-${width}-populated.png`), fullPage: true });
        results.push({ route, width, login, populated, failures: [...login.failures.map((item) => `login: ${item}`), ...populated.failures, ...routeErrors] });
      }
    } finally { await context.close(); }
  }
} catch (error) {
  errors.push(error.stack);
} finally {
  try { if (browser) await browser.close(); }
  finally {
    if (server) await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
  const failures = results.flatMap((result) => result.failures.map((failure) => `${result.route}/${result.width}: ${failure}`));
  failures.push(...errors);
  const report = { ok: !failures.length && results.length === routes.length * widths.length, syntheticOnly: true, checked: results.length, routes, widths, blocked, failures, results, output, limitations: ["No real authentication, Firestore, member data, sends or writes.", "Populated DOM fixtures test presentation, not production data rendering.", "Sequence covers its gated shell; the separate sequence cloud verifier owns editor/adapter behavior.", "Focus checks sample login/search fields; contrast and screen-reader behavior need separate review."] };
  await fs.writeFile(path.join(output, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: report.ok, checked: report.checked, failures: failures.length, blocked: blocked.length, report: path.join(output, "results.json") }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

function populate(route) {
  assertFixture();
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
    home: ["homeDecisionList", "renewalPipelineList"],
    private: ["privateInstructorPendingList"],
    messages: ["messagesDecisionList", "messagesSendList", "messagesCandidateList"],
    staff: ["staffHrList", "staffEvaluationSubmissionList", "staffDetailCard"],
    "member-registration": ["memberRegistrationList"],
    "instructor-lessons": ["instructorLessonRegistrationList"],
  };
  for (const id of targets[route] || []) put(id, row.repeat(2));
  if (route === "private") put("privateProgressList", ["recording", "review", "complete"].map((stage) => `<section class="stage-column stage-${stage}"><div class="stage-column-header"><strong>합성 검증 단계</strong><span>2건</span></div><div class="stage-card"><strong>${member}</strong><p>긴 수업명과 기록 상태 확인</p><details><summary>기록 상세</summary><p>합성 검증 기록</p></details></div></section>`).join(""));
  if (route === "member-registration" || route === "instructor-lessons") {
    put(route === "member-registration" ? "memberRegistrationList" : "instructorLessonRegistrationList", `<article class="instructor-registration-item member-registration-item"><div class="instructor-registration-item-head"><div><strong>${member}</strong><span>010-0000-0000 · 2026.10.08</span></div><span class="pill danger">확인필요</span></div><div class="instructor-registration-meta"><span>합성 검증 수강권 30회</span><span>가입서 대기</span></div><ol class="instructor-registration-progress">${["회원", "수강권", "안내", "가입서", "예약"].map((label, i) => `<li class="${i < 2 ? "is-done" : "is-pending"}"><span>${i + 1}</span><small>${label}</small><em>${i < 2 ? "완료" : "대기"}</em></li>`).join("")}</ol></article>`);
    if (route === "instructor-lessons") put("instructorLessonScheduleList", `<article class="instructor-seat-item"><div class="instructor-seat-item-head"><div><strong>10월 8일 (목)</strong><span>12:00 - 14:10</span></div><span class="pill">잔여 2석</span></div><div class="instructor-seat-counts"><span><small>예약</small><strong>8</strong></span><span><small>정원</small><strong>10</strong></span><span><small>잔여</small><strong>2</strong></span></div><button type="button" class="secondary-action">수강 명단 보기</button></article>`);
  }
  if (route === "refunds") {
    for (const id of ["refundCalculationPanel", "refundResult", "refundSendPanel"]) document.getElementById(id).hidden = false;
    put("refundMemberSummary", `<strong>${member} · 010-0000-0000</strong><span>합성 검증 수강권</span>`);
    put("refundTicketList", '<legend>수강권</legend><label class="refund-ticket-option"><input type="radio" checked disabled><span><strong>합성 검증 긴 프라이빗 30회 수강권</strong><small>잔여 17 / 총 30</small></span><span class="pill">1,650,000원</span></label>');
    for (const id of ["refundResultPaid", "refundResultBalance", "refundResultPenalty", "refundResultUsed", "refundResultAmount"]) document.getElementById(id).textContent = "770,000원";
    document.getElementById("refundMessage").value = "합성 검증 안내. 실제 발송 대상이나 환불 계산 결과가 아닙니다.";
  }
  if (route === "sequence") {
    // Keep the real editor auth gate intact. Only fill the shell with inert data.
    const main = document.querySelector("main");
    const fixture = document.createElement("section");
    fixture.innerHTML = `<h1>시퀀스 노트</h1>${row}`;
    main.appendChild(fixture);
  }
  function assertFixture() {
    if (location.hostname !== "127.0.0.1" || window.KANGSAIN_FIREBASE_CONFIG?.apiKey) throw Error("Synthetic fixture requires isolated empty-config localhost");
  }
}

async function checkFocus(control) {
  await control.focus();
  await control.page().keyboard.press("Tab");
  await control.page().keyboard.press("Shift+Tab");
  const focus = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    const outlined = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 1 && !["transparent", "rgba(0, 0, 0, 0)"].includes(style.outlineColor);
    return document.activeElement === element && element.matches(":focus-visible") && (outlined || style.boxShadow !== "none");
  });
  assert.ok(focus, "keyboard focus has a visible outline or shadow");
}

async function measure(page, mode) {
  return page.evaluate((mode) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const screenReaderOnly = rect.width <= 1 && rect.height <= 1 && style.clip !== "auto";
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && !screenReaderOnly && !element.closest("[hidden]");
    };
    const root = mode === "login" ? document.querySelector(".login-card") : mode === "dialog" ? document.querySelector('[role="dialog"]:not([hidden])') : document.querySelector(".shell");
    const label = (element) => element.id || `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}:${element.textContent.trim().slice(0, 32)}`;
    const nodes = [...root.querySelectorAll("h1,h2,h3,p,label,small,strong,button,a,input,select,textarea,summary,.pill,.metric-value")].filter(visible);
    const viewport = document.documentElement.clientWidth;
    const documentWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
    const typography = nodes.filter((element) => {
      const size = parseFloat(getComputedStyle(element).fontSize);
      const max = element.matches("h1") ? 36 : element.matches("h2,h3") ? 26 : element.matches(".metric-value,.private-metric strong,.refund-final-amount strong") ? 40 : 32;
      return size < 11 || size > max;
    }).map((element) => ({ element: label(element), size: getComputedStyle(element).fontSize }));
    const clipped = nodes.filter((element) => {
      if (element.matches("input,textarea,select,summary")) return false;
      const style = getComputedStyle(element);
      return (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2 && ["hidden", "clip"].includes(style.overflowX)) || (element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 2 && ["hidden", "clip"].includes(style.overflowY));
    }).map(label);
    const touch = [...root.querySelectorAll("button,summary,input:not([type=hidden]),select,textarea,.nav a,.primary-action,.secondary-action")].filter(visible).filter((element) => {
      if (element.matches("input[type=checkbox],input[type=radio]")) return false;
      const rect = element.getBoundingClientRect();
      return rect.height < 43.5 || rect.width < 43.5;
    }).map((element) => ({ element: label(element), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
    const prose = mode !== "populated" ? [] : [...root.querySelectorAll(".eyebrow,.title-block > p,.brand > span,.mast > p,.private-mast > p")].filter(visible).filter((element) => !/^ARCHIVE (?:CORE|PILATES|METHOD)$/.test(element.textContent.trim())).map(label);
    const brands = [...root.querySelectorAll(".brand img,.brand-mark img,img.brand-mark,.login-card img")].filter(visible);
    const brand = brands.some((element) => element.complete && element.naturalWidth > 0 && new URL(element.src).pathname === "/icons/archive-pilates-icon-192.png");
    const failures = [];
    if (documentWidth > viewport + 1) failures.push(`unclipped document overflow ${documentWidth} > ${viewport}`);
    if (typography.length) failures.push(`typography out of bounds: ${JSON.stringify(typography)}`);
    if (clipped.length) failures.push(`clipped text: ${clipped.join(", ")}`);
    if (touch.length) failures.push(`targets below 44px: ${JSON.stringify(touch)}`);
    if (prose.length) failures.push(`decorative prose remains: ${prose.join(", ")}`);
    if (mode === "populated" && !brand) failures.push("loaded official brand image missing");
    return { viewport, documentWidth, typography, clipped, touch, prose, brand, failures };
  }, mode);
}

async function startServer() {
  const server = http.createServer(async (request, response) => {
    try {
      assert.ok(["GET", "HEAD"].includes(request.method));
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = path.resolve(core, `.${pathname}`, pathname.endsWith("/") ? "index.html" : "");
      assert.ok(file.startsWith(`${core}${path.sep}`));
      const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
      const data = await fs.readFile(file);
      response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : data);
    } catch { response.writeHead(404); response.end("Not found"); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server;
}
