export const CONTRACT_SIGNER_NAME_POLICY = "member_display_numeric_suffix_v1";

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
  if (!Object.hasOwn(source || {}, "contractSignerName") && !Object.hasOwn(source || {}, "contractSignerNamePolicy")) return;
  const name = storedMembershipContractSignerName(source);
  if (member?.name !== source.memberName || contract?.memberName !== name || dom?.memberName !== name)
    throw new Error("contract_signer_name_readback_mismatch");
}
