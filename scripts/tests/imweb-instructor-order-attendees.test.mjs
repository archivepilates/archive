import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { admitInstructorOrderAttendees, reconcileInstructorOrderAttendees } from '../lib/imweb-instructor-order-attendees.mjs';
import { verifyInstructorPaidOrder } from '../lib/imweb-instructor-order-source.mjs';
import {
  IMWEB_LESSON_POLICY as policy, assessInstructorOrder, createInstructorOrderAttendeeResolution,
  validateInstructorOrderAttendeeResolution, orderLedgerId, orderFingerprint,
} from '../lib/imweb-instructor-order-policy.mjs';
import { importInstructorOrder, syncImwebInstructorOrders } from '../lib/imweb-instructor-orders.mjs';

const NOW = new Date('2026-10-26T01:00:00.000Z');
const ORDER_NO = '209901010000002';
const LESSON_DATE = '2026-11-28';
const APPROVAL = { actor: 'synthetic-operator', basis: 'synthetic explicit two-attendee approval', now: NOW };
const clone = value => structuredClone(value);
const item = order => order.sections[0].sectionItems[0];
const unexpected = () => assert.fail('Unexpected external action');

beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(globalThis, 'fetch', unexpected);
});

function fixture(change = () => {}) {
  const order = {
    orderNo: ORDER_NO, ordererName: 'Synthetic Buyer', ordererCall: '01000000001',
    wtime: '2026-10-25T01:00:00.000Z',
    isGift: 'N', currency: 'KRW', saleChannel: 'IMWEB', orderType: 'SHOPPING', orderStatus: 'OPEN',
    totalPaymentPrice: 140000, totalDeliveryPrice: 0, totalPoint: 0,
    totalRefundPendingPrice: 0, totalRefundedPrice: 0, totalRefundPendingPoint: 0, totalRefundedPoint: 0,
    payments: [{ paymentStatus: 'PAYMENT_COMPLETE', isCancel: 'N', method: 'CARD', paidPrice: 140000,
      paymentCompleteTime: '2026-10-25T01:00:00.000Z' }],
    sections: [{ orderSectionStatus: 'SHIPPING_READY', returnInfo: { isRefund: 'N', isExchange: 'N' },
      sectionItems: [{ orderSectionItemNo: `${ORDER_NO}-1`, qty: 2,
        productInfo: { prodNo: 1, prodName: '[오프라인] ARCHIVE METHOD 강사레슨',
          optionInfo: { 수강일: '2026년 11월 28일(토)' } } }] }],
  };
  change(order);
  return order;
}

function attendees() {
  return [
    { memberName: 'Synthetic Buyer', memberPhone: '010-0000-0001' },
    { memberName: 'Synthetic Attendee', memberPhone: '010-0000-0002' },
  ];
}

function paths(order = fixture()) {
  const resolution = createInstructorOrderAttendeeResolution(order, attendees(), APPROVAL);
  return {
    resolution,
    ledger: `imwebInstructorLessonOrders/${orderLedgerId(order.orderNo)}`,
    audit: `workLanes/instructor-lesson-registration/reports/attendees-${resolution.resolutionKey}`,
    rows: resolution.attendees.map(a => ({ ...a,
      registration: `instructorLessonRegistrations/${a.registrationId}`,
      job: `studiomateInstructorLessonJobs/${a.registrationId}`,
      form: `eformsignInstructorMemberJobs/${a.registrationId}`,
    })),
  };
}

function field(data, key) {
  return key.split('.').reduce((value, part) => value?.[part], data);
}

function patch(data, values) {
  const result = clone(data);
  for (const [key, value] of Object.entries(values)) {
    const parts = key.split('.'), last = parts.pop();
    let parent = result;
    for (const part of parts) parent = parent[part] ??= {};
    parent[last] = clone(value);
  }
  return result;
}

