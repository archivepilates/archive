#!/usr/bin/env node
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(await fs.realpath(path.join(repo, "node_modules")), "../firebase/kangsain-functions/functions/package.json"));
const ts = require("typescript");
const output = await fs.mkdtemp(path.join(os.tmpdir(), "member-result-wrapping-"));
const report = { output, scope: "Pure source renderers and synthetic results only; all external requests blocked; no live API or submissions. Optional DEPLOYED_RENDERER_SOURCE_ROOT compares operator-supplied local Functions src snapshots only, not live runtime attestation.", sources: [], cases: [], failures: [], blocked: [], rendererSourceVerification: [] };
const long = "오래 앉아 있을 때 어깨와 골반의 움직임을 확인하고 편안한 호흡을 유지합니다. ";
const unbroken = "SyntheticLongUnbrokenIdentifier".repeat(8);
const longUrl = `https://synthetic.invalid/${unbroken}?reference=${"SyntheticUrlSegment".repeat(8)}`;
const browsers = [];
const contexts = new Set();

function pureRendererSource(file, bytes, names) {
  const ast = ts.createSourceFile(file, bytes.toString(), ts.ScriptTarget.Latest, true);
  const functions = names.map(name => {
    const matches = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (matches.length !== 1) throw new Error(`Renderer dependency mismatch: ${file}: ${name}`);
    return matches[0].getText(ast);
  });
  return functions.join("\n").replace(/^export /gm, "").replace(/\r\n/g, "\n");
}

async function closeContext(context) {
  await context.close();
  contexts.delete(context);
}

async function renderer(file, names, globals, exported) {
  const bytes = await fs.readFile(path.join(repo, file));
  const pureSource = pureRendererSource(file, bytes, names);
  const rendererSha256 = createHash("sha256").update(pureSource).digest("hex");
  report.sources.push({ file, sha256: createHash("sha256").update(bytes).digest("hex"), rendererSha256 });
  if (process.env.DEPLOYED_RENDERER_SOURCE_ROOT) {
    const relative = path.relative("firebase/kangsain-functions/functions/src", file);
    const snapshot = path.resolve(process.env.DEPLOYED_RENDERER_SOURCE_ROOT, relative);
    // Inspect AST text only; never execute snapshot code or request a tokenized Function.
    const snapshotSource = pureRendererSource(snapshot, await fs.readFile(snapshot), names);
    const actual = createHash("sha256").update(snapshotSource).digest("hex");
    report.rendererSourceVerification.push({ file, snapshot, expected: rendererSha256, actual, matches: actual === rendererSha256 });
    if (actual !== rendererSha256) report.failures.push({ name: "renderer-source-mismatch", error: file });
  }
  const source = pureSource + `\nglobalThis.render=${exported};`;
  const sandbox = { URL, Intl, ...globals };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, sandbox, { timeout: 1000 });
  return sandbox.render;
}

