import assert from 'node:assert/strict';
import test from 'node:test';
import {ENTITIES, publicRow, viewModel} from '../view-model.mjs';

for (const [entity, fields] of [
  ['entitlements', ['totalUnits', 'remainingUnits', 'bookableUnits', 'cancellableUnits', 'weeklyLimit', 'monthlyLimit']],
  ['occurrences', ['capacity', 'occupiedCount', 'waitingCount']],
  ['products', ['totalUnits', 'weeklyLimit', 'monthlyLimit']],
]) {
  test(`${entity}: missing counts remain null, not zero`, () => {
    const absent = viewModel(entity, 'synthetic-row', {});
    const zero = viewModel(entity, 'synthetic-row', Object.fromEntries(fields.map((field) => [field, 0])));
    // Weekly/monthly limits currently come from the retained source field names.
    const sourceZero = viewModel(entity, 'synthetic-row', {
      booking_limit_per_week: 0, booking_limit_per_month: 0,
    });
    for (const field of fields) {
      assert.equal(absent[field], null, field);
      assert.equal(['weeklyLimit', 'monthlyLimit'].includes(field) ? sourceZero[field] : zero[field], 0, field);
    }
  });
}

test('remaining, bookable and cancellable credits retain separate REA meanings', () => {
  const row = viewModel('entitlements', 'synthetic-pass', {
    max_coupon: '20', remaining_coupon: '12', usable_coupon: '7', remaining_cancel: '2',
  });
  assert.deepEqual([row.totalUnits, row.remainingUnits, row.bookableUnits, row.cancellableUnits], [20, 12, 7, 2]);
});

test('one available credit count never supplies missing counts of another kind', () => {
  const row = viewModel('entitlements', 'synthetic-pass', {remaining_coupon: 9});
  assert.equal(row.remainingUnits, 9);
  assert.equal(row.bookableUnits, null);
  assert.equal(row.cancellableUnits, null);
  assert.equal(row.totalUnits, null);
});

test('explicit zero counts are not overwritten by nonzero source aliases', () => {
  const row = viewModel('entitlements', 'synthetic-pass', {
    totalUnits: 0, max_coupon: 20, remainingUnits: 0, remaining_coupon: 12,
    bookableUnits: 0, usable_coupon: 7, cancellableUnits: 0, remaining_cancel: 2,
  });
  assert.deepEqual([row.totalUnits, row.remainingUnits, row.bookableUnits, row.cancellableUnits], [0, 0, 0, 0]);
});

for (const status of ['booked', 'booking_confirmed', 'booking_waiting']) {
  test(`REA ${status} remains distinct inside the booked filter group`, () => {
    const row = viewModel('bookings', 'synthetic-booking', {status});
    assert.equal(row.status, status);
    assert.equal(row.statusGroup, 'booked');
    assert.equal(publicRow(row).status, status);
  });
}

for (const status of ['attendance', 'absence', 'noshow', 'checkIn']) {
  test(`post-class status ${status} is not mixed into the booked filter group`, () => {
    const row = viewModel('bookings', 'synthetic-booking', {status});
    assert.equal(row.status, status);
    assert.equal(row.statusGroup, 'after');
  });
}

test('unknown and absent booking statuses do not imply a confirmed booking', () => {
  for (const status of [undefined, 'future_status']) {
    const row = viewModel('bookings', 'synthetic-booking', {status});
    assert.equal(row.status, status ?? null);
    assert.equal(row.statusGroup, 'other');
  }
});

for (const entity of ['bookings', 'occurrences']) {
  test(`${entity}: explicit local class date takes precedence over the UTC date`, () => {
    const row = viewModel(entity, 'synthetic-class', {startAt: '2026-10-23T15:30:00.000Z', localDate: '2026-10-24'});
    assert.equal(row.localDate, '2026-10-24');
    assert.equal(row.startAt, '2026-10-23T15:30:00.000Z');
  });

  for (const [startAt, localDate] of [
    ['2026-10-23T14:59:59.999Z', '2026-10-23'],
    ['2026-10-23T15:00:00.000Z', '2026-10-24'],
    ['2026-12-31T15:00:00.000Z', '2027-01-01'],
    ['2026-10-24T00:30:00+09:00', '2026-10-24'],
  ]) {
    test(`${entity}: date derived from ${startAt} uses Asia/Seoul`, () => {
      const row = viewModel(entity, 'synthetic-class', {startAt});
      assert.equal(row.localDate, localDate);
      assert.equal(row.startAt, startAt);
    });
  }

  test(`${entity}: Firestore timestamp-shaped source retains instant and KST local date`, () => {
    const row = viewModel(entity, 'synthetic-class', {start_on: {toDate: () => new Date('2026-10-23T15:30:00.000Z')}});
    assert.equal(row.startAt, '2026-10-23T15:30:00.000Z');
    assert.equal(row.localDate, '2026-10-24');
  });

  test(`${entity}: missing dates remain unknown rather than inventing today`, () => {
    const row = viewModel(entity, 'synthetic-class', {});
    assert.equal(row.startAt, null);
    assert.equal(row.localDate, null);
  });
}

test('all entity projections omit private raw fields before serving', () => {
  for (const entity of ENTITIES) {
    const row = viewModel(entity, 'synthetic-row', {
      name: 'Synthetic row', privateRaw: {sentinel: 'PRIVATE_SENTINEL'},
      password: 'PRIVATE_SENTINEL', token: 'PRIVATE_SENTINEL',
      profile: {name: 'Synthetic row', privateNotes: 'PRIVATE_SENTINEL'},
    });
    assert.ok(!JSON.stringify(publicRow(row)).includes('PRIVATE_SENTINEL'), entity);
  }
});

test('publicRow strips privateRaw and unknown imported fields, not just known metadata', () => {
  const row = {
    ...viewModel('members', 'synthetic-member', {name: 'Synthetic member', phone: '01000000000'}),
    privateRaw: {survey: 'PRIVATE_SENTINEL'}, futurePrivateField: 'PRIVATE_SENTINEL',
    password: 'PRIVATE_SENTINEL', accessToken: 'PRIVATE_SENTINEL',
    _source: {path: 'PRIVATE_SENTINEL'}, nameKey: 'INTERNAL_SENTINEL',
    nativeId: 'INTERNAL_SENTINEL', sourceId: 'INTERNAL_SENTINEL', statusGroup: 'INTERNAL_SENTINEL',
  };
  const before = structuredClone(row);
  const safe = publicRow(row);
  assert.equal(safe.id, 'synthetic-member');
  assert.equal(safe.name, 'Synthetic member');
  assert.equal(safe.phone, '01000000000');
  for (const field of ['privateRaw', 'futurePrivateField', 'password', 'accessToken', '_source', 'nameKey', 'nativeId', 'sourceId', 'statusGroup']) {
    assert.equal(Object.hasOwn(safe, field), false, `${field} must never be publicly serialized`);
  }
  assert.deepEqual(row, before, 'public projection must not mutate private stored rows');
});
