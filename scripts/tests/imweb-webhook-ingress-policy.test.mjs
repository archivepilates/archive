import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  IMWEB_APP_CODE, IMWEB_SITE_CODE, IMWEB_UNIT_CODE, MAX_PAYLOAD_BYTES, MAX_EVENT_ITEMS, EVENT_ROUTES,
  sha256, payloadDigest, verifySecretDigest, normalizeEvent, deliveryReceiptKey,
} from '../lib/imweb-webhook-ingress-policy.mjs';

const SIGNUP = EVENT_ROUTES.signup;
const fixture = (extra = {}) => ({
  siteCode: IMWEB_SITE_CODE, unitCode: IMWEB_UNIT_CODE,
  memberUid: 'synthetic-member@example.invalid', ...extra,
});
const bulkFixture = (extra = {}) => ({
  siteCode: IMWEB_SITE_CODE, unitCode: IMWEB_UNIT_CODE,
  memberUidList: ['synthetic-one@example.invalid', 'synthetic-two@example.invalid'], ...extra,
});
const gradeFixture = (extra = {}) => fixture({
  gradeCodes: ['g20250124563854a652d54', 'g20250124563844c752d51'], ...extra,
});
const rejects = (fn, code) => assert.throws(fn, error => error.code === code && error.message === code);

test('fixed target and immutable route map do not contain schema guesses', () => {
  assert.equal(IMWEB_APP_CODE, 'ga202609279410fb87e608a');
  assert.equal(IMWEB_SITE_CODE, 'S20260516852c71a014d08');
  assert.equal(IMWEB_UNIT_CODE, 'u2026051698c99ea234719');
  assert.equal(MAX_PAYLOAD_BYTES, 65536);
  assert.equal(MAX_EVENT_ITEMS, 50);
  assert.deepEqual(EVENT_ROUTES, { signup: 'END_USER_SIGN_UP',
    'signup-bulk': 'END_USER_SIGN_UP_BULK', grade: 'END_USER_GRADE_UPDATE' });
  assert.throws(() => { EVENT_ROUTES.grade = SIGNUP; }, TypeError);
});

test('SHA256 matches known vectors for exact strings and bytes', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256('abc'), sha256(Buffer.from('abc')));
  assert.notEqual(sha256('abc'), sha256(' abc'));
});

test('hash input is not implicitly coerced', () => {
  for (const value of [null, undefined, 1, {}, [], new String('abc')]) {
    rejects(() => sha256(value), 'invalid_hash_input');
  }
});

test('exact synthetic secret authenticates; digest is not itself a secret', () => {
  const secret = 'synthetic-secret-only';
  const digest = sha256(secret);
  assert.equal(verifySecretDigest(secret, digest), true);
  assert.equal(verifySecretDigest(digest, digest), false);
  for (const value of ['wrong', ` ${secret}`, `${secret} `, secret.toUpperCase(), `Bearer ${secret}`]) {
    assert.equal(verifySecretDigest(value, digest), false);
  }
});

test('unauthorized missing, repeated or non-string headers fail closed', () => {
  for (const header of [undefined, null, '', [], ['synthetic'], {}, 123, Buffer.from('synthetic')]) {
    assert.equal(verifySecretDigest(header, sha256('synthetic')), false);
  }
  assert.equal(verifySecretDigest('x'.repeat(MAX_PAYLOAD_BYTES + 1), sha256('x')), false);
});

test('missing or malformed configured secret digests fail without echoing inputs', () => {
  for (const digest of [undefined, null, '', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65),
    sha256('synthetic').toUpperCase(), Buffer.alloc(32), {}]) {
    assert.equal(verifySecretDigest('synthetic', digest), false);
  }
});

test('ill-formed secret strings cannot authenticate by UTF8 replacement collisions', () => {
  assert.equal(verifySecretDigest('\ud800', sha256('\ufffd')), false);
});

test('signup yields a lookup hint, never a permission grant or inferred member code', () => {
  const body = Object.freeze(fixture());
  assert.deepEqual(normalizeEvent(body, SIGNUP), {
    appCode: IMWEB_APP_CODE, eventType: SIGNUP, siteCode: IMWEB_SITE_CODE,
    unitCode: IMWEB_UNIT_CODE, memberUid: body.memberUid,
    memberUidSha256: sha256(body.memberUid), payloadSha256: payloadDigest(body),
    hint: 'member_lookup_required', grantsAccess: false,
  });
});

