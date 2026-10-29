import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { signupV2Projection, parseSignupProfileV2, signupProfileV2Id,completionOnlySignupProfileV2 } from './instructor-signup-profile-v2.mjs';
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE,
  normalizeInstructorLessonPhone as phone, normalizeInstructorLessonName as name } from './instructor-lesson-registration-contract.mjs';
import { normalizeSignupBirthDateV2, normalizeSignupAddressV2 } from './instructor-signup-profile-v2-policy.mjs';

const TWO_HOURS = 2 * 3600000;
const BASELINE = 'completed_signup_profile_baseline_v2';
const PREFIX = 'instructor_profile_baseline_';
const regularId = value => typeof value === 'string' && /^ilr_[a-f0-9]{24}$/.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const PROFILE_KEYS = ['version', 'documentId', 'templateId', 'memberName', 'memberPhone', 'birthDateRaw', 'addressRaw', 'career', 'affiliation'];
const COMPLETION_PROFILE_KEYS=['version','mode','documentId','templateId','memberName','memberPhone','fieldReviewReason'];
const profileKeys=profile=>profile?.mode==='completion_only'?COMPLETION_PROFILE_KEYS:PROFILE_KEYS;
const SOURCE_KEYS = ['jobId', 'source', 'baselineOnly', 'sendAllowed', 'status', 'registrationId', 'studioId',
  'studiomateMemberId', 'memberName', 'memberPhone', 'documentId', 'documentName', 'submittedProfile',
  'completionProof', 'profileNativeReadbackAt', 'sourceAuditHash', 'profileMemoJobId'];

export function assertSignupEnrichmentSubset(subset,parent) {
  assert(subset?.source==='instructor_signup_verified_subset_v2'&&subset.parentAuditComplete===false
    &&subset.ok===true&&subset.coverage?.complete===true&&subset.coverage.scope==='verified_completed_native_members');
  assert(parent?.source==='instructor_signup_enrichment_native_sources_v2'&&parent.coverage?.inventoryComplete===true
    &&parent.coverage.scopeComplete===true&&parent.coverage.documentStatus.attempted===parent.coverage.documentStatus.expected
    &&parent.coverage.nativeMembers.attempted===parent.coverage.nativeMembers.expected
    &&parent.cleanup?.length===3&&parent.cleanup.every(x=>x.contextClosed&&x.lockReleased)
    &&parent.errors.every(x=>['document_status','completed_profiles'].includes(x.phase)));
  assert(Array.isArray(subset.rows)&&subset.rows.length===parent.members.length&&new Set(subset.rows.map(x=>x.member.memberId)).size===subset.rows.length);
  for(const row of subset.rows){
    const m=parent.members.find(x=>x.documentId===row.documentId),doc=parent.documents.find(x=>x.documentId===row.documentId);
    assert(m&&doc&&row.status==='verified'&&row.baselineOnly===true&&row.sendAllowed===false);
    assert(isDeepStrictEqual(row.member,{memberId:m.memberId,name:m.memberName,phone:m.memberPhone,memberGrade:m.memberGrade,inactive:m.inactive}));
    assert(row.nativeCheckedAt===m.checkedAt);
    const original=parent.rows.find(x=>x.documentId===row.documentId);
    if(original)assert(isDeepStrictEqual(row,original),'Do not change verified signed-field evidence');
    else{
      assert(row.documentName===doc.title&&row.checkedAt===m.checkedAt&&isDeepStrictEqual(row.completionProof,doc.completionProof)
        &&isDeepStrictEqual(row.profile,completionOnlySignupProfileV2(m.job)),'Completion-only subset must retain real provider/native evidence and no submitted answers');
    }
  }
  return subset.rows;
}

function exactKeys(value, keys) {
  assert(record(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), 'Unexpected source schema');
}

function instant(value) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'Invalid source timestamp');
  const ms = Date.parse(value);
  assert(Number.isFinite(ms) && new Date(value.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) === value.slice(0, 10), 'Invalid source timestamp');
  return ms;
}

function fresh(value, now) {
  const ms = instant(value);
  assert(now instanceof Date && Number.isFinite(now.getTime()) && now.getTime() - ms >= 0
    && now.getTime() - ms <= TWO_HOURS, 'Stale or future enrichment source');
  return ms;
}

