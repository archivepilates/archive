import {createHmac,randomBytes} from 'node:crypto';
import {isToken,ORIGIN} from './accounts.mjs';
import {json,payload,readCookie} from './http.mjs';
import {WEB_MEMBER_OTP_REQUEST} from './consultation-otp.mjs';

export const CONVERSATION_HEADER='x-archive-conversation';
const routes=new Set(['availability','otp-start','otp-verify','cards','touch','logout']);
const keySet=(obj,keys)=>Object.keys(obj).sort().join(',')===keys;
const deny={ok:false};
const cookie=(step,session,age)=>'__session='+(!step&&!session?'':(step??'-')+'.'+(session??'-'))
  +'; Path=/api/member-access/; Secure; HttpOnly; SameSite=Strict'+(age==null?'':'; Max-Age='+age);
const same=(a,b)=>!!b&&a.accountId===b.accountId&&a.memberId===b.memberId
  &&a.studioId===b.studioId&&a.revision===b.revision;
const SOURCE_TTL=26*60*60_000;
const GRANT_TTL=2*60_000;

export function createConsultationCardLookup({consultation,issuer,reader,now=Date.now,sourceTtl=SOURCE_TTL}){
  return async (token,conversation)=>{
    const before=await consultation.touch(token,conversation);
    if(!before)return {status:403};
    const grant=randomBytes(32).toString('base64url');
    try{
      await issuer.issue({token:grant,binding:{...before,expiresAt:Math.min(before.expiresAt,now()+GRANT_TTL)}});
      const data=await reader(grant,'cards');
      const after=await consultation.resolveSession(token,conversation);
      if(!same(before,after))return {status:403};
      if(!data)return {status:503};
      const dataExpiresAt=Math.min(Date.parse(data.checkedAt)+sourceTtl,after.expiresAt);
      if(!Number.isSafeInteger(dataExpiresAt)||dataExpiresAt<=now())return {status:503};
      return {status:200,body:{ok:true,cards:data.cards,checkedAt:data.checkedAt,dataExpiresAt}};
    }finally{
      // The isolated one-request grant is not the browser auth session.
      try{await issuer.revoke(grant);}catch{/* Closed by its short expiry. */}
    }
  };
}

export function createConsultationMemberHandler({enabled=false,memberWebOtp=false,publicRoster=false,consultation,allowRequest,lookup,stepSecret,origin=ORIGIN}={}){
  if(enabled===true&&(!Buffer.isBuffer(stepSecret)||stepSecret.length!==32||typeof allowRequest!=='function'))
    throw Error('Private consultation HTTP configuration required');
  const forStep=conversation=>createHmac('sha256',stepSecret).update('help-otp-step:v1:'+conversation).digest('base64url');
  const web=memberWebOtp===true&&origin===ORIGIN;
  return async req=>{
    if(enabled!==true)return json(404,deny);
    try{
      const url=new URL(req.url), match=/^\/api\/member-access\/([a-z-]+)$/u.exec(url.pathname), route=match?.[1];
      if(!routes.has(route)||url.origin!==origin||url.search)return json(404,deny);
      if(req.method!=='POST'||req.headers.get('origin')!==origin)return json(403,deny);
      const conversation=req.headers.get(CONVERSATION_HEADER);
      if(!isToken(conversation))return json(403,deny);
      const {step,session}=readCookie(req);
      const preAuth=forStep(conversation);
      const body=await payload(req);
      if(!body)return json(400,deny);
      // A known conversation can always end even when its request budget is spent.
      if(route==='logout'&&keySet(body,'')){
        const removed=await consultation.logout(session,conversation,step===preAuth?step:null);
        return json(200,{ok:true},removed?[cookie(null,null,0)]:[]);
      }
      if(route==='availability'&&keySet(body,''))return json(200,{ok:true,remoteOtp:true,method:'otp',
        ...(web?{requestHours:'24h',...(publicRoster?{audience:'verified-members'}:{})}:{})});
      if(!await allowRequest(route==='otp-start'?preAuth:session??step,route))return json(429,deny);
      if(route==='otp-start'&&keySet(body,'phone')&&typeof body.phone==='string'&&/^010\d{8}$/u.test(body.phone)){
        const source=web?WEB_MEMBER_OTP_REQUEST:undefined;
        await consultation.start(preAuth,conversation,body.phone,source).catch(()=>{});
        return json(200,{ok:true},[cookie(preAuth,session,session?null:600)]);
      }
      if(route==='otp-verify'&&keySet(body,'code')&&typeof body.code==='string'&&/^\d{6}$/u.test(body.code)){
        if(step!==preAuth)return json(403,deny);
        const result=await consultation.verify(step,conversation,body.code);
        if(!result.ok||!isToken(result.token))return json(403,deny);
        if(session&&session!==result.token)await consultation.logout(session,conversation,null);
        return json(200,{ok:true},[cookie(null,result.token,null)]);
      }
      if(route==='touch'&&keySet(body,'')){
        return session&&await consultation.touch(session,conversation)?json(200,{ok:true}):json(403,deny);
      }
      if(route==='cards'&&keySet(body,'')){
        if(!session)return json(403,deny);
        const result=await lookup(session,conversation);
        return json(result.status,result.body??deny);
      }
      return json(400,deny);
    }catch{return json(503,deny);}
  };
}
