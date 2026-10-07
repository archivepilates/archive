import test from "node:test";
import assert from "node:assert/strict";
import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID } from "../lib/holding-allowance-notice.mjs";
import { HOLDING_SOURCE, normalizeHoldingObservation, sourceInstant } from "../lib/studiomate-holding-source.mjs";
import {
  HOLDING_AUTO_MODE, HOLDING_AUTO_EVENTS, HOLDING_AUTO_POLICY, HOLDING_AUTO_CUTOVER,
  holdingAutomaticConfigIssue, automaticHoldingEvidence, automaticHoldingEvent, automaticHoldingEventIssue,
} from "../lib/holding-notice-automatic.mjs";
import {
  dispatchVerifiedOperatorHolding, verifiedOperatorHoldingPlan, reconcileVerifiedOperatorHolding,
} from "../lib/holding-notice-operator-dispatch.mjs";

const NOW = new Date("2026-10-08T03:00:00.000Z");
const MEMBER = Object.freeze({ memberId: "901", name: "Synthetic Holding Member", phone: "01000000901", studioId: "5330" });
const change = (field, before, after) => ({ field, before, after });
const creation = (at, start, end) => ({ at, staff: "Synthetic Operator", type: "수강권정지",
  changes: [change("정지시작일", "내역없음", start), change("정지종료일", "내역없음", end)] });

function config() {
  return { mode: HOLDING_AUTO_MODE, autoSendEnabled: true, canonicalSourcePromoted: true,
    calculationMode: "live_studiomate_readback", sourceScanEnabled: true, rosterDiscoveryEnabled: true,
    studioId: "5330", templateId: HOLDING_NOTICE_TEMPLATE_ID, automaticPolicyId: HOLDING_AUTO_POLICY,
    cutoverAt: HOLDING_AUTO_CUTOVER, automaticSourceCollection: HOLDING_AUTO_EVENTS, nativeE2eVerified: true,
    activationCommit: "a".repeat(40), baselineInitializedAt: "2026-10-07T14:00:00.000Z" };
}

function evidence(now = NOW) {
  return { source: HOLDING_SOURCE, studioId: MEMBER.studioId, memberId: MEMBER.memberId, memberName: MEMBER.name,
    ticketName: "Synthetic Annual Pass", memberUrl: `https://arcpilates.studiomate.kr/users/detail?id=${MEMBER.memberId}`,
    observedAt: now.toISOString(), historyComplete: true, activeHoldsComplete: true,
    activeHolds: [{ start: "2026-10-08", end: "2026-10-14" }], currentHold: { start: "2026-10-08", end: "2026-10-14" },
    history: [
      { at: "2026. 01. 01. 12:00", staff: "Synthetic Operator", type: "발급",
        changes: [change("이용시작일", "내역없음", "2026-01-01"), change("이용종료일", "내역없음", "2026-12-31")] },
      { at: "2026. 07. 01. 12:00", staff: "Synthetic Operator", type: "일괄변경",
        changes: [change("이용종료일", "2026-12-31", "2027-01-04")] },
      creation("2026. 10. 08. 09:00", "2026-10-08", "2026-10-14"),
    ] };
}

function planFor(raw = evidence(), settings = config(), now = NOW) {
  const { approval } = automaticHoldingEvidence(raw, settings, now);
  // The operator plan additionally binds the canonical recipient phone.
  return verifiedOperatorHoldingPlan(raw, MEMBER, { ...approval, memberPhone: MEMBER.phone }, now);
}

const template = () => ({ ...structuredClone(HOLDING_NOTICE_TEMPLATE), templateId: HOLDING_NOTICE_TEMPLATE_ID, status: "APPROVED" });

// In-memory, serialized transactions follow the existing operator test harness.
class Store {
  docs = new Map();
  tail = Promise.resolve();
  transactionReads = [];
  creates = [];

