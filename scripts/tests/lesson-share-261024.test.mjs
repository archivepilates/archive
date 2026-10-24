import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonShareActionKey, matchLessonShareMember, reuseLessonShareWindow } from '../lib/lesson-share-261024.mjs';
import { SITE, UNIT } from '../lib/imweb-staff-video-policy.mjs';

const attendee = (changes = {}) => ({ name: 'Synthetic Attendee', phone: '010-0000-0001', attendance: '출석', ...changes });
const member = (changes = {}) => ({ siteCode: SITE, unitCode: UNIT, uid: 'synthetic-uid-1',
  memberCode: 'm0001', name: 'Synthetic Attendee', callnum: '01000000001',
  group: ['paid', 'other-share'], grade: 'ordinary', point: 123, ...changes });
const match = (members, extra = {}) => matchLessonShareMember({ attendee: attendee(), members, complete: true, ...extra });
const actionKey = (extra = {}) => lessonShareActionKey({ team: 'A', attendee: attendee(), action: 'sms', ...extra });
const GROUP = 'synthetic-share-a';
const START = '2026-10-25T00:00:00.000Z';
const NOW = Date.parse(START);
const END = '2026-12-04T00:00:00.000Z';
const grant = (changes = {}) => ({ status: 'group_verified', beforeGroups: ['paid', 'other-share'],
  afterGroups: ['paid', 'other-share', GROUP], existingGroupsPreserved: true, verifiedAt: START, ...changes });
const window = (extra = {}) => reuseLessonShareWindow({ firstGrant: grant(), groupCode: GROUP, now: NOW, ...extra });

test('unique exact native match returns identifiers only and preserves every input', () => {
  const input = { attendee: attendee(), members: [member()], complete: true };
  const before = structuredClone(input);
  Object.freeze(input.attendee);
  Object.freeze(input.members[0].group);
  Object.freeze(input.members[0]);
  Object.freeze(input.members);
  Object.freeze(input);
  assert.deepEqual(matchLessonShareMember(input), { status: 'matched', member: { uid: 'synthetic-uid-1', memberCode: 'm0001' } });
  assert.deepEqual(input, before);
});

test('existing phone normalizer handles domestic punctuation and +82, with exact trimmed names', () => {
  for (const value of ['01000000001', '010-0000-0001', '+82 10-0000-0001', '821000000001']) {
    assert.equal(match([member({ callnum: value })]).status, 'matched');
    assert.equal(match([member()], { attendee: attendee({ phone: value, name: ' Synthetic Attendee ' }) }).status, 'matched');
  }
  for (const changedName of ['SyntheticAttendee', 'synthetic attendee', 'Synthetic  Attendee']) {
    assert.deepEqual(match([member({ name: changedName })]), { status: 'hold', reason: 'identity_mismatch' });
  }
});

test('matching never uses phone-only, name-only, suffix, fuzzy or guessed alias fields', () => {
  assert.equal(match([member({ name: 'Different Name' })]).status, 'hold');
  assert.equal(match([member({ callnum: '01000000002' })]).status, 'hold');
  for (const changed of [{ callnum: undefined, phone: '01000000001' }, { callnum: '0001' },
    { callnum: { phone: '01000000001' } }, { callnum: '010abc00000001' }]) {
    assert.deepEqual(match([member(changed)]), { status: 'hold', reason: 'identity_mismatch' });
  }
  assert.deepEqual(match([member({ name: undefined })]), { status: 'hold', reason: 'invalid_member_source' });
});

test('unrelated absent or unparseable phones do not block a valid exact match', () => {
  for (const callnum of [undefined, null, '', 'not a phone', '0001', 1000000001, { phone: '01000000001' }]) {
    const unrelated = member({ uid: 'synthetic-uid-2', memberCode: 'm0002', name: 'Unrelated', callnum });
    const before = structuredClone(unrelated);
    for (const members of [[unrelated, member()], [member(), unrelated]]) {
      assert.deepEqual(match(members), { status: 'matched', member: { uid: 'synthetic-uid-1', memberCode: 'm0001' } });
    }
    assert.deepEqual(match([unrelated]), { status: 'no_member', reason: 'no_current_identity_match' });
    assert.deepEqual(unrelated, before);
  }
});

