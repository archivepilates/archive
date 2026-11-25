import {createPrivateMemberPilot} from './index.mjs';

const memberId=value=>typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value);
const fullPhone=value=>typeof value==='string'&&/^01[016789]\d{7,8}$/.test(value);
const name=value=>typeof value==='string'&&value.length>0&&value.length<=120&&value===value.normalize('NFC').trim();
const day=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))
  &&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const exactTarget=target=>target&&Object.keys(target).sort().join(',')==='memberId,name,phone'
  &&memberId(target.memberId)&&name(target.name)&&fullPhone(target.phone);
const readback=(raw,target)=>raw?.memberId===target.memberId&&raw?.name===target.name&&raw?.phone===target.phone;
const meta=raw=>({memberId:raw.memberId,name:raw.name,phone:raw.phone,checkedAt:raw.checkedAt});

// This is an in-process capability, not an MCP tool or an HTTP endpoint.
// Only the authenticated lookup service supplies the verified target.
export function createInternalStudioMateReader(admin){
  if(typeof admin?.getOverview!=='function'||typeof admin?.getBookings!=='function')throw Error('StudioMate read adapter unavailable');
  return Object.freeze({
    async getOverview(target,signal){
      if(!exactTarget(target)||!signal||signal.aborted)return null;
      const raw=await admin.getOverview(target,signal);
      if(signal.aborted||!readback(raw,target)||raw.coverage!=='current_ticket_cards'
        ||!Array.isArray(raw.tickets)||raw.tickets.length>100)return null;
      return {...meta(raw),coverage:raw.coverage,tickets:raw.tickets.map(t=>({
        name:t?.name,type:t?.type,status:t?.status,availableFromDate:t?.availableFromDate,
        expiresOn:t?.expiresOn,remainingCount:t?.remainingCount,reservableCount:t?.reservableCount
      }))};
    },
    async getBookings(target,range,signal){
      if(!exactTarget(target)||!signal||signal.aborted||!day(range?.startDate)||!day(range?.endDate))return null;
      const span=Date.parse(range.endDate)-Date.parse(range.startDate);
      if(span<0||span>30*86400_000)return null;
      const raw=await admin.getBookings(target,range,signal), coverage=raw?.coverage;
      if(signal.aborted||!readback(raw,target)||coverage?.kind!=='native_member_booking_history'
        ||coverage.complete!==true||coverage.traversalComplete!==true
        ||coverage.requestedRange?.startDate!==range.startDate||coverage.requestedRange?.endDate!==range.endDate
        ||!Array.isArray(raw.records)||raw.records.length>2000)return null;
      return {...meta(raw),coverage:{kind:coverage.kind,complete:true,traversalComplete:true,requestedRange:{...range}},
        records:raw.records.map(row=>({lectureDate:row?.lectureDate,lessonType:row?.lessonType,sourceStatus:row?.sourceStatus}))};
    }
  });
}

export async function createInternalStudioMatePilot({enabled=false,makeAdminReader,...options}={}){
  if(enabled!==true)return createPrivateMemberPilot();
  const open=makeAdminReader??(await import('../archivepilates-mcp/src/live-browser.mjs')).createLiveReader;
  const admin=await open();
  try{
    const pilot=createPrivateMemberPilot({...options,enabled:true,nativeReader:createInternalStudioMateReader(admin)});
    return Object.freeze({...pilot,async close(){try{pilot.close();}finally{await admin.close?.();}}});
  }catch(error){await admin?.close?.();throw error;}
}
