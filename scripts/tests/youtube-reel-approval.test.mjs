import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('../../firebase/kangsain-functions/functions/node_modules/typescript');
const root = new URL('../../firebase/kangsain-functions/functions/src/', import.meta.url);
const compile = name => ts.transpileModule(readFileSync(new URL(name, root), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const page = { exports: {} };
vm.runInNewContext(compile('social/youtubeReelApprovalPage.ts'), page);
const gate = { exports: {}, Buffer, Date, require(name) {
  if (name === 'node:crypto') return crypto;
  assert.equal(name, './youtubeReelApprovalPage');
  return page.exports;
} };
vm.runInNewContext(compile('social/youtubeReelApprovalGate.ts'), gate);
const { reelApprovalHandler, validReelApproval, REEL_CHANNEL, REEL_APPROVAL_ORIGIN } = gate.exports;
const token = 'a'.repeat(43);
const now = 1791900000000;
const doc = () => ({ schemaVersion: 1, id: 'fixture-approval', videoId: 'testReel001', channelId: REEL_CHANNEL,
  title: '<script>title must remain text</script>', contentHash: 'b'.repeat(64), fileSha256: 'c'.repeat(64),
  tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: now + 10000, status: 'pending', isTest: true });

function response() {
  return { headers: {}, code: 0, value: null, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    status(code) { this.code = code; return this; }, type(type) { this.contentType = type; return this; },
    send(value) { this.value = value; return this; }, json(value) { this.value = value; return this; } };
}
const request = (body = { id: 'fixture-approval', token, action: 'approve' }, overrides = {}) => ({ method: 'POST', body,
  is: value => value === 'application/json', get: key => key === 'Origin' ? REEL_APPROVAL_ORIGIN : undefined, ...overrides });

test('GET and inspector never mutate approval; page needs an explicit click', async () => {
  let writes = 0;
  const handler = reelApprovalHandler({ get: async () => doc(), approve: async () => { writes++; } }, () => now);
  const get = response();
  await handler({ method: 'GET' }, get);
  assert.equal(get.code, 200);
  assert.match(get.value, /addEventListener\('click'/);
  assert.match(get.value, /void request\('inspect'\)/);
  assert.match(get.value, /<script nonce="/);
  assert.match(get.headers['Content-Security-Policy'], /script-src 'nonce-/);
  assert.equal(get.headers['Referrer-Policy'], 'no-referrer');
  const inspect = response();
  await handler(request({ id: 'fixture-approval', token, action: 'inspect' }), inspect);
  assert.equal(inspect.value.status, 'pending');
  assert.equal(writes, 0);
});

test('explicit approval and replay do not create multiple approvals', async () => {
  let current = doc(), writes = 0;
  const handler = reelApprovalHandler({ get: async () => current, approve: async () => {
    if (current.status === 'pending') { writes++; current = { ...current, status: 'approved', approvedAt: now }; }
    return current;
  } }, () => now);
  for (let i = 0; i < 2; i++) { const out = response(); await handler(request(), out); assert.equal(out.value.status, 'approved'); }
  assert.equal(writes, 1);
});

test('bad token, expiry, wrong channel and invalid identity/hash are denied', async () => {
  for (const patch of [{ tokenHash: 'd'.repeat(64) }, { expiresAt: now }, { channelId: 'other' },
    { id: 'other' }, { videoId: 'bad' }, { contentHash: '' }, { fileSha256: '' }, { schemaVersion: 2 }]) {
    assert.equal(validReelApproval({ ...doc(), ...patch }, 'fixture-approval', token, now), false);
    const out = response();
    await reelApprovalHandler({ get: async () => ({ ...doc(), ...patch }), approve: async () => assert.fail('must not write') }, () => now)(request(), out);
    assert.equal(out.code, 403);
  }
});

test('cross-origin, missing origin, malformed IDs, wrong method/content type fail closed', async () => {
  const handler = reelApprovalHandler({ get: async () => assert.fail('must not query'), approve: async () => assert.fail('must not write') });
  const inputs = [request(undefined, { get: () => 'https://evil.invalid' }), request(undefined, { get: () => undefined }),
    request({ id: '../other', token, action: 'approve' }), request({ id: 'fixture-approval', token, action: 'delete' }),
    request(undefined, { is: () => false }), request(undefined, { method: 'HEAD' })];
  for (const input of inputs) { const out = response(); await handler(input, out); assert.ok([400, 403, 405].includes(out.code)); }
});

function transactionHandler(mutate, clock) {
  let current = doc(), writes = 0;
  const ref = { get: async () => ({ data: () => current }) };
  const db = { collection: () => ({ doc: () => ref }), runTransaction: async callback => {
    current = mutate(current);
    return callback({ get: async () => ({ data: () => current }), update: (_ref, data) => { writes++; current = { ...current, ...data }; } });
  } };
  const context = { exports: {}, Date: { now: clock }, require(name) {
    if (name === 'firebase-functions') return { logger: {} };
    if (name === 'firebase-functions/v2/https') return { onCall: () => undefined, onRequest: (_, h) => h };
    if (name === 'firebase-functions/v2/scheduler') return { onSchedule: () => undefined };
    if (name === '../config/firebase') return { db };
    if (name === '../social/youtubeReelApprovalGate') return { ...gate.exports, reelApprovalHandler: store => reelApprovalHandler(store, () => now) };
    return {};
  } };
  vm.runInNewContext(compile('exports/social.ts'), context);
  return { handler: context.exports.approveYoutubeReel, writes: () => writes, current: () => current };
}

test('transaction rejects changed scope and freshly expired approval', async () => {
  for (const mutate of [d => ({ ...d, contentHash: 'd'.repeat(64) }), d => ({ ...d, channelId: 'other' }),
    d => ({ ...d, isTest: false }), d => ({ ...d, status: 'cancelled' })]) {
    const f = transactionHandler(mutate, () => now);
    const out = response(); await f.handler(request(), out);
    assert.equal(out.code, 409); assert.equal(f.writes(), 0);
  }
  const f = transactionHandler(d => d, () => now + 10001);
  const out = response(); await f.handler(request(), out);
  assert.equal(out.code, 409); assert.equal(f.writes(), 0);
});

test('real transaction accepts once and queues only the exact snapshot', async () => {
  const f = transactionHandler(d => d, () => now);
  for (let i = 0; i < 2; i++) { const out = response(); await f.handler(request(), out); assert.equal(out.code, 200); }
  assert.equal(f.writes(), 1);
  assert.equal(f.current().needsWorker, true);
  assert.equal(f.current().approvedAt, now);
});
