import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import {
  CONTRACT_REMINDER_POLICY,
  assertContractReminderLive,
  contractReminderEnabled,
  planContractSignatureReminder,
  processContractSignatureReminder,
} from "../lib/contract-signature-reminder.mjs";
import { assertContractReminderSmsResponse } from "../lib/contract-signature-reminder-browser.mjs";

const ID = "a".repeat(64);
const NOW = "2026-10-20T01:00:00.000Z";
const SENT = "2026-10-19T01:00:00.000Z";
const SETTINGS = "systemSettings/membershipContractAutomation";
const CONTRACT = `studiomateMembershipContracts/${ID}`;
const WAITING_TEXT = "\uC694\uCCAD\uB300\uAE30";
const clone = value => structuredClone(value);
let originalFetch;

before(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("External network is forbidden in reminder unit tests"); };
});
after(() => { globalThis.fetch = originalFetch; });

function sourceFixture(id = ID) {
  const memberId = "101", userTicketId = "202";
  const selectionJobKey = `membership_contract_${createHash("sha256")
    .update(JSON.stringify(["studiomate-membership-v1", memberId, userTicketId])).digest("hex")}`;
  const binding = {
    verified: true, studioId: "5330", contractId: id, memberId, userTicketId,
    productId: "303", memberPhone: "01000000000", title: "Synthetic membership contract",
    contractAction: "first_purchase_contract", selectionJobKey,
    selectedAt: "2026-10-19T00:00:00.000Z",
    expectedTotalAmount: 100000, expectedPaidAmount: 100000, expectedOutstandingAmount: 0,
    previousObservations: [],
  };
  const source = {
    schemaVersion: 1, source: "studiomate_native_contract", studioId: "5330",
    contractId: id, bindingVerified: true, binding, memberName: "Synthetic Member",
    status: "waiting", observationStatus: "waiting", observationHold: false,
  };
  source.lastObservation = sentObservation(source);
  return source;
}

function sentObservation(source, observedAt = SENT) {
  const bindingIdentity = Object.fromEntries(
    ["studioId", "memberId", "userTicketId", "productId", "selectionJobKey", "selectedAt"]
      .map(key => [key, source.binding[key]]),
  );
  return {
    schemaVersion: 1, source: "studiomate_contract_dom", verified: true, complete: true,
    loading: false, matchCount: 1, status: "sent", statusText: WAITING_TEXT,
    contractId: source.contractId, memberName: source.memberName,
    memberPhone: source.binding.memberPhone, title: source.binding.title,
    centerSignaturePresent: true, memberSignaturePresent: false,
    signedDate: null, signedDateText: null, bindingIdentity, observedAt,
  };
}

function liveFixture(source, checkedAt = NOW) {
  const b = source.binding;
  return {
    checkedAt,
    memberResult: {
      status: "verified", matchCount: 1,
      member: { memberId: b.memberId, phone: b.memberPhone, name: source.memberName, inactive: false },
    },
    contract: {
      verified: true, complete: true, contractId: source.contractId, studioId: b.studioId,
      memberId: b.memberId, title: b.title, categoryId: 1, memberPhone: b.memberPhone,
      memberName: source.memberName, status: "sent", memberSignaturePresent: false,
      centerSignaturePresent: true, signedAt: null,
      ticket: {
        userTicketId: b.userTicketId, productId: b.productId,
        amount: b.expectedPaidAmount, unpaidAmount: b.expectedOutstandingAmount,
      },
    },
    dom: { ...sentObservation(source, checkedAt) },
    ticketRead: {
      status: "verified",
      tickets: [{
        verified: true, complete: true, memberId: b.memberId, studioId: b.studioId,
        userTicketId: b.userTicketId, productId: b.productId, status: "active",
        refunded: false, cancelled: false,
        payment: {
          verified: true, complete: true, refundedAmount: 0,
          totalAmount: b.expectedTotalAmount, paidAmount: b.expectedPaidAmount,
          outstandingAmount: b.expectedOutstandingAmount,
        },
      }],
    },
  };
}

function configFixture() {
  return {
    studioId: "5330", observeEnabled: true, sourcePromoted: true,
    mode: "live", nativeE2eVerified: true,
    signatureReminderEnabled: true, signatureReminderPolicy: CONTRACT_REMINDER_POLICY,
  };
}

// Serialize callbacks and publish writes only after success, like atomic transactions.
function memoryDb(source, config = configFixture()) {
  const rows = new Map([[CONTRACT, clone(source)], [SETTINGS, clone(config)]]);
  const commits = [];
  let tail = Promise.resolve();
  const snapshot = value => ({ exists: value !== undefined, data: () => clone(value) });
  return {
    commits,
    read: path => clone(rows.get(path)),
    replace: (path, value) => rows.set(path, clone(value)),
    doc: path => ({ path, get: async () => snapshot(rows.get(path)) }),
    runTransaction(callback) {
      const result = tail.then(async () => {
        const pending = new Map();
        const writes = [];
        const valueAt = path => pending.has(path) ? pending.get(path) : rows.get(path);
        const result = await callback({
          get: async ref => snapshot(valueAt(ref.path)),
          update(ref, patch) {
            assert.ok(valueAt(ref.path), "Update requires an existing in-memory document");
            pending.set(ref.path, { ...clone(valueAt(ref.path)), ...clone(patch) });
            writes.push({ path: ref.path, patch: clone(patch) });
          },
        });
        for (const [path, value] of pending) rows.set(path, value);
        commits.push(writes);
        return result;
      });
      tail = result.catch(() => {});
      return result;
    },
  };
}

