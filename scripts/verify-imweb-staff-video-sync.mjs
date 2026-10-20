import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { staffImweb, staffMembers, staffPages, STAFF_VIDEO_DIR } from './lib/imweb-staff-video-sync.mjs';
import { STAFF_GRADE, STAFF_GROUP, SITE, UNIT, videoGroups } from './lib/imweb-staff-video-policy.mjs';

// Independent read-only member detail and every target group's membership list.
const state = JSON.parse(fs.readFileSync(path.join(STAFF_VIDEO_DIR, 'state.json'), 'utf8'));
const context = staffImweb(['config', 'context']);
assert.equal(context.resolved_profile.site_code, SITE); assert.equal(context.resolved_profile.unit_code, UNIT);
const members = staffMembers(staffImweb).filter(member => member.grade === STAFF_GRADE);
assert.ok(members.length > 0);
const catalog = videoGroups(staffPages(staffImweb, ['member', 'groups', 'list']));
const desired = [...catalog, STAFF_GROUP];
const outcomes = [];
for (const member of members) {
  const detail = staffImweb(['member', 'get', member.uid, '--unit-code', UNIT]).data;
  assert.equal(detail.memberCode, member.memberCode); assert.equal(detail.grade, STAFF_GRADE);
  const entry = state.members[member.memberCode]; assert.ok(entry && !entry.pending);
  assert.ok(desired.every(code => detail.group.includes(code)));
  assert.ok(entry.baselineGroups.every(code => detail.group.includes(code)));
  outcomes.push({ memberCode: detail.memberCode, videoGroups: catalog.length, baselinePreserved: true });
}
for (const code of desired) {
  const rows = staffPages(staffImweb, ['member', 'groups', 'members', code, '--unit-code', UNIT]);
  for (const member of members) assert.equal(rows.filter(row => row.memberCode === member.memberCode).length, 1);
}
const result = { ok: true, verifiedAt: new Date().toISOString(), memberDetails: outcomes,
  independentlyVerifiedGroupLists: desired.length, ordinaryMemberPlayback: 'not_verified' };
fs.writeFileSync(path.join(STAFF_VIDEO_DIR, 'verification.json'), JSON.stringify(result, null, 2)+'\n', { mode: 0o600 });
console.log(JSON.stringify(result));
