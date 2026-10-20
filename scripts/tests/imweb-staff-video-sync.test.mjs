import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { reconcileStaffVideos, STAFF_VIDEO_POLICY } from '../lib/imweb-staff-video-sync.mjs';
import { STAFF_GRADE, STAFF_GROUP, SITE, UNIT } from '../lib/imweb-staff-video-policy.mjs';

const NOW = Date.parse('2026-10-20T00:00:00Z');
const VIDEO_CODES = Array.from({ length: 30 }, (_, index) => `video-${String(index).padStart(2, '0')}`);
const sort = values => [...values].sort();
const copy = value => structuredClone(value);
const flag = (args, name) => args[args.indexOf(name) + 1];
const isWrite = args => args.slice(0, 3).join(' ') === 'member update groups' && args.includes('--yes');
const isDry = args => args.slice(0, 3).join(' ') === 'member update groups' && args.includes('--dry-run');
const isDetail = args => args[0] === 'member' && args[1] === 'get';
let purchaseSequence = 0;

beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  purchaseSequence = 0;
});

function member(code = 'm001', changes = {}) {
  return {
    siteCode: SITE, unitCode: UNIT, memberCode: code, uid: `synthetic-${code}`,
    grade: STAFF_GRADE, group: ['baseline', VIDEO_CODES[0]], point: 1234,
    coupon: [{ code: 'synthetic-coupon', usable: true }],
    metadata: { consent: false, notes: ['preserve'], flags: { subscribed: true } },
    ...changes,
  };
}

function purchase(code, groupCode, changes = {}) {
  return {
    orderNo: 202610200000000 + ++purchaseSequence,
    siteCode: SITE, unitCode: UNIT, memberCode: code, orderStatus: 'CLOSED',
    sections: [{ orderSectionStatus: 'PURCHASE_COMPLETE', sectionItems: [{
      productInfo: { groupPassCode: groupCode, groupPassDayCnt: 40 },
    }] }],
    payments: [{ paymentStatus: 'PAYMENT_COMPLETE', isCancel: 'N',
      paymentCompleteTime: new Date(Date.now() - 10 * 86_400_000).toISOString() }],
    ...changes,
  };
}

function tracked(source, ownedAddedGroups, baselineGroups = ['baseline']) {
  return { memberCode: source.memberCode, uid: source.uid, baselineGroups, ownedAddedGroups };
}

