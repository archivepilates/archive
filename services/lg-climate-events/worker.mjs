import { fault, VERSION } from './config.mjs';
import { createEventRouter } from './router.mjs';
import { RENEW_MS } from './subscriptions.mjs';

export function createWorker({ config, client, firestore, ledger, renewSubscriptions,
  now = Date.now, uuid, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
  const router = createEventRouter({ config, firestore, ledger, now, uuid, setTimer, clearTimer, log });
  let transport = false; let connected = false; let stopping = false; let started = false;
  let epoch = 0; let retryMs = 1000; let setupRequested = false; let setupFlight;
  let setupAbort; let reconnectTimer; let setupTimer; let heartbeatTimer; let stopFlight;
  let statusPending; let statusFlight;

  function status(value) {
    statusPending = value;
    if (!statusFlight) {
      statusFlight = (async () => {
        while (statusPending !== undefined) {
          const snapshot = statusPending; statusPending = undefined;
          try {
            await firestore.doc('facilityClimateSignals/receiver-status').set({ connected: snapshot,
              updatedAt: new Date(now()).toISOString(), version: VERSION });
          } catch { log('STATUS_WRITE_FAILED'); }
        }
      })().finally(() => { statusFlight = undefined; });
    }
    return statusFlight;
  }
  function heartbeat() {
    if (stopping) return;
    void status(connected);
    heartbeatTimer = setTimer(heartbeat, 60_000);
  }
  function subscribe(signal) {
    return new Promise((resolve, reject) => {
      let timeout;
      const finish = error => {
        clearTimer(timeout); signal.removeEventListener('abort', aborted);
        if (error) reject(fault('MQTT_SUBSCRIBE_FAILED')); else resolve();
      };
      const aborted = () => finish(true);
      signal.addEventListener('abort', aborted, { once: true });
      timeout = setTimer(() => finish(true), 15_000);
      if (signal.aborted) { finish(true); return; }
      try {
        client.subscribe([...config.subscriptions], { qos: 1 }, (error, granted) => finish(error
          || !Array.isArray(granted) || granted.length !== config.subscriptions.length
          || granted.some(item => !config.subscriptions.includes(item.topic) || item.qos !== 1)));
      } catch { finish(true); }
    });
  }
  function requestSetup() {
    if (stopping || !transport) return;
    setupRequested = true;
    if (setupFlight) return;
    const generation = epoch;
    setupRequested = false;
    setupAbort = new AbortController();
    const signal = setupAbort.signal;
    setupFlight = (async () => {
      let delay = RENEW_MS;
      try {
        await subscribe(signal);
        await renewSubscriptions(signal);
        if (stopping || !transport || generation !== epoch) return;
        connected = true; retryMs = 1000;
        void status(true);
      } catch {
        if (signal.aborted || stopping || generation !== epoch) return;
        connected = false; void status(false); log('RECEIVER_SETUP_FAILED'); delay = 60_000;
      } finally {
        if (!stopping && transport && generation === epoch) setupTimer = setTimer(requestSetup, delay);
      }
    })().finally(() => {
      setupFlight = undefined;
      if (setupRequested && transport && !stopping) requestSetup();
    });
  }
  function offline() {
    if (stopping) return;
    transport = false; connected = false; epoch += 1;
    setupAbort?.abort(); clearTimer(setupTimer); void status(false);
  }
  function onClose() {
    offline();
    if (stopping || reconnectTimer !== undefined) return;
    const delay = retryMs; retryMs = Math.min(60_000, retryMs * 2);
    reconnectTimer = setTimer(() => {
      reconnectTimer = undefined;
      if (!stopping) {
        try { client.reconnect(); } catch { log('MQTT_ERROR'); onClose(); }
      }
    }, delay);
  }
  const handlers = {
    connect() {
      if (stopping) return;
      clearTimer(reconnectTimer); reconnectTimer = undefined;
      clearTimer(setupTimer); epoch += 1; transport = true; connected = false;
      setupAbort?.abort(); requestSetup();
    },
    close: onClose, offline, disconnect: offline,
    error() { log('MQTT_ERROR'); connected = false; void status(false); },
    message(topic, payload) { if (!stopping && transport) router.accept(topic, payload); },
  };
  return {
    start() {
      if (started || stopping) return;
      started = true;
      for (const [event, handler] of Object.entries(handlers)) client.on(event, handler);
      heartbeat(); client.connect();
    },
    stop() {
      if (stopFlight) return stopFlight;
      stopping = true; connected = false; transport = false; epoch += 1;
      for (const timer of [reconnectTimer, setupTimer, heartbeatTimer]) clearTimer(timer);
      setupAbort?.abort();
      stopFlight = (async () => {
        // End the socket without deleting LG client registration or subscriptions.
        try { client.end(true); } catch { log('MQTT_ERROR'); }
        if (setupFlight) await setupFlight;
        await router.close();
        await status(false);
        for (const [event, handler] of Object.entries(handlers)) client.off(event, handler);
      })();
      return stopFlight;
    },
  };
}
