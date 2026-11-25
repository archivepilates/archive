import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {digest,STUDIO_ID} from './accounts.mjs';
import {createCloudEnrollmentAuthority} from './cloud-enrollment-authority.mjs';

const time=Date.parse('2026-11-25T07:00:00Z');
const reference=randomBytes(32).toString('base64url');
const selector={studioId:STUDIO_ID,memberId:'417',revision:'a'.repeat(64)};
const record={...selector,authority:'verified_studiomate_in_person_signup',signupComplete:true,active:true,
  revoked:false,registeredContactVerified:true,phone:'01000000001',sourceObservedAt:time-1000};
const approval={...selector,authority:'approved_help_enrollment',approved:true,expiresAt:time+60_000};

test('operator enrollment needs an approved reference and a fresh exact binding',async()=>{
  let current=record, intent=approval, reads=0;
  const adapter=createCloudEnrollmentAuthority({now:()=>time,
    loadEnrollment:async ({referenceDigest})=>referenceDigest===digest(reference)?intent:null,
    loadCurrentBinding:async ({studioId,memberId})=>{
      assert.deepEqual({studioId,memberId},{studioId:STUDIO_ID,memberId:'417'});reads++;return current;
    }});
  assert.equal(await adapter.verifyEnrollment('417',{studioId:STUDIO_ID}),null);
  assert.equal(await adapter.verifyEnrollment(randomBytes(32).toString('base64url'),{studioId:STUDIO_ID}),null);
  assert.equal(reads,0);
  const result=await adapter.verifyEnrollment(reference,{studioId:STUDIO_ID});
  assert.equal(result.checkedAt,time);
  assert.equal(result.sourceObservedAt,time-1000);
  assert.equal(result.authority,'verified_cloud_member_binding');
  assert.ok(!Object.hasOwn(result,'nativeVerified')&&!Object.hasOwn(result,'phone'));
  for(const change of [{memberId:'418'},{revision:'b'.repeat(64)},{revoked:true},{signupComplete:false},
    {active:false},{sourceObservedAt:time+1},{sourceObservedAt:time-26*60*60_000}]){
    current={...record,...change};
    assert.equal(await adapter.confirmBinding(selector),null);
    assert.equal(await adapter.verifyEnrollment(reference,{studioId:STUDIO_ID}),null);
  }
  current=record;intent={...approval,expiresAt:time};
  assert.equal(await adapter.verifyEnrollment(reference,{studioId:STUDIO_ID}),null);
});

test('the OTP destination has a stricter separate freshness limit',async()=>{
  let observed=time-60*60_000;
  const adapter=createCloudEnrollmentAuthority({now:()=>time,loadEnrollment:async()=>null,
    loadCurrentBinding:async()=>({...record,sourceObservedAt:observed})});
  assert.ok(await adapter.confirmBinding(selector));
  assert.equal(await adapter.resolveRecipient(selector),null);
  observed++;
  const recipient=await adapter.resolveRecipient(selector);
  assert.equal(recipient.phone,record.phone);
  assert.equal(recipient.authority,'verified_cloud_registered_contact');
  assert.equal(await adapter.resolveRecipient({...selector,signal:AbortSignal.abort()}),null);
});
