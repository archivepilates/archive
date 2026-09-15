import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeSignupField, nativeOwnCode, isReferralSite } from '../lib/imweb-referral-native.mjs';
test('native signup field is unique and never targets own-code profile forms', () => {
  const field = { type: 'text', disabled: false, readOnly: false, form: { querySelector: () => null } };
  assert.equal(nativeSignupField({ querySelectorAll: () => [field] }), field);
  assert.equal(nativeSignupField({ querySelectorAll: () => [field, field] }), null);
  field.form.querySelector = () => ({});
  assert.equal(nativeSignupField({ querySelectorAll: () => [field] }), null);
  field.form.querySelector = () => null; field.readOnly = true;
  assert.equal(nativeSignupField({ querySelectorAll: () => [field] }), null);
});
test('reads only one valid public own-code from native display', () => {
  assert.equal(nativeOwnCode({ querySelectorAll: () => [{ textContent: ' TEST2026 ' }] }), 'TEST2026');
  assert.equal(nativeOwnCode({ querySelectorAll: () => [{ textContent: 'member@example.com' }] }), null);
  assert.equal(nativeOwnCode({ querySelectorAll: () => [{ textContent: 'TEST2026' }, { textContent: 'MORE2026' }] }), null);
});
test('site adapter never runs on admin or other origins', () => {
  for (const path of ['/', '/17', '/oauth']) assert.equal(isReferralSite(new URL('https://archivepilates.imweb.me' + path)), true);
  for (const path of ['/admin', '/admin/member', '/logout.cm']) assert.equal(isReferralSite(new URL('https://archivepilates.imweb.me' + path)), false);
  assert.equal(isReferralSite(new URL('https://example.com/')), false);
});
