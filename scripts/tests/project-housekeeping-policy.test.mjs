import test from 'node:test';
import assert from 'node:assert/strict';
import {isExpiredVideoRateGuard,assertRateGuardPath,utcHour,RATE_GUARD_RETENTION_MS,CLEANUP_GRACE_MS} from '../lib/project-housekeeping-policy.mjs';

const now=Date.parse('2026-10-28T11:00:00Z');
const updated=now-RATE_GUARD_RETENTION_MS-CLEANUP_GRACE_MS-1000;
const row={id:`buyer_synthetic_${utcHour(updated)}`,subjectKey:'synthetic',scope:'buyer',count:4,updatedAtMs:updated,expiresAtMs:updated+RATE_GUARD_RETENTION_MS};
test('expired hour-scoped guard with original retention is eligible',()=>assert.equal(isExpiredVideoRateGuard(row,now),true));
test('network guard uses the same strict rule',()=>assert.equal(isExpiredVideoRateGuard({...row,id:row.id.replace('buyer_','network_'),scope:'network'},now),true));
test('active and newly expired guards stay protected',()=>{
  for(const age of [0,1000,CLEANUP_GRACE_MS]){
    const updatedAtMs=now-RATE_GUARD_RETENTION_MS-age;
    assert.equal(isExpiredVideoRateGuard({...row,id:`buyer_synthetic_${utcHour(updatedAtMs)}`,updatedAtMs,expiresAtMs:updatedAtMs+RATE_GUARD_RETENTION_MS},now),false);
  }
});
test('scope, prefix, bucket and original expiry duration must agree',()=>{
  for(const patch of [{scope:'auth'},{id:'network_synthetic_'+utcHour(updated)},{id:'buyer_synthetic_2026102800'},{expiresAtMs:row.expiresAtMs-1},{updatedAtMs:null},{expiresAtMs:NaN},{count:0},{count:1.2}]){
    assert.equal(isExpiredVideoRateGuard({...row,...patch},now),false);
  }
});
test('other collections, parents and descendants cannot be deletion paths',()=>{
  assert.doesNotThrow(()=>assertRateGuardPath('videoWatchRateLimits/example'));
  for(const path of ['bookings/example','alimtalkSends/example','videoWatchEvents/example','videoWatchRateLimits','videoWatchRateLimits/','videoWatchRateLimits/example/children/x','workLanes/example'])assert.throws(()=>assertRateGuardPath(path));
});
test('subject identity must reconstruct the exact source key',()=>{
  for(const subjectKey of [undefined,null,'','wrong','invalid/key']){
    assert.equal(isExpiredVideoRateGuard({...row,subjectKey},now),false);
  }
  assert.equal(isExpiredVideoRateGuard({...row,id:42},now),false);
});
test('out-of-range and malformed timestamps fail closed',()=>{
  for(const value of [Infinity,-1,8640000000000001,'2026-10-28']){
    for(const field of ['updatedAtMs','expiresAtMs'])assert.equal(isExpiredVideoRateGuard({...row,[field]:value},now),false);
    assert.equal(isExpiredVideoRateGuard(row,value),false);
  }
});
test('missing proof is never treated as expiry',()=>{
  assert.equal(isExpiredVideoRateGuard(null,now),false);
  assert.equal(isExpiredVideoRateGuard({},now),false);
});
