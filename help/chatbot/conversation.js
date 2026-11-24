import { regularNov, sourcePrice } from './content.js';
import { respond, reusableQuestion } from './engine.js';
import { publishedTimetable } from './timetable.js';

const appGuide='https://archivepilates.notion.site/studiomate';
const rates='https://archivepilates.notion.site/';
const calendar=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const timing={오전:'오전',아침:'오전',오후:'오후',저녁:'저녁',퇴근:'저녁'};
const counts={한:1,두:2,세:3,네:4,다섯:5,여섯:6,일곱:7};
const weekly=/(?:일주일(?:에)?|주당|주(?:에)?)\s*([1-7]|한|두|세|네|다섯|여섯|일곱)\s*(?:회|번)/u;
const shortFrequency=/^([1-7]|한|두|세|네|다섯|여섯|일곱)\s*(?:회|번)(?:쯤| 정도)?(?:이요|요|이에요)?[.!?\s]*$/u;
const monthly=/한\s*달|4\s*주|월\s*몇\s*(?:회|번)/u;
const hold=/홀딩|일시\s*(?:정지|중지)|(?:수강권|회원권).{0,26}(?:멈추|멈출|쉬|정지)|(?:여행|출장|휴가).{0,34}(?:멈추|멈출|쉬|정지|얼려)/u;
const scheduleAsk=/시간표|스케줄|수업\s*일정|수업\s*목록|오늘\s*수업|빈\s*자리|실시간\s*좌석|몇\s*시.{0,7}수업|자리\s*(?:남|있)/u;
const rateAsk=/수강료|가격|비용|얼마|프로모션|특가|블랙프라이데이|11\s*월.{0,10}수강권/u;
const otherMember=/(?:친구|가족|배우자|타인|다른\s*회원).{0,14}(?:수강권|잔여|출석|이력)/u;
const personal=/(?:내|제)\s*(?:수강권|예약|출석)|잔여\s*횟수|몇\s*(?:회|번)\s*남|수강\s*이력|출석\s*기록|패스키|회원\s*인증/u;
const booking=/예약|취소|고정|(?:자유\s*예약)|(?:해지|종료)/u;
const refund=/환불|돈.{0,8}돌려/u;
const greeting=/^(?:안녕(?:하세요|하십니까|하세용)?|안뇽|반가워요|하이|hi|hello)[!?~.\s\p{Extended_Pictographic}]*$/iu;
const thanks=/^(?:고마워(?:요)?|감사(?:해요|합니다)|덕분이에요)[!?~.\s\p{Extended_Pictographic}]*$/u;
const parking=/주차(?:장)?|출차|차량\s*등록/u;
const bookingOpen=/(?:예약|일정).{0,16}(?:언제\s*(?:열|오픈|시작|부터)|열리|오픈|개시)/u;
const amount=n=>n.toLocaleString('ko-KR')+'원';

function rule(rules,id){return rules?.rules?.find(row=>row.id===id)?.text??'';}
function planText(p,question){
  const first=p.beginner?'처음이시면 기본 동작을 설명하는 입문 수업부터 알아보는 게 좋아요.':'꾸준히 다닐 수 있는 시간대를 먼저 기준으로 잡으면 좋아요.';
  const day=p.day?p.day+'요일':'', time=p.time??'', freq=p.frequency;
  const where=[day,time].filter(Boolean).join(' ');
  if(p.onlyDay&&day&&freq)return {text:where+'만 가능하면 한 번씩 다니는 기준으로 주 1회, 4주에 4회예요. 실제 개설 시간과 남은 자리는 회원 앱에서 확인해 주세요.',appGuide};
  if(monthly.test(question)&&freq)return {text:'주 '+freq+'회라면 4주에 '+freq*4+'회예요. 달력상 한 달 횟수는 시작일과 요일에 따라 달라질 수 있어요.'};
  const questionText=!freq?'일주일에 몇 번 정도 오실 수 있으세요?':!day?'어느 요일이 가장 편하세요?':'실제 개설 시간과 남은 자리는 회원 앱에서 확인해 주세요.';
  const conditions=[where,freq?'주 '+freq+'회':''].filter(Boolean).join(' · ');
  return {text:[first,conditions?conditions+' 기준으로 비교해 볼 수 있어요.':'',questionText].filter(Boolean).join(' '),...(day&&freq?{appGuide}:{})};
}
function nextPlan(previous,q,askedFrequency){
  const p={...previous};
  const match=q.match(weekly)?.[1]||(askedFrequency?q.match(shortFrequency)?.[1]:undefined);
  const day=q.match(/([월화수목금토일])요일/u)?.[1];
  if(match)p.frequency=counts[match]??Number(match);
  if(day){
    p.day=day;p.onlyDay=/밖에|요일\s*만/u.test(q);
  }
  const time=q.match(/오전|아침|오후|저녁|퇴근/u)?.[0];
  if(time)p.time=timing[time];
  if(/처음|초보|입문|경험이\s*없/u.test(q))p.beginner=true;
  return p;
}

