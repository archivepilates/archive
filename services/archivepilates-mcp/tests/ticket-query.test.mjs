import test from 'node:test';
import assert from 'node:assert/strict';
import { selectExpiring } from '../src/ticket-query.mjs';
import { validate } from '../src/catalog.mjs';
import { createService } from '../src/service.mjs';

const now = Date.parse('2026-10-15T15:00:00Z');
const ticket = (end = '2026-10-26', extra = {}) => ({ name: '가상 그룹권', status: '사용중', classType: '그룹', remainingCount: 3,
  availableFrom: '2026-09-30T15:00:00Z', expiresAt: `${end}T00:00:00+09:00`, ...extra });
const profile = (id = '123', extra = {}) => ({ _id: id, memberId: id, studioId: '5330', name: '가상 회원', phone: '01012345678',
  activeTickets: [ticket()], syncedAt: new Date(now - 1000), ...extra });
const query = (rows, extra = {}) => selectExpiring(rows, { now, daysRemainingMax: 10, ...extra });

test('expiry query includes KST day zero and day ten, excludes already expired and day eleven', () => {
  const result = query([profile('123', { activeTickets: ['2026-10-15', '2026-10-16', '2026-10-26', '2026-10-27'].map(end => ticket(end)) })]);
  assert.deepEqual(result.members[0].tickets.map(t => t.daysRemaining), [0, 10]);
  assert.equal(result.range.startDate, '2026-10-16');
  assert.equal(result.range.endDate, '2026-10-26');
  assert.equal(result.memberCount, 1);
  assert.equal(result.ticketRowCount, 2);
  assert.equal(result.liveReadback, false);
  assert.equal(result.coverage.liveRosterComplete, false);
  assert.equal(result.allowedForExternalActions, false);
  assert.ok(!JSON.stringify(result).includes('01012345678'));
});
test('period passes with null counts and scheduled passes are retained; zero, refunded and holding are excluded', () => {
  const result = query([profile('123', { activeTickets: [ticket(undefined, { remainingCount: null }),
    ticket(undefined, { name: '예정권', status: '사용예정' }), ticket(undefined, { remainingCount: 0 }),
    ticket(undefined, { status: '환불' }), ticket(undefined, { status: '정지' })] })]);
  assert.equal(result.ticketRowCount, 2);
  assert.equal(result.coverage.excludedEmptyTickets, 1);
  assert.equal(result.coverage.excludedTicketStatus, 2);
});
test('class filter separates instructor lessons from group and private and reports unknown types', () => {
  const p = profile('123', { activeTickets: [ticket(), ticket(undefined, { name: '강사레슨 2T', classType: '그룹' }),
    ticket(undefined, { name: '개인권', classType: '개인' }), ticket(undefined, { name: '미분류', classType: '' })] });
  assert.equal(query([p], { classType: 'all' }).ticketRowCount, 4);
  for (const classType of ['group', 'private', 'instructor']) assert.equal(query([p], { classType }).ticketRowCount, 1);
  assert.equal(query([p]).coverage.unknownClassType, 1);
});
test('merged and other-studio profiles are excluded, duplicate identities are not silently double-counted', () => {
  const result = query([profile(), profile('excel_123'), profile('m', { mergedInto: '123' }), profile('x', { studioId: 'other' })]);
  assert.equal(result.memberCount, 0);
  assert.equal(result.coverage.ambiguousProfiles, 2);
  assert.equal(result.ambiguousMembers.length, 1);
  assert.equal(result.coverage.excludedInactiveProfiles, 1);
  assert.equal(result.coverage.invalidProfiles, 1);
});
test('invalid dates and counts are disclosed; identical cards are not double-counted', () => {
  const result = query([profile('123', { activeTickets: [ticket(), ticket(), ticket(undefined, { expiresAt: null }),
    ticket(undefined, { remainingCount: '3' }), ticket(undefined, { availableFrom: '2026-11-01' })] })]);
  assert.equal(result.ticketRowCount, 1);
  assert.equal(result.coverage.duplicateTickets, 1);
  assert.equal(result.coverage.invalidTickets, 3);
});
test('too many rows or matching members fail instead of truncating', () => {
  assert.throws(() => query(Array(2001).fill(profile())), { code: 'SOURCE_LIMIT' });
  assert.throws(() => query(Array.from({ length: 201 }, (_, n) => profile(String(n + 1), { name: `가상${n}`, phone: `0101234${String(n).padStart(4, '0')}` }))), { code: 'SOURCE_LIMIT' });
});
test('same-phone different names remain explicit ambiguous identities, not two confirmed members', () => {
  const result = query([profile(), profile('124', { name: '다른이름' })]);
  assert.equal(result.memberCount, 0);
  assert.equal(result.coverage.ambiguousProfiles, 2);
  assert.equal(result.ambiguousMembers[0].names.length, 2);
});
test('verified alias uses native inventory only, while identity-only native data stays unresolved', () => {
  const alias = profile('excel_123');
  const verifiedLinks = [{ aliasId: 'excel_123', nativeId: '123' }];
  const result = query([profile(), alias], { verifiedLinks });
  assert.equal(result.memberCount, 1);
  assert.equal(result.members[0].memberId, '123');
  assert.equal(result.ticketRowCount, 1);
  assert.equal(result.coverage.excludedVerifiedAliases, 1);
  for (const activeTickets of [[], undefined]) {
    const incomplete = query([profile('123', { activeTickets }), alias], { verifiedLinks });
    assert.equal(incomplete.coverage.excludedVerifiedAliases, 0);
    assert.equal(incomplete.memberCount, 0);
  }
});
test('typed arguments reject strings, NaN, negative, excessive, fractional and unknown properties', () => {
  for (const value of ['10', -1, 367, NaN, 1.5]) assert.equal(validate('members_list_expiring', { daysRemainingMax: value }), false);
  assert.equal(validate('members_list_expiring', { daysRemainingMax: 10 }), true);
  assert.equal(validate('members_list_expiring', { daysRemainingMax: 10, forceRefresh: true, classType: 'group' }), true);
  assert.equal(validate('members_list_expiring', { daysRemainingMax: 10, forceRefresh: 'true' }), false);
  assert.equal(validate('members_list_expiring', { daysRemainingMax: 10, raw: true }), false);
});
test('known displayed status suffixes are normalized without accepting negative or unknown states', () => {
  const result = query([profile('123', { activeTickets: [ticket(undefined, { status: '사용중 (10일 남음)' }),
    ticket(undefined, { name: '예정표시', status: '사용 예정' }), ticket(undefined, { name: '음성', status: '사용중 환불' }),
    ticket(undefined, { name: '알수없음', status: '신규상태' })] })]);
  assert.equal(result.ticketRowCount, 2);
  assert.equal(result.coverage.excludedTicketStatus, 2);
});
test('service checks operator even on cached inventory and never calls browser or writes', async () => {
  let active = true, calls = 0;
  const service = createService({ staffId: 'operator', now: () => now, readOnly: true,
    store: { getOperator: async () => ({ studioId: '5330', role: 'owner', active }),
      getTicketInventory: async ({ forceRefresh }) => { calls++; assert.equal(forceRefresh, true); return { profiles: [profile()], fetchedAt: now, cacheHit: false }; } } });
  const result = await service.callTool('members_list_expiring', { daysRemainingMax: 10, forceRefresh: true, source: 'snapshot' });
  assert.equal(result.memberCount, 1);
  assert.equal(result.source.freshness, 'unknown');
  active = false;
  await assert.rejects(service.callTool('members_list_expiring', { daysRemainingMax: 10, source: 'snapshot' }), { code: 'PERMISSION_DENIED' });
  assert.equal(calls, 1);
});
