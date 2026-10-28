import test from 'node:test';
import assert from 'node:assert/strict';
import { staffImweb } from '../lib/imweb-staff-video-sync.mjs';
test('only native group GETs are paced and receive one bounded read retry',()=>{
  const waits=[],calls=[];
  const options={pause:ms=>waits.push(ms),execute:(binary,args,config)=>{calls.push({args,config});return '{"statusCode":200,"data":{}}';}};
  staffImweb(['member','groups','members','synthetic'],options);
  assert.deepEqual(waits,[1500]);assert.ok(calls[0].args.includes('--retry'));
  assert.equal(calls[0].config.timeout,120000);
  staffImweb(['member','update','groups','synthetic','--yes'],options);
  assert.deepEqual(waits,[1500]);assert.ok(!calls[1].args.includes('--retry'));assert.equal(calls[1].config.timeout,45000);
});
test('zero-exit quota envelope retains non-dispatch classification and contradictions stay unknown',()=>{
  const args=['member','update','groups','synthetic','--yes'];
  assert.throws(()=>staffImweb(args,{execute:()=>JSON.stringify({error:{code:'write_quota_exceeded'}})}),{code:'IMWEB_LOCAL_WRITE_QUOTA_EXCEEDED'});
  assert.throws(()=>staffImweb(args,{execute:()=>JSON.stringify({error:{code:'write_quota_exceeded'},statusCode:429})}),{code:'IMWEB_REQUEST_FAILED'});
});