const cases = [];
try {
const survey = await renderer("firebase/kangsain-functions/functions/src/privateSurvey/privateSurveyResponse.ts",
  ["renderSurveyPage", "answerBlock", "matchText", "lessonTimeText", "escapeHtml"], { ARCHIVE_LOGO_URL: "https://synthetic.invalid/logo.png" }, "renderSurveyPage");
const privateReport = await renderer("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts",
  ["renderPrivateLessonReportPage", "cleanEditableReportText", "textArray", "firstText", "lessonTimeText", "uniqueTextItems", "privateReportNextCheckItems", "mediaFilesForReport", "renderPrivateLessonReportMediaSection", "escapeHtml", "escapeAttr", "drivePreviewUrl"],
  { PRIVATE_LESSON_REPORT_VIEW_BASE_URL: "https://synthetic.invalid/report" }, "renderPrivateLessonReportPage");
const mealFile = "archivein/recommendedMealPlan/index.html";
const mealBytes = await fs.readFile(path.join(repo, mealFile));
report.sources.push({ file: mealFile, sha256: createHash("sha256").update(mealBytes).digest("hex") });

for (const stress of [false, true]) {
  // Keep URL and newline stress below the report renderer's 900-character limit.
  const value = (stress ? [long.repeat(3).trim(), unbroken, longUrl, "가상 다음 줄: 줄바꿈 보존 검증"] : [long.trim(), long.trim()]).join("\n");
  assert.ok(value.length <= 900, "Stress fixture must survive renderer length limits");
  for (const surveyType of ["group", "private"]) cases.push({ name: `${surveyType}-response-${stress ? "stress" : "normal"}`, value, lineBreakSelector: ".value", html: survey({
    memberName: stress ? "가상회원이름줄바꿈검증" : "가상회원", surveyType, submittedAtText: "2026. 10. 12. 오후 7:00",
    experienceType: "필라테스 경험은 있지만 오랜만이에요", matching: { status: "matched", lectureDate: "2026. 10. 12. 오후 7:00", staffName: "가상강사" },
    summary: Object.fromEntries(["goal", "focusArea", "painOrMedicalNote", "exerciseLevel", "expectationOrImportantFactor", "concernOrDifficulty", "lifestyleOrPreviousIssue", "referralSource"].map(key => [key, value])),
  }) });
  cases.push({ name: `private-report-${stress ? "stress" : "normal"}`, value, lineBreakSelector: ".lead p", html: privateReport({
    memberName: "가상회원", staffName: "가상강사", recordId: "synthetic", sessionNumber: 2, lessonDate: "2026-10-12", gptDraftSummary: value,
    gptDraftNextDirection: value, postRecord: { goals: [value], focusAreas: ["어깨", "골반"], equipment: ["리포머"], changes: [value], condition: value, painChange: value, homework: value },
    media: { files: [{ status: "uploaded", includeInReport: true, driveFileId: "synthetic", fileName: stress ? unbroken : "가상 수업 영상.mp4", previewUrl: "https://synthetic.invalid/media", driveUrl: "https://synthetic.invalid/media" }] },
  }, { accessTokenHash: "synthetic" }) });
  cases.push({ name: `meal-plan-${stress ? "stress" : "normal"}`, value, lineBreakSelector: ".card p,.meal span", html: mealBytes.toString(), meal: { ok: true, memberName: "가상회원", content: {
    title: "생활 습관에 맞춘 추천식단", summary: value, goal: value, metricsSummary: value, principles: [value, value],
    days: Array.from({ length: 7 }, (_, i) => ({ label: `${i + 1}일차`, breakfast: value, lunch: value, dinner: value, snack: value, timingTip: value })),
    hydration: value, exerciseNutrition: value, weekendStrategy: value, caution: value,
  } } });
}

for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
  const browser = await launcher.launch({ headless: true });
  browsers.push(browser);
  try {
    for (const width of [320, 390, 768, 1440]) for (const item of cases) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, locale: "ko-KR", hasTouch: width < 800, reducedMotion: "reduce", serviceWorkers: "block" });
      contexts.add(context);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(6000);
        const errors = [];
        let fixtureConsumed = false;
        page.on("pageerror", error => errors.push(error.message));
        await context.route("**/*", async route => {
          const request = route.request(), url = new URL(request.url());
          if (request.method() === "GET" && url.href === "https://synthetic.invalid/audit") return route.fulfill({ contentType: "text/html", body: item.html });
          if (item.meal && request.method() === "GET" && url.origin === "https://synthetic.invalid" && url.pathname === "/api/recommendedMealPlan") {
            fixtureConsumed = true;
            return route.fulfill({ contentType: "application/json", body: JSON.stringify(item.meal) });
          }
          report.blocked.push({ engine, name: item.name, width, method: request.method(), path: `${url.origin}${url.pathname}` });
          return route.abort();
        });
        await page.goto("https://synthetic.invalid/audit", { waitUntil: "load" });
        if (item.meal) await page.getByRole("heading", { name: item.meal.content.title, exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(({ value, lineBreakSelector }) => {
          const issues = [];
          for (const node of document.querySelectorAll("h1,h2,h3,p,span,strong,small,li,a,.value,.chip")) {
            const style = getComputedStyle(node), box = node.getBoundingClientRect();
            if (!box.height || !box.width || style.visibility === "hidden" || style.opacity === "0") continue;
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            const rects = [];
            while (walker.nextNode()) {
              if (!walker.currentNode.textContent.trim()) continue;
              const range = document.createRange(); range.selectNodeContents(walker.currentNode);
              rects.push(...[...range.getClientRects()].filter(rect => rect.width && rect.height));
            }
            const reasons = [];
            if (rects.some(rect => rect.left < -1 || rect.right > innerWidth + 1)) reasons.push("text-outside-viewport");
            let parent = node;
            while (parent && parent !== document.documentElement) {
              const ancestorStyle = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
              if (["hidden", "clip", "auto", "scroll"].includes(ancestorStyle.overflowX) && rects.some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) reasons.push(`ancestor-x-${ancestorStyle.overflowX}`);
              if (["hidden", "clip"].includes(ancestorStyle.overflowY) && rects.some(rect => rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)) reasons.push(`ancestor-y-${ancestorStyle.overflowY}`);
              parent = parent.parentElement;
            }
            if (reasons.length) issues.push({ tag: node.tagName, className: node.className, text: node.textContent.slice(0, 100), reasons: [...new Set(reasons)] });
          }
          const lineBreaks = [...document.querySelectorAll(lineBreakSelector)].filter(node => node.textContent === value).map(node => {
            const text = node.firstChild;
            const newline = value.indexOf("\n");
            const before = document.createRange(), after = document.createRange();
            if (text?.nodeType !== Node.TEXT_NODE || text.textContent !== value || newline < 1) return { preserved: false };
            before.setStart(text, newline - 1); before.setEnd(text, newline);
            after.setStart(text, newline + 1); after.setEnd(text, newline + 2);
            const whiteSpace = getComputedStyle(node).whiteSpace;
            // WebKit includes a zero-width previous-line caret in ranges after a newline.
            const beforeRect = [...before.getClientRects()].find(rect => rect.width > 0 && rect.height > 0);
            const afterRect = [...after.getClientRects()].find(rect => rect.width > 0 && rect.height > 0);
            return { whiteSpace, beforeTop: beforeRect?.top, afterTop: afterRect?.top,
              preserved: ["pre", "pre-wrap", "pre-line", "break-spaces"].includes(whiteSpace) && Boolean(beforeRect && afterRect && afterRect.top > beforeRect.top + 1) };
          });
          return { horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1, textIssues: issues, lineBreaks,
            longUrlVisible: document.body.textContent.includes(value.split("\n").find(line => line.startsWith("https://")) || "") };
        }, { value: item.value, lineBreakSelector: item.lineBreakSelector });
        const screenshot = path.join(output, `${engine}-${item.name}-${width}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        report.cases.push({ engine, name: item.name, width, ...metrics, screenshot, errors, fixtureConsumed, expectsFixture: Boolean(item.meal) });
      } catch (error) {
        report.failures.push({ name: `${engine}-${item.name}-${width}`, error: error.message });
      } finally { await closeContext(context); }
    }
  } finally { await browser.close(); }
}
for (const source of report.sources) {
  const actual = createHash("sha256").update(await fs.readFile(path.join(repo, source.file))).digest("hex");
  if (actual !== source.sha256) report.failures.push({ name: "source-drift", error: source.file });
}
} catch (error) {
  report.failures.push({ name: "harness", error: error.message });
} finally {
  const cleanupResults = await Promise.allSettled([...contexts].map(closeContext));
  cleanupResults.push(...await Promise.allSettled(browsers.filter(browser => browser.isConnected()).map(browser => browser.close())));
  for (const result of cleanupResults) if (result.status === "rejected") report.failures.push({ name: "cleanup", error: result.reason.message });
  report.cleanup = { contextsClosed: contexts.size === 0, browsersClosed: browsers.every(browser => !browser.isConnected()), serverUsed: false };
}
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, cases: report.cases.length, findings: report.cases.filter(item => item.horizontalOverflow || item.textIssues.length).map(({ engine, name, width, horizontalOverflow, textIssues }) => ({ engine, name, width, horizontalOverflow, textIssues: textIssues.length })), failures: report.failures, cleanup: report.cleanup }, null, 2));
// Preserve metrics/screenshots before failing the regression gate.
const regressions = [];
function check(name, fn) {
  try { fn(); } catch (error) { regressions.push(`${name}: ${error.message}`); }
}
check("harness", () => assert.equal(report.failures.length, 0, JSON.stringify(report.failures)));
check("coverage", () => { assert.equal(cases.length, 8); assert.equal(report.cases.length, 64); });
check("cleanup", () => assert.ok(report.cleanup.contextsClosed && report.cleanup.browsersClosed && !report.cleanup.serverUsed));
check("no submissions", () => assert.equal(report.blocked.filter(request => request.method !== "GET").length, 0));
for (const engine of ["chromium", "webkit"]) for (const width of [320, 390, 768, 1440]) for (const item of cases) {
  check(`${engine}-${item.name}-${width} coverage`, () => assert.equal(report.cases.filter(capture => capture.engine === engine && capture.width === width && capture.name === item.name).length, 1));
}
for (const item of report.cases) check(`${item.engine}-${item.name}-${item.width}`, () => {
  assert.equal(item.horizontalOverflow, false, "body overflow");
  assert.equal(item.textIssues.length, 0, `text overflow/clipping: ${JSON.stringify(item.textIssues)}`);
  assert.equal(item.errors.length, 0, `page errors: ${JSON.stringify(item.errors)}`);
  if (item.expectsFixture) assert.equal(item.fixtureConsumed, true, "synthetic meal fixture not consumed");
  assert.ok(item.lineBreaks.length > 0 && item.lineBreaks.every(line => line.preserved), `explicit line breaks lost: ${JSON.stringify(item.lineBreaks)}`);
  if (item.name.endsWith("-stress")) assert.equal(item.longUrlVisible, true, "long URL fixture lost or truncated");
});
assert.equal(regressions.length, 0, regressions.join("\n"));
console.log("PASS: all 64 normal/stress result scenarios, body/text overflow/clipping, long URL, explicit line breaks, source integrity, no submissions, and cleanup assertions");
