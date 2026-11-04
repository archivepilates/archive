import { createHash } from 'node:crypto';

export const RECOVERY_PROFILE = 'excel_2480894ded997c06';
export const RECOVERY_NATIVE_ID = '5095448';
const digest = value => createHash('sha256').update(String(value)).digest('hex');

export async function recoverVerifiedChartMemberLink({ db, proof, resolvedAt, nowMs = Date.now() }) {
  const fail = code => { throw new Error(code); };
  const time = value => value?.toMillis?.() ?? Date.parse(value);
  if (proof?.memberId !== RECOVERY_PROFILE || proof.nativeMemberId !== RECOVERY_NATIVE_ID ||
    proof.queryKind !== 'full_phone' || proof.uniqueMatchCount !== 1 || proof.liveReadback !== true ||
    proof.sourceKind !== 'studiomate_rendered_dom' || !/^[a-f0-9]{64}$/.test(proof.phoneSha256 || '') ||
    !Number.isFinite(Date.parse(proof.checkedAt)) || nowMs - Date.parse(proof.checkedAt) < 0 ||
    nowMs - Date.parse(proof.checkedAt) > 10 * 60000 || !Number.isFinite(time(resolvedAt)) ||
    Math.abs(nowMs - time(resolvedAt)) > 30000) fail('member_link_live_proof_required');
  const profileRef = db.doc(`memberProfiles/${RECOVERY_PROFILE}`);
  const lookupRef = db.doc(`studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${RECOVERY_PROFILE}`);
  const auditRef = db.doc('workLanes/ops-monitor-accuracy-20261104/reports/member-link-5095448');
  return db.runTransaction(async tx => {
    const [profileSnap, lookupSnap, audit, native] = await Promise.all([
      tx.get(profileRef), tx.get(lookupRef), tx.get(auditRef), tx.get(db.doc(`memberProfiles/${RECOVERY_NATIVE_ID}`)),
    ]);
    const profile = profileSnap.data(), lookup = lookupSnap.data();
    if (!profile || profile.memberId !== RECOVERY_PROFILE || profile.studioId !== '5330' ||
      profile.name !== proof.memberName || digest(profile.phone) !== proof.phoneSha256 ||
      !/^01[016789]\d{7,8}$/.test(profile.phone || '') || profile.canonicalMemberId || profile.mergedInto ||
      profile.status === 'merged' || profile.supersededByMemberId || profile.externalActionEligible === false)
      fail('member_link_source_changed');
    if (audit.exists) {
      if (profile.studiomateMemberId === RECOVERY_NATIVE_ID && lookup?.status === 'done' &&
        lookup.studiomateMemberId === RECOVERY_NATIVE_ID && lookup.memberId === RECOVERY_PROFILE &&
        lookup.memberPhone === profile.phone && lookup.memberName === profile.name &&
        time(lookup.resolvedAt) === time(profile.studiomateMemberIdResolvedAt) &&
        audit.data()?.phoneSha256 === proof.phoneSha256) return { status: 'already_linked' };
      fail('member_link_prior_outcome_requires_review');
    }
    if (profile.studiomateMemberId || native.exists || ['done', 'processing', 'running'].includes(lookup?.status) ||
      (lookup?.memberId && lookup.memberId !== RECOVERY_PROFILE) || (lookup?.studioId && lookup.studioId !== '5330') ||
      (lookup?.memberPhone && lookup.memberPhone !== profile.phone) ||
      (lookup?.studiomateMemberId && lookup.studiomateMemberId !== RECOVERY_NATIVE_ID)) fail('member_link_existing_identity_review');
    const matches = await tx.get(db.collection('memberProfiles').where('phone', '==', profile.phone).limit(2));
    const nativeMatches = await tx.get(db.collection('memberProfiles').where('studiomateMemberId', '==', RECOVERY_NATIVE_ID).limit(2));
    if (matches.size !== 1 || matches.docs[0].id !== RECOVERY_PROFILE || nativeMatches.size) fail('member_link_ambiguous');
    tx.update(profileRef, { studiomateMemberId: RECOVERY_NATIVE_ID, studiomateMemberIdResolvedAt: resolvedAt });
    tx.set(lookupRef, { jobId: lookupRef.id, memberId: RECOVERY_PROFILE, studioId: '5330', memberName: profile.name,
      memberPhone: profile.phone, status: 'done', studiomateMemberId: RECOVERY_NATIVE_ID, resolvedAt,
      updatedAt: resolvedAt, lastError: null, source: 'operator_verified_chart_recovery',
      verification: { memberId: RECOVERY_PROFILE, nativeMemberId: RECOVERY_NATIVE_ID, phoneSha256: proof.phoneSha256,
        checkedAt: proof.checkedAt, queryKind: proof.queryKind, sourceKind: proof.sourceKind,
        liveReadback: true, uniqueMatchCount: 1 } }, { merge: true });
    tx.create(auditRef, { memberId: RECOVERY_PROFILE, studiomateMemberId: RECOVERY_NATIVE_ID,
      phoneSha256: proof.phoneSha256, sourceCheckedAt: proof.checkedAt, resolvedAt,
      outcome: 'linked', scope: 'existing_profile_pointer_only', nativeProfileCreated: false });
    return { status: 'linked' };
  });
}
