import {reusableQuestion} from './engine.js';
import {conversationTurn} from './conversation.js';

// Send only predefined tags, not a redacted copy of the visitor's message.
const cues={
  schedule:/시간표|스케줄|(?:수업|강좌).{0,5}(?:시간|일정|열리|있나)|몇\s*시|시간대/u,
  price:/가격|수강료|비용|얼마|금액|결제|요금/u,
  hold:/홀딩|일시.?정지|멈추|멈출|쉬어|쉬고|쉬어야|잠깐\s*쉬/u,
  book:/예약|취소|바꾸|옮기|자리|잡을/u,
  recommend:/추천|어떤\s*수업|맞을|맞는|좋을|어울리|시작하/u,
  beginner:/처음|초보|입문|해\s*본\s*적\s*없/u,
  weekday:/평일|월요일|화요일|수요일|목요일|금요일/u,
  weekend:/주말|토요일|일요일/u,
  morning:/아침|오전|출근\s*전/u,
  afternoon:/오후|낮\s*시간/u,
  evening:/저녁|퇴근|저녁밥|야간/u,
  frequency:/일주일|주\s*(?:당|에|[1-7])|몇\s*(?:회|번)|한\s*달|4\s*주/u,
  followup:/^(?:그럼|그러면|혹시)|그중|앞에서/u
};
const topics=new Set(['schedule','pricing','holding','booking','plan']);
const days=['','월','화','수','목','금','토','일'];
const times=['','오전','오후','저녁'];
const requestPolicy=/다른\s*(?:사람|회원)|내\s*(?:예약|기록|출석|잔여)|회원\s*(?:번호|기록|정보|인증)|출석|이력|환불|통증|부상|건강|알레르기|약물|수술|질환|임신|체중|진단|치료|비밀번호|인증번호/u;

export function prepareAiSignals(question,state){
  const text=question.normalize('NFKC').trim();
  if(!text||!reusableQuestion(text)||requestPolicy.test(text))return null;
  const tags=Object.entries(cues).filter(([,pattern])=>pattern.test(text)).map(([tag])=>tag);
  const context=topics.has(state?.topic)?state.topic:'';
  if(!tags.length||tags.length===1&&tags[0]==='followup'&&!context)return null;
  const plan=state?.plan??{};
  return {tags,context,day:Math.max(0,days.indexOf(plan.day)),time:Math.max(0,times.indexOf(plan.time)),
    frequency:Number.isInteger(plan.frequency)&&plan.frequency>=1&&plan.frequency<=7?plan.frequency:0};
}

const routeSpecs={
  schedule:{cue:'schedule',topic:'schedule',prefix:'시간표'},
  price:{cue:'price',topic:'pricing',prefix:'수강료'},
  hold:{cue:'hold',topic:'holding',prefix:'홀딩'},
  book:{cue:'book',topic:'booking',prefix:'예약'},
  recommend:{cue:'recommend',topic:'plan',prefix:'수업 추천'}
};

const routes={schedule:'schedule',pricing:'price',holding:'hold',booking:'book',plan:'recommend'};
const lineTime=/오전|오후|저녁|아침|퇴근/u;
const dateReference=/[월화수목금토일]\s*요일|주말|평일|\d{1,2}\s*[월일]|다음\s*(?:주|달)|지난\s*(?:주|달)|오늘|내일|모레|어제|내년|작년/u;
const currentWindow=/이번\s*달|현재|11\s*월/u;
const wrongMonth=/다음\s*달|지난\s*달|내년|작년|십이월|(?:^|[^\d])(?:[1-9]|10|12)\s*월/u;
const followUp=/^(?:그럼|그러면|그중|그 때)|(?:오전|오후|저녁|아침|요일)(?:은|에는|만|밖에|엔)|(?:기간권|횟수권|공휴일)(?:은|는|이면)|(?:한\s*달|4\s*주)|^[1-7]\s*(?:회|번)/u;
const monthCount=/한\s*달|4\s*주|월\s*몇\s*(?:회|번)/u;
const sensitive=/(?:내|제|저의|우리)\s*(?:수강권|회원권|예약|결제|환불|계정|이력|홀딩)|(?:연락처|생년월일|주민번호|계좌|비밀번호|인증번호|진단서)|(?:방금|이미)\s*(?:예약|결제|신청)/u;
const kst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});

