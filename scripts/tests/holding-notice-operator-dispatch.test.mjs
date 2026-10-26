import test from "node:test";
import assert from "node:assert/strict";
import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID } from "../lib/holding-allowance-notice.mjs";
import { HOLDING_SOURCE, holdingFingerprint, normalizeHoldingObservation } from "../lib/studiomate-holding-source.mjs";
import { dispatchVerifiedOperatorHolding, verifiedOperatorHoldingPlan, reconcileVerifiedOperatorHolding, reconcileExistingHoldingAttempt } from "../lib/holding-notice-operator-dispatch.mjs";
import { automaticHoldingEvent, HOLDING_AUTO_MODE, HOLDING_AUTO_POLICY, HOLDING_AUTO_EVENTS, HOLDING_AUTO_CUTOVER } from "../lib/holding-notice-automatic.mjs";
import { automaticHoldingPeriodChangeEvidence, HOLDING_PERIOD_CHANGE_POLICY } from "../lib/holding-period-change-policy.mjs";

const NOW = new Date("2026-10-07T11:00:00Z");
const member = { memberId: "101", name: "Fixture Member", phone: "01000000001", studioId: "5330" };
const change = (field, before, after) => ({ field, before, after });
function evidence() {
  return { source: HOLDING_SOURCE, studioId: "5330", memberId: "101", memberName: member.name, ticketName: "Fixture Annual Pass",
    memberUrl: "https://arcpilates.studiomate.kr/users/detail?id=101", observedAt: NOW.toISOString(), historyComplete: true, activeHoldsComplete: true,
    activeHolds: [{ start: "2026-10-07", end: "2026-10-31" }], currentHold: { start: "2026-10-07", end: "2026-10-31" }, history: [
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
  snapshot(path) { const row = structuredClone(this.docs.get(path)); return { exists: this.docs.has(path), data: () => structuredClone(row) }; }
  querySnapshot({name, field, value, n}) {
    const docs = [...this.docs].filter(([p, row]) => p.startsWith(`${name}/`) && row[field] === value)
      .slice(0, n).map(([p]) => ({ id: p.split("/")[1], ...this.snapshot(p) }));
    return { size: docs.length, docs };
  }
  collection(name) { return { where: (field, _, value) => ({ query: true, name, field, value,
    limit: n => ({ query: true, name, field, value, n, get: async () => this.querySnapshot({name, field, value, n}) }) }) }; }
  async runTransaction(fn) {
    const previous = this.tail; let release; this.tail = new Promise(resolve => { release = resolve; }); await previous;
    const writes = [];
    try {
      const result = await fn({
        get: async ref => {
          assert.equal(writes.length, 0);
          if (!ref.query) return this.snapshot(ref.path);
          return this.querySnapshot(ref);
        },
        create: (ref, row) => { assert.equal(this.docs.has(ref.path), false); writes.push([ref.path, row]); },
        update: (ref, row) => { assert.ok(this.docs.has(ref.path)); writes.push([ref.path, { ...this.docs.get(ref.path), ...row }]); },
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
    recipientIssue: async () => issue, readLatest: async () => evidence(), now: () => NOW, memoPolicy:"holding_delivery_memo_v1", ...overrides });
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
  assert.throws(() => verifiedOperatorHoldingPlan(raw, member, approved(raw), new Date(NOW.getTime() + 120001)), /fresh_/);
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
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).sourceEvidence, undefined);
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).calculationMode, "live_studiomate_readback");
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoPolicy, "holding_delivery_memo_v1");
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoStatus, "ready");
  assert.deepEqual(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoRanges, [{start:"2026-10-07",end:"2026-10-31"}]);
  await assert.rejects(h.run(), /prior_holding_local/); assert.equal(h.posts.length, 1);
  const reconciled = await reconcileVerifiedOperatorHolding({ db: h.db, stamp: () => NOW.toISOString(), id: h.plan.id, request: h.request });
  assert.equal(reconciled.deliveryComplete, true); assert.equal(reconciled.providerPostCount, 0);
});

test("accepted receipts wait for final delivery before making the memo outbox ready", async () => {
  const h=harness(); h.row.status="SENDING"; h.row.statusCode="2000";
  const result=await h.run();
  assert.equal(result.deliveryComplete,false);
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoStatus,"waiting_delivery");
  h.row.status="COMPLETE";h.row.statusCode="4000";
  await reconcileVerifiedOperatorHolding({db:h.db,stamp:()=>NOW.toISOString(),id:h.plan.id,request:h.request});
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoStatus,"ready");
  assert.equal(h.posts.length,1);
});

