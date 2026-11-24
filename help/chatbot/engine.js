import {regularNov,sourcePrice} from './content.js';
import {privateInput,healthInput} from './privacy.js';
const kst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const memberApp='개인 수강권이나 수강 이력은 공개 채팅에서 조회하지 않아요. 스튜디오메이트 회원 앱에 로그인하고 내 수강권 또는 이용내역을 열어 주세요.';
const staff='정확한 적용 여부는 직원에게 확인해 주세요.';
const money=n=>n.toLocaleString('ko-KR')+'원';
const kstDate=now=>kst.format(now);
function fromRule(rules,id,fallback) {
 const found=rules?.rules?.find(x=>x.id===id);
 const url=rules?.sources?.[found?.sourceId]?.url;
 if(typeof found?.text!=='string')return {text:fallback};
 return {text:found.text,...(/^https:\/\/app\.notion\.com\/p\/[a-f0-9]{32}$/.test(url)&&found.sourceId!=='pricing'?{source:url}:{})};
}
function plan(n,now){
 if(kstDate(now)<'2026-11-01'||kstDate(now)>'2026-11-30')return {text:'현재 확인된 수강료가 없어요. 최신 상품과 가격은 직원에게 확인해 주세요.'};
 const fixed=regularNov.find(item=>item.name.startsWith('그룹 기간권')&&item.frequency===n);
 // Give a low-commitment comparison, not a large bundle calculated from weekly visits alone.
 const starter=regularNov.find(item=>item.name==='그룹 횟수권 8회');
 const items=n<=2?[...(fixed?[fixed]:[]),starter]:fixed?[fixed]:[];
 if(!items.length)return {text:'이 방문 횟수에 맞는 수강권은 직원과 확인해 주세요. 시간대와 일정을 알려 주시면 비교하기 쉬워요.'};
 return {text:'11월 정규 수강료 기준이에요. 부가세 포함이며 유효기간은 첫 수업일부터 계산해요.\n'+items.map(x=>x.name+' · '+x.duration+' · '+money(x.price)).join('\n')+'\n실제 판매·등록 가능 여부는 직원에게 확인해 주세요.',source:sourcePrice};
}
export const reusableQuestion=q=>typeof q==="string"&&!privateInput(q)&&!healthInput.test(q);
export function respond(q,{mode='prospect',context='',now=new Date(),rules=null}={}){
 if(typeof q!=='string'||!q.trim())return {text:'궁금한 내용을 입력해 주세요.'};
 if(privateInput(q))return {text:'이름, 연락처, 생년월일은 채팅에 적지 않아도 돼요. 개인 기록은 회원 앱 또는 직원 문의에서 확인해 주세요.'};
 q=q.trim().slice(0,160);
 const expired=/만료|(?:기간|기한)(?:이|은)?\s*(?:끝|지난|지났|지나)|이미\s*끝/.test(q), extension=/연장|홀딩|일시.?정지/.test(q), leftover=/남(?:은|았|아)|잔여|미사용/.test(q);
 if(healthInput.test(q))return {text:'통증이나 회복 상태에 맞는 운동은 여기서 판단하지 않아요. 직원에게 문의해 코치 상담을 받아 주세요.'};
 if(expired&&!/환불/.test(q)&&(extension||leftover)){
   if(/기간권/.test(q))return fromRule(rules,'holding-period','기간권은 유료 기간 연장 대상이 아니에요. 개인 사례는 직원에게 확인해 주세요.');
   const source='https://app.notion.com/p/216d49eae4bf806983abfb9665af7992';
   if(/횟수권/.test(q))return {source,text:'만료된 횟수권에 미사용 횟수가 남았다면 일반 홀딩이 아닌 유료 기간 연장 상담으로 문의해 주세요. 가능한지, 비용이 얼마인지는 담당자가 수강권을 확인한 뒤 안내해요. 연장은 실행되지 않아요. 필요한 경우 별도로 직원에게 문의해 주세요.'};
   return {source,text:'홀딩은 유효기간 안에 사전 신청하는 제도예요. 이미 끝난 수강권에 남은 횟수가 있다면 직원에게 수강권 종류와 기간 연장 가능 여부를 확인해 주세요.'};
 }
 if(/잔여|남(?:은|았)|(?:내|제)\s*수강권|출석|수강\s*이력|이용\s*내역|로그인|회원\s*인증|패스키/.test(q))return {text:memberApp,memberApp:true,memberLookup:true};
 if(mode==='member'&&/재등록/.test(q))return {text:'재등록 상담은 유효한 수강권이 있거나 마지막 실제 출석일로부터 3개월 이내인 경우를 기준으로 확인해요. 예약만 하거나 취소한 수업은 출석에 들어가지 않아요. 개인별 재등록 여부는 카카오톡으로 직원에게 문의해 주세요.',memberApp:true,inquiry:'staff'};
 if(/잘 모르겠/.test(q))return {text:'가입한 수강권이나 예약 유형을 회원 앱에서 먼저 확인하거나, 직원에게 문의해 주세요.'};
 if(/환불/.test(q)&&!/홀딩이나 환불/.test(q))return {text:'개인별 환불 가능 여부와 금액은 직원이 계약·이용 이력을 확인해 안내해요. 여기서 환불을 실행하지 않아요. 직원 문의는 별도로 선택해 주세요.',source:'https://app.notion.com/p/313d49eae4bf80179269f09d02597ede'};
 if(/홀딩이나 환불/.test(q))return {text:'홀딩(일시정지)과 환불 중 무엇을 확인할까요?',context:'hold-choice',choices:['홀딩','환불']};
 const fixed=/고정/.test(q), flex=/자유/.test(q);
 const single=/한\s*번(?:만)?|1\s*회(?:만)?|한\s*수업|이번\s*수업|당일\s*수업/.test(q);
 const recurringEnd=/해지|종료|그만|고정.{0,12}(?:중단|빼)|다음\s*달부터.{0,10}(?:안|못)\s*(?:갈|할|다닐)/.test(q);
 if((fixed||context==='fixed')&&recurringEnd&&(!single||/해지|종료/.test(q))){
   const result=fromRule(rules,'fixed-end','고정예약 해지 마감과 적용월은 데스크에 직접 확인해 주세요.');
   return {...result,context:'fixed',text:result.text+'\n데스크에 직접 요청해 주세요. 카카오톡 문의만으로 접수 기한을 충족했거나 해지가 완료됐다고 볼 수 없으니, 데스크에서 확인해 주세요.'};
 }
 if(fixed||context==='fixed'&&single){
   const result=fromRule(rules,'booking-fixed','고정예약 수업 1회 취소·변경은 원칙적으로 불가해요.');
   return {...result,context:'fixed',text:result.text+'\n한 회차의 예외 검토가 필요하면 직원에게 문의해 주세요.'};
 }
 if(flex||context==='flexible'&&/주말|토요일|일요일|공휴일/.test(q)){
   const answer=fromRule(rules,'booking-flexible','자유 예약의 마감은 스튜디오메이트 회원 앱 또는 직원에게 확인해 주세요.');
   return {...answer,context:'flexible'};
 }
 if(/예약|취소|변경/.test(q)||context==='booking')return {text:'고정 예약인가요, 자유 예약인가요?',context:'booking',choices:['고정 예약','자유 예약','잘 모르겠어요']};
 if(/홀딩|일시.?정지/.test(q)||context==='hold'){
  if(/기간권/.test(q))return fromRule(rules,'holding-period',staff);
  if(/횟수권/.test(q))return fromRule(rules,'holding-count',staff);
  return {text:'어떤 수강권에 대한 홀딩인가요?',context:'hold',choices:['기간권','횟수권','잘 모르겠어요']};
 }
 const chooseClass=!/수강권|수강료|가격|등록/.test(q)&&(context==='class'||/어떤 수업|수업.*(?:좋|추천)|(?:추천|맞는).*수업|초보.*(?:좋|추천)/.test(q));
 const hits=q.match(/(?:주(?:당)?\s*([1-7])\s*(?:회|번)|^([1-7])\s*(?:회|번)$)/);
 if(hits&&!chooseClass)return plan(Number(hits[1]||hits[2]),now);
 if(/수강권|수강료|가격|재등록|등록|정책/.test(q)){
   if(kstDate(now)<'2026-11-01'||kstDate(now)>'2026-11-30')return plan(2,now);
   return {text:'일주일에 보통 몇 번 방문할 수 있으세요? 정규 그룹 수강권을 최대 2개 비교해 드려요.',context:'pass',choices:['주 1회','주 2회','주 3회']};
 }
 if(/시간표|휴무/.test(q)&&!(/추천/.test(q)))return {text:'실제 시간표·휴무는 스튜디오메이트 회원 앱의 최신 공지를 확인해 주세요. 아직 회원이 아니라면 가능한 요일과 시간을 직원에게 알려 주세요.'};
 if(/수업|추천|초보|기구/.test(q)||context==='class'){
  if(/오전|오후|저녁|요일|리포머|체어|초보|처음|기초|경험/.test(q)){
   const beginner=/초보|처음|기초|입문/.test(q);
   const known=/리포머|체어|바렐|캐딜락/.test(q);
   const time=q.match(/오전|오후|저녁/)?.[0];
   const freq=hits?.[1]||hits?.[2];
   const compare=time||freq?'\n'+[time?time+'에 가능한 시간':null,freq?'주 '+freq+'회 방문':null].filter(Boolean).join('과 ')+' 기준으로 고르면 좋아요.':'';
   return {text:(beginner?'필라테스가 처음이라면 기본 동작을 설명하는 입문 수준 수업부터 알아보는 게 좋아요.':known?'선호 기구와 비슷한 난이도의 수업이 가능한지 먼저 확인해 보세요.':'가능한 요일과 시간대에 무리 없이 꾸준히 갈 수 있는 수업부터 비교해 보세요.')+compare+'\n실제 개설 여부와 좌석은 확인하지 않았어요. '+(mode==='member'?'회원 앱에서 확인하거나 직원에게 문의해 주세요.':'가능한 요일·시간·기구 경험을 직원에게 알려주시면 맞는 수업을 확인할 수 있어요.')};
  }
  return {text:'가능한 시간대와 필라테스·기구 경험을 알려 주세요. 예: 화요일 오전, 리포머는 처음이에요.',context:'class',choices:['오전 · 처음이에요','저녁 · 기구 수업 경험 있어요']};
 }
 return {text:'어떤 점이 궁금하신지 조금만 더 알려주세요.',unknown:true};
}
