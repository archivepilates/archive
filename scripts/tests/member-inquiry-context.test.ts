import test from 'node:test';
import assert from 'node:assert/strict';
import {readInquiryMemberContext} from '../../firebase/kangsain-functions/functions/src/memberInquiries/memberContext';
import {matchingGuidance,guidanceEvidence} from '../../firebase/kangsain-functions/functions/src/memberInquiries/guidance';

const NOW=Date.parse('2026-11-10T00:00:00Z');
const row={studioId:'5330',memberName:'가상회원',memberPhone:'01000000000'};
const profile={studioId:'5330',name:'가상회원',phone:'01000000000',memberId:'native',syncedAt:new Date(NOW),
  activeTickets:[{name:'가상 그룹권',remainingCount:null,usableCount:null,status:'holding'}],
  ticketStatusSummary:{holdingTickets:[{name:'가상 그룹권',status:'holding'}]},birthDate:'private',email:'private',memoPreview:'private'};
function database(rows:Record<string,any>){
  const reads:string[]=[];
  const snapshot=(key:string)=>({id:key.split('/').at(-1),exists:key in rows,data:()=>rows[key]});
  function query(collection:string,filters:Array<[string,string,any]>=[],max=999){return {
    where:(field:string,op:string,value:any)=>query(collection,[...filters,[field,op,value]],max),
    limit:(value:number)=>query(collection,filters,value),doc:(id:string)=>({get:async()=>{reads.push(collection+'/'+id);return snapshot(collection+'/'+id);}}),
    get:async()=>{reads.push(collection);const docs=Object.keys(rows).filter(key=>key.startsWith(collection+'/')&&key.split('/').length===2)
      .filter(key=>filters.every(([field,op,value])=>op==='in'?value.includes(rows[key][field]):rows[key][field]===value)).slice(0,max).map(snapshot);return {docs,size:docs.length};},
    set:()=>assert.fail('No mutations'),update:()=>assert.fail('No mutations')};}
  return {collection:query,reads};
}
test('member context is exact stored-source matching, read-only and field projected',async()=>{
  const db=database({'memberProfiles/native':profile,'bookings/booking':{memberId:'native',memberPhone:row.memberPhone,studioId:'5330',lectureDate:'2026-11-11',startTime:'10:00',staffName:'가상강사',title:'그룹',appStatus:'booked',privateNote:'private'}});
  const result=await readInquiryMemberContext(db,row,NOW);
  assert.equal(result.status,'unique_stored_match');assert.equal(result.profile.memberId,'native');
  assert.equal(result.tickets[0].remainingCount,null);assert.equal(result.tickets[0].usableCount,null);
  assert.equal(result.holds[0].name,'가상 그룹권');assert.equal(result.bookings.length,1);
  assert(!JSON.stringify(result).includes('private'));assert(!JSON.stringify(result).includes(row.memberPhone));
  assert.match(result.note,/실시간 조회가 아닙니다/);assert.equal(result.profile.syncedAt,new Date(NOW).toISOString());
});
test('ambiguity, unverified name or studio mismatch cannot expose a profile or bookings',async()=>{
  for(const profiles of [
    {'memberProfiles/one':profile,'memberProfiles/two':profile},
    {'memberProfiles/one':{...profile,name:'다른회원'}},
    {'memberProfiles/one':{...profile,studioId:'other'}},
  ]){const db=database(profiles),result=await readInquiryMemberContext(db,row,NOW);assert(!result.profile);assert.deepEqual(result.bookings,[]);assert(!db.reads.includes('bookings'));}
});
test('native source supersedes matching Excel fallback without writes; conflicting native identity does not',async()=>{
  const db=database({'memberProfiles/native':{...profile,studiomateMemberId:1},'memberProfiles/excel_a':{...profile,studiomateMemberId:1},
    'bookings/excel_booking_a':{memberId:'native',studioId:'5330',lectureDate:'2026-11-11',startTime:'10:00',staffName:'가상강사',title:'그룹',appStatus:'booked'},
    'bookings/native_booking':{memberId:'native',studioId:'5330',lectureDate:'2026-11-11',startTime:'10:00',staffName:'가상강사',title:'그룹',appStatus:'booked'}});
  const result=await readInquiryMemberContext(db,row,NOW);assert.equal(result.profile.memberId,'native');assert.equal(result.bookings.length,1);assert.equal(result.bookings[0].bookingId,'native_booking');
  const conflict=database({'memberProfiles/native':{...profile,studiomateMemberId:1},'memberProfiles/excel_a':{...profile,studiomateMemberId:2}});
  assert.equal((await readInquiryMemberContext(conflict,row,NOW)).status,'ambiguous');
});
test('merge references must preserve exact name, phone and studio and never cycle',async()=>{
  for(const target of [{...profile,studioId:'other'},{...profile,phone:'01000000001'},{...profile,name:'다른회원'},{...profile,canonicalMemberId:'old'}]){
    const result=await readInquiryMemberContext(database({'memberProfiles/old':{...profile,canonicalMemberId:'target'},'memberProfiles/target':target}),row,NOW);
    assert(['incomplete','ambiguous'].includes(result.status));assert(!result.profile);
  }
});
test('bounded coverage is explicit rather than a whole-roster or latest-bookings claim',async()=>{
  const profiles=Object.fromEntries(Array.from({length:21},(_,i)=>['memberProfiles/p'+i,profile]));
  const limited=await readInquiryMemberContext(database(profiles),row,NOW);assert.equal(limited.status,'ambiguous');assert.equal(limited.coverage.profilesLimited,true);
  const bookings=Object.fromEntries(Array.from({length:51},(_,i)=>['bookings/b'+i,{memberId:'native',studioId:'5330',lectureDate:'2026-11-'+String(i%28+1).padStart(2,'0'),startTime:'10:00',staffName:String(i),title:'그룹',appStatus:'booked'}]));
  const result=await readInquiryMemberContext(database({'memberProfiles/native':profile,...bookings}),row,NOW);assert.equal(result.coverage.bookingsLimited,true);assert.equal(result.bookings.length,30);
});
test('invalid submitted identity is incomplete without querying member profiles',async()=>{
  const db=database({});assert.equal((await readInquiryMemberContext(db,{...row,memberPhone:'bad'},NOW)).status,'incomplete');assert.deepEqual(db.reads,[]);
});
test('matched rules change by exact choice, never approve an exception or interpret free text',()=>{
  const ids=(category:string,answers:any)=>matchingGuidance(category,answers).map(rule=>rule.id);
  assert(ids('booking',{mode:'자유예약'}).includes('booking-flexible'));assert(!ids('booking',{mode:'자유예약'}).includes('booking-fixed'));
  assert(ids('booking',{mode:'고정예약'}).includes('booking-fixed'));assert(!ids('booking',{mode:'고정예약'}).includes('booking-flexible'));
  assert(ids('holding',{ticket:'기간권'}).includes('holding-period'));assert(!ids('holding',{ticket:'기간권'}).includes('holding-count'));
  assert(ids('fixed',{request:'해지 방법 문의'}).includes('fixed-end'));
  assert.deepEqual(guidanceEvidence('conversion',{}),{version:'2026-11-10.1',ruleIds:['conversion-review'],source:'curated_existing_notion_rules',basis:'server_rules_at_receipt',memberReadVerified:false,automaticDecision:false});
  assert.equal(ids('other',{topic:'그 외 문의',details:'고정예약 취소해줘'}).length,0);
});
