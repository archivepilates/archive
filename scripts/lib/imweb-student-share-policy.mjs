import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SITE, UNIT, STAFF_GRADE } from './imweb-staff-video-policy.mjs';

export const STUDENT_SHARE_DAYS = 40;
export const STUDENT_SHARE_WINDOW_MS = STUDENT_SHARE_DAYS * 86400000;
export const E261017_SHARE = Object.freeze({
  policyId: 'e261017-grant-40d-v1', groupCode: 'g2026101715ef28611dff4',
  revocation: 'e_team_group_only', lane: 'student-share-e-261017',
});
export const A261024_SHARE = Object.freeze({
  policyId: 'a261024-grant-40d-v1', groupCode: 'g20261025ad8ce226150cf',
  revocation: 'a_team_group_only', lane: 'student-share-a-261024',
  lessonIds: Object.freeze(['97134106', '97134121']),
  lessonDate: '2026-10-24',
});
export const B261024_SHARE = Object.freeze({
  policyId: 'b261024-grant-40d-v1', groupCode: 'g20261025ee18a8f4e30b9',
  revocation: 'b_team_group_only', lane: 'student-share-b-261024',
  lessonIds: Object.freeze(['97177049', '97177091']),
  lessonDate: '2026-10-24',
});
export const C261025_SHARE = Object.freeze({
  policyId: 'c261025-grant-40d-v1', groupCode: 'g202610257569d3a4255d5',
  revocation: 'c_team_group_only', lane: 'student-share-c-261025',
  lessonIds: Object.freeze(['97134107', '97134122']), lessonDate: '2026-10-25',
});
export const D261025_SHARE = Object.freeze({
  policyId: 'd261025-grant-40d-v1', groupCode: 'g202610252ef2256e312c1',
  revocation: 'd_team_group_only', lane: 'student-share-d-261025',
  lessonIds: Object.freeze(['97177137', '97177166']), lessonDate: '2026-10-25',
});
export const STUDENT_SHARE_SOURCES = Object.freeze([
  E261017_SHARE, A261024_SHARE, B261024_SHARE, C261025_SHARE, D261025_SHARE,
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = () => { throw Error('Student-share evidence missing or inconsistent; no staff group removal'); };
const groups = value => Array.isArray(value) && value.every(code => typeof code === 'string' && code.trim() === code && code.length > 0)
  && new Set(value).size === value.length;

export function shareInstant(value) {
  if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail();
  const instant = Date.parse(value);
  const date = value.slice(0, 10);
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(instant) || !Number.isFinite(midnight)
      || new Date(midnight).toISOString().slice(0, 10) !== date
      || Number(value.slice(11, 13)) >= 24) fail();
  return instant;
}

export function firstVerifiedShareWindow(grant, groupCode, now) {
  if (!Number.isFinite(now) || !record(grant) || grant.status !== 'group_verified'
      || !groups(grant.beforeGroups) || !groups(grant.afterGroups)
      || !grant.afterGroups.includes(groupCode)
      || !grant.beforeGroups.every(code => typeof code === 'string' && grant.afterGroups.includes(code))
      || grant.existingGroupsPreserved !== true) fail();
  if (grant.beforeGroups.includes(groupCode)) {
    const source = STUDENT_SHARE_SOURCES.find(source => source.groupCode === groupCode);
    const evidence = grant.attendanceEvidence;
    if (grant.kind !== 'student_share_existing_staff' || grant.beforeGrade !== STAFF_GRADE
        || grant.afterGrade !== STAFF_GRADE || !source?.lessonIds || !record(evidence)
        || evidence.source !== 'studiomate_live_lesson_detail' || evidence.status !== 'both_sessions_attended'
        || !/^m[0-9a-f]+$/.test(evidence.memberCode) || !source.lessonDate || evidence.date !== source.lessonDate
        || JSON.stringify(evidence.lessonIds) !== JSON.stringify(source.lessonIds)
        || grant.beforeGroups.length !== grant.afterGroups.length) fail();
  } else if (grant.kind === 'student_share_existing_staff') fail();
  const start = shareInstant(grant.verifiedAt);
  if (start > now || (grant.grantedAt !== undefined && shareInstant(grant.grantedAt) !== start)) fail();
  return { grantedAt: new Date(start).toISOString(), expiresAt: new Date(start + STUDENT_SHARE_WINDOW_MS).toISOString() };
}

export function assertSharePolicy(state, source) {
  const policy = state?.accessPolicy;
  if (!record(state) || !record(policy) || policy.id !== source.policyId || policy.approved !== true
      || policy.days !== STUDENT_SHARE_DAYS || policy.basis !== 'first_verified_grant'
      || policy.revocation !== source.revocation
      || (state.siteCode !== undefined && state.siteCode !== SITE)
      || (state.unitCode !== undefined && state.unitCode !== UNIT)) fail();
}

export function readStudentShareLedgers({ root = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES') } = {}) {
  const parent = fs.lstatSync(root);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid() || (parent.mode & 0o022)) fail();
  return STUDENT_SHARE_SOURCES.map(source => {
    const directory = path.join(root, source.lane);
    const file = path.join(directory, 'state.json');
    for (const [name, isDirectory] of [[directory, true], [file, false]]) {
      const stat = fs.lstatSync(name);
      if (stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)
          || (isDirectory ? !stat.isDirectory() : !stat.isFile())) fail();
    }
    return { source, state: JSON.parse(fs.readFileSync(file, 'utf8')) };
  });
}

