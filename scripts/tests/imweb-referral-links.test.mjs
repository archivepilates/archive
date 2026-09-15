import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReferralLink, incomingReferral, rememberReferral, applyReferralToField } from '../lib/imweb-referral-links.mjs';
test('share links contain only a public code, fixed HTTPS shop destination', () => {
  assert.equal(makeReferralLink('ABCD1234'), 'https://archivepilates.imweb.me/?ap_invite=ABCD1234');
  for (const code of ['<script>', 'test@example.test', 'abc', 'ABCD1234&x=1', '../admin', 'abcd1234']) assert.throws(() => makeReferralLink(code));
});
test('bad or ambiguous codes never bind an inviter', () => {
  assert.equal(incomingReferral('https://archivepilates.imweb.me/?ap_invite=ABCD1234'), 'ABCD1234');
  for (const query of ['ap_invite=bad', 'ap_invite=ABCD1234&ap_invite=ABCDEFGH', 'other=ABCD1234']) {
    assert.equal(incomingReferral(`https://archivepilates.imweb.me/?${query}`), null);
  }
});
test('first tab attribution persists across navigation and blocks self-invite', () => {
  const map = new Map();
  const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  assert.equal(rememberReferral(storage, makeReferralLink('ABCD1234'), 'ABCD1234'), null);
  assert.equal(rememberReferral(storage, makeReferralLink('ABCD1234')), 'ABCD1234');
  assert.equal(rememberReferral(storage, makeReferralLink('ABCDEFGH')), 'ABCD1234');
  assert.equal(rememberReferral(storage, 'https://archivepilates.imweb.me/login'), 'ABCD1234');
});
test('only empty native field is filled, never overwrites member choice', () => {
  const events = [];
  const field = { value: '', disabled: false, ownerDocument: { defaultView: { Event } }, dispatchEvent: event => events.push(event.type) };
  assert.equal(applyReferralToField(field, 'ABCD1234'), true);
  assert.deepEqual(events, ['input', 'change']);
  assert.equal(applyReferralToField(field, 'ABCDEFGH'), false);
  assert.equal(field.value, 'ABCD1234');
  field.disabled = true;
  assert.equal(applyReferralToField(field, 'ABCD1234'), false);
});
