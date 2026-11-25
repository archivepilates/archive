import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,symlinkSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createHash,randomBytes} from 'node:crypto';
import {openMemberStore} from './store.mjs';
import {createMemberAccounts,ORIGIN,RP_ID,STUDIO_ID} from './accounts.mjs';
import {createMemberHttpHandler} from './http.mjs';
import {createOwnLookup,createStudioMateOwnReader} from './studio-own.mjs';
import {createPrivateMemberPilot} from './index.mjs';
import {createRemoteOtp} from './remote-otp.mjs';

const fakeId='28'.repeat(16);
const token=()=>randomBytes(32).toString('base64url');
const enrollmentReceipt=token();
function fixture(t,verificationMethod='registered_contact'){
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'archive-help-member-')));
  const path=join(dir,'pilot.sqlite');
  let store=openMemberStore(path);
  t.after(()=>{store.close(); rmSync(dir,{recursive:true,force:true});});
  let tick=Date.parse('2026-11-23T15:00:00Z'), revision='a'.repeat(64), active=true, possession=true, deviceConfirmed=true;
  const now=()=>tick;
  const evidence=()=>({authority:'verified_member_enrollment',nativeVerified:true,signupComplete:true,
    verificationMethod,inPersonVerified:verificationMethod==='in_person_signup',
    contactVerified:verificationMethod==='registered_contact',active,studioId:STUDIO_ID,memberId:'417',revision,checkedAt:now()});
  const authority={verifyEnrollment:async ref=>ref==='operator-proof'?evidence():null,
    confirmBinding:async request=>request.memberId==='417'?evidence():null,
    confirmRegistrationEnrollment:async req=>({...evidence(),contactControlVerified:possession,
      staffConfirmedDevice:deviceConfirmed,stepDigest:req.stepDigest,inviteDigest:req.inviteDigest,enrollmentDigest:req.enrollmentDigest})};
  let handle;
  const verify={
    generateRegistrationOptions:async o=>{handle=Buffer.from(o.userID).toString('base64url');return {challenge:token(),user:{id:handle}};},
    generateAuthenticationOptions:async()=>({challenge:token()}),
    verifyRegistrationResponse:async o=>{
      assert.equal(o.expectedOrigin,ORIGIN);assert.equal(o.expectedRPID,RP_ID);assert.equal(o.requireUserVerification,true);
      return {verified:o.response.challenge===o.expectedChallenge,registrationInfo:{credential:{id:fakeId,counter:0,publicKey:Buffer.alloc(32)}}};
    },
    verifyAuthenticationResponse:async o=>{
      assert.equal(o.expectedOrigin,ORIGIN);assert.equal(o.expectedRPID,RP_ID);assert.equal(o.requireUserVerification,true);
      return {verified:o.response.challenge===o.expectedChallenge,authenticationInfo:{newCounter:o.credential.counter+1}};
    }};
  const service=()=>createMemberAccounts({store,authority,now,verify});
  return {service,authority,now,path,dir,store:()=>store,currentHandle:()=>handle,
    advanceBy:ms=>{tick+=ms;},revoke:()=>{active=false;},revision:()=>revision,
    rotate:()=>{revision='b'.repeat(64);},possession:value=>{possession=value;},device:value=>{deviceConfirmed=value;},
    reopen:()=>{store.close();store=openMemberStore(path);}};
}

async function enroll(accounts){
  const invitation=await accounts.issueInvite('operator-proof'), preAuth=token();
  const options=await accounts.registrationOptions(preAuth,invitation.token,enrollmentReceipt);
  assert(options.ok);
  const result=await accounts.register(preAuth,{id:fakeId,challenge:options.options.challenge});
  assert(result.ok);return {result,invitation,preAuth,response:{id:fakeId,challenge:options.options.challenge}};
}

test('OTP ingress budget stops fresh sessions before any private source call',async t=>{
  const f=fixture(t);let sourceCalls=0;
  const handle=createMemberHttpHandler({enabled:true,accounts:f.service(),otp:{start:async()=>{sourceCalls++;}}});
  const post=(cookie='')=>handle(new Request(ORIGIN+'/api/member-access/otp-start',{
    method:'POST',headers:{origin:ORIGIN,'Content-Type':'application/json',cookie},
    body:JSON.stringify({invitation:token()})
  }));
  const first=await post();
  const step=first.headers.getSetCookie()[0].split(';')[0];
  for(let i=0;i<3;i++)assert.equal((await post(step)).status,200);
  assert.equal((await post(step)).status,429);
  for(let i=0;i<8;i++)assert.equal((await post()).status,200);
  assert.equal((await post()).status,429);
  assert.equal(sourceCalls,12);
  f.advanceBy(60_001);
  assert.equal((await post()).status,200);
  assert.equal(sourceCalls,13);
});

