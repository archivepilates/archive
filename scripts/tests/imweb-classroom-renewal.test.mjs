import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const source = fs.readFileSync(new URL("../../official-home/assets/imweb-my-classroom-20260723a.js", import.meta.url), "utf8");
const catalog = JSON.parse(fs.readFileSync(new URL("../../config/imweb-paid-video-catalog.json", import.meta.url), "utf8"));
const origin = "https://classroom.test";
const watch = "/archive-method-watch-ar1";
const privateWatch = "/private-lesson-external-feedback-a-260919";
const hookPoint = '  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run,{once:true});else run();';
const sandbox = {
  URL,
  document: { readyState: "loading", addEventListener() {}, getElementById() { return {}; }, documentElement: { setAttribute() {} } },
  location: { href: origin + "/my-classroom", pathname: "/my-classroom" },
};
vm.runInNewContext(source.replace(hookPoint, `globalThis.hooks={L:L,M:M,probeOrder:probeOrder};\n${hookPoint}`), sandbox);
const lessons = JSON.parse(JSON.stringify(sandbox.hooks.L));
const manual = JSON.parse(JSON.stringify(sandbox.hooks.M));
let browser;

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => {
  if (!browser) return;
  try { assert.equal(browser.contexts().length, 0, "every task-owned browser context was closed"); }
  finally { await browser.close(); }
  assert.equal(browser.isConnected(), false);
});

function playable(image = "", selector = 'class="ap-watch"') {
  return `<!doctype html><html><head>${image ? `<meta property="og:image" content="${image}">` : ""}</head><body><div ${selector}></div></body></html>`;
}

async function fixture(t, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1280, height: 900 },
    storageState: { cookies: [], origins: [] },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const probes = [];
  const errors = [];
  const state = { reply: options.reply || (() => ({ status: 403, body: "Permission denied" })) };
  let active = 0;
  let maxActive = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  // A retry trace is available without changing the repository's test configuration.
  if (process.env.CLASSROOM_TRACE_RETRY === "1") await context.tracing.start({ screenshots: true, snapshots: true });
  t.after(async () => {
    try {
      if (process.env.CLASSROOM_TRACE_RETRY === "1") {
        await context.tracing.stop({ path: path.join(os.tmpdir(), `classroom-${t.name.replace(/[^a-z0-9]/gi, "-")}.zip`) });
      }
      assert.deepEqual(errors, [], "no browser runtime errors");
    } finally {
      await page.close();
      await context.close();
    }
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("ap_classroom_fetch_probe")) {
      probes.push(url.pathname);
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        const reply = await state.reply(url.pathname, route.request());
        if (reply.abort) await route.abort("failed");
        else await route.fulfill({ status: 200, contentType: "text/html", ...reply });
      } finally { active--; }
    } else if (url.pathname === (options.path || "/my-classroom")) {
      await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="member_profile"></div><main id="doz_content"></main></body></html>' });
    } else if (url.pathname === "/login") {
      await route.fulfill({ contentType: "text/html", body: "Login required" });
    } else if (url.hostname === "cdn.imweb.me" && url.pathname === "/fixture.png") {
      await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO7sAAAAASUVORK5CYII=", "base64") });
    } else await route.abort();
  });
  await page.goto(origin + (options.path || "/my-classroom"));
  await page.evaluate(({ hash, profile }) => {
    window.MEMBER_HASH = hash || "";
    window.MEMBER_UID = "fixture-member";
    document.getElementById("member_profile").textContent = profile || "";
  }, { hash: options.hash, profile: options.profile });
  if (options.beforeRuntime) await options.beforeRuntime(page);
  await page.addScriptTag({ content: source });
  return { page, context, probes, state, maxActive: () => maxActive };
}

async function settled(page, expected) {
  await page.waitForFunction(() => {
    const state = document.documentElement.getAttribute("data-ap-classroom-state");
    return state && state !== "loading";
  });
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-ap-classroom-state")), expected,
    await page.evaluate(() => document.querySelector(".apc-loading").textContent));
  assert.equal(await page.getByRole("button", { name: "다시 확인", exact: true }).isEnabled(), true);
}

