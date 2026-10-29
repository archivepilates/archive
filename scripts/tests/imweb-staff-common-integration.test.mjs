import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reconcileStaffVideos, runStaffVideoSync, STAFF_VIDEO_POLICY } from '../lib/imweb-staff-video-sync.mjs';
import { verifyStaffVideoAccess } from '../lib/imweb-staff-video-verification.mjs';
import { COMMON_STAFF_ACCESS_MODE, SITE, UNIT, STAFF_GRADE, STAFF_GROUP } from '../lib/imweb-staff-video-policy.mjs';
import { E261017_SHARE, STUDENT_SHARE_SOURCES } from '../lib/imweb-student-share-policy.mjs';

const NOW = Date.parse('2026-10-29T01:00:00Z');
const copy = value => structuredClone(value);
const sorted = values => [...values].sort();
const flag = (args, name) => args[args.indexOf(name) + 1];
const emptyShares = () => STUDENT_SHARE_SOURCES.map(source => ({ source, state: {
  accessPolicy: { id: source.policyId, approved: true, days: 40,
    basis: 'first_verified_grant', revocation: source.revocation },
  entitlements: {}, manualImmediateGrants: {},
} }));

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: NOW }));

function fixture(count = 49) {
  const codes = Array.from({ length: count }, (_, index) => `g${(256 + index).toString(16)}`);
  const member = { siteCode: SITE, unitCode: UNIT, memberCode: 'm001', uid: 'synthetic-member',
    grade: STAFF_GRADE, group: ['baseline', codes[0]], metadata: { consent: false, notes: ['preserve'] } };
  const groups = codes.map((siteGroupCode, index) => ({ siteCode: SITE, siteGroupCode,
    title: `ARCHIVE METHOD A${index} 40D` }));
  groups.push({ siteCode: SITE, siteGroupCode: STAFF_GROUP, title: 'ARCHIVE STAFF' });
  const originals = codes.map((code, index) => ({ menuCode: `page-${index}`,
    url: `/archive-method-watch-a${index}`, accessPermission: { type: 'group', groupCodes: [code] } }));
  const menus = originals.map(row => ({ ...copy(row),
    accessPermission: { type: 'group', groupCodes: [...row.accessPermission.groupCodes, STAFF_GROUP] } }));
  const state = { policyVersion: STAFF_VIDEO_POLICY, approved: true, members: {
    m001: { memberCode: member.memberCode, uid: member.uid, baselineGroups: ['baseline'],
      ownedAddedGroups: [codes[0]], firstObservedAt: '2026-10-20T00:00:00Z' },
  } };
  const f = { codes, member, groups, menus, state, calls: [], saved: [], orders: [], shares: emptyShares(),
    commonAccess: { mode: COMMON_STAFF_ACCESS_MODE, baselineMenus: copy(originals) },
    beforeWrite: null, failWrite: false, independentMembers: null, otherMembers: [] };
  const page = (rows, args) => {
    const currentPage = Number(flag(args, '--page'));
    assert.equal(flag(args, '--limit'), '100');
    const totalPage = Math.max(1, Math.ceil(rows.length / 25));
    assert.ok(currentPage >= 1 && currentPage <= totalPage);
    return { data: { list: copy(rows.slice((currentPage - 1) * 25, currentPage * 25)),
      currentPage, totalPage, totalCount: rows.length } };
  };
  f.run = args => {
    f.calls.push(copy(args));
    const command = args.slice(0, 3).join(' ');
    if (command === 'config context') return { effective_profile: 'default',
      resolved_profile: { site_code: SITE, unit_code: UNIT },
      remote_context: { write_ready: true }, token: { status: 'healthy' } };
    if (args[0] === 'site') {
      assert.deepEqual(args, ['site', 'menu', '--unit-code', UNIT]);
      return { data: copy(f.menus) };
    }
    if (command === 'member groups list') return page(f.groups, args);
    if (command === 'member grades list') return page([
      { memberGradeCode: STAFF_GRADE, title: '\uC2A4\uD15D', useAutoGrade: 'N' },
    ], args);
    if (command === 'member groups members') {
      assert.equal(args[3], STAFF_GROUP, 'Common verifier must not query per-video memberships');
      assert.equal(flag(args, '--unit-code'), UNIT);
      return page(f.independentMembers ?? [f.member, ...f.otherMembers].filter(row => row.group.includes(STAFF_GROUP)), args);
    }
    if (args[0] === 'member' && args[1] === 'list') {
      assert.deepEqual(args, ['member', 'list', '--unit-code', UNIT, '--limit', '50']);
      return { data: { list: copy([f.member, ...f.otherMembers]), hasNext: false } };
    }
    if (args[0] === 'member' && args[1] === 'get') {
      assert.deepEqual(args, ['member', 'get', f.member.uid, '--unit-code', UNIT]);
      return { data: copy(f.member) };
    }
    if (args[0] === 'order') return page(f.orders, args);
    if (command === 'member update groups') {
      assert.equal(args[3], f.member.uid);
      const body = JSON.parse(flag(args, '--data'));
      assert.deepEqual(Object.keys(body).sort(), ['groupCodes', 'unitCode']);
      assert.equal(body.unitCode, UNIT);
      assert.ok(body.groupCodes.length <= 50);
      if (args.includes('--dry-run')) return { confirmation_token: 'synthetic-confirm', body,
        safety: { bulk_confirmation_required_for_execute: false } };
      assert.ok(args.includes('--yes'));
      assert.equal(flag(args, '--confirm-token'), 'synthetic-confirm');
      assert.equal(f.state.members.m001.pending.status, 'intent');
      assert.ok(f.saved.some(saved => saved.members.m001.pending?.status === 'intent'));
      f.beforeWrite?.();
      if (f.failWrite) throw Error('Synthetic unknown transport');
      f.member.group = copy(body.groupCodes);
      return { statusCode: 200 };
    }
    assert.fail(`Unexpected mock command: ${JSON.stringify(args)}`);
  };
  f.reconcile = (options = {}) => reconcileStaffVideos(f.state, { run: f.run, apply: true, now: NOW,
    commonAccess: f.commonAccess, readStudentShares: () => f.shares,
    save: value => f.saved.push(copy(value)), ...options });
  f.verify = (options = {}) => verifyStaffVideoAccess({ run: f.run, state: f.state,
    commonAccess: f.commonAccess, ...options });
  f.updates = () => f.calls.filter(args => args.slice(0, 3).join(' ') === 'member update groups');
  return f;
}

