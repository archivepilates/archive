import assert from 'node:assert/strict';
import test from 'node:test';
import {auditNativeHelpRegistration,makeHelpRosterGeneration} from './help-roster-projection.mjs';
import {scopeHelpRosterBinding} from './help-roster-binding.mjs';

const now=Date.parse('2026-11-26T05:00:00+09:00'),at=new Date(now-1000).toISOString();
const row=(id,phone,options={})=>({memberId:id,_id:id,studioId:'5330',name:'Test '+id,phone,
  helpRegistration:{source:'native_member_registration_v1',registeredAt:'2026-11-20T00:00:00Z',inactive:false},activeTickets:[{
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
  assert.deepEqual(batch.summary.held,{contactMissing:1,contactAmbiguous:2,invalidCard:2,withoutCards:0,registrationUnverified:0});
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

test('general roster requires native registration and refuses duplicate numbers even from inactive profiles',()=>{
  const active=row('10','01000000010');
  const missing={...row('11','01000000011'),helpRegistration:undefined};
  const inactive=row('12','01000000012');
  inactive.helpRegistration.inactive=true;
  const future=row('13','01000000013');
  future.helpRegistration.registeredAt=new Date(now+60000).toISOString();
  const registeredAfterObservation=row('14','01000000014');
  registeredAfterObservation.helpRegistration.registeredAt=new Date(now).toISOString();
  const matchesInactive=row('15',inactive.phone);
  const profiles=[active,missing,inactive,future,registeredAfterObservation,matchesInactive];
  const input={...inventory,profiles};
  assert.deepEqual(auditNativeHelpRegistration(input),{registeredActive:2,registrationAndContactCandidates:1,
    heldInactive:1,heldRegistrationUnverified:3,heldContact:1});
  const batch=makeHelpRosterGeneration({...packageOptions,inventory:input});
  assert.equal(batch.members.length,1);
  assert.equal(batch.summary.held.registrationUnverified,3);
  assert.equal(batch.summary.held.contactAmbiguous,2);
  assert.equal(JSON.stringify(batch).includes('registeredAt'),false);
  assert.equal(batch.nativeContacts.length,profiles.length);
  assert.equal(batch.nativeContacts.filter(c=>c.phoneKey!==null).length,1);
});

test('product title drift is reported and the separate contact observation is retained',()=>{
  const input={...packageOptions,products:[{...packageOptions.products[0],sourceTitle:'Wrong historical title'}]};
  const batch=makeHelpRosterGeneration(input);
  assert.equal(batch.members.length,0);
  assert.equal(batch.summary.unreviewedProducts,2);
  assert.equal(batch.nativeContacts.length,profileList.length);
});

test('an expanded data batch never gives general members access while the canary is restricted',async()=>{
  const pilotSubject='a'.repeat(64),secondSubject='b'.repeat(64),another='c'.repeat(64);
  const lookup=async ({memberId})=>({memberId});
  const canary=scopeHelpRosterBinding(lookup,{pilotSubject,secondSubject});
  assert.deepEqual(await canary({memberId:pilotSubject}),{memberId:pilotSubject});
  assert.deepEqual(await canary({memberId:secondSubject}),{memberId:secondSubject});
  assert.equal(await canary({memberId:another}),null);
  assert.equal(await scopeHelpRosterBinding(lookup,{pilotSubject})({memberId:secondSubject}),null);
  const publicLookup=scopeHelpRosterBinding(lookup,{publicRoster:true,pilotSubject,secondSubject});
  assert.deepEqual(await publicLookup({memberId:another}),{memberId:another});
  assert.equal(await publicLookup({memberId:'fake'}),null);
});
