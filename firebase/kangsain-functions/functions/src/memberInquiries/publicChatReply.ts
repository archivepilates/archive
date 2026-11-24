import guidance from "./guidance.json";
import evidence from "./public-chat-evidence.generated.json";
import {publicIdentity} from "./publicNaturalChat";

const variants={
  schedule:["timetable","unverified"],
  pricing:["regular","comparison","other","unverified"],
  holding:["general","period","count"],
  booking:["general","flexible","fixed","ending"],
  plan:["general","four_weeks","single_day","daily","daily_home","daily_studio"],
  clarify:["open","context"],
  identity:["story","history","team","kihyo","minjin","eunyoung","chorim","yuri"]
} as const;
type Topic=keyof typeof variants;
export type PublicReplySignals={version:2;topic:Topic;detail:string;previousTopic:Topic|"";day:number;time:number;frequency:number;beginner:boolean};
type NextQuestion="none"|"day"|"time"|"frequency"|"pass_type"|"booking_type"|"routine_scope"|"help_topic";
export type GuidedPublicReply={answer:string;next:NextQuestion};
const weekdays=["","월","화","수","목","금","토","일"];
const times=["","오전","오후","저녁"];
const monthCalendar=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul"});
const allowedProse=/^[\p{Script=Hangul}\p{Zs}.,!?~·()\n]+$/u;
const unsupported=/예약\s*(?:완료|확정)|환불\s*(?:완료|확정)|자리\s*(?:있|남)|(?:무료|할인|선착순|확실히|무조건|자동으로\s*승인|치료|진단)|https?/u;

export function parsePublicReplySignals(input:unknown):PublicReplySignals|null{
  if(!input||typeof input!=="object"||Array.isArray(input))return null;
  const r=input as Record<string,unknown>;
  const index=(v:unknown,max:number)=>typeof v==="number"&&Number.isInteger(v)&&v>=0&&v<=max;
  if(Object.keys(r).sort().join(",")!=="beginner,day,detail,frequency,previousTopic,time,topic,version"
    ||r.version!==2||typeof r.topic!=="string"||!Object.hasOwn(variants,r.topic)||typeof r.detail!=="string"
    ||!(variants[r.topic as Topic] as readonly string[]).includes(r.detail)
    ||typeof r.previousTopic!=="string"||(r.previousTopic!==""&&!Object.hasOwn(variants,r.previousTopic))
    ||!index(r.day,7)||!index(r.time,3)||!index(r.frequency,7)||typeof r.beginner!=="boolean")return null;
  if((r.detail==="four_weeks"&&!r.frequency)||(r.detail==="single_day"&&(!r.day||!r.frequency))
    ||r.detail==="timetable"&&!r.day||r.detail==="comparison"&&!r.frequency)return null;
  if(r.previousTopic==="clarify"||r.topic==="clarify"&&(r.day!==0||r.time!==0||r.frequency!==0||r.beginner
    ||(r.detail==="context")!==Boolean(r.previousTopic)))return null;
  return r as PublicReplySignals;
}

const rule=(id:string)=>guidance.rules.find(r=>r.id===id)?.text??"";
const app="실제 개설과 남은 자리는 스튜디오메이트 회원 앱에서 확인해 주세요.";
const ratesUnavailable="요청하신 월에 적용할 확인된 공개 수강료가 없어요. 현재 상품과 금액은 직원에게 확인해 주세요.";
const scheduleUnavailable="요청하신 달이나 날짜에 적용할 확인된 공개 시간표가 없어요. 최신 시간표는 스튜디오메이트 회원 앱에서 확인해 주세요.";

