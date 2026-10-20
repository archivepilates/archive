import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STAFF_GRADE, STAFF_GROUP, SITE, UNIT,
  videoGroups, planStaffGroups, protectedPurchaseGroups, assertMemberPreserved,
} from '../lib/imweb-staff-video-policy.mjs';

const NOW = Date.parse('2026-10-20T00:00:00Z');
const MEMBER = 'synthetic-member';
const group = (code, title) => ({ siteCode: SITE, siteGroupCode: code, title });
const member = (extra = {}) => ({
  siteCode: SITE, unitCode: UNIT, memberCode: MEMBER, grade: STAFF_GRADE,
  group: ['baseline'], point: 1200, coupon: [{ code: 'keep' }],
  metadata: { consent: false, tags: ['keep'], note: null }, ...extra,
});
const section = (code = 'video-a', status = 'PURCHASE_CONFIRMATION', days = 40) => ({
  orderSectionStatus: status,
  sectionItems: [{ productInfo: { groupPassCode: code, groupPassDayCnt: days } }],
});
const payment = (time = '2026-10-10T00:00:00Z', extra = {}) => ({
  paymentStatus: 'PAYMENT_COMPLETE', isCancel: 'N', paymentCompleteTime: time, ...extra,
});
const order = (extra = {}) => ({
  memberCode: MEMBER, siteCode: SITE, unitCode: UNIT, orderStatus: 'CLOSED',
  sections: [section()], payments: [payment()], ...extra,
});
const purchases = orders => protectedPurchaseGroups(orders, MEMBER, NOW);

test('constants identify the native grade separately from the staff group', () => {
  assert.equal(STAFF_GRADE, 'g2026101335a27ee84d335');
  assert.equal(STAFF_GROUP, 'g20261013852db0f48eb41');
  assert.equal(SITE, 'S20260516852c71a014d08');
  assert.equal(UNIT, 'u2026051698c99ea234719');
});

test('video catalog selects exact titles and returns sorted codes without mutation', () => {
  const rows = [group('z', 'ARCHIVE METHOD A-10 40D'), group('a', 'PRIVATE LESSON AB 10 40D'),
    group('test', 'ARCHIVE TEST'), group(STAFF_GROUP, 'STAFF'),
    group('near', 'ARCHIVE METHOD A 40D extra'), group('lower', 'ARCHIVE METHOD a 40D'),
    group('days', 'ARCHIVE METHOD A 30D')];
  const before = structuredClone(rows);
  assert.deepEqual(videoGroups(rows), ['a', 'z']);
  assert.deepEqual(rows, before);
  assert.deepEqual(videoGroups([group(STAFF_GROUP, 'ARCHIVE METHOD STAFF 40D')]), []);
  assert.deepEqual(videoGroups([]), []);
});

test('malformed catalogs, wrong scope, duplicate codes/titles and over 48 videos fail closed', () => {
  for (const rows of [null, {}, [null], [group('a', 'STAFF'), { ...group('b', 'ARCHIVE TEST'), siteCode: 'other' }],
    [{ ...group('a', 'ARCHIVE METHOD A 40D'), siteGroupCode: 1 }],
    [{ ...group('a', 'ARCHIVE METHOD A 40D'), title: null }],
    [group('a', 'ARCHIVE METHOD A 40D'), group('a', 'ARCHIVE METHOD B 40D')],
    [group('a', 'ARCHIVE METHOD A 40D'), group('b', 'ARCHIVE METHOD A 40D')]]) {
    assert.throws(() => videoGroups(rows));
  }
  const rows = Array.from({ length: 49 }, (_, i) => group(`g${i}`, `ARCHIVE METHOD A${i} 40D`));
  assert.equal(videoGroups(rows.slice(0, 48)).length, 48);
  assert.throws(() => videoGroups(rows), /48/);
});

test('staff grade adds videos and staff group but owns only newly added permissions', () => {
  const source = member({ group: ['baseline', 'video-a'] });
  const before = structuredClone(source);
  const plan = planStaffGroups(source, null, ['video-b', 'video-a']);
  assert.deepEqual(plan, {
    action: 'update', beforeGroups: ['baseline', 'video-a'],
    afterGroups: [STAFF_GROUP, 'baseline', 'video-a', 'video-b'].sort(),
    addedGroups: [STAFF_GROUP, 'video-b'].sort(), removedGroups: [],
    nextManagedGroups: [STAFF_GROUP, 'video-b'].sort(),
  });
  assert.deepEqual(source, before);
});

