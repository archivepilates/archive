import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TEAM_IDS, assertTeamRegistration } from "../lib/team-261120-scope.mjs";
import { TEAM_EVENT } from "../build-team-261120-calendar.mjs";

const root = fileURLToPath(new URL("../../archivein/", import.meta.url));
const route = "/method/team-261120/assignment/";
const html = fs.readFileSync(path.join(root, route, "index.html"), "utf8");
const expectedNames = ["박하나", "양세정", "이민솔", "이효진", "최예린", "하언진"];
const privatePath = process.env.TEAM261120_PRIVATE_SOURCE;
const screenshotDirectory = "/tmp/team-261120-assignment-qa";
const hash = value => createHash("sha256").update(value).digest("hex");
const normalizePhone = value => String(value || "").replace(/\D/g, "").replace(/^82/, "0");
const displayName = value => String(value || "").replace(/\d+\s*$/, "").trim();
const timestamp = value => new Date(value._seconds * 1000 + value._nanoseconds / 1e6).toISOString();
const sessionTime = (session, field) => new Date(`${TEAM_EVENT.date}T${session[field]}:00+09:00`).toISOString();

test("assignment metadata contains the approved date, topic, time and instructor order", () => {
  assert.match(html, /<title>11\/20 Team 수업배정 안내 \| ARCHIVE PILATES<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive">/);
  assert.match(html, /data-lesson-date="2026-11-20"/);
  assert.match(html, /datetime="2026-11-20">2026\. 11\. 20\. 금요일/);
  assert.match(html, /ARCHIVE METHOD #1 · TEAM/);
  assert.match(html, /<h1>직장인 증후군<\/h1>/);
  assert.match(html, /14:00~15:50/);
  assert.match(html, /두 세션 모두 수강/);
  assert.match(html, /전원이 체어 수업 후 바렐 수업/);
  assert.match(html, /1세션 · 14:00~14:50[\s\S]*민진쌤 · 체어[\s\S]*2세션 · 15:00~15:50[\s\S]*은영쌤 · 바렐/);
  assert.match(html, /11월 20일 낮 12시에 공개됩니다/);
  assert.doesNotMatch(html, /2026-02-28|260228|261121|261128|Archive Pilates/);
});

test("public page contains exactly the six approved names and no contacts or internal identifiers", () => {
  const roster = html.match(/<ul class="roster">([\s\S]*?)<\/ul>/)?.[1];
  assert.ok(roster, "Roster list is required");
  const names = [...roster.matchAll(/<li>([^<]+)<\/li>/g)].map(match => match[1]);
  assert.deepEqual(names, expectedNames);
  assert.equal(new Set(names).size, 6);
  assert.match(html, /수강 명단 · 6명/);
  assert.doesNotMatch(html, /(?:\+?82[\s().-]?)?0?1[016789](?:[\s().-]*\d){7,8}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(html, /tel:|mailto:|ilr_|excel_|member(?:Id|Phone)|lectureId|registrationId|canonicalBookingKey|data-(?:member|lecture|registration)-id|firebase|firestore/i);
  for (const id of [...TEAM_IDS, ...TEAM_EVENT.sessions.map(session => session.lectureId)]) {
    assert.ok(!html.includes(id), "The public page must not contain a private source identifier");
  }
  assert.doesNotMatch(html, /<script\b|<form\b|<input\b|<textarea\b/i);
  assert.match(html, /src="\/logo120\.png"[^>]*alt="ARCHIVE PILATES"[^>]*width="48" height="48"/);
  assert.match(html, /href="\/method\/assets\/method-assignment\.css"/);
});

test("private snapshot joins exact TEAM registrations to six profiles and twelve unique target bookings", {
  skip: !privatePath && "Set TEAM261120_PRIVATE_SOURCE to the operator-selected private readback; never copy it into the repository.",
}, t => {
  let source;
  try { source = JSON.parse(fs.readFileSync(privatePath, "utf8")); }
  catch { throw new Error("The selected private snapshot could not be read; no source contents were logged."); }
  assert.equal(source.readOnly, true);
  assert.equal(source.checkedAt, "2026-11-19T08:47:01.697Z");
  assert.equal(source.registrations.length, 6);
  assert.equal(TEAM_IDS.length, 6);
  assert.ok(TEAM_IDS.every(id => source.registrations.filter(row => row.id === id).length === 1), "Exact TEAM registration set required");
  const registrations = TEAM_IDS.map(id => source.registrations.find(row => row.id === id));
  for (const registration of registrations) {
    try { assertTeamRegistration(registration.id, registration); }
    catch { throw new Error("An exact TEAM registration failed its existing canonical guard; details withheld."); }
    assert.equal(registration.status, "completed");
  }
  assert.ok(expectedNames.every(name => registrations.filter(row => row.memberName === name).length === 1), "Approved public names must match exact registrations");
  const phones = registrations.map(row => normalizePhone(row.memberPhone));
  assert.ok(phones.every(phone => /^010\d{8}$/.test(phone)), "All source phones must normalize unambiguously");
  assert.equal(new Set(phones).size, 6);
  assert.equal(source.profiles.length, 6);
  assert.equal(source.lectures.length, 2);
  assert.equal(source.bookings.length, 12);
  const sessions = TEAM_EVENT.sessions;
  assert.ok(source.lectures.every(row => sessions.some(session => String(row.lectureId) === session.lectureId)), "No extra lecture in the bounded snapshot");
  for (const session of sessions) {
    const matches = source.lectures.filter(row => String(row.lectureId) === session.lectureId);
    assert.equal(matches.length, 1);
    const lecture = matches[0];
    assert.equal(lecture.date, TEAM_EVENT.date);
    assert.equal(lecture.staffName, session.staffName);
    assert.equal(lecture.roomName, session.room);
    assert.equal(timestamp(lecture.startAt), sessionTime(session, "start"));
    assert.equal(timestamp(lecture.endAt), sessionTime(session, "end"));
    assert.equal(lecture.bookingCount, 6);
  }
  for (const registration of registrations) {
    const phone = normalizePhone(registration.memberPhone);
    const profiles = source.profiles.filter(row => normalizePhone(row.phone) === phone);
    assert.equal(profiles.length, 1, "One unique profile per normalized registration phone");
    assert.equal(displayName(profiles[0].name), registration.memberName);
    const bookings = source.bookings.filter(row => normalizePhone(row.memberPhone) === phone);
    assert.equal(bookings.length, 2, "Each approved registrant must have exactly two bookings");
    for (const session of sessions) {
      const matches = bookings.filter(row => String(row.lectureId) === session.lectureId);
      assert.equal(matches.length, 1, "Exactly one booking per registrant and intended session");
      const booking = matches[0];
      assert.equal(displayName(booking.memberName), registration.memberName);
      assert.equal(booking.lectureDate, TEAM_EVENT.date);
      assert.equal(booking.staffName, session.staffName);
      assert.equal(booking.appStatus, "reserved");
      assert.equal(booking.sourceStatus, "booked");
      assert.equal(timestamp(booking.lectureStartAt), sessionTime(session, "start"));
      assert.equal(timestamp(booking.lectureEndAt), sessionTime(session, "end"));
    }
  }
  assert.ok(source.bookings.every(row => phones.includes(normalizePhone(row.memberPhone)) && sessions.some(session => session.lectureId === String(row.lectureId))), "No extra person or session in the bounded snapshot");
  for (const field of ["bookingId", "canonicalBookingKey"]) {
    const values = source.bookings.map(row => row[field]);
    assert.ok(values.every(value => typeof value === "string" && value.length > 0), "Source booking identity required");
    assert.equal(new Set(values).size, 12, "Duplicate source booking identities are forbidden");
  }
  // Inspect in memory only, including formatted contact values and downstream identifiers.
  function checkPrivateValues(value, key = "") {
    if (Array.isArray(value)) return value.forEach(item => checkPrivateValues(item, key));
    if (value && typeof value === "object") return Object.entries(value).forEach(([name, item]) => checkPrivateValues(item, name));
    if (typeof value !== "string" || value.length < 6 || !/(?:phone|email|id$|key$)/i.test(key)) return;
    assert.ok(!html.includes(value), "A private contact or internal identifier leaked into the public page");
    if (/phone/i.test(key)) assert.ok(!html.includes(normalizePhone(value)), "A normalized contact leaked into the public page");
  }
  checkPrivateValues(source.registrations);
  checkPrivateValues(source.bookings);
  checkPrivateValues(source.profiles);
  t.diagnostic("17:47 KST saved readback: exact six TEAM registrations, six unique phone/profile joins, two sessions each, twelve unique bookings; no private values logged. This is not a new native read.");
});

test("localhost assignment renders real assets without overflow, errors or nested cards", { timeout: 90000 }, async t => {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const assets = new Map([
    [route, [path.join(root, route, "index.html"), "text/html; charset=utf-8"]],
    ["/method/assets/method-assignment.css", [path.join(root, "method/assets/method-assignment.css"), "text/css"]],
    ["/logo120.png", [path.join(root, "logo120.png"), "image/png"]],
    ["/apple-touch-icon.png", [path.join(root, "apple-touch-icon.png"), "image/png"]],
  ]);
  const server = http.createServer((request, response) => {
    const asset = assets.get(new URL(request.url, "http://localhost").pathname);
    if (!["GET", "HEAD"].includes(request.method) || !asset) return response.writeHead(404).end();
    response.writeHead(200, { "Content-Type": asset[1], "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : fs.readFileSync(asset[0]));
  });
  let browser;
  const contexts = new Set();
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 768, 1440]) {
      await t.test(`${width}px: complete roster, schedule, official logo and unframed sections`, async () => {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: "Asia/Seoul", serviceWorkers: "block" });
        contexts.add(context);
        try {
          const errors = [], loaded = new Map();
          await context.route("**/*", intercepted => {
            const url = new URL(intercepted.request().url());
            if (url.origin === origin && assets.has(url.pathname)) return intercepted.continue();
            errors.push("Unexpected network request blocked");
            return intercepted.abort();
          });
          const page = await context.newPage();
          page.on("pageerror", () => errors.push("Page execution error"));
          page.on("console", message => { if (message.type() === "error") errors.push("Browser console error"); });
          page.on("requestfailed", () => errors.push("Request failed"));
          page.on("response", response => {
            loaded.set(new URL(response.url()).pathname, response);
            if (response.status() >= 400) errors.push("Asset HTTP error");
          });
          const response = await page.goto(origin + route, { waitUntil: "load" });
          assert.equal(response.status(), 200);
          assert.equal(await page.getByRole("heading", { name: "직장인 증후군", exact: true }).isVisible(), true);
          assert.equal(await page.getByRole("heading", { name: "수강 명단 · 6명", exact: true }).isVisible(), true);
          const roster = page.getByRole("region", { name: "수강 명단 · 6명" }).getByRole("listitem");
          assert.deepEqual(await roster.allTextContents(), expectedNames);
          assert.deepEqual(await page.getByRole("heading", { level: 3 }).allTextContents(), ["민진쌤 · 체어", "은영쌤 · 바렐"]);
          assert.equal(await page.getByRole("img", { name: "ARCHIVE PILATES", exact: true }).isVisible(), true);
          const layout = await page.evaluate(() => {
            const frames = [...document.querySelectorAll("main *")].filter(item => {
              const style = getComputedStyle(item);
              return ["Top", "Right", "Bottom", "Left"].every(side => parseFloat(style[`border${side}Width`]) > 0);
            });
            const walker = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
            let node, outsideText = 0, clippedText = 0;
            while ((node = walker.nextNode())) {
              if (!node.textContent.trim()) continue;
              const range = document.createRange(); range.selectNodeContents(node);
              for (const rect of range.getClientRects()) {
                if (rect.left < -1 || rect.right > innerWidth + 1) outsideText++;
                for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                  const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
                  if ((/hidden|clip/.test(style.overflowX) && (rect.left < box.left - 1 || rect.right > box.right + 1)) || (/hidden|clip/.test(style.overflowY) && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1))) clippedText++;
                }
              }
            }
            const image = document.querySelector("img.brand");
            const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const painter = canvas.getContext("2d"); painter.drawImage(image, 0, 0);
            const pixels = painter.getImageData(0, 0, canvas.width, canvas.height).data;
            let redPixels = 0;
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 150 && pixels[i + 1] < 100 && pixels[i + 2] < 100 && pixels[i + 3] > 150) redPixels++;
            return {
              width: innerWidth, scrollWidth: document.documentElement.scrollWidth, outsideText, clippedText,
              frames: frames.length, onlySessionFrames: frames.every(item => item.matches("article.time-block")),
              nestedFrames: frames.some(item => frames.some(parent => parent !== item && parent.contains(item))),
              roomColumns: [...document.querySelectorAll(".room-grid")].map(item => getComputedStyle(item).gridTemplateColumns.split(" ").length),
              imageLoaded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
              imageSize: { width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height }, redPixels,
              times: [...document.querySelectorAll(".time-label")].map(item => item.textContent),
            };
          });
          assert.equal(layout.scrollWidth, width);
          assert.equal(layout.outsideText, 0);
          assert.equal(layout.clippedText, 0);
          assert.equal(layout.frames, 2);
          assert.equal(layout.onlySessionFrames, true);
          assert.equal(layout.nestedFrames, false);
          assert.deepEqual(layout.roomColumns, [1, 1]);
          assert.equal(layout.imageLoaded, true);
          assert.deepEqual(layout.imageSize, { width: 48, height: 48 });
          assert.ok(layout.redPixels > 100, "Official red symbol must render nonblank pixels");
          assert.deepEqual(layout.times, ["1세션 · 14:00~14:50", "2세션 · 15:00~15:50"]);
          for (const assetPath of ["/logo120.png", "/method/assets/method-assignment.css"]) {
            assert.ok(loaded.has(assetPath), "An absolute-path asset was not requested");
            assert.equal(hash(await loaded.get(assetPath).body()), hash(fs.readFileSync(assets.get(assetPath)[0])), "The browser must receive the real local asset, not a stub");
          }
          assert.deepEqual(errors, []);
          await page.screenshot({ path: path.join(screenshotDirectory, `${width}.png`), fullPage: true, animations: "disabled" });
        } finally {
          await context.close();
          contexts.delete(context);
        }
      });
    }
  } finally {
    for (const context of contexts) await context.close();
    contexts.clear();
    if (browser) await browser.close();
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(contexts.size, 0);
    assert.equal(browser?.isConnected() || false, false);
    assert.equal(server.listening, false);
    t.diagnostic("All task-owned browser contexts, browser and ephemeral localhost server closed; screenshots only in /tmp/team-261120-assignment-qa.");
  }
});
