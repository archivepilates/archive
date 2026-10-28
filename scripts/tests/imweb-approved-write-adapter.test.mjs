import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { imwebApprovedJson } from '../lib/imweb-referral-source.mjs';
import { createImwebNativeFollowupStore, imwebPayloadDigest } from '../lib/imweb-native-followup.mjs';

function fixture(t) {
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'imweb-approved-adapter-')));
  fs.chmodSync(directory,0o700); t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const payload={prodStatus:'sale'}, now=new Date().toISOString();
  const operation={canonicalActionKey:'synthetic-product-open',siteCode:'synthetic-site',unitCode:'synthetic-unit',
    approvedScope:{action:'product.update.status',targetIds:['88'],fields:['prodStatus']},payloadDigest:imwebPayloadDigest(payload),
    approvalRef:'chat:synthetic',ledgerRef:'ledger:synthetic',approvedAt:now,approvalExpiresAt:new Date(Date.now()+3600000).toISOString()};
  return {payload,operation,targetRef:'88',store:createImwebNativeFollowupStore({directory})};
}
const context={resolved_profile:{site_code:'synthetic-site',unit_code:'synthetic-unit'}};
test('adapter keeps dry-run/confirmation and accepts only one CLI write',async t=>{
  const f=fixture(t), calls=[];
  const result=await imwebApprovedJson(['product','update','status','88'],{...f,execute:(_bin,args)=>{
    calls.push(args);return JSON.stringify(args.includes('context')?context:args.includes('--dry-run')?{confirmation_token:'synthetic-token'}:{ok:true});
  }});
  assert.equal(result.ok,true);assert.equal(calls.length,3);
  assert(calls[1].includes('--dry-run'));assert(calls[2].includes('--yes'));assert(calls[2].includes('synthetic-token'));
  assert.equal(f.store.get(f.operation.canonicalActionKey).status,'cli_accepted');
});
test('local cap routes once to durable native continuation; no CLI replay',async t=>{
  const f=fixture(t);let writes=0;
  const execute=(_bin,args)=>{if(args.includes('context'))return JSON.stringify(context);writes++;
    throw {stdout:JSON.stringify({ok:false,error:{classification:'write_quota_exceeded'}}),status:1};};
  for(let i=0;i<2;i++)await assert.rejects(imwebApprovedJson(['product','update','status','88'],{...f,execute}),{code:'IMWEB_NATIVE_ADMIN_REQUIRED'});
  assert.equal(writes,1);assert.equal(f.store.get(f.operation.canonicalActionKey).status,'prepared');
});
test('scope, unexpected fields and wrong context stop before a write',async t=>{
  const f=fixture(t);let writes=0;
  const execute=()=>{writes++;return JSON.stringify({resolved_profile:{site_code:'wrong'}});};
  await assert.rejects(imwebApprovedJson(['product','update','status','88'],{...f,execute}),/site\/unit/);
  assert.equal(writes,1);
  for(const patch of [{targetRef:'89'},{payload:{prodStatus:'sale',price:0}},{operation:{...f.operation,approvedScope:{...f.operation.approvedScope,action:'member.update.groups'}}}])
    await assert.rejects(imwebApprovedJson(['product','update','status','88'],{...f,...patch,execute}),/scope mismatch/);
  assert.equal(writes,1);
});
test('member UID must resolve to the exact approved canonical member before execution',async t=>{
  const f=fixture(t),payload={unitCode:'synthetic-unit',groupCodes:['synthetic-group']};
  const operation={...f.operation,approvedScope:{action:'member.update.groups',targetIds:['synthetic-member'],fields:['unitCode','groupCodes']},payloadDigest:imwebPayloadDigest(payload)};
  let writes=0;
  await assert.rejects(imwebApprovedJson(['member','update','groups','synthetic@example.test'],{...f,operation,payload,targetRef:'synthetic-member',execute:(_bin,args)=>{
    if(args.includes('context'))return JSON.stringify(context);
    if(args.includes('get'))return JSON.stringify({data:{memberCode:'different-member',uid:'synthetic@example.test',siteCode:'synthetic-site',unitCode:'synthetic-unit'}});
    writes++;assert.fail('identity mismatch must never write');
  }}),/identity mismatch/);
  assert.equal(writes,0);assert.equal(f.store.get(operation.canonicalActionKey),null);
});
