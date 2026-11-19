import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../", import.meta.url));
const material = path.join(root, "archivein/method/team-261120/index.html");
const html = fs.readFileSync(material, "utf8");
const access = fs.readFileSync(path.join(root, "archivein/method/assets/method-access.js"), "utf8");
const title = "ARCHIVE METHOD #1 직장인 증후군 Team | 2026-11-20 | ARCHIVE PILATES";
const signupUrl = "https://archivepilates.imweb.me/?mode=join&back_url=LzQ4";
const instructors = [
  { name: /^민진T.*(?:Chair|체어)/i, pane: "pane-mj" },
  { name: /^은영T.*(?:Barrel|바렐)/i, pane: "pane-ey" },
];
const expectedNotionSequence = {
  "pane-mj": [
    { phase: "Warm-up", moves: [
      ["Mermaid with Arm Circle"],
      ["Seated Single-Leg Press"],
    ] },
    { phase: "Main", moves: [
      ["Half-Kneeling Roll Down"],
      ["Quadruped Leg Reach → Single-Leg Lower & Lift"],
      ["Side Kick Variation"],
      ["Teaser"],
      ["Lunge → Leg Pull Front"],
      ["Rolling Like a Ball with Pedal Press"],
      ["Frog Bridge"],
    ] },
    { phase: "Cool-down", moves: [
      ["Leg Pull Back"],
      ["Wrist Release"],
      ["Child's Pose with Back Breathing"],
    ] },
  ],
  "pane-ey": [
    { phase: "Warm-up", moves: [
      ["Spine Articulation"],
      ["Tricep Series", "Jump", "Tricep Press"],
      ["Leg Pull Back"],
      ["Hip Rolls"],
      ["Shoulder Bridge"],
    ] },
    { phase: "Main", moves: [
      ["Crab Reach"],
      ["Roll Back × 5"],
      ["Single Leg Stretch"],
      ["Hundred"],
      ["Prone", "Arm", "Swimming"],
    ] },
    { phase: "Cool-down", moves: [
      ["Side Lying", "Open", "Circles"],
    ] },
  ],
};

