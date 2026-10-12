#!/usr/bin/env node
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = await fs.mkdtemp(path.join(os.tmpdir(), "member-form-wrapping-"));
const token = "a".repeat(48);
const viewports = [{ width: 320, height: 720 }, { width: 390, height: 844 },
  { width: 768, height: 1024 }, { width: 1440, height: 900 }];
const routes = [
  { name: "groupSurvey", api: "groupSurveySubmit", form: "surveyForm", id: "gsr-synthetic-wrapping", current: "group_survey" },
  { name: "privateSurvey", api: "privateSurveySubmit", form: "surveyForm", id: "psr-synthetic-wrapping", current: "private_survey" },
  { name: "recommendedMealSurvey", api: "recommendedMealSurvey", form: "mealSurveyForm", id: "meal-synthetic-wrapping-20261012", current: "recommended_meal_survey" },
  { name: "instructor-observation", form: "surveyForm", current: "adjacent public onboarding form; no direct Alimtalk template mapping found" },
  { name: "private-chart", api: "privateChart", form: "form", current: "private lesson chart request" },
  { name: "parking", api: "parkingPreRegistration", form: "registrationForm", id: "parking-synthetic-wrapping", current: "instructor lesson parking" },
  { name: "memberSignup", api: "memberSignupContract", form: "signupForm", id: "msc-synthetic-wrapping", excludedFromActive: true, current: "legacy onsite_welcome links retained; new sends retired" },
  { name: "instructor-evaluation", form: "identityForm", current: "adjacent public applicant form; no direct Alimtalk template mapping found" },
];
for (const name of ["external-feedback-260919", "external-feedback-260920", "support-movement-260829", "support-movement-260830", "pelvis-hip-260725"]) {
  routes.push({ name: `method/${name}/assignment`, informational: true, current: "instructor_lesson_material generic assignment button target; source page exists, actual sent links unverified" });
}
for (const name of ["external-feedback-260919", "external-feedback-260920"]) {
  routes.push({ name: `method/${name}/calendar`, informational: true, current: "instructor_lesson_confirmation generic calendar target; source page exists, actual sent links unverified" });
}
const report = { scope: "Local source UI, synthetic GET responses only. Optional LIVE_STATIC_ORIGIN fetches token-free static HTML hashes only, never renders live HTML. No auth/member data/API calls, submissions, sends, signatures, deletes, or deploys. METHOD roster labels replaced before rendering. Retired memberSignup excluded from active coverage.",
  output, routes, sources: [], scenarios: [], blocked: [], failures: [], cleanup: {} };
const sources = new Map();
const servedSources = new Map();
let fixtureQuiz;
let server;
let origin;
const browsers = [];
const contexts = new Set();

async function closeContext(context) {
  await context.close();
  contexts.delete(context);
}

