import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as policy from '../lib/instructor-signup-profile-v2-policy.mjs';
import {
  normalizeSignupBirthDateV2, normalizeSignupAddressV2,
  decideSignupProfileFieldV2,
} from '../lib/instructor-signup-profile-v2-policy.mjs';

const NOW = new Date('2026-10-30T03:00:00.000Z');
const ADDRESS = '서울특별시 강남구 테헤란로 123 합성빌딩 704호';
beforeEach(t => t.mock.method(globalThis, 'fetch', () => assert.fail('No live calls permitted')));

for (const [raw, value] of [['19900102', '1990-01-02'], ['1990-1-2', '1990-01-02'],
  ['1990 / 1 / 2', '1990-01-02'], ['1990.01.02', '1990-01-02'], ['1990년 1월 2일', '1990-01-02'],
  ['2000-02-29', '2000-02-29'], ['1920-01-02', '1920-01-02']]) {
  test('strict four-year DOB accepts ' + raw, () => assert.deepEqual(normalizeSignupBirthDateV2(raw, NOW), { status: 'verified', value }));
}
for (const raw of [null, undefined, '', ' \t\n', '\u00a0']) {
  test('empty DOB is not_provided ' + JSON.stringify(raw), () => assert.deepEqual(normalizeSignupBirthDateV2(raw, NOW), { status: 'not_provided', value: '' }));
}
for (const raw of ['900102', '000229', '010203', '1990-02-29', '1900-02-29', '2001-02-30', '1990-13-01',
  '1990-01-00', '01/02/1990', '1990-01/02', '1990년1월2', '1990-01-02 extra', '90-01-02',
  '2026-10-30', '2026-10-31', '0000-01-01', 'unknown', 19900102, {}, []]) {
  test('DOB requires review without guessing ' + JSON.stringify(raw), () => assert.equal(normalizeSignupBirthDateV2(raw, NOW).status, 'review'));
}
test('six-digit DOB explicitly reports unverified century', () => {
  assert.equal(normalizeSignupBirthDateV2('900102', NOW).reason, 'birth_date_century_unverified');
});
test('DOB uses a strict past Korean calendar date and handles invalid clocks independently', () => {
  const midnight = new Date('2026-10-29T15:00:00Z');
  assert.equal(normalizeSignupBirthDateV2('2026-10-29', midnight).status, 'verified');
  assert.equal(normalizeSignupBirthDateV2('2026-10-30', midnight).status, 'review');
  assert.equal(normalizeSignupBirthDateV2('19900102', new Date('invalid')).status, 'review');
  assert.equal(normalizeSignupAddressV2(ADDRESS).status, 'verified');
});

for (const address of [ADDRESS, '부산광역시 강서구 명지국제2로28번길 34 합성빌딩 704호',
  '경기도 성남시 분당구 정자동 123-4', '세종특별자치시 한누리대로 2130', '제주특별자치도 제주시 중앙로 1',
  '대한민국 서울특별시 강남구 테헤란로 123 (역삼동)']) {
  test('Korean supplied address is retained without filling missing parts: ' + address, () => {
    assert.deepEqual(normalizeSignupAddressV2(address), { status: 'verified', value: address });
  });
}
test('address composes Unicode and normalizes whitespace/number width without adding content', () => {
  const input = '  서울특별시\u00a0강남구\t테헤란로 １２３\n합성빌딩 704호  '.normalize('NFD');
  assert.equal(normalizeSignupAddressV2(input).value, ADDRESS);
});
for (const raw of [null, undefined, '', ' \n']) test('missing address is not_provided ' + JSON.stringify(raw), () => {
  assert.deepEqual(normalizeSignupAddressV2(raw), { status: 'not_provided', value: '' });
});
for (const raw of ['없음', '미기재', 'N/A', '주소를 입력해주세요', '상세주소', '-', '서울특별시 강남구',
  '서울특별시 123', '테헤란로 123', '123 Main Street, New York, USA', 'Seoul Gangnam-gu Teheran-ro 123',
  '서울특별시 강남구 테헤란로 123 상세주소', ADDRESS + '\u202e', ADDRESS + '\u0000', 123, {}, []]) {
  test('invalid/non-Korean/incomplete address is review ' + JSON.stringify(raw), () => assert.equal(normalizeSignupAddressV2(raw).status, 'review'));
}

