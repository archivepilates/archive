import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {authorize, publicConfig} from '../auth.mjs';
import {ApiError} from '../repository.mjs';
import {createServer} from '../server.mjs';

const operator = Object.freeze({role: 'manager', staffName: 'Synthetic operator'});
const routes = ['/api/session', '/api/summary', '/api/list?entity=members', '/api/member?id=synthetic-member'];

function fakeRepository(t, overrides = {}) {
  const methods = {
    summary: async () => ({mode: 'read_only_mirror', snapshot: {id: 'synthetic-snapshot', complete: false}}),
    list: async () => ({items: [], nextCursor: null, snapshotId: 'synthetic-snapshot'}),
    member: async () => ({member: {id: 'synthetic-member', name: 'Synthetic member'}}),
    ...overrides,
  };
  for (const name of ['write', 'set', 'update', 'create', 'delete', 'reserve', 'cancel', 'send', 'dispatch', 'import']) {
    methods[name] = async () => { throw new Error(`Forbidden repository mutation: ${name}`); };
  }
  return Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, t.mock.fn(method)]));
}

function assertUntouched(repo) {
  for (const [name, method] of Object.entries(repo)) assert.equal(method.mock.callCount(), 0, name);
}

function request(port, path, {method = 'GET', headers = {}, body} = {}) {
  // This transport can only reach the server owned by this test, never the public network.
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port, path, method, headers, agent: false}, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text)});
      });
    });
    req.setTimeout(3000, () => req.destroy(new Error('Owned loopback test timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function withServer(options, run) {
  const server = createServer(options);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.ok(address.port > 0);
    await run((path, options) => request(address.port, path, options));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
      server.closeAllConnections();
    });
    assert.equal(server.listening, false);
  }
}

test('unauthenticated API requests never call the repository', async (t) => {
  const repo = fakeRepository(t);
  const auth = t.mock.fn(async () => { throw new ApiError(401, 'AUTH_REQUIRED', 'Synthetic login required'); });
  await withServer({repo, auth}, async (get) => {
    for (const path of routes) {
      const response = await get(path);
      assert.equal(response.status, 401, path);
      assert.equal(response.json().code, 'AUTH_REQUIRED');
      assert.equal(response.headers['cache-control'], 'private, no-store');
    }
  });
  assert.equal(auth.mock.callCount(), routes.length);
  assertUntouched(repo);
});

for (const authenticated of [false, true]) {
  test(`all POST routes are blocked before auth/repository access (authenticated=${authenticated})`, async (t) => {
    const repo = fakeRepository(t);
    const auth = t.mock.fn(async () => operator);
    await withServer({repo, auth}, async (get) => {
      for (const path of [...routes, '/api/health', '/api/config', '/api/reserve', '/api/cancel', '/api/import', '/api/dispatch', '/unknown', '/']) {
        const response = await get(path, {
          method: 'POST', headers: authenticated ? {authorization: 'Bearer synthetic-only'} : {},
          body: JSON.stringify({action: 'reserve', memberId: 'synthetic-member'}),
        });
        assert.equal(response.status, 405, path);
        assert.equal(response.json().code, 'READ_ONLY_MIRROR', path);
      }
    });
    assert.equal(auth.mock.callCount(), 0);
    assertUntouched(repo);
  });
}

test('other non-GET methods cannot reach data or write adapters', async (t) => {
  const repo = fakeRepository(t);
  const auth = t.mock.fn(async () => operator);
  await withServer({repo, auth}, async (get) => {
    for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await get('/api/member?id=synthetic-member', {method});
      assert.equal(response.status, 405, method);
      assert.equal(response.json().code, 'READ_ONLY_MIRROR');
    }
  });
  assert.equal(auth.mock.callCount(), 0);
  assertUntouched(repo);
});

