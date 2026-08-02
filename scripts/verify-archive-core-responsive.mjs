#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const coreRoot = path.join(repoRoot, "core");
const requestedBaseUrl = process.env.ARCHIVE_CORE_BASE_URL?.replace(/\/+$/, "");
const outputDir = process.env.ARCHIVE_CORE_QA_DIR || "/tmp/archive-core-responsive";
const viewports = [
  { name: "mobile-320", width: 320, height: 860 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 1000 },
];
const routes = [
  { name: "home", path: "/" },
  { name: "members", path: "/members/" },
  { name: "lessons", path: "/lessons/" },
  { name: "private", path: "/private/" },
  { name: "staff", path: "/staff/" },
  { name: "messages", path: "/messages/" },
  { name: "content", path: "/content/" },
  { name: "automation", path: "/automation/" },
  { name: "business", path: "/business/" },
  { name: "imports", path: "/imports/" },
  { name: "rules", path: "/rules/" },
  { name: "settings", path: "/settings/" },
];

fs.mkdirSync(outputDir, { recursive: true });
const localServer = requestedBaseUrl ? null : await startStaticServer();
const baseUrl = requestedBaseUrl || `http://127.0.0.1:${localServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];
const results = [];

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    for (const route of routes) {
      const url = `${baseUrl}${route.path}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForSelector(".shell", { state: "visible", timeout: 10_000 });
      await page.evaluate(() => {
        document.querySelectorAll(".login-gate").forEach((element) => element.remove());
      });
      if (route.name === "home") {
        await page.evaluate(() => {
          const panel = document.querySelector("#renewalPipeline");
          const list = document.querySelector("#renewalPipelineList");
          if (panel) panel.open = true;
          if (list) {
            list.innerHTML = `
              <article class="status-row renewal-row warning">
                <div>
                  <strong><a class="renewal-member-link" href="#">긴이름재등록테스트회원</a><small>010-1234-5678</small></strong>
                  <p>잔여 3회 · 매우 긴 프라이빗 수강권 이름 · 주 2.5회 · 예상 소진 2026-08-14 · 다음 예약 2026-08-03 · 프라이빗 30회 중심 상담</p>
                  <div class="renewal-actions">
                    <button type="button" data-renewal-action="contacted">연락완료</button><button type="button" data-renewal-action="considering">고민중</button><button type="button" data-renewal-action="snoozed">7일 후</button><button type="button" data-renewal-action="resolved">재등록완료</button><button type="button" data-renewal-action="excluded">재등록 의사 없음</button>
                  </div>
                </div>
                <span class="pill reviewing">확인</span>
              </article>`;
          }
        });
      }
      await page.evaluate(() => document.fonts?.ready);

      const check = await page.evaluate(() => {
        const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const viewportWidth = document.documentElement.clientWidth;
        const metricCards = [...document.querySelectorAll(".kpis > .metric")].slice(0, 4);
        const metricHeights = metricCards.map((element) => Math.round(element.getBoundingClientRect().height));
        const metricContentOverflow = metricCards.some(
          (element) => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1,
        );
        const metricValues = metricCards
          .map((element) => element.querySelector(".metric-value"))
          .filter(Boolean)
          .map((element) => ({
            text: element.textContent?.trim() || "",
            clippedX: element.scrollWidth > element.clientWidth + 1,
            clippedY: element.scrollHeight > element.clientHeight + 1,
          }));
        const touchTargets = [
          ...document.querySelectorAll(
            ".nav a, .nav-more-button, .quick-action, .external-tool-link, .filter-button, .text-link, .reference-toggle, a.rank-row, .rank-link, .primary-action, .secondary-action, .renewal-actions button",
          ),
        ]
          .filter((element) => element.offsetParent !== null)
          .map((element) => Math.round(element.getBoundingClientRect().height));
        const navOutsideViewport = [...document.querySelectorAll(".nav a, .nav-more-button")].some((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > viewportWidth + 1;
        });
        return {
          documentWidth,
          viewportWidth,
          horizontalOverflow: documentWidth > viewportWidth + 1,
          metricHeights,
          metricHeightMismatch:
            metricHeights.length > 1 && Math.max(...metricHeights) - Math.min(...metricHeights) > 2,
          metricContentOverflow,
          metricValues,
          navOutsideViewport,
          shortTouchTarget: touchTargets.some((height) => height < 44),
        };
      });

      const routeFailures = [];
      if (check.horizontalOverflow) routeFailures.push(`horizontal overflow ${check.documentWidth}px > ${check.viewportWidth}px`);
      if (check.metricHeightMismatch) routeFailures.push(`KPI heights differ: ${check.metricHeights.join(", ")}`);
      if (check.metricContentOverflow) routeFailures.push("KPI card content overflows its fixed track");
      if (check.metricValues.some((item) => item.clippedX || item.clippedY)) routeFailures.push("KPI value text is clipped");
      if (check.navOutsideViewport) routeFailures.push("navigation extends outside viewport");
      if (check.shortTouchTarget) routeFailures.push("interactive target below 44px");

      const screenshot = path.join(outputDir, `${route.name}-${viewport.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({ route: route.name, viewport: viewport.name, screenshot, ...check });
      for (const failure of routeFailures) failures.push(`${route.name}/${viewport.name}: ${failure}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  if (localServer) await new Promise((resolve) => localServer.close(resolve));
}

if (failures.length) {
  console.error("ARCHIVE CORE responsive verification failed.");
  console.error(JSON.stringify({ baseUrl, failures, results }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      checked: results.length,
      routes: routes.map((route) => route.name),
      viewports: viewports.map((viewport) => `${viewport.width}x${viewport.height}`),
      outputDir,
    },
    null,
    2,
  ),
);

async function startStaticServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
    const normalized = path.normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
    let filePath = path.join(coreRoot, normalized);
    if (requestPath.endsWith("/")) filePath = path.join(filePath, "index.html");
    if (!filePath.startsWith(coreRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.setHeader("Content-Type", contentType(filePath));
    response.end(fs.readFileSync(filePath));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".json" || extension === ".webmanifest") return "application/json; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}
