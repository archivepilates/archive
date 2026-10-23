import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingIdentity, memberIdentity} from '../import-source.mjs';
import {publicRow} from '../view-model.mjs';
test('distinct native reservations in the same member/time group remain distinct', () => {
  const seen = new Set();
  const a = bookingIdentity('100', {canonicalBookingKey: 'same-event', sourceBookingId: '100'}, seen);
  const b = bookingIdentity('101', {canonicalBookingKey: 'same-event', sourceBookingId: '101'}, seen);
  assert.notEqual(a.id, b.id); assert.equal(a.hasNative, true); assert.equal(b.hasNative, true);
});
test('fallback duplicate cannot replace observed native reservations', () => {
  const seen = new Set();
  bookingIdentity('100', {canonicalBookingKey: 'same-event'}, seen);
  assert.equal(bookingIdentity('excel_booking_fake', {canonicalBookingKey: 'same-event'}, seen), null);
});
test('canonical fallback identity is stable and not mistaken for native', () => {
  const a = bookingIdentity('usage_booking_fake', {canonicalBookingKey: 'fallback-event'}, new Set());
  const b = bookingIdentity('excel_booking_fake', {canonicalBookingKey: 'fallback-event'}, new Set());
  assert.equal(a.id, b.id); assert.equal(a.hasNative, false);
});
test('native/fallback identity without a legacy canonical key uses complete normalized event evidence', () => {
  const seen = new Set();
  const row = {memberId: 'm_12', startAt: '2026-10-23T09:00:00+09:00', staffId: 'staff1', title: 'Synthetic class'};
  const native = bookingIdentity('200', row, seen);
  assert.equal(native.hasNative, true);
  assert.equal(bookingIdentity('excel_booking_fake', row, seen), null);
});
test('recovery reuses explicit native member identity and rejects conflicting aliases', () => {
  const aliases = new Map();
  const native = memberIdentity('12', {memberId: '12'}, aliases);
  assert.equal(memberIdentity('excel_fake', {memberId: 'excel_fake', studiomateMemberId: '12'}, aliases), native);
  assert.equal(aliases.get('excel_fake'), native);
  assert.throws(() => memberIdentity('excel_fake', {studiomateMemberId: '13'}, aliases));
});
test('issued-pass quantities are never published as product-master defaults', () => {
  for (const sourceType of ['issued_pass_product_reference', 'derived_label_not_product_master']) assert.equal(publicRow({id: 'p_test', totalUnits: 23, sourceType}).totalUnits, null);
});
