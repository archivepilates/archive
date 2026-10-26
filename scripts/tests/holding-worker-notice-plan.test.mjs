import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HOLDING_NOTICE_TEMPLATE_ID } from "../lib/holding-allowance-notice.mjs";
import { HOLDING_SOURCE } from "../lib/studiomate-holding-source.mjs";
import { HOLDING_AUTO_MODE, HOLDING_AUTO_EVENTS, HOLDING_AUTO_POLICY, HOLDING_AUTO_CUTOVER,
  automaticHoldingReadback, automaticHoldingSourceReadback, automaticHoldingEvent, automaticHoldingEventIssue } from "../lib/holding-notice-automatic.mjs";
import { HOLDING_PERIOD_CHANGE_POLICY } from "../lib/holding-period-change-policy.mjs";
import { reconcileExistingHoldingAttempt, verifiedOperatorHoldingPlan } from "../lib/holding-notice-operator-dispatch.mjs";
import { selectHoldingWorkerNoticePlan } from "../lib/holding-worker-notice-plan.mjs";

const NOW = new Date("2026-10-26T03:00:00.000Z");
const MEMBER = { memberId: "902", name: "Synthetic Worker Member", phone: "01000000902", studioId: "5330" };
const field = (name, before, after) => ({ field: name, before, after });
function config() {
  return { mode: HOLDING_AUTO_MODE, autoSendEnabled: true, canonicalSourcePromoted: true,
    calculationMode: "live_studiomate_readback", sourceScanEnabled: true, rosterDiscoveryEnabled: true,
    studioId: "5330", templateId: HOLDING_NOTICE_TEMPLATE_ID, automaticPolicyId: HOLDING_AUTO_POLICY,
    cutoverAt: HOLDING_AUTO_CUTOVER, automaticSourceCollection: HOLDING_AUTO_EVENTS, nativeE2eVerified: true,
    activationCommit: "a".repeat(40), baselineInitializedAt: "2026-10-07T14:00:00.000Z",
    periodChangeNotice: { enabled: true, policyId: HOLDING_PERIOD_CHANGE_POLICY,
      activatedAt: "2026-10-25T00:00:00.000Z", approvedBy: "synthetic-policy-approval",
      templateId: HOLDING_NOTICE_TEMPLATE_ID, allowedPriorChanges: [] } };
}
function evidence({ edited = true, registeredAt = "2026. 10. 20. 09:00" } = {}) {
  const end = edited ? "2026-11-01" : "2026-10-30";
  return { source: HOLDING_SOURCE, studioId: MEMBER.studioId, memberId: MEMBER.memberId, memberName: MEMBER.name,
    ticketName: "Synthetic Worker Pass", memberUrl: `https://arcpilates.studiomate.kr/users/detail?id=${MEMBER.memberId}`,
    observedAt: NOW.toISOString(), historyComplete: true, activeHoldsComplete: true,
    activeHolds: [{ start: "2026-10-20", end }], currentHold: { start: "2026-10-20", end },
    history: [
      { at: "2026. 01. 01. 09:00", staff: "Synthetic Operator", type: "발급",
        changes: [field("이용시작일", "내역없음", "2026-01-01"), field("이용종료일", "내역없음", "2026-12-31")] },
      { at: registeredAt, staff: "Synthetic Operator", type: "수강권정지",
        changes: [field("정지시작일", "내역없음", "2026-10-20"), field("정지종료일", "내역없음", "2026-10-30")] },
      ...(edited ? [{ at: "2026. 10. 26. 10:00", staff: "Synthetic Operator", type: "수강권정지수정",
        changes: [field("정지종료일", "2026-10-30", "2026-11-01")] }] : []),
    ] };
}
function fixture(raw = evidence(), settings = config(), now = NOW) {
  const docs = new Map(), reads = [], queries = [], requests = [], selected = [], reconciled = [];
  const db = { doc(path) { return { get: async () => { reads.push(path);
    const data = structuredClone(docs.get(path)); return { data: () => data }; } }; },
    collection(name) { return { where: (field, operator, value) => ({ limit: limit => ({ get: async () => {
      queries.push({ name, field, operator, value, limit });
      assert.deepEqual({ name, field, operator, value, limit },
        { name: "alimtalkSends", field: "memberPhone", operator: "==", value: MEMBER.phone, limit: 500 });
      const rows = [...docs].filter(([path, row]) => path.startsWith(`${name}/`) && row[field] === value)
        .slice(0, limit).map(([, row]) => ({ data: () => structuredClone(row) }));
      return { size: rows.length, docs: rows };
    } }) }) }; } };
  const proof = automaticHoldingSourceReadback(raw, settings, now);
  const originalPlan = verifiedOperatorHoldingPlan(raw, MEMBER, { ...proof.approval, memberPhone: MEMBER.phone }, now);
  const receipt = { id: originalPlan.id, deliveryComplete: true, duplicateBlocked: true, providerPostCount: 0 };
  const request = async (url, method = "GET") => {
    requests.push({ url, method }); assert.equal(method, "GET");
    const send = [...docs.values()].find(row => row.solapiMessageId === "synthetic-change-message");
    return { messageList: [{ messageId: send.solapiMessageId, to: send.memberPhone,
      status: send.providerStatus, statusCode: send.providerStatusCode, text: send.message,
      kakaoOptions: { templateId: HOLDING_NOTICE_TEMPLATE_ID, disableSms: true, variables: send.variables } }] };
  };
  const select = (options = {}) => selectHoldingWorkerNoticePlan({ db, raw, config: settings, member: MEMBER,
    originalPlan, originalProof: proof, originalPrior: receipt, stamp: () => now.toISOString(), request, now: () => now,
    reconcile: async args => { reconciled.push(args.plan.id); return reconcileExistingHoldingAttempt(args); },
    onPlanSelected: plan => selected.push(plan.id), ...options });
  const original = ledger(originalPlan);
  original.solapiMessageId = "synthetic-original-message";
  original.observedAt = "2026-10-20T03:00:00.000Z";
  original.variables["#{홀딩종료일}"] = "2026-10-30";
  docs.set(`alimtalkSends/${originalPlan.id}`, original);
  return { db, docs, reads, queries, requests, selected, reconciled, raw, settings, proof, originalPlan, receipt, select };
}
function ledger(plan, complete = true) {
  return { ...structuredClone(plan), id: plan.id, candidateId: plan.id, sendId: plan.id,
    templateCode: HOLDING_NOTICE_TEMPLATE_ID, isTest: false, status: complete ? "done" : "processing",
    providerStatus: complete ? "COMPLETE" : "SENDING", providerStatusCode: complete ? "4000" : "3000",
    solapiMessageId: "synthetic-change-message", payload: { holdingNotice: true, deliveryMode: "automatic_live_readback",
      policyId: plan.noticePurpose === "holding_period_change" ? HOLDING_PERIOD_CHANGE_POLICY : HOLDING_AUTO_POLICY } };
}
function seedAttempt(h, plan, complete = true) {
  const send = ledger(plan, complete);
  h.docs.set(`alimtalkSends/${plan.id}`, send);
  h.docs.set(`alimtalkCandidates/${plan.id}`, { ...send, status: complete ? "sent" : "processing" });
  h.docs.set(`holdingNoticeClaims/${plan.id}`, { ...send, status: complete ? "delivered" : "accepted_pending_readback" });
}

