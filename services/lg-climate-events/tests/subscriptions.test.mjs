import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from './helpers.mjs';
import { createEventSubscriptions } from '../subscriptions.mjs';

test('only allowed event subscription POSTs to fixed KR origin, OP phase and 24-hour expiry', async () => {
  const calls = []; const cfg = config();
  const renew = createEventSubscriptions({ config: cfg, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return Response.json({ response: {} });
  } });
  assert.equal(calls.length, 0);
  await renew(); assert.equal(calls.length, 8);
  for (const [i, { url, options }] of calls.entries()) {
    assert.equal(url, `https://api-kic.lgthinq.com/event/device-${i}/subscribe`);
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['x-service-phase'], 'OP');
    assert.equal(options.headers['x-country'], 'KR'); assert.equal(options.headers['x-client-id'], cfg.clientId);
    assert.match(options.headers['x-message-id'], /^[a-z\d_-]{22}$/i);
    assert.deepEqual(JSON.parse(options.body), { expire: { unit: 'HOUR', timer: 24 } });
    assert.ok(!url.includes('/control')); assert.ok(!url.includes('/client'));
    assert.ok(!options.body.includes('power'));
  }
  assert.equal(new Set(calls.map(call => call.options.headers['x-message-id'])).size, 8);
});

test('HTTP200 error, malformed, oversized, absent success envelope and HTTP failures rejected without response leakage', async () => {
  const cases = [
    () => Response.json({ error: { code: '1309', message: 'secret' } }),
    () => Response.json({ response: { error: { code: '1309' } } }),
    () => Response.json({}), () => new Response('not-json secret'),
    () => new Response(' '.repeat(65537)),
    () => Response.json({ error: 'secret' }, { status: 401 }),
    () => new Response('secret', { status: 500 }),
    () => { throw Error('secret-pat'); },
  ];
  for (const respond of cases) {
    let count = 0;
    const renew = createEventSubscriptions({ config: config(), fetchImpl: async () => { count += 1; return respond(); } });
    await assert.rejects(renew(), error => {
      assert.match(error.code, /^SUBSCRIPTION_(AUTH|REJECTED|NETWORK)$/);
      assert.equal(error.message, error.code); assert.ok(!error.message.includes('secret')); return true;
    });
    assert.equal(count, 1);
  }
});

test('cancellation makes zero calls, including shutdown; no registration or deletion helpers exported', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const module = await import('../subscriptions.mjs');
  assert.deepEqual(Object.keys(module).sort(), ['RENEW_MS', 'createEventSubscriptions']);
  const renew = createEventSubscriptions({ config: config(), fetchImpl: async () => { calls += 1; } });
  await assert.rejects(renew(controller.signal), { code: 'SUBSCRIPTION_ABORTED' }); assert.equal(calls, 0);
});