function fixture({ members = [member()], orders = [], entries = {} } = {}) {
  const live = new Map(members.map(source => [source.uid, copy(source)]));
  const events = [];
  const saved = [];
  const state = { policyVersion: STAFF_VIDEO_POLICY, approved: true, members: copy(entries) };
  const f = {
    live, events, saved, state, orders: copy(orders),
    groups: [
      ...VIDEO_CODES.map((code, index) => ({ siteCode: SITE, siteGroupCode: code,
        title: index % 2 ? `PRIVATE LESSON P${index} 40D` : `ARCHIVE METHOD A${index} 40D` })),
      { siteCode: SITE, siteGroupCode: STAFF_GROUP, title: 'ARCHIVE STAFF' },
      { siteCode: SITE, siteGroupCode: 'test-group', title: 'ARCHIVE TEST' },
    ],
    grades: [
      { memberGradeCode: 'ordinary', title: 'ordinary', useAutoGrade: 'N' },
      { memberGradeCode: STAFF_GRADE, title: '\uC2A4\uD15D', useAutoGrade: 'N' },
    ],
    failWrite: null, beforeCall: null, afterResponse: null,
    get writes() { return events.filter(event => event.kind === 'call' && isWrite(event.args)); },
    get dryRuns() { return events.filter(event => event.kind === 'call' && isDry(event.args)); },
    save(value) {
      const snapshot = copy(value);
      saved.push(snapshot);
      events.push({ kind: 'save', state: snapshot });
    },
  };

  function page(rows, args) {
    const currentPage = Number(flag(args, '--page'));
    assert.ok(Number.isInteger(currentPage) && currentPage >= 1);
    assert.equal(flag(args, '--limit'), '100');
    const split = Math.ceil(rows.length / 2);
    const totalPage = rows.length > 1 ? 2 : 1;
    assert.ok(currentPage <= totalPage, 'Unexpected extra page');
    return { data: { list: copy(currentPage === 1 ? rows.slice(0, split) : rows.slice(split)),
      totalCount: rows.length, totalPage, currentPage } };
  }

  f.run = args => {
    events.push({ kind: 'call', args: copy(args) });
    f.beforeCall?.(args, f);
    let response;
    const command = args.slice(0, 3).join(' ');
    if (command === 'config context') {
      response = { effective_profile: 'default', resolved_profile: { site_code: SITE, unit_code: UNIT },
        remote_context: { write_ready: true }, token: { status: 'healthy' } };
    } else if (command === 'auth refresh') {
      response = { statusCode: 200 };
    } else if (command === 'member groups list') {
      response = page(f.groups, args);
    } else if (command === 'member grades list') {
      response = page(f.grades, args);
    } else if (args[0] === 'member' && args[1] === 'list') {
      assert.equal(flag(args, '--unit-code'), UNIT);
      assert.equal(flag(args, '--limit'), '50');
      const cursor = args.includes('--cursor') ? flag(args, '--cursor') : null;
      assert.ok(cursor === null || cursor === 'synthetic-page-2', 'Unexpected member cursor');
      const rows = [...live.values()];
      response = { data: { list: copy(cursor ? rows.slice(1) : rows.slice(0, 1)),
        hasNext: !cursor && rows.length > 1,
        ...(!cursor && rows.length > 1 ? { nextCursor: 'synthetic-page-2' } : {}) } };
    } else if (isDetail(args)) {
      assert.equal(flag(args, '--unit-code'), UNIT);
      assert.ok(live.has(args[2]), 'Unknown detail uid');
      response = { data: copy(live.get(args[2])) };
    } else if (args[0] === 'order' && args[1] === 'list') {
      assert.equal(flag(args, '--unit-code'), UNIT);
      response = page(f.orders, args);
    } else if (command === 'member update groups') {
      assert.ok(live.has(args[3]), 'Unknown update uid');
      const body = JSON.parse(flag(args, '--data'));
      assert.deepEqual(Object.keys(body).sort(), ['groupCodes', 'unitCode']);
      assert.equal(body.unitCode, UNIT);
      assert.equal(new Set(body.groupCodes).size, body.groupCodes.length);
      assert.ok(body.groupCodes.length <= 50);
      if (args.includes('--dry-run')) {
        assert.ok(!args.includes('--yes'));
        response = { confirmation_token: `confirm-${args[3]}`, body: copy(body),
          safety: { bulk_confirmation_required_for_execute: true,
            bulk_confirmation_token: `bulk-${args[3]}` } };
      } else {
        assert.ok(args.includes('--yes'), 'Only explicit apply commands are supported');
        assert.equal(flag(args, '--confirm-token'), `confirm-${args[3]}`);
        assert.equal(flag(args, '--bulk-confirm-token'), `bulk-${args[3]}`);
        const pending = state.members[live.get(args[3]).memberCode]?.pending;
        assert.equal(pending?.status, 'intent', 'Intent must exist before sending');
        assert.ok(saved.some(snapshot => snapshot.members[live.get(args[3]).memberCode]?.pending?.status === 'intent'),
          'Intent must be durably saved before sending');
        assert.deepEqual(pending.afterGroups, body.groupCodes);
        if (f.failWrite === 'before') throw Error('Synthetic transport failure before provider mutation');
        live.get(args[3]).group = copy(body.groupCodes);
        if (f.failWrite === 'after') throw Error('Synthetic transport failure after provider mutation');
        response = { statusCode: 200 };
      }
    } else {
      assert.fail(`Unexpected mock command: ${JSON.stringify(args)}`);
    }
    return f.afterResponse?.(args, response, f) ?? response;
  };
  f.reconcile = (options = {}) => reconcileStaffVideos(state, {
    run: f.run, save: f.save, now: NOW, apply: true, ...options,
  });
  return f;
}