test("no original attempt selects registration only, with its unchanged inclusive 48-hour gate", async () => {
  const fresh = fixture(evidence({ registeredAt: "2026. 10. 26. 09:00" }));
  fresh.docs.clear();
  const result = await fresh.select({ originalPrior: null });
  assert.equal(result.plan, fresh.originalPlan);
  assert.equal(result.proof, fresh.proof);
  assert.equal(result.isPeriodChange, false);
  assert.equal(result.prior, null);
  assert.deepEqual(fresh.reads, []);
  assert.deepEqual(fresh.queries, []);
  assert.deepEqual(fresh.reconciled, []);
  const old = fixture();
  await assert.rejects(old.select({ originalPrior: null }), /holding_registration_too_old_review_required/);
  assert.deepEqual(old.reads, []);
  const boundary = fixture(evidence({ edited: false, registeredAt: "2026. 10. 24. 12:00" }));
  assert.equal((await boundary.select({ originalPrior: null })).isPeriodChange, false);
  await assert.rejects(boundary.select({ originalPrior: null, now: () => new Date(NOW.getTime() + 1) }),
    /holding_registration_too_old_review_required/);
});

test("delivered original with disabled, missing or no-change policy stays a duplicate", async () => {
  for (const mode of ["disabled", "missing", "no-change", "preactivation", "already-incorporated"]) {
    const h = fixture(evidence({ edited: mode !== "no-change" }));
    if (mode === "disabled") h.settings.periodChangeNotice.enabled = false;
    if (mode === "missing") delete h.settings.periodChangeNotice;
    if (mode === "preactivation") h.settings.periodChangeNotice.activatedAt = "2026-10-26T02:00:00.000Z";
    if (mode === "already-incorporated") Object.assign(h.docs.get(`alimtalkSends/${h.originalPlan.id}`),
      { observedAt: NOW.toISOString(), variables: structuredClone(h.originalPlan.variables) });
    const before = structuredClone(h.docs), result = await h.select();
    assert.equal(result.plan, h.originalPlan, mode);
    assert.equal(result.prior, h.receipt, mode);
    assert.equal(result.isPeriodChange, false, mode);
    assert.deepEqual(h.reads, ["disabled", "missing"].includes(mode) ? [] : [`alimtalkSends/${h.originalPlan.id}`]);
    assert.deepEqual(h.reconciled, []);
    assert.equal(h.queries.length, ["disabled", "missing"].includes(mode) ? 0 : 1);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.docs, before);
  }
});

