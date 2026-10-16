import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationError } from '../src/errors.mjs';
import { normalizeMemberPage, normalizeBookingPage } from '../src/native-model.mjs';
import { selectExpiring } from '../src/ticket-query.mjs';

const ORIGIN = 'https://api.studiomate.kr';
const MEMBERS = `${ORIGIN}/v2/staff/members?page=1&limit=50&sort_name=asc&with=profile;account;avatars;userGrade;tickets.ticket;lockers`;
const BOOKINGS = `${ORIGIN}/staff/member/123/booking?page=1&per_page=10&with=lecture.course;lecture.instructor.profile;lecture.instructor.avatars;userTicket.metadata`;
const clone = value => structuredClone(value);
const pass = (patch = {}) => ({ id: 71, studio_id: 5330, member_id: 123, ticket_id: 9,
  ticket: { id: 9, title: 'Synthetic Pass', type: 'coupon', available_class_type: 'G' },
  max_coupon: 10, remaining_coupon: 3, availability_start_at: '2026-10-01 00:00:00',
  expire_at: '2026-10-26 00:00:00', active: true, ticket_usable: true, is_holding: false,
  is_shared: 0, updated_at: '2026-10-16 10:00:00', payment: 'PRIVATE_SENTINEL', ...patch });
const member = (patch = {}) => ({ id: 123, name: 'Synthetic Member', mobile: '010-1234-5678',
  userTickets: [pass()], private_memo: 'PRIVATE_SENTINEL', ...patch });
const booking = (patch = {}) => ({ id: 81, studio_id: 5330, lecture_id: 91, user_ticket_id: 71,
  status: 'attendance', deleted_at: null, private_memo: 'PRIVATE_SENTINEL',
  lecture: { id: 91, studio_id: 5330, type: 'G', title: 'Synthetic Lesson',
    start_on: '2026-10-16 08:30:00', end_on: '2026-10-16 09:20:00',
    instructor: { name: 'Synthetic Staff', phone: 'PRIVATE_SENTINEL' } }, ...patch });
function memberBody(rows = [member()], meta = {}) {
  return { data: rows, count: { total_count: rows.length },
    meta: { current_page: 1, per_page: 50, total: rows.length, last_page: 1, ...meta } };
}
function bookingBody(rows = [booking()], meta = {}) {
  return { kind: { total_count: rows.length },
    bookings: { current_page: 1, per_page: 10, total: rows.length, last_page: 1, data: rows, ...meta } };
}
const members = (body = memberBody(), url = MEMBERS, options = { page: 1 }) => normalizeMemberPage(body, url, options);
const bookings = (body = bookingBody(), url = BOOKINGS, options = { memberId: '123', page: 1 }) => normalizeBookingPage(body, url, options);
function rejected(action) {
  assert.throws(action, error => error instanceof OperationError && error.safe === true
    && !error.message.includes('PRIVATE_SENTINEL'));
}

test('member projection has exact public fields and does not mutate the source', () => {
  const body = memberBody(), before = clone(body), result = members(body);
  assert.deepEqual(result, { profiles: [{ _id: '123', memberId: '123', studioId: '5330',
    name: 'Synthetic Member', phone: '01012345678', activeTickets: [{ userTicketId: '71',
      name: 'Synthetic Pass', classType: 'group', type: 'coupon', status: 'active',
      availableFrom: '2026-09-30T15:00:00.000Z', expiresAt: '2026-10-25T15:00:00.000Z',
      remainingCount: 3 }] }], page: 1, perPage: 50, total: 1, lastPage: 1 });
  assert.deepEqual(body, before);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
});

