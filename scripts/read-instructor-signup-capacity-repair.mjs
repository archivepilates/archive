import assert from 'node:assert/strict';
import { readFile, mkdir, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { acquireEformsignBrowserLock } from './lib/eformsign-browser-lock.mjs';
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets } from './lib/studiomate-native-contract-source.mjs';
import { assertTeamLectures } from './lib/team-261120-scope.mjs';
import { parseCompletedRecipientStatus } from './lib/instructor-signup-order-identity.mjs';

const require=createRequire(import.meta.url), admin=require('../firebase/kangsain-functions/functions/node_modules/firebase-admin');
const {chromium}=require('playwright');
const id='ilr_b4c0fd50f082d92a1735f196',documentId='f3a607291be0429c8add02b4ddcbb893';
const app=admin.initializeApp({credential:admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json','utf8'))),projectId:'archive-pilates'});
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
let context,release,stage='registration';
const diagnostics=[];
try{
  const registration=await app.firestore().doc('instructorLessonRegistrations/'+id).get(),r=registration.data();
  assert(r.memberName==='안소은' && r.lessonDate==='2026-11-28' && r.evidence.studiomateMemberId==='4342056');
  stage='native_read';release=await acquireStudioMateBrowserLock({owner:'instructor-signup-capacity-readonly',waitMs:120000});
  context=await chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/browser-profile',{headless:true});
  const page=await context.newPage();
  await page.route('**/*',route=>route.request().url().includes('studiomate')&&!['GET','HEAD','OPTIONS'].includes(route.request().method())?route.abort():route.continue());
  const api=await captureStudioMateNativeApiClient(page),member=await readExactStudioMateMember(api,r.memberPhone);
  assert(member.status==='verified' && member.member.memberId==='4342056' && member.member.name===r.memberName);
  const tickets=await readStudioMateUserTickets(api,member.member.memberId);
  const lectures=await api.get('/v2/staff/lectures?start_date=2026-11-20&end_date=2026-11-20&limit=100&page=1&sort_by_name=start_on&sort_by_type=asc&with=room%3Bdivision%3Bstaff.profile');
  const selected=assertTeamLectures(lectures),nativeCheckedAt=new Date().toISOString();
  await context.close();context=null;await release();release=null;
  release=await acquireEformsignBrowserLock({owner:'instructor-signup-repair-readonly',waitMs:120000});
  context=await chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/eformsign-browser-profile',{headless:true,serviceWorkers:'block'});
  const eform=await context.newPage();
  await context.route('**/*',route=>{
    const req=route.request(),url=new URL(req.url());
    if(!['GET','HEAD','OPTIONS'].includes(req.method())) diagnostics.push({method:req.method(),host:url.hostname,path:url.pathname});
    const readSearch=req.method()==='POST' && ['www.eformsign.com','kr-service.eformsign.com'].includes(url.hostname)
      && /^\/v1\.0\/companies\/[a-f0-9]{32}\/documents$/.test(url.pathname);
    const readMetadata=req.method()==='POST'&&url.hostname==='kr-service.eformsign.com'&&[
      '/v1.0/companies/848f6dc7fa024a6cb28a2994c0835e53/members/archivepilates@gmail.com/unstructured_forms',
      '/v1.0/companies/848f6dc7fa024a6cb28a2994c0835e53/multi_category_by_permission'].includes(url.pathname);
    return ['GET','HEAD','OPTIONS'].includes(req.method())||readSearch||readMetadata?route.continue():route.abort();
  });
  stage='eform_navigation';await eform.goto('https://www.eformsign.com/eform/document/document_list.html?mode=ai',{waitUntil:'networkidle'});
  assert((await eform.locator('body').innerText()).includes('archivepilates@gmail.com'));
  stage='eform_initial_rows';await eform.locator('#RWDtable tr[id]').first().waitFor({state:'visible'});
  await eform.locator('#simpleSearchKey').fill(r.memberName);
  const statusWait=eform.waitForResponse(res=>res.request().method()==='GET'&&new URL(res.url()).pathname.endsWith('/documents/'+documentId+'/status'));
  const responseWait=eform.waitForResponse(res=>{
    try{return res.request().method()==='POST' && /\/documents$/.test(new URL(res.url()).pathname)
      && res.request().postDataJSON()?.input?.query?.search===r.memberName;}catch{return false;}
  });
  stage='search_response';const [response]=await Promise.all([responseWait,eform.locator('#simpleSearchButton').click()]);
  const body=await response.json();
  assert(response.status()===200 && body.status==='200' && body.code==='-1' && body.result.total_rows===1 && body.result.documents.length===1);
  stage='searched_row';await eform.locator('#RWDtable').getByRole('row').filter({hasText:'2025-12-30_강사회원가입서__안소은'}).waitFor({state:'visible'});
  const row=eform.locator('#RWDtable tr').filter({hasText:'2025-12-30_강사회원가입서__안소은'});
  assert(await row.count()===1);
  const href=await row.locator('a[href*="view_service.html"]').getAttribute('href');
  assert(href.includes(documentId)&&href.includes('a5b5ea6b85ec44c8bcb4af1e980e94eb'));
  assert(await row.getAttribute('id')===documentId);
  stage='document_status';await row.click({position:{x:15,y:15}});
  const statusResponse=await statusWait;
  const statusBody=await statusResponse.json();
  const recipientProof=parseCompletedRecipientStatus({responseUrl:statusResponse.url(),method:statusResponse.request().method(),httpStatus:statusResponse.status(),
    body:statusBody,selectedDocumentId:documentId,templateId:'a5b5ea6b85ec44c8bcb4af1e980e94eb',
    job:{documentId,documentName:'2025-12-30_강사회원가입서__안소은'}});
  assert(recipientProof.recipients.length===1&&recipientProof.recipients[0].name===r.memberName&&recipientProof.recipients[0].phone===r.memberPhone);
  stage='completed_source_verified';
  const completedAt=new Date(Number(statusBody.result.status.steps[2].execute_date)).toISOString();
  const proof={version:1,registrationId:id,registrationUpdateTime:registration.updateTime.toDate().toISOString(),
    member:member.member,tickets,lectures:lectures.data.filter(x=>selected.some(s=>s.id===String(x.id))),
    lectureCoverage:{total:lectures.meta.total,complete:true},nativeCheckedAt,
    completedSignup:{documentId,templateId:'a5b5ea6b85ec44c8bcb4af1e980e94eb',documentName:'2025-12-30_강사회원가입서__안소은',
      status:'completed',memberName:r.memberName,memberPhone:r.memberPhone,recipientCount:recipientProof.recipients.length,completedAt,
      searchTotal:1,historyHash:sha(statusBody),checkedAt:new Date().toISOString()},checkedAt:new Date().toISOString()};
  const dir='/Users/archivepilates/ArchiveIN/operations/instructor-signup-capacity-repair-20261029';
  await mkdir(dir,{recursive:true,mode:0o700});const output=dir+'/source-'+Date.now()+'.json';
  const file=await open(output,'wx',0o600);try{await file.writeFile(JSON.stringify(proof,null,2));await file.sync();}finally{await file.close();}
  console.log(JSON.stringify({ok:true,output,hash:sha(proof),memberId:proof.member.memberId,documentId,completed:true,
    lectures:selected,checkedAt:proof.checkedAt,memberSends:0,operationalWrites:0}));
}catch(error){console.error(JSON.stringify({ok:false,stage,errorType:error.name,message:error.message.split('\n')[0],requests:diagnostics}));process.exitCode=1;}
finally{try{await context?.close();}finally{await release?.();await app.delete();}}
