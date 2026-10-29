import assert from 'node:assert/strict';
import {readFile,open} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {TEAM_IDS,TEAM_DIRECTORY,assertTeamRegistration} from './lib/team-261120-scope.mjs';
import {TEMPLATE,assertRegistration,confirmationKey,confirmationSendId,verifyProviderMessage} from './lib/team-261120-confirmation.mjs';
import {providerHistory} from './send-team-261120-confirmations.mjs';
import {validateTeamTestTemplate} from './test-team-261121-confirmation.mjs';
import {makeLessonVideoSolapiRequest} from './lib/lesson-video-notice-solapi.mjs';
import {deriveInstructorLessonRegistrationState} from './lib/instructor-lesson-registration-contract.mjs';

assert.deepEqual(process.argv.slice(2),['--verify-and-reconcile']);
const require=createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const admin=require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
const app=admin.initializeApp({credential:admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json','utf8'))),projectId:'archive-pilates'},'team-final-'+Date.now());
const report={startedAt:new Date().toISOString(),providerMethods:['GET'],memberSends:0,rows:[]};
let file;
try{
  const db=app.firestore(),request=makeLessonVideoSolapiRequest(),template=await request('/kakao/v2/templates/'+TEMPLATE,'GET');
  validateTeamTestTemplate(template);
  for(const id of TEAM_IDS){
    const rr=db.doc('instructorLessonRegistrations/'+id),r=assertTeamRegistration(id,(await rr.get()).data());
    const binding=assertRegistration(id,r),key=confirmationKey(binding.memberId,binding.phone),sendId=confirmationSendId(binding.memberId,binding.phone);
    const cr=db.doc('alimtalkCandidates/'+key),sr=db.doc('alimtalkSends/'+sendId);
    const [cs,ss]=await db.getAll(cr,sr);const c=cs.data(),s=ss.data();
    assert(cs.exists && ss.exists && c.registrationId===id && s.registrationId===id
      && c.solapiMessageId && c.solapiMessageId===s.solapiMessageId && c.sourceActionKey===key && s.sourceActionKey===key
      && c.memberPhone===binding.phone && s.memberPhone===binding.phone && c.payload?.sourceTicketId===binding.ticketId
      && s.payload?.sourceTicketId===binding.ticketId && c.attempts===1 && s.attempts===1);
    const messages=(await providerHistory(request,binding.phone)).filter(m=>m.messageId===c.solapiMessageId);
    assert.equal(messages.length,1);const message=messages[0];
    const delivery=verifyProviderMessage(message,{binding,key,variables:c.variables},template,c.solapiMessageId);
    assert.equal(delivery.deliveryStatus,'delivered','Accepted or pending message is not delivery completion');
    const checkedAt=new Date().toISOString();
    const result=await db.runTransaction(async tx=>{
      const [current,can,send]=await tx.getAll(rr,cr,sr),v=assertTeamRegistration(id,current.data());
      assert(v.studiomateMemberId===binding.memberId && v.memberPhone===binding.phone
        && v.evidence.studiomateUserTicketId===binding.ticketId && can.data()?.solapiMessageId===c.solapiMessageId
        && send.data()?.solapiMessageId===c.solapiMessageId && v.teamConfirmationDispatch?.key===key);
      const steps={...v.steps,confirmation:{status:'verified',label:'예약확정 안내',detail:'동일 메시지·수신자·템플릿·내용 COMPLETE/4000 재조회 확인'}};
      const at=admin.firestore.FieldValue.serverTimestamp(),state=deriveInstructorLessonRegistrationState({mode:v.mode,steps});
      const patch={...delivery,providerReadbackAt:checkedAt,updatedAt:at};
      tx.update(cr,{...patch,reasonCode:null,dispatchState:'verified'});
      tx.update(sr,{...patch,status:'done'});
      const rp={steps,...state,lastError:null,externalEffectStarted:false,'teamFulfillment.finalReadbackAt':at,updatedAt:at};
      for(const effect of ['member_create','ticket_issue'])if(v.teamFulfillment?.effects?.[effect]){
        rp['teamFulfillment.effects.'+effect+'.status']='verified';
        rp['teamFulfillment.effects.'+effect+'.reconciliation']={source:'independent_native_get',memberId:binding.memberId,
          ...(effect==='ticket_issue'?{ticketId:binding.ticketId}:{}),verifiedAt:at};
      }
      tx.update(rr,rp);
      return {name:v.memberName,registrationId:id,memberId:binding.memberId,ticketId:binding.ticketId,
        documentId:v.evidence.eformsignDocumentId,signupStatus:steps.eformsign.status,memoStatus:steps.memo.status,
        confirmationStatus:'verified',messageId:c.solapiMessageId,providerStatus:delivery.providerStatus,
        providerStatusCode:delivery.providerStatusCode,providerCreatedAt:message.dateCreated,deliveryObservedAt:checkedAt,
        state:state.status,attempts:1};
    });
    report.rows.push(result);console.log(JSON.stringify(result));
  }
  report.ok=report.rows.length===6;
  report.finishedAt=new Date().toISOString();
  file=await open(TEAM_DIRECTORY+'/final-verification-'+Date.now()+'.json','wx',0o600);
  await file.writeFile(JSON.stringify(report,null,2));await file.sync();
  console.log(JSON.stringify({ok:report.ok,delivered:report.rows.length,memberSends:0,
    signupWaiting:report.rows.filter(r=>r.signupStatus==='sent').length,existingSignupComplete:report.rows.filter(r=>r.signupStatus==='verified').length}));
}finally{await file?.close();await app.delete();}