test('member URL permits only the exact API origin, path and complete inventory scope', () => {
  for (const url of ['PRIVATE_SENTINEL', MEMBERS.replace('https:', 'http:'),
    MEMBERS.replace('api.studiomate.kr', 'api.studiomate.kr.evil.test'),
    MEMBERS.replace('api.studiomate.kr', 'PRIVATE_SENTINEL@api.studiomate.kr'),
    MEMBERS.replace('/v2/staff/members', '/staff/members'), `${MEMBERS}#PRIVATE_SENTINEL`,
    MEMBERS.replace('sort_name=asc', 'sort_name=desc'), MEMBERS.replace('&sort_name=asc', ''),
    MEMBERS.replace('tickets.ticket', 'tickets'), `${MEMBERS}&status=active`,
    `${MEMBERS}&member_id=123`, `${MEMBERS}&page=1`, `${MEMBERS}&with=tickets.ticket`,
    MEMBERS.replace('page=1', 'page=2'), MEMBERS.replace('limit=50', 'limit=10')]) {
    rejected(() => members(memberBody(), url));
  }
  assert.equal(members(memberBody(), MEMBERS.replace('tickets.ticket', 'tickets.ticket,other')).total, 1);
  assert.equal(members(memberBody(), MEMBERS.replaceAll(';', ',')).total, 1);
  assert.equal(members(memberBody(), MEMBERS.replaceAll(';', '%3B')).total, 1);
});

test('pagination accepts numeric strings, stable references, final and empty pages', () => {
  for (const [normalize, body, url, options, key] of [
    [normalizeMemberPage, memberBody(), MEMBERS, { page: 1 }, 'profiles'],
    [normalizeBookingPage, bookingBody(), BOOKINGS, { memberId: '123', page: 1 }, 'records'],
  ]) {
    const meta = body.meta ?? body.bookings;
    for (const field of ['current_page', 'per_page', 'total', 'last_page']) meta[field] = String(meta[field]);
    (body.count ?? body.kind).total_count = '1';
    assert.equal(normalize(body, url, { ...options, total: '1', perPage: meta.per_page })[key].length, 1);
    const finalTotal = Number(meta.per_page) + 1;
    meta.current_page = 2; meta.total = finalTotal; meta.last_page = 2;
    (body.count ?? body.kind).total_count = finalTotal;
    assert.equal(normalize(body, url.replace('page=1', 'page=2'), { ...options, page: 2, total: finalTotal }).page, 2);
    const empty = key === 'profiles' ? memberBody([]) : bookingBody([]);
    assert.deepEqual(normalize(empty, url, options)[key], []);
  }
});

test('pagination rejects missing/invalid shape, mismatches, unstable references and wrong lengths', () => {
  for (const [normalize, base, url, options] of [
    [normalizeMemberPage, memberBody(), MEMBERS, { page: 1 }],
    [normalizeBookingPage, bookingBody(), BOOKINGS, { memberId: '123', page: 1 }],
  ]) {
    for (const invalid of [null, [], {}, { data: [] }]) rejected(() => normalize(invalid, url, options));
    for (const patch of [{ current_page: 0 }, { current_page: 2 }, { last_page: 0 }, { last_page: 2 },
      { per_page: 0 }, { per_page: 51 }, { total: -1 }, { total: 1.2 }, { total: '1e0' },
      { total: '' }, { total: true }, { total: null }, { total: ' 1' }, { total: '01' },
      { total: '9007199254740992' }]) {
      const body = clone(base);
      Object.assign(body.meta ?? body.bookings, patch);
      rejected(() => normalize(body, url, options));
    }
    for (const patch of [{ total: 2 }, { perPage: 1 }, { page: 2 }, { page: null }]) {
      rejected(() => normalize(base, url, { ...options, ...patch }));
    }
    for (const rows of [[], [member(), member()], null, {}]) {
      const body = clone(base);
      if (body.meta) body.data = rows; else body.bookings.data = rows;
      rejected(() => normalize(body, url, options));
    }
    const body = clone(base);
    (body.count ?? body.kind).total_count = 2;
    rejected(() => normalize(body, url, options));
    rejected(() => normalize(base, url));
  }
});

