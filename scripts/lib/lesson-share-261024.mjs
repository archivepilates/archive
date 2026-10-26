import { createHash } from 'node:crypto';
import { normalizeInstructorLessonPhone } from './instructor-lesson-registration-contract.mjs';
import { SITE, UNIT } from './imweb-staff-video-policy.mjs';
import { firstVerifiedShareWindow, shareInstant } from './imweb-student-share-policy.mjs';
import { isRegisteredLessonAttendance } from './lesson-share-registration-policy.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const name = value => typeof value === 'string' ? value.trim().normalize('NFC') : '';
const hold = reason => ({ status: 'hold', reason });

function phone(value) {
  if (typeof value !== 'string' || !/^[+()\d\s-]+$/.test(value)) return '';
  const normalized = normalizeInstructorLessonPhone(value);
  return /^010\d{8}$/.test(normalized) ? normalized : '';
}

function attendeeIdentity(attendee) {
  if (!record(attendee) || !isRegisteredLessonAttendance(attendee.attendance)) return null;
  const identity = { name: name(attendee.name), phone: phone(attendee.phone) };
  return identity.name && identity.phone ? identity : null;
}

// Supply a fresh, completely paginated native snapshot; referral projections omit name/callnum.
// complete is a caller assertion, not freshness proof or permission to send/grant.
export function matchLessonShareMember({ attendee, members, complete = false } = {}) {
  const target = attendeeIdentity(attendee);
  if (!target) return hold('invalid_registration_or_not_registered');
  if (complete !== true || !Array.isArray(members)) return hold('incomplete_member_source');
  const seenUids = new Set();
  const seenCodes = new Set();
  const exact = [];
  const samePhone = [];
  let sameName = false;
  for (const member of members) {
    if (!record(member) || member.siteCode !== SITE || member.unitCode !== UNIT
        || typeof member.uid !== 'string' || !member.uid.trim() || member.uid !== member.uid.trim()
        || typeof member.memberCode !== 'string' || !/^m[0-9a-f]+$/.test(member.memberCode)
        || !name(member.name)) return hold('invalid_member_source');
    if (seenUids.has(member.uid) || seenCodes.has(member.memberCode)) return hold('duplicate_member_identity');
    seenUids.add(member.uid);
    seenCodes.add(member.memberCode);
    const nameMatches = name(member.name) === target.name;
    const phoneMatches = phone(member.callnum) === target.phone;
    sameName ||= nameMatches;
    if (phoneMatches) samePhone.push(member);
    if (nameMatches && phoneMatches) exact.push(member);
  }
  if (exact.length > 1) return hold('ambiguous_exact_match');
  if (samePhone.length > 1) return hold('ambiguous_phone');
  if (exact.length === 1) {
    const { uid, memberCode } = exact[0];
    return { status: 'matched', member: { uid, memberCode } };
  }
  if (sameName || samePhone.length) return hold('identity_mismatch');
  return { status: 'no_member', reason: 'no_current_identity_match' };
}

// Use the same key across retries and signup rechecks; a result/key is not send approval.
export function lessonShareActionKey({ team, attendee, action } = {}) {
  const identity = attendeeIdentity(attendee);
  if (!['A', 'B'].includes(team) || !['sms', 'no_member'].includes(action) || !identity) {
    throw Error('invalid_lesson_share_action');
  }
  const digest = createHash('sha256').update(JSON.stringify([
    'lesson-share-261024-v1', '2026-10-24', team, action, identity.name, identity.phone,
  ])).digest('hex');
  return `lesson_share_261024_${action}_${digest}`;
}

// firstGrant must be the retained original receipt, never the latest replay/re-added group.
// Return dates only: this helper cannot authorize a grant or resurrect a terminal entitlement.
export function reuseLessonShareWindow({ firstGrant, groupCode, now, existing } = {}) {
  if (typeof groupCode !== 'string' || !groupCode.trim() || groupCode !== groupCode.trim()) {
    throw Error('invalid_lesson_share_group');
  }
  const window = firstVerifiedShareWindow(firstGrant, groupCode, now);
  if (existing !== undefined) {
    if (!record(existing) || existing.revocation !== undefined
        || (existing.status !== undefined && existing.status !== 'active')
        || (existing.groupCode !== undefined && existing.groupCode !== groupCode)
        || shareInstant(existing.grantedAt) !== shareInstant(window.grantedAt)
        || shareInstant(existing.expiresAt) !== shareInstant(window.expiresAt)) {
      throw Error('existing_share_window_conflict_or_terminal');
    }
  }
  return window;
}
