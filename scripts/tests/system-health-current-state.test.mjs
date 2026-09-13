import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import {
  canResolveHealthFinding, classifyPrivateRoundIssues, loadSyncRunEvidence,
  recoveredMainFailureIds, studioMateReservationSyncWindow, successfulSyncReport,
  summarizeSyncReports, unresolvedMainWorkflowFailures,
} from "../lib/system-health-current-state.mjs";
import { canAutoRetryQueueDocument, classifyNotionDocument, classifyQueueDocument, queryCoverage } from "../lib/system-health-queue-policy.mjs";
import { classifyCloudReadError, readSystemHealthCloudState } from "../lib/system-health-cloud-state.mjs";

const now = new Date("2026-09-05T02:00:00Z");
const step = (name) => ({ name, exitCode: 0, stdout: { ok: true,
  ...(name === "syncArchiveDashboardDbFromExcels" ? { firebaseSync: { ok: true, firestorePatch: { ok: true } } } : {}),
  ...(name === "syncArchiveDashboardDbFromExport" ? { firestorePatch: { ok: true } } : {}),
} });
const report = (overrides = {}) => ({
  source: "studiomate_excel_emergency_mode", mode: "apply", ok: true, download: true,
  finishedAt: "2026-09-04T10:15:00Z",
  steps: ["download", "memberProfiles", "memberPhoneDedupe", "reservations", "deletedClassLogs"].map(step), ...overrides,
});
const entry = (date, value) => ({ file: `${date}-run-apply.json`, report: value });

test("sync success requires complete source apply, not fresh partial or dry-run output", () => {
  assert.equal(successfulSyncReport(report()), true);
  for (const value of [
    report({ mode: "dry-run" }), report({ source: "child_import" }), report({ download: false }),
    report({ skippedImports: "missing source" }), report({ finishedAt: "invalid" }), report({ steps: [step("download")] }),
    report({ steps: report().steps.map((item) => item.name === "reservations" ? { ...item, stdoutOk: false } : item) }),
  ]) assert.equal(successfulSyncReport(value), false);
});

test("approved sales fallback is successful only with download and DB success", () => {
  const value = report({ source: "archive_dashboard_sales_daily", dbSyncSucceeded: true,
    steps: [step("downloadSalesExcels"), { ...step("syncArchiveDashboardDbFromExcels"), exitCode: 1 }, step("syncArchiveDashboardDbFromExport")] });
  assert.equal(successfulSyncReport(value), true);
  assert.equal(successfulSyncReport({ ...value, steps: value.steps.slice(1) }), false);
  assert.equal(successfulSyncReport({ ...value, dbSyncSucceeded: false }), false);
});

test("nested sales Firestore failures and missing write evidence cannot reset freshness", () => {
  for (const firebaseSync of [undefined, null, { ok: false, firestorePatch: { ok: false, status: 403 } }, { ok: true, firestorePatch: { ok: false } }]) {
    const value = report({ source: "archive_dashboard_sales_daily", dbSyncSucceeded: true,
      steps: [step("downloadSalesExcels"), { ...step("syncArchiveDashboardDbFromExcels"), stdout: { ok: true, firebaseSync } }] });
    assert.equal(successfulSyncReport(value), false);
    assert.equal(summarizeSyncReports([entry("2026-09-05T02", value)], { nowMs: now.getTime(), maxAgeMinutes: 95 }).failedStep, "syncArchiveDashboardDbFromExcels");
  }
});

test("a fresh failure does not reset source freshness or last success", () => {
  const value = summarizeSyncReports([
    entry("2026-09-04T10", report()),
    entry("2026-09-05T01", report({ ok: false, steps: [{ name: "download", exitCode: 1, stderr: "Executable doesn't exist at /runtime/browser\nother detail" }] })),
    { file: "2026-09-05T02-member-import-apply.json", report: report() },
  ], { nowMs: now.getTime(), maxAgeMinutes: 95 });
  assert.equal(value.stale, true);
  assert.equal(value.latestAttemptSucceeded, false);
  assert.equal(value.consecutiveFailures, 1);
  assert.equal(value.lastSuccessAt, report().finishedAt);
  assert.equal(value.missingBrowserExecutable, true);
});