function responseFixture(plan) {
  return {
    url: "https://api.studiomate.kr/v2/staff/sms", status: 200,
    body: {
      id: 404, studio_id: plan.studioId, type: "send", is_sent: 1,
      title: plan.smsTitle, message: plan.smsMessage,
    },
    payload: { users: [plan.memberId], title: plan.smsTitle, message: plan.smsMessage },
  };
}

function fakeBrowserAdapter({ beforeConfirm, afterClaim, responseMutation, responseError } = {}) {
  const state = { prepared: 0, sends: 0, plans: [], events: [] };
  state.sendSms = async (plan, beforeFinalSend) => {
    state.prepared++;
    state.plans.push(clone(plan));
    state.events.push("compose");
    await beforeConfirm?.(plan);
    await beforeFinalSend();
    state.events.push("claim_committed");
    await afterClaim?.(plan);
    state.sends++;
    state.events.push("final_confirm");
    if (responseError) throw responseError;
    const response = responseFixture(plan);
    responseMutation?.(response);
    assertContractReminderSmsResponse(response, plan);
    return { smsId: response.body.id };
  };
  return state;
}

function harness({ source = sourceFixture(), browserOptions, readLive, config } = {}) {
  const db = memoryDb(source, config);
  const browser = fakeBrowserAdapter(browserOptions);
  const state = { reads: 0 };
  return {
    db, browser, state, source,
    run(overrides = {}) {
      return processContractSignatureReminder({
        db, source: clone(source), id: ID, now: () => new Date(NOW), apply: true, scheduled: true,
        readLive: async () => {
          state.reads++;
          return readLive ? readLive(state.reads) : liveFixture(source);
        },
        sendSms: browser.sendSms,
        ...overrides,
      });
    },
  };
}

test("24-hour threshold uses the first verified sent observation, not creation/update time", () => {
  const source = sourceFixture();
  source.createdAt = "2020-01-01T00:00:00.000Z";
  source.updatedAt = NOW;
  assert.deepEqual(planContractSignatureReminder(source, ID, new Date(Date.parse(NOW) - 1)), {
    status: "skipped", reason: "under_24_hours",
  });
  for (const offset of [0, 1]) {
    const plan = planContractSignatureReminder(source, ID, new Date(Date.parse(NOW) + offset));
    assert.equal(plan.status, "ready");
    assert.equal(plan.firstConfirmedAt, SENT);
    assert.equal(plan.timingBasis, "first_verified_sent_observation");
  }
});

test("KST window is inclusive at 09:00 and exclusive at 20:00", async t => {
  const cases = [
    ["2026-10-20T23:59:59.999Z", "skipped"],
    ["2026-10-21T00:00:00.000Z", "ready"],
    ["2026-10-21T10:59:59.999Z", "ready"],
    ["2026-10-21T11:00:00.000Z", "skipped"],
    ["2026-10-21T15:00:00.000Z", "skipped"],
  ];
  for (const [now, status] of cases) await t.test(now, () => {
    const plan = planContractSignatureReminder(sourceFixture(), ID, new Date(now));
    assert.equal(plan.status, status);
    if (status === "skipped") assert.equal(plan.reason, "outside_send_window");
  });
});

