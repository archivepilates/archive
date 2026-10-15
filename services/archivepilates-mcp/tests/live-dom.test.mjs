import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSearch, validateOverview, assertMemberUrl } from '../src/live-dom.mjs';

const NAME = 'Synthetic Member';
const PHONE = '01012345678';
const EXPECTED = { name: NAME, phone: PHONE };
const ORIGIN = 'https://arcpilates.studiomate.kr';
const MEMBER_URL = `${ORIGIN}/users/detail?id=123`;
const REMAINING = '\uc794\uc5ec';
const RESERVABLE = '\uc608\uc57d\uac00\ub2a5';
const COUNT_TYPE = '\ud69f\uc218\uc81c';
const PERIOD_TYPE = '\uae30\uac04\uc81c';
const PAYMENT_LABEL = '\uacb0\uc81c\uae08\uc561';
const WON = '\uc6d0';
const TIMES = '\ud68c';

function search(patch = {}) {
  return { ready: true, query: NAME, incomplete: false,
    rows: [{ name: NAME, phone: '010-1234-5678' }], ...patch };
}

function ticket(patch = {}) {
  return { name: 'Synthetic Pass', status: '\uc774\uc6a9\uc911', type: COUNT_TYPE,
    counts: [{ label: REMAINING, value: `4${TIMES}` }, { label: RESERVABLE, value: '3' }],
    period: '2026. 10. 1. ~ 2026. 10. 31.', payment: `${PAYMENT_LABEL} 120,000${WON}`,
    ...patch };
}

function overview(patch = {}) {
  return { ready: true, incomplete: false, addCards: 1, name: NAME,
    phone: '010-1234-5678', memberGrade: 'Synthetic Grade', tickets: [ticket()], ...patch };
}

function throwsCode(action, code) {
  assert.throws(action, error => error.code === code && error.safe === true);
}

test('search normalizes whitespace and formatted phones and returns exact fields only', () => {
  const raw = search({ query: `  ${NAME}  `,
    rows: [{ name: ' Synthetic   Member ', phone: '010 1234 5678', memberId: 'untrusted' }] });
  assert.deepEqual(validateSearch(raw, NAME, false), [EXPECTED]);
  assert.deepEqual(validateSearch(search({ query: '010-1234-5678' }), '010-1234-5678', true), [EXPECTED]);
});

test('search compares Unicode-normalized names exactly', () => {
  const name = 'Synthetic Caf\u00e9';
  assert.deepEqual(validateSearch(search({ query: name, rows: [{ name: name.normalize('NFD'), phone: PHONE }] }),
    name, false), [{ name, phone: PHONE }]);
});

test('search excludes partial names, unrelated rows and phone suffix matches', () => {
  assert.deepEqual(validateSearch(search({ rows: [{ name: `${NAME} Extra`, phone: PHONE }] }), NAME, false), []);
  assert.deepEqual(validateSearch(search({ query: PHONE,
    rows: [{ name: NAME, phone: '01092345678' }] }), PHONE, true), []);
  assert.deepEqual(validateSearch(search({ rows: [
    { name: `${NAME} Extra`, phone: '01099998888' }, EXPECTED,
  ] }), NAME, false), [EXPECTED]);
});

test('search preserves distinct exact-name candidates rather than selecting the first', () => {
  const rows = [EXPECTED, { name: NAME, phone: '01099998888' }];
  assert.deepEqual(validateSearch(search({ rows }), NAME, false), rows);
});

test('search preserves multiple exact-phone identities for caller disambiguation', () => {
  const rows = [EXPECTED, { name: 'Synthetic Other Member', phone: PHONE }];
  assert.deepEqual(validateSearch(search({ query: PHONE, rows }), PHONE, true), rows);
});

test('search rejects indistinguishable duplicate exact candidates after normalization', () => {
  throwsCode(() => validateSearch(search({ rows: [EXPECTED,
    { name: ` ${NAME} `, phone: '010-1234-5678' }] }), NAME, false), 'LIVE_AMBIGUOUS');
});

test('search rejects masked, missing and malformed identity fields', () => {
  for (const patch of [
    { phone: '010-****-5678' }, { phone: '010-\u2022\u2022\u2022\u2022-5678' },
    { phone: '010*12345678' }, { phone: '' }, { phone: '12345678' },
    { phone: '+82 10 1234 5678' }, { name: '' }, { name: '   ' },
  ]) {
    throwsCode(() => validateSearch(search({ rows: [{ ...EXPECTED, ...patch }] }), NAME, false),
      'LIVE_IDENTITY_MISMATCH');
  }
});

