import assert from 'node:assert/strict';
import test from 'node:test';
import {makeHelpRosterGeneration} from './help-roster-projection.mjs';

const now=Date.parse('2026-11-26T05:00:00+09:00'),at=new Date(now-1000).toISOString();
const row=(id,phone,options={})=>({memberId:id,_id:id,studioId:'5330',name:'Test '+id,phone,activeTickets:[{
  userTicketId:id+'1',productId:'104',sourceClass:'G',type:'T',ownerVerified:true,
  usableStatus:'using',status:'active',availableFrom:'2026-11-25T00:00:00+09:00',expiresAt:'2026-12-31T23:59:59+09:00',
  remainingCount:4,usableCoupon:2,...options
}]});
const profileList=[row('1','01000000011'),row('2','01000000022'),row('3','01000000022'),
  row('4',null),row('5','01000000055',{ownerVerified:false}),row('6','01000000066',{productId:'105'})];
const inventory={profiles:profileList,startedAt:at,checkedAt:at,coverage:{kind:'native_member_pages',scope:'member_roster',
  ticketScope:'member_list_userTickets',complete:true,traversalComplete:true,nativeTotal:profileList.length,
  scannedMembers:profileList.length,pagesTraversed:2,pageCount:2,pagesRechecked:2}};
const packageOptions={inventory,sourceDigest:'a'.repeat(64),now,
  products:[{productId:'104',sourceClass:'G',sourceType:'T',category:'group'}],
  contactKey:Buffer.alloc(32,1),memberKeySecret:Buffer.alloc(32,2)};

test('complete inventory projects only safe class cards and does not retain identity or phone literals',()=>{
  const batch=makeHelpRosterGeneration(packageOptions);
  assert.equal(batch.members.length,1);
  assert.deepEqual(batch.summary.held,{contactMissing:1,contactAmbiguous:2,invalidCard:2,withoutCards:0});
  assert.equal(batch.summary.unreviewedProducts,1);
  assert.equal(batch.members[0].cards[0].remaining,4);
  assert.equal(batch.members[0].cards[0].bookable,2);
  assert.deepEqual(Object.keys(batch.members[0]).sort(),['cards','memberKey','phoneKey']);
  assert.doesNotMatch(JSON.stringify(batch),/Test 1|01000000011/u);
});

test('a partial, stale or ambiguous canary cannot publish',()=>{
  assert.throws(()=>makeHelpRosterGeneration({...packageOptions,inventory:{...inventory,coverage:{...inventory.coverage,complete:false}}}),/native_roster_unverified/);
  assert.throws(()=>makeHelpRosterGeneration({...packageOptions,now:now+31*60_000}),/roster_generation_unverified/);
  assert.throws(()=>makeHelpRosterGeneration({...packageOptions,onlyMembers:new Set(['1','2'])}),/roster_canary_scope_unverified/);
});
