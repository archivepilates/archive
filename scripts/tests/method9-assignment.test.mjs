import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, webkit } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicRoot = path.join(root, "archivein");
const content = JSON.parse(fs.readFileSync(path.join(root, "docs/tasks/2026-10-22-method9-content.json"), "utf8"));
// Operator's 2026-10-23 canonical lecture read: date field, eight open lectures.
// Oct24 A/B and Oct25 C/D cross teachers; each 50-minute lecture has 10-minute feedback.
const dates = [
  { day: "24", weekday: "토요일", teams: ["A", "B"] },
  { day: "25", weekday: "일요일", teams: ["C", "D"] },
].map((item) => ({ ...item, date: `2026-10-${item.day}`, code: `external-feedback-2610${item.day}` }));
const read = (file) => fs.readFileSync(path.join(publicRoot, file), "utf8");

for (const lesson of dates) {
  test(`${lesson.date} public assignment has the canonical teams, session times and equipment`, () => {
    const html = read(`method/${lesson.code}/assignment/index.html`);
    assert.ok(html.includes(`data-lesson-date="${lesson.date}"`));
    assert.ok(html.includes(`2026. 10. ${lesson.day}. ${lesson.weekday}`));
    assert.ok(html.includes("ARCHIVE METHOD #9"));
    assert.ok(html.includes(content.topic));
    const rooms = [...html.matchAll(/class="room (barrel|reformer)" data-team="([A-D])" data-teacher="(mj|ey)"><h3>(.*?)<\/h3><p class="machine">(.*?)<\/p>/g)];
    const [first, second] = lesson.teams;
    assert.deepEqual(rooms.map((m) => [m[2], m[3]]), [[first, "mj"], [second, "ey"], [second, "mj"], [first, "ey"]]);
    for (const room of rooms) {
      const teacher = content.instructors.find((item) => item.id === room[3]);
      assert.equal(room[4], `${room[2]}팀 · ${teacher.name}`);
      assert.equal(room[5], teacher.apparatus);
      assert.equal(room[1], teacher.id === "mj" ? "barrel" : "reformer");
    }
    const orders = [...html.matchAll(/class="team-route" data-team="([A-D])"><h3>.*?<\/h3><ol><li>(.*?)<\/li><li>(.*?)<\/li>/g)];
    const [mj, ey] = content.instructors.map((teacher) => `${teacher.name} · ${teacher.apparatus}`);
    assert.deepEqual(orders.map((m) => m.slice(1)), [[first, mj, ey], [second, ey, mj]]);
    for (const interval of ["13:00~14:00", "14:10~15:10", "13:00~13:50 실전 수업", "13:50~14:00 시퀀스 피드백", "14:10~15:00 실전 수업", "15:00~15:10 시퀀스 피드백", "14:00~14:10 · 휴식 및 기구 이동"]) assert.ok(html.includes(interval), interval);
    assert.doesNotMatch(html, lesson.day === "25" ? /[AB]팀|data-team="[AB]"/ : /[CD]팀|data-team="[CD]"/);
    assert.doesNotMatch(html, /class="names?"|\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|<script\b|<form\b|<input\b|<iframe\b|firebase|memberId|phone|notion\.so|preview=/i);
    assert.ok(html.includes("개별 안내받은 팀"));
    assert.ok(html.includes("수업 당일 12:00"));
  });

  test(`${lesson.date} assignment local assets and same-date material link exist`, () => {
    const html = read(`method/${lesson.code}/assignment/index.html`);
    const base = new URL(`https://local.invalid/method/${lesson.code}/assignment/`);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const url = new URL(match[1], base);
      assert.equal(url.origin, base.origin, "assignment must not load external assets");
      const file = path.join(publicRoot, url.pathname, url.pathname.endsWith("/") ? "index.html" : "");
      assert.ok(fs.existsSync(file), file);
    }
    assert.ok(html.includes(`href="/method/${lesson.code}/"`));
  });
}

test("date-specific styles remain identical without changing the shared assignment stylesheet", () => {
  assert.equal(read(`method/${dates[0].code}/assignment/assignment.css`), read(`method/${dates[1].code}/assignment/assignment.css`));
});

test("public assignment pages render at mobile, tablet and desktop widths with usable material links", { timeout: 120000 }, async (t) => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const file = path.resolve(publicRoot, `.${url.pathname}`, url.pathname.endsWith("/") ? "index.html" : "");
    if (!file.startsWith(`${publicRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
    const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".png": "image/png", ".js": "text/javascript" }[path.extname(file)];
    response.writeHead(200, { "Content-Type": mime || "application/octet-stream" }).end(fs.readFileSync(file));
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
      const browser = await engine.launch({ headless: true });
      try {
        for (const lesson of dates) for (const width of [320, 390, 768, 1280]) {
          await t.test(`${engineName} ${lesson.date} ${width}px`, async () => {
            const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", timezoneId: "Asia/Seoul" });
            try {
              await context.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
              const page = await context.newPage();
              const errors = [], failedResponses = [];
              page.on("pageerror", (error) => errors.push(String(error)));
              page.on("response", (response) => { if (response.status() >= 400) failedResponses.push(response.url()); });
              const response = await page.goto(`${base}/method/${lesson.code}/assignment/`, { waitUntil: "load" });
              assert.equal(response.status(), 200);
              assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), content.topic);
              for (const team of lesson.teams) assert.equal(await page.getByRole("heading", { name: `${team}팀`, exact: true }).count(), 1);
              const metrics = await page.evaluate(() => {
                const visible = [...document.querySelectorAll("body *")].filter((item) => item.checkVisibility());
                const width = document.documentElement.clientWidth;
                return {
                  width, scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                  overflow: visible.filter((item) => { const r = item.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > width + 1); }).map((item) => item.tagName),
                  clipped: visible.filter((item) => item.clientWidth > 0 && item.scrollWidth > item.clientWidth + 1).map((item) => item.tagName),
                  images: [...document.images].every((item) => item.complete && item.naturalWidth > 0),
                  rooms: document.querySelectorAll(".room").length,
                };
              });
              assert.ok(metrics.scrollWidth <= metrics.width + 1, JSON.stringify(metrics));
              assert.deepEqual(metrics.overflow, []);
              assert.deepEqual(metrics.clipped, []);
              assert.ok(metrics.images);
              assert.equal(metrics.rooms, 4);
              const materialLink = page.getByRole("link", { name: `10월 ${lesson.day}일 수업자료` });
              const bounds = await materialLink.boundingBox();
              assert.ok(bounds.height >= 44 && bounds.width >= 44);
              await page.keyboard.press(engineName === "webkit" ? "Alt+Tab" : "Tab");
              assert.equal(await materialLink.evaluate((link) => link === document.activeElement && getComputedStyle(link).outlineStyle !== "none"), true);
              const screenshot = await page.screenshot({ fullPage: true, animations: "disabled" });
              assert.ok(screenshot.byteLength > 1000);
              await materialLink.click();
              assert.equal(new URL(page.url()).pathname, `/method/${lesson.code}/`);
              assert.deepEqual(errors, []);
              assert.deepEqual(failedResponses, []);
            } finally { await context.close(); }
          });
        }
      } finally { await browser.close(); }
    }
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