test('inventory and booking totals are bounded before projecting any rows', () => {
  for (const [normalize, body, url, options, cap] of [
    [normalizeMemberPage, memberBody(), MEMBERS, { page: 1 }, 2000],
    [normalizeBookingPage, bookingBody(), BOOKINGS, { memberId: '123', page: 1 }, 20000],
  ]) {
    const meta = body.meta ?? body.bookings;
    meta.total = cap + 1; meta.last_page = Math.ceil(meta.total / meta.per_page);
    (body.count ?? body.kind).total_count = cap + 1;
    rejected(() => normalize(body, url, options));
  }
});

test('maximum totals and full final pages are accepted without truncation', () => {
  const memberRows = Array.from({ length: 50 }, (_, index) => member({ id: index + 1, userTickets: [] }));
  const memberPage = memberBody(memberRows, { current_page: 40, total: 2000, last_page: 40 });
  memberPage.count.total_count = 2000;
  assert.equal(members(memberPage, MEMBERS.replace('page=1', 'page=40'),
    { page: 40, total: 2000, perPage: 50 }).profiles.length, 50);
  const bookingRows = Array.from({ length: 50 }, (_, index) => booking({ id: index + 1 }));
  const bookingPage = bookingBody(bookingRows, { current_page: 400, per_page: 50, total: 20000, last_page: 400 });
  bookingPage.kind.total_count = 20000;
  assert.equal(bookings(bookingPage, BOOKINGS.replace('page=1', 'page=400').replace('per_page=10', 'per_page=50'),
    { memberId: '123', page: 400, total: 20000, perPage: 50 }).records.length, 50);
});

test('sparse arrays cannot masquerade as complete page or ticket rows', () => {
  rejected(() => members(memberBody(new Array(1))));
  rejected(() => bookings(bookingBody(new Array(1))));
  rejected(() => members(memberBody([member({ userTickets: new Array(1) })])));
});

test('member and ticket identities, ownership, arrays and issued ID uniqueness fail closed', () => {
  for (const id of [0, -1, 1.5, NaN, true, null, {}, '01', 'excel_123', '12345678901234567', 9007199254740992]) {
    rejected(() => members(memberBody([member({ id })])));
    rejected(() => members(memberBody([member({ userTickets: [pass({ id })] })])));
  }
  assert.equal(members(memberBody([member({ id: '1234567890123456', userTickets: [] })])).profiles[0].memberId, '1234567890123456');
  for (const patch of [{ studio_id: 1 }, { member_id: 124 }, { name: '' }, { name: null },
    { userTickets: undefined }, { userTickets: {} }, { userTickets: null },
    { userTickets: Array.from({ length: 101 }, (_, id) => pass({ id: id + 1 })) }]) {
    rejected(() => members(memberBody([member(patch)])));
  }
  for (const patch of [{ studio_id: 1 }, { studio_id: undefined }, { member_id: 124 },
    { member_id: null }, { ticket_id: 10 }, { ticket: null }, { ticket: {} },
    { ticket: { ...pass().ticket, studio_id: 1 } }, { ticket: { ...pass().ticket, member_id: 124 } },
    { active: 'false' }, { ticket_usable: 1 }, { is_holding: null }, { is_shared: true }]) {
    rejected(() => members(memberBody([member({ userTickets: [pass(patch)] })])));
  }
  rejected(() => members(memberBody([member(), member({ id: '123' })])));
  rejected(() => members(memberBody([member({ userTickets: [pass(), pass({ id: '71' })] })])));
});

test('explicit active AND usable semantics never turn disabled tickets into scheduled ones', () => {
  for (const active of [false, true]) for (const ticket_usable of [false, true]) for (const is_holding of [false, true]) {
    const row = members(memberBody([member({ userTickets: [pass({ active, ticket_usable, is_holding })] })])).profiles[0].activeTickets[0];
    assert.equal(row.status, is_holding ? '\uc815\uc9c0' : active && ticket_usable ? 'active' : 'inactive');
  }
});

