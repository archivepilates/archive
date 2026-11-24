import { createHash, createHmac } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const area = '/Users/archivepilates/archive-automation/operations/2026-11-20-supabase-history-pilot';
const api = 'https://api.studiomate.kr';
const { readInterval } = await import(area + '/october-global-booking-recheck.mjs');
const { parseExcel } = await import(area + '/history-backfill-source.mjs');
const { normalizedDay } = await import(area + '/october-global-booking-probe.mjs');
const { newBrowser } = await import(area + '/recheck-october-held.mjs');
const { readPrivateKey } = await import(area + '/reconcile-october-booking-pass.mjs');
const [dirArg, ...ranges] = process.argv.slice(2);
const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',dateStyle:'short'}).format(new Date());
const day = /^20\d\d-\d\d-\d\d$/;
const id = value => /^[1-9]\d{0,15}$/.test(String(value ?? ''));
const states = new Set(['attendance','absence','noshow','cancel','booked','booking_confirmed','booking_waiting','wait_cancel']);
const sha = data => createHash('sha256').update(data).digest('hex');
const group = (list,key) => {
  const result=new Map();
  for(const row of list) {
    const k=key(row), values=result.get(k)??[];
    values.push(row);result.set(k,values);
  }
  return result;
};
const match = row => JSON.stringify([row.day,row.start,row.end,row.staff,row.kind??null,row.status??null,
  row.name,row.phone,row.className,row.roomName,row.passTitle]);
const check = (value,code) => { if(!value)throw Object.assign(new Error(code),{code}); };

async function writePrivate(path,data) {
  const f=await open(path,'wx',0o600);
  try{await f.writeFile(data);await f.sync();}finally{await f.close();}
}

function validMemberBinding(row) {
  const lecture=row?.lecture, member=row?.member;
  return id(row?.id)&&String(row.studio_id)==='5330'&&id(member?.id)&&
    (row.member_id==null || String(row.member_id)===String(member.id))&&
    id(lecture?.id)&&String(row.lecture_id)===String(lecture.id)&&
    (lecture.studio_id==null||String(lecture.studio_id)==='5330')&&row.deleted_at==null;
}

async function collect(from,through,key) {
  return newBrowser(async page => {
    const rawSource=new Map(), readings=[];
    const receive = response => {
      const u=new URL(response.url());
      if(response.request().method()!=='GET'||u.origin!==api||u.pathname!=='/staff/booking'||
         normalizedDay(u.searchParams.get('start_date'))!==from||
         normalizedDay(u.searchParams.get('end_date'))!==through)return;
      readings.push((async()=>{
        check(response.ok() && !await response.finished(),'NATIVE_RESERVATION_FETCH_FAILED');
        const raw=await response.json();
        check(Array.isArray(raw.bookings?.data),'NATIVE_RESERVATION_UNAVAILABLE');
        for(const r of raw.bookings.data) {
          check(id(r.id),'NATIVE_RESERVATION_ID_INVALID');
          const projected={ok:validMemberBinding(r),member:String(r?.member?.id??'')}, prior=rawSource.get(String(r.id));
          check(!prior||JSON.stringify(prior)===JSON.stringify(projected),'NATIVE_RESERVATION_IDENTITY_CHANGED');
          rawSource.set(String(r.id),projected);
        }
      })().then(()=>null,error=>error));
    };
    page.on('response',receive);
    let native;
    try{
      native=await readInterval(page,from,through,'lesson-history');
      const done=await Promise.all(readings);
      if(done.some(Boolean))throw done.find(Boolean);
    } finally {page.off('response',receive);}
    check(native.rows.length===rawSource.size,'NATIVE_IDENTITY_COVERAGE_UNVERIFIED');
    const button=page.getByRole('button',{name:/엑셀\s*다운로드/u});
    check(await button.count()===1,'EXCEL_CONTROL_NOT_VERIFIED');
    const waiting=page.waitForEvent('download',{timeout:20000});
    await button.click();
    const dl=await waiting;
    check(/\.xlsx$/i.test(dl.suggestedFilename())&&!await dl.failure(),'NATIVE_EXCEL_FAILED');
    const excelBytes=await readFile(await dl.path()), excel=parseExcel(excelBytes,from,through);
    check(excel.length===native.rows.length,'NATIVE_EXCEL_ROW_COUNT_MISMATCH');
    const eGroups=group(excel,match), nGroups=group(native.rows,match);
    const body=[], held={};
    const hold=(reason,count=1)=>{held[reason]=(held[reason]??0)+count;};
    const hmac=(kind,value)=>createHmac('sha256',key).update('archive-ops:studiomate:5330:'+kind+':'+value).digest('hex');
    for(const [value, originals] of eGroups) {
      const rows=nGroups.get(value)??[];
      if(rows.length!==originals.length) {hold('excel_web_identity_not_reconciled',originals.length);continue;}
      for(const row of rows) {
        const link=rawSource.get(row.bookingId);
        if(!link?.ok||link.member!==row.memberId){hold('native_member_not_verified');continue;}
        if(!states.has(row.status)||!row.kind||!/^\d\d:\d\d$/.test(row.start)||!/^\d\d:\d\d$/.test(row.end)||
           row.end<=row.start){hold('status_type_or_time_unverified');continue;}
        body.push({key:hmac('booking',row.bookingId),member_key:hmac('member',row.memberId),service_day:row.day,
          start_time:row.start,end_time:row.end,lesson_type:row.kind,status:row.status});
      }
    }
    check(body.length+Object.values(held).reduce((a,b)=>a+b,0)===excel.length,'SOURCE_COUNT_MISMATCH');
    body.sort((a,b)=>a.key.localeCompare(b.key));
    const payload=JSON.stringify(body);
    return {excelBytes,payload,manifest:{from,through,kind:'reservation_excel',sourceRows:excel.length,
      acceptedRows:body.length,observedAt:new Date().toISOString(),sourceSha:sha(excelBytes),payloadSha:sha(payload),held}};
  });
}

const dir=resolve(dirArg??'');
const d=await lstat(dir);
check(d.isDirectory()&&d.uid===process.getuid()&&!(d.mode&0o077)&&ranges.length>0&&ranges.length<=8,'PRIVATE_OUTPUT_SCOPE');
const key=await readPrivateKey();
try {
  for(const interval of ranges) {
    const [from,through]=interval.split(':');
    try{
      check(day.test(from)&&day.test(through)&&from.slice(0,7)===through.slice(0,7)&&from<=through&&
        from>='2026-05-27'&&through<=today,'BAD_WINDOW');
      const {excelBytes,payload,manifest}=await collect(from,through,key);
      check(manifest.acceptedRows>0,'NO_VERIFIED_RECENT_ROWS');
      await writePrivate(join(dir,from+'.source.xlsx'),excelBytes);
      await writePrivate(join(dir,from+'.payload.json'),payload);
      await writePrivate(join(dir,from+'.manifest.json'),JSON.stringify(manifest)+'\n');
      console.log(JSON.stringify({summary:manifest}));
    }catch(error){
      console.log(JSON.stringify({from,through,error:/^[A-Z_]{3,65}$/.test(error?.code??'')?error.code:error?.name??'SOURCE_UNVERIFIED'}));
      process.exitCode=1;
    }
  }
} finally { key.fill(0); }