test('object, serialized JSON and UTF8 buffer normalize identically', () => {
  const body = fixture();
  assert.deepEqual(normalizeEvent(JSON.stringify(body), SIGNUP), normalizeEvent(body, SIGNUP));
  assert.deepEqual(normalizeEvent(Buffer.from(JSON.stringify(body)), SIGNUP), normalizeEvent(body, SIGNUP));
});

test('opaque identity case is preserved, not treated as a canonical email/member id', () => {
  const body = fixture({ memberUid: 'Synthetic-Case@example.invalid' });
  assert.equal(normalizeEvent(body, SIGNUP).memberUid, body.memberUid);
  assert.notEqual(payloadDigest(body), payloadDigest(fixture({ memberUid: body.memberUid.toLowerCase() })));
});

test('wrong and missing site/unit are rejected without coercion', () => {
  for (const siteCode of ['synthetic-other-site', undefined, null, 1, [IMWEB_SITE_CODE]]) {
    rejects(() => normalizeEvent(fixture({ siteCode }), SIGNUP),
      siteCode === undefined ? 'invalid_payload' : 'site_mismatch');
  }
  for (const unitCode of ['synthetic-other-unit', undefined, null, 1, [IMWEB_UNIT_CODE]]) {
    rejects(() => normalizeEvent(fixture({ unitCode }), SIGNUP),
      unitCode === undefined ? 'invalid_payload' : 'unit_mismatch');
  }
  const missing = fixture();
  delete missing.siteCode;
  rejects(() => normalizeEvent(missing, SIGNUP), 'site_mismatch');
  delete missing.unitCode;
  missing.siteCode = IMWEB_SITE_CODE;
  rejects(() => normalizeEvent(missing, SIGNUP), 'unit_mismatch');
});

test('official synthetic portal sample is never accepted as production scope', () => {
  const sample = { siteCode: 'S2025012450f7813d2ddau',
    unitCode: 'u2025012465b0fbe8ce0dy', memberUid: 'test_member@imweb.me' };
  rejects(() => normalizeEvent(sample, SIGNUP), 'site_mismatch');
  rejects(() => deliveryReceiptKey(sample, SIGNUP), 'site_mismatch');
});

test('missing identity and additional signup fields fail strict schema', () => {
  const missing = fixture();
  delete missing.memberUid;
  rejects(() => normalizeEvent(missing, SIGNUP), 'invalid_schema');
  for (const extra of [{ grade: 'synthetic' }, { memberCode: 'synthetic' }, { grant: true },
    { eventType: EVENT_ROUTES.grade }, { members: [] }]) {
    rejects(() => normalizeEvent(fixture(extra), SIGNUP), 'invalid_schema');
  }
});

test('bad identity types and empty, whitespace, control or oversized identifiers fail', () => {
  for (const memberUid of [null, 0, true, [], {}, '', ' ', ' padded', 'padded ', 'a b',
    'a\nb', 'a\u0000b', 'a\u200bb', '\ud800', 'x'.repeat(257)]) {
    rejects(() => normalizeEvent(fixture({ memberUid }), SIGNUP), 'invalid_member_uid');
  }
  rejects(() => normalizeEvent(fixture({ memberUid: undefined }), SIGNUP), 'invalid_payload');
  assert.equal(normalizeEvent(fixture({ memberUid: 'x'.repeat(256) }), SIGNUP).memberUid.length, 256);
});

test('unknown event types and route names are not event aliases', () => {
  for (const event of [undefined, null, 1, {}, 'signup', 'END_USER_DELETE', `${SIGNUP} `]) {
    rejects(() => normalizeEvent(fixture(), event), 'unsupported_event');
    rejects(() => deliveryReceiptKey(fixture(), event), 'unsupported_event');
  }
});

test('bulk signup requires the observed memberUidList, not guessed aliases', () => {
  for (const body of [fixture(), fixture({ members: [fixture()] }), fixture({ memberUids: ['synthetic'] })]) {
    rejects(() => normalizeEvent(body, EVENT_ROUTES['signup-bulk']), 'invalid_schema');
  }
});