test("fresh completion cannot conceal an old source snapshot", () => {
  const steps = report().steps;
  steps[0].stdout.startedAt = "2026-09-04T10:00:00Z";
  const value = summarizeSyncReports([entry("2026-09-05T02", report({ steps, finishedAt: now.toISOString() }))], { nowMs: now.getTime(), maxAgeMinutes: 95 });
  assert.equal(value.stale, true);
  assert.equal(value.successAgeMinutes, 960);
});

test("missing, corrupt and child reports cannot create success evidence", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "health-evidence-test-"));
  try {
    writeFileSync(path.join(dir, "2026-09-04-run-apply.json"), JSON.stringify(report()));
    writeFileSync(path.join(dir, "2026-09-05-run-apply.json"), "incomplete json");
    writeFileSync(path.join(dir, "2026-09-06-run-dry-run.json"), JSON.stringify(report()));
    const result = loadSyncRunEvidence(dir, { nowMs: now.getTime(), maxAgeMinutes: 95 });
    assert.equal(result.latestAttemptSucceeded, false);
    assert.equal(result.consecutiveFailures, 1);
    assert.equal(loadSyncRunEvidence(path.join(dir, "missing")).lastSuccessAt, "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reservation sync catches up across a failed midnight boundary without shrinking the future range", () => {
  const result = studioMateReservationSyncWindow({
    now: new Date("2026-09-07T03:00:00Z"),
    evidence: {
      latestAttemptSucceeded: false,
      lastSuccessAt: "2026-09-04T10:08:28Z",
      reservationRange: { startDate: "2026-09-04", endDate: "2026-09-13" },
    },
  });
  assert.deepEqual(result, {
    startDate: "2026-09-04",
    endDate: "2026-09-20",
    catchup: true,
    reason: "recover_gap_since_last_success",
    today: "2026-09-07",
  });
});

test("reservation sync performs one overnight catch-up and then returns to the current day", () => {
  const overnight = studioMateReservationSyncWindow({
    now: new Date("2026-09-07T00:00:00Z"),
    evidence: {
      latestAttemptSucceeded: true,
      lastSuccessAt: "2026-09-06T14:15:00Z",
      reservationRange: { startDate: "2026-09-06", endDate: "2026-09-13" },
    },
  });
  assert.equal(overnight.startDate, "2026-09-06");
  assert.equal(overnight.catchup, true);

  const current = studioMateReservationSyncWindow({
    now: new Date("2026-09-07T01:00:00Z"),
    evidence: {
      latestAttemptSucceeded: true,
      lastSuccessAt: "2026-09-07T00:15:00Z",
      reservationRange: { startDate: "2026-09-06", endDate: "2026-09-20" },
    },
  });
  assert.equal(current.startDate, "2026-09-07");
  assert.equal(current.catchup, false);
});

test("reservation catch-up is capped and explicit ranges remain exact", () => {
  const capped = studioMateReservationSyncWindow({
    now: new Date("2026-09-07T03:00:00Z"),
    evidence: {
      latestAttemptSucceeded: false,
      lastSuccessAt: "2026-08-20T00:00:00Z",
      reservationRange: { startDate: "2026-08-20", endDate: "2026-08-30" },
    },
  });
  assert.equal(capped.startDate, "2026-08-31");
  assert.equal(capped.endDate, "2026-09-20");

  const explicit = studioMateReservationSyncWindow({
    now: new Date("2026-09-07T03:00:00Z"),
    requestedStartDate: "2026-09-04",
    requestedEndDate: "2026-09-04",
    evidence: capped,
  });
  assert.deepEqual(explicit, {
    startDate: "2026-09-04",
    endDate: "2026-09-04",
    catchup: false,
    reason: "explicit_range",
    today: "2026-09-07",
  });
});

const run = (id, conclusion, overrides = {}) => ({ databaseId: id, workflowDatabaseId: 42, workflowName: "affected-check", headBranch: "main", status: "completed", conclusion, createdAt: `2026-09-0${id}T00:00:00Z`, ...overrides });
test("CI requires later success for the same workflow and branch", () => {
  assert.deepEqual(unresolvedMainWorkflowFailures([run(1, "failure"), run(2, "success")]), []);
  assert.deepEqual(recoveredMainFailureIds([run(1, "failure"), run(2, "success")]), ["1"]);
  for (const other of [run(1, "success"), run(3, "success", { headBranch: "feature" }), run(3, "success", { workflowDatabaseId: 99 }), run(3, "cancelled"), run(3, "", { status: "queued" })]) {
    assert.equal(unresolvedMainWorkflowFailures([run(2, "failure"), other]).some((item) => item.databaseId === 2), true);
    assert.deepEqual(recoveredMainFailureIds([run(2, "failure"), other]), []);
  }
});

test("round checker distinguishes unchecked attendance, cancellation and exclusions", () => {
  const booking = (id, data = {}) => ({ id, data: { lessonType: "private", lectureDate: "2026-09-04", appStatus: "reserved", attendanceStatus: "unchecked", sessionOrder: { privateCumulativeRound: 3 }, ...data } });
  const result = classifyPrivateRoundIssues([
    booking("unchecked"), booking("unchecked-without-round", { sessionOrder: { counted: false, excludedReason: "past_unchecked_attendance" } }), booking("cancelled", { status: "cancelled" }),
    booking("source-cancelled", { sourceStatus: "lecture_deleted" }),
    booking("attended", { attendanceStatus: "attended" }),
    booking("future", { lectureDate: "2026-09-06" }),
    booking("duplicate", { archiveBooking: { isCanonical: false } }),
    booking("absent", { attendanceStatus: "absent" }), booking("group", { lessonType: "group" }),
  ], { now });
  assert.deepEqual(result.pastUncheckedWithOrder.map((doc) => doc.id), ["unchecked"]);
  assert.deepEqual(result.pastUnchecked.map((doc) => doc.id), ["unchecked", "unchecked-without-round"]);
  assert.deepEqual(result.cancelledWithOrder.map((doc) => doc.id), ["cancelled", "source-cancelled"]);
  assert.deepEqual(result.countable.map((doc) => doc.id), ["attended", "future"]);
  assert.deepEqual(result.excludedWithOrder.map((doc) => doc.id), ["duplicate", "absent"]);
});

test("resolution requires completed coverage and positive CI recovery evidence", () => {
  const finding = { findingId: "old", checkKey: "github-ci", sourceRefs: ["workflow:main:1"] };
  assert.equal(canResolveHealthFinding(finding, new Set(), new Set(["github-ci"])), false);
  assert.equal(canResolveHealthFinding(finding, new Set(), new Set(["github-ci", "github-run:1"])), true);
  assert.equal(canResolveHealthFinding(finding, new Set(["old"]), new Set(["github-ci", "github-run:1"])), false);
  assert.equal(canResolveHealthFinding({ ...finding, checkKey: "private-attendance", sourceRefs: ["bookings/1"] }, new Set(), new Set(["private-attendance"])), false);
  assert.equal(canResolveHealthFinding(
    { ...finding, checkKey: "private-chart-state", sourceRefs: ["privateLessonChartRequests/1", "bookings/1"] },
    new Set(),
    new Set(["private-chart-state", "privateLessonChartRequests/1", "bookings/1"]),
  ), true);
  assert.equal(canResolveHealthFinding({ findingId: "admin", title: "운영자 Firestore 권한 검증 실패" }, new Set(), new Set()), false);
});

// Parse the real runner functions so persistence ordering and read-only guards cannot drift from these tests.
const require = createRequire(import.meta.url);
const ts = require("../../firebase/kangsain-functions/functions/node_modules/typescript");
const runner = readFileSync(new URL("../run-system-health-check.mjs", import.meta.url), "utf8");
const tree = ts.createSourceFile("health.mjs", runner, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function runnerFunction(name, globals) {
  const node = tree.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, name);
  return vm.runInNewContext(`(${node.getText(tree)})`, globals);
}
const baseGlobals = (overrides = {}) => ({
  READ_ONLY: true, MODE: "weekly", REPAIR: false, findings: [], repairs: [], checked: [], completedChecks: new Set(), now,
  runId: "synthetic-health-test", REPORT_DIR: "/unused", path, console: { log() {} },
  effectiveSeverityRank: () => 0, needsCodexAction: () => false, ...overrides,
});

function findingHarness(overrides = {}) {
  const globals = baseGlobals({
    stableId: runnerFunction("stableId", { require }), cleanArray: (value) => Array.isArray(value) ? value.filter(Boolean) : [],
    ...overrides,
  });
  globals.addFinding = runnerFunction("addFinding", globals);
  globals.reportQueueCoverage = runnerFunction("reportQueueCoverage", globals);
  return globals;
}

function resolves(prior, current) {
  return canResolveHealthFinding(prior, new Set(current.findings.map((finding) => finding.findingId)), current.completedChecks);
}

async function queueAudit({ active = [], failed = [], activeError = null, failuresComplete = true } = {}) {
  const globals = findingHarness({
    RECENT_FAILURE_MINUTES: 10080, db: {}, queueWorkers: new Map(), classifyQueueDocument, queryCoverage, canAutoRetryQueueDocument,
    loadStatusDocs: async () => { if (activeError) throw activeError; return active; },
    loadRecentQueueFailures: async () => ({ docs: failed, coverage: { complete: failuresComplete } }),
  });
  await runnerFunction("inspectQueue", globals)({ collection: "jobs", area: "queue", title: "queue", staleStatuses: ["processing"], staleMinutes: 30 });
  return globals;
}

test("queue age/failure identity is stable across counts and date errors, then resolves on full verification", async () => {
  const past = new Date(now.getTime() - 7200000);
  const first = await queueAudit({ active: [
    { id: "old", data: { status: "pending", createdAt: past } },
    { id: "undated", data: { status: "retry" } },
  ], failed: [{ id: "failed-1" }] });
  assert.deepEqual(first.findings.map((finding) => finding.checkKey), ["queue:jobs:age", "queue:jobs:failed"]);
  const changed = await queueAudit({ active: [{ id: "new-undated", data: { status: "pending" } }], failed: [{ id: "failed-2" }, { id: "failed-3" }] });
  assert.deepEqual(changed.findings.map((finding) => finding.findingId), first.findings.map((finding) => finding.findingId));
  assert.equal(first.findings.every((prior) => !resolves(prior, changed)), true);
  const healthy = await queueAudit();
  assert.equal(first.findings.every((prior) => resolves(prior, healthy)), true);
  assert.equal(healthy.completedChecks.has("queue:jobs:coverage"), true);
});

test("capped and permission-failed queue reads preserve prior age, failure and coverage findings", async () => {
  const prior = await queueAudit({ active: [{ id: "overdue", data: { status: "pending", createdAt: new Date(0) } }], failed: [{ id: "failed" }] });
  const capped = await queueAudit({
    active: Array.from({ length: 250 }, (_, id) => ({ id: String(id), data: { status: "pending", nextRunAt: new Date(now.getTime() + 60000) } })),
    failuresComplete: false,
  });
  const denied = await queueAudit({ activeError: { code: 7 }, failuresComplete: false });
  const coverage = capped.findings.find((finding) => finding.checkKey === "queue:jobs:coverage");
  assert.ok(coverage);
  assert.equal(denied.findings[0].findingId, coverage.findingId);
  for (const partial of [capped, denied]) {
    assert.equal(prior.findings.every((finding) => !resolves(finding, partial)), true);
    assert.equal(partial.completedChecks.size, 0);
  }
  assert.equal(resolves(coverage, await queueAudit()), true);
});

async function notionAudit(rows, error = null) {
  const globals = findingHarness({ classifyNotionDocument, queryCoverage, db: { collection: (collection) => ({
    where(field, op, statuses) {
      assert.equal(field, "notionSync.status");
      assert.equal(op, "in");
      assert.deepEqual(Array.from(statuses), ["pending", "failed"]);
      return this;
    },
    limit(limit) { assert.equal(limit, 250); return this; },
    async get() {
      if (collection === "privateLessonChartRecords" && error) throw error;
      return { docs: collection === "privateLessonChartRecords" ? rows.map((data, index) => ({ id: String(index), data: () => data })) : [] };
    },
  }) } });
  await runnerFunction("checkNotionSync", globals)();
  return globals;
}

test("Notion stable findings resolve for fully verified aliases, never a capped or failed sample", async () => {
  const first = await notionAudit([{ notionSync: { status: "pending" }, updatedAt: new Date(0) }]);
  const changed = await notionAudit(Array(3).fill({ notionSync: { status: "failed" }, updatedAt: new Date(0) }));
  const prior = first.findings[0];
  assert.equal(prior.checkKey, "notion:privateLessonChartRecords:sync");
  assert.equal(changed.findings[0].findingId, prior.findingId);
  const alias = { notionSync: { status: "pending" }, notionProjectionControl: { aliasOfRecordId: "owner" } };
  const partial = await notionAudit(Array(250).fill(alias));
  const denied = await notionAudit([], { code: 7 });
  assert.equal(resolves(prior, partial), false);
  assert.equal(resolves(prior, denied), false);
  const coverage = partial.findings[0];
  assert.equal(coverage.checkKey, "notion:privateLessonChartRecords:coverage");
  assert.equal(coverage.findingId, denied.findings[0].findingId);
  const healthy = await notionAudit([...Array(6).fill(alias), ...Array(2).fill({ ...alias, notionSync: { status: "failed" } })]);
  assert.equal(resolves(prior, healthy), true);
  assert.equal(resolves(coverage, healthy), true);
});

async function cloudAudit({ deniedCode, partial = false, noBackup = false, newSchedule = false } = {}) {
  const database = { name: "projects/test/databases/(default)", uid: "test-generation",
    deleteProtectionState: "DELETE_PROTECTION_ENABLED", pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_ENABLED" };
  const request = async ({ url, method }) => {
    assert.equal(method, "GET");
    if (deniedCode) throw { code: deniedCode };
    if (url.endsWith("/backupSchedules")) return { data: { backupSchedules: [{ dailyRecurrence: {}, createTime: new Date(newSchedule ? now.getTime() - 3600000 : 0).toISOString() }] } };
    if (url.endsWith("/backups")) return { data: { unreachable: partial ? ["test-region"] : [], backups: noBackup ? [] : [
      { database: database.name, databaseUid: database.uid, state: "READY", snapshotTime: now.toISOString(), expireTime: new Date(now.getTime() + 3600000).toISOString() },
    ] } };
    if (url.includes("cloudscheduler")) return { data: { state: "ENABLED", schedule: "*/10 * * * *" } };
    return { data: database };
  };
  const globals = findingHarness({ PROJECT_ID: "test", queueWorkers: new Map(), classifyCloudReadError,
    require: () => ({ GoogleAuth: class { request(options) { return request(options); } } }),
    readSystemHealthCloudState: (options) => readSystemHealthCloudState({ ...options,
      schedulers: [{ functionName: "scheduledProcessContactSyncJobs", expectedState: "ENABLED", collection: "contactSyncJobs" }],
    }),
  });
  await runnerFunction("checkCloudMetadata", globals)();
  return globals;
}

test("cloud permission findings keep stable IDs and resolve only after positive metadata reads", async () => {
  const denied = await cloudAudit({ deniedCode: 403 });
  const unavailable = await cloudAudit({ deniedCode: 500 });
  assert.equal(denied.findings.every((finding) => finding.checkKey.startsWith("cloud:")), true);
  assert.deepEqual(denied.findings.map((finding) => finding.findingId), unavailable.findings.map((finding) => finding.findingId));
  assert.equal(denied.completedChecks.size, 0);
  const healthy = await cloudAudit();
  assert.equal(denied.findings.every((finding) => resolves(finding, healthy)), true);
  const partial = await cloudAudit({ partial: true });
  assert.equal(resolves(denied.findings.find((finding) => finding.checkKey === "cloud:firestore-backups"), partial), false);
  assert.equal(partial.completedChecks.has("cloud:cloud-metadata"), false);
});

test("backup failure cannot resolve on partial reads or first-schedule grace without a READY backup", async () => {
  const failed = await cloudAudit({ noBackup: true });
  const prior = failed.findings.find((finding) => finding.checkKey === "cloud:firestore-backup-state");
  assert.ok(prior);
  assert.equal(resolves(prior, await cloudAudit({ partial: true })), false);
  assert.equal(resolves(prior, await cloudAudit({ noBackup: true, newSchedule: true })), false);
  assert.equal(resolves(prior, await cloudAudit()), true);
});

test("MCP finding IDs are per URL and disabling checks cannot erase an unverified route failure", async () => {
  const url = "https://test.invalid/mcp";
  const audit = async (status) => {
    const globals = findingHarness({ process: { env: status === null ? {} : { SYSTEM_HEALTH_MCP_URLS: url } },
      probeMcpEndpoints: async () => [{ url, status, state: status === 405 ? "reachable_not_functionally_verified" : "unreachable", needsAttention: status !== 405 }],
    });
    await runnerFunction("checkMcpReachability", globals)();
    return globals;
  };
  const failed = await audit(502);
  const changed = await audit(404);
  assert.equal(failed.findings[0].checkKey, `mcp:${url}`);
  assert.equal(failed.findings[0].findingId, changed.findings[0].findingId);
  assert.equal(resolves(failed.findings[0], await audit(null)), false);
  assert.equal(resolves(failed.findings[0], await audit(405)), true);
});

test("optional MCP endpoints are disabled without configuration and never raise findings", async () => {
  for (const env of [{}, { SYSTEM_HEALTH_MCP_URLS: "" }, { SYSTEM_HEALTH_MCP_URLS: " , \n " }]) {
    const checked = [];
    await runnerFunction("checkMcpReachability", baseGlobals({
      checked, process: { env },
      probeMcpEndpoints: () => assert.fail("unconfigured MCP must not be probed"),
      addFinding: () => assert.fail("unconfigured MCP must not create findings"),
    }))();
    assert.equal(checked.length, 1);
    assert.equal(checked[0].id, "caddy-mcp-reachability");
    assert.equal(checked[0].checks[0].state, "disabled_not_configured");
    assert.equal(checked[0].checks[0].needsAttention, false);
  }
});

test("explicit MCP endpoints still warn for unreachable routes only", async () => {
  const emitted = [];
  const urls = ["https://first.invalid/mcp", "https://second.invalid/mcp"];
  let probes = 0;
  await runnerFunction("checkMcpReachability", baseGlobals({
    process: { env: { SYSTEM_HEALTH_MCP_URLS: urls.join(", ") } },
    probeMcpEndpoints: async (actualUrls) => {
      probes++;
      assert.deepEqual(Array.from(actualUrls), urls);
      return [
        { url: urls[0], state: "unreachable", status: 502, needsAttention: true },
        { url: urls[1], state: "reachable_not_functionally_verified", status: 405, needsAttention: false },
      ];
    },
    addFinding: (finding) => emitted.push(finding),
  }))();
  assert.equal(probes, 1);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].severity, "warning");
  assert.equal(emitted[0].sourceRefs[0], urls[0]);
  assert.equal(emitted[0].autoRepairable, false);
});

