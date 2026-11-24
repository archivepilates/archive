import {promotionNov,regularNov} from './content.js';
import {publishedTimetable} from './timetable.js';

const source='https://archivepilates.notion.site/';
const appGuide='https://archivepilates.notion.site/studiomate';
const calendar=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const promo=/프로모션|블랙\s*프라이데이|특가/u;
const recommend=/(?:추천|비교)\s*(?:상품|수강권|회원권)|(?:상품|수강권|회원권)\s*(?:을|를|이|은|는)?\s*(?:추천|비교)|어떤\s*(?:상품|수강권|회원권)|뭘\s*(?:끊|등록)/u;
const anyDay=/요일\s*(?:은|이|에는)?\s*(?:상관\s*없|무관|관계\s*없)|아무\s*요일|요일\s*무관/u;
const number='([1-7]|한|두|세|네|다섯|여섯|일곱)';
const counts={한:1,두:2,세:3,네:4,다섯:5,여섯:6,일곱:7};
const frequencyPattern=new RegExp('^(?:보통\\s*)?(?:(?:주(?:당|에)?|일주일(?:에)?)\\s*)?'+number+
  '(?:\\s*(?:에서|내지|[~～–—-])\\s*'+number+')?\\s*(?:회|번)(?:\\s*(?:정도|쯤))?(?:이요|요|이에요)?[.!?\\s]*$','u');
const sourceLink={source,sourceLabel:'11월 수강료 원문'};
const amount=n=>n.toLocaleString('ko-KR')+'원';
const passLine=pass=>pass.name+' · '+(pass.perPerson?'1인 ':'')+amount(pass.price)+' · '+pass.duration;
const minuteValue=clock=>Number(clock.slice(0,2))*60+Number(clock.slice(3,5));

function readFrequency(q){
  if(/^(?:주\s*)?두세\s*(?:회|번)(?:이요|요|정도)?[.?!\s]*$/u.test(q))return [2,3];
  const match=q.match(frequencyPattern);
  if(!match)return null;
  const lower=counts[match[1]]??Number(match[1]), upper=match[2]?(counts[match[2]]??Number(match[2])):lower;
  return lower<=upper?[lower,upper]:null;
}

function readAfter(q){
  const m=q.match(/(?:^|[^\d])(?:(오전|오후|저녁|아침)\s*)?(\d{1,2})\s*시(?:\s*(?:(\d{1,2})\s*분|(반)))?\s*(?:이후|부터|넘어서)/u);
  if(!m)return null;
  const hour=Number(m[2]), minute=m[4]?30:Number(m[3]??0);
  if(minute>59||hour>23||m[1]&&(hour<1||hour>12)||!m[1]&&hour<13)return null;
  const hour24=m[1]?(hour%12+(/오후|저녁/u.test(m[1])?12:0)):hour;
  return hour24*60+minute;
}

function publicNovember(q,now){
  const month=q.match(/(?:^|[^\d])(\d{1,2})\s*월(?!요일)/u)?.[1];
  const year=q.match(/(20\d{2})\s*년/u)?.[1];
  return calendar.format(now).startsWith('2026-11-')&&(!month||month==='11')&&(!year||year==='2026')
    &&!/(?:다음|지난)\s*달|내년|작년|십이월/u.test(q);
}

function scheduleContext(context,now){
  if(context.after==null)return '';
  const clock=String(Math.floor(context.after/60)).padStart(2,'0')+':'+String(context.after%60).padStart(2,'0');
  const timetable=publishedTimetable('시간표',now);
  const days=Object.entries(timetable?.byDay??{}).filter(([day,slots])=>(!context.day||day===context.day)
    &&slots.some(([time])=>minuteValue(time)>=context.after)).map(([day])=>day);
  return [context.anyDay?'요일 무관 · '+clock+' 이후 기준이에요.':(context.day?context.day+'요일 ':'')+clock+' 이후 기준이에요.',
    days.length?'공개 예정표에 해당 시간대 수업이 있는 요일: '+days.join('·')+'. 실제 개설·잔여 자리는 회원 앱에서 확인해 주세요.'
      :'공개 예정표에서 해당 시간대 수업은 확인되지 않아요. 최신 일정은 회원 앱에서 확인해 주세요.'].join(' ');
}