export function publicReplyFacts(s:PublicReplySignals,now=new Date()):string{
  const date=monthCalendar.format(now), current=date>=evidence.validFrom&&date<=evidence.validThrough;
  const month=Number(evidence.validFrom.slice(5,7))+"월";
  if(s.topic==="schedule"){
    if(!current||s.detail==="unverified")return scheduleUnavailable;
    const day=weekdays[s.day]+"요일", slots=evidence.times[s.day-1]??[];
    const selected=slots.filter(t=>s.time===0||(s.time===1?Number(t.slice(0,2))<12:s.time===2?Number(t.slice(0,2))>=12&&Number(t.slice(0,2))<17:Number(t.slice(0,2))>=17));
    return month+" 명지점 월간 예정표 · "+day+(s.time?" "+times[s.time]:"")+
      (selected.length?" 수업 시작: "+selected.join(", ")+".":"에 표시된 예정 수업은 없어요.")+" "+app;
  }
  if(s.topic==="pricing"){
    if(!current||s.detail==="unverified")return ratesUnavailable;
    if(s.detail==="other")return month+" 개인·듀엣 및 프로모션 조건은 수강료 원문에서 확인할 수 있어요. 실제 판매 여부와 혜택 잔여는 직원이 확인해요.";
    const choices=s.detail==="comparison"?(s.frequency<=2?[0,2]:s.frequency===3?[1]:[]):[0,1,2,3,4];
    const selected=choices.filter(i=>s.detail!=="comparison"||s.frequency!==1||i===2);
    if(!selected.length)return "공개 자료에서 주 "+s.frequency+"회에 바로 맞는 상품을 확인하지 못했어요. 직원에게 조건을 확인해 주세요.";
    return month+" 명지점 정규 그룹 수강료 · 부가세 포함, 첫 수업일부터 기간 적용.\n"+
      selected.map(i=>{const r=evidence.rates[i];return r.name+" · "+r.price.toLocaleString("ko-KR")+"원 · "+r.duration;}).join("\n")+
      "\n실제 판매 및 등록 가능 여부는 직원에게 확인해 주세요.";
  }
  if(s.topic==="holding"){
    return [rule("holding-base"),s.detail==="general"?"기간권과 횟수권은 신청 단위가 달라요.":rule(s.detail==="period"?"holding-period":"holding-count")].join(" ");
  }
  if(s.topic==="booking"){
    if(s.detail==="general")return "취소·변경 기준은 고정예약과 자유예약이 달라요. 이 채팅에서는 예약이나 취소가 실행되지 않아요.";
    const id=s.detail==="fixed"?"booking-fixed":s.detail==="ending"?"fixed-end":"booking-flexible";
    return rule(id)+(s.detail==="ending"?" 카카오톡 문의만으로 기한을 충족했거나 해지가 완료된 것으로 볼 수 없어요.":"");
  }
  if(s.topic==="clarify")return "어떤 내용인지 확실하지 않아서 먼저 확인할게요.";
  if(s.topic==="identity"){
    if(s.detail==="story")return publicIdentity.values+" "+publicIdentity.approach;
    if(s.detail==="history")return "개원 연도 등 공개 자료에서 확인되지 않은 연혁은 정확히 안내하기 어려워요. "+publicIdentity.values;
    if(s.detail==="team")return "팀아카이브 공개 프로필에는 "+publicIdentity.team.map(([name,role])=>name+" "+role).join(", ")+"이 소개돼 있어요.";
    const person=publicIdentity.team[["kihyo","minjin","eunyoung","chorim","yuri"].indexOf(s.detail)];
    return "공식 프로필에서 "+person[0]+" "+person[1]+"의 주요 분야로 소개하는 내용이에요: "+person[2]+".";
  }
  if(s.detail==="daily")return "매일 운동하는 것과 매일 센터 수업에 참여하는 건 달라요. 센터 방문과 집에서 하는 운동을 나눠서 계획할 수 있어요.";
  if(s.detail==="daily_home")return "센터에 오는 날과 집에서 가볍게 움직이는 날을 나눠서 계획할 수 있어요.";
  if(s.detail==="daily_studio")return "센터 수업을 매일 들을 수 있는지는 수강권 조건과 날짜별 개설·예약 상황에 따라 달라요. 먼저 월간 예정표를 볼 수 있어요. "+app;
  if(s.detail==="single_day")return weekdays[s.day]+"요일만 주 1회씩 참여한다면 4주에 4회예요. "+app;
  if(s.detail==="four_weeks")return "주 "+s.frequency+"회라면 4주 기준 "+s.frequency*4+"회예요. 실제 한 달 횟수는 시작일과 요일에 따라 달라져요.";
  return [s.beginner?"처음이라면 기본 동작을 안내하는 입문 수업부터 비교해 보세요.":"꾸준히 다닐 수 있는 시간대를 먼저 정해 보세요.",
    [s.day?weekdays[s.day]+"요일":"",times[s.time],s.frequency?"주 "+s.frequency+"회":""].filter(Boolean).join(" · "),app].filter(Boolean).join(" ");
}

