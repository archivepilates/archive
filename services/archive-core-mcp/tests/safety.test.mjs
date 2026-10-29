import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CoreError, bounded, canonical, hash, identifier, memberWindow, publicResult, rejectSecrets } from '../src/safety.mjs';

const forbidden = error => error instanceof CoreError && error.code === 'FORBIDDEN_FIELD' && error.safe === true;
const secretKeys = ['password', 'pinHash', 'pinSalt', 'tempCode', 'accessToken', 'refreshToken',
  'idToken', 'Authorization', 'apiKey', 'clientSecret', 'privateKey', 'credentials', 'tokenHash', 'token'];
const alternateSecretKeys = ['private_key', 'api_key', 'pin_hash', 'pin_salt', 'temp_code', 'token_hash'];

test('secret parameters are forbidden recursively, including array entries', async t => {
  for (const key of secretKeys) await t.test(key, () => {
    assert.throws(() => rejectSecrets({ items: [{ nested: { [key]: 'FAKE_SECRET_ONLY' } }] }), forbidden);
  });
});

test('prototype-pollution keys are forbidden at every depth', async t => {
  for (const key of ['__proto__', 'prototype', 'constructor']) await t.test(key, () => {
    const input = JSON.parse(`{"items":[{"${key}":{"polluted":true}}]}`);
    assert.throws(() => rejectSecrets(input), forbidden);
    assert.equal({}.polluted, undefined);
  });
});

test('alternate credential key spellings must also be forbidden', async t => {
  for (const key of alternateSecretKeys) await t.test(key, () => {
    assert.throws(() => rejectSecrets({ nested: { [key]: 'FAKE_SECRET_ONLY' } }), forbidden);
  });
});

test('ordinary source identifiers and business parameters remain usable', () => {
  assert.doesNotThrow(() => rejectSecrets({ staffId: 'fake-owner', studioId: '5330',
    action: 'review', items: [{ bookingId: 'fake-booking', count: 2 }], note: null }));
  let deep = {};
  for (let i = 0; i < 17; i++) deep = { nested: deep };
  assert.throws(() => rejectSecrets(deep), { code: 'INVALID_ARGUMENT' });
});

test('credentials never appear in public or review results', async t => {
  for (const review of [false, true]) await t.test(`review=${review}`, () => {
    const input = { id: 'fake-record', nested: Object.fromEntries(secretKeys.map(key => [key, 'FAKE_SECRET_ONLY'])) };
    assert.deepEqual(publicResult(input, { review }), { id: 'fake-record', nested: {} });
    assert.equal(input.nested.password, 'FAKE_SECRET_ONLY');
  });
});

test('alternate credential key spellings must also be redacted', async t => {
  for (const key of alternateSecretKeys) await t.test(key, () => {
    for (const review of [false, true]) {
      assert.deepEqual(publicResult({ nested: { [key]: 'FAKE_SECRET_ONLY' } }, { review }), { nested: {} });
    }
  });
});

test('public results omit health and payload details; review never reveals credentials', () => {
  const input = { id: 'fake-record', answers: { goal: 'synthetic' }, health: 'synthetic',
    payload: { secret: 'FAKE_SECRET_ONLY', phone: '010-0000-0000' } };
  assert.deepEqual(publicResult(input), { id: 'fake-record' });
  assert.deepEqual(publicResult(input, { review: true }), { id: 'fake-record', answers: { goal: 'synthetic' },
    health: 'synthetic', payload: { phone: '***-****-0000' } });
});

test('URL credentials and secret query parameters are removed without following URLs', async t => {
  for (const key of ['token', 'access_token', 'refreshToken', 'apiKey', 'r', 't', 'key', '%74oken']) {
    await t.test(key, () => {
      assert.equal(publicResult(`https://example.invalid/path?${key}=FAKE_SECRET_ONLY&view=1#private`),
        'https://example.invalid/path?[private]');
    });
  }
  assert.equal(publicResult('https://fake-user:FAKE_SECRET_ONLY@example.invalid/path?view=1'),
    'https://example.invalid/path?[private]');
  assert.equal(publicResult('https://example.invalid/path?view=1'), 'https://example.invalid/path?view=1');
});