test("new policy uses the existing immediate receipt verification and makes accepted memo ready without another delivery lookup",async()=>{
  const h=harness();h.row.status="SENDING";h.row.statusCode="3000";
  let gets=0;
  const result=await h.run({memoPolicy:"holding_acceptance_memo_v2",request:(url,method,body)=>{
    if(method!=="POST")gets++;
    return h.request(url,method,body);
  }});
  assert.equal(gets,2);assert.equal(h.posts.length,1);assert.equal(result.deliveryComplete,false);
  const send=h.db.docs.get(`alimtalkSends/${h.plan.id}`),claim=h.db.docs.get(`holdingNoticeClaims/${h.plan.id}`);
  assert.equal(send.holdingMemoPolicy,"holding_acceptance_memo_v2");assert.equal(send.holdingMemoStatus,"ready");
  assert.equal(send.holdingMemoAcceptedMessageId,"fixture-message");
  assert.equal(claim.holdingMemoAcceptanceFingerprint,send.holdingMemoAcceptanceFingerprint);
  assert.equal(send.holdingMemoAcceptanceEvidence,"verified_provider_receipt");
  for(const status of ["queued","review"]){
    h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoStatus=status;h.row.status="COMPLETE";h.row.statusCode="4000";
    await reconcileVerifiedOperatorHolding({db:h.db,stamp:()=>NOW.toISOString(),id:h.plan.id,request:h.request});
    assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoStatus,status);
  }
});

test("production dispatcher default opts in only newly created sends to acceptance policy",async()=>{
  const h=harness();h.row.status="SENDING";h.row.statusCode="3000";
  await h.run({memoPolicy:undefined});
  const send=h.db.docs.get(`alimtalkSends/${h.plan.id}`);
  assert.equal(send.holdingMemoPolicy,"holding_acceptance_memo_v2");
  assert.equal(send.holdingMemoStatus,"ready");assert.equal(h.posts.length,1);
});

test("new policy never marks rejected, unknown or mismatched provider responses memo-ready",async()=>{
  for(const mutate of [row=>{row.status="COMPLETE";row.statusCode="5000";},
    row=>{row.status="UNKNOWN";row.statusCode="3000";},row=>{row.text="different content";}]){
    const h=harness();mutate(h.row);
    try{await h.run({memoPolicy:"holding_acceptance_memo_v2"});}catch{}
    const send=h.db.docs.get(`alimtalkSends/${h.plan.id}`);
    assert.notEqual(send.holdingMemoStatus,"ready");assert.equal(send.holdingMemoAcceptedMessageId,undefined);
    assert.equal(h.posts.length,1);
  }
  const h=harness({failure:true});
  await assert.rejects(h.run({memoPolicy:"holding_acceptance_memo_v2"}));
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoAcceptedMessageId,undefined);
  assert.equal(h.posts.length,1);
});

test("unknown immediate readback stays held until exact receipt reconciliation recovers the same new-policy event",async()=>{
  const h=harness();
  await assert.rejects(h.run({memoPolicy:"holding_acceptance_memo_v2",request:async(url,method,body)=>{
    if(method!=="POST"&&h.posts.length)throw new Error("readback_timeout");
    return h.request(url,method,body);
  }}),/readback_timeout/);
  const ref=`alimtalkSends/${h.plan.id}`;
  assert.equal(h.db.docs.get(ref).holdingMemoStatus,"waiting_acceptance");
  assert.equal(h.db.docs.get(ref).holdingMemoAcceptedMessageId,undefined);
  await reconcileVerifiedOperatorHolding({db:h.db,stamp:()=>NOW.toISOString(),id:h.plan.id,request:h.request});
  assert.equal(h.db.docs.get(ref).holdingMemoStatus,"ready");
  assert.equal(h.db.docs.get(ref).holdingMemoAcceptedMessageId,"fixture-message");
  assert.equal(h.posts.length,1);
});

test("existing-attempt wrapper recovers new acceptance while still SENDING and delivered legacy-worker proof without POST",async()=>{
  for(const complete of [false,true]){
    const h=harness();await h.run({memoPolicy:"holding_acceptance_memo_v2"});
    const send=h.db.docs.get(`alimtalkSends/${h.plan.id}`),claim=h.db.docs.get(`holdingNoticeClaims/${h.plan.id}`);
    for(const row of [send,claim])for(const field of ["holdingMemoAcceptedAt","holdingMemoAcceptedMessageId","holdingMemoAcceptanceEvidence","holdingMemoAcceptanceFingerprint"])delete row[field];
    send.holdingMemoStatus="waiting_acceptance";
    if(!complete){h.row.status="SENDING";h.row.statusCode="3000";send.providerStatus="SENDING";send.providerStatusCode="3000";claim.status="accepted_pending_readback";}
    const result=await reconcileExistingHoldingAttempt({db:h.db,stamp:()=>NOW.toISOString(),plan:h.plan,request:h.request});
    assert.equal(result.providerPostCount,0);assert.equal(h.posts.length,1);
    assert.equal(result.deliveryComplete,complete);assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoStatus,"ready");
    assert.equal(h.db.docs.get(`holdingNoticeClaims/${h.plan.id}`).holdingMemoAcceptedMessageId,"fixture-message");
  }
});

