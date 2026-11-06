import assert from 'node:assert/strict';
import test from 'node:test';
import { isContractDiagnostic, sanitizeContractDiagnostic } from './studiomate-contract-diagnostics.mjs';

const PHASES = [
  'create', 'seal_reserve', 'seal_upload', 'seal_finalize',
  'signature_prepare', 'signature_message', 'readback',
];
const KINDS = ['preflight', 'transport', 'http', 'invalid_response', 'unknown'];
const KEYS = ['schemaVersion', 'phase', 'kind', 'httpStatus', 'method', 'ambiguous'];

test('retains typed HTTP metadata from a standard Error without leaking secrets', () => {
  const secret = 'synthetic-private-marker';
  const error = Object.assign(new Error(secret), {
    errorKind: 'http', status: 503, method: 'POST', ambiguous: true,
    body: { secret }, headers: { authorization: secret },
    url: `https://synthetic.invalid/${secret}`, token: secret,
    name: secret, stack: secret, cause: new Error(secret),
    toJSON() { throw new Error('must not serialize source'); },
  });
  const result = sanitizeContractDiagnostic(error, { phase: 'create', method: 'GET', secret });
  assert.deepEqual(result, {
    schemaVersion: 1, phase: 'create', kind: 'http',
    httpStatus: 503, method: 'POST', ambiguous: true,
  });
  assert.deepEqual(Object.keys(result), KEYS);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('accepts every phase and explicit kind, without parsing raw messages', () => {
  for (const phase of PHASES) {
    for (const kind of KINDS) {
      const result = sanitizeContractDiagnostic({ errorKind: kind }, { phase });
      assert.equal(result.phase, phase);
      assert.equal(result.kind, kind);
      assert.deepEqual(Object.keys(result), KEYS);
      assert.equal(isContractDiagnostic(result), true);
    }
  }
  assert.equal(sanitizeContractDiagnostic(new Error('HTTP 503 transport'), {
    phase: 'readback',
  }).kind, 'unknown');
  assert.equal(sanitizeContractDiagnostic({ errorKind: 'invalid_response', status: 200 }, {
    phase: 'readback',
  }).kind, 'invalid_response');
});

test('bounds HTTP status to numeric integers 100 through 599', () => {
  for (const status of [100, 200, 400, 599]) {
    for (const key of ['status', 'httpStatus']) {
      const result = sanitizeContractDiagnostic({ [key]: status }, { phase: 'readback' });
      assert.equal(result.httpStatus, status);
      assert.equal(result.kind, 'http');
    }
  }
  for (const status of [undefined, null, 0, -1, 99, 600, 200.5, NaN, Infinity,
    -Infinity, '503', true, 503n, {}, [], Symbol('status')]) {
    assert.equal(sanitizeContractDiagnostic({ status }, { phase: 'readback' }).httpStatus, null);
  }
  assert.equal(sanitizeContractDiagnostic({ httpStatus: '503', status: 502 }, {
    phase: 'readback',
  }).httpStatus, 502);
  assert.equal(sanitizeContractDiagnostic({ httpStatus: 201, status: 502 }, {
    phase: 'readback',
  }).httpStatus, 201);
});

test('retains native no-response ambiguity without inventing an HTTP status', () => {
  const result = sanitizeContractDiagnostic(Object.assign(new Error('private detail'), {
    status: 0, method: 'PATCH', ambiguous: true,
  }), { phase: 'seal_finalize' });
  assert.deepEqual(result, {
    schemaVersion: 1, phase: 'seal_finalize', kind: 'transport',
    httpStatus: null, method: 'PATCH', ambiguous: true,
  });
  for (const ambiguous of [undefined, false, 'true', 1, {}, []]) {
    assert.equal(sanitizeContractDiagnostic({ ambiguous }, { phase: 'create' }).ambiguous, false);
  }
});

test('normalizes allowlisted methods and falls back only to a valid caller method', () => {
  for (const method of ['GET', 'POST', 'PATCH', 'PUT']) {
    assert.equal(sanitizeContractDiagnostic({ method: method.toLowerCase() }, {
      phase: 'create', method: 'GET',
    }).method, method);
    assert.equal(sanitizeContractDiagnostic({}, { phase: 'create', method }).method, method);
  }
  for (const method of [undefined, null, '', 'DELETE', 'POST private', ' GET', {}, 1, Symbol('method')]) {
    assert.equal(sanitizeContractDiagnostic({ method }, {
      phase: 'seal_upload', method: 'put',
    }).method, 'PUT');
    assert.equal(sanitizeContractDiagnostic({}, { phase: 'create', method }).method, null);
  }
});

test('rejects invalid phases with a fixed error rather than mislabeling an operation', () => {
  for (const options of [undefined, null, {}, { phase: 'private-phase' }, { phase: 1 },
    { phase: {} }, { phase: Symbol('phase') }, Object.create({ phase: 'create' })]) {
    assert.throws(() => sanitizeContractDiagnostic(null, options), {
      name: 'TypeError', message: 'contract_diagnostic_phase_invalid',
    });
  }
});

test('handles malformed thrown values and rejects unrecognized kinds without coercion', () => {
  for (const error of [undefined, null, 'private', 1, true, 1n, Symbol('error'), () => {}]) {
    assert.deepEqual(sanitizeContractDiagnostic(error, { phase: 'readback', method: 'GET' }), {
      schemaVersion: 1, phase: 'readback', kind: 'unknown',
      httpStatus: null, method: 'GET', ambiguous: false,
    });
  }
  for (const kind of ['private-kind', '', null, {}, Symbol('kind')]) {
    assert.equal(sanitizeContractDiagnostic({ errorKind: kind }, { phase: 'create' }).kind, 'unknown');
  }
});

test('does not execute own or inherited getters, coercion hooks, or proxy traps', () => {
  let calls = 0;
  const forbidden = () => { calls += 1; throw new Error('must not execute'); };
  const error = {};
  for (const key of [...KEYS, 'errorKind', 'status', 'message', 'stack', 'body', 'headers', 'url', 'toJSON']) {
    Object.defineProperty(error, key, { get: forbidden });
  }
  assert.deepEqual(sanitizeContractDiagnostic(error, { phase: 'create', method: 'POST' }), {
    schemaVersion: 1, phase: 'create', kind: 'unknown',
    httpStatus: null, method: 'POST', ambiguous: false,
  });
  assert.equal(sanitizeContractDiagnostic(Object.create(error), { phase: 'create' }).kind, 'unknown');
  const options = Object.defineProperty({ phase: 'create' }, 'method', { get: forbidden });
  assert.equal(sanitizeContractDiagnostic({}, options).method, null);
  assert.throws(() => sanitizeContractDiagnostic({}, Object.defineProperty({}, 'phase', {
    get: forbidden,
  })), /contract_diagnostic_phase_invalid/);
  const coercion = { toString: forbidden, valueOf: forbidden, [Symbol.toPrimitive]: forbidden };
  assert.equal(sanitizeContractDiagnostic({ status: coercion, method: coercion, errorKind: coercion }, {
    phase: 'create',
  }).kind, 'unknown');
  const proxy = new Proxy({}, { get: forbidden, getOwnPropertyDescriptor: forbidden, getPrototypeOf: forbidden });
  assert.equal(sanitizeContractDiagnostic(proxy, { phase: 'create' }).kind, 'unknown');
  assert.throws(() => sanitizeContractDiagnostic({}, proxy), /contract_diagnostic_phase_invalid/);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(sanitizeContractDiagnostic(revoked.proxy, { phase: 'create' }).kind, 'unknown');
  assert.equal(calls, 0);
});

test('does not mutate frozen source errors, caller options, or nested data', () => {
  const body = Object.freeze({ secret: 'synthetic-private-marker' });
  const error = Object.assign(new Error('private detail'), {
    errorKind: 'preflight', status: 0, method: 'POST', ambiguous: true, body,
  });
  Object.freeze(error);
  const options = Object.freeze({ phase: 'create', method: 'GET' });
  const beforeError = Object.getOwnPropertyDescriptors(error);
  const beforeOptions = Object.getOwnPropertyDescriptors(options);
  const first = sanitizeContractDiagnostic(error, options);
  const second = sanitizeContractDiagnostic(error, options);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(Object.getOwnPropertyDescriptors(error), beforeError);
  assert.deepEqual(Object.getOwnPropertyDescriptors(options), beforeOptions);
  assert.equal(error.body, body);
  assert.equal(body.secret, 'synthetic-private-marker');
});

test('reads only own errorKind metadata, not output kind, names, or messages', () => {
  for (const errorKind of KINDS) {
    const error = Object.assign(new Error('transport http invalid_response'), {
      errorKind, kind: 'http', name: 'SyntaxError', status: 200, method: 'GET', ambiguous: false,
    });
    assert.equal(sanitizeContractDiagnostic(error, { phase: 'readback' }).kind, errorKind);
  }
  for (const error of [{ kind: 'transport' }, Object.create({ errorKind: 'http', status: 503 })]) {
    assert.equal(sanitizeContractDiagnostic(error, { phase: 'create' }).kind, 'unknown');
  }
});

test('guard accepts sanitized records, JSON roundtrips, and null-prototype records', () => {
  for (const phase of PHASES) {
    for (const kind of KINDS) {
      for (const method of [null, 'GET', 'POST', 'PATCH', 'PUT']) {
        for (const httpStatus of [null, 100, 200, 599]) {
          for (const ambiguous of [false, true]) {
            const value = { schemaVersion: 1, phase, kind, httpStatus, method, ambiguous };
            assert.equal(isContractDiagnostic(value), true);
            assert.equal(isContractDiagnostic(JSON.parse(JSON.stringify(value))), true);
            assert.equal(isContractDiagnostic(Object.assign(Object.create(null), value)), true);
          }
        }
      }
    }
  }
});

test('guard rejects missing, extra, hidden, symbol, and non-enumerable fields', () => {
  const value = sanitizeContractDiagnostic(null, { phase: 'create' });
  for (const key of KEYS) {
    const missing = { ...value };
    delete missing[key];
    assert.equal(isContractDiagnostic(missing), false);
    const hidden = Object.defineProperty({ ...value }, key, { enumerable: false });
    assert.equal(isContractDiagnostic(hidden), false);
  }
  assert.equal(isContractDiagnostic({ ...value, secret: 'synthetic-private-marker' }), false);
  assert.equal(isContractDiagnostic({ ...value, [Symbol('secret')]: 'synthetic-private-marker' }), false);
  assert.equal(isContractDiagnostic(Object.defineProperty({ ...value }, 'secret', { value: 'private' })), false);
});

test('guard rejects invalid values without coercion or loose boolean acceptance', () => {
  const value = sanitizeContractDiagnostic(null, { phase: 'readback' });
  const invalid = {
    schemaVersion: [undefined, null, 0, 2, '1', true, 1n],
    phase: [undefined, null, 'CREATE', 'private', 1, {}, Symbol('phase')],
    kind: [undefined, null, 'HTTP', 'private', 1, {}, Symbol('kind')],
    httpStatus: [undefined, 0, 99, 600, -1, 200.5, NaN, Infinity, '200', true, 200n, {}],
    method: [undefined, 'get', '', 'DELETE', ' GET', 1, {}, Symbol('method')],
    ambiguous: [undefined, null, 0, 1, 'true', {}, []],
  };
  for (const [key, values] of Object.entries(invalid)) {
    for (const bad of values) assert.equal(isContractDiagnostic({ ...value, [key]: bad }), false, key);
  }
  for (const bad of [undefined, null, 1, 'private', true, 1n, Symbol('value'), [], () => {}]) {
    assert.equal(isContractDiagnostic(bad), false);
  }
});

test('guard never executes accessors, proxies, or inherited serialization hooks', () => {
  let calls = 0;
  const forbidden = () => { calls += 1; throw new Error('must not execute'); };
  const value = sanitizeContractDiagnostic(null, { phase: 'create' });
  for (const key of KEYS) {
    const accessor = Object.defineProperty({ ...value }, key, { enumerable: true, get: forbidden });
    assert.equal(isContractDiagnostic(accessor), false);
    const setter = Object.defineProperty({ ...value }, key, { enumerable: true, set: forbidden });
    assert.equal(isContractDiagnostic(setter), false);
  }
  const inherited = Object.create({ ...value, toJSON: forbidden });
  assert.equal(isContractDiagnostic(inherited), false);
  assert.equal(isContractDiagnostic(Object.assign(Object.create({ toJSON: forbidden }), value)), false);
  assert.equal(isContractDiagnostic({ ...value, toJSON: forbidden }), false);
  const proxy = new Proxy(value, {
    get: forbidden, getOwnPropertyDescriptor: forbidden, getPrototypeOf: forbidden, ownKeys: forbidden,
  });
  assert.equal(isContractDiagnostic(proxy), false);
  const revoked = Proxy.revocable(value, {});
  revoked.revoke();
  assert.equal(isContractDiagnostic(revoked.proxy), false);
  const before = Object.getOwnPropertyDescriptors(value);
  assert.equal(isContractDiagnostic(value), true);
  assert.deepEqual(Object.getOwnPropertyDescriptors(value), before);
  assert.equal(calls, 0);
});
