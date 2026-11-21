import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { additiveGroups, readPrivate, savePrivate, validateDryRun } from './grant-team-261120-video-access.mjs';
import { validateVideoReadiness } from './complete-imweb-video-access.mjs';
import { staffImweb, staffMembers, MEMBER_GROUP_LOCK } from './lib/imweb-staff-video-sync.mjs';
import { SITE, UNIT, STAFF_GROUP, assertMemberPreserved } from './lib/imweb-staff-video-policy.mjs';
import { firstVerifiedShareWindow, TEAM261121_SHARE, validatedShareEntries } from './lib/imweb-student-share-policy.mjs';
import { LESSON_VIDEO_ELIGIBILITY_POLICY_ID, isRegisteredLessonAttendance } from './lib/lesson-share-registration-policy.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { isLocalImwebWriteQuotaFailure } from './lib/imweb-read-failure.mjs';

const source = TEAM261121_SHARE;
const ROOT = '/Users/archivepilates/archive-automation/operations/team-lesson-videos-261121';
const LEDGER = '/Users/archivepilates/archive-automation/operations/student-share-team-261121/state.json';
const EXPECTED_PATH = '/private-lesson-team-261121';
const stamp = () => new Date().toISOString();
const same = (a, b) => isDeepStrictEqual([...a].sort(), [...b].sort());
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const phone = v => String(v ?? '').replace(/\D/g, '');

function fingerprint(name, v) {
  if (!/^010\d{8}$/.test(v)) return null;
  let h = 2166136261;
  for (const char of `team261121-roster|${name}|${v}`) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}

export function validateNativeRoster(proof, now) {
  assert(proof?.source === 'StudioMate live lesson-detail DOM' && proof.date === source.lessonDate
    && proof.studio === '5330' && proof.sessions?.length === 2
    && same(proof.sessions.map(x => x.lessonId), source.lessonIds), 'Exact native sessions required');
  const bySession = source.lessonIds.map(id => proof.sessions.find(x => x.lessonId === id));
  for (const s of bySession) {
    const age = now - Date.parse(s.observedAt);
    assert(age >= 0 && age <= 2 * 3600000 && s.registeredCount === 5 && s.rows?.length === 5
      && new Set(s.rows.map(x => x.name)).size === 5
      && s.rows.every(x => typeof x.name === 'string' && x.name.trim() === x.name && x.name.length >= 2
        && /^[a-f0-9]{1,8}$/.test(x.check) && isRegisteredLessonAttendance(x.attendance)), 'Fresh five-person roster required');
  }
  return bySession[0].rows.map(r => {
    const pair = bySession[1].rows.find(x => x.name === r.name && x.check === r.check);
    assert(pair, 'Roster identity differs between sessions');
    return { name: r.name, check: r.check, sessionAttendance: [r, pair].map((x, i) => ({
      lessonId: source.lessonIds[i], status: x.attendance,
    })) };
  });
}

export function matchNativeAccount(target, members) {
  const named = members.filter(m => m.name?.normalize('NFC').trim() === target.name);
  const exact = named.filter(m => fingerprint(target.name, phone(m.callnum)) === target.check);
  if (exact.length !== 1) return { status: named.length ? 'hold_identity' : 'no_member' };
  const m = exact[0];
  if (members.filter(x => phone(x.callnum) === phone(m.callnum)).length !== 1) return { status: 'hold_identity' };
  assert(m.siteCode === SITE && m.unitCode === UNIT && /^m[0-9a-f]+$/.test(m.memberCode) && m.uid);
  return { status: 'matched', member: m };
}

