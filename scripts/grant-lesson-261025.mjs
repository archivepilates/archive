import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { imwebJson } from './lib/imweb-referral-source.mjs';
import { staffMembers, MEMBER_GROUP_LOCK } from './lib/imweb-staff-video-sync.mjs';
import { SITE, UNIT, STAFF_GRADE, assertMemberPreserved } from './lib/imweb-staff-video-policy.mjs';
import { C261025_SHARE, D261025_SHARE, STUDENT_SHARE_SOURCES, readStudentShareLedgers, validatedShareEntries,
  firstVerifiedShareWindow, shareInstant } from './lib/imweb-student-share-policy.mjs';
import { matchLessonShareMember } from './lib/lesson-share-261024.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';

const ROOT = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES/lesson-videos-261025');
const SOURCES = Object.freeze({ C: C261025_SHARE, D: D261025_SHARE });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const kstDate = time => new Date(time + 9 * 3600000).toISOString().slice(0, 10);

function assertSources() {
  for (const [team, groupCode, lessonIds] of [
    ['C', 'g202610257569d3a4255d5', ['97134107', '97134122']],
    ['D', 'g202610252ef2256e312c1', ['97177137', '97177166']],
  ]) {
    const source = SOURCES[team];
    if (!STUDENT_SHARE_SOURCES.includes(source) || source?.groupCode !== groupCode
        || source.policyId !== `${team.toLowerCase()}261025-grant-40d-v1`
        || source.lane !== `student-share-${team.toLowerCase()}-261025`
        || source.revocation !== `${team.toLowerCase()}_team_group_only`
        || source.lessonDate !== '2026-10-25'
        || !isDeepStrictEqual(source.lessonIds, lessonIds)) throw Error('Unregistered or conflicting 10/25 source');
  }
}

