import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  classifyInstructorTicketIntakeCoverage as classify,
  instructorTicketIntakeBounds,
} from "../lib/instructor-ticket-intake-coverage.mjs";
import { instructorLessonRegistrationId } from "../lib/instructor-lesson-registration-contract.mjs";
import { canResolveHealthFinding } from "../lib/system-health-current-state.mjs";

const nowMs = Date.parse("2026-10-29T09:00:00+09:00");
const phone = "01000000001";
const lessonDate = "2026-11-28";
const registrationId = instructorLessonRegistrationId("5330", phone, lessonDate);
const fresh = { latestAttemptSucceeded: true, stale: false, sourceObservedAt: new Date(nowMs - 60_000).toISOString() };
const ticket = (patch = {}) => ({ name: "강사레슨 (2T)", availableFrom: lessonDate, expiresAt: lessonDate,
  status: "사용예정", paymentAmount: 70_000, ...patch });
const profile = (patch = {}, id = "10001") => ({ id, data: { memberId: id, studioId: "5330", phone,
  name: "Synthetic Private Name", memoPreview: "private medical text", memberGrade: "강사회원",
  activeTicketNames: ["강사레슨 (2T)"], activeTickets: [ticket()], ...patch } });
const registration = (patch = {}, id = registrationId) => ({ id, data: { registrationId, studioId: "5330",
  memberPhone: phone, lessonDate, ticketName: "강사레슨 (2T)", status: "completed", ...patch } });
const run = (patch = {}) => classify({ profiles: [profile()], registrations: [], nowMs, sourceEvidence: fresh, ...patch });

test("future exact canonical ticket without registration detects intake gap, never delivery failure", () => {
  const result = run();
  assert.equal(result.complete, true);
  assert.equal(result.healthy, false);
  assert.equal(result.counts.missing_canonical_registration, 1);
  assert.equal(result.items[0].registrationId, registrationId);
  assert.equal(result.items[0].registrationState, "missing");
  assert.equal(result.deliveryVerified, false);
  assert.match(result.findings[0].impact, /미발송·미수신 확정 증거는 아닙니다/);
  assert.equal(result.findings[0].autoRepairable, false);
});

test("normalizes +82 phones and reuses canonical stable registration id", () => {
  const result = run({ profiles: [profile({ phone: "+82 10-0000-0001" })], registrations: [registration()] });
  assert.equal(result.healthy, true);
  assert.equal(result.counts.covered, 1);
  assert.equal(result.items[0].registrationId, registrationId);
});

test("date bounds are exactly 120 KST calendar dates including today, not a month guess", () => {
  const bounds = instructorTicketIntakeBounds(nowMs);
  assert.deepEqual(bounds, { studioId: "5330", startDate: "2026-10-29", endDate: "2027-02-25", days: 120, limit: 501 });
  assert.equal(instructorTicketIntakeBounds(Date.parse("2026-10-28T15:00:00Z")).startDate, "2026-10-29");
  assert.throws(() => instructorTicketIntakeBounds(NaN));
  const result = run({ profiles: [profile({ activeTickets: [
    ticket({ availableFrom: bounds.startDate, expiresAt: bounds.startDate }),
    ticket({ availableFrom: bounds.endDate, expiresAt: bounds.endDate }),
    ticket({ availableFrom: "2027-02-26", expiresAt: "2027-02-26" }),
  ] })] });
  assert.equal(result.counts.missing_canonical_registration, 2);
  assert.equal(result.ignoredTickets, 1);
});

test("ignores old/expired/out-of-range tickets, historical dates and similar ticket names", () => {
  const result = run({ profiles: [profile({ instructorLessonDates: [lessonDate], activeTicketNames: ["강사레슨 (2T)"],
    activeTickets: [ticket({ availableFrom: "2026-10-01", expiresAt: "2026-10-01" }),
      ticket({ expiresAt: "2026-10-28" }), ticket({ availableFrom: "2027-03-01", expiresAt: "2027-03-01" }),
      ticket({ name: "Team 강사레슨" }), ticket({ name: "강사레슨 (2T) 추가" })] })] });
  assert.equal(result.items.length, 0);
  assert.equal(result.ignoredTickets, 5);
  assert.equal(result.healthy, true);
});

