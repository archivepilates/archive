import test from "node:test";
import assert from "node:assert/strict";
import * as source from "../lib/studiomate-holding-source.mjs";
import { calculateLiveHolding } from "../lib/holding-notice-live-readback.mjs";
import { HOLDING_NOTICE_TEMPLATE_ID } from "../lib/holding-allowance-notice.mjs";
import {
  HOLDING_AUTO_MODE, HOLDING_AUTO_EVENTS, HOLDING_AUTO_POLICY, HOLDING_AUTO_CUTOVER,
  automaticHoldingReadback, automaticHoldingEvidence,
} from "../lib/holding-notice-automatic.mjs";
import {
  verifiedOperatorHoldingPlan, reconcileExistingHoldingAttempt,
} from "../lib/holding-notice-operator-dispatch.mjs";

const NOW = new Date("2026-10-26T03:00:00.000Z");
const REGISTERED_AT = "2026-10-15T01:01:00.000Z";
const MEMBER = Object.freeze({ memberId: "901", name: "Synthetic Period Member",
  phone: "01000000901", studioId: "5330" });
const CHANGE_TYPES = ["수강권정지", "수강권정지수정"];
const change = (field, before, after) => ({ field, before, after });
const row = (at, type, changes) => ({ at, type, staff: "Synthetic Operator", changes });
const creation = (at, start, end) => row(at, "수강권정지", [
  change("정지시작일", "내역없음", start), change("정지종료일", "내역없음", end),
]);

function fixture({ edited = true, type = "수강권정지", expiryChange = true } = {}) {
  const end = edited ? "2026-11-01" : "2026-10-28";
  const raw = {
    source: source.HOLDING_SOURCE, studioId: MEMBER.studioId, memberId: MEMBER.memberId,
    memberName: MEMBER.name, ticketName: "Synthetic 150-day Pass",
    memberUrl: `https://arcpilates.studiomate.kr/users/detail?id=${MEMBER.memberId}`,
    observedAt: NOW.toISOString(), historyComplete: true, activeHoldsComplete: true,
    activeHolds: [{ start: "2026-10-16", end }], currentHold: { start: "2026-10-16", end },
    history: [
      row("2026. 09. 01. 09:00", "발급", [
        change("이용시작일", "내역없음", "2026-09-01"),
        change("이용종료일", "내역없음", "2027-01-28"),
      ]),
      creation("2026. 10. 12. 10:00", "2026-10-20", "2026-10-28"),
      row("2026. 10. 15. 10:00", "수강권정지취소", []),
      creation("2026. 10. 15. 10:01", "2026-10-16", "2026-10-28"),
    ],
  };
  if (edited) raw.history.push(row("2026. 10. 26. 11:00", type, [
    change("정지종료일", "2026-10-28", end),
    ...(expiryChange ? [change("이용종료일", "2027-01-28", "2027-02-01")] : []),
  ]));
  return raw;
}

function calculate(raw) {
  const creationEvidenceFingerprint = source.normalizeHoldingObservation(raw).history[3].fingerprint;
  return calculateLiveHolding(raw, { creationEvidenceFingerprint, now: NOW });
}

function config() {
  return { mode: HOLDING_AUTO_MODE, autoSendEnabled: true, canonicalSourcePromoted: true,
    calculationMode: "live_studiomate_readback", sourceScanEnabled: true, rosterDiscoveryEnabled: true,
    studioId: MEMBER.studioId, templateId: HOLDING_NOTICE_TEMPLATE_ID, automaticPolicyId: HOLDING_AUTO_POLICY,
    cutoverAt: HOLDING_AUTO_CUTOVER, automaticSourceCollection: HOLDING_AUTO_EVENTS, nativeE2eVerified: true,
    activationCommit: "a".repeat(40), baselineInitializedAt: "2026-10-07T14:00:00.000Z" };
}

