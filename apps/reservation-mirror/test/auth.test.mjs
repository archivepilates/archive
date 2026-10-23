import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import {assertOperatorSession, authorize, verifyToken} from '../auth.mjs';
import {ApiError} from '../repository.mjs';

const endpoint = 'https://getcoreaccesssession-3bmxsf33jq-du.a.run.app';
const token = `${'a'.repeat(40)}.${'b'.repeat(40)}.${'c'.repeat(40)}`;
const req = () => ({headers: {authorization: `Bearer ${token}`}});
// CORE checks staff.active before issuing this canonical session; active is not an output field.
const manager = Object.freeze({role: 'manager', staffId: 'synthetic-staff', staffName: 'Synthetic operator', mustChangePassword: false});
const errorIs = (status, code) => (error) => {
  assert.ok(error instanceof ApiError, error.stack);
  assert.equal(error.status, status);
  if (code) assert.equal(error.code, code);
  return true;
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type': 'application/json'},
});

beforeEach((t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Real network forbidden in auth tests'); });
});

for (const header of [undefined, '', 'Basic abc', token, 'Bearer short', `Bearer ${token}\n`, [`Bearer ${token}`]]) {
  test(`missing or malformed bearer header is rejected: ${JSON.stringify(header)}`, async (t) => {
    const verify = t.mock.fn();
    const request = t.mock.fn();
    await assert.rejects(authorize({headers: {authorization: header}}, {verify, request}), errorIs(401, 'AUTH_REQUIRED'));
    assert.equal(verify.mock.callCount(), 0);
    assert.equal(request.mock.callCount(), 0);
  });
}

test('an invalid JWT fails local verification without contacting CORE or JWKS', async (t) => {
  const request = t.mock.fn();
  await assert.rejects(authorize(req(), {verify: verifyToken, request}), errorIs(401, 'AUTH_INVALID'));
  assert.equal(request.mock.callCount(), 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('a token verification failure never reaches the canonical session request', async (t) => {
  const request = t.mock.fn();
  const verify = t.mock.fn(async () => { throw new Error('Synthetic expired signature'); });
  await assert.rejects(authorize(req(), {verify, request}), errorIs(401, 'AUTH_INVALID'));
  assert.equal(verify.mock.calls[0].arguments[0], token);
  assert.equal(request.mock.callCount(), 0);
});

test('verified identity is checked against the fixed canonical CORE endpoint', async (t) => {
  const order = [];
  const verify = t.mock.fn(async () => { order.push('verify'); return {sub: 'synthetic-uid'}; });
  const request = t.mock.fn(async () => { order.push('request'); return reply({result: manager}); });
  assert.deepEqual(await authorize(req(), {verify, request, endpoint: 'https://attacker.invalid'}), {
    role: 'manager', staffName: 'Synthetic operator',
  });
  assert.deepEqual(order, ['verify', 'request']);
  assert.equal(request.mock.callCount(), 1);
  const [url, options] = request.mock.calls[0].arguments;
  assert.equal(String(url), endpoint);
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, `Bearer ${token}`);
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(options.body), {data: {}});
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted, false);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('canonical callable data envelope is accepted without leaking session internals', async () => {
  const result = await authorize(req(), {
    verify: async () => ({sub: 'synthetic-uid'}),
    request: async () => reply({data: {...manager, privateRaw: 'not-public', uid: 'not-public'}}),
  });
  assert.deepEqual(result, {role: 'manager', staffName: 'Synthetic operator'});
});

for (const [label, session] of [
  ['non-manager instructor', {...manager, role: 'instructor'}],
  ['member', {...manager, role: 'member'}],
  ['missing role', {...manager, role: undefined}],
  ['password change required', {...manager, mustChangePassword: true}],
  ['password state missing', {...manager, mustChangePassword: undefined}],
  ['missing canonical staff identity', {...manager, staffId: ''}],
  ['missing session', null],
]) {
  test(`canonical session rejects ${label}, even with a manager token claim`, async () => {
    await assert.rejects(authorize(req(), {
      verify: async () => ({sub: 'synthetic-uid', role: 'manager'}),
      request: async () => reply({result: session}),
    }), errorIs(403, 'OPERATOR_REQUIRED'));
  });
}

test('direct session assertion never accepts a password-change gate', () => {
  assert.throws(() => assertOperatorSession({...manager, mustChangePassword: true}), errorIs(403));
});

for (const [label, status, body, expected] of [
  ['inactive account denied by canonical source', 403, {error: {status: 'PERMISSION_DENIED'}}, 403],
  ['revoked canonical session', 401, {error: {status: 'UNAUTHENTICATED'}}, 401],
  ['canonical service unavailable', 503, {error: {status: 'UNAVAILABLE'}}, 503],
  ['error envelope cannot fall back to a manager result', 403, {error: {status: 'PERMISSION_DENIED'}, result: manager}, 403],
]) {
  test(`${label} fails closed without trusting JWT role claims`, async () => {
    await assert.rejects(authorize(req(), {
      verify: async () => ({sub: 'synthetic-uid', role: 'manager'}),
      request: async () => reply(body, status),
    }), errorIs(expected));
  });
}

for (const [label, request] of [
  ['connection failure', async () => { throw new Error('Synthetic connection failure'); }],
  ['timeout', async () => { throw new DOMException('Synthetic timeout', 'TimeoutError'); }],
  ['non-JSON response', async () => new Response('<html>unavailable</html>', {status: 503})],
  ['null JSON response', async () => reply(null)],
]) {
  test(`${label} is a fail-closed canonical-source outage`, async () => {
    await assert.rejects(authorize(req(), {verify: async () => ({sub: 'synthetic-uid'}), request}),
      errorIs(503, 'AUTH_SOURCE_UNAVAILABLE'));
  });
}
