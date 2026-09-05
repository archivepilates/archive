import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import {
  canResolveHealthFinding, classifyPrivateRoundIssues, loadSyncRunEvidence,
  recoveredMainFailureIds, successfulSyncReport, summarizeSyncReports, unresolvedMainWorkflowFailures,
} from "../lib/system-health-current-state.mjs";

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
  READ_ONLY: true, MODE: "weekly", REPAIR: false, findings: [], repairs: [], checked: [], now,
  runId: "synthetic-health-test", REPORT_DIR: "/unused", path, console: { log() {} },
  effectiveSeverityRank: () => 0, needsCodexAction: () => false, ...overrides,
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
    minutesSince: (value) => value === now ? 0 : Infinity,
    recentOrUndatedDocs: (docs) => docs, addFinding: (finding) => emitted.push(finding),
  }))({ collection: "queue", title: "queue", activeStatuses: ["processing"], staleStatuses: ["processing"], staleMinutes: 20 });
  assert.deepEqual(emitted, []);
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
