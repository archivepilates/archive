import test from 'node:test';
import assert from 'node:assert/strict';
import { connectReferralSession } from '../lib/imweb-referral-session.mjs';

function fixture() {
  let notify;
  let frame;
  let disconnected = false;
  const listeners = new Map();
  const store = new Map();
  const field = { value: '', disabled: false, ownerDocument: { defaultView: { Event } },
    dispatchEvent() {} };
  const window = {
    document: { body: {} }, location: { href: 'https://archivepilates.imweb.me/?ap_invite=TEST2026' },
    sessionStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) },
    MutationObserver: class { constructor(fn) { notify = fn; } observe() {} disconnect() { disconnected = true; } },
    requestAnimationFrame(fn) { frame = fn; return 1; }, cancelAnimationFrame() { frame = null; },
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
  };
  return { window, field, notify: () => notify(), flush: () => { const fn = frame; frame = null; fn?.(); },
    listeners, disconnected: () => disconnected };
}

test('newly opened signup modal receives retained code without submitting', () => {
  const f = fixture();
  let visible = false;
  const stop = connectReferralSession({ window: f.window, resolveSignupField: () => visible ? f.field : null });
  assert.equal(f.field.value, '');
  f.window.location.href = 'https://archivepilates.imweb.me/login';
  visible = true;
  f.notify(); f.flush();
  assert.equal(f.field.value, 'TEST2026');
  stop();
});

test('coalesces mutation notifications and cleans up observers and page handlers', () => {
  const f = fixture();
  let reads = 0;
  const stop = connectReferralSession({ window: f.window, resolveSignupField: () => { reads++; return f.field; } });
  f.notify(); f.notify(); f.flush();
  assert.equal(reads, 2);
  stop(); f.notify(); f.flush();
  assert.equal(reads, 2);
  assert.equal(f.disconnected(), true);
  assert.equal(f.listeners.size, 0);
});

test('existing member choice and unavailable session storage are preserved', () => {
  const f = fixture();
  f.field.value = 'KEEP2026';
  let stop = connectReferralSession({ window: f.window, resolveSignupField: () => f.field });
  assert.equal(f.field.value, 'KEEP2026');
  stop();
  f.window.sessionStorage.getItem = () => { throw new Error('blocked'); };
  stop = connectReferralSession({ window: f.window, resolveSignupField: () => { throw new Error('must not resolve'); } });
  stop();
});