async function cardPaths(page) {
  return page.getByRole("link", { name: /수업 시청하기/ }).evaluateAll((links) => links.map((link) => link.getAttribute("href")));
}

test("catalog, manual modes and private-first probe queue retain every lesson", async (t) => {
  assert.equal(lessons.length, catalog.products.length + 11);
  assert.deepEqual(lessons.filter((lesson) => !lesson.private).map(({ code, path: watchPath }) => ({ code, watchPath })), catalog.products.map(({ code, watchPath }) => ({ code, watchPath })));
  const expectedOrder = lessons.filter((x) => x.private).concat(lessons.filter((x) => !x.private)).map((x) => x.path);
  assert.deepEqual(Array.from(sandbox.hooks.probeOrder(), (i) => lessons[i].path), expectedOrder);
  assert.deepEqual(Object.values(manual), ["all", "all", "owner"]);
  for (const [hash, mode] of Object.entries(manual)) {
    const { page, probes } = await fixture(t, { hash });
    await settled(page, "ready");
    assert.deepEqual(await cardPaths(page), lessons.filter((x) => mode === "owner" || !x.private).map((x) => x.path));
    assert.deepEqual(probes, mode === "owner" ? [] : lessons.filter((x) => x.private).map((x) => x.path));
  }
});

test("profile access skips probes and preserves the protected watch links", async (t) => {
  const { page, probes } = await fixture(t, { profile: "ARCHIVE METHOD AR1 40D PRIVATE LESSON PELVIS HIP B 260725 40D" });
  await settled(page, "ready");
  const expected = lessons.filter((x) => x.code === "AR1" || x.group === "PRIVATE LESSON PELVIS HIP B 260725 40D").map((x) => x.path);
  assert.deepEqual(await cardPaths(page), expected);
  assert.equal(probes.length, lessons.length - expected.length);
  for (const entry of expected) assert.equal(probes.includes(entry), false);
});

test("permission denials, login redirects and non-playable pages produce a genuine empty list", async (t) => {
  const { page, probes, maxActive } = await fixture(t, { path: "/48", beforeRuntime: async (page) => {
    // Playwright routing does not intercept redirect hops. Model the final fetch URL locally.
    await page.evaluate(({ watch, origin }) => {
      const fetch = window.fetch;
      window.fetch = async (...args) => {
        const response = await fetch(...args);
        if (new URL(args[0], location.href).pathname === watch) Object.defineProperty(response, "url", { value: origin + "/login" });
        return response;
      };
    }, { watch, origin });
  }, reply: (pathname) => {
    if (pathname === watch) return { body: playable() };
    if (pathname === privateWatch) return { body: "<script>window.fake='ap-watch'</script><p>Permission required</p>" };
    return { status: pathname.includes("private") ? 401 : 403, body: "Denied" };
  } });
  await settled(page, "empty");
  assert.deepEqual(await cardPaths(page), []);
  assert.equal(probes.length, lessons.length);
  assert.ok(maxActive() <= 6);
  assert.equal(await page.getByRole("link", { name: "다시 로그인", exact: true }).isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-ap-classroom-fetch-failures")), "0");
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await settled(page, "empty");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".apc-empty").length), 1);
});

test("the existing seven-second abort becomes a retryable failure", async (t) => {
  const { page } = await fixture(t, { beforeRuntime: async (page) => {
    await page.clock.install();
    await page.evaluate((watchPath) => {
      window.fetch = (url, options) => {
        if (new URL(url, location.href).pathname !== watchPath) return Promise.resolve(new Response("Denied", { status: 403 }));
        window.fixtureFetchOptions = { credentials: options.credentials, redirect: options.redirect, cache: options.cache };
        window.fixtureAbortSignal = options.signal;
        return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
      };
    }, watch);
  } });
  await page.waitForFunction(() => !!window.fixtureAbortSignal);
  await page.clock.fastForward(7000);
  await settled(page, "error");
  assert.equal(await page.evaluate(() => window.fixtureAbortSignal.aborted), true);
  assert.deepEqual(await page.evaluate(() => window.fixtureFetchOptions), { credentials: "same-origin", redirect: "follow", cache: "no-store" });
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-ap-classroom-fetch-failures")), "1");
});

