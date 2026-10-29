import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMON_STAFF_ACCESS_MODE, STAFF_GRADE, STAFF_GROUP, SITE, UNIT,
  videoGroups, planStaffGroups,
} from '../lib/imweb-staff-video-policy.mjs';

const common = { commonAccess: true };
const sorted = values => [...values].sort();
const group = (code, title) => ({ siteCode: SITE, siteGroupCode: code, title });
const catalog = count => Array.from({ length: count }, (_, i) => group(`video-${i}`, `ARCHIVE METHOD A${i} 40D`));
const member = (extra = {}) => ({
  siteCode: SITE, unitCode: UNIT, memberCode: 'synthetic-member', grade: STAFF_GRADE,
  group: ['baseline'], metadata: { consent: false, note: 'preserve' }, ...extra,
});

test('common staff mode has an explicit stable identifier', () => {
  assert.equal(COMMON_STAFF_ACCESS_MODE, 'common_staff_group_v1');
});

test('common catalog accepts more than 48 groups up to 1000 without changing legacy limits', () => {
  const rows = catalog(1001), before = structuredClone(rows);
  assert.equal(videoGroups(rows.slice(0, 48)).length, 48);
  assert.throws(() => videoGroups(rows.slice(0, 49)), /48/);
  assert.throws(() => videoGroups(rows.slice(0, 49), { commonAccess: false }), /48/);
  assert.equal(videoGroups(rows.slice(0, 49), common).length, 49);
  assert.equal(videoGroups(rows.slice(0, 1000), common).length, 1000);
  assert.throws(() => videoGroups(rows, common), /1000/);
  assert.deepEqual(rows, before);
});

test('common catalog preserves exact title selection, staff exclusion and sorted output', () => {
  const rows = [group('z', 'ARCHIVE METHOD A-10 40D'), group('a', 'PRIVATE LESSON AB 10 40D'),
    group(STAFF_GROUP, 'ARCHIVE METHOD STAFF 40D'), group('other', 'ARCHIVE TEST'),
    group('suffix', 'ARCHIVE METHOD A 40D extra'), group('lower', 'ARCHIVE METHOD a 40D'),
    group('days', 'ARCHIVE METHOD A 30D')];
  assert.deepEqual(videoGroups(rows, common), ['a', 'z']);
  assert.deepEqual(videoGroups([], common), []);
});

test('common catalog still rejects malformed, wrong-scope and duplicate source rows', () => {
  for (const rows of [null, {}, [null],
    [{ ...group('a', 'ARCHIVE TEST'), siteCode: 'other' }],
    [group('', 'ARCHIVE TEST')], [group('a', ' ARCHIVE TEST')],
    [{ ...group('a', 'ARCHIVE TEST'), siteGroupCode: 1 }], [group('a', null)],
    [group('a', 'ARCHIVE TEST'), group('a', 'OTHER TEST')],
    [group('a', 'ARCHIVE TEST'), group('b', 'ARCHIVE TEST')]]) {
    assert.throws(() => videoGroups(rows, common));
  }
});

test('common staff adds only STAFF and preserves legacy memberships, ownership and inputs', () => {
  const source = member({ group: ['baseline', 'baseline-video', 'legacy-owned', 'purchased', 'student'] });
  const ledger = { baselineGroups: ['baseline', 'baseline-video'], ownedAddedGroups: ['legacy-owned'],
    firstObservedAt: '2026-10-20T00:00:00Z' };
  const videos = ['baseline-video', 'legacy-owned', 'new-video'];
  const protectedGroups = ['purchased', 'student'];
  const before = structuredClone([source, ledger, videos, protectedGroups]);
  const plan = planStaffGroups(source, ledger, videos, protectedGroups, common);
  assert.equal(plan.action, 'update');
  assert.deepEqual(plan.afterGroups, sorted([...source.group, STAFF_GROUP]));
  assert.deepEqual(plan.addedGroups, [STAFF_GROUP]);
  assert.deepEqual(plan.removedGroups, []);
  assert.deepEqual(plan.nextManagedGroups, sorted(['legacy-owned', STAFF_GROUP]));
  assert.deepEqual([source, ledger, videos, protectedGroups], before);
});

