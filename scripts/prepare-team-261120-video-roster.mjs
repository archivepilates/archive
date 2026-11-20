import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {TEAM_IDS,assertTeamRegistration} from './lib/team-261120-scope.mjs';
import {staffMembers} from './lib/imweb-staff-video-sync.mjs';
import {imwebJson} from './lib/imweb-referral-source.mjs';
import {SITE,UNIT} from './lib/imweb-staff-video-policy.mjs';

const require=createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const admin=require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
admin.initializeApp({credential:admin.credential.cert(JSON.parse(readFileSync('/Users/archivepilates/archive-automation/secrets/google/archive-codex-operator.json','utf8'))),projectId:'archive-pilates'});
const root='/Users/archivepilates/archive-automation/operations/team-lesson-videos-261120';
mkdirSync(root,{recursive:true,mode:0o700});
const snaps=await admin.firestore().getAll(...TEAM_IDS.map(id=>admin.firestore().doc('instructorLessonRegistrations/'+id)));
const registrations=snaps.map(s=>({id:s.id,...assertTeamRegistration(s.id,s.data())}));
assert.equal(registrations.length,6);
const members=staffMembers(imwebJson);
assert(members.every(m=>m.siteCode===SITE&&m.unitCode===UNIT));
assert.equal(new Set(members.map(m=>m.memberCode)).size,members.length);
const phone=value=>String(value??'').replace(/\D/g,'');
const name=value=>String(value??'').normalize('NFC').trim();
function identityMatch(r){
  const samePhone=members.filter(m=>phone(m.callnum)===r.memberPhone);
  const exact=samePhone.filter(m=>name(m.name)===name(r.memberName));
  if(exact.length===1&&samePhone.length===1)return {status:'matched',member:{uid:exact[0].uid,memberCode:exact[0].memberCode}};
  if(samePhone.length||members.some(m=>name(m.name)===name(r.memberName)))return {status:'hold',reason:'identity_requires_confirmation'};
  return {status:'no_member',reason:'no_current_identity_match'};
}
const rows=registrations.map(r=>({registrationId:r.id,name:r.memberName,phone:r.memberPhone,
  sourceMemberId:r.memberId??r.fulfillment?.memberId??null,status:r.status,
  match:identityMatch(r)}));
const file=root+'/registered-roster.json';
writeFileSync(file+'.tmp',JSON.stringify({lessonDate:'2026-11-20',lessonIds:['98900618','98900887'],
  source:'Fresh canonical CORE instructorLessonRegistrations; native attendance remains a separate prerequisite',
  verifiedAt:new Date().toISOString(),rows},null,2),{mode:0o600});renameSync(file+'.tmp',file);
console.log(JSON.stringify({registered:rows.length,matches:rows.map(r=>({name:r.name,status:r.match.status,reason:r.match.reason})),nativeAttendanceVerified:false}));
await admin.app().delete();
