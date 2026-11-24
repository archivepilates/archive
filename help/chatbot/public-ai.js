import {reusableQuestion} from './engine.js';

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

export function groundedIntent(intent,signals){
  const rule=Object.hasOwn(routeSpecs,intent)?routeSpecs[intent]:null;
  if(!rule||!signals)return null;
  return signals.tags.includes(rule.cue)||signals.context===rule.topic
    ||intent==='recommend'&&signals.tags.includes('beginner')?rule:null;
}

export async function requestAiIntent(signals,controller,fetcher=fetch){
  if(!signals)return null;
  const timeout=setTimeout(()=>controller.abort(),4200);
  try{
    const reply=await fetcher('/api/public-chat-intent',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(signals),
      cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal
    });
    if(!reply.ok||!reply.headers.get('content-type')?.includes('application/json'))return null;
    const data=await reply.json();
    return data?.ok===true&&typeof data.intent==='string'&&data.intent.length<=20?groundedIntent(data.intent,signals):null;
  }catch{return null;}
  finally{clearTimeout(timeout);}
}
