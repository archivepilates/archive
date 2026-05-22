import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_LOCK_PATH = "~/ArchiveIN/automation/locks/studiomate-browser-profile.lock";
const DEFAULT_STALE_MS = 45 * 60 * 1000;
const DEFAULT_WAIT_MS = 30 * 60 * 1000;
const POLL_MS = 2500;

export async function acquireStudioMateBrowserLock(input = {}) {
  const lockPath = expandHome(input.lockPath || process.env.STUDIOMATE_BROWSER_LOCK_PATH || DEFAULT_LOCK_PATH);
  const staleMs = Number(input.staleMs || process.env.STUDIOMATE_BROWSER_LOCK_STALE_MS || DEFAULT_STALE_MS);
  const waitMs = Number(input.waitMs || process.env.STUDIOMATE_BROWSER_LOCK_WAIT_MS || DEFAULT_WAIT_MS);
  const owner = String(input.owner || "studiomate-playwright");
  const started = Date.now();
  await mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(
        path.join(lockPath, "owner.json"),
        `${JSON.stringify(
          {
            owner,
            pid: process.pid,
            host: os.hostname(),
            acquiredAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      return async () => {
        await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const metadata = await readLockMetadata(lockPath);
      const ageMs = Date.now() - metadata.acquiredAtMs;
      if (ageMs > staleMs) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > waitMs) {
        throw new Error(
          `StudioMate browser profile is locked by ${metadata.owner || "unknown"} since ${
            metadata.acquiredAt || "unknown"
          }.`,
        );
      }
      await sleep(POLL_MS);
    }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function expandHome(value) {
  if (!value) return value;
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}