test('field decisions cover every state without throwing or clearing existing values', () => {
  const decide = (current, expected) => decideSignupProfileFieldV2({ field: 'birthDate', current, expected, now: NOW });
  assert.equal(decide('', '19900102'), 'write');
  assert.equal(decide('1990-01-02', '19900102'), 'already_equal');
  assert.equal(decide('1989-01-02', '19900102'), 'conflict');
  assert.equal(decide('1989-01-02', ''), 'not_provided');
  assert.equal(decide('900102', '19900102'), 'review');
  assert.equal(decide('', '900102'), 'write');
  assert.equal(decideSignupProfileFieldV2({ field: 'address', current: ADDRESS, expected: '' }), 'not_provided');
  assert.equal(decideSignupProfileFieldV2({ field: 'address', current: '미기재', expected: ADDRESS }), 'review');
  assert.equal(decideSignupProfileFieldV2({ field: 'address', current: ADDRESS, expected: ADDRESS.replace('123', '124') }), 'conflict');
  assert.equal(decideSignupProfileFieldV2({ field: 'address', current: ADDRESS, expected: ' ' + ADDRESS + ' ' }), 'already_equal');
  assert.equal(decideSignupProfileFieldV2({ field: 'unknown' }), 'review');
});

const resolution = (value, source, now = NOW) => ({ status: 'verified', value,
  resolution: { policy: 'yy_kst_current_year_v1', referenceAt: now.toISOString(), source } });
function resolve(expected, current = '', now = NOW) {
  assert.equal(typeof policy.resolveSignupBirthDateV2, 'function', 'New prospective DOB resolver must be exported');
  return policy.resolveSignupBirthDateV2({ expected, current, now });
}

for (const [raw, value] of [
  ['000102', '2000-01-02'], ['260102', '2026-01-02'], ['270102', '1927-01-02'], ['990102', '1999-01-02'],
]) test('prospective blank-native cutoff at KST year 2026: ' + raw, () => {
  const now = new Date(NOW), before = now.toISOString();
  assert.deepEqual(resolve(raw, '', now), resolution(value, 'current_year_rule', now));
  assert.equal(decideSignupProfileFieldV2({ field: 'birthDate', expected: raw, current: '', now }), 'write');
  assert.equal(now.toISOString(), before, 'Resolution must not mutate the shared clock');
  assert.equal(normalizeSignupBirthDateV2(raw, now).status, 'review', 'Legacy/native normalization stays strict');
});

test('all two-digit years use the approved current-KST-year cutoff, not an age heuristic', () => {
  for (let yy = 0; yy <= 99; yy++) {
    const raw = String(yy).padStart(2, '0') + '0102';
    const year = (yy <= 26 ? 2000 : 1900) + yy;
    assert.deepEqual(resolve(raw), resolution(`${year}-01-02`, 'current_year_rule'), raw);
  }
});

test('cutoff follows Korean New Year, even while UTC is still in the preceding year', () => {
  const before = new Date('2026-12-31T14:59:59.999Z');
  const midnight = new Date('2026-12-31T15:00:00.000Z');
  const nextDay = new Date('2027-01-01T15:00:00.000Z');
  assert.deepEqual(resolve('270101', '', before), resolution('1927-01-01', 'current_year_rule', before));
  assert.equal(resolve('270101', '', midnight).status, 'review', 'Today is never an accepted DOB');
  assert.equal(resolve('271231', '', midnight).status, 'review', 'No fallback to 1927 for a future 2027 date');
  assert.deepEqual(resolve('270101', '', nextDay), resolution('2027-01-01', 'current_year_rule', nextDay));
});

for (const current of ['1920-01-02', '2020-01-02', '19200102', '2020 / 1 / 2']) {
  test('verified native century wins over prospective inference: ' + current, () => {
    const value = current.startsWith('1920') ? '1920-01-02' : '2020-01-02';
    assert.deepEqual(resolve('200102', current), resolution(value, 'native_full_match'));
    assert.equal(decideSignupProfileFieldV2({ field: 'birthDate', expected: '200102', current, now: NOW }), 'already_equal');
  });
}