test("concurrent receipt and memo projection cannot be reopened by a late accepted response",async()=>{
  for(const memoStatus of ["queued","review"]){
    const h=harness();h.row.status="SENDING";h.row.statusCode="3000";
    await h.run({memoPolicy:"holding_acceptance_memo_v2",request:async(url,method,body)=>{
      if(method!=="POST"&&h.posts.length){
        h.row.status="COMPLETE";h.row.statusCode="4000";
        await reconcileVerifiedOperatorHolding({db:h.db,stamp:()=>NOW.toISOString(),id:h.plan.id,request:h.request});
        h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoStatus=memoStatus;
        h.row.status="SENDING";h.row.statusCode="3000";
      }
      return h.request(url,method,body);
    }});
    assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoStatus,memoStatus);
    assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).providerStatusCode,"4000");
    assert.equal(h.posts.length,1);
  }
});

test("a lost commit response preserves durable accepted evidence and never downgrades or resends",async()=>{
  const h=harness();h.row.status="SENDING";h.row.statusCode="3000";
  const original=h.db.runTransaction.bind(h.db);let lost=false;
  h.db.runTransaction=async fn=>{const result=await original(fn);
    if(!lost&&h.db.docs.get(`alimtalkSends/${h.plan.id}`)?.holdingMemoAcceptedMessageId){lost=true;throw new Error("commit_response_lost");}
    return result;
  };
  const result=await h.run({memoPolicy:"holding_acceptance_memo_v2"});
  assert.equal(result.deliveryComplete,false);assert.equal(lost,true);assert.equal(h.posts.length,1);
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).providerOutcome,"accepted_verified");
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoStatus,"ready");
});

test("reconciliation never enrolls a historical ledger into the memo policy", async () => {
  const h=harness();await h.run();
  const ledger=h.db.docs.get(`alimtalkSends/${h.plan.id}`);
  delete ledger.holdingMemoPolicy;delete ledger.holdingMemoStatus;delete ledger.holdingMemoRanges;
  ledger.providerStatus="SENDING";h.db.docs.get(`holdingNoticeClaims/${h.plan.id}`).status="accepted";
  await reconcileVerifiedOperatorHolding({db:h.db,stamp:()=>NOW.toISOString(),id:h.plan.id,request:h.request});
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoStatus,undefined);
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).holdingMemoPolicy,undefined);
  assert.equal(h.posts.length,1);
});

test("rechecking terminal delivery does not rewrite the original candidate or ledger timestamps", async () => {
  const h = harness(); await h.run();
  const before = structuredClone(h.db.docs);
  await reconcileVerifiedOperatorHolding({ db: h.db, stamp: () => "2026-10-17T10:00:00.000Z", id: h.plan.id, request: h.request });
  assert.deepEqual(h.db.docs, before);
});

test("concurrent successful reconciliations tolerate mutable receipt updates and write completion once", async () => {
  const h = harness(); await h.run();
  h.db.docs.get(`alimtalkSends/${h.plan.id}`).providerStatus = "SENDING";
  h.db.docs.get(`holdingNoticeClaims/${h.plan.id}`).status = "accepted";
  let stamps = 0;
  const reconcile = () => reconcileVerifiedOperatorHolding({ db: h.db, stamp: () => { stamps++; return NOW.toISOString(); },
    id: h.plan.id, request: h.request });
  const results = await Promise.all([reconcile(), reconcile()]);
  assert.ok(results.every(row => row.deliveryComplete));
  assert.equal(stamps, 1);
  assert.equal(h.posts.length, 1);
});

