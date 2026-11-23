import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {respond,reusableQuestion} from '../help/chatbot/engine.js';
import {conversationTurn} from '../help/chatbot/conversation.js';
const rules=JSON.parse(fs.readFileSync(new URL('../help/assets/member-inquiry-guidance.json',import.meta.url)));
const nov=new Date('2026-11-30T14:59:59Z');
const december=new Date('2026-11-30T15:00:00Z');
const ask=(q,opts={})=>respond(q,{mode:'member',rules,now:nov,...opts});
test('book and hold follow-up correctly distinguishes conditions',()=>{
 assert.equal(ask('토요일 예약 취소').context,'booking');
 const a=ask('자유 예약이에요',{context:'booking'});
 assert.equal(a.context,'flexible');assert.match(a.text,/6시간|21시/);
 assert.match(ask('그럼 주말은요?',{context:a.context}).text,/21시/);
 assert.match(ask('고정 예약으로 바꿨는데요',{context:a.context}).text,/불가/);
 assert.equal(ask('홀딩').context,'hold');
 assert.match(ask('기간권',{context:'hold'}).text,/월요일/);
 assert.match(ask('횟수권',{context:'hold'}).text,/7일/);
});
test('valid dated prices, no clearance or December prices',()=>{
 const a=ask('주 2회 다녀요',{mode:'prospect'});
 assert.match(a.text,/398,000/);assert.doesNotMatch(a.text,/870,000/);assert.equal(a.text.split('\n').length,4);
 const b=ask('주 2회 다녀요',{mode:'prospect',now:december});
 assert.doesNotMatch(b.text,/398,000/);assert.equal(b.source,undefined);
});
test('personal queries point to the app, privacy markers and health go to guidance',()=>{
 for(const q of ['내 잔여 횟수','내 출석','제 수강권 확인','최근 수강 이력','패스키 로그인']){
  const a=ask(q);
  assert.equal(a.memberLookup,true);
  assert.match(a.text,/공개 채팅에서 조회하지 않아요/);
  assert.equal(a.source,undefined);
 }
 for(const q of ['제 생년월일은 1999-01-01','생년월일 19990101','０１０ １２３４ ５６７８']){
  assert.equal(reusableQuestion(q),false);
  assert.doesNotMatch(ask(q).text,/1999|1234/);
 }
 assert.notEqual(ask('홀딩').memberLookup,true);
 assert.doesNotMatch(ask('이름: 가상 회원, 010-1234-5678').text,/010|가상 회원/);
 assert.match(ask('수술 후 운동을 추천해주세요').text,/코치 상담/);
 assert.match(ask('환불 신청').text,/여기서 환불을 실행하지 않아요/);
});
test('class preferences lead to a class type, not live attendance or seats',()=>{
 const a=ask('수업 추천',{mode:'prospect'});
 assert.equal(a.context,'class');
 const b=ask('화요일 오전 리포머 초보',{context:a.context,mode:'prospect'});
 assert.match(b.text,/입문/);assert.match(b.text,/실제 개설 여부와 좌석은 확인하지 않았어요/);
});
test('static Help deployment does not gain any API route or personal persistence',()=>{
 const html=fs.readFileSync(new URL('../help/chatbot/index.html',import.meta.url),'utf8');
 const base=fs.readFileSync(new URL('../help/index.html',import.meta.url),'utf8');
 const fallback=fs.readFileSync(new URL('../help/inquiry/index.html',import.meta.url),'utf8');
 const app=fs.readFileSync(new URL('../help/chatbot/app.js',import.meta.url),'utf8');
 const firebase=JSON.parse(fs.readFileSync(new URL('../firebase.json',import.meta.url)));
 assert.match(html,/id="start-intake"/);
 assert.match(html,/<form id="question">/);
 assert.doesNotMatch(html,/data-mode|테스트 본인확인|가상 가입 링크/);
 assert.equal(html,base);
 assert.match(base,/href="\/inquiry\/">챗봇 이용이 어려울 때: 기존 문의 양식/);
 assert.match(fallback,/id="member-form"/);
 assert.equal((app.match(/\bfetch\(/g)||[]).length,1);
 assert.match(app,/fetch\('\/assets\/member-inquiry-guidance\.json'/);
 assert.doesNotMatch(app,/localStorage|sessionStorage|cookie|\/api\//);
 const config=firebase.hosting.find(row=>row.site==='archive-pilates-help');
 assert.equal(config.public,'help');
 assert.deepEqual(config.rewrites.map(r=>r.source),['/api/inquiries','**']);
});

test('public chat carries visiting preferences and adjusts a follow-up without inventing seats',()=>{
 const turn=(q,state)=>conversationTurn(q,state,{now:nov,rules});
 const first=turn('운동은 처음인데 퇴근하고 주 2회 가고 싶어요');
 assert.match(first.text,/입문.*저녁.*주 2회/);
 assert.match(turn('그럼 한 달이면 몇 번이야?',first.state).text,/4주에 8회/);
 const next=turn('목요일밖에 안 되면?',first.state);
 assert.match(next.text,/목요일 저녁만.*주 1회.*4주에 4회/);
 assert.match(next.text,/남은 자리는 회원 앱/);
});

test('public chat gives direct dated sources and respects the month rollover',()=>{
 const turn=(q,now=nov)=>conversationTurn(q,{}, {now,rules});
 const slots=turn('명지점 시간표 보여줘');
 assert.equal(slots.source,'https://archivepilates.notion.site/#409d49eae4bf800a9bdbdfcc29f1c3cc');
 assert.match(slots.text,/월간 예정표/);
 assert.equal(turn('12월 시간표 보여줘').source,undefined);
 const rates=turn('11월 수강권 문의');
 assert.match(rates.text,/398,000원 · 10주/);
 assert.equal(rates.source,'https://archivepilates.notion.site/');
 assert.doesNotMatch(turn('수강료 알려줘',december).text,/398,000/);
});

test('public chat keeps policy follow-ups, private routing and intake separate',()=>{
 const turn=(q,state)=>conversationTurn(q,state,{now:nov,rules});
 const hold=turn('다음 달 여행인데 수강권 멈출 수 있어요?');
 assert.deepEqual(hold.choices,['기간권','횟수권','잘 모르겠어요']);
 assert.match(turn('횟수권',hold.state).text,/7일/);
 const booking=turn('토요일 예약을 취소하고 싶어요');
 assert.match(turn('자유 예약',booking.state).text,/21시/);
 assert.equal(turn('환불 신청').inquiry,'refund');
 const lookup=turn('내 수강권 몇 회 남았어?');
 assert.equal(lookup.memberLookup,true);
 assert.equal(lookup.appGuide,'https://archivepilates.notion.site/studiomate');
 assert.equal(turn('그럼 언제까지예요?',lookup.state).memberLookup,true);
 const sensitive=turn('생년월일 1999-01-01');
 assert.equal(sensitive.hideInput,true);
 assert.doesNotMatch(JSON.stringify(sensitive),/1999-01-01/);
 assert.equal(turn('친구의 수강권을 확인할래요').hideInput,true);
});

test('class question with weekly frequency is not converted into a pass quote',()=>{
 const result=respond('처음이고 주 2회 저녁에 가능해요. 어떤 수업이 좋아요?',{mode:'prospect',now:new Date('2026-11-22T13:00:00Z')});
 assert.match(result.text,/입문 수준/);
 assert.match(result.text,/저녁.*주 2회/);
 assert.doesNotMatch(result.text,/\d원|50회/);
});

test('member renewal describes the consultation cutoff, not current eligibility',()=>{
 const result=respond('재등록이 궁금해요',{mode:'member'});
 assert.match(result.text,/실제 출석일로부터 3개월/);
 assert.match(result.text,/직원이 확인/);
 assert.equal(result.memberApp,true);
});

test('expired unused sessions are period extension review, while period passes are excluded',()=>{
 const expiry=ask('제 횟수권 기간이 끝났는데 잔여가 있어요. 홀딩 가능한가요?');
 assert.match(expiry.text,/일반 홀딩이 아닌 유료 기간 연장 상담/);
 assert.match(expiry.text,/담당자가 수강권을 확인/);
 assert.equal(expiry.source,'https://app.notion.com/p/216d49eae4bf806983abfb9665af7992');
 assert.doesNotMatch(expiry.text,/\d+원|가능해요/);
 const period=ask('기간이 지난 기간권도 연장되나요?');
 assert.match(period.text,/기간권은 유료 기간 연장 대상이 아니에요/);
 const unknown=ask('만료됐는데 잔여가 남았어요');
 assert.match(unknown.text,/수강권 종류와 기간 연장 가능 여부/);
 assert.equal(ask('만료된 횟수권 환불').source,'https://app.notion.com/p/313d49eae4bf80179269f09d02597ede');
});

test('Dec 1 00:01 KST: prospect renewal then Help renewal has no November link on either asset path',async()=>{
 const vm=await import('node:vm');
 const {currentPolicyHref}=await import('../help/assets/renewal-policy-link.js');
 const htmlPath=new URL('../help/assets/app.js',import.meta.url);
 const ui=fs.readFileSync(htmlPath,'utf8').replace(/^import .*\n/,'');
 const schema=JSON.parse(fs.readFileSync(new URL('../help/assets/inquiry-schema.json',import.meta.url)));
 const old=schema.categories.renewal.link;
 const rollover=new Date('2026-11-30T15:01:00Z');
 assert.equal(respond('가격과 재등록이 궁금해요',{now:rollover}).source,undefined);
 assert.equal(respond('재등록이 궁금해요',{mode:'member',now:rollover}).source,undefined);
 function element(tag=''){
  return {tag,children:[],dataset:{},events:{},hidden:false,
   addEventListener(type,fn){this.events[type]=fn;},append(...ns){this.children.push(...ns);},
   prepend(...ns){this.children.unshift(...ns);},replaceChildren(...ns){this.children=ns;},
   querySelectorAll(){return [];},setAttribute(){},removeAttribute(key){delete this[key];},focus(){}};
 }
 async function openRenewal(instant,withGuidance){
  const elements=new Map(), button=element('button');button.dataset.category='renewal';
  const at=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const replies={'/assets/inquiry-schema.json':schema,'/assets/member-inquiry-guidance.json':withGuidance?rules:null};
  const called=[];
  const context=vm.createContext({
   currentPolicyHref:href=>currentPolicyHref(href,instant),
   fetch:async path=>{called.push(path);assert.ok(Object.hasOwn(replies,path));return {ok:!!replies[path],json:async()=>replies[path]};},
   sessionStorage:{getItem:()=>''},
   document:{getElementById:at,createElement:element,createTextNode:text=>({textContent:text}),querySelectorAll:sel=>sel==='[data-category]'?[button]:[],querySelector(sel){
    const id=sel.match(/^\[data-question="([^"]+)"\]$/)?.[1];
    return at('choice-fields').children.find(x=>x.dataset.question===id)??button;
   }}
  });
  await vm.runInContext(ui,context);
  button.events.click();
  const guid=at('guidance-rules').children.flatMap(li=>li.children.filter(x=>x.tag==='a')).map(x=>x.href);
  return {guid,fallback:at('policy-link').href,hidden:at('policy-link').hidden,called};
 }
 for(const withGuidance of [false,true]){
  const state=await openRenewal(rollover,withGuidance);
  assert.deepEqual(state.guid,[]);assert.equal(state.fallback,undefined);assert.equal(state.hidden,true);
  assert.equal(state.called.length,2);
 }
 const last=await openRenewal(nov,true);
 assert.deepEqual(last.guid,[old]);assert.equal(last.hidden,true);
 const lastFallback=await openRenewal(nov,false);
 assert.equal(lastFallback.hidden,false);assert.equal(lastFallback.fallback,old);
});

test('monthly fixed booking termination is not a one-class cancellation',()=>{
 const schema=JSON.parse(fs.readFileSync(new URL('../help/assets/inquiry-schema.json',import.meta.url)));
 const fixed=schema.categories.fixed, request=fixed.questions.find(x=>x.id==='request').options;
 assert.equal(fixed.title,'고정예약 문의');assert.ok(request.includes('해지 방법 문의'));assert.ok(request.includes('취소·변경 예외 상담'));
 const ruleEnd=rules.rules.find(r=>r.id==='fixed-end');
 assert.equal(ruleEnd.category,'fixed');assert.equal(ruleEnd.when.request,'해지 방법 문의');
 const ending=ask('12월에는 고정반을 그만하고 싶어요');
 assert.ok(ending.text.startsWith(ruleEnd.text));
 assert.match(ending.text,/마지막 영업일까지 데스크/);
 assert.match(ending.text,/고정예약 문의 → 해지 방법 문의/);
 assert.match(ending.text,/온라인 문의만으로 접수 기한을 충족했거나 해지가 완료됐다고 볼 수 없으니/);
 assert.doesNotMatch(ending.text,/12월\s*\d+일|취소·변경 예외 상담/);
 const one=ask('이번 토요일 고정반 한 번만 취소할 수 있나요?');
 assert.ok(one.text.startsWith(rules.rules.find(r=>r.id==='booking-fixed').text));
 assert.match(one.text,/수업 취소·변경 → 고정예약/);
 assert.match(one.text,/고정예약 문의 → 취소·변경 예외 상담/);
 assert.doesNotMatch(one.text,/마지막 영업일|해지 방법 문의/);
 const followup=ask('그럼 다음 달부터 그만하려고요',{context:one.context});
 assert.match(followup.text,/해지 방법 문의/);
});


test('static desk contact works independently of scripts on both paths',()=>{
 for(const file of ['../help/index.html','../help/chatbot/index.html','../help/inquiry/index.html']){
  const html=fs.readFileSync(new URL(file,import.meta.url),'utf8');
  assert.match(html,/href="tel:01029244425">명지점 데스크 010-2924-4425<\/a>/);
 }
});
