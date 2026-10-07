import test from "node:test";
import assert from "node:assert/strict";
import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID } from "../lib/holding-allowance-notice.mjs";
import { HOLDING_SOURCE, normalizeHoldingObservation } from "../lib/studiomate-holding-source.mjs";
import { dispatchVerifiedOperatorHolding, verifiedOperatorHoldingPlan, reconcileVerifiedOperatorHolding } from "../lib/holding-notice-operator-dispatch.mjs";

const NOW = new Date("2026-10-07T11:00:00Z");
const member = { memberId: "101", name: "Fixture Member", phone: "01000000001", studioId: "5330" };
const change = (field, before, after) => ({ field, before, after });
function evidence() {
  return { source: HOLDING_SOURCE, studioId: "5330", memberId: "101", memberName: member.name, ticketName: "Fixture Annual Pass",
    memberUrl: "https://arcpilates.studiomate.kr/users/detail?id=101", observedAt: NOW.toISOString(), historyComplete: true, activeHoldsComplete: true,
    activeHolds: [{ start: "2026-10-07", end: "2026-10-31" }], history: [
      { at: "2026. 01. 07. 17:26", staff: "Fixture Operator", type: "발급", changes: [change("이용시작일", "내역없음", "2026-03-23"), change("이용종료일", "내역없음", "2027-03-22")] },
      { at: "2026. 07. 19. 19:38", staff: "Fixture Operator", type: "일괄변경", changes: [change("이용종료일", "2027-03-22", "2027-03-26")] },
      { at: "2026. 10. 07. 18:22", staff: "Fixture Operator", type: "수강권정지", changes: [change("정지시작일", "내역없음", "2026-10-07"), change("정지종료일", "내역없음", "2026-10-31")] },
    ] };
}
function approved(raw) {
  const obs = normalizeHoldingObservation(raw);
  return { confirmed: true, approvedBy: "fixture-human-approval", reason: "Explicit member one-off", memberId: member.memberId,
    memberPhone: member.phone, observationFingerprint: obs.observationFingerprint, creationEvidenceFingerprint: obs.history[2].fingerprint };
}
const planFor = raw => verifiedOperatorHoldingPlan(raw, member, approved(raw), NOW);
const template = () => ({ ...structuredClone(HOLDING_NOTICE_TEMPLATE), templateId: HOLDING_NOTICE_TEMPLATE_ID, status: "APPROVED" });

