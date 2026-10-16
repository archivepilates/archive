#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "archivein");
const route = "/method/external-feedback-261017/";
const previewCode = "externalfeedback261017";
const source = JSON.parse(fs.readFileSync(path.join(root, "docs/tasks/2026-10-16-external-feedback-team-source.json"), "utf8"));
const outputDir = path.join(root, "artifacts/external-feedback-team-261017");
const report = { startedAt: new Date().toISOString(), checks: [], screenshots: [], cleanup: {} };
const contexts = new Set();
let browser;
let server;

fs.mkdirSync(path.join(outputDir, "screenshots"), { recursive: true });

async function check(name, callback) {
  try {
    const evidence = await callback();
    report.checks.push({ name, passed: true, evidence });
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.stack || String(error) });
    throw error;
  }
}

function flatten(phases) {
  return Object.values(phases).flat();
}

function serve() {
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = path.resolve(publicRoot, `.${pathname}`, pathname.endsWith("/") ? "index.html" : "");
      if (request.method !== "GET" || !file.startsWith(`${publicRoot}${path.sep}`) || !fs.existsSync(file)) {
        response.writeHead(404).end("Not found");
        return;
      }
      const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png" }[path.extname(file)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      response.end(fs.readFileSync(file));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function openPage(context, baseUrl, suffix = "") {
  const page = await context.newPage();
  const response = await page.goto(`${baseUrl}${route}${suffix}`, { waitUntil: "load" });
  assert.equal(response.status(), 200);
  return page;
}

async function measure(page) {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const visible = [...document.body.querySelectorAll("*")].filter((element) => element.checkVisibility());
    return {
      width,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      outside: visible.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > width + 1);
      }).map((element) => `${element.tagName}.${element.className}`),
      controls: [...document.querySelectorAll('[role="tab"], .join-button')].filter((element) => element.checkVisibility()).map((element) => {
        const rect = element.getBoundingClientRect();
        return { text: element.textContent.trim(), width: rect.width, height: rect.height };
      }),
    };
  });
  assert.ok(result.scrollWidth <= result.width + 1, JSON.stringify(result));
  assert.deepEqual(result.outside, []);
  for (const control of result.controls) assert.ok(control.width >= 44 && control.height >= 44, JSON.stringify(control));
  return result;
}

try {
  await check("source and page contract", () => {
    assert.equal(source.lesson.date, "2026-10-17");
    assert.deepEqual(source.lesson.sessions.map(({ start, end, teacher, room }) => ({ start, end, teacher, room })), [
      { start: "13:30", end: "14:20", teacher: "정은영", room: "바렐룸" },
      { start: "14:30", end: "15:20", teacher: "배민진", room: "리포머룸" },
    ]);
    assert.equal(flatten(source.minjin.phases).length, 9);
    assert.equal(flatten(source.minjin.phases).flatMap((move) => move.steps).length, 28);
    assert.equal(flatten(source.eunyoung.phases).length, 12);
    assert.deepEqual(flatten(source.eunyoung.phases).filter((move) => move.withoutToningBall).map((move) => move.title), [
      "Ladder Hold Wide Squat + Side Bend Series", "Mountain Climber", "Standing Leg Series", "Arabesque Series",
    ]);
  });

  await serve();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });

  const beforeContext = await browser.newContext({ timezoneId: "Asia/Seoul", viewport: { width: 390, height: 844 } });
  contexts.add(beforeContext);
  await beforeContext.addInitScript(() => { Date.now = () => new Date("2026-10-17T11:59:59+09:00").getTime(); });
  const locked = await openPage(beforeContext, baseUrl);
  await check("locked before class-day noon", async () => {
    const state = await locked.evaluate(() => ({ state: document.body.dataset.methodAccessState, message: document.querySelector("[data-method-gate-message]").textContent.trim(), contentVisible: document.querySelector("[data-method-content]").checkVisibility() }));
    assert.deepEqual(state, { state: "locked", message: "수업자료는 수업 당일 12시에 공개됩니다.", contentVisible: false });
    return state;
  });
  await beforeContext.close(); contexts.delete(beforeContext);

  for (const width of [320, 390, 768, 1280]) {
    const context = await browser.newContext({ timezoneId: "Asia/Seoul", viewport: { width, height: width < 700 ? 844 : 1000 } });
    contexts.add(context);
    const page = await openPage(context, baseUrl, `?preview=${previewCode}`);
    await check(`${width}px preview layout and content`, async () => {
      assert.equal(await page.locator("body").getAttribute("data-method-access-state"), "preview");
      assert.equal(await page.getByRole("tab").count(), 2);
      assert.match(await page.locator(".lesson-meta").innerText(), /2026\. 10\. 17\. \(토\) · 13:30–15:20/);
      assert.deepEqual((await page.getByRole("tab").allTextContents()).map((value) => value.replace(/\s+/g, " ").trim()), [
        "은영T13:30 · 바렐 + 토닝볼", "민진T14:30 · 리포머 + 폼롤러",
      ]);
      assert.equal(await page.locator("#pane-ey .move-setup").count(), 4);
      assert.deepEqual((await page.locator("#pane-ey .move-setup").allTextContents()).map((value) => value.trim()), Array(4).fill("토닝볼 없이"));
      assert.deepEqual((await page.locator("#pane-ey h4").allTextContents()).map((value) => value.trim()), flatten(source.eunyoung.phases).map((move) => move.title));
      await page.getByRole("tab", { name: /^민진T/ }).click();
      assert.deepEqual((await page.locator("#pane-mj h4").allTextContents()).map((value) => value.trim()), flatten(source.minjin.phases).map((move) => move.title));
      assert.deepEqual(await page.locator("#pane-mj .move-steps p").allTextContents(), flatten(source.minjin.phases).flatMap((move) => move.steps));
      assert.equal(await page.locator("form, input, textarea, [data-rating]").count(), 0);
      return measure(page);
    });
    if ([390, 1280].includes(width)) {
      const file = path.join(outputDir, "screenshots", `${width}-cuecard.png`);
      await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
      report.screenshots.push(path.relative(outputDir, file));
    }
    await context.close(); contexts.delete(context);
  }

  const assignmentContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR" });
  contexts.add(assignmentContext);
  const assignment = await assignmentContext.newPage();
  const assignmentResponse = await assignment.goto(`${baseUrl}${route}assignment/`, { waitUntil: "load" });
  await check("assignment matches StudioMate without attendee names", async () => {
    assert.equal(assignmentResponse.status(), 200);
    const text = await assignment.locator("main").innerText();
    for (const value of ["13:30~14:20", "14:30~15:20", "정은영T", "배민진T", "바렐룸", "리포머룸", "두 세션 모두 수강"]) assert.match(text, new RegExp(value));
    assert.equal(await assignment.locator(".name, .names").count(), 0);
    return measure(assignment);
  });
  const assignmentFile = path.join(outputDir, "screenshots", "390-assignment.png");
  await assignment.screenshot({ path: assignmentFile, fullPage: true, animations: "disabled" });
  report.screenshots.push(path.relative(outputDir, assignmentFile));
  await assignmentContext.close(); contexts.delete(assignmentContext);
} finally {
  for (const context of contexts) await context.close();
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  report.cleanup = { contextsRemaining: contexts.size, browserClosed: browser ? !browser.isConnected() : true, serverClosed: server ? !server.listening : true };
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.every((item) => item.passed) && report.cleanup.browserClosed && report.cleanup.serverClosed;
  fs.writeFileSync(path.join(outputDir, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.checks.filter((item) => item.passed).length}/${report.checks.length} checks passed`);
  if (!report.passed) process.exitCode = 1;
}