export function validatedShareEntries(state, source, now) {
  if (!Number.isFinite(now)) fail();
  assertSharePolicy(state, source);
  if (!record(state.entitlements) || !record(state.manualImmediateGrants)) fail();
  const result = new Map();
  for (const [code, grant] of Object.entries(state.manualImmediateGrants)) {
    if (!/^m[0-9a-f]+$/.test(code)) fail();
    if (grant.kind === 'student_share_existing_staff' && grant.attendanceEvidence?.memberCode !== code) fail();
    const window = firstVerifiedShareWindow(grant, source.groupCode, now);
    result.set(code, { ...window, status: 'active', adopted: false });
  }
  for (const [code, entry] of Object.entries(state.entitlements)) {
    const window = result.get(code);
    if (!window || !record(entry) || entry.memberCode !== code
        || entry.policyId !== source.policyId || entry.groupCode !== source.groupCode
        || !['active', 'revoked', 'removed_externally'].includes(entry.status)
        || shareInstant(entry.grantedAt) !== shareInstant(window.grantedAt)
        || shareInstant(entry.expiresAt) !== shareInstant(window.expiresAt)) fail();
    result.set(code, { ...entry, adopted: true });
  }
  return result;
}

// These are independent access reasons, not new grants or a migration of old timestamps.
export function protectedStudentShareGroups(ledgers, memberCode, now) {
  if (!Number.isFinite(now) || !/^m[0-9a-f]+$/.test(memberCode) || !Array.isArray(ledgers)
      || ledgers.length !== STUDENT_SHARE_SOURCES.length) fail();
  const result = new Set();
  const seen = new Set();
  for (const item of ledgers) {
    const source = STUDENT_SHARE_SOURCES.find(row => row.policyId === item?.source?.policyId);
    if (!source || seen.has(source.policyId) || item.source.groupCode !== source.groupCode
        || item.source.revocation !== source.revocation) fail();
    seen.add(source.policyId);
    const state = item.state;
    for (const [code, entry] of validatedShareEntries(state, source, now)) {
      if (entry.status === 'active' && entry.revocation !== undefined) fail();
      if (code === memberCode && entry.status === 'active' && shareInstant(entry.expiresAt) > now) result.add(source.groupCode);
    }
  }
  return [...result].sort();
}
