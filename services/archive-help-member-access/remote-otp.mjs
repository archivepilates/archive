import {createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {digest,isToken,STUDIO_ID} from './accounts.mjs';

const kst=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'});
const inMemberWindow=ms=>{const hour=Number(kst.format(new Date(ms)));return hour>=9&&hour<23;};
const generic=Object.freeze({ok:true}); // No existence, receipt or delivery status is exposed by the request step.
const deny=Object.freeze({ok:false});
const MAX_ATTEMPTS=5, TTL=5*60_000, DAY=24*60*60_000;
const compatible=(row,inv,step)=>row?.accountId===inv.account.id&&row.memberId===inv.account.memberId
  &&row.revision===inv.account.revision&&row.inviteDigest===inv.inviteDigest&&row.stepDigest===digest(step);

export function createRemoteOtp({store,accounts,resolveRecipient,sendCode,secret,now=Date.now}){
  if(!(secret instanceof Uint8Array)||secret.length<32||typeof resolveRecipient!=='function'||typeof sendCode!=='function'){
    throw Error('Explicit code delivery and private key are required');
  }
  const codeHash=(claim,code)=>createHmac('sha256',secret).update(claim+':'+code).digest('hex');
  return Object.freeze({
    async start(step,invitation){
      if(!isToken(step)||!isToken(invitation)||!inMemberWindow(now()))return generic;
      if(store.read('otp',digest(invitation),now()))return generic;
      const inv=await accounts.resolveOpenInvitation(invitation);
      if(!inv||store.read('otp',inv.inviteDigest,now()))return generic;
      const {id,memberId,revision}=inv.account;
      const budget=digest('help-otp:'+STUDIO_ID+':'+memberId);
      if((store.read('otp-budget',budget,now())?.count??0)>=3)return generic;
      const recipient=await resolveRecipient({studioId:STUDIO_ID,memberId,revision,signal:AbortSignal.timeout(7000)});
      if(recipient?.authority!=='studiomate_registered_contact'||recipient.memberId!==memberId||
        recipient.studioId!==STUDIO_ID||recipient.revision!==revision||recipient.verified!==true||
        !/^010\d{8}$/.test(recipient.phone??'')||!Number.isSafeInteger(recipient.checkedAt)
        ||recipient.checkedAt>now()||now()-recipient.checkedAt>30_000)return generic;
      const code=String(randomInt(0,1_000_000)).padStart(6,'0'), claim=randomBytes(32).toString('hex');
      const expires=Math.min(inv.expiresAt,now()+TTL), stepDigest=digest(step);
      const row={claim,accountId:id,memberId,revision,inviteDigest:inv.inviteDigest,stepDigest,
        hash:codeHash(claim,code),expiresAt:expires,attempts:0,status:'dispatching'};
      const reserved=store.transaction(tx=>{
        const time=now();
        const prior=tx.read('otp-budget',budget,time);
        if(!inMemberWindow(time)||expires-time<30_000||tx.read('otp',inv.inviteDigest,time)||(prior?.count??0)>=3)return false;
        tx.put('otp-budget',budget,{count:(prior?.count??0)+1,ends:prior?.ends??time+DAY},prior?.ends??time+DAY);
        // Keep the dispatch claim for the whole invitation, independently of code expiry.
        tx.put('otp',inv.inviteDigest,row,inv.expiresAt);
        return true;
      });
      if(!reserved||!inMemberWindow(now())||expires<=now())return generic;
      let status='transport_unknown';
      let providerReceipt;
      try{
        const result=await sendCode({to:recipient.phone,code,dispatchKey:claim,expiresAt:expires,
          // Sender must recheck this window immediately before its irreversible provider call.
          mayDispatch:()=>inMemberWindow(now())&&now()<expires,signal:AbortSignal.timeout(7000)});
        if(result?.accepted===true){
          status='accepted';
          if(/^M[A-Za-z0-9]{20,80}$/.test(result.messageId??'')&&/^G[A-Za-z0-9]{20,80}$/.test(result.groupId??'')){
            providerReceipt={messageId:result.messageId,groupId:result.groupId};
          }
        }
      }catch{/* No retry after transport becomes uncertain. */}
      store.transaction(tx=>{
        const saved=tx.read('otp',inv.inviteDigest,now());
        if(saved?.claim===claim&&saved.status==='dispatching')tx.put('otp',inv.inviteDigest,{...saved,status,providerReceipt},inv.expiresAt);
      });
      return generic;
    },
    async verify(step,invitation,code){
      if(!isToken(step)||!isToken(invitation)||typeof code!=='string'||!/^\d{6}$/.test(code))return deny;
      const inv=await accounts.resolveOpenInvitation(invitation);
      if(!inv)return deny;
      return store.transaction(tx=>{
        const t=now(), saved=tx.read('otp',inv.inviteDigest,t);
        if(!compatible(saved,inv,step)||saved.expiresAt<=t||!['accepted','transport_unknown'].includes(saved.status)
          ||saved.attempts>=MAX_ATTEMPTS)return deny;
        const expected=Buffer.from(saved.hash,'hex'), actual=Buffer.from(codeHash(saved.claim,code),'hex');
        const matched=expected.length===actual.length&&timingSafeEqual(expected,actual);
        if(!matched){
          tx.put('otp',inv.inviteDigest,{...saved,attempts:saved.attempts+1},inv.expiresAt);
          return deny;
        }
        const receipt=randomBytes(32).toString('base64url'), expires=Math.min(inv.expiresAt,t+TTL);
        tx.put('otp',inv.inviteDigest,{...saved,status:'consumed',hash:null},inv.expiresAt);
        tx.put('otp-receipt',digest(receipt),{inviteDigest:inv.inviteDigest,stepDigest:digest(step),memberId:inv.account.memberId,
          accountId:inv.account.id,revision:inv.account.revision},expires);
        return {ok:true,enrollmentReceipt:receipt};
      });
    },
    matches({inviteDigest,stepDigest,enrollmentDigest,account}){
      const row=store.read('otp-receipt',enrollmentDigest,now());
      return row?.inviteDigest===inviteDigest&&row.stepDigest===stepDigest&&row.memberId===account.memberId&&
        row.accountId===account.id&&row.revision===account.revision;
    }
  });
}
