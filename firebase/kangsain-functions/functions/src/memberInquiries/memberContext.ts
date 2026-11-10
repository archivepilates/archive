const phone = (value: unknown) => String(value || '').replace(/[()\s-]/g,'').replace(/^\+?82/,'0');
const name = (value: unknown) => String(value || '').normalize('NFC').replace(/\s+/g,'');
const iso = (value: any): string | null => {
  const millis=value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
};
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const clean = (value: unknown) => typeof value === 'string' ? value.slice(0,200) : '';

export async function readInquiryMemberContext(db: any, row: Record<string, any>, now: number, profileOnly = false) {
  const result: Record<string,any> = {status:'not_found',source:'memberProfiles',observedAt:new Date(now).toISOString(),
    tickets:[],holds:[],bookings:[],coverage:{profilesLimited:false,bookingsLimited:false},
    note:'CORE 저장 원본의 일치 결과이며 본인 확인이나 StudioMate 실시간 조회가 아닙니다. 실제 처리 전 원본을 재확인하세요.'};
  const normalized=phone(row.memberPhone),expectedName=name(row.memberName);
  if(!/^010\d{8}$/.test(normalized)||!expectedName)return {...result,status:'incomplete'};
  const phones=[normalized,normalized.replace(/^(\d{3})(\d{4})(\d{4})$/,'$1-$2-$3'),'+82'+normalized.slice(1),'82'+normalized.slice(1)];
  const snapshot=await db.collection('memberProfiles').where('phone','in',phones).limit(21).get();
  if(snapshot.size===21)return {...result,status:'ambiguous',coverage:{...result.coverage,profilesLimited:true}};
  const matches=new Map<string,any>();
  const consistent=(profile:any)=>profile?.studioId===row.studioId&&phone(profile.phone)===normalized&&name(profile.name)===expectedName;
  for(const doc of snapshot.docs){
    let profile=doc.data(),id=doc.id;
    if(!consistent(profile))continue;
    const seen=new Set([id]);
    for(let hop=0;profile.canonicalMemberId||profile.mergedInto;hop++){
      const next=profile.canonicalMemberId||profile.mergedInto;
      if(hop>=3||typeof next!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(next)||seen.has(next))return {...result,status:'ambiguous'};
      const linked=await db.collection('memberProfiles').doc(next).get();
      if(!linked.exists||!consistent(linked.data()))return {...result,status:'incomplete'};
      seen.add(next);id=linked.id;profile=linked.data();
    }
    matches.set(id,profile);
  }
  const natives=[...matches].filter(([id])=>!id.startsWith('excel_'));
  let selected: [string,any] | undefined;
  if(natives.length===1){
    const nativeId=String(natives[0][1].studiomateMemberId||natives[0][1].memberId||natives[0][0]);
    if([...matches].some(([id,p])=>id.startsWith('excel_')&&p.studiomateMemberId&&String(p.studiomateMemberId)!==nativeId))return {...result,status:'ambiguous'};
    selected=natives[0];
  } else if(natives.length>1||matches.size>1)return {...result,status:'ambiguous'};
  else selected=[...matches][0];
  if(!selected)return result;
  const [memberId,profile]=selected;
  const mapTicket=(ticket:any)=>({id:clean(ticket.userTicketId||ticket.ticketId),name:clean(ticket.name),
    remainingCount:count(ticket.remainingCount),usableCount:count(ticket.usableCount),status:clean(ticket.status),
    availableFrom:iso(ticket.availableFrom),expiresAt:iso(ticket.expiresAt)});
  result.status='unique_stored_match';
  result.profile={memberId,name:clean(profile.name),memberGrade:clean(profile.memberGrade),maskedPhone:normalized.slice(0,3)+'-****-'+normalized.slice(-4),syncedAt:iso(profile.syncedAt||profile.sourceUpdatedAt)};
  if(profileOnly){
    const valid=(value:any)=>typeof value==='number'?Number.isSafeInteger(value)&&value>0:typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value);
    const explicit=profile.studiomateMemberId;
    const ids=[explicit,profile.memberId,memberId].filter(valid).map(String);
    result.nativeMemberId=(explicit!=null&&!valid(explicit))||new Set(ids).size!==1?null:ids[0];
    return result;
  }
  result.tickets=(Array.isArray(profile.activeTickets)?profile.activeTickets:[]).slice(0,30).map(mapTicket);
  result.holds=(Array.isArray(profile.ticketStatusSummary?.holdingTickets)?profile.ticketStatusSummary.holdingTickets:[]).slice(0,30).map(mapTicket);
  const ids=[...new Set([memberId,profile.memberId,profile.studiomateMemberId].filter(value=>typeof value==='string'||typeof value==='number').map(String))];
  const bookings=await db.collection('bookings').where('memberId','in',ids).limit(51).get();
  result.coverage.bookingsLimited=bookings.size===51;
  const unique=new Map<string,any>();
  for(const doc of bookings.docs){const booking=doc.data();
    if(booking.studioId!==row.studioId||!ids.includes(String(booking.memberId))||booking.memberPhone&&phone(booking.memberPhone)!==normalized)continue;
    const entry={bookingId:doc.id,lectureDate:clean(booking.lectureDate),startTime:clean(booking.startTime),staffName:clean(booking.staffName),title:clean(booking.lectureTitle||booking.title),status:clean(booking.appStatus||booking.sourceStatus)};
    const key=booking.canonicalBookingKey||JSON.stringify([entry.lectureDate,entry.startTime,booking.staffId||entry.staffName,entry.title,entry.status]);
    const old=unique.get(key);if(!old||old.bookingId.startsWith('excel_')&&!entry.bookingId.startsWith('excel_'))unique.set(key,entry);
  }
  result.bookings=[...unique.values()].sort((a,b)=>(b.lectureDate+b.startTime).localeCompare(a.lectureDate+a.startTime)).slice(0,30);
  result.coverage.displayedBookings=result.bookings.length;
  return result;
}

export async function readInquiryMemberLink(db:any,row:Record<string,any>,now:number){
  const context=await readInquiryMemberContext(db,row,now,true);
  const status=context.status==='unique_stored_match'?(context.nativeMemberId?'ready':'incomplete'):context.status;
  return {status,source:'memberProfiles',observedAt:context.observedAt,
    ...(status==='ready'?{url:`https://arcpilates.studiomate.kr/users/detail?id=${context.nativeMemberId}`,syncedAt:context.profile.syncedAt}:{})};
}