export function conversationTurn(question, previous={}, {rules=null,now=new Date()}={}){
  if(!reusableQuestion(question))return {...respond(question,{rules,now}),state:previous,hideInput:true};
  const q=question.normalize('NFKC').trim();
  if(greeting.test(q))return {text:'안녕하세요! 시간표, 수강료, 예약 등 궁금한 내용을 편하게 물어보세요.',state:previous,direct:true};
  if(thanks.test(q))return {text:'천만에요! 또 궁금한 게 있으면 편하게 물어보세요.',state:previous,direct:true};
  if(otherMember.test(q))return {text:'다른 회원의 수강권이나 이용내역은 안내하지 않아요. 본인의 기록은 회원 앱에서 확인해 주세요.',state:previous,hideInput:true,appGuide};
  const suppliedFrequency=previous.guidedNext==='frequency'&&shortFrequency.test(q);
  const plan=nextPlan(previous.plan,q,suppliedFrequency);
  const state={plan,topic:'',context:''};
  const close=result=>({...result,state:{...state,topic:result.topic??'',context:result.context??''}});
  const kst=calendar.format(now);
  const november=kst>='2026-11-01'&&kst<='2026-11-30';
  const anotherMonth=/다음\s*달|12\s*월|십이월/u.test(q);
  const asksRefund=refund.test(q)&&!/홀딩이나\s*환불/u.test(q);
  const shelf=hold.test(q)||previous.context==='hold'&&/^(?:기간권|횟수권|잘 모르겠어요)[이예요인데요.\s?]*$/u.test(q);
  const existing=options=>respond(q,{rules,now,mode:'member',...options});
  const rateResponse=result=>result.source===sourcePrice?{...result,source:rates,sourceLabel:'11월 수강료 원문'}:result;
  const planAsk=/어떤\s*수업|수업.{0,8}추천|처음|초보|일정을\s*짜/u.test(q)||weekly.test(q)&&/운동|다니|가고|방문|가능|퇴근/u.test(q);

  if(asksRefund)return close({...respond('환불 상담',{rules,now,mode:'member'}),inquiry:'refund',topic:'refund'});
  if(shelf){
    const normalized=hold.test(q)&&!/^홀딩이나\s*환불/u.test(q)&&!/만료|이미\s*끝|기간.{0,4}지난/u.test(q)?q+' 홀딩':q;
    const result=respond(normalized,{rules,now,mode:'member',context:'hold'});
    const base=/여행|출장|휴가/u.test(q)?rule(rules,'holding-base'):'';
    return close({...result,text:[base,result.text].filter(Boolean).join(' '),inquiry:'staff',topic:'holding'});
  }
  if(scheduleAsk.test(q)||previous.topic==='schedule'&&/다음\s*달|\d{1,2}\s*월|[월화수목금토일]\s*요일|주말|내일|모레/u.test(q)&&!rateAsk.test(q)&&!booking.test(q)){
    const timetable=publishedTimetable(q,now);
    return close({
      text:timetable?'명지점 월간 예정표예요. 남은 자리와 당일 변경은 회원 앱에서 확인해 주세요.':
        '이 날짜에 적용할 확인된 월간 예정표가 없어요. 명지점 시간표와 남은 자리는 회원 앱의 수업 목록에서 확인해 주세요.',
      ...(timetable?{timetable,source:timetable.source,sourceLabel:'11월 명지점 시간표 원문'}:{}),appGuide,topic:'schedule'});
  }
  if(!rateAsk.test(q)&&(personal.test(q)||previous.topic==='member'&&/^(?:그럼|그러면).*(?:언제까지|예약|몇\s*(?:회|번))/u.test(q))){
    const reply=respond('내 수강권',{rules,now,mode:'member'});
    return close({...reply,appGuide,topic:'member'});
  }
  const commonRule=parking.test(q)?'other-facility':bookingOpen.test(q)&&!/취소|변경|해지/u.test(q)?'other-booking':'';
  if(commonRule){
    const text=rule(rules,commonRule);
    return {text:text||'정확한 안내는 카카오톡으로 직원에게 문의해 주세요.',state:previous,direct:true,
      ...(!text?{inquiry:'staff'}:{})};
  }
  if(rateAsk.test(q)||previous.topic==='pricing'&&(suppliedFrequency||/^(?:주\s*[1-7]\s*(?:회|번)|[1-7]\s*(?:회|번))[\s.요만]*$/u.test(q))){
    if(!november||anotherMonth)return close({text:'현재 확인된 수강료가 없어요. 적용 월과 상품을 직원에게 확인해 주세요.',inquiry:'staff',topic:'pricing'});
    if(/개인|프라이빗|듀엣|프로모션|특가|블랙프라이데이/u.test(q))return close({text:'11월 개인·듀엣 수강료와 프로모션 조건은 아래 원문에서 확인할 수 있어요. 실제 판매 여부나 선착순 혜택이 남았는지는 직원에게 확인해 주세요.',source:rates,sourceLabel:'11월 수강료 원문',topic:'pricing'});
    if(weekly.test(q)||/^[1-7]\s*(?:회|번)/u.test(q)||suppliedFrequency){
      const compared=suppliedFrequency?respond('수강료 주 '+plan.frequency+'회',{rules,now,mode:'member'}):existing();
      return close({...rateResponse(compared),topic:'pricing'});
    }
    return close({text:['11월 명지점 정규 그룹 수강료예요. 부가세가 포함되며 기간은 첫 수업일부터 계산해요.',
      ...regularNov.map(r=>r.name+' · '+amount(r.price)+' · '+r.duration),'주 몇 회 방문할 수 있는지 알려주시면 비교해 드릴게요.'].join('\n'),
      source:rates,sourceLabel:'11월 수강료 원문',choices:['주 1회','주 2회','주 3회'],topic:'pricing'});
  }
  if(planAsk||previous.topic==='plan'&&(monthly.test(q)||/요일|아침|오전|오후|저녁|퇴근/u.test(q)||weekly.test(q)||suppliedFrequency)){
    return close({...planText(plan,q),topic:'plan'});
  }
  const continuation=previous.context==='booking'&&/고정|자유|모르겠어요/u.test(q)
    ||previous.context==='fixed'&&/한\s*번|이번\s*수업|해지|종료|그만|다음\s*달부터/u.test(q)
    ||previous.context==='flexible'&&/주말|토요일|일요일|공휴일/u.test(q);
  const result=rateResponse(existing({context:continuation?previous.context:''}));
  return close({...result,...(result.memberApp?{appGuide}:{}),
    ...(booking.test(q)&&!(result.choices?.length)?{inquiry:'staff'}:{}),
    topic:result.memberLookup?'member':booking.test(q)||continuation?'booking':result.context==='pass'?'pricing':''});
}