test("missing, future, unverified or cross-bound send evidence fails closed", async t => {
  const cases = [
    ["missing history", s => { delete s.lastObservation; }],
    ["unverified", s => { s.lastObservation.verified = false; }],
    ["incomplete", s => { s.lastObservation.complete = false; }],
    ["future instant", s => { s.lastObservation.observedAt = "2026-10-21T01:00:00.000Z"; }],
    ["date only", s => { s.lastObservation.observedAt = "2026-10-19"; }],
    ["invalid instant", s => { s.lastObservation.observedAt = "2026-02-30T01:00:00.000Z"; }],
    ["pre-selection", s => { s.lastObservation.observedAt = "2026-10-18T01:00:00.000Z"; }],
    ["draft", s => { s.lastObservation.status = "draft"; }],
    ["wrong renderer status", s => { s.lastObservation.statusText = "unknown"; }],
    ["wrong contract", s => { s.lastObservation.contractId = "b".repeat(64); }],
    ["wrong phone", s => { s.lastObservation.memberPhone = "01099999999"; }],
    ["wrong name", s => { s.lastObservation.memberName = "Different Member"; }],
    ["wrong title", s => { s.lastObservation.title = "Different contract"; }],
    ["wrong issuance", s => { s.lastObservation.bindingIdentity.userTicketId = "999"; }],
    ["unsigned center", s => { s.lastObservation.centerSignaturePresent = false; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const source = sourceFixture();
    source.createdAt = "2020-01-01T00:00:00.000Z";
    source.sentAt = "2020-01-01T00:00:00.000Z";
    mutate(source);
    assert.deepEqual(planContractSignatureReminder(source, ID, new Date(NOW)), {
      status: "skipped", reason: "original_send_time_unverified",
    });
  });
});

test("oldest trusted bound history wins without refreshing the timing baseline", () => {
  const source = sourceFixture();
  const original = clone(source.lastObservation);
  source.lastObservation = sentObservation(source, "2026-10-20T00:59:00.000Z");
  const foreign = sentObservation(source, "2026-10-19T00:00:01.000Z");
  foreign.bindingIdentity.memberId = "999";
  source.binding.previousObservations = [foreign, original];
  source.observationTail = [sentObservation(source, "2026-10-19T03:00:00.000Z")];
  const before = clone(source);
  const plan = planContractSignatureReminder(source, ID, new Date(NOW));
  assert.equal(plan.status, "ready");
  assert.equal(plan.firstConfirmedAt, SENT);
  assert.deepEqual(source, before);
});

test("historical signed/cancelled/expired or signature/date conflicts veto later unsigned observations", async t => {
  const conflicts = [
    ["signed status", row => { row.status = "signed"; }],
    ["cancelled status", row => { row.status = "cancelled"; }],
    ["expired status", row => { row.status = "expired"; }],
    ["member signature", row => { row.memberSignaturePresent = true; }],
    ["signed date", row => { row.signedDate = "2026-10-19"; }],
    ["rendered signing date", row => { row.signedDateText = "2026-10-19"; }],
  ];
  for (const location of ["previousObservations", "observationTail", "lastObservation"]) {
    for (const [name, mutate] of conflicts) await t.test(`${location}: ${name}`, async () => {
      const source = sourceFixture();
      const conflict = sentObservation(source, "2026-10-19T02:00:00.000Z");
      mutate(conflict);
      source.binding.previousObservations = [clone(source.lastObservation)];
      source.lastObservation = sentObservation(source, "2026-10-20T00:59:00.000Z");
      if (location === "previousObservations") source.binding.previousObservations.push(conflict);
      else if (location === "observationTail") source.observationTail = [conflict];
      else source.lastObservation = conflict;
      const before = clone(source);
      assert.deepEqual(planContractSignatureReminder(source, ID, new Date(NOW)), {
        status: "skipped", reason: "historical_signature_conflict",
      });
      const h = harness({ source });
      assert.deepEqual(await h.run(), { status: "skipped", reason: "historical_signature_conflict" });
      assert.equal(h.state.reads, 0);
      assert.equal(h.browser.prepared, 0);
      assert.equal(h.browser.sends, 0);
      assert.equal(h.db.commits.length, 0);
      assert.deepEqual(source, before);
    });
  }
});

test("invalid source or clock cannot become a dispatch plan", async t => {
  for (const [name, mutate] of [
    ["source collection", s => { s.source = "member360Cards"; }],
    ["binding verification", s => { s.bindingVerified = false; }],
    ["native member identity", s => { s.binding.memberId = "excel_101"; }],
    ["issuance identity", s => { s.binding.selectionJobKey = "different"; }],
    ["studio", s => { s.studioId = "999"; }],
    ["contract identity", s => { s.binding.contractId = "b".repeat(64); }],
  ]) await t.test(name, () => {
    const source = sourceFixture();
    mutate(source);
    assert.equal(planContractSignatureReminder(source, ID, new Date(NOW)).reason, "invalid_source");
  });
  assert.equal(planContractSignatureReminder(sourceFixture(), ID, new Date(NaN)).reason, "invalid_source");
  assert.equal(planContractSignatureReminder(sourceFixture(), "invalid", new Date(NOW)).reason, "invalid_source");
});

test("non-unsigned sources and every existing reminder state suppress planning", async t => {
  for (const [name, patch] of [
    ["signed", { status: "signed" }], ["cancelled", { status: "cancelled" }],
    ["review", { observationStatus: "review" }], ["hold", { observationHold: true }],
    ["completion", { completion: { signedAt: NOW } }],
    ["receipt", { signatureReceipt: { signedAt: NOW } }],
    ["invalidated completion", { invalidatedCompletion: { signedAt: NOW } }],
  ]) await t.test(name, () => {
    assert.equal(planContractSignatureReminder({ ...sourceFixture(), ...patch }, ID, new Date(NOW)).reason, "not_unsigned");
  });
  for (const status of ["attempting", "accepted", "review", "failed", "unknown"]) await t.test(status, () => {
    const source = { ...sourceFixture(), signatureReminder: { status } };
    assert.equal(planContractSignatureReminder(source, ID, new Date(NOW)).reason, "reminder_already_recorded");
  });
});

test("fingerprint ignores binding map order and additional later observations, not payload changes", () => {
  const source = sourceFixture();
  const plan = planContractSignatureReminder(source, ID, new Date(NOW));
  const reordered = clone(source);
  reordered.binding = Object.fromEntries(Object.entries(reordered.binding).reverse());
  reordered.binding.previousObservations.push(sentObservation(source, "2026-10-19T02:00:00.000Z"));
  const actual = planContractSignatureReminder(reordered, ID, new Date(NOW));
  assert.equal(actual.fingerprint, plan.fingerprint);
  assert.equal(actual.key, `contract_signature_reminder_${ID}`);
  assert.match(actual.fingerprint, /^[a-f0-9]{64}$/);
  assert.match(actual.smsMessage, new RegExp(`https://sign\\.studiomate\\.kr/${ID}$`));
  assert.ok(actual.smsMessage.includes(source.memberName));
  const changed = clone(source);
  changed.binding.expectedTotalAmount++;
  assert.notEqual(planContractSignatureReminder(changed, ID, new Date(NOW)).fingerprint, plan.fingerprint);
  const renamed = clone(source);
  renamed.memberName = "Renamed Synthetic Member";
  renamed.lastObservation.memberName = renamed.memberName;
  assert.notEqual(planContractSignatureReminder(renamed, ID, new Date(NOW)).fingerprint, plan.fingerprint);
  const other = planContractSignatureReminder(sourceFixture("b".repeat(64)), "b".repeat(64), new Date(NOW));
  assert.notEqual(other.key, plan.key);
});

test("manual and dry-run modes perform zero database reads, live reads or sends", async t => {
  for (const [apply, scheduled] of [[false, false], [false, true], [true, false]]) {
    await t.test(`apply=${apply}, scheduled=${scheduled}`, async () => {
      const h = harness();
      const result = await h.run({ apply, scheduled, db: { doc: () => assert.fail("No database access in non-dispatch mode") } });
      assert.equal(result.status, "dry_run");
      assert.equal(h.state.reads, 0);
      assert.equal(h.browser.prepared, 0);
      assert.equal(h.browser.sends, 0);
      assert.equal(h.db.commits.length, 0);
    });
  }
});

test("all configuration gates must be explicitly enabled", async t => {
  assert.equal(contractReminderEnabled(configFixture()), true);
  for (const [key, value] of [
    ["studioId", "999"], ["observeEnabled", false], ["sourcePromoted", false],
    ["mode", "shadow"], ["mode", undefined],
    ["nativeE2eVerified", false], ["nativeE2eVerified", undefined], ["nativeE2eVerified", "true"],
    ["signatureReminderEnabled", false], ["signatureReminderPolicy", "different-policy"],
  ]) await t.test(`${key}=${String(value)}`, async () => {
    const config = { ...configFixture(), [key]: value };
    assert.equal(contractReminderEnabled(config), false);
    const h = harness({ config });
    assert.equal((await h.run()).status, "disabled");
    assert.equal(h.state.reads, 0);
    assert.equal(h.browser.prepared, 0);
    assert.equal(h.browser.sends, 0);
    assert.equal(h.db.commits.length, 0);
  });
});

test("successful dispatch persists the claim before final confirmation and never implies delivery", async () => {
  const h = harness();
  let claim;
  const browser = fakeBrowserAdapter({ afterClaim: () => {
    claim = h.db.read(CONTRACT).signatureReminder;
    assert.equal(claim.status, "attempting");
    assert.equal(claim.attempts, 1);
    assert.equal(claim.firstConfirmedAt, SENT);
  } });
  const result = await h.run({ sendSms: browser.sendSms });
  assert.deepEqual(result, { status: "accepted", contractId: ID, stage: "postclaim", smsId: 404 });
  assert.equal(h.state.reads, 2);
  assert.equal(browser.sends, 1);
  assert.deepEqual(browser.events, ["compose", "claim_committed", "final_confirm"]);
  const saved = h.db.read(CONTRACT).signatureReminder;
  for (const key of ["policy", "key", "fingerprint", "attempts", "firstConfirmedAt", "timingBasis", "attemptedAt", "memberId"]) {
    assert.deepEqual(saved[key], claim[key], `Immutable claim field: ${key}`);
  }
  assert.equal(saved.status, "accepted");
  assert.equal(saved.deliveryStatus, "not_verified");
  assert.equal(saved.acceptedAt, NOW);
  assert.equal(saved.smsId, 404);
});

test("fresh and stale reruns of the same contract cannot replace an accepted claim", async () => {
  const h = harness();
  assert.equal((await h.run()).status, "accepted");
  const saved = h.db.read(CONTRACT);
  assert.equal((await h.run({ source: saved })).reason, "reminder_already_recorded");
  assert.equal((await h.run()).reason, "source_or_claim_unverified");
  assert.equal(h.browser.sends, 1);
  assert.deepEqual(h.db.read(CONTRACT), saved);
});

test("different contracts for the same member and issuance each get one independent attempt", async () => {
  const h = harness();
  assert.equal((await h.run()).status, "accepted");
  const firstClaim = h.db.read(CONTRACT).signatureReminder;
  const id = "b".repeat(64), source = sourceFixture(id);
  const path = `studiomateMembershipContracts/${id}`;
  h.db.replace(path, source);
  const run = overrides => h.run({ source, id, readLive: async () => liveFixture(source), ...overrides });
  assert.equal((await run()).status, "accepted");
  assert.equal((await run({ source: h.db.read(path) })).reason, "reminder_already_recorded");
  assert.equal((await run()).reason, "source_or_claim_unverified");
  assert.equal(h.browser.sends, 2);
  assert.deepEqual(h.db.read(CONTRACT).signatureReminder, firstClaim);
  assert.notEqual(h.db.read(path).signatureReminder.key, firstClaim.key);
  assert.equal(h.db.read(path).signatureReminder.attempts, 1);
});

test("serialized concurrent transactions allow one immutable contract-scoped claim and one send", { timeout: 2000 }, async () => {
  const h = harness();
  let arrivals = 0, release;
  const bothComposed = new Promise(resolve => { release = resolve; });
  const browser = fakeBrowserAdapter({ beforeConfirm: async () => {
    if (++arrivals === 2) release();
    await bothComposed;
  } });
  const results = await Promise.all([h.run({ sendSms: browser.sendSms }), h.run({ sendSms: browser.sendSms })]);
  assert.deepEqual(results.map(result => result.status).sort(), ["accepted", "review"]);
  assert.equal(results.find(result => result.status === "accepted").stage, "postclaim");
  assert.equal(results.find(result => result.status === "review").stage, "preclaim");
  assert.equal(browser.prepared, 2);
  assert.equal(browser.sends, 1);
  const claims = h.db.commits.flat().filter(write => write.patch.signatureReminder?.status === "attempting");
  assert.equal(claims.length, 1);
  const saved = h.db.read(CONTRACT).signatureReminder;
  assert.equal(saved.key, claims[0].patch.signatureReminder.key);
  assert.equal(saved.fingerprint, claims[0].patch.signatureReminder.fingerprint);
  assert.equal(saved.attempts, 1);
  assert.equal(saved.status, "accepted");
});

test("lost or invalid post-claim response is unknown and never automatically resent", async t => {
  for (const [name, options, sends] of [
    ["response lost", { responseError: new Error("Synthetic response loss") }, 1],
    ["response rejected", { responseMutation: response => { response.body.id = 0; } }, 1],
    ["interrupted after claim before confirmation", {
      afterClaim: () => { throw new Error("Synthetic post-claim interruption"); },
    }, 0],
  ]) await t.test(name, async () => {
    const h = harness({ browserOptions: options });
    assert.deepEqual(await h.run(), {
      status: "review", contractId: ID, stage: "postclaim", reason: "send_outcome_unknown",
    });
    const saved = h.db.read(CONTRACT);
    assert.equal(saved.signatureReminder.status, "review");
    assert.equal(saved.signatureReminder.attempts, 1);
    assert.equal(saved.signatureReminder.reason, "send_outcome_unknown");
    assert.deepEqual(await h.run({ source: saved }), {
      status: "review", contractId: ID, stage: "postclaim", reason: "prior_attempt_requires_reconciliation",
    });
    assert.equal((await h.run()).reason, "source_or_claim_unverified");
    assert.equal(h.browser.sends, sends);
    assert.deepEqual(h.db.read(CONTRACT), saved);
  });
});

test("a durable attempting claim left by interruption is never reclaimed", async () => {
  const source = sourceFixture();
  const plan = planContractSignatureReminder(source, ID, new Date(NOW));
  const h = harness();
  const latest = clone(source);
  latest.signatureReminder = {
    key: plan.key, fingerprint: plan.fingerprint, status: "attempting", attempts: 1,
    attemptedAt: "2026-10-19T01:00:00.000Z",
  };
  h.db.replace(CONTRACT, latest);
  assert.deepEqual(await h.run({ source: latest }), {
    status: "review", contractId: ID, stage: "postclaim", reason: "prior_attempt_requires_reconciliation",
  });
  assert.equal((await h.run()).reason, "source_or_claim_unverified");
  assert.equal(h.browser.sends, 0);
  assert.deepEqual(h.db.read(CONTRACT), latest);
});

test("post-claim journal outage returns review, preserves attempting, and never resends", async t => {
  for (const responseLost of [true, false]) await t.test(`responseLost=${responseLost}`, async () => {
    const h = harness();
    let unavailable = false, attempted;
    const db = {
      doc: h.db.doc,
      runTransaction: callback => unavailable
        ? Promise.reject(new Error("Synthetic settlement database outage"))
        : h.db.runTransaction(callback),
    };
    const browser = fakeBrowserAdapter({
      afterClaim: () => {
        attempted = h.db.read(CONTRACT).signatureReminder;
        assert.equal(attempted.status, "attempting");
        unavailable = true;
      },
      ...(responseLost ? { responseError: new Error("Synthetic lost send response") } : {}),
    });
    assert.deepEqual(await h.run({ db, sendSms: browser.sendSms }), {
      status: "review", contractId: ID, stage: "postclaim",
      reason: "send_outcome_unknown_journal_unavailable",
    });
    const saved = h.db.read(CONTRACT);
    assert.deepEqual(saved.signatureReminder, attempted);
    assert.equal(saved.signatureReminder.attempts, 1);
    assert.equal(browser.sends, 1);
    assert.equal(h.db.commits.length, 1);
    assert.deepEqual(await h.run({ db, source: saved, sendSms: browser.sendSms }), {
      status: "review", contractId: ID, stage: "postclaim", reason: "prior_attempt_requires_reconciliation",
    });
    unavailable = false;
    assert.deepEqual(await h.run({ db, sendSms: browser.sendSms }), {
      status: "review", contractId: ID, stage: "preclaim", reason: "source_or_claim_unverified",
    });
    assert.equal(browser.sends, 1);
    assert.deepEqual(h.db.read(CONTRACT), saved);
  });
});

test("an accepted settlement with a lost commit acknowledgment returns its persisted result", async () => {
  const h = harness();
  let calls = 0;
  const db = {
    doc: h.db.doc,
    async runTransaction(callback) {
      const call = ++calls;
      const result = await h.db.runTransaction(callback);
      if (call === 2) throw new Error("Synthetic lost settlement acknowledgment");
      return result;
    },
  };
  assert.deepEqual(await h.run({ db }), {
    status: "accepted", contractId: ID, stage: "postclaim", smsId: 404,
  });
  assert.equal(calls, 3);
  assert.equal(h.browser.sends, 1);
  const saved = h.db.read(CONTRACT);
  assert.equal(saved.signatureReminder.status, "accepted");
  assert.equal(saved.signatureReminder.smsId, 404);
  assert.equal(h.db.commits.flat().filter(write => write.patch.signatureReminder?.status === "review").length, 0);
  await h.run({ db, source: saved });
  assert.equal(h.browser.sends, 1);
  assert.deepEqual(h.db.read(CONTRACT), saved);
});

test("persisted accepted evidence wins over a later receipt or lost send response", async t => {
  for (const responseLost of [false, true]) await t.test(`responseLost=${responseLost}`, async () => {
    const h = harness();
    let accepted;
    const browser = fakeBrowserAdapter({
      afterClaim: () => {
        const latest = h.db.read(CONTRACT);
        latest.signatureReminder = {
          ...latest.signatureReminder, status: "accepted", smsId: 505,
          acceptedAt: "2026-10-20T00:59:59.999Z", deliveryStatus: "not_verified",
        };
        accepted = clone(latest.signatureReminder);
        h.db.replace(CONTRACT, latest);
      },
      ...(responseLost ? { responseError: new Error("Synthetic lost send response") } : {}),
    });
    assert.deepEqual(await h.run({ sendSms: browser.sendSms }), {
      status: "accepted", contractId: ID, stage: "postclaim", smsId: 505,
    });
    assert.equal(browser.sends, 1);
    assert.deepEqual(h.db.read(CONTRACT).signatureReminder, accepted);
  });
});

const liveMutations = [
  ["signed status", live => { live.contract.status = "signed"; }],
  ["member signature", live => { live.contract.memberSignaturePresent = true; }],
  ["signed timestamp", live => { live.contract.signedAt = NOW; }],
  ["cancelled contract", live => { live.contract.status = "cancelled"; }],
  ["expired contract", live => { live.contract.status = "expired"; }],
  ["draft contract", live => { live.contract.status = "draft"; }],
  ["unknown contract status", live => { live.contract.status = "unknown"; }],
  ["DOM status changed", live => { live.dom.statusText = "unknown"; }],
  ["DOM signature", live => { live.dom.memberSignaturePresent = true; }],
  ["DOM signing date", live => { live.dom.signedDateText = "2026-10-20"; }],
  ["missing center signature", live => { live.contract.centerSignaturePresent = false; }],
  ["missing DOM center signature", live => { live.dom.centerSignaturePresent = false; }],
  ["contract phone", live => { live.contract.memberPhone = "01099999999"; }],
  ["live recipient phone", live => { live.memberResult.member.phone = "01099999999"; }],
  ["recipient name", live => { live.memberResult.member.name = "Different Member"; }],
  ["recipient ID", live => { live.memberResult.member.memberId = "999"; }],
  ["inactive recipient", live => { live.memberResult.member.inactive = true; }],
  ["ambiguous recipient", live => { live.memberResult.matchCount = 2; }],
  ["unverified recipient", live => { live.memberResult.status = "review"; }],
  ["excluded recipient grade", live => { live.memberResult.member.memberGrade = "\uAC15\uC0AC"; }],
  ["refunded ticket", live => { live.ticketRead.tickets[0].refunded = true; }],
  ["cancelled ticket", live => { live.ticketRead.tickets[0].cancelled = true; }],
  ["inactive ticket", live => { live.ticketRead.tickets[0].status = "expired"; }],
  ["refund ledger", live => { live.ticketRead.tickets[0].payment.refundedAmount = 1; }],
  ["payment verification revoked", live => { live.ticketRead.tickets[0].payment.verified = false; }],
  ["incomplete payment source", live => { live.ticketRead.tickets[0].payment.complete = false; }],
  ["missing refund evidence", live => { delete live.ticketRead.tickets[0].payment.refundedAmount; }],
  ["current payment total changed", live => { live.ticketRead.tickets[0].payment.totalAmount++; }],
  ["contract paid copy changed", live => { live.contract.ticket.amount--; }],
  ["contract outstanding copy changed", live => { live.contract.ticket.unpaidAmount++; }],
  ["issuance changed", live => { live.contract.ticket.userTicketId = "999"; }],
  ["missing ticket", live => { live.ticketRead.tickets = []; }],
  ["duplicate ticket", live => { live.ticketRead.tickets.push(clone(live.ticketRead.tickets[0])); }],
  ["ticket source unverified", live => { live.ticketRead.status = "review"; }],
  ["stale read", live => { live.checkedAt = "2026-10-20T00:58:59.999Z"; }],
  ["future read", live => { live.checkedAt = "2026-10-20T01:00:00.001Z"; }],
  ["future DOM", live => { live.dom.observedAt = "2026-10-20T01:00:00.001Z"; }],
];

test("every live signature, source, recipient and status change vetoes final confirmation", async t => {
  for (const [name, mutate] of liveMutations) await t.test(name, async () => {
    const source = sourceFixture();
    const h = harness({ source, readLive: read => {
      const live = liveFixture(source);
      if (read === 2) mutate(live);
      return live;
    } });
    const result = await h.run();
    assert.equal(result.reason, "source_or_claim_unverified");
    assert.equal(result.stage, "preclaim");
    assert.equal(h.state.reads, 2);
    assert.equal(h.browser.prepared, 1);
    assert.equal(h.browser.sends, 0);
    assert.equal(h.db.commits.length, 0);
    assert.equal(h.db.read(CONTRACT).signatureReminder, undefined);
  });
});

test("live validator accepts sent/opened only with fresh exact identity and bound ticket", () => {
  const source = sourceFixture();
  const plan = planContractSignatureReminder(source, ID, new Date(NOW));
  for (const status of ["sent", "opened"]) {
    const live = liveFixture(source);
    live.contract.status = status;
    assert.doesNotThrow(() => assertContractReminderLive(source, plan, live, new Date(NOW)));
  }
  const live = liveFixture(source, "2026-10-20T00:59:00.000Z");
  assert.doesNotThrow(() => assertContractReminderLive(source, plan, live, new Date(NOW)));
  live.dom.observedAt = "2026-10-20T00:58:59.999Z";
  assert.throws(() => assertContractReminderLive(source, plan, live, new Date(NOW)), /source_unverified/);
});

test("image loading failure stays preclaim, emits safe diagnostics and can recover without a resend", async t => {
  for (const boundary of [1,2]) await t.test(`live boundary ${boundary}`,async()=>{
    const h=harness();
    const error=new Error("SECRET contact and remote image path");
    error.code="native_contract_signature_images_unavailable";
    const failed=await h.run({readLive:async()=>{
      h.state.reads++;
      if(h.state.reads===boundary)throw error;
      return liveFixture(h.source);
    }});
    assert.deepEqual(failed,{status:"review",contractId:ID,stage:"preclaim",
      reason:"source_or_claim_unverified",diagnostic:"native_contract_signature_images_unavailable"});
    assert.equal(JSON.stringify(failed).includes("SECRET"),false);
    assert.equal(h.browser.sends,0);
    assert.equal(h.db.read(CONTRACT).signatureReminder,undefined);
    assert.equal((await h.run()).status,"accepted");
    assert.equal(h.browser.sends,1);
    assert.equal((await h.run({source:h.db.read(CONTRACT)})).reason,"reminder_already_recorded");
    assert.equal(h.browser.sends,1);
  });
});

test("unpaid/partial contract copies remain valid through verified current payment settlement", async t => {
  for (const [name, originalPaid, settledPaid] of [
    ["unpaid remains unpaid", 0, 0],
    ["unpaid settles partially", 0, 50000],
    ["unpaid settles fully", 0, 100000],
    ["partial remains partial", 40000, 40000],
    ["partial settles fully", 40000, 100000],
  ]) await t.test(name, async () => {
    const source = sourceFixture();
    source.binding.expectedPaidAmount = originalPaid;
    source.binding.expectedOutstandingAmount = 100000 - originalPaid;
    const plan = planContractSignatureReminder(source, ID, new Date(NOW));
    assert.equal(plan.status, "ready");
    const h = harness({ source, readLive: read => {
      const live = liveFixture(source);
      const payment = live.ticketRead.tickets[0].payment;
      payment.paidAmount = read === 1 ? originalPaid : settledPaid;
      payment.outstandingAmount = payment.totalAmount - payment.paidAmount;
      payment.status = payment.paidAmount === 0 ? "unpaid" : payment.outstandingAmount === 0 ? "paid" : "partial";
      assert.equal(live.contract.ticket.amount, originalPaid);
      assert.equal(live.contract.ticket.unpaidAmount, 100000 - originalPaid);
      assert.doesNotThrow(() => assertContractReminderLive(source, plan, live, new Date(NOW)));
      return live;
    } });
    assert.equal((await h.run()).status, "accepted");
    assert.equal(h.state.reads, 2);
    assert.equal(h.browser.sends, 1);
    assert.deepEqual(h.db.read(CONTRACT).binding, source.binding);
    assert.equal(h.db.read(CONTRACT).signatureReminder.deliveryStatus, "not_verified");
  });
});

test("unpaid contract amount must be its original paid copy, not the total or current paid amount", () => {
  const source = sourceFixture();
  source.binding.expectedPaidAmount = 0;
  source.binding.expectedOutstandingAmount = source.binding.expectedTotalAmount;
  const plan = planContractSignatureReminder(source, ID, new Date(NOW));
  for (const wrongAmount of [50000, 100000]) {
    const live = liveFixture(source);
    live.contract.ticket.amount = wrongAmount;
    live.ticketRead.tickets[0].payment.paidAmount = wrongAmount;
    live.ticketRead.tickets[0].payment.outstandingAmount = 100000 - wrongAmount;
    assert.throws(() => assertContractReminderLive(source, plan, live, new Date(NOW)), /source_unverified/);
  }
});

test("current payment total must match the bound total even when paid/outstanding remain internally settled", async t => {
  for (const total of [99999, 100001, undefined, "100000"]) await t.test(`total=${String(total)}`, async () => {
    const source = sourceFixture();
    source.binding.expectedPaidAmount = 0;
    source.binding.expectedOutstandingAmount = 100000;
    const plan = planContractSignatureReminder(source, ID, new Date(NOW));
    const changed = liveFixture(source);
    const payment = changed.ticketRead.tickets[0].payment;
    payment.totalAmount = total;
    payment.paidAmount = typeof total === "number" ? total : 100000;
    payment.outstandingAmount = 0;
    assert.throws(() => assertContractReminderLive(source, plan, changed, new Date(NOW)), /source_unverified/);
    const h = harness({ source, readLive: read => read === 1 ? liveFixture(source) : changed });
    assert.deepEqual(await h.run(), {
      status: "review", contractId: ID, stage: "preclaim", reason: "source_or_claim_unverified",
    });
    assert.equal(h.state.reads, 2);
    assert.equal(h.browser.prepared, 1);
    assert.equal(h.browser.sends, 0);
    assert.equal(h.db.commits.length, 0);
  });
});

test("DOM phone formatting normalizes without changing the canonical recipient", async t => {
  for (const phone of ["010-0000-0000", "010 0000 0000", "+82 10 0000 0000"]) {
    await t.test(phone, async () => {
      const source = sourceFixture();
      const h = harness({ source, readLive: () => {
        const live = liveFixture(source);
        live.dom.memberPhone = phone;
        return live;
      } });
      assert.equal((await h.run()).status, "accepted");
      assert.equal(h.browser.sends, 1);
      assert.equal(h.browser.plans[0].memberPhone, source.binding.memberPhone);
    });
  }
});

test("source/config changes during composition cannot claim or overwrite existing state", async t => {
  for (const [name, mutate] of [
    ["signed source", (source) => { source.status = "signed"; }],
    ["source on hold", (source) => { source.observationHold = true; }],
    ["payload fingerprint changed", (source) => { source.binding.expectedTotalAmount++; }],
    ["reminder inserted", (source) => { source.signatureReminder = { status: "review", key: "existing" }; }],
    ["disabled config", (_source, config) => { config.signatureReminderEnabled = false; }],
    ["runtime leaves live mode", (_source, config) => { config.mode = "shadow"; }],
    ["E2E verification revoked", (_source, config) => { config.nativeE2eVerified = false; }],
    ["historical signature discovered", source => {
      const signed = sentObservation(source, "2026-10-19T02:00:00.000Z");
      signed.status = "signed";
      source.observationTail = [signed];
    }],
  ]) await t.test(name, async () => {
    const h = harness();
    const source = h.db.read(CONTRACT), config = h.db.read(SETTINGS);
    mutate(source, config);
    const browser = fakeBrowserAdapter({ beforeConfirm: () => {
      h.db.replace(CONTRACT, source);
      h.db.replace(SETTINGS, config);
    } });
    const result = await h.run({ sendSms: browser.sendSms });
    assert.equal(result.reason, "source_or_claim_unverified");
    assert.equal(result.stage, "preclaim");
    assert.equal(browser.sends, 0);
    assert.deepEqual(h.db.read(CONTRACT), source);
    assert.equal(h.db.commits.length, 0);
  });
});

test("binding map-order changes between read and transaction do not reject an unchanged claim", async () => {
  const h = harness();
  const browser = fakeBrowserAdapter({ beforeConfirm: () => {
    const latest = h.db.read(CONTRACT);
    latest.binding = Object.fromEntries(Object.entries(latest.binding).reverse());
    h.db.replace(CONTRACT, latest);
  } });
  assert.equal((await h.run({ sendSms: browser.sendSms })).status, "accepted");
  assert.equal(browser.sends, 1);
});

test("failure to commit a claim prevents final confirmation", async () => {
  const h = harness();
  const db = { doc: h.db.doc, runTransaction: async () => { throw new Error("Synthetic commit failure"); } };
  assert.deepEqual(await h.run({ db }), {
    status: "review", contractId: ID, stage: "preclaim", reason: "source_or_claim_unverified",
  });
  assert.equal(h.browser.sends, 0);
  assert.equal(h.db.read(CONTRACT).signatureReminder, undefined);
});

test("settlement cannot overwrite a foreign claim inserted after the dispatch boundary", async () => {
  const h = harness();
  const foreign = { status: "review", key: "other", fingerprint: "other", attempts: 1 };
  const browser = fakeBrowserAdapter({ afterClaim: () => {
    const latest = h.db.read(CONTRACT);
    latest.signatureReminder = foreign;
    h.db.replace(CONTRACT, latest);
  } });
  assert.deepEqual(await h.run({ sendSms: browser.sendSms }), {
    status: "review", contractId: ID, stage: "postclaim", reason: "send_outcome_unknown_journal_unavailable",
  });
  assert.equal(browser.sends, 1);
  assert.deepEqual(h.db.read(CONTRACT).signatureReminder, foreign);
});

test("SMS receipt requires exact provider and outgoing single-recipient payload evidence", async t => {
  const plan = planContractSignatureReminder(sourceFixture(), ID, new Date(NOW));
  assert.equal(plan.memberPhone, "01000000000");
  assert.doesNotThrow(() => assertContractReminderSmsResponse(responseFixture(plan), plan));
  const cases = [
    ["wrong endpoint", r => { r.url += "/other"; }],
    ["non-200 response", r => { r.status = 202; }],
    ["missing response body", r => { delete r.body; }],
    ["zero ID", r => { r.body.id = 0; }],
    ["negative ID", r => { r.body.id = -1; }],
    ["fractional ID", r => { r.body.id = 1.5; }],
    ["string ID", r => { r.body.id = "404"; }],
    ["unsafe ID", r => { r.body.id = Number.MAX_SAFE_INTEGER + 1; }],
    ["wrong studio", r => { r.body.studio_id = "999"; }],
    ["draft receipt", r => { r.body.type = "draft"; }],
    ["explicit unsent", r => { r.body.is_sent = 0; }],
    ["response title", r => { r.body.title += "changed"; }],
    ["response message", r => { r.body.message += "changed"; }],
    ["missing request", r => { delete r.payload; }],
    ["empty recipients", r => { r.payload.users = []; }],
    ["extra recipient", r => { r.payload.users.push("999"); }],
    ["wrong recipient", r => { r.payload.users = ["999"]; }],
    ["non-array recipients", r => { r.payload.users = plan.memberId; }],
    ["request title", r => { r.payload.title += "changed"; }],
    ["request message", r => { r.payload.message += "changed"; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const response = responseFixture(plan);
    mutate(response);
    assert.throws(() => assertContractReminderSmsResponse(response, plan), /sms_receipt_unverified/);
  });
});
