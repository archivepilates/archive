import assert from "node:assert/strict";
import test from "node:test";
import { buildInstructorCancellationPlan, assertInstructorCancellationReadback }
  from "../lib/instructor-lesson-cancellation-contract.mjs";

function fixture(count = 2) {
  const now = new Date("2026-10-16T00:00:00Z");
  const job = { studioId: "5330", memberId: "101", memberName: "Synthetic instructor",
    memberPhone: "01000000000", lessonDate: "2026-10-16", ticketName: "강사레슨 (2T)",
    reason: "Operator-approved cancellation", expectedTicketId: "201" };
  const target = { userTicketId: "201", productId: "301", memberId: "101", studioId: "5330",
    title: job.ticketName, availabilityStartAt: job.lessonDate, expireAt: job.lessonDate,
    usable: true, isShared: false, maxCoupon: 2, remainingCoupon: 2, paymentFingerprint: "payment-evidence-a" };
  const other = { ...target, userTicketId: "202", productId: "302", title: "Unrelated pass",
    availabilityStartAt: "2026-10-01", expireAt: "2026-12-31", maxCoupon: 10, remainingCoupon: 8 };
  const snapshot = { member: { memberId: "101", name: job.memberName, phone: job.memberPhone, studioId: "5330" },
    complete: true, tickets: [target, other], bookings: { complete: true, total: count,
      rows: Array.from({ length: count }, (_, index) => ({ key: `booking-${index + 1}`, date: job.lessonDate,
        startTime: `${10 + index}:00`, status: index ? "waiting" : "reserved",
        title: "Synthetic instructor lesson", staff: "Synthetic staff" })) } };
  return { job, snapshot, now };
}

function afterCascade(snapshot) {
  const after = structuredClone(snapshot);
  after.tickets[0].usable = false;
  after.bookings.rows.forEach((row) => { row.status = "cancelled"; });
  return after;
}

test("successful native retirement verifies both reservation and waiting-list cascade", () => {
  const { job, snapshot, now } = fixture();
  const plan = buildInstructorCancellationPlan(job, snapshot, now);
  const after = afterCascade(snapshot);
  const result = assertInstructorCancellationReadback(plan, after);
  assert.deepEqual(result, { nativeVerified: true, userTicketId: "201", productId: "301", bookingCount: 2,
    cancelledBookingCount: 2, paymentUnchanged: true, unrelatedTicketsUnchanged: true, fingerprint: plan.fingerprint });
  assert.ok(Object.isFrozen(result));
  assert.ok(!Object.hasOwn(result, "refundSettled"));
});

test("explicitly complete zero-booking pass is accepted; missing history is not zero", () => {
  const { job, snapshot, now } = fixture(0);
  const plan = buildInstructorCancellationPlan(job, snapshot, now);
  assert.equal(assertInstructorCancellationReadback(plan, afterCascade(snapshot)).bookingCount, 0);
  for (const bookings of [undefined, {}, { complete: true, total: 0 },
    { complete: false, total: 0, rows: [] }, { complete: true, total: 1, rows: [] }]) {
    assert.throws(() => buildInstructorCancellationPlan(job, { ...snapshot, bookings }, now));
  }
});

test("plan is a deep detached immutable snapshot and leaves both inputs untouched", () => {
  const { job, snapshot, now } = fixture();
  const before = structuredClone({ job, snapshot });
  const plan = buildInstructorCancellationPlan(job, snapshot, now);
  assert.deepEqual({ job, snapshot }, before);
  for (const value of [plan, plan.job, plan.snapshot, plan.snapshot.member, plan.snapshot.tickets,
    plan.snapshot.tickets[0], plan.snapshot.bookings, plan.snapshot.bookings.rows[0]]) assert.ok(Object.isFrozen(value));
  assert.ok(!Object.isFrozen(snapshot));
  snapshot.tickets[0].paymentFingerprint = "mutated caller evidence";
  assert.equal(plan.snapshot.tickets[0].paymentFingerprint, "payment-evidence-a");
  assert.throws(() => { plan.snapshot.bookings.rows[0].status = "cancelled"; }, TypeError);
});

