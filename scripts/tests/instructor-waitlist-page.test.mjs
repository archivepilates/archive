import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const html = await fs.readFile(new URL("archivein/instructorWaitlist/index.html", root), "utf8");
const source = await fs.readFile(new URL("archivein/instructorWaitlist/app.js", root), "utf8");
const styles = await fs.readFile(new URL("archivein/instructorWaitlist/styles.css", root), "utf8");
const id = `ilr_${"a".repeat(24)}`;
const token = "b".repeat(64);
const link = `https://in.archivepilates.com/instructor-waitlist/?id=${id}#token=${token}`;
const status = (overrides = {}) => ({ ok: true, lessonDate: "2026-11-28", status: "waitlisted", position: 3, canCancel: true, ...overrides });
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness({ url = link, replies = [status()], confirmed = true, cleanupFails = false } = {}) {
  const location = new URL(url);
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, name]) => [name, {
    hidden: !["waitlistPage", "loading", "brandIcon", "brandMark", "positionRow"].includes(name),
    disabled: false, textContent: "", attributes: {}, handlers: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(event, fn) { this.handlers[event] = fn; },
    focus() { this.focused = true; },
  }]));
  const calls = [];
  let ready;
  let confirmations = 0;
  vm.runInNewContext(source, {
    URLSearchParams, Intl, Date, AbortSignal,
    window: {
      location,
      history: { replaceState(state, title, value) {
        assert.equal(state, null);
        if (cleanupFails) throw new Error("synthetic history failure");
        location.href = new URL(value, location).href;
      } },
      confirm() { confirmations++; return confirmed; },
    },
    document: {
      addEventListener(name, callback) { assert.equal(name, "DOMContentLoaded"); ready = callback; },
      getElementById(name) { assert.ok(elements.has(name), name); return elements.get(name); },
    },
    fetch: async (endpoint, options) => {
      assert.equal(location.hash, "", "secret removed before any request");
      const payload = JSON.parse(options.body);
      calls.push({ endpoint, options, payload });
      assert.ok(replies.length, "unexpected extra request");
      let reply = replies.shift();
      if (typeof reply === "function") reply = await reply();
      if (reply instanceof Error) throw reply;
      return { ok: reply.httpOk !== false, json: async () => {
        if (reply.invalidJson) throw new SyntaxError("synthetic invalid JSON");
        return reply;
      } };
    },
    console: new Proxy({}, { get() { throw new Error("No logging permitted"); } }),
    localStorage: new Proxy({}, { get() { throw new Error("No storage permitted"); } }),
  });
  return { location, calls, elements, ready, confirmations: () => confirmations,
    get: name => elements.get(name), click: name => elements.get(name).handlers.click() };
}

test("privacy metadata and parser-blocking token consumption precede assets; no persistence or clock-based source", () => {
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(html, /connect-src 'self'/);
  assert.ok(html.indexOf('<script src="./app.js"></script>') < html.indexOf('href="./styles.css"'));
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|Date\.now|sendBeacon|innerHTML/);
  assert.doesNotMatch(source, /2026-\d\d-\d\d/);
  assert.match(styles, /min-height: 48px/);
  assert.doesNotMatch(styles, /gradient|100vw|overflow-x:\s*(hidden|clip)/);
});

test("extracts and strips fragment immediately; initial view=cancel only focuses after status read", async () => {
  const h = harness({ url: `${link}&view=cancel` });
  assert.equal(h.location.hash, "");
  assert.equal(h.calls.length, 0);
  h.ready(); await tick();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].payload, { action: "status", registrationId: id, token });
  assert.equal(h.get("cancelButton").focused, true);
  assert.equal(h.confirmations(), 0);
  assert.equal(h.get("position").textContent, "3번");
  assert.match(h.get("note").textContent, /수강 확정이 아닙니다/);
});

