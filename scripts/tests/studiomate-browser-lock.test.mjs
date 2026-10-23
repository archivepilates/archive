import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { getEventListeners, once } from "node:events";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
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

const lockSource = await readFile(new URL("../lib/studiomate-browser-lock.mjs", import.meta.url), "utf8");

// In-memory filesystem and timers make cancellation boundaries deterministic.
function memoryLock({ metadata = null, onMkdir, onRead, onWrite } = {}) {
  const lockPath = "/synthetic/studiomate-browser-profile.lock";
  const state = {
    metadata,
    folders: new Set(metadata ? [lockPath] : []),
    removals: [],
    mkdirs: [],
    reads: 0,
    timers: new Map(),
  };
  let timerId = 0;
  let signalTimer;
  const timerScheduled = new Promise((resolve) => { signalTimer = resolve; });
  const acquire = runInNewContext(`${lockSource.replace(/^import .*;\n/gm, "").replace(/^export /gm, "")}\nacquireStudioMateBrowserLock;`, {
    os: { hostname: () => "synthetic-host", homedir: () => "/synthetic-home" },
    path,
    process: {
      pid: 123,
      env: {},
      kill: (pid) => { if (pid !== 123) throw Object.assign(new Error("dead"), { code: "ESRCH" }); },
    },
    randomUUID: () => "synthetic-token",
    mkdir: async (target, options) => {
      state.mkdirs.push(target);
      if (!options?.recursive && state.folders.has(target)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      state.folders.add(target);
      onMkdir?.(target, state);
    },
    readFile: async () => {
      state.reads += 1;
      onRead?.(state.reads, state);
      if (!state.metadata) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return JSON.stringify(state.metadata);
    },
    writeFile: async (_target, content) => { state.metadata = JSON.parse(content); onWrite?.(state); },
    rm: async (target) => {
      state.removals.push(target);
      state.folders.delete(target);
      if (target === lockPath) state.metadata = null;
    },
    setTimeout: (callback) => { const id = ++timerId; state.timers.set(id, callback); signalTimer(); return id; },
    clearTimeout: (id) => { state.timers.delete(id); },
  });
  return {
    state,
    lockPath,
    acquire: (input = {}) => acquire({ lockPath, pollMs: 5000, waitMs: 30000, ...input }),
    timerScheduled,
    finishTimer() {
      const [id, callback] = state.timers.entries().next().value;
      state.timers.delete(id);
      callback();
    },
  };
}

function memoryOwner(overrides = {}) {
  return { owner: "other-owner", token: "other-token", pid: 123, host: "synthetic-host", acquiredAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

test("busy timeout has a typed code and preserves its original message", async () => {
  const metadata = memoryOwner();
  const fixture = memoryLock({ metadata });
  await assert.rejects(fixture.acquire({ waitMs: 0 }), (error) => {
    assert.equal(error.code, "STUDIOMATE_BROWSER_BUSY");
    assert.equal(error.message, `StudioMate browser profile is locked by ${metadata.owner} since ${metadata.acquiredAt}.`);
    return true;
  });
  assert.deepEqual(fixture.state.metadata, metadata);
  assert.equal(fixture.state.removals.length, 0);
});

test("pre-aborted acquisition performs no filesystem operations", async () => {
  const controller = new AbortController();
  controller.abort();
  const fixture = memoryLock({ metadata: memoryOwner() });
  await assert.rejects(fixture.acquire({ signal: controller.signal }), (error) => error === controller.signal.reason);
  assert.equal(fixture.state.mkdirs.length, 0);
  assert.equal(fixture.state.reads, 0);
  assert.equal(fixture.state.removals.length, 0);
});

test("abort during parent setup stops before trying the profile lock", async () => {
  const controller = new AbortController();
  const fixture = memoryLock({ onMkdir: () => controller.abort() });
  await assert.rejects(fixture.acquire({ signal: controller.signal }), (error) => error === controller.signal.reason);
  assert.deepEqual(fixture.state.mkdirs, ["/synthetic"]);
  assert.equal(fixture.state.removals.length, 0);
});

test("abort while waiting clears its timer/listener and preserves another owner", async () => {
  const metadata = memoryOwner();
  const controller = new AbortController();
  const fixture = memoryLock({ metadata });
  const pending = fixture.acquire({ signal: controller.signal });
  await fixture.timerScheduled;
  assert.equal(fixture.state.timers.size, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  controller.abort(new Error("synthetic cancellation"));
  await assert.rejects(pending, (error) => error === controller.signal.reason);
  assert.equal(fixture.state.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.deepEqual(fixture.state.metadata, metadata);
  assert.deepEqual(fixture.state.removals, []);
});

test("normal poll expiry removes the abort listener before successful acquisition", async () => {
  const controller = new AbortController();
  const fixture = memoryLock({ metadata: memoryOwner() });
  const pending = fixture.acquire({ signal: controller.signal });
  await fixture.timerScheduled;
  fixture.state.folders.delete(fixture.lockPath);
  fixture.state.metadata = null;
  fixture.finishTimer();
  const release = await pending;
  assert.equal(fixture.state.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await release();
  assert.equal(fixture.state.metadata, null);
});

test("abort immediately after acquisition removes only its own token", async () => {
  for (const stage of ["mkdir", "write"]) {
    const controller = new AbortController();
    const fixture = memoryLock({
      onMkdir: (target) => { if (stage === "mkdir" && target.endsWith(".lock")) controller.abort(); },
      onWrite: () => { if (stage === "write") controller.abort(); },
    });
    await assert.rejects(fixture.acquire({ signal: controller.signal }), (error) => error === controller.signal.reason);
    assert.deepEqual(fixture.state.removals, [fixture.lockPath]);
    assert.equal(fixture.state.metadata, null);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

test("abort after owner replacement never removes the replacement lock", async () => {
  const controller = new AbortController();
  const replacement = memoryOwner({ token: "replacement" });
  const fixture = memoryLock({ onWrite: (state) => { state.metadata = replacement; controller.abort(); } });
  await assert.rejects(fixture.acquire({ signal: controller.signal }), (error) => error === controller.signal.reason);
  assert.deepEqual(fixture.state.metadata, replacement);
  assert.deepEqual(fixture.state.removals, []);
});

test("abort before stale recovery deletion preserves the dead owner's profile lock", async () => {
  const controller = new AbortController();
  const metadata = memoryOwner({ pid: 456 });
  const fixture = memoryLock({ metadata, onRead: (count) => { if (count === 3) controller.abort(); } });
  await assert.rejects(fixture.acquire({ signal: controller.signal, staleMs: 0 }), (error) => error === controller.signal.reason);
  assert.deepEqual(fixture.state.metadata, metadata);
  assert.deepEqual(fixture.state.removals, [`${fixture.lockPath}.recovery`]);
});

test("abort after handoff does not unlock a profile that may already be in use", async () => {
  const controller = new AbortController();
  const fixture = memoryLock();
  const release = await fixture.acquire({ signal: controller.signal });
  controller.abort();
  assert.equal(fixture.state.metadata.token, "synthetic-token");
  assert.deepEqual(fixture.state.removals, []);
  await release();
  await release();
  assert.deepEqual(fixture.state.removals, [fixture.lockPath]);
});

test("release still requires matching PID and host even when the token matches", async () => {
  for (const replacement of [{ pid: 456 }, { host: "foreign-host" }]) {
    const fixture = memoryLock();
    const release = await fixture.acquire();
    Object.assign(fixture.state.metadata, replacement);
    await release();
    assert.deepEqual(fixture.state.removals, []);
    assert.ok(fixture.state.metadata);
  }
});
