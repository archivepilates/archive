const nativeId = value => typeof value === "string" && /^[1-9]\d*$/.test(value);
const excelId = value => typeof value === "string" && /^excel_[a-z0-9_]+$/.test(value);
const phone = value => typeof value === "string" && /^01[016789]\d{7,8}$/.test(value);
const resolvedTime = value => {
  const time = typeof value?.toMillis === "function" ? value.toMillis() :
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      ? Date.parse(value) : NaN;
  return Number.isSafeInteger(time) && time > 0 ? time : null;
};

// A resolved ID is a discovery hint; the lookup receipt is checked again before use.
export function holdingProfileNativeId(profile) {
  if (!profile || profile.studioId !== "5330") return "";
  if (nativeId(profile.memberId)) return profile.memberId;
  if (!excelId(profile.memberId) || !nativeId(profile.studiomateMemberId) ||
      !resolvedTime(profile.studiomateMemberIdResolvedAt) || !phone(profile.phone) ||
      typeof profile.name !== "string" || !profile.name.trim() ||
      profile.canonicalMemberId || profile.mergedInto || profile.status === "merged" ||
      profile.externalActionEligible === false) return "";
  return profile.studiomateMemberId;
}

export async function readHoldingMemberProfile({ db, memberId, reader }) {
  if (!nativeId(memberId)) throw new Error("holding_native_member_id_required");
  const get = ref => reader ? reader.get(ref) : ref.get();
  const direct = await get(db.doc(`memberProfiles/${memberId}`));
  // An existing native record is authoritative, including invalid data that must fail closed.
  if (direct.exists) {
    const profile = direct.data();
    if (profile?.memberId !== memberId || profile.studioId !== "5330")
      throw new Error("operator_member_changed");
    return profile;
  }
  const linked = await get(db.collection("memberProfiles").where("studiomateMemberId", "==", memberId).limit(2));
  if (linked.size === 0) throw new Error("operator_member_changed");
  if (linked.size !== 1) throw new Error("holding_unique_linked_member_required");
  const doc = linked.docs[0], profile = doc.data();
  if (doc.id !== profile?.memberId || !excelId(doc.id) || holdingProfileNativeId(profile) !== memberId)
    throw new Error("holding_verified_member_link_required");
  const lookup = (await get(db.doc(`studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${doc.id}`))).data();
  if (!lookup || lookup.status !== "done" || lookup.memberId !== doc.id || lookup.studioId !== profile.studioId ||
      lookup.studiomateMemberId !== memberId || lookup.memberName !== profile.name || lookup.memberPhone !== profile.phone ||
      resolvedTime(lookup.resolvedAt) !== resolvedTime(profile.studiomateMemberIdResolvedAt))
    throw new Error("holding_member_lookup_proof_mismatch");
  const samePhone = await get(db.collection("memberProfiles").where("phone", "==", profile.phone).limit(2));
  if (samePhone.size !== 1 || samePhone.docs[0].id !== doc.id)
    throw new Error("holding_member_phone_ambiguity");
  // Preserve exclusion flags and source fields; never persist a synthetic native profile.
  return { ...profile, memberId };
}
