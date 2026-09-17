#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

// createRequire also supports an operator-supplied NODE_PATH in isolated worktrees.
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(repoRoot, "archivein");
const outputDir = path.join(repoRoot, "artifacts/external-feedback-2609");
const sourceFile = "docs/tasks/2026-09-18-external-feedback-source.json";
const cards = [
  { code: "260919", date: "2026-09-19", displayDate: "2026. 9. 19. (토)" },
  { code: "260920", date: "2026-09-20", displayDate: "2026. 9. 20. (일)" },
].map((card) => ({
  ...card,
  preview: `externalfeedback${card.code}`,
  route: `/method/external-feedback-${card.code}/`,
  file: `archivein/method/external-feedback-${card.code}/index.html`,
}));
const teachers = [
  { key: "minjin", id: "mj", name: /^민진T/ },
  { key: "eunyoung", id: "ey", name: /^은영T/ },
];
const viewports = [
  { width: 320, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
];
const report = {
  startedAt: new Date().toISOString(),
  scope: "Local static-card QA only; no accounts, remote browser, external writes or deployments.",
  node: process.version,
  playwright: require("playwright/package.json").version,
  sourceFile,
  checks: [],
  scenarios: [],
  screenshots: [],
  inputs: {},
  cleanup: {},
};
const contexts = new Set();
const text = (value) => value.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const hash = (file) => createHash("sha256").update(fs.readFileSync(path.join(repoRoot, file))).digest("hex");
let browser;
let baseUrl;
let port;
let expected;

fs.mkdirSync(path.join(outputDir, "screenshots"), { recursive: true });

async function check(name, callback) {
  try {
    const evidence = await callback();
    report.checks.push({ name, passed: true, ...(evidence === undefined ? {} : { evidence }) });
    return true;
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.stack || String(error) });
    console.error(`FAIL ${name}: ${error.message}`);
    return false;
  }
}

function parseSource(source) {
  assert.equal(source.minjin.pageId, "3ded49ea-e4bf-800e-9a73-d23defe9b2b6", "Only the final Minjin child page is canonical");
  const phaseNames = { "WARM-UP": "Warm-up", MAIN: "Main", "COOL DOWN": "Cool Down" };
  const parseSequence = (raw) => {
    const phases = [];
    const moves = [];
    let phase;
    let move;
    for (const rawLine of raw.split("\n")) {
      const line = text(rawLine).replace(/^#+\s*/, "");
      if (phaseNames[line]) {
        phase = { title: phaseNames[line], moves: 0 };
        phases.push(phase);
        move = undefined;
      } else if (/^\d+\. /.test(line)) {
        assert.ok(phase, "A source move must follow a phase heading");
        const match = line.match(/^(\d+)\. (.+)$/);
        assert.equal(Number(match[1]), phase.moves + 1, "Source numbering must restart within each phase");
        phase.moves++;
        move = { title: match[2], steps: [] };
        moves.push(move);
      } else if (line.startsWith("- ")) {
        assert.ok(move, "A source substep must follow a move");
        move.steps.push(line.slice(2));
      }
    }
    return { moves, phases };
  };
  const mj = parseSequence(source.minjin.text);
  const ey = parseSequence(source.eunyoung.text);
  const minjin = mj.moves;
  const eunyoung = ey.moves;
  assert.equal(minjin.length, 9, "Final Minjin source must contain 9 groups");
  assert.equal(minjin.flatMap((move) => move.steps).length, 28, "Final Minjin source must contain 28 substeps");
  assert.deepEqual(minjin.map((move) => move.steps.length), [3, 2, 3, 3, 5, 5, 2, 2, 3]);
  assert.equal(eunyoung.length, 12, "Eunyoung source must contain 12 moves");
  assert.deepEqual(mj.phases, [{ title: "Warm-up", moves: 3 }, { title: "Main", moves: 4 }, { title: "Cool Down", moves: 2 }]);
  assert.deepEqual(ey.phases, [{ title: "Warm-up", moves: 3 }, { title: "Main", moves: 8 }, { title: "Cool Down", moves: 1 }]);
  return { minjin, eunyoung, phases: { minjin: mj.phases, eunyoung: ey.phases } };
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};
const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const allowed = cards.some((card) => pathname === card.route || pathname === `${card.route}index.html`)
      || /^\/method\/assets\/[a-z0-9-]+\.(css|js)$/.test(pathname)
      || ["/logo120.png", "/apple-touch-icon.png"].includes(pathname);
    if (request.method !== "GET" || !allowed) {
      response.writeHead(403).end("Outside local static QA scope");
      return;
    }
    const file = path.resolve(publicRoot, `.${pathname}`, pathname.endsWith("/") ? "index.html" : "");
    if (!file.startsWith(`${publicRoot}${path.sep}`) || !fs.existsSync(file)) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(file)], "Cache-Control": "no-store" });
    response.end(fs.readFileSync(file));
  } catch {
    response.writeHead(500).end("Local static server error");
  }
});

