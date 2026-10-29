import assert from 'node:assert/strict';
import { readFile, mkdir, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets } from './lib/studiomate-native-contract-source.mjs';

const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const admin = require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
const { chromium } = require('playwright');
const ids = ['ilr_6685071b1f94a42a4a2b9cc2','ilr_11220626f43287e672165c95','ilr_0882918f3696516a12e99baa',
  'ilr_5645aa92361ec38ac3341284','ilr_1a419dab0dc80e8c175f0096','ilr_a48e0e3d5c7e4b8c5c65cb13'];
const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json','utf8'))), projectId:'archive-pilates' });
let release, context;
try {
  const docs = await app.firestore().getAll(...ids.map(id => app.firestore().doc('instructorLessonRegistrations/'+id)));
  const inputs = docs.map(s => ({id:s.id,...s.data()}));
  assert(inputs.every(r => r.studioId==='5330' && r.courseKind==='team' && r.lessonDate==='2026-11-20'
    && r.lessonTime==='14:00' && r.lessonTopic==='ARCHIVE METHOD #1 직장인 증후군'
    && r.paymentAmount===80000 && r.paymentMethod==='wiretransfer' && !r.cancellation));
  release = await acquireStudioMateBrowserLock({owner:'team-261120-readonly-source',waitMs:120000});
  context = await chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/browser-profile',{headless:true});
  const page = await context.newPage();
  await page.route('**/*', route => route.request().url().includes('studiomate')
    && !['GET','HEAD','OPTIONS'].includes(route.request().method()) ? route.abort() : route.continue());
  const api = await captureStudioMateNativeApiClient(page);
  const rows=[];
  for (const r of inputs) {
    const member=await readExactStudioMateMember(api,r.memberPhone);
    if(member.member) assert.equal(member.member.name,r.memberName);
    const tickets=member.status==='verified' ? await readStudioMateUserTickets(api,member.member.memberId) : null;
    rows.push({registrationId:r.id,memberName:r.memberName,member,tickets,checkedAt:new Date().toISOString()});
  }
  const lectures=await api.get('/v2/staff/lectures?start_date=2026-11-20&end_date=2026-11-20&limit=100&page=1&sort_by_name=start_on&sort_by_type=asc&with=room%3Bdivision%3Bstaff.profile');
  assert(Array.isArray(lectures.data)&&lectures.meta?.last_page===1&&lectures.data.length===lectures.meta?.total);
  const member=rows.find(r=>r.member.status==='verified');
  let teamProducts=[];
  if(member){
    await page.goto('https://arcpilates.studiomate.kr/users/detail?id='+member.member.member.memberId,{waitUntil:'networkidle'});
    const cards=page.locator('.member-basic__user-tickets').first().locator('.userticket-card, .ticket-card');
    await cards.filter({hasText:'새로운 수강권 만들기'}).click();
    const dialog=page.locator('.ticket-issue-modal');await dialog.waitFor({state:'visible'});
    await dialog.locator('input[placeholder="수강권명 검색"]').fill('Team 강사레슨');
    await dialog.locator('.ticket-card h3').filter({hasText:/^Team 강사레슨$/}).waitFor({state:'visible'});
    teamProducts=await dialog.locator('.ticket-card').evaluateAll(nodes=>nodes.map(n=>({text:n.innerText,id:n.getAttribute('data-id')})));
    await dialog.getByRole('button',{name:'닫기',exact:true}).click().catch(()=>{});
  }
  const dir='/Users/archivepilates/ArchiveIN/operations/team-instructor-fulfillment-20261029';
  await mkdir(dir,{recursive:true,mode:0o700});
  const output=dir+'/native-'+Date.now()+'.json';
  const file=await open(output,'wx',0o600);
  try { await file.writeFile(JSON.stringify({rows,lectures,teamProducts,checkedAt:new Date().toISOString()},null,2));await file.sync(); } finally {await file.close();}
  console.log(JSON.stringify({ok:true,output,rows:rows.map(r=>({name:r.memberName,status:r.member.status,reason:r.member.reason,
    memberId:r.member.member?.memberId,tickets:r.tickets?.tickets?.map(t=>({name:t.title,start:t.availabilityStartAt,end:t.expireAt,active:t.active}))})),
    teamProducts,lectures:lectures.data.filter(r=>/강사|team|메소드/i.test([r.title,r.description].join(' '))).map(r=>({id:r.id,title:r.title,description:r.description,start:r.start_on,end:r.end_on,capacity:r.max_trainee,room:r.room?.name,staff:r.staff?.name}))}));
} finally {try {await context?.close();} finally {await release?.();await app.delete();}}
