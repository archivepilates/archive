import {STUDIO_ID} from './accounts.mjs';

const calendar=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const day=ms=>calendar.format(new Date(ms));
const validDate=v=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)
  &&Number.isFinite(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const validCount=v=>v===null||Number.isSafeInteger(v)&&v>=0&&v<=1000;
const category=new Set(['그룹수업','개인수업','듀엣수업']);
const sameAccount=(a,b)=>!!b&&a.accountId===b.accountId&&a.studioId===b.studioId
  &&a.memberId===b.memberId&&a.revision===b.revision&&a.expiresAt===b.expiresAt;
const fullPhone=s=>typeof s==='string'&&/^01[016789]\d{7,8}$/.test(s);
const cleanName=s=>typeof s==='string'?s.normalize('NFC').trim():'';
const identityMatches=(value,expected)=>value?.memberId===expected.memberId&&
  cleanName(value.name)===cleanName(expected.name)&&value.phone===expected.phone;

export function createStudioMateOwnReader({reader,loadExpectedIdentity,classifyTicket,now=Date.now}){
  return async function readOwn(account,scope,{signal,startedAt}){
    if(account?.studioId!==STUDIO_ID||!['cards','history'].includes(scope)||signal.aborted)return null;
    const identity=await loadExpectedIdentity({studioId:STUDIO_ID,memberId:account.memberId,revision:account.revision,signal});
    if(!identity||identity.authority!=='verified_member_identity'||identity.memberId!==account.memberId
      ||identity.revision!==account.revision||identity.studioId!==account.studioId
      ||!cleanName(identity.name)||!fullPhone(identity.phone)||signal.aborted)return null;
    const expected={memberId:account.memberId,name:cleanName(identity.name),phone:identity.phone};
    let result, rows;
    if(scope==='cards'){
      result=await reader.getOverview(expected,signal);
      if(!identityMatches(result,expected)||result.coverage!=='current_ticket_cards'||!Array.isArray(result.tickets)||result.tickets.length>100)return null;
      rows=[];
      for(const ticket of result.tickets){
        // The production classifier must recognize this exact native product and status; no name heuristics.
        const rule=classifyTicket(ticket);
        if(rule?.display===false&&rule.verified===true)continue;
        if(rule?.display!==true||rule.verified!==true||!category.has(rule.category)
          ||!validDate(ticket?.availableFromDate)||!validDate(ticket.expiresOn)
          ||ticket.availableFromDate>ticket.expiresOn)return null;
        if(rule.type==='period')rows.push({category:rule.category,type:'period',endsOn:ticket.expiresOn});
        else if(rule.type==='count'&&validCount(ticket.remainingCount)&&validCount(ticket.reservableCount)){
          rows.push({category:rule.category,type:'count',remaining:ticket.remainingCount,bookable:ticket.reservableCount,expiresOn:ticket.expiresOn});
        }else return null;
      }
      if(rows.length>8)return null;
    }else{
      const range={startDate:day(now()-30*86400_000),endDate:day(now())};
      result=await reader.getBookings(expected,range,signal);
      const coverage=result?.coverage;
      if(!identityMatches(result,expected)||coverage?.kind!=='native_member_booking_history'||coverage.complete!==true
        ||coverage.traversalComplete!==true||coverage.requestedRange?.startDate!==range.startDate
        ||coverage.requestedRange?.endDate!==range.endDate||!Array.isArray(result.records)||result.records.length>2000)return null;
      const observed=result.records.filter(row=>row?.sourceStatus==='attendance');
      if(observed.some(row=>!validDate(row.lectureDate)||row.lectureDate<range.startDate||row.lectureDate>range.endDate
        ||!['group','private'].includes(row.lessonType)))return null;
      rows=observed.slice().sort((a,b)=>b.lectureDate.localeCompare(a.lectureDate)).slice(0,5).map(row=>({
        date:row.lectureDate,category:row.lessonType==='group'?'그룹수업':'개인·듀엣 계열',status:'출석'
      }));
    }
    const checkedAt=Date.parse(result?.checkedAt);
    if(signal.aborted||!Number.isFinite(checkedAt)||checkedAt<startedAt||checkedAt>now()||now()-checkedAt>30_000)return null;
    return {rows,checkedAt,memberId:account.memberId};
  };
}

export function createOwnLookup({accounts,readOwn,now=Date.now}){
  return async function lookup(session,scope){
    if(!['cards','history'].includes(scope))return null;
    const first=await accounts.resolveSession(session);
    if(!first)return null;
    const startedAt=now(),signal=AbortSignal.timeout(30_000);
    const result=await readOwn(first,scope,{startedAt,signal});
    if(!result||result.memberId!==first.memberId||signal.aborted)return null;
    const after=await accounts.resolveSession(session);
    if(!sameAccount(first,after)||signal.aborted||now()-result.checkedAt>30_000)return null;
    return {[scope]:result.rows,checkedAt:new Date(result.checkedAt).toISOString(),expiresAt:after.expiresAt};
  };
}