test('public health/config expose only public configuration, not member data or auth state', async (t) => {
  const secret = 'PRIVATE_SYNTHETIC_MEMBER_SENTINEL';
  const repo = fakeRepository(t, {summary: async () => ({privateRaw: secret})});
  const auth = t.mock.fn(async () => ({...operator, privateRaw: secret}));
  await withServer({repo, auth}, async (get) => {
    const health = await get('/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.json(), {status: 'ok', mode: 'read_only_mirror', dispatchEnabled: false});
    const config = await get('/api/config');
    assert.equal(config.status, 200);
    assert.deepEqual(config.json(), publicConfig);
    assert.equal(config.json().mode, 'read_only_mirror');
    assert.deepEqual(Object.keys(config.json()).sort(), ['firebase', 'loginEmailDomain', 'loginEmailPrefix', 'mode']);
    assert.deepEqual(Object.keys(config.json().firebase).sort(), ['apiKey', 'appId', 'authDomain', 'projectId']);
    for (const response of [health, config]) {
      assert.ok(!response.text.includes(secret));
      assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(response.headers['cache-control'], 'private, no-store');
    }
  });
  assert.equal(auth.mock.callCount(), 0);
  assertUntouched(repo);
});

test('unknown and secret source paths are 404, not a filesystem fallback', async (t) => {
  const repo = fakeRepository(t);
  const auth = t.mock.fn(async () => operator);
  await withServer({repo, auth}, async (get) => {
    for (const path of [
      '/unknown', '/api/unknown', '/.env', '/.git/config', '/auth.mjs', '/safety.mjs',
      '/repository.mjs', '/package.json', '/AGENTS.md', '/test/auth.test.mjs',
      '/secrets/google/archive-codex-operator.json', '/%2e%2e/.env',
      '/%2e%2e%2fauth.mjs', '/dist/../auth.mjs', '/app.js.map',
    ]) {
      const response = await get(path);
      assert.equal(response.status, 404, path);
      assert.equal(response.json().code, 'NOT_FOUND', path);
    }
  });
  assertUntouched(repo);
});

test('authenticated GET handlers only call their expected read method', async (t) => {
  const repo = fakeRepository(t);
  const auth = t.mock.fn(async () => operator);
  await withServer({repo, auth}, async (get) => {
    assert.deepEqual((await get('/api/session')).json(), operator);
    assertUntouched(repo);
    const summary = await get('/api/summary');
    assert.equal(summary.status, 200);
    assert.equal(summary.json().snapshot.id, 'synthetic-snapshot');
    const list = await get('/api/list?entity=bookings&status=booked&from=2026-10-24&limit=10');
    assert.equal(list.status, 200);
    assert.deepEqual(Object.fromEntries(repo.list.mock.calls[0].arguments[0]), {
      entity: 'bookings', status: 'booked', from: '2026-10-24', limit: '10',
    });
    const member = await get('/api/member?id=synthetic-member');
    assert.equal(member.status, 200);
    assert.equal(repo.member.mock.calls[0].arguments[0], 'synthetic-member');
  });
  for (const name of ['summary', 'list', 'member']) assert.equal(repo[name].mock.callCount(), 1, name);
  for (const [name, method] of Object.entries(repo)) {
    if (!['summary', 'list', 'member'].includes(name)) assert.equal(method.mock.callCount(), 0, name);
  }
});

for (const [label, status, body] of [
  ['revoked session', 401, {error: {status: 'UNAUTHENTICATED'}}],
  ['inactive account', 403, {error: {status: 'PERMISSION_DENIED'}}],
  ['canonical outage', 503, {error: {status: 'UNAVAILABLE'}}],
]) {
  test(`${label} cannot expose repository data through HTTP`, async (t) => {
    const repo = fakeRepository(t);
    const auth = (req) => authorize(req, {
      verify: async () => ({sub: 'synthetic-uid', role: 'manager'}),
      request: async () => new Response(JSON.stringify(body), {status}),
    });
    await withServer({repo, auth}, async (get) => {
      const response = await get('/api/summary', {headers: {authorization: `Bearer ${'a'.repeat(120)}`}});
      assert.equal(response.status, status);
    });
    assertUntouched(repo);
  });
}

test('untrusted strings are JSON-escaped and returned as JSON, never HTML', async (t) => {
  const value = '"},"admin":true,"name":"<script>alert("synthetic")</script>\\\n\r\t\u0000';
  const payload = {items: [{id: 'synthetic-member', name: value}], nextCursor: null};
  const repo = fakeRepository(t, {list: async () => payload});
  await withServer({repo, auth: async () => operator}, async (get) => {
    const response = await get('/api/list?entity=members');
    assert.equal(response.status, 200);
    assert.deepEqual(response.json(), payload);
    assert.equal(response.text, JSON.stringify(payload));
    assert.ok(response.text.includes('\\"'));
    assert.ok(response.text.includes('\\n'));
    assert.equal(response.json().admin, undefined);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'DENY');
  });
});

test('unexpected repository failures return a sanitized 503 and no private error text', async (t) => {
  const secret = 'PRIVATE_SYNTHETIC_ERROR_SENTINEL';
  const log = t.mock.method(console, 'error', () => {});
  const repo = fakeRepository(t, {summary: async () => { throw new Error(secret); }});
  await withServer({repo, auth: async () => operator}, async (get) => {
    const response = await get('/api/summary');
    assert.equal(response.status, 503);
    assert.equal(response.json().code, 'MIRROR_UNAVAILABLE');
    assert.ok(!response.text.includes(secret));
    assert.ok(!response.text.includes('stack'));
  });
  assert.ok(!JSON.stringify(log.mock.calls.map((call) => call.arguments)).includes(secret));
});