function planFor(raw) {
  const obs = source.normalizeHoldingObservation(raw);
  return verifiedOperatorHoldingPlan(raw, MEMBER, {
    confirmed: true, approvedBy: HOLDING_AUTO_POLICY, reason: "Synthetic period-edit regression only",
    memberId: MEMBER.memberId, memberPhone: MEMBER.phone,
    observationFingerprint: obs.observationFingerprint, creationEvidenceFingerprint: obs.history[3].fingerprint,
  }, NOW);
}

test("synthetic 150-day issuance and pre-start cancellation establish 30/13/17 before editing", () => {
  const raw = fixture({ edited: false }), before = structuredClone(raw), result = calculate(raw);
  assert.deepEqual(result.summary, { ok: true, originalDays: 150, totalDays: 30,
    usedDays: 13, remainingDays: 17, overageDays: 0 });
  assert.equal(result.holds.length, 1, "the cancelled planned hold consumes zero days");
  assert.equal(result.selected.registeredAt, REGISTERED_AT);
  assert.equal(result.selected.id, source.normalizeHoldingObservation(raw).history[3].fingerprint);
  assert.deepEqual(raw, before, "calculation must not mutate source evidence");
});

test("mislabeled and explicit end edits preserve creation identity while producing 30/17/13", async t => {
  const original = calculate(fixture({ edited: false }));
  for (const type of CHANGE_TYPES) for (const expiryChange of [false, true]) {
    await t.test(`${type}; expiry change=${expiryChange}`, () => {
      const raw = fixture({ type, expiryChange }), input = structuredClone(raw), edited = calculate(raw);
      assert.deepEqual(edited.summary, { ok: true, originalDays: 150, totalDays: 30,
        usedDays: 17, remainingDays: 13, overageDays: 0 });
      assert.equal(edited.holds.length, 1, "an edit is not another holding creation");
      assert.equal(edited.selected.id, original.selected.id);
      assert.equal(edited.selected.creationEvidenceFingerprint, original.selected.creationEvidenceFingerprint);
      assert.equal(edited.selected.registeredAt, REGISTERED_AT);
      assert.equal(edited.selected.registeredAt, original.selected.registeredAt);
      assert.equal(edited.selected.start, "2026-10-16");
      assert.equal(edited.selected.end, "2026-11-01");
      assert.notEqual(edited.selected.id, edited.observation.history[4].fingerprint);
      assert.notEqual(edited.observation.observationFingerprint, original.observation.observationFingerprint);
      assert.deepEqual(raw, input);
    });
  }
});

test("existing-date edit chains match both before values and never mint a holding identity", async t => {
  for (const type of CHANGE_TYPES) await t.test(type, () => {
    const raw = fixture({ type });
    raw.history.push(row("2026. 10. 26. 11:01", type, [
      change("정지시작일", "2026-10-16", "2026-10-17"),
      change("정지종료일", "2026-11-01", "2026-11-02"),
    ]));
    raw.currentHold = { start: "2026-10-17", end: "2026-11-02" };
    raw.activeHolds = [structuredClone(raw.currentHold)];
    const result = calculate(raw);
    assert.equal(result.holds.length, 1);
    assert.equal(result.selected.id, result.observation.history[3].fingerprint);
    assert.equal(result.selected.registeredAt, REGISTERED_AT);
    assert.equal(result.summary.usedDays, 17);
    assert.equal(result.summary.remainingDays, 13);
    raw.history[5].changes[1].before = "2026-10-28";
    assert.throws(() => calculate(raw), "a stale before date cannot bypass the earlier edit");
  });
});