export function publicPassConsultation(q,previous,now){
  const active=previous.passConsultation;
  const after=readAfter(q), range=readFrequency(q), flexibleDays=anyDay.test(q);
  const day=q.match(/([월화수목금토일])\s*요일/u)?.[1];
  const wantsPromo=promo.test(q);
  const asksPromoPrices=wantsPromo&&!recommend.test(q)&&!range;
  const wantsPass=recommend.test(q)||Boolean(active&&(after!==null||range||flexibleDays||day||/^[?？\s]+$/u.test(q)));
  if(!asksPromoPrices&&!wantsPass)return null;
  const context={...active,...(after!==null?{after}:{}),...(range?{range}:{}),
    ...(flexibleDays?{anyDay:true,day:null}:day?{day,anyDay:false}:{})};
  const result={topic:'pricing',direct:true};
  if(!publicNovember(q,now)){
    return {context:null,result:{...result,text:'요청하신 달에 적용되는 수강료는 확인되지 않아요. 현재 상품과 가격은 직원에게 확인해 주세요.',inquiry:'staff'}};
  }
  if(asksPromoPrices){
    const group=/그룹/u.test(q), duet=/듀엣|두\s*명|둘이/u.test(q), personalOnly=/개인|프라이빗/u.test(q)&&!group&&!duet;
    const rows=promotionNov.filter(pass=>group===duet||pass.kind===(group?'group':'duet'));
    const text=personalOnly?'11월 공개 프로모션 표에는 그룹과 듀엣만 있어요. 개인레슨은 정규 수강료 원문에서 확인해 주세요.'
      :['11월 블랙프라이데이 공개 수강료예요.',...rows.map(passLine),
        '부가세 포함, 첫 수업일부터 유효기간 적용이에요. 선착순 20명 조건이지만 잔여 혜택과 현재 판매 여부는 직원 확인이 필요해요.'].join('\n');
    return {context:active??null,result:{...result,...sourceLink,text,inquiry:'staff'}};
  }
  if(/개인|프라이빗|듀엣/u.test(q)&&!/그룹/u.test(q)){
    return {context:null,result:{...result,...sourceLink,inquiry:'staff',
      text:'이용하실 개인·듀엣 수업은 담당 강사와 가능한 시간이 중요해요. 최신 수강료 원문에서 가격을 확인하고, 원하시는 시간의 담당 강사와 가능 여부는 직원에게 문의해 주세요.'}};
  }
  if(!context.range){
    const schedule=scheduleContext(context,now);
    return {context,result:{...result,text:[schedule,'그룹 기준으로 비교해 볼게요. 일주일에 몇 번 정도 오실 수 있으세요?'].filter(Boolean).join('\n'),
      ...(schedule?{appGuide}:{}),choices:['주 1회','주 2회','주 2~3회','주 3회']}};
  }
  const [lower,upper]=context.range;
  const fixed=regularNov.filter(pass=>pass.name.startsWith('그룹 기간권')&&pass.frequency>=lower&&pass.frequency<=upper);
  const flexible=regularNov.find(pass=>pass.name===(upper===1?'그룹 횟수권 8회':'그룹 횟수권 20회'));
  const schedule=scheduleContext(context,now);
  const visit=lower===upper?'주 '+lower+'회':'주 '+lower+'~'+upper+'회';
  if(!range&&active?.range&&(recommend.test(q)||/^[?？\s]+$/u.test(q))){
    const lines=fixed.length?[
      '먼저 '+passLine(fixed[0])+'부터 보세요. 주 '+fixed[0].frequency+'회가 꾸준히 가능할 때 맞는 선택이에요.',
      ...(flexible?['방문 횟수가 주마다 바뀐다면 '+passLine(flexible)+'도 비교해 보세요.']:[])
    ]:flexible?['우선 '+passLine(flexible)+'부터 비교해 보세요. 매주 정해진 횟수로 다니기 어려울 때 볼 수 있는 선택지예요.']:[];
    if(lines.length)return {context,result:{...result,...sourceLink,...(schedule?{appGuide}:{}),text:lines.join('\n')}};
  }
  const fixedLines=fixed.map(pass=>passLine(pass)+(pass.frequency===2?' · 주 2회가 꾸준할 때':' · 실제로 주 3회가 꾸준할 때'));
  const text=[schedule,visit+' 방문을 생각하시면 이렇게 비교할 수 있어요.',
    ...fixedLines,...(!fixed.length?['공개표에는 이 빈도의 그룹 기간권이 없어요.']:[]),
    ...(flexible?[passLine(flexible)+' · 주마다 방문 횟수가 달라질 때 비교할 선택지예요.']:[]),
    '금액은 부가세 포함이고 유효기간은 첫 수업일부터예요.'].filter(Boolean).join('\n');
  return {context,result:{...result,...sourceLink,...(schedule?{appGuide}:{}),text}};
}