test('search does not discard an unreadable candidate to claim a complete result', () => {
  throwsCode(() => validateSearch(search({ rows: [EXPECTED,
    { name: 'Synthetic Other Member', phone: '010-****-8888' }] }), NAME, false),
  'LIVE_IDENTITY_MISMATCH');
});

test('search accepts zero only with a query-specific empty result marker', () => {
  assert.deepEqual(validateSearch(search({ rows: [], emptyQuery: ` ${NAME} ` }), NAME, false), []);
  for (const emptyQuery of [undefined, '', 'Synthetic Earlier Query']) {
    throwsCode(() => validateSearch(search({ rows: [], emptyQuery }), NAME, false), 'LIVE_INCOMPLETE');
  }
});

test('search rejects stale query, not-ready, pagination/loading and malformed row lists', () => {
  for (const patch of [{ ready: false }, { query: 'Synthetic Earlier Query' },
    { incomplete: true }, { rows: undefined }, { rows: {} }]) {
    throwsCode(() => validateSearch(search(patch), NAME, false), 'LIVE_INCOMPLETE');
  }
  throwsCode(() => validateSearch(null, NAME, false), 'LIVE_INCOMPLETE');
});

test('search accepts nine candidates and rejects ten or more without truncation', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ name: NAME, phone: `0101234${String(i).padStart(4, '0')}` }));
  assert.equal(validateSearch(search({ rows: rows.slice(0, 9) }), NAME, false).length, 9);
  for (const count of [10, 11]) {
    throwsCode(() => validateSearch(search({ rows: rows.slice(0, count) }), NAME, false), 'LIVE_INCOMPLETE');
  }
});

test('member URL accepts only the bound native detail identity', () => {
  assert.doesNotThrow(() => assertMemberUrl(MEMBER_URL, '123'));
  assert.doesNotThrow(() => assertMemberUrl(`${MEMBER_URL}&view=tickets`, '123'));
});

test('member URL rejects wrong studio, protocol, path, member and fallback IDs', () => {
  for (const url of [
    'https://other.studiomate.kr/users/detail?id=123',
    'http://arcpilates.studiomate.kr/users/detail?id=123',
    'https://arcpilates.studiomate.kr.example.invalid/users/detail?id=123',
    `${ORIGIN}/login?id=123`, `${ORIGIN}/users/detail/extra?id=123`,
    `${ORIGIN}/users/detail?id=124`, `${ORIGIN}/users/detail`,
  ]) throwsCode(() => assertMemberUrl(url, '123'), 'LIVE_IDENTITY_MISMATCH');
  for (const memberId of ['0', '0123', 'excel_123', '../123', '12345678901234567']) {
    throwsCode(() => assertMemberUrl(`${ORIGIN}/users/detail?id=${encodeURIComponent(memberId)}`, memberId),
      'LIVE_IDENTITY_MISMATCH');
  }
});

test('member URL rejects malformed and relative addresses', () => {
  for (const url of ['not a URL', '/users/detail?id=123', '']) {
    assert.throws(() => assertMemberUrl(url, '123'));
  }
});

test('overview projects parsed counts, dates and payment without inventing ticket IDs', () => {
  const result = validateOverview(overview(), EXPECTED);
  assert.deepEqual(result, { ...EXPECTED, memberGrade: 'Synthetic Grade', tickets: [{
    userTicketId: null, name: 'Synthetic Pass', status: '\uc774\uc6a9\uc911', type: COUNT_TYPE,
    remainingCount: 4, reservableCount: 3,
    availableFromDate: '2026-10-01', expiresOn: '2026-10-31',
    availableFrom: '2026-09-30T15:00:00.000Z', expiresAt: '2026-10-30T15:00:00.000Z',
    paymentAmount: 120000,
  }] });
});

test('overview accepts absent ticket IDs and never derives IDs from names or caller fields', () => {
  const rows = [ticket({ name: 'Synthetic Pass A', id: 'forged-a', userTicketId: 'forged-b' }),
    ticket({ name: 'Synthetic Pass B' })];
  const result = validateOverview(overview({ tickets: rows }), EXPECTED);
  assert.deepEqual(result.tickets.map(row => row.userTicketId), [null, null]);
  assert.ok(result.tickets.every(row => !Object.hasOwn(row, 'id')));
});