test('URL query redaction must cover snake-case API keys and case-insensitive schemes', async t => {
  for (const url of ['https://example.invalid/path?api_key=FAKE_SECRET_ONLY',
    'HTTPS://example.invalid/path?token=FAKE_SECRET_ONLY']) await t.test(url, () => {
    assert.doesNotMatch(publicResult(url), /FAKE_SECRET_ONLY/);
  });
});

test('JWTs with both long and short headers are redacted in arbitrary strings', async t => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const [label, header] of [['long JWT header', { alg: 'HS256', typ: 'JWT' }],
    ['short JWT header', { alg: 'RS256' }]]) await t.test(label, () => {
    const fakeJwt = `${encode(header)}.${encode({ sub: 'fake-subject' })}.FAKE_SIGNATURE_ONLY`;
    assert.equal(publicResult(`diagnostic: ${fakeJwt}`), '[redacted]');
  });
});

test('private key material and data URLs are always redacted, including review mode', () => {
  for (const review of [false, true]) {
    assert.equal(publicResult('-----BEGIN PRIVATE KEY-----FAKE_ONLY', { review }), '[redacted]');
    assert.equal(publicResult('data:text/plain;base64,RkFLRQ==', { review }), '[redacted]');
  }
});

test('Korean phone numbers are masked in nested strings and arrays', () => {
  for (const phone of ['010-0000-0000', '01000000000', '010 0000 0000', '+82 10-0000-0000', '011-000-0000']) {
    assert.deepEqual(publicResult({ note: `phone ${phone}`, items: [phone] }),
      { note: 'phone ***-****-0000', items: ['***-****-0000'] });
  }
});

test('secret-query URL redaction must not bypass phone masking in the path', () => {
  const output = publicResult('https://example.invalid/member/010-0000-0000?token=FAKE_SECRET_ONLY');
  assert.doesNotMatch(output, /010-0000-0000|FAKE_SECRET_ONLY/);
});

test('public results drop dangerous prototype keys and bound output size/depth', () => {
  const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":"fake","prototype":"fake","id":"ok"}');
  assert.deepEqual(publicResult(input), { id: 'ok' });
  assert.equal({}.polluted, undefined);
  assert.equal(publicResult('x'.repeat(13000)).length, 12000);
  assert.equal(publicResult(Array.from({ length: 120 }, (_, i) => i)).length, 100);
  let deep = 'end';
  for (let i = 0; i < 14; i++) deep = { nested: deep };
  assert.match(JSON.stringify(publicResult(deep)), /\[bounded\]/);
});

test('canonical binding hashes are stable across object key order, not identity changes', () => {
  assert.equal(canonical({ b: [2, 1], a: { z: true } }), canonical({ a: { z: true }, b: [2, 1] }));
  assert.equal(hash({ uid: 'fake', studioId: '5330' }), hash({ studioId: '5330', uid: 'fake' }));
  assert.notEqual(hash({ uid: 'fake' }), hash({ uid: 'other' }));
});
test('phone-like digits inside opaque hashes cannot corrupt plan confirmations or IDs', () => {
  const digest = 'a'.repeat(20) + '01012345678' + 'b'.repeat(33);
  assert.equal(digest.length, 64);
  assert.equal(publicResult(digest), digest);
  assert.equal(publicResult('saveDraft:' + digest), 'saveDraft:' + digest);
  assert.equal(publicResult('holding_notice_' + digest), 'holding_notice_' + digest);
  assert.equal(publicResult('전화 01012345678'), '전화 ***-****-5678');
});

test('identifier validation rejects URL/path injection', () => {
  assert.equal(identifier('fake_Record-123'), 'fake_Record-123');
  for (const value of ['', '../admin', 'https://example.invalid', 'x?token=fake', 'x/y', 'x'.repeat(161), null]) {
    assert.throws(() => identifier(value), { code: 'INVALID_ARGUMENT' });
  }
});

test('member communication window is exactly [09:00, 23:00) KST', () => {
  for (const [time, expected] of [['08:59:59', false], ['09:00:00', true], ['22:59:59', true],
    ['23:00:00', false], ['00:00:00', false]]) {
    assert.equal(memberWindow(Date.parse(`2026-01-01T${time}+09:00`)), expected, time);
  }
});

test('payload bounds count UTF-8 bytes rather than just characters', () => {
  assert.deepEqual(bounded({ id: 'fake' }, 13), { id: 'fake' });
  assert.throws(() => bounded('\uAC00'.repeat(3), 10), { code: 'INPUT_TOO_LARGE' });
});
