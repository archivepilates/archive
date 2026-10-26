import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID } from "../lib/holding-allowance-notice.mjs";
import { HOLDING_SOURCE, normalizeHoldingObservation } from "../lib/studiomate-holding-source.mjs";
import { calculateLiveHolding } from "../lib/holding-notice-live-readback.mjs";
import { holdingOperatorNoticeId, holdingPeriodChangeFingerprint } from "../lib/holding-notice-identity.mjs";
import { HOLDING_PERIOD_CHANGE_POLICY, automaticHoldingPeriodChangeEvidence } from "../lib/holding-period-change-policy.mjs";

const NOW = new Date("2026-10-26T03:00:00.000Z");
const ACTIVATED_AT = "2026-10-26T01:30:00.000Z";
const MEMBER = "901", STUDIO = "5330";
const A = { start: "2026-10-16", end: "2026-10-28" };
const B = { start: "2026-10-16", end: "2026-11-01" };
const C = { start: "2026-10-17", end: "2026-11-02" };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const field = (name, before, after) => ({ field: name, before, after });
const historyRow = (at, type, changes) => ({ at, type, staff: "Synthetic Operator", changes });
const creation = (at, range) => historyRow(at, "수강권정지", [
  field("정지시작일", "내역없음", range.start), field("정지종료일", "내역없음", range.end),
]);

function evidence({ edited = true } = {}) {
  const raw = { source: HOLDING_SOURCE, studioId: STUDIO, memberId: MEMBER,
    memberName: "Synthetic Period Member", ticketName: "Synthetic 150-day Pass",
    memberUrl: `https://arcpilates.studiomate.kr/users/detail?id=${MEMBER}`,
    observedAt: NOW.toISOString(), historyComplete: true, activeHoldsComplete: true,
    activeHolds: [{ ...A }], currentHold: { ...A },
    history: [historyRow("2026. 09. 01. 09:00", "발급", [
      field("이용시작일", "내역없음", "2026-09-01"), field("이용종료일", "내역없음", "2027-01-28"),
    ]), creation("2026. 10. 15. 10:01", A)] };
  if (edited) edit(raw, "2026. 10. 26. 11:00", A, B);
  return raw;
}

function edit(raw, at, before, after) {
  raw.history.push(historyRow(at, "수강권정지수정", [
    field("정지시작일", before.start, after.start), field("정지종료일", before.end, after.end),
  ]));
  raw.currentHold = { ...after };
  raw.activeHolds = [{ ...after }];
}

function settings() {
  return { periodChangeNotice: { enabled: true, policyId: HOLDING_PERIOD_CHANGE_POLICY,
    activatedAt: ACTIVATED_AT, approvedBy: "Synthetic Human Approver", templateId: HOLDING_NOTICE_TEMPLATE_ID,
    allowedPriorChanges: [] } };
}

function identity(raw = evidence()) {
  const obs = normalizeHoldingObservation(raw);
  return { studioId: obs.studioId, memberId: obs.memberId, issuanceFingerprint: obs.issuanceFingerprint,
    creationEvidenceFingerprint: obs.history[1].fingerprint };
}

function original(raw = evidence()) {
  const row = identity(raw), id = holdingOperatorNoticeId(row);
  return { ...row, memberPhone: "01000000901", id, candidateId: id, sendId: id, status: "done", providerStatus: "COMPLETE",
    providerStatusCode: "4000", isTest: false, templateCode: HOLDING_NOTICE_TEMPLATE_ID,
    payload: { holdingNotice: true, deliveryMode: "automatic_live_readback" },
    observedAt: "2026-10-15T01:02:00.000Z" };
}

function changeEvidence(overrides = {}) {
  return { creationEvidenceFingerprint: "a".repeat(64), previousChangeId: "a".repeat(64),
    changedAt: "2026-10-26T02:00:00.000Z", beforeStart: A.start, beforeEnd: A.end,
    start: B.start, end: B.end, ...overrides };
}

const run = (raw = evidence(), config = settings(), receipt = original(raw), now = NOW, completedChanges = []) =>
  automaticHoldingPeriodChangeEvidence(raw, config, receipt, now, completedChanges);