test("an unchanged companion start is valid when the end date actually changes", async t => {
  for (const type of CHANGE_TYPES) await t.test(type, () => {
    const raw = fixture({ type });
    raw.history[4].changes.unshift(change("정지시작일", "2026-10-16", "2026-10-16"));
    assert.equal(source.holdingHistoryOperation(raw.history[4]), "edit");
    const result = calculate(raw);
    assert.equal(result.holds.length, 1);
    assert.equal(result.selected.id, result.observation.history[3].fingerprint);
    assert.equal(result.selected.registeredAt, REGISTERED_AT);
    assert.equal(result.summary.usedDays, 17);
    assert.equal(result.summary.remainingDays, 13);
    const ids = STABLE_ID_PAIRS[0];
    const shadow = source.reconcileHoldingObservation(raw, reviewFor(raw, ids), null, NOW);
    assert.equal(shadow.source.holds[1].id, ids[1]);
    assert.equal(shadow.summary.usedDays, 17);
    assert.equal(shadow.summary.remainingDays, 13);
  });
});

test("source helper classifies dates rather than trusting the holding label", async t => {
  assert.equal(typeof source.holdingHistoryOperation, "function", "production helper must be exported");
  const raw = fixture();
  for (const [label, input, expected] of [
    ["creation", raw.history[3], "create"],
    ["spaced creation", { ...raw.history[3], type: "수강권 정지" }, "create"],
    ["cancel", raw.history[2], "cancel"],
    ["spaced cancel", { ...raw.history[2], type: "수강권 정지 취소" }, "cancel"],
    ...CHANGE_TYPES.flatMap(type => [
      [`${type}: end only with expiry`, { ...raw.history[4], type }, "edit"],
      [`${type}: start only`, row("2026. 10. 26. 11:00", type,
        [change("정지시작일", "2026-10-16", "2026-10-17")]), "edit"],
      [`${type}: both dates`, row("2026. 10. 26. 11:00", type, [
        change("정지시작일", "2026-10-16", "2026-10-17"),
        change("정지종료일", "2026-10-28", "2026-11-01"),
      ]), "edit"],
    ]),
  ]) await t.test(label, () => assert.equal(source.holdingHistoryOperation(input), expected));
});

const invalidChanges = () => [
  ["partial new start", [change("정지시작일", "내역없음", "2026-10-16")]],
  ["partial new end", [change("정지종료일", "내역없음", "2026-11-01")]],
  ["mixed new start and existing end", [change("정지시작일", "내역없음", "2026-10-16"),
    change("정지종료일", "2026-10-28", "2026-11-01")]],
  ["mixed existing start and new end", [change("정지시작일", "2026-10-16", "2026-10-17"),
    change("정지종료일", "내역없음", "2026-11-01")]],
  ["unsupported holding field", [change("정지종료일", "2026-10-28", "2026-11-01"),
    change("정지일수", "13", "17")]],
  ["unsupported holding alias", [change("홀딩종료일", "2026-10-28", "2026-11-01")]],
  ["no changed dates", []],
  ["unchanged end date", [change("정지종료일", "2026-10-28", "2026-10-28")]],
  ["unchanged hold dates despite expiry change", [change("정지시작일", "2026-10-16", "2026-10-16"),
    change("정지종료일", "2026-10-28", "2026-10-28"),
    change("이용종료일", "2027-01-28", "2027-02-01")]],
  ["expiry alone is not a holding edit", [change("이용종료일", "2027-01-28", "2027-02-01")]],
  ["invalid before date", [change("정지종료일", "2026-10-99", "2026-11-01")]],
  ["invalid after date", [change("정지종료일", "2026-10-28", "2026-11-31")]],
  ["missing before date", [change("정지종료일", "", "2026-11-01")]],
  ["missing after date", [change("정지종료일", "2026-10-28", "")]],
  ["malformed expiry before", [change("정지종료일", "2026-10-28", "2026-11-01"),
    change("이용종료일", "not-a-date", "2027-02-01")]],
  ["malformed expiry after", [change("정지종료일", "2026-10-28", "2026-11-01"),
    change("이용종료일", "2027-01-28", "2027-02-30")]],
  ["duplicate end changes", [change("정지종료일", "2026-10-28", "2026-11-01"),
    change("정지종료일", "2026-10-28", "2026-11-02")]],
];

