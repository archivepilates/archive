import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOLS, validate } from '../src/catalog.mjs';
import { OperationError } from '../src/errors.mjs';
import { createService } from '../src/service.mjs';

const checkedAt = '2026-10-16T01:00:00.000Z';
const startedAt = '2026-10-16T00:59:00.000Z';
const identity = { memberId: '123', name: '가상 회원', phone: '01012345678' };
const dates = { startDate: '2026-10-16', endDate: '2026-10-26' };
const ticket = extra => ({ userTicketId: 'ticket-1', name: '그룹권', classType: '그룹', status: '사용중',
  remainingCount: 3, availableFrom: '2026-10-01T00:00:00+09:00', expiresAt: '2026-10-26T00:00:00+09:00', ...extra });
const profile = extra => ({ _id: '123', studioId: '5330', ...identity, activeTickets: [ticket()], ...extra });
const booking = extra => ({ bookingId: 'booking-1', lectureDate: '2026-10-16', startAt: '2026-10-16T01:00:00Z',
  endAt: '2026-10-16T01:50:00Z', staffName: '가상강사', lessonType: '그룹', sourceStatus: '예약', userTicketId: 'ticket-1', ...extra });

function fixture(t, { reader = true } = {}) {
  const store = { getOperator: t.mock.fn(async () => ({ studioId: '5330', active: true, role: 'owner' })),
    getProfile: t.mock.fn(async () => null), getRows: t.mock.fn(async () => []),
    getTicketInventory: t.mock.fn(async () => ({ profiles: [profile()], fetchedAt: Date.parse(checkedAt), cacheHit: false })) };
  const liveReader = reader ? {
    getInventory: t.mock.fn(async () => ({ profiles: [profile()], checkedAt, startedAt, elapsedMs: 60000,
      coverage: { kind: 'native_member_pages', nativeTotal: 1, scannedMembers: 1, complete: true } })),
    getBookings: t.mock.fn(async expected => ({ ...expected, records: [booking()], checkedAt, startedAt, elapsedMs: 60000,
      coverage: { kind: 'native_member_booking_history', complete: true } })),
    getOverview: t.mock.fn(async expected => ({ ...expected, tickets: [], checkedAt, elapsedMs: 1 })),
    findMembers: t.mock.fn(async () => ({ members: [identity], checkedAt, elapsedMs: 1 })),
  } : undefined;
  // Deliberately earlier than the reader timestamp: service and reader clocks need not be identical in fixtures.
  let clock = Date.parse('2026-10-15T01:00:00Z');
  return { store, liveReader, setTime: value => { clock = value; },
    ...createService({ store, liveReader, staffId: 'operator', readOnly: true, now: () => clock }) };
}

test('schemas preserve nine reads, make source optional with live default, and reject other source values', () => {
  assert.deepEqual(TOOLS.filter(value => value.annotations.readOnlyHint).map(value => value.name), [
    'members_find', 'members_get_overview', 'members_list_expiring', 'bookings_list',
    'contracts_get_progress', 'messages_get_delivery', 'messages_validate_target', 'operations_get_job', 'operations_get_progress',
  ]);
  for (const [name, args] of [['members_list_expiring', { daysRemainingMax: 10 }],
    ['bookings_list', { memberId: '123', ...dates }]]) {
    assert.equal(validate(name, args), true);
    const schema = TOOLS.find(value => value.name === name).inputSchema;
    assert.equal(schema.properties.source.default, 'live');
    assert.deepEqual(schema.properties.source.enum, ['live', 'snapshot']);
    assert.ok(!schema.required.includes('source'));
    for (const source of ['live', 'snapshot']) assert.equal(validate(name, { ...args, source }), true);
    for (const source of ['stored', '', null, true, 1]) assert.equal(validate(name, { ...args, source }), false);
  }
});

test('default and explicit live queries fail closed without a reader or the required method', async t => {
  for (const reader of [false, true]) {
    const f = fixture(t, { reader });
    if (reader) { delete f.liveReader.getInventory; delete f.liveReader.getBookings; }
    for (const source of [undefined, 'live']) {
      const extra = source ? { source } : {};
      await assert.rejects(f.callTool('members_list_expiring', { daysRemainingMax: 10, ...extra }), { code: 'LIVE_SOURCE_UNAVAILABLE' });
      await assert.rejects(f.callTool('bookings_list', { memberId: '123', ...dates, ...extra }), { code: 'LIVE_SOURCE_UNAVAILABLE' });
    }
    assert.equal(f.store.getTicketInventory.mock.callCount(), 0);
    assert.equal(f.store.getProfile.mock.callCount(), 0);
    assert.equal(f.store.getRows.mock.callCount(), 0);
  }
});

