import assert from "node:assert/strict";
import test from "node:test";
import { canSkipUnchangedSurveySheet } from "../../firebase/kangsain-functions/functions/src/privateSurvey/sheetSyncCheckpoint";
import { isSocialPublishJobDue, loadDueSocialPublishJobs } from "../../firebase/kangsain-functions/functions/src/social/socialDueJobs";

test("sheet checkpoint skips only a fresh identical revision", () => {
  const now = 100_000_000;
  assert.equal(canSkipUnchangedSurveySheet("12", { version: "12", checkedAtMillis: now - 1 }, now), true);
  for (const [version, checkpoint] of [
    ["13", { version: "12", checkedAtMillis: now }],
    [undefined, { version: "12", checkedAtMillis: now }],
    ["12", undefined],
    ["12", { version: "12", checkedAtMillis: now + 1 }],
    ["12", { version: "12", checkedAtMillis: now - 86_400_000 }],
  ] as const) assert.equal(canSkipUnchangedSurveySheet(version, checkpoint, now), false);
});

test("publish claims respect due times, leases and final states", () => {
  const now = 100_000_000;
  const job = (status: string, due = now, updated = now) => ({
    status, nextRunAt: { toMillis: () => due }, updatedAt: { toMillis: () => updated },
  });
  assert.equal(isSocialPublishJobDue(job("pending"), now), true);
  assert.equal(isSocialPublishJobDue(job("retry", now + 1), now), false);
  assert.equal(isSocialPublishJobDue(job("processing"), now), false);
  assert.equal(isSocialPublishJobDue(job("processing", now, now - 1_800_001), now), true);
  for (const status of ["done", "cancelled", "manual_review", "blocked_config"])
    assert.equal(isSocialPublishJobDue(job(status), now), false);
});

test("social query excludes future jobs before limit and bounds stale claims separately", async () => {
  const queries: unknown[][] = [];
  const collection = { where(...args: unknown[]) {
    const calls: unknown[] = [["where", ...args]]; queries.push(calls);
    const query = {
      where(...a: unknown[]) { calls.push(["where", ...a]); return query; },
      orderBy(...a: unknown[]) { calls.push(["orderBy", ...a]); return query; },
      limit(n: number) { calls.push(["limit", n]); return query; },
      async get() { return { docs: [queries.length] }; },
    }; return query;
  }};
  const now = { toMillis: () => 100_000_000 };
  assert.deepEqual(await loadDueSocialPublishJobs(collection as any, now as any), [1, 2]);
  assert.deepEqual(queries[0], [["where", "status", "in", ["pending", "retry"]], ["where", "nextRunAt", "<=", now], ["orderBy", "nextRunAt", "asc"], ["limit", 30]]);
  assert.equal((queries[1][1] as any)[1], "updatedAt");
  assert.equal((queries[1][1] as any)[3].toMillis(), 98_200_000);
});
