import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runStaffVideoSync } from './lib/imweb-staff-video-sync.mjs';
import { SITE, UNIT } from './lib/imweb-staff-video-policy.mjs';

export function validateVideoReadiness(proof,now=Date.now()) {
  const age=now-Date.parse(proof?.verifiedAt);
  if(proof?.siteCode!==SITE || proof.unitCode!==UNIT || !Number.isFinite(age) || age<0 || age>900000
    || proof.nativePagesPublished!==true || proof.catalogConnectionVerified!==true
    || !Array.isArray(proof.videos) || !proof.videos.length || proof.videos.length>48) throw Error('Fresh media/page/catalog verification required');
  const groups=new Set();
  for(const row of proof.videos) {
    if(!/^[A-Za-z0-9_-]{11}$/.test(row.youtubeId||'') || !/^g[0-9a-f]+$/.test(row.groupCode||'')
      || !/^\/[a-z0-9-]+$/.test(row.watchPath||'') || row.processing!=='succeeded'
      || !['unlisted','public'].includes(row.privacyStatus) || row.playbackVerified!==true
      || row.pageAccessVerified!==true) throw Error('Verified playback and protected page required');
    groups.add(row.groupCode);
  }
  return [...groups].sort();
}

// Upstream upload/page work supplies its fresh private proof, not a webhook body.
export async function completeVideoAccess(proof,{run=runStaffVideoSync,now,clock=Date.now}={}) {
  const current=()=>now??clock();
  const expectedGroupCodes=validateVideoReadiness(proof,current());
  const result=await run({apply:true,expectedGroupCodes});
  if(result.ok!==true || result.accessVerified!==true || result.verification?.ok!==true) throw Error('Video access completion not independently verified');
  validateVideoReadiness(proof,current());
  return {ok:true,status:'staff_access_verified',videoCount:proof.videos.length,
    groupCount:expectedGroupCodes.length,verifiedAt:result.verification.verifiedAt};
}

async function main(args) {
  if(args.length!==1 || !args[0].startsWith('--ready-file=')) throw Error('Use one private --ready-file');
  const file=path.resolve(args[0].slice(13)),stat=fs.lstatSync(file);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid() || stat.mode&0o077) throw Error('Unsafe readiness source');
  const result=await completeVideoAccess(JSON.parse(fs.readFileSync(file,'utf8')));
  const target=path.join(path.dirname(file),'staff-access-complete.json'),temp=`${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,target);
  console.log(JSON.stringify(result));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2))
  .catch(error=>{console.error(JSON.stringify({ok:false,status:'access_pending',code:error.code||'VIDEO_ACCESS_INCOMPLETE',reason:error.message}));process.exitCode=1;});