test("pending original cannot enter change policy or the registration age gate", async () => {
  const h = fixture();
  h.settings.periodChangeNotice = { enabled: true }; // Invalid config must never even be consulted.
  const prior = { deliveryComplete: false, providerPostCount: 0 };
  const result = await h.select({ originalPrior: prior });
  assert.equal(result.prior, prior);
  assert.equal(result.plan, h.originalPlan);
  assert.equal(result.isPeriodChange, false);
  assert.deepEqual(h.reads, []);
  assert.deepEqual(h.queries, []);
  assert.deepEqual(h.selected, []);
});

test("a pre-cutover delivered holding may have a prospective edit but never a historical registration send", async () => {
  const h = fixture(evidence({ registeredAt: "2026. 10. 01. 09:00" }));
  assert.throws(() => automaticHoldingReadback(h.raw, h.settings, NOW), /holding_historical_registration_excluded/);
  assert.equal((await h.select()).isPeriodChange, true);
  await assert.rejects(h.select({ originalPrior: null }), /holding_historical_registration_excluded/);
});

test("only matching proven zero-transport deferrals are resumable", async () => {
  for (const poison of [false, true]) {
    const h = fixture(), first = await h.select();
    seedAttempt(h, first.plan, false);
    for (const collection of ["alimtalkCandidates", "alimtalkSends", "holdingNoticeClaims"]) {
      const row = h.docs.get(`${collection}/${first.plan.id}`);
      delete row.solapiMessageId;
      Object.assign(row, { status: "deferred", attempts: 0, providerOutcome: "quiet_deferred_no_transport",
        dispatchToken: "fixture-quiet", dispatchDeferrals: [{ dispatchToken: "fixture-quiet", providerPostCount: 0 }] });
    }
    if (poison) h.docs.get(`holdingNoticeClaims/${first.plan.id}`).dispatchDeferrals[0].providerPostCount = 1;
    if (poison) await assert.rejects(h.select(), /holding_prior_claim_reconciliation_required/);
    else { const selected = await h.select(); assert.equal(selected.plan.id, first.plan.id); assert.equal(selected.prior, null); }
    assert.deepEqual(h.requests, []);
  }
});

test("already attempted change reconciles after 48 hours without replay or false expiry", async () => {
  for (const complete of [true, false]) {
    const h = fixture(), first = await h.select();
    seedAttempt(h, first.plan, complete);
    const late = new Date(NOW.getTime() + 49 * 3600_000);
    h.raw.observedAt = late.toISOString();
    const after = await h.select({ now: () => late });
    assert.equal(after.plan.id, first.plan.id);
    assert.equal(after.prior.deliveryComplete, complete);
    assert.equal(after.prior.providerPostCount, 0);
    assert.ok(h.requests.every(r => r.method === "GET"));
  }
});

test("new edit on old registration uses exact original doc, phone-bound change approval and separate event", async () => {
  const h = fixture(), before = structuredClone(h.docs);
  const result = await h.select();
  assert.equal(result.isPeriodChange, true);
  assert.equal(result.prior, null);
  assert.notEqual(result.plan.id, h.originalPlan.id);
  assert.match(result.plan.id, /^holding_operator_notice_[a-f0-9]{64}$/);
  assert.equal(result.plan.creationEvidenceFingerprint, h.originalPlan.creationEvidenceFingerprint);
  assert.equal(result.plan.approval.noticePurpose, "holding_period_change");
  assert.equal(result.plan.approval.changeFingerprint, result.proof.change.id);
  assert.equal(result.plan.approval.memberPhone, MEMBER.phone);
  assert.equal(result.plan.variables["#{홀딩종료일}"], "2026-11-01");
  assert.equal(result.plan.variables["#{이번홀딩일수}"], "13");
  assert.deepEqual(h.selected, [result.plan.id]);
  assert.deepEqual(h.reconciled, [result.plan.id]);
  assert.deepEqual(h.reads, [`alimtalkSends/${h.originalPlan.id}`, `alimtalkSends/${result.plan.id}`,
    `holdingNoticeClaims/${result.plan.id}`, `alimtalkCandidates/${result.plan.id}`]);
  assert.deepEqual(h.docs, before);
  const event = automaticHoldingEvent(result.plan, result.proof.selected, h.settings);
  assert.equal(event.id, result.plan.id);
  assert.equal(event.originalNoticeId, h.originalPlan.id);
  assert.equal(event.policyId, HOLDING_PERIOD_CHANGE_POLICY);
});

