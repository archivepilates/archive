import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReferralLedger } from '../lib/imweb-referral-ledger.mjs';
import { REFERRAL_POLICY } from '../lib/imweb-referral-policy.mjs';
import { readReferralMembers, referralPairs, preparePointAward, IMWEB_REFERRAL_SCOPE as scope } from '../lib/imweb-referral-source.mjs';

const member = (id, extra = {}) => ({ ...scope, memberCode: `m-${id}`, uid: `test-${id}`,
  email: `${id}@example.test`, joinTime: '2026-09-15T00:00:00Z', recommendCode: null, recommendTargetCode: null, ...extra });
const context = { resolved_profile: { site_code: scope.siteCode, unit_code: scope.unitCode } };
function runner(pages) {
  return args => args[0] === 'config' ? context : { data: pages.shift() };
}
function awardRunner(write, rows = []) {
  return args => args[0] === 'config' ? context : args[2] === 'log' ? {
    data: { list: rows, currentPage: 1, pageSize: 50, totalCount: rows.length, totalPage: rows.length ? 1 : 0 },
  } : write(args);
}
test('reads all pages, minimizes fields, never writes', () => {
  const a = member('a', { name: 'not retained', callnum: 'not retained' });
  const out = readReferralMembers({ run: runner([{ list: [a], hasNext: true, nextCursor: 'next' },
    { list: [a, member('b')], hasNext: false }]) });
  assert.equal(out.members.length, 2);
  assert.equal(out.pages, 2);
  assert.equal(out.members[0].name, undefined);
  assert.equal(out.members[0].callnum, undefined);
});
test('incomplete and conflicting scans fail closed', () => {
  assert.throws(() => readReferralMembers({ maxPages: 1, run: runner([{ list: [], hasNext: true, nextCursor: 'n' }]) }), /incomplete/);
  assert.throws(() => readReferralMembers({ run: runner([{ list: [member('a')], hasNext: true, nextCursor: 'n' },
    { list: [member('a', { recommendTargetCode: 'changed' })], hasNext: false }]) }), /Conflicting/);
});
test('wrong site and cursor cycles are blocked', () => {
  assert.throws(() => readReferralMembers({ run: () => ({ resolved_profile: { site_code: 'wrong' } }) }), /scope/);
  assert.throws(() => readReferralMembers({ run: runner([
    { list: [], hasNext: true, nextCursor: 'n' }, { list: [], hasNext: true, nextCursor: 'n' },
  ]) }), /pagination/);
});
test('canonical attribution requires one unambiguous inviter', () => {
  const inviter = member('a', { recommendCode: 'ABCD1234' });
  const invited = member('b', { recommendTargetCode: 'ABCD1234' });
  assert.equal(referralPairs([invited, inviter])[0].inviter.uid, inviter.uid);
  assert.equal(referralPairs([invited])[0].inviter, null);
  assert.throws(() => referralPairs([inviter, member('c', { recommendCode: 'ABCD1234' })]), /Ambiguous/);
});
test('provider write is dry-run-first, explicit, and attempted at most once', () => {
  const calls = [];
  const award = preparePointAward(member('a'), 'a'.repeat(64), { run: awardRunner(args => {
    calls.push(args);
    return args.includes('--dry-run') ? { confirmation_token: 'fixture-only' } : { statusCode: 200 };
  }) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes('--yes'), false);
  award.send();
  assert.equal(calls[1].includes('--yes'), true);
  assert.throws(() => award.send(), /consumed/);
  assert.equal(calls.length, 2);
});
test('unknown provider outcome is not automatically retried', () => {
  let attempts = 0;
  const award = preparePointAward(member('a'), 'b'.repeat(64), { run: awardRunner(args => {
    if (args.includes('--dry-run')) return { confirmation_token: 'fixture-only' };
    attempts += 1;
    throw new Error('timeout');
  }) });
  assert.throws(() => award.send(), /timeout/);
  assert.throws(() => award.send(), /consumed/);
  assert.equal(attempts, 1);
});
test('real provider adapter and ledger agree on recipient, amount and reconciliation reason', () => {
  const directory = mkdtempSync(join(tmpdir(), 'referral-adapter-test-'));
  const ledger = new ReferralLedger(join(directory, 'test.sqlite'));
  try {
    const inviter = member('a', { recommendCode: 'TEST2026', joinTime: '2026-09-01T00:00:00Z' });
    const invited = member('b', { recommendTargetCode: 'TEST2026' });
    const result = ledger.reserve({ member: invited, inviter, sourceVerified: true, now: '2026-09-15T01:00:00Z',
      policy: { ...REFERRAL_POLICY, enabled: true, startsAt: '2026-09-14T00:00:00Z' } });
    let payload;
    const prepared = preparePointAward(inviter, result.record.rewardKey, { run: awardRunner(args => {
      assert.equal(args[4], inviter.uid);
      payload = JSON.parse(args[args.indexOf('--data') + 1]);
      return { confirmation_token: 'fixture-only' };
    }) });
    assert.equal(prepared.reason, result.record.providerReason);
    assert.equal(payload.reason, result.record.providerReason);
    assert.equal(payload.point, result.record.amountWon);
    assert.equal(payload.changeType, 'increase');
  } finally { ledger.close(); rmSync(directory, { recursive: true }); }
});
test('old provider award blocks a fresh or restored ledger before dry-run', () => {
  const target = member('a');
  const row = { unitCode: scope.unitCode, memberCode: target.memberCode, memberUid: target.uid,
    time: '2026-09-01T00:00:00Z', reason: `imweb-referral:${'a'.repeat(64)}`, changePoint: 3000,
    type: 'etc', currency: 'KRW' };
  assert.throws(() => preparePointAward(target, 'a'.repeat(64), {
    run: awardRunner(() => assert.fail('must not prepare'), [row]),
  }), /Prior provider award/);
});
