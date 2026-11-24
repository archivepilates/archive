import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {conversationTurn} from '../help/chatbot/conversation.js';
import {applyGuidedReply,prepareAiSignals,preparePublicReply,requestPublicReply} from '../help/chatbot/public-ai.js';

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
  assert.deepEqual(result,{answer:'목요일 저녁에 맞춰 확인했어요.',next:''});
  assert.equal(await requestPublicReply(follow.signals,new AbortController(),async()=>new Response('<html>')),null);
  assert.equal(await requestPublicReply(follow.signals,new AbortController(),async()=>Response.json({ok:false},{status:503})),null);
  assert.equal(await requestPublicReply(follow.signals,new AbortController(),async()=>Response.json({ok:true,answer:'응답',next:'member_id'})),null);
});

test('GPT can lead with one approved question and short replies resume the same topic',()=>{
  const opts={now:new Date('2026-11-24T10:00:00+09:00')};
  function guided(question,next,previous){
    const turn=preparePublicReply(question,previous,opts);
    return applyGuidedReply(turn.result,{answer:'조건을 확인했어요.',next});
  }
  const schedule=guided('목요일 시간표','time');
  assert.match(schedule.text,/어느 시간대가 편하세요\?/);
  assert.deepEqual(schedule.choices,['오전','오후','저녁']);
  const evening=preparePublicReply('저녁이요',schedule.state,opts);
  assert.deepEqual([evening.signals.topic,evening.signals.day,evening.signals.time],['schedule',4,3]);
  const pricing=guided('수강료','frequency');
  const two=preparePublicReply('두 번이요',pricing.state,opts);
  assert.deepEqual([two.signals.topic,two.signals.detail,two.signals.frequency],['pricing','comparison',2]);
  const plan=guided('필라테스는 처음이에요','frequency');
  const planned=preparePublicReply('두 번 정도요',plan.state,opts);
  assert.deepEqual([planned.signals.topic,planned.signals.beginner,planned.signals.frequency],['plan',true,2]);
  assert.equal(preparePublicReply('내 수강권 몇 번 남았어요?',plan.state,opts).signals,null);
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

test('daily plans and short date questions preserve public conversation without asserting bookings',()=>{
  const opts={now:new Date('2026-11-24T21:26:00+09:00')};
  const plan=preparePublicReply('주 3회 운동하고 싶어요',{},opts);
  const daily=preparePublicReply('매일운동하려면?',plan.result.state,opts);
  const restated=preparePublicReply('매일은?',daily.result.state,opts);
  assert.equal(daily.signals.detail,'daily');
  assert.equal(daily.signals.frequency,3);
  assert.match(daily.result.text,/매일 운동하는 것과 매일 센터 수업을 듣는 건 달라요/);
  assert.equal(restated.signals.detail,'daily_studio');
  assert.match(restated.result.text,/수강권 조건과 날짜별 개설·예약 상황/);
  const home=preparePublicReply('집에서도 운동',restated.result.state,opts);
  assert.equal(home.signals.detail,'daily_home');
  const today=preparePublicReply('오늘은?',restated.result.state,opts);
  assert.deepEqual([today.signals.topic,today.signals.day,today.result.timetable.selectedDay],['schedule',2,'화']);
  const thu=preparePublicReply('목요일 시간표',{},opts);
  assert.equal(preparePublicReply('오늘은?',thu.result.state,opts).signals.day,2);
  const nextMonth=preparePublicReply('오늘은?',thu.result.state,{now:new Date('2026-12-01T00:01:00+09:00')});
  assert.equal(nextMonth.result.timetable,undefined);
  assert.equal(nextMonth.signals.detail,'unverified');
});

test('conversation repair keeps context, sends no free-text, and cannot request private data',()=>{
  const opts={now:new Date('2026-11-24T21:26:00+09:00')};
  const plan=preparePublicReply('퇴근하고 주 3회 운동하고 싶어요',{},opts);
  const repair=preparePublicReply('지금 계속 이상해',plan.result.state,opts);
  assert.equal(repair.result.state,plan.result.state);
  assert.deepEqual(repair.signals,{version:2,topic:'clarify',detail:'context',previousTopic:'plan',day:0,time:0,frequency:0,beginner:false});
  assert.equal(preparePublicReply('익명 테스트 표현입니다',{},opts).signals.detail,'open');
  const detail=preparePublicReply('목요일에요',repair.result.state,opts);
  assert.deepEqual([detail.signals.topic,detail.signals.day,detail.signals.frequency],['plan',4,3]);
  assert.equal(preparePublicReply('내 수강권 몇 회 남았어요?',plan.result.state,opts).signals,null);
  assert.equal(preparePublicReply('전화번호 01012345678, 매일은?',plan.result.state,opts).signals,null);
});
test('brand and public staff questions send allowlisted selectors, not the wording',()=>{
  const {result,signals}=preparePublicReply('이초림 수석강사는 어떤 수업을 해요?');
  assert.equal(result.source,'https://archivepilates.com/teams/chorim');
  assert.equal(signals.topic,'identity');
  assert.equal(signals.detail,'chorim');
  assert.doesNotMatch(JSON.stringify(signals),/이초림|수석강사|어떤 수업/);
});
test('verified November promotion prices and the complete after-work product conversation',()=>{
  const opts={now:new Date('2026-11-24T21:26:00+09:00')};
  let state={};
  const next=q=>{
    const turn=preparePublicReply(q,state,opts);
    assert.equal(turn.signals,null);
    state=turn.result.state;
    return turn.result;
  };
  const promo=next('11월 프로모션 가격 있나요');
  assert.match(promo.text,/그룹레슨 50회 · 870,000원 · 6개월/);
  assert.match(promo.text,/강사\) · 1인 600,000원 · 100일/);
  assert.match(promo.text,/부원장\) · 1인 660,000원 · 100일/);
  assert.match(promo.text,/잔여 혜택과 현재 판매 여부는 직원 확인/);
  assert.equal(promo.source,'https://archivepilates.notion.site/');
  assert.match(next('직장인인데 추천 상품은').text,/일주일에 몇 번/);
  assert.match(next('요일은 상관없고 오후7시 이후').text,/요일 무관 · 19:00 이후/);
  const result=next('2-3번');
  assert.match(result.text,/19:00 이후.*월·화·수·목·금\. 실제 개설·잔여 자리는 회원 앱/);
  assert.match(result.text,/주 2~3회/);
  assert.match(result.text,/그룹 기간권 주 2회 · 398,000원 · 10주/);
  assert.match(result.text,/그룹 기간권 주 3회 · 570,000원 · 10주/);
  assert.match(result.text,/그룹 횟수권 20회 · 450,000원 · 5개월/);
  assert.doesNotMatch(result.text,/어느 요일|몇 번 정도 오실/);
  for(const question of ['추천 상품없어','?']){
    const recap=next(question);
    assert.match(recap.text,/먼저 그룹 기간권 주 2회 · 398,000원 · 10주/);
    assert.match(recap.text,/방문 횟수가 주마다 바뀐다면/);
    assert.doesNotMatch(recap.text,/어느 요일|몇 번 정도 오실/);
  }
});
test('product replies expire in KST, accept Korean ranges and do not treat a private pass as a recommendation',()=>{
  const nov={now:new Date('2026-11-30T23:59:59+09:00')}, dec={now:new Date('2026-12-01T00:00:00+09:00')};
  const initial=preparePublicReply('수강권 추천',{},nov).result.state;
  const context=preparePublicReply('토요일 오후 7시 30분 이후',initial,nov).result.state;
  const offer=preparePublicReply('두세 번',context,nov).result;
  assert.match(offer.text,/토요일 19:30 이후/);
  assert.match(offer.text,/해당 시간대 수업은 확인되지/);
  assert.match(offer.text,/주 2~3회/);
  for(const [q,opts] of [['11월 프로모션',dec],['추천 상품없어',dec],['다음 달 프로모션',nov],['10월 프로모션',nov]]){
    const result=preparePublicReply(q,offer.state,opts).result;
    assert.doesNotMatch(result.text,/870,000|398,000/);
    assert.equal(result.source,undefined);
  }
  assert(preparePublicReply('내 수강권은 몇 번 남았어요?',offer.state,nov).result.memberLookup);
});