  doc(path) { return { path, get: async () => this.snapshot(path) }; }
  snapshot(path) {
    const row = structuredClone(this.docs.get(path));
    return { exists: this.docs.has(path), data: () => structuredClone(row) };
  }
  querySnapshot({ name, field, value, n }) {
    const docs = [...this.docs].filter(([path, row]) => path.startsWith(`${name}/`) && row[field] === value)
      .slice(0, n).map(([path]) => ({ id: path.split("/")[1], ...this.snapshot(path) }));
    return { size: docs.length, docs };
  }
  collection(name) {
    return { where: (field, operator, value) => {
      assert.equal(operator, "==");
      return { query: true, name, field, value,
        limit: n => ({ query: true, name, field, value, n,
          get: async () => this.querySnapshot({ name, field, value, n }) }) };
    } };
  }
  async runTransaction(fn) {
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    const writes = [];
    try {
      const result = await fn({
        get: async ref => {
          assert.equal(writes.length, 0, "all transaction reads must precede claims");
          this.transactionReads.push(ref.path || `${ref.name}?${ref.field}=${ref.value}`);
          return ref.query ? this.querySnapshot(ref) : this.snapshot(ref.path);
        },
        create: (ref, row) => {
          assert.equal(this.docs.has(ref.path), false);
          assert.equal(writes.some(([path]) => path === ref.path), false);
          writes.push([ref.path, structuredClone(row)]);
        },
        update: (ref, row) => {
          assert.ok(this.docs.has(ref.path));
          writes.push([ref.path, { ...this.docs.get(ref.path), ...structuredClone(row) }]);
        },
      });
      for (const [path, row] of writes) {
        if (!this.docs.has(path)) this.creates.push(path);
        this.docs.set(path, row);
      }
      return result;
    } finally { release(); }
  }
  batch() {
    const updates = [];
    return {
      update: (ref, row) => updates.push([ref.path, structuredClone(row)]),
      commit: async () => {
        for (const [path, row] of updates) {
          assert.ok(this.docs.has(path));
          this.docs.set(path, { ...this.docs.get(path), ...row });
        }
      },
    };
  }
}

function harness({ raw = evidence(), plan = planFor(raw), failure = "", providerPrior = false } = {}) {
  const db = new Store(), posts = [], calls = [], exclusions = [];
  const settings = config();
  const selected = { id: plan.creationEvidenceFingerprint, registeredAt: sourceInstant(raw.history[2].at) };
  const eventPath = `${HOLDING_AUTO_EVENTS}/${plan.id}`;
  db.docs.set("settings/holdingNotice", settings);
  db.docs.set(`memberProfiles/${MEMBER.memberId}`, structuredClone(MEMBER));
  db.docs.set(eventPath, automaticHoldingEvent(plan, selected, settings));
  const row = { messageId: "synthetic-automatic-message", groupId: "synthetic-automatic-group", to: MEMBER.phone,
    status: "COMPLETE", statusCode: "4000", text: plan.message,
    kakaoOptions: { templateId: HOLDING_NOTICE_TEMPLATE_ID, disableSms: true, variables: structuredClone(plan.variables) } };
  const request = async (url, method, body) => {
    calls.push({ url, method: method || "GET" });
    if (method === "POST") {
      assert.equal(url, "/messages/v4/send-many/detail");
      assert.equal(db.docs.get(`holdingNoticeClaims/${plan.id}`).status, "claimed");
      assert.equal(db.docs.get(`alimtalkCandidates/${plan.id}`).status, "processing");
      assert.equal(db.docs.get(`alimtalkSends/${plan.id}`).providerOutcome, "claimed_no_retry");
      assert.ok(db.transactionReads.includes(eventPath));
      assert.ok(db.transactionReads.includes("settings/holdingNotice"));
      assert.ok(db.transactionReads.includes(`memberProfiles/${MEMBER.memberId}`));
      assert.equal(body.strict, true);
      assert.equal(body.allowDuplicates, false);
      assert.equal(body.messages.length, 1);
      assert.equal(body.messages[0].to, MEMBER.phone);
      assert.equal(body.messages[0].kakaoOptions.disableSms, true);
      posts.push(structuredClone(body));
      if (failure === "throw") throw new Error("synthetic_provider_outcome_unknown");
      if (failure === "acceptance") return { messageList: [] };
      return { messageList: [structuredClone(row)] };
    }
    assert.match(url, /^\/messages\/v4\/list\?/);
    assert.equal(new URL(url, "https://synthetic.invalid").searchParams.get("to"), MEMBER.phone);
    if (posts.length && failure === "receipt") return { messageList: [{ ...row, text: "synthetic mismatched receipt" }] };
    return { messageList: posts.length || providerPrior ? { [row.messageId]: structuredClone(row) } : {} };
  };
  const recipientIssue = async (tx, profile) => {
    exclusions.push(structuredClone(profile));
    const exclusion = (await tx.get(db.doc(`syntheticRecipientExclusions/${profile.phone}`))).data();
    return exclusion?.reason || "";
  };
  const run = (overrides = {}) => dispatchVerifiedOperatorHolding({ db, stamp: () => NOW.toISOString(), plan,
    template: template(), request, automatic: true, recipientIssue, readLatest: async () => structuredClone(raw),
    now: () => new Date(NOW), ...overrides });
  return { db, plan, posts, calls, exclusions, eventPath, request, run };
}

