import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateConfirmedLessonIdentities, resolveConfirmedLessonMember } from '../lib/lesson-share-261025-confirmed-identities.mjs';
import { SITE, UNIT } from '../lib/imweb-staff-video-policy.mjs';
import { C261025_SHARE, D261025_SHARE } from '../lib/imweb-student-share-policy.mjs';
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const approval = 'call_dc4c07262f9f49688c452582a637c7ed:existing-check-after-quota-recovery';
function fixture() {
  const targets = [1, 2].map(i => ({ team: 'D', name: `Synthetic ${i}`, phone: `0100000000${i}`, attendance: '출석' }));
  const members = targets.map((t, i) => ({ name: t.name, uid: `synthetic-${i}`, memberCode: `m000${i}`,
    siteCode: SITE, unitCode: UNIT, callnum: i ? t.phone : '01099999999', group: [], grade: 'ordinary' }));
  members.push({ ...members[1], memberCode: 'm0009', uid: 'synthetic-duplicate' });
  const selected = targets.map((t, i) => ({ team: 'D', name: t.name, uid: members[i].uid, memberCode: members[i].memberCode,
    attendeeIdentitySha256: digest([t.name, t.phone]) }));
  const confirmed = { source: 'direct human reply in C/D sharing task', status: 'approved_waiting_existing_cli_quota_recovery',
    route: 'existing_cli_only_no_admin_ui', routeApproval: approval, confirmedAt: '2026-10-25T16:00:00Z', routeApprovedAt: '2026-10-25T16:50:00Z',
    lessonDate: '2026-10-25', lessonIds: [...D261025_SHARE.lessonIds], selected };
  const expectedHash = digest(selected.map(x => [x.team, x.name, x.memberCode, x.uid, x.attendeeIdentitySha256])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const resolve = (target = targets[0], current = members, source = D261025_SHARE) => resolveConfirmedLessonMember({ target, source, members: current, confirmed, expectedHash });
  return { targets, members, confirmed, expectedHash, resolve };
}
test('exact two identities are pinned to explicit CLI-only deferral, not count alone', () => {
  const f = fixture();
  assert.equal(validateConfirmedLessonIdentities(f.confirmed, Date.now(), f.expectedHash), f.confirmed);
  for (const mutate of [
    x => { x.status = 'identity_confirmed_grant_pending_route_approval'; }, x => { x.route = 'native_ui'; },
    x => { x.routeApproval = 'unapproved'; }, x => { x.lessonDate = '2026-10-24'; },
    x => { x.lessonIds[0] = '97134107'; }, x => x.selected.pop(),
    x => { x.selected[0].memberCode = 'm9999'; }, x => { x.selected[0].uid = 'other'; },
    x => { x.selected[0].name = 'Other'; }, x => { x.selected[0].team = 'C'; },
    x => { x.selected[0].attendeeIdentitySha256 = 'a'.repeat(64); },
    x => { x.confirmedAt = '2999-01-01T00:00:00Z'; }, x => { x.routeApprovedAt = '2026-10-25'; },
    x => { x.selected[0].uid = x.selected[1].uid; },
  ]) { const value = structuredClone(f.confirmed); mutate(value); assert.throws(() => validateConfirmedLessonIdentities(value, Date.now(), f.expectedHash)); }
});
test('human confirmation handles only exact mismatched and duplicate accounts without mutating inputs', () => {
  const f = fixture(), before = structuredClone(f.members);
  for (let i = 0; i < 2; i++) {
    const result = f.resolve(f.targets[i]);
    assert.equal(result.status, 'matched'); assert.equal(result.member.uid, f.members[i].uid);
    assert.equal(result.identityConfirmation.route, 'existing_cli_only_no_admin_ui');
    assert.equal(result.identityConfirmation.scope, D261025_SHARE.policyId);
  }
  assert.deepEqual(f.members, before);
});
test('ordinary strict matching stays unchanged outside this exact D lesson', () => {
  const f = fixture();
  assert.equal(f.resolve({ ...f.targets[0], team: 'C' }, f.members, C261025_SHARE).status, 'hold');
  assert.equal(resolveConfirmedLessonMember({ target: f.targets[0], source: D261025_SHARE, members: f.members, confirmed: null }).status, 'hold');
  assert.throws(() => f.resolve(f.targets[0], f.members, C261025_SHARE));
  const outsider = { team: 'D', name: 'Other', phone: '01012345678', attendance: '출석' };
  assert.equal(f.resolve(outsider).status, 'no_member');
});
test('attendance changes, absence, deleted/renamed account and inconsistent source stay held', () => {
  for (const mutate of [
    f => { f.targets[0].attendance = '결석'; }, f => { f.targets[0].phone = '01033333333'; },
    f => { f.members[0].name = 'Renamed'; }, f => { f.members[0].uid = 'new-uid'; },
    f => { f.members[0].memberCode = 'm9999'; }, f => { f.members[0].siteCode = 'other'; },
    f => { f.members.push({ ...f.members[0] }); },
    f => { f.members.push({ ...f.members[0], uid: 'new', memberCode: 'm9999', callnum: f.targets[0].phone }); },
  ]) { const f = fixture(); mutate(f); assert.notEqual(f.resolve().status, 'matched'); }
});
test('fresh detail read can use the same explicit selected account despite contact mismatch', () => {
  const f = fixture();
  assert.equal(f.resolve(f.targets[0], [f.members[0]]).status, 'matched');
  assert.equal(f.resolve(f.targets[1], [f.members[1]]).status, 'matched');
  assert.equal(f.resolve({ ...f.targets[0], phone: '+82 10 0000 0001' }).status, 'matched');
});
