import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { beforeEach, test } from 'node:test';
import { assessInstructorOrder, createInstructorOrderAttendeeResolution, orderLedgerId, orderFingerprint } from '../lib/imweb-instructor-order-policy.mjs';
import { verifyInstructorPaidOrder } from '../lib/imweb-instructor-order-source.mjs';
import { assertOrderContactBinding, buildOrderContactBinding } from '../lib/instructor-signup-order-identity.mjs';
import { memberDispatchWindow, assertMemberDispatchAllowed, isMemberDispatchDeferred, MemberDispatchDeferredError } from '../lib/member-dispatch-window.mjs';
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID, INSTRUCTOR_LESSON_TICKET_NAME,
  INSTRUCTOR_LESSON_TICKET_PRICE, normalizeInstructorLessonName, normalizeInstructorLessonPhone,
  staleExternalActionStatus } from '../lib/instructor-lesson-registration-contract.mjs';

const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
const NOW = new Date('2026-10-26T01:00:00.000Z');
const NIGHT = Date.parse('2026-10-26T14:00:00.000Z');
const NEXT = '2026-10-27T00:00:00.000Z';
const ORDER = '209901010000001', DOC = 'a'.repeat(32);
const WORKER = 'process-instructor-lesson-registration-jobs.mjs';
const EFORM = 'process-eformsign-instructor-member-jobs.mjs';
const unexpected = () => assert.fail('Unmocked external operation forbidden');
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: NOW }));

function parsed(file) {
  return ts.createSourceFile(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}
function declaration(tree, name) {
  const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `Missing ${name}`);
  return node;
}
function evaluate(tree, names, globals) {
  return vm.runInNewContext(`${names.map(n => declaration(tree, n).getText(tree)).join('\n')}\n({${names.join(',')}})`, { Date, ...globals });
}
function findNode(node, predicate) {
  if (predicate(node)) return node;
  let found;
  ts.forEachChild(node, child => { found ||= findNode(child, predicate); });
  return found;
}

