import assert from 'node:assert/strict';
import test from 'node:test';
import { recordOperatorConfirmedManualShare } from '../lib/lesson-share-manual-clock.mjs';
import { C261025_SHARE, D261025_SHARE, STUDENT_SHARE_WINDOW_MS, validatedShareEntries } from '../lib/imweb-student-share-policy.mjs';
import { SITE, UNIT, STAFF_GRADE } from '../lib/imweb-staff-video-policy.mjs';
import { LESSON_VIDEO_ELIGIBILITY_POLICY_ID } from '../lib/lesson-share-registration-policy.mjs';

const START = '2026-10-26T02:00:00.000Z';
const CONFIRMED = '2026-10-26T02:01:00.000Z';
const NOW = Date.parse('2026-10-26T02:02:00.000Z');
const CODE = 'm0001';
function fixture() {
  const source = C261025_SHARE;
  const member = { siteCode: SITE, unitCode: UNIT, uid: 'synthetic-c', memberCode: CODE,
    grade: 'ordinary', group: ['paid', source.groupCode, 'other-share'],
    email: 'private@example.invalid', point: 123, coupon: ['keep'] };
  return {
    source, member, now: NOW,
    state: { siteCode: SITE, unitCode: UNIT,
      accessPolicy: { id: source.policyId, approved: true, days: 40, basis: 'first_verified_grant', revocation: source.revocation },
      manualImmediateGrants: {}, entitlements: {}, unrelated: { keep: [1, 2] } },
    groupMembers: { complete: true, groupCode: source.groupCode, totalCount: 1,
      members: [{ siteCode: SITE, unitCode: UNIT, uid: member.uid, memberCode: CODE }] },
    attendanceEvidence: { source: 'studiomate_live_lesson_detail', status: 'both_sessions_registered',
      eligibilityPolicy: LESSON_VIDEO_ELIGIBILITY_POLICY_ID, memberCode: CODE,
      date: source.lessonDate, lessonIds: [...source.lessonIds],
      sessionAttendance: source.lessonIds.map(lessonId => ({ lessonId, status: '결석' })) },
    confirmation: { approved: true, source: 'direct_operator_confirmation', memberCode: CODE,
      groupCode: source.groupCode, grantedAt: START, confirmedAt: CONFIRMED },
  };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function rejectsWithoutMutation(input) {
  const before = structuredClone(input);
  assert.throws(() => recordOperatorConfirmedManualShare(input));
  assert.deepEqual(input, before);
}

test('both absent registrations record the approved forty-day clock without permission changes or input mutation', () => {
  const input = freeze(fixture()), before = structuredClone(input);
  const next = recordOperatorConfirmedManualShare(input);
  const receipt = next.manualImmediateGrants[CODE], entry = next.entitlements[CODE];
  assert.notEqual(next, input.state);
  assert.deepEqual(input, before);
  assert.deepEqual(receipt, {
    kind: 'student_share_operator_confirmed_manual', status: 'group_verified', memberCode: CODE, uid: input.member.uid,
    beforeGroups: input.member.group, afterGroups: input.member.group,
    beforeGrade: 'ordinary', afterGrade: 'ordinary', existingGroupsPreserved: true,
    verifiedAt: START, independentVerifiedAt: new Date(NOW).toISOString(),
    operatorConfirmation: input.confirmation, attendanceEvidence: input.attendanceEvidence,
  });
  assert.deepEqual(entry, { policyId: input.source.policyId, memberCode: CODE, groupCode: input.source.groupCode,
    grantedAt: START, expiresAt: '2026-12-05T02:00:00.000Z', status: 'active', grantEvidence: 'operator_confirmed_manual_grant' });
  assert.equal(Date.parse(entry.expiresAt) - Date.parse(entry.grantedAt), STUDENT_SHARE_WINDOW_MS);
  assert.equal(validatedShareEntries(next, input.source, NOW).get(CODE).adopted, true);
  assert.deepEqual(next.unrelated, input.state.unrelated);
  assert.notEqual(next.unrelated, input.state.unrelated);
  for (const key of ['email', 'point', 'coupon', 'name', 'phone']) assert.equal(Object.hasOwn(receipt, key), false);
});

test('present, absent and mixed registrations use the same approved start, including exact confirmation boundaries', () => {
  for (const statuses of [['출석', '출석'], ['출석', '결석'], ['결석', '출석'], ['결석', '결석']]) {
    for (const confirmedAt of [START, CONFIRMED, new Date(NOW).toISOString()]) {
      const input = fixture();
      input.confirmation.confirmedAt = confirmedAt;
      input.attendanceEvidence.sessionAttendance.forEach((row, i) => { row.status = statuses[i]; });
      assert.equal(recordOperatorConfirmedManualShare(input).entitlements[CODE].grantedAt, START);
    }
  }
});

test('caller-supplied now and explicit offsets do not reinterpret or restart the approved instant', () => {
  const input = fixture();
  input.confirmation.grantedAt = '2026-10-26T11:00:00+09:00';
  input.now += 5 * 86400000;
  const next = recordOperatorConfirmedManualShare(input);
  assert.equal(next.manualImmediateGrants[CODE].verifiedAt, input.confirmation.grantedAt);
  assert.equal(next.entitlements[CODE].grantedAt, START);
  assert.equal(next.entitlements[CODE].expiresAt, '2026-12-05T02:00:00.000Z');
});

test('native null and empty non-STAFF grades are retained without reclassification', () => {
  for (const grade of [null, '']) {
    const input = fixture();
    input.member.grade = grade;
    const receipt = recordOperatorConfirmedManualShare(input).manualImmediateGrants[CODE];
    assert.equal(receipt.beforeGrade, grade);
    assert.equal(receipt.afterGrade, grade);
  }
});

test('receipt retains only needed approval, member and attendance fields and owns its cloned arrays', () => {
  const input = fixture();
  input.member.unneeded = 'omit';
  input.confirmation.unneeded = 'omit';
  input.attendanceEvidence.unneeded = 'omit';
  input.attendanceEvidence.sessionAttendance[0].unneeded = 'omit';
  const before = structuredClone(input);
  const next = recordOperatorConfirmedManualShare(input), receipt = next.manualImmediateGrants[CODE];
  for (const value of [receipt, receipt.operatorConfirmation, receipt.attendanceEvidence,
    receipt.attendanceEvidence.sessionAttendance[0]]) assert.equal(Object.hasOwn(value, 'unneeded'), false);
  receipt.beforeGroups.push('output-only');
  receipt.afterGroups.push('after-only');
  receipt.attendanceEvidence.lessonIds.reverse();
  receipt.attendanceEvidence.sessionAttendance[0].status = '출석';
  next.unrelated.keep.push(3);
  assert.deepEqual(input, before);
});

const invalid = [
  ['wrong member site', x => { x.member.siteCode = 'other'; }],
  ['wrong member unit', x => { x.member.unitCode = 'other'; }],
  ['invalid member code', x => { x.member.memberCode = 'excel_1'; }],
  ['missing uid', x => { delete x.member.uid; }],
  ['untrimmed uid', x => { x.member.uid = ' synthetic-c '; }],
  ['STAFF grade', x => { x.member.grade = STAFF_GRADE; }],
  ['missing grade', x => { delete x.member.grade; }],
  ['undefined grade', x => { x.member.grade = undefined; }],
  ['malformed grade', x => { x.member.grade = {}; }],
  ['missing live group', x => { x.member.group = ['paid']; }],
  ['duplicate live groups', x => { x.member.group.push('paid'); }],
  ['malformed live groups', x => { x.member.group.push({ groupCode: 'other' }); }],
  ['missing independent readback', x => { delete x.groupMembers; }],
  ['incomplete readback', x => { x.groupMembers.complete = false; }],
  ['count mismatch', x => { x.groupMembers.totalCount = 2; }],
  ['missing count', x => { delete x.groupMembers.totalCount; }],
  ['wrong readback group', x => { x.groupMembers.groupCode = D261025_SHARE.groupCode; }],
  ['wrong readback uid', x => { x.groupMembers.members[0].uid = 'other'; }],
  ['wrong readback member', x => { x.groupMembers.members[0].memberCode = 'm0002'; }],
  ['wrong readback site', x => { x.groupMembers.members[0].siteCode = 'other'; }],
  ['wrong readback unit', x => { x.groupMembers.members[0].unitCode = 'other'; }],
  ['empty readback', x => { x.groupMembers.members = []; x.groupMembers.totalCount = 0; }],
  ['missing approval', x => { delete x.confirmation; }],
  ['unapproved', x => { x.confirmation.approved = false; }],
  ['non-boolean approval', x => { x.confirmation.approved = 'true'; }],
  ['wrong approval source', x => { x.confirmation.source = 'inferred'; }],
  ['wrong approved member', x => { x.confirmation.memberCode = 'm0002'; }],
  ['wrong approved group', x => { x.confirmation.groupCode = D261025_SHARE.groupCode; }],
  ['confirmation before start', x => { x.confirmation.confirmedAt = '2026-10-26T01:59:59Z'; }],
  ['future approval', x => { x.confirmation.confirmedAt = '2026-10-26T02:03:00Z'; }],
  ['future start', x => { x.confirmation.grantedAt = '2026-10-27T02:00:00Z'; }],
  ['ambiguous start', x => { x.confirmation.grantedAt = '2026-10-26'; }],
  ['missing approval time', x => { delete x.confirmation.confirmedAt; }],
  ['invalid now', x => { x.now = NaN; }],
  ['string now', x => { x.now = START; }],
  ['missing registered evidence', x => { delete x.attendanceEvidence; }],
  ['legacy evidence', x => { x.attendanceEvidence.status = 'both_sessions_attended'; }],
  ['wrong evidence member', x => { x.attendanceEvidence.memberCode = 'm0002'; }],
  ['wrong evidence source', x => { x.attendanceEvidence.source = 'snapshot'; }],
  ['wrong eligibility policy', x => { x.attendanceEvidence.eligibilityPolicy = 'other'; }],
  ['wrong evidence date', x => { x.attendanceEvidence.date = '2026-10-24'; }],
  ['wrong lesson pair', x => { x.attendanceEvidence.lessonIds = [...D261025_SHARE.lessonIds]; }],
  ['missing session status', x => { delete x.attendanceEvidence.sessionAttendance; }],
  ['missing session', x => { x.attendanceEvidence.sessionAttendance.pop(); }],
  ['sparse session evidence', x => { delete x.attendanceEvidence.sessionAttendance[0]; }],
  ['wrong session order', x => { x.attendanceEvidence.sessionAttendance.reverse(); }],
  ['cancelled registration', x => { x.attendanceEvidence.sessionAttendance[0].status = '취소'; }],
  ['unknown registration', x => { x.attendanceEvidence.sessionAttendance[0].status = '예약'; }],
  ['unapproved state policy', x => { x.state.accessPolicy.approved = false; }],
  ['wrong state policy', x => { x.state.accessPolicy.id = 'other'; }],
  ['wrong state site', x => { x.state.siteCode = 'other'; }],
  ['wrong state unit', x => { x.state.unitCode = 'other'; }],
  ['missing state grants', x => { delete x.state.manualImmediateGrants; }],
  ['missing state entitlements', x => { delete x.state.entitlements; }],
  ['forged source', x => { x.source = { ...x.source, lessonDate: '2026-10-24' }; }],
];
for (const [label, mutate] of invalid) test(`rejects ${label} without mutation`, () => {
  const input = fixture();
  mutate(input);
  rejectsWithoutMutation(input);
});

test('duplicate independent member rows, reused uids and reused codes remain blocked', () => {
  for (const change of [{}, { uid: 'other' }, { memberCode: 'm0002' }]) {
    const input = fixture();
    input.groupMembers.members.push({ ...input.groupMembers.members[0], ...change });
    input.groupMembers.totalCount++;
    rejectsWithoutMutation(input);
  }
});

test('an unrelated valid independent member does not block a unique target', () => {
  const input = fixture();
  input.groupMembers.members.push({ siteCode: SITE, unitCode: UNIT, uid: 'other', memberCode: 'm0002' });
  input.groupMembers.totalCount++;
  assert.equal(recordOperatorConfirmedManualShare(input).entitlements[CODE].grantedAt, START);
});

test('prior manual, legacy, expired or terminal clocks cannot be reset by replay or a new approval', () => {
  for (const status of ['active', 'revoked', 'removed_externally']) {
    const input = fixture();
    input.state = recordOperatorConfirmedManualShare(input);
    input.state.entitlements[CODE].status = status;
    rejectsWithoutMutation(input);
    input.now += 41 * 86400000;
    input.confirmation.grantedAt = new Date(input.now).toISOString();
    input.confirmation.confirmedAt = input.confirmation.grantedAt;
    rejectsWithoutMutation(input);
  }
  for (const kind of [undefined, 'student_share_operator_confirmed_manual']) {
    const input = fixture();
    const next = recordOperatorConfirmedManualShare(input);
    if (kind === undefined) {
      next.manualImmediateGrants[CODE] = { status: 'group_verified', verifiedAt: START,
        beforeGroups: ['paid'], afterGroups: ['paid', input.source.groupCode], existingGroupsPreserved: true };
    }
    next.entitlements = {};
    input.state = next;
    rejectsWithoutMutation(input);
  }
});

test('an entitlement without its original grant and corrupt unrelated state fail closed', () => {
  for (const mutate of [
    state => { delete state.manualImmediateGrants[CODE]; },
    state => { state.manualImmediateGrants.m0002 = { status: 'intent' }; },
    state => { state.entitlements[CODE].expiresAt = START; },
  ]) {
    const input = fixture();
    input.state = recordOperatorConfirmedManualShare(input);
    mutate(input.state);
    rejectsWithoutMutation(input);
  }
});
