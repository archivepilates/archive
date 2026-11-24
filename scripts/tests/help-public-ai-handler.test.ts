import assert from "node:assert/strict";
import test from "node:test";
import {classifyPublicIntent,createHelpPublicChatHandler,isHelpNaturalEnabled,isHelpPublicAiEnabled,parsePublicSignals} from "../../firebase/kangsain-functions/functions/src/memberInquiries/publicChatIntent";
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
test("natural turns require a separate feature flag and reject identifiers before accessing keys",async()=>{
  for(const value of [undefined,"","TRUE","false","oops"])assert.equal(isHelpNaturalEnabled("archive-pilates",value),false);
  assert.equal(isHelpNaturalEnabled("unrelated-project","true"),false);
  assert.equal(isHelpNaturalEnabled("archive-pilates","true"),true);
  let enabled=false, called=0, keys=0;
  const fn=createHelpPublicChatHandler({enabled:()=>true,key:()=>{keys++;return "fake";},
    reserve:async()=>true,classify:async()=>null,generate:async()=>null},
    {enabled:()=>enabled,generate:async request=>{
      called++;
      assert.equal(request.question,"한동안 못 오다가 다시 이어도 되나요?");
      return {answer:"수강권 종류부터 확인해 볼까요?",link:"none"};
    }});
  const post=async(question:string)=>{
    const body={version:3,consent:true,question,history:[]},req={method:"POST",get:()=>"https://help.archivepilates.com",
      is:()=>true,body,rawBody:Buffer.from(JSON.stringify(body))} as any;
    let status=0;
    const res={set(){},status(v:number){status=v;return this;},json(){}};
    await fn(req,res);
    return status;
  };
  assert.equal(await post("한동안 못 오다가 다시 이어도 되나요?"),503);
  enabled=true;
  assert.equal(await post("내 수강권과 전화번호 확인해줘"),400);
  assert.equal(keys,0);assert.equal(called,0);
  assert.equal(await post("한동안 못 오다가 다시 이어도 되나요?"),200);
  assert.equal(keys,1);assert.equal(called,1);
});

const fixture:PublicReplySignals={version:2,topic:"schedule",detail:"timetable",previousTopic:"schedule",day:4,time:3,frequency:0,beginner:false};
const nov=new Date("2026-11-24T10:00:00+09:00");
test("public daily and clarification turns carry bounded context only",async()=>{
  const daily={...fixture,topic:"plan",detail:"daily",previousTopic:"plan",frequency:3} as const;
  assert.match(publicReplyFacts(daily,nov),/매일 운동하는 것과 매일 센터 수업에 참여하는 건 달라요/);
  const unclear={...fixture,topic:"clarify",detail:"context",previousTopic:"plan",day:0,time:0} as const;
  assert.deepEqual(parsePublicReplySignals(unclear),unclear);
  for(const value of [{...unclear,previousTopic:""},{...unclear,day:2},{...unclear,frequency:3},{...unclear,raw:"회원정보"}]){
    assert.equal(parsePublicReplySignals(value),null);
  }
  const mock=(expected:string):typeof fetch=>async(_url,init)=>{
    const request=JSON.parse(String(init?.body));
    assert.deepEqual(request.text.format.schema.properties.next.enum,[expected]);
    return Response.json({status:"completed",output:[{type:"message",role:"assistant",status:"completed",
      content:[{type:"output_text",text:JSON.stringify({answer:"앞에서 말씀하신 내용을 이어서 볼게요.",next:expected})}]}]});
  };
  assert.equal((await generatePublicReply(daily,"fake",mock("routine_scope"),nov))?.next,"routine_scope");
  assert.equal((await generatePublicReply(unclear,"fake",mock("help_topic"),nov))?.next,"help_topic");
});
test("the privacy-safe route can explain only selected published brand and team facts",()=>{
  const ask={version:2,topic:"identity",detail:"chorim",previousTopic:"",day:0,time:0,frequency:0,beginner:false} as const;
  assert.deepEqual(parsePublicReplySignals(ask),ask);
  assert.match(publicReplyFacts(ask,nov),/이초림 수석강사.*설명 속도와 난이도/);
  assert.match(publicReplyFacts({...ask,detail:"history"},nov),/공개 자료에서 확인되지 않은 연혁/);
  assert.equal(parsePublicReplySignals({...ask,detail:"김가상"}),null);
});
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
  const composed=await generatePublicReply(fixture,"fake",mock("목요일 저녁으로 좁혀 봤어요."),nov);
  assert.deepEqual(composed,{answer:"목요일 저녁으로 좁혀 봤어요.\n\n"+facts,next:"none"});
  assert.equal(await generatePublicReply(fixture,"fake",mock("목요일 저녁이에요.","time"),nov),null);
  const dayOnly={...fixture,time:0};
  assert.deepEqual(await generatePublicReply(dayOnly,"fake",mock("특가 123원이에요.","time",dayOnly),nov),
    {answer:publicReplyFacts(dayOnly,nov),next:"time"});
  for(const text of ["예약 완료됐어요.","특가 123원이에요.","https://example.com","안내 날짜예요?","안내예요.\n확인이에요.",""])assert.equal(renderPublicReply(text,facts),null);
  assert.match(publicReplyFacts({...fixture,topic:"plan",detail:"four_weeks",frequency:2},nov),/4주 기준 8회/);
});