test("source classifier rejects partial, mixed, unsupported and malformed changes", async t => {
  assert.equal(typeof source.holdingHistoryOperation, "function", "missing helper is not rejection evidence");
  for (const type of CHANGE_TYPES) for (const [name, changes] of invalidChanges()) {
    await t.test(`${type}: ${name}`, () => {
      assert.throws(() => source.holdingHistoryOperation(row("2026. 10. 26. 11:00", type, changes)));
    });
  }
  assert.throws(() => source.holdingHistoryOperation({ ...fixture().history[3], type: "수강권정지수정" }),
    "an explicit edit cannot masquerade as creation with two empty before dates");
});

test("live parser fails closed for partial, mixed, unsupported and malformed edits", async t => {
  for (const type of CHANGE_TYPES) for (const [name, changes] of invalidChanges()) {
    await t.test(`${type}: ${name}`, () => {
      const raw = fixture({ type });
      raw.history[4].changes = changes;
      assert.throws(() => calculate(raw));
    });
  }
});

const invalidLifecycles = [
  ["ambiguous before matches multiple live holds", raw => {
    raw.history.splice(4, 0, creation("2026. 10. 16. 10:00", "2026-10-17", "2026-10-28"));
    raw.activeHolds.push({ start: "2026-10-17", end: "2026-10-28" });
  }],
  ["unmatched before", raw => { raw.history[4].changes[0].before = "2026-10-27"; }],
  ["edit of cancelled hold", raw => { raw.history[4].changes[0].field = "정지시작일";
    raw.history[4].changes[0].before = "2026-10-20"; raw.history[4].changes[0].after = "2026-10-21"; }],
  ["inverted range", raw => { raw.history[4].changes[0].after = "2026-10-15"; }],
  ["invalid edit calendar date", raw => { raw.history[4].at = "2026. 10. 32. 11:00"; }],
  ["invalid edit clock", raw => { raw.history[4].at = "2026. 10. 26. 24:00"; }],
  ["same-minute creation and edit", raw => { raw.history[4].at = raw.history[3].at; }],
  ["same-minute chained edits", raw => {
    raw.history.push(row(raw.history[4].at, raw.history[4].type,
      [change("정지종료일", "2026-11-01", "2026-11-02")]));
    raw.currentHold.end = raw.activeHolds[0].end = "2026-11-02";
  }],
];

test("ambiguous, unmatched, cancelled, inverted and same-minute live edit chains fail closed", async t => {
  for (const type of CHANGE_TYPES) for (const [name, mutate] of invalidLifecycles) {
    await t.test(`${type}: ${name}`, () => {
      const raw = fixture({ type });
      mutate(raw);
      assert.throws(() => calculate(raw));
    });
  }
});

test("a fresh edit never refreshes the original registration's 48-hour automatic evidence age", async t => {
  for (const type of CHANGE_TYPES) await t.test(type, () => {
    const raw = fixture({ type }), proof = automaticHoldingReadback(raw, config(), NOW);
    assert.equal(proof.selected.id, source.normalizeHoldingObservation(raw).history[3].fingerprint);
    assert.equal(proof.selected.registeredAt, REGISTERED_AT);
    assert.equal(proof.live.summary.usedDays, 17);
    assert.equal(proof.live.summary.remainingDays, 13);
    assert.ok(NOW.getTime() - Date.parse(proof.selected.registeredAt) > 48 * 3600_000);
    assert.ok(NOW.getTime() - Date.parse(source.sourceInstant(raw.history[4].at)) < 48 * 3600_000);
    assert.throws(() => automaticHoldingEvidence(raw, config(), NOW), /holding_registration_too_old_review_required/);
  });
});

