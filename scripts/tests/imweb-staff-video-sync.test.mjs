import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { reconcileStaffVideos as reconcileRuntimeStaffVideos, STAFF_VIDEO_POLICY } from '../lib/imweb-staff-video-sync.mjs';
import { E261017_SHARE, A261024_SHARE, B261024_SHARE, C261025_SHARE, D261025_SHARE, STUDENT_SHARE_SOURCES } from '../lib/imweb-student-share-policy.mjs';
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
const STAFF_SHARE_START = Date.parse('2026-10-25T01:16:33.501Z');
const STAFF_SHARE_END = STAFF_SHARE_START + 40 * 86400000;

const emptyShares = () => STUDENT_SHARE_SOURCES.map(source => ({ source, state: {
  accessPolicy: { id: source.policyId, approved: true, days: 40,
    basis: 'first_verified_grant', revocation: source.revocation },
  entitlements: {}, manualImmediateGrants: {},
} }));
const reconcileStaffVideos = (state, options = {}) => reconcileRuntimeStaffVideos(state,
  { readStudentShares: emptyShares, ...options });

function shareLedger(code, start = NOW - 86400000, source = E261017_SHARE) {
  const verifiedAt = new Date(start).toISOString();
  const expiresAt = new Date(start + 40 * 86400000).toISOString();
  const grant = { status: 'group_verified', verifiedAt, beforeGroups: ['baseline'],
    afterGroups: ['baseline', source.groupCode], existingGroupsPreserved: true };
  const ledgers = emptyShares();
  const selected = ledgers.find(item => item.source === source);
  selected.state.manualImmediateGrants[code] = grant;
  selected.state.entitlements[code] = { memberCode: code, policyId: source.policyId,
    groupCode: source.groupCode, grantedAt: verifiedAt, expiresAt, status: 'active' };
  return ledgers;
}

function exitWithShare(share = E261017_SHARE) {
  const source = member('m001', { grade: 'ordinary', group: ['baseline', share.groupCode, VIDEO_CODES[1]] });
  const f = fixture({ members: [source], entries: { [source.memberCode]: tracked(source,
    [share.groupCode, VIDEO_CODES[1]]) } });
  const [team, date] = share.policyId.split('-')[0].match(/^([a-z])(\d+)$/).slice(1);
  f.groups.push({ siteCode: SITE, siteGroupCode: share.groupCode,
    title: `PRIVATE LESSON EXTERNAL FEEDBACK ${team.toUpperCase()} ${date} 40D` });
  return { f, source, ledgers: shareLedger(source.memberCode, NOW - 86400000, share) };
}

function staffReceiptLedgers(code, share) {
  const ledgers = shareLedger(code, STAFF_SHARE_START, share);
  const state = ledgers.find(item => item.source === share).state;
  const receipt = state.manualImmediateGrants[code];
  Object.assign(receipt, { kind: 'student_share_existing_staff', beforeGrade: STAFF_GRADE,
    afterGrade: STAFF_GRADE, beforeGroups: [...receipt.afterGroups],
    attendanceEvidence: { source: 'studiomate_live_lesson_detail', status: 'both_sessions_attended',
      memberCode: code, date: share.lessonDate, lessonIds: [...share.lessonIds] } });
  state.entitlements[code].grantEvidence = 'manualImmediateGrants:independent_attendance_share_on_staff';
  return ledgers;
}

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
        title: `ARCHIVE METHOD A${index} 40D` })),
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
  assert.throws(() => f.reconcile(), /protection changed/);
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
  assert.throws(() => f.reconcile(), /protection changed/);
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

test('STAFF exit preserves independent student-share access and drops only other owned groups', () => {
  const { f, source, ledgers } = exitWithShare(); const before = copy(ledgers);
  const options = { readStudentShares: () => copy(ledgers) };
  f.reconcile(options);
  assert.deepEqual(sort(f.live.get(source.uid).group), sort(['baseline', E261017_SHARE.groupCode]));
  assert.equal(f.writes.length, 1); assert.deepEqual(ledgers, before);
  assert.deepEqual(f.state.members[source.memberCode].ownedAddedGroups, []);
  f.reconcile(options); assert.equal(f.writes.length, 1);
});

test('grant-only student-share evidence preserves access until the expiry worker adopts it', () => {
  const { f, source, ledgers } = exitWithShare(); ledgers[0].state.entitlements = {};
  const before = copy(ledgers); f.reconcile({ readStudentShares: () => copy(ledgers) });
  assert.ok(f.live.get(source.uid).group.includes(E261017_SHARE.groupCode));
  assert.deepEqual(ledgers, before);
});

test('read-only student-share protection changes neither membership nor either ledger', () => {
  const { f, ledgers } = exitWithShare(); const state = copy(f.state); const before = copy(ledgers);
  const result = f.reconcile({ apply: false, readStudentShares: () => copy(ledgers) });
  assert.equal(result.outcomes[0].removed, 1); assert.equal(f.writes.length, 0);
  assert.deepEqual(f.state, state); assert.deepEqual(ledgers, before);
});