test('overview accepts a verified empty ticket list without creating a placeholder ticket', () => {
  assert.deepEqual(validateOverview(overview({ tickets: [] }), EXPECTED),
    { ...EXPECTED, memberGrade: 'Synthetic Grade', tickets: [] });
});

test('overview rejects unverified empty lists, pagination, missing sections and incomplete state', () => {
  for (const patch of [{ ready: false }, { incomplete: true }, { addCards: 0 },
    { addCards: 2 }, { addCards: undefined }, { tickets: undefined }, { tickets: {} }]) {
    throwsCode(() => validateOverview(overview({ tickets: [], ...patch }), EXPECTED), 'LIVE_INCOMPLETE');
  }
  throwsCode(() => validateOverview(null, EXPECTED), 'LIVE_INCOMPLETE');
});

test('overview checks name, full phone and grade even when there are no tickets', () => {
  for (const patch of [{ name: `${NAME} Extra` }, { name: '' }, { phone: '01092345678' },
    { phone: '010-****-5678' }, { phone: '010-\u2022\u2022\u2022\u2022-5678' },
    { phone: '010*12345678' }, { phone: '' }, { memberGrade: '' }]) {
    throwsCode(() => validateOverview(overview({ tickets: [], ...patch }), EXPECTED), 'LIVE_IDENTITY_MISMATCH');
  }
});

test('overview normalizes identity whitespace and phone formatting', () => {
  const result = validateOverview(overview({ name: ' Synthetic   Member ', memberGrade: ' Synthetic   Grade ' }),
    { name: NAME, phone: '010 1234 5678' });
  assert.equal(result.name, NAME);
  assert.equal(result.phone, PHONE);
  assert.equal(result.memberGrade, 'Synthetic Grade');
});

test('overview accepts 100 distinct cards and rejects 101 without truncation', () => {
  const tickets = Array.from({ length: 101 }, (_, i) => ticket({ name: `Synthetic Pass ${i}` }));
  assert.equal(validateOverview(overview({ tickets: tickets.slice(0, 100) }), EXPECTED).tickets.length, 100);
  throwsCode(() => validateOverview(overview({ tickets }), EXPECTED), 'LIVE_INCOMPLETE');
});

test('overview rejects identical normalized cards rather than silently deduplicating', () => {
  throwsCode(() => validateOverview(overview({ tickets: [ticket(), ticket({ name: ' Synthetic   Pass ' })] }), EXPECTED),
    'LIVE_AMBIGUOUS');
});

test('overview retains same-name cards when their visible facts differ', () => {
  const tickets = [ticket(), ticket({ counts: [{ label: REMAINING, value: '2' }] })];
  assert.equal(validateOverview(overview({ tickets }), EXPECTED).tickets.length, 2);
});

test('overview rejects missing ticket labels or malformed count collections', () => {
  for (const patch of [{ name: '' }, { status: '' }, { type: '' }, { counts: undefined }, { counts: {} }]) {
    throwsCode(() => validateOverview(overview({ tickets: [ticket(patch)] }), EXPECTED), 'LIVE_LAYOUT_CHANGED');
  }
});

test('overview accepts leap days, single-day periods and displayed period annotations', () => {
  for (const period of ['2028. 2. 29. ~ 2028. 2. 29.', '2028.2.29 ~ 2028.3.1 (Synthetic annotation)']) {
    const result = validateOverview(overview({ tickets: [ticket({ period })] }), EXPECTED).tickets[0];
    assert.equal(result.availableFromDate, '2028-02-29');
  }
});

test('overview rejects invalid, reversed, missing and unrecognized date periods', () => {
  for (const period of ['', '2026-10-01 ~ 2026-10-31', '2026. 2. 29. ~ 2026. 3. 1.',
    '2026. 4. 31. ~ 2026. 5. 1.', '2026. 13. 1. ~ 2027. 1. 1.',
    '2026. 10. 0. ~ 2026. 10. 1.', '2026. 10. 31. ~ 2026. 10. 1.',
    '2026. 10. 1.', '2026. 10. 1. ~ 2026. 10. 31. unexpected']) {
    throwsCode(() => validateOverview(overview({ tickets: [ticket({ period })] }), EXPECTED), 'LIVE_LAYOUT_CHANGED');
  }
});