// Model Firestore's read-before-write rule and publish only a complete committed attempt.
function mockDb(seed = {}, options = {}) {
  let data = new Map(Object.entries(clone(seed))), attempts = 0;
  const commits = [], reads = [], stagedAttempts = [];
  const refFor = key => ({ key, path: key, id: key.split('/').at(-1), get: async () => {
    reads.push({ key, transaction: false });
    return snapshot(key, data);
  } });
  const snapshot = (key, source) => ({ id: key.split('/').at(-1), ref: refFor(key),
    exists: source.has(key), data: () => clone(source.get(key)) });
  const collection = (name, filters = [], limit = Infinity) => ({
    name, filters, maximum: limit,
    where: (key, operator, value) => {
      assert.ok(['==', 'array-contains'].includes(operator), `Unsupported operator: ${operator}`);
      return collection(name, [...filters, { key, operator, value }], limit);
    },
    limit: value => collection(name, filters, value),
    doc: id => refFor(`${name}/${id}`),
  });
  const db = {
    collection, doc: refFor,
    async runTransaction(callback) {
      for (let attempt = 0; attempt < (options.retryOnce ? 2 : 1); attempt++) {
        attempts++;
        const staged = clone(data), writes = [];
        stagedAttempts.push(writes);
        function write(kind, ref, value, config) {
          if (kind === 'create') assert.equal(staged.has(ref.key), false, `Already exists: ${ref.key}`);
          if (kind === 'update') assert.equal(staged.has(ref.key), true, `Missing document: ${ref.key}`);
          writes.push({ kind, key: ref.key });
          if (writes.length === options.failWriteAt) throw new Error('injected transaction write failure');
          staged.set(ref.key, kind === 'update' || config?.merge
            ? patch(staged.get(ref.key) || {}, value) : clone(value));
        }
        const result = await callback({
          async get(ref) {
            assert.equal(writes.length, 0, 'Transaction read after write');
            reads.push({ key: ref.key || ref.name, transaction: true });
            if (ref.key) return snapshot(ref.key, data);
            const docs = [...data].filter(([key, value]) => key.startsWith(`${ref.name}/`)
              && key.split('/').length === 2 && ref.filters.every(filter => filter.operator === '=='
                ? field(value, filter.key) === filter.value
                : Array.isArray(field(value, filter.key)) && field(value, filter.key).includes(filter.value)))
              .slice(0, ref.maximum).map(([key]) => snapshot(key, data));
            return { docs, size: docs.length, empty: docs.length === 0 };
          },
          create: (ref, value) => write('create', ref, value),
          update: (ref, value) => write('update', ref, value),
          set: (ref, value, config) => write('set', ref, value, config),
        });
        if (options.retryOnce && attempt === 0) continue;
        data = staged;
        commits.push(writes);
        return result;
      }
    },
  };
  return { db, commits, reads, stagedAttempts, get attempts() { return attempts; },
    get: key => clone(data.get(key)), all: () => clone(Object.fromEntries(data)),
    seed: (key, value) => data.set(key, clone(value)), remove: key => data.delete(key),
    admit: (order = fixture(), overrides = {}) => admitInstructorOrderAttendees(db, order, attendees(),
      { ...APPROVAL, apply: true, ...overrides }),
  };
}

async function admitted(options = {}) {
  const store = mockDb({}, options), order = fixture(), keys = paths(order);
  await store.admit(order);
  return { store, order, keys };
}

function addForms(store, keys, statuses = ['pending', 'retry']) {
  keys.rows.forEach((row, index) => store.seed(row.form, { registrationId: row.registrationId,
    status: statuses[index], attempts: index + 1, memberPhone: row.memberPhone, documentId: `synthetic-form-${index}` }));
}

function assertHeld(store, keys) {
  assert.equal(store.get(keys.ledger).status, 'review_required');
  assert.equal(store.get(keys.ledger).attendeeResolution.status, 'blocked');
  for (const row of keys.rows) {
    const registration = store.get(row.registration);
    assert.equal(registration.externalOrderReviewRequired, true);
    assert.equal(registration.operatorChecks.paymentConfirmed, false);
    assert.equal(store.get(row.job).status, 'review_required');
    assert.equal(store.get(row.form).status, 'send_review_required');
  }
}

const sourceChanges = [
  ['refund', order => { order.totalRefundedPrice = 70000; }],
  ['pending refund', order => { order.totalRefundPendingPrice = 70000; }],
  ['date', order => { item(order).productInfo.optionInfo.수강일 = '2026년 11월 29일(일)'; }],
  ['quantity', order => { item(order).qty = 1; }],
  ['gift', order => { order.isGift = 'Y'; }],
  ['source channel', order => { order.saleChannel = 'OTHER'; }],
  ['source product', order => { item(order).productInfo.prodNo = 999; }],
  ['source product title', order => { item(order).productInfo.prodName = '[온라인] ARCHIVE METHOD 강사레슨'; }],
  ['cancellation', order => { order.orderStatus = 'CANCEL'; order.payments[0].isCancel = 'Y'; }],
];

test('transaction mock rejects a read after a staged write without leaking that write', async () => {
  const store = mockDb();
  await assert.rejects(store.db.runTransaction(async tx => {
    tx.create(store.db.doc('synthetic/a'), { value: 1 });
    await tx.get(store.db.doc('synthetic/b'));
  }), /Transaction read after write/);
  assert.deepEqual(store.all(), {});
  assert.deepEqual(store.commits, []);
});

test('raw quantity-two paid-140000 order remains review-only without explicit attendee approval', async () => {
  const order = fixture(), before = clone(order), store = mockDb();
  assert.equal(assessInstructorOrder(order, { now: NOW }).status, 'review_required');
  const result = await importInstructorOrder(store.db, order, { apply: true, now: NOW });
  assert.equal(result.status, 'review_required');
  assert.equal(Object.keys(store.all()).filter(key => key.startsWith('studiomateInstructorLessonJobs/')).length, 0);
  assert.equal(store.get(paths().ledger).paymentAmount, 140000);
  assert.deepEqual(order, before);
});

