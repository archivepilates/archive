import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { TEAM_IDS, assertTeamRegistration } from './lib/team-261120-scope.mjs';
import { imwebJson } from './lib/imweb-referral-source.mjs';
import { staffMembers, MEMBER_GROUP_LOCK } from './lib/imweb-staff-video-sync.mjs';
import { SITE, UNIT, STAFF_GRADE, STAFF_GROUP, assertMemberPreserved } from './lib/imweb-staff-video-policy.mjs';
import { STUDENT_SHARE_SOURCES, studentShareSourceDirectory, readStudentShareLedgers,
  validatedShareEntries, firstVerifiedShareWindow, shareInstant } from './lib/imweb-student-share-policy.mjs';
import { LESSON_VIDEO_ELIGIBILITY_POLICY_ID } from './lib/lesson-share-registration-policy.mjs';
import { isLocalImwebWriteQuotaFailure } from './lib/imweb-read-failure.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';

export const PRIVATE_ROOT = '/Users/archivepilates/archive-automation/operations/team-lesson-videos-261120';
export const POLICY_ID = 'team261120-grant-40d-v1';
export const LESSON_DATE = '2026-11-20';
export const LESSON_IDS = Object.freeze(['98900618', '98900887']);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const kstDate = now => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
const fail = message => { throw Error(message); };
const same = (a, b) => isDeepStrictEqual([...a].sort(), [...b].sort());

function fresh(at, now, maxAge) {
  const age = now - shareInstant(at);
  assert(Number.isFinite(now) && age >= 0 && age <= maxAge, 'Fresh evidence required');
}

function identity(row) {
  assert(typeof row?.name === 'string' && row.name.normalize('NFC').trim(), 'Missing full name');
  assert(typeof row.phone === 'string' && /^[+()\d\s-]+$/.test(row.phone), 'Missing full phone');
  const phone = row.phone.replace(/\D/g, '');
  assert(/^010\d{8}$/.test(phone), 'Full native mobile phone required');
  return JSON.stringify([row.name.normalize('NFC').trim(), phone]);
}

export function requireTeamSource(sources = STUDENT_SHARE_SOURCES) {
  const source = sources.find(row => row.policyId === POLICY_ID);
  assert(source && sources.filter(row => row.policyId === POLICY_ID).length === 1,
    'Team share policy must be registered by the main lane first');
  assert(source.lessonDate === LESSON_DATE && isDeepStrictEqual(source.lessonIds, LESSON_IDS)
    && /^g[0-9a-f]+$/.test(source.groupCode) && source.groupCode !== STAFF_GROUP
    && sources.filter(row => row.groupCode === source.groupCode).length === 1
    && source.storage === 'automation_operations', 'Wrong registered Team share scope');
  return source;
}

export function validateRegisteredRoster(proof) {
  assert(proof?.lessonDate === LESSON_DATE && same(proof.lessonIds || [], LESSON_IDS)
    && Array.isArray(proof.rows) && proof.rows.length === 6, 'Canonical six-person prior roster required');
  assert(same(proof.rows.map(row => row.registrationId), TEAM_IDS), 'Wrong canonical registration IDs');
  const keys = proof.rows.map(identity);
  assert(new Set(keys).size === 6 && new Set(proof.rows.map(row => JSON.parse(identity(row))[1])).size === 6,
    'Prior roster identities must be unique');
  return proof.rows;
}

// readCore must read these six canonical documents now, never a mirror/export/workLanes record.
export function validateFreshCore(records, roster) {
  assert(Array.isArray(records) && records.length === 6 && same(records.map(row => row.id), TEAM_IDS),
    'Fresh exact-six canonical CORE read required');
  return TEAM_IDS.map(id => {
    const record = records.find(row => row.id === id);
    const current = assertTeamRegistration(id, record.data);
    const prior = roster.find(row => row.registrationId === id);
    assert(prior && identity(prior) === identity({ name: current.memberName, phone: current.memberPhone }),
      'Canonical CORE identity drift');
    const memberId = current.memberId ?? current.fulfillment?.memberId ?? null;
    assert(!prior.sourceMemberId || prior.sourceMemberId === memberId, 'Canonical native member ID drift');
    return { ...prior, name: current.memberName, phone: current.memberPhone };
  });
}