test('invite, passkey and session survive restart; a consumed challenge and invite are rejected',async t=>{
  const f=fixture(t);let a=f.service();
  assert.equal(await a.issueInvite('untrusted-reference'),null);
  const ticket=await a.issueInvite('operator-proof');
  assert.equal(await a.issueInvite('operator-proof'),null);
  f.reopen();a=f.service();
  const preAuth=token(), reg=await a.registrationOptions(preAuth,ticket.token,enrollmentReceipt);
  const response={id:fakeId,challenge:reg.options.challenge};
  const races=await Promise.all([a.register(preAuth,response),a.register(preAuth,response)]);
  assert.equal(races.filter(x=>x.ok).length,1);
  const original=races.find(x=>x.ok);
  f.reopen();a=f.service();
  assert.equal((await a.resolveSession(original.token)).memberId,'417');
  assert.equal((await a.registrationOptions(token(),ticket.token,enrollmentReceipt)).ok,false);
  const login=token(), opts=await a.loginOptions(login);
  const assertion={id:fakeId,challenge:opts.options.challenge,response:{userHandle:f.currentHandle()}};
  const verified=await a.login(login,assertion);
  assert(verified.ok);
  assert.equal((await a.login(login,assertion)).ok,false);
  f.advanceBy(20*60_000+1);
  assert.equal(await a.resolveSession(verified.token),null);
  assert.equal(statSync(f.path).mode&0o077,0);
});

test('expired invitation, bad user handle, logout and contact revision block access',async t=>{
  const f=fixture(t),a=f.service();
  const old=await a.issueInvite('operator-proof');f.advanceBy(601_000);
  assert.equal((await a.registrationOptions(token(),old.token,enrollmentReceipt)).ok,false);
  const ep=await enroll(a);
  const step=token(), opts=await a.loginOptions(step);
  const bad={id:fakeId,challenge:opts.options.challenge,response:{userHandle:token()}};
  assert.equal((await a.login(step,bad)).ok,false);
  assert.equal((await a.login(step,{...bad,response:{userHandle:f.currentHandle()}})).ok,false);
  await a.logout(ep.preAuth,ep.result.token);assert.equal(await a.resolveSession(ep.result.token),null);
  const next=token(),x=await a.loginOptions(next);
  const signin=await a.login(next,{id:fakeId,challenge:x.options.challenge,response:{userHandle:f.currentHandle()}});
  f.rotate();
  assert.equal(await a.resolveSession(signin.token),null);
  f.revoke();assert.equal(await a.issueInvite('operator-proof'),null);
});

test('a forwarded registration link is insufficient without contact control on the same step',async t=>{
  const f=fixture(t),a=f.service(), invitation=await a.issueInvite('operator-proof'),step=token();
  assert.equal((await a.registrationOptions(step,invitation.token)).ok,false);
  f.possession(false);
  assert.equal((await a.registrationOptions(step,invitation.token,enrollmentReceipt)).ok,false);
  f.possession(true);
  const good=await a.registrationOptions(step,invitation.token,enrollmentReceipt);
  assert(good.ok);
  f.possession(false);
  assert.equal((await a.register(step,{id:fakeId,challenge:good.options.challenge})).ok,false);
});

test('in-person signup needs staff-confirmed device binding but no contact challenge',async t=>{
  const f=fixture(t,'in_person_signup'),a=f.service();
  f.possession(false);f.device(false);
  const invitation=await a.issueInvite('operator-proof'),step=token();
  assert(invitation?.token);
  assert.equal((await a.registrationOptions(step,invitation.token,enrollmentReceipt)).ok,false);
  f.device(true);
  const options=await a.registrationOptions(step,invitation.token,enrollmentReceipt);
  assert(options.ok);
  const result=await a.register(step,{id:fakeId,challenge:options.options.challenge});
  const session=await a.resolveSession(result.token);
  assert.equal(session.verificationMethod,'in_person_signup');
  assert.equal(session.contactVerified,undefined);
  assert.equal(session.identityVerified,true);
});

