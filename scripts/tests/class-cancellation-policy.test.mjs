import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateClassCancellation as evaluate,
  prepareClassCancellationPlan as prepare,
  assertClassCancellationDraft as verify,
} from "../lib/class-cancellation-policy.mjs";

const row = (patch = {}) => ({ date: "2026-11-21", startTime: "09:00", staffName: "Synthetic Instructor",
  title: "Synthetic Group", room: "", lessonType: "그룹", category: "그룹", ...patch });
const calendar = (patch = {}) => ({ from: "2026-01-01", through: "2026-12-31", dates: ["2026-11-23"],
  sourceReference: "synthetic-verified-calendar", verifiedAt: "2026-11-13T10:00:00+09:00", ...patch });
const draft = plan => plan.rows.map(value => ({ ...structuredClone(value),
  ...(value.cancellation ? { cancelDeadline: value.cancellation.deadline } : {}) }));

for (const [time, hours, minutes] of [["00:00", 3, 0], ["09:00", 12, 0], ["09:30", 12, 30], ["23:59", 26, 59]]) {
  test(`Saturday ${time} computes previous-day 21:00 and ${hours}h${minutes}m`, () => {
    assert.deepEqual(evaluate(row({ startTime: time })), { status: "enforce", rule: "previous_day_21",
      expectedDeadline: "2026-11-20 21:00:00", leadHours: hours, leadMinutes: minutes });
  });
}

for (const [date, previous] of [["2026-11-22", "2026-11-21"], ["2026-11-01", "2026-10-31"],
  ["2028-01-01", "2027-12-31"], ["2020-03-01", "2020-02-29"], ["2024-03-02", "2024-03-01"]]) {
  test(`calendar subtraction ${date} -> ${previous}`, () => {
    assert.equal(evaluate(row({ date })).expectedDeadline, `${previous} 21:00:00`);
  });
}

test("weekday holiday uses previous-day 21:00", () => {
  assert.equal(evaluate(row({ date: "2026-11-23" }), { calendar: calendar() }).expectedDeadline, "2026-11-22 21:00:00");
});
test("ordinary weekday uses six hours, including midnight crossover", () => {
  assert.deepEqual(evaluate(row({ date: "2026-11-24", startTime: "00:30" }), { calendar: calendar() }), {
    status: "enforce", rule: "weekday_6_hours", expectedDeadline: "2026-11-23 18:30:00", leadHours: 6, leadMinutes: 0,
  });
});
test("weekday nonholiday subtraction crosses the year without local-time arithmetic", () => {
  const result = evaluate(row({ date: "2027-01-01", startTime: "00:00" }), {
    calendar: calendar({ from: "2027-01-01", through: "2027-12-31", dates: [] }),
  });
  assert.equal(result.rule, "weekday_6_hours");
  assert.equal(result.expectedDeadline, "2026-12-31 18:00:00");
});
test("weekday fails closed without verified calendar", () => {
  assert.equal(evaluate(row({ date: "2026-11-24" })).reason, "verified_calendar_required");
});
for (const patch of [{ from: "2026-02-30" }, { through: "2025-12-31" }, { dates: ["2026-02-30"] },
  { dates: ["2027-01-01"] }, { dates: ["2026-11-23", "2026-11-23"] }, { dates: "2026-11-23" },
  { sourceReference: " " }, { verifiedAt: "yesterday" }, { verifiedAt: "2026-02-30T10:00:00Z" },
  { verifiedAt: "2026-11-13T24:00:00Z" }]) {
  test(`malformed calendar blocks: ${JSON.stringify(patch)}`, () => {
    assert.equal(evaluate(row({ date: "2026-11-24" }), { calendar: calendar(patch) }).reason, "malformed_calendar");
  });
}
test("weekday outside calendar coverage blocks", () => {
  assert.equal(evaluate(row({ date: "2027-01-04" }), { calendar: calendar() }).reason, "calendar_outside_coverage");
});
test("weekend calculation does not require a calendar", () => {
  assert.equal(evaluate(row(), { calendar: null }).status, "enforce");
});

