#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archiveInRoot = path.join(repoRoot, "archivein");
const outputDir = "/tmp/group-survey-responsive";
const requestId = "gsr-responsive-synthetic-20261012";
const accessToken = "a".repeat(48);
const viewports = [
  { width: 320, height: 860 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
];
const groups = [
  { key: "exerciseExperience", title: "필라테스 또는 운동 경험이 있으신가요?", label: "운동 경험", alternative: "필라테스 처음이에요", answer: "수영을 오래 했지만 필라테스는 처음입니다", type: "radio" },
  { key: "painAreas", title: "현재 통증이나 불편한 부위가 있나요?", label: "통증/불편 부위", alternative: "허리", answer: "오래 앉아 있으면 오른쪽 발바닥이 불편합니다", type: "checkbox" },
  { key: "cautionTypes", title: "수업 전 강사가 꼭 알아야 할 내용이 있나요?", label: "수업 전 주의사항", alternative: "수술/시술 이력", answer: "최근 운동을 쉬었으므로 강도를 천천히 높이고 싶습니다", type: "checkbox" },
  { key: "concern", title: "첫 그룹수업에서 가장 걱정되는 부분은 무엇인가요?", label: "첫 수업 걱정", alternative: "자세를 잘 모르겠어요", answer: "호흡과 자세를 함께 따라가기 어려울까 걱정됩니다", type: "radio" },
];
const failures = [];
const results = [];
const skipped = [];
let server;

await main();

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === "--live")) {
    throw new Error("Usage: node scripts/verify-group-survey-responsive.mjs [--live https://host/archivein/]");
  }
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    let pageUrl;
    let liveHtml;
    if (args.length) {
      pageUrl = livePageUrl(args[1]);
      console.log(`Static GET only: ${pageUrl}; all survey API requests are mocked.`);
      const response = await fetch(pageUrl, { redirect: "error", signal: AbortSignal.timeout(15000) });
      assert.ok(response.ok, `Static page GET failed: HTTP ${response.status}`);
      assert.match(response.headers.get("content-type") || "", /text\/html/i);
      liveHtml = await response.text();
    } else {
      server = await startServer();
      pageUrl = new URL(`/archivein/groupSurvey/`, `http://127.0.0.1:${server.address().port}`);
    }
    for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
      if (!fs.existsSync(browserType.executablePath())) {
        if (engine === "chromium") throw new Error("Chromium is not installed for the runtime Playwright version.");
        skipped.push({ engine, reason: "Browser executable not installed", executable: browserType.executablePath() });
        continue;
      }
      let browser;
      try {
        browser = await browserType.launch({ headless: true });
        for (const viewport of viewports) {
          const prefix = `${engine}-${viewport.width}`;
          await runCase(browser, viewport, pageUrl, liveHtml, `${prefix}-form`, {}, async (page, mock) => {
            await page.getByRole("button", { name: "제출하기", exact: true }).waitFor();
            await checkLayout(page, `${prefix}-form`, true);
            assert.equal(mock.gets.length, 1, "One synthetic GET expected");
            assert.equal(mock.posts.length, 0, "Layout check must not submit");
          });
          for (const state of ["invalid", "rejected", "submitted"]) {
            await runCase(browser, viewport, pageUrl, liveHtml, `${prefix}-${state}`, { state }, async (page, mock) => {
              const text = state === "invalid" ? "설문 링크가 올바르지 않습니다." : state === "rejected" ? "합성 링크 거부" : "이미 제출이 완료되었습니다.";
              await waitMessage(page, text);
              await checkHiddenForm(page);
              await checkLayout(page, `${prefix}-${state}`, false);
              assert.equal(mock.gets.length, state === "invalid" ? 0 : 1);
              assert.equal(mock.posts.length, 0);
            });
          }
          await runCase(browser, viewport, pageUrl, liveHtml, `${prefix}-other-submit`, { retry: true, dashTime: true }, async (page, mock) => {
            await verifyOtherSubmission(page, mock, `${prefix}-other-submit`);
          });
          await runCase(browser, viewport, pageUrl, liveHtml, `${prefix}-duplicate-submit`, { duplicate: true }, async (page, mock) => {
            await page.getByRole("button", { name: "제출하기", exact: true }).waitFor();
            await page.getByRole("group", { name: groups[0].title, exact: true }).getByLabel(groups[0].alternative, { exact: true }).check();
            await page.getByRole("button", { name: "제출하기", exact: true }).click();
            await waitMessage(page, "이미 제출이 완료되었습니다.");
            await checkHiddenForm(page);
            assert.equal(mock.posts.length, 1);
            assert.equal(mock.posts[0].exerciseExperience, groups[0].alternative);
            await checkLayout(page, `${prefix}-duplicate-submit`, false);
          });
        }
      } finally {
        if (browser) await browser.close();
      }
    }
  } catch (error) {
    failures.push({ case: "setup", error: error.stack || String(error) });
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
  const report = { ok: failures.length === 0, mode: args.length ? "live-static-mocked-api" : "synthetic-http", viewports, results, skipped, failures, outputDir, cleanup: "Contexts, browsers and fixture server closed in finally" };
  fs.writeFileSync(path.join(outputDir, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = failures.length ? 1 : 0;
}

async function runCase(browser, viewport, pageUrl, liveHtml, name, options, test) {
  let context;
  let page;
  const mock = { gets: [], posts: [], blocked: [], errors: [], checks: [] };
  try {
    context = await browser.newContext({ viewport, serviceWorkers: "block" });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => mock.errors.push(error.message));
    // Deny every request except the exact static page/logo and this synthetic API.
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const apiUrl = new URL("../api/groupSurveySubmit", pageUrl);
      if (url.origin === apiUrl.origin && url.pathname === apiUrl.pathname && ["GET", "POST"].includes(request.method())) {
        let body;
        let status = 200;
        if (request.method() === "GET") {
          mock.gets.push(Object.fromEntries(url.searchParams));
          if (url.searchParams.get("id") !== requestId || url.searchParams.get("token") !== accessToken) {
            body = { ok: false, error: "합성 토큰 불일치" };
            status = 400;
          } else if (options.state === "rejected") {
            body = { ok: false, error: "합성 링크 거부" };
            status = 403;
          } else {
            body = { ok: true, memberName: "합성테스트회원", lessonTime: options.dashTime ? "-" : "2026년 10월 12일 오전 10:00 첫 그룹수업", staffName: "합성테스트강사", status: options.state === "submitted" ? "submitted" : "sent" };
          }
        } else {
          mock.posts.push(request.postDataJSON());
          if (options.retry && mock.posts.length === 1) {
            body = { ok: false, error: "합성 제출 실패: 입력은 유지됩니다." };
            status = 503;
          } else {
            body = { ok: true, status: "submitted", duplicate: Boolean(options.duplicate) };
          }
        }
        await route.fulfill({ status, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) });
        return;
      }
      if (request.method() === "GET" && url.origin === pageUrl.origin && url.pathname === pageUrl.pathname && request.isNavigationRequest()) {
        if (liveHtml !== undefined) await route.fulfill({ contentType: "text/html; charset=utf-8", body: liveHtml });
        else await route.continue();
        return;
      }
      const logoUrl = new URL("../logo120.png", pageUrl);
      if (request.method() === "GET" && url.origin === pageUrl.origin && [logoUrl.pathname, "/logo120.png"].includes(url.pathname)) {
        await route.continue();
        return;
      }
      mock.blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
    });
    const url = new URL(pageUrl);
    if (options.state === "invalid") url.search = "?id=invalid&token=invalid";
    else url.search = new URLSearchParams({ id: requestId, token: accessToken }).toString();
    await page.goto(url.href, { waitUntil: "load" });
    await page.getByRole("heading", { name: "그룹 첫 수업 사전확인", exact: true }).waitFor();
    await test(page, mock);
    assert.deepEqual(mock.errors, [], "No browser JavaScript errors");
    assert.deepEqual(mock.blocked, [], "Unexpected network requests were safely blocked");
    await page.screenshot({ path: path.join(outputDir, `${name}-viewport.png`) });
    await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
    results.push({ case: name, ok: true, mockedGets: mock.gets.length, mockedPosts: mock.posts.length, checks: mock.checks });
  } catch (error) {
    failures.push({ case: name, error: error.stack || String(error), mockedGets: mock.gets.length, mockedPosts: mock.posts.length, passedChecks: mock.checks, blocked: mock.blocked, pageErrors: mock.errors });
    if (page) await page.screenshot({ path: path.join(outputDir, `${name}-failure.png`), fullPage: true }).catch(() => {});
  } finally {
    if (context) await context.close();
  }
}

