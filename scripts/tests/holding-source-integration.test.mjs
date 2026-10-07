import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const read = file => readFile(new URL(file, root), "utf8");

test("hourly import keeps the holding sidecar opt-in and nonfatal to unrelated member imports", async () => {
  const source = await read("scripts/run-studiomate-excel-emergency-mode.mjs");
  assert.match(source, /if \(process\.env\.STUDIOMATE_HOLDING_SOURCE_SCAN === "enabled"\)/);
  assert.match(source, /runStep\("holdingSource", \["scripts\/run-studiomate-holding-sync\.mjs", "--from-roster", "--apply"\]\)/);
  assert.match(source, /if \(holdingRosterReady\(steps\)\)/);
  assert.match(source, /const sidecars = new Set\(\["staffEmployment", "holdingSource"\]\)/);
  assert.match(source, /!sidecars\.has\(step\.name\)/);
});

test("both queue entrypoints route holding to the guarded dispatcher, not generic retry bookkeeping", async () => {
  const source = await read("firebase/kangsain-functions/functions/src/alimtalk/processAlimtalkQueue.ts");
  assert.match(source, /await reconcileHoldingNoticeQueue\(\)/);
  assert.match(source, /if \(isHoldingNoticeCandidate\(claimed\)\) \{\s*holdingProcessed = true;\s*const outcome = await processClaimedHoldingNotice\(claimed\)/);
  assert.match(source, /if \(isHoldingNoticeCandidate\(claimed\)\) return processClaimedHoldingNotice\(claimed\)/);
  assert.match(source, /if \(isHoldingNoticeCandidate\(candidate\)\) return sendHoldingNotice\(candidate\)/);
  assert.match(source, /if \(current\.status !== "queued"\) return null/);
  assert.doesNotMatch(source, /holdingApprovalSnapshot: holdingApprovalSnapshot\(current\)/, "claim cannot replace the human-reviewed snapshot");
  assert.match(source, /if \(claim\.exists \|\| send\.exists\) return null/);
});

test("holding approval binds the displayed snapshot to an authenticated manager", async () => {
  const source = await read("firebase/kangsain-functions/functions/src/exports/alimtalk.ts");
  const callable = source.slice(source.indexOf("export const operatorApproveHoldingNotice"));
  assert.match(callable, /requireStaff\(request\)/);
  assert.match(callable, /requireManager\(staff\)/);
  assert.match(callable, /expectedSnapshot: request\.data\?\.expectedSnapshot/);
  assert.match(callable, /reviewedByUid: request\.auth!\.uid/);
  assert.match(callable, /studioId: staff\.studioId/);
});

test("source worker revokes unverified sources, checks current scan authorization, and never sends", async () => {
  const source = await read("scripts/run-studiomate-holding-sync.mjs");
  assert.match(source, /if \(!authorized\(config, target\)\)/);
  assert.match(source, /identityVerified: false/);
  assert.match(source, /await invalidate\(target, "holding_native_readback_failed"\)/);
  assert.match(source, /scanTargets\?\.some/);
  assert.match(source, /holdingRosterReadbackIssue\(target, currentProfile\)/);
  assert.match(source, /if \(apply && authorized\(settings, target\)\)/);
  assert.doesNotMatch(source, /send-many|sendHoldingNotice|dispatchHoldingNotice|queueHoldingNotice/);
});

test("roster observer consumes raw rows before cleanup without relying on active-only profile data", async () => {
  const source = await read("scripts/emergency-import-studiomate-member-excel.mjs");
  assert.match(source, /STUDIOMATE_HOLDING_ROSTER_OBSERVER === "shadow"/);
  assert.match(source, /observeHoldingRoster\(\{ db, rows,/);
  assert.ok(source.indexOf("summary.holdingRosterDiscovery = await observeHoldingRoster") <
    source.indexOf("summary.sourceFileRetention = await cleanupImportedSourceFiles"));
  const hook = source.slice(source.indexOf("// Reuse parsed raw rows"), source.indexOf("summary.sourceFileRetention"));
  assert.doesNotMatch(hook, /activeTickets|member360|sendHoldingNotice/);
});

test("runtime disabled guard precedes source scans and provider transport is bounded", async () => {
  const source = await read("firebase/kangsain-functions/functions/src/alimtalk/holdingNoticeRuntime.ts");
  const reconcile = source.slice(source.indexOf("export async function reconcileHoldingNoticeQueue"));
  assert.ok(reconcile.indexOf("if (!holdingAutomationEnabled") < reconcile.indexOf("db.collection(HOLDING_NOTICE_SOURCE_COLLECTION)"));
  assert.match(source, /const deadline = Date\.now\(\) \+ 25_000/);
  assert.match(source, /signal: AbortSignal\.timeout\(20_000\)/);
  assert.match(source, /allowDuplicates: false/);
  assert.match(source, /disableSms: true/);
  assert.match(source, /return dispatchHoldingNotice\(dependencies\(\), candidate/);
});

test("source files are content-addressed and collector always closes its owned context/lock", async () => {
  const source = await read("scripts/collect-studiomate-holding-source.mjs");
  assert.match(source, /\$\{memberId\}-\$\{normalized\.observationFingerprint\}/);
  assert.match(source, /finally \{ await release\(\); \}/);
  assert.match(source, /process\.once\("SIGTERM", terminate\)/);
  assert.match(source, /mode: 0o600/);
});