test('grade requires the observed gradeCodes list, not guessed fields or grants', () => {
  for (const body of [fixture(), fixture({ grade: 'synthetic-grade' }), fixture({ grantsAccess: true })]) {
    rejects(() => normalizeEvent(body, EVENT_ROUTES.grade), 'invalid_schema');
  }
});

test('bulk normalizes observed schema to unique lookup-only identities without mutation', () => {
  const body = bulkFixture();
  body.memberUidList.push(body.memberUidList[0]);
  Object.freeze(body.memberUidList);
  Object.freeze(body);
  const result = normalizeEvent(body, EVENT_ROUTES['signup-bulk']);
  assert.deepEqual(result.memberUidList, body.memberUidList.slice(0, 2));
  assert.deepEqual(result.memberUidSha256List, result.memberUidList.map(sha256));
  assert.equal(result.memberUid, undefined);
  assert.equal(result.grantsAccess, false);
  assert.equal(result.hint, 'member_lookup_required');
  assert.equal(body.memberUidList.length, 3);
});

test('bulk max50 limit applies before dedupe; empty, non-array and oversized lists fail', () => {
  const event = EVENT_ROUTES['signup-bulk'];
  const fifty = Array.from({ length: 50 }, (_, index) => `synthetic-${index}@example.invalid`);
  assert.equal(normalizeEvent(bulkFixture({ memberUidList: fifty }), event).memberUidList.length, 50);
  for (const memberUidList of [[], null, 'synthetic', {}, Array(51).fill('synthetic')]) {
    rejects(() => normalizeEvent(bulkFixture({ memberUidList }), event), 'invalid_member_uid_list');
  }
  for (const uid of ['', null, {}, 1, ' padded', 'a\nb', 'x'.repeat(257)]) {
    rejects(() => normalizeEvent(bulkFixture({ memberUidList: ['synthetic-valid', uid] }), event),
      'invalid_member_uid');
  }
});

test('grade codes are native, deduped advisory values and never current authority', () => {
  const body = gradeFixture();
  body.gradeCodes.push(body.gradeCodes[0]);
  const before = structuredClone(body);
  const result = normalizeEvent(body, EVENT_ROUTES.grade);
  assert.deepEqual(result.gradeCodes, body.gradeCodes.slice(0, 2));
  assert.equal(result.gradeCodesAuthoritative, false);
  assert.equal(result.hint, 'member_lookup_required');
  assert.equal(result.memberUid, body.memberUid);
  assert.equal(result.grantsAccess, false);
  assert.deepEqual(body, before);
});

test('an empty grade list still requires lookup, not permission revocation', () => {
  const result = normalizeEvent(gradeFixture({ gradeCodes: [] }), EVENT_ROUTES.grade);
  assert.deepEqual(result.gradeCodes, []);
  assert.equal(result.gradeCodesAuthoritative, false);
  assert.equal(result.grantsAccess, false);
  assert.equal(result.hint, 'member_lookup_required');
});

test('grade list max50 limit applies before dedupe and rejects non-arrays', () => {
  const fifty = Array.from({ length: 50 }, (_, index) => `g${index.toString(16).padStart(21, '0')}`);
  assert.equal(normalizeEvent(gradeFixture({ gradeCodes: fifty }), EVENT_ROUTES.grade).gradeCodes.length, 50);
  for (const gradeCodes of [null, {}, 'g20250124563854a652d54', Array(51).fill(fifty[0])]) {
    rejects(() => normalizeEvent(gradeFixture({ gradeCodes }), EVENT_ROUTES.grade), 'invalid_grade_codes');
  }
});

test('grade rejects malformed codes, group identifiers and implicit conversions', () => {
  for (const code of [null, 1, {}, [], '', 'STAFF', 'staff-group', 'G20250124563854a652d54',
    'g20250124563854a652d5', 'g20250124563854a652d540', 'g20250124563854a652d5z',
    ' g20250124563854a652d54', 'g20250124563854a652d54\n']) {
    rejects(() => normalizeEvent(gradeFixture({ gradeCodes: [code] }), EVENT_ROUTES.grade),
      'invalid_grade_code');
  }
  rejects(() => normalizeEvent(gradeFixture({ memberUid: null }), EVENT_ROUTES.grade), 'invalid_member_uid');
});