test('live inventory keeps filtering/count policy and discloses native scan window using returned timing', async t => {
  const f = fixture(t), signal = new AbortController().signal;
  f.liveReader.getInventory.mock.mockImplementation(async () => ({
    profiles: [profile({ activeTickets: [ticket(), ticket(), ticket({ remainingCount: 0 }),
      ticket({ status: '정지' }), ticket({ expiresAt: '2026-10-15T00:00:00+09:00' }),
      ticket({ name: '개인권', classType: '개인' }), ticket({ name: '예정권', status: '사용예정' })] })],
    checkedAt, startedAt, elapsedMs: 60000,
    coverage: { nativeTotal: 1, scannedMembers: 1, complete: true, kind: 'native_member_pages' },
  }));
  const result = await f.callTool('members_list_expiring', { daysRemainingMax: 10, classType: 'group' }, { signal });
  assert.equal(result.memberCount, 1);
  assert.equal(result.ticketRowCount, 2);
  assert.equal(result.range.startDate, '2026-10-16');
  assert.equal(result.coverage.duplicateTickets, 1);
  assert.equal(result.coverage.excludedEmptyTickets, 1);
  assert.equal(result.coverage.excludedTicketStatus, 1);
  assert.equal(result.coverage.kind, 'native_member_pages');
  assert.equal(result.coverage.nativeTotal, 1);
  assert.equal(result.coverage.scannedMembers, 1);
  assert.equal(result.coverage.liveRosterComplete, true);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.liveReadback, true);
  assert.equal(result.allowedForExternalActions, false);
  assert.equal(result.source.allowedForExternalActions, false);
  assert.equal(result.source.observedAt, checkedAt);
  assert.equal(result.source.queriedAt, checkedAt);
  assert.deepEqual(result.source.sourceWindow, { startedAt, checkedAt });
  assert.equal(result.members[0].ticketFreshness, 'live_at_checked_time');
  assert.equal(result.checkedAt, checkedAt);
  assert.equal(result.elapsedMs, 60000);
  assert.equal(f.liveReader.getInventory.mock.calls[0].arguments[0], signal);
  assert.equal(f.store.getTicketInventory.mock.callCount(), 0);
  assert.ok(!JSON.stringify(result).includes(identity.phone));
});

test('live inventory selections support unsynced follow-up overview and bookings without a stored lookup', async t => {
  const f = fixture(t), signal = new AbortController().signal;
  await f.callTool('members_list_expiring', { daysRemainingMax: 10 });
  const overview = await f.callTool('members_get_overview', { memberId: '123' });
  assert.equal(overview.member.memberId, '123');
  const result = await f.callTool('bookings_list', { memberId: '123', ...dates }, { signal });
  assert.equal(result.liveReadback, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].userTicketId, 'ticket-1');
  assert.equal(result.records[0].sourceStatus, '예약');
  assert.equal(result.records[0].source.freshness, 'live_at_checked_time');
  assert.equal(result.source.allowedForExternalActions, false);
  assert.deepEqual(result.source.sourceWindow, { startedAt, checkedAt });
  const [expected, interval, forwardedSignal] = f.liveReader.getBookings.mock.calls[0].arguments;
  assert.equal(expected.memberId, '123');
  assert.equal(expected.phone, identity.phone);
  assert.deepEqual(interval, dates);
  assert.equal(forwardedSignal, signal);
  assert.equal(f.store.getProfile.mock.callCount(), 0);
  assert.equal(f.store.getRows.mock.callCount(), 0);
  assert.ok(!JSON.stringify(result).includes(identity.phone));
});

test('live bookings share search selection, sort and filter only the requested range', async t => {
  const f = fixture(t);
  await f.callTool('members_find', { query: identity.name });
  f.liveReader.getBookings.mock.mockImplementation(async expected => ({ ...expected, checkedAt, startedAt,
    coverage: { complete: true, kind: 'native_member_booking_history' }, records: [
      booking({ bookingId: 'late', lectureDate: '2026-10-26' }), booking(),
      booking({ bookingId: 'outside', lectureDate: '2026-10-27' }),
    ] }));
  const result = await f.callTool('bookings_list', { memberId: '123', ...dates, source: 'live' });
  assert.deepEqual(result.records.map(value => value.bookingId), ['booking-1', 'late']);
  assert.equal(f.store.getProfile.mock.callCount(), 0);
});

