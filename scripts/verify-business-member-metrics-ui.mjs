#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "artifacts/business-member-metrics-ui");
fs.mkdirSync(output, { recursive: true });
const source = fs.readFileSync(path.join(root, "core/assets/app.js"), "utf8");
const functions = new Map([...source.matchAll(/^function (\w+)\([^]*?^\}/gm)].map((match) => [match[1], match[0]]));
const names = ["qs", "setText", "timestampMs", "formatDate", "normMonth", "formatMonth", "toNumber", "formatCount", "formatManwon", "formatRate", "deltaText", "memberCountDeltaText", "escapeHtml", "normalizeBusinessSnapshot", "latestDailyForMonth", "renderBusinessBars", "renderBusinessRanks", "renderBusinessMonth", "renderBusiness"];
const script = `const state = {};\n${names.map((name) => functions.get(name)).join("\n")}\nglobalThis.metricFixture = (data) => renderBusiness(normalizeBusinessSnapshot(data));`;
const fixture = {
  summary: ["2026-08", "2026-09", "2026-10"].map((월) => ({ 월, 총매출: 20000000, 수업매출: 15000000, 마진률: 40, 출석률: 90 })),
  월별회원지표: ["2026-08", "2026-09", "2026-10"].map((월) => ({ 월, 수강권보유회원수: 100, 예약이용회원수: 150, 출석회원수: 140, 수강권원천: "source/월별 유효회원" })),
  updatedAt: "2026-10-08T00:00:00Z", memberMetricsUpdatedAt: "2026-10-08T01:00:00Z",
};
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    try {
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== "core-fixture.invalid") return route.abort();
        if (/app\.js|firebase-config\.js/.test(url.pathname)) return route.fulfill({ contentType: "application/javascript", body: "" });
        const relative = decodeURIComponent(url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname);
        const file = path.resolve(root, `core${relative}`);
        if (!file.startsWith(`${root}/core/`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: "" });
        const contentType = file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
        return route.fulfill({ contentType, body: fs.readFileSync(file) });
      });
      const page = await context.newPage();
      await page.goto("https://core-fixture.invalid/business/", { waitUntil: "load" });
      await page.addScriptTag({ content: script });
      for (const missing of [false, true]) {
        const data = structuredClone(fixture);
        if (missing) data.월별회원지표.pop();
        await page.evaluate((value) => globalThis.metricFixture(value), data);
        await page.getByText(missing ? "회원 집계 필요" : "연결됨", { exact: true }).waitFor();
        assert.equal(await page.getByText("집계 필요", { exact: true }).count(), missing ? 3 : 0);
        const geometry = await page.evaluate(() => {
          const cards = ["businessTicketMembers", "businessBookingMembers", "businessAttendedMembers"].map((id) => document.getElementById(id));
          return {
            viewport: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            clipped: cards.some((card) => card.scrollWidth > card.clientWidth + 1),
          };
        });
        assert.ok(geometry.scrollWidth <= geometry.viewport + 1, `page overflow at ${width}`);
        assert.equal(geometry.clipped, false, `metric text clipped at ${width}`);
        const screenshot = path.join(output, `${width}-${missing ? "missing" : "complete"}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        checks.push({ width, missing, screenshot, ...geometry });
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ ok: true, syntheticOnly: true, noProductionRequests: true, checks }, null, 2));
