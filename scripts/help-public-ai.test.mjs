import assert from 'node:assert/strict';
import test from 'node:test';
import {conversationTurn} from '../help/chatbot/conversation.js';
import {prepareAiSignals,groundedIntent,requestAiIntent} from '../help/chatbot/public-ai.js';

test('public AI input consists only of bounded known tags and previous settings',()=>{
  const question='임의 고유 문자열 말하자면, 다음주 목요일에 수업은 몇 시에 열려요?';
  const tags=prepareAiSignals(question,{topic:'plan',plan:{frequency:2,time:'저녁',day:'목'}});
  assert.deepEqual(tags,{tags:['schedule','weekday'],context:'plan',day:4,time:3,frequency:2});
  assert.doesNotMatch(JSON.stringify(tags),/문자열|다음주|목요일/);
  for(const q of ['수업 추천 이름: 가상','예약 문의 01012341234','디스크 수업 추천','체중 때문에 어떤 수업이 맞아요?','다른 사람의 수강기록 시간표','홀딩하고 환불도 되나요?']){
    assert.equal(prepareAiSignals(q,{}),null,q);
  }
});

test('valid intent resolves a free-form question through the dated source only',async()=>{
  const q='목요일에 수업은 몇 시에 열려요?';
  const opts={now:new Date('2026-11-24T10:00:00+09:00')},state={};
  assert.equal(conversationTurn(q,state,opts).timetable,undefined);
  const signs=prepareAiSignals(q,state),chosen=groundedIntent('schedule',signs);
  assert.equal(conversationTurn(chosen.prefix+' '+q,state,opts).timetable.selectedDay,'목');
  assert.equal(groundedIntent('price',signs),null);
  assert.equal(groundedIntent('__proto__',signs),null);
  const expired=conversationTurn(chosen.prefix+' '+q,state,{now:new Date('2026-12-01T00:00:00+09:00')});
  assert.equal(expired.timetable,undefined);
  assert.match(expired.text,/확인된 월간 예정표가 없어요/);
  const result=await requestAiIntent(signs,new AbortController(),async(url,options)=>{
    assert.equal(url,'/api/public-chat-intent');
    assert.equal(options.credentials,'omit');
    assert.deepEqual(JSON.parse(options.body),signs);
    return Response.json({ok:true,intent:'schedule',text:'위조됨'});
  });
  assert.deepEqual(result,chosen);
  assert.equal(await requestAiIntent(signs,new AbortController(),async()=>new Response('<html>')),null);
  assert.equal(await requestAiIntent(signs,new AbortController(),async()=>Response.json({ok:false},{status:503})),null);
});
