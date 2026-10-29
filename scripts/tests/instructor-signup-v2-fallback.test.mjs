import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {completionOnlySignupProfileV2,signupV2Projection} from '../lib/instructor-signup-profile-v2.mjs';
const require=createRequire(new URL('../../firebase/kangsain-functions/functions/package.json',import.meta.url));
const ts=require('typescript'),file=new URL('../process-eformsign-instructor-member-jobs.mjs',import.meta.url);
const tree=ts.createSourceFile(file.pathname,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='inspectCompletion').getText(tree);
const doc='a'.repeat(32),template='a5b5ea6b85ec44c8bcb4af1e980e94eb';
function setup({orderFailure=false,login=false,security=false,wrongRecipient=false}={}){
  const events=[],job={documentId:doc,registrationId:'ilr_'+'b'.repeat(24),studioId:'5330',studiomateMemberId:'9000001',memberName:'Synthetic Member',memberPhone:'01000000001'};
  const completion={documentId:doc,templateId:template,status:'completed',recipients:[{name:job.memberName,phone:wrongRecipient?'01000000002':job.memberPhone}],
    providerCompletedAt:'2025-12-30T00:00:00Z',observedAt:new Date().toISOString()};
  const page={goto:async()=>{},url:()=>login?'https://www.eformsign.com/login.html':'https://www.eformsign.com/eform/document/view_service.html',
    locator:selector=>({count:async()=>0,innerText:async()=>security?'보안 확인':''})};
  const inspect=vm.runInNewContext(declaration+'\ninspectCompletion',{
    URL,Error,EFORMSIGN_COMPLETED_DOCUMENTS_URL:'https://www.eformsign.com/eform/document/document_list.html?mode=ai',
    documentRowEvidenceAfterLoad:async()=>({found:true,documentId:doc}),
    readCompletedRecipientEvidence:async()=>completion,
    readCompletedSignupProfileV2:async(_p,_j,_e,options)=>{if(orderFailure)await options.verifyOrderContact({});throw new Error('Synthetic field unavailable');},
    verifyCompletedOrderContact:async()=>{throw new Error('Synthetic paid order review hold');},
    completionOnlySignupProfileV2,signupV2Projection,
    finalizeCompletedDocument:async(_ref,_job,_e,profile,proof)=>events.push({profile,proof}),
    markCompletionReviewRequired:async()=>({status:'review_required'}),
  });
  return {run:()=>inspect(page,{id:job.registrationId},job),events};
}
test('a proven completed recipient can record its completion note without copying unverified answers',async()=>{
  const m=setup(),r=await m.run();assert.equal(r.status,'completed');assert.equal(m.events.length,1);
  const profile=m.events[0].profile;assert.equal(profile.mode,'completion_only');
  for(const key of ['birthDateRaw','addressRaw','career','affiliation'])assert(!Object.hasOwn(profile,key));
});
for(const [label,options]of Object.entries({paidOrderHold:{orderFailure:true},login:{login:true},security:{security:true},wrongRecipient:{wrongRecipient:true}})){
  test('metadata fallback cannot bypass '+label,async()=>{
    const m=setup(options);assert.equal((await m.run()).status,'review_required');assert.equal(m.events.length,0);
  });
}
