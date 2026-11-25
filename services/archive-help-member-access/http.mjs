import {randomBytes} from 'node:crypto';
import {ORIGIN,SESSION_MS,isToken} from './accounts.mjs';

// Firebase Hosting forwards only this cookie to a Functions or Cloud Run rewrite.
const COOKIE='__session';
const payloadLimit=8192;
const unavailable={ok:false};
const routeNames=new Set(['availability','otp-start','otp-verify','registration-options','register','login-options','login','logout','cards','history']);
const keySet=(obj,keys)=>Object.keys(obj).sort().join(',')===keys;
const cookie=(step,session,age)=>COOKIE+'='+(!step&&!session?'':(step??'-')+'.'+(session??'-'))
  +'; Path=/api/member-access/; Secure; HttpOnly; SameSite=Strict; Max-Age='+age;

export function readCookie(req){
  const prefix=COOKIE+'=';
  const matches=(req.headers.get('cookie')??'').split(';').map(row=>row.trim()).filter(row=>row.startsWith(prefix));
  if(matches.length!==1)return {};
  const parts=matches[0].slice(prefix.length).split('.');
  if(parts.length!==2||parts.some(v=>v!=='-'&&!isToken(v)))return {};
  const [step,session]=parts;
  return {step:isToken(step)?step:null,session:isToken(session)?session:null};
}
export function json(status,value,cookies=[]){
  const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  for(const item of cookies)headers.append('Set-Cookie',item);
  return new Response(JSON.stringify(value),{status,headers});
}
export async function payload(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers.get('content-type')??'')||!req.body
    ||Number(req.headers.get('content-length'))>payloadLimit)return null;
  const reader=req.body.getReader(),chunks=[];
  let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>payloadLimit){await reader.cancel();return null;}
      chunks.push(value);
    }
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
  }catch{return null;}
  finally{reader.releaseLock();}
}

export function createMemberHttpHandler({enabled=false,accounts,lookup,otp,onSessionClosed}={}){
  async function closeSession(step,session){
    await accounts.logout(step,session);
    if(session&&onSessionClosed){
      try{await onSessionClosed(session);}catch{/* The authenticated session is already closed. */}
    }
  }
  return async function handle(req){
    if(enabled!==true)return json(404,unavailable);
    try{
      const url=new URL(req.url), path=url.pathname;
      const route=path.startsWith('/api/member-access/')?path.slice('/api/member-access/'.length):'';
      if(!routeNames.has(route)||url.origin!==ORIGIN||url.search)return json(404,unavailable);
      if(req.method!=='POST'||req.headers.get('origin')!==ORIGIN)return json(403,unavailable);
      const {step,session}=readCookie(req);
      if(!await accounts.allowRequest(step??session,route))return json(429,unavailable);
      const body=await payload(req);
      if(!body)return json(400,unavailable);
      if(route==='availability'&&keySet(body,''))return otp?json(200,{ok:true,remoteOtp:true}):json(404,unavailable);
      if(route==='otp-start'&&otp&&keySet(body,'invitation')){
        if(!isToken(body.invitation))return json(400,unavailable);
        const preAuth=step??randomBytes(32).toString('base64url');
        try{await otp.start(preAuth,body.invitation);}catch{/* Do not disclose identity or transport errors. */}
        return json(200,{ok:true},[cookie(preAuth,session,session?SESSION_MS/1000:600)]);
      }
      if(route==='otp-verify'&&otp&&step&&keySet(body,'code,invitation')){
        const result=await otp.verify(step,body.invitation,body.code);
        return json(result.ok?200:403,result);
      }
      if(route==='logout'&&keySet(body,'')){
        await closeSession(step,session);
        return json(200,{ok:true},[cookie(null,null,0)]);
      }
      if(keySet(body,'')&&['cards','history'].includes(route)){
        if(!session)return json(403,unavailable);
        const data=await lookup(session,route);
        return data?json(200,{ok:true,...data}):json(403,unavailable);
      }
      if(route==='registration-options'&&keySet(body,'enrollmentReceipt,invitation')||route==='login-options'&&keySet(body,'')){
        const preAuth=step??randomBytes(32).toString('base64url');
        const result=route==='registration-options'
          ?await accounts.registrationOptions(preAuth,body.invitation,body.enrollmentReceipt)
          :await accounts.loginOptions(preAuth);
        return result.ok?json(200,result,[cookie(preAuth,session,session?SESSION_MS/1000:120)]):json(403,unavailable);
      }
      if((route==='register'||route==='login')&&step&&keySet(body,'response')){
        const result=await accounts[route](step,body.response);
        if(!result.ok)return json(403,unavailable);
        if(session)await closeSession(null,session);
        return json(200,{ok:true},[cookie(null,result.token,SESSION_MS/1000)]);
      }
      return json(400,unavailable);
    }catch{return json(403,unavailable);}
  };
}
