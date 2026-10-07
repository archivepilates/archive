import test from "node:test";
import assert from "node:assert/strict";
import {
  HOLDING_SOURCE,
  holdingSourceId,
  normalizeHoldingObservation,
  reconcileHoldingObservation,
  sourceDate,
  sourceInstant,
} from "../lib/studiomate-holding-source.mjs";
import {
  extractHoldingHistoryDom,
  extractRegisteredHoldsDom,
  readOpenHoldingTicket,
  registeredHoldingRanges,
} from "../lib/studiomate-holding-reader.mjs";
import { holdingNoticeKey } from "../lib/holding-allowance-notice.mjs";

const BASELINE = "2026-10-07T03:00:00.000Z";
const LATER = "2026-10-08T03:00:00.000Z";
const NOW = new Date("2026-10-12T03:00:00.000Z");
const IDS = [
  "hold_00000000-0000-4000-8000-000000000001",
  "hold_00000000-0000-4000-8000-000000000002",
  "hold_00000000-0000-4000-8000-000000000003",
];
const change = (field, before, after) => ({ field, before, after });
const row = (at, type, changes) => ({ at, staff: "Fixture Operator", type, changes });
const issuance = () => row("2026. 01. 01. 09:00", "발급", [
  change("이용시작일", "내역없음", "2026. 01. 01."),
  change("이용종료일", "내역없음", "2026. 12. 31."),
]);
const holdRow = (at = "2026. 08. 25. 09:00", start = "2026. 09. 01.", end = "2026. 09. 08.") =>
  row(at, "수강권 정지", [change("정지시작일", "내역없음", start), change("정지종료일", "내역없음", end)]);
const extension = () => row("2026. 09. 20. 09:00", "센터휴무 기간연장", [
  change("이용종료일", "2026. 12. 31.", "2027. 01. 10."),
]);

// Synthetic equivalents of the requested 365-day / 8-used and 365-day / 0-used cases.
function fixture(used = true) {
  const memberId = used ? "101" : "102";
  return {
    source: HOLDING_SOURCE, studioId: "9001", memberId,
    memberName: used ? "Fixture Member A" : "Fixture Member B", ticketName: "Fixture Annual Pass",
    memberUrl: `https://arcpilates.studiomate.kr/users/detail?id=${memberId}`,
    observedAt: BASELINE, historyComplete: true, activeHoldsComplete: true,
    history: used ? [issuance(), holdRow()] : [issuance()],
    activeHolds: used ? [{ start: "2026. 09. 01.", end: "2026. 09. 08." }] : [],
  };
}

function mapping(raw, historyIndex, id = IDS[0], extra = {}) {
  const obs = normalizeHoldingObservation(raw);
  const creation = obs.history[historyIndex];
  return {
    id, status: "registered", kind: "member",
    start: creation.changes.find(c => c.field === "정지시작일").after,
    end: creation.changes.find(c => c.field === "정지종료일").after,
    creationEvidenceFingerprint: creation.fingerprint,
    evidenceFingerprints: [creation.fingerprint], ...extra,
  };
}

function review(raw, holds = raw.activeHolds.length ? [mapping(raw, 1)] : []) {
  const obs = normalizeHoldingObservation(raw);
  return {
    schemaVersion: 1, observationFingerprint: obs.observationFingerprint,
    issuanceFingerprint: obs.issuanceFingerprint, ticketId: raw.memberId === "101" ? "201" : "202",
    reviewedBy: "fixture-reviewer", reviewedAt: LATER,
    completeHistoryVerified: true, nativeTicketBindingVerified: true, holds,
  };
}

const reconcile = (raw, decision = review(raw), previous = null) =>
  reconcileHoldingObservation(raw, decision, previous, NOW);

function addHold(raw, { at = "2026. 10. 08. 09:00", start = "2026. 10. 10.", end = "2026. 10. 11." } = {}) {
  raw.history.push(holdRow(at, start, end));
  raw.activeHolds.push({ start, end });
}

