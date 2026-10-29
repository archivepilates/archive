import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { matchLessonShareMember as matchOriginal } from './lesson-share-261024.mjs';
import { normalizeInstructorLessonPhone } from './instructor-lesson-registration-contract.mjs';
import { SITE, UNIT } from './imweb-staff-video-policy.mjs';
import { shareInstant } from './imweb-student-share-policy.mjs';

export const APPROVED_SET_HASH = 'd1878adb8f1a5e6c5599e48804da513d2affa342ccf8f3258cf090737c543b47';
const SCOPE = 'instructor_lesson_video_share';
const APPROVAL = 'operator-chat-20261029-same-person-persistent-matching';
const MAX_BYTES = 65536;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value === value.trim()
  && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
const name = value => typeof value === 'string' ? value.trim().normalize('NFC') : '';
const requireThat = (condition, message) => { if (!condition) throw Error(message); };
const hold = reason => ({ status: 'hold', reason });
function phone(value) {
  if (typeof value !== 'string' || !/^[+()\d\s-]+$/.test(value)) return '';
  const normalized = normalizeInstructorLessonPhone(value);
  return /^010\d{8}$/.test(normalized) ? normalized : '';
}

export function validateOperatorIdentities(value, now = Date.now(), expectedHash = APPROVED_SET_HASH) {
  requireThat(record(value) && value.version === 1 && value.approved === true
    && value.siteCode === SITE && value.unitCode === UNIT && value.scope === SCOPE
    && value.approvalRef === APPROVAL && Number.isFinite(now)
    && typeof expectedHash === 'string' && /^[a-f0-9]{64}$/.test(expectedHash), 'Invalid operator identity approval');
  requireThat(shareInstant(value.confirmedAt) <= now, 'Future operator identity confirmation');
  requireThat(Array.isArray(value.identities) && value.identities.length === 1, 'Invalid operator identity set');
  for (const entry of value.identities) {
    requireThat(record(entry) && text(entry.name) && entry.name === name(entry.name)
      && typeof entry.phone === 'string' && /^010\d{8}$/.test(entry.phone)
      && text(entry.uid) && typeof entry.memberCode === 'string' && /^m[0-9a-f]+$/.test(entry.memberCode)
      && typeof entry.sourceMemberId === 'string' && /^\d+$/.test(entry.sourceMemberId), 'Invalid operator identity entry');
  }
  for (const key of ['name', 'phone', 'uid', 'memberCode', 'sourceMemberId']) {
    requireThat(new Set(value.identities.map(entry => entry[key])).size === value.identities.length, 'Duplicate operator identity');
  }
  const canonical = value.identities.map(entry => [SITE, UNIT, entry.name, entry.phone,
    entry.uid, entry.memberCode, entry.sourceMemberId])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  requireThat(hash === expectedHash, 'Operator identity approval hash mismatch');
  return value;
}

function privateStat(stat, directory = false) {
  requireThat(!stat.isSymbolicLink() && stat.uid === process.getuid() && !(stat.mode & 0o077)
    && (stat.mode & 0o400) !== 0 && (directory
      ? stat.isDirectory() && (stat.mode & 0o100) !== 0
      : stat.isFile() && stat.nlink === 1 && stat.size <= MAX_BYTES), 'Unsafe operator identity file or parent');
}

export function readOperatorIdentities(file = path.join(os.homedir(), 'ArchiveIN/automation/imweb-lesson-identities/approved.json')) {
  requireThat(typeof file === 'string' && path.isAbsolute(file) && path.resolve(file) === file, 'Invalid operator identity path');
  const parent = path.dirname(file);
  let current = path.parse(parent).root, parentStat, before;
  try {
    for (const part of parent.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'Unsafe operator identity ancestor');
    }
    parentStat = fs.lstatSync(parent);
    privateStat(parentStat, true);
    before = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  privateStat(before);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let contents;
  try {
    const opened = fs.fstatSync(descriptor);
    privateStat(opened);
    requireThat(opened.ino === before.ino && opened.dev === before.dev, 'Operator identity file changed');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0, read;
    do { read = fs.readSync(descriptor, buffer, size, buffer.length - size, null); size += read; }
    while (read > 0 && size < buffer.length);
    const after = fs.fstatSync(descriptor), latestParent = fs.lstatSync(parent), latest = fs.lstatSync(file);
    privateStat(after); privateStat(latestParent, true); privateStat(latest);
    requireThat(size <= MAX_BYTES && size === opened.size && after.size === opened.size
      && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs
      && latest.ino === opened.ino && latest.dev === opened.dev
      && latestParent.ino === parentStat.ino && latestParent.dev === parentStat.dev, 'Operator identity file changed');
    contents = buffer.subarray(0, size).toString('utf8');
  } finally { fs.closeSync(descriptor); }
  let value;
  try { value = JSON.parse(contents); } catch { throw Error('Invalid operator identity registry JSON'); }
  return validateOperatorIdentities(value);
}

export function matchWithOperatorIdentity({ attendee, members, complete = false } = {}, registry,
  { now = Date.now(), expectedHash = APPROVED_SET_HASH } = {}) {
  const ordinary = matchOriginal({ attendee, members, complete });
  if (registry == null) return ordinary;
  validateOperatorIdentities(registry, now, expectedHash);
  const entry = registry.identities.find(row => row.name === name(attendee?.name) && row.phone === phone(attendee?.phone));
  if (!entry) return ordinary;
  if (ordinary.reason && ordinary.reason !== 'identity_mismatch' && ordinary.status !== 'no_member') return ordinary;
  if (ordinary.status === 'matched' && (ordinary.member.uid !== entry.uid || ordinary.member.memberCode !== entry.memberCode)) {
    return hold('operator_identity_current_account_conflict');
  }
  const sameName = members.filter(member => name(member.name) === entry.name);
  if (sameName.length !== 1 || sameName[0].uid !== entry.uid || sameName[0].memberCode !== entry.memberCode) {
    return hold('operator_identity_current_account_conflict');
  }
  const selected = sameName[0];
  if (selected.callnum !== undefined && selected.callnum !== null && selected.callnum !== ''
    && phone(selected.callnum) !== entry.phone) return hold('operator_identity_current_phone_conflict');
  if (members.some(member => member !== selected && phone(member.callnum) === entry.phone)) {
    return hold('operator_identity_current_phone_conflict');
  }
  return { status: 'matched', member: { uid: entry.uid, memberCode: entry.memberCode },
    identityConfirmation: { source: 'explicit_operator_identity_confirmation', scope: SCOPE,
      approvedSetSha256: expectedHash, confirmedAt: registry.confirmedAt, approvalRef: registry.approvalRef } };
}

export function matchLessonShareMember(options) {
  return matchWithOperatorIdentity(options, readOperatorIdentities());
}