async function verifyLiveStaticSources() {
  report.liveStatic = { enabled: Boolean(process.env.LIVE_STATIC_ORIGIN), routes: [] };
  if (!process.env.LIVE_STATIC_ORIGIN) return;
  const base = new URL(process.env.LIVE_STATIC_ORIGIN);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("LIVE_STATIC_ORIGIN must be a plain HTTP(S) origin without credentials, path, query, or fragment");
  }
  report.liveStatic.origin = base.origin;
  for (const route of routes) {
    const file = `archivein/${route.name}/index.html`;
    const url = new URL(`/archivein/${route.name}/`, base.origin);
    try {
      // Fetch bytes only: no browser, cookies, authorization, redirects, or API URLs.
      const response = await fetch(url, { method: "GET", credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new Error(`Static HTML response invalid: HTTP ${response.status}`);
      const actual = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
      const expected = createHash("sha256").update(sources.get(file)).digest("hex");
      report.liveStatic.routes.push({ file, url: url.href, expected, actual, matches: actual === expected });
      if (actual !== expected) report.failures.push({ name: "live-static-source-mismatch", error: file });
    } catch (error) {
      report.failures.push({ name: "live-static-fetch", error: `${file}: ${error.message}` });
    }
  }
}

function payload(api, state) {
  const base = { ok: true, memberName: "가상회원", memberPhone: "010-0000-0000", staffName: "가상강사",
    lessonTime: "2026. 10. 12. 오후 7:00", status: state === "completed" ? "submitted" : "pending" };
  if (state === "metadata-stress") {
    base.memberName = "가상회원이름줄바꿈검증";
    base.staffName = "가상강사이름줄바꿈검증";
    base.lessonTime = "2026. 10. 12. 오후 7:00";
  }
  if (api === "recommendedMealSurvey") return { ...base, inbodyStatus: "available", inbodyMeasuredAt: "2026-10-10T02:00:00Z" };
  if (api === "parkingPreRegistration") return { ...base, status: state === "completed" ? "registered" : "pending",
    lessonDate: "2026-10-12", lessonStartAt: "2026-10-12T10:00:00Z", carLast4: state === "completed" ? "0000" : "", canEdit: true };
  if (api === "memberSignupContract") return { ok: true, contract: { ...base,
    memberPhoneLast4: "0000", member: { name: "가상회원", phoneMasked: "010-****-0000", gender: "미입력", email: "synthetic@example.invalid" },
    purchase: { ticketName: "가상 그룹 수강권", startDate: "2026-10-12", endDate: "2026-11-12", paymentMethod: "가상 결제", paidAmount: "0원" } } };
  if (api === "privateChart") {
    if (state === "daily-empty") return { ok: true, date: "2026-10-12", staffName: "가상강사", total: 0, completed: 0, items: [] };
    return { ...base, requestId: "plc-synthetic", mode: "post", sessionNumber: 2, postSubmitted: state === "report-edit", postStatus: state === "report-edit" ? "submitted" : "pending", locked: false,
      existingAnswers: {}, intakeSummary: { primaryGoal: "체형교정·자세 개선", focusAreas: ["어깨", "골반/고관절"], painNote: "가상 응답: 오래 앉아 있을 때 불편함을 확인합니다." },
      previousReport: { sessionNumber: 1, lessonTime: base.lessonTime, summary: "가상 이전 기록: 호흡과 코어 연결을 확인했습니다.", nextDirection: "다음 수업 방향을 가상으로 표시합니다.", homework: "가상 홈워크" },
      media: { files: [] }, report: state === "report-edit" ? { status: "draft_created", canEdit: true, sent: false,
        url: `${origin}/archivein/__synthetic-report`, canonicalUrl: `${origin}/archivein/__synthetic-report`,
        summary: "가상 리포트 문장입니다. 호흡과 움직임의 연결을 확인했습니다.", nextDirection: "가상 다음 수업 방향입니다. 충분한 설명과 반복을 이어갑니다." } : {} };
  }
  return base;
}

function scenarioUrl(route, state) {
  const url = new URL(`/archivein/${route.name}/`, origin);
  if (route.id) { url.searchParams.set("id", route.id); url.searchParams.set("token", token); }
  if (route.name === "private-chart") {
    url.searchParams.set("r", "plc-synthetic"); url.searchParams.set("t", token); url.searchParams.set("mode", "post");
    if (state === "daily-empty") { url.searchParams.set("view", "today"); url.searchParams.set("date", "2026-10-12"); }
  }
  return url.href;
}

// Text fragment bounds detect clipped legends even when document scrollWidth looks normal.
async function measure(page) {
  return page.evaluate(() => {
    const visible = node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const identify = node => ({ tag: node.tagName, id: node.id, className: typeof node.className === "string" ? node.className : "",
      text: node.textContent.trim().replace(/\s+/g, " ").slice(0, 180) });
    const textIssues = [];
    const fragments = [];
    for (const node of document.querySelectorAll("h1,h2,h3,legend,label,p,summary,button,.chip,.value,.label,.option span,.choice span")) {
      if (!visible(node) || node.closest(".honeypot")) continue;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const rects = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) rects.push({ x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom });
      }
      const lines = new Set(rects.map(rect => Math.round(rect.y))).size;
      const bounds = node.getBoundingClientRect();
      if (node.matches("legend,.option,.choice")) fragments.push({ ...identify(node), lines, width: bounds.width,
        height: bounds.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth });
      const reasons = [];
      if (rects.some(rect => rect.x < -1 || rect.right > innerWidth + 1)) reasons.push("text-outside-viewport");
      let parent = node;
      while (parent && parent !== document.documentElement) {
        const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if (["hidden", "clip", "auto", "scroll"].includes(style.overflowX) && rects.some(rect => rect.x < box.left - 1 || rect.right > box.right + 1)) reasons.push(`ancestor-x-${style.overflowX}:${parent.tagName}.${parent.className}`);
        if (["hidden", "clip"].includes(style.overflowY) && rects.some(rect => rect.y < box.top - 1 || rect.bottom > box.bottom + 1)) reasons.push(`ancestor-y-${style.overflowY}:${parent.tagName}.${parent.className}`);
        parent = parent.parentElement;
      }
      if (reasons.length) textIssues.push({ ...identify(node), reasons: [...new Set(reasons)], bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, lines });
    }
    const overflowingElements = [...document.querySelectorAll("main,form,fieldset,section,label,legend,.options,.option,.choice,.meta,.chip,textarea,select")]
      .filter(visible).filter(node => !node.matches("textarea,input"))
      .filter(node => node.scrollWidth > node.clientWidth + 2)
      .map(node => ({ ...identify(node), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
    const labelTargets = [...document.querySelectorAll("label")].filter(visible)
      .map(node => ({ ...identify(node), height: node.getBoundingClientRect().height }));
    const optionTargets = [...document.querySelectorAll("label.option,label.choice,.agree")].filter(visible)
      .map(node => ({ ...identify(node), height: node.getBoundingClientRect().height }));
    const smallOptions = optionTargets.filter(node => node.height < 44 - 0.1);
    const hiddenVisible = [...document.querySelectorAll("[hidden],.hidden")].filter(visible).map(identify);
    const canvas = document.createElement("canvas").getContext("2d");
    const nativeSelects = [...document.querySelectorAll("select")].filter(visible).map(node => {
      const style = getComputedStyle(node); canvas.font = style.font;
      const label = node.selectedOptions[0]?.textContent || "";
      const textWidth = canvas.measureText(label).width;
      const availableWithoutArrow = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return { name: node.name, label, textWidth, availableWithoutArrow, width: node.getBoundingClientRect().width,
        textExceedsInnerWidth: textWidth > availableWithoutArrow + 1 };
    });
    return { innerWidth, clientWidth: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth, bodyOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1,
      textIssues, overflowingElements, smallOptions, labelTargets, optionTargets, fragments, hiddenVisible, nativeSelects };
  });
}

async function run(browser, engine, viewport, route, state) {
  const name = `${engine}-${route.name.replaceAll("/", "-")}-${state}-${viewport.width}`;
  const context = await browser.newContext({ viewport, locale: "ko-KR", timezoneId: "Asia/Seoul",
    reducedMotion: "reduce", serviceWorkers: "block", hasTouch: viewport.width < 800 });
  contexts.add(context);
  const errors = [];
  const intercepted = [];
  let page;
  try {
    await context.route("**/*", async interception => {
      const request = interception.request(), url = new URL(request.url());
      if (request.method() !== "GET" || url.origin !== origin) {
        report.blocked.push({ scenario: name, method: request.method(), path: `${url.origin}${url.pathname}` });
        return interception.abort("blockedbyclient");
      }
      if (url.pathname.startsWith("/archivein/api/")) {
        const api = url.pathname.split("/").at(-1);
        if (api !== route.api) throw new Error(`Unexpected API ${api}`);
        intercepted.push(api);
        return interception.fulfill({ status: state === "error" ? 403 : 200, contentType: "application/json",
          body: JSON.stringify(state === "error" ? { ok: false, error: "가상 오류: 이 링크의 유효기간이 종료되었습니다. 받은 안내 메시지를 다시 확인해 주세요.", message: "가상 오류: 링크를 다시 확인해 주세요." } : payload(api, state)) });
      }
      return interception.continue();
    });
    page = await context.newPage(); page.setDefaultTimeout(6000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(scenarioUrl(route, state), { waitUntil: "load" });
    if (state === "quiz-static") {
      await page.evaluate(quizData => {
        renderQuiz(quizData);
        document.getElementById("startView").classList.add("hidden");
        document.getElementById("examView").classList.remove("hidden");
      }, fixtureQuiz);
    } else if (route.api && ["error", "completed", "daily-empty"].includes(state)) {
      await page.waitForFunction(({ formId, daily }) => daily
        ? !document.getElementById("dailyPanel").classList.contains("hidden")
        : (document.getElementById(formId).hidden || document.getElementById(formId).classList.contains("hidden"))
          && [...document.querySelectorAll(".message,.status,#errorPanel,#successPanel")].some(node => node.getBoundingClientRect().height > 0 && node.textContent.trim()),
      { formId: route.form, daily: state === "daily-empty" });
    } else if (!route.informational) {
      await page.waitForFunction(formId => document.getElementById(formId)?.getBoundingClientRect().height > 0, route.form);
    }
    await page.evaluate(() => document.fonts.ready);
    if (route.api && !intercepted.includes(route.api)) throw new Error("Synthetic fixture was not consumed; cannot claim API-backed state coverage");
    const metrics = await measure(page);
    const screenshot = path.join(output, `${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.screenshot({ path: path.join(output, `${name}-viewport.png`) });
    report.scenarios.push({ name, engine, route: route.name, state, width: viewport.width,
      excludedFromActive: Boolean(route.excludedFromActive),
      coverage: state === "quiz-static" ? "22 actual source question labels via renderQuiz + exposed exam; session/timer/start untested" : route.informational ? "static informational page; roster names replaced; external fonts blocked" : "native DOM + synthetic API GET where needed",
      metrics, screenshot, errors, intercepted });
    if (state === "form" && ["groupSurvey", "privateSurvey", "instructor-observation", "private-chart"].includes(route.name)) {
      await page.evaluate(() => {
        for (const details of document.querySelectorAll("details")) details.open = true;
        for (const input of document.querySelectorAll('input[value="기타"]')) { input.checked = true; input.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      const expandedName = `${engine}-${route.name}-expanded-${viewport.width}`;
      const expandedScreenshot = path.join(output, `${expandedName}.png`);
      const expandedMetrics = await measure(page);
      await page.screenshot({ path: expandedScreenshot, fullPage: true });
      report.scenarios.push({ name: expandedName, engine, route: route.name, state: "expanded", width: viewport.width,
        coverage: "DOM-only checkbox state/optional details; no submit", metrics: expandedMetrics, screenshot: expandedScreenshot, errors });
    }
    if (state === "form" && await page.getByRole("combobox").count()) {
      await page.evaluate(() => {
        const canvas = document.createElement("canvas").getContext("2d");
        for (const select of document.querySelectorAll("select")) {
          canvas.font = getComputedStyle(select).font;
          const longest = [...select.options].filter(option => option.value).sort((a, b) => canvas.measureText(b.textContent).width - canvas.measureText(a.textContent).width)[0];
          if (longest) { select.value = longest.value; select.dispatchEvent(new Event("change", { bubbles: true })); }
        }
      });
      const selectedName = `${engine}-${route.name}-selected-options-${viewport.width}`;
      const selectedScreenshot = path.join(output, `${selectedName}.png`);
      report.scenarios.push({ name: selectedName, engine, route: route.name, state: "selected-options", width: viewport.width,
        coverage: "Longest native select choices set locally; no submits; native popup contents not inspected", metrics: await measure(page), screenshot: selectedScreenshot, errors });
      await page.screenshot({ path: selectedScreenshot, fullPage: true });
    }
  } catch (error) {
    report.failures.push({ name, error: error.message });
    if (page) await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {});
  } finally { await closeContext(context); }
}

try {
  const catalogFile = "core/assets/alimtalk-catalog.json";
  const catalogBytes = await fs.readFile(path.join(repo, catalogFile));
  const catalog = JSON.parse(catalogBytes);
  sources.set(catalogFile, catalogBytes);
  report.catalog = { coverage: catalog.coverage, rows: catalog.rows.length,
    note: "Snapshot only; not current provider approval, real short-link resolution, actual sent-button inventory or deployment evidence.",
    buttons: catalog.rows.map(row => ({ type: row.type, code: row.code, label: row.label, knownProvider: row.knownProvider,
      implementation: row.implementation, visibility: row.visibility, urls: row.policy?.buttonUrlRules || [] })),
    uncheckedExternal: ["Notion welcome/notice/holding/pricing/visit pages", "eformsign signing/refund templates", "StudioMate registration/reservation screens", "separate interview-scheduling project", "provider-only URL contents not represented in source"],
    excluded: ["onsiteWelcome (retired)", "memberSignup (legacy retained links only)", "deleted/archived provider templates"],
    nonInput: ["privateSurveyResponseView", "recommendedMealPlan", "private lesson/InBody report links", "METHOD material/assignment/calendar informational pages"] };
  const quizFile = "firebase/kangsain-functions/functions/src/staffEvaluation/instructorEvaluationQuiz.ts";
  const quizBytes = await fs.readFile(path.join(repo, quizFile)); sources.set(quizFile, quizBytes);
  const runtimeModules = await fs.realpath(path.join(repo, "node_modules"));
  const require = createRequire(path.resolve(runtimeModules, "../firebase/kangsain-functions/functions/package.json"));
  const ts = require("typescript");
  const ast = ts.createSourceFile(quizFile, quizBytes.toString(), ts.ScriptTarget.Latest, true);
  const safeNodes = ast.statements.filter(node => (ts.isFunctionDeclaration(node) && node.name?.text === "choiceQuestion")
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "QUIZ")));
  if (safeNodes.length !== 2) throw new Error("Cannot isolate quiz constants safely");
  const isolated = safeNodes.map(node => node.getText(ast)).join("\n") + ";globalThis.result=QUIZ;";
  const sandbox = {};
  vm.runInNewContext(ts.transpileModule(isolated, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, sandbox, { timeout: 1000 });
  fixtureQuiz = { questions: sandbox.result.questions.map(({ questionId, type, title, options, points }) => ({ questionId, type, title, options, points })) };
  report.quizQuestions = fixtureQuiz.questions.length;
  for (const route of routes) {
    const file = `archivein/${route.name}/index.html`;
    const bytes = await fs.readFile(path.join(repo, file)); sources.set(file, bytes);
    report.sources.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await verifyLiveStaticSources();
  server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method !== "GET" || !url.pathname.startsWith("/archivein/") || url.pathname.includes("/api/")) return response.writeHead(403).end("Blocked");
      const relative = decodeURIComponent(url.pathname).replace(/^\//, "") + (url.pathname.endsWith("/") ? "index.html" : "");
      const file = path.resolve(repo, relative);
      if (!file.startsWith(path.join(repo, "archivein") + path.sep)) return response.writeHead(403).end("Blocked");
      if (url.pathname === "/archivein/__synthetic-report") return response.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><html lang="ko"><body><h1>가상 리포트</h1><p>실제 회원 내용이 아닙니다.</p></body></html>');
      if (!sources.has(relative)) sources.set(relative, await fs.readFile(file));
      const bytes = servedSources.get(relative) || sources.get(relative);
      const type = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" }[path.extname(file)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }).end(bytes);
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    let browser;
    try { browser = await launcher.launch({ headless: true }); browsers.push(browser); }
    catch (error) { report.failures.push({ name: `${engine}-launch`, error: error.message }); continue; }
    if (!servedSources.size) {
      const sanitizingContext = await browser.newContext({ serviceWorkers: "block" });
      contexts.add(sanitizingContext);
      try {
        const sanitizer = await sanitizingContext.newPage();
        for (const route of routes.filter(item => item.informational)) {
          const file = `archivein/${route.name}/index.html`;
          const clean = await sanitizer.evaluate(raw => {
            const doc = new DOMParser().parseFromString(raw, "text/html");
            doc.querySelectorAll(".name").forEach((node, index) => { node.textContent = `가상${String(index % 5 + 1)}`; });
            return "<!doctype html>" + doc.documentElement.outerHTML;
          }, sources.get(file).toString());
          servedSources.set(file, Buffer.from(clean));
        }
      } finally { await closeContext(sanitizingContext); }
    }
    for (const viewport of viewports) {
      for (const route of routes) {
        const states = route.api ? route.name === "private-chart" ? ["form", "report-edit", "error", "daily-empty"]
          : route.name === "parking" ? ["form", "error"] : ["form", "error", "completed", ...(["groupSurvey", "privateSurvey"].includes(route.name) ? ["metadata-stress"] : [])]
          : route.name === "instructor-evaluation" ? ["form", "quiz-static"] : route.informational ? ["information"] : ["form"];
        for (const state of states) await run(browser, engine, viewport, route, state);
      }
      console.log(`${engine} ${viewport.width}px complete`);
    }
    await browser.close();
  }
} catch (error) {
  report.failures.push({ name: "harness", error: error.message });
} finally {
  const cleanupResults = await Promise.allSettled([...contexts].map(closeContext));
  cleanupResults.push(...await Promise.allSettled(browsers.filter(browser => browser.isConnected()).map(browser => browser.close())));
  for (const result of cleanupResults) if (result.status === "rejected") report.failures.push({ name: "cleanup", error: result.reason.message });
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  report.cleanup = { contextsClosed: contexts.size === 0, browsersClosed: browsers.every(browser => !browser.isConnected()), serverClosed: !server?.listening };
  report.summary = { captures: report.scenarios.length, nonRetiredCaptures: report.scenarios.filter(item => !item.excludedFromActive).length,
    retiredCaptures: report.scenarios.filter(item => item.excludedFromActive).length,
    wrappingIssueCaptures: report.scenarios.filter(item => !item.excludedFromActive && (item.metrics.bodyOverflow || item.metrics.textIssues.length)).length,
    nativeSelectWidthWarnings: report.scenarios.filter(item => item.metrics.nativeSelects.some(select => select.textExceedsInnerWidth)).map(item => item.name),
    inputScope: "7 non-retired local input routes, including 2 adjacent staff forms without a mapped Alimtalk template; 1 retired legacy input route excluded; 7 informational METHOD pages",
    limitations: "No live/provider auth or actual sent-button resolution. Quiz rendering bypasses session/start/timer. METHOD names synthetic, external webfont blocked. Native select popups, iOS keyboard/browser chrome, live eformsign/Notion/StudioMate and separate interview scheduler not covered." };
  report.sources = [...sources].map(([file, bytes]) => ({ file, sha256: createHash("sha256").update(bytes).digest("hex") }));
  for (const [file, bytes] of sources) if (!(await fs.readFile(path.join(repo, file))).equals(bytes)) report.failures.push({ name: "source-drift", error: file });
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  const escaped = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  await fs.writeFile(path.join(output, "report.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARCHIVE PILATES form wrapping audit</title><style>body{font:16px/1.5 system-ui;margin:24px;color:#222}main{max-width:90rem;margin:auto}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #ddd;padding:8px;overflow-wrap:anywhere}a{color:#a12b30}.table{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><main><h1>ARCHIVE PILATES Form Wrapping Audit</h1><p>${escaped(report.scope)}</p><h2>Coverage</h2><pre>${escaped(JSON.stringify(report.summary, null, 2))}</pre><p>${escaped(JSON.stringify(report.cleanup))}</p><h2>Source Catalog</h2><p>${escaped(report.catalog?.note || "Catalog unavailable")}</p><pre>${escaped(JSON.stringify(report.catalog, null, 2))}</pre><h2>Rendered Evidence</h2><div class="table"><table><thead><tr><th>Scenario</th><th>Body Overflow</th><th>Text Issues</th><th>Small Options</th><th>Evidence</th></tr></thead><tbody>${report.scenarios.map(item => `<tr><td>${escaped(item.name)}${item.excludedFromActive ? " (retired, excluded)" : ""}</td><td>${item.metrics.bodyOverflow}</td><td>${item.metrics.textIssues.length}</td><td>${item.metrics.smallOptions.length}</td><td><a href="${escaped(path.basename(item.screenshot))}">Screenshot</a></td></tr>`).join("")}</tbody></table></div><h2>Harness Failures</h2><pre>${escaped(JSON.stringify(report.failures, null, 2))}</pre></main></html>`);
}
console.log(JSON.stringify({ output, summary: report.summary, failures: report.failures,
  blockedRequests: report.blocked.length, nonGetAttempts: report.blocked.filter(request => request.method !== "GET"), cleanup: report.cleanup }, null, 2));
// Assert only after preserving audit evidence, so every regression has a report.
const regressions = [];
function check(name, fn) {
  try { fn(); } catch (error) { regressions.push(`${name}: ${error.message}`); }
}
check("harness", () => assert.equal(report.failures.length, 0, JSON.stringify(report.failures)));
check("cleanup", () => assert.ok(Object.values(report.cleanup).every(Boolean), JSON.stringify(report.cleanup)));
check("no submissions", () => assert.equal(report.blocked.filter(request => request.method !== "GET").length, 0));
for (const engine of ["chromium", "webkit"]) for (const viewport of viewports) for (const route of routes.filter(route => !route.excludedFromActive)) {
  check(`${engine}/${route.name}/${viewport.width} coverage`, () => assert.ok(report.scenarios.some(item => item.engine === engine && item.route === route.name && item.width === viewport.width)));
}
for (const item of report.scenarios.filter(item => !item.excludedFromActive)) {
  check(item.name, () => {
    assert.equal(item.metrics.bodyOverflow, false, "body overflow");
    assert.equal(item.metrics.textIssues.length, 0, `text clipping: ${JSON.stringify(item.metrics.textIssues)}`);
    assert.equal(item.metrics.hiddenVisible.length, 0, `hidden content visible: ${JSON.stringify(item.metrics.hiddenVisible)}`);
    assert.equal(item.errors.length, 0, `page errors: ${JSON.stringify(item.errors)}`);
  });
  if (item.route === "privateSurvey" && ["form", "metadata-stress", "expanded", "selected-options"].includes(item.state)) {
    check(`${item.name} label targets`, () => {
      assert.ok(item.metrics.labelTargets.length > 0, "privateSurvey labels must be rendered");
      assert.ok(item.metrics.labelTargets.every(label => label.height >= 44 - 0.1), `labels below 43.9px: ${JSON.stringify(item.metrics.labelTargets.filter(label => label.height < 44 - 0.1))}`);
    });
  }
  if (item.route === "instructor-evaluation" && item.state === "quiz-static") {
    check(`${item.name} quiz targets`, () => {
      assert.equal(item.metrics.optionTargets.length, fixtureQuiz.questions.reduce((total, question) => total + (question.options?.length || 0), 0), "all source quiz options must be rendered");
      assert.ok(item.metrics.optionTargets.every(option => option.height >= 44 - 0.1), `quiz options below 43.9px: ${JSON.stringify(item.metrics.smallOptions)}`);
    });
  }
}
assert.equal(regressions.length, 0, regressions.join("\n"));
console.log("PASS: active wrapping/hidden-state, privateSurvey and quiz 44px targets (0.1px tolerance), source integrity, coverage, no submissions, and cleanup assertions");