function assertUnclaimed(h) {
  assert.equal(h.posts.length, 0);
  for (const collection of ["alimtalkCandidates", "alimtalkSends", "holdingNoticeClaims"])
    assert.equal(h.db.docs.has(`${collection}/${h.plan.id}`), false, collection);
  assert.deepEqual(h.db.creates, []);
}

test("cutover is exactly 2026-10-08 00:00 KST, inclusive for activation and native registration", () => {
  assert.equal(HOLDING_AUTO_MODE, "live_readback_auto");
  assert.equal(HOLDING_AUTO_EVENTS, "holdingNoticeEvents");
  assert.equal(HOLDING_AUTO_POLICY, "holding_new_registrations_20261008");
  assert.equal(HOLDING_AUTO_CUTOVER, "2026-10-07T15:00:00.000Z");
  const before = new Date(Date.parse(HOLDING_AUTO_CUTOVER) - 1), boundary = new Date(HOLDING_AUTO_CUTOVER);
  assert.equal(holdingAutomaticConfigIssue(config(), before), "holding_cutover_not_reached");
  assert.equal(holdingAutomaticConfigIssue(config(), boundary), "");
  const raw = evidence(boundary);
  raw.history[2].at = "2026. 10. 08. 00:00:00";
  assert.throws(() => automaticHoldingEvidence(raw, config(), before), /holding_cutover_not_reached/);
  assert.equal(automaticHoldingEvidence(raw, config(), boundary).selected.registeredAt, HOLDING_AUTO_CUTOVER);
  raw.history[2].at = "2026. 10. 07. 23:59:59";
  assert.throws(() => automaticHoldingEvidence(raw, config(), boundary), /holding_historical_registration_excluded/);
});

test("pre-cutover history with a future holding start never becomes an automatic send", async () => {
  const raw = evidence();
  raw.history[2] = creation("2026. 10. 07. 23:59:59", "2026-10-20", "2026-10-26");
  raw.activeHolds = [{ start: "2026-10-20", end: "2026-10-26" }];
  raw.currentHold = structuredClone(raw.activeHolds[0]);
  assert.throws(() => automaticHoldingEvidence(raw, config(), NOW), /holding_historical_registration_excluded/);
  const obs = normalizeHoldingObservation(raw);
  const approval = { confirmed: true, reason: "Synthetic historical candidate must be rejected", approvedBy: HOLDING_AUTO_POLICY,
    memberId: MEMBER.memberId, memberPhone: MEMBER.phone, observationFingerprint: obs.observationFingerprint,
    creationEvidenceFingerprint: obs.history[2].fingerprint };
  const plan = verifiedOperatorHoldingPlan(raw, MEMBER, approval, NOW), h = harness({ raw, plan });
  await assert.rejects(h.run(), /holding_historical_registration_excluded/);
  assertUnclaimed(h);
});

