import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../", import.meta.url));
const material = path.join(root, "archivein/method/team-261120/index.html");
const html = fs.readFileSync(material, "utf8");
const source = fs.readFileSync(path.join(root, "archivein/method/office-worker-syndrome-260228/index.html"), "utf8");
const access = fs.readFileSync(path.join(root, "archivein/method/assets/method-access.js"), "utf8");
const cooldown = '<li><span class="dot sec"></span>4발기기 분절 + 다운독</li>';
const sourceCooldown = '<li><span class="dot sec"></span>Quadruped Articulation</li><li><span class="dot sec"></span>Down Dog</li><li><span class="dot sec"></span>Alignment Reset</li>';
const line = (text, prefix) => {
  const matches = text.split("\n").filter(value => value.startsWith(prefix));
  assert.equal(matches.length, 1, prefix);
  return matches[0];
};

test("November 20 Team metadata has the approved topic, schedule and instructor order", () => {
  assert.match(html, /<title>ARCHIVE METHOD #1 직장인 증후군 Team \| 2026-11-20 \| ARCHIVE PILATES<\/title>/);
  assert.match(html, /<body data-method-date="2026-11-20" data-method-preview-code="team261120staff" class="method-locked">/);
  const header = line(html, "<header>");
  assert.match(header, /ARCHIVE METHOD #1 · Team/);
  assert.match(header, /<h1 class="hdr-title">직장인 증후군<\/h1>/);
  assert.match(header, /민진 Chair · 은영 Barrel/);
  assert.match(header, /datetime="2026-11-20">2026-11-20 \(금\)/);
  assert.match(header, /14:00~15:50/);
  assert.match(line(html, "<hr><footer>"), /ARCHIVE PILATES.*ARCHIVE METHOD #1 · Team.*2026-11-20 · 14:00~15:50/);
  assert.doesNotMatch(html, /2026-02-28|260228|2602|261121|261128|Archive Method|Archive Pilates/);
});

test("source theory and sequences are unchanged except the confirmed Barrel cooldown", () => {
  for (const prefix of ['<div class="dir-grid', '<div class="mv rev', '<div class="apply rev', '<div id="tab-mj"']) {
    assert.equal(line(html, prefix), line(source, prefix), prefix);
  }
  assert.equal(line(html, '<div id="tab-ey"'), line(source, '<div id="tab-ey"').replace(sourceCooldown, cooldown));
  assert.ok(html.indexOf('class="seq rev"') < html.indexOf('class="mv rev"'));
  assert.equal(html.split(cooldown).length - 1, 1);
  assert.doesNotMatch(html, /Alignment\s*Reset/i);
  assert.equal(line(html, '<div class="survey rev"'), line(source, '<div class="survey rev"').replace("Archive Method Feedback", "ARCHIVE METHOD Feedback"));
});

test("the page reuses the shared fail-closed access assets without an inline bypass", () => {
  assert.match(html, /<link rel="stylesheet" href="\.\.\/assets\/method-access\.css">/);
  assert.match(html, /<script src="\.\.\/assets\/method-access\.js"><\/script>/);
  assert.match(html, /data-method-gate aria-live="polite"/);
  assert.match(html, /data-method-gate-message>수업자료는 수업 당일 12시에 공개됩니다\./);
  assert.match(html, /class="method-content" data-method-content/);
  assert.equal((html.match(/data-method-date=/g) || []).length, 1);
  assert.doesNotMatch(html, /Date\.now|new Date|localStorage|sessionStorage/);
});

function accessFixture(now, search = "") {
  const classes = new Set(["method-locked"]);
  const gate = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, querySelector() { return message; } };
  const content = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const message = {};
  const events = {};
  let timer;
  const body = {
    dataset: {
      methodDate: html.match(/data-method-date="([^"]+)"/)[1],
      methodPreviewCode: html.match(/data-method-preview-code="([^"]+)"/)[1],
    },
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
  };
  class ClockDate extends Date { static now() { return now; } }
  const document = {
    body, visibilityState: "visible",
    querySelector(selector) { return selector === "[data-method-gate]" ? gate : content; },
    addEventListener(name, callback) { events[name] = callback; },
  };
  const window = {
    location: { search },
    clearTimeout() { timer = undefined; },
    setTimeout(callback, delay) { timer = { callback, delay }; return 1; },
    addEventListener(name, callback) { events[name] = callback; },
  };
  vm.runInNewContext(access, { document, window, Date: ClockDate, URLSearchParams, console });
  return { body, gate, content, message, classes, events, get timer() { return timer; }, setNow(value) { now = value; } };
}