test("selected change event is accepted by the shared automatic event validator", async () => {
  const h = fixture(), result = await h.select();
  const event = automaticHoldingEvent(result.plan, result.proof.selected, h.settings);
  assert.equal(automaticHoldingEventIssue(event, result.plan, h.settings, NOW,
    h.docs.get(`alimtalkSends/${h.originalPlan.id}`)), "");
});

test("prior change completion or acceptance is receipt-only on every reentrant selection", async () => {
  for (const complete of [true, false]) {
    const h = fixture(), first = await h.select();
    seedAttempt(h, first.plan, complete);
    const before = structuredClone(h.docs);
    for (let pass = 0; pass < 2; pass++) {
      const result = await h.select();
      assert.equal(result.plan.id, first.plan.id);
      assert.equal(result.prior.deliveryComplete, complete);
      assert.equal(result.prior.duplicateBlocked, true);
      assert.equal(result.prior.providerPostCount, 0);
    }
    assert.equal(h.requests.length, complete ? 0 : 2);
    assert.ok(h.requests.every(row => row.method === "GET"));
    assert.deepEqual(h.docs, before);
  }
});

test("second edit is selectable only after the preceding change has a completed matching ledger", async () => {
  const first = fixture(), initial = await first.select();
  const later = new Date("2026-10-26T05:00:00.000Z"), raw = evidence();
  raw.observedAt = later.toISOString();
  raw.activeHolds[0].end = raw.currentHold.end = "2026-11-03";
  raw.history.push({ at: "2026. 10. 26. 13:00", staff: "Synthetic Operator", type: "수강권정지수정",
    changes: [field("정지종료일", "2026-11-01", "2026-11-03")] });
  const h = fixture(raw, config(), later);
  await assert.rejects(h.select(), /holding_multiple_unnotified_changes_review_required/);
  seedAttempt(h, initial.plan, false);
  await assert.rejects(h.select(), /holding_multiple_unnotified_changes_review_required/);
  seedAttempt(h, initial.plan, true);
  const before = structuredClone(h.docs), result = await h.select();
  assert.equal(result.isPeriodChange, true);
  assert.equal(result.prior, null);
  assert.notEqual(result.plan.id, initial.plan.id);
  assert.equal(result.plan.variables["#{홀딩종료일}"], "2026-11-03");
  assert.equal(result.plan.periodChange.previousChangeId, initial.plan.changeFingerprint);
  assert.deepEqual(h.docs, before);
  assert.equal(h.queries.length, 3);
  assert.equal(automaticHoldingEventIssue(automaticHoldingEvent(result.plan, result.proof.selected, h.settings),
    result.plan, h.settings, later, h.docs.get(`alimtalkSends/${h.originalPlan.id}`),
    [...h.docs].filter(([path]) => path.startsWith("alimtalkSends/")).map(([, row]) => row)), "");
});

test("bounded phone history must be complete before any policy plan or receipt reconciliation", async () => {
  const h = fixture();
  for (let i = 0; i < 499; i++) h.docs.set(`alimtalkSends/synthetic_${i}`, { memberPhone: MEMBER.phone });
  const before = structuredClone(h.docs);
  await assert.rejects(h.select(), /incomplete_holding_receipt_history/);
  assert.deepEqual(h.selected, []);
  assert.deepEqual(h.reconciled, []);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.docs, before);
});

