import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildRecoveryPlan, parseRecoveryArgs, assertApplyGate, assertProviderPrecheck, SCOPE, OLD_APPROVAL_IDS,
  type RecoveryInput, type RecoveryPlan } from "../recover-instructor-lesson-material-sample";

const NOW = Date.parse("2026-10-23T05:34:00Z");
function fixture(): RecoveryInput {
  const timestamp = { toDate: () => new Date("2026-10-24T04:00:00Z"), toMillis: () => Date.parse("2026-10-24T04:00:00Z") };
  const bookings = ["a", "b"].map((part) => ({ bookingId: `booking-${part}`, lectureId: `lecture-${part}`,
    studioId: SCOPE.studioId, memberId: "member-test", memberName: "Synthetic", memberPhone: "01000000001",
    lectureDate: SCOPE.lessonDate, lectureStartAt: part === "a" ? timestamp : {
      toDate: () => new Date("2026-10-24T06:00:00Z"), toMillis: () => Date.parse("2026-10-24T06:00:00Z") },
    staffId: "staff-test", staffName: "Synthetic", appStatus: "reserved", lessonType: "group", ticketName: "강사레슨" }));
  const candidates = ["a", "b"].map((part) => ({ id: `old-${part}`, data: {
    candidateId: `old-${part}`, studioId: SCOPE.studioId, sourceDate: SCOPE.sourceDate,
    type: "instructor_lesson_material", memberId: "member-test", memberPhone: "01000000001", status: "candidate", attempts: 0,
    payload: { lessonDate: SCOPE.lessonDate, managementNumber: `${part}-261024` },
  } }));
  return {
    bookings, lectures: ["a", "b"].map((part) => ({ lectureId: `lecture-${part}`, studioId: SCOPE.studioId,
      date: SCOPE.lessonDate, title: part, status: "open" })),
    profiles: [{ memberId: "member-test", studioId: SCOPE.studioId, name: "Synthetic", phone: "01000000001" }],
    snapshot: { active: true, snapshotPolicy: "bookings_single_source_reconcile_import_range", importedBookings: 2,
      dateRange: { startDate: "2026-10-23", endDate: "2026-11-01" }, updatedAt: new Date(NOW - 1000).toISOString() },
    candidates, approvals: OLD_APPROVAL_IDS.map((id, index) => ({ id, data: {
      studioId: SCOPE.studioId, sourceDate: SCOPE.sourceDate, lessonDate: SCOPE.lessonDate,
      managementNumber: `${index ? "b" : "a"}-261024`, status: "sample_failed", lastError: "original route failure",
      candidateIds: [candidates[index].id],
    } })), sends: [], cancellations: [], version: "synthetic-version",
  } as unknown as RecoveryInput;
}
const plan = (): RecoveryPlan => buildRecoveryPlan(fixture(), NOW);
const provider = () => ({ readOnly: true, sourceDate: SCOPE.sourceDate, checkedAt: new Date(NOW).toISOString(),
  templateApproved: true, recipientCount: 1, memberHistoryCount: 0, sampleHistoryCount: 0,
  templateId: "synthetic", receipts: [] });

test("defaults to dry-run and rejects unknown/missing options", () => {
  assert.equal(parseRecoveryArgs([]).apply, false);
  assert.equal(parseRecoveryArgs(["--dry-run"]).apply, false);
  assert.throws(() => parseRecoveryArgs(["--send"]));
  assert.throws(() => parseRecoveryArgs(["--expected-plan"]));
});

test("shared builder combines a/b into one date/topic recipient and merges parking bookings", () => {
  const result = plan();
  assert.equal(result.uniqueRecipients, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].payload.managementNumber, SCOPE.managementNumber);
  assert.equal(result.candidates[0].payload.parkingBookingIds, "booking-a,booking-b");
  assert.equal(result.candidates[0].payload.lessonStartAt, "2026-10-24T04:00:00.000Z");
  assert.deepEqual(result.oldCandidateIds, ["old-a", "old-b"]);
});

test("legacy failed approval history remains untouched by plan construction", () => {
  const input = fixture();
  buildRecoveryPlan(input, NOW);
  assert.equal(input.approvals[0].data.status, "sample_failed");
  assert.equal(input.approvals[0].data.lastError, "original route failure");
});

test("all ledger states, including failed and ambiguous, block replay", () => {
  for (const status of ["done", "pending", "processing", "retry", "failed", "unknown"]) {
    const input = fixture(); input.sends = [{ id: "legacy_sample", data: { status } }];
    assert.throws(() => buildRecoveryPlan(input, NOW), /Existing send ledger/);
  }
});

