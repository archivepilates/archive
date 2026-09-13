import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  canAutoRetryQueueDocument, classifyNotionDocument, classifyQueueDocument, healthTimestampMs,
  isExplicitlyRetired, loadRecentQueueFailures, queryCoverage, recentQueueFailure,
} from "../lib/system-health-queue-policy.mjs";

const nowMs = Date.parse("2026-09-14T12:00:00Z");
const ago = (minutes) => new Date(nowMs - minutes * 60000);
const options = { nowMs, staleMinutes: 30 };

test("pending/retry age uses due time or creation, never fresh bookkeeping", () => {
  for (const status of ["pending", "retry"]) {
    assert.equal(classifyQueueDocument({ status, createdAt: ago(120), updatedAt: ago(0) }, options).state, "overdue_waiting");
    assert.equal(classifyQueueDocument({ status, createdAt: ago(120), nextRunAt: ago(60), updatedAt: ago(0) }, options).state, "overdue_waiting");
    const future = { status, createdAt: ago(5000), nextRunAt: ago(-120) };
    assert.equal(classifyQueueDocument(future, options).state, "future_due");
    assert.equal(classifyQueueDocument(future, options).needsAttention, false);
    assert.equal(classifyQueueDocument({ status, nextRunAt: ago(20) }, options).state, "within_grace");
    assert.equal(canAutoRetryQueueDocument("jobs", { status, createdAt: ago(60) }, options), false);
  }
});

test("only explicit complete retirement excludes failed and active jobs", () => {
  const retirement = { retiredAt: ago(1), retirementReason: "legacy_api_write_retired" };
  for (const status of ["pending", "retry", "processing", "failed"]) {
    const data = { status, type: "bookingAttendanceUpdate", createdAt: ago(200), ...retirement };
    assert.equal(classifyQueueDocument(data, options).state, "retired");
    assert.equal(recentQueueFailure(data, options), false);
    assert.equal(canAutoRetryQueueDocument("jobs", data, options), false);
  }
  assert.equal(isExplicitlyRetired({ retirementReason: "legacy" }), false);
  assert.equal(isExplicitlyRetired({ retiredAt: ago(1) }), false);
  assert.equal(classifyQueueDocument({ status: "failed", type: "bookingAttendanceUpdate" }, options).state, "failed");
});

test("retired worker backlog remains visible but no writeQueue job is auto-retried", () => {
  const data = { status: "processing", updatedAt: ago(90) };
  assert.equal(canAutoRetryQueueDocument("writeQueue", data, options), false);
  assert.equal(canAutoRetryQueueDocument("jobs", data, options), true);
  for (const state of ["intentionally_retired", "permission_unavailable", "unexpected_scheduler_state"]) {
    const policy = { ...options, worker: { state } };
    assert.equal(canAutoRetryQueueDocument("jobs", data, policy), false);
    assert.equal(classifyQueueDocument({ status: "pending", createdAt: ago(60) }, policy).needsAttention, true);
  }
  assert.equal(classifyQueueDocument(data, { ...options, worker: { state: "intentionally_retired" } }).reason, "retired_worker_backlog");
});

test("missing or invalid age evidence needs attention without unsafe retries", () => {
  for (const data of [{ status: "pending" }, { status: "retry", nextRunAt: "invalid", createdAt: ago(90) }, { status: "processing" }]) {
    assert.equal(classifyQueueDocument(data, options).state, "timestamp_unavailable");
    assert.equal(classifyQueueDocument(data, options).needsAttention, true);
    assert.equal(canAutoRetryQueueDocument("jobs", data, options), false);
  }
  assert.equal(healthTimestampMs({ toMillis: () => nowMs }), nowMs);
  assert.equal(healthTimestampMs({ seconds: nowMs / 1000 }), nowMs);
  assert.equal(healthTimestampMs({ toDate: () => { throw new Error("invalid"); } }), null);
});

test("Notion pending/failed ages exclude aliases and lesson waiting states", () => {
  for (const status of ["pending", "failed"]) {
    const data = { status: "pending", notionSync: { status }, updatedAt: ago(120) };
    assert.equal(classifyNotionDocument(data, options).state, `overdue_${status}`);
    assert.equal(classifyNotionDocument({ ...data, notionProjectionControl: { aliasOfRecordId: "owner" } }, options).state, "alias");
    assert.equal(classifyNotionDocument({ ...data, updatedAt: ago(10) }, options).needsAttention, false);
  }
  for (const status of ["pending", "pre_submitted", "before_lesson_waiting"]) {
    assert.equal(classifyNotionDocument({ status, createdAt: ago(2000) }, options).state, "inactive");
    assert.equal(classifyNotionDocument({ status, notionSync: { status: "synced" }, createdAt: ago(2000) }, options).needsAttention, false);
  }
  assert.equal(classifyNotionDocument({ notionSync: { status: "pending" } }, options).needsAttention, true);
  assert.equal(classifyNotionDocument({ surveyType: "group", notionSync: { status: "failed" }, updatedAt: ago(120) }, options).needsAttention, false);
});