test("ambiguous original stops before policy and ambiguous change retains the change event ID", async () => {
  const h = fixture();
  h.docs.clear();
  h.docs.set(`holdingNoticeClaims/${h.originalPlan.id}`, { candidateId: h.originalPlan.id, status: "reconciliation_required" });
  // The actual worker calls this reconciler before selection, even for enabled change policy.
  await assert.rejects(reconcileExistingHoldingAttempt({ db: h.db, plan: h.originalPlan, request: h.request }),
    /holding_prior_claim_reconciliation_required/);
  assert.deepEqual(h.selected, []);
  assert.deepEqual(h.requests, []);
  const change = fixture(), first = await change.select();
  change.docs.set(`holdingNoticeClaims/${first.plan.id}`, { candidateId: first.plan.id, status: "reconciliation_required" });
  change.selected.length = 0;
  const before = structuredClone(change.docs);
  await assert.rejects(change.select(), /holding_prior_claim_reconciliation_required/);
  assert.deepEqual(change.selected, [first.plan.id]);
  assert.deepEqual(change.docs, before);
  assert.deepEqual(change.requests, []);
});

test("missing original proof or expired edit cannot authorize a new change", async () => {
  const missing = fixture(); missing.docs.clear();
  await assert.rejects(missing.select(), /holding_original_notice_delivery_required/);
  assert.deepEqual(missing.reconciled, []);
  const expired = fixture();
  expired.raw.history[2].at = "2026. 10. 24. 11:59";
  expired.settings.periodChangeNotice.activatedAt = "2026-10-23T00:00:00.000Z";
  await assert.rejects(expired.select(), /holding_period_change_too_old_review_required/);
  assert.equal(expired.reconciled.length, 1); // Receipt-only lookup precedes the new-transport age gate.
  assert.deepEqual(expired.requests, []);
});

test("dry-run keeps terminal duplicate reads but refuses pending receipt reconciliation without writes", async () => {
  for (const complete of [true, false]) {
    const h = fixture(), first = await h.select(); seedAttempt(h, first.plan, complete);
    const before = structuredClone(h.docs);
    const dryRequest = async () => { throw new Error("dry_run_receipt_reconciliation_required"); };
    if (complete) assert.equal((await h.select({ request: dryRequest })).prior.deliveryComplete, true);
    else await assert.rejects(h.select({ request: dryRequest }), /dry_run_receipt_reconciliation_required/);
    assert.deepEqual(h.docs, before);
    assert.deepEqual(h.requests, []);
  }
});

test("actual worker wires original reconciliation, change selection and common promotion without weakening source guards", async () => {
  const worker = await readFile(new URL("../run-automatic-holding-notices.ts", import.meta.url), "utf8");
  const original = worker.indexOf("const prior = await reconcileExistingHoldingAttempt");
  const selection = worker.indexOf("const selection = await selectHoldingWorkerNoticePlan");
  const gate = worker.indexOf("if (!selection.isPeriodChange) automaticHoldingEvidence(raw, config)");
  const event = worker.indexOf("automaticHoldingEvent(plan, selection.proof.selected, config)");
  const promote = worker.indexOf("const eventRef = db.doc");
  const dispatch = worker.indexOf("const result = await dispatchVerifiedOperatorHolding");
  assert.ok(original > 0 && selection > original && gate > selection && event > gate && promote > event && dispatch > promote);
  assert.match(worker.slice(selection, gate), /onPlanSelected:.*eventId = selectedPlan.id/);
  assert.match(worker.slice(selection, gate), /plan = selection.plan/);
  assert.match(worker.slice(selection, gate), /const prior = selection.prior/);
  assert.match(worker.slice(selection, gate), /"duplicate_blocked" : "receipt_pending"/);
  assert.match(worker.slice(selection, gate), /continue;/);
  assert.match(worker, /if \(!apply\) \{ results.push\(.*"verified_no_send".*continue; \}/);
  assert.match(worker, /if \(!apply\) return;/);
  assert.match(worker, /holdingFingerprint\(currentConfig\) !== holdingFingerprint\(config\)/);
  assert.match(worker, /currentBaseline\?\.sourceImportId !== job.sourceImportId/);
  assert.match(worker, /currentBaseline.downloadedAt !== job.downloadedAt/);
  assert.match(worker, /!holdingRosterReadbackIsCurrent\(currentJob, job\)/);
  assert.match(worker, /job.sourceImportId !== baseline.sourceImportId \|\| job.downloadedAt !== baseline.downloadedAt/);
  assert.match(worker, /if \(!currentEvent.exists\) tx.create\(eventRef, event\)/);
  assert.doesNotMatch(worker, /tx\.(update|set)\(eventRef/);
  const poller = worker.slice(worker.indexOf("// Receipts may complete"), worker.indexOf("const mark = async"));
  assert.match(poller, /if \(apply\)/);
  assert.doesNotMatch(poller, /selectHoldingWorkerNoticePlan|dispatchVerifiedOperatorHolding|"POST"/);
});
