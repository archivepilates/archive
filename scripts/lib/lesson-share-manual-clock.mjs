import { isDeepStrictEqual } from 'node:util';
import { SITE, UNIT, STAFF_GRADE } from './imweb-staff-video-policy.mjs';
import { STUDENT_SHARE_SOURCES, assertSharePolicy, validatedShareEntries,
  firstVerifiedShareWindow, shareInstant } from './imweb-student-share-policy.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0 && value === value.trim();
const fail = reason => { throw Error(reason); };
const validIdentity = member => record(member) && member.siteCode === SITE && member.unitCode === UNIT
  && /^m[0-9a-f]+$/.test(member.memberCode) && nonempty(member.uid);

// groupMembers is an independent, fully paginated { complete, groupCode, totalCount, members } readback.
// This records an approved clock only; it never changes account permissions or an existing clock.
export function recordOperatorConfirmedManualShare({ state, source, member, groupMembers,
  attendanceEvidence, confirmation, now } = {}) {
  const canonical = STUDENT_SHARE_SOURCES.find(item => item.policyId === source?.policyId);
  if (!canonical || !isDeepStrictEqual(source, canonical) || !Number.isFinite(now)) fail('invalid_manual_share_scope_or_clock');
  assertSharePolicy(state, canonical);
  validatedShareEntries(state, canonical, now);
  if (!validIdentity(member) || !Object.hasOwn(member, 'grade')
      || !(member.grade === null || typeof member.grade === 'string' && member.grade === member.grade.trim())
      || member.grade === STAFF_GRADE
      || !Array.isArray(member.group) || !member.group.includes(canonical.groupCode)
      || !member.group.every(nonempty) || new Set(member.group).size !== member.group.length) fail('invalid_manual_share_member');
  const { memberCode, uid } = member;
  if (Object.hasOwn(state.manualImmediateGrants, memberCode) || Object.hasOwn(state.entitlements, memberCode)) {
    fail('existing_manual_share_clock_requires_review');
  }
  if (!record(groupMembers) || groupMembers.complete !== true || groupMembers.groupCode !== canonical.groupCode
      || !Array.isArray(groupMembers.members) || !Number.isSafeInteger(groupMembers.totalCount)
      || groupMembers.totalCount !== groupMembers.members.length) fail('incomplete_manual_share_group_readback');
  const uids = new Set(), codes = new Set();
  let matched = 0;
  for (const current of groupMembers.members) {
    if (!validIdentity(current) || uids.has(current.uid) || codes.has(current.memberCode)) fail('invalid_or_duplicate_group_identity');
    uids.add(current.uid);
    codes.add(current.memberCode);
    if (current.uid === uid && current.memberCode === memberCode) matched++;
  }
  if (matched !== 1) fail('manual_share_group_identity_mismatch');
  if (!record(confirmation) || confirmation.approved !== true || confirmation.source !== 'direct_operator_confirmation'
      || confirmation.memberCode !== memberCode || confirmation.groupCode !== canonical.groupCode) fail('invalid_manual_share_confirmation');
  const start = shareInstant(confirmation.grantedAt), confirmed = shareInstant(confirmation.confirmedAt);
  if (start > confirmed || confirmed > now) fail('invalid_manual_share_confirmation_clock');
  if (!record(attendanceEvidence) || attendanceEvidence.status !== 'both_sessions_registered'
      || attendanceEvidence.memberCode !== memberCode) fail('registered_manual_share_evidence_required');
  const receipt = {
    kind: 'student_share_operator_confirmed_manual', status: 'group_verified', memberCode, uid,
    beforeGroups: [...member.group], afterGroups: [...member.group],
    beforeGrade: member.grade, afterGrade: member.grade, existingGroupsPreserved: true,
    verifiedAt: confirmation.grantedAt, independentVerifiedAt: new Date(now).toISOString(),
    operatorConfirmation: {
      approved: true, source: 'direct_operator_confirmation', memberCode, groupCode: canonical.groupCode,
      grantedAt: confirmation.grantedAt, confirmedAt: confirmation.confirmedAt,
    },
    attendanceEvidence: {
      source: attendanceEvidence.source, status: attendanceEvidence.status,
      eligibilityPolicy: attendanceEvidence.eligibilityPolicy, memberCode,
      date: attendanceEvidence.date, lessonIds: structuredClone(attendanceEvidence.lessonIds),
      sessionAttendance: Array.isArray(attendanceEvidence.sessionAttendance)
        ? Array.from(attendanceEvidence.sessionAttendance, row => record(row) ? { lessonId: row.lessonId, status: row.status } : null)
        : undefined,
    },
  };
  const window = firstVerifiedShareWindow(receipt, canonical.groupCode, now);
  const next = structuredClone(state);
  next.manualImmediateGrants[memberCode] = receipt;
  next.entitlements[memberCode] = {
    policyId: canonical.policyId, memberCode, groupCode: canonical.groupCode,
    ...window, status: 'active', grantEvidence: 'operator_confirmed_manual_grant',
  };
  validatedShareEntries(next, canonical, now);
  return next;
}
