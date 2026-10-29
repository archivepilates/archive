import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {TEAM_IDS,TEAM_DIRECTORY,TEAM_APPROVAL,assertTeamRegistration,selectTeamTicket} from './lib/team-261120-scope.mjs';
import {deriveInstructorLessonRegistrationState} from './lib/instructor-lesson-registration-contract.mjs';
import {assertMemberDispatchAllowed} from './lib/member-dispatch-window.mjs';
import {parseSignupProfile} from './lib/instructor-signup-profile.mjs';

const args=process.argv.slice(2);
assert(args.length===2 && args[0]==='--apply' && /^--evidence=eform-\d+\.json$/.test(args[1]));
const proof=JSON.parse(await readFile(TEAM_DIRECTORY+'/'+args[1].slice(11),'utf8'));
assert(proof.source==='team_261120_native_eform_readonly' && proof.account==='archivepilates@gmail.com'
  && proof.templateId==='a5b5ea6b85ec44c8bcb4af1e980e94eb' && proof.rows.length===6);
assert(proof.cleanup.contextClosed && proof.cleanup.lockReleased && proof.cleanup.appDeleted);
const require=createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const admin=require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
const app=admin.initializeApp({credential:admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json','utf8'))),projectId:'archive-pilates'},'team-signups-'+Date.now());
const db=app.firestore(),now=()=>admin.firestore.FieldValue.serverTimestamp();
try{
  for(const id of TEAM_IDS){
    const rows=proof.rows.filter(r=>r.registrationId===id);assert.equal(rows.length,1);const p=rows[0];
    assert(p.searchComplete && p.searches.length===2 && p.searches.every(s=>s.complete && !s.error && !s.unverified.length));
    assert(p.completed.length+p.progress.length<=1);
    assert(Date.now()-Date.parse(p.checkedAt)>=0 && Date.now()-Date.parse(p.checkedAt)<15*60*1000,'Stale signup source');
    assert(['completed_verified','completed_unverified','not_found_in_verified_search','progress_reconcile'].includes(p.status),'Unverified signup must not dispatch');
    const completed=p.completed[0];
    let reuse;
    if(completed){
      assert(completed.recipientVerified && completed.statusResponse?.body?.status==='200');
      const jobs=await db.collection('eformsignInstructorMemberJobs').where('documentId','==',completed.documentId).get();
      assert.equal(jobs.size,1,'Existing completed signup must bind one original tracking job');
      const original=jobs.docs[0].data();
      assert(original.status==='done' && original.memberPhone===p.canonicalPhone && original.memberName===p.memberName
        && original.documentId===completed.documentId && original.submittedProfile);
      parseSignupProfile(original.submittedProfile,original,completed.documentId);
      reuse={ref:jobs.docs[0].ref,documentId:completed.documentId,documentName:completed.documentName,
        memoId:'instructor_member_profile_'+completed.documentId};
    }
    const rr=db.doc('instructorLessonRegistrations/'+id),jr=db.doc('eformsignInstructorMemberJobs/'+id);
    const outcome=await db.runTransaction(async tx=>{
      const s=await tx.get(rr),js=await tx.get(jr),r=assertTeamRegistration(id,s.data());
      assert(r.memberName===p.memberName && r.memberPhone===p.canonicalPhone && /^[1-9]\d+$/.test(r.studiomateMemberId));
      assert(r.steps?.member?.status==='verified' && r.steps?.ticket?.status==='verified');
      assert(r.evidence.studiomateUserTicketId===selectTeamTicket({status:'verified',reason:'complete_native_ticket_list',tickets:[r.teamFulfillment.ticket]},r.studiomateMemberId).userTicketId);
      if(js.exists){
        const j=js.data();assert(j.registrationId===id && j.memberPhone===r.memberPhone && j.studiomateMemberId===r.studiomateMemberId
          && j.ticketName==='Team 강사레슨' && j.ticketPrice===80000);
        return {name:r.memberName,status:'existing_job_preserved',jobStatus:j.status};
      }
      if(reuse){
        const [original,memo,memoJob,consent]=await Promise.all([tx.get(reuse.ref),tx.get(db.doc('memberMemos/'+reuse.memoId)),
          tx.get(db.doc('studiomateMemoWriteJobs/'+reuse.memoId)),tx.get(db.doc('instructorMemberConsents/consent_5330_'+r.studiomateMemberId))]);
        assert(original.data()?.status==='done' && original.data().studiomateMemberId===r.studiomateMemberId
          && original.data().memberPhone===r.memberPhone && original.data().documentId===reuse.documentId
          && memo.data()?.syncStatus==='synced' && memo.data().memberId===r.studiomateMemberId
          && memoJob.data()?.status==='done' && memoJob.data().memberId===r.studiomateMemberId
          && memoJob.data().content===memo.data().content && consent.data()?.status==='completed'
          && consent.data().documentId===reuse.documentId && consent.data().memberId===r.studiomateMemberId);
        const steps={...r.steps,eformsign:{status:'verified',label:'강사회원 가입서',detail:'기존 완료 문서·실제 수신자·전체 연락처 재확인 · 재발송 없음'},
          memo:{status:'verified',label:'가입서 정보 반영',detail:'같은 완료 문서의 기존 메모 synced·작업 done 유지'},
          confirmation:{status:'pending',label:'예약확정 안내',detail:'일정·주제·전체 안내 이력 최종 검증 대기'},
          bookings:{status:'not_required',label:'반배정·예약',detail:'이번 범위에서 예약 변경 없음'}};
        tx.update(rr,{steps,...deriveInstructorLessonRegistrationState({mode:r.mode,steps}),lastError:null,
          'evidence.eformsignDocumentId':reuse.documentId,'evidence.eformsignJobId':reuse.ref.id,
          'teamFulfillment.signupSourceCheckedAt':new Date(p.checkedAt),'teamFulfillment.signupProfileSource':'existing_canonical_completed_job',
          'teamFulfillment.approval':TEAM_APPROVAL,updatedAt:now()});
        tx.update(consent.ref,{registrationIds:admin.firestore.FieldValue.arrayUnion(id),updatedAt:now()});
        return {name:r.memberName,status:'existing_completed_signup_and_synced_memo_reused',documentId:reuse.documentId};
      }
      assert(!r.evidence?.eformsignDocumentId && !r.teamFulfillment?.effects?.eformsign_send);
      const found=p.completed[0]||p.progress[0];
      if(found)assert(found.recipientVerified && /^[a-f0-9]{32}$/.test(found.documentId));
      else assertMemberDispatchAllowed();
      const job={jobId:id,registrationId:id,studioId:'5330',memberName:r.memberName,memberPhone:r.memberPhone,
        lessonDate:r.lessonDate,studiomateMemberId:r.studiomateMemberId,ticketName:'Team 강사레슨',ticketPrice:80000,
        paymentAmount:80000,courseKind:'team',status:found?'waiting_completion':'pending',attempts:0,maxAttempts:1,
        externalEffectStarted:false,approval:TEAM_APPROVAL,source:{type:'native_eform_search',checkedAt:p.checkedAt,
          evidenceFile:args[1].slice(11),searchModes:['ai','ip'],completed:p.completed.length,progress:p.progress.length},
        createdAt:now(),updatedAt:now(),...(found?{documentId:found.documentId,documentName:found.documentName,documentUrl:found.href,
          existingDocumentReused:true}:{}),...(p.completed[0]?.statusResponse?.body?.result?.status ? {originalCompletionEvidenceCheckedAt:p.completed[0].checkedAt}:{} )};
      const steps={...r.steps,eformsign:{status:found?'sent':'queued',label:'강사회원 가입서',
        detail:found?(p.completed.length?'기존 완료 가입서 확인·답변 연결 대기':'기존 진행 중 가입서 재사용 · 재발송 없음'):'완료·진행 문서 없음 확인 · 기존 발송 처리기 대기'},
        memo:{status:'waiting_external',label:'가입서 정보 반영',detail:'가입서 완료 후 기존 메모 처리기에서 반영'},
        confirmation:{status:'pending',label:'예약확정 안내',detail:'일정·주제·수강권·전체 발송 이력 최종 검증 대기'},
        bookings:{status:'not_required',label:'반배정·예약',detail:'이번 범위는 수강권·가입서·확정 안내이며 예약 변경 없음'}};
      const state=deriveInstructorLessonRegistrationState({mode:r.mode,steps});
      tx.create(jr,job);
      tx.update(rr,{steps,...state,lastError:null,'teamFulfillment.signupSourceCheckedAt':new Date(p.checkedAt),
        'teamFulfillment.approval':TEAM_APPROVAL,...(found?{'evidence.eformsignDocumentId':found.documentId}:{}),updatedAt:now()});
      return {name:r.memberName,status:found?'existing_document_linked':'signup_queued',documentId:found?.documentId||null};
    });
    console.log(JSON.stringify(outcome));
  }
}finally{await app.delete();}
