import { EventEmitter } from 'node:events';
import { validateConfig } from '../config.mjs';

export function config(overrides = {}) {
  return validateConfig({ pat: 'fake-pat-for-offline-tests', clientId: 'e63749d5-fdd1-4b71-ab3e-b982ed806dfe',
    allowedDeviceIds: Array.from({ length: 8 }, (_, i) => `device-${i}`),
    mqttHost: 'example-ats.iot.ap-northeast-2.amazonaws.com',
    certificatePath: '/test/cert.pem', privateKeyPath: '/test/key.pem', caPath: '/test/ca.pem',
    subscriptions: ['server/issued/topic'], ...overrides });
}

export const payload = (extra = {}) => Buffer.from(JSON.stringify({ deviceId: 'device-0',
  pushType: 'DEVICE_STATUS', report: { operation: { state: 'on' } }, ...extra }));
export const settle = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

export function clock() {
  let time = Date.parse('2026-10-21T00:00:00Z'); let id = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(fn, ms) { const handle = ++id; timers.set(handle, { fn, at: time + ms }); return handle; },
    clearTimer(handle) { timers.delete(handle); },
    async tick(ms) {
      const target = time + ms;
      for (;;) {
        await settle();
        const next = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, task]) => task.at <= target);
        if (!next) break;
        timers.delete(next[0]); time = next[1].at; next[1].fn();
      }
      time = target; await settle();
    },
    get size() { return timers.size; },
  };
}

export function store() {
  const writes = []; let fail = false;
  return { writes, set fail(value) { fail = value; },
    doc(path) {
      if (path.split('/').some(segment => /^__.*__$/.test(segment))) throw new Error('reserved Firestore document ID');
      return { async set(data) {
      if (fail) throw new Error('sensitive upstream content must never be logged');
      writes.push({ path, data });
    } }; },
  };
}

export function memoryLedger() {
  const records = new Map();
  return { get: id => records.get(id), set: (id, value) => records.set(id, value), records };
}

export class FakeClient extends EventEmitter {
  subscriptions = []; reconnects = 0; connections = 0; ends = 0; grantsFail = false;
  connect() { this.connections += 1; }
  reconnect() { this.reconnects += 1; }
  end(force) { if (!force) throw Error('Expected forced socket close'); this.ends += 1; }
  subscribe(topics, options, callback) {
    this.subscriptions.push({ topics, options });
    callback(null, topics.map(topic => ({ topic, qos: this.grantsFail ? 128 : 1 })));
  }
}
