import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { HOLDING_RECEIPT_CHECKS, HOLDING_RECEIPT_CURSOR, createHoldingWorkerDeadline,
  selectHoldingWorkerJobs, loadHoldingReceiptCandidates, recordHoldingReceiptCheck,
  transitionHoldingWorkerEvent, runHoldingWorkerChild } from "../lib/holding-automatic-worker-state.mjs";

const EVENTS = "syntheticHoldingEvents";
const at = n => new Date(Date.UTC(2026, 9, 8, 0, n)).toISOString();
const id = n => `event_${String(n).padStart(4, "0")}`;
const snapshot = (key, data) => ({ id: key.split("/").at(-1), data: () => structuredClone(data), exists: !!data });
function mockDb() {
  const docs = new Map(), updates = [], reads = [], pages = [];
  const db = {
    docs, updates, reads, pages,
    doc(path) { return { path, get: async () => { reads.push(path); return snapshot(path, docs.get(path)); },
      set: async data => { docs.set(path, structuredClone(data)); } }; },
    collection(name) {
      const make = (after = "", count = 50) => ({
        where: () => make(after, count), orderBy: field => { assert.equal(field, "__name__"); return make(after, count); },
        startAfter: value => make(value, count), limit: value => make(after, value),
        get: async () => {
          const rows = [...docs].filter(([key, value]) => key.startsWith(`${name}/`) &&
            ["ready", "reconciliation_required"].includes(value.status) && key.split("/").at(-1) > after)
            .sort(([a], [b]) => a.localeCompare(b)).slice(0, count).map(([key, value]) => snapshot(key, value));
          pages.push(rows.length);
          return { docs: rows };
        },
      });
      return make();
    },
    getAll: async (...refs) => refs.map(ref => { reads.push(ref.path); return snapshot(ref.path, docs.get(ref.path)); }),
    async runTransaction(run) {
      const staged = [];
      const result = await run({ get: ref => ref.get(), update: (ref, patch) => staged.push([ref.path, patch]) });
      for (const [path, patch] of staged) { docs.set(path, { ...docs.get(path), ...patch }); updates.push([path, patch]); }
      return result;
    },
  };
  return db;
}
function seed(db, n, { receipt = false, status = "ready" } = {}) {
  const key = id(n);
  db.docs.set(`${EVENTS}/${key}`, { id: key, canonical: true, status });
  if (receipt) db.docs.set(`alimtalkSends/${key}`, { id: key, solapiMessageId: `receipt_${n}`,
    payload: { deliveryMode: "automatic_live_readback" } });
  return key;
}
const budget = () => ({ remaining: () => 400_000 });

test("eleven receipt-bearing events behind ten unclaimed events all rotate into polling", async () => {
  const db = mockDb();
  for (let n = 0; n < 21; n++) seed(db, n, { receipt: n >= 10 });
  const first = await loadHoldingReceiptCandidates({ db, eventsCollection: EVENTS, deadline: budget(), pageSize: 5 });
  assert.deepEqual(first.map(row => row.id), Array.from({ length: 10 }, (_, n) => id(n + 10)));
  for (const row of first) await recordHoldingReceiptCheck({ db, id: row.id, now: new Date(at(1)), error: "synthetic_pending_or_failure" });
  const second = await loadHoldingReceiptCandidates({ db, eventsCollection: EVENTS, deadline: budget(), pageSize: 5 });
  assert.equal(second[0].id, id(20));
  assert.equal(db.docs.get(`${HOLDING_RECEIPT_CHECKS}/${id(10)}`).lastError, "synthetic_pending_or_failure");
  assert.deepEqual(db.docs.get(`${EVENTS}/${id(10)}`), { id: id(10), canonical: true, status: "ready" });
});

test("receipt scan caps event reads at 400 and advances its ring cursor beyond stuck pages", async () => {
  const db = mockDb();
  for (let n = 0; n < 450; n++) seed(db, n, { receipt: n === 420 });
  assert.deepEqual(await loadHoldingReceiptCandidates({ db, eventsCollection: EVENTS, deadline: budget() }), []);
  assert.equal(db.pages.reduce((a, b) => a + b, 0), 400);
  assert.equal(db.docs.get(HOLDING_RECEIPT_CURSOR).afterId, id(399));
  db.pages.length = 0;
  const next = await loadHoldingReceiptCandidates({ db, eventsCollection: EVENTS, deadline: budget() });
  assert.equal(next[0].id, id(420));
  assert.equal(db.pages.reduce((a, b) => a + b, 0), 400);
});