async function verifyOtherSubmission(page, mock, name) {
  const submit = page.getByRole("button", { name: "제출하기", exact: true });
  await submit.waitFor();
  assert.equal(await page.getByRole("textbox").count(), 2, "Other fields start hidden");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll(".chip")].some((element) => element.textContent.trim() === "-")), false, "Placeholder lesson-time chip hidden");
  for (const group of groups) {
    const scope = page.getByRole("group", { name: group.title, exact: true });
    const other = scope.getByLabel("기타", { exact: true });
    await other.check();
    const textarea = scope.getByRole("textbox");
    await textarea.waitFor();
    await submit.click();
    await waitMessage(page, `${group.label}의 기타 내용을 적어주세요.`);
    assert.equal(mock.posts.length, 0, `${group.key}: empty Other must not POST`);
    await textarea.fill("   ");
    await submit.click();
    await waitMessage(page, `${group.label}의 기타 내용을 적어주세요.`);
    assert.equal(mock.posts.length, 0, `${group.key}: whitespace Other must not POST`);
    await textarea.fill("지워야 할 합성 내용");
    if (group.type === "radio") await scope.getByLabel(group.alternative, { exact: true }).check();
    else await other.uncheck();
    assert.equal(await scope.getByRole("textbox").count(), 0, `${group.key}: deselection hides Other`);
    await other.check();
    assert.equal(await textarea.inputValue(), "", `${group.key}: deselection clears stale Other`);
    await textarea.fill(`  ${group.answer}  `);
    if (group.type === "checkbox") await scope.getByLabel(group.alternative, { exact: true }).check();
  }
  await page.getByLabel("통증이나 불편함이 있다면 자세히 적어주세요", { exact: true }).fill("  합성 통증 메모  ");
  await page.getByLabel("오늘 수업에서 강사가 참고했으면 하는 요청사항이 있나요?", { exact: true }).fill("  합성 요청 메모  ");
  mock.checks.push("Other reveal, empty/whitespace validation, deselection hides and clears all four fields");
  // Keep functional coverage even when expanded layout/accessibility has a defect.
  let expandedLayoutError;
  try {
    await checkLayout(page, `${name}-expanded`, true);
  } catch (error) {
    expandedLayoutError = error;
  }
  await page.screenshot({ path: path.join(outputDir, `${name}-expanded.png`), fullPage: true });
  const expected = {
    requestId,
    accessToken,
    exerciseExperience: `기타: ${groups[0].answer}`,
    painAreas: ["허리", `기타: ${groups[1].answer}`],
    painNote: "합성 통증 메모",
    cautionTypes: ["수술/시술 이력", `기타: ${groups[2].answer}`],
    concern: `기타: ${groups[3].answer}`,
    requestNote: "합성 요청 메모",
  };
  await submit.click();
  await waitMessage(page, "합성 제출 실패: 입력은 유지됩니다.");
  assert.deepEqual(mock.posts, [expected], "Trimmed selections, Other text and notes preserved in mock POST");
  assert.equal(await submit.isVisible(), true, "Failed submission leaves form visible");
  assert.equal(await submit.isEnabled(), true, "Failed submission enables retry");
  for (const group of groups) {
    assert.equal(await page.getByRole("group", { name: group.title, exact: true }).getByRole("textbox").inputValue(), `  ${group.answer}  `, "Failed submission preserves typed Other input");
  }
  await submit.click();
  await waitMessage(page, "제출이 완료되었습니다.");
  assert.deepEqual(mock.posts, [expected, expected], "Retry preserves entire payload");
  mock.checks.push("Mock POST trims and preserves all selections, Other answers and notes; failure/retry preserves entire payload");
  await checkHiddenForm(page);
  await checkLayout(page, `${name}-submitted`, false);
  mock.checks.push("Successful mock submission hides form from layout and accessibility tree");
  if (expandedLayoutError) throw expandedLayoutError;
}

