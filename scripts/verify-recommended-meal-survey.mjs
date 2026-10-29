#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "recommended-meal-survey-qa-"));
const viewports = [
  { name: "mobile-320", width: 320, height: 860 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 1000 }
];
const schemaVersion = "meal-choice-v2";
const consentVersion = "meal-preferences-operator-v1-20261029";
const token = "a".repeat(48);
// Synthetic fixed choices only: no measurements, medical details or real member identities.
const choices = {
  primaryGoal: "식사 습관 개선", mealsPerDay: "3회", breakfastPattern: "간단히 먹음",
  mainMealSource: "집밥·도시락", cookingAccess: "10분 이내 간단 조리", mealBudget: "큰 제한 없음",
  mealBreakWindow: "대체로 일정", workIntensity: "주로 앉아서 생활", exerciseSchedule: "일정하지 않음·운동 안 함",
  snackPattern: ["거의 없음"], allergies: ["없음"], preferredFoods: ["한식", "두부·콩"], healthFlags: ["해당 없음"]
};
const states = new Map();
const posts = [];
const failures = [];
const responsive = [];
const reportGates = [];
let contractMismatchCases = 0;
const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;

try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of viewports) {
    await withContext(viewport, async context => {
      const { page } = await openCase(context, `layout-${viewport.width}`);
      await page.getByRole("button", { name: "설문 제출하기" }).waitFor();
      assert.equal(await page.getByRole("group").count(), 13);
      assert.equal(await page.locator("textarea, select, input:not([type=radio]):not([type=checkbox])").count(), 0);
      const notice = await page.locator("#aiProcessingNotice").innerText();
      assert.match(notice, /Gemini\/OpenAI API를 자동 호출하지 않습니다/);
      assert.match(notice, /ChatGPT\/Codex/);
      assert.match(notice, /제출 즉시 생성되거나 공개되지 않습니다/);
      assert.match(await page.locator("#healthProcessingNotice").innerText(), /초안 작성 입력에 포함하지 않습니다/);
      const before = await inspectLayout(page);
      assertLayout(before, viewport.name);
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}-viewport.png`) });
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`), fullPage: true });
      await page.locator('input[name="primaryGoal"]').first().check();
      assert.deepEqual((await inspectLayout(page)).choiceRects, before.choiceRects, "selection must not shift choices");
      await page.getByRole("button", { name: "설문 제출하기" }).click();
      await page.locator("#surveyValidation").waitFor({ state: "visible" });
      assert.equal(await page.locator("#surveyValidationList li").count(), 13);
      assertLayout(await inspectLayout(page), `${viewport.name} validation`);
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}-validation.png`) });
      await page.locator(".consent").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}-consent.png`) });
      responsive.push({ viewport: `${viewport.width}x${viewport.height}`, horizontalOverflow: false,
        minimumOptionHeight: before.minimumOptionHeight, submitHeight: before.submitHeight });
    });
  }
  assert.equal(posts.length, 0, "layout and validation never submit");

  for (const existing of [false, true]) {
    for (const reportReady of [false, true, "false"]) {
      const name = `${existing ? "existing" : "new"}-${String(reportReady)}-${typeof reportReady}`;
      await withContext(viewports[1], async context => {
        const { page, id } = await openCase(context, name, { status: existing ? "submitted" : "sent", reportReady,
          ...(existing ? { surveySchemaVersion: undefined, consentVersion: reportReady === true ? "meal-preferences-gemini-v1-20261029" : undefined } : {}) });
        const initialPosts = posts.length;
        if (!existing) {
          await fillChoices(page);
          assert.equal(posts.length, initialPosts, "choice and consent changes never auto-submit");
          await page.getByRole("button", { name: "설문 제출하기" }).click();
        }
        await page.locator("#surveyMessage").waitFor({ state: "visible" });
        assert.match(await page.locator("#surveyMessageText").innerText(), /설문 제출이 완료/);
        assert.equal(await page.locator("form").isVisible(), false);
        assert.equal(await page.locator("button[type=submit]").isDisabled(), true);
        assert.equal(posts.length, initialPosts + (existing ? 0 : 1));
        const visible = reportReady === true;
        assert.equal(await page.locator("#mealReportLink").isVisible(), visible);
        if (visible) {
          assert.equal(await page.locator("#mealReportLink").getAttribute("href"), `../recommendedMealPlan/?id=${id}&token=${token}`);
          assert.match(await page.locator("#surveyMessageText").innerText(), /운영자가 공개한/);
        } else {
          assert.match(await page.locator("#surveyMessageText").innerText(), /운영자 검토를 기다리고 있습니다/);
          assert.match(await page.locator("#surveyMessageText").innerText(), /관리자가 별도로 요청/);
        }
        await page.locator("form").dispatchEvent("submit");
        assert.equal(posts.length, initialPosts + (existing ? 0 : 1), "submitted form stays locked");
        await page.screenshot({ path: path.join(outputDir, `${name}-completion.png`) });
        reportGates.push({ kind: existing ? "historical submitted" : "new submission", flag: reportReady, linkVisible: visible });
      });
    }
  }

  for (const [index, metadata] of [
    { surveySchemaVersion: undefined }, { surveySchemaVersion: 3 }, { surveySchemaVersion: "meal-choice-v3" },
    { consentVersion: undefined }, { consentVersion: [consentVersion] }, { consentVersion: "old-consent" },
    { consentVersion: "meal-preferences-gemini-v1-20261029" }
  ].entries()) {
    await withContext(viewports[1], async context => {
      const { page } = await openCase(context, `contract-${index}`, metadata);
      assert.equal(await page.locator("form").isVisible(), false);
      assert.equal(await page.locator("button[type=submit]").isDisabled(), true);
      assert.match(await page.locator("#surveyMessageText").innerText(), /새로고침/);
      const initialPosts = posts.length;
      await page.locator("form").dispatchEvent("submit");
      assert.equal(posts.length, initialPosts);
      contractMismatchCases += 1;
    });
  }
} catch (error) {
  failures.push(error.message);
} finally {
  if (browser) {
    const remaining = browser.contexts().length;
    await browser.close();
    if (remaining) failures.push(`${remaining} browser contexts were not cleaned up`);
  }
  await new Promise(resolve => server.close(resolve));
}

