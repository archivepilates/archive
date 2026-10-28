import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeEach, test } from 'node:test';
import vm from 'node:vm';
import { reconcileInstructorOrderAttendees } from '../lib/imweb-instructor-order-attendees.mjs';
import {
  assertInstructorOrderAttendeeFamily, createInstructorOrderAttendeeResolution, orderFingerprint, orderLedgerId,
} from '../lib/imweb-instructor-order-policy.mjs';
import { deriveInstructorLessonRegistrationState, staleExternalActionStatus } from '../lib/instructor-lesson-registration-contract.mjs';

const NOW = new Date('2026-10-28T01:00:00.000Z');
const ORDER_NO = '209901010000028';
const PROGRESS_BLOCKED = 'INSTRUCTOR_ORDER_FAMILY_PROGRESS_BLOCKED';
const clone = value => structuredClone(value);

beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(globalThis, 'fetch', () => assert.fail('Network access forbidden in synthetic tests'));
});

function field(value, key) {
  return key.split('.').reduce((row, part) => row?.[part], value);
}

function patch(value, changes) {
  const result = clone(value);
  for (const [key, entry] of Object.entries(changes)) {
    const parts = key.split('.'), last = parts.pop();
    let parent = result;
    for (const part of parts) parent = parent[part] ??= {};
    parent[last] = clone(entry);
  }
  return result;
}