test("initial 365-day baselines calculate 8/0 used days and never propose historical notices", () => {
  for (const used of [true, false]) {
    const result = reconcile(fixture(used));
    assert.deepEqual(result.summary, {
      ok: true, originalDays: 365, totalDays: 73, usedDays: used ? 8 : 0,
      remainingDays: used ? 65 : 73, overageDays: 0,
    });
    assert.deepEqual(result.candidateKeys, []);
    assert.deepEqual(result.source.noticeEligibleHoldIds, []);
    assert.deepEqual(result.source.baselineHoldIds, used ? [IDS[0]] : []);
    assert.equal(result.source.baselineAt, BASELINE);
    assert.equal(result.source.holdsComplete, true);
    assert.equal(result.source.identityVerified, true);
    assert.equal(result.sendAllowed, false);
    assert.equal(result.reason, "initial_baseline_no_send");
  }
});

test("full-observation review and explicit native ticket binding are mandatory", async t => {
  const raw = fixture();
  for (const [label, patch] of [
    ["schema", { schemaVersion: 2 }], ["observation", { observationFingerprint: "a".repeat(64) }],
    ["issuance", { issuanceFingerprint: "b".repeat(64) }],
    ["history verification", { completeHistoryVerified: false }],
    ["native binding verification", { nativeTicketBindingVerified: false }],
    ["fallback ticket", { ticketId: "excel_201" }], ["numeric ticket value", { ticketId: 201 }],
    ["zero ticket", { ticketId: "0" }], ["reviewer", { reviewedBy: " " }],
    ["invalid review time", { reviewedAt: "not-a-time" }],
    ["future review time", { reviewedAt: "2027-01-01T00:00:00Z" }], ["hold mappings", { holds: null }],
  ]) {
    await t.test(label, () => assert.throws(() => reconcile(raw, { ...review(raw), ...patch }),
      /observation_bound_identity_review_required/));
  }
  assert.throws(() => reconcile(raw, null), /observation_bound_identity_review_required/);
});

test("stable UUID or native hold identity is required, never a date/name/import-derived ID", () => {
  const raw = fixture();
  for (const id of [undefined, "", "2026-09-01_2026-09-08", "Fixture Member A", "excel_hold_1", "hold_123", "native_0"]) {
    assert.throws(() => reconcile(raw, review(raw, [{ ...mapping(raw, 1), id }])), /invalid_stable_hold_mapping/);
  }
  assert.equal(reconcile(raw, review(raw, [mapping(raw, 1, "native_901")])).source.holds[0].id, "native_901");
});

test("reobserving unchanged evidence preserves source ID/version despite collection or reviewer timestamps", () => {
  const raw = fixture();
  const previous = reconcile(raw).source;
  raw.observedAt = LATER;
  const decision = review(raw);
  decision.reviewedBy = "another-fixture-reviewer";
  const next = reconcile(raw, decision, previous);
  assert.equal(next.source.sourceId, previous.sourceId);
  assert.equal(next.source.sourceVersion, previous.sourceVersion);
  assert.equal(next.source.observedAt, LATER);
  assert.deepEqual(next.candidateKeys, []);
});

test("editing dates for the same hold preserves stable ID and source ID while changing version", () => {
  const raw = fixture();
  const previous = reconcile(raw).source;
  raw.observedAt = LATER;
  raw.history.push(row("2026. 10. 08. 09:00", "수강권 정지 수정", [
    change("정지종료일", "2026. 09. 08.", "2026. 09. 10."),
  ]));
  raw.activeHolds[0].end = "2026. 09. 10.";
  const obs = normalizeHoldingObservation(raw);
  const decision = review(raw, [mapping(raw, 1, IDS[0], {
    end: raw.activeHolds[0].end, evidenceFingerprints: [obs.history[1].fingerprint, obs.history[2].fingerprint],
  })]);
  const next = reconcile(raw, decision, previous);
  assert.equal(next.source.holds[0].id, previous.holds[0].id);
  assert.equal(next.source.holds[0].creationEvidenceFingerprint, previous.holds[0].creationEvidenceFingerprint);
  assert.equal(next.source.sourceId, previous.sourceId);
  assert.notEqual(next.source.sourceVersion, previous.sourceVersion);
  assert.equal(next.summary.usedDays, 10);
  assert.deepEqual(next.candidateKeys, []);
  assert.equal(next.sendAllowed, false);
});