function readPrivate(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('Unsafe private evidence');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function save(file, state) {
  const temporary = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeSync(fd, JSON.stringify(state, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const parent = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}

function assertFreshAttendance(evidence) {
  const age = Date.now() - shareInstant(evidence.verifiedAt);
  if (evidence.date !== '2026-10-25' || evidence.source !== 'StudioMate live lesson-detail DOM'
      || age < 0 || age > 2 * 3600000 || !Array.isArray(evidence.sessions) || evidence.sessions.length !== 4) throw Error('Fresh live attendance evidence required');
}

function attendance() {
  const evidence = readPrivate(path.join(ROOT, 'attendance.json'));
  assertFreshAttendance(evidence);
  const targets = [];
  const registered = [];
  const identity = row => {
    if (typeof row.name !== 'string' || !row.name.normalize('NFC').trim()
        || typeof row.phone !== 'string' || !/^[+()\d\s-]+$/.test(row.phone)
        || !row.phone.replace(/\D/g, '')) throw Error('Invalid registered identity');
    return JSON.stringify([row.name.normalize('NFC').trim(), row.phone.replace(/\D/g, '')]);
  };
  for (const [team, source] of Object.entries(SOURCES)) {
    const sessions = evidence.sessions.filter(row => row.team === team);
    if (sessions.length !== 2 || !isDeepStrictEqual(sessions.map(row => row.lessonId).sort(), [...source.lessonIds].sort())) throw Error('Wrong class scope');
    const lists = sessions.map(session => {
      if (session.date !== '2026-10-25' || !Array.isArray(session.rows) || session.rows.length !== 5
          || session.rows.some(row => !['출석', '결석'].includes(row?.attendance))) throw Error('Registered roster with known attendance required');
      const keys = session.rows.map(identity).sort();
      if (new Set(keys).size !== 5) throw Error('Duplicate registered identity');
      const attended = session.rows.filter(row => row.attendance === '출석');
      if (!attended.length) throw Error('Nonempty attended roster required');
      return { keys, attended, attendedKeys: attended.map(identity).sort() };
    });
    if (!isDeepStrictEqual(lists[0].keys, lists[1].keys)) throw Error('Two registered rosters disagree');
    if (!isDeepStrictEqual(lists[0].attendedKeys, lists[1].attendedKeys)) throw Error('Two attended rosters disagree');
    registered.push(...sessions[0].rows);
    targets.push(...lists[0].attended.map(row => ({ ...row, team })));
  }
  if (new Set(registered.map(identity)).size !== registered.length
      || new Set(registered.map(row => row.phone.replace(/\D/g, ''))).size !== registered.length) throw Error('Cross-team duplicate registered identity or phone');
  return { evidence, targets };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(x => !['--apply', '--existing-staff-only'].includes(x))) throw Error('Unsupported argument');
  assertSources();
  const apply = args.includes('--apply');
  const release = await acquireStudioMateBrowserLock({ lockPath: MEMBER_GROUP_LOCK,
    owner: 'lesson-share-261025-grant', waitMs: 0, staleMs: 600000 });
  const locks = [];
  try {
    const context = imwebJson(['config', 'context']);
    if (context.resolved_profile?.site_code !== SITE || context.resolved_profile?.unit_code !== UNIT
        || context.token?.status !== 'healthy' || !context.remote_context?.write_ready) throw Error('Unexpected Imweb account/context');
    const { evidence, targets } = attendance();
    if (apply) {
      const ready = readPrivate(path.join(ROOT, 'delivery-ready.json'));
      if (ready.date !== '2026-10-25' || ready.nativePagesPublished !== true || ready.teamIsolationVerified !== true
          || !['C', 'D'].every(team => ready.teams?.[team]?.videos?.length === 2
            && ready.teams[team].videos.every(video => video.privacyStatus === 'unlisted' && video.processing === 'succeeded'))) throw Error('Verified protected delivery pages required before grants');
    }
    const all = readStudentShareLedgers();
    for (const item of all) validatedShareEntries(item.state, item.source, Date.now());
    const ledgers = new Map(all.filter(item => Object.values(SOURCES).includes(item.source)).map(item => [item.source.policyId, item]));
    if (Object.values(SOURCES).some(source => all.filter(item => item.source === source).length !== 1)) throw Error('Exactly one ledger per C/D source required');
    for (const source of Object.values(SOURCES)) {
      const file = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES', source.lane, 'run.lock');
      const fd = fs.openSync(file, 'wx', 0o600);
      locks.push({ file, fd });
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, operation: source.lane, startedAt: new Date().toISOString() }));
    }
    const members = staffMembers(imwebJson);
    const results = [];
    // The CLI quota belongs to the shared profile, not just this C/D lane.
    let quotaDeferred = all.some(({ state }) => Object.values(state.grantAttempts || {})
      .some(attempt => attempt.status === 'blocked_before_dispatch' && attempt.reason === 'write_quota_exceeded'
        && kstDate(shareInstant(attempt.quotaConfirmedAt)) === kstDate(Date.now())));
    for (const target of targets) {
      const match = matchLessonShareMember({ attendee: target, members, complete: true });
      const source = SOURCES[target.team], { state } = ledgers.get(source.policyId);
      const stateFile = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES', source.lane, 'state.json');
      if (match.status !== 'matched') { results.push({ team: target.team, status: match.status, reason: match.reason }); continue; }
      const { memberCode, uid } = match.member;
      const prior = state.manualImmediateGrants[memberCode];
      if (prior) {
        if (prior.status !== 'group_verified') throw Error('Prior grant result requires independent reconciliation; do not repeat');
        const member = imwebJson(['member', 'get', uid, '--unit-code', UNIT]).data;
        if (member.memberCode !== memberCode || member.uid !== uid || member.siteCode !== SITE || member.unitCode !== UNIT
            || !member.group?.includes(source.groupCode)) throw Error('Existing recorded access changed; no automatic regrant');
        results.push({ team: target.team, status: 'already_verified' }); continue;
      }
      const before = imwebJson(['member', 'get', uid, '--unit-code', UNIT]).data;
      const currentMatch = matchLessonShareMember({ attendee: target, members: [before], complete: true });
      if (currentMatch.status !== 'matched' || currentMatch.member.uid !== uid || before.memberCode !== memberCode
          || !Array.isArray(before.group)) throw Error('Member identity changed');
      const already = before.group.includes(source.groupCode);
      if (already && before.grade !== STAFF_GRADE) { results.push({ team: target.team, status: 'hold', reason: 'preexisting_group_without_first_grant' }); continue; }
      if (!already && (args.includes('--existing-staff-only') || quotaDeferred)) {
        results.push({ team: target.team, status: 'deferred', reason: quotaDeferred
          ? 'local_cli_quota_no_provider_attempt' : 'existing_staff_only_scope' }); continue;
      }
      const afterGroups = already ? [...before.group] : [...before.group, source.groupCode];
      if (new Set(afterGroups).size !== afterGroups.length || afterGroups.length > 50) throw Error('Unsafe member group set');
      const command = ['member', 'update', 'groups', uid, '--data', JSON.stringify({ unitCode: UNIT, groupCodes: afterGroups })];
      let dry;
      if (!already) {
        dry = imwebJson([...command, '--dry-run']);
        if (!dry.confirmation_token || dry.body?.unitCode !== UNIT || !isDeepStrictEqual(dry.body.groupCodes, afterGroups)) throw Error('Unexpected dry-run');
        if (dry.safety?.bulk_confirmation_required_for_execute && !(dry.bulk_confirmation_token || dry.safety.bulk_confirmation_token)) throw Error('Missing bulk confirmation');
      }
      if (!apply) { results.push({ team: target.team, status: already ? 'planned_independent_staff_share' : 'planned_grant' }); continue; }
      const latestMatch = matchLessonShareMember({ attendee: target, members: staffMembers(imwebJson), complete: true });
      if (latestMatch.status !== 'matched' || latestMatch.member.uid !== uid || latestMatch.member.memberCode !== memberCode) throw Error('Current directory identity is no longer unique');
      const fresh = imwebJson(['member', 'get', uid, '--unit-code', UNIT]).data;
      assertMemberPreserved(before, fresh, before.group);
      assertFreshAttendance(evidence);
      const receipt = { status: 'intent', intentAt: new Date().toISOString(), memberCode,
        beforeGroups: [...before.group], afterGroups, beforeGrade: before.grade, memberInvariantHash: hash(Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'group'))),
        attendanceEvidence: { source: 'studiomate_live_lesson_detail', status: 'both_sessions_attended',
          date: '2026-10-25', lessonIds: [...source.lessonIds], memberCode, verifiedAt: evidence.verifiedAt } };
      if (already) receipt.kind = 'student_share_existing_staff';
      state.manualImmediateGrants[memberCode] = receipt; save(stateFile, state);
      let quotaBlockedBeforeDispatch = false;
      try {
        if (!already) {
          const write = [...command, '--yes', '--confirm-token', dry.confirmation_token];
          if (dry.safety?.bulk_confirmation_required_for_execute) write.push('--bulk-confirm-token', dry.bulk_confirmation_token || dry.safety.bulk_confirmation_token);
          imwebJson(write, { execute: (...args) => {
            try { return execFileSync(...args); } catch (error) {
              for (const stream of [error.stderr, error.stdout]) {
                try { if (JSON.parse(String(stream))?.error?.code === 'write_quota_exceeded') quotaBlockedBeforeDispatch = true; }
                catch { /* Unknown errors remain uncertain; never infer non-dispatch. */ }
              }
              throw error;
            }
          } });
        }
        const after = imwebJson(['member', 'get', uid, '--unit-code', UNIT]).data;
        assertMemberPreserved(before, after, afterGroups);
        const response = imwebJson(['member', 'groups', 'members', source.groupCode]).data;
        const groupMembers = Array.isArray(response) ? response : response?.list;
        if (!Array.isArray(groupMembers) || groupMembers.filter(row => row.memberCode === memberCode).length !== 1
            || response.totalCount !== undefined && response.totalCount !== groupMembers.length) throw Error('Independent group readback failed');
        Object.assign(receipt, { status: 'group_verified', verifiedAt: new Date().toISOString(),
          existingGroupsPreserved: true, afterGrade: after.grade });
        const window = firstVerifiedShareWindow(receipt, source.groupCode, Date.now());
        state.entitlements[memberCode] = { ...window, status: 'active', memberCode,
          policyId: source.policyId, groupCode: source.groupCode, grantEvidence: already ? 'independent_attendance_share_on_staff' : 'first_verified_transition' };
        save(stateFile, state); results.push({ team: target.team, status: 'group_verified', staffAlreadyHadAccess: already });
      } catch {
        if (quotaBlockedBeforeDispatch) {
          receipt.status = 'blocked_before_dispatch'; receipt.reason = 'write_quota_exceeded';
          receipt.quotaConfirmedAt = new Date().toISOString(); receipt.firstGrantNotStarted = true;
          state.grantAttempts ??= {}; state.grantAttempts[memberCode] = receipt;
          delete state.manualImmediateGrants[memberCode]; save(stateFile, state);
          quotaDeferred = true;
          results.push({ team: target.team, status: 'deferred', reason: 'local_cli_quota_no_provider_attempt' }); continue;
        }
        receipt.status = 'result_unknown'; save(stateFile, state);
        throw Error('Grant/readback incomplete; reconcile current state before any retry');
      }
    }
    const evidenceFile = path.join(ROOT, `grants-${apply ? 'apply' : 'plan'}.json`);
    save(evidenceFile, { verifiedAt: new Date().toISOString(), mode: apply ? 'apply' : 'plan', results });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'plan', results }));
  } finally {
    try {
      const errors = [];
      for (const lock of locks.reverse()) {
        try { fs.closeSync(lock.fd); } catch (error) { errors.push(error); }
        try { fs.unlinkSync(lock.file); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'C/D grant lock cleanup incomplete');
    } finally { await release(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('10/25 entitlement operation incomplete; inspect private evidence before retry'); process.exitCode = 1; });
}
