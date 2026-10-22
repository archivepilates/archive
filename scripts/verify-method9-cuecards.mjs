#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, webkit } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(fs.readFileSync(path.join(root, "docs/tasks/2026-10-22-method9-content.json"), "utf8"));
const revision = createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0, 16);
const liveBase = process.env.METHOD9_BASE_URL?.replace(/\/$/, "");
const output = path.join(root, "artifacts/method9-2610");
const report = { checks: [], screenshots: [], cleanup: {} };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(root, `.${pathname}`, pathname.endsWith("/") ? "index.html" : "");
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
  const type = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png" }[path.extname(file)] || "application/octet-stream";
  response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }).end(fs.readFileSync(file));
});
const browsers = [];
const contexts = new Set();
fs.mkdirSync(output, { recursive: true });
async function check(name, action) {
  try { const evidence = await action(); report.checks.push({ name, passed: true, evidence }); }
  catch (error) { report.checks.push({ name, passed: false, error: String(error.stack || error) }); throw error; }
}
async function contextFor(browser, width, date) {
  const context = await browser.newContext({ timezoneId: "Asia/Seoul", viewport: { width, height: width < 700 ? 844 : 1000 } });
  contexts.add(context);
  if (date) await context.addInitScript((value) => { Date.now = () => new Date(value).getTime(); }, date);
  return context;
}
async function close(context) { await context.close(); contexts.delete(context); }
async function layout(page) {
  const metrics = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const visible = [...document.querySelectorAll("body *")].filter((item) => item.checkVisibility());
    return { width, scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      outside: visible.filter((item) => { const rect = item.getBoundingClientRect(); return rect.width && (rect.left < -1 || rect.right > width + 1); }).map((item) => item.tagName),
      controls: [...document.querySelectorAll('[role="tab"], .join-button, summary')].filter((item) => item.checkVisibility()).map((item) => { const rect = item.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }),
      logo: [...document.images].every((item) => item.complete && item.naturalWidth > 0) };
  });
  assert.ok(metrics.scrollWidth <= metrics.width + 1, JSON.stringify(metrics));
  assert.deepEqual(metrics.outside, []);
  assert.ok(metrics.logo);
  assert.ok(metrics.controls.every((item) => item.width >= 44 && item.height >= 44));
  return metrics;
}
async function content(page) {
  assert.equal(await page.evaluate(() => document.querySelector('meta[name="method-content-revision"]').content), revision);
  const rendered = await page.evaluate(() => [...document.querySelectorAll('[role="tabpanel"]')].map((pane) => ({
    id: pane.dataset.methodPane,
    moves: [...pane.querySelectorAll("h4")].map((item) => item.textContent),
    steps: [...pane.querySelectorAll(".move-steps p")].map((item) => item.textContent),
    setups: [...pane.querySelectorAll(".move-setup")].map((item) => item.textContent)
  })));
  for (const teacher of source.instructors) {
    const actual = rendered.find((item) => item.id === teacher.id);
    const moves = teacher.phases.flatMap((phase) => phase.moves);
    assert.deepEqual(actual.moves, moves.map((item) => item.title));
    assert.deepEqual(actual.steps, moves.flatMap((item) => item.steps));
    assert.deepEqual(actual.setups, moves.filter((item) => item.setup).map((item) => item.setup));
  }
  const structure = await page.evaluate(() => ({ titles: [...document.querySelectorAll("section h2")].map((item) => item.textContent), forms: document.querySelectorAll("form, input, textarea, [data-rating]").length }));
  assert.equal(structure.titles[0], "수업 시퀀스");
  for (const removed of ["30초 요약", "티칭 큐", "피드백 질문", "근거가 말하는 범위"]) assert.ok(!structure.titles.includes(removed));
  assert.equal(structure.forms, 0);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".flow-step b")].map((item) => item.textContent)), ["느끼기", "조절하기", "줄이기", "다시 하기"]);
  assert.ok(await page.evaluate(() => document.body.textContent.includes("#8의 ‘도구로 느끼고, 스스로 조절합니다’를 이어갑니다.")));
  await page.getByRole("tab", { name: /^은영T/ }).click();
  assert.equal(await page.getByRole("tab", { name: /^은영T/ }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: /^은영T/ }).press("ArrowLeft");
  assert.equal(await page.getByRole("tab", { name: /^민진T/ }).getAttribute("aria-selected"), "true");
  return { moveCounts: rendered.map((item) => item.moves.length), stepCounts: rendered.map((item) => item.steps.length) };
}