test("read-only mode cannot persist findings, queues, files or emails", async () => {
  const forbidden = () => { assert.fail("unexpected mutation"); };
  await runnerFunction("writeResults", baseGlobals({ writeFileSync: forbidden, db: { collection: forbidden }, sendAttentionEmail: forbidden, syncCodexActionQueue: forbidden }))();
  for (const name of ["runWeeklyArtifactRetention", "checkAdminAccess"]) {
    await runnerFunction(name, baseGlobals({ spawnSync: forbidden }))();
  }
  await runnerFunction("refreshRuntimeCheckout", baseGlobals({
    HOME: "/home/test", ROOT: "/home/test/dev/archive-in-runtime", spawnSync: forbidden,
    gitDirty: () => false, execText: () => "0 0",
  }))();
});

test("read-only orchestration and LaunchAgent checks never write status", async () => {
  const forbidden = () => { assert.fail("unexpected mutation"); };
  const functions = ["refreshRuntimeCheckout", "checkBrowserRuntime", "checkLaunchAgents", "checkWebSurfaces", "checkAdminAccess", "checkQueues", "checkPrivateLessonConsistency", "checkAlimtalk", "checkDataSourceAndReports", "checkGitAndCi", "runWeeklyArtifactRetention", "writeResults"];
  const invoked = [];
  await runnerFunction("main", baseGlobals({ mkdirSync: forbidden, ...Object.fromEntries(functions.map((name) => [name, () => invoked.push(name)])) }))();
  assert.equal(invoked.length, functions.length);
  await runnerFunction("checkLaunchAgents", baseGlobals({
    AUTOMATIONS: [{ id: "fixture", title: "fixture", plist: "/fixture", maxAgeMinutes: 95 }],
    existsSync: () => true,
    launchAgentState: () => ({ loaded: true, state: "not running", runs: 1, lastExitCode: 0 }),
    latestEvidence: () => ({ exists: true, ageMinutes: 1 }),
    completedChecks: new Set(), db: {}, recordAutomationStatus: forbidden,
  }))();
});