function adapter(f,hook=()=>{}){
  const identity={authority:'verified_member_identity',studioId:STUDIO_ID,memberId:'417',
    name:'Synthetic',phone:'01000000001',revision:f.revision()};
  return createStudioMateOwnReader({now:f.now,loadExpectedIdentity:async args=>{
      assert.equal(args.memberId,'417');assert.equal(args.revision,f.revision());return identity;
    },classifyTicket:t=>t.sku==='MOCK-GROUP'?{verified:true,display:true,type:'count',category:'그룹수업'}:null,
    reader:{getOverview:async args=>{
      assert.equal(args.memberId,'417');hook();
      return {memberId:'417',name:identity.name,phone:identity.phone,coverage:'current_ticket_cards',checkedAt:new Date(f.now()).toISOString(),
        tickets:[{sku:'MOCK-GROUP',availableFromDate:'2026-11-01',expiresOn:'2026-12-01',
          remainingCount:9,reservableCount:null,paymentAmount:890000,name:'PRIVATE PRODUCT TEXT'}]};
    },getBookings:async (args,range)=>{
      assert.equal(args.memberId,'417');
      assert.equal((Date.parse(range.endDate)-Date.parse(range.startDate))/86400_000+1,31);
      return {...identity,checkedAt:new Date(f.now()).toISOString(),coverage:{kind:'native_member_booking_history',
        complete:true,traversalComplete:true,requestedRange:range},records:[
          {lectureDate:'2026-11-13',lessonType:'private',sourceStatus:'attendance',bookingId:'SECRET'},
          {lectureDate:'2026-11-15',lessonType:'group',sourceStatus:'cancel'},
          {lectureDate:'2026-11-12',lessonType:'group',sourceStatus:'attendance',staffName:'SECRET'}]};
    }}
  });
}

test('own reader projects only allowed fields, checks identity and discards output on revocation during read',async t=>{
  const f=fixture(t),accounts=f.service(), {result}=await enroll(accounts);
  const lookup=createOwnLookup({accounts,now:f.now,readOwn:adapter(f)});
  const passes=await lookup(result.token,'cards');
  assert.deepEqual(passes.cards,[{category:'그룹수업',type:'count',remaining:9,bookable:null,expiresOn:'2026-12-01'}]);
  assert.doesNotMatch(JSON.stringify(passes),/890000|PRIVATE PRODUCT|01000000001|417/);
  const history=await lookup(result.token,'history');
  assert.deepEqual(history.history,[{date:'2026-11-13',category:'개인·듀엣 계열',status:'출석'},
    {date:'2026-11-12',category:'그룹수업',status:'출석'}]);
  assert.doesNotMatch(JSON.stringify(history),/SECRET|2026-11-15/);
  const wrong=createOwnLookup({accounts,now:f.now,readOwn:async()=>({memberId:'418',checkedAt:f.now(),rows:passes.cards})});
  assert.equal(await wrong(result.token,'cards'),null);
  const revoked=createOwnLookup({accounts,now:f.now,readOwn:adapter(f,()=>f.revoke())});
  assert.equal(await revoked(result.token,'cards'),null);
});