test("any changed observation requires renewed review of the whole observation", () => {
  const original = fixture();
  const decision = review(original);
  for (const mutate of [
    raw => { raw.ticketName = "Fixture Renamed Pass"; },
    raw => { raw.memberName = "Fixture Renamed Member"; },
    raw => { raw.history.push(extension()); },
    raw => { raw.activeHolds[0].end = "2026. 09. 09."; },
    raw => { raw.history[1].staff = "Fixture Other Operator"; },
  ]) {
    const raw = structuredClone(original);
    mutate(raw);
    assert.throws(() => reconcile(raw, decision), /observation_bound_identity_review_required/);
  }
});

test("hold creation cannot be reassigned to a fresh stable ID", () => {
  const raw = fixture();
  const previous = reconcile(raw).source;
  assert.throws(() => reconcile(raw, review(raw, [mapping(raw, 1, IDS[1])]), previous), /stable_hold_identity_lost|creation_identity_reassigned/);
});

test("an existing ID cannot be assigned to different creation evidence", () => {
  const original = fixture();
  const previous = reconcile(original).source;
  const raw = fixture(false);
  Object.assign(raw, { memberId: original.memberId, memberName: original.memberName, memberUrl: original.memberUrl, observedAt: LATER });
  addHold(raw);
  assert.throws(() => reconcile(raw, review(raw, [mapping(raw, 1)]), previous), /stable_hold_identity_lost/);
});

test("deleting a previously observed hold and its source history is rejected", () => {
  const raw = fixture();
  const previous = reconcile(raw).source;
  raw.history.pop();
  raw.activeHolds = [];
  raw.observedAt = LATER;
  assert.throws(() => reconcile(raw, review(raw, []), previous), /stable_hold_identity_lost/);
});

function cancelledFixture() {
  const raw = fixture();
  raw.history.push(row("2026. 09. 02. 09:00", "수강권 정지 취소", [change("정지상태", "정지", "취소")]));
  raw.activeHolds = [];
  const obs = normalizeHoldingObservation(raw);
  const hold = mapping(raw, 1, IDS[0], {
    status: "cancelled", evidenceFingerprints: [obs.history[1].fingerprint, obs.history[2].fingerprint],
  });
  return { raw, hold };
}

test("cancelled holds contribute zero days and cannot reuse their ID as registered", () => {
  const { raw, hold } = cancelledFixture();
  const baseline = reconcile(raw, review(raw, [hold]));
  assert.equal(baseline.summary.usedDays, 0);
  assert.deepEqual(baseline.candidateKeys, []);
  raw.observedAt = LATER;
  raw.activeHolds = [{ start: hold.start, end: hold.end }];
  assert.throws(() => reconcile(raw, review(raw, [{ ...hold, status: "registered" }]), baseline.source),
    /cancelled_identity_cannot_be_reused|hold_lifecycle_status_mismatch/);
});

test("unmapped cancellation history and cancellation without evidence fail closed", () => {
  const { raw, hold } = cancelledFixture();
  assert.throws(() => reconcile(raw, review(raw, [mapping(raw, 1, IDS[0], { status: "cancelled" })])), /cancel_evidence_required/);
  raw.activeHolds = [{ start: hold.start, end: hold.end }];
  assert.throws(() => reconcile(raw, review(raw, [mapping(raw, 1)])), /unmapped_hold_history_requires_review/);
});