test("shared gate opens at November 20 noon KST, not February or the lesson start time", () => {
  const opening = Date.parse("2026-11-20T12:00:00+09:00");
  for (const now of [Date.parse("2026-02-28T12:00:00+09:00"), Date.parse("2026-11-19T14:00:00+09:00"), opening - 1]) {
    const f = accessFixture(now);
    assert.equal(f.body.dataset.methodAccessState, "locked");
    assert.equal(f.content.attributes["aria-hidden"], "true");
    assert.equal(f.gate.attributes["aria-hidden"], "false");
    assert.ok(f.classes.has("method-locked"));
  }
  for (const now of [opening, opening + 1, Date.parse("2026-11-20T14:00:00+09:00")]) {
    const f = accessFixture(now);
    assert.equal(f.body.dataset.methodAccessState, "open");
    assert.equal(f.content.attributes["aria-hidden"], "false");
    assert.equal(f.gate.attributes["aria-hidden"], "true");
    assert.equal(f.classes.has("method-locked"), false);
    assert.equal(f.timer, undefined);
  }
  const f = accessFixture(opening - 1);
  assert.equal(f.timer.delay, 51);
  f.setNow(opening);
  f.timer.callback();
  assert.equal(f.body.dataset.methodAccessState, "open");
  assert.equal(f.timer, undefined);
  for (const event of ["pageshow", "focus", "visibilitychange"]) {
    f.setNow(opening - 1);
    f.events[event]();
    assert.equal(f.body.dataset.methodAccessState, "locked");
    f.setNow(opening);
    f.events[event]();
    assert.equal(f.body.dataset.methodAccessState, "open");
  }
});

test("only the exact staff preview code opens the new page before noon", () => {
  const now = Date.parse("2026-11-19T14:00:00+09:00");
  for (const query of ["", "?preview=", "?preview=wrong", "?preview=TEAM261120STAFF", "?preview=team261121staff"]) {
    assert.equal(accessFixture(now, query).body.dataset.methodAccessState, "locked", query);
  }
  const f = accessFixture(now, "?preview=team261120staff");
  assert.equal(f.body.dataset.methodAccessState, "preview");
  assert.equal(f.classes.has("method-locked"), false);
  assert.equal(f.timer, undefined);
});

