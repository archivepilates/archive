import test from 'node:test';
import assert from 'node:assert/strict';
import { config, payload, clock, store, memoryLedger, FakeClient, settle } from './helpers.mjs';
import { createWorker } from '../worker.mjs';
import { RENEW_MS } from '../subscriptions.mjs';

function fixture(renew) {
  const time = clock(); const firestore = store(); const client = new FakeClient(); const codes = [];
  let renewals = 0;
  const worker = createWorker({ config: config(), client, firestore, ledger: memoryLedger(), ...time,
    log: code => codes.push(code), renewSubscriptions: async signal => { renewals += 1; await renew?.(signal); } });
  return { time, firestore, client, codes, worker, get renewals() { return renewals; },
    get status() { return firestore.writes.filter(write => write.path.endsWith('/__receiver__')).at(-1)?.data; } };
}

test('no import-time connection; start subscribes exact topics QoS1, renews on reconnect and every 12h', async () => {
  const f = fixture();
  assert.equal(f.client.connections, 0); assert.equal(f.firestore.writes.length, 0);
  f.worker.start(); f.worker.start(); await settle();
  assert.equal(f.client.connections, 1); assert.equal(f.status.connected, false);
  f.client.emit('connect'); await settle();
  assert.equal(f.renewals, 1);
  assert.deepEqual(f.client.subscriptions[0], { topics: ['server/issued/topic'], options: { qos: 1 } });
  assert.deepEqual(Object.keys(f.status).sort(), ['connected', 'updatedAt', 'version']);
  assert.equal(f.status.version, 'lg_climate_events_v1'); assert.equal(f.status.connected, true);
  await f.time.tick(60_000);
  assert.equal(f.status.updatedAt, '2026-10-21T00:01:00.000Z');
  f.client.emit('close'); await settle(); assert.equal(f.status.connected, false);
  await f.time.tick(1000); assert.equal(f.client.reconnects, 1);
  f.client.emit('connect'); await settle(); assert.equal(f.renewals, 2);
  await f.time.tick(RENEW_MS); assert.equal(f.renewals, 3);
  await f.worker.stop(); assert.equal(f.status.connected, false);
  assert.equal(f.client.ends, 1); assert.equal(f.time.size, 0);
  assert.equal(f.client.listenerCount('message'), 0);
});

test('reconnect delay grows 1..60s and never overlaps retries', async () => {
  const f = fixture(); f.worker.start();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]) {
    f.client.emit('close'); f.client.emit('close');
    const before = f.client.reconnects;
    await f.time.tick(delay - 1); assert.equal(f.client.reconnects, before);
    await f.time.tick(1); assert.equal(f.client.reconnects, before + 1);
  }
  await f.worker.stop(); assert.equal(f.time.size, 0);
});

test('subscription failures keep receiver false and retry, never log secrets', async () => {
  let fails = true;
  const f = fixture(async () => { if (fails) throw new Error('secret-pat-upstream'); });
  f.worker.start(); f.client.emit('connect'); await settle();
  assert.equal(f.status.connected, false);
  assert.deepEqual(f.codes, ['RECEIVER_SETUP_FAILED']);
  fails = false; await f.time.tick(60_000);
  assert.equal(f.status.connected, true);
  await f.worker.stop();
});

test('SUBACK rejection is not reported as connected', async () => {
  const f = fixture(); f.client.grantsFail = true;
  f.worker.start(); f.client.emit('connect'); await settle();
  assert.equal(f.renewals, 0); assert.equal(f.status.connected, false);
  await f.worker.stop();
});

test('stale setup cannot report true after disconnect; shutdown aborts setup and is idempotent', async () => {
  const f = fixture(signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
  }));
  f.worker.start(); f.client.emit('connect'); await settle();
  f.client.emit('close'); await settle(); assert.equal(f.status.connected, false);
  f.client.emit('connect'); await settle();
  assert.equal(f.renewals, 2);
  await Promise.all([f.worker.stop(), f.worker.stop()]);
  assert.equal(f.client.ends, 1); assert.equal(f.status.connected, false); assert.equal(f.time.size, 0);
});

test('events route only while transport online and flush safely on shutdown', async () => {
  const f = fixture(); f.worker.start();
  f.client.emit('message', 'server/issued/topic', payload());
  f.client.emit('connect'); await settle();
  f.client.emit('message', 'server/issued/topic', payload());
  await f.worker.stop();
  const signals = f.firestore.writes.filter(write => !write.path.endsWith('/__receiver__'));
  assert.equal(signals.length, 1);
  assert.deepEqual(Object.keys(signals[0].data).sort(), ['deviceId', 'eventHash', 'revision', 'updatedAt']);
});