test("dispatch must acquire a new ticket after provider checks; stale files and reader errors never send", async () => {
  for (const readLatest of [undefined, async () => { throw new Error("browser_locked"); },
    async () => ({ ...evidence(), observedAt: new Date(NOW.getTime() - 1).toISOString() }),
    async () => { const raw = evidence(); raw.history.push({ at: "2026. 10. 07. 19:00", staff: "Fixture", type: "일괄변경",
      changes: [change("이용종료일", "2027-03-26", "2027-04-01")] }); return raw; },
  ]) {
    const h = harness(); await assert.rejects(h.run({ readLatest }));
    assert.equal(h.posts.length, 0); assert.equal(h.db.docs.has(`holdingNoticeClaims/${h.plan.id}`), false);
  }
});
test("concurrent calls post once; unknown outcome retains durable claims and cannot retry", async () => {
  const h = harness(); await Promise.all([h.run(), h.run()]); assert.equal(h.posts.length, 1);
  const unknown = harness({ failure: true }); await assert.rejects(unknown.run(), /unknown_provider/);
  assert.equal(unknown.db.docs.get(`holdingNoticeClaims/${unknown.plan.id}`).status, "reconciliation_required");
  await assert.rejects(unknown.run(), /prior_holding_local/); assert.equal(unknown.posts.length, 1);
});
test("a late receipt error never downgrades delivery independently confirmed by another worker", async () => {
  const h = harness();
  const result = await h.run({ request: async (url, method, body) => {
    if (!method && h.posts.length) {
      await reconcileVerifiedOperatorHolding({ db: h.db, stamp: () => NOW.toISOString(), id: h.plan.id, request: h.request });
      throw new Error("late_receipt_network_error");
    }
    return h.request(url, method, body);
  } });
  assert.equal(result.deliveryComplete, true);
  assert.equal(h.posts.length, 1);
  assert.equal(h.db.docs.get(`alimtalkCandidates/${h.plan.id}`).status, "sent");
  assert.equal(h.db.docs.get(`alimtalkSends/${h.plan.id}`).status, "done");
  assert.equal(h.db.docs.get(`holdingNoticeClaims/${h.plan.id}`).status, "delivered");
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

test("a distinct next holding uses the freshly shortened prior period and does not hit lifetime duplicate suppression", async () => {
  const h = harness(); await h.run();
  const later = new Date("2026-10-20T12:00:00.000Z"), raw = evidence();
  raw.observedAt = later.toISOString(); raw.activeHolds = [{ start: "2026-10-07", end: "2026-10-16" }, { start: "2026-10-20", end: "2026-10-26" }];
  raw.currentHold = raw.activeHolds[1];
  raw.history.push({ at: "2026. 10. 17. 12:00", staff: "Fixture", type: "수강권 정지취소", changes: [] },
    { at: "2026. 10. 20. 12:00", staff: "Fixture", type: "수강권정지", changes: [
      change("정지시작일", "내역없음", "2026-10-20"), change("정지종료일", "내역없음", "2026-10-26")] });
  const approval = { ...approved(raw), creationEvidenceFingerprint: normalizeHoldingObservation(raw).history.at(-1).fingerprint };
  const plan = verifiedOperatorHoldingPlan(raw, member, approval, later);
  let newRow;
  const run = (readLatest = async () => raw) => dispatchVerifiedOperatorHolding({ db: h.db, stamp: () => later.toISOString(), plan, template: template(),
    recipientIssue: async () => "", readLatest, now: () => later,
    request: async (url, method, body) => {
      if (method === "POST") {
        h.posts.push(body); newRow = { ...h.row, messageId: "next-hold-message", groupId: "next-hold-group", text: plan.message,
          kakaoOptions: { ...h.row.kakaoOptions, variables: structuredClone(plan.variables) } };
        return { messageList: [newRow] };
      }
      return { messageList: [h.row, ...(newRow ? [newRow] : [])] };
    } });
  const before = structuredClone(h.db.docs);
  for (const mutate of [() => { h.db.docs.get(`alimtalkSends/${h.plan.id}`).message = "changed after provider check"; },
    () => { const row = structuredClone(h.db.docs.get(`alimtalkSends/${h.plan.id}`)); row.issuanceFingerprint = "a".repeat(64);
      row.creationEvidenceFingerprint = "b".repeat(64); row.id = `holding_operator_notice_${holdingFingerprint([row.studioId, row.memberId, row.issuanceFingerprint, row.creationEvidenceFingerprint])}`;
      row.candidateId = row.id; row.sendId = row.id; h.db.docs.set(`alimtalkSends/${row.id}`, row); },
  ]) {
    await assert.rejects(run(async () => { mutate(); return raw; }), /prior_holding_/);
    assert.equal(h.posts.length, 1); h.db.docs = structuredClone(before);
  }
  const result = await run(); assert.equal(result.deliveryComplete, true);
  assert.equal(h.posts.length, 2); assert.equal(plan.summary.usedDays, 17); assert.equal(plan.summary.remainingDays, 56);
  assert.equal(h.posts[1].messages[0].kakaoOptions.variables["#{잔여홀딩일수}"], "56");
  await assert.rejects(run(), /prior_holding_local/); assert.equal(h.posts.length, 2);
});

test("changed issuance metadata cannot mint another send key for the same holding", async () => {
  const h = harness(); await h.run();
  const raw = evidence(); raw.history[0].staff = "Updated display name";
  const plan = verifiedOperatorHoldingPlan(raw, member, approved(raw), NOW);
  assert.notEqual(plan.id, h.plan.id);
  assert.equal(plan.creationEvidenceFingerprint, h.plan.creationEvidenceFingerprint);
  await assert.rejects(h.run({ plan, readLatest: async () => raw }), /prior_holding_local/);
  assert.equal(h.posts.length, 1);
});

const LINKED_EXCEL_ID = "excel_synthetic_dispatch_101";
const LINKED_PROFILE_PATH = `memberProfiles/${LINKED_EXCEL_ID}`;
const LINKED_LOOKUP_PATH = `studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${LINKED_EXCEL_ID}`;
const LINKED_RESOLVED_AT = "2026-10-07T10:00:00.000Z";

function linkedHarness(patch = {}) {
  const h = harness();
  h.db.docs.delete(`memberProfiles/${member.memberId}`);
  h.db.docs.set(LINKED_PROFILE_PATH, { ...member, memberId: LINKED_EXCEL_ID,
    studiomateMemberId: member.memberId, studiomateMemberIdResolvedAt: LINKED_RESOLVED_AT, ...patch });
  h.db.docs.set(LINKED_LOOKUP_PATH, { jobId: `studiomate_member_id_lookup_${LINKED_EXCEL_ID}`,
    memberId: LINKED_EXCEL_ID, studioId: member.studioId, memberName: member.name, memberPhone: member.phone,
    studiomateMemberId: member.memberId, status: "done", resolvedAt: LINKED_RESOLVED_AT });
  return h;
}

function assertNoLinkedDispatch(h) {
  assert.equal(h.posts.length, 0);
  for (const collection of ["alimtalkCandidates", "alimtalkSends", "holdingNoticeClaims"]) {
    assert.equal(h.db.docs.has(`${collection}/${h.plan.id}`), false, `${collection} must not be claimed`);
  }
  assert.equal(h.db.docs.has(`memberProfiles/${member.memberId}`), false, "never synthesize a native profile");
}

test("verified Excel-only identity dispatches once under the unchanged canonical plan key without native creation", async () => {
  const h = linkedHarness();
  const before = structuredClone(h.db.docs);
  assert.equal(h.plan.id, planFor(evidence()).id);
  const result = await h.run({ recipientIssue: async (_tx, profile) => {
    assert.deepEqual(profile, { ...before.get(LINKED_PROFILE_PATH), memberId: member.memberId });
    return "";
  } });
  assert.equal(result.deliveryComplete, true);
  assert.equal(result.id, h.plan.id);
  assert.equal(result.providerPostCount, 1);
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0].messages[0].to, member.phone);
  for (const collection of ["alimtalkCandidates", "alimtalkSends", "holdingNoticeClaims"]) {
    assert.equal(h.db.docs.get(`${collection}/${h.plan.id}`).memberId, member.memberId);
  }
  assert.equal(h.db.docs.get(`holdingNoticeClaims/${h.plan.id}`).status, "delivered");
  assert.equal(h.db.docs.has(`memberProfiles/${member.memberId}`), false);
  assert.deepEqual(h.db.docs.get(LINKED_PROFILE_PATH), before.get(LINKED_PROFILE_PATH));
  assert.deepEqual(h.db.docs.get(LINKED_LOOKUP_PATH), before.get(LINKED_LOOKUP_PATH));
  assert.deepEqual([...h.db.docs.keys()].filter(path => !before.has(path)).sort(), [
    `alimtalkCandidates/${h.plan.id}`, `alimtalkSends/${h.plan.id}`, `holdingNoticeClaims/${h.plan.id}`,
  ].sort());
  await assert.rejects(h.run(), /prior_holding_local/);
  assert.equal(h.posts.length, 1);
});