for (const category of ["강사레슨", "강사레슨(team)", "야외수업", "workshop", "신규강사 체험", "프라이빗 그룹", "키즈 그룹", "아카이브 레벨링"]) {
  test(`preserves excluded category ${category}`, () => {
    const original = row({ category, date: "2026-11-24", cancelDeadline: "2026-11-24 03:00:00 까지", custom: { value: 7 } });
    const plan = prepare([original], { operation: "edit" });
    assert.deepEqual(evaluate(original), { status: "excluded" });
    assert.deepEqual(plan.rows, [original]);
    assert.deepEqual(plan.batches, []);
    assert.equal(verify(plan, [original]).excludedCount, 1);
  });
}
test("private is excluded with known category and without holiday lookup", () => {
  for (const category of ["", "프라이빗", "그룹"]) {
    assert.equal(evaluate(row({ lessonType: "프라이빗", category, date: "2026-11-24" })).status, "excluded");
  }
  assert.equal(evaluate(row({ lessonType: "프라이빗", category: "unknown" })).status, "blocked");
});
test("native private empty category is explicit, not a missing category", () => {
  const original = row({ lessonType: "프라이빗", category: "", date: "2026-11-24", cancelDeadline: "2026-11-23 09:00:00" });
  const plan = prepare([original], { operation: "edit" });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows, [original]);
  assert.equal(verify(plan, [original]).excludedCount, 1);
  const missing = { ...original }; delete missing.category;
  assert.equal(evaluate(missing).status, "blocked");
  assert.equal(evaluate({ ...original, category: " " }).status, "blocked");
});

for (const patch of [{ date: "2026-02-29" }, { date: "2026-04-31" }, { date: "2026-2-01" }, { date: "0000-01-01" },
  { startTime: "24:00" }, { startTime: "09:60" }, { startTime: "9:00" }, { startTime: "09:00:00" },
  { lessonType: "group" }, { lessonType: "" }, { category: "unknown" }, { category: "" },
  { lessonType: "그룹", category: "프라이빗" }, { staffName: " " }, { title: "" }, { room: undefined },
  { cancelDeadline: "2026-02-30 03:00:00" }, { cancelDeadline: "2026-11-21 24:00:00" }]) {
  test(`malformed class blocks: ${JSON.stringify(patch)}`, () => {
    assert.equal(evaluate(row(patch)).status, "blocked");
  });
}
test("missing canonical fields and non-record rows block", () => {
  for (const field of ["date", "startTime", "staffName", "title", "room", "lessonType", "category"]) {
    const value = row(); delete value[field];
    assert.equal(evaluate(value).status, "blocked");
  }
  for (const value of [null, undefined, [], "group"]) assert.equal(evaluate(value).status, "blocked");
});
test("leap-day holiday supports exact verified coverage boundaries", () => {
  const result = evaluate(row({ date: "2024-02-29" }), { calendar: calendar({ from: "2024-02-29", through: "2024-02-29", dates: ["2024-02-29"] }) });
  assert.equal(result.expectedDeadline, "2024-02-28 21:00:00");
});

