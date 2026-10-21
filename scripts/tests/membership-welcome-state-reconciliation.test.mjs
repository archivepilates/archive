import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { planWelcomeStateReconciliation } from "../lib/membership-welcome-state-reconciliation.mjs";

function fixture() {
  const contractId = "a".repeat(64), memberId = "123", phone = "01000000001";
  const id = `membership_welcome_${createHash("sha256").update(JSON.stringify(["5330", "new_member_welcome", phone])).digest("hex")}`;
  const contract = { contractId, studioId: "5330", source: "studiomate_native_contract", bindingVerified: true,
    status: "signed", memberName: "SYNTHETIC", welcomeStatus: "queued", welcomeCandidateId: id,
    binding: { memberId, memberPhone: phone }, completion: { memberId, memberPhone: phone } };
  const candidate = { candidateId: id, studioId: "5330", memberId, memberName: "SYNTHETIC", memberPhone: phone,
    type: "membership_welcome", templateCode: "KA01TP260914091233543JoFDsn7KfCr", status: "failed",
    attempts: 1, lastError: "history_time_limit", payload: { sourceContractId: contractId } };
  return { contractId, memberId, contract, candidate, send: { ...candidate } };
}
test("only stale contract display fields change; old failed attempt is retained", () => {
  const f = fixture(), before = structuredClone(f);
  const result = planWelcomeStateReconciliation(f);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.patch, { welcomeStatus: "review", welcomeReason: "history_time_limit" });
  assert.deepEqual(f, before);
  assert.equal(f.candidate.attempts, 1);
});
for (const [record, field, value] of [
  ["contract", "studioId", "other"], ["contract", "source", "mirror"], ["contract", "bindingVerified", false],
  ["contract", "welcomeStatus", "accepted"], ["contract", "status", "waiting"],
  ["contract", "welcomeCandidateId", "membership_welcome_" + "b".repeat(64)],
  ["candidate", "memberId", "456"], ["candidate", "memberPhone", "01000000009"],
  ["candidate", "templateCode", "other"], ["candidate", "status", "sent"],
  ["send", "candidateId", "other"], ["send", "memberId", "456"], ["send", "status", "sent"],
  ["send", "lastError", "different"],
]) test(`rejects inconsistent ${record}.${field}`, () => {
  const f = fixture(); f[record][field] = value;
  assert.equal(planWelcomeStateReconciliation(f).eligible, false);
});
test("already reviewed and missing records cannot be reapplied", () => {
  const f = fixture(); f.contract.welcomeStatus = "review";
  assert.equal(planWelcomeStateReconciliation(f).reason, "already_review");
  assert.equal(planWelcomeStateReconciliation({ ...fixture(), send: undefined }).eligible, false);
});
