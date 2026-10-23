import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../emergency-download-studiomate-excels.mjs", import.meta.url), "utf8");
const marker = "export async function cleanupStudioMateExcelDownload(";
const start = source.indexOf(marker);
assert.ok(start >= 0, "The downloader must define its cleanup helper");
// Evaluate only the final helper, never the downloader's top-level browser/file work.
const cleanup = runInNewContext(`${source.slice(start).replace(/^export /, "")}\ncleanupStudioMateExcelDownload;`, { Error, AggregateError });

function fixture({ recordFailure, contextFailure, browserFailure, connectedAfterFallback = false, initiallyConnected = false, noBrowser = false } = {}) {
  const calls = [];
  let connected = initiallyConnected;
  const browser = {
    isConnected: () => connected,
    close: async () => {
      calls.push("browser.close");
      if (browserFailure) throw browserFailure;
      connected = connectedAfterFallback;
    },
  };
  const context = {
    browser: () => noBrowser ? null : browser,
    close: async () => { calls.push("context.close"); if (contextFailure) throw contextFailure; },
  };
  return {
    calls,
    browser,
    context,
    releaseBrowserLock: async () => { calls.push("unlock"); },
    recordResult: async () => { calls.push("record"); if (recordFailure) throw recordFailure; },
  };
}

test("downloader's production finally delegates result recording and browser cleanup", () => {
  assert.match(source, /finally \{\s+await cleanupStudioMateExcelDownload\(\{\s+context,\s+releaseBrowserLock,\s+recordResult: async \(\) => \{/);
  assert.match(source, /await writeFile\(path\.join\(config\.downloadDir, "last-emergency-excel-download-result.json"\)/);
  assert.match(source, /await appendFile\(config\.runLogPath/);
});

test("normal cleanup records, closes, and unlocks in order", async () => {
  const input = fixture();
  await cleanup(input);
  assert.deepEqual(input.calls, ["record", "context.close", "unlock"]);
});

test("failed launch without context still releases an acquired lock", async () => {
  const input = fixture();
  input.context = null;
  await cleanup(input);
  assert.deepEqual(input.calls, ["record", "unlock"]);
});

test("no acquired lock requires no release", async () => {
  const input = fixture();
  input.context = null;
  input.releaseBrowserLock = null;
  await cleanup(input);
  assert.deepEqual(input.calls, ["record"]);
});

for (const operation of ["writeFile", "appendFile", "console.log"]) {
  test(`${operation} failure cannot skip close or unlock`, async () => {
    const failure = new Error(`${operation} synthetic failure`);
    const input = fixture({ recordFailure: failure });
    await assert.rejects(cleanup(input), (error) => error === failure);
    assert.deepEqual(input.calls, ["record", "context.close", "unlock"]);
  });
}

test("recording failure without context still unlocks", async () => {
  const failure = new Error("synthetic write failure");
  const input = fixture({ recordFailure: failure });
  input.context = null;
  await assert.rejects(cleanup(input), (error) => error === failure);
  assert.deepEqual(input.calls, ["record", "unlock"]);
});

test("context close failure falls back to browser close before unlocking", async () => {
  const input = fixture({ contextFailure: new Error("context failed"), initiallyConnected: true });
  await cleanup(input);
  assert.deepEqual(input.calls, ["record", "context.close", "browser.close", "unlock"]);
});

test("recording failure still runs browser fallback and unlock", async () => {
  const failure = new Error("record failed");
  const input = fixture({ recordFailure: failure, contextFailure: new Error("context failed"), initiallyConnected: true });
  await assert.rejects(cleanup(input), (error) => error === failure);
  assert.deepEqual(input.calls, ["record", "context.close", "browser.close", "unlock"]);
});

test("both close failures retain the lock", async () => {
  const closeError = new Error("context failed");
  const browserError = new Error("browser failed");
  const input = fixture({ contextFailure: closeError, browserFailure: browserError, initiallyConnected: true });
  await assert.rejects(cleanup(input), (error) => {
    assert.equal(error.code, "STUDIOMATE_BROWSER_CLOSE_UNCONFIRMED");
    assert.deepEqual(Array.from(error.errors), [closeError, browserError]);
    return true;
  });
  assert.deepEqual(input.calls, ["record", "context.close", "browser.close"]);
});

test("a still-connected browser retains its lock even if fallback resolves", async () => {
  const input = fixture({ contextFailure: new Error("context failed"), connectedAfterFallback: true, initiallyConnected: true });
  await assert.rejects(cleanup(input), { code: "STUDIOMATE_BROWSER_CLOSE_UNCONFIRMED" });
  assert.deepEqual(input.calls, ["record", "context.close", "browser.close"]);
});

test("a rejected fallback with disconnected transport is not proof of browser exit", async () => {
  const input = fixture({ contextFailure: new Error("context failed"), browserFailure: new Error("transport disconnected") });
  await assert.rejects(cleanup(input), { code: "STUDIOMATE_BROWSER_CLOSE_UNCONFIRMED" });
  assert.deepEqual(input.calls, ["record", "context.close", "browser.close"]);
});

test("missing fallback browser after context close failure retains the lock", async () => {
  const failure = new Error("context failed");
  const input = fixture({ contextFailure: failure, noBrowser: true });
  await assert.rejects(cleanup(input), (error) => error === failure);
  assert.deepEqual(input.calls, ["record", "context.close"]);
});

test("successful context close without a browser handle can release", async () => {
  const input = fixture({ noBrowser: true });
  await cleanup(input);
  assert.deepEqual(input.calls, ["record", "context.close", "unlock"]);
});

test("still-connected browser after successful context close also uses fallback", async () => {
  const input = fixture({ initiallyConnected: true });
  await cleanup(input);
  assert.deepEqual(input.calls, ["record", "context.close", "browser.close", "unlock"]);
});

test("uncertain browser connection inspection retains the lock", async () => {
  const input = fixture();
  input.browser.isConnected = () => { throw new Error("connection unknown"); };
  await assert.rejects(cleanup(input), { code: "STUDIOMATE_BROWSER_CLOSE_UNCONFIRMED" });
  assert.deepEqual(input.calls, ["record", "context.close", "browser.close"]);
});

test("unlock errors propagate after confirmed closure without replay", async () => {
  const input = fixture();
  const failure = new Error("unlock failed");
  input.releaseBrowserLock = async () => { input.calls.push("unlock"); throw failure; };
  await assert.rejects(cleanup(input), (error) => error === failure);
  assert.deepEqual(input.calls, ["record", "context.close", "unlock"]);
});

test("unlock waits until context close has resolved", async () => {
  const input = fixture();
  let finishClose;
  let closeStarted;
  const started = new Promise((resolve) => { closeStarted = resolve; });
  input.context.close = () => { input.calls.push("context.close"); closeStarted(); return new Promise((resolve) => { finishClose = resolve; }); };
  const pending = cleanup(input);
  await started;
  assert.deepEqual(input.calls, ["record", "context.close"]);
  finishClose();
  await pending;
  assert.deepEqual(input.calls, ["record", "context.close", "unlock"]);
});
