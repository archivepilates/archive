import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {conversationTurn} from '../help/chatbot/conversation.js';
import {prepareAiSignals,preparePublicReply,requestPublicReply} from '../help/chatbot/public-ai.js';

test('greeting, parking and booking opening do not fall through to an unrelated GPT topic',()=>{
  const rules=JSON.parse(fs.readFileSync(new URL('../help/assets/member-inquiry-guidance.json',import.meta.url)));
  const now=new Date('2026-11-24T20:00:00+09:00');
  const previous=preparePublicReply('목요일 시간표',{}, {rules,now}).result.state;
  for(const q of ['안녕','안녕하세요!','hello','고마워요']){
    const turn=preparePublicReply(q,previous,{rules,now});
    assert.equal(turn.signals,null);
    assert.equal(turn.result.state,previous);
    assert.match(turn.result.text,/편하게/);
  }
  for(const [q,expected] of [['주차는 몇 시간 무료예요?',/2시간 무료 주차/],['예약은 언제 열려요?',/월요일 13시/]]){
    const turn=preparePublicReply(q,{}, {rules,now});
    assert.equal(turn.signals,null);
    assert.match(turn.result.text,expected);
  }
  assert.equal(preparePublicReply('안녕하세요, 목요일 시간표 알려줘',{}, {rules,now}).signals.topic,'schedule');
});

test('public AI input consists only of bounded known tags and previous settings',()=>{
  const question='임의 고유 문자열 말하자면, 다음주 목요일에 수업은 몇 시에 열려요?';
  const tags=prepareAiSignals(question,{topic:'plan',plan:{frequency:2,time:'저녁',day:'목'}});
  assert.deepEqual(tags,{tags:['schedule','weekday'],context:'plan',day:4,time:3,frequency:2});
  assert.doesNotMatch(JSON.stringify(tags),/문자열|다음주|목요일/);
  for(const q of ['수업 추천 이름: 가상','예약 문의 01012341234','디스크 수업 추천','체중 때문에 어떤 수업이 맞아요?','다른 사람의 수강기록 시간표','홀딩하고 환불도 되나요?']){
    assert.equal(prepareAiSignals(q,{}),null,q);
  }
});

test('answers use a scoped public turn and keep the selected weekday on a follow-up',async()=>{
  const q='목요일에 수업은 몇 시에 열려요?';
  const opts={now:new Date('2026-11-24T10:00:00+09:00')},state={};
  assert.equal(conversationTurn(q,state,opts).timetable,undefined);
  const first=preparePublicReply(q,state,opts);
  assert.equal(first.result.timetable.selectedDay,'목');
  const follow=preparePublicReply('그럼 저녁엔요?',first.result.state,opts);
  assert.deepEqual(follow.signals,{version:2,topic:'schedule',detail:'timetable',previousTopic:'schedule',day:4,time:3,frequency:0,beginner:false});
  assert.equal(follow.result.timetable.selectedDay,'목');
  const expired=preparePublicReply(q,state,{now:new Date('2026-12-01T00:00:00+09:00')});
  assert.equal(expired.result.timetable,undefined);
  assert.equal(expired.signals.detail,'unverified');
  const missing=preparePublicReply('다음 달 시간표 보여줘',first.result.state,opts);
  assert.equal(preparePublicReply('그럼 목요일은?',missing.result.state,opts).signals.detail,'unverified');
  const result=await requestPublicReply(follow.signals,new AbortController(),async(url,options)=>{
    assert.equal(url,'/api/public-chat-intent');
    assert.equal(options.credentials,'omit');
    assert.deepEqual(JSON.parse(options.body),follow.signals);
    return Response.json({ok:true,answer:'목요일 저녁에 맞춰 확인했어요.'});
  });
  assert.equal(result,'목요일 저녁에 맞춰 확인했어요.');
  assert.equal(await requestPublicReply(follow.signals,new AbortController(),async()=>new Response('<html>')),null);
  assert.equal(await requestPublicReply(follow.signals,new AbortController(),async()=>Response.json({ok:false},{status:503})),null);
});

test('public planning carries only bounded preferences; private turns never request GPT',()=>{
  const opts={now:new Date('2026-11-24T10:00:00+09:00')};
  const a=preparePublicReply('운동은 처음인데 퇴근하고 주 2회 가고 싶어요',{},opts);
  const b=preparePublicReply('그럼 한 달이면 몇 번이야?',a.result.state,opts);
  const c=preparePublicReply('목요일밖에 안 되면?',b.result.state,opts);
  assert.deepEqual([a.signals.detail,b.signals.detail,c.signals.detail],['general','four_weeks','single_day']);
  assert.deepEqual([c.signals.frequency,c.signals.time,c.signals.day,c.signals.beginner],[2,3,4,true]);
  for(const q of ['내 수강권 몇 회 남았어?','내가 01012341234인데 홀딩 돼?','다른 회원 수강 이력','통증 있는데 추천','환불 신청','제 홀딩 언제 끝나요?','이미 만료된 횟수권 연장']){
    assert.equal(preparePublicReply(q,c.result.state,opts).signals,null,q);
  }
  const rates=preparePublicReply('수강료 알려줘',{},opts);
  assert.equal(preparePublicReply('2회만',rates.result.state,opts).signals.detail,'comparison');
});