test('future catalog growth never grows common staff membership or regrants absent legacy videos', () => {
  const source = member({ group: ['baseline', 'legacy-owned'] });
  const ledger = { baselineGroups: ['baseline', 'absent-baseline-video'], ownedAddedGroups: ['legacy-owned'] };
  const first = planStaffGroups(source, ledger, ['legacy-owned', 'absent-baseline-video'], [], common);
  const nextMember = { ...source, group: first.afterGroups };
  const nextLedger = { ...ledger, ownedAddedGroups: first.nextManagedGroups };
  const replay = planStaffGroups(nextMember, nextLedger, videoGroups(catalog(1000), common), [], common);
  assert.equal(replay.action, 'none');
  assert.deepEqual(replay.afterGroups, first.afterGroups);
  assert.deepEqual(replay.addedGroups, []);
  assert.deepEqual(replay.removedGroups, []);
  assert.deepEqual(replay.nextManagedGroups, first.nextManagedGroups);
});

test('common no-op retains present ownership but releases absent and protected tracking', () => {
  const source = member({ group: ['baseline', STAFF_GROUP, 'legacy-owned', 'buyer', 'student'] });
  const ledger = { baselineGroups: ['baseline'],
    ownedAddedGroups: [STAFF_GROUP, 'legacy-owned', 'buyer', 'student', 'absent-owned'] };
  const plan = planStaffGroups(source, ledger, ['future-video'], ['buyer', 'student'], common);
  assert.equal(plan.action, 'none');
  assert.deepEqual(plan.afterGroups, sorted(source.group));
  assert.deepEqual(plan.nextManagedGroups, sorted([STAFF_GROUP, 'legacy-owned']));
});

test('unmanaged baseline STAFF and videos are never acquired or removed on common exit', () => {
  const source = member({ group: ['baseline', STAFF_GROUP, 'baseline-video', 'legacy-owned'] });
  const ledger = { baselineGroups: ['baseline', STAFF_GROUP, 'baseline-video'], ownedAddedGroups: ['legacy-owned'] };
  const active = planStaffGroups(source, ledger, ['new-video'], [], common);
  assert.equal(active.action, 'none');
  assert.deepEqual(active.nextManagedGroups, ['legacy-owned']);
  const exit = planStaffGroups({ ...source, grade: 'ordinary', group: active.afterGroups },
    { ...ledger, ownedAddedGroups: active.nextManagedGroups }, ['new-video'], [], common);
  assert.deepEqual(exit.afterGroups, sorted(ledger.baselineGroups));
  assert.deepEqual(exit.removedGroups, ['legacy-owned']);
  assert.deepEqual(exit.nextManagedGroups, []);
});

test('common exit removes only unprotected owned groups and preserves provided buyer/student rights', () => {
  const source = member({ grade: 'ordinary',
    group: ['baseline', 'baseline-video', STAFF_GROUP, 'legacy-owned', 'buyer', 'student', 'manual'] });
  const ledger = { baselineGroups: ['baseline', 'baseline-video'],
    ownedAddedGroups: [STAFF_GROUP, 'legacy-owned', 'buyer', 'student', 'absent-owned'] };
  const protectedGroups = ['buyer', 'student'];
  const before = structuredClone([source, ledger, protectedGroups]);
  const plan = planStaffGroups(source, ledger, ['future-video'], protectedGroups, common);
  assert.equal(plan.action, 'update');
  assert.deepEqual(plan.afterGroups, sorted(['baseline', 'baseline-video', 'buyer', 'student', 'manual']));
  assert.deepEqual(plan.addedGroups, []);
  assert.deepEqual(plan.removedGroups, sorted([STAFF_GROUP, 'legacy-owned']));
  assert.deepEqual(plan.nextManagedGroups, []);
  assert.deepEqual(plan, planStaffGroups(source, ledger, ['future-video'], protectedGroups));
  assert.deepEqual([source, ledger, protectedGroups], before);
});

test('STAFF membership and malformed or unrelated grades never activate common access', () => {
  for (const grade of ['ordinary', STAFF_GROUP, undefined, null, [STAFF_GRADE], { code: STAFF_GRADE }]) {
    for (const groups of [['baseline'], ['baseline', STAFF_GROUP]]) {
      const plan = planStaffGroups(member({ grade, group: groups }), null, ['video-a'], [], common);
      assert.equal(plan.action, 'none');
      assert.deepEqual(plan.afterGroups, sorted(groups));
      assert.deepEqual(plan.nextManagedGroups, []);
    }
  }
});

