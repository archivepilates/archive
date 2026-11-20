import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { E261017_SHARE, A261024_SHARE, B261024_SHARE, C261025_SHARE, D261025_SHARE,
  TEAM261120_SHARE, STUDENT_SHARE_SOURCES, STUDENT_SHARE_DAYS, STUDENT_SHARE_WINDOW_MS,
  studentShareSourceDirectory, readStudentShareLedgers, firstVerifiedShareWindow,
  validatedShareEntries, protectedStudentShareGroups } from '../lib/imweb-student-share-policy.mjs';
import { LESSON_VIDEO_ELIGIBILITY_POLICY_ID } from '../lib/lesson-share-registration-policy.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = '536d248c79b437f1a6886783a1a16941a73cb7c3';
const POLICY_FILE = 'scripts/lib/imweb-student-share-policy.mjs';
const ASSET = 'official-home/assets/imweb-my-classroom-20260723a.js';
const original = file => execFileSync('git', ['show', `${BASE}:${file}`], { cwd: ROOT, encoding: 'utf8' });
const policy = fs.readFileSync(path.join(ROOT, POLICY_FILE), 'utf8');
const classroom = fs.readFileSync(path.join(ROOT, ASSET), 'utf8');
const LEGACY = [E261017_SHARE, A261024_SHARE, B261024_SHARE, C261025_SHARE, D261025_SHARE];
const ENTRY = { code: 'Team261120', path: '/private-lesson-team-261120',
  title: '11/20 Team 강사레슨 · 수강생 공유', group: 'PRIVATE LESSON TEAM 261120 40D', private: true };
const START = '2026-11-22T03:04:05.678Z', START_MS = Date.parse(START);
const END_MS = START_MS + 40 * 86400000, END = new Date(END_MS).toISOString();
const MEMBER = 'm0a1'; // Synthetic identity; no member data or real ledgers are loaded.
const emptyLedger = source => ({ accessPolicy: { id: source.policyId, approved: true, days: 40,
  basis: 'first_verified_grant', revocation: source.revocation }, entitlements: {}, manualImmediateGrants: {} });
const receipt = () => ({ status: 'group_verified', memberCode: MEMBER,
  beforeGroups: ['synthetic-paid'], afterGroups: ['synthetic-paid', TEAM261120_SHARE.groupCode],
  beforeGrade: null, afterGrade: null, existingGroupsPreserved: true, verifiedAt: START, grantedAt: START,
  attendanceEvidence: { source: 'studiomate_live_lesson_detail', status: 'both_sessions_registered',
    eligibilityPolicy: LESSON_VIDEO_ELIGIBILITY_POLICY_ID, memberCode: MEMBER,
    date: '2026-11-20', lessonIds: ['98900618', '98900887'],
    sessionAttendance: [{ lessonId: '98900618', status: '출석' }, { lessonId: '98900887', status: '결석' }] } });

test('exact verified Team group is frozen and appended once after the unchanged five sources', () => {
  assert.deepEqual(TEAM261120_SHARE, {
    policyId: 'team261120-grant-40d-v1', groupCode: 'g20261120d135a4dabe93a',
    revocation: 'team261120_group_only', lane: 'student-share-team-261120', storage: 'automation_operations',
    lessonIds: ['98900618', '98900887'], lessonDate: '2026-11-20',
  });
  assert.ok(Object.isFrozen(TEAM261120_SHARE)); assert.ok(Object.isFrozen(TEAM261120_SHARE.lessonIds));
  assert.ok(Object.isFrozen(STUDENT_SHARE_SOURCES));
  assert.deepEqual(STUDENT_SHARE_SOURCES, [...LEGACY, TEAM261120_SHARE]);
  for (const field of ['policyId', 'groupCode', 'lane', 'revocation']) {
    assert.equal(new Set(STUDENT_SHARE_SOURCES.map(source => source[field])).size, 6);
  }
  for (const source of LEGACY) assert.equal(Object.hasOwn(source, 'storage'), false);
});