test('bulk and grade enforce exact schemas and production scope', () => {
  for (const [make, event] of [[bulkFixture, EVENT_ROUTES['signup-bulk']], [gradeFixture, EVENT_ROUTES.grade]]) {
    rejects(() => normalizeEvent(make({ grantsAccess: true }), event), 'invalid_schema');
    rejects(() => normalizeEvent(make({ siteCode: 'S2025012450f7813d2ddau' }), event), 'site_mismatch');
    rejects(() => normalizeEvent(make({ unitCode: 'u2025012465b0fbe8ce0dy' }), event), 'unit_mismatch');
    rejects(() => normalizeEvent(make({ note: 'x'.repeat(MAX_PAYLOAD_BYTES) }), event), 'payload_too_large');
    const body = make();
    assert.deepEqual(normalizeEvent(JSON.stringify(body), event), normalizeEvent(body, event));
  }
});

test('observed bulk and grade samples retain provider test scope and are rejected in production', () => {
  const scope = { siteCode: 'S2025012450f7813d2ddau', unitCode: 'u2025012465b0fbe8ce0dy' };
  const bulk = { ...scope, memberUidList: ['test_member1@imweb.me', 'test_member2@imweb.me',
    'test_member3@imweb.me'] };
  const grade = { ...scope, memberUid: 'test_member@imweb.me',
    gradeCodes: ['g20250124563854a652d54', 'g20250124563844c752d51'] };
  rejects(() => normalizeEvent(bulk, EVENT_ROUTES['signup-bulk']), 'site_mismatch');
  rejects(() => normalizeEvent(grade, EVENT_ROUTES.grade), 'site_mismatch');
});

test('malformed JSON and non-object event payloads fail', () => {
  for (const body of ['', '{', '{"memberUid":}', 'undefined']) {
    rejects(() => normalizeEvent(body, SIGNUP), 'invalid_payload');
  }
  for (const body of [null, [], 1, true, 'null', '[]', '"synthetic"']) {
    rejects(() => normalizeEvent(body, SIGNUP), 'invalid_schema');
  }
});

test('malformed UTF8 and BOM are not silently repaired', () => {
  rejects(() => normalizeEvent(Buffer.from([0xff, 0xfe]), SIGNUP), 'invalid_payload');
  rejects(() => normalizeEvent(Buffer.from(`\ufeff${JSON.stringify(fixture())}`), SIGNUP), 'invalid_payload');
});

test('wire size includes whitespace and uses UTF8 bytes, with 64KiB accepted exactly', () => {
  const raw = JSON.stringify(fixture());
  const boundary = raw + ' '.repeat(MAX_PAYLOAD_BYTES - Buffer.byteLength(raw));
  assert.deepEqual(normalizeEvent(boundary, SIGNUP), normalizeEvent(fixture(), SIGNUP));
  for (const body of [boundary + ' ', Buffer.from(boundary + ' ')]) {
    rejects(() => normalizeEvent(body, SIGNUP), 'payload_too_large');
  }
  rejects(() => payloadDigest({ synthetic: '\uac00'.repeat(22000) }), 'payload_too_large');
});

test('object canonical size includes JSON escaping and enforces the same byte limit', () => {
  assert.match(payloadDigest('"' + 'x'.repeat(MAX_PAYLOAD_BYTES - 2) + '"'), /^[a-f0-9]{64}$/);
  rejects(() => payloadDigest({ synthetic: 'x'.repeat(MAX_PAYLOAD_BYTES) }), 'payload_too_large');
  rejects(() => payloadDigest({ synthetic: '\u0000'.repeat(12000) }), 'payload_too_large');
});

test('payload digest recursively sorts keys but preserves array order', () => {
  assert.equal(payloadDigest({ b: { z: 1, a: 2 }, a: [3, { y: 4, x: 5 }] }),
    payloadDigest({ a: [3, { x: 5, y: 4 }], b: { a: 2, z: 1 } }));
  assert.notEqual(payloadDigest([1, 2]), payloadDigest([2, 1]));
  assert.notEqual(payloadDigest({ a: 1 }), payloadDigest({ a: '1' }));
});

