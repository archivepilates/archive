import assert from 'node:assert/strict';
import { readFile, mkdir, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TEAM_EVENT } from './build-team-261121-calendar.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { captureStudioMateNativeApiClient, readExactStudioMateMember } from './lib/studiomate-native-contract-source.mjs';
import { makeLessonVideoSolapiRequest } from './lib/lesson-video-notice-solapi.mjs';
import { assertMemberDispatchAllowed, isMemberDispatchDeferred } from './lib/member-dispatch-window.mjs';

export const TEAM_TEST_ID = 'instructor_team_confirmation_test_261121_operator_20261029_v1';
const TEMPLATE = 'KA01TP2608241233353269Jgtoiwnzi6', CHANNEL = 'KA01PF260511123407631PSoAflYAVXs';
const PHONE = '01086488585';
export function teamTestVariables(member) {
  assert(member?.name === '김기효' && member.phone === PHONE && /^[1-9]\d+$/.test(member.memberId));
  return { '#{이름}': '김기효 (Team 안내 테스트)', '#{수업일}': TEAM_EVENT.dateText,
    '#{수업시간}': TEAM_EVENT.timeText, '#{수업구성}': TEAM_EVENT.composition, '#{관리번호}': 'team-261121' };
}
export function validateTeamTestTemplate(template) {
  assert(template?.templateId === TEMPLATE && template.channelId === CHANNEL && template.status === 'APPROVED'
    && template.messageType === 'BA' && template.emphasizeType === 'IMAGE' && template.imageId === 'ST01FZ260825101204154cOImfLX8Ri7');
  assert.equal(template.content, '#{이름}님,\n\n아카이브 강사 레슨\n예약이 확정되었어요.\n\n[일정]\n#{수업일} #{수업시간}\n\n[수업 구성]\n#{수업구성}\n두 세션 모두 수강해요.\n\n[장소]\n아카이브필라테스 명지\n\n수업 배정과 큐카드는\n수업 D-1 알림톡으로 \n다시 안내해 드릴게요.');
  assert.deepEqual(template.buttons?.map(b => ({ type:b.buttonType,name:b.buttonName,mo:b.linkMo,pc:b.linkPc })), [
    { type:'WL',name:'캘린더에 일정 추가',mo:'https://in.archivepilates.com/method/#{관리번호}/calendar/',pc:'https://in.archivepilates.com/method/#{관리번호}/calendar/' },
    { type:'WL',name:'방문안내 보기',mo:'https://archivepilates.notion.site/visitin',pc:'https://archivepilates.notion.site/visitin' },
  ]);
}
async function main() {
  const args=process.argv.slice(2),apply=args.includes('--apply'),expected=args.find(a=>a.startsWith('--expected-commit='))?.slice(18);
  assert(args.every(a=>a==='--apply'||a.startsWith('--expected-commit='))&&args.length===(apply?2:0));
  const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim(),commit=git('rev-parse','HEAD');
  if(apply){assert(/^[a-f0-9]{40}$/.test(expected||''));assert.equal(commit,expected);git('diff','--quiet','HEAD');assertMemberDispatchAllowed();}
  const require=createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
  const admin=require('./firebase/kangsain-functions/functions/node_modules/firebase-admin'),{chromium}=require('playwright');
  const app=admin.initializeApp({credential:admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json','utf8'))),projectId:'archive-pilates'});
  let context,release,effectStarted=false,claimed=false;
  const db=app.firestore(),candidateRef=db.doc('alimtalkCandidates/'+TEAM_TEST_ID),sendRef=db.doc('alimtalkSends/'+TEAM_TEST_ID);
  try{
    const prior=await candidateRef.get();if(prior.exists){console.log(JSON.stringify({status:prior.data().status,replayed:false,candidateId:TEAM_TEST_ID}));return;}
    const request=makeLessonVideoSolapiRequest(),template=await request('/kakao/v2/templates/'+TEMPLATE,'GET');validateTeamTestTemplate(template);
    const landing=await fetch(TEAM_EVENT.url,{cache:'no-store'}),ics=await fetch(TEAM_EVENT.url+TEAM_EVENT.icsName,{cache:'no-store'});
    assert(landing.ok&&ics.ok&&/text\/calendar/.test(ics.headers.get('content-type')));
    const html=await landing.text(),calendar=(await ics.text()).replace(/\r\n /g,'');
    assert(html.includes(TEAM_EVENT.dateText)&&html.includes(TEAM_EVENT.timeText)&&calendar.includes('DTSTART:'+TEAM_EVENT.start)&&calendar.includes('DTEND:'+TEAM_EVENT.end));
    release=await acquireStudioMateBrowserLock({owner:'team-confirmation-operator-test',waitMs:120000});
    context=await chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/browser-profile',{headless:true});
    const page=await context.newPage();await page.route('**/*',r=>r.request().url().includes('studiomate')&&!['GET','HEAD','OPTIONS'].includes(r.request().method())?r.abort():r.continue());
    const api=await captureStudioMateNativeApiClient(page),checkedAt=Date.now(),native=await readExactStudioMateMember(api,PHONE);
    assert.equal(native.status,'verified');const member=native.member,variables=teamTestVariables(member);
    const lectures=await api.get('/v2/staff/lectures?start_date=2026-11-21&end_date=2026-11-21&limit=100&page=1&sort_by_name=start_on&sort_by_type=asc&with=room%3Bdivision%3Bstaff.profile');
    assert(Array.isArray(lectures.data)&&lectures.meta?.last_page===1&&lectures.meta?.current_page===1&&lectures.data.length===lectures.meta?.total);
    for(const s of TEAM_EVENT.sessions){const r=lectures.data.find(r=>String(r.id)===s.lectureId);assert(r&&r.title==='강사레슨(team)'&&r.description===s.description&&r.start_on===`2026-11-21 ${s.start}:00`&&r.end_on===`2026-11-21 ${s.end}:00`);}
    const cs=db.collection('alimtalkCandidates').where('memberPhone','==',PHONE).limit(201),ss=db.collection('alimtalkSends').where('memberPhone','==',PHONE).limit(201);
    const relevant=d=>d.candidateId===TEAM_TEST_ID||d.payload?.teamPreviewKey===TEAM_TEST_ID||d.templateCode===TEMPLATE&&d.payload?.lessonDate==='2026-11-21';
    const history=async tx=>{const c=await(tx?tx.get(cs):cs.get()),s=await(tx?tx.get(ss):ss.get());assert(c.size<201&&s.size<201&&!c.docs.some(x=>relevant(x.data()))&&!s.docs.some(x=>relevant(x.data())));};
    await history();
    const p=await request('/messages/v4/list?'+new URLSearchParams({to:PHONE,type:'ATA',dateType:'CREATED',startDate:'2026-10-29T00:00:00Z',endDate:new Date().toISOString(),limit:'500'}),'GET');
    assert(!p.nextKey&&!Object.values(p.messageList||{}).some(m=>m.kakaoOptions?.templateId===TEMPLATE&&/2026년\s*11월\s*21일/.test(m.text||'')));
    const approval={actor:'operator-current-chat',purpose:'Team 안내 내용 확인 후 실제5명 발송 여부 결정',recipient:member.memberId,phoneHash:createHash('sha256').update(PHONE).digest('hex'),approvedAt:new Date().toISOString(),realTeamDispatchApproved:false};
    if(!apply){console.log(JSON.stringify({ok:true,mode:'plan',recipient:'김기효',variables,calendarVerified:true,nativeSessionsVerified:true,createsRegistration:false}));return;}
    const ensureFresh=()=>{assert(Date.now()-checkedAt<120000);assertMemberDispatchAllowed();};
    ensureFresh();
    await db.runTransaction(async tx=>{const prior=await tx.get(candidateRef),send=await tx.get(sendRef);assert(!prior.exists&&!send.exists);await history(tx);ensureFresh();
      const at=admin.firestore.FieldValue.serverTimestamp();
      tx.create(candidateRef,{candidateId:TEAM_TEST_ID,studioId:'5330',memberId:member.memberId,memberName:member.name,memberPhone:PHONE,
        type:'instructor_lesson_confirmation',templateCode:TEMPLATE,status:'processing',attempts:0,maxAttempts:1,
        sourceActionKey:TEAM_TEST_ID,sourceDate:'2026-10-29',isTest:true,manualDispatchOnly:true,externalEffectStarted:false,
        payload:{teamPreviewKey:TEAM_TEST_ID,lessonDate:'2026-11-21',managementNumber:'team-261121',testOnly:true},
        variables,approval,sourceCommit:commit,createdAt:at,updatedAt:at});
      tx.create(sendRef,{sendId:TEAM_TEST_ID,candidateId:TEAM_TEST_ID,studioId:'5330',memberId:member.memberId,memberName:member.name,memberPhone:PHONE,
        templateCode:TEMPLATE,status:'processing',attempts:0,maxAttempts:1,isTest:true,variables,createdAt:at,updatedAt:at});});
    claimed=true;ensureFresh();
    await db.runTransaction(async tx=>{const c=await tx.get(candidateRef),s=await tx.get(sendRef);assert(c.data()?.status==='processing'&&s.data()?.status==='processing');ensureFresh();tx.update(candidateRef,{attempts:1,externalEffectStarted:true});tx.update(sendRef,{attempts:1});});
    ensureFresh();effectStarted=true;
    const response=await request('/messages/v4/send-many/detail','POST',{messages:[{to:PHONE,type:'ATA',kakaoOptions:{pfId:CHANNEL,templateId:TEMPLATE,disableSms:true,variables},customFields:{archiveActionKey:TEAM_TEST_ID,purpose:'team_confirmation_preview'}}],strict:true,allowDuplicates:false,showMessageList:true});
    const accepted=response.messageList;if(response.failedMessageList?.length||!Array.isArray(accepted)||accepted.length!==1||accepted[0].to!==PHONE||!/^M[A-Za-z0-9]+$/.test(accepted[0].messageId||''))throw Error('Ambiguous test receipt.');
    const messageId=accepted[0].messageId;
    await db.runTransaction(async tx=>{const c=await tx.get(candidateRef),s=await tx.get(sendRef);assert(c.data()?.status==='processing'&&s.data()?.status==='processing');const at=admin.firestore.FieldValue.serverTimestamp();tx.update(candidateRef,{status:'sent',solapiMessageId:messageId,sentAt:at,updatedAt:at});tx.update(sendRef,{status:'done',solapiMessageId:messageId,acceptedAt:at,updatedAt:at});});
    const directory='/Users/archivepilates/ArchiveIN/operations/november-instructor-confirmation-20261029';await mkdir(directory,{recursive:true,mode:0o700});
    const h=await open(path.join(directory,'team-test-accepted.json'),'wx',0o600);try{await h.writeFile(JSON.stringify({candidateId:TEAM_TEST_ID,messageId,sourceCommit:commit,approval,variables,acceptedAt:new Date().toISOString()},null,2));}finally{await h.close();}
    console.log(JSON.stringify({ok:true,status:'accepted',candidateId:TEAM_TEST_ID,messageId,recipient:'김기효',actualTeamRecipientsSent:0,createsRegistration:false}));
  }catch(error){
    if(claimed){const deferred=!effectStarted&&isMemberDispatchDeferred(error);
      const patch={status:deferred?'deferred':'review_required',attempts:effectStarted?1:0,externalEffectStarted:effectStarted,
        lastError:effectStarted?'테스트 접수 결과 확인 필요 · 재발송 금지':'전송 전 확인 중단 · 공급자 요청 없음',updatedAt:admin.firestore.FieldValue.serverTimestamp()};
      await db.runTransaction(async tx=>{await tx.get(candidateRef);await tx.get(sendRef);tx.update(candidateRef,patch);tx.update(sendRef,patch);}).catch(()=>{});}
    console.error(JSON.stringify({ok:false,code:'TEAM_TEST_STOPPED',effectStarted,replay:false}));process.exitCode=1;
  }finally{await context?.close();await release?.();await app.delete();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
