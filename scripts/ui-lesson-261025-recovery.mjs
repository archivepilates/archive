import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readLessonAttendance, assertLessonSources } from './grant-lesson-261025.mjs';
import { imwebJson } from './lib/imweb-referral-source.mjs';
import { staffMembers, MEMBER_GROUP_LOCK } from './lib/imweb-staff-video-sync.mjs';
import { SITE, UNIT, assertMemberPreserved } from './lib/imweb-staff-video-policy.mjs';
import { C261025_SHARE, D261025_SHARE, readStudentShareLedgers, validatedShareEntries, shareInstant } from './lib/imweb-student-share-policy.mjs';
import { matchLessonShareMember } from './lib/lesson-share-operator-identities.mjs';
import { retainUiShareWindow, releaseUiShareLocks } from './ui-lesson-261024-recovery.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';

const ROOT = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES/lesson-videos-261025');
const SOURCES = { C: C261025_SHARE, D: D261025_SHARE };
const APPROVAL = 'call_3062285e017a44979da0dc8ac60f75d8:approved-five-native-ui';
const APPROVED_SET_HASH = 'f9c9af9cf0c368fbaa2eeec613bf941d35524a9896ca9943f9895aa416570ee1';
const EXECUTION = 'native_admin_ui_user_resume_20261026_cd_five';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invariants = member => digest(Object.fromEntries(Object.entries(member).filter(([key]) => key !== 'group')));
const fileFor = source => path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES', source.lane, 'state.json');
function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('unsafe_evidence');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function save(file, value) {
  const temp = `${file}.${process.pid}.tmp`, fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
function ledgerSet() {
  const all = readStudentShareLedgers();
  for (const item of all) validatedShareEntries(item.state, item.source, Date.now());
  return all;
}
export function assertApprovedFive(manifest, expectedSetHash = APPROVED_SET_HASH) {
  if (manifest?.approval !== APPROVAL || !Array.isArray(manifest.targets) || manifest.targets.length !== 5
      || manifest.targets.filter(t => t.team === 'C').length !== 2
      || manifest.targets.filter(t => t.team === 'D').length !== 3
      || new Set(manifest.targets.map(t => t.memberCode)).size !== 5
      || new Set(manifest.targets.map(t => t.uid)).size !== 5
      || manifest.targets.some(t => !SOURCES[t.team] || !/^m[0-9a-f]+$/.test(t.memberCode) || typeof t.uid !== 'string' || !t.uid)
      || !Number.isFinite(shareInstant(manifest.approvedAt))) throw Error('outside_approved_five');
  const set = manifest.targets.map(t => [t.team, t.memberCode, t.uid]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (digest(set) !== expectedSetHash) throw Error('approved_identity_set_changed');
  return manifest.targets;
}
export function assertPendingUi(snapshot, manifest, receipt, expectedSetHash = APPROVED_SET_HASH) {
  const allowed = assertApprovedFive(manifest, expectedSetHash).find(t => t.memberCode === snapshot?.before?.memberCode);
  const source = SOURCES[allowed?.team];
  if (!allowed || allowed.uid !== snapshot.before.uid || allowed.team !== snapshot.team
      || snapshot.before.siteCode !== SITE || snapshot.before.unitCode !== UNIT
      || !Array.isArray(snapshot.before.group) || snapshot.before.group.includes(source.groupCode)
      || !['intent', 'result_unknown'].includes(receipt?.status)
      || receipt.execution !== EXECUTION || receipt.approval !== APPROVAL
      || receipt.memberCode !== allowed.memberCode || receipt.intentAt !== snapshot.receipt?.intentAt
      || receipt.memberInvariantHash !== invariants(snapshot.before)
      || receipt.beforeGrade !== snapshot.before.grade
      || !isDeepStrictEqual(receipt.beforeGroups, snapshot.before.group)
      || !isDeepStrictEqual(receipt.afterGroups, [...snapshot.before.group, source.groupCode])
      || !isDeepStrictEqual(snapshot.afterGroups, receipt.afterGroups)) throw Error('pending_evidence_conflict');
  return allowed;
}
export function acquireUiLaneLock(lock, io = fs, now = Date.now(), probe = process.kill) {
  try { return io.openSync(lock, 'wx', 0o600); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = io.lstatSync(lock), raw = io.readFileSync(lock, 'utf8'), owner = JSON.parse(raw);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077
        || owner.operation !== EXECUTION || owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0
        || now - shareInstant(owner.startedAt) <= 600000) throw Error('lane_lock_not_proven_stale');
    let dead = false;
    try { probe(owner.pid, 0); } catch (probeError) { dead = probeError.code === 'ESRCH'; }
    if (!dead || io.lstatSync(lock).ino !== stat.ino || io.readFileSync(lock, 'utf8') !== raw) throw Error('lane_lock_owner_alive_or_changed');
    io.unlinkSync(lock); return io.openSync(lock, 'wx', 0o600);
  }
}
function identify(allowed) {
  const { evidence, targets } = readLessonAttendance();
  const members = staffMembers(imwebJson);
  const candidates = targets.filter(t => t.team === allowed.team).map(target => ({ target,
    match: matchLessonShareMember({ attendee: target, members, complete: true }) }))
    .filter(x => x.match.status === 'matched' && x.match.member.memberCode === allowed.memberCode && x.match.member.uid === allowed.uid);
  if (candidates.length !== 1) throw Error('current_unique_identity_required');
  const before = imwebJson(['member', 'get', allowed.uid, '--unit-code', UNIT]).data;
  if (before.siteCode !== SITE || before.unitCode !== UNIT || before.memberCode !== allowed.memberCode || before.uid !== allowed.uid
      || !Array.isArray(before.group) || new Set(before.group).size !== before.group.length
      || matchLessonShareMember({ attendee: candidates[0].target, members: [before], complete: true }).status !== 'matched') throw Error('fresh_identity_mismatch');
  return { before, target: candidates[0].target, evidence };
}
async function main() {
  if (process.argv.slice(2).length !== 1 || !['--approved-five', '--resume'].includes(process.argv[2])) throw Error('explicit_scope_required');
  assertLessonSources();
  const release = await acquireStudioMateBrowserLock({ lockPath: MEMBER_GROUP_LOCK, owner: EXECUTION, waitMs: 0, staleMs: 600000 });
  const locks = []; let lines; let pending;
  try {
    const context = imwebJson(['config', 'context']);
    if (context.resolved_profile?.site_code !== SITE || context.resolved_profile?.unit_code !== UNIT
        || context.token?.status !== 'healthy') throw Error('wrong_context');
    for (const source of Object.values(SOURCES)) {
      const lock = path.join(path.dirname(fileFor(source)), 'run.lock'), fd = acquireUiLaneLock(lock);
      locks.push({ lock, fd }); fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), operation: EXECUTION, startedAt: new Date().toISOString() }));
    }
    const ready = read(path.join(ROOT, 'delivery-ready.json'));
    if (ready.date !== '2026-10-25' || !['nativePagesPublished', 'teamIsolationVerified', 'classroomDiscoveryVerified', 'testGroupsRestored'].every(k => ready[k] === true)
        || !Object.keys(SOURCES).every(t => ready.teams?.[t]?.videos?.length === 2 && ready.teams[t].videos.every(v => v.privacyStatus === 'unlisted' && v.processing === 'succeeded'))) throw Error('protected_delivery_required');
    const manifestFile = path.join(ROOT, 'ui-approved-five.json');
    let manifest;
    if (!fs.existsSync(manifestFile)) {
      if (process.argv[2] !== '--approved-five') throw Error('approval_manifest_required');
      const all = ledgerSet(), { targets } = readLessonAttendance(), members = staffMembers(imwebJson);
      const approved = []; let verified = 0; let holds = 0;
      for (const target of targets) {
        const match = matchLessonShareMember({ attendee: target, members, complete: true });
        if (match.status !== 'matched') { if (target.team !== 'D') throw Error('unexpected_hold'); holds++; continue; }
        const source = SOURCES[target.team], state = all.find(x => x.source === source).state;
        const prior = state.manualImmediateGrants[match.member.memberCode];
        if (prior) { if (target.team !== 'C' || prior.status !== 'group_verified') throw Error('unexpected_prior_grant'); verified++; continue; }
        approved.push({ team: target.team, uid: match.member.uid, memberCode: match.member.memberCode });
      }
      if (targets.length !== 9 || verified !== 2 || holds !== 2) throw Error('approved_initial_scope_changed');
      manifest = { approval: APPROVAL, approvedAt: new Date().toISOString(), targets: approved };
      assertApprovedFive(manifest); save(manifestFile, manifest);
    } else manifest = read(manifestFile);
    const approved = assertApprovedFive(manifest);
    const recoveryFile = path.join(ROOT, 'ui-five-current.json');
    // Reconcile a saved intent before permitting another member write.
    const raw = readStudentShareLedgers();
    const unfinished = raw.flatMap(item => Object.entries(item.state.manualImmediateGrants || {}).filter(([, r]) => r.status !== 'group_verified').map(([code, receipt]) => ({ ...item, code, receipt })));
    if (unfinished.length) {
      if (unfinished.length !== 1 || !fs.existsSync(recoveryFile)) throw Error('unrelated_pending_intent');
      const item = unfinished[0], snapshot = read(recoveryFile);
      const allowed = assertPendingUi(snapshot, manifest, item.receipt);
      if (item.source !== SOURCES[allowed.team] || item.code !== allowed.memberCode) throw Error('pending_source_conflict');
      for (const entry of raw) {
        const state = structuredClone(entry.state);
        if (entry.source === item.source) { delete state.manualImmediateGrants[item.code]; delete state.entitlements[item.code]; }
        validatedShareEntries(state, entry.source, Date.now());
      }
      identify(allowed);
      pending = { allowed, ...snapshot };
    } else ledgerSet();
    console.log(JSON.stringify({ ready: true, approvedCount: approved.length, cliWrites: false, pendingReadback: !!pending }));
    lines = readline.createInterface({ input: process.stdin });
    for await (const line of lines) {
      try {
        const command = JSON.parse(line);
        if (command.action === 'quit') { lines.close(); break; }
        const allowed = approved.find(t => t.memberCode === command.memberCode);
        if (!allowed) throw Error('outside_approved_five');
        const source = SOURCES[allowed.team];
        if (command.action === 'prepare') {
          if (pending) throw Error('verify_prior_intent_first');
          ledgerSet();
          const { before, evidence } = identify(allowed), state = read(fileFor(source));
          if (state.manualImmediateGrants[allowed.memberCode] || state.entitlements[allowed.memberCode]) throw Error('prior_receipt_no_repeat');
          if (before.group.includes(source.groupCode)) throw Error('preexisting_group_without_receipt');
          const afterGroups = [...before.group, source.groupCode];
          if (afterGroups.length > 50) throw Error('unsafe_group_set');
          const dry = imwebJson(['member', 'update', 'groups', allowed.uid, '--data', JSON.stringify({ unitCode: UNIT, groupCodes: afterGroups }), '--dry-run']);
          if (!dry.confirmation_token || dry.body?.unitCode !== UNIT || !isDeepStrictEqual(dry.body.groupCodes, afterGroups)) throw Error('dry_run_mismatch');
          const fresh = identify(allowed).before; assertMemberPreserved(before, fresh, before.group);
          const finalAttendance = readLessonAttendance();
          if (!isDeepStrictEqual(finalAttendance.evidence, evidence)) throw Error('attendance_changed_during_prepare');
          const receipt = { status: 'intent', intentAt: new Date().toISOString(), memberCode: allowed.memberCode,
            beforeGroups: before.group, afterGroups, beforeGrade: before.grade, memberInvariantHash: invariants(before),
            approval: APPROVAL, execution: EXECUTION, attendanceEvidence: { source: 'studiomate_live_lesson_detail', status: 'both_sessions_attended',
              memberCode: allowed.memberCode, date: '2026-10-25', lessonIds: [...source.lessonIds], verifiedAt: evidence.verifiedAt } };
          const snapshot = { team: allowed.team, before, afterGroups, receipt };
          save(recoveryFile, snapshot);
          state.manualImmediateGrants[allowed.memberCode] = receipt; save(fileFor(source), state);
          pending = { allowed, ...snapshot };
          console.log(JSON.stringify({ prepared: true, team: allowed.team, memberCode: allowed.memberCode, beforeCount: before.group.length, afterCount: afterGroups.length }));
        } else if (command.action === 'verify') {
          if (!pending || pending.allowed.memberCode !== allowed.memberCode) throw Error('wrong_pending_target');
          const state = read(fileFor(source)), receipt = state.manualImmediateGrants[allowed.memberCode];
          assertPendingUi(pending, manifest, receipt);
          try {
            const after = identify(allowed).before;
            assertMemberPreserved(pending.before, after, receipt.afterGroups);
            const data = imwebJson(['member', 'groups', 'members', source.groupCode]).data;
            const members = Array.isArray(data) ? data : data?.list;
            if (!Array.isArray(members) || members.filter(m => m.memberCode === allowed.memberCode).length !== 1
                || data.totalCount !== undefined && data.totalCount !== members.length) throw Error('independent_group_readback_missing');
            const result = retainUiShareWindow({ ...receipt, afterGrade: after.grade }, state.entitlements[allowed.memberCode], source, Date.now());
            Object.assign(receipt, result.receipt);
            state.manualImmediateGrants[allowed.memberCode] = receipt; state.entitlements[allowed.memberCode] = result.entitlement;
            save(fileFor(source), state); ledgerSet(); pending = undefined;
            console.log(JSON.stringify({ verified: true, team: allowed.team, memberCode: allowed.memberCode, preserved: true, windowHours: 960 }));
          } catch {
            receipt.status = 'result_unknown'; state.manualImmediateGrants[allowed.memberCode] = receipt; save(fileFor(source), state);
            throw Error('readback_required_no_repeat_write');
          }
        } else throw Error('unsupported_action');
      } catch (error) { console.log(JSON.stringify({ ok: false, error: ['outside_approved_five', 'verify_prior_intent_first', 'prior_receipt_no_repeat', 'preexisting_group_without_receipt', 'wrong_pending_target', 'readback_required_no_repeat_write'].includes(error.message) ? error.message : 'safety_check_failed' })); }
    }
  } finally {
    lines?.close(); process.stdin.pause(); await releaseUiShareLocks(locks, release);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Approved C/D UI operation stopped; inspect saved intent before retry'); process.exitCode = 1; });
}
