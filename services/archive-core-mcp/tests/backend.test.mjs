import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createBackend } from '../src/backend.mjs';
import { CoreError } from '../src/safety.mjs';

const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error('Real network forbidden in security tests'); }; });
after(() => { globalThis.fetch = originalFetch; });

const safeError = code => error => {
  assert.ok(error instanceof CoreError);
  assert.equal(error.code, code);
  assert.equal(error.safe, true);
  assert.doesNotMatch(error.message, /FAKE_(?:SECRET|ID)|private-backend-detail/);
  return true;
};

function fixture({ endpoints = ['coreRead', 'coreWrite'], body = { result: { ok: true } }, ok = true } = {}) {
  const state = { calls: [], requests: [], body, ok };
  const current = { staff: { uid: 'fake-owner' }, bindingHash: 'fake-binding' };
  const access = { async token(value) {
    state.calls.push('auth');
    assert.equal(value, current);
    if (state.authGate) await state.authGate;
    if (state.authError) throw state.authError;
    return 'FAKE_ID_NOT_A_REAL_TOKEN';
  } };
  const fetcher = async (url, options) => {
    state.calls.push('POST');
    state.requests.push({ url, options });
    if (state.networkError) throw state.networkError;
    return { ok: state.ok, async json() {
      state.calls.push('json');
      if (state.jsonError) throw state.jsonError;
      return state.body;
    } };
  };
  const invoke = createBackend({ access, endpoints, fetcher });
  return { state, current, invoke, call: (params = {}, signal, options) => invoke('coreWrite', params, current, signal, options) };
}

test('fixed endpoint POST uses callable envelope, owner token and redirect refusal', async () => {
  const { state, call } = fixture();
  const params = { id: 'fake-record', url: 'http://127.0.0.1:1/not-a-target' };
  assert.deepEqual(await call(params), { ok: true });
  assert.equal(state.requests.length, 1);
  const { url, options } = state.requests[0];
  assert.equal(url, 'https://asia-northeast3-archive-pilates.cloudfunctions.net/coreWrite');
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer FAKE_ID_NOT_A_REAL_TOKEN' });
  assert.deepEqual(JSON.parse(options.body), { data: params });
  assert.ok(options.signal instanceof AbortSignal);
});

test('unknown endpoints and SSRF/path injection fail before auth, callback or fetch', async t => {
  const malicious = ['https://example.invalid/action', '//127.0.0.1/action', '../coreWrite',
    'coreWrite?url=http://169.254.169.254', 'coreWrite#fragment', 'coreWrite/other',
    'coreWrite%2fother', 'coreWrite\nX-Fake: yes', 'coreWrite@evil.invalid'];
  for (const endpoint of ['notRegistered', ...malicious]) await t.test(JSON.stringify(endpoint), async () => {
    // Even accidental allowlist inclusion must not turn a name into an arbitrary URL/path.
    const { state, invoke, current } = fixture({ endpoints: ['coreWrite', ...malicious] });
    await assert.rejects(() => invoke(endpoint, {}, current, undefined, {
      beforeDispatch() { state.calls.push('callback'); },
    }), safeError('UNKNOWN_ACTION'));
    assert.deepEqual(state.calls, []);
  });
});

test('allowlist is snapshotted rather than accepting later array mutations', async () => {
  const endpoints = ['coreRead'];
  const { invoke, current, state } = fixture({ endpoints });
  endpoints.push('coreWrite');
  await assert.rejects(() => invoke('coreWrite', {}, current), safeError('UNKNOWN_ACTION'));
  assert.deepEqual(state.calls, []);
});

test('auth completes before callback, and awaited beforeDispatch completes before POST', async () => {
  const { state, call } = fixture();
  let releaseAuth, releaseCallback;
  state.authGate = new Promise(resolve => { releaseAuth = resolve; });
  const callbackGate = new Promise(resolve => { releaseCallback = resolve; });
  let enteredCallback;
  const callbackEntered = new Promise(resolve => { enteredCallback = resolve; });
  const pending = call({}, undefined, { async beforeDispatch() {
    state.calls.push('callback.start');
    enteredCallback();
    await callbackGate;
    state.calls.push('callback.end');
  } });
  assert.deepEqual(state.calls, ['auth']);
  releaseAuth();
  await callbackEntered;
  assert.deepEqual(state.calls, ['auth', 'callback.start']);
  assert.equal(state.requests.length, 0);
  releaseCallback();
  await pending;
  assert.deepEqual(state.calls, ['auth', 'callback.start', 'callback.end', 'POST', 'json']);
});

