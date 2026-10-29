import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseInstructorEformProgress} from '../lib/instructor-eform-progress-evidence.mjs';
const input=()=>({httpStatus:200,documentName:'Synthetic document',memberName:'Synthetic',memberPhone:'01000000000',now:1000,
  body:{status:'200',code:'-1',result:{status:{document_title:'Synthetic document',steps:[
    {seq:1,action:'doc_create',execute_date:1},{seq:2,action:'doc_request_participant',execute_date:-1,
      owner:{members:['Synthetic(01000000000)'],groups:[],external_creators:null}},
    {seq:3,action:'',execute_date:-1}],current_infos:[{step_seq:2,expired_date:2000}]}}}});
test('pending native request binds current exact recipient, not completion or SMS delivery',()=>{
  const result=parseInstructorEformProgress(input());assert.equal(result.status,'signature_requested');
  assert.equal(result.memberSignatureComplete,false);assert.equal(result.providerDeliveryVerified,false);
});
for(const [name,change] of Object.entries({
  wrongRecipient:i=>i.memberPhone='01000000001',expired:i=>i.now=3000,
  acceptedInsteadOfPending:i=>i.body.result.status.steps[1].action='doc_accept_participant',
  duplicateRecipient:i=>i.body.result.status.steps[1].owner.members.push('Synthetic(01000000000)'),
  wrongCurrentStep:i=>i.body.result.status.current_infos[0].step_seq=3,
  completed:i=>{i.body.result.status.steps[2].action='doc_complete';i.body.result.status.steps[2].execute_date=900;},
}))test(name+' fails closed',()=>{const i=input();change(i);assert.throws(()=>parseInstructorEformProgress(i));});