class Store {
  docs = new Map(); tail = Promise.resolve();
  doc(path) { return { path, get: async () => this.snapshot(path) }; }
  snapshot(path) { return { exists: this.docs.has(path), data: () => structuredClone(this.docs.get(path)) }; }
  collection(name) { return { where: (field, _, value) => ({ query: true, name, field, value, limit: n => ({ query: true, name, field, value, n }) }) }; }
  async runTransaction(fn) {
    const previous = this.tail; let release; this.tail = new Promise(resolve => { release = resolve; }); await previous;
    const writes = [];
    try {
      const result = await fn({
        get: async ref => {
          assert.equal(writes.length, 0);
          if (!ref.query) return this.snapshot(ref.path);
          const docs = [...this.docs].filter(([p, row]) => p.startsWith(`${ref.name}/`) && row[ref.field] === ref.value)
            .slice(0, ref.n).map(([p]) => ({ id: p.split("/")[1], ...this.snapshot(p) }));
          return { size: docs.length, docs };
        },
        create: (ref, row) => { assert.equal(this.docs.has(ref.path), false); writes.push([ref.path, row]); },
      });
      for (const [path, row] of writes) this.docs.set(path, structuredClone(row));
      return result;
    } finally { release(); }
  }
  batch() { const updates = []; return {
    update: (ref, row) => updates.push([ref.path, row]),
    commit: async () => { for (const [path, row] of updates) { assert.ok(this.docs.has(path)); this.docs.set(path, { ...this.docs.get(path), ...structuredClone(row) }); } },
  }; }
}
function harness({ failure = false, providerPrior = false, issue = "" } = {}) {
  const db = new Store(), plan = planFor(evidence()), posts = [];
  db.docs.set("settings/holdingNotice", { autoSendEnabled: false, canonicalSourcePromoted: false, templateId: HOLDING_NOTICE_TEMPLATE_ID });
  db.docs.set(`memberProfiles/${member.memberId}`, structuredClone(member));
  const row = { messageId: "fixture-message", groupId: "fixture-group", to: member.phone, status: "COMPLETE", statusCode: "4000", text: plan.message,
    kakaoOptions: { templateId: HOLDING_NOTICE_TEMPLATE_ID, disableSms: true, variables: structuredClone(plan.variables) } };
  const request = async (url, method, body) => {
    if (method === "POST") {
      assert.equal(db.docs.get(`holdingNoticeClaims/${plan.id}`).status, "claimed");
      assert.equal(db.docs.get(`alimtalkSends/${plan.id}`).status, "processing");
      assert.equal(body.allowDuplicates, false); assert.equal(body.messages[0].kakaoOptions.disableSms, true);
      posts.push(body); if (failure) throw new Error("fixture_unknown_provider_outcome");
      return { messageList: [row] };
    }
    assert.equal(url.includes("messageIds="), false);
    return { messageList: posts.length || providerPrior ? { [row.messageId]: row } : {} };
  };
  const run = (overrides = {}) => dispatchVerifiedOperatorHolding({ db, stamp: () => NOW.toISOString(), plan, template: template(), request,
    recipientIssue: async () => issue, now: () => NOW, ...overrides });
  return { db, plan, posts, request, run, row };
}

test("verified unchanged creation produces 73/25/48 from original issuance, excluding center extension", () => {
  const raw = evidence(), plan = planFor(raw);
  assert.deepEqual(plan.summary, { ok: true, originalDays: 365, totalDays: 73, usedDays: 25, remainingDays: 48, overageDays: 0 });
  assert.match(plan.id, /^holding_operator_notice_[a-f0-9]{64}$/);
  const later = { ...raw, observedAt: new Date(NOW.getTime() + 1000).toISOString() };
  assert.equal(verifiedOperatorHoldingPlan(later, member, approved(later), new Date(NOW.getTime() + 1000)).id, plan.id);
});
test("approval is bound to recipient, full evidence, immutable creation, and freshness", () => {
  const raw = evidence();
  for (const patch of [{ confirmed: false }, { memberId: "102" }, { memberPhone: "01000000002" }, { observationFingerprint: "a".repeat(64) }, { creationEvidenceFingerprint: "b".repeat(64) }])
    assert.throws(() => verifiedOperatorHoldingPlan(raw, member, { ...approved(raw), ...patch }, NOW));
  assert.throws(() => verifiedOperatorHoldingPlan(raw, { ...member, name: "Other" }, approved(raw), NOW));
  assert.throws(() => verifiedOperatorHoldingPlan(raw, member, approved(raw), new Date(NOW.getTime() + 120001)), /fresh_operator/);
});
test("empty controls, cancellation, edits, unsupported date changes and overlapping histories block", () => {
  for (const mutate of [raw => { raw.activeHolds = []; }, raw => { raw.history[2].changes[0].before = "2026-10-06"; },
    raw => { raw.activeHolds[0].end = "2026-10-30"; },
    raw => { raw.history.push({ ...raw.history[2], type: "수강권 정지 취소", at: "2026. 10. 07. 19:00" }); },
    raw => { raw.history.push({ ...raw.history[2], type: "수강권 정지 수정", at: "2026. 10. 07. 19:00" }); },
  ]) { const raw = evidence(); mutate(raw); assert.throws(() => planFor(raw)); }
});
test("manual send claims once with automation off and reconciles independently", async () => {
  const h = harness(); const result = await h.run(); assert.equal(result.deliveryComplete, true); assert.equal(h.posts.length, 1);
  assert.equal(h.db.docs.get("settings/holdingNotice").autoSendEnabled, false);
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).isTest, false);
  await assert.rejects(h.run(), /prior_holding_provider/); assert.equal(h.posts.length, 1);
  const reconciled = await reconcileVerifiedOperatorHolding({ db: h.db, stamp: () => NOW.toISOString(), id: h.plan.id, request: h.request });
  assert.equal(reconciled.deliveryComplete, true); assert.equal(reconciled.providerPostCount, 0);
});
test("concurrent calls post once; unknown outcome retains durable claims and cannot retry", async () => {
  const h = harness(); await Promise.all([h.run(), h.run()]); assert.equal(h.posts.length, 1);
  const unknown = harness({ failure: true }); await assert.rejects(unknown.run(), /unknown_provider/);
  assert.equal(unknown.db.docs.get(`holdingNoticeClaims/${unknown.plan.id}`).status, "reconciliation_required");
  await assert.rejects(unknown.run(), /prior_holding_provider/); assert.equal(unknown.posts.length, 1);
});
test("provider and local prior records, staff exclusion, global activation and changed payload block", async () => {
  const prior = harness({ providerPrior: true }); await assert.rejects(prior.run(), /prior_holding_provider/); assert.equal(prior.posts.length, 0);
  const local = harness(); local.db.docs.set("alimtalkSends/old-key", { memberPhone: member.phone, templateCode: HOLDING_NOTICE_TEMPLATE_ID });
  await assert.rejects(local.run(), /prior_holding_local/); assert.equal(local.posts.length, 0);
  const excluded = harness({ issue: "staff excluded" }); await assert.rejects(excluded.run(), /staff excluded/); assert.equal(excluded.posts.length, 0);
  const active = harness(); active.db.docs.get("settings/holdingNotice").autoSendEnabled = true;
  await assert.rejects(active.run(), /inactive_automation/); assert.equal(active.posts.length, 0);
  const changed = harness(); await assert.rejects(changed.run({ plan: { ...changed.plan, variables: { ...changed.plan.variables, "#{잔여홀딩일수}": "999" } } }), /plan_changed/);
  assert.equal(changed.posts.length, 0);
  const wrongId = harness(); wrongId.db.docs.get(`memberProfiles/${member.memberId}`).memberId = "999";
  await assert.rejects(wrongId.run(), /member_changed/); assert.equal(wrongId.posts.length, 0);
});