test('auth failure or beforeDispatch rejection prevents any POST', async t => {
  for (const mode of ['auth', 'callback']) await t.test(mode, async () => {
    const { state, call } = fixture();
    const error = new CoreError('OWNER_REQUIRED', 'Synthetic authorization denial');
    if (mode === 'auth') state.authError = error;
    await assert.rejects(() => call({}, undefined, { beforeDispatch() {
      state.calls.push('callback');
      throw error;
    } }), value => value === error);
    assert.deepEqual(state.calls, mode === 'auth' ? ['auth'] : ['auth', 'callback']);
    assert.equal(state.requests.length, 0);
  });
});

test('pre-aborted or auth-time cancelled request cannot claim or POST', async t => {
  for (const mode of ['pre-aborted', 'during auth']) await t.test(mode, async () => {
    const { state, call } = fixture();
    const controller = new AbortController();
    let release;
    if (mode === 'pre-aborted') controller.abort();
    else state.authGate = new Promise(resolve => { release = resolve; });
    const pending = call({}, controller.signal, { beforeDispatch() { state.calls.push('callback'); } });
    controller.abort();
    release?.();
    await assert.rejects(pending, safeError('CANCELLED'));
    assert.deepEqual(state.calls, ['auth']);
    assert.equal(state.requests.length, 0);
  });
});

test('transport and response-decoding uncertainty are safe OUTCOME_UNKNOWN with exactly one attempt', async t => {
  for (const kind of ['networkError', 'jsonError']) await t.test(kind, async () => {
    const { state, call } = fixture();
    state[kind] = new Error('FAKE_SECRET private-backend-detail');
    await assert.rejects(call, safeError('OUTCOME_UNKNOWN'));
    assert.equal(state.requests.length, 1);
    assert.equal(state.calls.filter(value => value === 'auth').length, 1);
  });
});

test('callable result/data payloads preserve primitive and object values', async t => {
  for (const envelope of ['result', 'data']) for (const value of [{ id: 'fake' }, [1, 2], false, 0, '', null]) {
    await t.test(`${envelope}=${JSON.stringify(value)}`, async () => {
      const { state, call } = fixture({ body: { [envelope]: value } });
      assert.deepEqual(await call(), value);
      assert.equal(state.requests.length, 1);
    });
  }
});

test('explicit result takes precedence over compatibility data, including null', async () => {
  const { call } = fixture({ body: { result: null, data: { stale: true } } });
  assert.equal(await call(), null);
});

test('callable and HTTP errors sanitize status and discard backend details without retry', async t => {
  for (const [label, body, ok, code] of [
    ['callable error', { error: { status: 'PERMISSION_DENIED', message: 'private-backend-detail', details: 'FAKE_SECRET' } }, true, 'PERMISSION_DENIED'],
    ['HTTP rejection', {}, false, 'BACKEND_REJECTED'],
    ['unsafe status', { error: { status: `PERMISSION_DENIED${'X'.repeat(80)}123\n` } }, false, `PERMISSION_DENIED${'X'.repeat(80)}`.slice(0, 60)],
    ['non-string status', { error: { status: 403 } }, true, 'BACKEND_REJECTED'],
    ['error wins over result', { result: { ok: true }, error: { status: 'FAILED_PRECONDITION' } }, true, 'FAILED_PRECONDITION'],
  ]) await t.test(label, async () => {
    const { state, call } = fixture({ body, ok });
    await assert.rejects(call, safeError(code));
    assert.equal(state.requests.length, 1);
  });
});

test('missing/malformed completion envelopes fail safely without another attempt', async t => {
  for (const body of [{}, [], 'fake-not-an-envelope', null]) await t.test(JSON.stringify(body), async () => {
    const { state, call } = fixture({ body });
    await assert.rejects(call, safeError('OUTCOME_UNKNOWN'));
    assert.equal(state.requests.length, 1);
  });
});

test('request size is checked before auth/callback and oversized responses are not retried', async () => {
  const { state, call } = fixture();
  await assert.rejects(() => call({ note: 'x'.repeat(180001) }, undefined, {
    beforeDispatch() { state.calls.push('callback'); },
  }), safeError('INPUT_TOO_LARGE'));
  assert.deepEqual(state.calls, []);
  state.body = { result: { note: 'x'.repeat(500001) } };
  await assert.rejects(call, safeError('INPUT_TOO_LARGE'));
  assert.equal(state.requests.length, 1);
});
