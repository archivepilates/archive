import assert from 'node:assert/strict';

export const STAFF_GRADE = 'g2026101335a27ee84d335';
export const STAFF_GROUP = 'g20261013852db0f48eb41';
export const COMMON_STAFF_ACCESS_MODE = 'common_staff_group_v1';
export const SITE = 'S20260516852c71a014d08';
export const UNIT = 'u2026051698c99ea234719';

const nonempty = value => typeof value === 'string' && value.trim() === value && value.length > 0;
const sorted = values => [...new Set(values)].sort();

function strings(value, name) {
  assert.ok(Array.isArray(value) && value.every(nonempty), `${name} must be a string array`);
  assert.equal(new Set(value).size, value.length, `${name} must be unique`);
  return [...value];
}

export function videoGroups(groups, { commonAccess = false } = {}) {
  assert.ok(Array.isArray(groups), 'groups must be an array');
  const codes = new Set();
  const titles = new Set();
  const selected = [];
  for (const row of groups) {
    assert.equal(row?.siteCode, SITE, 'Unexpected group siteCode');
    assert.ok(nonempty(row.siteGroupCode) && nonempty(row.title), 'Invalid group code/title');
    assert.ok(!codes.has(row.siteGroupCode) && !titles.has(row.title), 'Duplicate group code/title');
    codes.add(row.siteGroupCode);
    titles.add(row.title);
    if (row.siteGroupCode !== STAFF_GROUP
      && (/^ARCHIVE METHOD [A-Z0-9-]+ 40D$/.test(row.title)
        || /^PRIVATE LESSON [A-Z0-9 -]+ 40D$/.test(row.title))) selected.push(row.siteGroupCode);
  }
  const catalogLimit = commonAccess ? 1000 : 48;
  assert.ok(selected.length <= catalogLimit, `Video catalog exceeds ${catalogLimit} groups`);
  return selected.sort();
}

export function planStaffGroups(member, ledger, catalogGroups, protectedGroups = [], { commonAccess = false } = {}) {
  assert.equal(member?.siteCode, SITE, 'Unexpected member siteCode');
  assert.equal(member?.unitCode, UNIT, 'Unexpected member unitCode');
  const beforeGroups = strings(member.group, 'member.group').sort();
  const owned = strings(ledger == null ? [] : ledger.ownedAddedGroups, 'ledger.ownedAddedGroups');
  const baseline = new Set(strings(ledger?.baselineGroups ?? [], 'ledger.baselineGroups'));
  assert.ok(owned.every(code => !baseline.has(code)), 'Baseline cannot be worker-owned');
  const catalog = strings(catalogGroups, 'catalogGroups');
  const protectedSet = new Set(strings(protectedGroups, 'protectedGroups'));
  const current = new Set(beforeGroups);
  const active = member.grade === STAFF_GRADE;
  const removable = new Set(owned.filter(code => !protectedSet.has(code)));
  if (commonAccess && !active && ledger?.commonStaffGroupManaged === true) {
    assert.ok(!protectedSet.has(STAFF_GROUP), 'Protected STAFF group requires manual review; no automatic role removal');
    removable.add(STAFF_GROUP);
  }
  const afterGroups = active
    ? sorted([...beforeGroups, ...(commonAccess ? [] : catalog), STAFF_GROUP])
    : beforeGroups.filter(code => !removable.has(code));
  const after = new Set(afterGroups);
  const addedGroups = afterGroups.filter(code => !current.has(code));
  const removedGroups = beforeGroups.filter(code => !after.has(code));
  const nextManagedGroups = active
    ? sorted([...owned.filter(code => current.has(code)), ...addedGroups])
      .filter(code => !protectedSet.has(code) && !baseline.has(code))
    : [];
  return {
    action: addedGroups.length || removedGroups.length ? 'update' : 'none',
    beforeGroups, afterGroups, addedGroups, removedGroups, nextManagedGroups,
  };
}

const SUCCESS_SECTIONS = new Set(['PURCHASE_CONFIRMATION', 'PURCHASE_COMPLETE', 'DELIVERY_COMPLETE']);
const NON_GRANT_SECTIONS = new Set([
  'PAYMENT_PENDING', 'PAYMENT_WAIT', 'PAYMENT_WAITING', 'PAYMENT_FAILED', 'PAYMENT_COMPLETE',
  'SHIPPING_READY', 'SHIPPING', 'SHIPPING_COMPLETE', 'DELIVERY_READY', 'DELIVERY_PENDING',
  'CANCEL', 'CANCELED', 'CANCELLED', 'CANCEL_REQUEST', 'CANCEL_PENDING', 'CANCEL_COMPLETE',
  'REFUND', 'REFUNDED', 'REFUND_REQUEST', 'REFUND_PENDING', 'REFUND_COMPLETE',
  'RETURN_REQUEST', 'RETURN_PENDING', 'RETURN_COMPLETE',
]);
const NON_GRANT_PAYMENTS = new Set([
  'PAYMENT_PENDING', 'PAYMENT_WAIT', 'PAYMENT_WAITING', 'PAYMENT_FAILED', 'PAYMENT_CANCEL',
  'PAYMENT_CANCELED', 'PAYMENT_CANCELLED', 'PAYMENT_CANCEL_COMPLETE', 'PAYMENT_REFUNDED',
  'CANCEL', 'CANCEL_PENDING', 'CANCEL_COMPLETE', 'REFUND_PENDING', 'REFUND_COMPLETE',
]);
const NON_GRANT_ORDERS = new Set([
  'PENDING', 'PAYMENT_PENDING', 'PAYMENT_WAIT', 'PAYMENT_WAITING', 'PAYMENT_FAILED',
  'CANCEL', 'CANCELED', 'CANCELLED', 'CANCEL_PENDING', 'CANCEL_COMPLETE',
  'REFUND', 'REFUNDED', 'REFUND_PENDING', 'REFUND_COMPLETE',
]);

