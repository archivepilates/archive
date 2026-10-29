import assert from 'node:assert/strict';
import {readFile,open} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {TEAM_IDS,TEAM_DIRECTORY,assertTeamRegistration} from './lib/team-261120-scope.mjs';
import {makeLessonVideoSolapiRequest} from './lib/lesson-video-notice-solapi.mjs';
import {validateTeamTestTemplate} from './test-team-261121-confirmation.mjs';
import {TEMPLATE,CHANNEL,MANAGEMENT,templateHash,stableHash,approvalFor} from './lib/team-261120-confirmation.mjs';

assert.deepEqual(process.argv.slice(2),['--record-approved-review']);
const require=createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const admin=require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
const app=admin.initializeApp({credential:admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json','utf8'))),projectId:'archive-pilates'},'team-d1-review-'+Date.now());
let file;
try{
  const request=makeLessonVideoSolapiRequest(),template=await request('/kakao/v2/templates/'+TEMPLATE,'GET');
  validateTeamTestTemplate(template);
  const db=app.firestore(),review={source:'human_current_chat',questionId:'call_2e8c4f25a21e4778a93c688d09c6f1e3',
    decision:'existing_confirmation_approved_d1_preparation_separate',reviewedAt:new Date().toISOString(),
    status:'preparation_required',lessonDate:'2026-11-20',dueDate:'2026-11-19',
    automaticDispatchEnabled:false,newScheduleCreated:false,
    nextAction:'별도 D-1 배정·큐카드 준비, 기존 샘플·명시적 승인 절차 확인 후에만 안내'};
  const refs=TEAM_IDS.map(id=>db.doc('instructorLessonRegistrations/'+id));
  await db.runTransaction(async tx=>{
    const rows=await tx.getAll(...refs);
    for(const row of rows){const r=assertTeamRegistration(row.id,row.data());
      assert(r.steps?.member?.status==='verified' && r.steps?.ticket?.status==='verified');
      assert(!r.d1Followup || r.d1Followup.questionId===review.questionId);}
    for(const ref of refs)tx.update(ref,{d1Followup:review,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
  });
  const proof={status:'verified',reviewedBy:'main_current_chat',scope:'existing_template_d1_promise',
    managementNumber:MANAGEMENT,lessonDate:'2026-11-20',templateId:TEMPLATE,channelId:CHANNEL,
    templateHash:templateHash(template),approvalHash:stableHash(approvalFor(template)),checkedAt:new Date().toISOString(),
    evidenceRef:'instructorLessonRegistrations/'+TEAM_IDS[0]+'#d1Followup',registrationIds:TEAM_IDS,
    reviewDecision:review.decision,questionId:review.questionId,
    verifiesOperatorApprovalOnly:true,d1PreparationComplete:false,d1AutomationActivated:false};
  file=await open(TEAM_DIRECTORY+'/team-261120-confirmation-d1-proof.json','wx',0o600);
  await file.writeFile(JSON.stringify(proof,null,2));await file.sync();
  console.log(JSON.stringify({ok:true,review:'existing_confirmation_approved',d1:'separate_preparation_required',newSchedule:false}));
}finally{await file?.close();await app.delete();}