test("run-evidence write failure prevents any queue resolution", async () => {
  let queueWrites = 0;
  const error = new Error("injected run write failure");
  await assert.rejects(runnerFunction("writeResults", baseGlobals({
    READ_ONLY: false, writeFileSync() {}, FieldValue: { serverTimestamp: () => null },
    db: { collection: () => ({ doc: () => ({ set: async () => { throw error; } }) }) },
    syncCodexActionQueue: async () => { queueWrites++; },
  }))(), error);
  assert.equal(queueWrites, 0);
});

test("queue age uses stored data timestamps, not missing wrapper fields", async () => {
  const emitted = [];
  const data = { status: "processing", updatedAt: now };
  await runnerFunction("inspectQueue", baseGlobals({
    RECENT_FAILURE_MINUTES: 10080,
    loadStatusDocs: async (_collection, statuses) => statuses.includes("processing") ? [{ id: "job", status: "processing", data }] : [],
    db: {}, queueWorkers: new Map(), classifyQueueDocument, queryCoverage,
    loadRecentQueueFailures: async () => ({ docs: [], coverage: { complete: true } }),
    reportQueueCoverage() {}, addFinding: (finding) => emitted.push(finding),
  }))({ collection: "queue", title: "queue", activeStatuses: ["processing"], staleStatuses: ["processing"], staleMinutes: 20 });
  assert.deepEqual(emitted, []);
});