test("network and HTTP failures never masquerade as an empty entitlement list", async (t) => {
  for (const status of [0, 404, 429, 503]) {
    const { page, state } = await fixture(t, { reply: () => status ? { status, body: "Unavailable" } : { abort: true } });
    await settled(page, "error");
    assert.deepEqual(await cardPaths(page), []);
    assert.equal(await page.getByRole("link", { name: "다시 로그인", exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector(".apc-error strong").textContent), "수업 목록을 불러오지 못했습니다.");
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-ap-classroom-fetch-failures")), String(lessons.length));
    state.reply = () => ({ status: 403, body: "Denied" });
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await settled(page, "empty");
    assert.equal(await page.evaluate(() => document.querySelector(".apc-error").hidden), true);
  }
});

test("partial results survive retry without duplicate cards, focus loss or relogin", async (t) => {
  const { page, state, probes, maxActive } = await fixture(t, { reply: (pathname) => pathname === watch ? { body: playable("https://cdn.imweb.me/fixture.png") } : { status: 503, body: "Unavailable" } });
  await settled(page, "partial");
  const initial = await page.getByRole("link", { name: /수업 시청하기/ }).elementHandle();
  assert.deepEqual(await cardPaths(page), [watch]);
  let release;
  let started;
  let pending = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const firstWave = new Promise((resolve) => { started = resolve; });
  t.after(() => release());
  state.reply = async (pathname) => {
    if (++pending === 6) started();
    await gate;
    return pathname === privateWatch ? { body: playable("", 'class="ap-private-watch"') } : { status: 403, body: "Denied" };
  };
  const requestsBefore = probes.length;
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.getAttribute("data-ap-classroom-state") === "loading");
  await firstWave;
  assert.equal(await page.getByRole("button", { name: "확인 중", exact: true }).isDisabled(), true);
  assert.deepEqual(await cardPaths(page), [watch]);
  await page.getByRole("link", { name: /수업 시청하기/ }).focus();
  await page.evaluate(() => document.querySelector(".apc-retry").dispatchEvent(new Event("click")));
  assert.equal(probes.length, requestsBefore + 6, "double retry cannot create another worker pool");
  release();
  await settled(page, "ready");
  assert.deepEqual(await cardPaths(page), [watch, privateWatch]);
  assert.equal(await initial.evaluate((node) => node.isConnected && document.activeElement === node), true);
  assert.equal(probes.filter((entry) => entry === watch).length, 1, "already available cards retain the original skip rule");
  assert.ok(maxActive() <= 6);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("ap_classroom_relogin")), null);
  assert.equal(page.url(), origin + "/my-classroom");
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-ap-classroom-v2-complete")), catalog.runtime.classroomAssetVersion);
});

test("empty-state retry can discover a new class without retaining the empty message", async (t) => {
  const { page, state } = await fixture(t);
  await settled(page, "empty");
  state.reply = (pathname) => pathname === watch ? { body: playable("", 'data-widget-type="video"') } : { status: 403, body: "Denied" };
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await settled(page, "ready");
  assert.deepEqual(await cardPaths(page), [watch]);
  assert.equal(await page.evaluate(() => document.querySelector(".apc-empty").hidden), true);
});

test("unverified and shared site-logo metadata never become lesson thumbnails", async (t) => {
  const images = ["https://cdn.imweb.me/site-logo.png", "https://cdn.imweb.me/site-logo.png", origin + "/class.webp", "https://untrusted.test/full.jpg", "javascript:alert(1)", "https://cdn.imweb.me.evil.test/image.jpg", "http://cdn.imweb.me/image.jpg"];
  const paid = lessons.filter((x) => !x.private);
  const { page } = await fixture(t, { reply: (pathname) => {
    const index = paid.findIndex((x) => x.path === pathname);
    if (index >= 0 && index < images.length) return { body: playable(images[index]) };
    return { status: 403, body: playable("https://cdn.imweb.me/denied.jpg") };
  } });
  await settled(page, "ready");
  assert.equal((await cardPaths(page)).length, images.length);
  const thumbnails = await page.getByRole("link", { name: /수업 시청하기/ }).evaluateAll((cards) => cards.flatMap((card) => Array.from(card.querySelectorAll("img"), (img) => img.src)));
  assert.deepEqual(thumbnails, []);
  assert.equal(await page.evaluate(() => document.querySelector("iframe")), null);
});