test('same-name accounts with absent or unparseable phones hold instead of no_member', () => {
  for (const callnum of [undefined, null, '', 'not a phone', '0001', { phone: '01000000001' }]) {
    assert.deepEqual(match([member({ callnum })]), { status: 'hold', reason: 'identity_mismatch' });
  }
});

test('target phone conflicts still hold alongside unrelated missing-phone accounts', () => {
  const unrelated = member({ uid: 'synthetic-uid-3', memberCode: 'm0003', name: 'Unrelated', callnum: '' });
  const conflict = member({ uid: 'synthetic-uid-2', memberCode: 'm0002', name: 'Different Name' });
  for (const members of [[unrelated, member(), conflict], [conflict, member(), unrelated]]) {
    assert.deepEqual(match(members), { status: 'hold', reason: 'ambiguous_phone' });
  }
});

test('NFC-equivalent names match and produce the same SMS and no-member action keys', () => {
  const composed = 'Synthetic \uAC00';
  const decomposed = 'Synthetic \u1100\u1161';
  for (const [memberName, attendeeName] of [[composed, decomposed], [decomposed, composed]]) {
    assert.equal(match([member({ name: memberName })], { attendee: attendee({ name: attendeeName }) }).status, 'matched');
  }
  for (const action of ['sms', 'no_member']) {
    assert.equal(actionKey({ action, attendee: attendee({ name: composed }) }),
      actionKey({ action, attendee: attendee({ name: ` ${decomposed} ` }) }));
  }
  assert.deepEqual(match([member({ name: decomposed, callnum: '' })], { attendee: attendee({ name: composed }) }),
    { status: 'hold', reason: 'identity_mismatch' });
});

test('only a complete valid snapshot can yield no_member, and signup rechecks change the result', () => {
  assert.deepEqual(match([]), { status: 'no_member', reason: 'no_current_identity_match' });
  assert.equal(match([member({ name: 'Unrelated', callnum: '01000000002' })]).status, 'no_member');
  assert.equal(match([member()]).status, 'matched');
  for (const complete of [undefined, false, 1, 'true']) {
    assert.deepEqual(match([], { complete }), { status: 'hold', reason: 'incomplete_member_source' });
  }
  for (const members of [null, {}, { members: [], complete: true }]) assert.equal(match(members).status, 'hold');
});

test('non-attendance and malformed attendee identities never become SMS no-member candidates', () => {
  for (const changed of [{ attendance: '예약' }, { attendance: '취소' }, { attendance: ' 출석' },
    { name: '' }, { name: 123 }, { phone: '' }, { phone: 1000000001 }, { phone: '0001' },
    { phone: '010letters00000001' }]) {
    assert.deepEqual(match([], { attendee: attendee(changed) }), { status: 'hold', reason: 'invalid_attendee_or_not_attended' });
    assert.throws(() => actionKey({ attendee: attendee(changed) }), /invalid_lesson_share_action/);
  }
  assert.equal(matchLessonShareMember().status, 'hold');
});

test('duplicate exact accounts, shared phones and repeated native identities explicitly hold', () => {
  const other = member({ uid: 'synthetic-uid-2', memberCode: 'm0002' });
  assert.deepEqual(match([member(), other]), { status: 'hold', reason: 'ambiguous_exact_match' });
  assert.deepEqual(match([member(), { ...other, name: 'Different Name' }]), { status: 'hold', reason: 'ambiguous_phone' });
  assert.deepEqual(match([member(), member()]), { status: 'hold', reason: 'duplicate_member_identity' });
  for (const changed of [{ memberCode: 'm0002' }, { uid: 'synthetic-uid-2' }]) {
    assert.equal(match([member(), member(changed)]).reason, 'duplicate_member_identity');
  }
  assert.equal(match([member(), { ...other, callnum: '01000000002' }]).status, 'matched');
});

test('bad source scope/identity or referral projections fail closed even after an exact match', () => {
  for (const invalid of [null, {}, member({ siteCode: 'other' }), member({ unitCode: 'other' }),
    member({ uid: '' }), member({ uid: ' synthetic-uid-2 ' }), member({ memberCode: 'excel_1' }),
    { siteCode: SITE, unitCode: UNIT, uid: 'projection', memberCode: 'm0002' }]) {
    for (const members of [[invalid], [member(), invalid]]) assert.equal(match(members).reason, 'invalid_member_source');
  }
});