test("new native evidence binds approval and recalculates allowance from original issuance", () => {
  const raw = evidence(), proof = automaticHoldingEvidence(raw, config(), NOW), obs = normalizeHoldingObservation(raw);
  assert.equal(proof.selected.registeredAt, "2026-10-08T00:00:00.000Z");
  assert.equal(proof.selected.id, obs.history[2].fingerprint);
  assert.equal(proof.approval.confirmed, true);
  assert.equal(proof.approval.approvedBy, HOLDING_AUTO_POLICY);
  assert.equal(proof.approval.memberId, MEMBER.memberId);
  assert.equal(proof.approval.observationFingerprint, obs.observationFingerprint);
  assert.equal(proof.approval.creationEvidenceFingerprint, proof.selected.id);
  assert.deepEqual(proof.live.summary, { ok: true, originalDays: 365, totalDays: 73, usedDays: 7, remainingDays: 66, overageDays: 0 });
  const later = new Date(NOW.getTime() + 1000);
  assert.equal(planFor(evidence(later), config(), later).id, planFor(raw).id);
});

test("native readback freshness is bounded and future or incomplete observations fail closed", () => {
  const atLimit = { ...evidence(), observedAt: new Date(NOW.getTime() - 120_000).toISOString() };
  assert.ok(automaticHoldingEvidence(atLimit, config(), NOW).selected);
  for (const raw of [
    { ...evidence(), observedAt: new Date(NOW.getTime() - 120_001).toISOString() },
    { ...evidence(), observedAt: new Date(NOW.getTime() + 1).toISOString() },
    { ...evidence(), historyComplete: false }, { ...evidence(), activeHoldsComplete: false },
    { ...evidence(), currentHold: null },
  ]) assert.throws(() => automaticHoldingEvidence(raw, config(), NOW));
});

test("registration older than 48 hours requires review even with a fresh native readback", () => {
  const boundary = new Date(Date.parse(HOLDING_AUTO_CUTOVER) + 48 * 3600_000), raw = evidence(boundary);
  raw.history[2].at = "2026. 10. 08. 00:00:00";
  assert.ok(automaticHoldingEvidence(raw, config(), boundary).selected);
  const expired = new Date(boundary.getTime() + 1);
  raw.observedAt = expired.toISOString();
  assert.throws(() => automaticHoldingEvidence(raw, config(), expired), /holding_registration_too_old_review_required/);
});