test('common sync handles 49 groups, saves intent and adds STAFF only without changing legacy ownership', () => {
  const f = fixture(), before = copy(f.member), baseline = copy(f.state.members.m001.baselineGroups);
  const result = f.reconcile({ expectedGroupCodes: [f.codes[48]] });
  assert.equal(result.accessMode, COMMON_STAFF_ACCESS_MODE);
  assert.equal(result.catalogGroups, 49);
  assert.equal(result.nativeAcl.ok, true);
  assert.equal(result.nativeAcl.menuCount, 49);
  assert.deepEqual(f.member, { ...before, group: sorted([...before.group, STAFF_GROUP]) });
  assert.deepEqual(f.state.members.m001.baselineGroups, baseline);
  assert.deepEqual(f.state.members.m001.ownedAddedGroups, sorted([f.codes[0], STAFF_GROUP]));
  assert.equal(f.state.members.m001.firstObservedAt, '2026-10-20T00:00:00Z');
  assert.equal(f.state.members.m001.pending, undefined);
  assert.equal(f.state.members.m001.commonStaffGroupManaged, true);
  assert.equal(f.updates().length, 2);
  const aclIndex = f.calls.findIndex(args => args[0] === 'site');
  const firstUpdate = f.calls.findIndex(args => args.slice(0, 3).join(' ') === 'member update groups');
  assert.ok(aclIndex >= 0 && aclIndex < firstUpdate);
});