function identity(value) {
  assert(typeof value.memberName === 'string' && value.memberName.trim().length >= 2 && value.memberName.length <= 40
    && !/[\x00-\x1f\x7f]/.test(value.memberName), 'Invalid full member name');
  assert(typeof value.memberPhone === 'string' && /^[+\d\s().-]+$/.test(value.memberPhone)
    && /^010\d{8}$/.test(phone(value.memberPhone)), 'Full native phone required');
  assert(typeof value.studiomateMemberId === 'string' && /^[1-9]\d*$/.test(value.studiomateMemberId), 'Native member ID required');
}

function completionFor(source, completion, now) {
  assert(record(completion) && completion.documentId === source.documentId && completion.selectedDocumentId === source.documentId
    && completion.templateId === TEMPLATE && completion.status === 'completed'
    && Array.isArray(completion.recipients) && completion.recipients.length === 1, 'Actual completed document proof required');
  const recipient = completion.recipients[0];
  assert(record(recipient) && typeof recipient.name === 'string' && recipient.name.length <= 40 && name(recipient.name) === name(source.memberName)
    && typeof recipient.phone === 'string' && /^[+\d\s().-]+$/.test(recipient.phone)
    && phone(recipient.phone) === phone(source.memberPhone), 'Completed document recipient mismatch');
  const completed = instant(completion.providerCompletedAt), observed = instant(completion.observedAt);
  assert(completed >= 946684800000 && completed <= observed && observed <= now.getTime(), 'Actual completion time unverified');
}

/** A baseline enriches an existing native member; it is never an invented registration or send. */
export function buildSignupEnrichmentPlan(row, { now = new Date() } = {}) {
  assert(record(row) && row.status === 'verified' && row.baselineOnly === true && row.sendAllowed === false, 'Verified baseline row required');
  const member = row.member, completion = row.completionProof;
  assert(record(member) && member.inactive === false && member.memberGrade === '강사회원', 'Active exact instructor required');
  const memberId = member.memberId;
  const canonical = { memberName: member.name, memberPhone: member.phone, studiomateMemberId: memberId };
  identity(canonical);
  assert(/^[a-f0-9]{32}$/.test(row.documentId || '') && row.documentId === completion?.documentId
    && typeof row.documentName === 'string' && row.documentName.trim() && row.documentName.length <= 1000, 'Document identity required');
  const checked = fresh(row.checkedAt, now), nativeChecked = fresh(row.nativeCheckedAt, now);
  assert(nativeChecked <= checked, 'Native source chronology mismatch');
  completionFor({ ...canonical, documentId: row.documentId }, completion, now);
  assert(fresh(completion.observedAt, now) <= checked, 'Completion proof chronology mismatch');
  exactKeys(row.profile, profileKeys(row.profile));
  assert(typeof row.profile.memberPhone === 'string' && /^[+\d\s().-]+$/.test(row.profile.memberPhone)
    && typeof row.profile.memberName === 'string' && row.profile.memberName.length <= 40
    && phone(row.profile.memberPhone) === phone(member.phone), 'Signed profile identity mismatch');
  const sourceId = PREFIX + row.documentId;
  const source = { jobId: sourceId, source: BASELINE, baselineOnly: true, sendAllowed: false, status: 'done',
    registrationId: '', studioId: '5330', studiomateMemberId: memberId, memberName: member.name,
    memberPhone: phone(member.phone), documentId: row.documentId, documentName: row.documentName,
    submittedProfile: structuredClone(row.profile), completionProof: structuredClone(completion),
    profileNativeReadbackAt: row.nativeCheckedAt,
    sourceAuditHash: sha({ documentId: row.documentId, member, profile: row.profile, completion }) };
  parseSignupProfileV2(source.submittedProfile, source, source.documentId);
  const projection = signupV2Projection({ job: source, profile: source.submittedProfile, completion: source.completionProof, memberId, now });
  source.profileMemoJobId = projection.memoId;
  assert(row.profileMemoJobId == null || row.profileMemoJobId === projection.memoId, 'Row memo identity mismatch');
  return { source, projection: structuredClone(projection) };
}

