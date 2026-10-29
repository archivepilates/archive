import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TEAM_IDS,assertTeamRegistration,assertTeamLectures,selectTeamTicket} from '../lib/team-261120-scope.mjs';
const registration=()=>({studioId:'5330',courseKind:'team',ticketName:'Team 강사레슨',lessonDate:'2026-11-20',lessonTime:'14:00',
  lessonTopic:'ARCHIVE METHOD #1 직장인 증후군',paymentAmount:80000,paymentMethod:'wiretransfer',memberName:'테스트',memberPhone:'01000000000'});
test('only the exact six Team intake records and payment scope are accepted',()=>{
  assertTeamRegistration(TEAM_IDS[0],registration());
  for(const patch of [{paymentAmount:70000},{lessonDate:'2026-11-21'},{courseKind:'regular'},{cancellation:{}},{externalOrderReviewRequired:true}])
    assert.throws(()=>assertTeamRegistration(TEAM_IDS[0],{...registration(),...patch}));
  assert.throws(()=>assertTeamRegistration('other',registration()));
});
test('unknown/incomplete and duplicate ticket lists never mean no ticket',()=>{
  assert.throws(()=>selectTeamTicket({status:'review',tickets:[]},'1'));
  const result={status:'verified',reason:'complete_native_ticket_list',tickets:[]};
  assert.equal(selectTeamTicket(result,'1'),null);
  const ticket={title:'Team 강사레슨',availabilityStartAt:'2026-11-20',expireAt:'2026-11-20'};
  assert.throws(()=>selectTeamTicket({...result,tickets:[ticket,ticket]},'1'));
  assert.throws(()=>selectTeamTicket({...result,tickets:[ticket]},'1'));
});
test('both exact native sessions and complete coverage are mandatory',()=>{
  const data=[{id:98900618,start_on:'2026-11-20 14:00:00',end_on:'2026-11-20 14:50:00',staff:{id:1983525},room:{name:'체어'},max_trainee:6,active:true,title:'강사레슨(team)'},
    {id:98900887,start_on:'2026-11-20 15:00:00',end_on:'2026-11-20 15:50:00',staff:{id:2222464},room:{name:'바렐'},max_trainee:6,active:true,title:'강사레슨(Team)'}];
  for(const r of data)r.course={active:true,studio_id:5330,instructor_id:r.staff.id,type:'G',deleted_at:null};
  const source={data,meta:{last_page:1,total:2}};
  assert.equal(assertTeamLectures(source).length,2);
  assert.throws(()=>assertTeamLectures({...source,meta:{last_page:2,total:2}}));
  assert.throws(()=>assertTeamLectures({...source,data:[{...data[0],max_trainee:5},data[1]]}));
});
