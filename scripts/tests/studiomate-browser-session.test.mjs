import test from "node:test";
import assert from "node:assert/strict";
import { createStudioMateBrowserSession } from "../lib/studiomate-browser-session.mjs";

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  const events = [], pages = [];
  const context = {
    async newPage() {
      const page = { id: pages.length, setDefaultTimeout: () => {}, async close() { events.push(`page-close-${page.id}`); } };
      pages.push(page); events.push(`page-${page.id}`); return page;
    },
    async close() { events.push("context-close"); },
  };
  const session = createStudioMateBrowserSession({
    profile: "/synthetic-only/profile", headless: true,
    acquire: async input => { events.push("acquire"); assert.equal(input.owner, "studiomate-holding-batch");
      assert.equal(input.waitMs, 15_000); return async () => { events.push("release"); }; },
    launch: async directory => { assert.equal(directory, "/synthetic-only/profile"); events.push("launch"); return context; },
    ...overrides,
  });
  return { events, pages, context, session };
}

test("batch reads reuse one locked browser, but each read receives a fresh page and fresh operation", async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.events, []);
    assert.equal(await f.session.run(async p => p.id), 0);
    assert.equal(await f.session.run(async p => p.id), 1);
    assert.deepEqual(f.events, ["acquire", "launch", "page-0", "page-close-0", "page-1", "page-close-1"]);
  } finally { await f.session.close(); }
  assert.deepEqual(f.events.slice(-2), ["context-close", "release"]);
  await f.session.close();
  assert.equal(f.events.filter(x => x === "release").length, 1);
});

test("concurrent callers are queued, never interleave page operations", async () => {
  const f = fixture(), entered = gate(), resume = gate();
  const first = f.session.run(async () => { f.events.push("first-start"); entered.resolve(); await resume.promise; f.events.push("first-end"); });
  await entered.promise;
  const second = f.session.run(async () => { f.events.push("second-start"); });
  await Promise.resolve();
  assert.equal(f.events.includes("second-start"), false);
  resume.resolve(); await first; await second; await f.session.close();
  assert.ok(f.events.indexOf("first-end") < f.events.indexOf("second-start"));
  assert.equal(f.events.filter(x => x === "launch").length, 1);
});

test("busy lock preserves typed failure without launching or invoking read operation", async () => {
  const busy = Object.assign(new Error("synthetic busy"), { code: "STUDIOMATE_BROWSER_BUSY" });
  const f = fixture({ acquire: async () => { throw busy; } });
  await assert.rejects(f.session.run(() => { throw new Error("must not read"); }), error => error === busy);
  await f.session.close(); assert.deepEqual(f.events, []);
});

test("abort before work never acquires a profile", async () => {
  const controller = new AbortController(); controller.abort(new Error("synthetic stop"));
  const f = fixture({ signal: controller.signal });
  await assert.rejects(f.session.run(() => {}), /synthetic stop/);
  await f.session.close(); assert.deepEqual(f.events, []);
});

test("batch stop cancels lock wait even when a separate task signal is provided", async () => {
  const batch = new AbortController(), task = new AbortController(), waiting = gate();
  const f = fixture({ signal: batch.signal, acquire: async ({ signal }) => {
    waiting.resolve();
    await new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } });
  const read = f.session.run(() => {}, { signal: task.signal });
  await waiting.promise; batch.abort(new Error("synthetic batch stop"));
  await assert.rejects(read, /synthetic batch stop/); await f.session.close();
  assert.deepEqual(f.events, []);
});

test("read failure closes owned browser and releases before a new read can restart", async () => {
  const f = fixture();
  await assert.rejects(f.session.run(() => { throw new Error("synthetic layout changed"); }), /layout changed/);
  assert.ok(f.events.indexOf("context-close") < f.events.indexOf("release"));
  assert.equal(await f.session.run(async p => p.id), 1);
  await f.session.close(); assert.equal(f.events.filter(x => x === "launch").length, 2);
});

test("abort during startup waits for the owned browser to close before releasing the profile", async () => {
  const controller = new AbortController(), started = gate(), finish = gate();
  const f = fixture({ signal: controller.signal, launch: async () => { started.resolve(); await finish.promise; return f.context; } });
  const read = f.session.run(() => { throw new Error("must not read after stop"); });
  await started.promise; controller.abort(new Error("synthetic stop"));
  await Promise.resolve(); assert.equal(f.events.includes("release"), false);
  finish.resolve(); await assert.rejects(read, /synthetic stop/); await f.session.close();
  assert.ok(f.events.indexOf("context-close") < f.events.indexOf("release"));
});

test("active cancellation closes the context and rejects even if a late read returns data", async () => {
  const controller = new AbortController(), entered = gate(), finish = gate();
  const f = fixture();
  f.context.close = async () => { f.events.push("context-close"); finish.resolve(); };
  const read = f.session.run(async () => { entered.resolve(); await finish.promise; return "late-stale-result"; }, { signal: controller.signal });
  await entered.promise; controller.abort(new Error("synthetic timeout"));
  await assert.rejects(read, /synthetic timeout/); await f.session.close();
  assert.equal(f.events.filter(x => x === "release").length, 1);
});

test("unconfirmed browser cleanup retains the lock and prohibits session restart", async () => {
  const f = fixture(); f.context.close = async () => { throw new Error("synthetic close failure"); };
  await f.session.run(() => "read-only-result");
  await assert.rejects(f.session.close(), /cleanup_unconfirmed/);
  assert.equal(f.events.includes("release"), false);
  await assert.rejects(f.session.run(() => {}), /session_closed/);
});

test("browser fallback confirmed disconnected permits lock release", async () => {
  const f = fixture(); let connected = true;
  f.context.close = async () => { throw new Error("synthetic close failure"); };
  f.context.browser = () => ({ close: async () => { connected = false; }, isConnected: () => connected });
  await f.session.run(() => "read"); await f.session.close();
  assert.equal(f.events.at(-1), "release");
});

test("disconnected transport with both close failures is not proof of process exit", async () => {
  const f = fixture();
  f.context.close = async () => { throw new Error("synthetic context close failed"); };
  f.context.browser = () => ({ close: async () => { throw new Error("synthetic browser close failed"); }, isConnected: () => false });
  await f.session.run(() => "read");
  await assert.rejects(f.session.close(), /cleanup_unconfirmed/);
  await assert.rejects(f.session.close(), /cleanup_unconfirmed/);
  assert.equal(f.events.includes("release"), false);
});

test("batch signal closes an idle retained browser without waiting for the owner finally", async () => {
  const controller = new AbortController(), released = gate();
  const f = fixture({ signal: controller.signal, acquire: async () => async () => { f.events.push("release"); released.resolve(); } });
  await f.session.run(() => "read");
  controller.abort(new Error("synthetic batch stopped while idle"));
  await released.promise;
  assert.ok(f.events.indexOf("context-close") < f.events.indexOf("release"));
  await assert.rejects(f.session.run(() => {}), /session_closed/);
  await f.session.close();
});

test("closing a batch rejects already queued operations without opening extra pages", async () => {
  const f = fixture(), entered = gate(), resume = gate();
  const first = f.session.run(async () => { entered.resolve(); await resume.promise; });
  await entered.promise;
  const second = f.session.run(() => { throw new Error("must not run"); });
  const rejected = assert.rejects(second, /session_closed/);
  const closed = f.session.close(); resume.resolve();
  await first; await rejected; await closed;
  assert.equal(f.pages.length, 1);
});
