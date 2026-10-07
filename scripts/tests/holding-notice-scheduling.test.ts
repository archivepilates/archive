import assert from "node:assert/strict";
import test from "node:test";
import { holdingQueueOutcomeTerminal, holdingReadyBatch, holdingRecoveryPatch, holdingReadyScopeIssue, holdingWelcomeInteropIssue } from "../../firebase/kangsain-functions/functions/src/alimtalk/holdingNoticeScheduling";
import { HOLDING_TEMPLATE } from "../../firebase/kangsain-functions/functions/src/alimtalk/holdingNoticeProvider";
import { MEMBERSHIP_WELCOME_TEMPLATE } from "../../firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomePolicy";

const candidate = { payload: { holdingNotice: true }, status: "processing", attempts: 0, updatedAt: { toMillis: () => 1000 } };
test("only stale, never-attempted processing without either durable record returns to operator review", () => {
  const patch = holdingRecoveryPatch(candidate, 601000, false, false);
  assert.equal(patch?.status, "reviewed");
  assert.equal(patch?.holdingApprovalSnapshot, null);
  for (const [claim, send] of [[true, false], [false, true], [true, true]])
    assert.equal(holdingRecoveryPatch(candidate, 601000, claim, send)?.status, "failed");
  for (const attempts of [1, undefined, "0", null])
    assert.equal(holdingRecoveryPatch({ ...candidate, attempts }, 601000, false, false)?.status, "failed");
  for (const change of [{ status: "queued" }, { payload: {} }, { updatedAt: {} }])
    assert.equal(holdingRecoveryPatch({ ...candidate, ...change }, 601000, false, false), null);
  assert.equal(holdingRecoveryPatch(candidate, 600999, false, false), null);
  assert.equal(holdingRecoveryPatch(candidate, NaN, false, false), null);
});
test("welcome interoperability uses the exact audited allowlist validator", () => {
  const valid = { independentlyAudited: true, auditId: "fixture", templateIds: [HOLDING_TEMPLATE.templateId] };
  const issue = (value: any) => holdingWelcomeInteropIssue({ providerHistoryCoverage: { nonWelcomeTemplateAllowlist: value } });
  assert.equal(issue(valid), "");
  for (const value of [undefined, {}, { ...valid, independentlyAudited: false }, { ...valid, auditId: " fixture " },
    { ...valid, templateIds: [HOLDING_TEMPLATE.templateId, HOLDING_TEMPLATE.templateId] },
    { ...valid, templateIds: [HOLDING_TEMPLATE.templateId, "bad id"] },
    { ...valid, templateIds: [HOLDING_TEMPLATE.templateId, MEMBERSHIP_WELCOME_TEMPLATE.templateId] }])
    assert.equal(issue(value), "holding_welcome_provider_allowlist_audit_required");
});
test("poison ready sources become reviewable, not endlessly selected at the head of the queue", () => {
  for (const value of [null, [], {}, ["a", "a"], ["a/b"], [""], Array.from({ length: 1001 }, (_, i) => `id-${i}`)])
    assert.equal(holdingReadyScopeIssue(value), "holding_event_scope_invalid");
  assert.equal(holdingReadyScopeIssue(["stable-1"]), "");
});
test("ten-event work budget is not a lifetime ticket limit", () => {
  const holds = Array.from({ length: 11 }, (_, i) => `stable-${i}`);
  assert.equal(holdingReadyScopeIssue(holds), "");
  const first = holdingReadyBatch(holds, undefined, "v1");
  assert.deepEqual(first, holds.slice(0, 10));
  const progress = { sourceVersion: "v1", completedHoldIds: first };
  assert.deepEqual(holdingReadyBatch(holds, progress, "v1"), holds.slice(10));
  assert.deepEqual(holdingReadyBatch(holds, { ...progress, completedHoldIds: holds }, "v1"), []);
  assert.deepEqual(holdingReadyBatch(holds, progress, "v2"), first);
});
test("a claim racing the preliminary read is terminal without blocking later batches", () => {
  const holds = Array.from({ length: 11 }, (_, i) => `stable-${i}`);
  const outcomes = holdingReadyBatch(holds, undefined, "v1").map((id, index) => ({ id,
    status: index === 9 ? "blocked" : "reviewed", reason: index === 9 ? "holding_prior_send_or_claim" : "operator_review_required" }));
  assert.equal(outcomes.some(result => !holdingQueueOutcomeTerminal(result)), false);
  const completedHoldIds = outcomes.filter(holdingQueueOutcomeTerminal).map(result => result.id);
  assert.deepEqual(holdingReadyBatch(holds, { sourceVersion: "v1", completedHoldIds }, "v1"), ["stable-10"]);
  assert.equal(holdingQueueOutcomeTerminal({ status: "blocked", reason: "holding_existing_candidate_attempted_or_unknown" }), false);
  assert.equal(holdingQueueOutcomeTerminal({ status: "blocked", reason: "holding_inspection_failed" }), false);
});