test('valid native suffix match can preserve 1926 rather than the otherwise inferred 2026', () => {
  assert.deepEqual(resolve('261031', '1926-10-31'), resolution('1926-10-31', 'native_full_match'));
  assert.equal(resolve('261031').status, 'review');
  assert.equal(decideSignupProfileFieldV2({ field: 'birthDate', expected: '261031', current: '1926-10-31', now: NOW }), 'already_equal');
});

test('leap-day resolution accepts 2000 but never treats 1900 as a verified native date', () => {
  assert.deepEqual(resolve('000229'), resolution('2000-02-29', 'current_year_rule'));
  assert.deepEqual(resolve('000229', '2000-02-29'), resolution('2000-02-29', 'native_full_match'));
  assert.equal(normalizeSignupBirthDateV2('1900-02-29', NOW).status, 'review');
  assert.equal(decideSignupProfileFieldV2({ field: 'birthDate', expected: '000229', current: '1900-02-29', now: NOW }), 'review');
  for (const raw of ['010229', '990229', '260229']) assert.equal(resolve(raw).status, 'review', raw);
});

for (const raw of ['000000', '001300', '000100', '000230', '261030', '261031', '261231',
  '90-01-02', '90/01/02', '90010', '9001020', '900102 trailing', '9e0102', '９００１０２',
  '900102\u0000', 900102, 102, 229, 0, false, {}, [], ['900102']]) {
  test('prospective resolver never guesses invalid, numeric or zero-lost input: ' + JSON.stringify(raw), () => {
    const wanted = resolve(raw);
    assert.equal(wanted.status, 'review');
    assert.notEqual(wanted.status, 'verified');
    assert.equal(decideSignupProfileFieldV2({ field: 'birthDate', expected: raw, current: '', now: NOW }), 'review');
  });
}

test('six digits retain leading zeros only when provided as a string', () => {
  assert.deepEqual(resolve('010203'), resolution('2001-02-03', 'current_year_rule'));
  assert.equal(resolve(Number('010203')).status, 'review');
  assert.equal(resolve(Number('000229')).status, 'review');
});

for (const current of ['200102', '20-01-02', '2020-02-30', '2026-10-30', '2026-10-31',
  'not a date', 20200102, 0, {}, []]) {
  test('nonempty native DOB must parse strictly and is never eligible for write: ' + JSON.stringify(current), () => {
    const decision = decideSignupProfileFieldV2({ field: 'birthDate', expected: '200102', current, now: NOW });
    assert.equal(decision, 'review');
  });
}

for (const current of ['1920-01-03', '2020-01-03', '1990-01-02']) {
  test('true nonempty native mismatch is a conflict, not a blank-only write: ' + current, () => {
    assert.equal(decideSignupProfileFieldV2({ field: 'birthDate', expected: '200102', current, now: NOW }), 'conflict');
  });
}

test('full-year and missing signed inputs retain existing normalization results without inference metadata', () => {
  for (const expected of [undefined, null, '', ' \t', '19900102', '1920-01-02', '1900-02-29', '2026-10-30']) {
    assert.deepEqual(resolve(expected), normalizeSignupBirthDateV2(expected, NOW));
  }
  assert.equal(resolve('900102', '', new Date('invalid')).status, 'review');
  assert.equal(resolve('900102', '1990-01-02', new Date('invalid')).status, 'review');
});
test('DOB conflict or century review never blocks independently writable address, and vice versa', () => {
  for (const current of ['1989-01-02', '900102']) {
    assert(['conflict', 'review'].includes(decideSignupProfileFieldV2({ field: 'birthDate', current, expected: '19900102', now: NOW })));
    assert.equal(decideSignupProfileFieldV2({ field: 'address', current: '', expected: ADDRESS }), 'write');
  }
  assert.equal(decideSignupProfileFieldV2({ field: 'address', current: ADDRESS, expected: ADDRESS.replace('123', '124') }), 'conflict');
  assert.equal(decideSignupProfileFieldV2({ field: 'birthDate', current: '', expected: '19900102', now: NOW }), 'write');
});