test("read-only and retired writeQueue cannot trigger any recovery write", async () => {
  const forbidden = () => assert.fail("unexpected queue mutation");
  for (const globals of [{ READ_ONLY: true, APPLY: true }, { READ_ONLY: false, APPLY: true }]) {
    const repair = runnerFunction("repairStaleQueue", baseGlobals({ ...globals, db: { batch: forbidden } }));
    assert.equal((await repair({ collection: "writeQueue" }, [{ data: { status: "processing" } }])).updated, 0);
    if (globals.READ_ONLY) assert.equal((await repair({ collection: "contactSyncJobs" }, [])).updated, 0);
  }
});

test("retired worker backlog is reported without repair even with repair enabled", async () => {
  const emitted = [];
  const rows = [{ id: "legacy", status: "processing", data: { status: "processing", updatedAt: new Date(now.getTime() - 7200000) } }];
  await runnerFunction("inspectQueue", baseGlobals({
    REPAIR: true, RECENT_FAILURE_MINUTES: 10080, db: {}, classifyQueueDocument, queryCoverage, canAutoRetryQueueDocument,
    queueWorkers: new Map([["writeQueue", { state: "intentionally_retired" }]]),
    loadStatusDocs: async () => rows,
    loadRecentQueueFailures: async () => ({ docs: [], coverage: { complete: true } }),
    repairStaleQueue: () => assert.fail("must not retry retired worker"), reportQueueCoverage() {},
    addFinding: (finding) => emitted.push(finding),
  }))({ collection: "writeQueue", title: "queue", activeStatuses: ["processing"], staleStatuses: ["processing"], staleMinutes: 20 });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].autoRepairable, false);
  assert.equal(emitted[0].repairStatus, "not_attempted");
});