// Transactions stage changes in memory and reject reads after the first write.
function memoryStore(seed) {
  let rows = new Map(Object.entries(clone(seed)));
  const writes = [];
  const doc = path => ({ path, id: path.split('/').at(-1) });
  const snapshot = path => ({ ref: doc(path), exists: rows.has(path), data: () => clone(rows.get(path)) });
  const collection = (name, filters = []) => ({
    name, filters, doc: id => doc(`${name}/${id}`),
    where(key, operator, value) {
      assert.equal(operator, '==');
      return collection(name, [...filters, { key, value }]);
    },
  });
  const db = {
    collection,
    async runTransaction(callback) {
      const staged = clone(rows), pending = [];
      function write(kind, ref, changes, options) {
        if (kind === 'update') assert.ok(staged.has(ref.path), `Missing document: ${ref.path}`);
        const entry = { kind, path: ref.path, changes: clone(changes) };
        writes.push(entry);
        pending.push(entry);
        staged.set(ref.path, kind === 'update' || options?.merge
          ? patch(staged.get(ref.path) || {}, changes) : clone(changes));
      }
      const result = await callback({
        async get(ref) {
          assert.equal(pending.length, 0, 'Transaction read after write');
          if (ref.path) return snapshot(ref.path);
          const docs = [...rows].filter(([path, row]) => path.startsWith(`${ref.name}/`)
            && path.split('/').length === 2 && ref.filters.every(filter => field(row, filter.key) === filter.value))
            .map(([path]) => snapshot(path));
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
        update: (ref, changes) => write('update', ref, changes),
        set: (ref, changes, options) => write('set', ref, changes, options),
      });
      rows = staged;
      return result;
    },
  };
  return { db, writes, get: path => clone(rows.get(path)), all: () => clone(Object.fromEntries(rows)),
    seed: (path, value) => rows.set(path, clone(value)), remove: path => rows.delete(path) };
}

function fixture() {
  const order = {
    orderNo: ORDER_NO, ordererName: 'Synthetic Buyer', ordererCall: '01000000001',
    isGift: 'N', currency: 'KRW', saleChannel: 'IMWEB', orderType: 'SHOPPING', orderStatus: 'OPEN',
    totalPaymentPrice: 140000, totalDeliveryPrice: 0, totalPoint: 0,
    totalRefundPendingPrice: 0, totalRefundedPrice: 0, totalRefundPendingPoint: 0, totalRefundedPoint: 0,
    payments: [{ paymentStatus: 'PAYMENT_COMPLETE', isCancel: 'N', method: 'CARD', paidPrice: 140000,
      paymentCompleteTime: '2026-10-27T01:00:00.000Z' }],
    sections: [{ orderSectionStatus: 'SHIPPING_READY', returnInfo: { isRefund: 'N', isExchange: 'N' },
      sectionItems: [{ orderSectionItemNo: `${ORDER_NO}-1`, qty: 2,
        productInfo: { prodNo: 1, prodName: '[오프라인] ARCHIVE METHOD 강사레슨',
          optionInfo: { 수강일: '2026년 11월 28일(토)' } } }] }],
  };
  const resolution = createInstructorOrderAttendeeResolution(order, [
    { memberName: 'Synthetic Buyer', memberPhone: '01000000001' },
    { memberName: 'Synthetic Attendee', memberPhone: '01000000002' },
  ], { actor: 'synthetic-operator', basis: 'synthetic explicit two-attendee approval', now: NOW });
  const ledger = `imwebInstructorLessonOrders/${orderLedgerId(ORDER_NO)}`;
  const paths = resolution.attendees.map(a => ({
    registration: `instructorLessonRegistrations/${a.registrationId}`,
    native: `studiomateInstructorLessonJobs/${a.registrationId}`,
    form: `eformsignInstructorMemberJobs/${a.registrationId}`,
  }));
  const seed = { [ledger]: { orderNo: ORDER_NO, itemNo: resolution.itemNo, status: 'queued',
    fingerprint: orderFingerprint(order), paymentAmount: 140000,
    registrationIds: resolution.attendees.map(a => a.registrationId), attendeeResolution: resolution } };
  resolution.attendees.forEach((a, index) => {
    seed[paths[index].registration] = {
      registrationId: a.registrationId, studioId: resolution.studioId, memberName: a.memberName,
      memberPhone: a.memberPhone, lessonDate: resolution.lessonDate, mode: 'new_member', status: 'processing',
      ticketPrice: a.paidAmount, operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
      source: { type: 'imweb_paid_order', sourceId: ORDER_NO, itemNo: resolution.itemNo },
      externalOrder: { ...a, orderNo: ORDER_NO, itemNo: resolution.itemNo, lessonDate: resolution.lessonDate,
        attendeeResolutionKey: resolution.resolutionKey, totalPaidAmount: 140000 },
      steps: { member: { status: 'verified' }, ticket: { status: 'pending' },
        eformsign: { status: 'queued' }, memo: { status: 'waiting_external' }, confirmation: { status: 'pending' } },
    };
    seed[paths[index].native] = { registrationId: a.registrationId, status: 'retry', attempts: 2,
      currentStep: 'ticket', externalEffectStarted: false };
    seed[paths[index].form] = { registrationId: a.registrationId, status: 'pending', attempts: 1,
      externalEffectStarted: false };
  });
  return { order, ledger, paths, store: memoryStore(seed) };
}

function changeRegistration(f, index, change) {
  const path = f.paths[index].registration, row = f.store.get(path);
  change(row);
  f.store.seed(path, row);
}

function familyCheck(f) {
  return assertInstructorOrderAttendeeFamily(f.store.get(f.ledger).attendeeResolution,
    f.paths.map(row => f.store.get(row.registration)).filter(Boolean));
}

const isProgress = error => {
  assert.equal(error.code, PROGRESS_BLOCKED);
  return true;
};
const isHard = error => {
  assert.notEqual(error.code, PROGRESS_BLOCKED);
  return true;
};

async function reconcile(f, apply = true) {
  return reconcileInstructorOrderAttendees(f.store.db, f.order, { apply, now: NOW });
}

async function assertOperationalWait(f) {
  const before = f.store.all(), orderBefore = clone(f.order);
  for (const apply of [false, true, true]) {
    const result = await reconcile(f, apply);
    assert.equal(result.status, 'unchanged');
    assert.equal(result.attendeeResolutionVerified, true);
    assert.equal(result.operationalWait, true);
    assert.deepEqual(f.store.all(), before);
    assert.deepEqual(f.store.writes, []);
    assert.deepEqual(f.order, orderBefore);
  }
}

async function assertHardHold(f) {
  const before = f.store.all();
  const preview = await reconcile(f, false);
  assert.equal(preview.status, 'review_required');
  assert.notEqual(preview.operationalWait, true);
  assert.notEqual(preview.attendeeResolutionVerified, true);
  assert.deepEqual(f.store.all(), before);
  assert.deepEqual(f.store.writes, []);
  const result = await reconcile(f);
  assert.equal(result.status, 'review_required');
  assert.notEqual(result.operationalWait, true);
  assert.equal(f.store.get(f.ledger).status, 'review_required');
  assert.equal(f.store.get(f.ledger).attendeeResolution.status, 'blocked');
  assert.ok(f.store.writes.length > 0);
  for (const paths of f.paths) {
    const row = f.store.get(paths.registration);
    if (row) {
      assert.equal(row.externalOrderReviewRequired, true);
      assert.equal(row.operatorChecks.paymentConfirmed, false);
    }
    assert.equal(f.store.get(paths.native).status, 'review_required');
    assert.equal(f.store.get(paths.form).status, 'send_review_required');
  }
}

for (const index of [0, 1]) for (const status of ['failed', 'review_required', 'action_required']) {
  test(`attendee ${index} ${status} with unverified ticket stays rejected as typed progress, without reconciliation writes`, async () => {
    const f = fixture();
    changeRegistration(f, index, row => { row.status = status; row.steps.confirmation.status = 'review_required'; });
    assert.throws(() => familyCheck(f), isProgress);
    await assertOperationalWait(f);
  });
}

test('ordinary pending sibling progress remains eligible rather than a new family barrier', async () => {
  const f = fixture(), before = f.store.all();
  assert.equal(familyCheck(f), true);
  const result = await reconcile(f);
  assert.equal(result.status, 'unchanged');
  assert.equal(result.attendeeResolutionVerified, true);
  assert.notEqual(result.operationalWait, true);
  assert.deepEqual(f.store.all(), before);
  assert.deepEqual(f.store.writes, []);
});

for (const step of ['eformsign', 'memo', 'confirmation']) for (const status of ['failed', 'review_required']) {
  test(`verified member/ticket ${step} ${status} retains the existing downstream exception`, async () => {
    const f = fixture();
    changeRegistration(f, 0, row => {
      row.status = 'action_required';
      row.steps.ticket.status = 'verified';
      row.steps[step].status = status;
    });
    const before = f.store.all();
    assert.equal(familyCheck(f), true);
    const result = await reconcile(f);
    assert.equal(result.status, 'unchanged');
    assert.notEqual(result.operationalWait, true);
    assert.deepEqual(f.store.all(), before);
    assert.deepEqual(f.store.writes, []);
  });
}

const hardFamilyChanges = [
  ['cancelled sibling', row => { row.status = 'cancelled'; }],
  ['canceled sibling', row => { row.status = 'canceled'; }],
  ['rejected sibling', row => { row.status = 'rejected'; }],
  ['cancellation request', row => { row.cancellation = { jobId: 'synthetic-cancel' }; }],
  ['source review', row => { row.externalOrderReviewRequired = true; }],
  ['unknown status', row => { row.status = 'unknown'; }],
  ['missing status', row => { delete row.status; }],
  ['changed studio', row => { row.studioId = 'synthetic-other-studio'; }],
  ['changed name', row => { row.memberName = 'Different Synthetic Attendee'; }],
  ['changed phone', row => { row.memberPhone = '01000000009'; }],
  ['changed lesson date', row => { row.lessonDate = '2026-11-29'; }],
  ['changed source type', row => { row.source.type = 'imweb_order_review'; }],
  ['changed source order', row => { row.source.sourceId = '209901010000029'; }],
  ['missing order binding', row => { delete row.externalOrder; }],
  ['changed order binding', row => { row.externalOrder.orderNo = '209901010000029'; }],
  ['changed item binding', row => { row.externalOrder.itemNo += '-other'; }],
  ['changed allocation key', row => { row.externalOrder.attendeeResolutionKey = 'tampered'; }],
  ['changed bound name', row => { row.externalOrder.memberName = 'Different Synthetic Attendee'; }],
  ['changed bound phone', row => { row.externalOrder.memberPhone = '01000000009'; }],
  ['changed bound registration', row => { row.externalOrder.registrationId = 'synthetic-other-registration'; }],
  ['changed bound lesson date', row => { row.externalOrder.lessonDate = '2026-11-29'; }],
  ['changed total amount', row => { row.externalOrder.totalPaidAmount = 70000; }],
  ['changed personal amount', row => { row.externalOrder.paidAmount = 140000; }],
  ['changed ticket price', row => { row.ticketPrice = 140000; }],
  ['payment approval revoked', row => { row.operatorChecks.paymentConfirmed = false; }],
  ['seat approval revoked', row => { row.operatorChecks.seatConfirmed = false; }],
];

for (const [name, change] of hardFamilyChanges) {
  test(`first sibling progress cannot mask later hard ${name}`, async () => {
    const f = fixture();
    changeRegistration(f, 0, row => { row.status = 'failed'; });
    changeRegistration(f, 1, change);
    assert.throws(() => familyCheck(f), isHard);
    await assertHardHold(f);
    if (name === 'cancelled sibling') assert.equal(f.store.get(f.paths[1].registration).status, 'cancelled');
  });
}

test('first sibling progress cannot mask a missing second registration', async () => {
  const f = fixture();
  changeRegistration(f, 0, row => { row.status = 'action_required'; });
  f.store.remove(f.paths[1].registration);
  assert.throws(() => familyCheck(f), isHard);
  await assertHardHold(f);
  assert.equal(f.store.get(f.paths[1].registration), undefined);
});

for (const [name, change] of [
  ['refund', order => { order.totalRefundedPrice = 70000; }],
  ['pending refund', order => { order.totalRefundPendingPrice = 70000; }],
  ['refund points', order => { order.totalRefundedPoint = 1; }],
  ['payment cancellation', order => { order.payments[0].isCancel = 'Y'; }],
  ['order cancellation', order => { order.orderStatus = 'CANCEL'; }],
  ['return refund', order => { order.sections[0].returnInfo.isRefund = 'Y'; }],
  ['return exchange', order => { order.sections[0].returnInfo.isExchange = 'Y'; }],
  ['purchaser changed', order => { order.ordererCall = '01000000009'; }],
  ['quantity changed', order => { order.sections[0].sectionItems[0].qty = 1; }],
  ['lesson option changed', order => { order.sections[0].sectionItems[0].productInfo.optionInfo.수강일 = '2026년 11월 29일(일)'; }],
]) {
  test(`operational progress cannot downgrade fresh source ${name} into operationalWait`, async () => {
    const f = fixture();
    changeRegistration(f, 0, row => { row.status = 'review_required'; });
    change(f.order);
    await assertHardHold(f);
  });
}

for (const [name, change] of [
  ['existing ledger hold', ledger => { ledger.status = 'review_required'; }],
  ['changed ledger fingerprint', ledger => { ledger.fingerprint = 'tampered'; }],
  ['revoked manifest approval', ledger => { ledger.attendeeResolution.status = 'blocked'; }],
  ['missing manifest', ledger => { delete ledger.attendeeResolution; }],
  ['changed manifest digest', ledger => { ledger.attendeeResolution.resolutionKey = 'tampered'; }],
  ['changed manifest allocation', ledger => { ledger.attendeeResolution.attendees[1].paidAmount = 140000; }],
  ['missing approval actor', ledger => { ledger.attendeeResolution.approval.actor = ''; }],
]) {
  test(`operational progress never overrides ${name}`, async () => {
    const f = fixture();
    changeRegistration(f, 0, row => { row.status = 'failed'; });
    const ledger = f.store.get(f.ledger);
    change(ledger);
    f.store.seed(f.ledger, ledger);
    if (name === 'missing manifest') {
      const before = f.store.all();
      await assert.rejects(reconcile(f), isHard);
      assert.deepEqual(f.store.all(), before);
      assert.deepEqual(f.store.writes, []);
    } else await assertHardHold(f);
  });
}

for (const status of ['accepted', 'unknown', 'waiting_completion']) {
  test(`operationalWait preserves ${status} form and native evidence without resetting or replaying`, async () => {
    const f = fixture();
    changeRegistration(f, 0, row => { row.status = 'action_required'; });
    for (const paths of f.paths) {
      for (const path of [paths.form, paths.native]) f.store.seed(path, {
        ...f.store.get(path), status, attempts: 3, externalEffectStarted: true,
        effectStartedAt: NOW, sendClickedAt: NOW, sentAt: NOW,
        documentId: 'synthetic-existing-document', providerRequestId: 'synthetic-existing-request',
        claimToken: 'synthetic-owned-claim',
      });
    }
    await assertOperationalWait(f);
  });
}

test('fresh verification after sibling progress clears needs no approval, amount or job reset', async () => {
  const f = fixture();
  changeRegistration(f, 0, row => { row.status = 'action_required'; row.steps.confirmation.status = 'review_required'; });
  await assertOperationalWait(f);
  changeRegistration(f, 0, row => { row.steps.ticket.status = 'verified'; });
  const before = f.store.all();
  assert.equal(familyCheck(f), true);
  const result = await reconcile(f);
  assert.equal(result.status, 'unchanged');
  assert.equal(result.attendeeResolutionVerified, true);
  assert.notEqual(result.operationalWait, true);
  assert.deepEqual(f.store.all(), before);
  assert.deepEqual(f.store.writes, []);
});

const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
const workerSource = ts.createSourceFile('eform-worker.mjs',
  readFileSync(new URL('../process-eformsign-instructor-member-jobs.mjs', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

// Evaluate selected declarations only; importing the worker would start its production entry point.
function workerApi(names, globals) {
  const declarations = names.map(name => {
    const node = workerSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, `Missing worker declaration: ${name}`);
    return node.getText(workerSource);
  });
  return vm.runInNewContext(`${declarations.join('\n')}\n({${names.join(',')}})`, {
    Date, FieldValue: { serverTimestamp: () => NOW.toISOString() },
    deriveInstructorLessonRegistrationState, staleExternalActionStatus, ...globals,
  });
}

function deferralFixture() {
  const f = fixture(), target = f.paths[0];
  const claimed = { ...f.store.get(target.form), status: 'processing', claimToken: 'synthetic-owned', attempts: 4 };
  f.store.seed(target.form, claimed);
  changeRegistration(f, 0, row => {
    row.status = 'waiting_signature';
    row.steps.ticket.status = 'verified';
    row.steps.eformsign.status = 'processing';
    row.steps.confirmation = { status: 'verified', detail: 'Synthetic existing confirmation' };
    row.evidence = { ticketId: 'synthetic-ticket' };
  });
  const api = workerApi(['deferFamilyProgress', 'deriveRegistrationPatch', 'stepValue'], { db: f.store.db });
  return { ...f, target, claimed, defer: () => api.deferFamilyProgress(f.store.db.collection('eformsignInstructorMemberJobs')
    .doc(target.form.split('/').at(-1)), claimed) };
}

for (const status of ['cancelled', 'canceled', 'rejected', 'completed', 'failed', 'review_required', 'unknown', undefined]) {
  test(`family deferral never replaces concurrent registration status ${String(status)} without a cancellation object`, async () => {
    const f = deferralFixture();
    changeRegistration(f, 0, row => { row.status = status; delete row.cancellation; });
    const before = f.store.all();
    await assert.rejects(f.defer());
    assert.deepEqual(f.store.all(), before);
    assert.deepEqual(f.store.writes, []);
  });
}

for (const [name, value] of [
  ['externalEffectStarted', true], ['effectStartedAt', NOW], ['sendStartedAt', NOW], ['sendClickedAt', NOW],
  ['sentAt', NOW], ['documentId', 'synthetic-existing-document'], ['documentUrl', 'https://example.invalid/document'],
  ['providerMessageId', 'synthetic-accepted-message'], ['completedAt', NOW],
]) {
  test(`family deferral preserves concurrent job ${name} evidence instead of making it pending`, async () => {
    const f = deferralFixture();
    f.store.seed(f.target.form, { ...f.store.get(f.target.form), [name]: value });
    const before = f.store.all();
    await assert.rejects(f.defer());
    assert.deepEqual(f.store.all(), before);
    assert.deepEqual(f.store.writes, []);
  });
}

for (const [name, change] of [
  ['registration document evidence', row => { row.evidence.eformsignDocumentId = 'synthetic-existing-document'; }],
  ...['sent', 'verified', 'waiting_completion'].map(status =>
    [`registration eform ${status}`, row => { row.steps.eformsign.status = status; }]),
]) {
  test(`family deferral preserves concurrent ${name}`, async () => {
    const f = deferralFixture();
    changeRegistration(f, 0, change);
    const before = f.store.all();
    await assert.rejects(f.defer());
    assert.deepEqual(f.store.all(), before);
    assert.deepEqual(f.store.writes, []);
  });
}

test('unattempted owned family deferral returns the consumed attempt and preserves unrelated confirmation/evidence', async () => {
  const f = deferralFixture(), before = f.store.get(f.target.registration);
  const siblingBefore = f.store.get(f.paths[1].form);
  await f.defer();
  const job = f.store.get(f.target.form), registration = f.store.get(f.target.registration);
  assert.equal(job.status, 'pending');
  assert.equal(job.attempts, 3);
  assert.equal(job.claimToken, null);
  assert.equal(job.sourceWaitCode, PROGRESS_BLOCKED);
  assert.equal(job.nextSourceCheckAt.getTime(), NOW.getTime() + 5 * 60 * 1000);
  assert.equal(registration.status, 'waiting_signature');
  assert.equal(registration.steps.eformsign.status, 'queued');
  for (const key of ['confirmation', 'member', 'ticket']) assert.deepEqual(registration.steps[key], before.steps[key]);
  for (const key of ['evidence', 'source', 'externalOrder', 'operatorChecks']) assert.deepEqual(registration[key], before[key]);
  assert.deepEqual(f.store.get(f.paths[1].form), siblingBefore);
  assert.deepEqual(f.store.writes.map(write => write.path), [f.target.form, f.target.registration]);
});

function staleRecoveryFixture(status) {
  const f = fixture(), target = f.paths[0], targetId = target.form.split('/').at(-1);
  const oldTime = new Date(NOW.getTime() - 16 * 60 * 1000);
  const stale = { ...f.store.get(target.form), status, claimToken: 'synthetic-stale-claim',
    attempts: 2, maxAttempts: 3, updatedAt: oldTime, claimedAt: oldTime,
    externalEffectStarted: status === 'sending' };
  f.store.seed(target.form, stale);
  f.store.seed(f.paths[1].form, { ...stale, registrationId: f.paths[1].form.split('/').at(-1) });
  const directReads = [];
  // The initial GET returns the old scan; transactional reads see the independently changed store.
  const db = { ...f.store.db, collection(name) {
    const collection = f.store.db.collection(name);
    return { ...collection, doc(id) {
      const ref = collection.doc(id);
      return { ...ref, async get() {
        assert.equal(name, 'eformsignInstructorMemberJobs');
        assert.equal(id, targetId);
        directReads.push(ref.path);
        return { exists: true, ref, data: () => clone(stale) };
      } };
    } };
  } };
  const api = workerApi(['recoverStaleJobs', 'updateFailureState', 'timestampMillis', 'deriveRegistrationPatch', 'stepValue'], {
    db, config: { jobId: targetId, staleLeaseMs: 15 * 60 * 1000 },
  });
  return { ...f, target, stale, directReads, recover: () => api.recoverStaleJobs() };
}

for (const status of ['checking_completion', 'processing', 'sending']) {
  for (const [name, change] of [
    ['completed after scan', row => ({ ...row, status: 'done', claimToken: null, sentAt: NOW, documentId: 'synthetic-completed-document' })],
    ['changed claim token', row => ({ ...row, claimToken: 'synthetic-new-owner' })],
    ['cleared claim token', row => ({ ...row, claimToken: null })],
    ['fresh updated timestamp', row => ({ ...row, updatedAt: NOW })],
    ['fresh claimed timestamp fallback', row => { const current = { ...row, claimedAt: NOW }; delete current.updatedAt; return current; }],
    ['deleted after scan', () => undefined],
  ]) {
    test(`exact-target stale ${status} recovery leaves ${name} untouched`, async () => {
      const f = staleRecoveryFixture(status), changed = change(f.store.get(f.target.form));
      if (changed) f.store.seed(f.target.form, changed);
      else f.store.remove(f.target.form);
      const before = f.store.all();
      await f.recover();
      assert.deepEqual(f.directReads, [f.target.form]);
      assert.deepEqual(f.store.all(), before);
      assert.deepEqual(f.store.writes, []);
    });
  }

  test(`exact-target unchanged stale ${status} recovers only its intended row`, async () => {
    const f = staleRecoveryFixture(status), before = f.store.all();
    await f.recover();
    const recovered = f.store.get(f.target.form);
    assert.equal(recovered.status, status === 'checking_completion' ? 'waiting_completion'
      : status === 'sending' ? 'send_review_required' : 'retry');
    assert.equal(recovered.claimToken, null);
    assert.equal(recovered.attempts, f.stale.attempts);
    assert.equal(recovered.externalEffectStarted, f.stale.externalEffectStarted);
    assert.deepEqual(f.directReads, [f.target.form]);
    const allowed = new Set([f.target.form, ...(status === 'checking_completion' ? [] : [f.target.registration])]);
    for (const write of f.store.writes) assert.ok(allowed.has(write.path), `Unexpected recovery write: ${write.path}`);
    for (const [path, value] of Object.entries(before)) {
      if (!allowed.has(path)) assert.deepEqual(f.store.get(path), value);
    }
    assert.ok(f.store.writes.length > 0);
  });
}
