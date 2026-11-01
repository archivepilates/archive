import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {splitSignupPostalAddress,signupPostalAddressKey,signupPostalSelectionMatches} from '../lib/instructor-signup-profile-v2-writer.mjs';

const source=readFileSync(new URL('../verify-instructor-signup-enrichment.mjs',import.meta.url),'utf8');
const start=source.indexOf("if(['verified','already_equal'].includes(progress.address.status))");
const end=source.indexOf('report.rows.push',start);
assert(start>0&&end>start);
const check=new vm.Script(source.slice(start,end));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(status='verified') {
  const raw='서울특별시 강남구 역삼동 123-4 301호',parts=splitSignupPostalAddress(raw);
  const values={address:'서울특별시 강남구 테헤란로 123',detail:parts.detail};
  const progress={address:{status,lookupEvidence:{kind:'native_exact_result_same_row_v1',
    sourceBaseHash:sha(signupPostalAddressKey(parts.base)),selectedValueHash:sha(signupPostalAddressKey(values.address)),
    detailHash:sha(parts.detail)}},beforeFieldHashes:{address:sha(''),detail:sha('')}};
  return {values,progress,job:{profileUpdate:{addressRaw:raw}}};
}
function verify(f) {
  check.runInNewContext({...f,assert,sha,splitSignupPostalAddress,signupPostalAddressKey,signupPostalSelectionMatches});
}
for(const status of ['verified','already_equal'])test('actual verifier accepts bound same-row road callback '+status,()=>verify(fixture(status)));
for(const status of ['verified','already_equal'])for(const alias of [false,true])
  test(`actual verifier normalizes preserved detail whitespace ${status} alias=${alias}`,()=>{
    const f=fixture(status);f.values.detail='  '+f.values.detail+'  ';
    if(!alias){f.values.address=splitSignupPostalAddress(f.job.profileUpdate.addressRaw).base;delete f.progress.address.lookupEvidence;}
    verify(f);
  });
for(const key of ['sourceBaseHash','selectedValueHash','detailHash','kind'])test('actual verifier rejects changed alias evidence '+key,()=>{
  const f=fixture();f.progress.address.lookupEvidence[key]='changed';assert.throws(()=>verify(f));
});
for(const key of ['address','detail'])test('actual verifier rejects changed persisted '+key,()=>{
  const f=fixture();f.values[key]+=' changed';assert.throws(()=>verify(f));
});
test('actual verifier rejects missing alias evidence',()=>{
  const f=fixture();delete f.progress.address.lookupEvidence;assert.throws(()=>verify(f));
});
test('literal source still verifies without alias metadata',()=>{
  const f=fixture();delete f.progress.address.lookupEvidence;f.values.address=splitSignupPostalAddress(f.job.profileUpdate.addressRaw).base;verify(f);
});
test('unresolved address must still match its original preserved fields',()=>{
  const f=fixture('review');f.values={address:'',detail:''};verify(f);
  f.values.address='서울특별시 강남구 테헤란로 123';assert.throws(()=>verify(f));
});