function validatePlan(plan, now) {
  exactKeys(plan, ['source', 'projection']);
  exactKeys(plan.source, SOURCE_KEYS);
  exactKeys(plan.projection, ['memoId', 'content', 'profileUpdate', 'completionProof']);
  const source = plan.source;
  identity(source);
  assert(source.source === BASELINE && source.baselineOnly === true && source.sendAllowed === false
    && source.status === 'done' && source.registrationId === '' && source.studioId === '5330'
    && /^[a-f0-9]{32}$/.test(source.documentId || '') && source.jobId === PREFIX + source.documentId
    && source.profileMemoJobId === signupProfileV2Id(source.documentId)
    && typeof source.documentName === 'string' && source.documentName.trim()
    && /^[a-f0-9]{64}$/.test(source.sourceAuditHash || ''), 'Invalid baseline plan source');
  exactKeys(source.submittedProfile, profileKeys(source.submittedProfile));
  fresh(source.profileNativeReadbackAt, now);
  fresh(source.completionProof?.observedAt, now);
  completionFor(source, source.completionProof, now);
  const expected = signupV2Projection({ job: source, profile: source.submittedProfile,
    completion: source.completionProof, memberId: source.studiomateMemberId, now });
  assert(isDeepStrictEqual(expected, plan.projection), 'Projection differs from canonical completed source');
}

function sameMember(record, source) {
  assert(record?.studioId === '5330' && record.memberId === source.studiomateMemberId
    && name(record.memberName) === name(source.memberName), 'Existing member binding mismatch');
}

function existingMemoAndJob(memo, job, source, projection) {
  sameMember(memo, source); sameMember(job, source);
  assert(memo.memoId === projection.memoId && memo.memoType === 'member_note' && memo.visibility === 'manager_only'
    && memo.content === projection.content && (!memo.documentId || memo.documentId === source.documentId), 'Existing memo differs');
  assert(job.jobId === projection.memoId && job.source === 'instructor_member_eformsign'
    && job.studiomateMemberId === source.studiomateMemberId && phone(job.memberPhone) === source.memberPhone
    && job.writeMode === 'playwright' && job.content === projection.content
    && isDeepStrictEqual(job.profileUpdate, projection.profileUpdate), 'Existing profile job differs; never requeue');
}

function existingSource(existing, source, job, now) {
  assert(existing?.jobId === job.profileSourceJobId && existing.status === 'done' && existing.studioId === '5330'
    && existing.studiomateMemberId === source.studiomateMemberId && name(existing.memberName) === name(source.memberName)
    && phone(existing.memberPhone) === source.memberPhone && existing.documentId === source.documentId
    && existing.documentName === source.documentName && existing.profileMemoJobId === job.jobId
    && !existing.cancellation && !existing.externalOrderReviewRequired
    && !existing.claimToken && !existing.sendClaimToken && !existing.activeSendLease, 'Existing source differs');
  parseSignupProfileV2(existing.submittedProfile, existing, source.documentId);
  assert(isDeepStrictEqual(existing.submittedProfile, source.submittedProfile), 'Existing signed profile differs');
  completionFor(existing, existing.completionProof, now);
  assert(instant(existing.completionProof.providerCompletedAt) === instant(source.completionProof.providerCompletedAt), 'Existing completion time differs');
  const original = signupV2Projection({ job: existing, profile: existing.submittedProfile,
    completion: existing.completionProof, memberId: source.studiomateMemberId, registrationId: existing.registrationId,
    now: new Date(existing.completionProof.observedAt) });
  assert(original.content === job.content && isDeepStrictEqual(original.profileUpdate, job.profileUpdate), 'Existing source projection differs');
}