test("copy replaces inherited six-hour cancellation plan using destination", () => {
  const original = row({ cancelDeadline: "2026-11-21 03:00:00", cancellation: { deadline: "old", leadHours: 6 },
    capacity: 6, metadata: { preserve: [1, 2] } });
  const before = structuredClone(original);
  const plan = prepare([original], { operation: "copy" });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows[0].cancellation, { deadline: "2026-11-20 21:00:00", leadHours: 12, leadMinutes: 0, rule: "previous_day_21" });
  assert.equal(plan.rows[0].cancelDeadline, original.cancelDeadline);
  assert.deepEqual(plan.rows[0].metadata, original.metadata);
  assert.deepEqual(original, before);
  assert.throws(() => verify(plan, [original]), /deadline_mismatch/);
  assert.equal(verify(plan, draft(plan)).enforcedCount, 1);
});
test("mixed weekday/weekend batches separate rules and minute components", () => {
  const rows = [row(), row({ date: "2026-11-28" }), row({ startTime: "09:30" }), row({ date: "2026-11-24" }),
    row({ category: "강사레슨" })];
  const plan = prepare(rows, { operation: "create", calendar: calendar() });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.batches.map(({ rule, leadHours, leadMinutes, keys }) => [rule, leadHours, leadMinutes, keys.length]), [
    ["previous_day_21", 12, 0, 2], ["previous_day_21", 12, 30, 1], ["weekday_6_hours", 6, 0, 1],
  ]);
  assert.deepEqual(JSON.parse(plan.batches[0].keys[0]), [rows[0].date, rows[0].startTime, rows[0].staffName,
    rows[0].lessonType, rows[0].category, rows[0].title, rows[0].room]);
  assert.deepEqual(verify(plan, draft(plan).reverse()), { ok: true, version: plan.version, operation: "create", verification: "draft_only",
    rowCount: 5, enforcedCount: 4, excludedCount: 1, readOnly: true, requiresNativeReadback: true });
});
test("duplicate exact keys block both rows, but distinct rooms remain distinct", () => {
  const plan = prepare([row(), row({ custom: 2 })], { operation: "edit" });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.blocked, [{ index: 0, reason: "duplicate_class_key" }, { index: 1, reason: "duplicate_class_key" }]);
  assert.equal(prepare([row(), row({ room: "Room B" })], { operation: "edit" }).ok, true);
  assert.throws(() => verify(plan, []), /prepared_plan/);
});
test("one blocked row prevents plan success", () => {
  const plan = prepare([row(), row({ date: "2026-11-24" })], { operation: "copy" });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.blocked, [{ index: 1, reason: "verified_calendar_required" }]);
});
test("operation and row-count bounds fail closed", () => {
  for (const operation of [undefined, "delete", "CREATE", null, {}]) assert.equal(prepare([row()], { operation }).ok, false);
  for (const rows of [null, {}, [], Array.from({ length: 1001 }, (_, i) => row({ title: `Group ${i}` }))]) {
    assert.equal(prepare(rows, { operation: "create" }).ok, false);
  }
  const plan = prepare(Array.from({ length: 1000 }, (_, i) => row({ title: `Group ${i}` })), { operation: "create" });
  assert.equal(plan.ok, true);
  assert.equal(plan.rows.length, 1000);
});
test("sparse arrays and uncloneable fields do not succeed", () => {
  const sparse = prepare(new Array(1), { operation: "create" });
  assert.equal(sparse.ok, false);
  assert.deepEqual(sparse.blocked, [{ index: 0, reason: "invalid_row" }]);
  assert.equal(prepare([row({ custom: () => true })], { operation: "create" }).ok, false);
});
test("draft accepts only optional native until suffix, not seconds or loose formatting", () => {
  const plan = prepare([row()], { operation: "edit" });
  for (const suffix of ["", " 까지", "까지"]) {
    assert.equal(verify(plan, [row({ cancelDeadline: `2026-11-20 21:00:00${suffix}` })]).ok, true);
  }
  for (const value of ["2026-11-20 21:00:01", "2026-11-20 21:00", "2026-11-20T21:00:00", "2026-11-20 21:00:00 ", undefined]) {
    assert.throws(() => verify(plan, [row({ cancelDeadline: value })]));
  }
});
test("draft rejects missing, extra, duplicate, stale and wrong-identity rows", () => {
  const plan = prepare([row(), row({ startTime: "10:00" })], { operation: "edit" });
  const good = draft(plan);
  for (const values of [good.slice(0, 1), [...good, good[0]], [good[0], good[0]],
    [good[0], { ...good[1], date: "2026-11-28" }], [good[0], { ...good[1], staffName: "Other Instructor" }],
    [good[0], { ...good[1], category: "강사레슨" }], [good[0], { ...good[1], room: "Other Room" }], null]) {
    assert.throws(() => verify(plan, values));
  }
});
test("excluded draft settings cannot change", () => {
  const plan = prepare([row({ category: "강사레슨", cancelDeadline: "2026-11-21 03:00:00", cancellation: { custom: 1 } })], { operation: "edit" });
  assert.throws(() => verify(plan, [{ ...plan.rows[0], cancelDeadline: "2026-11-20 21:00:00" }]), /excluded/);
  assert.throws(() => verify(plan, [{ ...plan.rows[0], cancellation: { custom: 2 } }]), /excluded/);
});
test("optional draft policy fields cannot contradict the recomputed policy", () => {
  const plan = prepare([row()], { operation: "edit" });
  const values = draft(plan);
  values[0].cancellation.leadHours = 6;
  assert.throws(() => verify(plan, values), /draft_cancellation_fields_mismatch/);
});
test("fabricated and serialized plans require re-preparation", () => {
  const plan = prepare([row()], { operation: "create" });
  for (const value of [null, {}, structuredClone(plan), JSON.parse(JSON.stringify(plan))]) {
    assert.throws(() => verify(value, draft(plan)), /prepared_plan/);
  }
});
for (const change of [p => { p.rows[0].cancellation.deadline = "2026-11-21 03:00:00"; },
  p => { p.rows[0].cancellation.leadHours = 6; }, p => { p.rows[0].startTime = "10:00"; },
  p => { p.rows[0].capacity = 9; }, p => { p.operation = "copy"; }, p => { p.version = "fake"; },
  p => { p.batches[0].keys = []; }, p => { p.blocked.push({ index: 0, reason: "fake" }); },
  p => { p.readOnly = false; }, p => { p.requiresNativeReadback = false; }, p => { p.ok = false; },
  p => { p.extra = true; }]) {
  test(`prepared integrity rejects ${change.toString()}`, () => {
    const plan = prepare([row()], { operation: "edit" });
    const values = draft(plan);
    change(plan);
    assert.throws(() => verify(plan, values), /tampered/);
  });
}
test("source rows and calendar are isolated snapshots; verification is read-only", () => {
  const rows = [row({ date: "2026-11-23", extra: { value: 1 } })];
  const cal = calendar();
  const plan = prepare(rows, { operation: "edit", calendar: cal });
  rows[0].date = "2026-11-24"; rows[0].extra.value = 9; cal.dates.length = 0;
  const values = draft(plan);
  const beforePlan = structuredClone(plan), beforeDraft = structuredClone(values);
  assert.equal(verify(plan, values).ok, true);
  assert.deepEqual(plan, beforePlan);
  assert.deepEqual(values, beforeDraft);
});
test("plan embeds normalized calendar and can be deterministically re-prepared", () => {
  const plan = prepare([row(), row({ date: "2026-11-24" }), row({ lessonType: "프라이빗", category: "" })], {
    operation: "copy", calendar: calendar({ dates: ["2026-12-25", "2026-11-23"], sourceReference: " synthetic-calendar " }),
  });
  assert.deepEqual(plan.calendar, { from: "2026-01-01", through: "2026-12-31", dates: ["2026-11-23", "2026-12-25"],
    sourceReference: "synthetic-calendar", verifiedAt: "2026-11-13T01:00:00.000Z" });
  const again = prepare(plan.rows, { operation: plan.operation, calendar: plan.calendar });
  assert.deepEqual(again, plan);
  const loaded = JSON.parse(JSON.stringify(plan));
  const revalidated = prepare(loaded.rows, { operation: loaded.operation, calendar: loaded.calendar });
  assert.deepEqual(revalidated, loaded);
  assert.equal(verify(revalidated, draft(revalidated)).ok, true);
});
test("blocked and excluded rows retain their original positions on re-preparation", () => {
  const rows = [row(), row({ category: "unknown" }), row({ lessonType: "프라이빗", category: "" }),
    row({ date: "2026-02-30" }), row({ title: "Duplicate" }), row({ title: "Duplicate" })];
  const plan = prepare(rows, { operation: "edit", calendar: calendar() });
  assert.equal(plan.ok, false);
  assert.equal(plan.rows.length, rows.length);
  for (const index of [1, 2, 3, 4, 5]) assert.deepEqual(plan.rows[index], rows[index]);
  assert.deepEqual(plan.blocked.map(value => value.index), [1, 3, 4, 5]);
  assert.deepEqual(prepare(plan.rows, { operation: plan.operation, calendar: plan.calendar }), plan);
});
test("malformed or absent calendar reproduces identical blocked plans", () => {
  for (const cal of [undefined, null, calendar({ dates: ["2026-02-30"] })]) {
    const plan = prepare([row({ date: "2026-11-24" }), row({ category: "workshop" })], { operation: "create", calendar: cal });
    assert.equal(plan.ok, false);
    assert.deepEqual(prepare(plan.rows, { operation: plan.operation, calendar: plan.calendar }), plan);
  }
});
test("prepared calendar metadata cannot be changed", () => {
  const plan = prepare([row({ date: "2026-11-24" })], { operation: "edit", calendar: calendar() });
  const values = draft(plan);
  plan.calendar.sourceReference = "fabricated-source";
  assert.throws(() => verify(plan, values), /tampered/);
});