test("fingerprint is SHA256 canonical JSON, stable across object and list order", () => {
  const { job, snapshot, now } = fixture();
  const plan = buildInstructorCancellationPlan(job, snapshot, now);
  const reverseKeys = (value) => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse()
      .map(([key, child]) => [key, reverseKeys(child)])) : value;
  const reordered = reverseKeys(snapshot);
  reordered.tickets.reverse();
  reordered.bookings.rows.reverse();
  assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(buildInstructorCancellationPlan(reverseKeys(job), reordered, now).fingerprint, plan.fingerprint);
  const after = afterCascade(snapshot);
  after.tickets.reverse();
  after.bookings.rows.reverse();
  assert.equal(assertInstructorCancellationReadback(plan, after).nativeVerified, true);
  job.reason = "Different approval reason";
  assert.notEqual(buildInstructorCancellationPlan(job, snapshot, now).fingerprint, plan.fingerprint);
});

test("issued ID and product ID remain distinct fields, not necessarily unequal values", () => {
  const { job, snapshot, now } = fixture();
  snapshot.tickets[0].productId = "201";
  const plan = buildInstructorCancellationPlan(job, snapshot, now);
  assert.equal(plan.productId, plan.userTicketId);
  assert.equal(assertInstructorCancellationReadback(plan, afterCascade(snapshot)).nativeVerified, true);
  delete job.expectedTicketId;
  assert.equal(buildInstructorCancellationPlan(job, snapshot, now).userTicketId, "201");
  job.expectedTicketId = "301";
  assert.throws(() => buildInstructorCancellationPlan(job, snapshot, now), /expected issued ticket ID/);
});

test("rejects wrong member, full phone, name, studio, ticket ownership and ticket name", () => {
  const mutations = [
    ({ job }) => { job.studioId = "5331"; },
    ({ job }) => { job.memberId = "102"; },
    ({ job }) => { job.memberName = "Other instructor"; },
    ({ job }) => { job.memberPhone = "01000000001"; },
    ({ job }) => { job.memberPhone = "010-0000-0000"; },
    ({ job }) => { job.ticketName = "강사레슨 (1T)"; },
    ({ snapshot }) => { snapshot.member.studioId = "5331"; },
    ({ snapshot }) => { snapshot.member.memberId = "102"; },
    ({ snapshot }) => { snapshot.member.phone = "01000000001"; },
    ({ snapshot }) => { snapshot.member.name = "Other instructor"; },
    ({ snapshot }) => { snapshot.tickets[0].memberId = "102"; },
    ({ snapshot }) => { snapshot.tickets[1].studioId = "5331"; },
  ];
  for (const change of mutations) {
    const input = fixture(); change(input);
    assert.throws(() => buildInstructorCancellationPlan(input.job, input.snapshot, input.now));
  }
});

test("rejects malformed or synthetic native IDs everywhere; accepts safe numeric IDs", () => {
  for (const id of ["", "0", "00101", " 101", "-1", "1.2", "excel_101", "1".repeat(65),
    0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, {}, true]) {
    for (const field of ["memberId", "productId", "userTicketId", "studioId"]) {
      const { job, snapshot, now } = fixture();
      snapshot.tickets[0][field] = id;
      assert.throws(() => buildInstructorCancellationPlan(job, snapshot, now), /native ID/);
    }
    const { job, snapshot, now } = fixture();
    job.memberId = id;
    assert.throws(() => buildInstructorCancellationPlan(job, snapshot, now), /native ID/);
  }
  const { job, snapshot, now } = fixture();
  job.memberId = 101; job.studioId = 5330; job.expectedTicketId = 201;
  assert.equal(buildInstructorCancellationPlan(job, snapshot, now).userTicketId, "201");
});

test("same-day pass ambiguity includes inactive duplicates, overlapping periods and duplicate issued IDs", () => {
  for (const duplicate of ["inactive", "active", "same-id", "partial-period", "overlapping-period"]) {
    const { job, snapshot, now } = fixture();
    const extra = { ...snapshot.tickets[0], userTicketId: duplicate === "same-id" ? "201" : "203",
      usable: duplicate !== "inactive" };
    if (duplicate === "partial-period") extra.expireAt = "2026-10-17";
    if (duplicate === "overlapping-period") {
      extra.availabilityStartAt = "2026-10-15";
      extra.expireAt = "2026-10-17";
      extra.usable = false;
    }
    snapshot.tickets.push(extra);
    assert.throws(() => buildInstructorCancellationPlan(job, snapshot, now), /ambiguous|duplicate/);
  }
});

test("readback is pure and a complete retained cancellation history can verify repeatedly", () => {
  const { job, snapshot, now } = fixture();
  const plan = buildInstructorCancellationPlan(job, snapshot, now);
  const after = afterCascade(snapshot);
  const original = structuredClone(after);
  assert.deepEqual(assertInstructorCancellationReadback(plan, after), assertInstructorCancellationReadback(plan, after));
  assert.deepEqual(after, original);
  assert.ok(!Object.isFrozen(after));
});