console.log(JSON.stringify({ ok: !failures.length, failures, responsive, reportGates,
  contractMismatchCases, syntheticLocalPosts: posts.length, livePosts: 0,
  outputDir, browserClosed: !browser?.isConnected(), serverClosed: !server.listening }, null, 2));
if (failures.length) process.exitCode = 1;

async function withContext(viewport, run) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width < 540, hasTouch: viewport.width < 540, serviceWorkers: "block", reducedMotion: "reduce" });
  try {
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === baseUrl) return route.continue();
      failures.push(`Blocked non-local request: ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await run(context);
  } finally { await context.close(); }
}

async function openCase(context, name, metadata = {}) {
  const id = `meal-qa-${name}-0000000000000000`;
  states.set(id, { status: "sent", reportReady: false, surveySchemaVersion: schemaVersion, consentVersion, ...metadata });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => failures.push(error.message));
  await page.goto(`${baseUrl}/recommendedMealSurvey/?id=${id}&token=${token}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "추천식단 설문", exact: true }).waitFor();
  await page.waitForFunction(() => !document.getElementById("mealSurveyForm").hidden || !document.getElementById("surveyMessage").hidden);
  return { page, id };
}

async function fillChoices(page) {
  for (const [name, answer] of Object.entries(choices)) {
    const group = page.locator(`fieldset[data-choice="${name}"]`);
    for (const value of Array.isArray(answer) ? answer : [answer]) {
      await group.getByRole(Array.isArray(answer) ? "checkbox" : "radio", { name: value, exact: true }).check();
    }
  }
  await page.locator('input[name="consent"]').check();
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const rect = element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
    const visible = element => element.getClientRects().length;
    const options = [...document.querySelectorAll(".option")].filter(visible);
    const overflow = [...document.querySelectorAll("main, fieldset, .options, .option, .notice, .consent, p, legend, .message, .validation-list a")]
      .filter(element => visible(element) && (element.scrollWidth > element.clientWidth + 1 || rect(element).x + rect(element).width > innerWidth + 1));
    return {
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1,
      submitHeight: rect(document.querySelector("button[type=submit]")).height,
      minimumOptionHeight: Math.min(...options.map(element => rect(element).height)),
      smallErrorLinks: [...document.querySelectorAll(".validation-list a")].filter(element => visible(element) && rect(element).height < 44).length,
      overflowingFields: overflow.length,
      choiceRects: [...document.querySelectorAll("fieldset .option")].map(rect)
    };
  });
}

function assertLayout(check, name) {
  assert.equal(check.horizontalOverflow, false, `${name}: horizontal overflow`);
  assert.ok(check.submitHeight >= 44, `${name}: submit target below 44px`);
  assert.ok(check.minimumOptionHeight >= 44, `${name}: option target below 44px`);
  assert.equal(check.smallErrorLinks, 0, `${name}: error link below 44px`);
  assert.equal(check.overflowingFields, 0, `${name}: field overflow`);
}

async function startServer() {
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch(error => {
      failures.push(`Mock server: ${error.message}`);
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Synthetic QA request rejected" }));
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server;
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/api/recommendedMealSurvey") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.method === "GET") {
      const state = states.get(url.searchParams.get("id"));
      assert.ok(state, "unknown synthetic GET request");
      assert.equal(url.searchParams.get("token"), token);
      response.end(JSON.stringify({ ok: true, memberName: "합성 QA 회원", inbodyStatus: "missing", ...state }));
      return;
    }
    assert.equal(request.method, "POST");
    let body = "";
    for await (const chunk of request) { body += chunk; assert.ok(body.length <= 16384); }
    const payload = JSON.parse(body);
    const state = states.get(payload.requestId);
    assert.ok(state, "unknown synthetic POST request");
    assert.deepEqual(payload, { requestId: payload.requestId, accessToken: token, schemaVersion, consentVersion,
      consent: true, aiProcessingConsent: true, ...choices });
    posts.push(payload.requestId);
    const duplicate = state.status === "submitted";
    state.status = "submitted";
    response.end(JSON.stringify({ ok: true, status: "submitted", duplicate, reportReady: state.reportReady }));
    return;
  }
  const files = {
    "/recommendedMealSurvey/": ["archivein/recommendedMealSurvey/index.html", "text/html; charset=utf-8"],
    "/archivein/logo120.png": ["archivein/logo120.png", "image/png"]
  };
  const file = files[url.pathname];
  if (request.method !== "GET" || !file) { response.writeHead(404); response.end("Not found"); return; }
  response.setHeader("Content-Type", file[1]);
  response.end(fs.readFileSync(path.join(repoRoot, file[0])));
}