export function validateAttendance(proof, roster, now) {
  assert(proof?.source === 'StudioMate live lesson-detail DOM' && proof.date === LESSON_DATE
    && Array.isArray(proof.sessions) && proof.sessions.length === 2, 'Native attendance evidence required');
  fresh(proof.verifiedAt, now, 2 * 3600000);
  assert(same(proof.sessions.map(row => row.lessonId), LESSON_IDS), 'Wrong native session IDs');
  const expected = roster.map(identity);
  for (const session of proof.sessions) {
    assert(session.date === LESSON_DATE && session.registeredCount === 6
      && Array.isArray(session.rows) && session.rows.length === 6
      && session.rows.every(row => ['출석', '결석'].includes(row.attendance)), 'Complete registered attendance required');
    assert(same(session.rows.map(identity), expected), 'Native attendance and canonical CORE roster disagree');
  }
  return roster.map(row => ({ ...row, sessionAttendance: LESSON_IDS.map(lessonId => ({ lessonId,
    status: proof.sessions.find(session => session.lessonId === lessonId).rows
      .find(attendee => identity(attendee) === identity(row)).attendance })) }));
}

/** Private --ready-file JSON (default protected-delivery-ready.json under PRIVATE_ROOT):
 * {schema:'team261120-protected-delivery-v1', policyId, siteCode, unitCode,
 *  date:<current KST date>, lessonDate:'2026-11-20', groupCode, verifiedAt, videos:[
 *   {lessonId, youtubeId, groupCode, watchPath:'/...', processing:'succeeded',
 *    privacyStatus:'unlisted', playbackVerified:true, playbackVerifiedAt,
 *    nativeAcl:{source:'Imweb native page ACL', verifiedAt, published:true,
 *      mode:'groups', operator:'OR', publicAccess:false, groupCodes:[STUDENT, STAFF]},
 *    catalog:{source:'Imweb live classroom catalog', verifiedAt, connectionVerified:true,
 *      youtubeId, watchPath, groupCode}}]}
 * Exactly one video per native session; all observations <=15 minutes and today KST.
 * This is an upstream observation contract, not permission to fabricate proof or attendance.
 */
export function validateProtectedDelivery(proof, source, now) {
  assert(proof?.schema === 'team261120-protected-delivery-v1' && proof.policyId === POLICY_ID
    && proof.siteCode === SITE && proof.unitCode === UNIT && proof.date === kstDate(now)
    && proof.lessonDate === LESSON_DATE && proof.groupCode === source.groupCode
    && Array.isArray(proof.videos) && proof.videos.length === 2, 'Exact protected delivery proof required');
  const today = at => { fresh(at, now, 900000); assert(kstDate(shareInstant(at)) === kstDate(now)); };
  today(proof.verifiedAt);
  assert(same(proof.videos.map(video => video.lessonId), LESSON_IDS), 'Wrong delivery session scope');
  assert(new Set(proof.videos.map(video => video.youtubeId)).size === 2, 'Two distinct protected videos required');
  for (const video of proof.videos) {
    assert(/^[A-Za-z0-9_-]{11}$/.test(video.youtubeId || '') && /^\/[a-z0-9-]+$/.test(video.watchPath || '')
      && video.groupCode === source.groupCode && video.processing === 'succeeded'
      && video.privacyStatus === 'unlisted' && video.playbackVerified === true, 'Processed unlisted playback required');
    today(video.playbackVerifiedAt);
    const acl = video.nativeAcl, catalog = video.catalog;
    assert(acl?.source === 'Imweb native page ACL' && acl.mode === 'groups' && acl.operator === 'OR'
      && acl.published === true && acl.publicAccess === false && Array.isArray(acl.groupCodes)
      && same(acl.groupCodes, [source.groupCode, STAFF_GROUP]), 'Native STUDENT OR STAFF ACL required');
    today(acl.verifiedAt);
    assert(catalog?.source === 'Imweb live classroom catalog' && catalog.connectionVerified === true
      && catalog.youtubeId === video.youtubeId && catalog.watchPath === video.watchPath
      && catalog.groupCode === source.groupCode, 'Exact classroom catalog connection required');
    today(catalog.verifiedAt);
  }
  return proof;
}

export function matchCurrentMember(target, members) {
  assert(Array.isArray(members), 'Complete fresh member directory required');
  assert(new Set(members.map(row => row.uid)).size === members.length
    && new Set(members.map(row => row.memberCode)).size === members.length, 'Duplicate directory identity');
  for (const row of members) assert(row.siteCode === SITE && row.unitCode === UNIT
    && typeof row.uid === 'string' && row.uid && /^m[0-9a-f]+$/.test(row.memberCode), 'Wrong member directory scope');
  const [name, phone] = JSON.parse(identity(target));
  const byPhone = members.filter(row => String(row.callnum ?? '').replace(/\D/g, '') === phone);
  const byName = members.filter(row => typeof row.name === 'string' && row.name.normalize('NFC').trim() === name);
  if (!byPhone.length && !byName.length) return { status: 'no_member' };
  if (byPhone.length !== 1 || !byName.includes(byPhone[0])) return { status: 'hold' };
  return { status: 'matched', member: byPhone[0] };
}

