import {createMemberAccounts} from './accounts.mjs';
import {openMemberStore} from './store.mjs';
import {createOwnLookup,createStudioMateOwnReader} from './studio-own.mjs';
import {createMemberHttpHandler} from './http.mjs';
import {createRemoteOtp} from './remote-otp.mjs';

export function createPrivateMemberPilot({
  enabled=false,storePath,authority,nativeReader,loadExpectedIdentity,classifyTicket,now=Date.now,remoteOtp
}={}){
  if(enabled!==true)return {handle:createMemberHttpHandler(),close(){}};
  if(typeof authority?.verifyEnrollment!=='function'||typeof authority?.confirmBinding!=='function'
    ||!remoteOtp&&typeof authority?.confirmRegistrationEnrollment!=='function'
    ||typeof nativeReader?.getOverview!=='function'||typeof nativeReader?.getBookings!=='function'
    ||typeof loadExpectedIdentity!=='function'||typeof classifyTicket!=='function'){
    throw Error('Independently scoped member sources are required');
  }
  const store=openMemberStore(storePath);
  let otp;
  const accounts=createMemberAccounts({store,authority,now,confirmRemoteEnrollment:remoteOtp?(input=>otp.matches(input)):undefined});
  try{if(remoteOtp)otp=createRemoteOtp({...remoteOtp,store,accounts,now});}catch(error){store.close();throw error;}
  const readOwn=createStudioMateOwnReader({reader:nativeReader,loadExpectedIdentity,classifyTicket,now});
  const lookup=createOwnLookup({accounts,readOwn,now});
  return Object.freeze({
    handle:createMemberHttpHandler({enabled:true,accounts,lookup,otp}),
    issueInvite:reference=>accounts.issueInvite(reference),
    close:()=>store.close()
  });
}