test("requires unused, nonshared, usable 2T pass and a known payment fingerprint", () => {
  for (const [field, value] of [["remainingCoupon", 1], ["remainingCoupon", "2"], ["maxCoupon", 3],
    ["maxCoupon", null], ["isShared", true], ["isShared", undefined], ["usable", false],
    ["usable", undefined], ["paymentFingerprint", ""], ["paymentFingerprint", null]]) {
    const { job, snapshot, now } = fixture(); snapshot.tickets[0][field] = value;
    assert.throws(() => buildInstructorCancellationPlan(job, snapshot, now));
  }
});

test("rejects wrong pass date, invalid calendars and past Korean lesson dates", () => {
  for (const date of ["2026-10-15", "2026-02-30", "2026-13-01", "2026-1-16", "2026-10-16T00:00:00Z"]) {
    const { job, snapshot, now } = fixture(); job.lessonDate = date;
    assert.throws(() => buildInstructorCancellationPlan(job, snapshot, now));
  }
  for (const field of ["availabilityStartAt", "expireAt"]) {
    const { job, snapshot, now } = fixture(); snapshot.tickets[0][field] = "2026-10-17";
    assert.throws(() => buildInstructorCancellationPlan(job, snapshot, now), /period|same-day pass/);
  }
  const { job, snapshot } = fixture(0);
  assert.throws(() => buildInstructorCancellationPlan(job, snapshot, new Date("2026-10-16T15:00:00Z")), /past/);
  assert.throws(() => buildInstructorCancellationPlan(job, snapshot, new Date("invalid")), /clock/);
});

test("KST midnight and future lessons are allowed; active bookings cannot already have started", () => {
  const { job, snapshot } = fixture();
  assert.equal(buildInstructorCancellationPlan(job, snapshot, new Date("2026-10-15T15:00:00Z")).bookingCount, 2);
  assert.equal(buildInstructorCancellationPlan(job, snapshot, new Date("2026-10-15T14:59:59Z")).bookingCount, 2);
  assert.throws(() => buildInstructorCancellationPlan(job, snapshot, new Date("2026-10-16T01:00:01Z")), /already started/);
  snapshot.bookings.rows[0].status = "cancelled";
  const plan = buildInstructorCancellationPlan(job, snapshot, new Date("2026-10-16T01:00:01Z"));
  assert.equal(plan.activeBookingCount, 1);
  assert.equal(assertInstructorCancellationReadback(plan, afterCascade(snapshot)).cancelledBookingCount, 1);
});

test("rejects out-of-scope dates, attendance, unknown status and malformed booking evidence", () => {
  for (const [field, value] of [["date", "2026-10-17"], ["date", "2026-02-30"],
    ["status", "attended"], ["status", "absent"], ["status", "noshow"], ["status", "unknown"],
    ["status", "late_cancel"], ["key", ""], ["startTime", "24:00"], ["startTime", "9:00"],
    ["title", ""], ["staff", ""]]) {
    const { job, snapshot, now } = fixture(); snapshot.bookings.rows[0][field] = value;
    assert.throws(() => buildInstructorCancellationPlan(job, snapshot, now));
  }
  const { job, snapshot, now } = fixture(); snapshot.bookings.rows[1].key = snapshot.bookings.rows[0].key;
  assert.throws(() => buildInstructorCancellationPlan(job, snapshot, now), /duplicate booking/);
});

test("rejects incomplete or paginated history, including more than two historical rows", () => {
  for (const change of [
    (s) => { s.complete = false; }, (s) => { delete s.tickets; },
    (s) => { s.bookings.complete = false; }, (s) => { s.bookings.total = 3; },
    (s) => { s.bookings.total = "2"; }, (s) => { s.bookings.total = -1; },
    (s) => { s.bookings.rows.pop(); },
    (s) => { s.bookings.rows.push({ ...s.bookings.rows[0], key: "old-cancelled", status: "cancelled" }); s.bookings.total = 3; },
  ]) {
    const { job, snapshot, now } = fixture(); change(snapshot);
    assert.throws(() => buildInstructorCancellationPlan(job, snapshot, now));
  }
});