export function additiveGroups(member, groupCode) {
  assert(Array.isArray(member.group) && member.group.every(code => /^g[0-9a-f]+$/.test(code))
    && new Set(member.group).size === member.group.length, 'Unsafe current group set');
  const groups = member.group.includes(groupCode) ? [...member.group] : [...member.group, groupCode];
  assert(groups.length <= 50, 'Native 50-group limit exceeded');
  return groups;
}

export function validateDryRun(dry, expectedGroups) {
  assert(typeof dry?.confirmation_token === 'string' && dry.confirmation_token
    && isDeepStrictEqual(dry.body, { unitCode: UNIT, groupCodes: expectedGroups }), 'Unexpected group dry-run body');
  if (dry.safety?.bulk_confirmation_required_for_execute) {
    const token = dry.bulk_confirmation_token || dry.safety.bulk_confirmation_token;
    assert(typeof token === 'string' && token, 'Missing bulk confirmation');
  }
  return dry;
}

function assertPrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
    && !(stat.mode & 0o022), 'Unsafe private directory');
  assert(fs.realpathSync(directory) === path.resolve(directory), 'Nested private symlink forbidden');
}

export function readPrivate(file) {
  assertPrivateDirectory(path.dirname(file));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert(stat.isFile() && stat.uid === process.getuid() && !(stat.mode & 0o077), 'Unsafe private evidence');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}