test('staff group alone, a grade array or a grade object never activates staff access', () => {
  for (const grade of ['ordinary', STAFF_GROUP, undefined, [STAFF_GRADE], { code: STAFF_GRADE }]) {
    const plan = planStaffGroups(member({ grade, group: [STAFF_GROUP, 'baseline'] }), null, ['video-a']);
    assert.equal(plan.action, 'none');
    assert.deepEqual(plan.afterGroups, [STAFF_GROUP, 'baseline'].sort());
    assert.deepEqual(plan.nextManagedGroups, []);
  }
});

test('new catalog video is added on replay without adopting baseline or losing current ownership', () => {
  const ledger = { ownedAddedGroups: [STAFF_GROUP, 'video-a', 'absent'] };
  const source = member({ group: ['baseline', 'purchased', STAFF_GROUP, 'video-a'] });
  const inputs = structuredClone([source, ledger]);
  const plan = planStaffGroups(source, ledger, ['video-a', 'video-b', 'purchased']);
  assert.deepEqual(plan.addedGroups, ['video-b']);
  assert.deepEqual(plan.nextManagedGroups, [STAFF_GROUP, 'video-a', 'video-b'].sort());
  assert.deepEqual([source, ledger], inputs);
  const replay = planStaffGroups({ ...source, group: plan.afterGroups },
    { ownedAddedGroups: plan.nextManagedGroups }, ['video-a', 'video-b', 'purchased']);
  assert.equal(replay.action, 'none');
  assert.deepEqual(replay.nextManagedGroups, plan.nextManagedGroups);
});

test('offstaff removes only present ledger-owned permissions, even if absent from the catalog', () => {
  const plan = planStaffGroups(member({ grade: 'ordinary', group: ['baseline', 'purchased', 'old-video', STAFF_GROUP] }),
    { ownedAddedGroups: ['old-video', STAFF_GROUP, 'already-absent'] }, []);
  assert.equal(plan.action, 'update');
  assert.deepEqual(plan.afterGroups, ['baseline', 'purchased']);
  assert.deepEqual(plan.removedGroups, [STAFF_GROUP, 'old-video'].sort());
  assert.deepEqual(plan.nextManagedGroups, []);
});

test('exit and reentry preserve preexisting staff/video baseline permanently', () => {
  const baseline = [STAFF_GROUP, 'video-a', 'baseline'];
  const first = planStaffGroups(member({ group: baseline }), undefined, ['video-a', 'video-b']);
  const exit = planStaffGroups(member({ grade: 'ordinary', group: first.afterGroups }),
    { ownedAddedGroups: first.nextManagedGroups }, ['video-a', 'video-b']);
  assert.deepEqual(exit.afterGroups, [...baseline].sort());
  const reentry = planStaffGroups(member({ group: exit.afterGroups }),
    { ownedAddedGroups: exit.nextManagedGroups }, ['video-a', 'video-b', 'video-c']);
  assert.deepEqual(reentry.nextManagedGroups, ['video-b', 'video-c']);
});
test('baseline cannot be acquired through ledger corruption or a later re-add', () => {
  assert.throws(() => planStaffGroups(member({ grade: 'ordinary', group: ['baseline'] }),
    { baselineGroups: ['baseline'], ownedAddedGroups: ['baseline'] }, []), /Baseline/);
  const plan = planStaffGroups(member({ group: [] }),
    { baselineGroups: ['video-a'], ownedAddedGroups: [] }, ['video-a', 'video-b']);
  assert.ok(plan.afterGroups.includes('video-a'));
  assert.ok(!plan.nextManagedGroups.includes('video-a'));
});

test('protected purchases release ownership onstaff and offstaff even without a group update', () => {
  for (const grade of [STAFF_GRADE, 'ordinary']) {
    const source = member({ grade, group: ['baseline', STAFF_GROUP, 'video-a'] });
    const plan = planStaffGroups(source, { ownedAddedGroups: ['video-a'] }, [], ['video-a']);
    assert.equal(plan.action, 'none');
    assert.deepEqual(plan.afterGroups, [...source.group].sort());
    assert.deepEqual(plan.nextManagedGroups, []);
  }
  const plan = planStaffGroups(member(), null, ['video-a'], ['video-a']);
  assert.deepEqual(plan.nextManagedGroups, [STAFF_GROUP]);
});