test('common verifier independently rereads native ACL and only the STAFF membership list', () => {
  const f = fixture();
  const sync = f.reconcile(), verification = f.verify({ expectedGroupCodes: [f.codes[48]] });
  assert.equal(verification.ok, true);
  assert.equal(verification.accessMode, COMMON_STAFF_ACCESS_MODE);
  assert.deepEqual(verification.nativeAcl, sync.nativeAcl);
  assert.equal(verification.catalogGroups, 49);
  assert.equal(verification.independentlyVerifiedGroupLists, 1);
  assert.equal(verification.memberDetails[0].requiredGroupsVerified, 1);
  assert.equal(verification.ordinaryMemberPlayback, 'not_verified');
  assert.equal(f.calls.filter(args => args[0] === 'site').length, 3);
  assert.deepEqual(f.calls.filter(args => args[2] === 'members').map(args => args[3]), [STAFF_GROUP]);
});

test('future native catalog and menu growth does not grow member groups or trigger updates', () => {
  const f = fixture(); f.reconcile();
  const before = copy(f.member.group), updates = f.updates().length;
  f.groups.push({ siteCode: SITE, siteGroupCode: 'gfff', title: 'ARCHIVE METHOD FUTURE 40D' });
  f.menus.push({ menuCode: 'future', url: '/archive-method-watch-future',
    accessPermission: { type: 'group', groupCodes: ['gfff', STAFF_GROUP] } });
  assert.equal(f.reconcile().catalogGroups, 50);
  assert.equal(f.verify().catalogGroups, 50);
  assert.deepEqual(f.member.group, before);
  assert.equal(f.updates().length, updates);
});

for (const [name, change] of [
  ['lost buyer', f => { f.menus[0].accessPermission.groupCodes = [STAFF_GROUP]; }],
  ['missing STAFF', f => { f.menus[0].accessPermission.groupCodes = [f.codes[0]]; }],
  ['public page', f => { f.menus[0].accessPermission.type = 'guest'; }],
  ['missing page', f => { f.menus.pop(); }],
  ['invalid menu envelope', f => { f.menus = { list: f.menus }; }],
]) test(`native ACL ${name} blocks sync before dry-run, intent saves or writes`, () => {
  const f = fixture(); change(f);
  const before = copy({ state: f.state, member: f.member });
  assert.throws(() => f.reconcile());
  assert.deepEqual(f.updates(), []);
  assert.deepEqual(f.saved, []);
  assert.deepEqual({ state: f.state, member: f.member }, before);
});

test('independent verification rejects ACL changes after successful sync', () => {
  const f = fixture(); f.reconcile();
  const updates = f.updates().length;
  f.menus[0].accessPermission.groupCodes = [STAFF_GROUP];
  assert.throws(() => f.verify(), /Baseline ACL/);
  assert.equal(f.calls.filter(args => args[0] === 'site').length, 3);
  assert.equal(f.updates().length, updates);
});

test('independent verification still requires native STAFF membership and preserved baseline', () => {
  const f = fixture(); f.reconcile();
  f.independentMembers = [];
  assert.throws(() => f.verify(), /membership missing/);
  f.independentMembers = null;
  f.member.group = f.member.group.filter(code => code !== STAFF_GROUP);
  assert.throws(() => f.verify(), /staff permission missing/);
  f.member.group = [STAFF_GROUP];
  assert.throws(() => f.verify(), /baseline permission missing/);
});

test('ACL drift after dry-run blocks the individual write before saving intent', () => {
  const f = fixture(), original = f.run, before = copy(f.state);
  const run = args => {
    const result = original(args);
    if (args.includes('--dry-run')) f.menus[0].accessPermission.groupCodes = [STAFF_GROUP];
    return result;
  };
  assert.throws(() => f.reconcile({run}), /Baseline ACL/);
  assert.ok(!f.calls.some(args => args.includes('--yes')));
  assert.deepEqual(f.saved, []);
  assert.deepEqual(f.state, before);
});

