import {healthInput,privateInput} from './privacy.js';
import {publishedTimetable} from './timetable.js';

const endpoint='/api/public-chat-intent';
const privateTopic=/(?:내|제|저의)\s*(?:이름|성함|수강권|회원권|시간표|홀딩|예약|출석|결제|환불|주소|기록|계정)|다른\s*(?:회원|사람)|(?:몇\s*(?:회|번)|수강권).{0,8}남았|(?:잔여\s*횟수|출석\s*기록|수강\s*이력|이용\s*내역|결제\s*내역|패스키)|회원\s*(?:정보|번호|기록|인증)|전화\s*번호|연락처|생년월일|주민\s*번호|비밀번호|인증\s*(?:번호|코드)|계좌|진단서|질환|약물|알레르기|[@<>]|https?:|\bwww\.|(?:\d[\s.()+-]*){8,}|(?<!\d)\d{6}(?!\d)/iu;
const namePattern=/(?:^|[\s,])([김이박최정강조윤장임한오서신권황안송류전홍유고문양손배백허남심노하곽성차주우구민진엄변천염여추도소석선설마길연방명]?[가-힣]{2,3})(?:\s*(?:님|씨|회원)(?:[\s,.!?은는이가을를]|$))/gu;
const publicNames=new Set(['김기효','배민진','정은영','이초림','정유리','강사','선생','원장','대표','부원장','회원','고객','담당자']);
const identityHint=/(?:제|내|저희)\s*(?:이름|성함|연락처|주소)|(?:이름|성함|주소)\s*[:=]|(?:저는|제가|본인)\s*[김이박최정강조윤장임한오서신권황안송류전홍유고문양손배백허남심노하곽성차주우구민진엄변천염여추도소석선마길연방명][가-힣]{1,3}\s*(?:입니다|이에요|예요)|(?:[가-힣\d]+(?:대로|번길)|[가-힣]+\d+로)\s*\d{1,5}|[가-힣]{2,}로\s+\d{1,5}(?!\d|\s*(?:회|번(?!길)|주|일|월|시|명|원|개))|\d{2,4}\s*(?:동|호)(?=[\s,.!?]|$)/u;
const sources={
  brand:['ARCHIVE PILATES 소개','https://archivepilates.com/'],
  team:['팀아카이브 공식 프로필','https://archivepilates.com/teams'],
  schedule:['명지점 공개 시간표','https://archivepilates.notion.site/#409d49eae4bf800a9bdbdfcc29f1c3cc'],
  pricing:['공식 수강료 안내','https://archivepilates.notion.site/'],
  app:['스튜디오메이트 회원 앱 안내','https://archivepilates.notion.site/studiomate']
};
export async function supportsNaturalChat(fetcher=fetch){
  try{
    const response=await fetcher(endpoint+'?capabilities=natural',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(2000)});
    return response.ok&&(await response.json()).natural===true;
  }catch{return false;}
}
export function publicNaturalPacket(question,history){
  const text=question.normalize('NFKC').trim();
  if(!text||text.length>180
    ||privateInput(text)||healthInput.test(text)||privateTopic.test(text)||identityHint.test(text)||/[\p{Cc}\p{Cf}]/u.test(text)
    ||[...text.matchAll(namePattern)].some(m=>!publicNames.has(m[1])))return null;
  return {version:3,consent:true,question:text,history:history.slice(-4)};
}
export async function requestNaturalReply(packet,controller,fetcher=fetch){
  const timeout=setTimeout(()=>controller.abort(),9700);
  try{
    const response=await fetcher(endpoint,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(packet),signal:controller.signal});
    if(!response.ok)return null;
    const reply=await response.json();
    if(reply.ok!==true||typeof reply.answer!=='string'||!reply.answer.trim()||reply.answer.length>320
      ||(reply.officialOnly!==undefined&&reply.officialOnly!==true)
      ||!Array.isArray(reply.details)||reply.details.length>5||!reply.details.every(v=>typeof v==='string'&&v.length<=420)
      ||reply.scheduleDay!==null&&!/^[월화수목금토일]$/u.test(reply.scheduleDay)
      ||typeof reply.link!=='string'||!['none','staff'].includes(reply.link)&&!Object.hasOwn(sources,reply.link))return null;
    return {answer:reply.answer,link:reply.link,details:reply.details,scheduleDay:reply.scheduleDay,officialOnly:reply.officialOnly===true};
  }catch{return null;}
  finally{clearTimeout(timeout);}
}
export function applyNaturalReply(state,reply,now=new Date()){
  const source=Object.hasOwn(sources,reply.link)?sources[reply.link]:null;
  const timetable=reply.link==='schedule'?publishedTimetable(reply.scheduleDay?reply.scheduleDay+'요일':'시간표',now):null;
  return {text:[reply.answer,...reply.details].join('\n\n'),state,aiAssisted:!reply.officialOnly,officialOnly:reply.officialOnly,
    ...(source?{sourceLabel:source[0],source:source[1]}:{}),
    ...(timetable?{timetable}:{}),
    ...(reply.link==='staff'?{inquiry:'staff'}:{})};
}
