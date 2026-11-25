import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {extname,join} from 'node:path';
import {ORIGIN} from './accounts.mjs';
import {createConsultationOtp} from './consultation-otp.mjs';
import {CONVERSATION_HEADER,createConsultationCardLookup,createConsultationMemberHandler} from './consultation-http.mjs';
import {createFirebaseMemberBridge} from './firebase-bridge.mjs';
import {openMemberStore} from './store.mjs';

const {chromium}=createRequire(process.env.ARCHIVE_PLAYWRIGHT_PACKAGE??import.meta.url)('playwright');
const dir=realpathSync(mkdtempSync(join(tmpdir(),'archive-help-otp-browser-')));
let store,browser,context;
let clock=Date.parse('2026-11-25T03:00:00Z'), snapshotAvailable=true, revoked=false;
const now=()=>clock, startTime=now(), phone='01000000417', received=[], steps=[], grants=new Set();
const secret=randomBytes(32), revision='a'.repeat(64);
const binding=()=>({authority:'verified_studiomate_in_person_signup',studioId:'5330',memberId:'417',revision,
  sourceObservedAt:startTime,registeredContactVerified:true,active:!revoked,revoked,signupComplete:true});
const contentTypes={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
let providerCalls=0;

try{
  store=openMemberStore(join(dir,'auth.sqlite'));
  const consultation=createConsultationOtp({store,now,secret,
    loadPilotBinding:async ({needContact})=>({...binding(),...(needContact?{phone}:{})}),
    sendCode:async data=>{
      assert.equal(data.to,phone);assert.equal(data.mayDispatch(),true);received.push(data.code);return {accepted:true};
    }});
  const issuer={issue:async ({token,binding:own})=>{
    assert.equal(own.memberId,'417');assert.equal(own.revision,revision);grants.add(token);
  },revoke:async token=>{grants.delete(token);}};
  const reader=async token=>{
    assert.ok(grants.has(token));
    return snapshotAvailable?{checkedAt:new Date(startTime).toISOString(),cards:[
      {category:'group',type:'count',status:'active',remaining:5,bookable:3,expiresOn:'2026-12-10'}
    ]}:null;
  };
  const lookup=createConsultationCardLookup({consultation,issuer,reader,now});
  const handler=createConsultationMemberHandler({enabled:true,consultation,lookup,stepSecret:secret,allowRequest:async()=>true});
  const bridge=createFirebaseMemberBridge({getHandler:async()=>handler});
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:820}});
  let cookie='',oldCookie='',originalConversation;
  await context.route('**/*',async route=>{
    const raw=route.request(),url=new URL(raw.url());
    if(url.origin!==ORIGIN)return route.abort();
    if(url.pathname==='/api/public-chat-intent'){
      if(raw.method()==='GET')return route.fulfill({json:{natural:false}});
      providerCalls++;assert.doesNotMatch(raw.postData()??'',new RegExp(phone));
      return route.fulfill({json:{ok:false},status:503});
    }
    if(!url.pathname.startsWith('/api/member-access/')){
      const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(raw.method()!=='GET'||!/^[a-zA-Z0-9._/-]+$/.test(file)||file.includes('..')||!contentTypes[extname(file)])return route.abort();
      return route.fulfill({contentType:contentTypes[extname(file)],body:readFileSync(new URL('../../help/'+file,import.meta.url))});
    }
    const op=url.pathname.split('/').at(-1), headers=await raw.allHeaders();
    steps.push(op);
    if(op==='otp-start')originalConversation=headers[CONVERSATION_HEADER];
    const res={status(n){this.code=n;return this;},headers:{},set(name,value){this.headers[name.toLowerCase()]=value;return this;},
      send(data){this.body=data;return this;},json(value){this.body=Buffer.from(JSON.stringify(value));return this;}};
    await bridge({method:raw.method(),originalUrl:url.pathname+url.search,rawBody:Buffer.from(raw.postData()??''),
      get:name=>name==='cookie'?cookie:headers[name]},res);
    if(res.headers['set-cookie']){
      const value=res.headers['set-cookie'][0];
      assert.match(value,/Path=\/api\/member-access\/; Secure; HttpOnly; SameSite=Strict/u);
      cookie=value.split(';')[0];
      if(op==='otp-verify'&&res.code===200)oldCookie=cookie;
    }
    return route.fulfill({status:res.code,contentType:'application/json',body:res.body});
  });
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date(clock));
  await page.goto(ORIGIN+'/');
  const ask=async()=>{const box=page.getByRole('textbox',{name:'궁금한 내용'});await box.fill('내 수강권 몇 회 남았어?');await box.press('Enter');};
  const answers=page.locator('[data-member-private]');
  const authButton=page.getByRole('button',{name:/회원 인증/});
  await ask();
  assert.equal(await authButton.count(),0);
  assert.ok(!steps.includes('availability'));
  await page.goto(ORIGIN+'/?member-pilot=1');
  await ask();await authButton.last().click();
  const dialog=page.getByRole('dialog');
  assert.equal(await dialog.getByText(/패스키/).count(),0);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:820});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth
      &&document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth),true);
  }
  await page.setViewportSize({width:390,height:820});
  await dialog.getByRole('textbox',{name:/휴대전화/u}).fill(phone);
  await dialog.getByRole('button',{name:/인증번호.*(받기|요청)/u}).click();
  const code=dialog.getByRole('textbox',{name:/인증번호/u});
  await code.waitFor();
  assert.equal(received.length,1);
  await code.fill(received[0]);
  await dialog.getByRole('button',{name:/인증하기/u}).click();
  await answers.last().waitFor();
  assert.match(await answers.last().innerText(),/잔여 5회.*예약 가능 3회/u);
  clock+=45*60_000;await page.clock.setFixedTime(new Date(clock));
  snapshotAvailable=false;
  const noData=page.waitForResponse(r=>r.url().endsWith('/api/member-access/cards')&&r.status()===503);
  await ask();await noData;
  snapshotAvailable=true;
  const fresh=page.waitForResponse(r=>r.url().endsWith('/api/member-access/cards')&&r.status()===200);
  await ask();await fresh;await answers.last().waitFor();
  assert.equal(await dialog.isVisible(),false);assert.equal(received.length,1);
  const fakeTab=async conversation=>handler(new Request(ORIGIN+'/api/member-access/cards',{method:'POST',headers:{
    origin:ORIGIN,'content-type':'application/json',cookie:oldCookie,[CONVERSATION_HEADER]:conversation},body:'{}'}));
  assert.equal((await fakeTab(secret.toString('base64url'))).status,403);
  assert.equal((await fakeTab(originalConversation)).status,200);
  const logout=page.waitForResponse(r=>r.url().endsWith('/api/member-access/logout')&&r.ok());
  await page.locator('#reset-chat').click();await logout;
  assert.equal(await answers.count(),0);
  assert.equal((await fakeTab(originalConversation)).status,403);
  assert.ok(!steps.some(x=>['login','register','registration-options'].includes(x)));
  assert.equal(providerCalls,0);assert.equal(grants.size,0);
  console.log(JSON.stringify({otpOnly:true,sameConsultationAfterMinutes:45,unavailableSnapshotDidNotEndSession:true,
    wrongTabBlocked:true,resetRevoked:true,checkedWidths:[320,390,768,1440],realSends:0,externalRequests:0}));
}finally{
  await context?.close();await browser?.close();store?.close();rmSync(dir,{recursive:true,force:true});
}
