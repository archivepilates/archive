import {createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {cloudSourceIsFresh,digest,isToken,STUDIO_ID} from './accounts.mjs';

const kst=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'});
const inMemberWindow=ms=>{const hour=Number(kst.format(new Date(ms)));return hour>=9&&hour<23;};
const generic=Object.freeze({ok:true}); // No existence, receipt or delivery status is exposed by the request step.
const deny=Object.freeze({ok:false});
const MAX_ATTEMPTS=5, TTL=5*60_000, DAY=24*60*60_000;
const compatible=(row,inv,step)=>row?.accountId===inv.account.id&&row.memberId===inv.account.memberId
  &&row.revision===inv.account.revision&&row.inviteDigest===inv.inviteDigest&&row.stepDigest===digest(step);

export function createRemoteOtp({store,accounts,resolveRecipient,sendCode,secret,now=Date.now,allowCloudRecipient=false}){
  if(!(secret instanceof Uint8Array)||secret.length<32||typeof resolveRecipient!=='function'||typeof sendCode!=='function'){
    throw Error('Explicit code delivery and private key are required');
  }
  const codeHash=(claim,code)=>createHmac('sha256',secret).update(claim+':'+code).digest('hex');
  return Object.freeze({
    async start(step,invitation){
      if(!isToken(step)||!isToken(invitation)||!inMemberWindow(now()))return generic;
      if(await store.read('otp',digest(invitation),now()))return generic;
      const inv=await accounts.resolveOpenInvitation(invitation);
      if(!inv||await store.read('otp',inv.inviteDigest,now()))return generic;
      const {id,memberId,revision}=inv.account;
      const budget=digest('help-otp:'+STUDIO_ID+':'+memberId);
      if(((await store.read('otp-budget',budget,now()))?.count??0)>=3)return generic;
      const recipient=await resolveRecipient({studioId:STUDIO_ID,memberId,revision,signal:AbortSignal.timeout(7000)});
      const sourceVerified=recipient?.authority==='studiomate_registered_contact'||(allowCloudRecipient
        &&recipient?.authority==='verified_cloud_registered_contact'&&cloudSourceIsFresh(recipient.sourceObservedAt,now(),60*60_000));
      if(!sourceVerified||recipient.memberId!==memberId||
        recipient.studioId!==STUDIO_ID||recipient.revision!==revision||recipient.verified!==true||
        !/^010\d{8}$/.test(recipient.phone??'')||!Number.isSafeInteger(recipient.checkedAt)
        ||recipient.checkedAt>now()||now()-recipient.checkedAt>30_000)return generic;
      const code=String(randomInt(0,1_000_000)).padStart(6,'0'), claim=randomBytes(32).toString('hex');
      const expires=Math.min(inv.expiresAt,now()+TTL), stepDigest=digest(step);
      const row={claim,accountId:id,memberId,revision,inviteDigest:inv.inviteDigest,stepDigest,
        hash:codeHash(claim,code),expiresAt:expires,attempts:0,status:'dispatching'};
      const reserved=await store.transaction(async tx=>{
        const time=now();
        const prior=await tx.read('otp-budget',budget,time);
        if(!inMemberWindow(time)||expires-time<30_000||await tx.read('otp',inv.inviteDigest,time)||(prior?.count??0)>=3)return false;
        await tx.put('otp-budget',budget,{count:(prior?.count??0)+1,ends:prior?.ends??time+DAY},prior?.ends??time+DAY);
        // Keep the dispatch claim for the whole invitation, independently of code expiry.
        await tx.put('otp',inv.inviteDigest,row,inv.expiresAt);
        return true;
      });
      if(!reserved||!inMemberWindow(now())||expires<=now())return generic;
      const current=await accounts.resolveOpenInvitation(invitation);
      if(current?.account?.id!==id||current.account.revision!==revision||now()-recipient.checkedAt>30_000)return generic;
      let status='transport_unknown';
      let providerReceipt;
      try{
        const result=await sendCode({to:recipient.phone,code,dispatchKey:claim,expiresAt:expires,
          // Sender must recheck this window immediately before its irreversible provider call.
          mayDispatch:()=>inMemberWindow(now())&&now()<expires&&now()-recipient.checkedAt<=30_000
            &&(recipient.authority!=='verified_cloud_registered_contact'||cloudSourceIsFresh(recipient.sourceObservedAt,now(),60*60_000)),
          signal:AbortSignal.timeout(7000)});
        if(result?.accepted===true){
          status='accepted';
          if(/^M[A-Za-z0-9]{20,80}$/.test(result.messageId??'')&&/^G[A-Za-z0-9]{20,80}$/.test(result.groupId??'')){
            providerReceipt={messageId:result.messageId,groupId:result.groupId};
          }
        }
      }catch{/* No retry after transport becomes uncertain. */}
      await store.transaction(async tx=>{
        const saved=await tx.read('otp',inv.inviteDigest,now());
        if(saved?.claim===claim&&saved.status==='dispatching'){
          await tx.put('otp',inv.inviteDigest,{...saved,status,providerReceipt},inv.expiresAt);
        }
      });
      return generic;
    },
    async verify(step,invitation,code){
      if(!isToken(step)||!isToken(invitation)||typeof code!=='string'||!/^\d{6}$/.test(code))return deny;
      const inv=await accounts.resolveOpenInvitation(invitation);
      if(!inv)return deny;
      return store.transaction(async tx=>{
        const t=now(), saved=await tx.read('otp',inv.inviteDigest,t);
        if(!compatible(saved,inv,step)||saved.expiresAt<=t||!['accepted','transport_unknown'].includes(saved.status)
          ||saved.attempts>=MAX_ATTEMPTS)return deny;
        const expected=Buffer.from(saved.hash,'hex'), actual=Buffer.from(codeHash(saved.claim,code),'hex');
        const matched=expected.length===actual.length&&timingSafeEqual(expected,actual);
        if(!matched){
          await tx.put('otp',inv.inviteDigest,{...saved,attempts:saved.attempts+1},inv.expiresAt);
          return deny;
        }
        const receipt=randomBytes(32).toString('base64url'), expires=Math.min(inv.expiresAt,t+TTL);
        await tx.put('otp',inv.inviteDigest,{...saved,status:'consumed',hash:null},inv.expiresAt);
        await tx.put('otp-receipt',digest(receipt),{inviteDigest:inv.inviteDigest,stepDigest:digest(step),memberId:inv.account.memberId,
          accountId:inv.account.id,revision:inv.account.revision},expires);
        return {ok:true,enrollmentReceipt:receipt};
      });
    },
    async matches({inviteDigest,stepDigest,enrollmentDigest,account}){
      const row=await store.read('otp-receipt',enrollmentDigest,now());
      return row?.inviteDigest===inviteDigest&&row.stepDigest===stepDigest&&row.memberId===account.memberId&&
        row.accountId===account.id&&row.revision===account.revision;
    }
  });
}