test("receipt eligibility rejects missing ids and non-automatic ledgers", async () => {
  const db = mockDb();
  for (let n = 0; n < 3; n++) seed(db, n, { receipt: true });
  delete db.docs.get(`alimtalkSends/${id(0)}`).solapiMessageId;
  db.docs.get(`alimtalkSends/${id(1)}`).payload.deliveryMode = "operator_verified_one_off";
  db.docs.get(`alimtalkSends/${id(2)}`).id = "foreign";
  const warnings = [];
  assert.deepEqual(await loadHoldingReceiptCandidates({ db, eventsCollection: EVENTS, deadline: budget(), onUnresolved: row => warnings.push(row) }), []);
  assert.deepEqual(warnings.map(row => row.id), [id(0)]);
});

test("unknown claimed receipts stay visible as warnings without occupying eligible poll slots", async () => {
  const db = mockDb(), warnings = [];
  for (let n = 0; n < 10; n++) seed(db, n, { status: "reconciliation_required" });
  seed(db, 10, { receipt: true });
  const polls = await loadHoldingReceiptCandidates({ db, eventsCollection: EVENTS, deadline: budget(), onUnresolved: row => warnings.push(row) });
  assert.deepEqual(polls.map(row => row.id), [id(10)]);
  assert.equal(warnings.length, 10);
});

test("stopped deadline performs no receipt pages or cursor writes", async () => {
  const db = mockDb(); seed(db, 0, { receipt: true });
  assert.deepEqual(await loadHoldingReceiptCandidates({ db, eventsCollection: EVENTS, deadline: { remaining: () => 0 } }), []);
  assert.equal(db.pages.length, 0);
  assert.equal(db.docs.has(HOLDING_RECEIPT_CURSOR), false);
});

test("oldest two continued hints run before sustained new/changed traffic, with deterministic ties", () => {
  const jobs = Array.from({ length: 20 }, (_, n) => ({ jobId: `new_${n}`, transition: n % 2 ? "changed" : "entered", requestedAt: at(0) }));
  jobs.push(...[3, 1, 2].map(n => ({ jobId: `continued_${n}`, transition: "continued", lastCheckedAt: at(n) })));
  const selected = selectHoldingWorkerJobs(jobs);
  assert.equal(selected.length, 10);
  assert.deepEqual(selected.slice(0, 2).map(row => row.jobId), ["continued_1", "continued_2"]);
  assert.deepEqual(selectHoldingWorkerJobs([...jobs].reverse()), selected);
  selected.slice(0, 2).forEach(row => { row.lastCheckedAt = at(10); });
  assert.equal(selectHoldingWorkerJobs(jobs)[0].jobId, "continued_3");
  assert.equal(selectHoldingWorkerJobs(jobs, 1)[0].transition, "continued");
});

test("failed promotion and pre-claim errors cannot manufacture receipt status", async () => {
  const db = mockDb(), key = seed(db, 0);
  const transition = options => transitionHoldingWorkerEvent({ db, eventsCollection: EVENTS, id: key, status: "reconciliation_required", ...options });
  assert.equal(await transition({ promoted: false }), false);
  assert.equal(db.reads.length, 0);
  assert.equal(await transition({}), false);
  assert.equal(db.docs.get(`${EVENTS}/${key}`).status, "ready");
  db.docs.set(`holdingNoticeClaims/${key}`, { candidateId: key, status: "claimed" });
  assert.equal(await transition({}), true);
  assert.deepEqual(db.updates, [[`${EVENTS}/${key}`, { status: "reconciliation_required" }]]);
});

test("delivered event is terminal under a late concurrent error, and delivery requires matching evidence", async () => {
  const db = mockDb(), key = seed(db, 0, { receipt: true });
  const run = status => transitionHoldingWorkerEvent({ db, eventsCollection: EVENTS, id: key, status });
  assert.equal(await run("delivered"), false);
  Object.assign(db.docs.get(`alimtalkSends/${key}`), { status: "done", providerStatus: "COMPLETE", providerStatusCode: "4000" });
  db.docs.set(`holdingNoticeClaims/${key}`, { candidateId: key, status: "delivered", solapiMessageId: "different" });
  assert.equal(await run("delivered"), false);
  db.docs.get(`holdingNoticeClaims/${key}`).solapiMessageId = "receipt_0";
  assert.equal(await run("reconciliation_required"), false);
  assert.equal(await run("delivered"), true);
  assert.equal(await run("reconciliation_required"), false);
  assert.deepEqual(db.docs.get(`${EVENTS}/${key}`), { id: key, canonical: true, status: "delivered" });
});