test('paginated sources grant native staff the catalog union without changing baseline or metadata', () => {
  const sources = [member('m001'), member('m002', { group: ['other-baseline'] }),
    member('m003', { grade: 'ordinary', group: [STAFF_GROUP] })];
  const f = fixture({ members: sources });
  const result = f.reconcile();
  assert.equal(result.ok, true);
  assert.equal(result.catalogGroups, 30);
  assert.equal(result.scannedMembers, 3);
  assert.equal(result.staffMembers, 2);
  assert.equal(f.writes.length, 2);
  for (const source of sources.slice(0, 2)) {
    const current = f.live.get(source.uid);
    assert.deepEqual(sort(current.group), sort([...new Set([...source.group, ...VIDEO_CODES, STAFF_GROUP])]));
    assert.deepEqual({ ...current, group: source.group }, source);
    assert.deepEqual(f.state.members[source.memberCode].baselineGroups, source.group);
    assert.deepEqual(sort(f.state.members[source.memberCode].ownedAddedGroups),
      sort([...VIDEO_CODES, STAFF_GROUP].filter(code => !source.group.includes(code))));
    assert.equal(f.state.members[source.memberCode].pending, undefined);
  }
  for (const command of ['member groups list', 'member grades list']) {
    assert.deepEqual(f.events.filter(event => event.args?.slice(0, 3).join(' ') === command)
      .map(event => Number(flag(event.args, '--page'))), [1, 2]);
  }
  assert.ok(f.events.some(event => event.args?.includes('--cursor')));
  assert.deepEqual(f.live.get(sources[2].uid), sources[2]);
});

test('idempotent apply rerun performs no more dry-runs or writes and never adopts baseline', () => {
  const f = fixture();
  f.reconcile();
  const owned = copy(f.state.members.m001.ownedAddedGroups);
  const current = copy(f.live.get('synthetic-m001'));
  const writeCount = f.writes.length;
  const dryCount = f.dryRuns.length;
  const result = f.reconcile();
  assert.equal(result.outcomes[0].action, 'none');
  assert.equal(f.writes.length, writeCount);
  assert.equal(f.dryRuns.length, dryCount);
  assert.deepEqual(f.live.get('synthetic-m001'), current);
  assert.deepEqual(f.state.members.m001.ownedAddedGroups, owned);
  assert.ok(!owned.includes('baseline') && !owned.includes(VIDEO_CODES[0]));
});

test('a newly cataloged video is added on a later run without acquiring baseline ownership', () => {
  const f = fixture();
  f.reconcile();
  f.groups.push({ siteCode: SITE, siteGroupCode: 'new-video', title: 'ARCHIVE METHOD NEW 40D' });
  const result = f.reconcile();
  assert.equal(result.outcomes[0].added, 1);
  assert.equal(f.writes.length, 2);
  assert.ok(f.live.get('synthetic-m001').group.includes('new-video'));
  assert.ok(f.state.members.m001.ownedAddedGroups.includes('new-video'));
  assert.ok(!f.state.members.m001.ownedAddedGroups.includes(VIDEO_CODES[0]));
});

test('baseline video removed natively and readded for staff never becomes worker-owned', () => {
  const f = fixture();
  f.reconcile();
  const source = f.live.get('synthetic-m001');
  source.group = source.group.filter(code => code !== VIDEO_CODES[0]);
  const restored = f.reconcile();
  assert.equal(restored.outcomes[0].added, 1);
  assert.ok(source.group.includes(VIDEO_CODES[0]));
  assert.ok(!f.state.members.m001.ownedAddedGroups.includes(VIDEO_CODES[0]));
  source.grade = 'ordinary';
  f.reconcile();
  assert.deepEqual(sort(source.group), ['baseline', VIDEO_CODES[0]].sort());
  assert.deepEqual(f.state.members.m001.ownedAddedGroups, []);
});