/** Uses only create operations after every required read. Existing work is validation-only. */
export async function applySignupEnrichmentPlan({ db, plan, stamp, apply = false }) {
  assert(typeof apply === 'boolean' && typeof db?.doc === 'function' && typeof db?.runTransaction === 'function');
  const copy = structuredClone(plan);
  validatePlan(copy, new Date());
  const { source, projection: p } = copy;
  const sourceRef = db.doc('eformsignInstructorMemberJobs/' + source.jobId);
  const memoRef = db.doc('memberMemos/' + p.memoId);
  const jobRef = db.doc('studiomateMemoWriteJobs/' + p.memoId);
  const result = status => ({ status, sourceId: source.jobId, jobId: p.memoId, documentId: source.documentId,
    memberId: source.studiomateMemberId,
    profileMode:source.submittedProfile.mode || 'verified_fields',
    birthDateSource: source.submittedProfile.mode==='completion_only'?'review':normalizeSignupBirthDateV2(source.submittedProfile.birthDateRaw).status,
    addressSource: source.submittedProfile.mode==='completion_only'?'review':normalizeSignupAddressV2(source.submittedProfile.addressRaw).status });
  return db.runTransaction(async tx => {
    validatePlan(copy, new Date());
    const [s, m, j] = await Promise.all([tx.get(sourceRef), tx.get(memoRef), tx.get(jobRef)]);
    if (s.exists || m.exists || j.exists) {
      assert(m.exists && j.exists, 'Partial existing enrichment requires review');
      const memo = m.data(), job = j.data();
      existingMemoAndJob(memo, job, source, p);
      if (s.exists) {
        const stored = s.data();
        assert(job.profileSourceJobId === source.jobId && job.registrationId === ''
          && stored.source === BASELINE && stored.baselineOnly === true && stored.sendAllowed === false
          && stored.registrationId === '' && /^[a-f0-9]{64}$/.test(stored.sourceAuditHash || '')
          && memo.source === 'instructor_signup_completion_v2' && memo.documentId === source.documentId,
        'Existing baseline binding differs');
        existingSource(stored, source, job, new Date());
      } else {
        assert(regularId(job.profileSourceJobId) && job.registrationId === job.profileSourceJobId, 'Unknown existing v2 source binding');
        const originalRef = db.doc('eformsignInstructorMemberJobs/' + job.profileSourceJobId);
        const registrationRef = db.doc('instructorLessonRegistrations/' + job.registrationId);
        const [original, registration] = await Promise.all([tx.get(originalRef), tx.get(registrationRef)]);
        assert(original.exists && registration.exists, 'Regular source or registration missing');
        const stored = original.data(), r = registration.data();
        assert(!stored.baselineOnly && stored.source !== BASELINE && stored.registrationId === job.registrationId
          && r.registrationId === job.registrationId && r.studioId === source.studioId
          && String(r.studiomateMemberId || r.evidence?.studiomateMemberId) === source.studiomateMemberId
          && phone(r.memberPhone) === source.memberPhone && name(r.memberName) === name(source.memberName)
          && !r.cancellation && !r.externalOrderReviewRequired
          && !['cancelled', 'canceled', 'rejected', 'cancellation_pending', 'cancellation_review'].includes(r.status),
        'Regular registration source mismatch');
        existingSource(stored, source, job, new Date());
      }
      return result('existing_preserved');
    }
    if (apply) {
      const timestamp = typeof stamp === 'function' ? stamp() : stamp;
      assert(timestamp != null && typeof timestamp.then !== 'function', 'Explicit synchronous timestamp required for creation');
      tx.create(sourceRef, { ...source, completedAt: source.completionProof.providerCompletedAt, createdAt: timestamp, updatedAt: timestamp });
      tx.create(memoRef, { memoId: p.memoId, studioId: source.studioId, memberId: source.studiomateMemberId,
        memberName: source.memberName, memoType: 'member_note', visibility: 'manager_only', content: p.content,
        syncStatus: 'pending', profileSyncStatus: 'pending', source: 'instructor_signup_completion_v2',
        documentId: source.documentId, createdAt: timestamp, updatedAt: timestamp });
      tx.create(jobRef, { jobId: p.memoId, source: 'instructor_member_eformsign', profileSourceJobId: source.jobId,
        registrationId: '', studioId: source.studioId, memberId: source.studiomateMemberId,
        studiomateMemberId: source.studiomateMemberId, memberName: source.memberName, memberPhone: source.memberPhone,
        status: 'pending', writeMode: 'playwright', profileUpdate: p.profileUpdate, content: p.content,
        attempts: 0, maxAttempts: 3, createdAt: timestamp, updatedAt: timestamp });
    }
    return result(apply ? 'queued' : 'planned');
  });
}