test('admission dry-run checks both seats but writes no audit, ledger, registrations or jobs', async () => {
  const store = mockDb(), order = fixture(), before = clone(order);
  const result = await store.admit(order, { apply: false });
  assert.equal(result.status, 'ready');
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.count, 2);
  assert.equal(result.occupiedAfter, 2);
  assert.equal(result.nextRunAt, NOW.toISOString());
  assert.deepEqual(store.all(), {});
  assert.equal(store.commits.flat().length, 0);
  assert.deepEqual(order, before);
});

test('one atomic admission commits exactly both attendees, both jobs, ledger and immutable raw audit', async () => {
  const { store, order, keys } = await admitted();
  assert.deepEqual(Object.keys(store.all()).sort(), [keys.audit, keys.ledger,
    ...keys.rows.flatMap(row => [row.registration, row.job])].sort());
  assert.equal(store.commits.length, 1);
  assert.equal(store.commits[0].length, 6);
  assert.deepEqual(store.get(keys.audit).order, order);
  assert.equal(store.get(keys.ledger).fingerprint, orderFingerprint(order));
  assert.equal(store.get(keys.ledger).paymentAmount, 140000);
  assert.deepEqual(store.get(keys.ledger).registrationIds, keys.rows.map(row => row.registrationId));
  assert.equal(store.get(keys.ledger).attendeeResolution.totalPaidAmount, 140000);
  for (const row of keys.rows) {
    const reg = store.get(row.registration), job = store.get(row.job);
    assert.equal(reg.status, 'queued');
    assert.equal(reg.ticketPrice, 70000);
    assert.equal(job.ticketPrice, 70000);
    assert.equal(reg.externalOrder.paidAmount, 70000);
    assert.equal(job.externalOrder.paidAmount, 70000);
    assert.equal(job.externalOrder.totalPaidAmount, 140000);
    assert.equal(reg.operatorChecks.paymentConfirmed, true);
    assert.equal(reg.operatorChecks.seatConfirmed, true);
    assert.equal(reg.steps.bookings.status, 'not_required');
    assert.equal(job.memberPhone, row.memberPhone);
    assert.equal(job.externalOrder.memberPhone, row.memberPhone);
    assert.equal(job.status, 'pending');
    assert.equal(job.attempts, 0);
    assert.equal(job.externalEffectStarted, false);
  }
  assert.equal(keys.rows.reduce((sum, row) => sum + store.get(row.job).ticketPrice, 0), order.totalPaymentPrice);
  assert.equal(store.get(keys.audit).order.ordererCall, '01000000001');
  assert.equal(store.get(keys.audit).order.sections[0].sectionItems[0].qty, 2);
});

test('safe raw review is promoted jointly while preserving its original createdAt and audit snapshot', async () => {
  const order = fixture(), store = mockDb(), keys = paths(order);
  await importInstructorOrder(store.db, order, { apply: true, now: NOW });
  const buyer = keys.rows.find(row => row.memberPhone === order.ordererCall);
  const original = { ...store.get(buyer.registration), createdAt: new Date('2026-10-25T02:00:00Z') };
  store.seed(buyer.registration, original);
  const previousLedger = store.get(keys.ledger);
  assert.equal((await store.admit(order)).status, 'queued');
  assert.deepEqual(store.get(buyer.registration).createdAt, original.createdAt);
  assert.deepEqual(store.get(keys.audit).previousLedger, previousLedger);
  assert.deepEqual(store.get(keys.audit).previousRegistrations.find(Boolean), original);
  assert.equal(store.get(buyer.registration).source.type, 'imweb_paid_order');
});

test('transaction retry discards the entire first family and commits one family exactly once', async () => {
  const { store, keys } = await admitted({ retryOnce: true });
  assert.equal(store.attempts, 2);
  assert.deepEqual(store.stagedAttempts.map(writes => writes.length), [6, 6]);
  assert.equal(store.commits.length, 1);
  assert.equal(Object.keys(store.all()).length, 6);
  const before = store.all();
  assert.equal((await store.admit()).status, 'unchanged');
  assert.deepEqual(store.all(), before);
  assert.equal(store.commits.flat().length, 6);
  assert.deepEqual(store.get(keys.ledger).registrationIds, keys.rows.map(row => row.registrationId));
});