test('baseline/owned overlap in a later target ledger blocks the entire write batch', () => {
  const offstaff = member('m002', { grade: 'ordinary' });
  const f = fixture({ members: [member('m001'), offstaff],
    entries: { m002: tracked(offstaff, ['baseline'], [...offstaff.group]) } });
  assert.throws(() => f.reconcile(), /Baseline cannot be worker-owned/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.saved.length, 0);
  assert.deepEqual(f.live.get(offstaff.uid), offstaff);
});

test('native staff group alone never selects an ordinary member for a grant', () => {
  const source = member('m001', { grade: 'ordinary', group: [STAFF_GROUP, 'baseline'] });
  const f = fixture({ members: [source] });
  assert.deepEqual(f.reconcile().outcomes, []);
  assert.deepEqual(f.live.get(source.uid), source);
  assert.deepEqual(f.state.members, {});
  assert.equal(f.writes.length, 0);
  assert.equal(f.dryRuns.length, 0);
});

test('every target detail and dry-run preflight completes before the first write', () => {
  const sources = [member('m001'), member('m002')];
  const f = fixture({ members: sources });
  f.reconcile();
  const firstWrite = f.events.findIndex(event => event.args && isWrite(event.args));
  assert.ok(firstWrite > 0);
  const preflight = f.events.slice(0, firstWrite);
  for (const source of sources) {
    assert.ok(preflight.some(event => event.args && isDetail(event.args) && event.args[2] === source.uid));
    assert.ok(preflight.some(event => event.args && isDry(event.args) && event.args[3] === source.uid));
  }
  assert.equal(f.writes.length, 2);
});

test('a late target preflight failure prevents all writes and intent saves', () => {
  const f = fixture({ members: [member('m001'), member('m002')] });
  f.afterResponse = (args, response) => {
    if (isDry(args) && args[3] === 'synthetic-m002') response.body.groupCodes = [];
    return response;
  };
  assert.throws(() => f.reconcile(), /dry-run/i);
  assert.equal(f.dryRuns.length, 2);
  assert.equal(f.writes.length, 0);
  assert.equal(f.saved.length, 0);
});

test('review-only run does not mutate ledger, member data, or save anything', () => {
  const f = fixture();
  const before = copy(f.state);
  const source = copy([...f.live.values()]);
  const result = f.reconcile({ apply: false });
  assert.equal(result.mode, 'dry_run');
  assert.equal(result.outcomes[0].action, 'update');
  assert.equal(f.dryRuns.length, 1);
  assert.equal(f.writes.length, 0);
  assert.equal(f.saved.length, 0);
  assert.deepEqual(f.state, before);
  assert.deepEqual([...f.live.values()], source);
});

test('failed write retains durable intent and is never repeated; matching readback reconciles it', () => {
  const f = fixture();
  f.failWrite = 'before';
  assert.throws(() => f.reconcile(), error => error.code === 'STAFF_GROUP_RESULT_UNKNOWN');
  assert.equal(f.writes.length, 1);
  assert.equal(f.state.members.m001.pending.status, 'result_unknown');
  assert.ok(f.saved.some(snapshot => snapshot.members.m001?.pending?.status === 'intent'));
  assert.ok(f.saved.some(snapshot => snapshot.members.m001?.pending?.status === 'result_unknown'));
  const pending = copy(f.state.members.m001.pending);
  f.failWrite = null;
  assert.throws(() => f.reconcile(), /Unresolved group update/);
  assert.equal(f.writes.length, 1);
  f.live.get('synthetic-m001').group = copy(pending.afterGroups);
  const result = f.reconcile();
  assert.equal(result.outcomes[0].action, 'none');
  assert.equal(f.writes.length, 1);
  assert.equal(f.state.members.m001.pending, undefined);
  assert.deepEqual(f.state.members.m001.ownedAddedGroups, pending.nextManagedGroups);
});