// This ledger exposes reads only: any attempted claim, timestamp update or provider call fails.
function deliveredLedger(plan) {
  const { sourceEvidence, ...auditPlan } = structuredClone(plan);
  const at = "2026-10-15T01:02:00.000Z";
  const common = { ...auditPlan, candidateId: plan.id, isTest: false, templateCode: HOLDING_NOTICE_TEMPLATE_ID,
    calculationMode: "live_studiomate_readback", dedupeKey: plan.id, sourceActionKey: plan.id,
    payload: { holdingNotice: true, deliveryMode: "automatic_live_readback",
      source: "studiomate_live_ticket_readback", holdingEventId: plan.id, policyId: HOLDING_AUTO_POLICY },
    attempts: 1, maxAttempts: 1, createdAt: at, updatedAt: at };
  const receipt = { solapiMessageId: "synthetic-original-message", solapiGroupId: "synthetic-original-group" };
  const docs = new Map([
    [`alimtalkCandidates/${plan.id}`, { ...structuredClone(common), status: "sent", sentAt: at }],
    [`alimtalkSends/${plan.id}`, { ...structuredClone(common), ...receipt, sendId: plan.id, status: "done",
      providerStatus: "COMPLETE", providerStatusCode: "4000", providerOutcome: "delivered_reconciled" }],
    [`holdingNoticeClaims/${plan.id}`, { ...receipt, candidateId: plan.id, memberId: plan.memberId,
      memberPhone: plan.memberPhone, issuanceFingerprint: plan.issuanceFingerprint,
      creationEvidenceFingerprint: plan.creationEvidenceFingerprint, status: "delivered", createdAt: at, updatedAt: at }],
  ]);
  const calls = [], reads = [];
  const forbiddenWrite = () => assert.fail("receipt matching must not write the synthetic complete ledger");
  return { docs, calls, reads,
    db: { doc(path) { return { path, async get() {
      reads.push(path);
      return { exists: docs.has(path), data: () => structuredClone(docs.get(path)) };
    } }; }, runTransaction: forbiddenWrite, batch: forbiddenWrite },
    async request(url, method = "GET") {
      calls.push({ url, method });
      assert.fail("a terminal delivered registration must never query or POST to the provider");
    },
  };
}

test("delivered registration is never replayed after an edit and original receipt variables remain unchanged", async t => {
  for (const type of CHANGE_TYPES) await t.test(type, async () => {
    const original = planFor(fixture({ edited: false })), current = planFor(fixture({ type }));
    assert.equal(current.id, original.id);
    assert.equal(current.creationEvidenceFingerprint, original.creationEvidenceFingerprint);
    assert.notDeepEqual(current.variables, original.variables);
    assert.equal(original.variables["#{이번홀딩일수}"], "13");
    assert.equal(original.variables["#{잔여홀딩일수}"], "17");
    assert.equal(current.variables["#{이번홀딩일수}"], "17");
    assert.equal(current.variables["#{잔여홀딩일수}"], "13");
    const h = deliveredLedger(original), before = structuredClone(h.docs);
    const result = await reconcileExistingHoldingAttempt({ db: h.db, plan: current,
      stamp: () => NOW.toISOString(), request: h.request });
    assert.equal(result.deliveryComplete, true);
    assert.equal(result.duplicateBlocked, true);
    assert.equal(result.providerPostCount, 0);
    assert.equal(h.calls.filter(call => call.method === "POST").length, 0);
    assert.deepEqual(h.calls, []);
    assert.equal(new Set(h.reads).size, 3, "candidate, send and claim must all be checked");
    assert.deepEqual(h.docs, before, "including original text, variables, receipt IDs and timestamps");
    assert.deepEqual(h.docs.get(`alimtalkSends/${original.id}`).variables, original.variables);
    assert.equal(h.docs.get(`alimtalkSends/${original.id}`).message, original.message);
  });
});