test('action keys are stable normalized, team/action-scoped hashes without raw identifiers', () => {
  const key = actionKey();
  assert.match(key, /^lesson_share_261024_sms_[a-f0-9]{64}$/);
  assert.equal(actionKey({ attendee: attendee({ phone: '+82 10-0000-0001', name: ' Synthetic Attendee ' }) }), key);
  assert.equal(actionKey(), key);
  assert.ok(!key.includes('Synthetic') && !key.includes('01000000001'));
  for (const extra of [{ team: 'B' }, { action: 'no_member' }, { attendee: attendee({ phone: '01000000002' }) },
    { attendee: attendee({ name: 'Different Name' }) }]) assert.notEqual(actionKey(extra), key);
  assert.match(actionKey({ action: 'no_member' }), /^lesson_share_261024_no_member_[a-f0-9]{64}$/);
  for (const extra of [{ team: 'C' }, { team: 'a' }, { action: 'grant' }, { action: undefined }]) {
    assert.throws(() => actionKey(extra), /invalid_lesson_share_action/);
  }
  assert.throws(() => lessonShareActionKey(), /invalid_lesson_share_action/);
});

test('the first verified instant fixes 960 hours, including at and after expiry', () => {
  const expected = { grantedAt: START, expiresAt: END };
  assert.deepEqual(window(), expected);
  assert.equal(Date.parse(END) - NOW, 960 * 3600000);
  const existing = { ...expected, groupCode: GROUP, status: 'active' };
  const before = structuredClone(existing);
  for (const now of [NOW + 1, Date.parse(END) - 1, Date.parse(END), Date.parse(END) + 86400000]) {
    assert.deepEqual(window({ existing, now }), expected);
  }
  assert.deepEqual(existing, before);
  assert.deepEqual(window({ existing: { grantedAt: '2026-10-25T09:00:00+09:00', expiresAt: '2026-12-04T09:00:00+09:00' } }), expected);
});

test('re-added group/re-enrollment and conflicting prior windows cannot renew access', () => {
  const existing = window();
  const replay = grant({ verifiedAt: '2026-10-26T00:00:00Z' });
  assert.throws(() => window({ firstGrant: replay, now: NOW + 86400000, existing }), /existing_share_window_conflict/);
  for (const changed of [{ grantedAt: '2026-10-26T00:00:00Z' }, { expiresAt: '2026-12-05T00:00:00Z' },
    { grantedAt: '2026-10-26T00:00:00Z', expiresAt: '2026-12-05T00:00:00Z' },
    { groupCode: 'other-group' }, { status: 'revoked' }, { status: 'removed_externally' },
    { status: 'pending' }, { revocation: { status: 'result_unknown' } }]) {
    assert.throws(() => window({ existing: { ...existing, ...changed } }));
  }
  for (const bad of [null, {}, [], { ...existing, grantedAt: '2026-10-25' }]) {
    assert.throws(() => window({ existing: bad }));
  }
});

test('invalid clocks, unverified transitions and lost pre-existing rights reject without mutation', () => {
  const original = grant();
  const before = structuredClone(original);
  assert.deepEqual(window({ firstGrant: original }), { grantedAt: START, expiresAt: END });
  assert.deepEqual(original, before);
  for (const changed of [{ status: 'intent' }, { status: 'result_unknown' }, { beforeGroups: [GROUP] },
    { afterGroups: ['paid', GROUP] }, { existingGroupsPreserved: false },
    { verifiedAt: '2026-10-25' }, { grantedAt: '2026-10-26T00:00:00Z' }]) {
    assert.throws(() => window({ firstGrant: grant(changed) }));
  }
  for (const now of [undefined, NaN, Infinity, '2026-10-25T00:00:00Z', NOW - 1]) assert.throws(() => window({ now }));
  for (const groupCode of [undefined, '', ' synthetic-share-a ']) assert.throws(() => window({ groupCode }));
  assert.throws(() => reuseLessonShareWindow());
});