for (let failWriteAt = 1; failWriteAt <= 6; failWriteAt++) {
  test(`admission rollback at write ${failWriteAt} preserves raw review and allows one clean retry`, async () => {
    const options = {}, order = fixture(), store = mockDb({}, options);
    await importInstructorOrder(store.db, order, { apply: true, now: NOW });
    const before = store.all(), committed = store.commits.length;
    options.failWriteAt = failWriteAt;
    await assert.rejects(store.admit(order), /injected transaction write failure/);
    assert.deepEqual(store.all(), before);
    assert.equal(store.commits.length, committed);
    options.failWriteAt = 0;
    assert.equal((await store.admit(order)).status, 'queued');
    assert.equal(store.commits.at(-1).length, 6);
    assert.equal((await store.admit(order)).status, 'unchanged');
    assert.equal(store.commits.flat().filter(write => write.key === paths().audit).length, 1);
  });
}

test('admission remains idempotent under reversed attendee order and preserves accepted/sent effects', async () => {
  const { store, order, keys } = await admitted();
  keys.rows.forEach((row, index) => {
    store.seed(row.job, { ...store.get(row.job), status: index ? 'completed' : 'accepted',
      attempts: 2, externalEffectStarted: true, providerRequestId: `synthetic-${index}` });
    store.seed(row.form, { registrationId: row.registrationId, status: index ? 'sent' : 'accepted', documentId: `synthetic-${index}` });
    store.seed(`alimtalkSends/synthetic-${index}`, { payload: { registrationId: row.registrationId },
      status: 'sent', providerRequestId: `synthetic-send-${index}` });
  });
  const before = store.all();
  const result = await admitInstructorOrderAttendees(store.db, order, attendees().reverse(), { ...APPROVAL, apply: true });
  assert.equal(result.status, 'unchanged');
  assert.equal(result.attendeeResolutionVerified, true);
  assert.deepEqual(store.all(), before);
  assert.equal(store.commits.at(-1).length, 0);
});

for (const [name, change] of [
  ['buyer omitted', list => { list[0] = { memberName: 'Synthetic Third', memberPhone: '01000000003' }; }],
  ['buyer name mismatched', list => { list[0].memberName = 'Wrong Buyer'; }],
  ['duplicate normalized phone', list => { list[1].memberPhone = '01000000001'; }],
  ['missing actual phone', list => { list[1].memberPhone = ''; }],
  ['missing actual name', list => { list[1].memberName = ''; }],
  ['one attendee', list => { list.pop(); }],
  ['wrong personal allocation', list => { list[1].paidAmount = 140000; }],
]) {
  test(`admission fails before transactions for ${name}`, async () => {
    const store = mockDb(), list = attendees();
    change(list);
    await assert.rejects(admitInstructorOrderAttendees(store.db, fixture(), list, { ...APPROVAL, apply: true }));
    assert.equal(store.attempts, 0);
    assert.deepEqual(store.all(), {});
  });
}

for (const missing of ['actor', 'basis']) {
  test(`explicit ${missing} is required even for a dry-run`, async () => {
    const store = mockDb();
    await assert.rejects(store.admit(fixture(), { apply: false, [missing]: '' }));
    assert.equal(store.attempts, 0);
  });
}

for (const [name, change] of [
  ['underpaid total', order => { order.totalPaymentPrice = 70000; }],
  ['mismatched payment receipt', order => { order.payments[0].paidPrice = 70000; }],
  ['points', order => { order.totalPoint = 1; }],
  ['delivery fee', order => { order.totalDeliveryPrice = 1; }],
  ['nonfuture date', order => { item(order).productInfo.optionInfo.수강일 = '2026년 10월 26일(월)'; }],
  ...sourceChanges.filter(([name]) => name !== 'date'),
]) {
  test(`new family rejects ${name} instead of fabricating a single-person source`, async () => {
    const store = mockDb();
    await assert.rejects(store.admit(fixture(change)));
    assert.equal(store.attempts, 0);
    assert.deepEqual(store.all(), {});
  });
}

test('a different valid future date is allowed for a new explicitly approved family', async () => {
  const store = mockDb();
  const result = await store.admit(fixture(order => {
    item(order).productInfo.optionInfo.수강일 = '2026년 11월 29일(일)';
  }));
  assert.equal(result.status, 'queued');
  for (const id of result.registrationIds) {
    assert.equal(store.get(`instructorLessonRegistrations/${id}`).lessonDate, '2026-11-29');
  }
});

for (const [name, ledger] of [
  ['changed source fingerprint', keys => ({ fingerprint: 'different-source' })],
  ['foreign primary registration', keys => ({ registrationId: 'foreign-registration' })],
  ['different prior family', keys => ({ registrationIds: [keys.rows[0].registrationId, 'foreign-registration'] })],
  ['incomplete prior family', keys => ({ registrationIds: [keys.rows[0].registrationId] })],
]) {
  test(`admission preserves prior ledger and refuses ${name}`, async () => {
    const keys = paths(), store = mockDb({ [keys.ledger]: ledger(keys) }), before = store.all();
    await assert.rejects(store.admit());
    assert.deepEqual(store.all(), before);
    assert.deepEqual(store.commits, []);
  });
}

