import { createHash } from "node:crypto";

export const CONTRACT_SIGNER_NAME_POLICY = "member_display_numeric_suffix_v1";
export const CONTRACT_MEMBER_NAME_POLICY = "exact_native_member_numeric_suffix_v1";
const memberIdentityKeys = ["studioId", "memberId", "userTicketId", "productId", "selectionJobKey", "selectedAt"];
const phoneHash = value => createHash("sha256").update(value).digest("hex");
const validInstant = value => typeof value === "string" && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

export function membershipContractSignerName(displayName) {
  if (typeof displayName !== "string" || /[<>\x00-\x1f\x7f]/.test(displayName))
    throw new Error("contract_signer_name_invalid");
  const name = displayName.trim().replace(/(?: *[0-9\uFF10-\uFF19])+$/u, "").trim();
  if (!name) throw new Error("contract_signer_name_invalid");
  return name;
}

export function storedMembershipContractSignerName(source) {
  const hasName = Object.hasOwn(source || {}, "contractSignerName");
  const hasPolicy = Object.hasOwn(source || {}, "contractSignerNamePolicy");
  // Already-issued contracts retain their original authentication name.
  if (!hasName && !hasPolicy) return source?.memberName;
  if (!hasName || !hasPolicy || source.contractSignerNamePolicy !== CONTRACT_SIGNER_NAME_POLICY ||
      source.contractSignerName !== membershipContractSignerName(source.memberName))
    throw new Error("contract_signer_name_binding_invalid");
  return source.contractSignerName;
}

export function assertMembershipContractSignerReadback(source, { member, contract, dom }) {
  if (source?.memberNameReadback == null && !Object.hasOwn(source || {}, "contractSignerName") && !Object.hasOwn(source || {}, "contractSignerNamePolicy")) return;
  const name = storedMembershipContractSignerName(source);
  if (member?.name !== storedMembershipContractMemberName(source) || contract?.memberName !== name || dom?.memberName !== name)
    throw new Error("contract_signer_name_readback_mismatch");
}

export function storedMembershipContractMemberName(source) {
  const proof = source?.memberNameReadback;
  if (proof == null) return source?.memberName;
  const b = source?.binding;
  if (source.bindingVerified !== true || !b || typeof b.memberPhone !== "string" || !/^01\d{8,9}$/.test(b.memberPhone)
      || proof.policy !== CONTRACT_MEMBER_NAME_POLICY || proof.verified !== true
      || proof.source !== "studiomate_native_contract" || !validInstant(proof.checkedAt)
      || proof.contractId !== source.contractId || !/^[a-f0-9]{64}$/.test(proof.contractId || "")
      || memberIdentityKeys.some(key => typeof b[key] !== "string" || !b[key] || proof[key] !== b[key])
      || proof.originalMemberName !== source.memberName || proof.memberPhoneHash !== phoneHash(b.memberPhone)
      || proof.contractSignerName !== storedMembershipContractSignerName(source)
      || typeof proof.currentMemberName !== "string" || proof.currentMemberName === source.memberName
      || membershipContractSignerName(proof.currentMemberName) !== membershipContractSignerName(source.memberName))
    throw new Error("contract_member_name_readback_invalid");
  return proof.currentMemberName;
}

export function buildMembershipContractMemberNameReadback(source, currentMemberName, checkedAt) {
  const proof = {
    policy: CONTRACT_MEMBER_NAME_POLICY, verified: true, source: "studiomate_native_contract",
    ...Object.fromEntries(memberIdentityKeys.map(key => [key, source.binding?.[key]])),
    contractId: source.contractId, originalMemberName: source.memberName, currentMemberName,
    contractSignerName: storedMembershipContractSignerName(source),
    memberPhoneHash: phoneHash(source.binding?.memberPhone || ""), checkedAt,
  };
  storedMembershipContractMemberName({ ...source, memberNameReadback: proof });
  return proof;
}