test('special JSON keys are retained in the digest rather than treated as prototypes', () => {
  const value = JSON.parse('{"__proto__":{"synthetic":true},"constructor":1}');
  assert.equal(payloadDigest(value), payloadDigest('{"constructor":1,"__proto__":{"synthetic":true}}'));
  assert.notEqual(payloadDigest(value), payloadDigest({ constructor: 1 }));
});

test('sparse arrays with non-index numeric properties cannot masquerade as dense arrays', () => {
  const value = Array(1);
  value[4294967295] = 'synthetic';
  rejects(() => payloadDigest(value), 'invalid_payload');
  const hidden = Object.defineProperty({}, 'synthetic', { value: 1 });
  rejects(() => payloadDigest(hidden), 'invalid_payload');
});

test('non-JSON values, cycles and excessive nesting fail without executing hooks', () => {
  for (const value of [undefined, NaN, Infinity, 1n, () => 1, Symbol('synthetic'), new Date(),
    { a: undefined }, [undefined], Array(1), Object.assign([], { extra: 1 }),
    { [Symbol('synthetic')]: 1 }, { toJSON() { throw Error('must not run'); } }]) {
    rejects(() => payloadDigest(value), 'invalid_payload');
  }
  const cycle = {}; cycle.self = cycle;
  rejects(() => payloadDigest(cycle), 'invalid_payload');
  let deep = {};
  for (let index = 0; index < 66; index++) deep = { synthetic: deep };
  rejects(() => payloadDigest(deep), 'invalid_payload');
  const accessor = Object.defineProperty({}, 'synthetic', {
    enumerable: true, get() { throw Error('must not run'); },
  });
  rejects(() => payloadDigest(accessor), 'invalid_payload');
});

test('receipt dedupes JSON key order, representation and whitespace, not identity changes', () => {
  const body = fixture();
  const reordered = { memberUid: body.memberUid, unitCode: body.unitCode, siteCode: body.siteCode };
  const key = deliveryReceiptKey(body, SIGNUP);
  assert.equal(key, deliveryReceiptKey(reordered, SIGNUP));
  assert.equal(key, deliveryReceiptKey(JSON.stringify(reordered, null, 2), SIGNUP));
  assert.equal(key, deliveryReceiptKey(Buffer.from(JSON.stringify(body)), SIGNUP));
  assert.notEqual(key, deliveryReceiptKey(fixture({ memberUid: 'synthetic-other@example.invalid' }), SIGNUP));
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.ok(!key.includes(body.memberUid));
});

test('receipt hashes the exact event/site/unit/payload tuple, not a grant or schema acceptance', () => {
  const body = fixture();
  const tuple = JSON.stringify([SIGNUP, IMWEB_SITE_CODE, IMWEB_UNIT_CODE, payloadDigest(body)]);
  assert.equal(deliveryReceiptKey(body, SIGNUP), createHash('sha256').update(tuple).digest('hex'));
  const keys = Object.values(EVENT_ROUTES).map(event => deliveryReceiptKey(body, event));
  assert.equal(new Set(keys).size, 3);
  rejects(() => normalizeEvent(body, EVENT_ROUTES.grade), 'invalid_schema');
});

test('bulk and grade receipt keys sort keys but retain content and array order', () => {
  for (const [make, event, field] of [[bulkFixture, EVENT_ROUTES['signup-bulk'], 'memberUidList'],
    [gradeFixture, EVENT_ROUTES.grade, 'gradeCodes']]) {
    const body = make();
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    assert.equal(deliveryReceiptKey(body, event), deliveryReceiptKey(reordered, event));
    assert.notEqual(deliveryReceiptKey(body, event),
      deliveryReceiptKey({ ...body, [field]: [...body[field]].reverse() }, event));
  }
});

test('errors never disclose synthetic identity, body, secret or supplied unknown event', () => {
  const body = fixture({ extra: 'synthetic-sensitive-value' });
  rejects(() => normalizeEvent(body, SIGNUP), 'invalid_schema');
  rejects(() => normalizeEvent(fixture(), 'synthetic-sensitive-event'), 'unsupported_event');
  assert.equal(verifySecretDigest('synthetic-sensitive-secret', 'invalid'), false);
});