test("timestamp dates are compared in KST; malformed/multi-day dates require review", () => {
  const at = Date.parse(`${lessonDate}T00:00:00+09:00`);
  const result = run({ profiles: [profile({ activeTickets: [ticket({ availableFrom: { toMillis: () => at },
    expiresAt: new Date(at) })] })] });
  assert.equal(result.items[0].registrationId, registrationId);
  for (const value of [null, "2026-11-31", "not-a-date"]) {
    assert.equal(run({ profiles: [profile({ activeTickets: [ticket({ availableFrom: value })] })] }).counts.operator_review, 1);
  }
  assert.ok(run({ profiles: [profile({ activeTickets: [ticket({ expiresAt: "2026-11-29" })] })] })
    .items[0].reasons.includes("unsupported_ticket_date_range"));
});

test("ignores wrong-studio profiles and does not use wrong-studio registrations as coverage", () => {
  assert.equal(run({ profiles: [profile({ studioId: "9999" })] }).items.length, 0);
  assert.equal(run({ registrations: [registration({ studioId: "9999" })] }).counts.missing_canonical_registration, 1);
});

test("exact duplicate ticket snapshots dedupe; distinct ticket evidence requires review", () => {
  const result = run({ profiles: [profile({ activeTickets: [ticket(), ticket()] })] });
  assert.equal(result.items.length, 1);
  assert.equal(result.duplicateTickets, 1);
  assert.equal(result.counts.missing_canonical_registration, 1);
  const distinct = run({ profiles: [profile({ activeTickets: [ticket({ userTicketId: "t1" }), ticket({ userTicketId: "t2" })] })] });
  assert.equal(distinct.counts.operator_review, 1);
  assert.ok(distinct.items[0].reasons.includes("multiple_ticket_evidence"));
});

test("same phone among bounded indexed holders is ambiguous even if one ticket detail is absent", () => {
  const result = run({ profiles: [profile(), profile({ activeTickets: [] }, "10002")], registrations: [registration()] });
  assert.equal(result.counts.ambiguous_identity, 1);
  assert.equal(result.counts.covered, undefined);
});

test("duplicate identity scope excludes profiles outside the bounded exact holder query", () => {
  const result = run({ profiles: [profile(), profile({ activeTicketNames: ["Team 강사레슨"] }, "10002"),
    profile({ activeTicketNames: undefined }, "10003")], registrations: [registration()] });
  assert.equal(result.counts.covered, 1);
  assert.equal(result.counts.ambiguous_identity, undefined);
  assert.match(result.profileCoverage.queryScope, /activeTicketNames_exact/);
  assert.equal(result.duplicateIdentityScope,
    "bounded_queried_ticket_holders_only; nonholders_and_unqueried_profiles_not_checked");
});

test("noncanonical/duplicate registration documents are review, never silently covered", () => {
  for (const registrations of [[registration({}, "legacy")], [registration({ registrationId: "wrong" })],
    [registration(), registration({}, "legacy")], [registration({ ticketName: "Team 강사레슨" })]]) {
    assert.equal(run({ registrations }).counts.operator_review, 1);
  }
  assert.equal(run({ registrations: [registration({ lessonDate: "2026-11-29" }, "different-date")] }).counts.missing_canonical_registration, 1);
});

test("existing canonical document with contradictory phone/date/member binding is review, not absence", () => {
  for (const patch of [{ memberPhone: "" }, { memberPhone: "01000000002" }, { lessonDate: "2026-11-29" },
    { evidence: { studiomateMemberId: "10002" } }]) {
    const result = run({ registrations: [registration(patch)] });
    assert.equal(result.counts.operator_review, 1);
    assert.equal(result.items[0].registrationState, "present");
  }
});

test("ticket cancellation and registration cancellation/pending are not missing-registration claims", () => {
  const cases = [
    { profiles: [profile({ activeTickets: [ticket({ status: "환불" })] })] },
    { registrations: [registration({ status: "cancelled" })] },
    { registrations: [registration({ cancellation: { status: "pending", reason: "private reason" } })] },
  ];
  for (const input of cases) {
    const result = run(input);
    assert.equal(result.counts.cancelled, 1);
    assert.equal(result.counts.missing_canonical_registration, undefined);
    assert.ok(result.items[0].reasons.includes("cancelled_or_cancellation_pending"));
  }
});

test("bad phone never generates a canonical registration key", () => {
  for (const phone of ["", "1234", "0101234567", "0212345678"]) {
    const result = run({ profiles: [profile({ phone })] });
    assert.equal(result.counts.operator_review, 1);
    assert.equal(result.items[0].registrationId, undefined);
    assert.deepEqual(result.items[0].reasons, ["invalid_phone"]);
  }
});

