import { pathToFileURL } from 'node:url';
import { runStaffVideoSync, STAFF_VIDEO_DIR, STAFF_VIDEO_LOCK_BUSY } from './lib/imweb-staff-video-sync.mjs';
import { observeAutomationRun, sendAutomationHealthEmail } from './lib/automation-failure-notifications.mjs';

const healthNotify=event=>sendAutomationHealthEmail({area:'스텝 영상권한',title:'자동 연결',link:'https://archive-pilates.web.app/core/rules/'},event);

export async function runStaffVideoJob({args=[],directory=STAFF_VIDEO_DIR,run=runStaffVideoSync,
  observe=observeAutomationRun,notify=healthNotify,now=()=>new Date().toISOString()}={}) {
  if(args.some((arg,i)=>!['--apply','--member-code'].includes(arg)&&args[i-1]!=='--member-code'))throw Error('Unsupported staff sync argument');
  const onlyMemberCode=args.includes('--member-code')?args[args.indexOf('--member-code')+1]:'';
  if(onlyMemberCode&&!/^m[0-9a-f]+$/.test(onlyMemberCode))throw Error('Invalid member code');
  const apply=args.includes('--apply');
  const runStartedAt=now();
  try {
    const result=await run({apply,onlyMemberCode,directory});
    if(result.ok!==true||result.skipped||result.mode!==(apply?'apply':'dry_run')
      ||apply&&(result.accessVerified!==true||result.verification?.ok!==true)
      ||!Number.isFinite(Date.parse(result.finishedAt))) {
      throw Object.assign(Error('Staff video run did not complete'),{code:'STAFF_VIDEO_RUN_INCOMPLETE'});
    }
    if(apply&&!onlyMemberCode)await observe(directory,{ok:true,runFinishedAt:result.finishedAt},notify,now());
    return {...result,exitCode:0};
  } catch(error) {
    const runFailedAt=now();
    if(error.code===STAFF_VIDEO_LOCK_BUSY&&error.phase==='lock_acquisition') {
      let health;
      try {
        if(apply&&!onlyMemberCode)health=await observe(directory,
          {lockWait:true,runStartedAt,errorCode:STAFF_VIDEO_LOCK_BUSY},notify,now());
      } catch {
        return {ok:false,errorCode:'STAFF_VIDEO_HEALTH_FAILED',exitCode:1};
      }
      return {ok:false,status:health?.lockWaitEscalated?'blocked':'deferred',skipped:true,
        errorCode:health?.lockWaitEscalated?health.errorCode:STAFF_VIDEO_LOCK_BUSY,
        reason:'아임웹 회원그룹 잠금 대기; 기존 정기 실행에서 재확인합니다.',exitCode:health?.lockWaitEscalated?1:0};
    }
    if(apply&&!onlyMemberCode) {
      try{await observe(directory,{ok:false,errorCode:error.code||'STAFF_VIDEO_SYNC_FAILED',runFailedAt},notify,now());}catch{console.error('스텝 영상권한 오류 알림 확인 실패');}
    }
    return {ok:false,errorCode:error.code||'STAFF_VIDEO_SYNC_FAILED',
      reason:error.code==='ERR_ASSERTION'?'Staff permission validation failed':String(error.message).slice(0,180),exitCode:1};
  }
}
export async function main(args=process.argv.slice(2)) {
  const result=await runStaffVideoJob({args});
  (result.exitCode?console.error:console.log)(JSON.stringify(result));
  process.exitCode=result.exitCode;
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
