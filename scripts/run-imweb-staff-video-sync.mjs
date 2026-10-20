import { pathToFileURL } from 'node:url';
import { runStaffVideoSync, STAFF_VIDEO_DIR } from './lib/imweb-staff-video-sync.mjs';
import { observeAutomationRun, sendAutomationHealthEmail } from './lib/automation-failure-notifications.mjs';

export async function main(args=process.argv.slice(2)) {
  if(args.some((arg,i)=>!['--apply','--member-code'].includes(arg)&&args[i-1]!=='--member-code'))throw Error('Unsupported staff sync argument');
  const onlyMemberCode=args.includes('--member-code')?args[args.indexOf('--member-code')+1]:'';
  if(onlyMemberCode&&!/^m[0-9a-f]+$/.test(onlyMemberCode))throw Error('Invalid member code');
  const apply=args.includes('--apply');
  const notify=event=>sendAutomationHealthEmail({area:'스텝 영상권한',title:'자동 연결',link:'https://archive-pilates.web.app/core/rules/'},event);
  try {
    const result=await runStaffVideoSync({apply,onlyMemberCode});
    if(apply&&!onlyMemberCode)await observeAutomationRun(STAFF_VIDEO_DIR,{ok:true,runFinishedAt:result.finishedAt},notify);
    console.log(JSON.stringify(result));return result;
  } catch(error) {
    if(apply&&!onlyMemberCode) {
      try{await observeAutomationRun(STAFF_VIDEO_DIR,{ok:false,errorCode:error.code||'STAFF_VIDEO_SYNC_FAILED'},notify);}catch{console.error('스텝 영상권한 오류 알림 확인 실패');}
    }
    console.error(JSON.stringify({ok:false,errorCode:error.code||'STAFF_VIDEO_SYNC_FAILED',
      reason:error.code==='ERR_ASSERTION'?'Staff permission validation failed':String(error.message).slice(0,180)}));
    process.exitCode=1;return {ok:false,errorCode:error.code||'STAFF_VIDEO_SYNC_FAILED'};
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
