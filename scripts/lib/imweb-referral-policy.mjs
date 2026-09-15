import { createHash } from 'node:crypto';

// Activation is deliberately separate from the approved reward amounts.
export const REFERRAL_POLICY = Object.freeze({
  version: '2026-09-15',
  rewardWon: 3000,
  monthlyLimitWon: 30000,
  timezone: 'Asia/Seoul',
  phoneVerificationRequired: false,
  purchaseRequired: false,
  enabled: false,
  startsAt: null,
});

function instant(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}

export function kstMonth(value) {
  const time = instant(value);
  if (!Number.isFinite(time)) throw new Error('Timezone-qualified timestamp required');
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

export function referralKey(member) {
  if (![member?.siteCode, member?.unitCode, member?.memberCode].every(nonempty)) {
    throw new Error('Canonical Imweb member identity required');
  }
  return createHash('sha256')
    .update(JSON.stringify([member.siteCode, member.unitCode, member.memberCode]))
    .digest('hex');
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Pure decision helper, not an authorization or points-write endpoint.
 * Caller must fetch canonical members from Imweb and reserve the reward key
 * and monthly budget atomically in a durable ledger before any provider call.
 */
export function assessReferral({ member, inviter, now, policy = REFERRAL_POLICY,
  existingReward = null, monthlyReservedWon = 0, sourceVerified = false }) {
  const hold = (reason) => ({ eligible: false, rewardWon: 0, reason });
  if (policy.enabled !== true) return hold('not_active');
  if (policy.rewardWon !== 3000 || policy.monthlyLimitWon !== 30000) return hold('policy_mismatch');
  const start = instant(policy.startsAt);
  const current = instant(now);
  if (!Number.isFinite(start) || !Number.isFinite(current) || start > current) return hold('not_started');
  if (sourceVerified !== true) return hold('source_unverified');
  if (![member, inviter].every(m => [m?.siteCode, m?.unitCode, m?.memberCode, m?.uid].every(nonempty))) {
    return hold('identity_missing');
  }
  if (member.siteCode !== inviter.siteCode || member.unitCode !== inviter.unitCode) return hold('site_mismatch');
  const key = referralKey(member);
  // Never pay again, including ambiguous/failed provider attempts. Reconciliation
  // belongs to the future ledger worker, not this eligibility calculation.
  if (existingReward !== null) return hold('already_recorded');
  if (member.memberCode === inviter.memberCode || member.uid === inviter.uid) return hold('self_referral');
  if (normalizedEmail(member.email) && normalizedEmail(member.email) === normalizedEmail(inviter.email)) {
    return hold('same_email');
  }
  if (!nonempty(member.recommendTargetCode) || member.recommendTargetCode !== inviter.recommendCode) {
    return hold('referrer_unverified');
  }
  const joined = instant(member.joinTime);
  const inviterJoined = instant(inviter.joinTime);
  if (!Number.isFinite(joined) || !Number.isFinite(inviterJoined)) return hold('join_time_invalid');
  if (joined < start) return hold('existing_member');
  if (joined > current || inviterJoined >= joined) return hold('join_order_invalid');
  // No retroactive awards or carry-over until an explicit policy approves them.
  if (kstMonth(member.joinTime) !== kstMonth(now)) return hold('past_month_review');
  if (!Number.isSafeInteger(monthlyReservedWon) || monthlyReservedWon < 0) return hold('budget_invalid');
  if (monthlyReservedWon + policy.rewardWon > policy.monthlyLimitWon) return hold('monthly_limit');
  return { eligible: true, rewardWon: policy.rewardWon, reason: 'eligible',
    rewardKey: key, month: kstMonth(member.joinTime) };
}
