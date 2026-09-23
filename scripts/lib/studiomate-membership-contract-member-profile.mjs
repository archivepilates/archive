import { normalizeMembershipPhone } from "./studiomate-membership-contract-policy.mjs";

const nativeId = (value) => /^[1-9]\d{0,63}$/.test(String(value ?? ""));

export function buildMembershipContractMemberProfilePatch(member, studioId) {
  const memberId = String(member?.memberId ?? "");
  const phone = normalizeMembershipPhone(member?.phone);
  const name = String(member?.name ?? "").trim();
  if (!nativeId(memberId) || !nativeId(studioId) || !phone || !name)
    throw new Error("invalid_membership_contract_member_profile");
  return Object.freeze({
    memberId,
    studioId: String(studioId),
    name,
    normalizedName: name.replace(/\s+/g, "").toLowerCase(),
    phone,
    phoneLast4: phone.slice(-4),
    ...(String(member.memberGrade || "").trim()
      ? { memberGrade: String(member.memberGrade).trim() }
      : {}),
    ...(String(member.birthday || "").trim()
      ? { birthDate: String(member.birthday).trim() }
      : {}),
    ...(String(member.gender || "").trim()
      ? { gender: String(member.gender).trim() }
      : {}),
    source: "studiomate_native_contract",
    identityVerified: true,
  });
}

export function membershipContractFallbackAliasIds(rows, canonicalProfile) {
  if (!Array.isArray(rows))
    throw new Error("invalid_membership_contract_member_aliases");
  const aliases = [];
  for (const row of rows) {
    const id = String(row?.id ?? "");
    const data = row?.data;
    if (!id || !data || id === canonicalProfile.memberId) continue;
    if (normalizeMembershipPhone(data.phone) !== canonicalProfile.phone) continue;
    if (
      data.studioId !== canonicalProfile.studioId ||
      String(data.name || "").trim().replace(/\s+/g, "").toLowerCase() !==
        canonicalProfile.normalizedName ||
      !/^excel_[a-z0-9_]+$/i.test(id)
    )
      throw new Error("membership_contract_member_alias_conflict");
    aliases.push(id);
  }
  return Object.freeze([...new Set(aliases)].sort());
}
