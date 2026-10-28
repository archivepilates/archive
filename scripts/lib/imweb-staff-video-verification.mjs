import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { staffMembers, staffPages, STAFF_VIDEO_POLICY } from './imweb-staff-video-sync.mjs';
import { STAFF_GRADE, STAFF_GROUP, SITE, UNIT, videoGroups } from './imweb-staff-video-policy.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function groupSet(value) {
  assert.ok(Array.isArray(value) && value.every(code => typeof code === 'string' && code.length > 0
    && code.trim() === code), 'Invalid verification group set');
  assert.equal(new Set(value).size, value.length, 'Duplicate verification group');
  return [...value].sort();
}

// The caller owns MEMBER_GROUP_LOCK. This function performs native reads only.
export function verifyStaffVideoAccess({ run, state, onlyMemberCode = '', expectedGroupCodes = [] }) {
  assert.equal(typeof run, 'function', 'Native reader required');
  assert.ok(typeof onlyMemberCode === 'string' && (!onlyMemberCode || /^m[0-9a-f]+$/.test(onlyMemberCode)), 'Invalid verification member');
  const expected = groupSet(expectedGroupCodes);
  assert.ok(state?.policyVersion === STAFF_VIDEO_POLICY && state.approved === true
    && state.members && typeof state.members === 'object' && !Array.isArray(state.members), 'Approved ownership ledger required');
  const context = run(['config', 'context']);
  assert.ok(context?.effective_profile === 'default' && context.resolved_profile?.site_code === SITE
    && context.resolved_profile?.unit_code === UNIT, 'Verification site/unit/profile mismatch');
  const groups = staffPages(run, ['member', 'groups', 'list']);
  const catalog = videoGroups(groups);
  assert.ok(catalog.length >= 30, 'Incomplete verification video catalog');
  assert.equal(groups.filter(row => row.siteGroupCode === STAFF_GROUP && row.title === 'ARCHIVE STAFF').length, 1, 'Verification staff group mismatch');
  assert.ok(expected.every(code => catalog.includes(code)), 'Expected video groups missing from native catalog');
  const desired = [...catalog, STAFF_GROUP].sort();
  const members = staffMembers(run), index = new Map(members.map(member => [member.memberCode, member]));
  const staff = members.filter(member => member.grade === STAFF_GRADE);
  const targets = onlyMemberCode ? [onlyMemberCode]
    : [...new Set([...staff.map(member => member.memberCode), ...Object.keys(state.members)])].sort();
  assert.ok(targets.length > 0, 'No verification targets');
  const active = [], memberDetails = [];
  for (const code of targets) {
    const source = index.get(code), entry = state.members[code];
    assert.ok(source && entry && entry.memberCode === code && entry.uid === source.uid, 'Verification ledger/member mismatch');
    assert.ok(!entry.pending, 'Pending group update cannot be verified');
    const detail = run(['member', 'get', source.uid, '--unit-code', UNIT]).data;
    assert.ok(detail?.memberCode === code && detail.uid === source.uid && detail.siteCode === SITE
      && detail.unitCode === UNIT, 'Verification native identity mismatch');
    assert.ok(detail.grade == null || typeof detail.grade === 'string', 'Ambiguous verification member grade');
    assert.equal(detail.grade, source.grade, 'Native grade changed during verification');
    const current = groupSet(detail.group), baseline = groupSet(entry.baselineGroups);
    assert.ok(baseline.every(group => current.includes(group)), 'Verification baseline permission missing');
    const isStaff = detail.grade === STAFF_GRADE;
    if (isStaff) {
      assert.ok(desired.every(group => current.includes(group)), 'Verification staff permission missing');
      active.push(code);
    }
    memberDetails.push({ memberKeyHash: hash([SITE, UNIT, code]), memberGroupsHash: hash(current),
      staff: isStaff, baselinePreserved: true, requiredGroupsVerified: isStaff ? desired.length : 0 });
  }
  if (active.length) for (const code of desired) {
    const rows = staffPages(run, ['member', 'groups', 'members', code, '--unit-code', UNIT]);
    for (const memberCode of active) {
      const matches = rows.filter(row => row.memberCode === memberCode);
      assert.equal(matches.length, 1, 'Independent group membership missing or duplicated');
      const row = matches[0];
      assert.ok((row.siteCode === undefined || row.siteCode === SITE)
        && (row.unitCode === undefined || row.unitCode === UNIT)
        && (row.uid === undefined || row.uid === index.get(memberCode).uid), 'Independent group identity mismatch');
    }
  }
  const titles = new Map(groups.map(row => [row.siteGroupCode, row.title]));
  return { ok: true, verifiedAt: new Date().toISOString(), scope: onlyMemberCode ? 'member' : 'all_tracked',
    catalogFingerprint: hash(catalog.map(code => [code, titles.get(code)])), catalogGroups: catalog.length,
    scannedMembers: members.length, staffMembers: staff.length, verifiedMembers: targets.length,
    memberDetails, independentlyVerifiedGroupLists: active.length ? desired.length : 0,
    ordinaryMemberPlayback: 'not_verified' };
}