test('legacy mode still rejects 49 groups without native ACL reads or writes', () => {
  const f = fixture();
  assert.throws(() => f.reconcile({ commonAccess: null }), /48/);
  assert.throws(() => f.verify({ commonAccess: null }), /48/);
  assert.ok(!f.calls.some(args => args[0] === 'site'));
  assert.deepEqual(f.updates(), []);
});

test('common sync retains the native 50-member-group guard before all writes', () => {
  const f = fixture();
  f.member.group = Array.from({ length: 50 }, (_, index) => `existing-${index}`);
  f.state.members.m001.baselineGroups = copy(f.member.group);
  f.state.members.m001.ownedAddedGroups = [];
  assert.throws(() => f.reconcile(), /Member group hard limit/);
  assert.deepEqual(f.updates(), []);
  assert.deepEqual(f.saved, []);
});

test('common offstaff removal preserves current purchase and original student-share clocks', () => {
  const f = fixture(), share = E261017_SHARE;
  f.member.grade = 'ordinary';
  f.member.group = ['baseline', STAFF_GROUP, f.codes[0], f.codes[1], share.groupCode];
  f.state.members.m001.baselineGroups = ['baseline', STAFF_GROUP];
  f.state.members.m001.ownedAddedGroups = [f.codes[0], f.codes[1], share.groupCode];
  f.state.members.m001.commonStaffGroupManaged = true;
  f.groups.push({ siteCode: SITE, siteGroupCode: share.groupCode, title: 'PRIVATE LESSON E261017 40D' });
  f.menus.push({ menuCode: 'share', url: '/private-lesson-e261017',
    accessPermission: { type: 'group', groupCodes: [share.groupCode, STAFF_GROUP] } });
  const paidAt = new Date(NOW - 86400000).toISOString();
  f.orders = [{ orderNo: 1, siteCode: SITE, unitCode: UNIT, memberCode: 'm001', orderStatus: 'CLOSED',
    sections: [{ orderSectionStatus: 'PURCHASE_COMPLETE', sectionItems: [
      { productInfo: { groupPassCode: f.codes[0], groupPassDayCnt: 40 } },
    ] }], payments: [{ paymentStatus: 'PAYMENT_COMPLETE', paymentCompleteTime: paidAt }] }];
  const ledger = f.shares.find(row => row.source === share).state;
  ledger.manualImmediateGrants.m001 = { status: 'group_verified', verifiedAt: paidAt,
    beforeGroups: ['baseline'], afterGroups: ['baseline', share.groupCode], existingGroupsPreserved: true };
  const shareBefore = copy(f.shares);
  const result = f.reconcile();
  assert.equal(result.outcomes[0].removed, 2);
  assert.deepEqual(f.member.group, sorted(['baseline', f.codes[0], share.groupCode]));
  assert.deepEqual(f.state.members.m001.baselineGroups, ['baseline', STAFF_GROUP]);
  assert.deepEqual(f.state.members.m001.ownedAddedGroups, []);
  assert.deepEqual(f.shares, shareBefore);
});

test('common unknown write remains pending and is never retried', () => {
  const f = fixture(); f.failWrite = true;
  assert.throws(() => f.reconcile(), { code: 'STAFF_GROUP_RESULT_UNKNOWN' });
  const pending = copy(f.state.members.m001.pending), updates = f.updates().length;
  assert.equal(pending.status, 'result_unknown');
  assert.equal(f.state.members.m001.commonStaffGroupManaged, undefined);
  assert.throws(() => f.reconcile(), /Unresolved group update/);
  assert.equal(f.updates().length, updates);
  assert.deepEqual(f.state.members.m001.pending, pending);
});

test('common mode cannot discard or replay an existing legacy unknown intent', () => {
  const f = fixture();
  const fields = Object.fromEntries(Object.entries(f.member).filter(([key]) => key !== 'group')
    .sort(([a], [b]) => a.localeCompare(b)));
  f.state.members.m001.pending = { status: 'result_unknown', at: new Date(NOW).toISOString(),
    memberHash: createHash('sha256').update(JSON.stringify(fields)).digest('hex'),
    beforeGroups: sorted(f.member.group), afterGroups: sorted([...f.member.group, ...f.codes, STAFF_GROUP]
      .filter((code, index, rows) => rows.indexOf(code) === index)),
    nextManagedGroups: sorted([...f.codes, STAFF_GROUP]) };
  const before = copy(f.state);
  assert.throws(() => f.reconcile(), /Unresolved group update/);
  assert.deepEqual(f.updates(), []);
  assert.deepEqual(f.state, before);
});