test('the five original policy declarations retain every pinned baseline byte', () => {
  const baseline = original(POLICY_FILE);
  for (const name of ['E261017_SHARE', 'A261024_SHARE', 'B261024_SHARE', 'C261025_SHARE', 'D261025_SHARE']) {
    const declaration = new RegExp(`export const ${name} = Object.freeze\\(\\{[\\s\\S]*?\\n\\}\\);`);
    const before = baseline.match(declaration)?.[0], after = policy.match(declaration)?.[0];
    assert.ok(before); assert.equal(after, before);
  }
});

// In-memory filesystem only: even canonical-looking paths cannot reach private host data.
function mockDirectories(t, { missing, unsafe } = {}) {
  const home = '/offline-home', automation = path.join(home, 'archive-automation');
  const operations = path.join(automation, 'operations');
  const legacy = path.join(home, 'Library/Application Support/ARCHIVE PILATES');
  const directories = new Map([[automation, 0o755], [operations, 0o755], [legacy, 0o755]]);
  const files = new Map(), reads = [];
  for (const source of STUDENT_SHARE_SOURCES) {
    const parent = source === TEAM261120_SHARE ? operations : legacy;
    const directory = path.join(parent, source.lane);
    directories.set(directory, 0o700);
    files.set(path.join(directory, 'state.json'), emptyLedger(source));
  }
  const teamDirectory = path.join(operations, TEAM261120_SHARE.lane);
  if (missing === 'directory') directories.delete(teamDirectory);
  if (missing === 'state') files.delete(path.join(teamDirectory, 'state.json'));
  if (unsafe) directories.set(teamDirectory, 0o755);
  t.mock.method(os, 'homedir', () => home);
  t.mock.method(fs, 'lstatSync', (file, options) => {
    reads.push(file);
    const directory = directories.has(file), exists = directory || files.has(file);
    if (!exists) {
      if (options?.throwIfNoEntry === false) return undefined;
      throw Object.assign(Error('Missing synthetic source'), { code: 'ENOENT' });
    }
    return { uid: process.getuid(), mode: directory ? directories.get(file) : 0o600,
      dev: 1, ino: 1, isDirectory: () => directory, isFile: () => !directory, isSymbolicLink: () => false };
  });
  t.mock.method(fs, 'readFileSync', file => {
    reads.push(file); assert.ok(files.has(file), 'Only synthetic source ledgers may be read');
    return JSON.stringify(files.get(file));
  });
  for (const method of ['mkdirSync', 'writeFileSync', 'openSync', 'unlinkSync', 'rmSync']) {
    t.mock.method(fs, method, () => assert.fail('Registration/resolution must not write or create ledgers'));
  }
  return { home, operations, legacy, teamDirectory, reads };
}

test('canonical Team lane uses operations while all original five keep their prior Application Support paths', t => {
  const f = mockDirectories(t);
  assert.equal(studentShareSourceDirectory(TEAM261120_SHARE), f.teamDirectory);
  assert.equal(f.teamDirectory, '/offline-home/archive-automation/operations/student-share-team-261120');
  for (const source of LEGACY) {
    assert.equal(studentShareSourceDirectory(source), path.join(f.legacy, source.lane));
  }
  const ledgers = readStudentShareLedgers();
  assert.equal(ledgers.length, 6); assert.equal(ledgers[5].source, TEAM261120_SHARE);
  assert.deepEqual(ledgers[5].state, emptyLedger(TEAM261120_SHARE));
  assert.deepEqual(validatedShareEntries(ledgers[5].state, TEAM261120_SHARE, START_MS), new Map());
  assert.deepEqual(protectedStudentShareGroups(ledgers, MEMBER, START_MS), []);
});

for (const missing of ['directory', 'state']) test(`missing parent-owned Team ${missing} fails closed without initialization or fallback`, t => {
  const f = mockDirectories(t, { missing });
  assert.throws(() => readStudentShareLedgers(), { code: 'ENOENT' });
  assert.equal(f.reads.some(file => file.startsWith(path.join(f.legacy, TEAM261120_SHARE.lane))), false);
});

