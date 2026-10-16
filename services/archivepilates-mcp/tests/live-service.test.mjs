import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../src/service.mjs';
import { OperationError } from '../src/errors.mjs';

const identity = { memberId: '123', name: '가상강사', phone: '01012345678' };
const checkedAt = '2026-10-15T03:00:00Z';
function fixture(t) {
  const store = { getOperator: t.mock.fn(async () => ({ studioId: '5330', active: true, role: 'owner' })),
    getProfile: t.mock.fn(async () => null), findMembers: t.mock.fn() };
  const liveReader = { findMembers: t.mock.fn(async () => ({ members: [identity], checkedAt, elapsedMs: 10 })),
    getOverview: t.mock.fn(async expected => ({ ...expected, checkedAt, memberGrade: '스텝', tickets: [],
      coverage: 'current_ticket_cards', ticketIdsAvailable: false, elapsedMs: 20 })) };
  let time = Date.parse(checkedAt);
  return { store, liveReader, setTime: value => { time = value; },
    ...createService({ store, approvals: {}, staffId: 'operator', readOnly: true, liveReader, now: () => time }) };
}

test('live search and overview support unsynced native members, mask phones, and never use stored tickets', async t => {
  const f = fixture(t), controller = new AbortController();
  const search = await f.callTool('members_find', { query: identity.name }, { signal: controller.signal });
  assert.equal(search.liveReadback, true);
  assert.equal(search.members[0].memberId, '123');
  const result = await f.callTool('members_get_overview', { memberId: '123' }, { signal: controller.signal });
  assert.equal(result.liveReadback, true);
  assert.equal(result.member.source.kind, 'studiomate_rendered_dom');
  assert.equal(result.member.source.liveReadback, true);
  assert.equal(result.checkedAt, checkedAt);
  assert.equal(result.member.maskedPhone, '010-****-5678');
  assert.ok(!JSON.stringify([search, result]).includes(identity.phone));
  assert.equal(f.store.getProfile.mock.callCount(), 0);
  assert.equal(f.store.findMembers.mock.callCount(), 0);
  assert.equal(f.liveReader.getOverview.mock.calls[0].arguments[1], controller.signal);
});

test('live failures propagate without a stored-data fallback or empty success', async t => {
  const f = fixture(t);
  f.liveReader.findMembers.mock.mockImplementation(async () => { throw new OperationError('LIVE_LOGIN_REQUIRED', '로그인 필요'); });
  await assert.rejects(f.callTool('members_find', { query: identity.name }), { code: 'LIVE_LOGIN_REQUIRED' });
  assert.equal(f.store.findMembers.mock.callCount(), 0);
  f.liveReader.findMembers.mock.mockImplementation(async () => ({ members: [identity], checkedAt }));
  await f.callTool('members_find', { query: identity.name });
  f.liveReader.getOverview.mock.mockImplementation(async () => { throw new OperationError('LIVE_BUSY', '사용 중'); });
  await assert.rejects(f.callTool('members_get_overview', { memberId: '123' }), { code: 'LIVE_BUSY' });
  assert.equal(f.store.getProfile.mock.callCount(), 0);
});

test('revoked operator and invalid search cannot start a live browser', async t => {
  const f = fixture(t);
  f.store.getOperator.mock.mockImplementation(async () => ({ studioId: '5330', role: 'owner', active: false }));
  await assert.rejects(f.callTool('members_find', { query: identity.name }), { code: 'PERMISSION_DENIED' });
  assert.equal(f.liveReader.findMembers.mock.callCount(), 0);
  f.store.getOperator.mock.mockImplementation(async () => ({ studioId: '5330', role: 'owner', active: true }));
  await assert.rejects(f.callTool('members_find', { query: '5678' }), { code: 'INVALID_ARGUMENT' });
  assert.equal(f.liveReader.findMembers.mock.callCount(), 0);
});

test('temporary IDs are not silently translated and stale native selections require source binding', async t => {
  const f = fixture(t);
  f.store.getProfile.mock.mockImplementation(async memberId => ({ _id: memberId, memberId, studioId: '5330',
    name: identity.name, phone: identity.phone, studiomateMemberId: '123' }));
  await assert.rejects(f.callTool('members_get_overview', { memberId: 'excel_old' }), { code: 'LIVE_SELECTION_REQUIRED' });
  assert.equal(f.liveReader.getOverview.mock.callCount(), 0);
  await f.callTool('members_find', { query: identity.name });
  f.setTime(Date.parse(checkedAt) + 600001);
  await f.callTool('members_get_overview', { memberId: '123' });
  assert.equal(f.store.getProfile.mock.callCount(), 2);
});

test('unexpected returned identity is rejected, writes remain hidden', async t => {
  const f = fixture(t);
  await f.callTool('members_find', { query: identity.name });
  f.liveReader.getOverview.mock.mockImplementation(async () => ({ ...identity, memberId: '999' }));
  await assert.rejects(f.callTool('members_get_overview', { memberId: '123' }), { code: 'LIVE_IDENTITY_MISMATCH' });
  assert.ok(f.listTools().every(row => row.annotations.readOnlyHint));
  await assert.rejects(f.callTool('memos_commit', { proposalId: 'none' }), { code: 'WRITE_DISABLED' });
});

test('live bookings reuse overview native profile binding and reject temporary IDs without translation', async t => {
  const f = fixture(t);
  f.store.getProfile.mock.mockImplementation(async memberId => ({ _id: memberId, memberId, studioId: '5330',
    name: identity.name, phone: identity.phone, studiomateMemberId: '123' }));
  f.liveReader.getBookings = t.mock.fn(async expected => ({ ...expected, checkedAt, records: [],
    coverage: { complete: true, kind: 'native_member_booking_history' } }));
  const dates = { startDate: '2026-10-01', endDate: '2026-10-31' };
  const result = await f.callTool('bookings_list', { memberId: '123', ...dates });
  assert.equal(result.liveReadback, true);
  assert.deepEqual(f.liveReader.getBookings.mock.calls[0].arguments[0], identity);
  assert.equal(f.store.getProfile.mock.callCount(), 1);
  await assert.rejects(f.callTool('bookings_list', { memberId: 'excel_old', ...dates }), { code: 'LIVE_SELECTION_REQUIRED' });
  assert.equal(f.liveReader.getBookings.mock.callCount(), 1);
});