test('public protocol rejects member ID injection, unscoped URLs and disabled deployments',async t=>{
  const f=fixture(t),accounts=f.service(), {result}=await enroll(accounts);
  const handle=createMemberHttpHandler({enabled:true,accounts,lookup:createOwnLookup({accounts,readOwn:adapter(f),now:f.now})});
  const req=(path,body={},headers={})=>new Request(ORIGIN+'/api/member-access/'+path,{method:'POST',
    headers:{Origin:ORIGIN,'Content-Type':'application/json',Cookie:'__session=-.'+result.token,...headers},
    body:JSON.stringify(body)});
  assert.equal((await createMemberHttpHandler()(req('cards'))).status,404);
  assert.throws(()=>createPrivateMemberPilot({enabled:true,storePath:f.path}));
  assert.equal((await handle(req('issue-invite',{memberId:'417'}))).status,404);
  assert.equal((await handle(req('cards',{memberId:'418'}))).status,400);
  assert.equal((await handle(req('cards',{}, {Origin:'https://example.org'}))).status,403);
  assert.equal((await handle(req('cards',{}, {Cookie:''}))).status,403);
  assert.equal((await handle(req('cards',{}, {Cookie:`__session=-.${result.token}; __session=-.${result.token}`}))).status,403);
  assert.equal((await handle(req('history',{memberId:'418'}))).status,400);
  assert.equal((await handle(req('cards?memberId=418'))).status,404);
  assert.equal((await handle(req('cards',{pad:'a'.repeat(8192)}))).status,400);
  const ok=await handle(req('cards'));
  assert.equal(ok.status,200);
  assert.match(ok.headers.get('cache-control'),/no-store/);
  assert.equal((await ok.json()).cards.length,1);
  const options=await handle(req('login-options'));
  assert.equal(options.headers.getSetCookie().length,1);
  assert.match(options.headers.getSetCookie()[0],/^__session=.*Path=\/api\/member-access\/; Secure; HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(options.headers.getSetCookie()[0],/Domain=/i);
  assert.doesNotMatch(JSON.stringify(await options.json()),/417|01000000001/);
  const out=await handle(req('logout'));assert.equal(out.status,200);
  assert.equal((await handle(req('cards'))).status,403);
});

test('the account store rejects symbolic links instead of following them',t=>{
  const f=fixture(t), link=join(f.dir,'alternate.sqlite');
  symlinkSync(f.path,link);
  assert.throws(()=>openMemberStore(link),/Owner-only store file/);
});

test('remote verification is separate, browser-bound, single-use and silent during quiet hours',async t=>{
  const f=fixture(t,'in_person_signup'),accounts=f.service(),sent=[];
  const otp=createRemoteOtp({store:f.store(),accounts,now:f.now,secret:randomBytes(32),
    resolveRecipient:async req=>({authority:'studiomate_registered_contact',studioId:STUDIO_ID,memberId:req.memberId,
      revision:req.revision,checkedAt:f.now(),verified:true,phone:'01000000001'}),
    sendCode:async data=>{assert(data.mayDispatch());sent.push(data);return {accepted:true};}});
  const night=await accounts.issueInvite('operator-proof');
  assert.deepEqual(await otp.start(token(),night.token),{ok:true});
  assert.equal(sent.length,0);
  f.advanceBy(9*3600_000);
  const invite=await accounts.issueInvite('operator-proof'), step=token(), other=token();
  await Promise.all([otp.start(step,invite.token),otp.start(other,invite.token)]);
  assert.equal(sent.length,1);
  const code=sent[0].code;
  assert.equal((await otp.verify(other,invite.token,code)).ok,false);
  const r=await otp.verify(step,invite.token,code);
  assert(r.ok);
  const inv=await accounts.resolveOpenInvitation(invite.token);
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const proof={account:inv.account,inviteDigest:inv.inviteDigest,stepDigest:hash(step),enrollmentDigest:hash(r.enrollmentReceipt)};
  assert.equal(await otp.matches(proof),true);
  assert.equal(await otp.matches({...proof,stepDigest:hash(other)}),false);
  assert.equal((await otp.verify(step,invite.token,code)).ok,false);
});

test('an uncertain code request is not replayed, and five wrong entries lock the code',async t=>{
  const f=fixture(t,'in_person_signup'),accounts=f.service(),sent=[];
  f.advanceBy(9*3600_000);
  const invite=await accounts.issueInvite('operator-proof'),step=token();
  const otp=createRemoteOtp({store:f.store(),accounts,now:f.now,secret:randomBytes(32),
    resolveRecipient:async req=>({authority:'studiomate_registered_contact',studioId:STUDIO_ID,memberId:req.memberId,
      revision:req.revision,checkedAt:f.now(),verified:true,phone:'01000000001'}),
    sendCode:async data=>{sent.push(data);throw Error('ambiguous transport');}});
  await otp.start(step,invite.token);
  await otp.start(step,invite.token);
  assert.equal(sent.length,1);
  const wrong=sent[0].code==='000000'?'000001':'000000';
  for(let i=0;i<5;i++)assert.equal((await otp.verify(step,invite.token,wrong)).ok,false);
  assert.equal((await otp.verify(step,invite.token,sent[0].code)).ok,false);
  f.advanceBy(5*60_000+1);
  assert(await accounts.resolveOpenInvitation(invite.token));
  await otp.start(token(),invite.token);
  assert.equal(sent.length,1);
});

test('an otherwise valid code expires before its invitation and cannot be replayed',async t=>{
  const f=fixture(t,'in_person_signup'),accounts=f.service(),sent=[];
  f.advanceBy(9*3600_000);
  const invite=await accounts.issueInvite('operator-proof'),step=token();
  const otp=createRemoteOtp({store:f.store(),accounts,now:f.now,secret:randomBytes(32),
    resolveRecipient:async req=>({authority:'studiomate_registered_contact',studioId:STUDIO_ID,memberId:req.memberId,
      revision:req.revision,checkedAt:f.now(),verified:true,phone:'01000000001'}),
    sendCode:async data=>{sent.push(data);return {accepted:true};}});
  await otp.start(step,invite.token);
  f.advanceBy(5*60_000);
  assert(await accounts.resolveOpenInvitation(invite.token));
  assert.equal((await otp.verify(step,invite.token,sent[0].code)).ok,false);
  await otp.start(step,invite.token);
  assert.equal(sent.length,1);
});