test("revoked or changed linked proof immediately before the claim transaction prevents every provider POST", async t => {
  for (const [label, mutate, error] of [
    ["lookup revoked", h => { h.db.docs.get(LINKED_LOOKUP_PATH).status = "pending"; }, /holding_member_lookup_proof_mismatch/],
    ["lookup removed", h => { h.db.docs.delete(LINKED_LOOKUP_PATH); }, /holding_member_lookup_proof_mismatch/],
    ["native pointer changed", h => { h.db.docs.get(LINKED_PROFILE_PATH).studiomateMemberId = "102"; }, /operator_member_changed/],
    ["profile resolution revoked", h => { delete h.db.docs.get(LINKED_PROFILE_PATH).studiomateMemberIdResolvedAt; }, /holding_verified_member_link_required/],
    ["profile resolution changed", h => { h.db.docs.get(LINKED_PROFILE_PATH).studiomateMemberIdResolvedAt = "2026-10-07T10:00:00.001Z"; }, /holding_member_lookup_proof_mismatch/],
    ["lookup timestamp changed", h => { h.db.docs.get(LINKED_LOOKUP_PATH).resolvedAt = "2026-10-07T10:00:00.001Z"; }, /holding_member_lookup_proof_mismatch/],
    ["lookup name changed", h => { h.db.docs.get(LINKED_LOOKUP_PATH).memberName = "Synthetic Other Member"; }, /holding_member_lookup_proof_mismatch/],
    ["lookup phone changed", h => { h.db.docs.get(LINKED_LOOKUP_PATH).memberPhone = "01000000002"; }, /holding_member_lookup_proof_mismatch/],
    ["lookup studio changed", h => { h.db.docs.get(LINKED_LOOKUP_PATH).studioId = "9001"; }, /holding_member_lookup_proof_mismatch/],
    ["second native pointer", h => { h.db.docs.set("memberProfiles/excel_synthetic_duplicate_101",
      { ...h.db.docs.get(LINKED_PROFILE_PATH), memberId: "excel_synthetic_duplicate_101" }); }, /holding_unique_linked_member_required/],
    ["second phone profile", h => { h.db.docs.set("memberProfiles/102", { ...member, memberId: "102" }); }, /holding_member_phone_ambiguity/],
  ]) {
    await t.test(label, async () => {
      const h = linkedHarness();
      const originalTransaction = h.db.runTransaction.bind(h.db);
      let latestChecked = false, exclusionChecks = 0;
      h.db.runTransaction = async callback => {
        assert.equal(latestChecked, true, "mutate only after the final live holding readback");
        mutate(h);
        return originalTransaction(callback);
      };
      await assert.rejects(h.run({
        readLatest: async () => {
          assert.equal(h.db.docs.get(LINKED_LOOKUP_PATH).status, "done");
          assert.equal(h.db.docs.get(LINKED_PROFILE_PATH).studiomateMemberId, member.memberId);
          latestChecked = true;
          return evidence();
        },
        recipientIssue: async () => { exclusionChecks++; return ""; },
      }), error);
      assert.equal(latestChecked, true);
      assert.equal(exclusionChecks, 0, "unverified identity cannot reach recipient eligibility or claim writes");
      assertNoLinkedDispatch(h);
    });
  }
});