test("only a newly registered post-baseline hold is eligible; historical backfill and equal-time creation are not", async t => {
  for (const [label, at, eligible] of [
    ["new post-baseline", "2026. 10. 08. 09:00", true],
    ["historical backfill with future hold dates", "2026. 10. 01. 09:00", false],
    ["exact baseline boundary", "2026. 10. 07. 12:00", false],
  ]) {
    await t.test(label, () => {
      const raw = fixture(false);
      const previous = reconcile(raw).source;
      raw.observedAt = LATER;
      addHold(raw, { at });
      const result = reconcile(raw, review(raw, [mapping(raw, 1, IDS[1])]), previous);
      assert.deepEqual(result.source.noticeEligibleHoldIds, eligible ? [IDS[1]] : []);
      assert.deepEqual(result.candidateKeys, eligible ? [holdingNoticeKey({ ...result.source, holdId: IDS[1] })] : []);
      assert.equal(result.source.baselineAt, BASELINE);
      assert.deepEqual(result.source.baselineHoldIds, []);
      assert.equal(result.sendAllowed, false);
      assert.equal(result.reason, "shadow_until_source_promotion");
    });
  }
});

test("source ID uses only native studio/member/ticket identity and rejects fallback identifiers", () => {
  const identity = { studioId: "9001", memberId: "101", ticketId: "201" };
  const id = holdingSourceId(identity);
  assert.match(id, /^holding_ticket_[a-f0-9]{64}$/);
  assert.equal(id, holdingSourceId({ ...identity, memberName: "Renamed Fixture", start: "2027-01-01" }));
  for (const field of Object.keys(identity)) {
    assert.notEqual(id, holdingSourceId({ ...identity, [field]: "9999" }));
    for (const value of ["excel_1", "0", "01", 1, "", undefined]) {
      assert.throws(() => holdingSourceId({ ...identity, [field]: value }), /native_ticket_identity_required/);
    }
  }
});

test("ticket binding, issuance evidence, and observation chronology cannot change under an existing source", () => {
  const raw = fixture();
  const previous = reconcile(raw).source;
  assert.throws(() => reconcile(raw, { ...review(raw), ticketId: "299" }, previous), /prior_source_binding_conflict/);
  const changed = structuredClone(raw);
  changed.history[0].staff = "Fixture Other Operator";
  assert.throws(() => reconcile(changed, review(changed), previous), /prior_source_binding_conflict/);
  raw.observedAt = "2026-10-06T03:00:00.000Z";
  assert.throws(() => reconcile(raw, review(raw), previous), /prior_source_binding_conflict/);
});

test("source dates and timestamps reject invalid calendar/time values and normalize KST", () => {
  assert.equal(sourceDate("2026. 1. 2."), "2026-01-02");
  assert.equal(sourceDate("2026-01-02"), "2026-01-02");
  assert.equal(sourceInstant("2026. 01. 02. 09:30"), "2026-01-02T00:30:00.000Z");
  assert.equal(sourceInstant("2026. 01. 02. 09:30:45"), "2026-01-02T00:30:45.000Z");
  for (const value of ["", "2026-02-30", "2026. 13. 01.", "01/02/2026"]) assert.throws(() => sourceDate(value));
  for (const value of ["garbage", "2026. 02. 30. 09:00", "2026. 01. 02. 24:00", "2026. 01. 02. 09:60", "2026. 01. 02. 09:30:60"]) {
    assert.throws(() => sourceInstant(value));
  }
});

test("invalid observation times and history newer than observation are rejected", () => {
  const raw = fixture();
  assert.throws(() => normalizeHoldingObservation({ ...raw, observedAt: "invalid" }), /incomplete_observation/);
  raw.history[1].at = "2026. 10. 08. 09:00";
  assert.throws(() => normalizeHoldingObservation(raw), /future_history_row/);
  raw.history[1].at = "not-a-time";
  assert.throws(() => normalizeHoldingObservation(raw), /invalid_history_timestamp/);
});

test("future observations are rejected even with a matching explicit review", () => {
  const raw = fixture();
  raw.observedAt = "2027-01-01T00:00:00.000Z";
  assert.throws(() => reconcile(raw, review(raw)), /future_observation/);
});