test('runner derives common activation from config and passes it to sync and independent verification', async () => {
  const f = fixture(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'imweb-common-integration-'));
  f.member.group.push(STAFF_GROUP);
  f.state.members.m001.ownedAddedGroups.push(STAFF_GROUP);
  const commonAccess = { ...f.commonAccess, approved: true, siteCode: SITE, unitCode: UNIT,
    activation: { nativeAclFingerprint: 'a'.repeat(64), verifiedAt: new Date(NOW).toISOString(),
      staffOnlyAllowed: true, buyerAllowed: true, ordinaryDenied: true, loggedOutDenied: true,
      testAccountRestored: true, classroomStaffDiscovery: true } };
  let releases = 0, verifications = 0;
  try {
    fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ policyVersion: STAFF_VIDEO_POLICY,
      approved: true, siteCode: SITE, unitCode: UNIT, commonAccess }), { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(f.state), { mode: 0o600 });
    const result = await runStaffVideoSync({ directory, run: f.run, apply: true,
      acquireLock: async () => () => { releases++; }, verify: options => {
        verifications++;
        assert.equal(options.commonAccess.mode, COMMON_STAFF_ACCESS_MODE);
        assert.deepEqual(options.commonAccess.baselineMenus, f.commonAccess.baselineMenus);
        return verifyStaffVideoAccess(options);
      } });
    assert.equal(result.accessVerified, true);
    assert.equal(result.accessMode, COMMON_STAFF_ACCESS_MODE);
    assert.equal(result.verification.accessMode, COMMON_STAFF_ACCESS_MODE);
    assert.deepEqual(result.nativeAcl, result.verification.nativeAcl);
    assert.equal(f.calls.filter(args => args[0] === 'site').length, 2);
    assert.deepEqual(f.updates(), []);
    assert.equal(verifications, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'));
    assert.equal(saved.lastRun.accessMode, COMMON_STAFF_ACCESS_MODE);
    assert.equal(saved.lastRun.verification.nativeAcl.ok, true);
    assert.equal(releases, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('successful common no-op marks baseline STAFF managed without reclassifying personal groups', () => {
  const f = fixture(), personal = f.codes.slice(0, 42);
  f.member.group = [...personal, STAFF_GROUP];
  const entry = f.state.members.m001;
  entry.baselineGroups = copy(f.member.group);
  entry.ownedAddedGroups = [];
  entry.originalExpiresAt = '2026-11-29T01:00:00Z';
  const before = copy({ member: f.member, baseline: entry.baselineGroups, owned: entry.ownedAddedGroups });
  f.reconcile();
  assert.equal(entry.commonStaffGroupManaged, true);
  assert.deepEqual(entry.baselineGroups, before.baseline);
  assert.deepEqual(entry.ownedAddedGroups, before.owned);
  assert.equal(entry.originalExpiresAt, '2026-11-29T01:00:00Z');
  assert.deepEqual(f.member, before.member);
  assert.deepEqual(f.updates(), []);
  assert.equal(f.verify().ok, true);

  f.member.grade = 'ordinary';
  f.reconcile();
  assert.deepEqual(f.member.group, sorted(personal));
  assert.deepEqual(entry.baselineGroups, before.baseline);
  assert.deepEqual(entry.ownedAddedGroups, before.owned);
  assert.equal(entry.originalExpiresAt, '2026-11-29T01:00:00Z');
  const result = f.verify();
  assert.equal(result.ok, true);
  assert.equal(result.independentlyVerifiedGroupLists, 1);
});

test('common dry-run and legacy sync do not acquire the managed STAFF flag', () => {
  const preview = fixture(), before = copy(preview.state);
  preview.reconcile({ apply: false });
  assert.deepEqual(preview.state, before);
  const legacy = fixture(30);
  legacy.reconcile({ commonAccess: null });
  assert.equal(legacy.state.members.m001.commonStaffGroupManaged, undefined);
});

test('managed baseline STAFF exit still scans purchase protection and blocks a protected role', () => {
  const f = fixture();
  f.member.grade = 'ordinary';
  f.member.group = ['baseline', STAFF_GROUP];
  const entry = f.state.members.m001;
  entry.baselineGroups = copy(f.member.group);
  entry.ownedAddedGroups = [];
  entry.commonStaffGroupManaged = true;
  f.orders = [{ orderNo: 1, siteCode: SITE, unitCode: UNIT, memberCode: 'm001', orderStatus: 'CLOSED',
    sections: [{ orderSectionStatus: 'PURCHASE_COMPLETE', sectionItems: [
      { productInfo: { groupPassCode: STAFF_GROUP, groupPassDayCnt: 40 } },
    ] }], payments: [{ paymentStatus: 'PAYMENT_COMPLETE', paymentCompleteTime: new Date(NOW - 86400000).toISOString() }] }];
  const before = copy({ member: f.member, state: f.state });
  assert.throws(() => f.reconcile(), /Protected STAFF group requires manual review/);
  assert.ok(f.calls.some(args => args[0] === 'order'));
  assert.deepEqual(f.updates(), []);
  assert.deepEqual(f.saved, []);
  assert.deepEqual({ member: f.member, state: f.state }, before);
});

test('common baseline exception cannot hide a missing personal group or an unmanaged STAFF removal', () => {
  const f = fixture();
  f.member.grade = 'ordinary';
  f.member.group = ['baseline'];
  const entry = f.state.members.m001;
  entry.baselineGroups = ['baseline', STAFF_GROUP];
  entry.ownedAddedGroups = [];
  assert.throws(() => f.verify(), /baseline permission missing/);
  entry.commonStaffGroupManaged = true;
  assert.equal(f.verify().ok, true);
  entry.baselineGroups.push('personal-video');
  assert.throws(() => f.verify(), /baseline permission missing/);
});

test('ordinary baseline STAFF remains untouched without a managed flag but requires manual review', () => {
  const f = fixture(30);
  f.member.grade = 'ordinary';
  f.member.group = ['baseline', STAFF_GROUP];
  f.state.members.m001.baselineGroups = copy(f.member.group);
  f.state.members.m001.ownedAddedGroups = [];
  f.reconcile();
  assert.deepEqual(f.updates(), []);
  const before = copy({ member: f.member, state: f.state });
  assert.throws(() => f.verify(), /manual review required/);
  assert.deepEqual({ member: f.member, state: f.state }, before);
  assert.equal(f.verify({ commonAccess: null }).ok, true);
});

for (const kind of ['unknown member', 'ordinary member', 'untracked staff']) {
  test(`common group audit rejects ${kind} even during targeted verification`, () => {
    const f = fixture(); f.reconcile();
    const outsider = { ...copy(f.member), memberCode: 'm002', uid: 'synthetic-other',
      grade: kind === 'ordinary member' ? 'ordinary' : STAFF_GRADE };
    if (kind !== 'unknown member') f.otherMembers.push(outsider);
    f.independentMembers = [copy(f.member), outsider];
    const before = copy(f.state), updates = f.updates().length;
    assert.throws(() => f.verify({ onlyMemberCode: 'm001' }), /manual review required/);
    assert.equal(f.updates().length, updates);
    assert.deepEqual(f.state, before);
  });
}

test('common group audit rejects outsider memberships even with no active staff targets', () => {
  const f = fixture();
  f.member.grade = 'ordinary';
  f.member.group = ['baseline'];
  f.independentMembers = [{ ...copy(f.member), memberCode: 'm002', uid: 'synthetic-unknown' }];
  assert.throws(() => f.verify(), /manual review required/);
});