test('incomplete coverage, missing/malformed check time and inconsistent scan counts never become live readbacks', async t => {
  const cases = [
    { checkedAt: undefined }, { checkedAt: 'not-a-date' }, { checkedAt: '2026-02-30T00:00:00Z' },
    { startedAt: '2026-10-17T01:00:00Z' }, { coverage: undefined },
    { coverage: { complete: false, kind: 'native_member_pages' } },
    { coverage: { complete: true, kind: 'stored_profiles_only' } },
    { coverage: { complete: true, kind: 'native_member_pages', nativeTotal: 2, scannedMembers: 1 } },
    { coverage: { complete: true, kind: 'native_member_pages', nativeTotal: 1, scannedMembers: 0 } },
    { profiles: [profile({ _id: 'excel_123', memberId: 'excel_123' })] },
    { profiles: [profile({ studioId: 'other' })] },
  ];
  for (const patch of cases) {
    const f = fixture(t), original = await f.liveReader.getInventory();
    f.liveReader.getInventory.mock.mockImplementation(async () => ({ ...original, ...patch }));
    await assert.rejects(f.callTool('members_list_expiring', { daysRemainingMax: 10 }), OperationError);
    assert.equal(f.store.getTicketInventory.mock.callCount(), 0);
    await assert.rejects(f.callTool('members_get_overview', { memberId: '123' }), { code: 'MEMBER_NOT_FOUND' });
    assert.equal(f.liveReader.getOverview.mock.callCount(), 0);
  }
});

test('live bookings require complete proof and exact identity and never read stored booking records on failure', async t => {
  for (const patch of [{ checkedAt: undefined }, { coverage: { complete: false, kind: 'native_member_booking_history' } },
    { coverage: { complete: true, kind: 'stored_bookings' } }, { memberId: '999' }, { name: '다른 회원' },
    { phone: '01099999999' }, { records: undefined }]) {
    const f = fixture(t);
    await f.callTool('members_find', { query: identity.name });
    const original = await f.liveReader.getBookings(identity);
    f.liveReader.getBookings.mock.mockImplementation(async () => ({ ...original, ...patch }));
    await assert.rejects(f.callTool('bookings_list', { memberId: '123', ...dates }), OperationError);
    assert.equal(f.store.getRows.mock.callCount(), 0);
  }
});

test('reader errors propagate for both default live queries, never falling back or returning empty success', async t => {
  const f = fixture(t);
  await f.callTool('members_find', { query: identity.name });
  for (const code of ['LIVE_BUSY', 'LIVE_LOGIN_REQUIRED', 'SOURCE_UNAVAILABLE']) {
    f.liveReader.getInventory.mock.mockImplementation(async () => { throw new OperationError(code, 'unavailable'); });
    f.liveReader.getBookings.mock.mockImplementation(async () => { throw new OperationError(code, 'unavailable'); });
    await assert.rejects(f.callTool('members_list_expiring', { daysRemainingMax: 10 }), { code });
    await assert.rejects(f.callTool('bookings_list', { memberId: '123', ...dates }), { code });
  }
  assert.equal(f.store.getTicketInventory.mock.callCount(), 0);
  assert.equal(f.store.getRows.mock.callCount(), 0);
});

test('invalid booking intervals are rejected before live reader or stored profile access', async t => {
  const f = fixture(t);
  for (const interval of [{ startDate: '2026-02-30', endDate: '2026-03-01' },
    { startDate: '2026-10-26', endDate: '2026-10-16' },
    { startDate: '2026-10-01', endDate: '2026-11-01' }]) {
    for (const source of ['live', 'snapshot']) await assert.rejects(f.callTool('bookings_list', {
      memberId: '123', ...interval, source,
    }), { code: 'INVALID_ARGUMENT' });
  }
  assert.equal(f.liveReader.getBookings.mock.callCount(), 0);
  assert.equal(f.store.getProfile.mock.callCount(), 0);
  assert.equal(f.store.getRows.mock.callCount(), 0);
});

test('each live and snapshot query reauthorizes even with an existing selection or cached inventory', async t => {
  const f = fixture(t);
  await f.callTool('members_list_expiring', { daysRemainingMax: 10 });
  await f.callTool('bookings_list', { memberId: '123', ...dates });
  f.store.getOperator.mock.mockImplementation(async () => ({ studioId: '5330', role: 'owner', active: false }));
  for (const source of ['live', 'snapshot']) {
    await assert.rejects(f.callTool('members_list_expiring', { daysRemainingMax: 10, source }), { code: 'PERMISSION_DENIED' });
    await assert.rejects(f.callTool('bookings_list', { memberId: '123', ...dates, source }), { code: 'PERMISSION_DENIED' });
  }
  assert.equal(f.store.getOperator.mock.callCount(), 6);
  assert.equal(f.liveReader.getInventory.mock.callCount(), 1);
  assert.equal(f.liveReader.getBookings.mock.callCount(), 1);
  assert.equal(f.store.getTicketInventory.mock.callCount(), 0);
  assert.equal(f.store.getRows.mock.callCount(), 0);
});

