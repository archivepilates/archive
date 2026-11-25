import assert from 'node:assert/strict';
import test from 'node:test';
import {createInternalStudioMatePilot,createInternalStudioMateReader} from './internal-studiomate.mjs';

const target={memberId:'417',name:'Synthetic Member',phone:'01000000001'};
const range={startDate:'2026-10-25',endDate:'2026-11-24'};
const signal=new AbortController().signal;
const checkedAt='2026-11-24T00:00:00.000Z';

test('internal reader passes only exact targets and strips operator fields',async()=>{
  const admin={
    findMembers(){assert.fail('member search must not be exposed');},
    async getOverview(who){
      assert.deepEqual(who,target);
      return {...who,checkedAt,memberGrade:'private',coverage:'current_ticket_cards',tickets:[{
        name:'Verified product',type:'Group count',status:'Active',availableFromDate:'2026-11-01',
        expiresOn:'2026-12-10',remainingCount:6,reservableCount:2,paymentAmount:1000000,userTicketId:'sensitive'}]};
    },
    async getBookings(who,requestedRange){
      assert.deepEqual(who,target);
      return {...who,checkedAt,coverage:{kind:'native_member_booking_history',complete:true,traversalComplete:true,requestedRange},
        records:[{lectureDate:'2026-11-03',lessonType:'group',sourceStatus:'attendance',staffName:'sensitive',bookingId:'sensitive'}]};
    }
  };
  const reader=createInternalStudioMateReader(admin);
  assert.deepEqual(Object.keys(reader).sort(),['getBookings','getOverview']);
  assert.equal(await reader.getOverview({...target,extra:'no'},signal),null);
  assert.equal(await reader.getBookings(target,{...range,startDate:'2026-10-24'},signal),null);
  assert.equal((await reader.getOverview(target,signal)).tickets[0].remainingCount,6);
  assert.doesNotMatch(JSON.stringify(await reader.getOverview(target,signal)),/memberGrade|paymentAmount|userTicketId|sensitive/);
  assert.deepEqual((await reader.getBookings(target,range,signal)).records,[{
    lectureDate:'2026-11-03',lessonType:'group',sourceStatus:'attendance'}]);
});

test('mismatched native identity, incomplete coverage and cancellation never yield data',async()=>{
  const reader=createInternalStudioMateReader({
    getOverview:async()=>({...target,memberId:'418',checkedAt,coverage:'current_ticket_cards',tickets:[]}),
    getBookings:async()=>({...target,checkedAt,records:[],coverage:{kind:'native_member_booking_history',complete:false}})
  });
  assert.equal(await reader.getOverview(target,signal),null);
  assert.equal(await reader.getBookings(target,range,signal),null);
  assert.equal(await reader.getOverview(target,AbortSignal.abort()),null);
});

test('no admin browser on disabled startup, and failed initialization closes it',async()=>{
  const disabled=await createInternalStudioMatePilot({makeAdminReader:()=>assert.fail('disabled must not open reader')});
  assert.equal((await disabled.handle(new Request('https://help.archivepilates.com/api/member-access/cards'))).status,404);
  let closed=false;
  await assert.rejects(createInternalStudioMatePilot({enabled:true,
    makeAdminReader:()=>({getOverview(){},getBookings(){},close(){closed=true;}})}),/Independently scoped member sources/);
  assert.equal(closed,true);
});
