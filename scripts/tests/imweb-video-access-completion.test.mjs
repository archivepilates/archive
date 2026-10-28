import test from 'node:test';
import assert from 'node:assert/strict';
import { completeVideoAccess,validateVideoReadiness } from '../complete-imweb-video-access.mjs';
import { SITE,UNIT } from '../lib/imweb-staff-video-policy.mjs';
const now=Date.parse('2026-10-29T01:00:00Z');
const proof=()=>({siteCode:SITE,unitCode:UNIT,verifiedAt:new Date(now).toISOString(),nativePagesPublished:true,catalogConnectionVerified:true,
  videos:[{youtubeId:'abcdefghijk',groupCode:'g123abc',watchPath:'/archive-method-watch-test',processing:'succeeded',privacyStatus:'unlisted',playbackVerified:true,pageAccessVerified:true}]});
test('completion runs the shared handler only after all media/page proof prerequisites',async()=>{
  let options;const result=await completeVideoAccess(proof(),{now,run:async value=>{options=value;return {ok:true,accessVerified:true,verification:{ok:true,verifiedAt:'fresh'}};}});
  assert.deepEqual(options,{apply:true,expectedGroupCodes:['g123abc']});assert.equal(result.status,'staff_access_verified');
});
test('every readiness failure prevents any staff call',async()=>{
  for(const change of [p=>p.siteCode='other',p=>p.unitCode='other',p=>p.verifiedAt='bad',p=>p.verifiedAt=new Date(now-900001).toISOString(),
    p=>p.verifiedAt=new Date(now+1).toISOString(),p=>p.nativePagesPublished=false,p=>p.catalogConnectionVerified=false,
    p=>p.videos=[],p=>p.videos[0].processing='processing',p=>p.videos[0].privacyStatus='private',
    p=>p.videos[0].playbackVerified=false,p=>p.videos[0].pageAccessVerified=false,p=>p.videos[0].watchPath='https://other.example/']) {
    const value=proof();change(value);await assert.rejects(completeVideoAccess(value,{now,run:()=>assert.fail('must not sync')}));
  }
});
test('sync errors or incomplete independent readback never claim video completion',async()=>{
  await assert.rejects(completeVideoAccess(proof(),{now,run:async()=>{throw Error('pending');}}),/pending/);
  for(const result of [{ok:true},{ok:true,accessVerified:true},{ok:true,accessVerified:true,verification:{ok:false}}]) {
    await assert.rejects(completeVideoAccess(proof(),{now,run:async()=>result}),/not independently verified/);
  }
});
test('multiple videos in one team deduplicate only the expected group',()=>{
  const value=proof();value.videos.push({...value.videos[0],youtubeId:'bcdefghijkl'});
  assert.deepEqual(validateVideoReadiness(value,now),['g123abc']);
});

test('proof expiring during slow verification remains pending without repeating sync',async()=>{
  let time=now,calls=0;
  await assert.rejects(completeVideoAccess(proof(),{clock:()=>time,run:async()=>{
    calls++;time+=900001;return {ok:true,accessVerified:true,verification:{ok:true}};
  }}),/Fresh media/);
  assert.equal(calls,1);
});
