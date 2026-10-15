import test from "node:test";
import assert from "node:assert/strict";
import { calculateLiveHolding } from "../lib/holding-notice-live-readback.mjs";
import { HOLDING_SOURCE, normalizeHoldingObservation } from "../lib/studiomate-holding-source.mjs";

const now = new Date("2026-10-20T12:00:00.000Z");
const c = (field, before, after) => ({ field, before, after });
const create = (date, start, end) => ({ at: `${date} 12:00`, staff: "Fixture", type: "수강권정지",
  changes: [c("정지시작일", "내역없음", start), c("정지종료일", "내역없음", end)] });
function fixture() {
  return { source: HOLDING_SOURCE, studioId: "5330", memberId: "101", memberName: "Fixture", ticketName: "Annual",
    memberUrl: "https://arcpilates.studiomate.kr/users/detail?id=101", observedAt: now.toISOString(), historyComplete: true, activeHoldsComplete: true,
    currentHold: { start: "2026-10-20", end: "2026-10-26" },
    activeHolds: [{ start: "2026-10-07", end: "2026-10-16" }, { start: "2026-10-20", end: "2026-10-26" }],
    history: [
      { at: "2026. 01. 01. 12:00", staff: "Fixture", type: "발급",
        changes: [c("이용시작일", "내역없음", "2026-01-01"), c("이용종료일", "내역없음", "2026-12-31")] },
      create("2026. 10. 06.", "2026-10-07", "2026-10-31"),
      { at: "2026. 10. 17. 12:00", staff: "Fixture", type: "수강권 정지취소", changes: [] },
      create("2026. 10. 20.", "2026-10-20", "2026-10-26"),
    ] };
}
function calculate(raw) {
  const creationEvidenceFingerprint = normalizeHoldingObservation(raw).history.at(-1).fingerprint;
  return calculateLiveHolding(raw, { creationEvidenceFingerprint, now });
}
test("latest explicit consumed period retains ten days after early release, then adds seven for 73/17/56", () => {
  const r = calculate(fixture());
  assert.equal(r.summary.totalDays, 73); assert.equal(r.summary.usedDays, 17); assert.equal(r.summary.remainingDays, 56);
  assert.equal(r.selected.id, normalizeHoldingObservation(fixture()).history.at(-1).fingerprint);
});
test("current list overrides planned duration even when no release change row exists", () => {
  const raw = fixture(); raw.history.splice(2, 1);
  assert.equal(calculate(raw).summary.usedDays, 17);
});
test("full pre-start cancellation is zero, but disappearance during or after the start is not zero proof", () => {
  const raw = fixture(); raw.activeHolds.shift(); raw.history[2].at = "2026. 10. 06. 13:00";
  assert.equal(calculate(raw).summary.usedDays, 7);
  for (const at of ["2026. 10. 07. 12:00", "2026. 10. 17. 12:00"]) {
    raw.history[2].at = at; assert.throws(() => calculate(raw), /early_release_actual_period/);
  }
});
test("missing or unstable source, ambiguous changes, future truncated periods and wrong current controls block", () => {
  for (const mutate of [raw => { raw.activeHolds.shift(); }, raw => { raw.activeHoldsComplete = false; },
    raw => { raw.currentHold.end = "2026-10-25"; }, raw => { raw.history[2].type = "수강권홀딩해제"; },
    raw => { raw.history[2].at = raw.history[1].at; },
    raw => { raw.activeHolds.push({ start: "2026-10-10", end: "2026-10-11" }); },
  ]) { const raw = fixture(); mutate(raw); assert.throws(() => calculate(raw)); }
  const raw = fixture(); raw.history.splice(2, 1); raw.activeHolds[0].end = "2026-10-21";
  assert.throws(() => calculate(raw), /early_release_range_not_effective/);
});
test("never use a cached allowance or an extended expiry to calculate the original limit", () => {
  const raw = fixture(); raw.cachedUsedDays = 70; raw.cachedRemainingDays = 3;
  raw.history.push({ at: "2026. 10. 20. 13:00", staff: "Fixture", type: "일괄변경", changes: [c("이용종료일", "2026-12-31", "2027-06-30")] });
  const selected = normalizeHoldingObservation(raw).history[3].fingerprint;
  const result = calculateLiveHolding(raw, { creationEvidenceFingerprint: selected, now });
  assert.equal(result.summary.totalDays, 73); assert.equal(result.summary.usedDays, 17);
  assert.equal(result.summary.remainingDays, 56);
});

function scheduledLiveFixture() {
  const raw = fixture();
  raw.currentHold = null;
  raw.activeHolds = [{ start: "2026-10-21", end: "2026-10-27" }];
  raw.history = [raw.history[0], create("2026. 10. 20.", "2026-10-21", "2026-10-27")];
  return raw;
}