test("reason must contain 2 through 200 characters after trimming", () => {
  for (const reason of [undefined, null, "", " ", "a", "a".repeat(201), 12]) {
    const { job, snapshot, now } = fixture(); job.reason = reason;
    assert.throws(() => buildInstructorCancellationPlan(job, snapshot, now), /reason/);
  }
  const { job, snapshot, now } = fixture(); job.reason = "  ab  ";
  assert.equal(buildInstructorCancellationPlan(job, snapshot, now).job.reason, "ab");
  job.reason = "a".repeat(200);
  assert.equal(buildInstructorCancellationPlan(job, snapshot, now).job.reason.length, 200);
});

test("unknown post-click result, missing target and incomplete cascade never count as verified", () => {
  const { job, snapshot, now } = fixture();
  const plan = buildInstructorCancellationPlan(job, snapshot, now);
  for (const after of [undefined, null, {}, snapshot,
    { ...afterCascade(snapshot), complete: false },
    { ...afterCascade(snapshot), tickets: [snapshot.tickets[1]] },
    { ...afterCascade(snapshot), bookings: { complete: true, total: 0, rows: [] } }]) {
    assert.throws(() => assertInstructorCancellationReadback(plan, after));
  }
  for (const status of ["reserved", "waiting", "attended", "absent", "noshow", "unknown"]) {
    const after = afterCascade(snapshot); after.bookings.rows[0].status = status;
    assert.throws(() => assertInstructorCancellationReadback(plan, after));
  }
});

test("readback enforces unchanged payments, pass periods, issued/product IDs and unrelated tickets", () => {
  const { job, snapshot, now } = fixture();
  const plan = buildInstructorCancellationPlan(job, snapshot, now);
  for (const [field, value] of [["paymentFingerprint", "changed-payment"], ["productId", "999"],
    ["userTicketId", "999"], ["availabilityStartAt", "2026-10-15"], ["expireAt", "2026-10-17"],
    ["remainingCoupon", 1], ["maxCoupon", 3], ["isShared", true]]) {
    const after = afterCascade(snapshot); after.tickets[0][field] = value;
    assert.throws(() => assertInstructorCancellationReadback(plan, after));
  }
  for (const [field, value] of [["paymentFingerprint", "changed-payment"], ["remainingCoupon", 7],
    ["usable", false], ["title", "Changed title"]]) {
    const after = afterCascade(snapshot); after.tickets[1][field] = value;
    assert.throws(() => assertInstructorCancellationReadback(plan, after));
  }
  const extra = afterCascade(snapshot); extra.tickets.push({ ...snapshot.tickets[1], userTicketId: "203" });
  assert.throws(() => assertInstructorCancellationReadback(plan, extra));
});

test("readback rejects identity drift, changed booking identity/content and new bookings", () => {
  const { job, snapshot, now } = fixture();
  const plan = buildInstructorCancellationPlan(job, snapshot, now);
  for (const [field, value] of [["key", "replacement"], ["date", "2026-10-17"], ["startTime", "12:00"],
    ["title", "Other lesson"], ["staff", "Other staff"]]) {
    const after = afterCascade(snapshot); after.bookings.rows[0][field] = value;
    assert.throws(() => assertInstructorCancellationReadback(plan, after));
  }
  for (const field of ["memberId", "name", "phone", "studioId"]) {
    const after = afterCascade(snapshot); after.member[field] = "999";
    assert.throws(() => assertInstructorCancellationReadback(plan, after));
  }
  const after = afterCascade(snapshot); after.bookings.complete = false;
  assert.throws(() => assertInstructorCancellationReadback(plan, after));
  const zero = fixture(0); const zeroPlan = buildInstructorCancellationPlan(zero.job, zero.snapshot, zero.now);
  const added = afterCascade(zero.snapshot); added.bookings = afterCascade(snapshot).bookings;
  assert.throws(() => assertInstructorCancellationReadback(zeroPlan, added));
});

test("serialized plan retains its fingerprint and forged plan evidence is rejected", () => {
  const { job, snapshot, now } = fixture();
  const plan = buildInstructorCancellationPlan(job, snapshot, now);
  const serialized = JSON.parse(JSON.stringify(plan));
  const after = afterCascade(snapshot);
  assert.equal(assertInstructorCancellationReadback(serialized, after).nativeVerified, true);
  for (const change of [(p) => { p.fingerprint = "0".repeat(64); }, (p) => { p.userTicketId = "202"; },
    (p) => { p.snapshot.tickets[0].paymentFingerprint = "changed"; }, (p) => { p.bookingCount = 0; },
    (p) => { p.plannedAt = "invalid"; }]) {
    const forged = structuredClone(serialized); change(forged);
    assert.throws(() => assertInstructorCancellationReadback(forged, after));
  }
});