export function renderPublicReply(value:unknown,facts:string):string|null{
  if(typeof value!=="string"||value.length>160||!facts)return null;
  const lead=value.trim();
  if(!lead||/[?\n]/u.test(lead)||!allowedProse.test(lead)||unsupported.test(lead))return null;
  return lead+"\n\n"+facts;
}

function allowedNext(s:PublicReplySignals,now:Date):NextQuestion[]{
  if(s.topic==="clarify")return ["help_topic"];
  if(s.topic==="plan"&&s.detail==="daily")return ["routine_scope"];
  if(s.topic==="plan"&&s.detail==="daily_home")return s.day?["none"]:["day"];
  const next:NextQuestion[]=["none"];
  if(s.topic==="plan"&&s.detail==="general"){
    if(!s.day)next.push("day");
    if(!s.time)next.push("time");
    if(!s.frequency)next.push("frequency");
    if(next.length>1)next.shift();
  }else if(s.topic==="schedule"&&s.detail==="timetable"&&!s.time){
    const date=monthCalendar.format(now);
    if(date>=evidence.validFrom&&date<=evidence.validThrough)next.push("time");
  }else if(s.topic==="pricing"&&s.detail==="regular"&&!s.frequency){
    const date=monthCalendar.format(now);
    if(date>=evidence.validFrom&&date<=evidence.validThrough)next.push("frequency");
  }else if(s.topic==="holding"&&s.detail==="general")next.push("pass_type");
  else if(s.topic==="booking"&&s.detail==="general")next.push("booking_type");
  return next;
}

export async function generatePublicReply(input:PublicReplySignals,key:string,fetcher:typeof fetch=fetch,now=new Date()):Promise<GuidedPublicReply|null>{
  const signals=parsePublicReplySignals(input);
  if(!signals||!key.trim())return null;
  const facts=publicReplyFacts(signals,now);
  const nextOptions=allowedNext(signals,now);
  const res=await fetcher("https://api.openai.com/v1/responses",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key.trim()}`},
    redirect:"error",signal:AbortSignal.timeout(6500),
    body:JSON.stringify({
      model:"gpt-6-luna",store:false,reasoning:{effort:"none"},max_output_tokens:140,
      instructions:"Talk naturally in Korean 해요체 like a friendly studio receptionist. Acknowledge known preferences or a change of plan instead of writing a generic confirmation. Day 1..7 means Monday..Sunday; time 1..3 means morning, afternoon, evening; zero means unknown. When detail is daily, distinguish everyday exercise from taking a class every day. For clarify, the message was not understood: briefly acknowledge that without guessing the visitor's words. In answer write only one short opening sentence in Korean letters, spaces and simple punctuation, without a question. The server appends official facts and the selected question separately. Never repeat facts, use figures or links, infer medical or private details, or claim eligibility, actions or real-time seats. For next, choose one offered question: day, time, frequency, pass_type, booking_type, routine_scope (studio classes only or exercise at home too), help_topic (ask what kind of help), or none if offered and no question would help. Never ask for a preference already provided.",
      input:JSON.stringify({signals,facts}),
      text:{format:{type:"json_schema",name:"help_public_answer",strict:true,schema:{type:"object",
        properties:{answer:{type:"string"},next:{type:"string",enum:nextOptions}},
        required:["answer","next"],additionalProperties:false}}}
    })
  });
  if(!res.ok)return null;
  const body=await res.json();
  if(body?.status!=="completed"||!Array.isArray(body.output)||body.output.length!==1)return null;
  const m=body.output[0];
  if(m?.type!=="message"||m.role!=="assistant"||m.status!=="completed"||!Array.isArray(m.content)||m.content.length!==1)return null;
  const p=m.content[0];
  if(p?.type!=="output_text"||typeof p.text!=="string"||p.text.length>720)return null;
  try{
    const data=JSON.parse(p.text);
    if(!data||typeof data!=="object"||Object.keys(data).sort().join(",")!=="answer,next"
      ||typeof data.answer!=="string"||!nextOptions.includes(data.next))return null;
    return {answer:renderPublicReply(data.answer,facts)??facts,next:data.next};
  }catch{return null;}
}