test("incomplete history/list and live-range mismatches reject reconciliation", () => {
  const raw = fixture();
  for (const field of ["historyComplete", "activeHoldsComplete"]) {
    assert.throws(() => normalizeHoldingObservation({ ...raw, [field]: false }), /incomplete_observation/);
  }
  for (const activeHolds of [[], [{ start: "2026. 09. 01.", end: "2026. 09. 09." }]]) {
    const changed = { ...raw, activeHolds };
    assert.throws(() => reconcile(changed, review(changed, [mapping(changed, 1)])), /registered_hold_list_mismatch/);
  }
  assert.throws(() => normalizeHoldingObservation({ ...raw, memberUrl: "https://example.invalid/fixture" }), /member_url_mismatch/);
});

test("duplicate history rows, duplicate ranges, fields, identities and reused evidence are rejected", () => {
  const raw = fixture();
  const duplicateHistory = structuredClone(raw);
  duplicateHistory.history.push(structuredClone(raw.history[1]));
  assert.throws(() => normalizeHoldingObservation(duplicateHistory), /indistinguishable_history_rows_review_required/);
  const duplicateRange = structuredClone(raw);
  duplicateRange.activeHolds.push({ start: "2026-09-01", end: "2026-09-08" });
  assert.throws(() => normalizeHoldingObservation(duplicateRange), /duplicate_live_hold_ranges/);
  const duplicateField = structuredClone(raw);
  duplicateField.history[1].changes.push(structuredClone(raw.history[1].changes[0]));
  assert.throws(() => normalizeHoldingObservation(duplicateField), /ambiguous_history_fields/);
  const first = mapping(raw, 1);
  assert.throws(() => reconcile(raw, review(raw, [first, structuredClone(first)])), /invalid_stable_hold_mapping/);
  assert.throws(() => reconcile(raw, review(raw, [first, { ...first, id: IDS[1] }])), /ambiguous_hold_event_mapping/);
});

test("center-closure extensions change neither original issuance days nor member hold usage", () => {
  for (const used of [true, false]) {
    const raw = fixture(used);
    const before = reconcile(raw);
    raw.history.push(extension());
    raw.observedAt = LATER;
    const after = reconcile(raw, review(raw), before.source);
    assert.deepEqual(after.summary, before.summary);
    assert.equal(after.source.originalPeriod.days, 365);
    assert.equal(after.source.holds.length, used ? 1 : 0);
    assert.equal(after.source.sourceId, before.source.sourceId);
    assert.notEqual(after.source.sourceVersion, before.source.sourceVersion);
    assert.deepEqual(after.candidateKeys, []);
  }
});

test("original period must come from exactly one proven issuance, not a later extension", () => {
  for (const mutate of [
    raw => { raw.history = [extension()]; },
    raw => { raw.history.push({ ...issuance(), at: "2026. 01. 02. 09:00" }); },
    raw => { raw.history[0].changes[1].before = "2026. 12. 01."; },
  ]) {
    const raw = fixture(false);
    mutate(raw);
    assert.throws(() => normalizeHoldingObservation(raw), /single_original_issuance_required|original_issuance_not_proven/);
  }
});

test("history omission: previously observed non-hold evidence must not silently disappear after re-review", () => {
  const raw = fixture();
  raw.history.push(extension());
  const previous = reconcile(raw).source;
  raw.history.pop();
  raw.observedAt = LATER;
  assert.throws(() => reconcile(raw, review(raw), previous), "Dropping prior extension history must fail closed");
});

test("history omission: prior hold-edit evidence must remain mapped across observations", () => {
  const raw = fixture();
  raw.history.push(row("2026. 09. 02. 09:00", "수강권 정지 수정", [
    change("정지종료일", "2026. 09. 08.", "2026. 09. 10."),
  ]));
  raw.activeHolds[0].end = "2026. 09. 10.";
  const obs = normalizeHoldingObservation(raw);
  const previous = reconcile(raw, review(raw, [mapping(raw, 1, IDS[0], {
    end: "2026. 09. 10.",
    evidenceFingerprints: [obs.history[1].fingerprint, obs.history[2].fingerprint],
  })])).source;
  raw.history.pop();
  raw.observedAt = LATER;
  assert.throws(() => reconcile(raw, review(raw), previous), "Dropping prior mapped edit evidence must fail closed");
});

