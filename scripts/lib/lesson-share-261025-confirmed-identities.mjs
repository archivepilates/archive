import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { matchLessonShareMember } from './lesson-share-261024.mjs';
import { SITE, UNIT } from './imweb-staff-video-policy.mjs';
import { D261025_SHARE, shareInstant } from './imweb-student-share-policy.mjs';
import { normalizeInstructorLessonPhone } from './instructor-lesson-registration-contract.mjs';

const SET_HASH = '66664e797661aa198707b093189f7ab77ba16a34d9dd743f11b9295069380b53';
const ROUTE_APPROVAL = 'call_dc4c07262f9f49688c452582a637c7ed:existing-check-after-quota-recovery';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalizeName = value => typeof value === 'string' ? value.normalize('NFC').trim() : '';
export function validateConfirmedLessonIdentities(value, now = Date.now(), expectedHash = SET_HASH) {
  if (value?.source !== 'direct human reply in C/D sharing task'
      || value.status !== 'approved_waiting_existing_cli_quota_recovery'
      || value.route !== 'existing_cli_only_no_admin_ui' || value.routeApproval !== ROUTE_APPROVAL
      || value.lessonDate !== '2026-10-25' || !isDeepStrictEqual(value.lessonIds, [...D261025_SHARE.lessonIds])
      || !Number.isFinite(now) || shareInstant(value.confirmedAt) > now || shareInstant(value.routeApprovedAt) > now
      || !Array.isArray(value.selected) || value.selected.length !== 2) throw Error('Invalid scoped identity confirmation');
  const entries = value.selected;
  if (new Set(entries.map(x => x.memberCode)).size !== 2 || new Set(entries.map(x => x.uid)).size !== 2
      || new Set(entries.map(x => x.name)).size !== 2
      || entries.some(x => x.team !== 'D' || !normalizeName(x.name) || x.name !== normalizeName(x.name)
        || !/^m[0-9a-f]+$/.test(x.memberCode) || typeof x.uid !== 'string' || !x.uid || x.uid !== x.uid.trim()
        || !/^[a-f0-9]{64}$/.test(x.attendeeIdentitySha256))) throw Error('Invalid confirmed identity set');
  const set = entries.map(x => [x.team, x.name, x.memberCode, x.uid, x.attendeeIdentitySha256])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (hash(set) !== expectedHash) throw Error('Confirmed identity set changed');
  return value;
}
export function readConfirmedLessonIdentities(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('Unsafe identity evidence');
  return validateConfirmedLessonIdentities(JSON.parse(fs.readFileSync(file, 'utf8')));
}
export function resolveConfirmedLessonMember({ target, source, members, confirmed, expectedHash = SET_HASH }) {
  const ordinary = matchLessonShareMember({ attendee: target, members, complete: true });
  if (!confirmed || target?.team !== 'D') return ordinary;
  validateConfirmedLessonIdentities(confirmed, Date.now(), expectedHash);
  if (source?.policyId !== D261025_SHARE.policyId || source.groupCode !== D261025_SHARE.groupCode
      || source.lessonDate !== D261025_SHARE.lessonDate || !isDeepStrictEqual(source.lessonIds, D261025_SHARE.lessonIds)) throw Error('Wrong confirmed-share scope');
  const entry = confirmed.selected.find(x => x.name === normalizeName(target.name));
  if (!entry) return ordinary;
  const hold = reason => ({ status: 'hold', reason });
  if (target.attendance !== '출석' || typeof target.phone !== 'string'
      || !/^[+()\d\s-]+$/.test(target.phone)
      || hash([normalizeName(target.name), normalizeInstructorLessonPhone(target.phone)]) !== entry.attendeeIdentitySha256) return hold('confirmed_attendance_identity_changed');
  if (['invalid_member_source', 'duplicate_member_identity', 'incomplete_member_source', 'invalid_attendee_or_not_attended'].includes(ordinary.reason)) return ordinary;
  const current = members.filter(m => m.memberCode === entry.memberCode && m.uid === entry.uid
    && normalizeName(m.name) === entry.name && m.siteCode === SITE && m.unitCode === UNIT);
  if (current.length !== 1 || ordinary.status === 'matched'
      && (ordinary.member.memberCode !== entry.memberCode || ordinary.member.uid !== entry.uid)) return hold('confirmed_current_account_conflict');
  return { status: 'matched', member: { uid: entry.uid, memberCode: entry.memberCode },
    identityConfirmation: { source: 'explicit_operator_identity_confirmation', routeApproval: ROUTE_APPROVAL,
      scope: D261025_SHARE.policyId, approvedSetSha256: expectedHash, confirmedAt: confirmed.confirmedAt,
      route: 'existing_cli_only_no_admin_ui' } };
}