test('common planning retains scope, group-array and baseline ownership validation', () => {
  for (const source of [member({ siteCode: 'other' }), member({ unitCode: 'other' }),
    member({ group: undefined }), member({ group: ['a', 'a'] }), member({ group: [' a'] })]) {
    assert.throws(() => planStaffGroups(source, null, [], [], common));
  }
  for (const ledger of [{}, { ownedAddedGroups: ['a', 'a'] },
    { baselineGroups: ['baseline'], ownedAddedGroups: ['baseline'] }]) {
    assert.throws(() => planStaffGroups(member(), ledger, [], [], common));
  }
  assert.throws(() => planStaffGroups(member(), null, ['a', 'a'], [], common));
  assert.throws(() => planStaffGroups(member(), null, [], [null], common));
});

test('catalog source bound is not a planner member-count cap', () => {
  const source = member({ group: Array.from({ length: 50 }, (_, i) => `existing-${i}`) });
  const plan = planStaffGroups(source, null, videoGroups(catalog(1000), common), [], common);
  assert.equal(plan.afterGroups.length, 51);
  assert.deepEqual(plan.addedGroups, [STAFF_GROUP]);
  assert.deepEqual(plan.removedGroups, []);
});

test('managed common exit removes baseline STAFF only and preserves 42 personal baseline groups', () => {
  const personal = Array.from({ length: 42 }, (_, i) => `personal-${i}`);
  const source = member({ grade: 'ordinary',
    group: [...personal, STAFF_GROUP, 'legacy-owned', 'buyer', 'student'] });
  const ledger = { baselineGroups: [...personal, STAFF_GROUP],
    ownedAddedGroups: ['legacy-owned', 'buyer', 'student'], commonStaffGroupManaged: true,
    firstObservedAt: '2026-10-20T00:00:00Z' };
  const protectedGroups = ['buyer', 'student'], before = structuredClone([source, ledger, protectedGroups]);
  const plan = planStaffGroups(source, ledger, ['future-video'], protectedGroups, common);
  assert.deepEqual(plan.removedGroups, sorted([STAFF_GROUP, 'legacy-owned']));
  assert.deepEqual(plan.afterGroups, sorted([...personal, 'buyer', 'student']));
  assert.deepEqual(plan.nextManagedGroups, []);
  assert.deepEqual([source, ledger, protectedGroups], before);
});

test('STAFF baseline exception requires common mode and the exact managed flag', () => {
  const source = member({ grade: 'ordinary', group: ['baseline', STAFF_GROUP] });
  const ledger = { baselineGroups: [...source.group], ownedAddedGroups: [] };
  for (const value of [undefined, false, 'true', 1]) {
    const plan = planStaffGroups(source, { ...ledger, commonStaffGroupManaged: value }, [], [], common);
    assert.deepEqual(plan.afterGroups, sorted(source.group));
  }
  const legacy = planStaffGroups(source, { ...ledger, commonStaffGroupManaged: true }, []);
  assert.deepEqual(legacy.afterGroups, sorted(source.group));
  assert.throws(() => planStaffGroups(source,
    { ...ledger, ownedAddedGroups: [STAFF_GROUP], commonStaffGroupManaged: true }, [], [], common), /Baseline/);
});

test('protected STAFF conflicts block managed exit without changing ownership or baseline', () => {
  const source = member({ grade: 'ordinary', group: ['baseline', STAFF_GROUP, 'buyer', 'student'] });
  const ledger = { baselineGroups: ['baseline', STAFF_GROUP], ownedAddedGroups: ['buyer', 'student'],
    commonStaffGroupManaged: true };
  const before = structuredClone([source, ledger]);
  assert.throws(() => planStaffGroups(source, ledger, [], [STAFF_GROUP, 'buyer', 'student'], common), /manual review/);
  assert.deepEqual([source, ledger], before);
  assert.equal(planStaffGroups({ ...source, grade: STAFF_GRADE }, ledger, [], [STAFF_GROUP], common).action, 'none');
});
