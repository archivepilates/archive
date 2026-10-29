import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { imwebJson } from './lib/imweb-referral-source.mjs';
import { staffMembers, MEMBER_GROUP_LOCK } from './lib/imweb-staff-video-sync.mjs';
import { SITE, UNIT, assertMemberPreserved } from './lib/imweb-staff-video-policy.mjs';
import { readStudentShareLedgers, A261024_SHARE, B261024_SHARE, validatedShareEntries,
  firstVerifiedShareWindow, shareInstant } from './lib/imweb-student-share-policy.mjs';
import { matchLessonShareMember } from './lib/lesson-share-operator-identities.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';

const ROOT = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES/lesson-videos-261024');
const allowed = new Set(['윤소언', '김지우', '박규리', '김윤화', '조정미']);
const sources = { A: A261024_SHARE, B: B261024_SHARE };
const file = source => path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES', source.lane, 'state.json');
function readPrivate(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('unsafe_evidence');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function save(file, data) {
  const temporary = `${file}.${process.pid}.tmp`, fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const parent = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
function roster() {
  const a = readPrivate(path.join(ROOT, 'attendance.json'));
  const age = Date.now() - shareInstant(a.verifiedAt);
  if (a.source !== 'StudioMate live lesson-detail DOM' || a.date !== '2026-10-24'
      || age < 0 || age > 7200000 || a.sessions?.length !== 4) throw Error('fresh_attendance_required');
  return Object.entries(sources).flatMap(([team, source]) => {
    const sessions = a.sessions.filter(s => s.team === team);
    if (sessions.length !== 2 || [...source.lessonIds].sort().join() !== sessions.map(s => s.lessonId).sort().join()
        || sessions.some(s => s.date !== a.date || s.rows.length !== 5 || s.rows.some(r => r.attendance !== '출석'))) throw Error('wrong_attendance');
    const keys = sessions.map(s => s.rows.map(r => `${r.name}|${r.phone.replace(/\D/g, '')}`).sort().join());
    if (keys[0] !== keys[1] || new Set(sessions[0].rows.map(r => r.phone.replace(/\D/g, ''))).size !== 5) throw Error('roster_mismatch');
    return sessions[0].rows.map(r => ({ ...r, team, source, attendanceVerifiedAt: a.verifiedAt }));
  });
}
function identify(name) {
  const targets = roster().filter(r => r.name === name);
  if (!allowed.has(name) || targets.length !== 1) throw Error('outside_approved_five');
  const target = targets[0], match = matchLessonShareMember({ attendee: target, members: staffMembers(imwebJson), complete: true });
  if (match.status !== 'matched') throw Error('current_unique_identity_required');
  const before = imwebJson(['member', 'get', match.member.uid, '--unit-code', UNIT]).data;
  if (before.memberCode !== match.member.memberCode || !Array.isArray(before.group)
      || matchLessonShareMember({ attendee: target, members: [before], complete: true }).status !== 'matched') throw Error('fresh_identity_mismatch');
  return { target, before, memberCode: before.memberCode };
}
export function retainUiShareWindow(receipt, existing, source, now) {
  const next = { ...receipt, status: 'group_verified', existingGroupsPreserved: true,
    verifiedAt: receipt.verifiedAt ?? new Date(now).toISOString() };
  const window = firstVerifiedShareWindow(next, source.groupCode, now);
  const entitlement = { ...window, status: 'active', memberCode: receipt.memberCode,
    policyId: source.policyId, groupCode: source.groupCode, grantEvidence: 'first_verified_native_ui_transition' };
  if (existing && (existing.status !== 'active' || existing.memberCode !== entitlement.memberCode
      || existing.policyId !== entitlement.policyId || existing.groupCode !== entitlement.groupCode
      || existing.grantedAt !== window.grantedAt || existing.expiresAt !== window.expiresAt)) throw Error('existing_share_window_conflict');
  return { receipt: next, entitlement: existing ? structuredClone(existing) : entitlement };
}
export function recoverUiShareIntent(ledgers, snapshot) {
  const entries = ledgers.flatMap(item => Object.entries(item.state.manualImmediateGrants || {})
    .filter(([, receipt]) => receipt.status !== 'group_verified')
    .map(([memberCode, receipt]) => ({ ...item, memberCode, receipt })));
  if (!entries.length) return null;
  if (entries.length !== 1 || !snapshot || !allowed.has(snapshot.name)) throw Error('unrelated_pending_share');
  const item = entries[0], { before, afterGroups } = snapshot;
  if (!['intent', 'result_unknown'].includes(item.receipt.status)
      || !sources[snapshot.team] || sources[snapshot.team].policyId !== item.source.policyId
      || item.memberCode !== before?.memberCode || item.receipt.memberCode !== item.memberCode
      || before.siteCode !== SITE || before.unitCode !== UNIT || !Array.isArray(before.group)
      || before.group.includes(item.source.groupCode)
      || !isDeepStrictEqual(afterGroups, [...before.group, item.source.groupCode])
      || !isDeepStrictEqual(item.receipt.beforeGroups, before.group)
      || !isDeepStrictEqual(item.receipt.afterGroups, afterGroups)
      || item.receipt.intentAt !== snapshot.receipt?.intentAt
      || item.receipt.execution !== 'native_admin_ui_user_resume_20261025'
      || item.receipt.beforeGrade !== before.grade
      || item.receipt.memberInvariantHash !== createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'group')))).digest('hex')) throw Error('pending_ui_evidence_conflict');
  return { name: snapshot.name, team: snapshot.team, before, memberCode: item.memberCode, source: item.source };
}
export async function releaseUiShareLocks(locks, release, io = fs) {
  const errors = [];
  try {
    for (const item of [...locks].reverse()) {
      try { io.closeSync(item.fd); } catch (error) { errors.push(error); }
      try { io.unlinkSync(item.lock); } catch (error) { errors.push(error); }
    }
  } finally {
    try { await release(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'UI grant lock cleanup incomplete');
}

async function main() {
const release = await acquireStudioMateBrowserLock({ lockPath: MEMBER_GROUP_LOCK,
  owner: 'lesson-share-261024-approved-ui-recovery', waitMs: 0, staleMs: 600000 });
const locks = [];
let pending;
let lines;
try {
  const context = imwebJson(['config', 'context']);
  if (context.resolved_profile?.site_code !== SITE || context.resolved_profile?.unit_code !== UNIT
      || context.token?.status !== 'healthy') throw Error('wrong_context');
  const ledgers = readStudentShareLedgers();
  const recoveryFile = path.join(ROOT, 'ui-recovery-current.json');
  const recovery = recoverUiShareIntent(ledgers, fs.existsSync(recoveryFile) ? readPrivate(recoveryFile) : null);
  for (const item of ledgers) {
    const state = structuredClone(item.state);
    if (recovery && item.source.policyId === recovery.source.policyId) {
      delete state.manualImmediateGrants[recovery.memberCode];
      delete state.entitlements[recovery.memberCode];
    }
    validatedShareEntries(state, item.source, Date.now());
  }
  if (recovery) {
    const current = identify(recovery.name);
    if (current.memberCode !== recovery.memberCode || current.before.uid !== recovery.before.uid
        || current.target.team !== recovery.team) throw Error('pending_ui_identity_changed');
    pending = { ...current, before: recovery.before };
  }
  for (const source of Object.values(sources)) {
    const lock = path.join(path.dirname(file(source)), 'run.lock'), fd = fs.openSync(lock, 'wx', 0o600);
    locks.push({ lock, fd });
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), operation: 'approved_native_ui_grant' }));
  }
  console.log(JSON.stringify({ ready: true, mode: 'native_ui_only', cliWrites: false, pendingReadback: pending?.target.name ?? null }));
  lines = readline.createInterface({ input: process.stdin });
  for await (const line of lines) {
    try {
      const command = JSON.parse(line);
      if (command.action === 'quit') { lines.close(); break; }
      if (command.action === 'prepare') {
        if (pending) throw Error('verify_prior_intent_first');
        const current = identify(command.name), { target, before, memberCode } = current;
        const state = readPrivate(file(target.source));
        validatedShareEntries(state, target.source, Date.now());
        if (state.manualImmediateGrants[memberCode]) throw Error('prior_receipt_preserved_no_repeat');
        if (before.group.includes(target.source.groupCode)) throw Error('already_present_without_first_receipt');
        const afterGroups = [...before.group, target.source.groupCode];
        const dry = imwebJson(['member', 'update', 'groups', before.uid, '--data',
          JSON.stringify({ unitCode: UNIT, groupCodes: afterGroups }), '--dry-run']);
        if (!dry.confirmation_token || JSON.stringify(dry.body?.groupCodes) !== JSON.stringify(afterGroups)) throw Error('dry_run_mismatch');
        const receipt = { status: 'intent', intentAt: new Date().toISOString(), memberCode,
          beforeGroups: before.group, afterGroups, beforeGrade: before.grade,
          execution: 'native_admin_ui_user_resume_20261025',
          memberInvariantHash: createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'group')))).digest('hex'),
          attendanceEvidence: { source: 'studiomate_live_lesson_detail', status: 'both_sessions_attended',
            memberCode, date: '2026-10-24', lessonIds: [...target.source.lessonIds], verifiedAt: target.attendanceVerifiedAt } };
        state.manualImmediateGrants[memberCode] = receipt;
        save(path.join(ROOT, 'ui-recovery-current.json'), { name: target.name, team: target.team, before, afterGroups, receipt });
        save(file(target.source), state);
        pending = current;
        console.log(JSON.stringify({ prepared: true, name: target.name, team: target.team,
          beforeCount: before.group.length, afterCount: afterGroups.length }));
      } else if (command.action === 'verify') {
        if (!pending || command.name !== pending.target.name) throw Error('wrong_pending_target');
        const { target, before, memberCode } = pending, state = readPrivate(file(target.source));
        const receipt = state.manualImmediateGrants[memberCode];
        try {
          const after = identify(command.name).before;
          assertMemberPreserved(before, after, receipt.afterGroups);
          const data = imwebJson(['member', 'groups', 'members', target.source.groupCode]).data;
          const members = Array.isArray(data) ? data : data?.list;
          if (!Array.isArray(members) || members.filter(m => m.memberCode === memberCode).length !== 1) throw Error('group_readback_missing');
          const result = retainUiShareWindow({ ...receipt, afterGrade: after.grade }, state.entitlements[memberCode], target.source, Date.now());
          Object.assign(receipt, result.receipt);
          state.entitlements[memberCode] = result.entitlement;
          save(file(target.source), state);
          pending = undefined;
          console.log(JSON.stringify({ verified: true, name: target.name, team: target.team, allPreviousGroupsPreserved: true, expiryDays: 40 }));
        } catch {
          receipt.status = 'result_unknown'; save(file(target.source), state);
          throw Error('ui_result_requires_readback_no_repeat_write');
        }
      } else throw Error('unsupported_action');
    } catch (error) {
      console.log(JSON.stringify({ ok: false, error: ['verify_prior_intent_first','outside_approved_five','current_unique_identity_required',
        'fresh_identity_mismatch','prior_receipt_preserved_no_repeat','already_present_without_first_receipt','wrong_pending_target',
        'ui_result_requires_readback_no_repeat_write','unsupported_action'].includes(error.message) ? error.message : 'recovery_check_failed' }));
    }
  }
} finally {
  lines?.close();
  process.stdin.pause();
  await releaseUiShareLocks(locks, release);
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('UI share recovery stopped; inspect private intent and locks before retry'); process.exitCode = 1; });
}