// Workers are never imported or run. Only selected declarations execute against this store.
function memoryDb(initial = {}) {
  const rows = new Map(Object.entries(structuredClone(initial))), writes = [];
  const deleted = Symbol('delete');
  const snap = path => ({ exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const db = {
    rows, writes,
    fieldValue: { delete: () => deleted, serverTimestamp: () => 'synthetic-stamp' },
    doc: path => ({ path, id: path.split('/').at(-1), get: async () => snap(path) }),
    collection: name => ({ doc: id => db.doc(`${name}/${id}`) }),
    async runTransaction(callback) {
      const pending = [];
      const result = await callback({ get: async ref => snap(ref.path),
        set: (ref, patch) => pending.push([ref.path, patch]), update: (ref, patch) => pending.push([ref.path, patch]) });
      for (const [path, patch] of pending) {
        const row = rows.get(path) || {};
        for (const [key, value] of Object.entries(patch)) {
          const parts = key.split('.'), last = parts.pop();
          let target = row;
          for (const part of parts) target = target[part] ??= {};
          if (value === deleted) delete target[last]; else target[last] = structuredClone(value);
        }
        rows.set(path, row); writes.push([path, patch]);
      }
      return result;
    },
  };
  return db;
}

function fixture({ quantity = 2 } = {}) {
  const order = {
    orderNo: ORDER, ordererName: 'Synthetic Buyer', ordererCall: '01000000001', isGift: 'N',
    currency: 'KRW', saleChannel: 'IMWEB', orderType: 'SHOPPING', orderStatus: 'OPEN',
    totalPaymentPrice: quantity * 70000, totalDeliveryPrice: 0, totalPoint: 0, totalRefundPendingPrice: 0,
    totalRefundedPrice: 0, totalRefundPendingPoint: 0, totalRefundedPoint: 0,
    payments: [{ paymentStatus: 'PAYMENT_COMPLETE', isCancel: 'N', method: 'CARD', paidPrice: quantity * 70000,
      paymentCompleteTime: '2026-10-25T01:00:00Z' }],
    sections: [{ orderSectionStatus: 'SHIPPING_READY', returnInfo: { isRefund: 'N', isExchange: 'N' },
      sectionItems: [{ orderSectionItemNo: `${ORDER}-1`, qty: quantity, productInfo: { prodNo: 1,
        prodName: '[오프라인] ARCHIVE METHOD 강사레슨', optionInfo: { 수강일: '2026년 11월 28일(토)' } } }] }],
  };
  const base = assessInstructorOrder(order, { now: NOW });
  const resolution = quantity === 2 ? createInstructorOrderAttendeeResolution(order, [
    { memberName: order.ordererName, memberPhone: order.ordererCall },
    { memberName: 'Synthetic Attendee', memberPhone: '01000000002' },
  ], { actor: 'synthetic-operator', basis: 'synthetic explicit approval', now: NOW }) : undefined;
  const attendees = resolution?.attendees || [base];
  const registrations = attendees.map(a => ({
    registrationId: a.registrationId, studioId: '5330', memberName: a.memberName, memberPhone: a.memberPhone,
    lessonDate: base.lessonDate, studiomateMemberId: '123456', mode: 'new_member', ticketPrice: 70000,
    status: 'processing', source: { type: 'imweb_paid_order', sourceId: ORDER, itemNo: base.itemNo },
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true }, evidence: { eformsignDocumentId: DOC },
    externalOrder: { ...base, ...a, status: 'ready', ...(resolution ? {
      attendeeResolutionKey: resolution.resolutionKey, totalPaidAmount: resolution.totalPaidAmount,
    } : {}) }, steps: { member: { status: 'verified' }, ticket: { status: 'pending' } },
  }));
  const registration = registrations.find(r => r.memberPhone !== order.ordererCall) || registrations[0];
  const job = { ...registration, documentId: DOC, sentAt: '2026-10-25T01:00:00Z',
    status: 'pending', currentStep: 'ticket', attempts: 2, maxAttempts: 5, ticketId: '456', externalEffectStarted: false };
  const registrationPath = `instructorLessonRegistrations/${job.registrationId}`;
  const jobPath = `studiomateInstructorLessonJobs/${job.registrationId}`;
  const db = memoryDb({ ...Object.fromEntries(registrations.map(r => [`instructorLessonRegistrations/${r.registrationId}`, r])),
    [`imwebInstructorLessonOrders/${orderLedgerId(ORDER)}`]: {
      orderNo: ORDER, itemNo: base.itemNo, registrationId: base.registrationId,
      ...(resolution ? { registrationIds: attendees.map(a => a.registrationId), attendeeResolution: resolution } : {}),
      fingerprint: orderFingerprint(order), paymentAmount: order.totalPaymentPrice,
      status: 'queued', reason: 'synthetic verified paid order', lastVerifiedAt: NOW, updatedAt: NOW,
    },
    [jobPath]: job });
  let reads = 0;
  const verify = async (store, value) => verifyInstructorPaidOrder(store, value, { now: NOW,
    read: async orderNo => { assert.equal(orderNo, ORDER); reads++; return order; } });
  const member = { status: 'verified', member: { memberId: '123456', name: job.memberName, phone: job.memberPhone } };
  const document = { documentId: DOC, selectedDocumentId: DOC, templateId: INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID,
    status: 'completed', recipients: [{ name: job.memberName, phone: job.memberPhone }], observedAt: NOW.toISOString() };
  return { order, attendeeResolution: resolution, registrations, registration, job, jobPath, registrationPath,
    db, verify, reads: () => reads, member, document, submittedPhone: '01000000003', now: NOW };
}

test('single-order binding remains compatible; allocated binding uses actual attendee without rewriting purchaser', async () => {
  for (const quantity of [1, 2]) {
    const f = fixture({ quantity }), before = structuredClone(f.order);
    const verified = await f.verify(f.db, f.job);
    assert.equal(verified.assessment.paidAmount, 70000);
    const binding = buildOrderContactBinding({ ...f, ...verified });
    assert.equal(binding.canonicalPhone, f.job.memberPhone);
    assert.equal(binding.memberName, f.job.memberName);
    assert.equal(binding.attendeeResolutionKey, f.attendeeResolution?.resolutionKey);
    assert.equal(assertOrderContactBinding(binding, f.job, f.submittedPhone, f.registration), f.job.memberPhone);
    if (quantity === 2) assert.notEqual(binding.canonicalPhone, f.order.ordererCall);
    assert.deepEqual(f.order, before);
  }
});

for (const marker of ['orderAllocation', 'operatorOrderAllocation', 'quantity', 'totalPaidAmount', 'ledger manifest', 'ledger registrationIds']) {
  test(`missing allocation key cannot fall back to a changed single-order source: ${marker}`, async () => {
    const f = fixture(), effects = [];
    f.order.sections[0].sectionItems[0].qty = 1;
    f.order.totalPaymentPrice = 70000;
    f.order.payments[0].paidPrice = 70000;
    const single = assessInstructorOrder(f.order, { now: NOW });
    assert.equal(single.status, 'ready', 'The raw source alone must permit the unsafe single-order fallback');
    const buyer = f.registrations.find(r => r.memberPhone === f.order.ordererCall);
    const job = { ...f.job, ...buyer, externalOrder: { ...single }, nativeDispatch: { attempted: false } };
    const ledger = f.db.rows.get(`imwebInstructorLessonOrders/${orderLedgerId(ORDER)}`);
    const manifest = ledger.attendeeResolution, ids = ledger.registrationIds;
    delete ledger.attendeeResolution;
    delete ledger.registrationIds;
    Object.assign(ledger, { fingerprint: orderFingerprint(f.order), paymentAmount: 70000 });
    if (marker === 'orderAllocation' || marker === 'operatorOrderAllocation') job[marker] = { resolutionKey: manifest.resolutionKey };
    if (marker === 'quantity') job.externalOrder.quantity = 2;
    if (marker === 'totalPaidAmount') job.externalOrder.totalPaidAmount = 140000;
    if (marker === 'ledger manifest') ledger.attendeeResolution = manifest;
    if (marker === 'ledger registrationIds') ledger.registrationIds = ids;
    assert.equal(job.externalOrder.attendeeResolutionKey, undefined);
    f.db.rows.set(`instructorLessonRegistrations/${job.registrationId}`, job);
    let ready = false;
    await assert.rejects(f.verify(f.db, job).then(result => {
      ready = result?.assessment.status === 'ready';
      return result;
    }), /승인키 누락/);
    assert.equal(ready, false);
    assert.equal(f.reads(), marker.startsWith('ledger ') ? 1 : 0);

    const button = { click: async () => effects.push('native-click') };
    for (const name of ['createInstructorMember', 'issueInstructorLessonTicket']) {
      const run = vm.runInNewContext(`(async()=>{${nativeBoundary(parsed(WORKER), name)}})`, {
        db: f.db, job, ref: {}, verifyInstructorPaidOrder: f.verify,
        assertMemberDispatchAllowed: () => assertMemberDispatchAllowed(NOW),
        startExternalEffect: async () => effects.push('native-effect-prepared'),
        page: { getByRole: () => button, waitForResponse: async () => ({}) }, dialog: { getByRole: () => button },
      });
      await assert.rejects(run(), /승인키 누락/);
      assert.equal(job.nativeDispatch.attempted, false);
    }
    const sendGuard = finalEformGuard({ db: f.db, candidate: { ref: { id: job.registrationId } }, claimed: job,
      verifyInstructorPaidOrder: f.verify, normalizeInstructorLessonPhone, normalizeInstructorLessonName,
      INSTRUCTOR_LESSON_TICKET_PRICE, positiveMoney: Number, assertMemberDispatchAllowed: () => assertMemberDispatchAllowed(NOW),
      markSending: async () => effects.push('eform-send-prepared'), finalSendClicked: false });
    await assert.rejects(sendGuard(), /승인키 누락/);
    assert.deepEqual(effects, []);
    assert.equal(f.db.writes.length, 0);
  });
}

for (const issue of ['missing manifest', 'changed source', 'purchaser recipient', 'missing binding key', 'changed registration key']) {
  test(`allocated contact binding fails closed: ${issue}`, () => {
    const f = fixture();
    if (issue === 'missing manifest') { delete f.attendeeResolution; assert.throws(() => buildOrderContactBinding(f)); }
    if (issue === 'changed source') { f.order.totalRefundedPrice = 1; assert.throws(() => buildOrderContactBinding(f)); }
    if (issue === 'purchaser recipient') {
      f.document.recipients[0] = { name: f.order.ordererName, phone: f.order.ordererCall };
      assert.throws(() => buildOrderContactBinding(f));
    }
    if (issue === 'missing binding key' || issue === 'changed registration key') {
      const binding = buildOrderContactBinding(f);
      if (issue === 'missing binding key') delete binding.attendeeResolutionKey;
      else f.registration.externalOrder.attendeeResolutionKey = 'b'.repeat(64);
      assert.throws(() => assertOrderContactBinding(binding, f.job, f.submittedPhone, f.registration));
    }
  });
}

function nativeBoundary(tree, name) {
  const statements = [...declaration(tree, name).body.statements];
  const mark = statements.findIndex(n => n.getText(tree).includes('await startExternalEffect('));
  const click = statements.findIndex((n, i) => i > mark && n.getText(tree).includes('.click()'));
  assert.ok(mark >= 2 && click > mark);
  assert.match(statements[mark - 2].getText(tree), /await verifyInstructorPaidOrder\(db, job\)/);
  return statements.slice(mark - 2, click + 1).map(n => n.getText(tree)).join('\n');
}

for (const name of ['createInstructorMember', 'issueInstructorLessonTicket']) {
  for (const issue of ['blocked sibling', 'cancelled sibling', 'refunded source', 'changed source', 'cutoff after read', 'cutoff after mark', 'allowed']) {
    test(`${name} last-mile allocation/quiet-hour guard: ${issue}`, async () => {
      const f = fixture(), tree = parsed(WORKER), calls = [];
      const sibling = f.registrations.find(r => r.registrationId !== f.job.registrationId);
      if (issue === 'blocked sibling') f.db.rows.get(`instructorLessonRegistrations/${sibling.registrationId}`).externalOrderReviewRequired = true;
      if (issue === 'cancelled sibling') f.db.rows.get(`instructorLessonRegistrations/${sibling.registrationId}`).status = 'cancelled';
      if (issue === 'refunded source') f.order.totalRefundedPrice = 70000;
      if (issue === 'changed source') f.order.ordererName = 'Changed Buyer';
      let clock = NOW.getTime();
      const job = { ...f.job, nativeDispatch: { attempted: false } };
      const button = { click: async () => { calls.push('click'); } };
      const run = vm.runInNewContext(`(async()=>{${nativeBoundary(tree, name)}})`, {
        db: f.db, job, ref: {},
        verifyInstructorPaidOrder: async (...args) => { calls.push('verify'); await f.verify(...args); if (issue === 'cutoff after read') clock = NIGHT; },
        assertMemberDispatchAllowed: () => assertMemberDispatchAllowed(clock),
        startExternalEffect: async () => { calls.push('mark'); if (issue === 'cutoff after mark') clock = NIGHT; },
        page: { getByRole: () => button, waitForResponse: async () => ({}) }, dialog: { getByRole: () => button },
      });
      if (issue === 'allowed') { await run(); assert.deepEqual(calls, ['verify', 'mark', 'click']); assert.equal(job.nativeDispatch.attempted, true); }
      else {
        await assert.rejects(run(), issue.startsWith('cutoff') ? isMemberDispatchDeferred : undefined);
        assert.equal(calls.includes('click'), false); assert.equal(job.nativeDispatch.attempted, false);
        assert.equal(calls.includes('mark'), issue === 'cutoff after mark');
      }
    });
  }
}

function queueApi(f, clock) {
  return evaluate(parsed(WORKER), ['claimJob', 'restoreFields', 'deferClaim', 'startExternalEffect', 'commitClaimedState'], {
    db: f.db, registration: id => f.db.collection('instructorLessonRegistrations').doc(id), FieldValue: f.db.fieldValue,
    Timestamp: { fromMillis: ms => new Date(ms).toISOString() }, timestampMillis: value => Date.parse(value) || 0,
    memberDispatchWindow: () => memberDispatchWindow(clock()), randomUUID: () => 'synthetic-claim',
    os: { hostname: () => 'synthetic-host' }, process: { pid: 1 },
    stepValue: (status, label, detail) => ({ status, label, detail }), stepLabel: name => name,
    registrationStepName: name => name,
  });
}

test('native queue defers before claim without consuming an attempt or altering approval/canonical source', async () => {
  const f = fixture(), before = structuredClone(f.db.rows.get(f.registrationPath));
  const api = queueApi(f, () => NIGHT), ref = f.db.doc(f.jobPath);
  assert.equal(await api.claimJob(ref), null);
  const job = f.db.rows.get(f.jobPath);
  assert.equal(job.status, 'pending'); assert.equal(job.attempts, 2); assert.equal(job.claimToken, undefined);
  assert.equal(job.nextRunAt, NEXT); assert.equal(job.nextAllowedAt, NEXT);
  assert.deepEqual(f.db.rows.get(f.registrationPath), before);
  assert.equal(f.reads(), 0);
});

test('existing native effect traces cannot be reclaimed or replayed', async () => {
  const f = fixture(), api = queueApi(f, () => NOW.getTime()), ref = f.db.doc(f.jobPath);
  Object.assign(f.db.rows.get(f.jobPath), { externalEffectStarted: true, effectStartedAt: 'ambiguous-native-result' });
  assert.equal((await api.claimJob(ref)).blocked, true);
  assert.equal(f.db.rows.get(f.jobPath).status, 'review_required');
  assert.equal(f.db.rows.get(f.jobPath).attempts, 2);
  assert.equal(await api.claimJob(ref), null);
});

test('native quiet crossing restores unattempted claim and preserves verified prior member, then resumes after 09:00', async t => {
  const f = fixture(); let clock = NOW.getTime();
  const api = queueApi(f, () => clock), ref = f.db.doc(f.jobPath);
  const claimed = await api.claimJob(ref);
  await api.startExternalEffect(ref, claimed.claimToken, 'ticket', 'ticket_issue');
  clock = NIGHT;
  await api.deferClaim(ref, claimed, NEXT);
  const job = f.db.rows.get(f.jobPath), reg = f.db.rows.get(f.registrationPath);
  assert.equal(job.status, 'pending'); assert.equal(job.attempts, 2); assert.equal(job.claimToken, undefined);
  assert.equal(job.externalEffectStarted, false); assert.equal(job.effectStartedAt, null);
  assert.equal(job.nextRunAt, NEXT); assert.equal(job.dispatchDeferrals[0].providerPostCount, 0);
  assert.equal(job.dispatchDeferrals[0].deferredStep, 'ticket');
  assert.deepEqual(reg.steps.member, { status: 'verified' }); assert.equal(reg.steps.ticket.status, 'pending');
  assert.equal(reg.studiomateMemberId, '123456'); assert.deepEqual(reg.externalOrder, f.registration.externalOrder);
  assert.equal(await api.claimJob(ref), null);
  clock = Date.parse(NEXT);
  t.mock.timers.setTime(clock);
  assert.equal((await api.claimJob(ref)).attempts, 3);
});

test('quiet rollback never overwrites another claim or a concurrent cancellation/review', async () => {
  for (const issue of ['claim', 'cancellation', 'review']) {
    const f = fixture(), api = queueApi(f, () => NOW.getTime()), ref = f.db.doc(f.jobPath);
    const claimed = await api.claimJob(ref);
    if (issue === 'claim') f.db.rows.get(f.jobPath).claimToken = 'another-worker';
    else Object.assign(f.db.rows.get(f.registrationPath), issue === 'cancellation'
      ? { cancellation: { jobId: 'synthetic-cancel' } } : { externalOrderReviewRequired: true });
    const before = structuredClone(f.db.rows.get(f.registrationPath));
    if (issue === 'claim') await assert.rejects(api.deferClaim(ref, claimed, NEXT), /claim_changed/);
    else await api.deferClaim(ref, claimed, NEXT);
    assert.deepEqual(f.db.rows.get(f.registrationPath), before);
  }
});

test('an attempted native action is never rolled back as an unsent quiet deferral', async () => {
  const f = fixture(), summary = { processed: 0, reviewRequired: 0, failed: 0, jobs: [] }, failures = [];
  const { runCandidate } = evaluate(parsed(WORKER), ['runCandidate'], {
    config: { simulateNewMemberTest: false }, summary, normalizeInstructorLessonPhone,
    claimJob: async () => ({ ...f.job, claimToken: 'owned' }), verifyInstructorPaidOrder: f.verify, db: f.db,
    processStudioMateRegistration: async (_page, _ref, job) => {
      job.nativeDispatch.attempted = true;
      Object.assign(f.db.rows.get(f.jobPath), { externalEffectStarted: true, effectStartedAt: 'started', claimToken: 'owned' });
      throw new MemberDispatchDeferredError(NIGHT);
    },
    isMemberDispatchDeferred, memberDispatchWindow: () => memberDispatchWindow(NIGHT), deferClaim: unexpected,
    staleExternalActionStatus, markFailure: async (_ref, _job, _message, status) => failures.push(status),
  });
  await runCandidate({ ref: f.db.doc(f.jobPath) }, {});
  assert.deepEqual(failures, ['review_required']); assert.equal(summary.reviewRequired, 1);
});

for (const amount of [70000, 140000]) test(`existing-ticket adoption checks allocated ${amount} amount and never issues another ticket`, async () => {
  const f = fixture(), steps = [], calls = [];
  const { processStudioMateRegistration } = evaluate(parsed(WORKER), ['processStudioMateRegistration'], {
    db: f.db, verifyInstructorPaidOrder: async (...args) => { calls.push('verify'); return f.verify(...args); },
    openMemberDetail: async () => {}, findActiveInstructorTicket: async () => ({ ticketId: '456', text: `결제 금액 ${amount}원` }),
    completeStep: async (_ref, _claim, step, values) => steps.push([step, values]),
    preparePostTicketSteps: async () => calls.push('prepare'), completeStudioMateRegistration: async () => ({ status: 'completed' }),
    issueInstructorLessonTicket: unexpected,
  });
  const run = () => processStudioMateRegistration({}, {}, { ...f.job, nativeDispatch: { attempted: false } });
  if (amount === 140000) { await assert.rejects(run(), /결제액/); assert.equal(steps.length, 0); }
  else {
    assert.equal((await run()).status, 'completed'); assert.equal(steps[0][1].ticketPaymentAmount, 70000);
    assert.deepEqual(calls, ['verify', 'verify', 'prepare', 'verify']);
  }
});

test('ticket completion rechecks the paid family after issuing and before completing or preparing candidates', async () => {
  const f = fixture();
  const { processStudioMateRegistration } = evaluate(parsed(WORKER), ['processStudioMateRegistration'], {
    db: f.db, verifyInstructorPaidOrder: f.verify,
    openMemberDetail: async () => {}, findActiveInstructorTicket: async () => null,
    issueInstructorLessonTicket: async () => { f.order.totalRefundedPrice = 70000; return { ticketId: '456' }; },
    completeStep: unexpected, preparePostTicketSteps: unexpected, completeStudioMateRegistration: unexpected,
  });
  await assert.rejects(processStudioMateRegistration({}, {}, { ...f.job, nativeDispatch: { attempted: false } }));
  assert.equal(f.reads(), 2);
});

test('post-ticket preparation verifies the whole family first and queues the actual per-attendee price', async () => {
  for (const blocked of [false, true]) {
    const f = fixture(), ref = f.db.doc(f.jobPath);
    Object.assign(f.db.rows.get(f.jobPath), { status: 'processing', claimToken: 'owned' });
    if (blocked) f.db.rows.get(f.registrationPath).externalOrderReviewRequired = true;
    const { preparePostTicketSteps } = evaluate(parsed(WORKER), ['preparePostTicketSteps', 'stepValue'], {
      db: f.db, verifyInstructorPaidOrder: f.verify, registration: id => f.db.doc(`instructorLessonRegistrations/${id}`),
      FieldValue: f.db.fieldValue, INSTRUCTOR_LESSON_TICKET_NAME, INSTRUCTOR_LESSON_TICKET_PRICE, normalizeInstructorLessonPhone,
    });
    const run = () => preparePostTicketSteps(ref, 'owned', f.job);
    if (blocked) { await assert.rejects(run()); assert.equal(f.db.writes.length, 0); }
    else {
      await run();
      const eform = f.db.rows.get(`eformsignInstructorMemberJobs/${f.job.registrationId}`);
      assert.equal(eform.ticketPrice, 70000); assert.equal(eform.memberPhone, f.job.memberPhone);
      assert.equal(eform.status, 'pending');
    }
  }
});

function finalEformGuard(globals) {
  const tree = parsed(EFORM), node = findNode(declaration(tree, 'processCandidate'), n =>
    ts.isCallExpression(n) && n.expression.getText(tree) === 'sendInstructorMemberForm');
  assert.ok(node);
  return vm.runInNewContext(`(${node.arguments[2].getText(tree)})`, { Date, ...globals });
}

for (const issue of ['allowed', 'review without order', 'blocked sibling', 'wrong recipient', 'total instead of attendee price']) {
  test(`eform final-send source guard: ${issue}`, async () => {
    const f = fixture(), calls = [], claimed = { ...f.job };
    if (issue === 'review without order') { f.registration.externalOrderReviewRequired = true; delete f.registration.externalOrder; }
    if (issue === 'blocked sibling') {
      const sibling = f.registrations.find(r => r.registrationId !== f.job.registrationId);
      f.db.rows.get(`instructorLessonRegistrations/${sibling.registrationId}`).status = 'cancelled';
    }
    if (issue === 'wrong recipient') claimed.memberPhone = f.order.ordererCall;
    if (issue === 'total instead of attendee price') claimed.ticketPrice = 140000;
    f.db.rows.set(f.registrationPath, f.registration);
    const guard = finalEformGuard({ db: f.db, candidate: { ref: { id: f.job.registrationId } }, claimed,
      verifyInstructorPaidOrder: f.verify, normalizeInstructorLessonPhone, normalizeInstructorLessonName,
      INSTRUCTOR_LESSON_TICKET_PRICE, positiveMoney: Number, assertMemberDispatchAllowed: () => assertMemberDispatchAllowed(NOW),
      markSending: async () => calls.push('mark'), finalSendClicked: false });
    if (issue === 'allowed') { assert.equal(typeof await guard(), 'function'); assert.deepEqual(calls, ['mark']); }
    else { await assert.rejects(guard()); assert.deepEqual(calls, []); }
  });
}

test('all worker order reads use the shared verifier and completion binding retains browser ownership/exact evidence', () => {
  for (const file of [WORKER, EFORM]) {
    const source = parsed(file).text;
    assert.match(source, /import \{ verifyInstructorPaidOrder \} from "\.\/lib\/imweb-instructor-order-source\.mjs"/);
    assert.doesNotMatch(source, /\b(?:readImwebOrder|assertSamePaidOrder)\(/);
  }
  const tree = parsed(EFORM), source = declaration(tree, 'verifyCompletedOrderContact').getText(tree);
  assert.match(source, /readCompletedRecipientEvidence\(page, job\)/);
  assert.match(source, /acquireStudioMateBrowserLock/);
  assert.match(source, /readSignupMemberIdentity/);
  assert.match(source, /finally \{ await releaseMemberLock\?\.\(\); \}/);
  assert.match(source, /const \{ order, attendeeResolution \} = await verifyInstructorPaidOrder\(db, registration\)/);
  assert.match(source, /buildOrderContactBinding\(\{ job, registration, order, attendeeResolution, member, document/);
  assert.ok(source.indexOf('await memberContext?.close()') < source.indexOf('await verifyInstructorPaidOrder'));
});