test('transport failure after provider mutation is recovered by readback without retry', () => {
  const f = fixture();
  f.failWrite = 'after';
  assert.equal(f.reconcile().ok, true);
  assert.equal(f.writes.length, 1);
  assert.ok(f.saved.some(snapshot => snapshot.members.m001?.pending?.status === 'result_unknown'));
  assert.equal(f.state.members.m001.pending, undefined);
  f.failWrite = null;
  assert.equal(f.reconcile().outcomes[0].action, 'none');
  assert.equal(f.writes.length, 1);
});

test('pending result with matching groups but changed member metadata cannot be reconciled', () => {
  const f = fixture();
  f.failWrite = 'before';
  assert.throws(() => f.reconcile());
  const source = f.live.get('synthetic-m001');
  source.group = copy(f.state.members.m001.pending.afterGroups);
  source.point = 0;
  f.failWrite = null;
  assert.throws(() => f.reconcile(), /Unresolved group update/);
  assert.equal(f.writes.length, 1);
  assert.equal(f.state.members.m001.pending.status, 'result_unknown');
});

test('failure to persist write intent prevents the provider apply call', () => {
  const f = fixture();
  assert.throws(() => f.reconcile({ save() { throw Error('Synthetic ledger save failed'); } }), /ledger save failed/);
  assert.equal(f.writes.length, 0);
});

test('member group race between preflight and execution blocks the apply call', () => {
  const f = fixture();
  let details = 0;
  f.afterResponse = (args, response) => {
    if (isDetail(args) && ++details === 2) response.data.group.push('concurrent-purchase');
    return response;
  };
  assert.throws(() => f.reconcile(), /groups differ/i);
  assert.equal(f.writes.length, 0);
});

test('final member reread after the fresh order scan preserves a concurrent permission', () => {
  const source = member('m001', { grade: 'ordinary', group: ['baseline', VIDEO_CODES[1], VIDEO_CODES[2]] });
  const f = fixture({ members: [source], entries: { m001: tracked(source, [VIDEO_CODES[1], VIDEO_CODES[2]]) },
    orders: [purchase('m001', VIDEO_CODES[1]), purchase('m999', VIDEO_CODES[2])] });
  let scans = 0;
  let lastFreshPageEvent = -1;
  f.afterResponse = (args, response) => {
    if (args[0] === 'order') {
      if (flag(args, '--page') === '1') scans++;
      if (scans === 2 && flag(args, '--page') === '2') {
        f.live.get(source.uid).group.push('concurrent-permission');
        lastFreshPageEvent = f.events.length - 1;
      }
    }
    return response;
  };
  assert.throws(() => f.reconcile(), /groups differ/i);
  assert.equal(scans, 2);
  assert.ok(lastFreshPageEvent >= 0);
  assert.ok(f.events.findLastIndex(event => event.args && isDetail(event.args)) > lastFreshPageEvent,
    'Member must be read again after the last fresh order page');
  assert.equal(f.writes.length, 0);
  assert.equal(f.saved.length, 0);
  assert.equal(f.state.members.m001.pending, undefined);
  assert.deepEqual(f.live.get(source.uid), { ...source, group: [...source.group, 'concurrent-permission'] });
});

for (const shape of ['missing', 'null', 'array']) {
  test(`${shape} members ownership map is rejected before any source read in both modes`, () => {
    for (const apply of [false, true]) {
      const f = fixture();
      if (shape === 'missing') delete f.state.members;
      else f.state.members = shape === 'null' ? null : [];
      const before = copy(f.state);
      assert.throws(() => f.reconcile({ apply }), /Ownership members map missing or invalid/);
      assert.deepEqual(f.events, []);
      assert.deepEqual(f.saved, []);
      assert.deepEqual(f.state, before);
    }
  });
}

