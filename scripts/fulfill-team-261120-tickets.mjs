import assert from 'node:assert/strict';
import {readFile, mkdir, open} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {acquireStudioMateBrowserLock} from './lib/studiomate-browser-lock.mjs';
import {captureStudioMateNativeApiClient,readExactStudioMateMember,readStudioMateUserTickets} from './lib/studiomate-native-contract-source.mjs';
import {createInstructorMember,issueTeamTicket} from './lib/team-instructor-fulfillment-ui.mjs';
import {assertMemberDispatchAllowed} from './lib/member-dispatch-window.mjs';
import {TEAM_IDS,TEAM_DIRECTORY,TEAM_APPROVAL,assertTeamRegistration,assertTeamLectures,selectTeamTicket} from './lib/team-261120-scope.mjs';

assert.deepEqual(process.argv.slice(2),['--apply']);
assert(!process.env.FIRESTORE_EMULATOR_HOST);
const require=createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const admin=require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
const {chromium}=require('playwright');
const credentials=JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json','utf8'));
assert(credentials.project_id==='archive-pilates' && credentials.client_email==='archive-codex-operator@archive-pilates.iam.gserviceaccount.com');
const app=admin.initializeApp({credential:admin.credential.cert(credentials),projectId:'archive-pilates'},'team-ticket-'+Date.now());
const db=app.firestore(), now=()=>admin.firestore.FieldValue.serverTimestamp();
const report={source:'team_261120_native_ui',startedAt:new Date().toISOString(),approval:TEAM_APPROVAL,rows:[],cleanup:{}};
let release,context,file,api;
const lecturePath='/v2/staff/lectures?start_date=2026-11-20&end_date=2026-11-20&limit=100&page=1&sort_by_name=start_on&sort_by_type=asc&with=room%3Bdivision%3Bstaff.profile';
async function source(ref){const s=await ref.get();assert(s.exists);return assertTeamRegistration(s.id,s.data());}
async function claim(ref,expected,effect){
  assertMemberDispatchAllowed();
  const live=await readExactStudioMateMember(api,expected.memberPhone);
  if(effect==='member_create')assert(live.status==='review' && live.reason==='member_not_found');
  else {assert(live.status==='verified' && live.member.memberId===expected.studiomateMemberId && live.member.name===expected.memberName);
    assert.equal(selectTeamTicket(await readStudioMateUserTickets(api,live.member.memberId),live.member.memberId),null);}
  await db.runTransaction(async tx=>{
    const s=await tx.get(ref),r=assertTeamRegistration(s.id,s.data());
    assert(r.memberName===expected.memberName && r.memberPhone===expected.memberPhone && !r.teamFulfillment?.effects?.[effect]);
    assert(!r.studiomateMemberId || r.studiomateMemberId===expected.studiomateMemberId);
    tx.update(ref,{['teamFulfillment.effects.'+effect]:{status:'intent',attempts:1,startedAt:now(),approval:TEAM_APPROVAL},updatedAt:now()});
  });
  assertMemberDispatchAllowed();
}
async function receipt(ref,value){
  await db.runTransaction(async tx=>{
    const s=await tx.get(ref),r=assertTeamRegistration(s.id,s.data());
    assert.equal(r.teamFulfillment?.effects?.[value.effect]?.status,'intent');
    tx.update(ref,{['teamFulfillment.effects.'+value.effect+'.status']:value.outcome,
      ['teamFulfillment.effects.'+value.effect+'.receipt']:value,
      ['teamFulfillment.effects.'+value.effect+'.receiptAt']:now(),updatedAt:now()});
  });
}
try{
  await mkdir(TEAM_DIRECTORY,{recursive:true,mode:0o700});
  file=await open(TEAM_DIRECTORY+'/tickets-'+Date.now()+'.json','wx',0o600);
  release=await acquireStudioMateBrowserLock({owner:'approved-team-261120-ticket-fulfillment',waitMs:120000});
  context=await chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/browser-profile',{headless:true});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  api=await captureStudioMateNativeApiClient(page);
  report.lectures=assertTeamLectures(await api.get(lecturePath));
  for(const id of TEAM_IDS){
    const ref=db.doc('instructorLessonRegistrations/'+id),item={registrationId:id};report.rows.push(item);
    try{
      api=await captureStudioMateNativeApiClient(page);
      let r=await source(ref);item.name=r.memberName;
      const prior=await db.collection('instructorLessonRegistrations').where('memberPhone','==',r.memberPhone).get();
      assert.equal(prior.docs.filter(s=>s.data().lessonDate===r.lessonDate && !['cancelled','canceled'].includes(s.data().status)).length,1);
      let live=await readExactStudioMateMember(api,r.memberPhone);
      if(live.status!=='verified'){
        assert(live.reason==='member_not_found' && !r.studiomateMemberId && !r.teamFulfillment?.effects?.member_create);
        const created=await createInstructorMember(page,r,{beforeEffect:e=>claim(ref,r,e),onReceipt:v=>receipt(ref,v)});
        live=await readExactStudioMateMember(api,r.memberPhone);
        assert.equal(live.member?.memberId,created.memberId);
      }
      assert(live.status==='verified' && live.member.name===r.memberName && live.member.memberGrade==='강사회원' && live.member.inactive===false);
      const memberId=live.member.memberId;
      assert(!r.studiomateMemberId || r.studiomateMemberId===memberId);
      await db.runTransaction(async tx=>{
        const s=await tx.get(ref),v=assertTeamRegistration(s.id,s.data());
        assert(v.memberPhone===r.memberPhone && (!v.studiomateMemberId || v.studiomateMemberId===memberId));
        tx.update(ref,{studiomateMemberId:memberId,'evidence.studiomateMemberId':memberId,
          'steps.member':{status:'verified',label:'StudioMate 회원',detail:'전체 연락처·이름·강사회원 원본 일치'},
          'teamFulfillment.memberReadbackAt':now(),updatedAt:now()});
      });
      r={...await source(ref),studiomateMemberId:memberId};
      let ticket=selectTeamTicket(await readStudioMateUserTickets(api,memberId),memberId);
      if(!ticket){
        assert(!r.teamFulfillment?.effects?.ticket_issue,'Prior issue intent requires read-only reconciliation');
        let issued;
        try { issued=await issueTeamTicket(page,r,{beforeEffect:e=>claim(ref,r,e),onReceipt:v=>receipt(ref,v),
          readTicketIdentity:async()=>{
            const t=selectTeamTicket(await readStudioMateUserTickets(api,memberId),memberId);assert(t);
            return {verified:true,memberId,ticketId:t.userTicketId,ticketName:t.title,
              availableFrom:t.availabilityStartAt,expiresAt:t.expireAt,paymentAmount:t.payment.paidAmount};
          }}); } catch(error) {
          if(error.code!=='TEAM_UI_EFFECT_REVIEW_REQUIRED')throw error;
          // An ambiguous UI receipt is never repeated. Only independent native readback may resolve it.
          const observed=selectTeamTicket(await readStudioMateUserTickets(api,memberId),memberId);
          const current=await source(ref),intent=current.teamFulfillment?.effects?.ticket_issue?.startedAt;
          assert(observed && intent?.toMillis && Date.parse(observed.issuedAt)>=intent.toMillis()-2000,
            'Ticket effect remains ambiguous; no replay');
          issued={ticketId:observed.userTicketId};
          item.uiReceiptReconciledByNativeRead=true;
        }
        ticket=selectTeamTicket(await readStudioMateUserTickets(api,memberId),memberId);
        assert.equal(ticket?.userTicketId,issued.ticketId);
      }
      await db.runTransaction(async tx=>{
        const s=await tx.get(ref),v=assertTeamRegistration(s.id,s.data());
        assert.equal(v.studiomateMemberId,memberId);
        tx.update(ref,{'steps.ticket':{status:'verified',label:'Team 수강권',detail:'11/20 당일 2회·8만원 계좌이체 원본 확인'},
          'evidence.studiomateUserTicketId':ticket.userTicketId,'evidence.studiomateTicketId':ticket.userTicketId,
          'teamFulfillment.ticket':ticket,'teamFulfillment.ticketReadbackAt':now(),
          'teamFulfillment.ticketOutcome':'verified_by_independent_native_read',
          'teamFulfillment.approval':TEAM_APPROVAL,updatedAt:now()});
      });
      Object.assign(item,{memberId,ticketId:ticket.userTicketId,status:'ticket_verified'});
    }catch(error){item.status='review_required';item.errorCode=error.code||error.name;
      item.error=String(error.message||'').replace(/01\d[\d -]{7,}/g,'[redacted]').slice(0,240);
      item.location=String(error.stack||'').split('\n').filter(l=>/fulfill-team|team-261120-scope|team-instructor-fulfillment-ui/.test(l)).slice(1,4);
      console.log(JSON.stringify(item));break;}
    console.log(JSON.stringify(item));
  }
  report.ok=report.rows.length===6 && report.rows.every(r=>r.status==='ticket_verified');
}finally{
  try{await context?.close();report.cleanup.contextClosed=true;}finally{await release?.();report.cleanup.lockReleased=true;await app.delete();}
  report.finishedAt=new Date().toISOString();if(file){await file.writeFile(JSON.stringify(report,null,2));await file.sync();await file.close();}
  console.log(JSON.stringify({ok:report.ok,rows:report.rows,cleanup:report.cleanup}));
}
if(!report.ok)process.exitCode=1;