test("unavailable or capped evidence produces an actionable finding even with zero rows", () => {
  const emitted = [];
  const check = runnerFunction("reportQueueCoverage", baseGlobals({ addFinding: (finding) => emitted.push(finding) }));
  check({ title: "queue", collection: "jobs" }, { failures: queryCoverage({ limit: 50, error: { code: 7 } }) });
  assert.equal(emitted[0].severity, "action_required");
  assert.equal(emitted[0].autoRepairable, false);
});

test("GitHub query failure cannot overwrite prior workflow failure identity", async () => {
  const emitted = [];
  await runnerFunction("checkGitAndCi", baseGlobals({
    gitWorktrees: () => [], gitDirty: () => false, GH: "gh", ROOT: "/unused", process: { env: {} },
    spawnSync: () => ({ status: 1, stderr: "query failed" }), addFinding: (finding) => emitted.push(finding),
  }))();
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].checkKey, "github-ci-lookup");
});

test("previously flagged bookings remain covered outside the recent sample", async () => {
  const doc = (id, data) => ({ id, exists: true, data: () => data });
  const current = doc("current", { lessonType: "group" });
  const prior = doc("prior", { lessonType: "private" });
  const query = { orderBy() { return this; }, limit() { return this; }, get: async () => ({ size: 1, docs: [current] }), doc: (id) => ({ id }) };
  const rows = await runnerFunction("loadRecentBookings", baseGlobals({ db: {
    collection: (name) => name === "bookings" ? query : { where: () => ({ get: async () => ({ docs: [doc("finding", { area: "private", sourceRefs: ["bookings/prior"] })] }) }) },
    getAll: async (...refs) => { assert.equal(refs[0].id, "prior"); return [prior]; },
  } }))(1);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].id, "prior");
});
