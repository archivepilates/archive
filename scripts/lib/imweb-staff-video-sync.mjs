import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { STAFF_GRADE, STAFF_GROUP, SITE, UNIT, videoGroups, planStaffGroups,
  protectedPurchaseGroups, assertMemberPreserved } from './imweb-staff-video-policy.mjs';
import { acquireStudioMateBrowserLock } from './studiomate-browser-lock.mjs';
import { imwebRequestFailure } from './imweb-read-failure.mjs';
import { readStudentShareLedgers, protectedStudentShareGroups, STUDENT_SHARE_SOURCES } from './imweb-student-share-policy.mjs';

export const STAFF_VIDEO_POLICY = 'imweb-staff-video-v1';
export const STAFF_VIDEO_DIR = path.join(os.homedir(), 'ArchiveIN/automation/imweb-staff-video');
export const MEMBER_GROUP_LOCK = path.join(os.homedir(), 'ArchiveIN/automation/locks/imweb-member-groups.lock');
export const STAFF_VIDEO_LOCK_BUSY = 'IMWEB_MEMBER_GROUPS_BUSY';
const stamp = () => new Date().toISOString();
const sameGroups = (a,b) => isDeepStrictEqual([...a].sort(),[...b].sort());
const memberHash = member => createHash('sha256').update(JSON.stringify(Object.fromEntries(
  Object.entries(member).filter(([key])=>key!=='group').sort(([a],[b])=>a.localeCompare(b))))).digest('hex');