test("staff and member-exclusion fields survive Excel resolution and still block dispatch", async t => {
  for (const patch of [{ isStaff: true }, { excludeFromAlimtalk: true }, { memberGrade: "스텝" }]) {
    await t.test(JSON.stringify(patch), async () => {
      const h = linkedHarness(patch);
      let exclusionChecks = 0;
      await assert.rejects(h.run({ recipientIssue: async (_tx, profile) => {
        exclusionChecks++;
        assert.equal(profile.memberId, member.memberId);
        for (const [field, value] of Object.entries(patch)) assert.equal(profile[field], value);
        return "synthetic_staff_excluded";
      } }), /synthetic_staff_excluded/);
      assert.equal(exclusionChecks, 1);
      assertNoLinkedDispatch(h);
    });
  }
});

test("a native document that appears before claim remains authoritative over the Excel link", async () => {
  const h = linkedHarness();
  await assert.rejects(h.run({ readLatest: async () => {
    h.db.docs.set(`memberProfiles/${member.memberId}`, { ...member, name: "Synthetic Other Native Member" });
    return evidence();
  } }), /operator_member_changed/);
  assert.equal(h.posts.length, 0);
  assert.equal(h.db.docs.has(`holdingNoticeClaims/${h.plan.id}`), false);
});

const CHANGE_NOW = new Date("2026-10-26T08:30:00.000Z");
async function periodChangeHarness() {
  const original = harness();
  await original.run();
  const { db } = original, raw = evidence();
  raw.observedAt = CHANGE_NOW.toISOString();
  raw.history.push({ at: "2026. 10. 26. 16:55", staff: "Fixture Operator", type: "수강권정지",
    changes: [change("정지종료일", "2026-10-31", "2026-11-01")] });
  raw.currentHold.end = raw.activeHolds[0].end = "2026-11-01";
  const settings = { mode: HOLDING_AUTO_MODE, autoSendEnabled: true, canonicalSourcePromoted: true,
    calculationMode: "live_studiomate_readback", sourceScanEnabled: true, rosterDiscoveryEnabled: true,
    studioId: "5330", templateId: HOLDING_NOTICE_TEMPLATE_ID, automaticPolicyId: HOLDING_AUTO_POLICY,
    cutoverAt: HOLDING_AUTO_CUTOVER, automaticSourceCollection: HOLDING_AUTO_EVENTS, nativeE2eVerified: true,
    activationCommit: "a".repeat(40), baselineInitializedAt: "2026-10-07T14:00:00.000Z",
    periodChangeNotice: { enabled: true, policyId: HOLDING_PERIOD_CHANGE_POLICY,
      activatedAt: "2026-10-26T07:00:00.000Z", approvedBy: "fixture-human", templateId: HOLDING_NOTICE_TEMPLATE_ID,
      allowedPriorChanges: [] } };
  const originalSend = structuredClone(db.docs.get(`alimtalkSends/${original.plan.id}`));
  const proof = automaticHoldingPeriodChangeEvidence(raw, settings, originalSend, CHANGE_NOW);
  const plan = verifiedOperatorHoldingPlan(raw, member, { ...proof.approval, memberPhone: member.phone }, CHANGE_NOW);
  db.docs.set("settings/holdingNotice", settings);
  db.docs.set(`${HOLDING_AUTO_EVENTS}/${plan.id}`, automaticHoldingEvent(plan, proof.selected, settings));
  const row = { ...structuredClone(original.row), messageId: "fixture-change-message", text: plan.message,
    kakaoOptions: { templateId: HOLDING_NOTICE_TEMPLATE_ID, disableSms: true, variables: structuredClone(plan.variables) } };
  const posts = [], providerRows = [structuredClone(original.row)];
  let failure = false;
  const request = async (_url, method, body) => {
    if (method === "POST") {
      assert.equal(db.docs.get(`holdingNoticeClaims/${plan.id}`).status, "claimed");
      posts.push(body);
      if (failure) throw new Error("fixture_change_unknown_acceptance");
      providerRows.push(row);
      return { messageList: [row] };
    }
    return { messageList: providerRows };
  };
  const originalRecords = ["alimtalkCandidates", "alimtalkSends", "holdingNoticeClaims"].map(collection =>
    [collection, structuredClone(db.docs.get(`${collection}/${original.plan.id}`))]);
  const run = (overrides = {}) => dispatchVerifiedOperatorHolding({ db, stamp: () => CHANGE_NOW.toISOString(), plan,
    template: template(), request, recipientIssue: async () => "", readLatest: async () => structuredClone(raw),
    automatic: true, now: () => CHANGE_NOW, ...overrides });
  return { db, original, originalRecords, originalSend, raw, proof, plan, row, posts, request, run,
    unknown: () => { failure = true; } };
}

