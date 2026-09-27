import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { importInstructorOrder } from '../lib/imweb-instructor-orders.mjs';
import { assessInstructorOrder, IMWEB_LESSON_POLICY, orderLedgerId } from '../lib/imweb-instructor-order-policy.mjs';

const NOW = new Date('2026-09-27T12:30:00.000Z');
const ORDER_NO = '209901010000001';
const LESSON_DATE = '2026-10-10';
const TICKET = '강사레슨 (2T)';
const STUDIO = IMWEB_LESSON_POLICY.studioId;
const clone = value => structuredClone(value);

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: NOW }));

function fixture(change = () => {}) {
  const order = {
    orderNo: ORDER_NO, ordererName: 'Synthetic Learner', ordererCall: '01000000001',
    isGift: 'N', currency: 'KRW', saleChannel: 'IMWEB', orderType: 'SHOPPING', orderStatus: 'OPEN',
    totalPaymentPrice: 70000, totalDeliveryPrice: 0, totalPoint: 0,
    totalRefundPendingPrice: 0, totalRefundedPrice: 0, totalRefundPendingPoint: 0, totalRefundedPoint: 0,
    payments: [{ paymentStatus: 'PAYMENT_COMPLETE', isCancel: 'N', method: 'CARD', paidPrice: 70000,
      paymentCompleteTime: '2026-09-27T12:25:00.000Z' }],
    sections: [{ orderSectionStatus: 'SHIPPING_READY', returnInfo: { isRefund: 'N', isExchange: 'N' },
      sectionItems: [{ orderSectionItemNo: `${ORDER_NO}-1`, qty: 1,
        productInfo: { prodNo: 1, prodName: '[오프라인] ARCHIVE METHOD 강사레슨',
          optionInfo: { 수강일: '2026년 10월 10일(토)' } } }] }],
  };
  change(order);
  return order;
}

function paths(order = fixture()) {
  const input = assessInstructorOrder(order, { now: NOW });
  return {
    registration: `instructorLessonRegistrations/${input.registrationId}`,
    job: `studiomateInstructorLessonJobs/${input.registrationId}`,
    ledger: `imwebInstructorLessonOrders/${orderLedgerId(order.orderNo)}`,
  };
}

function cancelled(order) {
  const result = clone(order);
  result.orderStatus = 'CANCEL';
  result.totalRefundedPrice = 70000;
  result.payments[0].isCancel = 'Y';
  return result;
}

function field(data, key) {
  return key.split('.').reduce((value, part) => value?.[part], data);
}

function patch(data, values) {
  const result = clone(data);
  for (const [key, value] of Object.entries(values)) {
    const parts = key.split('.');
    const last = parts.pop();
    let parent = result;
    for (const part of parts) parent = parent[part] ??= {};
    parent[last] = clone(value);
  }
  return result;
}

