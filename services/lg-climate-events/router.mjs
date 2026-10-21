import { createHash, randomUUID } from 'node:crypto';
import { MAX_PAYLOAD_BYTES } from './config.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const signalPath = deviceId => `facilityClimateSignals/${hash(deviceId)}`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const decoder = new TextDecoder('utf-8', { fatal: true });

export function parseEvent(payload, allowedDeviceIds) {
  if (!Buffer.isBuffer(payload) || payload.length > MAX_PAYLOAD_BYTES) return { code: 'EVENT_SIZE' };
  let event;
  try { event = JSON.parse(decoder.decode(payload)); } catch { return { code: 'EVENT_JSON' }; }
  if (!object(event) || event.pushType !== 'DEVICE_STATUS' || !object(event.report)
    || typeof event.deviceId !== 'string') return { code: 'EVENT_SCHEMA' };
  if (!allowedDeviceIds.includes(event.deviceId)) return { code: 'EVENT_DEVICE' };
  const id = event.messageId ?? event.messageID;
  if (id !== undefined && (typeof id !== 'string' || id.length < 1 || id.length > 256
    || /[\u0000-\u0020\u007f]/u.test(id))) return { code: 'EVENT_MESSAGE_ID' };
  return { deviceId: event.deviceId, eventHash: hash(payload), messageIdHash: id === undefined ? null : hash(id) };
}

export function createEventRouter({ config, firestore, ledger, now = Date.now, uuid = randomUUID,
  setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
  const slots = new Map(config.allowedDeviceIds.map(id => [id, {
    pending: null, active: null, timer: null, flight: null, seen: new Map(), retryMs: 1000,
  }]));
  let closed = false;
  function schedule(id, slot, delay = 500) {
    if (closed || slot.timer !== null || slot.flight || !slot.pending) return;
    slot.timer = setTimer(() => { slot.timer = null; void flush(id, slot); }, delay);
  }
  async function flush(id, slot) {
    if (slot.flight || !slot.pending) return slot.flight;
    const event = slot.pending; slot.pending = null; slot.active = event;
    slot.flight = (async () => {
      try {
        await firestore.doc(signalPath(id)).set({ deviceId: id, revision: uuid(),
          eventHash: event.eventHash, updatedAt: new Date(now()).toISOString() });
        ledger.set(id, { eventHash: event.eventHash, receivedAt: event.receivedAt,
          messageIdHash: event.messageIdHash ?? ledger.get(id)?.messageIdHash ?? null });
        slot.retryMs = 1000;
      } catch {
        log('SIGNAL_WRITE_FAILED');
        // Retain only the newest hint, never a payload or an unbounded retry queue.
        slot.pending ??= event;
        slot.retryMs = Math.min(60_000, slot.retryMs * 2);
      }
    })();
    await slot.flight;
    slot.flight = null; slot.active = null;
    schedule(id, slot, slot.retryMs === 1000 ? 500 : slot.retryMs);
  }
  return {
    accept(topic, payload) {
      if (closed) return false;
      if (!config.subscriptions.includes(topic)) { log('EVENT_TOPIC'); return false; }
      const event = parseEvent(payload, config.allowedDeviceIds);
      if (event.code) { log(event.code); return false; }
      event.receivedAt = now();
      const slot = slots.get(event.deviceId);
      const prior = [ledger.get(event.deviceId), slot.active, slot.pending].filter(Boolean);
      if (event.messageIdHash) {
        if (slot.seen.has(event.messageIdHash) || prior.some(item => item.messageIdHash === event.messageIdHash)) return false;
        slot.seen.set(event.messageIdHash, true);
        if (slot.seen.size > 128) slot.seen.delete(slot.seen.keys().next().value);
      } else if (prior.some(item => item.eventHash === event.eventHash
        && Math.abs(event.receivedAt - item.receivedAt) < 5000)) return false;
      slot.pending = event;
      schedule(event.deviceId, slot);
      return true;
    },
    async close() {
      closed = true;
      for (const slot of slots.values()) {
        if (slot.timer !== null) clearTimer(slot.timer);
        slot.timer = null;
      }
      await Promise.all([...slots].map(async ([id, slot]) => {
        if (slot.flight) await slot.flight;
        if (slot.pending) await flush(id, slot);
      }));
    },
  };
}