for (const phase of ['initial', 'fresh']) {
  for (const representation of ['number', 'string']) {
    test(`${phase} order scan rejects duplicate canonical orderNo across pages as ${representation}`, () => {
      const source = member('m001', { grade: 'ordinary', group: ['baseline', VIDEO_CODES[1]] });
      const f = fixture({ members: [source], entries: { m001: tracked(source, [VIDEO_CODES[1]]) },
        orders: [purchase('m998', VIDEO_CODES[1]), purchase('m999', VIDEO_CODES[2])] });
      const duplicate = () => {
        f.orders[1].orderNo = representation === 'number' ? f.orders[0].orderNo : String(f.orders[0].orderNo);
      };
      if (phase === 'initial') duplicate();
      else f.beforeCall = args => { if (isDry(args)) duplicate(); };
      assert.throws(() => f.reconcile(), /duplicate canonical order identity/i);
      const pages = f.events.filter(event => event.args?.[0] === 'order')
        .map(event => Number(flag(event.args, '--page')));
      assert.deepEqual(pages, phase === 'initial' ? [1, 2] : [1, 2, 1, 2]);
      assert.equal(f.dryRuns.length, phase === 'initial' ? 0 : 1);
      assert.equal(f.writes.length, 0);
      assert.equal(f.saved.length, 0);
      assert.equal(f.state.members.m001.pending, undefined);
      assert.deepEqual(f.live.get(source.uid), source);
    });
  }
}

test('distinct digit-string order numbers remain valid purchase protection across both scans', () => {
  const source = member('m001', { grade: 'ordinary', group: ['baseline', VIDEO_CODES[1], VIDEO_CODES[2]] });
  const orders = [purchase('m001', VIDEO_CODES[1]), purchase('m999', VIDEO_CODES[2])]
    .map(value => ({ ...value, orderNo: String(value.orderNo) }));
  const f = fixture({ members: [source], entries: { m001: tracked(source, [VIDEO_CODES[1], VIDEO_CODES[2]]) }, orders });
  assert.equal(f.reconcile().ok, true);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.live.get(source.uid).group, ['baseline', VIDEO_CODES[1]].sort());
  assert.deepEqual(f.state.members.m001.ownedAddedGroups, []);
});

test('offstaff removes owned groups only, preserving baseline and valid purchases across order pages', () => {
  const source = member('m001', { grade: 'ordinary',
    group: ['baseline', VIDEO_CODES[0], VIDEO_CODES[1], VIDEO_CODES[2], STAFF_GROUP, 'manual-permission'] });
  const owned = [VIDEO_CODES[1], VIDEO_CODES[2], STAFF_GROUP];
  const f = fixture({ members: [source], entries: { m001: tracked(source, owned, ['baseline', VIDEO_CODES[0]]) },
    orders: [purchase('m999', VIDEO_CODES[2]), purchase('m001', VIDEO_CODES[1])] });
  const result = f.reconcile();
  assert.equal(result.outcomes[0].removed, 2);
  assert.equal(f.writes.length, 1);
  const current = f.live.get(source.uid);
  assert.deepEqual(sort(current.group), sort(['baseline', VIDEO_CODES[0], VIDEO_CODES[1], 'manual-permission']));
  assert.deepEqual({ ...current, group: source.group }, source);
  assert.deepEqual(f.state.members.m001.ownedAddedGroups, []);
  const orderPages = f.events.filter(event => event.args?.[0] === 'order').map(event => Number(flag(event.args, '--page')));
  assert.ok(orderPages.length >= 2);
  assert.deepEqual(orderPages.slice(0, 2), [1, 2]);
  const previous = f.writes.length;
  assert.equal(f.reconcile().outcomes[0].action, 'none');
  assert.equal(f.writes.length, previous);
});

test('incomplete purchase pages block even an earlier active target before its first write', () => {
  const active = member('m001');
  const offstaff = member('m002', { grade: 'ordinary', group: ['baseline', VIDEO_CODES[1]] });
  const f = fixture({ members: [active, offstaff], entries: { m002: tracked(offstaff, [VIDEO_CODES[1]]) },
    orders: [purchase('m999', VIDEO_CODES[2]), purchase('m002', VIDEO_CODES[1])] });
  f.afterResponse = (args, response) => {
    if (args[0] === 'order' && flag(args, '--page') === '2') response.data.list = [];
    return response;
  };
  assert.throws(() => f.reconcile(), /Incomplete paginated source/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.saved.length, 0);
});