test("six pending and two failed display aliases preserve history without health failures", () => {
  const docs = [...Array(6).fill("pending"), ...Array(2).fill("failed")].map((status) => ({
    notionSync: { status }, updatedAt: ago(5000),
    notionProjectionControl: { aliasOfRecordId: "canonical-record" },
  }));
  const before = JSON.stringify(docs);
  assert.equal(docs.filter((data) => classifyNotionDocument(data, options).needsAttention).length, 0);
  assert.equal(JSON.stringify(docs), before);
});

function fakeFirestore(rows, { failRecent = false, failAll = false } = {}) {
  const calls = [];
  return { calls, collection: (name) => {
    const operations = [];
    const query = {
      where(...args) { operations.push(["where", ...args]); return this; },
      orderBy(...args) { operations.push(["orderBy", ...args]); return this; },
      limit(...args) { operations.push(["limit", ...args]); return this; },
      async get() {
        calls.push({ name, operations });
        if (failAll || (failRecent && operations.some(([op]) => op === "orderBy"))) throw Object.assign(new Error("injected"), { code: 7 });
        let selected = [...rows];
        for (const [op, field, comparator, value] of operations) {
          if (op === "where") selected = selected.filter((row) => {
            if (comparator === "in") return value.includes(row[field]);
            const time = healthTimestampMs(row[field]);
            return time !== null && (comparator === ">=" ? time >= value.getTime() : time <= value.getTime());
          });
          if (op === "orderBy") selected.sort((a, b) => healthTimestampMs(b[field]) - healthTimestampMs(a[field]));
          if (op === "limit") selected = selected.slice(0, field);
        }
        return { size: selected.length, docs: selected.map((row) => ({ id: row.id, data: () => row })) };
      },
    };
    return query;
  } };
}

test("recent failure filtering and sorting occur server-side before the 50 cap", async () => {
  const rows = Array.from({ length: 60 }, (_, id) => ({ id: `old-${id}`, status: "failed", updatedAt: ago(20000) }));
  rows.push({ id: "latest", status: "failed", updatedAt: ago(1) });
  const db = fakeFirestore(rows);
  const result = await loadRecentQueueFailures(db, "writeQueue", ["failed"], { nowMs });
  assert.deepEqual(result.docs.map((doc) => doc.id), ["latest"]);
  assert.deepEqual(db.calls[0].operations.map(([op]) => op), ["where", "where", "where", "orderBy", "limit"]);
  assert.deepEqual(db.calls[0].operations.at(-1), ["limit", 50]);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.countIsLowerBound, true);
  assert.equal(result.coverage.queries[1].capped, true);
  assert.equal(db.calls.length, 2);
});

test("undated legacy failures are sampled, retired failures excluded and duplicates merged", async () => {
  const db = fakeFirestore([
    { id: "recent", status: "failed", updatedAt: ago(1) },
    { id: "undated", status: "error" },
    { id: "legacy", status: "failed", failedAt: ago(2) },
    { id: "retired", status: "failed", updatedAt: ago(0), retiredAt: ago(0), retirementReason: "approved" },
    { id: "future", status: "failed", updatedAt: ago(-1) },
  ]);
  const result = await loadRecentQueueFailures(db, "jobs", ["failed", "error"], { nowMs });
  assert.deepEqual(result.docs.map((doc) => doc.id).sort(), ["legacy", "recent", "undated"]);
  assert.equal(result.coverage.complete, true);
});

test("failed or capped reads can never imply a verified current full count", async () => {
  for (const opts of [{ failRecent: true }, { failAll: true }]) {
    const result = await loadRecentQueueFailures(fakeFirestore([], opts), "jobs", ["failed"], { nowMs });
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.countIsLowerBound, true);
    assert.equal(result.coverage.queries[0].errorCode, "7");
  }
  assert.equal(queryCoverage({ size: 50, limit: 50 }).complete, false);
  const rows = Array.from({ length: 60 }, (_, id) => ({ id: String(id), status: "failed", updatedAt: ago(id) }));
  const result = await loadRecentQueueFailures(fakeFirestore(rows), "jobs", ["failed"], { nowMs });
  assert.equal(result.docs.length, 50);
  assert.equal(result.coverage.queries[0].capped, true);
});

test("every recent failure collection has its status/updatedAt composite index", () => {
  const { indexes } = JSON.parse(readFileSync(new URL("../../firebase/kangsain-functions/firestore.indexes.json", import.meta.url)));
  for (const collection of ["adminSyncRequests", "onsiteWelcomeRequests", "studiomateMemoWriteJobs", "studiomateInstructorLessonJobs",
    "eformsignInstructorMemberJobs", "eformsignRefundJobs", "contactSyncJobs", "writeQueue", "alimtalkSends"]) {
    assert.ok(indexes.some((index) => index.collectionGroup === collection && index.queryScope === "COLLECTION" &&
      JSON.stringify(index.fields) === JSON.stringify([{ fieldPath: "status", order: "ASCENDING" }, { fieldPath: "updatedAt", order: "DESCENDING" }])), collection);
  }
});
