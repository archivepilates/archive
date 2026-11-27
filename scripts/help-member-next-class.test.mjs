import assert from 'node:assert/strict';
import {test} from 'node:test';
import {memberPlanText,memberPlanIntent,clarification} from '../help/chatbot/member-plan.js';
import {conversationTurn} from '../help/chatbot/conversation.js';
import {applyNaturalReply} from '../help/chatbot/public-natural.js';
import {collectRecentAttendance,makeRecentAttendanceProjection} from '../services/archive-help-member-access/recent-attendance.mjs';
import {currentPassMemberKey} from '../services/archive-help-member-access/current-pass-snapshot.mjs';
const now=new Date('2026-11-27T00:00:00Z');
const attendance={windowThrough:'2026-11-27',lastOn:'2026-11-26',byCategory:{group:7,private:0,duet:0,triple:0}};
const pass={category:'group',type:'count',status:'active',startsOn:'2026-11-01',expiresOn:'2026-11-27',remaining:5,bookable:1};
test('authenticated member intent preserves history vs recommendation, and clarifies with usable labels',()=>{
  assert.deepEqual(memberPlanIntent('내 출석 기록을 참고해서 수업 추천',{connected:true}),{kind:'plan',time:null});
  assert.deepEqual(memberPlanIntent('수강 이력'),{kind:'history'});
  assert.deepEqual(memberPlanIntent('평일 저녁',{connected:true,preferring:true}),{kind:'plan',time:'weekdayEvening'});
  assert.equal(memberPlanIntent('친구 수업 이력',{connected:true}),null);
  assert.equal(memberPlanIntent('수업 추천'),null);
  assert.deepEqual(conversationTurn('이거 그건가요',{}, {now}).choices,clarification.choices);
  assert.equal(conversationTurn('수업 시간',{}, {now}).timetable.title,'11월 명지점 시간표');
  assert.doesNotMatch(conversationTurn('운동 계획',{}, {now}).text,/정확히 이해하지/);
  assert.deepEqual(applyNaturalReply({}, {link:'clarify'}).choices,clarification.choices);
});
test('uses actual booking budget and expiry, avoids private slots and never treats stale as no attendance',()=>{
  const data=memberPlanText([pass],attendance,'plan','weekdayEvening',now);
  assert.match(data.text,/그룹 7회[\s\S]*잔여 5회 · 추가 예약 가능 1회[\s\S]*11월 27일\(금\) 19:00/);
  assert.equal((data.text.match(/11월 27일/g)??[]).length,1);
  assert.doesNotMatch(data.text,/11월 28일/);
  assert.match(memberPlanText([{...pass,status:'held'}],attendance,'plan',null,now).text,/추천에 사용할 수 있는 수강권이 확인되지/);
  assert.match(memberPlanText([{...pass,bookable:0}],attendance,'plan',null,now).text,/추천에 사용할 수 있는 수강권이 확인되지/);
  assert.match(memberPlanText([{...pass,category:'private'}],attendance,'plan',null,now).text,/공개 그룹 시간표를 적용하지/);
  assert.match(memberPlanText([pass],null,'history',null,now).text,/미출석으로 판단하지/);
  assert.match(memberPlanText([{...pass,expiresOn:'2026-12-05'}],attendance,'plan',null,new Date('2026-12-01T02:00:00Z')).text,/확인된 공개 예정표가 없어요/);
});
const row=(id,memberId,product,status='attendance')=>({id,studio_id:5330,status,member:{id:memberId},
  lecture:{studio_id:5330,start_on:'2026-11-26 11:00:00'},user_ticket:{ticket:{id:product}}});
test('native source uses exact scoped attendance; projection omits unknown ownership/coverage and raw IDs',async()=>{
  const source=[row(1,101,33),row(2,101,33,'cancel'),row(3,101,35),row(4,102,977)];
  const get=rows=>async()=>({bookings:{current_page:1,last_page:1,total:rows.length,data:rows}});
  const signal=AbortSignal.timeout(1200);
  const snapshot=await collectRecentAttendance({fetchPage:get(source),now:()=>+now,signal});
  assert.equal(snapshot.rows.length,3);
  await assert.rejects(collectRecentAttendance({fetchPage:get([...source,source[0]]),now:()=>+now,signal}),/scope_unverified/);
  await assert.rejects(collectRecentAttendance({fetchPage:get([{...source[0],member_id:103}]),now:()=>+now,signal}),/scope_unverified/);
  await assert.rejects(collectRecentAttendance({fetchPage:get([{...source[0],studio_id:4000}]),now:()=>+now,signal}),/scope_unverified/);
  const secret=Buffer.alloc(32,1);
  const members=['101','102','103'].map(memberId=>({memberKey:currentPassMemberKey(secret,memberId)}));
  const batch={members,sourceDigest:'a'.repeat(64),observedAt:new Date(+now+1000).toISOString()};
  const products=[{productId:'33',category:'group'},{productId:'35',category:'excluded'}];
  const projection=makeRecentAttendanceProjection({snapshot,batch,products,secret,now:+now+2000});
  assert.equal(projection.records.length,2);
  assert.deepEqual(projection.records.map(x=>[x.memberKey,x.attendance.byCategory.group]),
    [[members[0].memberKey,1],[members[2].memberKey,0]]);
  assert(!JSON.stringify(projection).includes('productId'));
  assert(!JSON.stringify(projection).includes('memberId'));
});