test('invalid member scope and ambiguous string arrays are rejected', () => {
  for (const source of [member({ siteCode: 'other' }), member({ unitCode: 'other' }),
    member({ group: undefined }), member({ group: [{}] }), member({ group: ['a', 'a'] })]) {
    assert.throws(() => planStaffGroups(source, null, []));
  }
  for (const ledger of [{}, { ownedAddedGroups: ['a', 'a'] }, { ownedAddedGroups: 'a' }]) {
    assert.throws(() => planStaffGroups(member(), ledger, []));
  }
  assert.throws(() => planStaffGroups(member(), null, ['a', 'a']));
  assert.throws(() => planStaffGroups(member(), null, [], [null]));
});

test('successful unexpired purchase protects owned video access on exit', () => {
  for (const status of ['PURCHASE_CONFIRMATION', 'PURCHASE_COMPLETE', 'DELIVERY_COMPLETE']) {
    const protectedGroups = purchases([order({ sections: [section('video-a', status)] })]);
    assert.deepEqual(protectedGroups, ['video-a']);
    const plan = planStaffGroups(member({ grade: 'ordinary', group: ['baseline', 'video-a', STAFF_GROUP] }),
      { ownedAddedGroups: ['video-a', STAFF_GROUP] }, ['video-a'], protectedGroups);
    assert.deepEqual(plan.afterGroups, ['baseline', 'video-a']);
    assert.deepEqual(plan.removedGroups, [STAFF_GROUP]);
    assert.deepEqual(plan.nextManagedGroups, []);
  }
});

test('pending, canceled, refunded and non-successful orders/sections/payments never grant', () => {
  for (const value of [
    order({ orderStatus: 'CANCEL_COMPLETE' }), order({ orderStatus: 'REFUNDED' }),
    order({ orderStatus: 'PAYMENT_PENDING' }), order({ isCancel: 'Y' }),
    order({ sections: [section('a', 'CANCEL_COMPLETE')] }),
    order({ sections: [section('a', 'REFUND_COMPLETE')] }),
    order({ sections: [section('a', 'SHIPPING_READY')] }),
    order({ sections: [{ ...section(), returnInfo: { isRefund: 'Y' } }] }),
    order({ payments: [payment('bad', { isCancel: 'Y' })] }),
    order({ payments: [payment('bad', { paymentStatus: 'PAYMENT_PENDING' })] }),
    order({ payments: [payment('bad', { paymentStatus: 'REFUND_COMPLETE' })] }),
  ]) assert.deepEqual(purchases([value]), []);
});

test('partial section cancellation skips canceled subscription but retains successful subscription', () => {
  assert.deepEqual(purchases([order({ sections: [section('canceled', 'CANCEL_COMPLETE'), section('valid')] })]), ['valid']);
  const partial = order();
  partial.sections[0].sectionItems.push({ ...section('canceled').sectionItems[0], isCancel: 'Y' });
  assert.deepEqual(purchases([partial]), ['video-a']);
  assert.deepEqual(purchases([order({ payments: [payment('bad', { isCancel: 'Y' }), payment()] })]), ['video-a']);
  assert.throws(() => purchases([order({ totalRefundedPrice: 100 })]), /refund allocation/);
});

test('other member orders cannot grant access or block matching member on malformed details', () => {
  assert.deepEqual(purchases([order({ memberCode: 'other', sections: null, payments: null }),
    order({ memberCode: `${MEMBER} ` })]), []);
  assert.throws(() => purchases([order({ siteCode: 'other' })]), /siteCode/);
  assert.throws(() => purchases([order({ unitCode: 'other' })]), /unitCode/);
});