const existingEffects = [
  ['native pending job', row => row.job, row => ({ registrationId: row.registrationId, status: 'pending' })],
  ['native accepted job', row => row.job, row => ({ registrationId: row.registrationId, status: 'accepted', externalEffectStarted: true })],
  ['form exact key without registration field', row => row.form, () => ({ status: 'pending' })],
  ['form alternative key', () => 'eformsignInstructorMemberJobs/synthetic-alias', row => ({ registrationId: row.registrationId, status: 'sent' })],
  ['candidate alternative key', () => 'alimtalkCandidates/synthetic-alias', row => ({ payload: { registrationId: row.registrationId }, status: 'pending' })],
  ['accepted send alternative key', () => 'alimtalkSends/synthetic-alias', row => ({ payload: { registrationId: row.registrationId }, status: 'accepted' })],
  ['sent alternative key', () => 'alimtalkSends/synthetic-alias', row => ({ payload: { registrationId: row.registrationId }, status: 'sent' })],
  ['ambiguous send alternative key', () => 'alimtalkSends/synthetic-alias', row => ({ payload: { registrationId: row.registrationId }, status: 'unknown' })],
];

for (const index of [0, 1]) for (const [name, key, value] of existingEffects) {
  test(`existing ${name} for attendee ${index + 1} blocks the entire admission without overwriting effects`, async () => {
    const row = paths().rows[index], store = mockDb({ [key(row)]: value(row) });
    const before = store.all();
    await assert.rejects(store.admit());
    assert.deepEqual(store.all(), before);
    assert.deepEqual(store.commits, []);
  });
}

test('one remaining lecture seat cannot partially admit a two-attendee family', async () => {
  const store = mockDb({ 'lectures/synthetic': { studioId: policy.studioId, date: LESSON_DATE,
    title: '강사레슨', startTime: '13:00', capacity: 1 } });
  const before = store.all();
  await assert.rejects(store.admit(), /정원/);
  assert.deepEqual(store.all(), before);
  assert.deepEqual(store.commits, []);
});

for (const [now, next] of [
  ['2026-10-26T14:00:00.000Z', '2026-10-27T00:00:00.000Z'],
  ['2026-10-26T23:59:59.999Z', '2026-10-27T00:00:00.000Z'],
  ['2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'],
]) {
  test(`admission at ${now} queues both for ${next} without claims, forms, candidates or sends`, async () => {
    const store = mockDb(), keys = paths(), order = fixture(), before = clone(order);
    const result = await store.admit(order, { now: new Date(now) });
    assert.equal(result.nextRunAt, next);
    for (const row of keys.rows) {
      const job = store.get(row.job);
      assert.equal(job.nextRunAt.toISOString(), next);
      assert.equal(job.status, 'pending');
      assert.equal(job.attempts, 0);
      assert.equal(job.claimToken, undefined);
      assert.equal(job.externalEffectStarted, false);
      assert.equal(job.sentAt, undefined);
      assert.equal(store.get(row.form), undefined);
    }
    assert.equal(store.commits.flat().length, 6);
    assert.ok(Object.keys(store.all()).every(key => !/^(alimtalk|bookings\/|memberProfiles\/)/.test(key)));
    assert.deepEqual(order, before);
    assert.equal(globalThis.fetch.mock.callCount(), 0);
  });
}

test('reconciliation of unchanged joint source and watcher import is read-only and verified', async () => {
  const { store, order } = await admitted();
  const before = store.all();
  for (const apply of [false, true]) {
    assert.equal((await reconcileInstructorOrderAttendees(store.db, order, { apply, now: NOW })).attendeeResolutionVerified, true);
    assert.equal((await importInstructorOrder(store.db, order, { apply, tracked: true, now: NOW })).status, 'unchanged');
    assert.deepEqual(store.all(), before);
  }
  assert.ok(store.commits.slice(1).every(writes => writes.length === 0));
});

for (const [name, change] of sourceChanges) {
  test(`watcher import jointly blocks both pending jobs and forms on ${name}, preserving original identity and audit`, async () => {
    const { store, order, keys } = await admitted();
    addForms(store, keys);
    const before = store.all(), audit = store.get(keys.audit);
    change(order);
    assert.equal((await importInstructorOrder(store.db, order, { apply: false, tracked: true, now: NOW })).status, 'review_required');
    assert.deepEqual(store.all(), before);
    assert.equal((await importInstructorOrder(store.db, order, { apply: true, tracked: true, now: NOW })).status, 'review_required');
    assertHeld(store, keys);
    assert.equal(store.get(keys.ledger).lastObservedFingerprint, orderFingerprint(order));
    assert.equal(store.get(keys.ledger).fingerprint, orderFingerprint(audit.order));
    assert.deepEqual(store.get(keys.audit), audit);
    assert.deepEqual(Object.keys(store.all()).sort(), Object.keys(before).sort());
    for (const row of keys.rows) {
      assert.equal(store.get(row.registration).lessonDate, LESSON_DATE);
      assert.equal(store.get(row.job).externalOrder.paidAmount, 70000);
      assert.equal(store.get(row.job).attempts, 0);
    }
    assert.equal(store.commits.at(-1).length, 7);
  });
}

