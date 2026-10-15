import assert from "node:assert/strict";
import test from "node:test";
import { needsMembershipContractObservation, membershipContractNextObservation, selectMembershipContractObservationTargets,
  membershipContractObservationHistory, resolveMembershipContractSignature, membershipContractObservationTail,
  membershipContractCompletionSafetyPatch } from "./studiomate-membership-contract-completion-state.mjs";

const NOW = Date.parse("2026-10-15T00:00:00.000Z");
const doc = (id, patch = {}) => ({ id, data: () => ({ schemaVersion: 1, source: "studiomate_native_contract", studioId: "5330", contractId: id,
  bindingVerified: true, binding: { contractId: id, selectedAt: "2026-10-14T00:00:00.000Z", previousObservations: Array(100).fill({ status: "sent" }) },
  status: "waiting", welcomeStatus: "blocked", ...patch }) });

test("100 stored observations no longer stop polling", () => {
  const next = membershipContractNextObservation({ status: "waiting" }, doc("a").data(), NOW);
  assert.equal(next.at, NOW + 10 * 60_000);
});
test("failed reads and old bindings get bounded retry instead of silent abandonment", () => {
  assert.equal(membershipContractNextObservation({ status: "review", reason: "native_contract_read_failed" }, doc("a").data(), NOW).at, NOW + 15 * 60_000);
  assert.equal(membershipContractNextObservation({ status: "review", reason: "native_contract_read_failed" }, doc("a", { observationReviewAttempts: 100 }).data(), NOW).at, NOW + 6 * 3600_000);
  assert.equal(membershipContractNextObservation({ status: "review", reason: "contract_binding_mismatch" }, doc("a").data(), NOW), null);
  const old = doc("a").data(); old.binding.selectedAt = "2026-10-01T00:00:00.000Z";
  assert.equal(membershipContractNextObservation({ status: "waiting" }, old, NOW).at, NOW + 6 * 3600_000);
});
test("only verified completion or readonly signature receipt is terminal", () => {
  for (const key of ["completion", "signatureReceipt"]) {
    assert.equal(membershipContractNextObservation({ status: "signed", [key]: {} }, doc("a").data(), NOW), null);
    assert.equal(needsMembershipContractObservation(doc("a", { [key]: {} }).data(), "a", "5330"), false);
  }
});
test("recovery reserves two slots, deduplicates due rows and keeps scope guards", () => {
  const due = [doc("a", { nextObservationAt: 1 }), doc("b", { nextObservationAt: 1 }), doc("c", { nextObservationAt: 1 })];
  const recovery = [doc("x"), doc("y"), doc("z"), ...due];
  assert.deepEqual(selectMembershipContractObservationTargets(due, recovery, "5330").map(d => d.id), ["x", "y", "a", "b", "c"]);
  for (const patch of [{ studioId: "1" }, { status: "signed" }, { welcomeStatus: "accepted" }, { bindingVerified: false }, { source: "mirror" }, { observationHold: true }]) {
    assert.equal(needsMembershipContractObservation(doc("a", patch).data(), "a", "5330"), false);
  }
});

test("signed sources keep exact and queued pre-send readback while receipt-only sources never replay", () => {
  const source = doc("a", { status: "signed", completion: {}, welcomeStatus: "ready" }).data();
  assert.equal(needsMembershipContractObservation(source, "a", "5330"), false);
  assert.equal(needsMembershipContractObservation(source, "a", "5330", { refresh: true }), true);
  source.welcomeStatus = "queued";
  assert.equal(needsMembershipContractObservation(source, "a", "5330"), true);
  source.welcomeStatus = "accepted";
  assert.equal(needsMembershipContractObservation(source, "a", "5330", { refresh: true }), false);
});
test("receipt identity mismatch vetoes a fresh completion rather than setting welcome ready", () => {
  const result = resolveMembershipContractSignature({ status: "complete", completion: { signatureTimeSource: "provider" } },
    { receipt: null, reason: "native_signature_receipt_identity_mismatch" }, "signed");
  assert.equal(result.completion, null);
  assert.equal(result.status, "review");
});
test("post-100 observations are retained for validation and state transitions are not discarded", () => {
  const first = { status: "sent", observedAt: "2026-10-10T00:00:00.000Z" };
  const last = { ...first, observedAt: "2026-10-14T00:00:00.000Z" };
  const source = doc("a").data();
  source.binding.previousObservations = Array(100).fill(first);
  source.lastObservation = last;
  source.observationTail = [{ status: "signed", observedAt: "2026-10-12T00:00:00.000Z" }, last];
  const history = membershipContractObservationHistory(source);
  assert.deepEqual(history.map(row => row.status), ["sent", "signed", "sent"]);
  assert.equal(history.at(-1).observedAt, last.observedAt);
  assert.equal(source.binding.previousObservations.length, 100);
});

test("a signature veto invalidates an older completion and queued state while preserving its audit", () => {
  const source = doc("a", { status: "signed", completion: { contractId: "a" }, welcomeStatus: "queued" }).data();
  const patch = membershipContractCompletionSafetyPatch({ status: "review", reason: "native_signature_receipt_identity_mismatch" }, source, "DELETE");
  assert.equal(patch.status, "review");
  assert.equal(patch.completion, "DELETE");
  assert.deepEqual(patch.invalidatedCompletion, source.completion);
  assert.equal(patch.welcomeStatus, "review");
  assert.deepEqual(membershipContractCompletionSafetyPatch({ status: "review", reason: "native_contract_read_failed" }, source, "DELETE"), {});
});

test("tail overflow preserves evidence and permits an explicit hold instead of aborting the batch", () => {
  const source = doc("a").data();
  source.observationTail = Array.from({ length: 100 }, (_, index) => ({ status: index % 2 ? "sent" : "draft", observedAt: new Date(NOW - (101 - index) * 1000).toISOString() }));
  const result = membershipContractObservationTail(source, { status: "signed", observedAt: new Date(NOW).toISOString() });
  assert.equal(result.overflow, true);
  assert.deepEqual(result.rows, source.observationTail);
  assert.equal(membershipContractNextObservation({ status: "review", reason: "invalid_observation_history" }, source, NOW), null);
});
