import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  TEAM_EVENT, TEAM_CALENDAR_DIR, buildTeamCalendar, foldIcsLine, icsEscape,
  renderTeamCalendarHtml, renderTeamCalendarIcs,
} from "../build-team-261121-calendar.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const unfold = text => text.replace(/\r\n[ \t]/g, "");
const stamp = "20261029T000000Z";

test("immutable Team schedule contains only the independently supplied November 21 lectures", () => {
  assert.equal(TEAM_EVENT.title, "ARCHIVE PILATES Team 강사레슨 · ARCHIVE METHOD #9 외부 피드백2");
  assert.equal(TEAM_EVENT.composition, "은영쌤 리포머 + 블럭\n민진쌤 바렐 + 스틱");
  assert.equal(new Date(`${TEAM_EVENT.date}T00:00:00Z`).getUTCDay(), 6);
  assert.deepEqual(TEAM_EVENT.sessions.map(s => [s.lectureId, s.start, s.end, s.room]), [
    ["98585018", "13:30", "14:20", "리포머"], ["98585168", "14:30", "15:20", "바렐"],
  ]);
  assert.equal(Object.isFrozen(TEAM_EVENT), true);
  assert.equal(Object.isFrozen(TEAM_EVENT.sessions[0]), true);
});

test("ICS is one combined UTC event with stable Team UID and public URL", () => {
  const text = unfold(renderTeamCalendarIcs(stamp));
  assert.equal(text.split("BEGIN:VEVENT").length - 1, 1);
  for (const line of ["UID:team-261121@archivepilates.com", `DTSTAMP:${stamp}`,
    "DTSTART:20261121T043000Z", "DTEND:20261121T062000Z", `SUMMARY:${TEAM_EVENT.title}`,
    "LOCATION:ARCHIVE PILATES 명지", `URL:${TEAM_EVENT.url}`,
    "DESCRIPTION:은영쌤 리포머 + 블럭\\n민진쌤 바렐 + 스틱"]) assert.ok(text.includes(`${line}\r\n`), line);
  assert.equal(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"), true);
  assert.equal(text.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"), true);
});

test("RFC 5545 folding preserves UTF-8 characters and limits every physical line to 75 octets", () => {
  for (const text of [renderTeamCalendarIcs(stamp), `${foldIcsLine(`DESCRIPTION:${"한글é".repeat(100)}`)}\r\n`]) {
    const encoded = Buffer.from(text, "utf8");
    assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(encoded), text);
    assert.equal(text.replaceAll("\r\n", "").includes("\n"), false);
    assert.ok(text.split("\r\n").every(line => Buffer.byteLength(line, "utf8") <= 75));
  }
  const logical = `DESCRIPTION:${"한글é".repeat(100)}`;
  assert.equal(unfold(foldIcsLine(logical)), logical);
  assert.ok(foldIcsLine(logical).includes("\r\n "));
});

test("ICS escapes delimiters and newlines without changing the calendar title", () => {
  assert.equal(icsEscape("a,b;c\\d\r\ne\rf\ng"), "a\\,b\\;c\\\\d\\ne\\nf\\ng");
  assert.throws(() => renderTeamCalendarIcs("invalid"));
});

test("HTML is self-contained, uses official root logo and contains no unrelated November offering", () => {
  const html = renderTeamCalendarHtml();
  assert.match(html, /<html lang="ko"/);
  assert.match(html, /src="\/logo120\.png"/);
  assert.match(html, /<table>/);
  assert.match(html, /2026년 11월 21일\(토\) · 13:30~15:20/);
  assert.match(html, /href="\.\/archive-method-261121\.ics"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/in\.archivepilates\.com\/method\/team-261121\/calendar\/">/);
  assert.doesNotMatch(html, /<script|rel="stylesheet"|@import|#10|11월 28일|notion-261128|외부 피드백3/);
  assert.match(html, /data-lecture-id="98585018"/);
  assert.match(html, /data-lecture-id="98585168"/);
});

test("Google calendar link has identical title, UTC bounds, composition, venue and timezone", () => {
  const html = renderTeamCalendarHtml();
  const url = new URL(html.match(/href="(https:\/\/calendar\.google\.com[^\"]+)"/)[1].replaceAll("&amp;", "&"));
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), TEAM_EVENT.title);
  assert.equal(url.searchParams.get("dates"), "20261121T043000Z/20261121T062000Z");
  assert.equal(url.searchParams.get("details"), TEAM_EVENT.composition);
  assert.equal(url.searchParams.get("location"), TEAM_EVENT.location);
  assert.equal(url.searchParams.get("ctz"), "Asia/Seoul");
});

test("saved HTML and ICS agree with the static builder without writing during tests", async () => {
  await buildTeamCalendar({ check: true });
  assert.equal(await readFile(path.join(TEAM_CALENDAR_DIR, "index.html"), "utf8"), renderTeamCalendarHtml());
});

for (const width of [320, 390, 768, 1440]) test(`offline responsive calendar, logo, keyboard and ICS download at ${width}px`, async () => {
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  let browser, context;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      let file, contentType;
      if (url.pathname === "/logo120.png") { file = path.join(ROOT, "archivein/logo120.png"); contentType = "image/png"; }
      else if (url.pathname === "/method/team-261121/calendar/") { file = path.join(TEAM_CALENDAR_DIR, "index.html"); contentType = "text/html; charset=utf-8"; }
      else if (url.pathname === `/method/team-261121/calendar/${TEAM_EVENT.icsName}`) {
        file = path.join(TEAM_CALENDAR_DIR, TEAM_EVENT.icsName); contentType = "text/calendar; charset=utf-8";
      } else { response.writeHead(404).end(); return; }
      response.writeHead(200, { "Content-Type": contentType });
      response.end(await readFile(file));
    } catch { response.writeHead(500).end(); }
  });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const externalRequests = [], errors = [];
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalRequests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/method/team-261121/calendar/`, { waitUntil: "networkidle" });
    const metrics = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const logo = document.querySelector(".brand img");
      const cells = [...document.querySelectorAll("tbody tr:nth-child(3) td")];
      return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        logoLoaded: logo.complete && logo.naturalWidth > 0, header: rect("header"), layout: rect(".layout"),
        save: rect(".save"), calendar: rect("table"), schedule: rect(".schedule"),
        day21Column: cells.findIndex(cell => cell.classList.contains("event-day")),
        sessionText: [...document.querySelectorAll(".sessions li")].map(row => row.innerText),
        targets: [...document.querySelectorAll(".actions a")].map(a => ({ height: a.getBoundingClientRect().height,
          clipped: a.scrollWidth > a.clientWidth, text: a.innerText })),
        overflowing: [...document.querySelectorAll("main *")].filter(el => {
          const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
        }).map(el => el.tagName),
      };
    });
    assert.equal(metrics.scrollWidth, width);
    assert.equal(metrics.logoLoaded, true);
    assert.equal(metrics.day21Column, 6);
    assert.ok(metrics.layout.y >= metrics.header.bottom);
    assert.ok(metrics.save.y >= metrics.layout.bottom);
    assert.deepEqual(metrics.overflowing, []);
    assert.ok(metrics.targets.every(target => target.height >= 44 && !target.clipped));
    assert.match(metrics.sessionText[0], /13:30[\s\S]*14:20[\s\S]*은영쌤[\s\S]*리포머 \+ 블럭/);
    assert.match(metrics.sessionText[1], /14:30[\s\S]*15:20[\s\S]*민진쌤[\s\S]*바렐 \+ 스틱/);
    if (width >= 700) assert.ok(metrics.schedule.x >= metrics.calendar.right);
    else assert.ok(metrics.schedule.y >= metrics.calendar.bottom);
    await page.keyboard.press("Tab");
    const focus = await page.locator("a.primary").evaluate(el => ({ focused: document.activeElement === el,
      outlineStyle: getComputedStyle(el).outlineStyle, outlineWidth: getComputedStyle(el).outlineWidth }));
    assert.equal(focus.focused, true);
    assert.equal(focus.outlineStyle, "solid");
    assert.equal(focus.outlineWidth, "3px");
    const artifactDir = path.join(ROOT, "artifacts/team-261121-calendar");
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, `${width}.png`), fullPage: true });
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("a.primary").click()]);
    assert.equal(download.suggestedFilename(), TEAM_EVENT.icsName);
    assert.equal(await download.failure(), null);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    assert.match(unfold(Buffer.concat(chunks).toString("utf8")), /DTSTART:20261121T043000Z/);
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(errors, []);
  } finally {
    try { await context?.close(); } finally {
      try {
        await browser?.close();
        if (browser) assert.equal(browser.isConnected(), false);
      } finally {
        if (server.listening) await new Promise(resolve => server.close(resolve));
        assert.equal(server.listening, false);
      }
    }
  }
});
