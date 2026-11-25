import {createHash,randomBytes} from 'node:crypto';
import * as webauthn from '@simplewebauthn/server';

export const ORIGIN='https://help.archivepilates.com';
export const RP_ID='help.archivepilates.com';
export const STUDIO_ID='5330';
export const SESSION_MS=20*60_000;
const CHALLENGE_MS=2*60_000, INVITE_MS=10*60_000, PROOF_MS=30_000;
const token=()=>randomBytes(32).toString('base64url');
export const isToken=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s);
const credentialId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{16,512}$/.test(s);
export const digest=s=>createHash('sha256').update(s).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const versionKey=account=>digest(account.id+':'+account.revision);
const unavailable=Object.freeze({ok:false});

function verificationMethod(proof){
  if(proof?.verificationMethod==='in_person_signup'&&proof.inPersonVerified===true)return 'in_person_signup';
  if(proof?.verificationMethod==='registered_contact'&&proof.contactVerified===true)return 'registered_contact';
  return null;
}

function proofValid(proof,started,now,allowCloudBinding){
  const native=proof?.authority==='verified_member_enrollment'&&proof.nativeVerified===true;
  const cloud=allowCloudBinding&&proof?.authority==='verified_cloud_member_binding'
    &&cloudSourceIsFresh(proof.sourceObservedAt,now);
  return (native||cloud)&&proof.signupComplete===true
    &&proof.active===true&&verificationMethod(proof)!==null&&proof.studioId===STUDIO_ID
    &&typeof proof.memberId==='string'&&/^[1-9]\d{0,15}$/.test(proof.memberId)
    &&typeof proof.revision==='string'&&/^[a-f0-9]{64}$/.test(proof.revision)
    &&Number.isSafeInteger(proof.checkedAt)&&proof.checkedAt>=started&&proof.checkedAt<=now
    &&now-proof.checkedAt<=PROOF_MS;
}

export function cloudSourceIsFresh(observed,now,maxAge=26*60*60_000){
  return Number.isSafeInteger(observed)&&observed<=now&&now-observed<maxAge;
}