test('reconciliation failure partway through joint blocking rolls back both people and all forms', async () => {
  const options = {}, { store, order, keys } = await admitted(options);
  addForms(store, keys);
  const before = store.all(), commits = store.commits.length;
  order.totalRefundedPrice = 70000;
  options.failWriteAt = 5;
  await assert.rejects(reconcileInstructorOrderAttendees(store.db, order, { apply: true, now: NOW }), /injected/);
  assert.deepEqual(store.all(), before);
  assert.equal(store.commits.length, commits);
  options.failWriteAt = 0;
  assert.equal((await reconcileInstructorOrderAttendees(store.db, order, { apply: true, now: NOW })).status, 'review_required');
  assertHeld(store, keys);
});

test('accepted/sent/unknown forms and native effects are not reset or replayed during a source hold', async () => {
  for (const status of ['accepted', 'sent', 'unknown', 'completed', 'processing']) {
    const { store, order, keys } = await admitted();
    addForms(store, keys, [status, status]);
    keys.rows.forEach(row => store.seed(row.job, { ...store.get(row.job), status,
      externalEffectStarted: true, providerRequestId: 'synthetic-accepted', attempts: 2 }));
    const preserved = keys.rows.map(row => [store.get(row.job), store.get(row.form)]);
    order.totalRefundedPrice = 70000;
    await reconcileInstructorOrderAttendees(store.db, order, { apply: true, now: NOW });
    keys.rows.forEach((row, index) => {
      assert.deepEqual(store.get(row.job), preserved[index][0]);
      assert.deepEqual(store.get(row.form), preserved[index][1]);
    });
    await assert.rejects(store.admit());
    assert.deepEqual(keys.rows.map(row => [store.get(row.job), store.get(row.form)]), preserved);
  }
});

for (const [name, tamper] of [
  ['manifest allocation', (store, keys) => {
    const ledger = store.get(keys.ledger); ledger.attendeeResolution.attendees[1].paidAmount = 140000; store.seed(keys.ledger, ledger);
  }],
  ['manifest fingerprint', (store, keys) => {
    const ledger = store.get(keys.ledger); ledger.attendeeResolution.sourceFingerprint = 'tampered'; store.seed(keys.ledger, ledger);
  }],
  ['manifest digest', (store, keys) => {
    const ledger = store.get(keys.ledger); ledger.attendeeResolution.resolutionKey = 'tampered'; store.seed(keys.ledger, ledger);
  }],
  ['sibling cancellation', (store, keys) => {
    const row = keys.rows[1]; store.seed(row.registration, { ...store.get(row.registration), status: 'cancelled', cancellation: { jobId: 'synthetic-cancel' } });
  }],
  ['lost sibling registration', (store, keys) => store.remove(keys.rows[1].registration)],
  ['sibling actual recipient', (store, keys) => {
    const row = keys.rows[1]; store.seed(row.registration, { ...store.get(row.registration), memberPhone: '01000000003' });
  }],
]) {
  test(`${name} fails source-helper read guard and jointly blocks surviving family work`, async () => {
    const { store, order, keys } = await admitted();
    addForms(store, keys);
    tamper(store, keys);
    const before = store.all(), writes = store.commits.length;
    await assert.rejects(verifyInstructorPaidOrder(store.db, store.get(keys.rows[0].job), { now: NOW, read: async () => clone(order) }));
    assert.deepEqual(store.all(), before);
    assert.equal(store.commits.length, writes);
    assert.equal((await reconcileInstructorOrderAttendees(store.db, order, { apply: true, now: NOW })).status, 'review_required');
    assert.equal(store.get(keys.ledger).status, 'review_required');
    for (const row of keys.rows) {
      assert.equal(store.get(row.job).status, 'review_required');
      assert.equal(store.get(row.form).status, 'send_review_required');
      const reg = store.get(row.registration);
      if (reg) {
        assert.equal(reg.externalOrderReviewRequired, true);
        assert.equal(reg.operatorChecks.paymentConfirmed, false);
      }
    }
    if (name === 'sibling cancellation') assert.equal(store.get(keys.rows[1].registration).status, 'cancelled');
    if (name === 'lost sibling registration') assert.equal(store.get(keys.rows[1].registration), undefined);
  });
}