export function savePrivate(file, value) {
  assertPrivateDirectory(path.dirname(file));
  try { fs.lstatSync(file); readPrivate(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
    const parent = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function acquireSourceLock(directory) {
  assertPrivateDirectory(directory);
  const file = path.join(directory, 'run.lock');
  const fd = fs.openSync(file, 'wx', 0o600);
  const inode = fs.fstatSync(fd).ino;
  const release = () => {
    try { if (fs.lstatSync(file).ino === inode) fs.unlinkSync(file); }
    finally { fs.closeSync(fd); }
  };
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); fs.fsyncSync(fd); }
  catch (error) { release(); throw error; }
  return release;
}

async function readCanonicalCore() {
  assert(!process.env.FIRESTORE_EMULATOR_HOST, 'Production emulator conflict');
  const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
  const admin = require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
  // Runtime uses existing ADC; never read, log, or copy a credential file here.
  const app = admin.initializeApp({ projectId: 'archive-pilates', credential: admin.credential.applicationDefault() },
    `team-video-read-${randomUUID()}`);
  try {
    const db = app.firestore();
    const snapshots = await db.getAll(...TEAM_IDS.map(id => db.doc(`instructorLessonRegistrations/${id}`)));
    return snapshots.map(snapshot => { assert(snapshot.exists, 'Missing canonical registration'); return { id: snapshot.id, data: snapshot.data() }; });
  } finally { await app.delete(); }
}

export function parseArguments(args) {
  assert(args.every(arg => arg === '--apply' || arg.startsWith('--ready-file='))
    && args.filter(arg => arg === '--apply').length <= 1
    && args.filter(arg => arg.startsWith('--ready-file=')).length <= 1, 'Unsupported CLI arguments');
  const readyFile = path.resolve(args.find(arg => arg.startsWith('--ready-file='))?.slice(13)
    || path.join(PRIVATE_ROOT, 'protected-delivery-ready.json'));
  assert(path.dirname(readyFile) === PRIVATE_ROOT, 'Readiness proof must be in the private task root');
  return { apply: args.includes('--apply'), readyFile };
}

// All external effects are injected for focused offline tests. Defaults are used only by direct CLI execution.
export async function runTeamVideoAccess({ apply = false, readyFile = path.join(PRIVATE_ROOT, 'protected-delivery-ready.json'),
  sources = STUDENT_SHARE_SOURCES, resolveDirectory = studentShareSourceDirectory,
  readEvidence = readPrivate, readLedgers = readStudentShareLedgers, save = savePrivate,
  run = imwebJson, readCore = readCanonicalCore, clock = Date.now,
  acquireShared = () => acquireStudioMateBrowserLock({ lockPath: MEMBER_GROUP_LOCK,
    owner: 'team-261120-video-access', waitMs: 0, staleMs: 600000 }),
  acquireSource = acquireSourceLock, validateEntries = validatedShareEntries,
  shareWindow = firstVerifiedShareWindow } = {}) {
  const source = requireTeamSource(sources), directory = resolveDirectory(source);
  const releaseShared = await acquireShared();
  let releaseSource;
  try {
    releaseSource = await acquireSource(directory);
    const stateFile = path.join(directory, 'state.json');
    const ledgers = readLedgers();
    for (const item of ledgers) validateEntries(item.state, item.source, clock());
    const own = ledgers.filter(item => item.source.policyId === POLICY_ID);
    assert(own.length === 1 && own[0].source.groupCode === source.groupCode, 'Missing canonical Team ledger');
    const state = own[0].state;
    const roster = validateRegisteredRoster(readEvidence(path.join(PRIVATE_ROOT, 'registered-roster.json')));
    const currentTargets = async () => {
      const current = validateFreshCore(await readCore(), roster);
      const canonicalCoreVerifiedAt = new Date(clock()).toISOString();
      const attendance = readEvidence(path.join(PRIVATE_ROOT, 'native-attendance.json'));
      const targets = validateAttendance(attendance, current, clock());
      const delivery = apply ? validateProtectedDelivery(readEvidence(readyFile), source, clock()) : null;
      return { targets, attendance, delivery, canonicalCoreVerifiedAt };
    };
    const initial = await currentTargets();
    const context = run(['config', 'context']);
    assert(context.effective_profile === 'default' && context.resolved_profile?.site_code === SITE
      && context.resolved_profile?.unit_code === UNIT && context.token?.status === 'healthy'
      && context.remote_context?.write_ready === true, 'Unexpected Imweb profile/site/unit');
    const members = staffMembers(run), results = [];
    let quotaDeferred = Object.values(state.grantAttempts || {}).some(row =>
      row.status === 'blocked_before_dispatch' && row.reason === 'write_quota_exceeded');
    for (const target of initial.targets) {
      const result = status => results.push({ registrationId: target.registrationId, status });
      const match = matchCurrentMember(target, members);
      if (match.status !== 'matched') { result(match.status === 'no_member' ? 'deferred_no_member' : 'hold_identity'); continue; }
      const { memberCode, uid } = match.member;
      assert(Object.values(state.manualImmediateGrants).every(grant =>
        grant.registrationId !== target.registrationId || grant.memberCode === memberCode),
      'Registration already has a different member binding; original clock must not restart');
      const prior = state.manualImmediateGrants[memberCode];
      if (prior && prior.status !== 'group_verified') fail('Prior uncertain intent requires reconciliation; never replay');
      const before = run(['member', 'get', uid, '--unit-code', UNIT]).data;
      const exact = matchCurrentMember(target, [before]);
      assert(exact.status === 'matched' && before.uid === uid && before.memberCode === memberCode, 'Current member identity drift');
      const afterGroups = additiveGroups(before, source.groupCode);
      if (prior) {
        assert(prior.registrationId === target.registrationId, 'Prior grant registration binding changed');
        const window = shareWindow(prior, source.groupCode, clock());
        const entitlement = state.entitlements[memberCode];
        assert(entitlement && entitlement.grantedAt === window.grantedAt && entitlement.expiresAt === window.expiresAt,
          'Original clock missing; no adoption or reset');
        if (entitlement.status !== 'active' || shareInstant(window.expiresAt) <= clock()) { result('window_closed_no_regrant'); continue; }
        assert(before.group.includes(source.groupCode), 'Recorded access changed; no automatic regrant');
        verifyGroup(run, source.groupCode, memberCode);
        result('already_verified_original_clock'); continue;
      }
      assert(!state.entitlements[memberCode], 'Orphan entitlement requires reconciliation');
      const already = before.group.includes(source.groupCode);
      if (already && before.grade !== STAFF_GRADE) { result('hold_preexisting_group'); continue; }
      if (!already && quotaDeferred) { result('deferred_local_quota_before_dispatch'); continue; }
      const command = ['member', 'update', 'groups', uid, '--data', JSON.stringify({ unitCode: UNIT, groupCodes: afterGroups })];
      const dry = already ? null : validateDryRun(run([...command, '--dry-run']), afterGroups);
      if (!apply) { result(already ? 'planned_existing_staff_share' : 'planned_grant'); continue; }
      const unique = matchCurrentMember(target, staffMembers(run));
      assert(unique.status === 'matched' && unique.member.uid === uid && unique.member.memberCode === memberCode,
        'Fresh directory identity is no longer unique');
      // Re-read all six canonical registrations after the potentially long directory scan.
      const latest = await currentTargets();
      const current = latest.targets.find(row => row.registrationId === target.registrationId);
      const freshMember = run(['member', 'get', uid, '--unit-code', UNIT]).data;
      assertMemberPreserved(before, freshMember, before.group);
      fresh(latest.canonicalCoreVerifiedAt, clock(), 900000);
      validateAttendance(latest.attendance, roster, clock());
      validateProtectedDelivery(latest.delivery, source, clock());
      const receipt = { status: 'intent', intentAt: new Date(clock()).toISOString(), memberCode,
        registrationId: current.registrationId, canonicalCoreVerifiedAt: latest.canonicalCoreVerifiedAt,
        beforeGroups: [...before.group], afterGroups, beforeGrade: before.grade,
        memberInvariantHash: hash(Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'group'))),
        deliveryProofHash: hash(latest.delivery), attendanceEvidence: {
          source: 'studiomate_live_lesson_detail', status: 'both_sessions_registered',
          eligibilityPolicy: LESSON_VIDEO_ELIGIBILITY_POLICY_ID, date: LESSON_DATE,
          lessonIds: [...LESSON_IDS], memberCode, sessionAttendance: current.sessionAttendance,
          verifiedAt: latest.attendance.verifiedAt } };
      if (already) receipt.kind = 'student_share_existing_staff';
      state.manualImmediateGrants[memberCode] = receipt;
      save(stateFile, state); // fsync file and parent before transport; failures are not replayable.
      let transportReturned = false;
      try {
        // Disk persistence may take time; expiry boundaries still gate the provider request.
        fresh(latest.canonicalCoreVerifiedAt, clock(), 900000);
        validateAttendance(latest.attendance, roster, clock());
        validateProtectedDelivery(latest.delivery, source, clock());
        if (!already) {
          const write = [...command, '--yes', '--confirm-token', dry.confirmation_token];
          if (dry.safety?.bulk_confirmation_required_for_execute) write.push('--bulk-confirm-token',
            dry.bulk_confirmation_token || dry.safety.bulk_confirmation_token);
          run(write);
        }
        transportReturned = true;
        const after = run(['member', 'get', uid, '--unit-code', UNIT]).data;
        assertMemberPreserved(before, after, afterGroups);
        verifyGroup(run, source.groupCode, memberCode);
        Object.assign(receipt, { status: 'group_verified', verifiedAt: new Date(clock()).toISOString(),
          existingGroupsPreserved: true, afterGrade: after.grade });
        const window = shareWindow(receipt, source.groupCode, clock());
        state.entitlements[memberCode] = { ...window, status: 'active', memberCode,
          policyId: POLICY_ID, groupCode: source.groupCode,
          grantEvidence: already ? 'independent_attendance_share_on_staff' : 'first_verified_transition' };
        save(stateFile, state);
        result('group_verified');
      } catch (error) {
        if (!already && !transportReturned && isLocalImwebWriteQuotaFailure(error)) {
          Object.assign(receipt, { status: 'blocked_before_dispatch', reason: 'write_quota_exceeded',
            quotaConfirmedAt: new Date(clock()).toISOString(), firstGrantNotStarted: true });
          state.grantAttempts ??= {};
          state.grantAttempts[memberCode] = receipt;
          delete state.manualImmediateGrants[memberCode];
          save(stateFile, state);
          quotaDeferred = true;
          result('deferred_local_quota_before_dispatch'); continue;
        }
        receipt.status = 'result_unknown';
        delete state.entitlements[memberCode];
        save(stateFile, state);
        fail('Grant or independent readback incomplete; reconcile without replay');
      }
    }
    return { mode: apply ? 'apply' : 'dry-run', results };
  } finally {
    try { await releaseSource?.(); } finally { await releaseShared(); }
  }
}

function verifyGroup(run, groupCode, memberCode) {
  // Independent full group-membership surface, not a second member-detail read.
  const response = run(['member', 'groups', 'members', groupCode]).data;
  const rows = Array.isArray(response) ? response : response?.list;
  assert(Array.isArray(rows) && response?.hasNext !== true
    && (response?.totalCount === undefined || response.totalCount === rows.length)
    && rows.filter(row => row.memberCode === memberCode).length === 1, 'Independent group membership readback failed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  Promise.resolve().then(() => runTeamVideoAccess(parseArguments(process.argv.slice(2))))
    .then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('Team 11/20 access incomplete; inspect private evidence. No automatic replay.'); process.exitCode = 1; });
}
