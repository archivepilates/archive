import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireStudioMateBrowserLock } from "../lib/studiomate-browser-lock.mjs";

const STALE_MS = 100;
const WAIT_MS = 120;
const POLL_MS = 5;

function lockHost() {
  return os.hostname();
}

async function withTempLock(testBody) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "studiomate-browser-lock-"));
  const lockPath = path.join(tempDir, "studiomate-browser-profile.lock");
  try {
    return await testBody(lockPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeOwnerMetadata(lockPath, metadata) {
  await mkdir(lockPath, { recursive: true });
  await writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function spawnDeadPid() {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await once(child, "exit");
  return child.pid;
}

function staleOwnerMetadata({ pid, acquiredAt, owner = "studiomate-playwright", token = "stale-token", host = lockHost() }) {
  return { owner, token, pid, host, acquiredAt };
}

test("alive lock owner stays locked even when older than stale timeout", () =>
  withTempLock(async (lockPath) => {
    await writeOwnerMetadata(lockPath, staleOwnerMetadata({
      owner: "alive-owner",
      pid: process.pid,
      acquiredAt: new Date(Date.now() - STALE_MS - 20).toISOString(),
    }));

    await assert.rejects(
      acquireStudioMateBrowserLock({ lockPath, staleMs: STALE_MS, waitMs: WAIT_MS, pollMs: POLL_MS }),
      /locked by alive-owner/,
    );
  }));

test("foreign/missing/malformed metadata keeps lock until timeout", () =>
  withTempLock(async (lockPath) => {
    const cases = [
      { name: "foreign host", metadata: staleOwnerMetadata({ owner: "foreign-owner", token: "foreign", pid: process.pid, host: "foreign-host", acquiredAt: new Date(0).toISOString() }) },
      { name: "malformed metadata", content: "{", },
      { name: "missing metadata" },
    ];

    for (const metadataCase of cases) {
      await rm(lockPath, { recursive: true, force: true });
      await mkdir(lockPath, { recursive: true });

      if (metadataCase.metadata) {
        await writeOwnerMetadata(lockPath, metadataCase.metadata);
      } else if (metadataCase.content) {
        await writeFile(path.join(lockPath, "owner.json"), metadataCase.content, "utf8");
      } else {
        await mkdir(lockPath, { recursive: true });
      }

      await assert.rejects(
        acquireStudioMateBrowserLock({ lockPath, staleMs: STALE_MS, waitMs: WAIT_MS, pollMs: POLL_MS }),
        /is locked by/,
      );
    }
  }));

test("stale dead owner with confirmed dead child PID is recovered", () =>
  withTempLock(async (lockPath) => {
    const deadPid = await spawnDeadPid();
    await writeOwnerMetadata(lockPath, staleOwnerMetadata({
      owner: "dead-owner",
      pid: deadPid,
      acquiredAt: new Date(Date.now() - STALE_MS - 25).toISOString(),
    }));

    const release = await acquireStudioMateBrowserLock({ lockPath, staleMs: STALE_MS, waitMs: WAIT_MS + 200, pollMs: POLL_MS });
    const metadata = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
    assert.equal(metadata.owner, "studiomate-playwright");
    await release();
  }));

test("fresh dead owner does not recover before stale timeout", () =>
  withTempLock(async (lockPath) => {
    const deadPid = await spawnDeadPid();
    await writeOwnerMetadata(lockPath, staleOwnerMetadata({
      owner: "fresh-dead-owner",
      pid: deadPid,
      acquiredAt: new Date(Date.now() + STALE_MS * 3).toISOString(),
    }));

    await assert.rejects(
      acquireStudioMateBrowserLock({ lockPath, staleMs: STALE_MS, waitMs: WAIT_MS, pollMs: POLL_MS }),
      /locked by fresh-dead-owner/,
    );
  }));

test("release is idempotent and does not delete replaced owner lock metadata", () =>
  withTempLock(async (lockPath) => {
    const release = await acquireStudioMateBrowserLock({ lockPath, staleMs: STALE_MS, waitMs: WAIT_MS, pollMs: POLL_MS });

    await writeOwnerMetadata(lockPath, staleOwnerMetadata({
      owner: "replacement-owner",
      token: "replacement-token",
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    }));

    await assert.doesNotReject(() => release());
    await assert.doesNotReject(() => release());
    const remaining = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
    assert.equal(remaining.owner, "replacement-owner");
  }));

test("parallel stale contenders never both acquire lock", () =>
  withTempLock(async (lockPath) => {
    const deadPid = await spawnDeadPid();
    await writeOwnerMetadata(lockPath, staleOwnerMetadata({
      owner: "stale-contenders",
      pid: deadPid,
      acquiredAt: new Date(Date.now() - STALE_MS - 30).toISOString(),
    }));

    const contenders = [
      acquireStudioMateBrowserLock({ lockPath, staleMs: STALE_MS, waitMs: WAIT_MS + 300, pollMs: POLL_MS }),
      acquireStudioMateBrowserLock({ lockPath, staleMs: STALE_MS, waitMs: WAIT_MS, pollMs: POLL_MS }),
    ];

    const outcomes = await Promise.allSettled(contenders);
    const success = outcomes.filter((entry) => entry.status === "fulfilled");
    const failure = outcomes.filter((entry) => entry.status === "rejected");
    assert.equal(success.length, 1);
    assert.equal(failure.length, 1);
    for (const entry of success) {
      await entry.value();
    }
  }));

test("bad timing inputs are rejected", () =>
  withTempLock(async (lockPath) => {
    const badInputs = [
      { staleMs: -1 },
      { waitMs: -1 },
      { pollMs: 0 },
      { staleMs: "abc" },
    ];
    for (const input of badInputs) {
      await assert.rejects(
        acquireStudioMateBrowserLock({ lockPath, ...input }),
        /Invalid StudioMate lock timing options/,
      );
    }
  }));
