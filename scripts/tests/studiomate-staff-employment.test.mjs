import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { buildStaffEmploymentPlans, validateStaffSnapshot, staffScanDue, STAFF_EMPLOYMENT_SOURCE } from "../lib/studiomate-staff-employment.mjs";

const now = new Date("2026-10-07T05:00:00Z");
function snapshot(staffs = [{ staffId: "1", name: "현재강사", phone: "01011112222", sourceRole: "STAFF", employmentType: "정규직" }]) {
  return { source: STAFF_EMPLOYMENT_SOURCE, studioId: "5330", scanUrl: "https://arcpilates.studiomate.kr/staffs",
    capturedAt: now.toISOString(), total: staffs.length, complete: true,
    filters: { role: "전체", employmentType: "전체", search: "" }, staffs };
}
const existing = [
  { docId: "1", staffId: "1", studiomateStaffId: "1", name: "현재강사", phone: "01011112222", active: true, role: "instructor", uid: "keep-uid" },
  { docId: "2", staffId: "2", studiomateStaffId: "2", name: "이전강사", active: true, role: "instructor", uid: "keep-old-uid" },
  { docId: "operator_1", staffId: "operator_1", name: "운영자", active: true, role: "manager" },
];

test("complete source marks missing staff non-working, preserving auth and history", () => {
  const before = structuredClone(existing);
  const plans = buildStaffEmploymentPlans(snapshot(), existing, { now });
  assert.equal(plans.writes.length, 2);
  assert.equal(plans.writes[0].data.employmentStatus, "current");
  assert.equal(plans.writes[1].data.employmentStatus, "inactive");
  assert.equal(plans.skippedOperators.length, 1);
  for (const p of plans.writes) for (const field of ["active", "role", "uid", "email", "phone", "name", "defaultVehicleNumber", "retiredAt"]) assert.equal(field in p.data, false, field);
  assert.deepEqual(existing, before);
});
test("scoped refresh never marks missing staff or claims complete scan", () => {
  const plans = buildStaffEmploymentPlans(snapshot(), existing, { now, staffIdScope: "1" });
  assert.equal(plans.writes.length, 1);
  assert.throws(() => buildStaffEmploymentPlans(snapshot(), existing, { now, staffIdScope: "2" }), /absent/);
});
test("first-seen instructor is visible without provisioning login access", () => {
  const plans = buildStaffEmploymentPlans(snapshot(), [], { now });
  assert.equal(plans.writes[0].data.employmentStatus, "current");
  assert.equal(plans.writes[0].data.active, false);
  assert.equal(plans.writes[0].data.uid, undefined);
  assert.equal(plans.writes[0].data.role, "instructor");
});
test("rehiring updates employment only, without granting access", () => {
  const plans = buildStaffEmploymentPlans(snapshot(), [{ ...existing[0], active: false, employmentStatus: "inactive" }], { now });
  assert.equal(plans.writes[0].data.employmentStatus, "current");
  assert.equal(plans.writes[0].data.active, undefined);
});
for (const [name, modify] of [
  ["empty", s => { s.staffs = []; s.total = 0; }],
  ["partial page", s => { s.total = 10; }],
  ["incomplete", s => { s.complete = false; }],
  ["filtered", s => { s.filters.role = "강사"; }],
  ["searched", s => { s.filters.search = "현재"; }],
  ["foreign studio", s => { s.studioId = "999"; }],
  ["foreign URL", s => { s.scanUrl = "https://evil.example/staffs"; }],
  ["stale", s => { s.capturedAt = "2026-10-06T00:00:00Z"; }],
  ["missing capture", s => { delete s.capturedAt; }],
  ["future", s => { s.capturedAt = "2026-10-08T00:00:00Z"; }],
  ["missing phone", s => { s.staffs[0].phone = ""; }],
  ["synthetic ID", s => { s.staffs[0].staffId = "excel_1"; }],
  ["duplicate", s => { s.staffs.push(s.staffs[0]); s.total = 2; }],
]) test(`blocks ${name} snapshot before any write plan`, () => {
  const source = snapshot(); modify(source);
  assert.throws(() => validateStaffSnapshot(source, { now }));
});
test("ambiguous phones and changed phone identity require review", () => {
  assert.throws(() => buildStaffEmploymentPlans(snapshot(), [...existing, { docId: "9", phone: "01011112222" }], { now }), /Ambiguous/);
  assert.throws(() => buildStaffEmploymentPlans(snapshot(), [{ ...existing[0], phone: "01099998888" }], { now }), /mismatch/);
});
test("large unexpected roster coverage loss blocks deactivation", () => {
  const previous = [1,2,3,4].map(id => ({ staffId: String(id), studiomateStaffId: String(id), active: true }));
  assert.throws(() => buildStaffEmploymentPlans(snapshot(), previous, { now }), /coverage loss/);
});
test("only full successful scan defers daily work; partial legacy scan is never baseline", () => {
  assert.equal(staffScanDue({}, now), true);
  assert.equal(staffScanDue({ updatedAt: now.toISOString(), scannedStaffs: 1 }, now), true);
  assert.equal(staffScanDue({ fullScanComplete: true, lastFullScanAt: now.toISOString() }, now), false);
  assert.equal(staffScanDue({ fullScanComplete: true, lastFullScanAt: "2026-10-06T05:00:00Z" }, now), true);
  assert.equal(staffScanDue({ fullScanComplete: true, lastFullScanAt: "2026-10-08T05:00:00Z" }, now), true);
});
test("runner uses existing sync, daily gate, shared lock and web source without StudioMate API", () => {
  const script = fs.readFileSync(new URL("../sync-studiomate-staffs-from-browser.mjs", import.meta.url), "utf8");
  const runner = fs.readFileSync(new URL("../run-studiomate-excel-emergency-mode.mjs", import.meta.url), "utf8");
  assert.match(script, /acquireStudioMateBrowserLock/);
  assert.match(script, /owner: "studiomate-staff-browser-scan", waitMs: 0/);
  assert.match(script, /plan\.change === "create_unprovisioned_staff"\) batch\.create\(ref, plan\.data\)/);
  assert.match(script, /await context\.close\(\).*finally \{ await release\(\)/s);
  assert.doesNotMatch(script, /api\.studiomate\.kr|capturedAuthorization|waitForTimeout/);
  assert.match(runner, /staffEmployment.*sync-studiomate-staffs-from-browser\.mjs.*--if-due/);
  assert.match(runner, /const failed = steps\.filter\(\(step\) => step\.name !== "staffEmployment"/);
  assert.match(runner, /step\.name === "staffEmployment" && step\.exitCode !== 0/);
});