export function staffImweb(args, { execute = execFileSync } = {}) {
  try {
    const result=JSON.parse(execute(path.join(os.homedir(),'.local/bin/imweb'),
      ['--profile','default','--output','json',...args], {encoding:'utf8',timeout:45000,
        maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));
    if (!result || typeof result!=='object' || Array.isArray(result) || result.error
      || result.statusCode!==undefined && result.statusCode!==200) throw Error('Invalid Imweb envelope');
    return result;
  } catch(error) {
    throw imwebRequestFailure(error,{readOnly:!args.includes('--yes'),operation:args[0]==='order'?'order_list':'other_request'});
  }
}

export function staffMembers(run) {
  const members=new Map();let cursor;const cursors=new Set();
  for(let page=0;page<100;page++) {
    const {data}=run(['member','list','--unit-code',UNIT,'--limit','50',...(cursor?['--cursor',cursor]:[])]);
    if(!Array.isArray(data?.list)||typeof data.hasNext!=='boolean')throw Error('Incomplete member source');
    for(const member of data.list) {
      if(member.siteCode!==SITE||member.unitCode!==UNIT||typeof member.uid!=='string'
        ||!/^m[0-9a-f]+$/.test(member.memberCode))throw Error('Member source scope mismatch');
      if(members.has(member.memberCode))throw Error('Duplicate member identity');
      members.set(member.memberCode,member);
    }
    if(!data.hasNext)return [...members.values()];
    if(!data.nextCursor||cursors.has(data.nextCursor))throw Error('Incomplete member cursor');
    cursor=data.nextCursor;cursors.add(cursor);
  }
  throw Error('Member pagination exceeded safety bound');
}

export function staffPages(run,args,maxPages=50) {
  const all=[];let total;const orderIds=new Set();
  for(let page=1;page<=maxPages;page++) {
    const {data}=run([...args,'--page',String(page),'--limit','100']);
    if(!Array.isArray(data?.list)||!Number.isInteger(data.totalCount)||!Number.isInteger(data.totalPage)
      ||data.currentPage!==page)throw Error('Invalid paginated source');
    if(total!==undefined&&total!==data.totalCount)throw Error('Source changed during scan');
    if(args[0]==='order')for(const order of data.list) {
      const id=order?.orderNo;
      if(!(typeof id==='number'&&Number.isSafeInteger(id)&&id>0||typeof id==='string'&&/^[0-9]+$/.test(id))
        ||orderIds.has(String(id)))throw Error('Invalid or duplicate canonical order identity');
      orderIds.add(String(id));
    }
    total=data.totalCount;all.push(...data.list);
    if(page>=data.totalPage) {
      if(all.length!==total)throw Error('Incomplete paginated source');
      return all;
    }
  }
  throw Error('Source pagination exceeded safety bound');
}

function verifyContext(run) {
  let c=run(['config','context']);
  if(c.effective_profile==='default'&&c.resolved_profile?.site_code===SITE&&c.resolved_profile?.unit_code===UNIT
    &&(c.token?.should_refresh===true||['expired','expiring'].includes(c.token?.status))) {
    run(['auth','refresh']);c=run(['config','context']);
  }
  if(c.effective_profile!=='default'||c.resolved_profile?.site_code!==SITE||c.resolved_profile?.unit_code!==UNIT
    ||!c.remote_context?.write_ready||c.token?.status!=='healthy')throw Error('Imweb profile/auth mismatch');
}

export function reconcileStaffVideos(state,{run=staffImweb,apply=false,save=()=>{},now=Date.now(),onlyMemberCode='',
  readStudentShares=readStudentShareLedgers}={}) {
  if(!apply)state=structuredClone(state);
  if(state.policyVersion!==STAFF_VIDEO_POLICY||state.approved!==true)throw Error('Approved staff policy required');
  if(!state.members||Array.isArray(state.members)||typeof state.members!=='object')throw Error('Ownership members map missing or invalid');
  verifyContext(run);
  const groups=staffPages(run,['member','groups','list']);
  if(groups.filter(g=>g.siteGroupCode===STAFF_GROUP&&g.title==='ARCHIVE STAFF').length!==1)throw Error('Staff group mismatch');
  const grades=staffPages(run,['member','grades','list']);
  if(grades.filter(g=>g.memberGradeCode===STAFF_GRADE&&g.title==='스텝'&&g.useAutoGrade==='N').length!==1)throw Error('Staff grade mismatch');
  const catalog=videoGroups(groups);
  if(catalog.length<30)throw Error('Unexpectedly incomplete video catalog');
  const members=staffMembers(run);const index=new Map(members.map(m=>[m.memberCode,m]));
  const targets=[...new Set([...members.filter(m=>m.grade===STAFF_GRADE).map(m=>m.memberCode),...Object.keys(state.members)])]
    .filter(code=>!onlyMemberCode||code===onlyMemberCode).sort();
  if(onlyMemberCode&&!targets.includes(onlyMemberCode))throw Error('Requested member not eligible/tracked');
  const readMember=code=>{
    const source=index.get(code);if(!source)throw Error('Tracked member missing; manual review required');
    const member=run(['member','get',source.uid,'--unit-code',UNIT]).data;
    if(member?.memberCode!==code||member.uid!==source.uid||member.siteCode!==SITE||member.unitCode!==UNIT)throw Error('Member identity mismatch');
    if(member.grade!=null&&typeof member.grade!=='string')throw Error('Ambiguous native member grade; no group change');
    return member;
  };
  let orders;const prepared=[];
  // Complete every source/preflight check before the first member write.
  for(const code of targets) {
    const before=readMember(code);const entry=state.members[code]||{memberCode:code,uid:before.uid,
      baselineGroups:[...before.group],ownedAddedGroups:[],firstObservedAt:new Date(now).toISOString()};
    if(entry.memberCode!==code||entry.uid!==before.uid)throw Error('Ownership ledger identity mismatch');
    if(entry.pending) {
      if(memberHash(before)!==entry.pending.memberHash||!sameGroups(before.group,entry.pending.afterGroups))throw Error('Unresolved group update; no automatic write retry');
      entry.ownedAddedGroups=entry.pending.nextManagedGroups;delete entry.pending;
      entry.lastVerifiedAt=stamp();if(apply){state.members[code]=entry;save(state);}
    }
    let protectedGroups=[];
    if(before.grade!==STAFF_GRADE&&(entry.ownedAddedGroups||[]).some(g=>before.group.includes(g))) {
      orders??=staffPages(run,['order','list','--unit-code',UNIT]);
      protectedGroups=[...new Set([...protectedPurchaseGroups(orders,code,now),
        ...protectedStudentShareGroups(readStudentShares(),code,now)])].sort();
      const unknownShareGroups=groups.filter(group=>/^PRIVATE LESSON /.test(group.title)
        &&!STUDENT_SHARE_SOURCES.some(source=>source.groupCode===group.siteGroupCode)
        &&entry.ownedAddedGroups.includes(group.siteGroupCode)&&before.group.includes(group.siteGroupCode)
        &&!protectedGroups.includes(group.siteGroupCode));
      if(unknownShareGroups.length)throw Error('Unregistered student-share source; manual entitlement review required');
    }
    const plan=planStaffGroups(before,entry,catalog,protectedGroups);
    if(plan.afterGroups.length>50)throw Error('Member group hard limit exceeded; no quota override');
    let dry;
    if(plan.action==='update') {
      dry=run(['member','update','groups',before.uid,'--data',JSON.stringify({unitCode:UNIT,groupCodes:plan.afterGroups}),'--dry-run']);
      if(!dry.confirmation_token||dry.body?.unitCode!==UNIT||!sameGroups(dry.body?.groupCodes||[],plan.afterGroups))throw Error('Unexpected group dry-run');
      if(dry.safety?.bulk_confirmation_required_for_execute&&!dry.safety?.bulk_confirmation_token&&!dry.bulk_confirmation_token)throw Error('Missing bulk confirmation token');
    }
    prepared.push({code,before,entry,plan,dry,protectedGroups});
  }
  const outcomes=[];
  for(const {code,before,entry,plan,dry,protectedGroups} of prepared) {
    outcomes.push({memberCode:code,action:plan.action,staff:before.grade===STAFF_GRADE,
      added:plan.addedGroups.length,removed:plan.removedGroups.length,groupsAfter:plan.afterGroups.length});
    if(!apply)continue;
    if(plan.action==='update') {
      if(before.grade!==STAFF_GRADE) {
        const checkedAt=Date.now();
        const latestProtected=[...new Set([
          ...protectedPurchaseGroups(staffPages(run,['order','list','--unit-code',UNIT]),code,checkedAt),
          ...protectedStudentShareGroups(readStudentShares(),code,checkedAt)])].sort();
        if(!sameGroups(protectedGroups,latestProtected))throw Error('Purchase/student-share protection changed; no group removal');
      }
      const fresh=readMember(code);assertMemberPreserved(before,fresh,plan.beforeGroups);
      entry.pending={status:'intent',at:stamp(),memberHash:memberHash(before),beforeGroups:plan.beforeGroups,
        afterGroups:plan.afterGroups,nextManagedGroups:plan.nextManagedGroups};
      state.members[code]=entry;save(state);
      const args=['member','update','groups',before.uid,'--data',JSON.stringify({unitCode:UNIT,groupCodes:plan.afterGroups}),
        '--yes','--confirm-token',dry.confirmation_token];
      if(dry.safety?.bulk_confirmation_required_for_execute)args.push('--bulk-confirm-token',dry.bulk_confirmation_token||dry.safety.bulk_confirmation_token);
      try {
        run(args);
        const after=readMember(code);assertMemberPreserved(before,after,plan.afterGroups);
      } catch(error) {
        entry.pending.status='result_unknown';save(state);
        // Only read back after an uncertain request; never send that write again.
        let after;
        try{after=readMember(code);assertMemberPreserved(before,after,plan.afterGroups);}catch{
          throw Object.assign(Error('Group update/readback unresolved; no automatic retry'),{code:'STAFF_GROUP_RESULT_UNKNOWN'});
        }
      }
      delete entry.pending;
    }
    entry.ownedAddedGroups=plan.nextManagedGroups;entry.lastGrade=before.grade;entry.lastVerifiedAt=stamp();
    entry.status=before.grade===STAFF_GRADE?'staff_active':'staff_removed';
    state.members[code]=entry;save(state);
  }
  const result={ok:true,mode:apply?'apply':'dry_run',catalogGroups:catalog.length,scannedMembers:members.length,
    staffMembers:members.filter(m=>m.grade===STAFF_GRADE).length,outcomes,finishedAt:stamp()};
  if(apply){state.lastRun=result;save(state);}
  return result;
}

export async function runStaffVideoSync({apply=false,onlyMemberCode='',directory=STAFF_VIDEO_DIR,run=staffImweb,
  acquireLock=acquireStudioMateBrowserLock}={}) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  let release;
  try {
    release=await acquireLock({lockPath:MEMBER_GROUP_LOCK,owner:'imweb-staff-video-sync',waitMs:0,staleMs:600000});
  } catch(error) {
    if(error.code!=='STUDIOMATE_BROWSER_BUSY')throw error;
    throw Object.assign(Error('아임웹 회원그룹 변경 작업이 진행 중입니다.'),
      {code:STAFF_VIDEO_LOCK_BUSY,phase:'lock_acquisition'});
  }
  try {
    const config=JSON.parse(fs.readFileSync(path.join(directory,'config.json'),'utf8'));
    if(config.policyVersion!==STAFF_VIDEO_POLICY||config.approved!==true||config.siteCode!==SITE||config.unitCode!==UNIT)throw Error('Staff sync not activated');
    const file=path.join(directory,'state.json');
    if(!fs.existsSync(file))throw Error('Ownership ledger missing; operator review required');
    const state=JSON.parse(fs.readFileSync(file,'utf8'));
    const save=value=>{const temp=`${file}.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);};
    return reconcileStaffVideos(state,{run,apply,save,onlyMemberCode});
  } finally {await release();}
}
