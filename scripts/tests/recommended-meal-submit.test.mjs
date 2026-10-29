import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import { chromium } from "playwright";

const html = readFileSync(new URL("../../archivein/recommendedMealSurvey/index.html", import.meta.url), "utf8");
const requestId = "meal-2026-10-20-0000000000000000";
const accessToken = "a".repeat(48);
const origin = "https://meal-survey.test";
const surveyPath = "/archivein/recommendedMealSurvey/";
const apiPath = "/archivein/api/recommendedMealSurvey";
let browser;

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => {
  if (!browser) return;
  try { assert.equal(browser.contexts().length, 0, "every test must close its context"); }
  finally { await browser.close(); }
  assert.equal(browser.isConnected(), false);
});

// Historical submit coverage now uses the real 13-choice DOM instead of legacy field mocks.
// Every browser request, including synthetic POSTs, is fulfilled or aborted locally.
async function fixture(t, { post = "success", submitted = false, reportReady = false,
  width = 390, search = `?id=${requestId}&token=${accessToken}`, getError = false,
  memberName = "합성 테스트", pendingConsent = false, metadata = {} } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 844 }, isMobile: width < 540, hasTouch: width < 540,
    serviceWorkers: "block", reducedMotion: "reduce"
  });
  const calls = [];
  const gets = [];
  const unexpected = [];
  const errors = [];
  t.after(async () => {
    try { await context.close(); }
    finally {
      assert.deepEqual(unexpected, [], "no unmocked network requests");
      assert.deepEqual(errors, [], "no uncaught browser errors");
    }
  });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    }
    if (request.isNavigationRequest() && url.pathname === surveyPath) {
      const body = pendingConsent ? html.replace('consentVersion: "meal-preferences-operator-v1-20261029"', 'consentVersion: ""') : html;
      return route.fulfill({ contentType: "text/html; charset=utf-8", body });
    }
    if (url.pathname === "/archivein/logo120.png") {
      return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6yS8AAAAASUVORK5CYII=", "base64") });
    }
    if (url.pathname !== apiPath) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (request.method() === "GET") {
      gets.push(url);
      return route.fulfill({ status: getError ? 403 : 200, json: getError
        ? { ok: false, error: "합성 링크 인증 오류" }
        : { ok: true, status: submitted ? "submitted" : "sent", memberName, inbodyStatus: "missing", reportReady,
          surveySchemaVersion: "meal-choice-v2", consentVersion: "meal-preferences-operator-v1-20261029", ...metadata } });
    }
    assert.equal(request.method(), "POST");
    calls.push({ payload: request.postDataJSON(), contentType: request.headers()["content-type"] });
    if (post === "network-error") return route.abort("failed");
    if (typeof post === "function") return route.fulfill(await post());
    if (post === "invalid-json") return route.fulfill({ contentType: "application/json", body: "not json" });
    const json = post === "api-error" ? { ok: false, error: "합성 서버 오류" }
      : post === "null-json" ? null : post === "empty-json" ? {}
      : post === "missing-status" ? { ok: true }
      : post === "wrong-status" ? { ok: true, status: "pending" }
      : { ok: true, status: "submitted", duplicate: post === "duplicate", reportReady };
    return route.fulfill({ status: post === "http-error" ? 500 : 200, json });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}${surveyPath}${search}`);
  await page.waitForFunction(() => !document.getElementById("mealSurveyForm").hidden || !document.getElementById("surveyMessage").hidden);
  return {
    page, calls, gets,
    setPost(value) { post = value; },
    field(name) { return page.locator(`input[name="${name}"]`).first(); },
    async fill() {
      for (const group of await page.locator("fieldset[data-choice]").all()) await group.locator("input").first().check();
      await page.locator('input[name="consent"]').check();
    },
    async clear(name) {
      await page.locator(`input[name="${name}"]`).evaluateAll(inputs => {
        inputs.forEach(input => { input.checked = false; });
        inputs[0].dispatchEvent(new Event("change", { bubbles: true }));
      });
    },
    async snapshot() {
      return page.locator("form input").evaluateAll(inputs => inputs.map(({ name, value, checked }) => ({ name, value, checked })));
    },
    async submit() {
      await page.locator('button[type="submit"]').click();
      await page.waitForFunction(() => !submitting);
    }
  };
}

test("required unanswered choices block POST without deleting answers; no free text is collected", async t => {
  const f = await fixture(t); await f.fill();
  await f.clear("primaryGoal"); await f.clear("breakfastPattern");
  const before = await f.snapshot(); await f.submit();
  assert.equal(f.calls.length, 0);
  assert.equal(await f.page.locator("#surveyValidationList li").count(), 2);
  assert.equal(await f.page.evaluate(() => document.activeElement.id), "surveyValidation");
  assert.deepEqual(await f.snapshot(), before);
  assert.equal(await f.page.locator("textarea, select, input:not([type=radio]):not([type=checkbox])").count(), 0);
  assert.equal(await f.page.locator('input[value=""], input[value="   "]').count(), 0);
  assert.equal(await f.page.locator("form").isVisible(), true);
});

test("missing allergy and consent are blocked without weakening validation", async t => {
  const f = await fixture(t); await f.fill(); await f.clear("allergies"); await f.clear("consent"); await f.submit();
  assert.equal(f.calls.length, 0);
  assert.equal(await f.page.locator("#surveyValidationList li").count(), 2);
  assert.equal(await f.field("consent").getAttribute("aria-invalid"), "true");
});

test("correcting a missing choice clears its summary and indicator", async t => {
  const f = await fixture(t); await f.fill(); await f.clear("primaryGoal"); await f.submit();
  await f.field("primaryGoal").check();
  assert.equal(await f.page.locator("#surveyValidation").isVisible(), false);
  assert.equal(await f.field("primaryGoal").getAttribute("aria-invalid"), null);
  assert.equal(f.calls.length, 0, "correcting an answer never auto-submits");
});

test("summary links focus the missing native control without selecting it", async t => {
  const f = await fixture(t); await f.fill(); await f.clear("primaryGoal"); await f.submit();
  await f.page.locator("#surveyValidationList a").click();
  assert.equal(await f.field("primaryGoal").evaluate(input => input === document.activeElement), true);
  assert.equal(await f.field("primaryGoal").isChecked(), false);
});

test("successful submission sends all original choices once with the approved schema and consent", async t => {
  const f = await fixture(t); await f.fill();
  const before = await f.snapshot(); await f.submit();
  assert.equal(f.calls.length, 1);
  const { payload, contentType } = f.calls[0];
  const names = [...new Set(before.map(input => input.name))].filter(name => name !== "consent");
  assert.equal(names.length, 13);
  assert.deepEqual(Object.keys(payload).sort(), [...names, "requestId", "accessToken", "schemaVersion", "consentVersion", "consent", "aiProcessingConsent"].sort());
  assert.equal(payload.schemaVersion, "meal-choice-v2");
  assert.equal(payload.consentVersion, "meal-preferences-operator-v1-20261029");
  assert.equal(payload.consent, true);
  assert.equal(payload.aiProcessingConsent, true);
  assert.equal(payload.requestId, requestId);
  assert.equal(payload.accessToken, accessToken);
  assert.equal(contentType, "application/json");
  for (const name of names) {
    const values = before.filter(input => input.name === name && input.checked).map(input => input.value);
    assert.deepEqual(payload[name], ["allergies", "healthFlags", "snackPattern", "preferredFoods"].includes(name) ? values : values[0]);
  }
  assert.deepEqual(await f.snapshot(), before);
  assert.equal(await f.page.locator("form").isVisible(), false);
  assert.match(await f.page.locator("#surveyMessageText").innerText(), /설문 제출이 완료/);
  assert.match(await f.page.locator("#surveyMessageText").innerText(), /운영자 검토를 기다리고 있습니다/);
  assert.match(await f.page.locator("#surveyMessageText").innerText(), /관리자가 별도로 요청/);
  assert.equal(await f.page.locator("#mealReportLink").isVisible(), false);
  await f.page.locator("form").dispatchEvent("submit");
  assert.equal(f.calls.length, 1);
  assert.equal(await f.page.locator("button[type=submit]").isDisabled(), true);
});

test("in-flight double click produces exactly one request and freezes choices", async t => {
  let release;
  const f = await fixture(t, { post: () => new Promise(resolve => { release = resolve; }) });
  await f.fill();
  try {
    await f.page.locator("button[type=submit]").click();
    await f.page.waitForFunction(() => submitting);
    await f.page.locator("form").dispatchEvent("submit");
    assert.equal(await f.page.locator("form input:enabled, form button:enabled").count(), 0);
    assert.equal(f.calls.length, 1);
  } finally { release?.({ json: { ok: true, status: "submitted" } }); }
  await f.page.waitForFunction(() => submitted);
  assert.equal(await f.page.locator("form").isVisible(), false);
});

for (const post of ["api-error", "invalid-json", "http-error", "missing-status", "wrong-status", "null-json", "empty-json", "network-error"]) {
  test(`${post} preserves answers, restores button, and focuses a visible error without automatic retry`, async t => {
    const f = await fixture(t, { post }); await f.fill();
    const before = await f.snapshot(); await f.submit();
    assert.equal(await f.page.locator("form").isVisible(), true);
    assert.equal(await f.page.locator("button[type=submit]").isEnabled(), true);
    assert.equal(await f.page.locator("#surveyMessage").isVisible(), true);
    assert.equal(await f.page.locator("#surveyMessage").getAttribute("role"), "alert");
    assert.equal(await f.page.evaluate(() => document.activeElement.id), "surveyMessage");
    assert.doesNotMatch(await f.page.locator("#surveyMessageText").innerText(), /제출이 완료/);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(await f.snapshot(), before);
    assert.equal(await f.page.locator("form input:disabled").count(), 0);
  });
}

test("manual retry keeps the same request and answers and accepts server duplicate confirmation", async t => {
  const f = await fixture(t, { post: "network-error" }); await f.fill(); await f.submit();
  assert.equal(await f.page.locator("form").isVisible(), true);
  f.setPost("duplicate"); await f.submit();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].payload, f.calls[0].payload);
  assert.equal(await f.page.locator("form").isVisible(), false);
  assert.match(await f.page.locator("#surveyMessageText").innerText(), /이미 설문 제출이 완료/);
});

for (const reportReady of [false, true]) {
  test(`historical submitted link stays read-only, reportReady=${reportReady}`, async t => {
    const f = await fixture(t, { submitted: true, reportReady, metadata: { surveySchemaVersion: undefined, consentVersion: undefined } });
    assert.equal(await f.page.locator("form").isVisible(), false);
    assert.equal(await f.page.locator("button[type=submit]").isDisabled(), true);
    assert.match(await f.page.locator("#surveyMessageText").innerText(), /이미 설문 제출이 완료/);
    assert.equal(f.gets[0].searchParams.get("id"), requestId);
    assert.equal(f.gets[0].searchParams.get("token"), accessToken);
    assert.equal(await f.page.locator("#mealReportLink").isVisible(), reportReady);
    if (reportReady) assert.equal(await f.page.locator("#mealReportLink").getAttribute("href"), `../recommendedMealPlan/?id=${requestId}&token=${accessToken}`);
    await f.page.locator("form").dispatchEvent("submit");
    assert.equal(f.calls.length, 0);
  });
}

test("legacy Gemini-consent submitted links stay read-only without new consent or drafting requests", async t => {
  for (const reportReady of [false, true]) {
    const f = await fixture(t, { submitted: true, reportReady,
      metadata: { consentVersion: "meal-preferences-gemini-v1-20261029" } });
    assert.equal(await f.page.locator("form").isVisible(), false);
    assert.equal(await f.field("consent").isDisabled(), true);
    assert.equal(await f.page.locator("button[type=submit]").isDisabled(), true);
    assert.match(await f.page.locator("#surveyMessageText").innerText(), /이미 설문 제출이 완료/);
    assert.equal(await f.page.locator("#mealReportLink").isVisible(), reportReady);
    await f.page.locator("form").dispatchEvent("submit");
    assert.equal(f.calls.length, 0);
  }
});

test("invalid link, rejected GET and absent consent contract never permit POST", async t => {
  for (const options of [{ search: "?id=bad&token=bad" }, { getError: true }, { pendingConsent: true }]) {
    const f = await fixture(t, options);
    assert.equal(await f.page.locator("button[type=submit]").isDisabled(), true);
    await f.page.locator("form").dispatchEvent("submit");
    assert.equal(f.calls.length, 0);
    if (options.search) assert.equal(f.gets.length, 0);
    if (options.pendingConsent) assert.equal(await f.field("consent").isDisabled(), true);
  }
});

test("missing, malformed or mismatched server contract keeps submission locked with a refresh message", async t => {
  for (const metadata of [
    { surveySchemaVersion: undefined }, { surveySchemaVersion: null }, { surveySchemaVersion: 3 },
    { surveySchemaVersion: "meal-choice-v3" }, { consentVersion: undefined },
    { consentVersion: ["meal-preferences-operator-v1-20261029"] }, { consentVersion: "old-consent" },
    { consentVersion: "meal-preferences-gemini-v1-20261029" }
  ]) {
    const f = await fixture(t, { metadata });
    assert.equal(await f.page.locator("form").isVisible(), false);
    assert.equal(await f.page.locator("button[type=submit]").isDisabled(), true);
    assert.equal(await f.field("consent").isDisabled(), true);
    assert.match(await f.page.locator("#surveyMessageText").innerText(), /새로고침/);
    assert.equal(await f.page.evaluate(() => document.activeElement.id), "surveyMessage");
    await f.page.locator("form").dispatchEvent("submit");
    assert.equal(f.calls.length, 0);
  }
});

test("native labels, legends, consent descriptions and keyboard navigation are accessible", async t => {
  const f = await fixture(t);
  assert.equal(await f.page.getByRole("group").count(), 13);
  assert.equal(await f.page.getByRole("group", { name: "1. 가장 우선하는 목표는 무엇인가요?", exact: true }).count(), 1);
  const semantics = await f.page.locator("form input").evaluateAll(inputs => inputs.map(input => ({
    labelled: input.labels.length === 1 && Boolean(input.labels[0].textContent.trim()),
    descriptions: (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean).every(id => Boolean(document.getElementById(id)?.textContent.trim()))
  })));
  assert.ok(semantics.every(input => input.labelled && input.descriptions));
  assert.equal(await f.field("consent").getAttribute("aria-describedby"), "aiProcessingNotice healthProcessingNotice voluntaryConsentNotice");
  assert.equal(await f.field("consent").isChecked(), false);
  assert.match(await f.page.locator("#aiProcessingNotice").innerText(), /Gemini\/OpenAI API를 자동 호출하지 않습니다/);
  assert.match(await f.page.locator("#aiProcessingNotice").innerText(), /ChatGPT\/Codex/);
  await f.page.keyboard.press("Tab");
  assert.equal(await f.field("primaryGoal").evaluate(input => input === document.activeElement), true);
  const focus = await f.field("primaryGoal").evaluate(input => ({
    visible: input.matches(":focus-visible"), outline: getComputedStyle(input).outlineStyle,
    labelOutline: getComputedStyle(input.closest("label")).outlineStyle
  }));
  assert.deepEqual(focus, { visible: true, outline: "solid", labelOutline: "solid" });
  await f.page.keyboard.press("Space"); await f.page.keyboard.press("ArrowDown");
  const goals = f.page.locator('input[name="primaryGoal"]');
  assert.equal(await goals.nth(0).isChecked(), false);
  assert.equal(await goals.nth(1).isChecked(), true);
  await f.page.keyboard.press("Tab");
  assert.equal(await f.field("mealsPerDay").evaluate(input => input === document.activeElement), true);
  assert.equal(f.calls.length, 0);
});

test("native multi-choice labels enforce none exclusivity, maximum and unlock without a submit", async t => {
  const f = await fixture(t);
  const group = f.page.getByRole("group", { name: "12. 선호하는 음식은 무엇인가요?", exact: true });
  for (const name of ["한식", "면류", "빵·샌드위치"]) await group.getByText(name, { exact: true }).click();
  assert.equal(await group.getByRole("checkbox", { name: "고기·생선", exact: true }).isDisabled(), true);
  await group.getByRole("checkbox", { name: "면류", exact: true }).uncheck();
  assert.equal(await group.getByRole("checkbox", { name: "고기·생선", exact: true }).isEnabled(), true);
  await group.getByText("특별한 선호 없음", { exact: true }).click();
  assert.equal(await group.locator("input:checked").count(), 1);
  await group.getByRole("checkbox", { name: "두부·콩", exact: true }).check();
  assert.equal(await group.getByRole("checkbox", { name: "특별한 선호 없음", exact: true }).isChecked(), false);
  assert.equal(f.calls.length, 0);
});

for (const width of [320, 390, 768, 1440]) {
  test(`${width}px: realistic choices, consent and error summary fit without clipping or shifting`, async t => {
    const f = await fixture(t, { width, memberName: "합성테스트아주긴회원표시이름".repeat(3) });
    const layout = async () => f.page.evaluate(() => {
      const rect = element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
      const targets = [...document.querySelectorAll(".option, button[type=submit], .validation-list a")].filter(element => element.getClientRects().length);
      const overflows = [...document.querySelectorAll("main, fieldset, .options, .option, .option > span, legend, p, .meta span, .message, .validation-list a")]
        .filter(element => element.getClientRects().length && (element.scrollWidth > element.clientWidth + 1 || element.getBoundingClientRect().right > innerWidth + 1));
      const clippedLabels = [...document.querySelectorAll(".option > span")].filter(span => {
        const text = span.getBoundingClientRect(); const label = span.parentElement.getBoundingClientRect();
        return text.right > label.right + 1 || text.bottom > label.bottom + 1;
      });
      return {
        viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
        tooSmall: targets.filter(element => rect(element).height < 44).length,
        overflows: overflows.map(element => element.tagName + "." + element.className),
        clippedLabels: clippedLabels.length,
        columns: getComputedStyle(document.querySelector(".options")).gridTemplateColumns.split(" ").length,
        choiceRects: [...document.querySelectorAll("fieldset .option")].map(rect)
      };
    });
    const before = await layout();
    assert.equal(before.viewport, width);
    assert.ok(before.pageWidth <= width);
    assert.equal(before.tooSmall, 0);
    assert.deepEqual(before.overflows, []);
    assert.equal(before.clippedLabels, 0);
    assert.equal(before.columns, width < 540 ? 1 : 2);
    assert.equal(await f.page.locator('meta[name="viewport"]').getAttribute("content"), "width=device-width, initial-scale=1");
    await f.field("primaryGoal").check();
    assert.deepEqual((await layout()).choiceRects, before.choiceRects, "selection does not move choices");
    const screenshot = await f.page.screenshot({ animations: "disabled" });
    assert.ok(screenshot.byteLength > 10000, "rendered screenshot is not blank");
    assert.equal(screenshot.readUInt32BE(16), width);
    await f.submit();
    const invalid = await layout();
    assert.ok(invalid.pageWidth <= width);
    assert.deepEqual(invalid.overflows, []);
    assert.equal(invalid.tooSmall, 0);
    assert.equal(await f.page.locator("#surveyValidationList li").count(), 13);
    await f.page.locator('input[name="consent"]').scrollIntoViewIfNeeded();
    assert.ok((await f.page.screenshot({ animations: "disabled" })).byteLength > 10000);
    assert.equal(f.calls.length, 0);
  });
}