try {
  if (!liveBase) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = liveBase || `http://127.0.0.1:${server.address().port}`;
  const methodRoot = liveBase ? `${base}/method` : `${base}/archivein/method`;
  await check("generated files share the canonical content revision", async () => {
    const paths = ["docs/reports/2026-10-22-method9-cuecard.html", "archivein/method/external-feedback-2610-preview/index.html", ...source.dates.map((item) => `archivein/method/${item.code}/index.html`)];
    for (const file of paths) assert.ok(fs.readFileSync(path.join(root, file), "utf8").includes(`name="method-content-revision" content="${revision}"`), file);
    assert.equal(fs.readFileSync(path.join(root, paths[0]), "utf8"), fs.readFileSync(path.join(root, paths[1]), "utf8"));
    return { paths, revision };
  });
  for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await engine.launch({ headless: true }); browsers.push(browser);
    for (const lesson of source.dates) {
      const route = `${methodRoot}/${lesson.code}/`;
      for (const [time, expected] of [["11:59:59", "locked"], ["12:00:00", "open"]]) {
        const context = await contextFor(browser, 390, `${lesson.date}T${time}+09:00`);
        const page = await context.newPage();
        await page.goto(route, { waitUntil: "load" });
        await check(`${engineName} ${lesson.date} ${time}`, async () => {
          const state = await page.evaluate(() => ({ state: document.body.dataset.methodAccessState, visible: document.querySelector("[data-method-content]").checkVisibility(), message: document.querySelector("[data-method-gate-message]").textContent }));
          assert.equal(state.state, expected); assert.equal(state.visible, expected === "open");
          assert.equal(state.message, "수업자료는 수업 당일 12시에 공개됩니다."); return state;
        });
        if (expected === "locked") await check(`${engineName} ${lesson.date} resume at noon`, async () => {
          await page.evaluate((date) => { Date.now = () => new Date(`${date}T12:00:00+09:00`).getTime(); window.dispatchEvent(new Event("pageshow")); }, lesson.date);
          assert.equal(await page.evaluate(() => document.body.dataset.methodAccessState), "open");
        });
        await close(context);
      }
      for (const width of [320, 390, 768, 1280]) {
        const context = await contextFor(browser, width, `${lesson.date}T11:00:00+09:00`);
        const page = await context.newPage(); const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        const response = await page.goto(`${route}?preview=${lesson.preview}`, { waitUntil: "load" });
        await check(`${engineName} ${lesson.date} ${width}px preview`, async () => {
          assert.equal(response.status(), 200);
          assert.equal(await page.evaluate(() => document.body.dataset.methodAccessState), "preview");
          const result = await content(page);
          await layout(page);
          await page.getByRole("tab", { name: /^은영T/ }).click();
          await layout(page);
          await page.getByTestId("references-toggle").click();
          await layout(page);
          assert.deepEqual(errors, []); return result;
        });
        if (engineName === "chromium" && lesson === source.dates[0] && [390, 1280].includes(width)) {
          const file = path.join(output, `${width}-cuecard.png`); await page.screenshot({ path: file, fullPage: true, animations: "disabled" }); report.screenshots.push(file);
          await page.getByRole("tab", { name: /^민진T/ }).click();
          const mj = path.join(output, `${width}-minjin.png`); await page.screenshot({ path: mj, fullPage: true, animations: "disabled" }); report.screenshots.push(mj);
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
          await page.screenshot({ path: path.join(output, `${width}-top.png`), animations: "disabled" });
        }
        await close(context);
      }
    }
    for (const width of [320, 390, 768, 1280]) {
      const context = await contextFor(browser, width);
      const page = await context.newPage();
      const response = await page.goto(`${methodRoot}/external-feedback-2610-preview/`, { waitUntil: "load" });
      await check(`${engineName} ${width}px hosted staff preview`, async () => {
        assert.equal(response.status(), 200);
        await content(page);
        const state = await page.evaluate(() => ({ access: document.body.dataset.methodAccessState, robots: document.querySelector('meta[name="robots"]').content }));
        assert.equal(state.access, "preview"); assert.match(state.robots, /noindex/);
        return { state, metrics: await layout(page) };
      });
      await close(context);
    }
    const context = await contextFor(browser, 390);
    const page = await context.newPage();
    await page.goto(`file://${root}/docs/reports/2026-10-22-method9-cuecard.html`, { waitUntil: "load" });
    await check(`${engineName} offline standalone preview`, async () => { await content(page); return layout(page); });
    await close(context);
  }
} finally {
  for (const context of contexts) await context.close();
  contexts.clear();
  for (const browser of browsers) await browser.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  report.cleanup = { contextsRemaining: contexts.size, browsersClosed: browsers.every((browser) => !browser.isConnected()), serverClosed: !server.listening };
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, liveBase ? "live-verification.json" : "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.checks.filter((item) => item.passed).length}/${report.checks.length} checks passed; ${JSON.stringify(report.cleanup)}`);
}
