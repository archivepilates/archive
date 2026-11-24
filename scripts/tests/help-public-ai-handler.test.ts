import assert from "node:assert/strict";
import test from "node:test";
import {classifyPublicIntent,createHelpPublicChatHandler,isHelpPublicAiEnabled,parsePublicSignals} from "../../firebase/kangsain-functions/functions/src/memberInquiries/publicChatIntent";
import {generatePublicReply,parsePublicReplySignals,publicReplyFacts,renderPublicReply,type PublicReplySignals} from "../../firebase/kangsain-functions/functions/src/memberInquiries/publicChatReply";

const signals={tags:["schedule","weekday"],context:"plan",day:4,time:3,frequency:2};
test("the live model is restricted to the intended project and can be disabled",()=>{
  assert.equal(isHelpPublicAiEnabled("archive-pilates",undefined),true);
  assert.equal(isHelpPublicAiEnabled("archive-pilates","false"),false);
  assert.equal(isHelpPublicAiEnabled("other-project","true"),false);
  assert.equal(isHelpPublicAiEnabled("",undefined),false);
});
test("API rejects arbitrary content, history, unbounded choices and duplicates",()=>{
  assert.deepEqual(parsePublicSignals(signals),signals);
  for(const input of [
    {...signals,text:"비공개"},
    {...signals,context:"member"},
    {...signals,tags:["개인 데이터"]},
    {...signals,tags:["schedule","schedule"]},
    {...signals,day:8},
    {...signals,frequency:"2"},
  ])assert.equal(parsePublicSignals(input),null);
});
test("OpenAI request sends only allowed signals and accepts one completed intent",async()=>{
  let calls=0;
  const mock=(content:unknown[],status="completed")=>async (uri:unknown,options?:RequestInit)=>{
    calls++;
    assert.equal(String(uri),"https://api.openai.com/v1/responses");
    assert.equal(new Headers(options?.headers).get("authorization"),"Bearer fake");
    assert.equal(options?.redirect,"error");
    const body=JSON.parse(String(options?.body));
    assert.deepEqual(JSON.parse(body.input),signals);
    assert.equal(body.model,"gpt-6-luna");
    assert.deepEqual(body.reasoning,{effort:"none"});
    assert.equal(body.max_output_tokens,64);
    assert.equal(body.store,false);
    assert.equal(body.text.format.strict,true);
    assert.equal(Object.hasOwn(body,"tools"),false);
    assert.equal(Object.hasOwn(body,"previous_response_id"),false);
    return Response.json({status,output:[{type:"message",role:"assistant",status:"completed",content}]});
  };
  const valid={type:"output_text",text:'{"intent":"schedule"}'};
  assert.equal(await classifyPublicIntent(signals,"fake",mock([valid])),"schedule");
  for(const text of ['{"intent":"refund"}','{"intent":"schedule","text":"untrusted"}','{"intent":', '[]']){
    assert.equal(await classifyPublicIntent(signals,"fake",mock([{type:"output_text",text}])),null);
  }
  assert.equal(await classifyPublicIntent(signals,"fake",mock([{type:"refusal",refusal:"declined"}])),null);
  assert.equal(await classifyPublicIntent(signals,"fake",mock([valid,valid])),null);
  assert.equal(await classifyPublicIntent(signals,"fake",mock([valid],"incomplete")),null);
  assert.equal(await classifyPublicIntent({...signals,context:"untrusted"},"fake",mock([valid])),null);
  assert.equal(calls,8);
});
test("disabled, bad origin and exhausted quota do not call the model",async()=>{
  let enabled=false,reserved=false,keyReads=0,modelCalls=0;
  const fn=createHelpPublicChatHandler({enabled:()=>enabled,key:()=>{keyReads++;return "fake";},
    reserve:async()=>reserved,classify:async()=>{modelCalls++;return "schedule";},generate:async()=>{modelCalls++;return {answer:"답변",next:"none"};}});
  const call=async(origin:string,body:unknown=signals)=>{
    const req={method:"POST",get:()=>origin,is:()=>true,rawBody:Buffer.from(JSON.stringify(body)),body} as any;
    let status=0;
    const res={set(){},status(v:number){status=v;return this;},json(){}};
    await fn(req,res);
    return status;
  };
  assert.equal(await call("https://help.archivepilates.com"),503);
  assert.equal(keyReads,0);
  enabled=true;
  assert.equal(await call("https://foreign.invalid"),403);
  assert.equal(await call("https://help.archivepilates.com",{...signals,raw:"비공개"}),400);
  assert.equal(keyReads,0);
  assert.equal(await call("https://help.archivepilates.com"),503);
  assert.equal(modelCalls,0);
  reserved=true;
  assert.equal(await call("https://help.archivepilates.com"),200);
  assert.equal(modelCalls,1);
});

const fixture:PublicReplySignals={version:2,topic:"schedule",detail:"timetable",previousTopic:"schedule",day:4,time:3,frequency:0,beginner:false};
const nov=new Date("2026-11-24T10:00:00+09:00");
test("only the closed public context schema and current official facts enter GPT",async()=>{
  for(const v of [{...fixture,raw:"private"},{...fixture,time:4},{...fixture,previousTopic:"member"},{...fixture,detail:"compare"},{...fixture,day:0}]){
    assert.equal(parsePublicReplySignals(v),null);
  }
  const facts=publicReplyFacts(fixture,nov);
  assert.match(facts,/목요일 저녁/);
  assert.match(facts,/17:30, 18:30, 19:00, 19:30, 20:30/);
  assert.doesNotMatch(facts,/09:00|은영|유리/);
  assert.doesNotMatch(publicReplyFacts(fixture,new Date("2026-12-01T00:00:00+09:00")),/17:30/);
  assert.doesNotMatch(publicReplyFacts({...fixture,detail:"unverified"},nov),/17:30/);
  const mock=(answer:string,next="none",expected=fixture):typeof fetch=>async(url,init)=>{
    assert.equal(url,"https://api.openai.com/v1/responses");
    const request=JSON.parse(String(init?.body));
    assert.equal(request.store,false);assert.equal(request.max_output_tokens,140);
    assert.equal(Object.hasOwn(request,"tools"),false);
    assert.deepEqual(JSON.parse(request.input),{signals:expected,facts:publicReplyFacts(expected,nov)});
    const offered=request.text.format.schema.properties.next.enum;
    assert.deepEqual(offered,expected.time?["none"]:["none","time"]);
    return Response.json({status:"completed",output:[{type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify({answer,next})}]}]});
  };
  const composed=await generatePublicReply(fixture,"fake",mock("목요일 저녁으로 좁혀 봤어요.\n{{facts}}"),nov);
  assert.deepEqual(composed,{answer:"목요일 저녁으로 좁혀 봤어요.\n\n"+facts,next:"none"});
  assert.equal(await generatePublicReply(fixture,"fake",mock("목요일 저녁이에요.\n{{facts}}","time"),nov),null);
  const dayOnly={...fixture,time:0};
  assert.equal((await generatePublicReply(dayOnly,"fake",mock("목요일 시간표를 확인했어요.\n{{facts}}","time",dayOnly),nov))?.next,"time");
  for(const text of ["예약 완료됐어요.\n{{facts}}","특가 123원이에요.\n{{facts}}","https://example.com\n{{facts}}","{{facts}}","안내예요. {{facts}}","안내예요.\n{{facts}}\n{{facts}}"])assert.equal(renderPublicReply(text,facts),null);
  assert.match(publicReplyFacts({...fixture,topic:"plan",detail:"four_weeks",frequency:2},nov),/4주 기준 8회/);
});