test("period update uses unchanged approved template, own claim, and preserves all original ledgers", async () => {
  const h = await periodChangeHarness();
  assert.notEqual(h.plan.id, h.original.plan.id);
  assert.equal(h.plan.originalNoticeId, h.original.plan.id);
  assert.equal(h.plan.noticePurpose, "holding_period_change");
  assert.equal(h.plan.variables["#{이번홀딩일수}"], "26");
  assert.equal(h.plan.variables["#{잔여홀딩일수}"], "47");
  const sent = await h.run();
  assert.equal(sent.providerPostCount, 1);
  assert.equal(sent.deliveryComplete, true);
  assert.equal(h.posts[0].messages[0].kakaoOptions.templateId, HOLDING_NOTICE_TEMPLATE_ID);
  for (const [collection, prior] of h.originalRecords)
    assert.deepEqual(h.db.docs.get(`${collection}/${h.original.plan.id}`), prior);
  const repeated = await reconcileExistingHoldingAttempt({ db: h.db, stamp: () => CHANGE_NOW.toISOString(), plan: h.plan, request: h.request });
  assert.equal(repeated.duplicateBlocked, true);
  assert.equal(repeated.providerPostCount, 0);
  await assert.rejects(h.run(), /prior_holding_local/);
  assert.equal(h.posts.length, 1);
});

test("concurrent change dispatch has at most one provider transport", async () => {
  const h = await periodChangeHarness();
  const results = await Promise.allSettled([h.run(), h.run()]);
  assert.equal(h.posts.length, 1);
  assert.ok(results.some(r => r.status === "fulfilled" && r.value.providerPostCount === 1));
});

test("ambiguous change acceptance is never retried or converted into registration", async () => {
  const h = await periodChangeHarness();
  h.unknown();
  await assert.rejects(h.run(), /fixture_change_unknown_acceptance/);
  await assert.rejects(h.run(), /prior_holding_local/);
  await assert.rejects(reconcileExistingHoldingAttempt({ db: h.db, stamp: () => CHANGE_NOW.toISOString(), plan: h.plan, request: h.request }), /prior_claim_reconciliation/);
  assert.equal(h.posts.length, 1);
  for (const [collection, prior] of h.originalRecords)
    assert.deepEqual(h.db.docs.get(`${collection}/${h.original.plan.id}`), prior);
});

test("changed source, altered policy, nonapproved template and exclusions block change before POST", async () => {
  for (const reason of ["source", "policy", "template", "exclusion", "original"]) {
    const h = await periodChangeHarness();
    let overrides = {};
    if (reason === "source") overrides.readLatest = async () => {
      const altered = structuredClone(h.raw);
      altered.history.push({ at: "2026. 10. 26. 17:00", staff: "Fixture Operator", type: "수강권정지수정",
        changes: [change("정지종료일", "2026-11-01", "2026-11-02")] });
      altered.currentHold.end = altered.activeHolds[0].end = "2026-11-02";
      return altered;
    };
    if (reason === "policy") h.db.docs.get("settings/holdingNotice").periodChangeNotice.enabled = false;
    if (reason === "template") overrides.template = { ...template(), status: "PENDING" };
    if (reason === "exclusion") overrides.recipientIssue = async () => "fixture_staff_excluded";
    if (reason === "original") h.db.docs.get(`holdingNoticeClaims/${h.original.plan.id}`).status = "accepted";
    await assert.rejects(h.run(overrides));
    assert.equal(h.posts.length, 0, reason);
    assert.equal(h.db.docs.has(`holdingNoticeClaims/${h.plan.id}`), false, reason);
  }
});

test("period change quiet hours defer without a claim or transport", async () => {
  const h = await periodChangeHarness();
  const result = await h.run({ now: () => new Date("2026-10-26T14:00:00.000Z") });
  assert.equal(result.status, "deferred");
  assert.equal(result.providerPostCount, 0);
  assert.equal(h.posts.length, 0);
  assert.equal(h.db.docs.has(`holdingNoticeClaims/${h.plan.id}`), false);
});