function completedChange(raw, index = 0) {
  const periodChange = calculateLiveHolding(raw, { now: new Date(raw.observedAt) }).periodChanges[index];
  const registration = original(raw), noticePurpose = "holding_period_change", changeFingerprint = periodChange.id;
  const id = holdingOperatorNoticeId({ ...identity(raw), noticePurpose, changeFingerprint });
  return { ...registration, id, candidateId: id, sendId: id, noticePurpose, changeFingerprint,
    originalNoticeId: registration.id, periodChange: structuredClone(periodChange), solapiMessageId: `synthetic_change_${index}`,
    observedAt: periodChange.changedAt,
    payload: { holdingNotice: true, deliveryMode: "automatic_live_readback", policyId: HOLDING_PERIOD_CHANGE_POLICY } };
}

function exception(raw) {
  const change = calculateLiveHolding(raw, { now: new Date(raw.observedAt) }).periodChanges.at(-1);
  const { memberId, issuanceFingerprint, creationEvidenceFingerprint } = identity(raw);
  return { memberId, issuanceFingerprint, creationEvidenceFingerprint, changeFingerprint: change.id };
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test("registration hash is unchanged; period-change hash has exactly six flat entries", () => {
  const row = identity();
  const parts = [row.studioId, row.memberId, row.issuanceFingerprint, row.creationEvidenceFingerprint];
  assert.equal(holdingOperatorNoticeId(row), `holding_operator_notice_${hash(parts)}`);
  const changed = { ...row, noticePurpose: "holding_period_change", changeFingerprint: "b".repeat(64) };
  assert.equal(holdingOperatorNoticeId(changed), `holding_operator_notice_${hash([...parts, "holding_period_change", changed.changeFingerprint])}`);
  assert.notEqual(holdingOperatorNoticeId(changed), holdingOperatorNoticeId(row));
  assert.notEqual(holdingOperatorNoticeId(changed), `holding_operator_notice_${hash([...parts, ["holding_period_change", changed.changeFingerprint]])}`);
});

test("A -> B -> A produces unique chained change and notice identities", () => {
  const first = changeEvidence(), firstId = holdingPeriodChangeFingerprint(first);
  assert.equal(firstId, hash(["holding_period_change_v1", first.creationEvidenceFingerprint, first.previousChangeId,
    first.changedAt, first.beforeStart, first.beforeEnd, first.start, first.end]));
  const second = changeEvidence({ previousChangeId: firstId, changedAt: "2026-10-26T02:01:00.000Z",
    beforeStart: B.start, beforeEnd: B.end, start: A.start, end: A.end });
  const secondId = holdingPeriodChangeFingerprint(second), base = identity();
  assert.notEqual(firstId, secondId);
  assert.equal(new Set([holdingOperatorNoticeId(base), ...[firstId, secondId].map(changeFingerprint =>
    holdingOperatorNoticeId({ ...base, noticePurpose: "holding_period_change", changeFingerprint }))]).size, 3);
  assert.notEqual(holdingPeriodChangeFingerprint({ ...first, previousChangeId: "c".repeat(64) }), firstId);
  assert.notEqual(holdingPeriodChangeFingerprint({ ...first, changedAt: "2026-10-26T02:00:01.000Z" }), firstId);
});

test("identity helpers reject invalid identities, digests, purposes, dates, times and no-op deltas", async t => {
  const identityCases = [
    null, {}, { ...identity(), studioId: 5330 }, { ...identity(), memberId: "excel_901" },
    { ...identity(), issuanceFingerprint: "A".repeat(64) }, { ...identity(), creationEvidenceFingerprint: "b".repeat(63) },
    { ...identity(), noticePurpose: null }, { ...identity(), noticePurpose: "registration" },
    { ...identity(), changeFingerprint: "a".repeat(64) }, { ...identity(), noticePurpose: "holding_period_change" },
    { ...identity(), noticePurpose: "holding_period_change", changeFingerprint: "G".repeat(64) },
  ];
  for (const [index, value] of identityCases.entries()) await t.test(`invalid notice identity ${index}`, () =>
    assert.throws(() => holdingOperatorNoticeId(value), /holding_notice_/));
  const invalid = [
    { creationEvidenceFingerprint: "x".repeat(64) }, { previousChangeId: null }, { previousChangeId: "a".repeat(63) },
    { changedAt: "2026-10-26" }, { changedAt: "2026-10-26T02:00:00Z" },
    { changedAt: "2026-10-26T11:00:00.000+09:00" }, { changedAt: "2026-02-30T02:00:00.000Z" },
    { changedAt: "2026-10-26T24:00:00.000Z" }, { changedAt: "2026-10-26T02:60:00.000Z" },
    { changedAt: "2026-10-26T02:00:60.000Z" }, { beforeStart: "2026-02-30" }, { beforeEnd: "2026-10-32" },
    { start: "2026. 10. 16" }, { end: "2026-11-31" }, { beforeStart: "2026-10-29" },
    { start: "2026-11-02" }, { start: A.start, end: A.end },
  ];
  for (const [index, patch] of invalid.entries()) await t.test(`invalid change evidence ${index}`, () =>
    assert.throws(() => holdingPeriodChangeFingerprint(changeEvidence(patch)), /holding_period_change_evidence_required/));
  assert.throws(() => holdingPeriodChangeFingerprint(null), /holding_period_change_evidence_required/);
  assert.doesNotThrow(() => holdingPeriodChangeFingerprint(changeEvidence({
    beforeStart: "2024-02-29", beforeEnd: "2024-03-02", start: "2024-03-01", end: "2024-03-02",
  })));
});

test("one current native change yields observation-bound policy approval without changing the approved template", () => {
  const raw = evidence(), config = settings(), receipt = original(raw);
  const before = structuredClone({ raw, config, receipt, template: HOLDING_NOTICE_TEMPLATE });
  freeze(raw); freeze(config); freeze(receipt);
  const proof = run(raw, config, receipt);
  assert.equal(proof.selected.id, identity(raw).creationEvidenceFingerprint);
  assert.equal(proof.selected.registeredAt, "2026-10-15T01:01:00.000Z", "registration age must not be reset");
  assert.equal(proof.change.id, holdingPeriodChangeFingerprint(proof.change));
  assert.equal(proof.change.previousChangeId, proof.selected.id);
  assert.equal(proof.change.changedAt, "2026-10-26T02:00:00.000Z");
  assert.equal(proof.change.end, proof.selected.end);
  assert.equal(proof.live.summary.usedDays, 17);
  assert.equal(proof.live.summary.remainingDays, 13);
  assert.deepEqual(proof.approval, { confirmed: true, approvedBy: HOLDING_PERIOD_CHANGE_POLICY,
    reason: "Human-approved existing-template holding period update", memberId: MEMBER,
    observationFingerprint: proof.live.observation.observationFingerprint,
    creationEvidenceFingerprint: proof.selected.id, noticePurpose: "holding_period_change", changeFingerprint: proof.change.id });
  assert.deepEqual({ raw, config, receipt, template: HOLDING_NOTICE_TEMPLATE }, before);
  assert.equal(Object.hasOwn(proof.approval, "memberPhone"), false, "worker adds the canonical recipient phone");
});

test("policy config fails closed for every invalid field, including malformed exact exceptions", async t => {
  const validTarget = { memberId: MEMBER, issuanceFingerprint: "a".repeat(64),
    creationEvidenceFingerprint: "b".repeat(64), changeFingerprint: "c".repeat(64) };
  const patches = [
    { enabled: false }, { enabled: "true" }, { policyId: "other" }, { activatedAt: "2026-10-26" },
    { activatedAt: "2026-02-30T00:00:00.000Z" }, { activatedAt: "2026-10-26T03:00:00.001Z" },
    { activatedAt: "2026-10-26T01:30:00Z" }, { approvedBy: " " }, { approvedBy: true },
    { templateId: "different-template" }, { allowedPriorChanges: undefined }, { allowedPriorChanges: {} },
    { allowedPriorChanges: [validTarget, validTarget] }, { allowedPriorChanges: [null] },
    { allowedPriorChanges: Array(1) }, { allowedPriorChanges: [{ ...validTarget, memberId: "*" }] },
    { allowedPriorChanges: [{ ...validTarget, changeFingerprint: "bad" }] },
    { allowedPriorChanges: [{ memberId: MEMBER }] },
    { allowedPriorChanges: [{ ...validTarget, studioId: STUDIO }] }, { unexpectedOverride: true },
  ];
  for (const [index, patch] of patches.entries()) await t.test(`invalid policy field ${index}`, () => {
    const config = settings(); Object.assign(config.periodChangeNotice, patch);
    assert.throws(() => run(evidence(), config), /holding_period_change_configuration_required/);
  });
  for (const key of Object.keys(settings().periodChangeNotice)) await t.test(`missing ${key}`, () => {
    const config = settings(); delete config.periodChangeNotice[key];
    assert.throws(() => run(evidence(), config), /holding_period_change_configuration_required/);
  });
  for (const config of [null, {}, { periodChangeNotice: [] }])
    assert.throws(() => run(evidence(), config), /holding_period_change_configuration_required/);
  assert.throws(() => run(evidence(), settings(), original(), new Date(NaN)), /holding_period_change_configuration_required/);
});

test("original registration must be an exact completed real matching receipt", async t => {
  const mutations = [
    row => { row.id = "wrong"; }, row => { row.candidateId = "wrong"; }, row => { row.sendId = "wrong"; },
    row => { row.memberId = "902"; }, row => { row.studioId = "5331"; },
    row => { row.issuanceFingerprint = "a".repeat(64); }, row => { row.creationEvidenceFingerprint = "b".repeat(64); },
    row => { row.status = "processing"; }, row => { row.providerStatus = "SENDING"; },
    row => { row.providerStatusCode = 4000; }, row => { row.providerStatusCode = "4100"; },
    row => { row.isTest = true; }, row => { delete row.isTest; }, row => { row.templateCode = "other"; },
    row => { row.payload.holdingNotice = false; }, row => { row.payload.deliveryMode = "unapproved"; },
    row => { row.noticePurpose = "holding_period_change"; row.changeFingerprint = "c".repeat(64); },
    row => { row.payload.noticePurpose = "holding_period_change"; },
    row => { row.observedAt = "2026-10-15"; }, row => { row.observedAt = "2026-02-30T01:00:00.000Z"; },
    row => { row.observedAt = "2026-10-15T01:00:00.000Z"; },
    row => { row.observedAt = "2026-10-26T03:00:00.001Z"; },
  ];
  for (const [index, mutate] of mutations.entries()) await t.test(`invalid receipt ${index}`, () => {
    const raw = evidence(), receipt = original(raw); mutate(receipt);
    assert.throws(() => run(raw, settings(), receipt), /holding_original_notice_delivery_required/);
  });
  assert.throws(() => run(evidence(), settings(), null), /holding_original_notice_delivery_required/);
  const raw = evidence(), receipt = original(raw);
  receipt.payload.deliveryMode = "operator_verified_one_off";
  assert.ok(run(raw, settings(), receipt));
});

test("no change, historical-only changes and incorporation never create approval or registration resend", () => {
  assert.equal(run(evidence({ edited: false })), null);
  const historical = evidence(); historical.history[2].at = "2026. 10. 26. 10:00";
  assert.equal(run(historical), null);
  const boundary = evidence(); boundary.history[2].at = "2026. 10. 26. 10:30";
  assert.equal(run(boundary), null, "activation boundary is excluded without an exact exception");
  const raw = evidence();
  for (const observedAt of ["2026-10-26T02:00:00.000Z", "2026-10-26T02:01:00.000Z"])
    assert.equal(run(raw, settings(), { ...original(raw), observedAt, variables: { "#{홀딩시작일}": B.start, "#{홀딩종료일}": B.end } }), null);
});

test("one exact prior target is allowed without a historical bulk or wildcard exception", async t => {
  const raw = evidence(); raw.history[2].at = "2026. 10. 26. 10:00";
  const target = exception(raw), config = settings();
  config.periodChangeNotice.allowedPriorChanges = [target];
  assert.ok(run(raw, config));
  for (const key of Object.keys(target)) await t.test(`mismatching exception ${key}`, () => {
    const other = structuredClone(config);
    other.periodChangeNotice.allowedPriorChanges[0][key] = key === "memberId" ? "902" : "d".repeat(64);
    assert.equal(run(raw, other), null);
  });
  const incorporated = { ...original(raw), observedAt: "2026-10-26T01:00:00.000Z", variables: { "#{홀딩시작일}": B.start, "#{홀딩종료일}": B.end } };
  assert.equal(run(raw, config, incorporated), null, "exception never overrides incorporation");
  raw.history[2].at = "2026. 10. 26. 10:30";
  config.periodChangeNotice.allowedPriorChanges = [exception(raw)];
  assert.ok(run(raw, config), "only an exact exception admits the activation boundary");
});

test("48-hour change age is inclusive and never refreshes the registration timestamp", () => {
  const raw = evidence(); raw.history[2].at = "2026. 10. 24. 12:00";
  const config = settings(); config.periodChangeNotice.activatedAt = "2026-10-24T02:59:59.999Z";
  assert.ok(run(raw, config));
  const expired = new Date(NOW.getTime() + 1); raw.observedAt = expired.toISOString();
  assert.throws(() => run(raw, config, original(raw), expired), /holding_period_change_too_old_review_required/);
  config.periodChangeNotice.activatedAt = ACTIVATED_AT;
  config.periodChangeNotice.allowedPriorChanges = [exception(raw)];
  assert.throws(() => run(raw, config, original(raw), expired), /holding_period_change_too_old_review_required/);
});

test("multiple unnotified eligible transitions require review; preactivation transitions are not counted", () => {
  const raw = evidence(); edit(raw, "2026. 10. 26. 11:01", B, C);
  assert.throws(() => run(raw), /holding_multiple_unnotified_changes_review_required/);
  assert.ok(run(raw, settings(), { ...original(raw), observedAt: "2026-10-26T02:00:00.000Z", variables: { "#{홀딩시작일}": B.start, "#{홀딩종료일}": B.end } }),
    "one transition already incorporated by registration leaves just one eligible transition");
  raw.history[2].at = "2026. 10. 26. 10:00";
  const result = run(raw);
  assert.equal(result.change.start, C.start);
  assert.equal(result.change.previousChangeId, result.live.periodChanges[0].id);
  const config = settings();
  config.periodChangeNotice.allowedPriorChanges = [{ ...exception(raw), changeFingerprint: result.live.periodChanges[0].id }];
  assert.throws(() => run(raw, config), /holding_multiple_unnotified_changes_review_required/);
  assert.ok(run(raw, config, original(raw), NOW, [completedChange(raw)]), "an explicitly allowed earlier change needs its own receipt");
});

test("minute-precision order never silently treats old communicated dates as the new period", () => {
  const raw = evidence(), receipt = { ...original(raw), observedAt: "2026-10-26T02:00:30.000Z",
    variables: { "#{홀딩시작일}": A.start, "#{홀딩종료일}": A.end } };
  assert.throws(() => run(raw, settings(), receipt), /holding_period_change_original_order_review_required/);
  receipt.variables["#{홀딩종료일}"] = B.end;
  assert.equal(run(raw, settings(), receipt), null);
});

test("a delivered first change permits the second legitimate change without reselecting the first", () => {
  const raw = evidence(); edit(raw, "2026. 10. 26. 11:01", B, C);
  const receipt = completedChange(raw), input = structuredClone({ raw, receipt });
  const proof = run(freeze(raw), settings(), original(raw), NOW, freeze([receipt]));
  assert.equal(proof.change.id, calculateLiveHolding(raw, { now: NOW }).periodChanges[1].id);
  assert.notEqual(proof.change.id, receipt.changeFingerprint);
  assert.equal(proof.change.previousChangeId, receipt.changeFingerprint);
  assert.deepEqual({ raw, receipt }, input);
  const latestPending = { ...completedChange(raw, 1), status: "processing", providerStatus: "SENDING", providerStatusCode: "2000" };
  assert.equal(run(raw, settings(), original(raw), NOW, [original(raw), receipt, latestPending]).change.id, proof.change.id,
    "latest receipt reconciliation belongs to the worker, not the earlier-delivery gate");
  assert.equal(run(raw, settings(), original(raw), NOW, [receipt, completedChange(raw, 1)]).change.id, proof.change.id,
    "even a delivered latest receipt is selected for worker reconciliation, never replayed here");
});

test("every earlier eligible transition needs a receipt, not just the immediate predecessor", () => {
  const raw = evidence(); edit(raw, "2026. 10. 26. 11:01", B, C); edit(raw, "2026. 10. 26. 11:02", C, A);
  const receipts = [completedChange(raw, 0), completedChange(raw, 1)];
  assert.ok(run(raw, settings(), original(raw), NOW, receipts));
  for (const receipt of receipts)
    assert.throws(() => run(raw, settings(), original(raw), NOW, [receipt]), /holding_multiple_unnotified_changes_review_required/);
  raw.history[2].at = "2026. 10. 24. 11:00";
  const config = settings(); config.periodChangeNotice.activatedAt = "2026-10-24T01:00:00.000Z";
  assert.ok(run(raw, config, original(raw), NOW, [completedChange(raw, 0), completedChange(raw, 1)]),
    "an already delivered earlier change may be older than 48 hours; only the latest change age controls approval");
});

test("prior delivered change receipt must match every pinned identity, payload and chronology field", async t => {
  const raw = evidence(); edit(raw, "2026. 10. 26. 11:01", B, C);
  const mutations = [
    row => { row.id = "wrong"; }, row => { row.candidateId = "wrong"; }, row => { row.sendId = "wrong"; },
    row => { row.memberId = "902"; }, row => { row.memberPhone = "01000000902"; },
    row => { row.studioId = "5331"; }, row => { row.issuanceFingerprint = "a".repeat(64); },
    row => { row.creationEvidenceFingerprint = "b".repeat(64); }, row => { row.originalNoticeId = "wrong"; },
    row => { delete row.originalNoticeId; }, row => { delete row.noticePurpose; },
    row => { row.changeFingerprint = "c".repeat(64); }, row => { row.status = "failed"; },
    row => { row.providerStatus = "SENDING"; }, row => { row.providerStatusCode = "2000"; },
    row => { row.providerStatusCode = 4000; }, row => { row.isTest = true; }, row => { delete row.isTest; },
    row => { row.templateCode = "other"; }, row => { delete row.templateCode; },
    row => { row.solapiMessageId = " "; }, row => { delete row.solapiMessageId; },
    row => { row.payload.holdingNotice = false; }, row => { row.payload.deliveryMode = "operator_verified_one_off"; },
    row => { row.payload.policyId = "wrong"; }, row => { delete row.payload; },
    row => { row.periodChange.end = A.end; }, row => { row.periodChange.previousChangeId = "d".repeat(64); },
    row => { row.periodChange.id = "e".repeat(64); }, row => { row.periodChange.extra = "not-source-evidence"; },
    row => { delete row.periodChange; }, row => { row.observedAt = "2026-10-26T01:59:59.999Z"; },
    row => { row.observedAt = "2026-10-26T03:00:00.001Z"; }, row => { row.observedAt = "2026-10-26T02:00:00Z"; },
  ];
  for (const [index, mutate] of mutations.entries()) await t.test(`invalid completed change ${index}`, () => {
    const receipt = completedChange(raw); mutate(receipt);
    assert.throws(() => run(raw, settings(), original(raw), NOW, [receipt]), /holding_multiple_unnotified_changes_review_required/);
  });
  const valid = completedChange(raw);
  assert.throws(() => run(raw, settings(), original(raw), NOW, [valid, structuredClone(valid)]),
    /holding_multiple_unnotified_changes_review_required/, "conflicting or duplicated matching rows are not delivery authority");
  assert.throws(() => run(raw, settings(), { ...original(raw), memberPhone: undefined }, NOW, [valid]),
    /holding_multiple_unnotified_changes_review_required/);
  for (const rows of [null, {}, "delivered", [null], Array(1)])
    assert.throws(() => run(raw, settings(), original(raw), NOW, rows), /holding_multiple_unnotified_changes_review_required/);
  const reordered = { ...valid, periodChange: Object.fromEntries(Object.entries(valid.periodChange).reverse()) };
  assert.ok(run(raw, settings(), original(raw), NOW, [reordered]), "source equality is independent of object property order");
});

test("an earlier activation-boundary change conservatively requires its own delivered receipt", () => {
  const raw = evidence(); raw.history[2].at = "2026. 10. 26. 10:30";
  edit(raw, "2026. 10. 26. 11:01", B, C);
  assert.throws(() => run(raw), /holding_multiple_unnotified_changes_review_required/);
  assert.ok(run(raw, settings(), original(raw), NOW, [completedChange(raw)]));
});

test("live A -> B -> A chronology retains the creation id and both transition identities", () => {
  const raw = evidence(); edit(raw, "2026. 10. 26. 11:01", B, A);
  const live = calculateLiveHolding(raw, { now: NOW }), changes = live.periodChanges;
  assert.equal(changes.length, 2);
  assert.equal(changes[0].previousChangeId, identity(raw).creationEvidenceFingerprint);
  assert.equal(changes[1].previousChangeId, changes[0].id);
  assert.equal(changes[1].beforeEnd, B.end);
  assert.equal(changes[1].end, A.end);
  assert.notEqual(changes[0].id, changes[1].id);
  for (const change of changes) assert.equal(change.id, holdingPeriodChangeFingerprint(change));
  assert.throws(() => run(raw), /holding_multiple_unnotified_changes_review_required/);
});

test("changes to a different historical holding never select or resend the unchanged current creation", () => {
  const raw = evidence({ edited: false });
  raw.history.push(creation("2026. 09. 02. 10:00", { start: "2026-09-03", end: "2026-09-04" }));
  raw.history.push(historyRow("2026. 09. 02. 11:00", "수강권정지수정", [
    field("정지종료일", "2026-09-04", "2026-09-05"),
  ]));
  raw.activeHolds.push({ start: "2026-09-03", end: "2026-09-05" });
  assert.equal(calculateLiveHolding(raw, { now: NOW }).periodChanges.length, 1);
  assert.equal(run(raw), null);
});

test("malformed native change chains and timestamps fail closed", async t => {
  const mutations = [
    raw => { raw.history[2].at = "2026. 10. 26. 24:00"; },
    raw => { raw.history[2].at = "2026. 10. 32. 11:00"; },
    raw => { raw.history[2].at = raw.history[1].at; },
    raw => { raw.history[2].at = "2026. 10. 26. 12:01"; },
    raw => { raw.history[2].changes[1].before = "2026-10-27"; },
    raw => { raw.history[2].changes[1].after = "2026-11-31"; },
    raw => { raw.history[2].changes[1].after = A.end; },
    raw => { edit(raw, raw.history[2].at, B, C); },
    raw => { edit(raw, "2026. 10. 26. 11:01", A, C); },
    raw => { raw.observedAt = "2026-10-26T03:00:00Z"; },
  ];
  for (const [index, mutate] of mutations.entries()) await t.test(`invalid native chain ${index}`, () => {
    const raw = evidence(), receipt = original(raw); mutate(raw);
    assert.throws(() => run(raw, settings(), receipt));
  });
});

test("only exactly one saved current or future noncancelled hold can qualify", async t => {
  const future = evidence({ edited: false });
  future.history[1] = creation("2026. 10. 15. 10:01", { start: "2026-10-30", end: "2026-11-02" });
  edit(future, "2026. 10. 26. 11:00", { start: "2026-10-30", end: "2026-11-02" },
    { start: "2026-10-30", end: "2026-11-04" });
  future.currentHold = null;
  assert.ok(run(future));
  const mutations = [
    raw => { raw.currentHold = null; },
    raw => { raw.currentHold.end = "2026-11-02"; },
    raw => { raw.activeHolds[0].end = "2026-10-26"; raw.currentHold.end = "2026-10-26"; },
    raw => { raw.history.push(historyRow("2026. 10. 26. 11:01", "수강권정지취소", [])); },
    raw => { raw.historyComplete = false; }, raw => { raw.activeHoldsComplete = false; },
    raw => { raw.history.push(creation("2026. 10. 26. 11:01", { start: "2026-10-20", end: "2026-10-22" }));
      raw.activeHolds.push({ start: "2026-10-20", end: "2026-10-22" }); },
  ];
  for (const [index, mutate] of mutations.entries()) await t.test(`invalid saved controls ${index}`, () => {
    const raw = evidence(), receipt = original(raw); mutate(raw);
    assert.throws(() => run(raw, settings(), receipt));
  });
  const multiple = structuredClone(future);
  multiple.history.push(creation("2026. 10. 26. 11:01", { start: "2026-11-10", end: "2026-11-12" }));
  multiple.activeHolds.push({ start: "2026-11-10", end: "2026-11-12" });
  assert.throws(() => run(multiple), /holding_single_current_creation_required/);
});
