import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
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
  assert.equal(decide('', '900102'), 'review');
  assert.equal(decideSignupProfileFieldV2({ field: 'address', current: ADDRESS, expected: '' }), 'not_provided');
  assert.equal(decideSignupProfileFieldV2({ field: 'address', current: '미기재', expected: ADDRESS }), 'review');
  assert.equal(decideSignupProfileFieldV2({ field: 'address', current: ADDRESS, expected: ADDRESS.replace('123', '124') }), 'conflict');
  assert.equal(decideSignupProfileFieldV2({ field: 'address', current: ADDRESS, expected: ' ' + ADDRESS + ' ' }), 'already_equal');
  assert.equal(decideSignupProfileFieldV2({ field: 'unknown' }), 'review');
});
test('DOB conflict or century review never blocks independently writable address, and vice versa', () => {
  for (const current of ['1989-01-02', '900102']) {
    assert(['conflict', 'review'].includes(decideSignupProfileFieldV2({ field: 'birthDate', current, expected: '19900102', now: NOW })));
    assert.equal(decideSignupProfileFieldV2({ field: 'address', current: '', expected: ADDRESS }), 'write');
  }
  assert.equal(decideSignupProfileFieldV2({ field: 'address', current: ADDRESS, expected: ADDRESS.replace('123', '124') }), 'conflict');
  assert.equal(decideSignupProfileFieldV2({ field: 'birthDate', current: '', expected: '19900102', now: NOW }), 'write');
});
