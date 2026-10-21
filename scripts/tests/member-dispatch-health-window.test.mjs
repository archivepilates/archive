import assert from "node:assert/strict";
import test from "node:test";
import { classifyQueueDocument } from "../lib/system-health-queue-policy.mjs";
const midnight = "2026-10-21T15:00:00.000Z";
const at = (value) => Date.parse(value);
test("new overnight member queue is not a stale failure immediately after 09:00", () => {
  const data = { status: "pending", attempts: 0, createdAt: midnight };
  assert.equal(classifyQueueDocument(data, { memberFacing: true, nowMs: at("2026-10-22T00:05:00Z") }).needsAttention, false);
  assert.equal(classifyQueueDocument(data, { memberFacing: true, nowMs: at("2026-10-22T00:31:00Z") }).state, "overdue_waiting");
  assert.equal(classifyQueueDocument(data, { nowMs: at("2026-10-22T00:05:00Z") }).state, "overdue_waiting");
});
test("quiet hours do not hide an attempted, ambiguous, failed, or stuck operation", () => {
  for (const patch of [{ attempts: 1 }, { sendClickedAt: midnight }, { externalEffectStarted: true }, { status: "failed" }, { status: "processing" }])
    assert.equal(classifyQueueDocument({ status: "pending", createdAt: midnight, ...patch }, { memberFacing: true, nowMs: at("2026-10-21T17:00:00Z") }).needsAttention, true);
});
test("prior daytime backlog and missing timestamps still need attention", () => {
  assert.equal(classifyQueueDocument({ status: "pending", attempts: 0, createdAt: "2026-10-21T10:00:00Z" }, { memberFacing: true, nowMs: at("2026-10-21T17:00:00Z") }).needsAttention, true);
  assert.equal(classifyQueueDocument({ status: "pending" }, { memberFacing: true, nowMs: at(midnight) }).state, "timestamp_unavailable");
});