test("identity review cannot consume cancellation as registered, invent dates, or combine creation rows", () => {
  const cancelled = cancelledFixture();
  cancelled.raw.activeHolds = [{ start: cancelled.hold.start, end: cancelled.hold.end }];
  assert.throws(() => reconcile(cancelled.raw, review(cancelled.raw, [{ ...cancelled.hold, status: "registered" }])), /hold_lifecycle_status_mismatch/);
  const unsupported = fixture(); unsupported.activeHolds[0].end = "2026. 09. 09.";
  assert.throws(() => reconcile(unsupported, review(unsupported, [{ ...mapping(unsupported, 1), end: "2026. 09. 09." }])), /hold_dates_not_supported/);
  const combined = fixture(); addHold(combined, { at: "2026. 09. 02. 09:00", start: "2026. 09. 01.", end: "2026. 09. 08." });
  combined.activeHolds.pop(); const obs = normalizeHoldingObservation(combined);
  assert.throws(() => reconcile(combined, review(combined, [{ ...mapping(combined, 1), evidenceFingerprints: [obs.history[1].fingerprint, obs.history[2].fingerprint] }])), /single_hold_creation/);
});

// The page protocol is mocked; evaluate never executes DOM code or starts a browser.
function mockPage(raw, { histories, holds, url = raw.memberUrl } = {}) {
  const historyResult = { history: raw.history, paginationPresent: false, ticketName: raw.ticketName };
  const holdsResult = { activeHolds: raw.activeHolds, paginationPresent: false };
  const historyReads = histories || [historyResult, structuredClone(historyResult)];
  const holdReads = holds || [holdsResult, structuredClone(holdsResult)];
  const calls = [];
  return {
    calls, url: () => url,
    getByRole(role, options) {
      if (role === "heading") {
        assert.deepEqual(options, { name: `${raw.memberName}님의 수강권`, exact: true });
        return { async waitFor(state) { assert.deepEqual(state, { state: "visible" }); } };
      }
      assert.equal(role, "listitem");
      return { filter({ hasText }) { return { async click() { calls.push(["click", hasText.source]); } }; } };
    },
    async waitForFunction(fn, expected, options) {
      assert.equal(typeof fn, "function");
      assert.equal(options.timeout, 20000);
      calls.push(["wait", expected]);
    },
    async evaluate(fn) {
      assert.ok(fn === extractHoldingHistoryDom || fn === extractRegisteredHoldsDom);
      const next = (fn === extractHoldingHistoryDom ? historyReads : holdReads).shift();
      assert.ok(next, "unexpected extra page evaluation");
      calls.push(["read", fn.name]);
      return structuredClone(next);
    },
  };
}

const read = (page, raw) => readOpenHoldingTicket(page, {
  studioId: raw.studioId, memberId: raw.memberId, memberName: raw.memberName,
});

test("mocked reader requires two matching history and hold-list reads before declaring completeness", async () => {
  const raw = fixture();
  const page = mockPage(raw);
  const result = await read(page, raw);
  assert.deepEqual(result.history, raw.history);
  assert.deepEqual(result.activeHolds, raw.activeHolds.map(({ start, end }) => ({ start: sourceDate(start), end: sourceDate(end) })));
  assert.equal(result.historyComplete, true);
  assert.equal(result.activeHoldsComplete, true);
  assert.equal(result.source, HOLDING_SOURCE);
  assert.deepEqual(page.calls.filter(([kind]) => kind === "read").map(([, name]) => name), [
    "extractHoldingHistoryDom", "extractRegisteredHoldsDom", "extractHoldingHistoryDom", "extractRegisteredHoldsDom",
  ]);
  assert.deepEqual(page.calls.filter(([kind]) => kind === "wait").map(([, tab]) => tab), [
    "변경이력", "정지기간정보", "변경이력", "정지기간정보",
  ]);
  const clicks = page.calls.filter(([kind]) => kind === "click").map(([, pattern]) => new RegExp(pattern));
  assert.ok(clicks[0].test(" 변경이력 "));
  assert.ok(clicks[1].test(" 정지기간정보 "));
  assert.ok(!clicks[0].test("변경이력 수정"));
});