test("local browser renders both instructor tabs and responsive content with the shared lock", { timeout: 90000 }, async t => {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch({ headless: true });
  const contexts = new Set();
  const url = new URL(`file://${material}`);
  const screenshots = process.env.TEAM261120_SCREENSHOTS;
  if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
  async function contextFor(width, time, javaScriptEnabled = true) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Seoul", javaScriptEnabled, reducedMotion: "reduce" });
    contexts.add(context);
    // Keep this local material check independent of external font/icon availability.
    await context.route(/^https?:\/\//, route => route.fulfill({ status: 200, body: "" }));
    if (javaScriptEnabled) await context.addInitScript(value => { Date.now = () => value; }, Date.parse(time));
    return context;
  }
  async function close(context) { await context.close(); contexts.delete(context); }
  try {
    for (const [time, query, expected] of [
      ["2026-11-20T11:59:59.999+09:00", "", "locked"],
      ["2026-11-20T12:00:00+09:00", "", "open"],
      ["2026-11-19T14:00:00+09:00", "?preview=wrong", "locked"],
    ]) {
      await t.test(`${time} ${query || "public"}: ${expected}`, async () => {
        const context = await contextFor(390, time);
        const page = await context.newPage();
        await page.goto(url.href + query);
        const state = await page.evaluate(() => ({
          access: document.body.dataset.methodAccessState,
          gate: document.querySelector("[data-method-gate]").checkVisibility(),
          content: document.querySelector("[data-method-content]").checkVisibility(),
        }));
        assert.deepEqual(state, { access: expected, gate: expected === "locked", content: expected === "open" });
        await close(context);
      });
    }
    await t.test("without JavaScript the material stays hidden", async () => {
      const context = await contextFor(390, "2026-11-19T14:00:00+09:00", false);
      const page = await context.newPage();
      await page.goto(url.href + "?preview=team261120staff");
      assert.equal(await page.getByRole("button", { name: /^민진T/ }).isVisible(), false);
      assert.equal(await page.getByRole("paragraph").filter({ hasText: "수업자료는 수업 당일 12시에 공개됩니다." }).isVisible(), true);
      await close(context);
    });
    for (const width of [320, 390, 768, 1280]) {
      await t.test(`${width}px: staff preview, Chair then Barrel`, async () => {
        const context = await contextFor(width, "2026-11-19T14:00:00+09:00");
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(url.href + "?preview=team261120staff");
        assert.equal(await page.evaluate(() => document.body.dataset.methodAccessState), "preview");
        assert.equal(await page.getByRole("heading", { name: "직장인 증후군" }).isVisible(), true);
        for (const [name, paneId] of [[/^민진T/, "tab-mj"], [/^은영T/, "tab-ey"], [/^민진T/, "tab-mj"]]) {
          const button = page.getByRole("button", { name });
          await button.click();
          const state = await page.evaluate(() => ({
            panes: [...document.querySelectorAll(".pane.on")].map(pane => pane.id),
            active: document.querySelectorAll(".tab.active").length,
            scrollWidth: document.documentElement.scrollWidth,
            width: document.documentElement.clientWidth,
            buttons: [...document.querySelectorAll(".tab")].map(item => ({ width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })),
            outside: [...document.querySelectorAll(".wrap *")].filter(item => {
              const rect = item.getBoundingClientRect();
              return item.checkVisibility() && rect.width && (rect.left < -1 || rect.right > innerWidth + 1);
            }).map(item => item.className),
          }));
          assert.deepEqual(state.panes, [paneId]);
          assert.equal(state.active, 1);
          assert.ok(state.scrollWidth <= state.width);
          assert.deepEqual(state.outside, []);
          assert.ok(state.buttons.every(size => size.width >= 44 && size.height >= 44));
          await button.focus();
          await button.press("Enter");
          assert.equal(await button.evaluate(item => getComputedStyle(item).outlineStyle), "solid");
          assert.equal(await button.evaluate(item => item === document.activeElement), true);
          if (screenshots) await page.screenshot({ path: path.join(screenshots, `${width}-${paneId}.png`), fullPage: true, animations: "disabled" });
        }
        const content = await page.evaluate(() => ({
          phases: [...document.querySelectorAll(".pane")].map(pane => [...pane.querySelectorAll(".phase")].map(phase => phase.querySelectorAll("li").length)),
          cooldown: [...document.querySelectorAll("#tab-ey .phase:last-child li")].map(item => item.textContent),
          theory: document.querySelector(".mv").textContent,
        }));
        assert.deepEqual(content.phases, [[5, 7, 6, 2], [3, 6, 1]]);
        assert.deepEqual(content.cooldown, ["4발기기 분절 + 다운독"]);
        assert.match(content.theory, /장시간 좌식 생활/);
        assert.deepEqual(errors, []);
        await close(context);
      });
    }
  } finally {
    for (const context of contexts) await context.close();
    contexts.clear();
    await browser.close();
    assert.equal(browser.isConnected(), false);
    t.diagnostic("All task-owned browser contexts and the browser were closed; no persistent profile or server used.");
  }
});
