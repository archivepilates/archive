import { createHash } from "node:crypto";

export const REFERRAL_POINTS = 20_000;
export const STUDIO_ID = "5330";
export const REFERRAL_COLLECTION = "studiomateReferralRequests";
export const CLAIM_COLLECTION = "studiomateReferralPointClaims";
export const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const phone = value => typeof value === "string" && /^010\d{8}$/.test(value.replace(/[\s-]/g, ""))
  ? value.replace(/[\s-]/g, "") : "";
const nativeId = value => typeof value === "string" && /^[1-9]\d*$/.test(value);
const amount = value => Number.isSafeInteger(value) && value >= 0;

// One lifetime referral award per native newcomer, regardless of attribution edits,
// purchase count, policy revisions, retries or transport route.
export function referralClaimKey(newMemberId, studioId = STUDIO_ID) {
  if (!nativeId(newMemberId) || studioId !== STUDIO_ID) throw new Error("invalid_referral_identity");
  return digest(["studiomate-referral", studioId, newMemberId]);
}

export function assessStudioMateReferral({ request, source, policy, now = Date.now(), existingClaim = null }) {
  const hold = reason => ({ eligible: false, reason });
  if (policy?.enabled !== true || policy?.purchaseThresholdConfirmed !== true)
    return hold("policy_confirmation_required");
  if (policy.rewardPoints !== REFERRAL_POINTS || policy.minimumPurchaseWon !== 300_000)
    return hold("policy_mismatch");
  const startsAt = Date.parse(policy.startsAt);
  if (!Number.isFinite(startsAt) || startsAt > now) return hold("not_started");
  if (existingClaim !== null) return hold("already_claimed");
  if (!source || source.studioId !== STUDIO_ID || source.complete !== true || source.live !== true)
    return hold("native_source_required");
  const observed = Date.parse(source.checkedAt);
  if (!Number.isFinite(observed) || observed > now || now - observed > 120_000)
    return hold("native_source_stale");
  const { newcomer, referrer, purchase } = source;
  if (![newcomer, referrer].every(m => nativeId(m?.memberId) && phone(m.phone) && m.name && !m.inactive))
    return hold("member_identity_unverified");
  if (newcomer.name !== request?.newMemberName || phone(newcomer.phone) !== phone(request.newMemberPhone) ||
      referrer.name !== request?.referrerName || phone(referrer.phone) !== phone(request.referrerPhone))
    return hold("attribution_identity_mismatch");
  if (newcomer.memberId === referrer.memberId || phone(newcomer.phone) === phone(referrer.phone))
    return hold("self_referral");
  const joined = Date.parse(newcomer.registeredAt), referred = Date.parse(referrer.registeredAt);
  if (!Number.isFinite(joined) || !Number.isFinite(referred) || joined < startsAt || joined > now || referred >= joined)
    return hold("new_membership_unverified");
  if (typeof newcomer.memberGrade !== "string" || !newcomer.memberGrade.trim())
    return hold("member_classification_unverified");
  if (/(체험|강사|스텝|스태프|직원)/.test(newcomer.memberGrade || "")) return hold("excluded_member");
  if (!purchase || !nativeId(purchase.userTicketId) || purchase.memberId !== newcomer.memberId ||
      purchase.firstQualifyingPurchase !== true || purchase.cancelled !== false || purchase.refunded !== false ||
      !amount(purchase.paidWon) || !amount(purchase.totalWon) || purchase.unpaidWon !== 0 ||
      purchase.paidWon !== purchase.totalWon || purchase.paidWon < policy.minimumPurchaseWon)
    return hold("qualifying_purchase_unverified");
  if (/(체험|강사레슨|강사 레슨|야외|무료|1회권|스텝|스태프)/.test(purchase.title || ""))
    return hold("excluded_purchase");
  const paidAt = Date.parse(purchase.paidAt);
  if (!Number.isFinite(paidAt) || paidAt < joined || paidAt > now) return hold("purchase_time_unverified");
  return { eligible: true, amount: REFERRAL_POINTS, claimKey: referralClaimKey(newcomer.memberId),
    memberId: referrer.memberId, sourceHash: digest(source),
    reason: `추천:${referralClaimKey(newcomer.memberId).slice(0, 16)}` };
}

export function samePointState(a, b) {
  return a?.memberId === b?.memberId && a?.name === b?.name && a?.phone === b?.phone &&
    a?.remaining === b?.remaining && a?.earned === b?.earned && a?.used === b?.used &&
    digest(a?.history) === digest(b?.history);
}

export function verifyPointOutcome(before, after, target, action) {
  const delta = action.direction === "credit" ? action.points : -action.points;
  const history = after.history.filter(row => row.reason?.includes(action.reason));
  if (after.memberId !== target.memberId || after.name !== target.name || after.phone !== phone(target.phone) ||
      after.remaining !== before.remaining + delta ||
      after.earned !== before.earned + (delta > 0 ? delta : 0) ||
      after.used !== before.used + (delta < 0 ? -delta : 0) || history.length !== 1)
    throw new Error("point_outcome_unverified_do_not_replay");
}

// A durable atomic claim precedes the irreversible UI confirmation. Any claim,
// including unknown outcomes, blocks replay. Compensation is a separate action.
export async function executePointAction({ action, target, ledger, native, revalidate = async () => true }) {
  if (!action || !/^[a-f0-9]{64}$/.test(action.key) || !["credit", "debit"].includes(action.direction) ||
      action.points !== REFERRAL_POINTS || typeof action.reason !== "string" ||
      !action.reason.trim() || action.reason.length > 20 || !nativeId(target?.memberId) ||
      !phone(target.phone) || !target.name) throw new Error("invalid_point_action");
  if (await ledger.get(action.key)) return { status: "duplicate", attempts: 0 };
  const before = await native.read(target);
  if (before.memberId !== target.memberId || before.name !== target.name || before.phone !== phone(target.phone) ||
      ![before.remaining, before.earned, before.used].every(amount) || !Array.isArray(before.history))
    throw new Error("point_identity_or_balance_unverified");
  if (before.history.some(row => row.reason?.includes(action.reason))) throw new Error("existing_native_point_reason");
  if (action.direction === "debit" && before.remaining < action.points) throw new Error("insufficient_test_balance");
  if (await revalidate() !== true) throw new Error("source_revalidation_required");
  const claimed = await ledger.claim(action.key, { action, targetId: target.memberId, before, status: "claimed" });
  if (!claimed) return { status: "duplicate", attempts: 0 };
  try {
    await native.prepare(target, action);
    const fresh = await native.readCurrent(target);
    if (!samePointState(before, fresh)) throw new Error("point_state_changed_before_dispatch");
    let finalGateChecked = false;
    await native.confirm(target, action, async () => {
      if (finalGateChecked) throw new Error("point_final_gate_repeated");
      if (await revalidate() !== true) throw new Error("source_changed_before_dispatch");
      await ledger.update(action.key, { status: "dispatching", dispatchedAt: new Date().toISOString() });
      finalGateChecked = true;
    });
    if (!finalGateChecked) throw new Error("point_adapter_skipped_final_gate");
    const after = await native.read(target);
    verifyPointOutcome(before, after, target, action);
    await ledger.update(action.key, { status: "verified", after, verifiedAt: new Date().toISOString() });
    return { status: "verified", attempts: 1, before: before.remaining, after: after.remaining };
  } catch (error) {
    await native.cancel?.().catch(() => {});
    await ledger.update(action.key, { status: "review", reason: error.message });
    throw error;
  }
}