test('unknown string class types remain null while malformed class fields fail safely', () => {
  for (const available_class_type of ['future_native_type', 'A', '', 'toString', '__proto__']) {
    const row = pass({ ticket: { ...pass().ticket, available_class_type } });
    assert.equal(members(memberBody([member({ userTickets: [row] })])).profiles[0].activeTickets[0].classType, null);
  }
  for (const available_class_type of [null, undefined, true, 1, [], {}]) {
    const row = pass({ ticket: { ...pass().ticket, available_class_type } });
    rejected(() => members(memberBody([member({ userTickets: [row] })])));
  }
  const row = pass({ ticket: { ...pass().ticket, available_class_type: 'P' } });
  assert.equal(members(memberBody([member({ userTickets: [row] })])).profiles[0].activeTickets[0].classType, 'private');
});

test('distinct issued IDs survive projection and selectExpiring; disabled and period semantics integrate', () => {
  const rows = [pass(), pass({ id: 72 }), pass({ id: 73, active: false }),
    pass({ id: 74, ticket: { ...pass().ticket, type: 'period' }, remaining_coupon: 0 })];
  const profiles = members(memberBody([member({ userTickets: rows })])).profiles;
  const result = selectExpiring(profiles, { now: Date.parse('2026-10-16T00:00:00+09:00'), daysRemainingMax: 10 });
  assert.equal(profiles[0].activeTickets.length, 4);
  assert.deepEqual(result.members[0].tickets.map(row => row.userTicketId), ['71', '72', '74']);
  assert.equal(result.coverage.excludedTicketStatus, 1);
  assert.equal(result.coverage.duplicateTickets, 0);
  assert.equal(result.members[0].tickets[2].remainingCount, null);
});

test('invalid ticket dates/counts are null, never inferred; leap day and KST are strict', () => {
  for (const date of ['2026-02-29 00:00:00', '2026-04-31 00:00:00', '2026-13-01 00:00:00',
    '2026-10-01 01:00:00', '2026-10-01', '2026-10-01T00:00:00Z', null, 0]) {
    const row = members(memberBody([member({ userTickets: [pass({ availability_start_at: date, expire_at: date })] })])).profiles[0].activeTickets[0];
    assert.equal(row.availableFrom, null); assert.equal(row.expiresAt, null);
  }
  const leap = members(memberBody([member({ userTickets: [pass({ availability_start_at: '2024-02-29 00:00:00' })] })])).profiles[0].activeTickets[0];
  assert.equal(leap.availableFrom, '2024-02-28T15:00:00.000Z');
  for (const remaining_coupon of [-1, 1.5, NaN, Infinity, '3', true, null, undefined]) {
    assert.equal(members(memberBody([member({ userTickets: [pass({ remaining_coupon })] })])).profiles[0].activeTickets[0].remainingCount, null);
  }
  assert.equal(members(memberBody([member({ userTickets: [pass({ remaining_coupon: 0 })] })])).profiles[0].activeTickets[0].remainingCount, 0);
  const reversed = members(memberBody([member({ userTickets: [pass({ expire_at: '2026-09-01 00:00:00' })] })])).profiles[0].activeTickets[0];
  assert.equal(reversed.availableFrom, null); assert.equal(reversed.expiresAt, null);
});

test('raw invalid phones remain invalid without guessed zeros or stripped masks', () => {
  for (const mobile of ['1012345678', '010-****-5678', '+82 10 1234 5678', 'bad01012345678', '010\t1234\t5678',
    '0101234567', '0-1-0-1-2-3-4-5-6-7-8', 1012345678]) {
    const profiles = members(memberBody([member({ mobile })])).profiles;
    assert.equal(profiles[0].phone, null);
    assert.equal(selectExpiring(profiles, { now: Date.parse('2026-10-16'), daysRemainingMax: 10 }).coverage.invalidProfiles, 1);
  }
  assert.equal(members(memberBody([member({ mobile: null })])).profiles[0].phone, null);
  assert.equal(members(memberBody([member({ mobile: '010 1234 5678' })])).profiles[0].phone, '01012345678');
});

