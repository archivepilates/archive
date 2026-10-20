import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readStudentShareLedgers, validatedShareEntries, protectedStudentShareGroups, STUDENT_SHARE_WINDOW_MS } from './lib/imweb-student-share-policy.mjs';
import { staffImweb, staffMembers, staffPages, MEMBER_GROUP_LOCK, STAFF_VIDEO_DIR } from './lib/imweb-staff-video-sync.mjs';
import { SITE, UNIT } from './lib/imweb-staff-video-policy.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function verifyStudentShares() {
  const release = await acquireStudioMateBrowserLock({ lockPath: MEMBER_GROUP_LOCK,
    owner: 'verify-imweb-student-share-policy', waitMs: 0, staleMs: 600000 });
  try {
    const context = staffImweb(['config', 'context']);
    assert.equal(context.effective_profile, 'default');
    assert.equal(context.resolved_profile?.site_code, SITE);
    assert.equal(context.resolved_profile?.unit_code, UNIT);
    assert.equal(context.token?.status, 'healthy');
    const ledgers = readStudentShareLedgers(); const beforeHash = hash(ledgers);
    const members = staffMembers(staffImweb); const now = Date.now();
    let entriesVerified = 0; let activeAccessVerified = 0;
    const windows = [];
    for (const { source, state } of ledgers) {
      const entries = validatedShareEntries(state, source, now);
      const rows = staffPages(staffImweb, ['member', 'groups', 'members', source.groupCode, '--unit-code', UNIT]);
      for (const [code, entry] of entries) {
        assert.equal(Date.parse(entry.expiresAt) - Date.parse(entry.grantedAt), STUDENT_SHARE_WINDOW_MS);
        windows.push([source.policyId, code, entry.grantedAt, entry.expiresAt]); entriesVerified++;
        if (!protectedStudentShareGroups(ledgers, code, now).includes(source.groupCode)) continue;
        const matches = members.filter(member => member.memberCode === code); assert.equal(matches.length, 1);
        const member = staffImweb(['member', 'get', matches[0].uid, '--unit-code', UNIT]).data;
        assert.equal(member.memberCode, code); assert.equal(member.siteCode, SITE); assert.equal(member.unitCode, UNIT);
        assert.ok(member.group.includes(source.groupCode));
        assert.equal(rows.filter(row => row.memberCode === code).length, 1); activeAccessVerified++;
      }
    }
    assert.equal(hash(readStudentShareLedgers()), beforeHash, 'Student-share ledger changed during verification');
    const result = { ok: true, verifiedAt: new Date().toISOString(), entriesVerified, activeAccessVerified,
      sourceUnchanged: true, sourceDigest: beforeHash, originalWindowDigest: hash(windows.sort()),
      liveStaffExitPerformed: false, ordinaryMemberPlayback: 'not_retested' };
    fs.mkdirSync(STAFF_VIDEO_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(STAFF_VIDEO_DIR, 'student-share-verification.json'), JSON.stringify(result, null, 2)+'\n', { mode: 0o600 });
    return result;
  } finally { await release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw Error('No time override or mutation arguments allowed');
  console.log(JSON.stringify(await verifyStudentShares()));
}
