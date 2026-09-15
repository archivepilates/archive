import test from 'node:test';
import assert from 'node:assert/strict';
import { REFERRAL_POLICY, assessReferral, referralKey, kstMonth } from '../lib/imweb-referral-policy.mjs';

const member = { siteCode: 'test-site', unitCode: 'test-unit', memberCode: 'new-member',
  uid: 'new-user', email: 'new@example.test', joinTime: '2026-09-15T05:00:00Z', recommendTargetCode: 'invite-code' };
const inviter = { ...member, memberCode: 'inviter', uid: 'inviter-user', email: 'inviter@example.test',
  joinTime: '2026-08-01T00:00:00Z', recommendCode: 'invite-code' };
const activePolicy = { ...REFERRAL_POLICY, enabled: true, startsAt: '2026-09-15T00:00:00+09:00' };
const input = { member, inviter, now: '2026-09-15T06:00:00Z', policy: activePolicy, sourceVerified: true };
const assess = changes => assessReferral({ ...input, ...changes });

test('approved amounts, signup-only, no phone authentication, activation held', () => {
  assert.equal(REFERRAL_POLICY.rewardWon, 3000);
  assert.equal(REFERRAL_POLICY.monthlyLimitWon, 30000);
  assert.equal(REFERRAL_POLICY.phoneVerificationRequired, false);
  assert.equal(REFERRAL_POLICY.purchaseRequired, false);
  assert.equal(assess({ policy: REFERRAL_POLICY }).reason, 'not_active');
});
test('verified new signup earns 3000 without a phone or purchase', () => {
  assert.equal(assess({}).eligible, true);
  assert.equal(assess({}).rewardWon, 3000);
});
test('truthy strings cannot activate payouts or assert source verification', () => {
  assert.equal(assess({ policy: { ...activePolicy, enabled: 'false' } }).reason, 'not_active');
  assert.equal(assess({ sourceVerified: 'true' }).reason, 'source_unverified');
});
test('tenth reward is allowed; eleventh is held', () => {
  assert.equal(assess({ monthlyReservedWon: 27000 }).eligible, true);
  assert.equal(assess({ monthlyReservedWon: 30000 }).reason, 'monthly_limit');
});
test('all existing ledger states block duplicate/reassignment payouts', () => {
  for (const status of ['reserved', 'sending', 'paid', 'unknown', 'failed', 'reversed']) {
    assert.equal(assess({ existingReward: { status } }).reason, 'already_recorded');
  }
  assert.equal(referralKey(member), referralKey({ ...member, uid: 'renamed', recommendTargetCode: 'different' }));
});
test('self-referral via stable member code or uid is rejected', () => {
  assert.equal(assess({ inviter: { ...inviter, memberCode: member.memberCode } }).reason, 'self_referral');
  assert.equal(assess({ inviter: { ...inviter, uid: member.uid } }).reason, 'self_referral');
});
test('same normalized email is rejected, missing email alone is not identity proof', () => {
  assert.equal(assess({ inviter: { ...inviter, email: ' NEW@EXAMPLE.TEST ' } }).reason, 'same_email');
  assert.equal(assess({ member: { ...member, email: '' } }).eligible, true);
});
test('unverified source, unknown referrer, or other site is rejected', () => {
  assert.equal(assess({ sourceVerified: false }).reason, 'source_unverified');
  assert.equal(assess({ member: { ...member, recommendTargetCode: null } }).reason, 'referrer_unverified');
  assert.equal(assess({ inviter: { ...inviter, recommendCode: 'other' } }).reason, 'referrer_unverified');
  assert.equal(assess({ inviter: { ...inviter, siteCode: 'other' } }).reason, 'site_mismatch');
});
test('activation cutoff excludes existing members and requires a valid date', () => {
  assert.equal(assess({ member: { ...member, joinTime: '2026-09-14T14:59:59Z' } }).reason, 'existing_member');
  assert.equal(assess({ policy: { ...activePolicy, startsAt: null } }).reason, 'not_started');
  assert.equal(assess({ policy: { ...activePolicy, startsAt: '2026-10-01T00:00:00Z' } }).reason, 'not_started');
});
test('invalid, future, or reverse-order join dates are held', () => {
  assert.equal(assess({ member: { ...member, joinTime: '' } }).reason, 'join_time_invalid');
  assert.equal(assess({ member: { ...member, joinTime: '2026-09-16T00:00:00Z' } }).reason, 'join_order_invalid');
  assert.equal(assess({ inviter: { ...inviter, joinTime: member.joinTime } }).reason, 'join_order_invalid');
});
test('KST month boundary, not UTC, controls the limit', () => {
  assert.equal(kstMonth('2026-09-30T14:59:59Z'), '2026-09');
  assert.equal(kstMonth('2026-09-30T15:00:00Z'), '2026-10');
  assert.equal(assess({ now: '2026-09-30T15:00:00Z' }).reason, 'past_month_review');
  assert.equal(assess({ member: { ...member, joinTime: '2026-09-30T15:00:00Z' }, now: '2026-09-30T15:01:00Z' }).eligible, true);
  assert.throws(() => kstMonth('2026-09-15 12:00:00'));
});
test('invalid counters, changed amounts, and missing identifiers fail closed', () => {
  for (const monthlyReservedWon of [-1, NaN, 0.5, '0', null]) {
    assert.equal(assess({ monthlyReservedWon }).reason, 'budget_invalid');
  }
  assert.equal(assess({ policy: { ...activePolicy, rewardWon: 5000 } }).reason, 'policy_mismatch');
  assert.equal(assess({ member: { ...member, memberCode: '' } }).reason, 'identity_missing');
});