test('booking projection has exact fields, native identities and KST ISO times without private data', () => {
  const body = bookingBody(), before = clone(body), result = bookings(body);
  assert.deepEqual(result, { records: [{ bookingId: '81', userTicketId: '71', lectureDate: '2026-10-16',
    startAt: '2026-10-15T23:30:00.000Z', endAt: '2026-10-16T00:20:00.000Z',
    staffName: 'Synthetic Staff', lessonType: 'group', sourceStatus: 'attendance' }],
  page: 1, perPage: 10, total: 1, lastPage: 1 });
  assert.deepEqual(body, before);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
});

test('booking URL rejects filters, duplicate queries, wrong member, origin and path', () => {
  for (const url of [BOOKINGS.replace('/123/', '/124/'), BOOKINGS.replace('https:', 'http:'),
    BOOKINGS.replace('api.studiomate.kr', 'evil.test'), BOOKINGS.replace('/staff/', '/v2/staff/'),
    `${BOOKINGS}&status[]=attendance`, `${BOOKINGS}&status%5B%5D=cancel`,
    `${BOOKINGS}&ticket_id=9`, `${BOOKINGS}&user_ticket_id=71`, `${BOOKINGS}&page=1`,
    `${BOOKINGS}&with=other`, `${BOOKINGS}#fragment`, BOOKINGS.replace('page=1', 'page=2'),
    BOOKINGS.replace('per_page=10', 'per_page=1')]) rejected(() => bookings(bookingBody(), url));
  rejected(() => bookings(bookingBody(), BOOKINGS, { memberId: 'excel_123', page: 1 }));
});

test('booking statuses are preserved exactly and private lessons are mapped explicitly', () => {
  for (const status of ['booked', 'booking_waiting', 'booking_confirmed', 'attendance', 'absence', 'noshow', 'cancel']) {
    const row = booking({ status }); row.lecture.type = 'P';
    const result = bookings(bookingBody([row])).records[0];
    assert.equal(result.sourceStatus, status); assert.equal(result.lessonType, 'private');
  }
});

test('booking ownership, IDs, lecture scope, deletion and duplicates fail closed', () => {
  for (const patch of [{ id: 'excel_81' }, { id: '12345678901234567' }, { user_ticket_id: null },
    { studio_id: 1 }, { studio_id: undefined }, { lecture_id: 92 }, { lecture_id: null },
    { member_id: 124 }, { member_id: null }, { deleted_at: '2026-10-16 01:00:00' },
    { deleted_at: undefined }, { status: 'unknown' }, { status: 'cancelled' }, { status: null },
    { lecture: null }, { lecture: {} }]) rejected(() => bookings(bookingBody([booking(patch)])));
  for (const patch of [{ id: 92 }, { studio_id: 1 }, { studio_id: undefined }, { member_id: 124 },
    { type: 'X' }, { instructor: null }, { instructor: { name: '' } }]) {
    const row = booking(); Object.assign(row.lecture, patch);
    rejected(() => bookings(bookingBody([row])));
  }
  rejected(() => bookings(bookingBody([booking(), booking({ id: '81' })])));
  assert.equal(bookings(bookingBody([booking({ member_id: '123' })])).records.length, 1);
});

test('booking timestamps reject rollover, timezone guessing, malformed and nonpositive intervals', () => {
  for (const date of ['2026-02-29 08:30:00', '2026-04-31 08:30:00', '2026-00-16 08:30:00',
    '2026-10-00 08:30:00', '2026-10-16 24:00:00', '2026-10-16 08:60:00',
    '2026-10-16 08:30:60', '2026-10-16T08:30:00+09:00', '2026-10-16', null]) {
    for (const field of ['start_on', 'end_on']) {
      const row = booking(); row.lecture[field] = date;
      rejected(() => bookings(bookingBody([row])));
    }
  }
  for (const end_on of ['2026-10-16 08:30:00', '2026-10-16 08:29:59']) {
    const row = booking(); row.lecture.end_on = end_on;
    rejected(() => bookings(bookingBody([row])));
  }
  const row = booking(); row.lecture.start_on = '2024-02-29 23:30:00'; row.lecture.end_on = '2024-03-01 00:20:00';
  assert.equal(bookings(bookingBody([row])).records[0].lectureDate, '2024-02-29');
});