test("a second change validates delivered predecessor despite Firestore map ordering", async () => {
  const h = await periodChangeHarness();
  await h.run();
  for (const collection of ["alimtalkCandidates", "alimtalkSends"])
    h.db.docs.get(`${collection}/${h.plan.id}`).periodChange = Object.fromEntries(Object.entries(h.plan.periodChange).sort());
  const raw = structuredClone(h.raw), now = new Date("2026-10-27T03:00:00.000Z");
  raw.observedAt = now.toISOString();
  raw.history.push({ at: "2026. 10. 27. 11:00", staff: "Fixture Operator", type: "수강권정지수정",
    changes: [change("정지종료일", "2026-11-01", "2026-11-02")] });
  raw.activeHolds[0].end = raw.currentHold.end = "2026-11-02";
  const settings = h.db.docs.get("settings/holdingNotice");
  const proof = automaticHoldingPeriodChangeEvidence(raw, settings, h.originalSend, now,
    [h.db.docs.get(`alimtalkSends/${h.plan.id}`)]);
  const plan = verifiedOperatorHoldingPlan(raw, member, { ...proof.approval, memberPhone: member.phone }, now);
  assert.notEqual(plan.id, h.plan.id);
  h.db.docs.set(`${HOLDING_AUTO_EVENTS}/${plan.id}`, automaticHoldingEvent(plan, proof.selected, settings));
  const row = { ...structuredClone(h.row), messageId: "fixture-second-change", text: plan.message,
    kakaoOptions: { templateId: HOLDING_NOTICE_TEMPLATE_ID, disableSms: true, variables: plan.variables } };
  let posts = 0;
  const request = async (_url, method) => {
    if (method === "POST") { posts++; return { messageList: [row] }; }
    return { messageList: [h.original.row, h.row, ...(posts ? [row] : [])] };
  };
  const result = await dispatchVerifiedOperatorHolding({ db: h.db, stamp: () => now.toISOString(), plan,
    template: template(), request, recipientIssue: async () => "", readLatest: async () => raw, automatic: true, now: () => now });
  assert.equal(result.providerPostCount, 1);
  assert.equal(posts, 1);
  assert.equal(h.db.docs.get(`holdingNoticeClaims/${h.plan.id}`).status, "delivered");
});

test("direct receipt polling rejects mismatched change purpose and proof without ledger updates", async () => {
  for (const [collection, field, value] of [["alimtalkCandidates", "noticePurpose", "other"],
    ["holdingNoticeClaims", "changeFingerprint", "f".repeat(64)],
    ["holdingNoticeClaims", "originalNoticeId", "other"],
    ["alimtalkCandidates", "periodChange", {}]]) {
    const h = await periodChangeHarness();
    await h.run();
    h.db.docs.get(`${collection}/${h.plan.id}`)[field] = value;
    const before = structuredClone(h.db.docs);
    await assert.rejects(reconcileVerifiedOperatorHolding({ db: h.db, stamp: () => CHANGE_NOW.toISOString(), id: h.plan.id, request: h.request }), /holding_receipt_ledger_changed/);
    assert.deepEqual(h.db.docs, before);
    assert.equal(h.posts.length, 1);
  }
});

test("23:00 crossing after claim resumes only a proven zero-POST deferral at 09:00", async () => {
  const h = await periodChangeHarness();
  const result = await h.run({ now: () => h.db.docs.has(`holdingNoticeClaims/${h.plan.id}`)
    ? new Date("2026-10-26T14:00:00.000Z") : CHANGE_NOW });
  assert.equal(result.status, "deferred");
  assert.equal(h.posts.length, 0);
  for (const collection of ["alimtalkCandidates", "alimtalkSends", "holdingNoticeClaims"]) {
    const row = h.db.docs.get(`${collection}/${h.plan.id}`);
    assert.equal(row.attempts, 0);
    assert.equal(row.providerOutcome, "quiet_deferred_no_transport");
  }
  const next = new Date("2026-10-27T00:00:00.000Z");
  h.raw.observedAt = next.toISOString();
  const proof = automaticHoldingPeriodChangeEvidence(h.raw, h.db.docs.get("settings/holdingNotice"), h.originalSend, next);
  const plan = verifiedOperatorHoldingPlan(h.raw, member, { ...proof.approval, memberPhone: member.phone }, next);
  assert.equal(await reconcileExistingHoldingAttempt({ db: h.db, stamp: () => next.toISOString(), plan, request: h.request }), null);
  const resumed = await h.run({ plan, now: () => next, readLatest: async () => h.raw });
  assert.equal(resumed.providerPostCount, 1);
  assert.equal(h.posts.length, 1);
  assert.equal(h.db.docs.get(`holdingNoticeClaims/${plan.id}`).status, "delivered");
});
