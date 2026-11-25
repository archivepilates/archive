import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {ORIGIN} from './accounts.mjs';
import {CONVERSATION_HEADER,createConsultationCardLookup,createConsultationMemberHandler} from './consultation-http.mjs';
import {createFirebaseMemberBridge} from './firebase-bridge.mjs';
import {WEB_MEMBER_OTP_REQUEST} from './consultation-otp.mjs';

const token=()=>randomBytes(32).toString('base64url');
const phone='01000000008', session=token(), first=token(), other=token();
const post=(route,body={},conversation=first,cookie='')=>new Request(ORIGIN+'/api/member-access/'+route,{
  method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',[CONVERSATION_HEADER]:conversation,Cookie:cookie},
  body:JSON.stringify(body)
});

test('the production origin and an exact OTP form route are required for the web exception',async()=>{
  const contexts=[];
  const setup=(origin,memberWebOtp)=>createConsultationMemberHandler({enabled:true,memberWebOtp,origin,
    stepSecret:randomBytes(32),allowRequest:async()=>true,
    consultation:{async start(_step,_conversation,_phone,source){contexts.push(source);}}});
  const live=setup(ORIGIN,true);
  assert.equal((await(await live(post('availability'))).json()).requestHours,'24h');
  assert.equal((await live(post('otp-start',{phone,requestHours:'24h'}))).status,400);
  assert.equal((await live(post('otp-start',{phone}))).status,200);
  assert.deepEqual(contexts,[WEB_MEMBER_OTP_REQUEST]);
  const testOrigin='https://example.invalid';
  const otherOrigin=setup(testOrigin,true);
  const req=new Request(testOrigin+'/api/member-access/otp-start',{
    method:'POST',headers:{Origin:testOrigin,'Content-Type':'application/json',[CONVERSATION_HEADER]:first},
    body:JSON.stringify({phone})});
  assert.equal((await live(req.clone())).status,404);
  assert.equal((await otherOrigin(req)).status,200);
  assert.equal((await setup(ORIGIN,false)(post('otp-start',{phone}))).status,200);
  assert.deepEqual(contexts,[WEB_MEMBER_OTP_REQUEST,undefined,undefined]);
});
const pair=response=>response.headers.getSetCookie()[0].split(';')[0];
test('OTP-only member routes bind the session to an opaque conversation; no WebAuthn routes',async()=>{
  let step,started=0, verified=0, dropped=false;
  const consultation={
    async start(s,c,p){assert.equal(c,first);assert.equal(p,phone);step=s;started++;},
    async verify(s,c,code){assert.equal(s,step);assert.equal(c,first);assert.equal(code,'123456');verified++;return {ok:true,token:session};},
    async touch(s,c){return s===session&&c===first&&!dropped;},
    async logout(s,c){if(s===session&&c===first){dropped=true;return true;}return false;}
  };
  let fresh=false;
  const handler=createConsultationMemberHandler({enabled:true,stepSecret:randomBytes(32),allowRequest:async()=>true,consultation,
    lookup:async(s,c)=>s===session&&c===first&&!dropped?{status:fresh?200:503,body:fresh?{ok:true,cards:[]}:undefined}:{status:403}});
  assert.deepEqual(await(await handler(post('availability'))).json(),{ok:true,remoteOtp:true,method:'otp'});
  for(const route of ['login','register','registration-options','history'])assert.equal((await handler(post(route))).status,404);
  assert.equal((await handler(post('otp-start',{phone,memberId:'418'}))).status,400);
  assert.equal((await handler(post('otp-start',{phone},'bad'))).status,403);
  const start=await handler(post('otp-start',{phone}));
  assert.deepEqual(await start.json(),{ok:true});
  const cookie=pair(start);
  const sameStep=await handler(post('otp-start',{phone}));
  assert.equal(pair(sameStep),cookie);
  assert.equal(started,2);
  const auth=await handler(post('otp-verify',{code:'123456'},first,cookie));
  assert.deepEqual(await auth.json(),{ok:true});assert.equal(verified,1);
  assert.doesNotMatch(auth.headers.get('set-cookie'),/Max-Age=/);
  const sessionCookie=pair(auth);
  assert.equal((await handler(post('otp-verify',{code:'123456'},other,cookie))).status,403);
  assert.equal((await handler(post('cards',{},first,sessionCookie))).status,503);
  assert.equal((await handler(post('touch',{},first,sessionCookie))).status,200);
  fresh=true;
  assert.equal((await handler(post('cards',{memberId:'418'},first,sessionCookie))).status,400);
  assert.equal((await handler(post('cards',{},other,sessionCookie))).status,403);
  assert.equal((await handler(post('logout',{},other,sessionCookie))).headers.get('set-cookie'),null);
  assert.equal((await handler(post('cards',{},first,sessionCookie))).status,200);
  assert.match((await handler(post('logout',{},first,sessionCookie))).headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await handler(post('cards',{},first,sessionCookie))).status,403);
});

