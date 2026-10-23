import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./studiomate-browser-lock.mjs";

const aborted = signal => { if (signal?.aborted) throw signal.reason || new Error("studiomate_browser_stopped"); };

// One owner per batch. Other processes remain serialized by the existing profile lock.
export function createStudioMateBrowserSession({ signal, waitMs = 15_000,
  profile = process.env.STUDIOMATE_EMERGENCY_PROFILE_DIR || path.join(os.homedir(), "ArchiveIN/automation/browser-profile"),
  headless = process.env.HEADLESS !== "false", acquire = acquireStudioMateBrowserLock,
  launch = async (directory, options) => (await import("playwright")).chromium.launchPersistentContext(directory, options),
} = {}) {
  let context, opening, release, tail = Promise.resolve(), closing, stopped = false, cleanupBlocked = false;
  let lifetimeCleanup;
  async function disposeContext() {
    if (cleanupBlocked) throw new Error("studiomate_browser_cleanup_unconfirmed");
    if (closing) return closing;
    closing = (async () => {
      const owned = context || (opening ? await opening.catch(() => undefined) : undefined);
      if (owned) {
        try { await owned.close(); }
        catch {
          const browser = owned.browser?.();
          let closed = false;
          try { if (browser) { await browser.close(); closed = true; } } catch {}
          // Never let another worker reuse a profile whose browser may still be alive.
          if (!closed || browser.isConnected?.() !== false) {
            cleanupBlocked = true;
            throw new Error("studiomate_browser_cleanup_unconfirmed");
          }
        }
      }
      context = undefined;
      if (release) { await release(); release = undefined; }
    })();
    try { await closing; } finally { closing = undefined; }
  }
  const stopBatch = () => {
    stopped = true;
    lifetimeCleanup ||= disposeContext();
    lifetimeCleanup.catch(() => {});
  };
  signal?.addEventListener("abort", stopBatch, { once: true });
  async function execute(operation, taskSignal) {
    aborted(signal); aborted(taskSignal);
    if (stopped || cleanupBlocked) throw new Error("studiomate_browser_session_closed");
    const acquireSignal = signal && taskSignal ? AbortSignal.any([signal, taskSignal]) : taskSignal || signal;
    if (!release) release = await acquire({ owner: "studiomate-holding-batch", waitMs, signal: acquireSignal });
    let page, stopping;
    const stop = () => { stopping ||= disposeContext(); stopping.catch(() => {}); };
    signal?.addEventListener("abort", stop, { once: true });
    taskSignal?.addEventListener("abort", stop, { once: true });
    try {
      aborted(signal); aborted(taskSignal);
      if (!context) {
        opening = Promise.resolve().then(() => launch(profile, { headless, timeout: 60_000 }));
        try { context = await opening; } finally { opening = undefined; }
      }
      aborted(signal); aborted(taskSignal);
      page = await context.newPage();
      page.setDefaultTimeout?.(20_000);
      const result = await operation(page);
      aborted(signal); aborted(taskSignal);
      return result;
    } catch (error) {
      await disposeContext();
      aborted(signal); aborted(taskSignal);
      throw error;
    } finally {
      signal?.removeEventListener("abort", stop);
      taskSignal?.removeEventListener("abort", stop);
      if (stopping) await stopping;
      if (page) {
        try { await page.close(); }
        catch { await disposeContext(); }
      }
    }
  }
  return {
    run(operation, { signal: taskSignal } = {}) {
      if (stopped) return Promise.reject(new Error("studiomate_browser_session_closed"));
      const task = tail.then(() => execute(operation, taskSignal));
      tail = task.catch(() => {});
      return task;
    },
    async close() {
      stopped = true;
      try { await tail; await lifetimeCleanup; await disposeContext(); }
      finally { signal?.removeEventListener("abort", stopBatch); }
    },
  };
}