test("runtime supplies one top exit link and a separate UX marker without changing VERSION", async (t) => {
  for (const existing of [false, true]) {
    const { page } = await fixture(t, { beforeRuntime: async (page) => {
      if (!existing) return;
      await page.evaluate(() => {
        const exit = document.createElement("a");
        exit.className = "apc-exit";
        exit.href = "/17";
        exit.textContent = "나가기";
        document.body.appendChild(exit);
        window.fixtureExit = exit;
      });
    } });
    await settled(page, "empty");
    const exit = page.getByRole("link", { name: "내 강의실 나가기", exact: true });
    assert.equal(await exit.count(), 1);
    assert.equal(await exit.getAttribute("href"), "/17");
    assert.equal(await exit.evaluate((node) => node.parentElement.className), "apc-top");
    if (existing) assert.equal(await exit.evaluate((node) => node === window.fixtureExit), true);
    await page.addScriptTag({ content: source });
    assert.equal(await exit.count(), 1);
    assert.deepEqual(await page.evaluate(() => [document.documentElement.getAttribute("data-ap-classroom-v2"), document.documentElement.getAttribute("data-ap-classroom-ux")]), [catalog.runtime.classroomAssetVersion, "2026-09-27a"]);
  }
});

test("classroom stays within 320, 390, 768 and 1280px with visible keyboard focus", async (t) => {
  const screenshotDir = process.env.CLASSROOM_SCREENSHOT_DIR;
  if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
  for (const width of [320, 390, 768, 1280]) {
    const { page } = await fixture(t, {
      viewport: { width, height: 900 },
      reply: (pathname) => lessons.slice(0, 4).some((x) => x.path === pathname) ? { body: playable("https://cdn.imweb.me/fixture.png") } : { status: 503, body: "Unavailable" },
    });
    await settled(page, "partial");
    const first = page.getByRole("link", { name: /수업 시청하기/ }).first();
    await first.focus();
    await page.keyboard.press("Tab");
    const layout = await page.evaluate(() => {
      const focus = getComputedStyle(document.activeElement);
      return {
        viewport: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        overflowing: Array.from(document.querySelectorAll(".apc a,.apc button,.apc p,.apc strong")).filter((el) => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1).map((el) => el.className),
        targets: Array.from(document.querySelectorAll(".apc a,.apc button")).filter((el) => el.getClientRects().length).every((el) => el.getBoundingClientRect().height >= 44),
        focus: focus.outlineStyle !== "none" && parseFloat(focus.outlineWidth) >= 2,
      };
    });
    assert.ok(layout.scroll <= layout.viewport, JSON.stringify(layout));
    assert.deepEqual(layout.overflowing, []);
    assert.ok(layout.targets);
    assert.ok(layout.focus);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `classroom-${width}.png`), fullPage: true });
  }
});

test("protected watch pages retain the barrel correction without mounting classroom UI", async (t) => {
  for (const [pathname, wrong, expected] of [
    ["/private-lesson-external-feedback-a-260919", "Vq9JxoeQpTY", "Mxk1oeWZzXM"],
    ["/private-lesson-external-feedback-b-260919", "Mxk1oeWZzXM", "Vq9JxoeQpTY"],
  ]) {
    const { page, probes } = await fixture(t, { path: pathname, beforeRuntime: async (page) => {
      await page.evaluate((id) => {
        const frame = document.createElement("iframe");
        frame.src = "https://www.youtube.com/embed/" + id + "?rel=0";
        document.body.appendChild(frame);
      }, wrong);
    } });
    assert.equal(await page.evaluate(() => document.querySelector("iframe").getAttribute("src")), `https://www.youtube.com/embed/${expected}?rel=0`);
    assert.equal(await page.getByRole("heading", { name: "내 강의실", exact: true }).count(), 0);
    assert.equal(probes.length, 0);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-archive-pilates-260919-barrel-swap")), "2026-09-20c");
  }
});