function instant(value, name) {
  const time = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
      : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        ? Date.parse(value) : NaN;
  assert.ok(Number.isFinite(time), `Ambiguous ${name}`);
  if (typeof value === 'string') {
    const date = value.slice(0, 10);
    const midnight = Date.parse(`${date}T00:00:00Z`);
    assert.ok(Number.isFinite(midnight) && new Date(midnight).toISOString().slice(0, 10) === date
      && Number(value.slice(11, 13)) < 24, `Ambiguous ${name} calendar date`);
  }
  return time;
}

function canceled(row) {
  for (const value of [row.isCancel, row.returnInfo?.isRefund, row.returnInfo?.isExchange]) {
    assert.ok(value === undefined || value === 'N' || value === 'Y', 'Ambiguous cancellation flag');
    if (value === 'Y') return true;
  }
  return false;
}

function subscription(item) {
  assert.ok(item && typeof item === 'object', 'Invalid section item');
  if (canceled(item)) return null;
  const product = item?.productInfo;
  assert.ok(product && typeof product === 'object', 'Ambiguous productInfo');
  const code = product.groupPassCode;
  const days = product.groupPassDayCnt;
  if ((code == null || code === '') && (days == null || days === 0 || days === '0' || days === '')) return null;
  assert.ok(nonempty(code), 'Ambiguous subscription groupPassCode');
  const count = typeof days === 'string' && /^\d+$/.test(days) ? Number(days) : days;
  assert.ok(Number.isSafeInteger(count) && count > 0, 'Ambiguous subscription groupPassDayCnt');
  return { code, days: count };
}

// Callers must supply all order pages from the already-verified site/unit scope.
export function protectedPurchaseGroups(orders, memberCode, now) {
  assert.ok(Array.isArray(orders), 'orders must be a completely paginated array');
  assert.ok(nonempty(memberCode), 'Invalid memberCode');
  const nowTime = instant(now, 'now');
  const protectedCodes = new Set();
  for (const order of orders) {
    assert.ok(order && typeof order === 'object', 'Invalid order');
    if (order.memberCode !== memberCode) continue;
    if (order.siteCode !== undefined) assert.equal(order.siteCode, SITE, 'Unexpected order siteCode');
    if (order.unitCode !== undefined) assert.equal(order.unitCode, UNIT, 'Unexpected order unitCode');
    if (NON_GRANT_ORDERS.has(order.orderStatus) || canceled(order)) continue;
    assert.ok(Array.isArray(order.sections), 'Ambiguous order sections');
    const subscriptions = [];
    for (const section of order.sections) {
      assert.ok(section && typeof section === 'object', 'Invalid section');
      if (NON_GRANT_SECTIONS.has(section.orderSectionStatus) || canceled(section)) continue;
      assert.ok(Array.isArray(section.sectionItems), 'Ambiguous sectionItems');
      const relevant = section.sectionItems.map(subscription).filter(Boolean);
      if (!relevant.length) continue;
      assert.ok(SUCCESS_SECTIONS.has(section.orderSectionStatus), 'Ambiguous subscription section state');
      subscriptions.push(...relevant);
    }
    if (!subscriptions.length) continue;
    assert.ok(order.orderStatus === undefined || ['OPEN', 'CLOSED'].includes(order.orderStatus),
      'Ambiguous subscription order state');
    // Aggregate refunds cannot establish which still-successful subscription was refunded.
    for (const key of ['totalRefundPendingPrice', 'totalRefundedPrice', 'totalRefundPendingPoint', 'totalRefundedPoint']) {
      if (order[key] !== undefined) {
        assert.ok((typeof order[key] === 'number' || typeof order[key] === 'string')
          && String(order[key]).trim() !== '' && Number(order[key]) === 0, 'Ambiguous subscription refund allocation');
      }
    }
    assert.ok(Array.isArray(order.payments) && order.payments.length > 0, 'Ambiguous subscription payments');
    const paidTimes = [];
    for (const payment of order.payments) {
      assert.ok(payment && typeof payment === 'object', 'Invalid payment');
      if (canceled(payment) || NON_GRANT_PAYMENTS.has(payment.paymentStatus)) continue;
      assert.equal(payment.paymentStatus, 'PAYMENT_COMPLETE', 'Ambiguous subscription payment state');
      const paidAt = instant(payment.paymentCompleteTime, 'subscription paymentCompleteTime');
      assert.ok(paidAt <= nowTime, 'Ambiguous future subscription payment');
      paidTimes.push(paidAt);
    }
    if (!paidTimes.length) continue;
    const paidAt = Math.max(...paidTimes);
    for (const { code, days } of subscriptions) {
      const expiresAt = paidAt + days * 86_400_000;
      assert.ok(Number.isSafeInteger(expiresAt), 'Ambiguous subscription expiry');
      if (expiresAt > nowTime) protectedCodes.add(code);
    }
  }
  return sorted(protectedCodes);
}

export function assertMemberPreserved(before, after, expectedGroups) {
  assert.ok(before && after && typeof before === 'object' && typeof after === 'object', 'Invalid member readback');
  const { group: beforeGroups, ...beforeFields } = before;
  const { group: afterGroups, ...afterFields } = after;
  strings(beforeGroups, 'before.group');
  assert.deepEqual(afterFields, beforeFields, 'Member metadata changed');
  assert.deepEqual(strings(afterGroups, 'after.group').sort(), strings(expectedGroups, 'expectedGroups').sort(),
    'Member groups differ from expected groups');
}