export function preparePublicReply(question,previous={},options={}){
  const q=question.normalize('NFKC').trim();
  let result=conversationTurn(q,previous,options);
  if(!q||q.length>220||result.hideInput||result.memberLookup||result.inquiry==='refund'
    ||!reusableQuestion(q)||requestPolicy.test(q)||sensitive.test(q))return {result,signals:null};
  const old=previous.publicContext;
  const cues=prepareAiSignals(q,result.state)?.tags??[];
  const isFollow=followUp.test(q);
  if(!Object.hasOwn(routes,result.state.topic)){
    const candidates=Object.values(routes).filter(intent=>cues.includes(intent));
    const inferred=isFollow&&old&&candidates.length===0?routes[old.topic]:candidates.length===1?candidates[0]:null;
    if(inferred)result=conversationTurn(routeSpecs[inferred].prefix+' '+q,previous,options);
  }
  const topic=result.state.topic;
  if(!Object.hasOwn(routes,topic)||result.hideInput||result.memberLookup||result.inquiry==='refund')return {result,signals:null};
  const same=old?.topic===topic;
  const plan=result.state.plan??{};
  const directFrequency=topic==='pricing'?Number(q.match(/(?:주(?:당|에)?\s*|^)([1-7])\s*(?:회|번)/u)?.[1]):0;
  const frequency=directFrequency||(Number.isInteger(plan.frequency)&&plan.frequency>=1&&plan.frequency<=7?plan.frequency:0);
  let day=Math.max(0,days.indexOf(plan.day)),time=Math.max(0,times.indexOf(plan.time)),detail='';
  if(topic==='schedule'){
    if(same&&old.detail==='unverified'&&!currentWindow.test(q)&&!/오늘/u.test(q)){
      result=conversationTurn('다음 달 시간표',previous,options);
    }else if(result.timetable&&same&&old.day&&!dateReference.test(q)){
      result={...result,timetable:{...result.timetable,selectedDay:days[old.day]}};
    }
    if(!lineTime.test(q))time=same&&isFollow?old.time:0;
    day=result.timetable?Math.max(0,days.indexOf(result.timetable.selectedDay)):0;
    detail=day?'timetable':'unverified';
  }else if(topic==='pricing'){
    if(!kst.format(options.now??new Date()).startsWith('2026-11-')||wrongMonth.test(q)||same&&old.detail==='unverified'&&!currentWindow.test(q)){
      result=conversationTurn('다음 달 수강료',previous,options);
      detail='unverified';
    }else if(/개인|프라이빗|듀엣|프로모션|특가|블랙프라이데이/u.test(q))detail='other';
    else if(directFrequency||frequency&&!result.choices?.length){
      detail='comparison';
      if(directFrequency){
        result=conversationTurn('수강료 주 '+directFrequency+'회',previous,options);
      }
    }else detail='regular';
  }else if(topic==='holding'){
    if(/만료|이미\s*끝|기간.{0,4}지난|연장/u.test(q))return {result,signals:null};
    detail=/기간권/u.test(q)?'period':/횟수권/u.test(q)?'count':same&&isFollow?old.detail:'general';
    if(!result.source&&detail!=='general')result=conversationTurn((detail==='period'?'기간권':'횟수권')+' 홀딩',previous,options);
  }else if(topic==='booking'){
    const kind=result.state.context;
    detail=kind==='fixed'?(/해지|종료|그만|다음\s*달부터/u.test(q)?'ending':'fixed'):kind==='flexible'?'flexible':'general';
  }else{
    detail=day&&frequency&&plan.onlyDay?'single_day':frequency&&monthCount.test(q)?'four_weeks':'general';
  }
  const publicContext={topic,detail,day,time};
  const packet={version:2,topic,detail,previousTopic:Object.hasOwn(routes,previous.topic)?previous.topic:'',
    day:topic==='schedule'||topic==='plan'?day:0,time:topic==='schedule'||topic==='plan'?time:0,
    frequency:topic==='pricing'||topic==='plan'?frequency:0,beginner:topic==='plan'&&plan.beginner===true};
  return {result:{...result,state:{...result.state,publicContext}},signals:packet};
}

export async function requestPublicReply(signals,controller,fetcher=fetch){
  if(!signals)return null;
  const timeout=setTimeout(()=>controller.abort(),7400);
  try{
    const reply=await fetcher('/api/public-chat-intent',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(signals),
      cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal
    });
    if(!reply.ok||!reply.headers.get('content-type')?.includes('application/json'))return null;
    const data=await reply.json();
    return data?.ok===true&&typeof data.answer==='string'&&data.answer.trim()&&data.answer.length<=1500?data.answer:null;
  }catch{return null;}
  finally{clearTimeout(timeout);}
}
