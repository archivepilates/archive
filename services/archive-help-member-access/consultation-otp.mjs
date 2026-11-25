import {createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';

const STUDIO_ID='5330', HOUR=60*60_000, DAY=24*HOUR, CODE_MS=5*60_000;
const MAX_SENDS=3, MAX_DENIES=5, DISPATCH_MS=15_000, PROOF_MS=30_000;
const WEB_REQUEST_COOLDOWN_MS=60_000;
const kst=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'});
const inWindow=time=>{const hour=Number(kst.format(time));return hour>=9&&hour<23;};
const tokenValid=value=>typeof value==='string'&&value.length===43&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(value);
const phoneValid=value=>typeof value==='string'&&value.length===11&&/^010\d{8}$/u.test(value);
const hexValid=value=>typeof value==='string'&&value.length===64&&/^[0-9a-f]+$/u.test(value);
const fresh=(observed,time,age)=>Number.isSafeInteger(observed)&&observed>=0&&observed<=time&&time-observed<age;
const samePhone=(left,right)=>timingSafeEqual(Buffer.from(left,'ascii'),Buffer.from(right,'ascii'));
const sameBinding=(left,right)=>!!left&&!!right&&left.memberId===right.memberId&&left.revision===right.revision;
const generic=Object.freeze({ok:true});
const denied=Object.freeze({ok:false});

export const WEB_MEMBER_OTP_REQUEST=Symbol('ARCHIVE PILATES Help member form request');

export function createConsultationOtp(options){
  return buildConsultationOtp(options,false);
}

export function createWebMemberConsultationOtp(options){
  return buildConsultationOtp(options,true);
}

function buildConsultationOtp({store,loadPilotBinding,sendCode,secret,now=Date.now}={},allowWebMemberHours){
  if(typeof store?.read!=='function'||typeof store?.transaction!=='function'||typeof loadPilotBinding!=='function'
    ||typeof sendCode!=='function'||typeof now!=='function'||!(secret instanceof Uint8Array)||secret.length<32){
    throw new TypeError('Trusted consultation OTP adapters and private key required');
  }
  const key=Buffer.from(secret);
  const hmac=(domain,...values)=>createHmac('sha256',key)
    .update(['archive-help-consultation-otp:v1',domain,...values].join('\0'));
  const digest=(...values)=>hmac(...values).digest('hex');
  const otpKey=(step,conversation)=>digest('otp',step,conversation);
  const proofFresh=(proof,time,age)=>fresh(proof.sourceObservedAt,time,age)&&fresh(proof.checkedAt,time,PROOF_MS);

  // The injected loader is bound to the sole configured pilot. No caller identity is passed to it.
  async function readPilot(needContact){
    const signal=AbortSignal.timeout(7000);
    const value=await loadPilotBinding({needContact,signal});
    const checkedAt=now();
    if(signal.aborted||value?.authority!=='verified_studiomate_in_person_signup'||value.studioId!==STUDIO_ID
      ||typeof value.memberId!=='string'||!/^[1-9]\d{0,15}$/u.test(value.memberId)||!hexValid(value.revision)
      ||value.registeredContactVerified!==true||value.signupComplete!==true||value.active!==true||value.revoked!==false
      ||!fresh(value.sourceObservedAt,checkedAt,needContact?HOUR:26*HOUR)||needContact&&!phoneValid(value.phone))return null;
    return {memberId:value.memberId,revision:value.revision,sourceObservedAt:value.sourceObservedAt,checkedAt,
      ...(needContact?{phone:value.phone}:{})};
  }

  async function recordDispatch(otp,marker,claim,status){
    // An ambiguous dispatch keeps only the opaque replay marker after the code expires.
    await store.transaction(async tx=>{
      const time=now(), held=await tx.read('otp',marker,time);
      if(held?.claim!==claim)return;
      const row=await tx.read('otp',otp,time);
      if(row?.claim===claim&&row.status==='dispatching'){
        if(status==='blocked')await tx.remove('otp',otp);
        else await tx.put('otp',otp,{...row,status},row.expiresAt);
      }
      if(status!=='transport_unknown')await tx.remove('otp',marker);
    });
  }

  const usableCode=(row,time)=>row&&Number.isSafeInteger(row.expiresAt)&&row.expiresAt>time
    &&Number.isSafeInteger(row.attempts)&&row.attempts>=0&&row.attempts<MAX_DENIES
    &&(row.status==='accepted'||row.status==='transport_unknown')&&hexValid(row.claim)&&hexValid(row.codeDigest);
  const usableSession=(row,conversation,time)=>row?.conversation===conversation
    &&Number.isSafeInteger(row.issuedAt)&&row.issuedAt<=time&&Number.isSafeInteger(row.expiresAt)&&row.expiresAt>time;

  async function sessionFor(token,conversation,touch){
    if(!tokenValid(token)||!tokenValid(conversation))return null;
    try{
      const sessionKey=digest('session',token), conversationDigest=digest('conversation',conversation);
      const before=await store.read('session',sessionKey,now());
      if(!usableSession(before,conversationDigest,now()))return null;
      const proof=await readPilot(false);
      if(!proof||!sameBinding(proof,before))return null;
      return await store.transaction(async tx=>{
        const current=await tx.read('session',sessionKey,now()), time=now();
        // A concurrent touch may extend this session. A deleted or replaced session cannot be revived.
        if(!usableSession(current,conversationDigest,time)||!sameBinding(current,before)
          ||current.issuedAt!==before.issuedAt||!proofFresh(proof,time,26*HOUR))return null;
        const expiresAt=touch?Math.max(current.expiresAt,time+DAY):current.expiresAt;
        if(expiresAt!==current.expiresAt)await tx.put('session',sessionKey,{...current,expiresAt},expiresAt);
        const {memberId,revision}=proof;
        return {accountId:hmac('account',STUDIO_ID,memberId).digest('base64url'),memberId,studioId:STUDIO_ID,
          revision,active:true,signupComplete:true,identityVerified:true,expiresAt};
      });
    }catch{return null;}
  }

  return Object.freeze({
    async start(step,conversation,phone,source){
      if(!tokenValid(step)||!tokenValid(conversation)||!phoneValid(phone))return generic;
      const memberForm=allowWebMemberHours&&source===WEB_MEMBER_OTP_REQUEST;
      const permitted=time=>Number.isSafeInteger(time)&&(memberForm||inWindow(time));
      try{
        if(!permitted(now()))return generic;
        const otp=otpKey(step,conversation), marker=digest('dispatch-marker',step,conversation);
        if(await store.read('otp',marker,now())||await store.read('otp',otp,now()))return generic;
        const proof=await readPilot(true);
        if(!proof||!samePhone(phone,proof.phone))return generic;
        const {memberId,revision}=proof, budget=digest('budget',STUDIO_ID,memberId);
        const claim=randomBytes(32).toString('hex'), code=String(randomInt(1_000_000)).padStart(6,'0');
        const reservation=await store.transaction(async tx=>{
          const time=now(), prior=await tx.read('otp-budget',budget,time);
          const entries=prior?.deadlines??[];
          if(!Array.isArray(entries)||entries.length>MAX_SENDS||entries.some(t=>!Number.isSafeInteger(t)))return null;
          if(await tx.read('otp',marker,time)||await tx.read('otp',otp,time))return null;
          const claimedAt=now(), deadlines=entries.filter(t=>t>claimedAt);
          if(!permitted(claimedAt)||!proofFresh(proof,claimedAt,HOUR)||deadlines.length>=MAX_SENDS
            ||memberForm&&deadlines.some(deadline=>claimedAt<deadline-DAY+WEB_REQUEST_COOLDOWN_MS))return null;
          const expiresAt=claimedAt+CODE_MS, dispatchBy=claimedAt+DISPATCH_MS;
          // Budget from the latest permitted transport time, not an earlier database timestamp.
          deadlines.push(dispatchBy+DAY);
          await tx.put('otp-budget',budget,{deadlines},Math.max(...deadlines));
          await tx.put('otp',marker,{claim});
          await tx.put('otp',otp,{claim,memberId,revision,expiresAt,attempts:0,status:'dispatching',
            codeDigest:digest('code',claim,code)},expiresAt);
          return {expiresAt,dispatchBy};
        });
        if(!reservation)return generic;

        const {expiresAt,dispatchBy}=reservation;
        let status='blocked';
        try{
          const current=permitted(now())&&now()<dispatchBy?await readPilot(true):null;
          const mayDispatch=()=>{
            const time=now();
            return !!current&&time<dispatchBy&&permitted(time)&&proofFresh(current,time,HOUR);
          };
          if(current&&sameBinding(current,proof)&&samePhone(current.phone,proof.phone)
            &&(await store.read('otp',otp,now()))?.claim===claim&&mayDispatch()){
            status='transport_unknown';
            const receipt=await sendCode({to:current.phone,code,dispatchKey:claim,expiresAt,mayDispatch,
              signal:AbortSignal.timeout(7000)});
            if(receipt?.accepted===true)status='accepted';
          }
        }finally{await recordDispatch(otp,marker,claim,status);}
      }catch{/* No provider, authority or store errors in the generic response, and no retry. */}
      return generic;
    },

    async verify(step,conversation,code){
      if(!tokenValid(step)||!tokenValid(conversation)||typeof code!=='string'||code.length!==6||!/^\d{6}$/u.test(code))return denied;
      try{
        const otp=otpKey(step,conversation), before=await store.read('otp',otp,now());
        if(!usableCode(before,now()))return denied;
        const proof=await readPilot(false);
        if(!proof||!sameBinding(proof,before))return denied;
        return await store.transaction(async tx=>{
          const current=await tx.read('otp',otp,now()), time=now();
          if(!usableCode(current,time)||current.claim!==before.claim||!sameBinding(current,proof)
            ||!proofFresh(proof,time,26*HOUR))return denied;
          const matches=timingSafeEqual(Buffer.from(current.codeDigest,'hex'),Buffer.from(digest('code',current.claim,code),'hex'));
          const attempts=current.attempts+Number(!matches);
          if(attempts>=MAX_DENIES||matches){
            await tx.put('otp',otp,{claim:current.claim,expiresAt:current.expiresAt,status:matches?'consumed':'denied'},current.expiresAt);
          }else{
            await tx.put('otp',otp,{...current,attempts},current.expiresAt);
          }
          if(!matches)return denied;
          const token=randomBytes(32).toString('base64url'), expiresAt=time+DAY;
          await tx.put('session',digest('session',token),{conversation:digest('conversation',conversation),
            memberId:proof.memberId,revision:proof.revision,issuedAt:time,expiresAt},expiresAt);
          return {ok:true,token,expiresAt};
        });
      }catch{return denied;}
    },

    async resolveSession(token,conversation){return sessionFor(token,conversation,false);},
    async touch(token,conversation){return sessionFor(token,conversation,true);},

    async logout(token,conversation,step){
      if(!tokenValid(conversation)||!tokenValid(token)&&!tokenValid(step))return false;
      try{
        return await store.transaction(async tx=>{
          const time=now();
          let removed=false;
          if(tokenValid(token)){
            const sessionKey=digest('session',token), conversationDigest=digest('conversation',conversation);
            if(usableSession(await tx.read('session',sessionKey,time),conversationDigest,time)){
              await tx.remove('session',sessionKey);
              removed=true;
            }
          }
          if(tokenValid(step)){
            const otp=otpKey(step,conversation);
            if(await tx.read('otp',otp,time)){
              await tx.remove('otp',otp);
              removed=true;
            }
          }
          return removed;
        });
      }catch{return false;}
    },
  });
}
