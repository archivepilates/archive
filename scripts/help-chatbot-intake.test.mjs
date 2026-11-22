import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cleanAnswers,payload,inquire,pendingKey,savedKey,saveKey,forgetKey,opaqueKey,refundDraft} from '../help/chatbot/intake.js';
const schema=JSON.parse(fs.readFileSync(new URL('../help/assets/inquiry-schema.json',import.meta.url)));
const key='a'.repeat(48), receipt='mi_'+'b'.repeat(32);
const basic={category:'booking',memberName:'가상 테스트',memberPhone:'010-0000-0000',contact:'문자',privacyConsent:true,details:'합성 요청 묘사',website:''};
test('all canonical category choices project an accepted shape and keep only active answers',()=>{
 for(const [category,config] of Object.entries(schema.categories)){
  const draft={...basic,category,answers:{}};
  for(const choice of config.questions){
   if(choice.type||choice.optional)continue;
   draft.answers[choice.id]=choice.multiple?[choice.options[0]]:choice.options[0];
  }
  const body=payload(schema,draft,key);
  assert.equal(body.category,category);assert.equal(body.requestKey,key);
  assert.equal(body.policyVersion,schema.version);assert.equal(body.privacyVersion,schema.privacyVersion);
 }
 const changed={request:'다른 수업으로 변경',mode:'자유예약',nextDay:['월'],nextTime:'오전'};
 assert.equal(cleanAnswers(schema.categories.booking,changed).nextTime,'오전');
 const stopped=cleanAnswers(schema.categories.booking,{...changed,request:'수업 취소'});
 assert.equal(stopped.nextTime,undefined);
 assert.equal(stopped.nextDay,undefined);
 assert.throws(()=>cleanAnswers(schema.categories.booking,{...changed,nextDay:['월','상담 후 결정']}));
 assert.throws(()=>payload(schema,{...basic,privacyConsent:false,answers:changed},key),/동의/);
});
test('retry preserves exact body; reload lookup carries only opaque recovery key',async()=>{
 const body=payload(schema,{...basic,answers:{request:'수업 취소',mode:'자유예약'}},key);
 const requests=[];
 const accept=async(url,opts)=>{requests.push({url,body:opts.body});return {ok:true,status:201,json:async()=>({ok:true,receiptId:receipt})};};
 assert.equal((await inquire(async()=>{throw Error('response lost');},body)).status,'unknown');
 assert.equal((await inquire(accept,body)).receiptId,receipt);
 assert.equal((await inquire(accept,body)).receiptId,receipt);
 assert.deepEqual(requests[0],requests[1]);
 assert.equal(requests[0].url,'/api/inquiries');
 await inquire(accept,{action:'lookup',requestKey:key});
 assert.deepEqual(Object.keys(JSON.parse(requests[2].body)),['action','requestKey']);
 assert.equal((await inquire(async()=>({ok:true,json:async()=>({ok:true,receiptId:'false'})}),body)).status,'unknown');
 assert.equal((await inquire(async()=>({ok:false,status:409,json:async()=>({ok:false})}),body)).status,'conflict');
});
test('storage records only the opaque key under the legacy recovery name',()=>{
 const map=new Map(), storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 assert.match(opaqueKey(),/^[a-f0-9]{48}$/);
 assert.equal(savedKey(storage),null);
 assert.equal(saveKey(storage,key),true);assert.deepEqual([...map],[[pendingKey,key]]);
 assert.equal(savedKey(storage),key);
 forgetKey(storage);assert.equal(savedKey(storage),null);
});

test('refund entry uses exact canonical answer fields, not a new category',()=>{
 const refund=refundDraft(schema);
 assert.deepEqual(refund,{category:'other',answers:{topic:'환불·양도 상담',reply:'담당자 상담'}});
 assert.equal(payload(schema,{...basic,...refund},key).category,'other');
 assert.equal(refundDraft({categories:{other:{questions:[]}}}),null);
});
