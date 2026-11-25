import {createMemberAccounts,STUDIO_ID} from './accounts.mjs';
import {createSupabaseCurrentPassLookup,createSupabasePassSessionIssuer} from './current-pass-snapshot.mjs';
import {createMemberHttpHandler} from './http.mjs';
import {createRemoteOtp} from './remote-otp.mjs';

const trustedBinding=(value,time)=>value?.identityVerified===true&&value.active===true&&value.signupComplete===true
  &&value.studioId===STUDIO_ID&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>time;

export function createHostedPassLookup({accounts,issuer,reader,now=Date.now}){
  return async function lookup(token,scope){
    if(scope!=='cards')return null;
    const before=await accounts.resolveSession(token);
    if(!trustedBinding(before,now()))return null;
    await issuer.issue({token,binding:before});
    const snapshot=await reader(token,scope);
    if(!snapshot)return null;
    // A revocation during the snapshot lookup must suppress the response.
    const after=await accounts.resolveSession(token);
    if(!trustedBinding(after,now())||after.accountId!==before.accountId||after.memberId!==before.memberId
      ||after.revision!==before.revision||after.expiresAt!==before.expiresAt){
      await issuer.revoke(token);
      return null;
    }
    const expiresAt=Math.min(snapshot.expiresAt,after.expiresAt);
    return expiresAt>now()?{...snapshot,expiresAt}:null;
  };
}

// No native browser or Mac mini credentials are accepted by this composition.
// Only server-held, separately scoped database clients may supply the queries.
export function createHostedHelpMemberService({enabled=false,store,authority,remoteOtp,issuerQuery,readerQuery,
  memberKeySecret,now=Date.now,verify}={}){
  if(enabled!==true)return Object.freeze({handle:createMemberHttpHandler()});
  if(typeof store?.transaction!=='function'||typeof store?.read!=='function'
    ||typeof authority?.verifyEnrollment!=='function'||typeof authority?.confirmBinding!=='function'
    ||typeof remoteOtp?.resolveRecipient!=='function'||typeof remoteOtp?.sendCode!=='function'
    ||issuerQuery===readerQuery)throw Error('Independently scoped hosted member services are required');

  const issuer=createSupabasePassSessionIssuer({query:issuerQuery,secret:memberKeySecret,now});
  const reader=createSupabaseCurrentPassLookup({query:readerQuery,now});
  let otp;
  const accounts=createMemberAccounts({store,authority,now,verify,allowCloudBinding:true,
    confirmRemoteEnrollment:input=>otp.matches(input)});
  otp=createRemoteOtp({...remoteOtp,store,accounts,now,allowCloudRecipient:true});
  const lookup=createHostedPassLookup({accounts,issuer,reader,now});
  return Object.freeze({
    handle:createMemberHttpHandler({enabled:true,accounts,lookup,otp,onSessionClosed:token=>issuer.revoke(token)}),
    issueInvite:reference=>accounts.issueInvite(reference)
  });
}