test("cancelled, ambiguous and unsupported native holding histories cannot authorize a send", async t => {
  const cases = [
    ["cancelled selected holding", raw => { raw.history.push({ at: "2026. 10. 08. 10:00", staff: "Synthetic Operator", type: "수강권 정지취소", changes: [] }); }],
    ["ambiguous cancellation", raw => {
      raw.history.push(creation("2026. 10. 08. 09:01", "2026-10-20", "2026-10-26"),
        { at: "2026. 10. 08. 10:00", staff: "Synthetic Operator", type: "수강권 정지취소", changes: [] });
      raw.activeHolds.push({ start: "2026-10-20", end: "2026-10-26" });
    }],
    ["duplicate creation", raw => { raw.history.push({ ...structuredClone(raw.history[2]), at: "2026. 10. 08. 09:01" }); }],
    ["missing creation", raw => { raw.history.pop(); }],
    ["unsupported cancellation", raw => { raw.history.push({ at: "2026. 10. 08. 10:00", staff: "Synthetic Operator", type: "수강권홀딩해제", changes: [] }); }],
    ["no saved current controls", raw => { raw.currentHold.end = "2026-10-15"; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const raw = evidence(); mutate(raw);
    assert.throws(() => automaticHoldingEvidence(raw, config(), NOW));
  });
});

test("canonical events have the exact minimal schema, without persisted raw ticket history", () => {
  const settings = config(), raw = evidence(), proof = automaticHoldingEvidence(raw, settings, NOW), plan = planFor(raw);
  const obs = normalizeHoldingObservation(raw), event = automaticHoldingEvent(plan, proof.selected, settings);
  assert.deepEqual(event, {
    schemaVersion: 1, id: plan.id, source: "studiomate_live_ticket_readback", memberId: MEMBER.memberId,
    memberPhone: MEMBER.phone, studioId: "5330", ticketName: "Synthetic Annual Pass",
    issuanceFingerprint: obs.issuanceFingerprint, creationEvidenceFingerprint: obs.history[2].fingerprint,
    registeredAt: "2026-10-08T00:00:00.000Z", policyId: HOLDING_AUTO_POLICY, cutoverAt: HOLDING_AUTO_CUTOVER,
    status: "ready", canonical: true,
  });
  assert.equal(automaticHoldingEventIssue(event, plan, settings, NOW), "");
  for (const field of ["sourceEvidence", "history", "activeHolds", "currentHold", "raw", "selected", "approval", "memberUrl"])
    assert.equal(Object.hasOwn(event, field), false, field);
});

test("canonical event identity is independent of document field order on readback", async t => {
  const reorder = event => Object.fromEntries(Object.entries(event).reverse());
  await t.test("issue API accepts the identical schema in a different field order", () => {
    const h = harness(), event = reorder(h.db.docs.get(h.eventPath));
    assert.deepEqual(event, h.db.docs.get(h.eventPath));
    assert.equal(automaticHoldingEventIssue(event, h.plan, config(), NOW), "");
  });
  await t.test("transaction accepts a reordered canonical document", async () => {
    const h = harness();
    const result = await h.run({ readLatest: async () => {
      h.db.docs.set(h.eventPath, reorder(h.db.docs.get(h.eventPath)));
      return evidence();
    } });
    assert.equal(result.deliveryComplete, true);
    assert.equal(h.posts.length, 1);
  });
});

const invalidConfigs = [
  ["mode", "operator_sample"], ["autoSendEnabled", false], ["autoSendEnabled", "true"],
  ["canonicalSourcePromoted", false], ["calculationMode", "cached"], ["sourceScanEnabled", false],
  ["rosterDiscoveryEnabled", false], ["studioId", "9999"], ["templateId", "synthetic-other-template"],
  ["automaticPolicyId", "synthetic-other-policy"], ["cutoverAt", "2026-10-07T15:00:00.001Z"],
  ["automaticSourceCollection", "workLanes"], ["nativeE2eVerified", false], ["activationCommit", ""],
  ["baselineInitializedAt", ""], ["baselineInitializedAt", "invalid"],
  ["baselineInitializedAt", HOLDING_AUTO_CUTOVER], ["baselineInitializedAt", "2026-10-08T00:00:00.000Z"],
];

test("all activation flags, policy, exact cutoff and baseline are checked again in the claim transaction", async t => {
  assert.equal(holdingAutomaticConfigIssue(config(), NOW), "");
  assert.equal(holdingAutomaticConfigIssue(undefined, NOW), "holding_automatic_configuration_required");
  for (const [field, value] of invalidConfigs) await t.test(`${field}=${value}`, async () => {
    const changed = { ...config(), [field]: value };
    assert.equal(holdingAutomaticConfigIssue(changed, NOW), "holding_automatic_configuration_required");
    assert.throws(() => automaticHoldingEvidence(evidence(), changed, NOW), /holding_automatic_configuration_required/);
    const h = harness();
    await assert.rejects(h.run({ readLatest: async () => {
      h.db.docs.set("settings/holdingNotice", changed);
      return evidence();
    } }), /holding_automatic_configuration_required/);
    assert.ok(h.db.transactionReads.includes("settings/holdingNotice"));
    assertUnclaimed(h);
  });
});

test("only the exact canonical event path can authorize dispatch, not a lane or alternate event id", async t => {
  for (const location of [null, `workLanes/synthetic/events`, `${HOLDING_AUTO_EVENTS}/synthetic-wrong-id`])
    await t.test(String(location), async () => {
      const h = harness(), event = h.db.docs.get(h.eventPath);
      h.db.docs.delete(h.eventPath);
      if (location) h.db.docs.set(location, event);
      await assert.rejects(h.run(), /holding_canonical_event_changed_or_missing/);
      assert.ok(h.db.transactionReads.includes(h.eventPath));
      assertUnclaimed(h);
    });
});

test("every canonical event field, missing field and unexpected raw evidence is tamper-evident", async t => {
  const sample = harness(), original = sample.db.docs.get(sample.eventPath);
  for (const field of Object.keys(original)) await t.test(field, async () => {
    for (const remove of [false, true]) {
      const h = harness(), event = h.db.docs.get(h.eventPath);
      if (remove) delete event[field];
      else event[field] = typeof event[field] === "boolean" ? false : typeof event[field] === "number" ? 2 : "synthetic-tamper";
      assert.equal(automaticHoldingEventIssue(event, h.plan, config(), NOW), "holding_canonical_event_changed_or_missing");
      await assert.rejects(h.run(), /holding_canonical_event_changed_or_missing/);
      assertUnclaimed(h);
    }
  });
  const h = harness();
  h.db.docs.get(h.eventPath).sourceEvidence = evidence();
  await assert.rejects(h.run(), /holding_canonical_event_changed_or_missing/);
  assertUnclaimed(h);
});

test("deleting or changing a canonical event after provider preflight is caught before claim", async () => {
  for (const mutate of [h => h.db.docs.delete(h.eventPath), h => { h.db.docs.get(h.eventPath).canonical = false; }]) {
    const h = harness();
    await assert.rejects(h.run({ readLatest: async () => { mutate(h); return evidence(); } }), /holding_canonical_event_changed_or_missing/);
    assertUnclaimed(h);
  }
});

test("staff and other recipient exclusions use the canonical member inside the transaction", async t => {
  for (const reason of ["synthetic_staff_excluded", "synthetic_recipient_opt_out"]) await t.test(reason, async () => {
    const h = harness();
    await assert.rejects(h.run({ readLatest: async () => {
      h.db.docs.set(`syntheticRecipientExclusions/${MEMBER.phone}`, { reason });
      return evidence();
    } }), new RegExp(reason));
    assert.deepEqual(h.exclusions, [MEMBER]);
    assert.ok(h.db.transactionReads.includes(`syntheticRecipientExclusions/${MEMBER.phone}`));
    assertUnclaimed(h);
  });
});

test("missing or changed canonical member blocks even when a matching mirror exists", async t => {
  for (const field of [null, "memberId", "name", "phone", "studioId"]) await t.test(String(field), async () => {
    const h = harness();
    h.db.docs.set(`member360Cards/${MEMBER.memberId}`, structuredClone(MEMBER));
    await assert.rejects(h.run({ readLatest: async () => {
      if (field) h.db.docs.get(`memberProfiles/${MEMBER.memberId}`)[field] = "synthetic-changed";
      else h.db.docs.delete(`memberProfiles/${MEMBER.memberId}`);
      return evidence();
    } }), /operator_member_changed/);
    assert.equal(h.exclusions.length, 0);
    assertUnclaimed(h);
  });
});

test("automatic ledger records deliveryMode and canonical identity but never raw history", async () => {
  const h = harness(), canonical = structuredClone(h.db.docs.get(h.eventPath)), result = await h.run();
  assert.equal(result.deliveryComplete, true);
  assert.equal(result.providerPostCount, 1);
  assert.equal(h.posts.length, 1);
  for (const collection of ["alimtalkCandidates", "alimtalkSends"]) {
    const row = h.db.docs.get(`${collection}/${h.plan.id}`);
    assert.deepEqual(row.payload, { holdingNotice: true, deliveryMode: "automatic_live_readback",
      source: "studiomate_live_ticket_readback", holdingEventId: h.plan.id, policyId: HOLDING_AUTO_POLICY });
    assert.equal(row.isTest, false);
    assert.equal(row.calculationMode, "live_studiomate_readback");
    assert.equal(row.reviewedByUid, HOLDING_AUTO_POLICY);
    assert.equal(row.attempts, 1);
    assert.equal(row.maxAttempts, 1);
    for (const field of ["sourceEvidence", "history", "activeHolds", "raw"])
      assert.equal(Object.hasOwn(row, field), false, field);
  }
  assert.equal(h.db.docs.get(`holdingNoticeClaims/${h.plan.id}`).status, "delivered");
  assert.deepEqual(h.db.docs.get(h.eventPath), canonical);
  const receipt = await reconcileVerifiedOperatorHolding({ db: h.db, stamp: () => NOW.toISOString(), id: h.plan.id, request: h.request });
  assert.equal(receipt.deliveryComplete, true);
  assert.equal(receipt.providerPostCount, 0);
  assert.equal(h.posts.length, 1);
});

test("same-event concurrent automatic calls and later replay produce exactly one POST", { timeout: 2000 }, async () => {
  const h = harness();
  let arrived = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const readLatest = async () => {
    if (++arrived === 2) release();
    await gate;
    return evidence();
  };
  const results = await Promise.all([h.run({ readLatest }), h.run({ readLatest })]);
  assert.equal(arrived, 2);
  assert.deepEqual(results.map(result => result.providerPostCount).sort(), [0, 1]);
  assert.equal(results.filter(result => result.duplicateBlocked).length, 1);
  assert.equal(h.posts.length, 1);
  assert.equal(h.db.creates.length, 3);
  await assert.rejects(h.run(), /prior_holding_local/);
  assert.equal(h.posts.length, 1);
});

test("unknown provider outcome retains durable claims and blocks every retry", async t => {
  for (const failure of ["throw", "acceptance", "receipt"]) await t.test(failure, async () => {
    const h = harness({ failure });
    await assert.rejects(h.run(), /provider_outcome_unknown|provider_acceptance_unknown|receipt_identity/);
    assert.equal(h.posts.length, 1);
    assert.equal(h.db.docs.get(`holdingNoticeClaims/${h.plan.id}`).status, "reconciliation_required");
    assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).providerOutcome, "unknown_do_not_retry");
    assert.equal(h.db.docs.get(`alimtalkCandidates/${h.plan.id}`).status, "failed");
    await assert.rejects(h.run(), /prior_holding_local/);
    assert.equal(h.posts.length, 1);
    assert.equal(h.db.creates.length, 3);
  });
});

