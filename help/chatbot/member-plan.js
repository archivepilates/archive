import {recommendClasses,bookingGuide} from './recommendation.js';

const dayFmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const dayMs=86400_000;
const dateMs=v=>typeof v==='string'&&/^20\d{2}-\d\d-\d\d$/u.test(v)&&
  new Date(Date.parse(v+'T00:00:00Z')||0).toISOString().slice(0,10)===v?Date.parse(v+'T00:00:00Z'):NaN;
const categories={group:'그룹',private:'프라이빗',duet:'듀엣',triple:'트리플'};
export const planOptions=['평일 오전','평일 오후','평일 저녁','주말','시간 무관'];
const times=['weekdayMorning','weekdayAfternoon','weekdayEvening','weekend','flexible'];
export const clarification={
  text:'제가 질문을 정확히 이해하지 못했어요. 수업 시간, 수강료, 운동 계획 중 어떤 쪽을 이어서 볼까요?',
  choices:['수업 시간','수강료','운동 계획']
};
const planWord=/(?:수업|운동|루틴).{0,18}(?:추천|계획|뭘\s*들|뭐\s*들|어떻게\s*다니)|(?:추천|맞는|다음에\s*들을).{0,12}(?:수업|운동)|^어떤\s*수업/u;
const blocked=/(?:친구|가족|남편|아내|배우자|타인|다른\s*(?:회원|사람))/u;
export function memberPlanIntent(q,{connected=false,preferring=false}={}){
  if(blocked.test(q))return null;
  const label=planOptions.find(v=>q.includes(v));
  const time=label?times[planOptions.indexOf(label)]:
    /저녁|퇴근/u.test(q)?'weekdayEvening':/오전|아침/u.test(q)?'weekdayMorning':/오후/u.test(q)?'weekdayAfternoon':null;
  const request=planWord.test(q);
  if((connected||/내\s*(?:수강권|이력|수업)|맞춤/u.test(q))&&request||connected&&preferring&&label)
    return {kind:'plan',time};
  if(/수강\s*이력|내\s*출석|수업\s*이력|이용\s*내역|출석\s*기록/u.test(q))return {kind:'history'};
  return null;
}
const countsOk=n=>Number.isSafeInteger(n)&&n>=0&&n<=500;
export function validAttendance(value,today){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).sort().join(',')==='byCategory,lastOn,windowThrough'&&
    Number.isFinite(dateMs(value.windowThrough))&&value.windowThrough<=today&&
    dateMs(today)-dateMs(value.windowThrough)<=dayMs&&value.byCategory&&
    Object.keys(value.byCategory).sort().join(',')==='duet,group,private,triple'&&
    Object.values(value.byCategory).every(countsOk)&&
    (value.lastOn===null?Object.values(value.byCategory).every(n=>n===0):
      Number.isFinite(dateMs(value.lastOn))&&value.lastOn<=value.windowThrough&&
      dateMs(value.windowThrough)-dateMs(value.lastOn)<28*dayMs&&Object.values(value.byCategory).some(n=>n>0));
}

export function memberPlanText(rows,attendance,kind,time,now=new Date()){
  const today=dayFmt.format(now);
  const history=validAttendance(attendance,today)?attendance:null;
  const historyLine=history?history.lastOn?
    '최근 4주 확인된 출석: '+Object.entries(categories).filter(([k])=>history.byCategory[k]>0)
      .map(([k,label])=>label+' '+history.byCategory[k]+'회').join(' · ')+'\n마지막 출석 '+history.lastOn:
    '최근 4주 내 확인된 출석 기록이 없어요.':
    '최근 출석 기록을 확인하지 못했어요. 미출석으로 판단하지 않아요.';
  if(kind==='history')return {text:historyLine,appGuide:bookingGuide,choices:['수업 추천']};
  const usable=rows.filter(r=>Object.hasOwn(categories,r?.category)&&r.status==='active'&&
    Number.isFinite(dateMs(r.startsOn))&&Number.isFinite(dateMs(r.expiresOn))&&r.startsOn<=today&&today<=r.expiresOn&&
    (r.type==='period'||r.type==='count'&&Number.isSafeInteger(r.remaining)&&r.remaining>0&&Number.isSafeInteger(r.bookable)&&r.bookable>0));
  if(!usable.length)return {text:historyLine+'\n\n현재 추천에 사용할 수 있는 수강권이 확인되지 않아요. 홀딩 중이거나 예약 가능한 횟수가 없는 수강권은 추천에서 제외했어요.',appGuide:bookingGuide};
  usable.sort((a,b)=>(history?.byCategory[b.category]??0)-(history?.byCategory[a.category]??0)||a.expiresOn.localeCompare(b.expiresOn));
  const pass=usable[0];
  const counts=pass.type==='count'?' · 잔여 '+pass.remaining+'회 · 추가 예약 가능 '+pass.bookable+'회':' · 기간권';
  const weeks=Math.max(1,Math.ceil((dateMs(pass.expiresOn)-dateMs(today)+dayMs)/(7*dayMs)));
  const habit=history?.byCategory[pass.category]??0;
  // Match the current attendance pace, not an artificial target to spend every credit.
  const weekly=habit?Math.min(3,Math.max(1,Math.round(habit/4))):1;
  const cap=pass.type==='count'?Math.min(weekly,pass.bookable):weekly;
  const pace='주 '+cap+'회부터 이어가 보세요.'+(pass.type==='count'&&pass.bookable>weeks*cap?
    ' 이 속도라면 만료 전 일부 횟수가 남을 수 있어요. 무리해서 몰아 듣기보다 가능한 일정을 먼저 확인해 주세요.':'');
  const title=categories[pass.category]+counts+' · 만료 '+pass.expiresOn;
  if(pass.category!=='group')return {text:[historyLine,title,pace+' 개인 레슨은 공개 그룹 시간표를 적용하지 않아요. 가능한 시간은 회원 앱이나 데스크에서 확인해 주세요.'].join('\n\n'),appGuide:bookingGuide};
  const availability=times.includes(time)?time:'flexible';
  const classes=recommendClasses({time:availability,goal:'routine',intensity:'moderate',through:pass.expiresOn,
    limit:pass.type==='count'?Math.min(2,pass.bookable):2},now);
  const candidates=classes?.classes??[];
  return {text:[historyLine,title,pace,candidates.length?
    '공개 예정표에서 만료일까지의 후보를 골랐어요.\n'+candidates.map(x=>x.label).join(' · ')+'\n실제 개설과 남은 자리는 회원 앱에서 확인해 주세요.':
    '조건에 맞는 확인된 공개 예정표가 없어요. 개설 시간과 예약은 회원 앱에서 확인해 주세요.'].join('\n\n'),
    appGuide:bookingGuide,choices:planOptions,rememberPlan:true};
}
