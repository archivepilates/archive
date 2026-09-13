import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBackupState, classifyCloudReadError, classifyDatabaseProtection, classifyMcpReachability,
  classifySchedulerState, probeMcpEndpoints, readSystemHealthCloudState, SYSTEM_HEALTH_SCHEDULERS,
} from "../lib/system-health-cloud-state.mjs";

const nowMs = Date.parse("2026-09-14T12:00:00Z");
const ago = (hours) => new Date(nowMs - hours * 3600000).toISOString();
const database = { name: "projects/test/databases/(default)", uid: "current-db-uid",
  deleteProtectionState: "DELETE_PROTECTION_ENABLED", pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_ENABLED" };
const schedule = (hours = 72) => ({ name: `${database.name}/backupSchedules/daily`, createTime: ago(hours), dailyRecurrence: {}, retention: "604800s" });
const backup = (hours = 24) => ({ database: database.name, databaseUid: database.uid, state: "READY", snapshotTime: ago(hours), expireTime: ago(-120) });
const classify = (overrides = {}) => classifyBackupState({ database, nowMs, schedules: [schedule()], backups: [], ...overrides });

test("first backup schedule gets 26 hours grace, not a verified backup", () => {
  const result = classify({ schedules: [schedule(25)] });
  assert.equal(result.state, "first_schedule_grace");
  assert.equal(result.needsAttention, false);
  assert.equal(result.verifiedBackup, false);
  assert.equal(result.graceUntil, ago(-1));
  assert.equal(classify({ schedules: [schedule(26)] }).needsAttention, true);
  assert.equal(classify({ schedules: [schedule(1)], backups: [{ ...backup(0), state: "CREATING" }] }).state, "first_schedule_grace");
});

test("existing schedules, failed backups, unknown age and new updateTime cannot reset grace", () => {
  for (const overrides of [
    { schedules: [schedule(25), schedule(48)] },
    { schedules: [{ ...schedule(48), updateTime: ago(1) }] },
    { schedules: [{ dailyRecurrence: {} }] },
    { schedules: [schedule(-1)] },
    { schedules: [schedule(1)], backups: [{ ...backup(), state: "NOT_AVAILABLE" }] },
    { schedules: [schedule(1)], backups: [backup(72)] },
  ]) assert.equal(classify(overrides).needsAttention, true);
});

test("backup checks require correct database generation, READY, recent and unexpired", () => {
  assert.equal(classify({ backups: [backup()] }).state, "backup_current");
  for (const row of [backup(27), { ...backup(), database: "other" }, { ...backup(), databaseUid: "old-generation" },
    { ...backup(), state: "CREATING" }, { ...backup(), expireTime: ago(1) }, { ...backup(), snapshotTime: ago(-1) },
  ]) assert.equal(classify({ backups: [row] }).needsAttention, true);
  assert.equal(classify({ backups: [backup()], complete: false }).state, "metadata_incomplete");
  assert.equal(classify({ backups: [backup()], schedules: [] }).state, "backup_schedule_missing");
});

test("database protection missing or disabled is visibly attention-required", () => {
  assert.equal(classifyDatabaseProtection(database).every((row) => !row.needsAttention), true);
  assert.equal(classifyDatabaseProtection({}).every((row) => row.needsAttention), true);
  assert.equal(classifyDatabaseProtection({ ...database, deleteProtectionState: "DELETE_PROTECTION_DISABLED" })[0].needsAttention, true);
});

test("the exact three current workers must be ENABLED and the exact three legacy workers PAUSED", () => {
  assert.deepEqual(SYSTEM_HEALTH_SCHEDULERS.filter((policy) => policy.expectedState === "ENABLED").map((policy) => policy.functionName), [
    "scheduledProcessAlimtalkQueue", "scheduledProcessContactSyncJobs", "scheduledSyncPrivateSurveyResponses",
  ]);
  assert.deepEqual(SYSTEM_HEALTH_SCHEDULERS.filter((policy) => policy.expectedState === "PAUSED" && policy.intentionallyRetired).map((policy) => policy.functionName), [
    "scheduledProcessWriteQueue", "scheduledSyncDashboardDaily", "scheduledAttendanceReminder",
  ]);
  assert.equal(SYSTEM_HEALTH_SCHEDULERS.length, 6);
  for (const policy of SYSTEM_HEALTH_SCHEDULERS) {
    const expected = classifySchedulerState({ state: policy.expectedState, schedule: "every 10 minutes" }, policy);
    assert.equal(expected.needsAttention, false);
    assert.equal(expected.state, policy.intentionallyRetired ? "intentionally_retired" : "enabled");
    assert.equal(classifySchedulerState({ state: policy.expectedState === "ENABLED" ? "PAUSED" : "ENABLED" }, policy).needsAttention, true);
    assert.equal(classifySchedulerState(null, policy).needsAttention, true);
  }
});

test("enabled workers require the full ten-minute cadence, not merely enabled state", () => {
  for (const policy of SYSTEM_HEALTH_SCHEDULERS.filter((item) => item.expectedState === "ENABLED")) {
    for (const schedule of ["*/10 * * * *", "every 10 minutes", "  */10  * * * *  "]) {
      const result = classifySchedulerState({ state: "ENABLED", schedule }, policy);
      assert.equal(result.state, "enabled");
      assert.equal(result.needsAttention, false);
      assert.ok(result.actualSchedule);
    }
    for (const schedule of [undefined, null, "", "every 5 minutes", "every 60 minutes", "*/5 * * * *", "*/10 9-17 * * *", "*/10 * * * 1-5", "0 */10 * * *"]) {
      const result = classifySchedulerState({ state: "ENABLED", schedule }, policy);
      assert.equal(result.state, "unexpected_scheduler_cadence");
      assert.equal(result.needsAttention, true);
      assert.equal(result.expectedSchedule, "*/10 * * * * or every 10 minutes");
    }
  }
  for (const policy of SYSTEM_HEALTH_SCHEDULERS.filter((item) => item.expectedState === "PAUSED")) {
    assert.equal(classifySchedulerState({ state: "PAUSED", schedule: "20 0 * * *" }, policy).state, "intentionally_retired");
  }
});

test("permission unavailable is never quietly classified as healthy or retired", () => {
  for (const error of [{ code: 7 }, { code: "PERMISSION_DENIED" }, { response: { status: 403 } }]) {
    assert.equal(classifyCloudReadError(error).state, "permission_unavailable");
    const result = classifySchedulerState(null, { expectedState: "PAUSED", intentionallyRetired: true }, error);
    assert.equal(result.needsAttention, true);
  }
});

test("cloud reader performs only GET metadata requests and covers every expected worker", async () => {
  const calls = [];
  const result = await readSystemHealthCloudState({ projectId: "test", nowMs, request: async (options) => {
    calls.push(options);
    assert.equal(options.method, "GET");
    assert.equal(options.retry, false);
    assert.equal(options.data, undefined);
    if (options.url.endsWith("/backupSchedules")) return { data: { backupSchedules: [schedule()] } };
    if (options.url.endsWith("/backups")) return { data: { backups: [backup()] } };
    if (options.url.includes("cloudscheduler")) {
      const policy = SYSTEM_HEALTH_SCHEDULERS.find((item) => options.url.includes(`${item.functionName}-`));
      assert.ok(policy);
      return { data: { state: policy.expectedState, schedule: "*/10 * * * *" } };
    }
    return { data: database };
  } });
  assert.equal(calls.length, 9);
  assert.deepEqual(calls.slice(3).map(({ url }) => url), [
    "scheduledProcessAlimtalkQueue", "scheduledProcessContactSyncJobs", "scheduledSyncPrivateSurveyResponses",
    "scheduledProcessWriteQueue", "scheduledSyncDashboardDaily", "scheduledAttendanceReminder",
  ].map((name) => `https://cloudscheduler.googleapis.com/v1/projects/test/locations/asia-northeast3/jobs/firebase-schedule-${name}-asia-northeast3`));
  assert.equal(result.checks.every((row) => !row.needsAttention), true);
  assert.equal(result.workers.writeQueue.state, "intentionally_retired");
  assert.equal(result.workers.contactSyncJobs.state, "enabled");
});

test("metadata reads expose a cadence mismatch and block worker health without extra queries", async () => {
  const calls = [];
  const result = await readSystemHealthCloudState({ projectId: "test", nowMs, request: async ({ url, method }) => {
    calls.push(url);
    assert.equal(method, "GET");
    if (url.endsWith("/backupSchedules")) return { data: { backupSchedules: [schedule()] } };
    if (url.endsWith("/backups")) return { data: { backups: [backup()] } };
    if (url.includes("cloudscheduler")) {
      const policy = SYSTEM_HEALTH_SCHEDULERS.find((item) => url.includes(`${item.functionName}-`));
      return { data: { state: policy.expectedState, schedule: "every 60 minutes" } };
    }
    return { data: database };
  } });
  assert.equal(calls.length, 9);
  assert.equal(result.checks.filter((row) => row.state === "unexpected_scheduler_cadence").length, 3);
  assert.equal(result.workers.contactSyncJobs.needsAttention, true);
  assert.equal(result.workers.contactSyncJobs.actualSchedule, "every 60 minutes");
  assert.equal(result.workers.writeQueue.state, "intentionally_retired");
});

test("cloud permission errors and partial backup locations stay visible", async () => {
  const denied = await readSystemHealthCloudState({ projectId: "test", request: async () => {
    throw Object.assign(new Error("sensitive response must not be logged"), { code: 403 });
  } });
  assert.equal(denied.checks.length, 9);
  assert.equal(denied.checks.every((row) => row.needsAttention && row.state === "permission_unavailable"), true);
  assert.equal(JSON.stringify(denied).includes("sensitive response"), false);
  const partial = await readSystemHealthCloudState({ projectId: "test", schedulers: [], nowMs, request: async ({ url }) => ({ data:
    url.endsWith("backupSchedules") ? { backupSchedules: [schedule(1)] }
      : url.endsWith("backups") ? { backups: [backup()], unreachable: ["test-region"] } : database,
  }) });
  assert.equal(partial.checks.at(-1).state, "metadata_incomplete");
  assert.equal(partial.checks.at(-1).needsAttention, true);
});

test("MCP reachability uses bounded unauthenticated HEAD, never a tool call or retry", async () => {
  const calls = [];
  const result = await probeMcpEndpoints(["https://test.invalid/mcp"], { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { status: 405, body: { cancel: async () => {} } };
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "HEAD");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[0].options.headers, undefined);
  assert.ok(calls[0].options.signal);
  assert.equal(result[0].state, "reachable_not_functionally_verified");
  for (const code of [404, 500, 502, 301]) {
    assert.equal(classifyMcpReachability(code).needsAttention, true);
    assert.equal(classifyMcpReachability(code).severity, "warning");
  }
  const invalid = await probeMcpEndpoints(["https://user:pass@test.invalid/mcp", "https://test.invalid/mcp?token=secret"], {
    fetchImpl: () => assert.fail("must not probe credential-bearing URL"),
  });
  assert.equal(invalid.every((row) => row.state === "invalid_endpoint"), true);
  assert.equal(JSON.stringify(invalid).includes("secret"), false);
});