test('Team lane remains private and does not reuse the separate video-operation evidence directory', t => {
  const f = mockDirectories(t, { unsafe: true });
  assert.throws(() => studentShareSourceDirectory(TEAM261120_SHARE), /Unsafe share ledger/);
  assert.equal(f.reads.some(file => file.includes('team-lesson-videos-261120')), false);
});

test('first verified grant, not lesson date or recheck time, starts exactly 40 days including registered absentees', () => {
  assert.equal(STUDENT_SHARE_DAYS, 40); assert.equal(STUDENT_SHARE_WINDOW_MS, 960 * 3600000);
  const grant = receipt(), unchanged = structuredClone(grant);
  for (const now of [START_MS, START_MS + 86400000, END_MS, END_MS + 86400000]) {
    assert.deepEqual(firstVerifiedShareWindow(grant, TEAM261120_SHARE.groupCode, now), { grantedAt: START, expiresAt: END });
  }
  assert.deepEqual(grant, unchanged);
  const state = emptyLedger(TEAM261120_SHARE);
  state.manualImmediateGrants[MEMBER] = grant;
  const initial = validatedShareEntries(state, TEAM261120_SHARE, START_MS).get(MEMBER);
  state.entitlements[MEMBER] = { ...initial, memberCode: MEMBER,
    policyId: TEAM261120_SHARE.policyId, groupCode: TEAM261120_SHARE.groupCode };
  const ledgers = STUDENT_SHARE_SOURCES.map(source => ({ source, state: source === TEAM261120_SHARE ? state : emptyLedger(source) }));
  assert.deepEqual(protectedStudentShareGroups(ledgers, MEMBER, END_MS - 1), [TEAM261120_SHARE.groupCode]);
  assert.deepEqual(protectedStudentShareGroups(ledgers, MEMBER, END_MS), []);
  state.entitlements[MEMBER].expiresAt = new Date(END_MS + 1).toISOString();
  assert.throws(() => validatedShareEntries(state, TEAM261120_SHARE, END_MS));
});

test('Team evidence rejects date/session/cancellation drift without changing the shared window validator', () => {
  for (const mutate of [
    grant => { grant.attendanceEvidence.date = '2026-11-21'; },
    grant => { grant.attendanceEvidence.lessonIds.reverse(); },
    grant => { grant.attendanceEvidence.sessionAttendance.pop(); },
    grant => { grant.attendanceEvidence.sessionAttendance[1].status = '취소'; },
    grant => { grant.attendanceEvidence.memberCode = 'm0a2'; },
    grant => { grant.grantedAt = new Date(START_MS + 1).toISOString(); },
  ]) {
    const grant = receipt(); mutate(grant);
    assert.throws(() => firstVerifiedShareWindow(grant, TEAM261120_SHARE.groupCode, START_MS));
  }
});

test('catalog adds exactly one private Team entry; every preexisting byte and video ID stays unchanged', () => {
  const baseline = original(ASSET), row = '    ' + JSON.stringify(ENTRY);
  const anchor = baseline.match(/^    \{"code":"D261025"[^\n]+\}\n/m)?.[0];
  assert.ok(anchor);
  assert.equal(classroom, baseline.replace(anchor, anchor.trimEnd() + ',\n' + row + '\n'));
  const privateRows = classroom.match(/(?<=^    )\{"code":[^\n]+\}(?=,?$)/gm).map(row => JSON.parse(row));
  const team = privateRows.filter(item => item.code === ENTRY.code || item.path === ENTRY.path || item.group === ENTRY.group);
  assert.deepEqual(team, [ENTRY]);
  assert.deepEqual(Object.keys(team[0]), ['code', 'path', 'title', 'group', 'private']);
  assert.doesNotMatch(row, /youtube|youtu\.be|videoId|embed/i);
  for (const code of ['E261017', 'A261024', 'B261024', 'C261025', 'D261025']) {
    assert.equal(privateRows.filter(item => item.code === code).length, 1);
  }
});
