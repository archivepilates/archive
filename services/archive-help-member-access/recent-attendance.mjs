import {createHash} from 'node:crypto';
import {currentPassMemberKey} from './current-pass-snapshot.mjs';

const calendar=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const dayMs=86400_000, hex=/^[a-f\d]{64}$/u, id=/^[1-9]\d{0,15}$/u;
const day=v=>typeof v==='string'&&/^20\d{2}-\d\d-\d\d$/u.test(v)&&Number.isFinite(Date.parse(v))&&
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const offset=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*dayMs).toISOString().slice(0,10);
const empty=()=>({group:0,private:0,duet:0,triple:0});
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys;
export const windowFor=time=>{
  const endDate=calendar.format(time);
  return {startDate:offset(endDate,-27),endDate};
};

export async function collectRecentAttendance({fetchPage,now=Date.now,signal}){
  const began=now(),range=windowFor(began),at=new Date(began).toISOString();
  const bookingIds=new Set(),rows=[];
  let pages,total;
  for(let page=1;page===1||page<=pages;page++){
    signal.throwIfAborted();
    const native=(await fetchPage(range,page,signal))?.bookings;
    if(!native||native.current_page!==page||!Number.isSafeInteger(native.total)||native.total<0||native.total>6000
      ||native.last_page!==Math.max(1,Math.ceil(native.total/100))||!Array.isArray(native.data)
      ||native.data.length!==Math.min(100,Math.max(0,native.total-(page-1)*100))
      ||page>1&&(native.last_page!==pages||native.total!==total))throw Error('attendance_traversal_unverified');
    total=native.total;pages=native.last_page;
    for(const booking of native.data){
      const key=String(booking?.id??'');
      if(!id.test(key)||bookingIds.has(key))throw Error('attendance_scope_unverified_booking');
      if(String(booking.studio_id)!=='5330')throw Error(booking.studio_id==null?'attendance_scope_unverified_studio_blank':'attendance_scope_unverified_studio');
      bookingIds.add(key);
      if(!['attendance','attended'].includes(booking.status))continue;
      const memberId=String(booking.member?.id??'');
      const on=String(booking.lecture?.start_on??'').slice(0,10);
      if(!id.test(memberId)||booking.member_id!=null&&String(booking.member_id)!==memberId)
        throw Error('attendance_scope_unverified_member');
      // The bulk list may omit the embedded lecture's studio ID. The parent
      // booking is always scoped to 5330; any supplied lecture scope or ID
      // must agree with the parent rather than silently replacing its proof.
      if(booking.lecture?.studio_id!=null&&String(booking.lecture.studio_id)!=='5330'
        ||booking.lecture_id!=null&&booking.lecture?.id!=null&&String(booking.lecture_id)!==String(booking.lecture.id))
        throw Error('attendance_scope_unverified_lecture');
      if(!day(on)||on<range.startDate||on>range.endDate)throw Error('attendance_scope_unverified_day');
      if(booking.deleted_at)throw Error('attendance_scope_unverified_removed');
      const ticket=booking.user_ticket?.ticket;
      rows.push({memberId,on,productId:id.test(String(ticket?.id??''))?String(ticket.id):null});
    }
  }
  if(bookingIds.size!==total||calendar.format(now())!==range.endDate)throw Error('attendance_traversal_unverified');
  return {at,rows};
}

export function validRecentAttendance(value,through){
  if(!exact(value,'byCategory,lastOn,windowThrough')||!day(value.windowThrough)||value.windowThrough!==through||
     !exact(value.byCategory,'duet,group,private,triple')||!Object.values(value.byCategory).every(v=>Number.isSafeInteger(v)&&v>=0&&v<=500))
    return false;
  return value.lastOn===null?Object.values(value.byCategory).every(v=>v===0):
    day(value.lastOn)&&value.lastOn>=offset(through,-27)&&value.lastOn<=through&&Object.values(value.byCategory).some(v=>v>0);
}

export function makeRecentAttendanceProjection({snapshot,batch,products,secret,now=Date.now()}){
  const collected=Date.parse(snapshot?.at??''),observed=Date.parse(batch.observedAt);
  if(!Number.isFinite(collected)||collected>observed||observed>now||now-collected>=45*60_000||
    calendar.format(collected)!==calendar.format(observed)||!Array.isArray(snapshot.rows)||snapshot.rows.length>6000)
    throw Error('attendance_snapshot_unverified');
  const {startDate,endDate}=windowFor(collected);
  const productsById=new Map(products.map(row=>[row.productId,row.category]));
  const out=new Map(batch.members.map(m=>[m.memberKey,{windowThrough:endDate,lastOn:null,byCategory:empty()}]));
  for(const {memberId,on,productId} of snapshot.rows){
    if(!id.test(memberId)||!day(on)||on<startDate||on>endDate)throw Error('attendance_snapshot_unverified');
    const key=currentPassMemberKey(secret,memberId),attendance=out.get(key);
    if(!attendance)continue;
    const category=productsById.get(productId);
    if(category==='excluded')continue;
    if(!Object.hasOwn(attendance.byCategory,category)){out.delete(key);continue;}
    attendance.byCategory[category]++;
    if(!attendance.lastOn||on>attendance.lastOn)attendance.lastOn=on;
  }
  const records=[...out].filter(([,attendance])=>validRecentAttendance(attendance,endDate))
    .map(([memberKey,attendance])=>({memberKey,attendance}));
  return {records,sourceDigest:createHash('sha256').update('archive-help-attendance:v1\0'+batch.sourceDigest+'\0'+JSON.stringify(records)).digest('hex')};
}

export function createRecentAttendanceLookup({query}){
  return async(grant,cardsObservedAt)=>{
    if(!/^[A-Za-z0-9_-]{43}$/u.test(grant))return null;
    try{
      const digest=createHash('sha256').update(grant).digest('hex');
      const result=await query('select archive_help_roster.read_own_recent_attendance($1::text,$2::timestamptz) as result',[digest,cardsObservedAt]);
      const row=result?.rows?.[0]?.result,checked=Date.parse(cardsObservedAt);
      return Number.isFinite(checked)&&validRecentAttendance(row,calendar.format(checked))?row:null;
    }catch{return null;}
  };
}