test("saved future range without current controls counts both endpoints and binds its creation", () => {
  const raw = scheduledLiveFixture(), result = calculate(raw);
  assert.equal(result.currentHold, null);
  assert.equal(result.selected.id, normalizeHoldingObservation(raw).history[1].fingerprint);
  assert.equal(result.selected.start, "2026-10-21");
  assert.equal(result.selected.end, "2026-10-27");
  assert.deepEqual(result.summary, { ok: true, originalDays: 365, totalDays: 73,
    usedDays: 7, remainingDays: 66, overageDays: 0 });
  raw.activeHolds[0].end = "2026-10-21";
  raw.history[1].changes[1].after = "2026-10-21";
  assert.equal(calculate(raw).summary.usedDays, 1);
});

test("missing controls never authorize today's or past ranges, using KST rather than UTC", () => {
  for (const start of ["2026-10-19", "2026-10-20"]) {
    const raw = scheduledLiveFixture();
    raw.activeHolds[0].start = start;
    raw.history[1].changes[0].after = start;
    assert.throws(() => calculate(raw), /selected_hold_not_current_saved_controls/);
  }
  const raw = scheduledLiveFixture();
  const creationEvidenceFingerprint = normalizeHoldingObservation(raw).history[1].fingerprint;
  const beforeMidnight = new Date("2026-10-20T14:59:59.999Z");
  raw.observedAt = beforeMidnight.toISOString();
  assert.ok(calculateLiveHolding(raw, { creationEvidenceFingerprint, now: beforeMidnight }).selected);
  const midnight = new Date("2026-10-20T15:00:00.000Z");
  raw.observedAt = midnight.toISOString();
  assert.throws(() => calculateLiveHolding(raw, { creationEvidenceFingerprint, now: midnight }),
    /selected_hold_not_current_saved_controls/);
});

test("future selection fails closed for malformed, incomplete, unmatched, cancelled and overlapping evidence", async t => {
  const cases = [
    ["malformed saved date", raw => { raw.activeHolds[0].end = "2026-10-99"; }],
    ["inverted saved range", raw => { raw.activeHolds[0].end = "2026-10-20"; }],
    ["incomplete history", raw => { raw.historyComplete = false; }],
    ["incomplete saved ranges", raw => { raw.activeHoldsComplete = false; }],
    ["incomplete creation", raw => { raw.history[1].changes.pop(); }],
    ["missing saved range", raw => { raw.activeHolds = []; }],
    ["unmatched saved range", raw => { raw.activeHolds[0].start = "2026-10-22"; }],
    ["future truncated range", raw => { raw.activeHolds[0].end = "2026-10-26"; }],
    ["partial controls do not become blank controls", raw => { raw.currentHold = { start: "2026-10-21" }; }],
    ["pre-start cancellation", raw => {
      raw.history.push({ at: "2026. 10. 20. 13:00", staff: "Fixture", type: "수강권 정지취소", changes: [] });
      raw.activeHolds = [];
    }],
    ["overlap at inclusive endpoint", raw => {
      raw.history.push(create("2026. 10. 20.", "2026-10-27", "2026-10-29"));
      raw.activeHolds.push({ start: "2026-10-27", end: "2026-10-29" });
    }],
    ["allowance exceeded", raw => {
      raw.activeHolds[0].end = "2027-01-02";
      raw.history[1].changes[1].after = "2027-01-02";
    }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const raw = scheduledLiveFixture();
    const creationEvidenceFingerprint = normalizeHoldingObservation(raw).history[1].fingerprint;
    mutate(raw);
    assert.throws(() => calculateLiveHolding(raw, { creationEvidenceFingerprint, now }));
  });
});

test("future period edit keeps original creation identity and recalculates inclusive usage", () => {
  const raw = scheduledLiveFixture(), original = calculate(raw);
  raw.history.push({ at: "2026. 10. 20. 13:00", staff: "Fixture", type: "수강권정지수정",
    changes: [c("정지종료일", "2026-10-27", "2026-10-29")] });
  raw.activeHolds[0].end = "2026-10-29";
  const edited = calculateLiveHolding(raw, { creationEvidenceFingerprint: original.selected.id, now });
  assert.equal(edited.selected.id, original.selected.id);
  assert.equal(edited.selected.registeredAt, original.selected.registeredAt);
  assert.notEqual(edited.observation.observationFingerprint, original.observation.observationFingerprint);
  assert.equal(edited.summary.usedDays, 9);
  assert.equal(edited.summary.remainingDays, 64);
});
