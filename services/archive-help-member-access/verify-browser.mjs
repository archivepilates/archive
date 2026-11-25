import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
import {createPrivateMemberPilot} from './index.mjs';
import {createInternalStudioMatePilot} from './internal-studiomate.mjs';
import {createHostedHelpMemberService} from './hosted-pass-service.mjs';
import {createCloudEnrollmentAuthority} from './cloud-enrollment-authority.mjs';
import {currentPassMemberKey} from './current-pass-snapshot.mjs';
import {createPostgresAuthStore} from './postgres-auth-store.mjs';
import {digest,ORIGIN,STUDIO_ID} from './accounts.mjs';

// Intercept every browser request. The real WebAuthn verifier sees synthetic records only.
const {chromium}=createRequire(process.env.ARCHIVE_PLAYWRIGHT_PACKAGE??import.meta.url)('playwright');
const dir=realpathSync(mkdtempSync(join(tmpdir(),'archive-help-member-browser-')));
const path=join(dir,'member.sqlite');
const clock=Date.parse('2026-11-24T02:00:00Z'),now=()=>clock;
let active=true,rev='b'.repeat(64),calls=0,publicGptPosts=0;
const received=[],secret=randomBytes(32);
const hosted=process.env.ARCHIVE_HELP_BROWSER_MODE==='hosted';
const memberKeySecret=randomBytes(32), issuedReadSessions=new Map();
const hostRef=randomBytes(32).toString('base64url');
const proof=()=>({authority:'verified_member_enrollment',nativeVerified:true,signupComplete:true,
  verificationMethod:'in_person_signup',inPersonVerified:true,active,studioId:STUDIO_ID,memberId:'79417',revision:rev,checkedAt:now()});
const identity=()=>({authority:'verified_member_identity',studioId:STUDIO_ID,memberId:'79417',revision:rev,
  name:'Synthetic Only',phone:'01000000001'});
const authority={verifyEnrollment:async key=>key==='confirmed-synthetic-enrollment'?proof():null,
  confirmBinding:async ({memberId})=>memberId==='79417'?proof():null};
const remoteOtp={secret,resolveRecipient:async request=>({authority:'studiomate_registered_contact',studioId:STUDIO_ID,
  memberId:request.memberId,revision:request.revision,verified:true,checkedAt:now(),phone:identity().phone}),
  sendCode:async ({code,mayDispatch})=>{assert(mayDispatch());received.push(code);return {accepted:true};}};
const nativePilot=()=>createInternalStudioMatePilot({enabled:true,storePath:path,now,authority,remoteOtp,
  loadExpectedIdentity:async ({memberId,revision})=>memberId==='79417'&&revision===rev?identity():null,
  classifyTicket:t=>t.name==='Verified fixture'?{verified:true,display:true,type:'count',category:'그룹수업'}:null,
  makeAdminReader:()=>({getOverview:async who=>{
    calls++;assert.equal(who.memberId,'79417');assert.equal(who.phone,identity().phone);
    return {...identity(),checkedAt:new Date(now()).toISOString(),coverage:'current_ticket_cards',tickets:[
      {name:'Verified fixture',availableFromDate:'2026-11-01',expiresOn:'2026-12-10',remainingCount:5,reservableCount:3,paymentAmount:1004000}]};
  },getBookings:async (_who,range)=>({...identity(),checkedAt:new Date(now()).toISOString(),
    coverage:{kind:'native_member_booking_history',complete:true,traversalComplete:true,requestedRange:range},records:[]})})});