export async function main(apply) {
  const release = await acquireStudioMateBrowserLock({ lockPath: MEMBER_GROUP_LOCK, owner: 'team-261121-video-access',
    waitMs: 45000, staleMs: 600000 });
  try {
    const proof = readPrivate(path.join(ROOT, 'registered-roster.json'));
    const targets = validateNativeRoster(proof, Date.now());
    const ready = apply ? readPrivate(path.join(ROOT, 'protected-delivery-ready.json')) : null;
    const state = readPrivate(LEDGER);
    assert(state.siteCode === SITE && state.unitCode === UNIT && state.scope?.lessonDate === source.lessonDate
      && state.scope.groupCode === source.groupCode && same(state.scope.lessonIds, source.lessonIds), 'Ledger scope mismatch');
    const beforeEntitlements = validatedShareEntries(state, source, Date.now());
    const run = staffImweb;
    const context = run(['config', 'context']);
    assert(context.effective_profile === 'default' && context.resolved_profile?.site_code === SITE
      && context.resolved_profile?.unit_code === UNIT && context.token?.status === 'healthy', 'Imweb context mismatch');
    const checkDelivery = () => {
      if (!apply) return;
      assert(ready.protectedPagePlaybackVerified === true && ready.unauthenticatedDirectBlocked === true && ready.videos?.length === 2
        && same(ready.videos.map(v => v.lessonId), source.lessonIds)
        && ready.videos.every(v => v.watchPath === EXPECTED_PATH && v.groupCode === source.groupCode), 'Unexpected delivery proof');
      validateVideoReadiness(ready);
      const page = run(['site', 'menu', '--unit-code', UNIT]).data;
      const objects = v => Array.isArray(v) ? v.flatMap(objects) : v && typeof v === 'object' ? [v, ...Object.values(v).flatMap(objects)] : [];
      const matching = objects(page).filter(x => x.url === EXPECTED_PATH.slice(1));
      assert(matching.length === 1 && matching[0].accessPermission?.type === 'group'
        && same(matching[0].accessPermission.groupCodes, [source.groupCode, STAFF_GROUP]), 'Native group protection changed');
    };
    const groupRows = () => {
      const data = run(['member', 'groups', 'members', source.groupCode]).data;
      const rows = Array.isArray(data) ? data : data?.list;
      assert(Array.isArray(rows) && data?.hasNext !== true && (data?.totalCount === undefined || data.totalCount === rows.length));
      return rows;
    };
    checkDelivery();
    const matches = staffMembers(run);
    const results = [];
    for (const target of targets) {
      const report = status => results.push({ name: target.name, status });
      const selected = matchNativeAccount(target, matches);
      if (selected.status !== 'matched') { report(selected.status); continue; }
      const { uid, memberCode } = selected.member;
      const before = run(['member', 'get', uid, '--unit-code', UNIT]).data;
      assert(matchNativeAccount(target, [before]).status === 'matched' && before.uid === uid && before.memberCode === memberCode);
      if (beforeEntitlements.has(memberCode)) {
        const entry = beforeEntitlements.get(memberCode);
        assert(entry.adopted && entry.status === 'active' && Date.parse(entry.expiresAt) > Date.now()
          && before.group.includes(source.groupCode) && groupRows().filter(x => x.memberCode === memberCode).length === 1);
        report('already_verified_original_clock'); continue;
      }
      assert(!state.grantAttempts?.[memberCode], 'Prior grant attempt requires reconciliation');
      assert(!before.group.includes(source.groupCode), 'Pre-existing group without verified first grant');
      const afterGroups = additiveGroups(before, source.groupCode);
      const command = ['member', 'update', 'groups', uid, '--data', JSON.stringify({ unitCode: UNIT, groupCodes: afterGroups })];
      const dry = validateDryRun(run([...command, '--dry-run']), afterGroups);
      if (!apply) { report('planned_grant'); continue; }
      validateNativeRoster(readPrivate(path.join(ROOT, 'registered-roster.json')), Date.now());
      checkDelivery();
      assertMemberPreserved(before, run(['member', 'get', uid, '--unit-code', UNIT]).data, before.group);
      const receipt = { status: 'intent', intentAt: stamp(), memberCode, beforeGrade: before.grade,
        beforeGroups: before.group, afterGroups, deliveryProofHash: hash(ready), attendanceEvidence: {
          source: 'studiomate_live_lesson_detail', status: 'both_sessions_registered',
          eligibilityPolicy: LESSON_VIDEO_ELIGIBILITY_POLICY_ID, date: source.lessonDate,
          lessonIds: source.lessonIds, memberCode, sessionAttendance: target.sessionAttendance,
          verifiedAt: proof.sessions.at(-1).observedAt,
        } };
      state.grantAttempts ??= {};
      state.grantAttempts[memberCode] = receipt;
      savePrivate(LEDGER, state);
      try {
        validateVideoReadiness(ready);
        run([...command, '--yes', '--confirm-token', dry.confirmation_token, ...(dry.safety?.bulk_confirmation_required_for_execute
          ? ['--bulk-confirm-token', dry.bulk_confirmation_token || dry.safety.bulk_confirmation_token] : [])]);
        const after = run(['member', 'get', uid, '--unit-code', UNIT]).data;
        assertMemberPreserved(before, after, afterGroups);
        assert(groupRows().filter(x => x.memberCode === memberCode).length === 1, 'Independent group membership missing');
        Object.assign(receipt, { status: 'group_verified', verifiedAt: stamp(), existingGroupsPreserved: true, afterGrade: after.grade });
        const window = firstVerifiedShareWindow(receipt, source.groupCode, Date.now());
        state.manualImmediateGrants[memberCode] = receipt;
        state.entitlements[memberCode] = { ...window, status: 'active', memberCode, groupCode: source.groupCode,
          policyId: source.policyId, grantEvidence: 'first_verified_transition' };
        delete state.grantAttempts[memberCode];
        savePrivate(LEDGER, state);
        report('group_verified');
      } catch (error) {
        receipt.status = isLocalImwebWriteQuotaFailure(error) ? 'blocked_before_dispatch' : 'result_unknown';
        savePrivate(LEDGER, state);
        throw Object.assign(new Error(receipt.status), { code: receipt.status });
      }
    }
    return results;
  } finally { await release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert(process.argv.length === 3 && ['--plan', '--apply'].includes(process.argv[2]));
  main(process.argv[2] === '--apply').then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(JSON.stringify({ status: 'incomplete', code: error.code || 'source_or_readback_unverified' }));
    process.exitCode = 1;
  });
}
