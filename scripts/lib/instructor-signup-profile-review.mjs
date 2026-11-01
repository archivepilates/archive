import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertSignupProfileV2Source} from './instructor-signup-profile-v2.mjs';
import {decideSignupProfileFieldV2,normalizeSignupAddressV2} from './instructor-signup-profile-v2-policy.mjs';
import {splitSignupPostalAddress,signupPostalAddressKey} from './instructor-signup-profile-v2-writer.mjs';
import {deriveInstructorLessonRegistrationState,normalizeInstructorLessonName as name,
  normalizeInstructorLessonPhone as phone,isInstructorMemberGrade} from './instructor-lesson-registration-contract.mjs';

const clean=value=>String(value||'').normalize('NFC').replace(/\s+/g,' ').trim();
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const profileSourceHash = sha;
export function nativeProfileReviewHash(native) {
  return sha([String(native.memberId),name(native.name),phone(native.phone),native.birthDate,native.address,native.detail]);
}
export function profileReviewApprovalHash({job,mode,native}) {
  return sha([job.jobId,job.registrationId,job.profileUpdate?.documentId,job.profileUpdate?.sourceHash,
    sha(job.profileUpdate),mode,nativeProfileReviewHash(native)]);
}
const safeCode=value=>typeof value==='string'&&/^[a-z_]{1,100}$/.test(value)?value:null;
const hashValue=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:undefined;
function priorBirthProof(value={}) {
  const result={status:'already_equal'};
  if(hashValue(value.expectedHash))result.expectedHash=value.expectedHash;
  const r=value.resolution;
  if(r?.policy==='yy_kst_current_year_v1'&&['native_full_match','current_year_rule'].includes(r.source)
    &&typeof r.referenceAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.referenceAt)
    &&Number.isFinite(Date.parse(r.referenceAt))&&new Date(r.referenceAt).toISOString()===r.referenceAt)
    result.resolution={policy:r.policy,source:r.source,referenceAt:r.referenceAt};
  return result;
}
export function planSignupProfileReviewResolution({job,source,registration,memo,proof,approval,now=new Date()}={}) {
  assert(now instanceof Date&&Number.isFinite(now.getTime()),'INVALID_REVIEW_CLOCK');
  assertSignupProfileV2Source(job,source,registration);
  assert(job.status==='done'&&job.memoWriteState==='verified'&&job.profileSyncStatus==='review_required'
    &&!job.claimToken&&!job.failureCode,'COMPLETED_MEMO_REVIEW_REQUIRED');
  assert(job.profileUpdate.mode==null&&registration.steps?.eformsign?.status==='verified'
    &&registration.steps?.memo?.status==='review_required'&&!registration.lastError,'FIELD_REVIEW_SCOPE_CHANGED');
  assert(registration.status==='action_required'&&!registration.cancellation&&!registration.cancellationJobId
    &&!registration.refunded&&!registration.refund,'CLOSED_REGISTRATION');
  assert(registration.evidence?.eformsignDocumentId===source.documentId
    &&[registration.steps.eformsign.documentId].every(value=>value==null||value===source.documentId)
    &&[registration.steps.eformsign.jobId,registration.evidence?.eformsignJobId].every(value=>value==null||value===source.jobId)
    &&[registration.steps.memo.jobId,registration.steps.memo.memoJobId,registration.steps.memo.profileMemoJobId,
      registration.evidence?.memoJobId,registration.evidence?.profileMemoJobId].every(value=>value==null||value===job.jobId),
    'REGISTRATION_STEP_BINDING_CHANGED');
  assert(memo?.memoId===job.jobId&&memo.studioId==='5330'&&String(memo.memberId)===String(job.memberId)
    &&memo.content===job.content&&memo.syncStatus==='synced','CANONICAL_MEMO_NOT_SYNCED');
  assert(proof?.kind==='studiomate_live_editor_readonly'&&proof.jobId===job.jobId
    &&proof.documentId===job.profileUpdate.documentId&&proof.profileUpdateHash===sha(job.profileUpdate)
    &&proof.memberWrites===0,'NATIVE_PROOF_BINDING_REQUIRED');
  const checked=Date.parse(proof.checkedAt),n=proof.native;
  assert(Number.isFinite(checked)&&checked<=now.getTime()&&now.getTime()-checked<=5*60000,'STALE_NATIVE_PROOF');
  assert(n&&String(n.memberId)===String(job.memberId)&&name(n.name)===name(job.memberName)
    &&/^010\d{8}$/.test(phone(n.phone))&&phone(n.phone)===phone(job.memberPhone)&&isInstructorMemberGrade(n.memberGrade)
    &&['birthDate','address','detail'].every(key=>typeof n[key]==='string'),'EXACT_NATIVE_IDENTITY_REQUIRED');
  assert(approval?.confirmed===true&&typeof approval.ref==='string'&&/^[a-z0-9:_-]{1,180}$/.test(approval.ref)
    &&approval.nativeProfileHash===nativeProfileReviewHash(n)
    &&approval.operationHash===profileReviewApprovalHash({job,mode:approval.mode,native:n}),'EXACT_OPERATOR_APPROVAL_REQUIRED');
  const approved=Date.parse(approval.confirmedAt);
  assert(Number.isFinite(approved)&&approved<=now.getTime()&&now.getTime()-approved<=24*3600000,'STALE_OPERATOR_APPROVAL');
  assert(decideSignupProfileFieldV2({field:'birthDate',current:n.birthDate,expected:job.profileUpdate.birthDateRaw,now})==='already_equal',
    'BIRTH_DATE_MISMATCH');
  assert(normalizeSignupAddressV2(n.address).status==='verified','NATIVE_ADDRESS_REQUIRED');
  const parts=splitSignupPostalAddress(job.profileUpdate.addressRaw);
  const signedMatch=!!parts&&signupPostalAddressKey(n.address)===signupPostalAddressKey(parts.base)&&clean(n.detail)===clean(parts.detail);
  if(approval.mode==='signed_fields_equal')assert(signedMatch,'SIGNED_ADDRESS_MISMATCH');
  else assert(approval.mode==='operator_confirmed_current_address','UNSUPPORTED_REVIEW_DECISION');
  const review={version:1,mode:approval.mode,approvalRef:approval.ref,approvedAt:approval.confirmedAt,
    nativeCheckedAt:proof.checkedAt,nativeProfileHash:nativeProfileReviewHash(n),resolvedAt:now.toISOString(),
    signedAddressMatches:signedMatch,memberId:String(job.memberId),documentId:job.profileUpdate.documentId,
    previousAddress:{status:safeCode(job.profileStatus?.address?.status),reason:safeCode(job.profileStatus?.address?.reason),
      stage:safeCode(job.profileStatus?.address?.stage)}};
  const beforeFieldHashes=Object.fromEntries(['birthDate','address','detail','protectedHash']
    .filter(key=>hashValue(job.profileStatus?.beforeFieldHashes?.[key])).map(key=>[key,job.profileStatus.beforeFieldHashes[key]]));
  const profileStatus={version:2,checkedAt:proof.checkedAt,...(Object.keys(beforeFieldHashes).length?{beforeFieldHashes}:{}),
    birthDate:priorBirthProof(job.profileStatus?.birthDate),
    address:{status:'verified',verificationBasis:signedMatch?'native_signed_fields_equal':'operator_confirmed_native_profile',
      sourceAddressHash:sha(job.profileUpdate.addressRaw),nativeAddressHash:sha([n.address,n.detail]),operatorReview:review}};
  const detail=signedMatch?'가입서 완료 메모·현재 회원정보 일치 재확인':'가입서 완료 메모 확인 · 운영자가 직접 입력한 현재 주소 보존 승인';
  const memoBindings=Object.fromEntries(['jobId','memoJobId','profileMemoJobId']
    .filter(key=>Object.hasOwn(registration.steps.memo,key))
    .map(key=>[key,registration.steps.memo[key]===job.jobId?job.jobId:null]));
  const step={...memoBindings,status:'verified',label:'가입서 정보 반영',detail};
  const state=deriveInstructorLessonRegistrationState({mode:registration.mode,steps:{...registration.steps,memo:step}});
  return {jobPatch:{profileStatus,profileSyncStatus:'synced',operatorProfileReview:review},
    memoPatch:{profileStatus,profileSyncStatus:'synced'},
    registrationPatch:{status:state.status,nextAction:state.nextAction,'steps.memo':step,
      profileEnrichment:{status:'synced',fields:profileStatus,operatorReview:review}},review};
}