test('new purchase after preflight blocks removal before intent and apply', () => {
  const source = member('m001', { grade: 'ordinary', group: ['baseline', VIDEO_CODES[1], VIDEO_CODES[2]] });
  const f = fixture({ members: [source], entries: { m001: tracked(source, [VIDEO_CODES[1], VIDEO_CODES[2]]) },
    orders: [purchase('m001', VIDEO_CODES[1]), purchase('m999', VIDEO_CODES[2])] });
  f.beforeCall = args => {
    if (isDry(args)) f.orders.push(purchase('m001', VIDEO_CODES[2]));
  };
  assert.throws(() => f.reconcile(), /Purchase protection changed/);
  assert.equal(f.dryRuns.length, 1);
  assert.equal(f.writes.length, 0);
  assert.equal(f.saved.length, 0);
  assert.deepEqual(f.live.get(source.uid), source);
});

test('incomplete fresh purchase scan blocks removal even after a complete initial scan', () => {
  const source = member('m001', { grade: 'ordinary', group: ['baseline', VIDEO_CODES[1], VIDEO_CODES[2]] });
  const f = fixture({ members: [source], entries: { m001: tracked(source, [VIDEO_CODES[1], VIDEO_CODES[2]]) },
    orders: [purchase('m001', VIDEO_CODES[1]), purchase('m999', VIDEO_CODES[2])] });
  let scans = 0;
  f.afterResponse = (args, response) => {
    if (args[0] === 'order') {
      if (flag(args, '--page') === '1') scans++;
      if (scans === 2 && flag(args, '--page') === '2') response.data.list = [];
    }
    return response;
  };
  assert.throws(() => f.reconcile(), /Incomplete paginated source/);
  assert.equal(scans, 2);
  assert.equal(f.dryRuns.length, 1);
  assert.equal(f.writes.length, 0);
  assert.equal(f.saved.length, 0);
});

test('purchase expiring during preparation blocks removal using the fresh wall clock', t => {
  const source = member('m001', { grade: 'ordinary', group: ['baseline', VIDEO_CODES[1], VIDEO_CODES[2]] });
  const f = fixture({ members: [source], entries: { m001: tracked(source, [VIDEO_CODES[1], VIDEO_CODES[2]]) },
    orders: [purchase('m001', VIDEO_CODES[1])] });
  f.beforeCall = args => {
    if (isDry(args)) t.mock.timers.tick(30 * 86_400_000);
  };
  assert.throws(() => f.reconcile(), /Purchase protection changed/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.saved.length, 0);
  assert.deepEqual(f.live.get(source.uid), source);
});

for (const token of [
  { status: 'healthy', should_refresh: true },
  { status: 'expired', should_refresh: false },
  { status: 'expiring', should_refresh: false },
]) {
  test(`token ${JSON.stringify(token)} refreshes once and rechecks context before sources`, () => {
    const f = fixture();
    let contexts = 0;
    f.afterResponse = (args, response) => {
      if (args[0] === 'config' && ++contexts === 1) {
        response.token = copy(token);
        response.remote_context.write_ready = false;
      }
      return response;
    };
    assert.equal(f.reconcile().ok, true);
    const calls = f.events.filter(event => event.kind === 'call').map(event => event.args);
    assert.deepEqual(calls.slice(0, 3), [['config', 'context'], ['auth', 'refresh'], ['config', 'context']]);
    assert.equal(calls.filter(args => args[0] === 'auth').length, 1);
    assert.equal(f.writes.length, 1);
  });
}

