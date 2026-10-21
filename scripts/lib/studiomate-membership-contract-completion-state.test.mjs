import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { needsMembershipContractObservation, membershipContractNextObservation, selectMembershipContractObservationTargets,
  membershipContractObservationHistory, resolveMembershipContractSignature, membershipContractObservationTail,
  membershipContractCompletionSafetyPatch, verifiedLegacyMembershipWelcomeDisposition,
  terminalMembershipWelcome, membershipContractWelcomeObservationPatch } from "./studiomate-membership-contract-completion-state.mjs";

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
  assert.equal(needsMembershipContractObservation(source, "a", "5330"), false);
  assert.equal(needsMembershipContractObservation(source, "a", "5330", { refresh: true }), true);
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

const legacySource = () => {
  const contractId = "a".repeat(64);
  return doc(contractId, {
    binding: { contractId, studioId: "5330", memberId: "10001", userTicketId: "20002",
      selectedAt: "2026-09-15T00:00:00.000Z", previousObservations: [] },
    status: "signed", welcomeStatus: "not_required", welcomeReason: "legacy_member_before_contract_cutover",
    signatureReceipt: { contractId, studioId: "5330", memberId: "10001", authoritative: true,
      source: "studiomate_native_contract", status: "signed", memberSigned: true, centerSigned: true,
      signedAt: "2026-10-01T00:00:00.000Z" },
    welcomeDisposition: { reason: "legacy_member_before_contract_cutover", verified: true, memberId: "10001", contractId,
      source: "studiomate_native_member_ticket", checkedAt: "2026-10-14T00:00:00.000Z",
      registeredAt: "2023-01-01T00:00:00.000Z", cutoverAt: "2026-09-14T00:00:00.000Z", priorRegularIssuanceIds: ["20001"] },
  }).data();
};

test("verified legacy disposition is terminal for scheduled observations, not an invented send or signature", () => {
  const source = legacySource(), before = structuredClone(source);
  assert.equal(verifiedLegacyMembershipWelcomeDisposition(source, NOW), true);
  assert.equal(terminalMembershipWelcome(source, NOW), true);
  assert.equal(needsMembershipContractObservation(source, source.contractId, "5330"), false);
  assert.equal(needsMembershipContractObservation(source, source.contractId, "5330", { refresh: true }), true);
  assert.equal(membershipContractNextObservation({ status: "waiting" }, source, NOW), null);
  assert.deepEqual(source, before);
});

test("accepted and verified not-required states are preserved on explicit historical signature refresh", () => {
  for (const welcomeStatus of ["accepted", "not_required"]) {
    const source = { ...legacySource(), welcomeStatus };
    for (const outcome of [
      { status: "signed", signatureReceipt: { ...source.signatureReceipt } },
      { status: "complete", completion: { ...source.signatureReceipt } },
    ]) {
      assert.deepEqual(membershipContractWelcomeObservationPatch(outcome, source), { welcomeStatus });
      assert.equal(membershipContractNextObservation(outcome, source, NOW), null);
    }
    const patch = membershipContractCompletionSafetyPatch({ status: "review", reason: "native_signature_receipt_identity_mismatch" },
      { ...source, completion: { ...source.signatureReceipt } }, "DELETE");
    assert.equal(patch.welcomeStatus, welcomeStatus);
    assert.equal(patch.status, "review");
    assert.equal(patch.completion, "DELETE");
    assert.equal(patch.welcomeReason, undefined);
  }
});

test("terminal freshness refresh never bypasses canonical source, identity, hold or studio guards", () => {
  for (const welcomeStatus of ["accepted", "not_required"]) {
    for (const patch of [{ schemaVersion: 2 }, { source: "mirror" }, { studioId: "other" },
      { bindingVerified: false }, { observationHold: true }, { binding: { contractId: "b".repeat(64) } }]) {
      const source = { ...legacySource(), welcomeStatus, ...patch };
      assert.equal(needsMembershipContractObservation(source, "a".repeat(64), "5330", { refresh: true }), false);
    }
  }
});

