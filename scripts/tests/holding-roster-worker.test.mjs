import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { planHoldingRoster, holdingRosterReadbackIssue, holdingRosterReadbackIsCurrent } from "../lib/studiomate-holding-roster.mjs";

const time = "2026-10-07T03:00:00.000Z";
const profile = { memberId: "101", studioId: "5330", phone: "01000001001" };
function job() {
  const plan = planHoldingRoster({ rows: [{ 전화번호: profile.phone, 수강권명: "Synthetic", 수강권상태: "정지중 (8일 정지)" }],
    profiles: [profile], source: { sourceImportId: "fixture", downloadedAt: time, applied: true, complete: true, studioId: "5330" }, now: time });
  return plan.jobs[0];
}
test("readback jobs are hints bound to a current native profile, never send authorization", () => {
  const current = job();
  assert.equal(holdingRosterReadbackIssue(current, profile), "");
  assert.equal(holdingRosterReadbackIssue(current, { ...profile, phone: "01000001002" }), "holding_roster_native_member_recheck_failed");
  assert.equal(holdingRosterReadbackIssue(current, { ...profile, studioId: "9999" }), "holding_roster_native_member_recheck_failed");
  for (const patch of [{ memberId: "excel_101" }, { jobId: "forged" }, { memberKey: "bad" }, { discoveryVersion: "bad" },
    { sendAllowed: true }, { absenceConfirmed: true }, { status: "observed" }, { downloadedAt: "invalid" },
    { sourceImportId: "" }, { studioId: "9999" }, { ticketName: "Other" }])
    assert.equal(holdingRosterReadbackIssue({ ...current, ...patch }, profile), "holding_roster_job_invalid");
});
test("worker remains bounded, checks roster freshness and preserves audit/write gates", async () => {
  const source = await readFile(new URL("../run-studiomate-holding-sync.mjs", import.meta.url), "utf8");
  assert.match(source, /settings\.rosterDiscoveryEnabled !== true/);
  assert.match(source, /age > 90 \* 60_000/);
  assert.match(source, /\.where\("status", "==", "pending"\)\.limit\(401\)/);
  assert.match(source, /jobs\.size > 400/);
  assert.match(source, /await recordReadback\(job, "review", "holding_roster_job_invalid"\)/);
  assert.match(source, /\.slice\(0, 10\)/);
  assert.match(source, /current\?\.discoveryVersion !== target\.discoveryVersion/);
  assert.match(source, /if \(apply && authorized\(settings, target\)\)/);
  assert.equal((source.match(/if \(!await readbackIsCurrent\(tx, target\)\)/g) || []).length, 2);
  assert.doesNotMatch(source, /send-many|dispatchHoldingNotice|queueHoldingNotice/);
  assert.match(source, /calculationMode !== "live_studiomate_readback"/);
  assert.match(source, /live_ticket_detail_deferred_until_dispatch/);
  const legacy = source.slice(source.indexOf("function authorized"));
  assert.ok(legacy.indexOf('settings.calculationMode === "live_studiomate_readback"') < legacy.indexOf("const run = spawnSync"));
  assert.match(source, /fromRoster && settings\?\.mode === HOLDING_AUTO_MODE/);
  assert.match(source, /scripts\/run-automatic-holding-notices\.ts/);
});
test("superseded readbacks cannot promote or revoke a newer source", () => {
  const target = job();
  assert.equal(holdingRosterReadbackIsCurrent(target, target), true);
  for (const patch of [{ discoveryVersion: "new-version" }, { status: "observed" }, { status: "review" },
    { memberKey: "other" }, { memberId: "102" }, { ticketName: "Other" }, { sendAllowed: true }, { absenceConfirmed: true }])
    assert.equal(holdingRosterReadbackIsCurrent({ ...target, ...patch }, target), false);
  assert.equal(holdingRosterReadbackIsCurrent(undefined, target), false);
});