test('expired or terminal student-share cannot preserve access on STAFF exit', () => {
  for (const terminal of [undefined, 'revoked', 'removed_externally']) {
    const { f, source } = exitWithShare();
    const ledgers = shareLedger(source.memberCode, terminal ? NOW - 1 : NOW - 40 * 86400000);
    if (terminal) ledgers[0].state.entitlements[source.memberCode].status = terminal;
    f.reconcile({ readStudentShares: () => copy(ledgers) });
    assert.deepEqual(f.live.get(source.uid).group, ['baseline']);
  }
});

test('missing, malformed, or pending student-share evidence blocks every provider write', () => {
  for (const corrupt of [() => { throw Error('Missing student-share file'); }, () => [],
    value => { value[0].state.entitlements = null; return value; },
    value => { value[0].state.entitlements.m001.grantedAt = new Date(NOW).toISOString(); return value; },
    value => { value[0].state.entitlements.m001.revocation = { status: 'result_unknown' }; return value; }]) {
    const { f, ledgers } = exitWithShare();
    assert.throws(() => f.reconcile({ readStudentShares: () => corrupt(copy(ledgers)) }));
    assert.equal(f.writes.length, 0); assert.equal(f.saved.length, 0);
  }
});

test('a student-share change after preflight blocks removal before saving intent', () => {
  const { f, ledgers } = exitWithShare(); let reads = 0;
  assert.throws(() => f.reconcile({ readStudentShares: () => ++reads === 1 ? emptyShares() : copy(ledgers) }),
    /protection changed/);
  assert.equal(f.writes.length, 0); assert.equal(f.saved.length, 0);
});

test('student-share expiration crossing during preparation aborts until replanned', () => {
  const { f, source } = exitWithShare();
  const ledgers = shareLedger(source.memberCode, NOW - 40 * 86400000 + 1);
  f.afterResponse = args => { if (isDry(args)) Date.now = () => NOW + 2; };
  const original = Date.now;
  try {
    assert.throws(() => f.reconcile({ readStudentShares: () => copy(ledgers) }), /protection changed/);
    assert.equal(f.writes.length, 0); assert.equal(f.saved.length, 0);
  } finally { Date.now = original; }
});

test('legacy student-share without an approved timestamp source blocks automatic STAFF exit', () => {
  const { f, ledgers } = exitWithShare();
  f.groups.find(group=>group.siteGroupCode===VIDEO_CODES[1]).title='PRIVATE LESSON LEGACY A 40D';
  assert.throws(()=>f.reconcile({readStudentShares:()=>copy(ledgers)}), /Unregistered student-share/);
  assert.equal(f.writes.length,0);assert.equal(f.saved.length,0);
});

for (const share of [A261024_SHARE, B261024_SHARE, C261025_SHARE, D261025_SHARE]) {
  const other = share === A261024_SHARE ? B261024_SHARE : A261024_SHARE;
  test(`STAFF exit preserves active ${share.policyId} without touching first-grant evidence`, () => {
    const { f, source, ledgers } = exitWithShare(share);
    const before = copy(ledgers);
    const options = { readStudentShares: () => copy(ledgers) };
    f.reconcile(options);
    assert.deepEqual(sort(f.live.get(source.uid).group), sort(['baseline', share.groupCode]));
    assert.deepEqual(ledgers, before);
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.state.members[source.memberCode].ownedAddedGroups, []);
    f.reconcile(options);
    assert.equal(f.writes.length, 1);
    assert.deepEqual(ledgers, before);
  });

  test(`${share.policyId} grant-only access preserves the original clock without adoption`, () => {
    const { f, source, ledgers } = exitWithShare(share);
    const selected = ledgers.find(item => item.source === share);
    selected.state.entitlements = {};
    const before = copy(ledgers);
    f.reconcile({ readStudentShares: () => copy(ledgers) });
    assert.deepEqual(sort(f.live.get(source.uid).group), sort(['baseline', share.groupCode]));
    assert.deepEqual(ledgers, before);
  });

  test(`expired ${share.policyId} access is not preserved by a valid grant for the other team`, () => {
    const { f, source } = exitWithShare(share);
    const expired = shareLedger(source.memberCode, NOW - 40 * 86400000, share);
    const activeOther = shareLedger(source.memberCode, NOW - 86400000, other);
    const ledgers = expired.map(item => item.source === other
      ? activeOther.find(value => value.source === other) : item);
    const before = copy(ledgers);
    f.reconcile({ readStudentShares: () => copy(ledgers) });
    assert.deepEqual(f.live.get(source.uid).group, ['baseline']);
    assert.deepEqual(ledgers, before);
    assert.equal(f.writes.length, 1);
  });

  test(`missing or unresolved ${share.policyId} evidence blocks all STAFF writes`, () => {
    for (const corrupt of [
      rows => rows.filter(item => item.source.policyId !== share.policyId),
      rows => { rows.find(item => item.source.policyId === share.policyId).state.entitlements = null; return rows; },
      rows => {
        rows.find(item => item.source.policyId === share.policyId).state.entitlements.m001.revocation = { status: 'result_unknown' };
        return rows;
      },
    ]) {
      const { f, ledgers } = exitWithShare(share);
      const before = copy(f.state);
      assert.throws(() => f.reconcile({ readStudentShares: () => corrupt(copy(ledgers)) }),
        /Student-share evidence missing or inconsistent/);
      assert.equal(f.writes.length, 0); assert.equal(f.saved.length, 0);
      assert.deepEqual(f.state, before);
    }
  });
}