test("the page reuses the shared fail-closed access assets without an inline bypass", () => {
  assert.match(html, /<link rel="stylesheet" href="\.\.\/assets\/method-access\.css">/);
  assert.match(html, /<script src="\.\.\/assets\/method-access\.js"><\/script>/);
  assert.match(html, /<script src="\.\.\/assets\/support-movement-card\.js"><\/script>/);
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
  const url = pathToFileURL(material);
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
    await t.test("approved headline, exact November 20 Notion sequences and conditional video signup", async () => {
      const context = await contextFor(390, "2026-11-20T12:00:00+09:00");
      const page = await context.newPage();
      await page.goto(url.href);
      assert.equal(await page.title(), title);
      const headline = page.getByRole("heading", { level: 1, name: "직장인 증후군", exact: true });
      assert.equal(await headline.isVisible(), true);
      const headerText = await headline.evaluate(heading => heading.closest("header").textContent);
      assert.match(headerText, /ARCHIVE METHOD #1\s*·\s*Team/);
      assert.match(headerText, /2026\s*[.\/-]\s*11\s*[.\/-]\s*20/);
      assert.match(headerText, /14:00\s*[~–-]\s*15:50/);
      const tabs = await page.getByRole("tablist").getByRole("tab").allTextContents();
      assert.equal(tabs.length, instructors.length);
      tabs.forEach((tab, index) => assert.match(tab.replace(/\s+/g, " "), instructors[index].name));

      const materialState = await page.evaluate(panes => {
        const normalize = text => text.normalize("NFC").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
        const readPhases = pane => Array.from(pane.querySelectorAll(".phase-card"), phase => ({
          phase: normalize(phase.querySelector(".phase-title > h3").textContent),
          moves: Array.from(phase.querySelectorAll(".move-list > li"), item => [
            normalize(item.querySelector(".move-name").textContent),
            ...Array.from(item.querySelectorAll(".move-steps > p"), step => normalize(step.textContent)),
          ]),
        }));
        const sequence = document.getElementById("sequence-title");
        const concept = document.getElementById("concept-title");
        const cta = document.querySelector(".video-cta");
        return {
          date: document.body.dataset.methodDate,
          preview: document.body.dataset.methodPreviewCode,
          orderedSections: Boolean(sequence && concept && (sequence.compareDocumentPosition(concept) & Node.DOCUMENT_POSITION_FOLLOWING)),
          theory: concept?.closest("section")?.textContent,
          current: Object.fromEntries(panes.map(id => [id, readPhases(document.getElementById(id))])),
          ctaText: cta?.textContent.replace(/\s+/g, " "),
          ctaLinks: Array.from(cta?.querySelectorAll("a[href]") || [], link => link.getAttribute("href")),
          hasOldSurvey: Boolean(document.querySelector('form, .survey, a[href*="docs.google.com/forms"], a[href*="forms.gle/"]')),
        };
      }, instructors.map(({ pane }) => pane));
      assert.equal(materialState.date, "2026-11-20");
      assert.equal(materialState.preview, "team261120staff");
      assert.equal(materialState.orderedSections, true);
      assert.match(materialState.theory, /장시간\s+좌식\s*생활/);
      assert.deepEqual(materialState.current, expectedNotionSequence);
      assert.equal(materialState.hasOldSurvey, false);
      assert.match(materialState.ctaText, /영상이\s*제공되는\s*경우.{0,55}내\s*강의실/);
      assert.match(materialState.ctaText, /가입\s*후.{0,25}권한.{0,20}(?:연결|부여)되면/);
      assert.deepEqual(materialState.ctaLinks, [signupUrl]);
      assert.equal(await page.getByRole("link", { name: /가입하기/ }).isVisible(), true);
      assert.doesNotMatch(await page.getByRole("main").innerText(), /2026-02-28|260228|261121|261128|Archive Method|Archive Pilates|Alignment\s*Reset/);
      await close(context);
    });
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
        assert.equal(await page.getByRole("link", { name: /가입하기/ }).isVisible(), expected === "open");
        await close(context);
      });
    }
    await t.test("without JavaScript the material stays hidden", async () => {
      const context = await contextFor(390, "2026-11-19T14:00:00+09:00", false);
      const page = await context.newPage();
      await page.goto(url.href + "?preview=team261120staff");
      assert.equal(await page.getByRole("tab", { name: instructors[0].name }).isVisible(), false);
      assert.equal(await page.getByRole("heading", { level: 1, name: "직장인 증후군" }).isVisible(), false);
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
        const tablist = page.getByRole("tablist");
        const chair = tablist.getByRole("tab", { name: instructors[0].name });
        const barrel = tablist.getByRole("tab", { name: instructors[1].name });
        async function checkTab({ name, pane }, keyboard = false) {
          const tab = tablist.getByRole("tab", { name, selected: true });
          assert.equal(await tablist.getByRole("tab", { selected: true }).count(), 1);
          assert.equal(await tab.getAttribute("aria-controls"), pane);
          assert.equal(await tab.evaluate(item => item.tabIndex), 0);
          assert.equal(await tablist.getByRole("tab", { selected: false }).evaluate(item => item.tabIndex), -1);
          assert.equal(await page.getByRole("tabpanel").count(), 1);
          assert.equal(await page.getByRole("tabpanel", { name }).getAttribute("id"), pane);
          if (keyboard) {
            assert.equal(await tab.evaluate(item => item === document.activeElement), true);
            assert.equal(await tab.evaluate(item => item.matches(":focus-visible") && getComputedStyle(item).outlineStyle === "solid"), true);
          }
          const buttons = await tablist.getByRole("tab").evaluateAll(items => items.map(item => {
            const { width, height } = item.getBoundingClientRect();
            return { width, height };
          }));
          const state = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            width: document.documentElement.clientWidth,
            outside: [...document.querySelectorAll(".page *")].filter(item => {
              const rect = item.getBoundingClientRect();
              return item.checkVisibility() && rect.width && (rect.left < -1 || rect.right > innerWidth + 1);
            }).map(item => item.className),
          }));
          assert.ok(state.scrollWidth <= state.width);
          assert.deepEqual(state.outside, []);
          assert.ok(buttons.every(size => size.width >= 44 && size.height >= 44));
          if (screenshots) await page.screenshot({ path: path.join(screenshots, `${width}-${pane}.png`), fullPage: true, animations: "disabled" });
        }
        await checkTab(instructors[0]);
        await chair.press("ArrowRight");
        await checkTab(instructors[1], true);
        await barrel.press("ArrowLeft");
        await checkTab(instructors[0], true);
        await barrel.click();
        assert.equal(await page.getByRole("tabpanel", { name: instructors[1].name }).isVisible(), true);
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