test("zero, missing, nonnumeric, partial and unsupported payments require operator review", () => {
  for (const [patch, reason] of [
    [{ paymentAmount: 0 }, "zero_payment_review"], [{ paymentAmount: null }, "payment_source_unknown"],
    [{ paymentAmount: "70000" }, "payment_source_unknown"], [{ paymentAmount: 35000 }, "unsupported_payment_review"],
    [{ paymentType: "분납" }, "unsupported_payment_review"], [{ status: "정지" }, "unsupported_ticket_status"],
  ]) {
    const result = run({ profiles: [profile({ activeTickets: [ticket(patch)] })] });
    assert.equal(result.counts.operator_review, 1);
    assert.ok(result.items[0].reasons.includes(reason));
    assert.equal(result.counts.missing_canonical_registration, undefined);
  }
});

test("staff hints require review, missing staff hints never prove ordinary-member eligibility", () => {
  for (const patch of [{ isStaff: true }, { staffId: "staff1" }, { memberGrade: "STAFF" }, { memberGrade: "직원" },
    { memberGrade: "스텝" }]) {
    const result = run({ profiles: [profile(patch)] });
    assert.equal(result.counts.operator_review, 1);
    assert.ok(result.items[0].reasons.includes("staff_review"));
  }
  assert.match(run().staffEligibility, /not_verified_from_memberProfiles_only/);
  assert.equal(run({ profiles: [profile({ memberId: "excel_synthetic" })] }).counts.operator_review, 1);
});

test("resolved numeric linked native identity takes precedence over an Excel or different numeric member id", () => {
  for (const memberId of ["excel_synthetic", "10002"]) {
    const result = run({ profiles: [profile({ memberId, studiomateMemberId: "10001" })],
      registrations: [registration({ evidence: { studiomateMemberId: "10001" } })] });
    assert.equal(result.counts.covered, 1);
    assert.deepEqual(result.items[0].reasons, []);
  }
  const missing = run({ profiles: [profile({ memberId: "excel_synthetic", studiomateMemberId: 10001 })] });
  assert.equal(missing.counts.missing_canonical_registration, 1);
  for (const studiomateMemberId of [null, "excel_unresolved", "0", "invalid"]) {
    const unresolved = run({ profiles: [profile({ memberId: "excel_synthetic", studiomateMemberId })] });
    assert.ok(unresolved.items[0].reasons.includes("native_identity_unresolved"));
  }
});

test("native binding compares only known numeric evidence and profile identities, never the registration top level", () => {
  const mismatch = run({ profiles: [profile({ memberId: "excel_synthetic", studiomateMemberId: "10001" })],
    registrations: [registration({ evidence: { studiomateMemberId: "10002" } })] });
  assert.ok(mismatch.items[0].reasons.includes("registration_member_identity_mismatch"));
  for (const evidence of [undefined, {}, { studiomateMemberId: "unknown" }, { studiomateMemberId: "10001" }]) {
    const result = run({ registrations: [registration({ studiomateMemberId: "10002", evidence })] });
    assert.equal(result.counts.covered, 1);
  }
  const unknownProfile = run({ profiles: [profile({ memberId: "excel_synthetic" })],
    registrations: [registration({ evidence: { studiomateMemberId: "10001" } })] });
  assert.ok(unknownProfile.items[0].reasons.includes("native_identity_unresolved"));
  assert.equal(unknownProfile.items[0].reasons.includes("registration_member_identity_mismatch"), false);
  const numericFallback = run({ profiles: [profile({ studiomateMemberId: "invalid" })],
    registrations: [registration({ evidence: { studiomateMemberId: 10001 } })] });
  assert.equal(numericFallback.counts.covered, 1);
});

test("freshness requires successful complete source evidence, not recent profile edit timestamps", () => {
  for (const evidence of [{}, { ...fresh, stale: true }, { ...fresh, latestAttemptSucceeded: false },
    { ...fresh, sourceObservedAt: new Date(nowMs - 96 * 60_000).toISOString() },
    { ...fresh, sourceObservedAt: new Date(nowMs + 60_000).toISOString() }, { ...fresh, sourceObservedAt: "bad" }]) {
    const result = run({ sourceEvidence: evidence, profiles: [profile({ syncedAt: new Date(nowMs), updatedAt: new Date(nowMs) })] });
    assert.equal(result.complete, false);
    assert.equal(result.healthy, false);
    assert.equal(result.counts.missing_canonical_registration, undefined);
    assert.deepEqual(result.completedCheckKeys, []);
    assert.equal(result.findings[0].checkKey, "instructor-ticket-intake:coverage");
  }
  assert.equal(run({ sourceEvidence: { ...fresh, sourceObservedAt: new Date(nowMs - 95 * 60_000).toISOString() } }).complete, true);
});

