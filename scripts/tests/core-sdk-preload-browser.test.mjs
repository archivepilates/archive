import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { chromium, webkit } from "playwright";

const config = await fs.readFile(new URL("../../core/firebase-config.js", import.meta.url), "utf8");

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: SDK downloads start while application download is still pending`, { timeout: 15000 }, async () => {
    const browser = await engine.launch({ headless: true });
    let releaseApp;
    const appGate = new Promise(resolve => { releaseApp = resolve; });
    const requests = new Set();
    let sdkReady;
    const sdkGate = new Promise(resolve => { sdkReady = resolve; });
    let deadline;
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        const sdk = /^\/firebasejs\/10\.14\.1\/firebase-(app|auth|firestore|functions)\.js$/.exec(url.pathname);
        if (url.hostname === "www.gstatic.com" && sdk) {
          requests.add(sdk[1]);
          if (requests.size === 4) sdkReady();
          return route.fulfill({ contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" },
            body: "window.__sdkExecuted = true; export const mock = true;" });
        }
        if (url.href === "https://core-performance.invalid/") return route.fulfill({ contentType: "text/html",
          body: '<!doctype html><script src="/firebase-config.js"></script><script type="module" src="/app.js"></script><main>QA</main>' });
        if (url.href === "https://core-performance.invalid/firebase-config.js") return route.fulfill({ contentType: "text/javascript", body: config });
        if (url.href === "https://core-performance.invalid/app.js") {
          await appGate;
          return route.fulfill({ contentType: "text/javascript", body: "window.__appExecuted = true;" }).catch(() => {});
        }
        return route.abort();
      });
      const page = await context.newPage();
      await page.goto("https://core-performance.invalid/", { waitUntil: "commit" });
      await Promise.race([sdkGate, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("SDK preload requests did not start before the app gate")), 7000);
      })]);
      assert.deepEqual([...requests].sort(), ["app", "auth", "firestore", "functions"]);
      assert.deepEqual(await page.evaluate(() => ({ app: Boolean(window.__appExecuted), sdk: Boolean(window.__sdkExecuted) })),
        { app: false, sdk: false }, "Preloading only downloads static modules; no app/auth SDK execution or data access");
      releaseApp();
      await page.waitForFunction(() => window.__appExecuted === true);
      await context.close();
    } finally {
      clearTimeout(deadline);
      releaseApp();
      await browser.close();
    }
  });
}