for (const [name, mutate] of [
  ["missing proof", source => { delete source.welcomeDisposition; }],
  ["forged verified flag", source => { source.welcomeDisposition.verified = "true"; }],
  ["wrong evidence source", source => { source.welcomeDisposition.source = "workLanes"; }],
  ["wrong member", source => { source.welcomeDisposition.memberId = "10002"; }],
  ["wrong contract", source => { source.welcomeDisposition.contractId = "b".repeat(64); }],
  ["wrong canonical studio", source => { source.studioId = "other"; }],
  ["wrong binding", source => { source.binding.contractId = "b".repeat(64); }],
  ["wrong receipt member", source => { source.signatureReceipt.memberId = "10002"; }],
  ["post-cutover registration", source => { source.welcomeDisposition.registeredAt = "2026-09-15T00:00:00.000Z"; }],
  ["future check", source => { source.welcomeDisposition.checkedAt = "2100-01-01T00:00:00.000Z"; }],
  ["invalid check", source => { source.welcomeDisposition.checkedAt = "2026-02-30T00:00:00.000Z"; }],
  ["empty prior proof", source => { source.welcomeDisposition.priorRegularIssuanceIds = []; }],
  ["fallback prior proof", source => { source.welcomeDisposition.priorRegularIssuanceIds = ["excel_20001"]; }],
  ["current issuance as prior", source => { source.welcomeDisposition.priorRegularIssuanceIds = ["20002"]; }],
]) {
  test(`invalid terminal disposition rejects ${name} and cannot become welcome ready`, () => {
    const source = legacySource(); mutate(source);
    assert.equal(verifiedLegacyMembershipWelcomeDisposition(source, NOW), false);
    assert.equal(terminalMembershipWelcome(source, NOW), false);
    for (const outcome of [{ signatureReceipt: source.signatureReceipt }, { completion: {} }])
      assert.deepEqual(membershipContractWelcomeObservationPatch(outcome, source), {
        welcomeStatus: "review", welcomeReason: "invalid_legacy_welcome_disposition",
      });
  });
}

test("ordinary signed and queued observations retain existing behavior", () => {
  for (const welcomeStatus of ["blocked", "review", "queued"]) {
    const source = { ...legacySource(), welcomeStatus };
    assert.deepEqual(membershipContractWelcomeObservationPatch({ completion: {} }, source), {
      welcomeStatus: welcomeStatus === "queued" ? "queued" : "ready",
    });
    assert.deepEqual(membershipContractWelcomeObservationPatch({ signatureReceipt: source.signatureReceipt }, source), {
      welcomeStatus: welcomeStatus === "queued" ? "queued" : "review", welcomeReason: "late_signature_welcome_review_required",
    });
    assert.deepEqual(membershipContractWelcomeObservationPatch({ status: "waiting" }, source), {});
  }
});

test("scheduled recovery never selects accepted or verified not-required terminals", () => {
  const terminals = ["accepted", "not_required"].map(welcomeStatus => {
    const source = { ...legacySource(), status: "review", signatureReceipt: null, welcomeStatus };
    return { id: source.contractId, data: () => source };
  });
  assert.deepEqual(selectMembershipContractObservationTargets(terminals, terminals, "5330"), []);
});

test("completion processor uses terminal-aware patch before safety invalidation without executing runtime", () => {
  const processor = fs.readFileSync(new URL("../process-studiomate-membership-contract-completions.mjs", import.meta.url), "utf8");
  assert.match(processor, /membershipContractWelcomeObservationPatch,[\s\S]*from "\.\/lib\/studiomate-membership-contract-completion-state\.mjs"/);
  assert.match(processor, /\.\.\.membershipContractWelcomeObservationPatch\(outcome, source\),\s*\.\.\.membershipContractCompletionSafetyPatch/);
  assert.doesNotMatch(processor, /welcomeStatus:\s*source\.welcomeStatus === "queued" \? "queued" : "ready"/);
});
