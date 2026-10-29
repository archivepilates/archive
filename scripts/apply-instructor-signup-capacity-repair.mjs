import assert from 'node:assert/strict';
import { readFile, lstat, realpath, mkdir, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { assertTeamLectures } from './lib/team-261120-scope.mjs';
import { planCompletedInstructorSignupRepair } from './lib/instructor-completed-signup-repair.mjs';

const args=process.argv.slice(2),apply=args.includes('--apply'),source=args.find(x=>x.startsWith('--source='))?.slice(9);
assert(source && args.every(x=>x==='--apply'||x===`--source=${source}`));
const directory='/Users/archivepilates/ArchiveIN/operations/instructor-signup-capacity-repair-20261029';
assert((await realpath(source)).startsWith(directory+'/source-'));
const stat=await lstat(source);assert(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0);
const proof=JSON.parse(await readFile(source,'utf8')),hash=createHash('sha256').update(JSON.stringify(proof)).digest('hex');
assert(Date.now()-Date.parse(proof.nativeCheckedAt)>=0 && Date.now()-Date.parse(proof.nativeCheckedAt)<=10*60000);
assert(proof.lectureCoverage.complete===true);
const native={data:proof.lectures,meta:{last_page:1,total:proof.lectures.length}};
const selected=assertTeamLectures(native);
assert(selected.length===2 && new Set(selected.map(x=>x.id)).size===2);
const require=createRequire(import.meta.url),admin=require('../firebase/kangsain-functions/functions/node_modules/firebase-admin');
const {normalizeLecture}=require('../firebase/kangsain-functions/functions/src/studiomate/normalizers.ts');
const app=admin.initializeApp({credential:admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json','utf8'))),projectId:'archive-pilates'});
const db=app.firestore(),id='ilr_b4c0fd50f082d92a1735f196';
const registrationRef=db.doc('instructorLessonRegistrations/'+id),jobRef=db.doc('eformsignInstructorMemberJobs/'+id);
const auditRef=db.doc('workLanes/instructor-lesson-registration/reports/signup-capacity-repair-20261029');
try{
  const current=await registrationRef.get();
  const patch=planCompletedInstructorSignupRepair({registration:current.data(),proof});
  assert(proof.tickets?.status==='verified');
  const ticket=proof.tickets.tickets.filter(t=>t.userTicketId===current.get('evidence.ticketId'));
  assert(ticket.length===1 && ticket[0].memberId==='4342056'&&ticket[0].title==='강사레슨 (2T)'
    &&ticket[0].availabilityStartAt==='2026-11-28'&&ticket[0].expireAt==='2026-11-28'
    &&ticket[0].active===true&&ticket[0].cancelled===false&&ticket[0].refunded===false
    &&ticket[0].payment.totalAmount===0&&ticket[0].payment.refundedAmount===0);
  assert(current.updateTime.toDate().toISOString()===proof.registrationUpdateTime,'Registration changed; refresh proof.');
  const lectures=proof.lectures.map(raw=>{
    const row=normalizeLecture(raw,'5330');
    assert(row.lectureId && row.date==='2026-11-20' && row.capacity===6 && row.startAt && row.endAt);
    // The native list did not fetch reservations; never invent zero reservation counters.
    delete row.bookingCount;delete row.waitCount;delete row.cancelCount;
    const capacityEvidence={source:'studiomate_lecture_list_readback',complete:true,proofHash:hash,nativeLectureId:row.lectureId,capacity:row.capacity,
      sourceUrl:`https://arcpilates.studiomate.kr/lecture/detail?id=${row.lectureId}`,
      sourcePath:'/v2/staff/lectures?start_date=2026-11-20&end_date=2026-11-20&limit=100&page=1&sort_by_name=start_on&sort_by_type=asc&with=room%3Bdivision%3Bstaff.profile',
      capturedAt:proof.nativeCheckedAt,studioId:row.studioId,date:row.date,title:row.title,staffName:row.staffName,roomName:row.roomName,startAt:row.startAt,endAt:row.endAt};
    return {...row,capacityEvidence,source:'studiomate_operator_verified_lecture',sourceReadback:{kind:'native_readonly',checkedAt:proof.nativeCheckedAt,
      proofHash:hash,sourceUrl:`https://arcpilates.studiomate.kr/lecture/detail?id=${row.lectureId}`}};
  });
  const targetRefs=lectures.map(x=>db.doc('lectures/'+x.lectureId));
  const confirmationId=current.get('evidence.confirmationCandidateId'),messageId=current.get('evidence.confirmationSolapiMessageId');
  assert(confirmationId && messageId);
  const noEffects=['studiomateInstructorLessonJobs','studiomateMemoWriteJobs'].map(c=>db.collection(c).where('registrationId','==',id));
  const execute=async transaction=>{
    const get=ref=>transaction?transaction.get(ref):ref.get();
    const [fresh,job,audit,existingLectures,others,signupJobs,...work]=await Promise.all([
      get(registrationRef),get(jobRef),get(auditRef),
      get(db.collection('lectures').where('studioId','==','5330').where('date','==','2026-11-20')),
      get(db.collection('instructorLessonRegistrations').where('memberPhone','==',current.get('memberPhone'))),
      get(db.collection('eformsignInstructorMemberJobs').where('memberPhone','==',current.get('memberPhone'))),
      ...noEffects.map(get),
    ]);
    assert(!audit.exists,'Prior repair exists; read back, do not replay.');
    assert(fresh.exists&&fresh.updateTime.isEqual(current.updateTime),'Concurrent registration update.');
    assert(!job.exists&&signupJobs.empty&&others.size===1,'New or ambiguous signup/registration source.');
    assert(existingLectures.empty,'Existing lecture source changed; reconcile instead of overwrite.');
    assert(work.every(s=>s.empty),'Existing fulfillment work requires reconciliation.');
    assert(fresh.get('evidence.confirmationCandidateId')===confirmationId&&fresh.get('evidence.confirmationSolapiMessageId')===messageId);
    const exactPatch=planCompletedInstructorSignupRepair({registration:fresh.data(),proof});
    const result={registrationId:id,signupDocumentId:proof.completedSignup.documentId,lectureIds:lectures.map(x=>x.lectureId),
      capacity:6,memberSends:0,ticketIssues:0,bookingWrites:0,sourceHash:hash,checkedAt:proof.checkedAt};
    if(transaction){
      transaction.update(registrationRef,{...exactPatch,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
      lectures.forEach((row,index)=>transaction.create(targetRefs[index],row));
      transaction.create(auditRef,{...result,approval:{source:'human_current_chat',scope:'existing_signup_link_and_two_lecture_source_repair'},
        beforeStatus:fresh.get('status'),afterStatus:exactPatch.status,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    }
    return result;
  };
  const result=apply?await db.runTransaction(execute):await execute();
  if(apply){
    const after=await registrationRef.get(),rows=await db.getAll(...targetRefs);
    assert(after.get('status')==='completed'&&after.get('evidence.confirmationCandidateId')===confirmationId&&after.get('evidence.confirmationSolapiMessageId')===messageId);
    assert(rows.every(x=>x.get('capacity')===6&&x.get('sourceReadback.proofHash')===hash));
    assert(!(await jobRef.get()).exists);
  }
  await mkdir(directory,{recursive:true,mode:0o700});
  const output=directory+`/${apply?'apply':'plan'}-${Date.now()}.json`,f=await open(output,'wx',0o600);
  try{await f.writeFile(JSON.stringify({ok:true,apply,...result,verified:apply},null,2));await f.sync();}finally{await f.close();}
  console.log(JSON.stringify({ok:true,apply,...result,output,verified:apply}));
}finally{await app.delete();}