// Only committed writes escape an attempt; retries replay the callback from the original snapshot.
function mockDb(seed = {}, { retryOnce = false, failWriteAt = 0 } = {}) {
  let data = new Map(Object.entries(clone(seed)));
  const commits = [];
  let attempts = 0;
  const snapshot = (key, source) => ({ id: key.split('/').at(-1), exists: source.has(key), data: () => clone(source.get(key)) });
  const collection = (name, filters = []) => ({
    name, filters,
    where: (key, operator, value) => {
      assert.ok(['==', 'array-contains'].includes(operator), `Unsupported operator: ${operator}`);
      return collection(name, [...filters, { key, operator, value }]);
    },
    doc: id => ({ key: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`, data) }),
  });
  const db = {
    collection,
    async runTransaction(callback) {
      for (let attempt = 0; attempt < (retryOnce ? 2 : 1); attempt++) {
        attempts++;
        const staged = clone(data);
        const writes = [];
        function write(kind, ref, value, options) {
          if (kind === 'create') assert.equal(staged.has(ref.key), false, `Already exists: ${ref.key}`);
          if (kind === 'update') assert.equal(staged.has(ref.key), true, `Missing document: ${ref.key}`);
          writes.push({ kind, key: ref.key });
          if (writes.length === failWriteAt) throw new Error('injected transaction write failure');
          staged.set(ref.key, kind === 'update' || options?.merge
            ? patch(staged.get(ref.key) || {}, value) : clone(value));
        }
        const result = await callback({
          async get(ref) {
            assert.equal(writes.length, 0, 'Transaction read after write');
            if (ref.key) return snapshot(ref.key, data);
            const docs = [...data].filter(([key, value]) => key.startsWith(`${ref.name}/`)
              && key.split('/').length === 2 && ref.filters.every(filter => filter.operator === '=='
                ? field(value, filter.key) === filter.value
                : Array.isArray(field(value, filter.key)) && field(value, filter.key).includes(filter.value)))
              .map(([key]) => snapshot(key, data));
            return { docs, size: docs.length, empty: docs.length === 0 };
          },
          create: (ref, value) => write('create', ref, value),
          update: (ref, value) => write('update', ref, value),
          set: (ref, value, options) => write('set', ref, value, options),
        });
        if (retryOnce && attempt === 0) continue;
        data = staged;
        commits.push(writes);
        return result;
      }
    },
  };
  return {
    db, commits, get attempts() { return attempts; },
    get: key => clone(data.get(key)),
    all: () => clone(Object.fromEntries(data)),
    seed: (key, value) => data.set(key, clone(value)),
    ingest: order => importInstructorOrder(db, order, { apply: true, now: NOW }),
  };
}

function booking(memberPhone, extra = {}) {
  return { studioId: STUDIO, lectureDate: LESSON_DATE, memberPhone, ticketName: TICKET, status: 'reserved', ...extra };
}

function lecture(capacity, extra = {}) {
  return { studioId: STUDIO, date: LESSON_DATE, title: '강사레슨', startTime: '13:00', capacity, ...extra };
}

function assertHeld(store, keys) {
  const registration = store.get(keys.registration);
  assert.equal(registration.status, 'action_required');
  assert.equal(registration.operatorChecks.paymentConfirmed, false);
  assert.equal(registration.externalOrderReviewRequired, true);
  assert.equal(store.get(keys.job).status, 'review_required');
  assert.equal(store.get(keys.ledger).status, 'review_required');
}

test('admission atomically creates one ledger, registration and ticket job, with bookings manual', async () => {
  const store = mockDb();
  const order = fixture();
  const keys = paths(order);
  assert.equal((await store.ingest(order)).status, 'queued');
  assert.deepEqual(Object.keys(store.all()).sort(), Object.values(keys).sort());
  assert.equal(store.commits.length, 1);
  assert.equal(store.commits[0].length, 3);
  assert.equal(store.get(keys.registration).source.sourceId, ORDER_NO);
  assert.equal(store.get(keys.registration).steps.bookings.status, 'not_required');
  assert.equal(store.get(keys.registration).operatorChecks.paymentConfirmed, true);
  assert.equal(store.get(keys.registration).operatorChecks.seatConfirmed, true);
  assert.equal(store.get(keys.job).externalOrder.orderNo, ORDER_NO);
  assert.equal(store.get(keys.job).ticketPrice, 70000);
});

test('transaction failure commits neither registration nor job nor ledger', async () => {
  const store = mockDb({}, { failWriteAt: 2 });
  await assert.rejects(store.ingest(fixture()), /injected transaction write failure/);
  assert.deepEqual(store.all(), {});
  assert.equal(store.commits.length, 0);
});

test('transaction callback replay commits only one registration and one job', async () => {
  const store = mockDb({}, { retryOnce: true });
  assert.equal((await store.ingest(fixture())).status, 'queued');
  assert.equal(store.attempts, 2);
  assert.equal(store.commits.length, 1);
  assert.equal(Object.keys(store.all()).length, 3);
});

test('same order replay does not reset a completed job or downstream evidence', async () => {
  const store = mockDb();
  const order = fixture();
  const keys = paths(order);
  await store.ingest(order);
  store.seed(keys.job, { ...store.get(keys.job), status: 'done', attempts: 2, ticketId: 'synthetic-ticket' });
  store.seed(keys.registration, { ...store.get(keys.registration), status: 'completed', evidence: { ticketId: 'synthetic-ticket' } });
  const before = store.all();
  assert.equal((await store.ingest(order)).status, 'unchanged');
  assert.deepEqual(store.all(), before);
  assert.deepEqual(store.commits.at(-1), []);
});

test('normal CLOSED and delivery-complete transition changes only ledger verification', async () => {
  const store = mockDb();
  const order = fixture();
  const keys = paths(order);
  await store.ingest(order);
  const registration = store.get(keys.registration);
  const job = store.get(keys.job);
  const previousFingerprint = store.get(keys.ledger).fingerprint;
  order.orderStatus = 'CLOSED';
  order.sections[0].orderSectionStatus = 'SHIPPING_COMPLETE';
  assert.equal((await store.ingest(order)).status, 'unchanged');
  assert.deepEqual(store.get(keys.registration), registration);
  assert.deepEqual(store.get(keys.job), job);
  assert.notEqual(store.get(keys.ledger).fingerprint, previousFingerprint);
  assert.deepEqual(store.commits.at(-1), [{ kind: 'set', key: keys.ledger }]);
});

for (const status of ['pending', 'retry']) {
  test(`own cancellation revokes payment confirmation and holds ${status} job`, async () => {
    const store = mockDb();
    const order = fixture();
    const keys = paths(order);
    await store.ingest(order);
    store.seed(keys.job, { ...store.get(keys.job), status, attempts: 1 });
    assert.equal((await store.ingest(cancelled(order))).status, 'review_required');
    assertHeld(store, keys);
    assert.equal(store.get(keys.job).attempts, 1);
    const before = store.all();
    assert.equal((await store.ingest(cancelled(order))).status, 'unchanged');
    assert.deepEqual(store.all(), before);
  });
}

for (const foreignType of ['archive_core_operator', 'imweb_paid_order']) {
  test(`duplicate cancellation cannot mutate a ${foreignType} registration or job`, async () => {
    const order = fixture();
    const keys = paths(order);
    const store = mockDb({
      [keys.registration]: { source: { type: foreignType, sourceId: 'foreign-owner' }, status: 'queued',
        operatorChecks: { paymentConfirmed: true, seatConfirmed: true } },
      [keys.job]: { status: 'pending', externalOrder: { orderNo: 'foreign-owner' } },
    });
    const registration = store.get(keys.registration);
    const job = store.get(keys.job);
    assert.equal((await store.ingest(order)).status, 'duplicate');
    assert.equal((await store.ingest(cancelled(order))).status, 'duplicate');
    assert.deepEqual(store.get(keys.registration), registration);
    assert.deepEqual(store.get(keys.job), job);
    assert.equal(store.get(keys.ledger).status, 'duplicate');
    assert.ok(store.commits.flat().every(write => write.key === keys.ledger));
  });
}

test('direct canceled duplicate without a prior ledger preserves the foreign registration', async () => {
  const order = fixture();
  const keys = paths(order);
  const store = mockDb({
    [keys.registration]: { source: { type: 'imweb_paid_order', sourceId: 'another-order' }, status: 'queued' },
    [keys.job]: { status: 'pending', externalOrder: { orderNo: 'another-order' } },
  });
  const registration = store.get(keys.registration);
  const job = store.get(keys.job);
  assert.equal((await store.ingest(cancelled(order))).status, 'duplicate');
  assert.deepEqual(store.get(keys.registration), registration);
  assert.deepEqual(store.get(keys.job), job);
});

test('tracked accepted order changing to a non-target product holds its owned registration and job', async () => {
  const store = mockDb();
  const order = fixture();
  const keys = paths(order);
  assert.equal((await store.ingest(order)).status, 'queued');
  order.sections[0].sectionItems[0].productInfo.prodNo = 999;
  assert.equal(assessInstructorOrder(order, { now: NOW }).status, 'ignored');

  const result = await importInstructorOrder(store.db, order, { apply: true, now: NOW, tracked: true });
  assert.equal(result.status, 'review_required');
  assertHeld(store, keys);
  assert.equal(store.get(keys.registration).source.sourceId, ORDER_NO);
  assert.deepEqual(Object.keys(store.all()).sort(), Object.values(keys).sort());
  assert.deepEqual(store.commits.at(-1), [
    { kind: 'update', key: keys.registration },
    { kind: 'update', key: keys.job },
    { kind: 'set', key: keys.ledger },
  ]);
});

test('untracked non-target order remains ignored without any transaction or writes', async () => {
  const store = mockDb();
  const order = fixture(value => { value.sections[0].sectionItems[0].productInfo.prodNo = 999; });
  const result = await importInstructorOrder(store.db, order, { apply: true, now: NOW, tracked: false });
  assert.equal(result.status, 'ignored');
  assert.equal(store.attempts, 0);
  assert.deepEqual(store.commits, []);
  assert.deepEqual(store.all(), {});
});

test('changed lesson date holds the original registration and never creates a second job', async () => {
  const store = mockDb();
  const order = fixture();
  const oldKeys = paths(order);
  await store.ingest(order);
  order.sections[0].sectionItems[0].productInfo.optionInfo['수강일'] = '2026년 10월 11일(일)';
  const newKeys = paths(order);
  assert.notEqual(newKeys.registration, oldKeys.registration);
  assert.equal((await store.ingest(order)).status, 'review_required');
  assertHeld(store, oldKeys);
  assert.equal(store.get(oldKeys.ledger).registrationId, oldKeys.registration.split('/')[1]);
  assert.equal(store.get(newKeys.registration), undefined);
  assert.equal(store.get(newKeys.job), undefined);
  const before = store.all();
  await store.ingest(order);
  assert.deepEqual(store.all(), before);
});

test('ten active booking-only members fill default capacity and do not enqueue work', async () => {
  const seed = Object.fromEntries(Array.from({ length: 10 }, (_, i) =>
    [`bookings/booking-${i}`, booking(`010000001${String(i).padStart(2, '0')}`)]));
  const store = mockDb(seed);
  const keys = paths();
  const result = await store.ingest(fixture());
  assert.equal(result.status, 'review_required');
  assert.match(result.reason, /10/);
  assert.equal(store.get(keys.job), undefined);
  assert.equal(store.get(keys.registration).operatorChecks.seatConfirmed, false);
  for (const [key, value] of Object.entries(seed)) assert.deepEqual(store.get(key), value);
});

test('lecture capacity below ten is enforced for lecture-linked bookings without ticket labels', async () => {
  const store = mockDb({
    'lectures/lesson': lecture(2),
    'bookings/a': booking('01000000002', { ticketName: '', lectureId: 'lesson' }),
    'bookings/b': booking('01000000003', { ticketName: '', lectureId: 'lesson' }),
  });
  const result = await store.ingest(fixture());
  assert.equal(result.status, 'review_required');
  assert.match(result.reason, /2/);
  assert.equal(store.get(paths().job), undefined);
});

test('capacity uses the union of registrations, ticket holders and bookings', async () => {
  const store = mockDb({
    'lectures/lesson': lecture(3),
    'instructorLessonRegistrations/other': { studioId: STUDIO, lessonDate: LESSON_DATE,
      memberPhone: '01000000002', status: 'queued', source: { type: 'archive_core_operator' } },
    'memberProfiles/holder': { studioId: STUDIO, phone: '01000000003', activeTicketNames: [TICKET],
      activeTickets: [{ name: TICKET, availableFrom: LESSON_DATE }] },
    'bookings/booking': booking('01000000004'),
  });
  assert.equal((await store.ingest(fixture())).status, 'review_required');
  assert.equal(store.get(paths().job), undefined);
});

test('the same normalized phone across sources consumes only one capacity place', async () => {
  const store = mockDb({
    'lectures/lesson': lecture(3),
    'instructorLessonRegistrations/other': { studioId: STUDIO, lessonDate: LESSON_DATE,
      memberPhone: '010-0000-0002', status: 'queued' },
    'memberProfiles/holder': { studioId: STUDIO, phone: '01000000002', activeTicketNames: [TICKET],
      activeTickets: [{ name: TICKET, availableFrom: LESSON_DATE }] },
    'bookings/same': booking('01000000002'),
    'bookings/other': booking('01000000003'),
  });
  assert.equal((await store.ingest(fixture())).status, 'queued');
  assert.equal(store.get(paths().job).status, 'pending');
});

test('canceled bookings, other studios and other dates do not consume a free seat', async () => {
  const store = mockDb({
    'lectures/lesson': lecture(1),
    'bookings/canceled': booking('01000000002', { status: 'cancelled' }),
    'bookings/other-studio': booking('01000000003', { studioId: 'other' }),
    'bookings/other-date': booking('01000000004', { lectureDate: '2026-10-11' }),
  });
  assert.equal((await store.ingest(fixture())).status, 'queued');
  assert.equal(store.get(paths().job).status, 'pending');
});