test('explicit snapshot inventory keeps fetch time separate from unknown ticket observation on hits and refreshes', async t => {
  for (const cacheHit of [false, true]) {
    const f = fixture(t);
    f.store.getTicketInventory.mock.mockImplementation(async () => ({ profiles: [profile({ syncedAt: checkedAt })],
      fetchedAt: Date.parse(checkedAt), cacheHit }));
    const result = await f.callTool('members_list_expiring', { daysRemainingMax: 11, source: 'snapshot', forceRefresh: true });
    assert.equal(result.memberCount, 1);
    assert.equal(result.ticketRowCount, 1);
    assert.equal(result.liveReadback, false);
    assert.equal(result.members[0].ticketFreshness, 'unknown');
    assert.equal(result.source.freshness, 'unknown');
    assert.equal(result.source.observedAt, null);
    assert.equal(result.source.fetchedAt, checkedAt);
    assert.equal(result.source.snapshotFetchedAt, checkedAt);
    assert.equal(result.source.cacheHit, cacheHit);
    assert.equal(result.source.allowedForExternalActions, false);
    assert.equal(result.coverage.kind, 'stored_profiles_only');
    assert.equal(f.liveReader.getInventory.mock.callCount(), 0);
    assert.deepEqual(f.store.getTicketInventory.mock.calls[0].arguments[0], { forceRefresh: true });
  }
});

test('explicit snapshot bookings use stored rows and all freshness remains unknown despite supplied live flags', async t => {
  const f = fixture(t);
  f.store.getProfile.mock.mockImplementation(async () => profile({ syncedAt: checkedAt, liveReadback: true }));
  f.store.getRows.mock.mockImplementation(async () => [{ _id: 'excel_booking_1', memberId: '123',
    lectureDate: dates.startDate, lectureStartAt: checkedAt, syncedAt: checkedAt,
    checkedAt, liveReadback: true, freshness: 'live_at_checked_time', sourceStatus: 'reserved' }]);
  const result = await f.callTool('bookings_list', { memberId: '123', ...dates, source: 'snapshot' });
  for (const value of [result.source, result.member.source, result.records[0].source]) {
    assert.equal(value.freshness, 'unknown');
    assert.equal(value.liveReadback, false);
    assert.equal(value.allowedForExternalActions, false);
  }
  assert.equal(result.liveReadback, false);
  assert.equal(result.records[0].sourceKind, 'fallback');
  assert.equal(result.source.observedAt, null);
  assert.equal(f.liveReader.getBookings.mock.callCount(), 0);
  assert.equal(f.store.getRows.mock.calls[0].arguments[0], 'bookings');
});

test('complete empty live sources return honest empty results without stored fallback', async t => {
  const f = fixture(t);
  f.liveReader.getInventory.mock.mockImplementation(async () => ({ profiles: [], checkedAt, startedAt,
    coverage: { complete: true, nativeTotal: 0, scannedMembers: 0, kind: 'native_member_pages' } }));
  const inventory = await f.callTool('members_list_expiring', { daysRemainingMax: 0 });
  assert.equal(inventory.memberCount, 0);
  assert.equal(inventory.liveReadback, true);
  await f.callTool('members_find', { query: identity.name });
  f.liveReader.getBookings.mock.mockImplementation(async expected => ({ ...expected, records: [], checkedAt,
    coverage: { complete: true, kind: 'native_member_booking_history' } }));
  assert.deepEqual((await f.callTool('bookings_list', { memberId: '123', ...dates })).records, []);
  assert.equal(f.store.getRows.mock.callCount(), 0);
});

test('inventory remembers only matched identities, expires them and keeps the selection map bounded', async t => {
  const f = fixture(t);
  await f.callTool('members_list_expiring', { daysRemainingMax: 10 });
  f.setTime(Date.parse('2026-10-15T01:10:00Z'));
  await assert.rejects(f.callTool('bookings_list', { memberId: '123', ...dates }), { code: 'MEMBER_NOT_FOUND' });
  assert.equal(f.liveReader.getBookings.mock.callCount(), 0);
  const profiles = Array.from({ length: 200 }, (_, index) => profile({ _id: String(index + 1000), memberId: String(index + 1000),
    phone: `0101234${String(index).padStart(4, '0')}` }));
  profiles.push(profile({ _id: '9999', memberId: '9999', phone: '01099999999', activeTickets: [] }));
  f.liveReader.getInventory.mock.mockImplementation(async () => ({ profiles, checkedAt,
    coverage: { complete: true, kind: 'native_member_pages', nativeTotal: 201, scannedMembers: 201 } }));
  const result = await f.callTool('members_list_expiring', { daysRemainingMax: 10 });
  assert.equal(result.memberCount, 200);
  await f.callTool('members_get_overview', { memberId: '1000' });
  await f.callTool('members_get_overview', { memberId: '1199' });
  for (const memberId of ['123', '9999']) await assert.rejects(f.callTool('members_get_overview', { memberId }), { code: 'MEMBER_NOT_FOUND' });
});