test('refresh without a healthy follow-up context fails before member sources or writes', () => {
  const f = fixture();
  f.afterResponse = (args, response) => {
    if (args[0] === 'config') response.token = { status: 'expired' };
    return response;
  };
  assert.throws(() => f.reconcile(), /profile\/auth mismatch/);
  assert.deepEqual(f.events.map(event => event.args),
    [['config', 'context'], ['auth', 'refresh'], ['config', 'context']]);
  assert.equal(f.writes.length, 0);
  assert.equal(f.saved.length, 0);
});

test('wrong site never triggers auth refresh or source access', () => {
  const f = fixture();
  f.afterResponse = (args, response) => {
    if (args[0] === 'config') {
      response.resolved_profile.site_code = 'wrong-site';
      response.token = { status: 'expired', should_refresh: true };
    }
    return response;
  };
  assert.throws(() => f.reconcile(), /profile\/auth mismatch/);
  assert.deepEqual(f.events.map(event => event.args), [['config', 'context']]);
  assert.equal(f.writes.length, 0);
});

for (const [name, corrupt, message] of [
  ['catalog missing last page rows', (args, response) => {
    if (args.slice(0, 3).join(' ') === 'member groups list' && flag(args, '--page') === '2') response.data.list = [];
  }, /Incomplete paginated source/],
  ['grade total changing between pages', (args, response) => {
    if (args.slice(0, 3).join(' ') === 'member grades list' && flag(args, '--page') === '2') response.data.totalCount++;
  }, /Source changed during scan/],
  ['member pagination missing hasNext', (args, response) => {
    if (args[0] === 'member' && args[1] === 'list') delete response.data.hasNext;
  }, /Incomplete member source/],
  ['member pagination missing next cursor', (args, response) => {
    if (args[0] === 'member' && args[1] === 'list') { response.data.hasNext = true; delete response.data.nextCursor; }
  }, /Incomplete member cursor/],
  ['member pagination repeated cursor', (args, response) => {
    if (args[0] === 'member' && args[1] === 'list' && args.includes('--cursor')) {
      response.data.hasNext = true; response.data.nextCursor = 'synthetic-page-2';
    }
  }, /Incomplete member cursor/],
  ['last member detail scope mismatch', (args, response) => {
    if (isDetail(args) && args[2] === 'synthetic-m002') response.data.unitCode = 'wrong-unit';
  }, /Member identity mismatch/],
  ['auth not ready', (args, response) => {
    if (args[0] === 'config') response.remote_context.write_ready = false;
  }, /profile\/auth mismatch/],
  ['dry-run missing bulk gate token', (args, response) => {
    if (isDry(args)) delete response.safety.bulk_confirmation_token;
  }, /bulk confirmation token/],
]) {
  test(`incomplete/unsafe source: ${name} stops before writes`, () => {
    const f = fixture({ members: [member('m001'), member('m002')] });
    f.afterResponse = (args, response) => { corrupt(args, response); return response; };
    assert.throws(() => f.reconcile(), message);
    assert.equal(f.writes.length, 0);
    assert.equal(f.saved.length, 0);
  });
}

test('catalog below thirty groups stops before any member update', () => {
  const f = fixture();
  f.groups = f.groups.filter(row => row.siteGroupCode !== VIDEO_CODES[29]);
  assert.throws(() => f.reconcile(), /incomplete video catalog/i);
  assert.equal(f.writes.length, 0);
  assert.equal(f.dryRuns.length, 0);
});

test('unapproved policy rejects before any source access', () => {
  const f = fixture();
  f.state.approved = false;
  assert.throws(() => f.reconcile(), /Approved staff policy/);
  assert.deepEqual(f.events, []);
});
test('a malformed tracked native grade cannot be mistaken for a staff exit', () => {
  for (const grade of [[STAFF_GRADE], { code: STAFF_GRADE }]) {
    const source = member('m001', { grade, group: ['baseline', VIDEO_CODES[1]] });
    const f = fixture({ members: [source], entries: { m001: tracked(source, [VIDEO_CODES[1]]) } });
    assert.throws(() => f.reconcile(), /Ambiguous native member grade/);
    assert.equal(f.writes.length, 0); assert.equal(f.saved.length, 0);
  }
});
