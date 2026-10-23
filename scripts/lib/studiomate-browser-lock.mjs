import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_LOCK_PATH = "~/ArchiveIN/automation/locks/studiomate-browser-profile.lock";
const DEFAULT_STALE_MS = 45 * 60 * 1000;
const DEFAULT_WAIT_MS = 30 * 60 * 1000;
const POLL_MS = 2500;

export async function acquireStudioMateBrowserLock(input = {}) {
  const lockPath = expandHome(input.lockPath || process.env.STUDIOMATE_BROWSER_LOCK_PATH || DEFAULT_LOCK_PATH);
  const staleMs = Number(input.staleMs ?? process.env.STUDIOMATE_BROWSER_LOCK_STALE_MS ?? DEFAULT_STALE_MS);
  const waitMs = Number(input.waitMs ?? process.env.STUDIOMATE_BROWSER_LOCK_WAIT_MS ?? DEFAULT_WAIT_MS);
  const pollMs = Number(input.pollMs ?? POLL_MS);
  if (![staleMs, waitMs, pollMs].every(Number.isFinite) || staleMs < 0 || waitMs < 0 || pollMs <= 0) {
    throw new Error("Invalid StudioMate lock timing options");
  }
  const owner = String(input.owner || "studiomate-playwright");
  const signal = input.signal;
  signal?.throwIfAborted();
  const started = Date.now();
  await mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    signal?.throwIfAborted();
    try {
      await mkdir(lockPath);
      const token = randomUUID();
      await writeFile(
        path.join(lockPath, "owner.json"),
        `${JSON.stringify(
          {
            owner,
            token,
            pid: process.pid,
            host: os.hostname(),
            acquiredAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        const current = await readLockMetadata(lockPath);
        if (current.token === token && current.pid === process.pid && current.host === os.hostname()) {
          await rm(lockPath, { recursive: true, force: true });
        }
      };
      if (signal?.aborted) {
        await release();
        signal.throwIfAborted();
      }
      return release;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      signal?.throwIfAborted();
      const metadata = await readLockMetadata(lockPath);
      signal?.throwIfAborted();
      if (await recoverDeadLock(lockPath, staleMs, signal)) continue;
      signal?.throwIfAborted();
      if (Date.now() - started >= waitMs) {
        throw Object.assign(new Error(
          `StudioMate browser profile is locked by ${metadata.owner || "unknown"} since ${
            metadata.acquiredAt || "unknown"
          }.`,
        ), { code: "STUDIOMATE_BROWSER_BUSY" });
      }
      await sleep(pollMs, signal);
    }
  }
}

function isDeadLocalOwner(metadata, staleMs) {
  if (metadata.host !== os.hostname() || !Number.isInteger(metadata.pid) || metadata.pid <= 0 ||
      !metadata.acquiredAtMs || Date.now() - metadata.acquiredAtMs <= staleMs) return false;
  try {
    process.kill(metadata.pid, 0);
    return false;
  } catch (error) {
    // EPERM, foreign hosts, and incomplete metadata are not proof of a dead owner.
    return error?.code === "ESRCH";
  }
}

async function recoverDeadLock(lockPath, staleMs, signal) {
  const metadata = await readLockMetadata(lockPath);
  signal?.throwIfAborted();
  if (!isDeadLocalOwner(metadata, staleMs)) return false;
  const recoveryPath = `${lockPath}.recovery`;
  try {
    await mkdir(recoveryPath);
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  try {
    // Serialize recovery and re-read: another contender may already own a new lock.
    const current = await readLockMetadata(lockPath);
    signal?.throwIfAborted();
    if (!isDeadLocalOwner(current, staleMs)) return false;
    await rm(lockPath, { recursive: true, force: true });
    return true;
  } finally {
    await rm(recoveryPath, { recursive: true, force: true });
  }
}

async function readLockMetadata(lockPath) {
  try {
    const parsed = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
    const acquiredAtMs = Date.parse(parsed.acquiredAt || "") || 0;
    return { ...parsed, acquiredAtMs };
  } catch {
    return { acquiredAtMs: 0 };
  }
}

function sleep(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function expandHome(value) {
  if (!value) return value;
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}