test('each lookup gets an isolated short DB grant; a revocation before response discards data',async()=>{
  let clock=Date.parse('2026-11-25T00:05:00Z'),after=null;
  const before={accountId:'own',memberId:'417',studioId:'5330',revision:'b'.repeat(64),
    expiresAt:clock+24*60*60_000};
  const issued=[],closed=[];
  const consultation={touch:async()=>before,resolveSession:async()=>after??before};
  const issuer={issue:async args=>{issued.push(args);},revoke:async t=>{closed.push(t);}};
  const reader=async(grant,scope)=>{assert.equal(scope,'cards');assert.notEqual(grant,session);
    return {cards:[],checkedAt:new Date(clock-1000).toISOString(),expiresAt:clock+120_000};};
  const lookup=createConsultationCardLookup({consultation,issuer,reader,now:()=>clock});
  assert.equal((await lookup(session,first)).status,200);
  clock+=41*60_000;
  const a=await lookup(session,first);assert.equal(a.status,200);
  assert.equal(issued[1].binding.expiresAt,clock+120_000);
  assert.notEqual(issued[0].token,issued[1].token);
  assert.equal(a.body.dataExpiresAt,before.expiresAt);
  assert.deepEqual(closed,issued.map(x=>x.token));
  const revoke=createConsultationCardLookup({consultation,issuer,reader:async()=>{after={...before,revision:'c'.repeat(64)};
    return reader(token(),'cards');},now:()=>clock});
  assert.deepEqual(await revoke(session,first),{status:403});
  assert.equal(closed.length,3);
});

test('Firebase bridge carries the exact origin, route, scoped cookie and opaque header',async()=>{
  const routes=[];
  const bridge=createFirebaseMemberBridge({getHandler:async()=>async req=>{
    routes.push(req.url);assert.equal(req.headers.get(CONVERSATION_HEADER),first);
    assert.equal(req.headers.get('cookie'),'__session=-.'+session);
    const h=new Headers({'Cache-Control':'private, no-store'});
    h.append('Set-Cookie','__session=; Secure; HttpOnly; Max-Age=0');
    return new Response('{"ok":true}',{headers:h});
  }});
  const request={method:'POST',originalUrl:'/api/member-access/logout',rawBody:Buffer.from('{}'),
    get:key=>({origin:ORIGIN,'content-type':'application/json',cookie:'__session=-.'+session,[CONVERSATION_HEADER]:first})[key]};
  const res={headers:{},status(n){this.code=n;return this;},set(k,v){this.headers[k.toLowerCase()]=v;return this;},
    json(v){this.body=v;return this;},send(v){this.body=JSON.parse(v.toString());return this;}};
  await bridge(request,res);
  assert.equal(res.code,200);assert.deepEqual(res.headers['set-cookie'],['__session=; Secure; HttpOnly; Max-Age=0']);
  assert.deepEqual(res.body,{ok:true});assert.deepEqual(routes,[ORIGIN+'/api/member-access/logout']);
  await bridge({...request,originalUrl:'/api/member-access/cards?otherMember=417'},res);
  assert.equal(res.code,404);
});