test("prior provider receipt without a known local canonical ledger blocks automatic dispatch", async () => {
  const h = harness({ providerPrior: true });
  await assert.rejects(h.run(), /prior_holding_provider/);
  assertUnclaimed(h);
});

test("manual dispatch stays blocked while automation is enabled, including default automatic=false", async () => {
  for (const automatic of [false, undefined]) {
    const h = harness();
    await assert.rejects(h.run({ automatic }), /inactive_automation/);
    assertUnclaimed(h);
  }
});

test("automatic dispatch requires policy-bound approval, not a manual approval relabelled as automatic", async () => {
  const h = harness(), plan = structuredClone(h.plan);
  plan.approval.approvedBy = "synthetic-manual-operator";
  await assert.rejects(h.run({ plan }), /holding_canonical_event_changed_or_missing/);
  assertUnclaimed(h);
});

test("fresh native source must be read after provider preflight and must remain unchanged before claim", async t => {
  const readers = [
    ["missing reader", undefined],
    ["reader failure", async () => { throw new Error("synthetic_reader_unavailable"); }],
    ["pre-request snapshot", async () => ({ ...evidence(), observedAt: new Date(NOW.getTime() - 1).toISOString() })],
    ["new source history", async () => {
      const raw = evidence();
      raw.history.push({ at: "2026. 10. 08. 10:00", staff: "Synthetic Operator", type: "일괄변경",
        changes: [change("이용종료일", "2027-01-04", "2027-01-05")] });
      return raw;
    }],
    ["changed holding controls", async () => { const raw = evidence(); raw.currentHold.end = "2026-10-15"; return raw; }],
    ["cancellation before claim", async () => {
      const raw = evidence();
      raw.history.push({ at: "2026. 10. 08. 10:00", staff: "Synthetic Operator", type: "수강권 정지취소", changes: [] });
      return raw;
    }],
  ];
  for (const [name, readLatest] of readers) await t.test(name, async () => {
    const h = harness();
    await assert.rejects(h.run({ readLatest }));
    assert.equal(h.calls[0].method, "GET");
    assert.equal(h.db.transactionReads.length, 0);
    assertUnclaimed(h);
  });
  const h = harness();
  await h.run({ readLatest: async ({ memberId, ticketName }) => {
    assert.deepEqual(h.calls.map(call => call.method), ["GET"]);
    assert.equal(memberId, MEMBER.memberId);
    assert.equal(ticketName, "Synthetic Annual Pass");
    assert.deepEqual(h.db.creates, []);
    return evidence();
  } });
  assert.equal(h.posts.length, 1);
});