const hostedPilot=()=>{
  const cloudAuthority=createCloudEnrollmentAuthority({now,
    loadEnrollment:async ({referenceDigest})=>referenceDigest===digest(hostRef)?{
      authority:'approved_help_enrollment',approved:true,studioId:STUDIO_ID,memberId:'79417',revision:rev,expiresAt:now()+60_000}:null,
    loadCurrentBinding:async ({memberId})=>memberId==='79417'?{...identity(),authority:'verified_studiomate_in_person_signup',
      signupComplete:true,active,revoked:!active,registeredContactVerified:true,sourceObservedAt:now()-1000}:null});
  const issuerQuery=async (sql,args)=>{
    if(sql.includes('.revoke_read_session(')){issuedReadSessions.delete(args[0]);return;}
    assert.match(sql,/\.issue_read_session\(/);
    assert.equal(args[1],currentPassMemberKey(memberKeySecret,identity().memberId));
    assert.equal(args[2],rev);
    issuedReadSessions.set(args[0],Date.parse(args[3]));
  };
  const readerQuery=async (sql,args)=>{
    assert.match(sql,/\.read_own\(/);assert.equal(args.length,1);calls++;
    return {rows:[{result:{observedAt:new Date(now()).toISOString(),expiresAt:issuedReadSessions.get(args[0]),
      cards:[{category:'group',type:'count',status:'active',startsOn:'2026-11-01',expiresOn:'2026-12-10',remaining:5,bookable:3}]}}]};
  };
  const store=createPostgresAuthStore({pool:localPool});
  return {...createHostedHelpMemberService({enabled:true,store,authority:cloudAuthority,now,memberKeySecret,issuerQuery,readerQuery,
    remoteOtp:{...remoteOtp,resolveRecipient:cloudAuthority.resolveRecipient}}),
    close(){}};
};
const pilot=hosted?hostedPilot:nativePilot;
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
let service,browser,ctx,authDb;
let queue=Promise.resolve();
const localPool={async connect(){
  const previous=queue;
  let release;
  queue=new Promise(resolve=>{release=resolve;});
  await previous;
  return {async query(sql,args){
    if(sql.startsWith('SELECT '))return authDb.query(sql,args);
    await authDb.exec(sql);
    return {command:sql.split(' ')[0]};
  },release};
}};
try{
  if(hosted){
    const dependencyFile=process.env.ARCHIVE_HELP_PGLITE_PACKAGE_JSON??
      '/Users/archivepilates/archive-automation/operations/2026-11-20-supabase-history-pilot/package.json';
    const {PGlite}=createRequire(dependencyFile)('@electric-sql/pglite');
    authDb=await PGlite.create();
    await authDb.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role');
    await authDb.exec(readFileSync(new URL('../archivepilates-mcp/sql/help-member-auth-store.sql',import.meta.url),'utf8'));
  }
  service=await pilot();
  browser=await chromium.launch({headless:true});
  ctx=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:820}});
  const jar=new Map();
  await ctx.route('**/*',async route=>{
    const raw=route.request(),url=new URL(raw.url());
    if(url.origin!==ORIGIN)return route.abort();
    if(url.pathname==='/api/public-chat-intent'){
      if(raw.method()==='GET')return route.fulfill({json:{natural:true}});
      publicGptPosts++;
      return route.fulfill({status:503,json:{ok:false}});
    }
    if(!url.pathname.startsWith('/api/member-access/')){
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(raw.method()!=='GET'||!/^[a-zA-Z0-9._/-]+$/.test(name)||name.includes('..')||!mime[extname(name)])return route.abort();
      return route.fulfill({contentType:mime[extname(name)],body:readFileSync(new URL('../../help/'+name,import.meta.url))});
    }
    const headers=await raw.allHeaders();
    headers.cookie=[...jar].map(([k,v])=>k+'='+v).join('; ');
    const result=await service.handle(new Request(raw.url(),{method:raw.method(),headers,body:raw.postData()}));
    for(const h of result.headers.getSetCookie()){
      const [pair,...attributes]=h.split(';'),[k,v]=pair.split('=');
      assert(attributes.includes(' Secure')&&attributes.includes(' HttpOnly')&&attributes.includes(' SameSite=Strict')
        &&attributes.includes(' Path=/api/member-access/'));
      assert.equal(k,'__session');
      if(v)jar.set(k,v);else jar.delete(k);
    }
    return route.fulfill({status:result.status,contentType:'application/json',body:await result.text()});
  });
  const page=await ctx.newPage(),cdp=await ctx.newCDPSession(page);
  await page.clock.setFixedTime(new Date(clock));
  await cdp.send('WebAuthn.enable');
  const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',
    hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  const ticket=await service.issueInvite(hosted?hostRef:'confirmed-synthetic-enrollment');
  assert(ticket?.token);
  await page.goto(ORIGIN+'/#member-invite='+ticket.token);
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  assert.equal(new URL(page.url()).hash,'');
  const ask=async q=>{const input=page.getByRole('textbox',{name:'궁금한 내용'});await input.fill(q);await input.press('Enter');};
  const call=(path,input={})=>page.evaluate(async ({path,input})=>{
    const r=await fetch('/api/member-access/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    return {status:r.status,body:await r.json()};
  },{path,input});
  assert.equal((await call('cards')).status,403);assert.equal(calls,0);
  await ask('내 수강권 몇 회 남았어?');
  await page.getByRole('button',{name:'회원 인증 후 확인',exact:true}).click();
  await page.getByRole('button',{name:'인증번호 받기',exact:true}).click();
  const code=page.getByLabel('알림톡 인증번호');
  await code.waitFor();
  assert.equal(received.length,1);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:800});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth
      &&document.getElementById('member-access').scrollWidth<=document.getElementById('member-access').clientWidth));
  }
  await page.setViewportSize({width:390,height:820});
  await code.fill(received[0]);
  await page.getByRole('button',{name:'번호 확인',exact:true}).click();
  await page.getByRole('button',{name:'패스키 등록',exact:true}).click();
  const answer=page.locator('[data-member-private]');
  await answer.waitFor();
  assert.match(await answer.innerText(),/잔여 5회.*예약 가능 3회/);
  assert.equal(await page.locator('#member-access').isVisible(),false);
  assert.equal(await page.getByText(received[0],{exact:true}).count(),0);
  const keys=await cdp.send('WebAuthn.getCredentials',{authenticatorId});assert.equal(keys.credentials.length,1);
  await service.close();service=await pilot();
  const own=await call('cards');
  assert.equal(own.status,200);assert.equal(own.body.cards[0].bookable,3);
  assert.doesNotMatch(JSON.stringify(own.body),/79417|Synthetic Only|01000000001|1004000/);
  assert.equal((await call('cards',{memberId:'79418'})).status,400);
  assert.equal((await call('history',{memberId:'79418'})).status,400);
  assert.equal((await call('history?memberId=79418')).status,404);
  assert.equal((await call('history')).status,hosted?403:200);
  await page.getByRole('button',{name:'인증 종료',exact:true}).click();
  await answer.waitFor({state:'detached'});
  assert.equal((await call('cards')).status,403);
  assert.equal(issuedReadSessions.size,0);
  assert.equal((await call('otp-verify',{invitation:ticket.token,code:received[0]})).status,400);
  await ask('내 수강권 몇 회 남았어?');
  await page.getByRole('button',{name:'회원 인증 후 확인',exact:true}).last().click();
  await page.getByRole('button',{name:'패스키로 로그인',exact:true}).click();
  await answer.waitFor();
  assert.equal(received.length,1);
  active=false;rev='c'.repeat(64);
  assert.equal((await call('cards')).status,403);
  assert.equal(calls,3);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await service.close();service=createPrivateMemberPilot();
  await page.reload();
  await ask('내 수강권 몇 회 남았어?');
  assert.equal(await page.getByRole('link',{name:'회원 앱에서 확인하는 방법',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'회원 인증 후 확인',exact:true}).count(),0);
  assert.equal(await answer.count(),0);
  assert.equal(publicGptPosts,0);
  console.log(JSON.stringify({backend:hosted?'hosted-snapshot':'native-pilot',virtualWebAuthn:true,restartPersisted:true,lookupScopeEnforced:true,
    separateSyntheticOtp:true,automaticResume:true,noSecondOtp:true,revokedBlocked:true,
    responsiveWidths:[320,390,768,1440],liveExternalRequests:0,publicGptPosts}));
}finally{
  await ctx?.close();await browser?.close();await service?.close();await authDb?.close();rmSync(dir,{recursive:true,force:true});
}