test("both hosts use exact same-origin POST paths and safe request options", async () => {
  for (const [url, expected] of [[link, "/api/instructorWaitlist"],
    [link.replace("in.archivepilates.com/instructor-waitlist", "archive-pilates.web.app/archivein/instructorWaitlist"), "/archivein/api/instructorWaitlist"]]) {
    const h = harness({ url }); h.ready(); await tick();
    const { endpoint, options } = h.calls[0];
    assert.equal(endpoint, expected);
    for (const [name, value] of Object.entries({ method: "POST", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" })) assert.equal(options[name], value);
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.ok(!endpoint.includes(token));
    assert.ok(!h.location.href.includes(token));
    assert.match(h.get("brandMark").src, /onsiteWelcome\/icons\/archive-pilates-icon-192\.png$/);
  }
});

test("invalid, duplicate, query-only or missing credentials and unsupported hosts fail closed", async () => {
  const invalid = [link.replace(id, "bad"), link.replace(token, "bad"), link.split("#")[0],
    `${link}&token=${token}`, link.replace(`?id=${id}`, `?id=${id}&id=${id}`),
    `${link.split("#")[0]}&token=${token}`, link.replace("in.archivepilates.com", "example.test")];
  for (const url of invalid) {
    const h = harness({ url }); h.ready(); await tick();
    assert.equal(h.location.hash, "");
    assert.equal(h.calls.length, 0);
    assert.equal(h.get("cancelButton").hidden, true);
    assert.match(h.get("message").textContent, /원래 링크/);
  }
  const h = harness({ cleanupFails: true }); h.ready(); await tick();
  assert.equal(h.calls.length, 0);
});

test("only current live status supplies position, including null, and refresh updates it", async () => {
  const h = harness({ url: `${link}&position=99`, replies: [status({ position: null }), status({ position: 1 })] });
  h.ready(); await tick();
  assert.equal(h.get("position").textContent, "확인 중");
  await h.click("refreshButton");
  assert.equal(h.get("position").textContent, "1번");
  assert.deepEqual(h.calls.map(c => c.payload.action), ["status", "status"]);
});

test("cancelled, confirmed, closed and canCancel=false never allow cancellation", async () => {
  for (const data of [status({ status: "cancelled" }), status({ status: "confirmed" }), status({ status: "closed" }), status({ canCancel: false })]) {
    const h = harness({ replies: [data] }); h.ready(); await tick();
    assert.equal(h.get("cancelButton").hidden, true);
    await h.click("cancelButton");
    assert.equal(h.calls.length, 1);
    assert.equal(h.confirmations(), 0);
    assert.equal(h.get("positionRow").hidden, data.status !== "waitlisted");
  }
});

test("rejects malformed responses and never displays unexpected identity or server error fields", async () => {
  for (const reply of [status({ status: "unknown" }), status({ lessonDate: "2026-02-30" }),
    status({ position: -1 }), status({ position: "1" }), status({ position: 1.5 }),
    status({ canCancel: "true" }), { ok: false, message: "SECRET name/phone" },
    { invalidJson: true }, { httpOk: false, ...status() }, new Error("SECRET transport")]) {
    const h = harness({ replies: [reply] }); h.ready(); await tick();
    assert.equal(h.get("details").hidden, true);
    assert.equal(h.get("cancelButton").hidden, true);
    assert.doesNotMatch(h.get("message").textContent, /SECRET/);
  }
  const h = harness({ replies: [status({ memberName: "SECRET", roster: ["SECRET"], memberPhone: "SECRET" })] });
  h.ready(); await tick();
  assert.ok([...h.elements.values()].every(element => !element.textContent.includes("SECRET")));
});

test("native explicit confirmation may be declined without a mutation", async () => {
  const h = harness({ confirmed: false }); h.ready(); await tick();
  await h.click("cancelButton");
  assert.equal(h.confirmations(), 1);
  assert.equal(h.calls.length, 1);
});

test("confirmed cancellation is POST confirm:true; in-flight controls and duplicate clicks are guarded", async () => {
  let release;
  const h = harness({ replies: [status(), () => new Promise(resolve => { release = resolve; })] });
  h.ready(); await tick();
  const pending = h.click("cancelButton"); await tick();
  assert.equal(h.get("cancelButton").disabled, true);
  assert.equal(h.get("refreshButton").disabled, true);
  assert.equal(h.get("waitlistPage").attributes["aria-busy"], "true");
  await h.click("cancelButton"); await h.click("refreshButton");
  assert.equal(h.calls.length, 2);
  assert.equal(h.confirmations(), 1);
  assert.deepEqual(h.calls[1].payload, { action: "cancel", registrationId: id, token, confirm: true });
  release(status({ status: "cancelled", position: null, canCancel: false })); await pending;
  assert.equal(h.get("status").textContent, "대기 취소 완료");
  assert.equal(h.get("cancelButton").hidden, true);
  assert.equal(h.get("cancelButton").disabled, false);
});

test("ambiguous cancel reconciles exactly once and never retries mutation, even after manual status reads", async () => {
  for (const recovery of [status({ status: "cancelled", position: null, canCancel: false }), status(), new Error("lost read")]) {
    const h = harness({ replies: [status(), new Error("lost cancel"), recovery, status()] });
    h.ready(); await tick();
    await h.click("cancelButton");
    assert.deepEqual(h.calls.map(c => c.payload.action), ["status", "cancel", "status"]);
    assert.equal(h.get("cancelButton").hidden, true);
    assert.equal(h.get("refreshButton").disabled, false);
    if (recovery instanceof Error) assert.equal(h.get("details").hidden, true);
    await h.click("cancelButton");
    await h.click("refreshButton");
    await h.click("cancelButton");
    assert.deepEqual(h.calls.map(c => c.payload.action), ["status", "cancel", "status", "status"]);
    assert.equal(h.get("cancelButton").hidden, true);
  }
});

test("invalid or generic cancel errors get one status read, not a cancellation replay", async () => {
  for (const reply of [{ ok: false, message: "Generic" }, { invalidJson: true }, status({ position: -1 })]) {
    const h = harness({ replies: [status(), reply, status()] }); h.ready(); await tick();
    await h.click("cancelButton");
    assert.deepEqual(h.calls.map(c => c.payload.action), ["status", "cancel", "status"]);
    assert.equal(h.get("cancelButton").hidden, true);
  }
});

test("cancel response still waitlisted is not reported as success and cannot be replayed", async () => {
  const h = harness({ replies: [status(), status()] }); h.ready(); await tick();
  await h.click("cancelButton"); await h.click("cancelButton");
  assert.equal(h.calls.length, 2);
  assert.match(h.get("message").textContent, /확인되지 않았습니다/);
  assert.equal(h.get("cancelButton").hidden, true);
});

test("synthetic Playwright QA: both hosts, responsive screenshots, keyboard and real dialog, no external requests", async t => {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    t.skip("Local Playwright library unavailable; no installation or network attempted"); return;
  }
  let browser;
  try { browser = await chromium.launch({ headless: true, args: ["--disable-background-networking"] }); }
  catch (error) {
    if (!/Executable doesn't exist/.test(error.message)) throw error;
    t.skip("Local Chromium unavailable; no download attempted"); return;
  }
  const context = await browser.newContext({ offline: true, serviceWorkers: "block", reducedMotion: "reduce" });
  const icon = await fs.readFile(new URL("archivein/onsiteWelcome/icons/archive-pilates-icon-192.png", root));
  const calls = [], unexpected = [], errors = [];
  let reply = status(), failCancel = false, recoveryFails = false;
  const screenshots = [];
  try {
    const screenshotDirectory = await fs.mkdtemp(join(tmpdir(), "instructor-waitlist-page-"));
    await context.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      assert.equal(url.hash, "");
      assert.ok(!url.href.includes(token));
      assert.equal(req.headers().referer, undefined);
      const path = url.pathname;
      if (path.endsWith("/api/instructorWaitlist")) {
        const payload = req.postDataJSON(); calls.push({ path, payload });
        assert.equal(req.method(), "POST");
        assert.equal(payload.token, token);
        if ((failCancel && payload.action === "cancel") || (recoveryFails && payload.action === "status" && calls.some(c => c.payload.action === "cancel"))) return route.abort("failed");
        if (payload.action === "cancel") reply = status({ status: "cancelled", position: null, canCancel: false });
        return route.fulfill({ json: reply });
      }
      if (/\/(instructor-waitlist|instructorWaitlist)\/$/.test(path)) return route.fulfill({ contentType: "text/html", body: html });
      if (path.endsWith("/app.js")) return route.fulfill({ contentType: "text/javascript", body: source });
      if (path.endsWith("/styles.css")) return route.fulfill({ contentType: "text/css", body: styles });
      if (path.endsWith("/onsiteWelcome/icons/archive-pilates-icon-192.png")) return route.fulfill({ contentType: "image/png", body: icon });
      unexpected.push(path); return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      reply = status({ position: Number.MAX_SAFE_INTEGER });
      await page.goto("about:blank");
      await page.goto(`${link}&view=cancel`);
      await page.locator("#details").waitFor({ state: "visible" });
      await page.waitForFunction(() => document.querySelector("#brandMark").naturalWidth > 0);
      assert.equal(new URL(page.url()).hash, "");
      const dimensions = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        images: [...document.images].every(img => img.complete && img.naturalWidth > 0),
        clipped: [...document.querySelectorAll("h1, dd, button, .note")].some(el => el.clientWidth < el.scrollWidth),
        touch: [...document.querySelectorAll("button")].every(el => el.getBoundingClientRect().height >= 44),
      }));
      assert.deepEqual(dimensions, { overflow: false, images: true, clipped: false, touch: true }, `width ${width}`);
      const screenshotPath = join(screenshotDirectory, `waitlist-${width}.png`);
      const png = await page.screenshot({ fullPage: true, path: screenshotPath });
      assert.ok(png.length > 5000, "non-empty synthetic screenshot retained in OS temporary directory");
      screenshots.push(screenshotPath);
      t.diagnostic(`Offline synthetic screenshot ${width}px: ${screenshotPath}`);
    }
    // Keyboard entry reaches a native confirmation dialog; declining is read-only.
    await page.locator("#cancelButton").focus();
    await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    assert.equal(await page.locator("#cancelButton").evaluate(el => el.matches(":focus-visible")), true);
    let dialogPromise = page.waitForEvent("dialog");
    let keypress = page.keyboard.press("Enter");
    let dialog = await dialogPromise;
    assert.equal(dialog.type(), "confirm"); await dialog.dismiss(); await keypress;
    assert.equal(calls.filter(c => c.payload.action === "cancel").length, 0);
    dialogPromise = page.waitForEvent("dialog"); keypress = page.keyboard.press("Enter");
    dialog = await dialogPromise; await dialog.accept(); await keypress;
    await page.waitForFunction(() => document.querySelector("#status").textContent === "대기 취소 완료");
    assert.equal(calls.filter(c => c.payload.action === "cancel").length, 1);

    calls.length = 0; reply = status(); failCancel = true; recoveryFails = true;
    await page.goto(link.replace("in.archivepilates.com/instructor-waitlist", "archive-pilates.web.app/archivein/instructorWaitlist"));
    await page.locator("#cancelButton").waitFor({ state: "visible" });
    dialogPromise = page.waitForEvent("dialog"); const click = page.locator("#cancelButton").click();
    dialog = await dialogPromise; await dialog.accept(); await click;
    await page.waitForFunction(() => document.querySelector("#message").textContent.includes("취소 결과를 확인하지 못했습니다"));
    assert.deepEqual(calls.map(c => c.payload.action), ["status", "cancel", "status"]);
    assert.ok(calls.every(c => c.path === "/archivein/api/instructorWaitlist"));
    assert.equal(await page.locator("#details").isHidden(), true);
    assert.equal(await page.locator("#cancelButton").isHidden(), true);
    assert.deepEqual(unexpected, []);
    assert.deepEqual(errors, []);
    t.diagnostic(`Offline screenshots retained: ${screenshots.length}; all contexts closed in finally`);
  } finally {
    try { await context.close(); }
    finally { await browser.close(); }
  }
});
