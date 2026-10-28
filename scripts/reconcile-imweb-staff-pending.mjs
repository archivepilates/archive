import { pathToFileURL } from 'node:url';
import { runStaffVideoSync } from './lib/imweb-staff-video-sync.mjs';

export async function reconcileStaffPending(args, { run=runStaffVideoSync }={}) {
  const option=name=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
  const memberCode=option('member-code'), pendingDigest=option('pending-digest'), approvalRef=option('approval-ref');
  if(new Set(args).size!==args.length || args.length!==(args.includes('--apply')?4:3)
    || !/^m[0-9a-f]+$/.test(memberCode||'') || !/^[a-f0-9]{64}$/.test(pendingDigest||'')
    || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,160}$/.test(approvalRef||'')
    || args.some(arg=>!['--apply',`--member-code=${memberCode}`,`--pending-digest=${pendingDigest}`,`--approval-ref=${approvalRef}`].includes(arg))) {
    throw Error('Exact member, pending digest and operator approval reference required');
  }
  return run({apply:args.includes('--apply'),onlyMemberCode:memberCode,
    reconcilePending:{memberCode,pendingDigest,approvalRef}});
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  reconcileStaffPending(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(JSON.stringify({ok:false,code:error.code||'STAFF_RECONCILIATION_FAILED',reason:error.message}));process.exitCode=1;});
}
