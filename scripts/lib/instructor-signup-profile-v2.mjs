import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE,normalizeInstructorLessonName as name,normalizeInstructorLessonPhone as phone } from './instructor-lesson-registration-contract.mjs';
import { SIGNUP_PROFILE_FIELDS } from './instructor-signup-profile.mjs';
import { assertOrderContactBinding } from './instructor-signup-order-identity.mjs';

export const signupProfileV2Id = doc => {assert(/^[a-f0-9]{32}$/.test(doc));return `instructor_member_completion_${doc}`;};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const sha=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function completionOnlySignupProfileV2(job) {
  return {version:2,mode:'completion_only',documentId:job.documentId,templateId:TEMPLATE,
    memberName:job.memberName,memberPhone:job.memberPhone,fieldReviewReason:'signed_fields_unverified'};
}
export function parseSignupProfileV2(profile,job,documentId) {
  assert(profile?.version===2&&documentId===job.documentId&&profile.documentId===documentId&&/^[a-f0-9]{32}$/.test(documentId)
    &&profile.templateId===TEMPLATE&&job.studioId==='5330'&&/^[1-9]\d*$/.test(String(job.studiomateMemberId)));
  assert(name(profile.memberName)===name(job.memberName)&&/^010\d{8}$/.test(phone(profile.memberPhone)));
  if(profile.mode==='completion_only'){
    assert(phone(profile.memberPhone)===phone(job.memberPhone)&&profile.fieldReviewReason==='signed_fields_unverified'
      &&Object.keys(profile).sort().join(',')===['version','mode','documentId','templateId','memberName','memberPhone','fieldReviewReason'].sort().join(','));
    return profile;
  }
  assert(profile.mode==null,'Unknown signed profile mode');
  if(profile.orderContactBinding) assertOrderContactBinding(profile.orderContactBinding,job,profile.memberPhone);
  else assert(phone(profile.memberPhone)===phone(job.memberPhone),'Signed form identity mismatch');
  for(const key of ['birthDateRaw','addressRaw','career','affiliation']) assert(typeof profile[key]==='string'&&profile[key].length<=1000);
  return profile;
}
export async function readCompletedSignupProfileV2(page,job,evidence,{verifyOrderContact}={}) {
  const url=new URL(evidence.href,'https://www.eformsign.com');
  assert(evidence.found&&/^(?:완료|Completed)\s/i.test(evidence.text)&&evidence.documentId===job.documentId
    &&url.origin==='https://www.eformsign.com'&&url.pathname==='/eform/document/view_service.html'
    &&url.searchParams.get('document_id')===job.documentId&&url.searchParams.get('form_id')===TEMPLATE);
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('#viewer_frame').waitFor({state:'attached',timeout:30000});
  const frame=page.frameLocator('#viewer_frame');
  await frame.locator('#'+SIGNUP_PROFILE_FIELDS.memberName).waitFor({state:'visible',timeout:30000});
  const viewer=await(await page.locator('#viewer_frame').elementHandle()).contentFrame();
  await viewer.waitForFunction(({id,expected})=>String(document.getElementById(id)?.value||'').replace(/\s+/g,'').trim()===expected,
    {id:SIGNUP_PROFILE_FIELDS.memberName,expected:name(job.memberName).replace(/\s+/g,'')},{timeout:20000});
  const fields={};for(const [key,id]of Object.entries(SIGNUP_PROFILE_FIELDS)) {
    const field=frame.locator('#'+id);await field.waitFor({state:'visible',timeout:30000});assert(await field.count()===1);fields[key]=await field.inputValue();
  }
  const binding=phone(fields.memberPhone)!==phone(job.memberPhone)&&typeof verifyOrderContact==='function'?await verifyOrderContact(fields):undefined;
  return parseSignupProfileV2({version:2,documentId:job.documentId,templateId:TEMPLATE,memberName:name(fields.memberName),memberPhone:phone(fields.memberPhone),
    birthDateRaw:fields.birthDate,addressRaw:fields.address,career:fields.career,affiliation:fields.affiliation,
    ...(binding?{orderContactBinding:binding}:{})},job,job.documentId);
}
export function signupV2Projection({job,profile,completion,memberId,registrationId='',now=new Date()}) {
  parseSignupProfileV2(profile,job,job.documentId);
  assert(!registrationId || registrationId===job.registrationId,'Completion registration binding mismatch');
  assert(completion?.status==='completed'&&completion.documentId===job.documentId&&completion.templateId===TEMPLATE
    &&completion.recipients?.length===1&&name(completion.recipients[0].name)===name(job.memberName)
    &&phone(completion.recipients[0].phone)===phone(job.memberPhone)&&String(memberId)===String(job.studiomateMemberId));
  const completed=Date.parse(completion.providerCompletedAt),observed=Date.parse(completion.observedAt);
  assert(Number.isFinite(completed)&&Number.isFinite(observed)&&completed<=observed&&observed<=now.getTime()+60000);
  // This projection binds signed-document and canonical identity evidence. The native
  // member profile is independently reopened by the existing writer before any change.
  const kst=new Date(completed+9*3600000).toISOString().replace('T',' ').replace(/Z$/,'');
  const content=['[ARCHIVE PILATES 강사회원 가입서 완료]',`완료 시각: ${kst} KST`,`문서 ID: ${job.documentId}`].join('\n');
  return {memoId:signupProfileV2Id(job.documentId),content,profileUpdate:{version:2,documentId:job.documentId,
    ...(profile.mode==='completion_only'?{mode:'completion_only',fieldReviewReason:profile.fieldReviewReason}
      :{birthDateRaw:profile.birthDateRaw,addressRaw:profile.addressRaw}),sourceHash:sha(profile)},completionProof:completion};
}
export function assertSignupProfileV2Source(job,source,registration) {
  const profile=source?.submittedProfile;
  assert(source?.status==='done'&&job.source==='instructor_member_eformsign'&&job.profileUpdate?.version===2
    &&source.jobId&&job.profileSourceJobId===source.jobId
    &&job.jobId===signupProfileV2Id(source.documentId)&&source.profileMemoJobId===job.jobId
    &&source.studioId==='5330'&&job.studioId===source.studioId
    &&String(job.memberId)===String(source.studiomateMemberId)&&String(job.studiomateMemberId)===String(source.studiomateMemberId)
    &&phone(job.memberPhone)===phone(source.memberPhone)&&name(job.memberName)===name(source.memberName));
  parseSignupProfileV2(profile,source,source.documentId);
  assert(Date.now()-Date.parse(source.completionProof?.observedAt)>=0&&Date.now()-Date.parse(source.completionProof?.observedAt)<=24*3600000,
    'Completed document source needs a fresh readback');
  assert(job.profileUpdate.documentId===source.documentId&&job.profileUpdate.sourceHash===sha(profile)
    &&job.profileUpdate.birthDateRaw===profile.birthDateRaw&&job.profileUpdate.addressRaw===profile.addressRaw);
  const original=signupV2Projection({job:source,profile,completion:source.completionProof,memberId:job.memberId,
    registrationId:source.registrationId||'',now:new Date(source.completionProof.observedAt)});
  assert(job.content===original.content&&sha(job.profileUpdate)===sha(original.profileUpdate));
  if(source.baselineOnly===true) assert(source.source==='completed_signup_profile_baseline_v2'&&source.sendAllowed===false
    &&source.registrationId===''&&job.registrationId==='');
  else assert(source.registrationId&&job.registrationId===source.registrationId&&registration?.registrationId===source.registrationId
    &&registration.studioId===job.studioId&&!registration.cancellation
    &&String(registration.studiomateMemberId||registration.evidence?.studiomateMemberId)===String(job.memberId)
    &&phone(registration.memberPhone)===phone(job.memberPhone)&&name(registration.memberName)===name(job.memberName));
  return profile;
}
