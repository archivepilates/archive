import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, payload, clock, store, memoryLedger } from './helpers.mjs';
import { createEventRouter, hash, signalPath } from '../router.mjs';
import { createLedger } from '../ledger.mjs';

function fixture(overrides = {}) {
  const time = clock(); const firestore = store(); const ledger = memoryLedger(); const codes = [];
  let revision = 0;
  const router = createEventRouter({ config: config(), firestore, ledger, ...time,
    uuid: () => `revision-${++revision}`, log: code => codes.push(code), ...overrides });
  return { time, firestore, ledger, codes, router, accept: body => router.accept('server/issued/topic', body) };
}

test('500ms bounded burst coalescing stores only invalidation fields at exact hashed targets', async () => {
  const f = fixture();
  for (let i = 0; i < 1000; i += 1) assert.equal(f.accept(payload({ messageId: `message-${i}` })), true);
  await f.time.tick(499); assert.equal(f.firestore.writes.length, 0);
  await f.time.tick(1); assert.equal(f.firestore.writes.length, 1);
  assert.deepEqual(f.firestore.writes[0], { path: signalPath('device-0'), data: {
    deviceId: 'device-0', revision: 'revision-1', eventHash: hash(payload({ messageId: 'message-999' })),
    updatedAt: '2026-10-21T00:00:00.500Z',
  } });
  assert.deepEqual(Object.keys(f.firestore.writes[0].data).sort(), ['deviceId', 'eventHash', 'revision', 'updatedAt']);
  await f.router.close(); assert.equal(f.time.size, 0);
});

test('QoS1 explicit message IDs dedupe pending, committed, recent out-of-order and across restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-events-ledger-'));
  try {
    const file = path.join(directory, 'state.json');
    const options = { file, allowedDeviceIds: config().allowedDeviceIds };
    const f = fixture({ ledger: createLedger(options) });
    assert.equal(f.accept(payload({ messageId: 'A' })), true);
    assert.equal(f.accept(payload({ messageId: 'A', report: { different: true } })), false);
    await f.time.tick(500);
    assert.equal(f.accept(payload({ messageId: 'A' })), false);
    f.accept(payload({ messageId: 'B' })); await f.time.tick(500);
    assert.equal(f.accept(payload({ messageId: 'A' })), false);
    await f.router.close();
    const g = fixture({ ledger: createLedger(options) });
    assert.equal(g.accept(payload({ messageId: 'B' })), false);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.ok(!fs.readFileSync(file, 'utf8').includes('operation'));
    await g.router.close();
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('fallback hash duplicates suppressed for 5s, not permanently; explicit ID retained after fallback', async () => {
  const f = fixture(); const body = payload();
  assert.equal(f.accept(body), true); assert.equal(f.accept(body), false);
  await f.time.tick(4999); assert.equal(f.accept(body), false);
  await f.time.tick(1); assert.equal(f.accept(body), true);
  await f.time.tick(500);
  f.accept(payload({ messageId: 'stable' })); await f.time.tick(500);
  f.accept(payload({ report: {} })); await f.time.tick(500);
  assert.equal(f.ledger.get('device-0').messageIdHash, hash('stable'));
  assert.equal(f.accept(payload({ messageId: 'stable' })), false);
  await f.router.close();
});

test('out-of-order source timestamps remain hints, never regress/apply appliance state', async () => {
  const f = fixture();
  f.accept(payload({ messageId: 'new', timestamp: '2026-10-21', report: { power: 'on' } })); await f.time.tick(500);
  f.accept(payload({ messageId: 'old', timestamp: '2020-01-01', report: { power: 'off' } })); await f.time.tick(500);
  assert.equal(f.firestore.writes.length, 2);
  assert.ok(f.firestore.writes[1].data.updatedAt > f.firestore.writes[0].data.updatedAt);
  assert.ok(f.firestore.writes.every(write => !JSON.stringify(write).includes('power')));
  await f.router.close();
});

test('unknown topics/devices, malformed and oversized events produce zero writes and bounded category codes', async () => {
  const f = fixture();
  assert.equal(f.router.accept('payload/suggested/topic', payload()), false);
  assert.equal(f.accept(payload({ deviceId: 'unknown' })), false);
  assert.equal(f.accept(Buffer.from('{ secret')), false);
  assert.equal(f.accept(Buffer.alloc(65537)), false);
  await f.time.tick(10000);
  assert.equal(f.firestore.writes.length, 0);
  assert.deepEqual(f.codes, ['EVENT_TOPIC', 'EVENT_DEVICE', 'EVENT_JSON', 'EVENT_SIZE']);
  await f.router.close();
});

test('Firestore errors retry bounded newest hint without acknowledging ledger early', async () => {
  const f = fixture(); f.firestore.fail = true;
  f.accept(payload({ messageId: 'A' })); await f.time.tick(500);
  assert.equal(f.ledger.get('device-0'), undefined);
  f.accept(payload({ messageId: 'B' }));
  f.firestore.fail = false; await f.time.tick(2000);
  assert.equal(f.firestore.writes.length, 1);
  assert.equal(f.ledger.get('device-0').messageIdHash, hash('B'));
  assert.deepEqual(f.codes, ['SIGNAL_WRITE_FAILED']);
  await f.router.close();
});

test('per-device writes never overlap; shutdown flushes latest pending hint', async () => {
  let unblock; const writes = [];
  const firestore = { doc(path) { return { async set(data) {
    writes.push({ path, data });
    if (writes.length === 1) await new Promise(resolve => { unblock = resolve; });
  } }; } };
  const f = fixture({ firestore });
  f.accept(payload({ messageId: 'A' })); await f.time.tick(500);
  f.accept(payload({ messageId: 'B' })); await f.time.tick(500);
  assert.equal(writes.length, 1);
  unblock(); await f.router.close();
  assert.equal(writes.length, 2); assert.equal(f.time.size, 0);
  assert.equal(f.accept(payload()), false);
});
