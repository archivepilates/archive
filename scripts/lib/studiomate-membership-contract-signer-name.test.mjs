import assert from "node:assert/strict";
import test from "node:test";
import { CONTRACT_SIGNER_NAME_POLICY, membershipContractSignerName, storedMembershipContractSignerName, assertMembershipContractSignerReadback } from "./studiomate-membership-contract-signer-name.mjs";

for (const [display, signer] of [
  ["Synthetic Member2", "Synthetic Member"], ["Synthetic Member 23", "Synthetic Member"],
  ["Synthetic Member 2 3", "Synthetic Member"], ["Synthetic Member\uFF12", "Synthetic Member"],
  ["Synthetic Member", "Synthetic Member"], ["  Synthetic Member2  ", "Synthetic Member"],
  ["Agent2 Member", "Agent2 Member"], ["A-B O'Name2", "A-B O'Name"],
]) test(`contract-only suffix mapping: ${JSON.stringify(display)}`, () => {
  assert.equal(membershipContractSignerName(display), signer);
});

test("invalid or entirely numeric names stop rather than create an unnamed contract", () => {
  for (const name of [null, undefined, 123, "", "   ", "123", " 12 3 ", "\uFF11\uFF12", "Member\n2", "<Member>2"])
    assert.throws(() => membershipContractSignerName(name), /contract_signer_name_invalid/);
});

test("legacy contract authentication names are not retroactively stripped", () => {
  assert.equal(storedMembershipContractSignerName({ memberName: "Synthetic Member2" }), "Synthetic Member2");
});

test("new source explicitly binds a signer name without changing its member display name", () => {
  const source = { memberName: "Synthetic Member2", contractSignerName: "Synthetic Member", contractSignerNamePolicy: CONTRACT_SIGNER_NAME_POLICY };
  const before = structuredClone(source);
  assert.equal(storedMembershipContractSignerName(source), "Synthetic Member");
  assert.deepEqual(source, before);
});

test("partial, unknown or mismatched signer bindings fail closed", () => {
  const source = { memberName: "Synthetic Member2", contractSignerName: "Synthetic Member", contractSignerNamePolicy: CONTRACT_SIGNER_NAME_POLICY };
  for (const change of [{ contractSignerName: undefined }, { contractSignerName: "Other Member" }, { contractSignerName: "Synthetic Member2" }, { contractSignerNamePolicy: "other" }, { contractSignerNamePolicy: undefined }])
    assert.throws(() => storedMembershipContractSignerName({ ...source, ...change }), /contract_signer_name_binding_invalid/);
});

test("completion separates contract/DOM names from the exact native member display identity", () => {
  const source = { memberName: "Synthetic Member2", contractSignerName: "Synthetic Member", contractSignerNamePolicy: CONTRACT_SIGNER_NAME_POLICY };
  const live = { member: { name: "Synthetic Member2" }, contract: { memberName: "Synthetic Member" }, dom: { memberName: "Synthetic Member" } };
  assert.doesNotThrow(() => assertMembershipContractSignerReadback(source, live));
  for (const [field, key] of [["member", "name"], ["contract", "memberName"], ["dom", "memberName"]]) {
    const changed = structuredClone(live);changed[field][key] = "Other Member";
    assert.throws(() => assertMembershipContractSignerReadback(source, changed), /contract_signer_name_readback_mismatch/);
  }
  assert.doesNotThrow(() => assertMembershipContractSignerReadback({ memberName: "Synthetic Member2" }, {}));
});
