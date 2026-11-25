import {cloudSourceIsFresh,digest,isToken,STUDIO_ID} from './accounts.mjs';

const memberId=value=>typeof value==='string'&&/^[1-9]\d{0,15}$/u.test(value);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const identityInput=value=>value?.studioId===STUDIO_ID&&memberId(value.memberId)&&revision(value.revision);

// Both loaders must read the canonical private authority without a cache. The
// operator reference is not an API parameter on the public Help origin.
export function createCloudEnrollmentAuthority({loadEnrollment,loadCurrentBinding,now=Date.now}={}){
  if(typeof loadEnrollment!=='function'||typeof loadCurrentBinding!=='function')throw Error('Trusted enrollment loaders required');

  async function binding(request){
    if(!identityInput(request)||request.signal?.aborted)return null;
    const {studioId,memberId,revision,signal}=request;
    const value=await loadCurrentBinding({studioId,memberId,signal});
    const checkedAt=now();
    if(signal?.aborted||!identityInput(value)||value.memberId!==memberId||value.revision!==revision
      ||value.authority!=='verified_studiomate_in_person_signup'||value.signupComplete!==true
      ||value.active!==true||value.revoked!==false||value.registeredContactVerified!==true
      ||!cloudSourceIsFresh(value.sourceObservedAt,checkedAt))return null;
    return {value,checkedAt};
  }
  async function confirmBinding(request){
    const checked=await binding(request);
    if(!checked)return null;
    const {value,checkedAt}=checked;
    return {authority:'verified_cloud_member_binding',studioId:STUDIO_ID,memberId:value.memberId,revision:value.revision,
      verificationMethod:'in_person_signup',inPersonVerified:true,signupComplete:true,active:true,
      checkedAt,sourceObservedAt:value.sourceObservedAt};
  }
  return Object.freeze({
    async verifyEnrollment(reference,{studioId,signal}={}){
      if(studioId!==STUDIO_ID||!isToken(reference)||signal?.aborted)return null;
      const intent=await loadEnrollment({referenceDigest:digest(reference),signal});
      if(!identityInput(intent)||intent.authority!=='approved_help_enrollment'||intent.approved!==true
        ||!Number.isSafeInteger(intent.expiresAt)||intent.expiresAt<=now())return null;
      return confirmBinding({studioId,memberId:intent.memberId,revision:intent.revision,signal});
    },
    confirmBinding,
    async resolveRecipient(request){
      const checked=await binding(request);
      if(!checked)return null;
      const {value,checkedAt}=checked;
      if(!/^010\d{8}$/u.test(value.phone??'')||!cloudSourceIsFresh(value.sourceObservedAt,checkedAt,60*60_000))return null;
      return {authority:'verified_cloud_registered_contact',studioId:STUDIO_ID,memberId:value.memberId,
        revision:value.revision,verified:true,checkedAt,sourceObservedAt:value.sourceObservedAt,phone:value.phone};
    }
  });
}