export function createMemberAccounts({store,authority,now=Date.now,verify=webauthn,confirmRemoteEnrollment,allowCloudBinding=false}){
  const lookup=(kind,key)=>store.read(kind,digest(key),now());
  const accountFor=id=>lookup('binding',id);
  async function proof(call){
    const started=now();
    const result=await call({studioId:STUDIO_ID,requestedAt:started,signal:AbortSignal.timeout(8000)});
    return proofValid(result,started,now(),allowCloudBinding)?result:null;
  }
  async function isCurrent(account){
    if(!account)return false;
    const result=await proof(options=>authority.confirmBinding({
      ...options,memberId:account.memberId,revision:account.revision
    }));
    return result?.memberId===account.memberId&&result.revision===account.revision
      &&verificationMethod(result)===account.verificationMethod&&same(await accountFor(account.id),account);
  }
  async function enrollmentBindsRegistration(account,preAuth,inviteDigest,enrollmentDigest){
    const stepDigest=digest(preAuth);
    if(confirmRemoteEnrollment){
      return await confirmRemoteEnrollment({account,stepDigest,inviteDigest,enrollmentDigest})===true&&await isCurrent(account);
    }
    const result=await proof(options=>authority.confirmRegistrationEnrollment({
      ...options,memberId:account.memberId,revision:account.revision,stepDigest,inviteDigest,enrollmentDigest
    }));
    return result?.memberId===account.memberId&&result.revision===account.revision
      &&verificationMethod(result)===account.verificationMethod
      &&result.stepDigest===stepDigest&&result.inviteDigest===inviteDigest&&result.enrollmentDigest===enrollmentDigest
      &&(account.verificationMethod==='in_person_signup'?result.staffConfirmedDevice===true:result.contactControlVerified===true)
      &&same(await accountFor(account.id),account);
  }
  function allowPreauth(challenge){
    return store.transaction(async tx=>{
      const next=await tx.read('challenge',digest(challenge.preAuth),now());
      if(!next||next.kind!==challenge.kind)return null;
      await tx.remove('challenge',digest(challenge.preAuth));
      return next;
    });
  }
  const setChallenge=(preAuth,record,expires)=>store.transaction(async tx=>{
    const key=digest(preAuth), operation=token();
    await tx.put('flow',key,{operation},expires);
    await tx.put('challenge',key,{...record,operation},expires);
  });
  const flowMatches=async(tx,pre,auth)=>(await tx.read('flow',digest(pre),now()))?.operation===auth.operation;
  async function newSession(tx,account,preAuth){
    const opaque=token(), expiresAt=now()+SESSION_MS;
    await tx.put('session',digest(opaque),{accountId:account.id,revision:account.revision,expiresAt},expiresAt);
    await tx.remove('flow',digest(preAuth));
    return {ok:true,token:opaque,expiresAt};
  }

  return Object.freeze({
    async resolveOpenInvitation(invitation){
      if(!isToken(invitation))return null;
      const inv=await lookup('invite',invitation), account=inv&&await accountFor(inv.accountId), inviteDigest=digest(invitation);
      if(!account||account.revision!==inv.revision||!await isCurrent(account)||!same(await lookup('invite',invitation),inv))return null;
      return {account,inviteDigest,expiresAt:inv.expiresAt};
    },
    // Operator-side only. There must be no public route accepting this reference.
    async issueInvite(reference){
      const result=await proof(options=>authority.verifyEnrollment(reference,options));
      if(!result)return null;
      return store.transaction(async tx=>{
        const nowMs=now();
        if(nowMs-result.checkedAt>PROOF_MS)return null;
        const key=digest(STUDIO_ID+':'+result.memberId);
        const id=(await tx.read('member-index',key,nowMs))?.id??token();
        const old=await tx.read('binding',digest(id),nowMs);
        if(old&&(old.memberId!==result.memberId||old.studioId!==STUDIO_ID))return null;
        const method=verificationMethod(result);
        if(old&&old.revision===result.revision&&old.verificationMethod!==method)return null;
        // Slow, older observations cannot overwrite a newer revision.
        if(old&&old.revision!==result.revision&&old.checkedAt>=result.checkedAt)return null;
        const account={id,studioId:STUDIO_ID,memberId:result.memberId,revision:result.revision,verificationMethod:method,
          checkedAt:old?.revision===result.revision?old.checkedAt:result.checkedAt};
        const index=versionKey(account);
        if(await tx.read('credential-index',index,nowMs)||await tx.read('invite-index',index,nowMs))return null;
        await tx.put('binding',digest(id),account);
        await tx.put('member-index',key,{id});
        const secret=token(), expiresAt=nowMs+INVITE_MS;
        await tx.put('invite',digest(secret),{accountId:id,revision:account.revision,expiresAt},expiresAt);
        await tx.put('invite-index',index,{digest:digest(secret)},expiresAt);
        return {token:secret,expiresAt};
      });
    },
    async registrationOptions(preAuth,invitation,enrollmentReceipt){
      if(!isToken(preAuth)||!isToken(invitation)||!isToken(enrollmentReceipt))return unavailable;
      const inv=await lookup('invite',invitation), account=inv&&await accountFor(inv.accountId);
      const inviteDigest=digest(invitation), enrollmentDigest=digest(enrollmentReceipt);
      if(!account||account.revision!==inv.revision||!await enrollmentBindsRegistration(account,preAuth,inviteDigest,enrollmentDigest))return unavailable;
      const userID=randomBytes(32);
      const options=await verify.generateRegistrationOptions({rpName:'ARCHIVE PILATES',rpID:RP_ID,
        userName:'archive-'+userID.toString('hex'),userDisplayName:'ARCHIVE PILATES 회원',
        userID,attestationType:'none',timeout:CHALLENGE_MS,
        authenticatorSelection:{residentKey:'required',userVerification:'required'}});
      const expiresAt=Math.min(inv.expiresAt,now()+CHALLENGE_MS);
      if(expiresAt<=now())return unavailable;
      await setChallenge(preAuth,{kind:'registration',challenge:options.challenge,inviteDigest,enrollmentDigest,
        account,userHandle:userID.toString('base64url')},expiresAt);
      return {ok:true,options};
    },
    async register(preAuth,response){
      if(!isToken(preAuth)||!credentialId(response?.id))return unavailable;
      const intent=await allowPreauth({preAuth,kind:'registration'});
      if(!intent)return unavailable;
      const {account}=intent;
      const good=await verify.verifyRegistrationResponse({response,expectedChallenge:intent.challenge,
        expectedOrigin:ORIGIN,expectedRPID:RP_ID,requireUserVerification:true});
      const c=good.registrationInfo?.credential;
      if(!good.verified||!c||c.id!==response.id||!Number.isSafeInteger(c.counter)||c.counter<0
        ||!await enrollmentBindsRegistration(account,preAuth,intent.inviteDigest,intent.enrollmentDigest))return unavailable;
      return store.transaction(async tx=>{
        const t=now(), stored=await tx.read('invite',intent.inviteDigest,t), id=digest(c.id), index=versionKey(account);
        if(!await flowMatches(tx,preAuth,intent)||!same(await tx.read('binding',digest(account.id),t),account)
          ||stored?.accountId!==account.id||stored.revision!==account.revision
          ||(await tx.read('invite-index',index,t))?.digest!==intent.inviteDigest
          ||await tx.read('credential',id,t)||await tx.read('credential-index',index,t))return unavailable;
        await tx.remove('invite',intent.inviteDigest);
        await tx.remove('invite-index',index);
        await tx.put('credential',id,{accountId:account.id,revision:account.revision,id:c.id,
          userHandle:intent.userHandle,counter:c.counter,publicKey:Buffer.from(c.publicKey).toString('base64url')});
        await tx.put('credential-index',index,{id});
        return newSession(tx,account,preAuth);
      });
    },
    async loginOptions(preAuth){
      if(!isToken(preAuth))return unavailable;
      const options=await verify.generateAuthenticationOptions({rpID:RP_ID,timeout:CHALLENGE_MS,userVerification:'required'});
      await setChallenge(preAuth,{kind:'login',challenge:options.challenge},now()+CHALLENGE_MS);
      return {ok:true,options};
    },
    async login(preAuth,response){
      if(!isToken(preAuth)||!credentialId(response?.id))return unavailable;
      const intent=await allowPreauth({preAuth,kind:'login'}), current=await lookup('credential',response.id);
      const account=current&&await accountFor(current.accountId);
      if(!intent||!account||account.revision!==current.revision||response.response?.userHandle!==current.userHandle)return unavailable;
      const good=await verify.verifyAuthenticationResponse({response,expectedChallenge:intent.challenge,
        expectedOrigin:ORIGIN,expectedRPID:RP_ID,requireUserVerification:true,
        credential:{id:current.id,counter:current.counter,publicKey:Buffer.from(current.publicKey,'base64url')}});
      const counter=good.authenticationInfo?.newCounter;
      if(!good.verified||!Number.isSafeInteger(counter)||counter<current.counter||!await isCurrent(account))return unavailable;
      return store.transaction(async tx=>{
        const t=now(), id=digest(current.id);
        if(!await flowMatches(tx,preAuth,intent)||!same(await tx.read('binding',digest(account.id),t),account)
          ||!same(await tx.read('credential',id,t),current))return unavailable;
        await tx.put('credential',id,{...current,counter});
        return newSession(tx,account,preAuth);
      });
    },
    async resolveSession(session){
      if(!isToken(session))return null;
      const found=await lookup('session',session), account=found&&await accountFor(found.accountId);
      if(!account||account.revision!==found.revision||!await isCurrent(account)||!same(await lookup('session',session),found))return null;
      return {accountId:account.id,revision:account.revision,studioId:account.studioId,memberId:account.memberId,
        active:true,signupComplete:true,identityVerified:true,verificationMethod:account.verificationMethod,expiresAt:found.expiresAt};
    },
    logout(preAuth,session){
      return store.transaction(async tx=>{
        if(isToken(preAuth)){
          await tx.remove('challenge',digest(preAuth));
          await tx.remove('flow',digest(preAuth));
        }
        if(isToken(session))await tx.remove('session',digest(session));
      });
    },
    allowRequest(preAuth,route){
      return store.transaction(async tx=>{
        const t=now(), budgets=[[digest('help-member-global'),90]];
        if(isToken(preAuth))budgets.push([digest('budget:'+preAuth),18]);
        if(route==='otp-start'){
          budgets.push([digest('help-member-otp-start'),12]);
          if(isToken(preAuth))budgets.push([digest('otp-start:'+preAuth),3]);
        }
        const counts=[];
        for(const [key,limit] of budgets){
          const row=await tx.read('budget',key,t);
          counts.push({key,count:(row?.count??0)+1,deadline:row?.deadline??t+60_000,limit});
        }
        if(counts.some(r=>r.count>r.limit))return false;
        await tx.prune(t);
        for(const r of counts)await tx.put('budget',r.key,{count:r.count,deadline:r.deadline},r.deadline);
        return true;
      });
    }
  });
}