async function screenshot(page, name, fullPage = false) {
  const relative = `screenshots/${name}.png`;
  await page.screenshot({ path: path.join(outputDir, relative), fullPage, animations: "disabled" });
  report.screenshots.push(relative);
  return relative;
}

async function scenario(name, options, callback) {
  await check(`${name}: scenario`, async () => {
    const context = await browser.newContext({
      viewport: options.viewport || viewports[1],
      timezoneId: options.timezone || "Asia/Seoul",
      locale: "ko-KR",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    contexts.add(context);
    const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], blockedRequests: [] };
    const evidence = { name, ...options, diagnostics };
    report.scenarios.push(evidence);
    try {
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (new URL(request.url()).origin !== baseUrl || request.method() !== "GET") {
          diagnostics.blockedRequests.push({ url: request.url(), method: request.method() });
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(6000);
      page.setDefaultNavigationTimeout(10000);
      page.on("console", (message) => {
        if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
      page.on("requestfailed", (request) => diagnostics.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
      page.on("response", (response) => {
        if (response.status() >= 400) diagnostics.badResponses.push({ url: response.url(), status: response.status() });
      });
      if (options.timers) {
        await page.clock.install({ time: new Date(options.time) });
        await page.clock.pauseAt(new Date(options.time));
      } else {
        await page.clock.setFixedTime(new Date(options.time));
      }
      await callback(page, evidence);
    } finally {
      await context.close();
      contexts.delete(context);
      await check(`${name}: console, requests and runtime clean`, () => {
        for (const [kind, errors] of Object.entries(diagnostics)) assert.deepEqual(errors, [], kind);
        return diagnostics;
      });
    }
  });
}

async function navigate(page, card, preview) {
  const suffix = preview === undefined ? "" : `?preview=${encodeURIComponent(preview)}`;
  const response = await page.goto(`${baseUrl}${card.route}${suffix}`, { waitUntil: "load" });
  assert.equal(response.status(), 200);
  await page.evaluate(() => document.fonts.ready);
}

async function accessState(page, state) {
  const observed = await page.evaluate(() => {
    const gate = document.querySelector("[data-method-gate]");
    const content = document.querySelector("[data-method-content]");
    return {
      now: new Date().toISOString(),
      state: document.body.dataset.methodAccessState,
      locked: document.body.classList.contains("method-locked"),
      gateVisible: gate.checkVisibility(),
      contentVisible: content.checkVisibility(),
      gateAriaHidden: gate.getAttribute("aria-hidden"),
      contentAriaHidden: content.getAttribute("aria-hidden"),
      message: gate.textContent.trim(),
    };
  });
  const locked = state === "locked";
  assert.equal(observed.state, state, JSON.stringify(observed));
  assert.equal(observed.locked, locked);
  assert.equal(observed.gateVisible, locked);
  assert.equal(observed.contentVisible, !locked);
  assert.equal(observed.gateAriaHidden, String(!locked));
  assert.equal(observed.contentAriaHidden, String(locked));
  assert.equal(observed.message, "수업자료는 수업 당일 12시에 공개됩니다.");
  assert.equal(await page.getByRole("tab").count(), locked ? 0 : 2);
  assert.equal(await page.getByRole("heading", { level: 4 }).count(), locked ? 0 : expected.minjin.length);
  return observed;
}

async function verifyContent(page, card) {
  await check(`${card.code}: sequence follows core message before theory`, async () => {
    const order = await page.evaluate(() => [...document.querySelectorAll('main > section[aria-labelledby]')].map((section) => ({
      heading: section.getAttribute('aria-labelledby'),
      number: section.querySelector('.section-num').textContent,
      afterHeader: section.previousElementSibling.tagName === 'HEADER',
    })));
    assert.deepEqual(order.map((section) => section.heading), ['sequence-title', 'concept-title', 'flow-title', 'remember-title']);
    assert.deepEqual(order.map((section) => section.number), ['01', '02', '03', '04']);
    assert.equal(order[0].afterHeader, true);
    return order;
  });
  await check(`${card.code}: DOM metadata and initial gate`, async () => {
    const metadata = await page.evaluate(() => ({
      date: document.body.dataset.methodDate,
      preview: document.body.dataset.methodPreviewCode,
      displayDate: document.querySelector(".lesson-meta").textContent,
      styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => ({ href: link.getAttribute("href"), loaded: Boolean(link.sheet?.cssRules.length) })),
    }));
    assert.equal(metadata.date, card.date);
    assert.equal(metadata.preview, card.preview);
    assert.equal(metadata.displayDate, `${card.displayDate} · 13:00–15:10`);
    assert.equal(metadata.styles.length, 3);
    assert.ok(metadata.styles.every((style) => style.loaded));
    const document = await page.evaluate((html) => {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      return { locked: parsed.body.classList.contains("method-locked"), date: parsed.body.dataset.methodDate };
    }, fs.readFileSync(path.join(repoRoot, card.file), "utf8"));
    assert.equal(document.locked, true, "Raw HTML must start locked to prevent content flash");
    assert.equal(document.date, card.date);
    return metadata;
  });
  for (const teacher of teachers) {
    await page.getByRole("tab", { name: teacher.name }).click();
    const pane = page.getByRole("tabpanel", { name: teacher.name });
    await check(`${card.code}: ${teacher.key} final source titles in order`, async () => {
      const actual = (await pane.getByRole("heading", { level: 4 }).allTextContents()).map(text);
      const wanted = expected[teacher.key].map((move) => move.title);
      assert.equal(actual.length, wanted.length);
      assert.deepEqual(actual, wanted);
      return { titles: actual, titleNormalization: "Exact final source titles" };
    });
    await check(`${card.code}: ${teacher.key} source phase grouping`, async () => {
      const phases = await pane.evaluate((element) => [...element.querySelectorAll(".phase-card")].map((phase) => ({ title: phase.querySelector("h3").textContent, moves: phase.querySelectorAll("h4").length })));
      assert.deepEqual(phases, expected.phases[teacher.key]);
      return phases;
    });
    if (teacher.key === "minjin") {
      await check(`${card.code}: Minjin all 28 final substeps by group, no legacy settings or repetitions`, async () => {
        const actual = await pane.evaluate((element) => [...element.querySelectorAll(".move-list > li")].map((move) => [...move.querySelectorAll(".move-steps p")].map((step) => step.textContent.replace(/\s+/g, " ").trim())));
        assert.deepEqual(actual, expected.minjin.map((move) => move.steps));
        assert.equal(actual.flat().length, 28);
        assert.equal(await pane.evaluate((element) => element.querySelectorAll(".move-setup").length), 0);
        assert.doesNotMatch(await pane.textContent(), /Jump|Feedback ON|Feedback OFF|Front Rowing|Feet on Frame|롤러 제거|×|\d+\s*(?:회|세트|breaths|ea|kg)/i);
        return { groups: actual.length, substeps: actual.flat().length, stepsPerGroup: actual.map((steps) => steps.length) };
      });
    } else {
      await check(`${card.code}: Eunyoung external-load intro without invented weights or repetitions`, async () => {
        const content = await pane.textContent();
        assert.match(content, /스프링의 직접적인 저항이 없어/);
        assert.match(content, /토닝볼을 웨이트로 활용해 외부 부하/);
        assert.doesNotMatch(content, /마무리의 Push up|마무리에 맞는 강도|×|\d+\s*(?:회|세트|kg)/i);
      });
    }
  }
  await check(`${card.code}: shared theory does not claim the superseded Minjin sequence`, async () => {
    const content = await page.evaluate(() => [...document.querySelectorAll('main > section:not([aria-labelledby="sequence-title"])')].map((section) => section.textContent).join("\n"));
    assert.doesNotMatch(content, /Jump|Feedback ON|Feedback OFF|Front Rowing|Frame Bridge|Rowing에서 롤러를 제거/);
    assert.match(content, /이번 시퀀스의 특정 동작을 설명하는 문장은 아닙니다/);
  });
  await check(`${card.code}: signup exists and no rating form`, async () => {
    const signup = page.getByRole("link", { name: "ARCHIVE PILATES 홈페이지 가입하기", exact: true });
    assert.equal(await signup.count(), 1);
    assert.equal(await signup.isVisible(), true);
    const url = new URL(await signup.getAttribute("href"));
    assert.equal(url.origin, "https://archivepilates.imweb.me");
    assert.equal(url.searchParams.get("mode"), "join");
    assert.equal(Buffer.from(url.searchParams.get("back_url"), "base64").toString(), "/48");
    assert.equal(await signup.getAttribute("target"), "_blank");
    assert.match(await signup.getAttribute("rel"), /noopener/);
    const formCount = await page.evaluate(() => document.querySelectorAll('form, input, textarea, select, [role="slider"], [role="radio"], [role="radiogroup"], [data-rating]').length);
    assert.equal(formCount, 0);
    assert.equal(await page.getByRole("button", { name: /평점|별점|평가|제출|rating|submit/i }).count(), 0);
    return { href: url.href, formControls: formCount, followedLink: false };
  });
}

async function verifyAssets(page) {
  const assets = await page.evaluate(() => ({
    links: [...document.querySelectorAll('script[src], link[rel="stylesheet"], link[rel="icon"], link[rel="apple-touch-icon"], img[src]')].map((node) => ({ url: node.src || node.href, tag: node.tagName, rel: node.rel || "" })),
    images: [...document.images].map((image) => ({ src: image.src, complete: image.complete, width: image.naturalWidth, height: image.naturalHeight, alt: image.alt })),
  }));
  for (const asset of assets.links) {
    assert.equal(new URL(asset.url).origin, baseUrl, "Assets must stay local");
    const response = await fetch(asset.url);
    assert.equal(response.status, 200, asset.url);
    assert.ok((await response.arrayBuffer()).byteLength > 0, `Empty asset: ${asset.url}`);
    const expectedType = contentTypes[path.extname(new URL(asset.url).pathname)].split(";")[0];
    assert.ok(response.headers.get("content-type").startsWith(expectedType), asset.url);
  }
  assert.ok(assets.images.length > 0, "Brand asset missing");
  for (const image of assets.images) assert.ok(image.complete && image.width > 0 && image.height > 0 && image.alt, JSON.stringify(image));
  return assets;
}

async function layout(page) {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const elements = [...document.body.querySelectorAll("*")].filter((element) => element.checkVisibility() && element.getBoundingClientRect().width > 0);
    const describe = (element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}.${[...element.classList].join(".")}`;
    const outside = elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > width + 1;
    }).map(describe);
    const clipped = elements.filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1).map(describe);
    const controls = [...document.querySelectorAll('[role="tab"], .join-button')].filter((element) => element.checkVisibility()).map((element) => ({ name: element.textContent.trim(), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
    return { width, scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), outside, clipped, controls };
  });
  assert.ok(result.scrollWidth <= result.width + 1, JSON.stringify(result));
  assert.deepEqual(result.outside, [], "Elements outside viewport");
  assert.deepEqual(result.clipped, [], "Horizontally clipped content");
  for (const control of result.controls) assert.ok(control.width >= 44 && control.height >= 44, JSON.stringify(control));
  return result;
}

async function tabState(page, selected, focused = false) {
  const state = await page.evaluate(() => ({
    tablists: document.querySelectorAll('[role="tablist"]').length,
    tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => {
      const pane = document.getElementById(tab.getAttribute("aria-controls"));
      const style = getComputedStyle(tab);
      return { id: tab.id, selected: tab.getAttribute("aria-selected"), tabIndex: tab.tabIndex, focused: document.activeElement === tab, focusVisible: tab.matches(":focus-visible"), outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), paneRole: pane?.getAttribute("role"), paneLabel: pane?.getAttribute("aria-labelledby"), paneHidden: pane?.hidden, paneVisible: pane?.checkVisibility() };
    }),
  }));
  assert.equal(state.tablists, 1);
  assert.equal(state.tabs.length, 2);
  for (const tab of state.tabs) {
    const active = tab.id === `tab-${selected}`;
    assert.equal(tab.selected, String(active));
    assert.equal(tab.tabIndex, active ? 0 : -1);
    assert.equal(tab.paneRole, "tabpanel");
    assert.equal(tab.paneLabel, tab.id);
    assert.equal(tab.paneHidden, !active);
    assert.equal(tab.paneVisible, active);
    if (focused && active) {
      assert.equal(tab.focused, true);
      assert.equal(tab.focusVisible, true);
      assert.notEqual(tab.outlineStyle, "none");
      assert.ok(tab.outlineWidth >= 2);
    }
  }
  return state;
}

async function verifyKeyboard(page, card) {
  await check(`${card.code}: keyboard Tab enters selected tab`, async () => {
    await page.getByRole("tab", { name: /^민진T/ }).click();
    await page.getByRole("tab", { name: /^민진T/ }).press("Shift+Tab");
    await page.keyboard.press("Tab");
    return tabState(page, "mj", true);
  });
  for (const [from, key, to] of [["mj", "ArrowRight", "ey"], ["ey", "ArrowRight", "mj"], ["mj", "ArrowLeft", "ey"], ["ey", "ArrowLeft", "mj"]]) {
    await check(`${card.code}: keyboard ${from} ${key} -> ${to}`, async () => {
      await page.getByRole("tab", { name: teachers.find((teacher) => teacher.id === from).name }).press(key);
      return tabState(page, to, true);
    });
  }
  await check(`${card.code}: keyboard Tab reaches active panel`, async () => {
    await page.getByRole("tab", { name: /^민진T/ }).press("Tab");
    const pane = page.getByRole("tabpanel", { name: /^민진T/ });
    assert.equal(await pane.evaluate((element) => document.activeElement === element), true);
  });
}

function closedPort() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", (error) => resolve(error.code === "ECONNREFUSED"));
    socket.setTimeout(2000, () => { socket.destroy(); resolve(false); });
  });
}

try {
  await check("Files exist; final source yields Minjin 9 groups / 28 substeps and Eunyoung 12 moves", () => {
    for (const file of [sourceFile, ...cards.map((card) => card.file), "archivein/method/assets/external-feedback-card.css", "archivein/method/assets/method-access.js", "archivein/method/assets/method-access.css", "archivein/method/assets/support-movement-card.js", "archivein/method/assets/support-movement-card.css", "archivein/logo120.png", "archivein/apple-touch-icon.png"]) {
      assert.ok(fs.statSync(path.join(repoRoot, file)).isFile(), file);
      report.inputs[file] = hash(file);
    }
    expected = parseSource(JSON.parse(fs.readFileSync(path.join(repoRoot, sourceFile), "utf8")));
    return expected;
  });
  assert.ok(expected, "Cannot verify without source sequences");
  await check("Cards identical except own date, preview code and display date", () => {
    const normalized = cards.map((card) => fs.readFileSync(path.join(repoRoot, card.file), "utf8")
      .replace(`data-method-date="${card.date}"`, 'data-method-date="DATE"')
      .replace(`data-method-preview-code="${card.preview}"`, 'data-method-preview-code="PREVIEW"')
      .replace(card.displayDate, "DISPLAY_DATE"));
    assert.equal(normalized[0], normalized[1]);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  report.localOrigin = baseUrl;
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  for (const card of cards) {
    const before = `${card.date}T11:59:59+09:00`;
    const noon = `${card.date}T12:00:00+09:00`;
    await scenario(`${card.code} boundary, already-open page`, { time: before, timers: true }, async (page, evidence) => {
      await navigate(page, card);
      await check(`${card.code}: locked at 11:59:59 KST`, () => accessState(page, "locked"));
      await check(`${card.code}: locked mobile layout`, () => layout(page));
      await screenshot(page, `${card.code}-390-locked`);
      await page.clock.runFor(1000);
      evidence.atNoon = await page.evaluate(() => ({ now: new Date().toISOString(), state: document.body.dataset.methodAccessState }));
      await check(`${card.code}: existing page reaches noon without early disclosure`, () => {
        assert.equal(evidence.atNoon.now, `${card.date}T03:00:00.000Z`);
        assert.ok(["locked", "open"].includes(evidence.atNoon.state));
        return evidence.atNoon;
      });
      // Existing shared gate deliberately adds a 50 ms timer buffer at the boundary.
      await page.clock.runFor(50);
      await check(`${card.code}: already-open page unlocked by 12:00:00.050 KST`, () => accessState(page, "open"));
    });
    await scenario(`${card.code} fresh noon in UTC browser`, { time: noon, timezone: "UTC" }, async (page) => {
      await navigate(page, card);
      await check(`${card.code}: fresh page open exactly at KST noon, independent of browser zone`, () => accessState(page, "open"));
      await verifyContent(page, card);
      await check(`${card.code}: all referenced assets load`, () => verifyAssets(page));
      await verifyKeyboard(page, card);
    });
    for (const preview of ["invalid-preview", cards.find((other) => other !== card).preview, card.preview]) {
      const correct = preview === card.preview;
      await scenario(`${card.code} preview ${correct ? "own" : preview === "invalid-preview" ? "wrong" : "other-date"}`, { time: before }, async (page) => {
        await navigate(page, card, preview);
        await check(`${card.code}: ${correct ? "own preview works before class" : "wrong/other-date preview stays locked"} (${preview})`, () => accessState(page, correct ? "preview" : "locked"));
      });
    }
    for (const viewport of viewports) {
      await scenario(`${card.code} responsive ${viewport.width}`, { viewport, time: noon }, async (page) => {
        await navigate(page, card);
        if ([390, 1280].includes(viewport.width)) {
          await screenshot(page, `${card.code}-${viewport.width}-initial`);
        }
        for (const teacher of teachers) {
          await page.getByRole("tab", { name: teacher.name }).click();
          await check(`${card.code} ${viewport.width} ${teacher.key}: tab ARIA`, () => tabState(page, teacher.id));
          await check(`${card.code} ${viewport.width} ${teacher.key}: no overflow and usable targets`, () => layout(page));
          await check(`${card.code} ${viewport.width} ${teacher.key}: images and assets`, () => verifyAssets(page));
          if ([390, 1280].includes(viewport.width)) {
            await page.getByRole("heading", { name: "외부 피드백", exact: true }).scrollIntoViewIfNeeded();
            await screenshot(page, `${card.code}-${viewport.width}-${teacher.key}-full`, true);
            await page.getByRole("tab", { name: teacher.name }).scrollIntoViewIfNeeded();
            await screenshot(page, `${card.code}-${viewport.width}-${teacher.key}-sequence`);
          }
        }
      });
    }
  }
  await scenario("Sept 19 noon isolates Sept 20", { time: "2026-09-19T12:00:00+09:00" }, async (page) => {
    await navigate(page, cards[0]);
    await check("Sept 19 open at its own noon", () => accessState(page, "open"));
    await navigate(page, cards[1]);
    await check("Sept 20 remains locked when Sept 19 opens", () => accessState(page, "locked"));
  });
} catch (error) {
  await check("Harness setup/execution", () => { throw error; });
} finally {
  for (const context of contexts) {
    await check("Emergency context cleanup", async () => {
      await context.close();
      contexts.delete(context);
    });
  }
  await check("Browser closed", async () => {
    if (browser) {
      await browser.close();
      assert.equal(browser.isConnected(), false);
      assert.equal(browser.contexts().length, 0);
    }
    report.cleanup.browserClosed = true;
    report.cleanup.contextsRemaining = contexts.size;
    assert.equal(contexts.size, 0);
  });
  await check("Temporary HTTP server closed", async () => {
    if (server.listening) {
      const close = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await close;
    }
    assert.equal(server.listening, false);
    report.cleanup.serverClosed = true;
    report.cleanup.portClosed = port ? await closedPort() : true;
    assert.equal(report.cleanup.portClosed, true);
  });
  await check("Read-only input files unchanged during QA", () => {
    for (const [file, initialHash] of Object.entries(report.inputs)) assert.equal(hash(file), initialHash, file);
  });
}

report.finishedAt = new Date().toISOString();
report.passed = report.checks.filter((item) => item.passed).length;
report.failed = report.checks.filter((item) => !item.passed).length;
report.ok = report.failed === 0;
report.limitations = [
  "Static content/preview gates are presentation gates, not authentication or confidentiality controls.",
  "Local Chromium only; remote signup, publication, Notion, production and other browser engines were not tested.",
];
fs.writeFileSync(path.join(outputDir, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
fs.writeFileSync(path.join(outputDir, "report.html"), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ARCHIVE PILATES external feedback cue-card QA</title>
<style>*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,sans-serif;color:#202725;background:#f8faf9}main{max-width:72rem;padding:2rem 1rem;margin:auto}h1{font-size:1.8rem}h2{font-size:1.2rem;margin-top:2rem}li{margin:.5rem 0}a{color:#245840}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem}.fail{color:#a32626}summary{cursor:pointer;padding:.7rem 0}details{border-bottom:1px solid #dce4e0}</style>
<main><h1>ARCHIVE PILATES external feedback cue-card QA</h1>
<p>${report.passed} checks passed; ${report.failed} failed. ${escape(report.finishedAt)}</p>
<p>${escape(report.scope)}</p><p>Chromium ${escape(report.browser || "not launched")}; Playwright ${escape(report.playwright)}. 320 / 390 / 768 / 1280 px, both dates and both tabs.</p>
<h2>Defects</h2>${report.failed ? report.checks.filter((item) => !item.passed).map((item) => `<details open class="fail"><summary>${escape(item.name)}</summary><pre>${escape(item.error)}</pre></details>`).join("") : "<p>None detected.</p>"}
<h2>Cleanup</h2><pre>${escape(JSON.stringify(report.cleanup, null, 2))}</pre>
<h2>Screenshots</h2><ul>${report.screenshots.map((file) => `<li><a href="${escape(file)}">${escape(file)}</a></li>`).join("")}</ul>
<h2>All checks</h2>${report.checks.map((item) => `<details><summary>${item.passed ? "PASS" : "FAIL"} ${escape(item.name)}</summary><pre>${escape(JSON.stringify(item.evidence ?? item.error ?? "Passed", null, 2))}</pre></details>`).join("")}
<h2>Scope limits</h2><ul>${report.limitations.map((item) => `<li>${escape(item)}</li>`).join("")}</ul><p><a href="results.json">Machine-readable evidence and input hashes</a></p></main></html>\n`);
console.log(JSON.stringify({ ok: report.ok, passed: report.passed, failed: report.failed, failures: report.checks.filter((item) => !item.passed).map((item) => item.name), screenshots: report.screenshots.length, cleanup: report.cleanup, outputDir }, null, 2));
process.exitCode = report.ok ? 0 : 1;