test('expiry is strict, purchases are independent, and latest successful payment determines expiry', () => {
  const atExpiry = order({ payments: [payment('2026-09-10T00:00:00Z')] });
  assert.deepEqual(purchases([atExpiry]), []);
  assert.deepEqual(protectedPurchaseGroups([atExpiry], MEMBER, NOW - 1), ['video-a']);
  assert.deepEqual(purchases([atExpiry, order(), order({ sections: [section('video-b')] })]), ['video-a', 'video-b']);
  const times = [payment('2026-09-01T00:00:00Z'), payment(), payment('2099-01-01T00:00:00Z', { isCancel: 'Y' })];
  assert.deepEqual(purchases([order({ payments: times })]), ['video-a']);
  assert.deepEqual(purchases([order({ payments: [...times].reverse() })]), ['video-a']);
  assert.deepEqual(purchases([order(), order({ orderStatus: 'CANCEL_COMPLETE' })]), ['video-a']);
});

test('unknown relevant state, missing payment/date or invalid subscription duration fails closed', () => {
  for (const value of [
    order({ orderStatus: 'NEW_STATUS' }), order({ sections: [section('a', 'UNKNOWN')] }),
    order({ sections: null }), order({ sections: [{ orderSectionStatus: 'PURCHASE_COMPLETE' }] }),
    order({ payments: null }), order({ payments: [] }),
    order({ payments: [payment('bad')] }), order({ payments: [payment('2026-10-10')] }),
    order({ payments: [payment('2026-10-10T00:00:00')] }),
    order({ payments: [payment('2026-02-30T00:00:00Z')] }),
    order({ payments: [payment('2026-10-09T24:00:00Z')] }),
    order({ payments: [payment('2099-01-01T00:00:00Z')] }),
    order({ payments: [payment(undefined, { paymentStatus: 'UNKNOWN' })] }),
    order({ payments: [payment(undefined, { isCancel: '?' })] }),
    ...[undefined, null, 0, -1, 1.5, Infinity, '40 days'].map(days => {
      const value = order(); value.sections[0].sectionItems[0].productInfo.groupPassDayCnt = days; return value;
    }),
  ]) assert.throws(() => purchases([value]));
  assert.throws(() => protectedPurchaseGroups([], MEMBER, NaN));
  assert.throws(() => protectedPurchaseGroups({}, MEMBER, NOW));
});

test('unknown extra payments cannot be hidden behind a valid payment or another protected purchase', () => {
  assert.throws(() => purchases([order(), order({ payments: [payment(),
    payment('bad', { paymentStatus: 'UNKNOWN' })] })]), /payment state/);
  assert.throws(() => purchases([order({ payments: [payment(), payment('bad')] })]), /paymentCompleteTime/);
  assert.throws(() => purchases([order({ sections: [section('video-a'), section('unknown', 'NEW_STATUS')] })]), /section state/);
});

test('no-op exit prunes missing ownership without requesting a member write', () => {
  const plan = planStaffGroups(member({ grade: 'ordinary' }), { ownedAddedGroups: ['absent'] }, []);
  assert.deepEqual(plan, { action: 'none', beforeGroups: ['baseline'], afterGroups: ['baseline'],
    addedGroups: [], removedGroups: [], nextManagedGroups: [] });
});

test('ordinary products do not grant; string integer days and explicit timezone dates are deterministic', () => {
  assert.deepEqual(purchases([order({ sections: [{ ...section(), sectionItems: [{ productInfo: { prodNo: 10 } }] }] })]), []);
  const value = order({ sections: [section('video-a', 'PURCHASE_COMPLETE', '40')],
    payments: [payment('2026-10-10T09:00:00+09:00')] });
  const before = structuredClone(value);
  assert.deepEqual(purchases([value]), ['video-a']);
  assert.deepEqual(value, before);
});

test('readback verifies exact group set and deep preservation of every other member field', () => {
  const before = member();
  const expected = ['baseline', 'video-a'];
  const after = structuredClone({ ...before, group: [...expected].reverse() });
  assertMemberPreserved(before, after, expected);
  for (const change of [
    value => { value.point = 0; }, value => { value.grade = 'ordinary'; },
    value => { value.coupon[0].code = 'changed'; }, value => { value.metadata.consent = true; },
    value => { delete value.memberCode; }, value => { value.unexpected = true; },
    value => { value.group = ['baseline']; }, value => { value.group.push('unrequested'); },
    value => { value.group.push('baseline'); },
  ]) {
    const changed = structuredClone(after); change(changed);
    assert.throws(() => assertMemberPreserved(before, changed, expected));
  }
});