test("transaction retry after a competing delivery does not downgrade terminal state", async () => {
  const db = mockDb(), key = seed(db, 0, { receipt: true }), transact = db.runTransaction.bind(db);
  db.runTransaction = async run => {
    await run({ get: ref => ref.get(), update: () => {} });
    db.docs.get(`${EVENTS}/${key}`).status = "delivered";
    return transact(run);
  };
  assert.equal(await transitionHoldingWorkerEvent({ db, eventsCollection: EVENTS, id: key, status: "reconciliation_required" }), false);
  assert.equal(db.updates.length, 0);
  assert.equal(db.docs.get(`${EVENTS}/${key}`).status, "delivered");
});

test("single monotonic deadline includes earlier polls and bounds subsequent children", () => {
  let clock = 0;
  const deadline = createHoldingWorkerDeadline({ budgetMs: 480_000, now: () => clock });
  try {
    clock = 200_000;
    assert.equal(deadline.remaining(), 280_000);
    assert.equal(deadline.timeout(500_000), 280_000);
    clock = 479_000;
    assert.equal(deadline.timeout(20_000), 1000);
    clock = 480_000;
    assert.throws(() => deadline.timeout(20_000), /deadline_reached/);
  } finally { deadline.dispose(); }
});

function fakeChild() {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.signals = [];
  child.kill = signal => { child.signals.push(signal); return true; };
  return child;
}
test("stop sends SIGTERM once and waits for collector close instead of SIGKILL or early rejection", async () => {
  const deadline = createHoldingWorkerDeadline(), child = fakeChild();
  let settled = false;
  const promise = runHoldingWorkerChild("synthetic", [], { deadline, maxMs: 1000, spawnImpl: () => child });
  promise.then(() => { settled = true; }, () => { settled = true; });
  deadline.stop(new Error("synthetic_stop")); deadline.stop();
  await Promise.resolve();
  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.equal(settled, false);
  child.emit("close", 143, null);
  await assert.rejects(promise, /synthetic_stop/);
  deadline.dispose();
});

test("child timeout waits for graceful cleanup; already stopped budgets never spawn", async () => {
  const deadline = createHoldingWorkerDeadline(), child = fakeChild();
  const killed = new Promise(resolve => { child.kill = signal => { child.signals.push(signal); resolve(); return true; }; });
  const promise = runHoldingWorkerChild("synthetic", [], { deadline, maxMs: 1, spawnImpl: () => child });
  await killed;
  assert.deepEqual(child.signals, ["SIGTERM"]);
  child.emit("close", 143, null);
  await assert.rejects(promise, /child_timeout/);
  deadline.stop();
  assert.throws(() => runHoldingWorkerChild("synthetic", [], { deadline, maxMs: 1000,
    spawnImpl: () => { throw new Error("must_not_spawn"); } }), /deadline_reached/);
  deadline.dispose();
});

test("successful child output and spawn failures settle without retained timers", async () => {
  const deadline = createHoldingWorkerDeadline(), child = fakeChild();
  try {
    const success = runHoldingWorkerChild("synthetic", [], { deadline, maxMs: 1000, spawnImpl: () => child });
    child.stdout.emit("data", Buffer.from("synthetic result")); child.emit("close", 0, null);
    assert.equal(await success, "synthetic result");
    const failed = fakeChild();
    const failure = runHoldingWorkerChild("synthetic", [], { deadline, maxMs: 1000, spawnImpl: () => failed });
    failed.emit("error", new Error("synthetic_spawn_failure"));
    await assert.rejects(failure, /synthetic_spawn_failure/);
  } finally { deadline.dispose(); }
});

test("worker wires warning/email, read-only collector, promotion gating and a shared child deadline", async () => {
  const worker = await readFile(new URL("../run-automatic-holding-notices.ts", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /execFileSync|eventRef\.update|event\.ref\.update|started = Date\.now/);
  assert.match(worker, /"--ticket-name", ticketName, "--stdout"/);
  assert.match(worker, /let promoted = false/);
  assert.match(worker, /eventStatus\(eventId, "reconciliation_required", promoted\)/);
  assert.match(worker, /recordHoldingReceiptCheck\(\{ db, id: event.id, error: error.message \}\)/);
  assert.match(worker, /holding_receipt_review_/);
  assert.match(worker, /status: review.length \? "warning" : "healthy"/);
  assert.match(worker, /AbortSignal.any\(\[deadline.signal/);
  assert.match(worker, /await db\.terminate\(\)/);
  assert.ok(worker.indexOf("deadline.dispose()") < worker.indexOf("await db.terminate()"));
});