test('manifest approval metadata and source remain bound and cannot be silently regenerated', () => {
  const order = fixture(), resolution = paths(order).resolution;
  assert.equal(validateInstructorOrderAttendeeResolution(order, resolution, { now: NOW }).paidAmount, 140000);
  for (const change of [
    value => { value.approval.actor = ''; }, value => { value.approval.basis = ''; },
    value => { value.approval.approvedAt = 'invalid'; },
    value => { value.approval.approvedAt = '2026-10-27T01:00:00Z'; },
  ]) {
    const tampered = clone(resolution); change(tampered);
    assert.throws(() => validateInstructorOrderAttendeeResolution(order, tampered, { now: NOW }));
  }
});

test('source helper reads the original order and both siblings, returning actual attendee and per-person payment only', async () => {
  const { store, order, keys } = await admitted();
  const row = keys.rows.find(value => value.memberPhone !== order.ordererCall), job = store.get(row.job);
  const before = store.all(), reads = [], start = store.reads.length;
  const result = await verifyInstructorPaidOrder(store.db, job, { now: NOW, read: async orderNo => {
    reads.push(orderNo); return clone(order);
  } });
  assert.deepEqual(reads, [ORDER_NO]);
  assert.equal(result.assessment.memberPhone, row.memberPhone);
  assert.equal(result.assessment.memberName, row.memberName);
  assert.notEqual(result.assessment.memberPhone, order.ordererCall);
  assert.equal(result.assessment.paidAmount, 70000);
  assert.equal(result.assessment.totalPaidAmount, 140000);
  assert.equal(result.order.ordererCall, order.ordererCall);
  assert.equal(result.order.totalPaymentPrice, 140000);
  assert.deepEqual(store.reads.slice(start).map(read => read.key).sort(), [keys.ledger, ...keys.rows.map(value => value.registration)].sort());
  assert.deepEqual(store.all(), before);
});

test('source helper never reads an external source for unrelated jobs or a preblocked/missing allocation', async () => {
  const store = mockDb();
  assert.equal(await verifyInstructorPaidOrder(store.db, {}, { now: NOW, read: unexpected }), null);
  for (const job of [{ externalOrderReviewRequired: true }, { operatorOrderAllocation: true },
    { externalOrder: { orderNo: ORDER_NO }, externalOrderReviewRequired: true }]) {
    await assert.rejects(verifyInstructorPaidOrder(store.db, job, { now: NOW, read: unexpected }));
  }
  assert.deepEqual(store.reads, []);
  assert.deepEqual(store.all(), {});
});

for (const [name, change] of sourceChanges) {
  test(`source helper rejects fresh ${name} before any writes`, async () => {
    const { store, order, keys } = await admitted(), before = store.all();
    change(order);
    for (const row of keys.rows) await assert.rejects(verifyInstructorPaidOrder(store.db, store.get(row.job),
      { now: NOW, read: async () => clone(order) }));
    assert.deepEqual(store.all(), before);
    assert.equal(store.commits.length, 1);
  });
}

for (const [name, tamper] of [
  ['buyer substituted for actual attendee', job => { job.memberPhone = '01000000001'; job.memberName = 'Synthetic Buyer'; }],
  ['total paid amount as personal amount', job => { job.externalOrder.paidAmount = 140000; }],
  ['changed source item', job => { job.externalOrder.itemNo = `${ORDER_NO}-other`; }],
  ['changed allocation key', job => { job.externalOrder.attendeeResolutionKey = 'tampered'; }],
  ['changed source order', job => { job.externalOrder.orderNo = '209901010000003'; }],
]) {
  test(`source helper fails closed for ${name}`, async () => {
    const { store, order, keys } = await admitted();
    const row = keys.rows.find(value => value.memberPhone !== order.ordererCall), job = store.get(row.job);
    tamper(job);
    const before = store.all();
    await assert.rejects(verifyInstructorPaidOrder(store.db, job, { now: NOW, read: async () => clone(order) }));
    assert.deepEqual(store.all(), before);
  });
}

test('source-helper read failure and missing or blocked ledger cannot create fallback work', async () => {
  for (const state of ['read failure', 'missing ledger', 'blocked ledger']) {
    const { store, order, keys } = await admitted();
    if (state === 'missing ledger') store.remove(keys.ledger);
    if (state === 'blocked ledger') store.seed(keys.ledger, { ...store.get(keys.ledger), status: 'review_required' });
    const before = store.all();
    await assert.rejects(verifyInstructorPaidOrder(store.db, store.get(keys.rows[0].job), { now: NOW,
      read: async () => { if (state === 'read failure') throw new Error('synthetic read unavailable'); return clone(order); } }));
    assert.deepEqual(store.all(), before);
  }
});