function reviewFor(raw, ids) {
  const obs = source.normalizeHoldingObservation(raw);
  const mapping = (id, creationIndex, status, start, end, evidenceIndexes) => ({
    id, kind: "member", status, start, end,
    creationEvidenceFingerprint: obs.history[creationIndex].fingerprint,
    evidenceFingerprints: evidenceIndexes.map(index => obs.history[index].fingerprint),
  });
  return { schemaVersion: 1, observationFingerprint: obs.observationFingerprint,
    issuanceFingerprint: obs.issuanceFingerprint, ticketId: "701", reviewedBy: "synthetic-reviewer",
    reviewedAt: NOW.toISOString(), completeHistoryVerified: true, nativeTicketBindingVerified: true,
    holds: [
      mapping(ids[0], 1, "cancelled", "2026-10-20", "2026-10-28", [1, 2]),
      mapping(ids[1], 3, "registered", raw.activeHolds[0].start, raw.activeHolds[0].end,
        obs.history.slice(3).map((_, index) => index + 3)),
    ] };
}

const STABLE_ID_PAIRS = [
  ["native_501", "native_502"],
  ["hold_00000000-0000-4000-8000-000000000001", "hold_00000000-0000-4000-8000-000000000002"],
];

test("shadow reconciliation preserves native/UUID mappings without making the period edit a new candidate", async t => {
  for (const ids of STABLE_ID_PAIRS) for (const type of CHANGE_TYPES) {
    await t.test(`${ids[1]}: ${type}`, () => {
      const raw = fixture({ edited: false });
      const previous = source.reconcileHoldingObservation(raw, reviewFor(raw, ids), null, NOW);
      assert.equal(previous.summary.usedDays, 13);
      assert.equal(previous.summary.remainingDays, 17);
      const changed = fixture({ type });
      const result = source.reconcileHoldingObservation(changed, reviewFor(changed, ids), previous.source, NOW);
      assert.equal(result.summary.originalDays, 150);
      assert.equal(result.summary.totalDays, 30);
      assert.equal(result.summary.usedDays, 17);
      assert.equal(result.summary.remainingDays, 13);
      assert.deepEqual(result.source.holds.map(hold => hold.id), ids);
      assert.equal(result.source.holds[0].status, "cancelled");
      assert.equal(result.source.holds[1].registeredAt, REGISTERED_AT);
      assert.equal(result.source.holds[1].creationEvidenceFingerprint, previous.source.holds[1].creationEvidenceFingerprint);
      assert.equal(result.source.sourceId, previous.source.sourceId);
      assert.notEqual(result.source.sourceVersion, previous.source.sourceVersion);
      assert.deepEqual(result.source.baselineHoldIds, previous.source.baselineHoldIds);
      assert.deepEqual(result.source.noticeEligibleHoldIds, []);
      assert.deepEqual(result.candidateKeys, []);
      assert.equal(result.sendAllowed, false);
      assert.equal(result.reason, "shadow_until_source_promotion");
    });
  }
});

test("shadow mapping cannot consume an edit as new creation or silently ignore malformed hold fields", async t => {
  const ids = STABLE_ID_PAIRS[0];
  for (const type of CHANGE_TYPES) {
    await t.test(`${type}: edit is not creation`, () => {
      const raw = fixture({ type }), review = reviewFor(raw, ids);
      review.holds[1].creationEvidenceFingerprint = source.normalizeHoldingObservation(raw).history[4].fingerprint;
      assert.throws(() => source.reconcileHoldingObservation(raw, review, null, NOW));
    });
    for (const [name, changes] of invalidChanges()) await t.test(`${type}: ${name}`, () => {
      const raw = fixture({ type });
      raw.history[4].changes = changes;
      assert.throws(() => source.reconcileHoldingObservation(raw, reviewFor(raw, ids), null, NOW));
    });
    for (const [name, mutate] of invalidLifecycles.filter(([name]) => name !== "ambiguous before matches multiple live holds")) {
      await t.test(`${type}: ${name}`, () => {
        const raw = fixture({ type });
        mutate(raw);
        assert.throws(() => source.reconcileHoldingObservation(raw, reviewFor(raw, ids), null, NOW));
      });
    }
  }
});