test('overview preserves zero remaining and reservable counts', () => {
  const counts = [{ label: REMAINING, value: `0${TIMES}` }, { label: RESERVABLE, value: '0' }];
  const result = validateOverview(overview({ tickets: [ticket({ counts })] }), EXPECTED).tickets[0];
  assert.equal(result.remainingCount, 0);
  assert.equal(result.reservableCount, 0);
});

test('overview parses grouped and ungrouped count integers', () => {
  for (const value of ['1,234', `1,234${TIMES}`, '1234']) {
    const result = validateOverview(overview({ tickets: [ticket({ counts: [{ label: REMAINING, value }] })] }), EXPECTED);
    assert.equal(result.tickets[0].remainingCount, 1234);
  }
});

test('overview rejects duplicate count labels and invalid or unsafe count values', () => {
  const badCounts = [[{ label: REMAINING, value: '4' }, { label: ` ${REMAINING} `, value: '4' }],
    [{ label: REMAINING, value: '4' }, { label: RESERVABLE, value: '2' }, { label: RESERVABLE, value: '2' }]];
  for (const value of ['', '-1', '1.5', '1e3', '1,23', '1,,234', 'unknown', '9007199254740992']) {
    badCounts.push([{ label: REMAINING, value }]);
  }
  for (const counts of badCounts) {
    throwsCode(() => validateOverview(overview({ tickets: [ticket({ counts })] }), EXPECTED), 'LIVE_LAYOUT_CHANGED');
  }
});

test('overview requires remaining count for count-based tickets without defaulting missing to zero', () => {
  throwsCode(() => validateOverview(overview({ tickets: [ticket({ counts: [] })] }), EXPECTED), 'LIVE_LAYOUT_CHANGED');
  const result = validateOverview(overview({ tickets: [ticket({ counts: [{ label: REMAINING, value: '4' }] })] }), EXPECTED);
  assert.equal(result.tickets[0].reservableCount, null);
});

test('overview permits missing counts on period-based tickets as unknown rather than zero', () => {
  const result = validateOverview(overview({ tickets: [ticket({ type: PERIOD_TYPE, counts: [] })] }), EXPECTED).tickets[0];
  assert.equal(result.remainingCount, null);
  assert.equal(result.reservableCount, null);
});

test('overview preserves zero payment and missing payment as distinct values', () => {
  for (const [payment, expected] of [[`${PAYMENT_LABEL} 0${WON}`, 0], ['', null], [undefined, null]]) {
    const result = validateOverview(overview({ tickets: [ticket({ payment })] }), EXPECTED).tickets[0];
    assert.equal(result.paymentAmount, expected);
  }
});

test('overview rejects unsafe payment integers', () => {
  throwsCode(() => validateOverview(overview({ tickets: [ticket({ payment: `${PAYMENT_LABEL} 9007199254740992${WON}` })] }),
    EXPECTED), 'LIVE_LAYOUT_CHANGED');
});

test('overview rejects malformed grouped counts instead of silently stripping commas', () => {
  const counts = [{ label: REMAINING, value: `1234,567${TIMES}` }];
  throwsCode(() => validateOverview(overview({ tickets: [ticket({ counts })] }), EXPECTED), 'LIVE_LAYOUT_CHANGED');
});

test('overview rejects malformed grouped payment instead of silently stripping commas', () => {
  for (const value of ['1,,000', '12,34', '1234,567', '1,000,']) {
    throwsCode(() => validateOverview(overview({ tickets: [ticket({ payment: `${PAYMENT_LABEL} ${value}${WON}` })] }),
      EXPECTED), 'LIVE_LAYOUT_CHANGED');
  }
});

test('validators do not mutate synthetic inputs', () => {
  const searchRaw = search(), overviewRaw = overview();
  const beforeSearch = structuredClone(searchRaw), beforeOverview = structuredClone(overviewRaw);
  validateSearch(searchRaw, NAME, false);
  validateOverview(overviewRaw, EXPECTED);
  assert.deepEqual(searchRaw, beforeSearch);
  assert.deepEqual(overviewRaw, beforeOverview);
});