for (const [name, change] of [
  ['order number', ledger => { ledger.orderNo = '209901010000003'; }],
  ['item number', ledger => { ledger.itemNo = `${ORDER_NO}-other`; }],
  ['source fingerprint', ledger => { ledger.fingerprint = 'different-source'; }],
  ['payment total', ledger => { ledger.paymentAmount = 70000; }],
  ['missing registration ids', ledger => { delete ledger.registrationIds; }],
  ['partial registration ids', ledger => { ledger.registrationIds.pop(); }],
  ['duplicate registration ids', ledger => { ledger.registrationIds[1] = ledger.registrationIds[0]; }],
  ['foreign registration id', ledger => { ledger.registrationIds[1] = 'foreign-registration'; }],
]) {
  test(`source helper rejects tampered ledger ${name} without reading sibling records or writing`, async () => {
    const { store, order, keys } = await admitted(), ledger = store.get(keys.ledger);
    change(ledger);
    store.seed(keys.ledger, ledger);
    const before = store.all(), readStart = store.reads.length;
    await assert.rejects(verifyInstructorPaidOrder(store.db, store.get(keys.rows[0].job),
      { now: NOW, read: async () => clone(order) }), /원장/);
    assert.deepEqual(store.reads.slice(readStart).map(read => read.key), [keys.ledger]);
    assert.deepEqual(store.all(), before);
  });
}

async function watcher(t, store, order, { fresh = order, listed = true, issue = true } = {}) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'imweb-attendee-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, 'state.json');
  await writeFile(stateFile, JSON.stringify({
    fingerprints: { [ORDER_NO]: orderFingerprint(order) },
    watch: { [ORDER_NO]: Date.parse('2026-11-30T00:00:00Z') },
    issues: issue ? { [ORDER_NO]: '복수 상품·인원 또는 선물 주문은 실제 수강자 확인필요' } : {},
  }));
  const calls = [], alerts = [], statuses = [];
  const read = args => {
    calls.push(clone(args));
    if (args[0] === 'config') return { resolved_profile: { site_code: policy.siteCode, unit_code: policy.unitCode } };
    if (args[1] === 'list') return { data: { currentPage: 1, totalPage: 1, list: listed ? [clone(order)] : [] } };
    assert.deepEqual(args, ['order', 'get', ORDER_NO]);
    return { data: clone(fresh) };
  };
  const result = await syncImwebInstructorOrders(store.db, { apply: true, force: true, stateDir, read,
    recordStatus: async (_db, value) => statuses.push(value),
    notify: async value => alerts.push(value), attention: async (...args) => alerts.push(args) });
  await assert.rejects(access(path.join(stateDir, 'scan.lock')), { code: 'ENOENT' });
  return { result, state: JSON.parse(await readFile(stateFile, 'utf8')), calls, alerts, statuses };
}

test('scheduled watcher rechecks an unchanged raw fingerprint to clear a resolved multi-attendee issue', async t => {
  const { store, order } = await admitted(), before = store.all();
  const observed = await watcher(t, store, order);
  assert.equal(observed.result.ok, true);
  assert.equal(observed.result.items.length, 1);
  assert.equal(observed.result.items[0].status, 'unchanged');
  assert.equal(observed.result.items[0].attendeeResolutionVerified, true);
  assert.deepEqual(observed.state.issues, {});
  assert.equal(observed.calls.filter(args => args[1] === 'get').length, 1);
  assert.deepEqual(store.all(), before);
  assert.equal(observed.alerts.length, 0);
});

for (const [name, change] of sourceChanges) {
  test(`scheduled watcher detects ${name} from exact fresh read even when the list fingerprint is unchanged`, async t => {
    const { store, order, keys } = await admitted(), fresh = clone(order);
    addForms(store, keys);
    change(fresh);
    const observed = await watcher(t, store, order, { fresh });
    assert.equal(observed.result.ok, false);
    assert.equal(observed.result.items[0].status, 'review_required');
    assertHeld(store, keys);
    assert.equal(observed.state.fingerprints[ORDER_NO], orderFingerprint(fresh));
    assert.ok(observed.state.issues[ORDER_NO]);
    assert.equal(observed.calls.filter(args => args[1] === 'get').length, 1);
    assert.equal(globalThis.fetch.mock.callCount(), 0);
  });
}

test('watch list reconciles a now-nontarget product outside the recent listing without new admission', async t => {
  const { store, order, keys } = await admitted(), fresh = clone(order);
  addForms(store, keys, ['queued', 'pending']);
  item(fresh).productInfo.prodNo = 999;
  const before = Object.keys(store.all()).sort();
  const observed = await watcher(t, store, order, { fresh, listed: false, issue: false });
  assert.equal(observed.result.items[0].status, 'review_required');
  assert.equal(observed.calls.filter(args => args[1] === 'get').length, 2);
  assertHeld(store, keys);
  assert.deepEqual(Object.keys(store.all()).sort(), before);
});