test('STAFF exit protects B but removes expired A when the same member belongs to both teams', () => {
  const source = member('m001', { grade: 'ordinary',
    group: ['baseline', A261024_SHARE.groupCode, B261024_SHARE.groupCode, VIDEO_CODES[1]] });
  const owned = [A261024_SHARE.groupCode, B261024_SHARE.groupCode, VIDEO_CODES[1]];
  const f = fixture({ members: [source], entries: { [source.memberCode]: tracked(source, owned) } });
  for (const [share, team] of [[A261024_SHARE, 'A'], [B261024_SHARE, 'B']]) {
    f.groups.push({ siteCode: SITE, siteGroupCode: share.groupCode,
      title: `PRIVATE LESSON EXTERNAL FEEDBACK ${team} 261024 40D` });
  }
  const expiredA = shareLedger(source.memberCode, NOW - 40 * 86400000, A261024_SHARE);
  const activeB = shareLedger(source.memberCode, NOW - 86400000, B261024_SHARE);
  const ledgers = expiredA.map(item => item.source === B261024_SHARE
    ? activeB.find(value => value.source === B261024_SHARE) : item);
  const before = copy(ledgers);
  f.reconcile({ readStudentShares: () => copy(ledgers) });
  assert.deepEqual(sort(f.live.get(source.uid).group), sort(['baseline', B261024_SHARE.groupCode]));
  assert.deepEqual({ ...f.live.get(source.uid), group: source.group }, source);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(ledgers, before);
});

for (const share of [A261024_SHARE, B261024_SHARE, C261025_SHARE, D261025_SHARE]) {
  test(`STAFF exit preserves ${share.policyId} existing-STAFF receipt without remove/re-add or clock reset`, t => {
    t.mock.timers.setTime(STAFF_SHARE_START + 86400000);
    for (const adopted of [false, true]) {
      const { f, source } = exitWithShare(share);
      const ledgers = staffReceiptLedgers(source.memberCode, share);
      if (!adopted) ledgers.find(item => item.source === share).state.entitlements = {};
      const before = copy(ledgers);
      const options = { now: STAFF_SHARE_START + 86400000, readStudentShares: () => copy(ledgers) };
      f.reconcile(options);
      assert.deepEqual(sort(f.live.get(source.uid).group), sort(['baseline', share.groupCode]));
      assert.deepEqual({ ...f.live.get(source.uid), group: source.group }, source);
      assert.equal(f.writes.length, 1);
      const body = JSON.parse(flag(f.writes[0].args, '--data'));
      assert.ok(body.groupCodes.includes(share.groupCode), 'Never remove independent attendee access');
      f.reconcile(options);
      assert.equal(f.writes.length, 1, 'No remove/re-add transition may be fabricated');
      assert.deepEqual(ledgers, before);
    }
  });

  test(`${share.policyId} existing-STAFF receipt has an exact exclusive expiry after STAFF exit`, t => {
    for (const now of [STAFF_SHARE_END - 1, STAFF_SHARE_END]) {
      t.mock.timers.setTime(now);
      const { f, source } = exitWithShare(share);
      const ledgers = staffReceiptLedgers(source.memberCode, share);
      const before = copy(ledgers);
      f.reconcile({ now, readStudentShares: () => copy(ledgers) });
      assert.deepEqual(sort(f.live.get(source.uid).group),
        sort(now < STAFF_SHARE_END ? ['baseline', share.groupCode] : ['baseline']));
      assert.deepEqual(ledgers, before);
    }
  });

  test(`invalid ${share.policyId} existing-STAFF proof blocks every STAFF exit write`, t => {
    const now = STAFF_SHARE_START + 86400000;
    t.mock.timers.setTime(now);
    for (const mutate of [
      receipt => { delete receipt.kind; },
      receipt => { receipt.beforeGrade = 'ordinary'; },
      receipt => { receipt.attendanceEvidence.memberCode = 'm002'; },
      receipt => { receipt.attendanceEvidence.status = 'one_session_attended'; },
      receipt => { receipt.attendanceEvidence.lessonIds = [...(share === A261024_SHARE ? B261024_SHARE : A261024_SHARE).lessonIds]; },
    ]) {
      const { f, source } = exitWithShare(share);
      const ledgers = staffReceiptLedgers(source.memberCode, share);
      mutate(ledgers.find(item => item.source === share).state.manualImmediateGrants[source.memberCode]);
      const before = copy(f.state);
      assert.throws(() => f.reconcile({ now, readStudentShares: () => copy(ledgers) }), /Student-share evidence/);
      assert.equal(f.writes.length, 0); assert.equal(f.saved.length, 0);
      assert.deepEqual(f.state, before);
      assert.deepEqual(f.live.get(source.uid), source);
    }
  });
}