test("a caller cannot mutate the isolated approved plan while provider evidence is awaited", async () => {
  const h = harness();
  await h.run({ request: async (url, method, body) => {
    if (!method && !h.posts.length) { h.plan.variables["#{잔여홀딩일수}"] = "999"; h.plan.approval.confirmed = false; }
    return h.request(url, method, body);
  } });
  assert.equal(h.posts[0].messages[0].kakaoOptions.variables["#{잔여홀딩일수}"], "48");
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).approval.confirmed, true);
});

test("receipt reconciliation selects the exact durable ID and blocks incomplete or mismatched evidence", async () => {
  const h = harness(); await h.run();
  const reconcile = response => reconcileVerifiedOperatorHolding({ db: h.db, stamp: () => NOW.toISOString(), id: h.plan.id,
    request: async url => {
      const params = new URL(url, "https://api.solapi.com").searchParams;
      assert.equal(params.get("to"), member.phone);
      assert.equal(params.get("startDate"), h.plan.observedAt);
      assert.equal(params.has("messageIds"), false);
      return response;
    } });
  const unrelated = { ...h.row, messageId: "other-message", text: "other notice" };
  assert.equal((await reconcile({ messageList: { other: unrelated, target: h.row } })).deliveryComplete, true);
  await assert.rejects(reconcile({ messageList: { other: unrelated } }), /receipt_identity/);
  await assert.rejects(reconcile({ messageList: { target: h.row }, nextKey: "more" }), /Incomplete provider/);
  await assert.rejects(reconcile({ messageList: { target: { ...h.row, text: "wrong" } } }), /receipt_identity/);
  assert.equal(h.posts.length, 1);
});