test("ongoing hold controls supplement the list without double-counting the same range", () => {
  const ongoing = { start: "2026. 10. 7.", end: "2026. 10. 31." };
  const expected = [{ start: "2026-10-07", end: "2026-10-31" }];
  assert.deepEqual(registeredHoldingRanges({ activeHolds: [], currentHold: ongoing }), expected);
  assert.deepEqual(registeredHoldingRanges({ activeHolds: [ongoing], currentHold: ongoing }), expected);
  assert.deepEqual(registeredHoldingRanges({ activeHolds: [], currentHold: null }), []);
  assert.equal(registeredHoldingRanges({ activeHolds: [{ start: "2026-09-01", end: "2026-09-08" }], currentHold: ongoing }).length, 2);
  assert.throws(() => registeredHoldingRanges({ activeHolds: [ongoing, ongoing] }), /duplicate_live_hold_ranges/);
  assert.throws(() => registeredHoldingRanges({ activeHolds: [], currentHold: { ...ongoing, end: "2026-10-06" } }), /invalid_hold_range/);
});

test("unchanged source refresh retains bounded queue progress but changed source resets it", () => {
  const raw = fixture();
  const initial = reconcile(raw).source;
  const progress = { sourceVersion: initial.sourceVersion, completedHoldIds: [] };
  const previous = { ...initial, noticeProgress: progress };
  assert.deepEqual(reconcile(raw, review(raw), previous).source.noticeProgress, progress);
  const changed = structuredClone(raw);
  changed.memberName = "Updated Fixture";
  assert.equal(reconcile(changed, review(changed), previous).source.noticeProgress, undefined);
});

test("mocked reader rejects wrong member URL without reading any ticket data", async () => {
  const raw = fixture();
  const page = mockPage(raw, { url: "https://example.invalid/fixture" });
  await assert.rejects(read(page, raw), /member_url_mismatch/);
  assert.deepEqual(page.calls, []);
});

test("mocked reader rejects paginated history or hold lists at the completeness boundary", async t => {
  const raw = fixture();
  await t.test("history pagination", async () => {
    const page = mockPage(raw, { histories: [{ history: raw.history, paginationPresent: true, ticketName: raw.ticketName }] });
    await assert.rejects(read(page, raw), /paginated_history_not_complete_review_required/);
    assert.equal(page.calls.filter(([kind]) => kind === "read").length, 1);
  });
  await t.test("hold-list pagination", async () => {
    const page = mockPage(raw, { holds: [{ activeHolds: raw.activeHolds, paginationPresent: true }] });
    await assert.rejects(read(page, raw), /paginated_hold_list_not_complete/);
    assert.equal(page.calls.filter(([kind]) => kind === "read").length, 2);
  });
});

test("mocked reader rejects changed, omitted or newly paginated evidence on its second read", async t => {
  const raw = fixture();
  const history = { history: raw.history, paginationPresent: false, ticketName: raw.ticketName };
  const holds = { activeHolds: raw.activeHolds, paginationPresent: false };
  for (const [label, overrides] of [
    ["history omission", { histories: [history, { ...history, history: [issuance()] }] }],
    ["ticket change", { histories: [history, { ...history, ticketName: "Changed Fixture Pass" }] }],
    ["new history pagination", { histories: [history, { ...history, paginationPresent: true }] }],
    ["hold omission", { holds: [holds, { ...holds, activeHolds: [] }] }],
    ["new hold pagination", { holds: [holds, { ...holds, paginationPresent: true }] }],
  ]) {
    await t.test(label, async () => assert.rejects(read(mockPage(raw, overrides), raw), /ticket_changed_during_observation/));
  }
});