test("never resets legacy sample_failed with send/approval evidence or new approval", () => {
  for (const change of [{ sampleSolapiMessageId: "accepted" }, { sampleSentAt: "time" }, { approvedAt: "time" },
    { liveSendStartedAt: "time" }, { status: "sample_unknown" }, { status: "sample_sending" }, { status: "approved" },
    { supersededByApprovalId: "unrelated" }]) {
    const input = fixture(); Object.assign(input.approvals[0].data, change);
    assert.throws(() => buildRecoveryPlan(input, NOW), /Legacy approval/);
  }
  const input = fixture(); input.approvals.push({ id: "new-approval", data: {} });
  assert.throws(() => buildRecoveryPlan(input, NOW), /New\/other approval/);
});

test("rejects stale snapshot, changed phone, cancelled or superseded source", () => {
  const stale = fixture(); stale.snapshot!.updatedAt = new Date(NOW - 25 * 3600_000).toISOString();
  assert.throws(() => buildRecoveryPlan(stale, NOW));
  const changed = fixture(); changed.profiles[0].phone = "01000000002";
  assert.throws(() => buildRecoveryPlan(changed, NOW), /identity mismatch/);
  const superseded = fixture(); superseded.bookings[0].supersededByBookingId = "replacement";
  assert.throws(() => buildRecoveryPlan(superseded, NOW), /Superseded/);
  const cancelled = fixture(); cancelled.bookings.forEach((booking) => booking.appStatus = "cancel");
  assert.throws(() => buildRecoveryPlan(cancelled, NOW), /cohort empty/);
});

test("rejects previously attempted or foreign legacy candidate identity", () => {
  for (const change of [{ attempts: 1 }, { status: "processing" }, { sentAt: "time" }, { memberId: "foreign" }]) {
    const input = fixture(); Object.assign(input.candidates[0].data, change);
    assert.throws(() => buildRecoveryPlan(input, NOW));
  }
});

test("fingerprint changes when source versions change", () => {
  const input = fixture(); const original = buildRecoveryPlan(input, NOW);
  input.version = "changed-version";
  assert.notEqual(buildRecoveryPlan(input, NOW).fingerprint, original.fingerprint);
});

test("apply requires exact reread count/fingerprint, correct day and before 18:00 KST", () => {
  const result = plan();
  const options = parseRecoveryArgs(["--apply", "--expected-recipients", "1", "--expected-plan", result.fingerprint]);
  assert.doesNotThrow(() => assertApplyGate(options, result, NOW));
  assert.throws(() => assertApplyGate({ ...options, expectedRecipients: 2 }, result, NOW));
  assert.throws(() => assertApplyGate({ ...options, expectedPlan: "stale" }, result, NOW));
  assert.throws(() => assertApplyGate(options, result, Date.parse("2026-10-23T09:00:00Z")));
  assert.throws(() => assertApplyGate(options, result, Date.parse("2026-10-23T14:00:00Z")));
});

test("provider gate requires fresh complete exact coverage with zero member AND sample history", () => {
  const result = plan();
  assert.doesNotThrow(() => assertProviderPrecheck(provider(), result, NOW));
  for (const change of [{ templateApproved: false }, { readOnly: false }, { recipientCount: 0 },
    { sourceDate: "2026-10-24" }, { memberHistoryCount: 1 }, { sampleHistoryCount: 1 },
    { checkedAt: new Date(NOW - 61_000).toISOString() }, { checkedAt: new Date(NOW + 1).toISOString() }]) {
    assert.throws(() => assertProviderPrecheck({ ...provider(), ...change }, result, NOW));
  }
});

test("write boundary uses transaction readback; exact old approvals only receive supersession metadata", () => {
  const source = readFileSync(new URL("../recover-instructor-lesson-material-sample.ts", import.meta.url), "utf8");
  assert.match(source, /db\.runTransaction[\s\S]*buildRecoveryPlan\(await readInputs\(tx\)\)/);
  assert.match(source, /current\.fingerprint === expected\.fingerprint/);
  assert.match(source, /for \(const id of OLD_APPROVAL_IDS\) tx\.update[^]*?supersededByApprovalId: correctedApprovalId, supersededAt: now,\s*\}/);
  assert.doesNotMatch(source, /processAlimtalkQueue|queueDailyAlimtalkCandidates|sendApprovedInstructorLessonAlimtalks|sendSolapiAlimtalk/);
  assert.equal((source.match(/await auditInstructorLessonProvider\(SCOPE\.sourceDate\)/g) || []).length, 2);
});