async function waitMessage(page, text) {
  await page.waitForFunction((expected) => {
    const element = document.getElementById("message");
    return element && !element.hidden && element.textContent.includes(expected);
  }, text);
}

async function checkHiddenForm(page) {
  const hidden = await page.evaluate(() => {
    const form = document.getElementById("surveyForm");
    return Boolean(form?.hidden && getComputedStyle(form).display === "none" && form.getClientRects().length === 0);
  });
  assert.equal(hidden, true, "Hidden form must actually be absent from layout");
  assert.equal(await page.getByRole("button", { name: "제출하기", exact: true }).count(), 0, "Hidden submit not accessible");
  assert.equal(await page.getByRole("textbox").count(), 0, "Hidden fields not accessible");
}

async function checkLayout(page, name, formVisible) {
  const check = await page.evaluate(() => {
    const errors = [];
    const width = document.documentElement.clientWidth;
    const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
    const elements = (selector) => [...document.querySelectorAll(selector)].filter(visible);
    const describe = (element) => `${element.tagName.toLowerCase()}: ${(element.textContent || element.getAttribute("name") || "").trim().slice(0, 70)}`;
    const inside = (rect, bounds) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    if (documentWidth > width + 1) errors.push(`Horizontal overflow: ${documentWidth} > ${width}`);
    for (const element of elements("fieldset, .field, .option, textarea, .message, .chip, .lead, h1")) {
      const bounds = element.getBoundingClientRect();
      if (bounds.left < -1 || bounds.right > width + 1) errors.push(`Outside viewport: ${describe(element)}`);
      if (element.scrollWidth > element.clientWidth + 1) errors.push(`Internal overflow: ${describe(element)}`);
    }
    for (const element of elements("legend, label.option > span")) {
      const parent = element.matches("legend") ? element.closest("fieldset") : element.closest("label.option");
      const bounds = parent.getBoundingClientRect();
      if (!inside(element.getBoundingClientRect(), bounds)) errors.push(`Outside parent: ${describe(element)}`);
      const range = document.createRange();
      range.selectNodeContents(element);
      for (const rect of range.getClientRects()) {
        if (rect.width && !inside(rect, bounds)) errors.push(`Text outside parent: ${describe(element)}`);
      }
    }
    for (const element of elements(".lead, legend, .label, label.option > span, textarea, .message")) {
      const style = getComputedStyle(element);
      if (style.wordBreak !== "keep-all") errors.push(`Expected Korean keep-all: ${describe(element)}`);
      if (["nowrap", "pre"].includes(style.whiteSpace)) errors.push(`Wrapping disabled: ${describe(element)}`);
      if (Number.parseFloat(style.fontSize) < 14) errors.push(`Descriptive text below 14px: ${describe(element)}`);
    }
    const options = elements("label.option");
    for (const element of [...options, ...elements("button")]) {
      if (element.getBoundingClientRect().height < 43.99) errors.push(`Touch target below 44px: ${describe(element)}`);
    }
    for (const element of elements("textarea")) {
      const label = [...(element.labels || [])].some((label) => label.textContent.trim()) || element.getAttribute("aria-label")?.trim() || element.getAttribute("aria-labelledby")?.split(/\s+/).some((id) => document.getElementById(id)?.textContent.trim());
      if (!label) errors.push(`Missing accessible textarea label: ${element.name}`);
    }
    const logo = document.querySelector(".brand");
    if (!logo?.complete || !logo.naturalWidth) errors.push("Logo did not render");
    const lead = document.querySelector(".lead");
    const top = document.querySelector(".top");
    if (!lead || !top || getComputedStyle(lead).gridColumnStart !== "1" || getComputedStyle(lead).gridColumnEnd !== "-1") errors.push("Intro must span both header columns");
    return { errors, width, documentWidth, optionCount: options.length, legendCount: elements("legend").length, minimumOptionHeight: options.length ? Math.min(...options.map((element) => element.getBoundingClientRect().height)) : null };
  });
  if (formVisible) {
    assert.equal(check.legendCount, 4, `${name}: expected four accessible question groups`);
    assert.equal(check.optionCount, 25, `${name}: expected all survey choices`);
  }
  assert.deepEqual(check.errors, [], `${name}: responsive bounds, typography, touch and labels`);
}

function livePageUrl(value) {
  const url = new URL(value);
  assert.ok(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, "Live URL must be an HTTP(S) static base without credentials, query or hash");
  if (/\/groupSurvey(?:\/index\.html)?\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/index\.html$/, "/").replace(/\/?$/, "/");
  else url.pathname = `${url.pathname === "/" ? "/archivein/" : url.pathname.replace(/\/?$/, "/")}groupSurvey/`;
  return url;
}

async function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    const files = {
      "/archivein/groupSurvey/": [path.join(archiveInRoot, "groupSurvey/index.html"), "text/html; charset=utf-8"],
      "/archivein/logo120.png": [path.join(archiveInRoot, "logo120.png"), "image/png"],
      "/logo120.png": [path.join(archiveInRoot, "logo120.png"), "image/png"],
    };
    const file = files[url.pathname];
    if (request.method !== "GET" || !file) {
      response.writeHead(403);
      response.end("Fixture allows static GET only; API must be intercepted.");
      return;
    }
    try {
      const body = fs.readFileSync(file[0]);
      response.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Static fixture missing");
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    return server;
  } catch (error) {
    server.close();
    throw error;
  }
}