test("either 501 cap or query failure is incomplete, never healthy or a resolution of previous findings", () => {
  for (const patch of [{ profiles: Array.from({ length: 501 }, (_, i) => profile({ activeTickets: [] }, `p${i}`)) },
    { registrations: Array.from({ length: 501 }, () => registration()) },
    { profileQueryFailed: true }, { registrationQueryFailed: true }]) {
    const result = run(patch);
    assert.equal(result.complete, false);
    assert.equal(result.healthy, false);
    assert.equal(canResolveHealthFinding({ findingId: "old", checkKey: "instructor-ticket-intake:review" },
      new Set(), new Set(result.completedCheckKeys)), false);
  }
  assert.equal(run({ registrationQueryFailed: true }).items[0].registrationState, "unknown_incomplete_query");
  assert.equal(run({ profiles: Array.from({ length: 500 }, (_, i) => profile({ activeTickets: [] }, `p${i}`)) }).complete, true);
});

test("reports contain counts/reference paths, not names, phones, medical or cancellation text", () => {
  const result = run({ profiles: [profile({}, phone)], registrations: [registration({ cancellation: { reason: "private reason" } })] });
  const text = JSON.stringify(result);
  for (const privateValue of [phone, "Synthetic Private Name", "private medical text", "private reason"]) {
    assert.equal(text.includes(privateValue), false);
  }
  assert.ok(result.items[0].sourceRefs.includes("memberProfiles"));
});

const healthSource = readFileSync(new URL("../run-system-health-check.mjs", import.meta.url), "utf8");
const checkSource = healthSource.slice(healthSource.indexOf("async function checkInstructorTicketIntakeCoverage()"),
  healthSource.indexOf("async function inspectQueue(input)"));

test("existing health integration performs only two bounded canonical reads and existing finding/complete hooks", async () => {
  const reads = [];
  const checked = [], findings = [], completedChecks = new Set();
  const db = { collection(name) {
    const clauses = [];
    const query = { where(...args) { clauses.push(args); return query; }, limit(value) { clauses.push(["limit", value]); return query; },
      async get() { reads.push({ name, clauses }); return { docs: name === "memberProfiles" ?
        [{ id: "10001", data: () => profile().data }] : [] }; } };
    return query;
  } };
  await vm.runInNewContext(`${checkSource}\ncheckInstructorTicketIntakeCoverage();`, {
    db, now: new Date(nowMs), instructorTicketIntakeBounds, classifyInstructorTicketIntakeCoverage: classify,
    syncEvidence: new Map([["studiomate-excel-sync", fresh]]), checked, completedChecks,
    addFinding: finding => findings.push(finding),
  });
  assert.deepEqual(reads, [
    { name: "memberProfiles", clauses: [["studioId", "==", "5330"],
      ["activeTicketNames", "array-contains", "강사레슨 (2T)"], ["limit", 501]] },
    { name: "instructorLessonRegistrations", clauses: [
      ["lessonDate", ">=", "2026-10-29"], ["lessonDate", "<=", "2027-02-25"], ["limit", 501]] },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(checked[0].counts.missing_canonical_registration, 1);
  assert.equal(JSON.stringify(checked).includes(phone), false);
  assert.ok(completedChecks.has("instructor-ticket-intake:review"));
  assert.match(healthSource, /await checkNotionSync\(\);\s+await checkInstructorTicketIntakeCoverage\(\);/);
  assert.doesNotMatch(checkSource, /\.set\(|\.update\(|\.delete\(|send|retry|repairStaleQueue|process\.env|execFile/);
});

test("health query errors are redacted incomplete findings, not source absence", async () => {
  const findings = [], completedChecks = new Set(), checked = [];
  const query = { where() { return query; }, limit() { return query; }, get() { throw new Error(`private ${phone}`); } };
  await vm.runInNewContext(`${checkSource}\ncheckInstructorTicketIntakeCoverage();`, {
    db: { collection() { return query; } }, now: new Date(nowMs), instructorTicketIntakeBounds,
    classifyInstructorTicketIntakeCoverage: classify, syncEvidence: new Map([["studiomate-excel-sync", fresh]]),
    checked, completedChecks, addFinding: finding => findings.push(finding),
  });
  assert.equal(completedChecks.size, 0);
  assert.equal(findings.length, 1);
  assert.equal(checked[0].complete, false);
  assert.equal(JSON.stringify({ findings, checked }).includes(phone), false);
});
