import assert from "node:assert/strict";
import test from "node:test";
import { recordAutomationStatus } from "../lib/archive-core-ops-logging.mjs";

test("explicitly unknown run time is not replaced by the health observation time", async () => {
  const writes = [];
  const db = { collection: () => ({ doc: () => ({ set: async data => { writes.push(data); } }) }) };
  const unknown = await recordAutomationStatus(db, { automationId: "synthetic", lastRunAt: null });
  assert.equal(unknown.lastRunAt, "");
  assert.ok(unknown.updatedAt);
  assert.equal(writes[0].lastRunAt, "");
  const known = "2026-11-01T00:30:00Z";
  assert.equal((await recordAutomationStatus(db, { lastRunAt: known })).lastRunAt, known);
  assert.ok((await recordAutomationStatus(db, {})).lastRunAt);
});
