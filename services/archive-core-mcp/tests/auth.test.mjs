import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOwnerAccess } from '../src/auth.mjs';
import { CoreError } from '../src/safety.mjs';

const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error('Real network forbidden in security tests'); }; });
after(() => { globalThis.fetch = originalFetch; });

const safeError = code => error => {
  assert.ok(error instanceof CoreError);
  assert.equal(error.code, code);
  assert.equal(error.safe, true);
  assert.doesNotMatch(error.message, /FAKE_(?:CUSTOM|ID|CREDENTIAL)/);
  return true;
};

async function fixture(t, configSource = 'window.core = { projectId: "archive-pilates", apiKey: "AIzaFAKE_OFFLINE_CONFIG_ONLY" };') {
  const directory = await mkdtemp(join(tmpdir(), 'core-mcp-auth-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configFile = join(directory, 'config.js');
  await writeFile(configFile, configSource, { mode: 0o600 });
  const state = {
    exists: true,
    time: Date.parse('2026-01-01T00:00:00Z'),
    staff: { staffId: 'fake-owner', studioId: '5330', active: true, role: 'owner',
      uid: 'fake-uid', email: 'owner@example.invalid', coreAuthAfter: 0 },
    user: { uid: 'fake-uid', email: 'OWNER@example.invalid', disabled: false,
      tokensValidAfterTime: '2025-12-01T00:00:00Z' },
    claims: {}, calls: [], exchanges: 0,
  };
  const db = {
    collection(name) {
      assert.equal(name, 'staffs');
      return { doc(id) {
        assert.equal(id, 'fake-owner');
        return { async get() {
          state.calls.push('staff.get');
          return { exists: state.exists, data: () => ({ ...state.staff }) };
        } };
      } };
    },
  };
  const auth = {
    async getUser(uid) {
      state.calls.push('auth.getUser');
      assert.equal(uid, state.staff.uid);
      if (state.userError) throw state.userError;
      return { ...state.user };
    },
    async createCustomToken(uid, claims) {
      state.calls.push('auth.createCustomToken');
      assert.equal(uid, state.staff.uid);
      assert.deepEqual(claims, { role: 'owner', staffId: 'fake-owner', studioId: '5330', coreMcp: true });
      if (state.customTokenError) throw state.customTokenError;
      return 'FAKE_CUSTOM_NOT_A_REAL_TOKEN';
    },
    async verifyIdToken(value) {
      state.calls.push('auth.verifyIdToken');
      assert.equal(value, `FAKE_ID_NOT_A_REAL_TOKEN_${state.exchanges}`);
      if (state.verifyError) throw state.verifyError;
      return { uid: state.staff.uid, role: 'owner', staffId: 'fake-owner', studioId: '5330',
        aud: 'archive-pilates', auth_time: Math.floor(state.time / 1000),
        exp: Math.floor(state.time / 1000) + 3600, ...state.claims };
    },
  };
  const fetcher = async (url, options) => {
    state.calls.push('fetch');
    state.exchanges++;
    assert.equal(url, 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaFAKE_OFFLINE_CONFIG_ONLY');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { token: 'FAKE_CUSTOM_NOT_A_REAL_TOKEN', returnSecureToken: true });
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    if (state.networkError) throw state.networkError;
    return { ok: state.ok ?? true, async json() {
      if (state.jsonError) throw state.jsonError;
      return Object.hasOwn(state, 'exchangeData') ? state.exchangeData
        : { idToken: `FAKE_ID_NOT_A_REAL_TOKEN_${state.exchanges}`, localId: state.staff.uid };
    } };
  };
  const access = createOwnerAccess({ db, auth, staffId: 'fake-owner', configFile, fetcher, now: () => state.time });
  return { state, access, session: async () => access.token(await access.owner()) };
}

test('active owner is bound to the exact staff, studio and existing Firebase identity', async t => {
  const { access, state, session } = await fixture(t);
  const current = await access.owner();
  assert.deepEqual(current.binding, { staffId: 'fake-owner', uid: 'fake-uid', studioId: '5330',
    role: 'owner', active: true, coreAuthAfter: 0, tokensValidAfterTime: state.user.tokensValidAfterTime });
  assert.match(current.bindingHash, /^[a-f0-9]{64}$/);
  assert.equal(await session(), 'FAKE_ID_NOT_A_REAL_TOKEN_1');
  assert.equal(state.exchanges, 1);
});

test('invalid staff records fail closed before identity lookup or token minting', async t => {
  for (const [label, patch] of [
    ['staff binding', { staffId: 'other-owner' }], ['studio binding', { studioId: 'other-studio' }],
    ['inactive', { active: false }], ['truthy active', { active: 'true' }],
    ['non-owner', { role: 'admin' }], ['missing uid', { uid: '' }],
    ['missing email', { email: '' }], ['password change required', { coreMustChangePassword: true }],
  ]) await t.test(label, async t => {
    const { state, session } = await fixture(t);
    Object.assign(state.staff, patch);
    await assert.rejects(session, safeError('OWNER_REQUIRED'));
    assert.deepEqual(state.calls, ['staff.get']);
  });
  await t.test('missing document', async t => {
    const { state, session } = await fixture(t);
    state.exists = false;
    await assert.rejects(session, safeError('OWNER_REQUIRED'));
    assert.deepEqual(state.calls, ['staff.get']);
  });
});

test('disabled or mismatched Firebase users cannot obtain a token', async t => {
  for (const patch of [{ disabled: true }, { uid: 'other-uid' }, { email: 'other@example.invalid' }]) {
    await t.test(JSON.stringify(patch), async t => {
      const { state, session } = await fixture(t);
      Object.assign(state.user, patch);
      await assert.rejects(session, safeError('OWNER_REQUIRED'));
      assert.equal(state.exchanges, 0);
      assert.ok(!state.calls.includes('auth.createCustomToken'));
    });
  }
});

test('unchanged binding caches tokens but always refreshes owner eligibility', async t => {
  const { state, session } = await fixture(t);
  assert.equal(await session(), await session());
  assert.equal(state.exchanges, 1);
  assert.equal(state.calls.filter(v => v === 'staff.get').length, 2);
  assert.equal(state.calls.filter(v => v === 'auth.getUser').length, 2);
  state.user.disabled = true;
  await assert.rejects(session, safeError('OWNER_REQUIRED'));
  assert.equal(state.exchanges, 1);
});

test('revocation and owner binding changes invalidate the token cache', async t => {
  for (const change of ['revocation', 'coreAuthAfter', 'uid']) await t.test(change, async t => {
    const { state, session } = await fixture(t);
    const first = await session();
    if (change === 'revocation') state.user.tokensValidAfterTime = '2026-01-01T00:00:00Z';
    if (change === 'coreAuthAfter') state.staff.coreAuthAfter = Math.floor(state.time / 1000);
    if (change === 'uid') state.staff.uid = state.user.uid = 'replacement-fake-uid';
    assert.notEqual(await session(), first);
    assert.equal(state.exchanges, 2);
  });
});

test('failed renewal after a revocation never returns the previously cached token', async t => {
  const { state, session } = await fixture(t);
  await session();
  state.user.tokensValidAfterTime = '2026-01-01T00:00:00Z';
  state.claims.role = 'teacher';
  await assert.rejects(session, safeError('AUTH_UNAVAILABLE'));
  assert.equal(state.exchanges, 2);
  state.claims.role = 'owner';
  assert.equal(await session(), 'FAKE_ID_NOT_A_REAL_TOKEN_3');
  assert.equal(state.exchanges, 3);
});

test('lost owner role or studio binding rejects even with a cached token', async t => {
  for (const patch of [{ role: 'teacher' }, { active: false }, { studioId: 'other-studio' }]) {
    await t.test(JSON.stringify(patch), async t => {
      const { state, session } = await fixture(t);
      await session();
      Object.assign(state.staff, patch);
      await assert.rejects(session, safeError('OWNER_REQUIRED'));
      assert.equal(state.exchanges, 1);
    });
  }
});

test('cache clear, local lifetime and two-minute expiry margin force a new exchange', async t => {
  for (const mode of ['clear', 'local lifetime', 'claim expiry']) await t.test(mode, async t => {
    const { state, access, session } = await fixture(t);
    if (mode === 'claim expiry') state.claims.exp = state.time / 1000 + 180;
    const first = await session();
    if (mode === 'clear') access.clear();
    else state.time += mode === 'claim expiry' ? 60000 : 2880000;
    assert.notEqual(await session(), first);
    assert.equal(state.exchanges, 2);
  });
});

test('verified claims must match owner, studio, project and authentication cutoff', async t => {
  for (const [field, value] of Object.entries({ uid: 'other', role: 'teacher', staffId: 'other',
    studioId: 'other', aud: 'other-project', auth_time: 0 })) await t.test(field, async t => {
    const { state, session } = await fixture(t);
    state.staff.coreAuthAfter = state.time / 1000 - 60;
    state.claims[field] = value;
    await assert.rejects(session, safeError('AUTH_UNAVAILABLE'));
    assert.equal(state.exchanges, 1);
  });
});

test('only one valid existing project configuration permits token minting', async t => {
  for (const source of [
    'window.core = { projectId: "other-project", apiKey: "AIzaFAKE_OFFLINE_CONFIG_ONLY" };',
    'window.core = { projectId: "archive-pilates", apiKey: "invalid" };',
    'window.a = window.b = { projectId: "archive-pilates", apiKey: "AIzaFAKE_OFFLINE_CONFIG_ONLY" };',
  ]) await t.test(source, async t => {
    const { state, session } = await fixture(t, source);
    await assert.rejects(session, safeError('CONFIG_INVALID'));
    assert.equal(state.exchanges, 0);
    assert.ok(!state.calls.includes('auth.createCustomToken'));
  });
});

test('identity/network failures are safe and never retried', async t => {
  for (const field of ['userError', 'networkError', 'jsonError']) await t.test(field, async t => {
    const { state, session } = await fixture(t);
    state[field] = new Error('FAKE_CREDENTIAL_DO_NOT_EXPOSE');
    await assert.rejects(session, safeError('AUTH_UNAVAILABLE'));
    assert.equal(state.exchanges, field === 'userError' ? 0 : 1);
  });
});

test('exchange must succeed and return the bound local identity and token', async t => {
  for (const patch of [{ ok: false }, { exchangeData: {} },
    { exchangeData: { localId: 'other', idToken: 'FAKE_ID_NOT_A_REAL_TOKEN_1' } }]) {
    await t.test(JSON.stringify(patch), async t => {
      const { state, session } = await fixture(t);
      Object.assign(state, patch);
      await assert.rejects(session, safeError('AUTH_UNAVAILABLE'));
      assert.ok(!state.calls.includes('auth.verifyIdToken'));
    });
  }
});

test('Firebase mint/verify errors must not escape as raw credential-bearing errors', async t => {
  for (const field of ['customTokenError', 'verifyError']) await t.test(field, async t => {
    const { state, session } = await fixture(t);
    state[field] = new Error('FAKE_CREDENTIAL_DO_NOT_EXPOSE');
    await assert.rejects(session, safeError('AUTH_UNAVAILABLE'));
    assert.equal(state.exchanges, field === 'customTokenError' ? 0 : 1);
  });
});

test('null exchange body must fail with a safe authentication error', async t => {
  const { state, session } = await fixture(t);
  state.exchangeData = null;
  await assert.rejects(session, safeError('AUTH_UNAVAILABLE'));
  assert.equal(state.exchanges, 1);
});
