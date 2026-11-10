import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {makeManifest,assertManifest} from './release-e261017-classroom.mjs';

const BASE='23bccca1c282630138e0c8bd6252960b93be2fd6', SITE='archive-pilates-core';
const expectedSources={
  '/assets/member-inquiries.js':'870311d52b4165d71af5e6a9de67a50473f55bcf89e69e190ac1db1c3a1fe932',
  '/rules/index.html':'48e3f8bdcdb7dd03d8aa8b632526887f35903043b0782abe0d2f4d2e01eb8fb0',
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validVersion=value=>/^sites\/archive-pilates-core\/versions\/[^/?#]+$/.test(value||'');
const validRelease=value=>/^sites\/archive-pilates-core\/releases\/[^/?#]+$/.test(value||'');
export function assigneeReleaseManifest(files,replacements){
  if(!isDeepStrictEqual(Object.keys(replacements).sort(),Object.keys(expectedSources).sort()))throw Error('Exactly the two reviewed paths are required');
  let manifest=Object.fromEntries(files.map(file=>[file.path,file.hash]));
  for(const [resource,hash] of Object.entries(replacements)){
    if(manifest[resource]===hash)throw Error('No-op release requires reconciliation');
    manifest=makeManifest(Object.entries(manifest).map(([path,hash])=>({path,hash})),hash,resource);
  }
  if(files.length!==Object.keys(manifest).length)throw Error('Duplicate baseline paths');
  return manifest;
}
export async function releaseAssignees(args){
  const expected=args.find(arg=>arg.startsWith('--expected-version='))?.slice(19),apply=args.includes('--apply');
  if(!validVersion(expected)||new Set(args).size!==args.length||args.some(arg=>arg!=='--apply'&&arg!==`--expected-version=${expected}`))throw Error('Exact baseline version required');
  const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const root=git(['rev-parse','--show-toplevel']),commit=git(['rev-parse','HEAD']);
  const clean=()=>{if(git(['branch','--show-current'])!=='main'||git(['status','--porcelain'])||git(['rev-parse','HEAD'])!==commit||git(['rev-parse','origin/main'])!==commit)throw Error('Clean aligned main required');};
  if(apply){git(['fetch','origin','main']);clean();}
  const sources=Object.fromEntries(Object.keys(expectedSources).map(resource=>[resource,fs.readFileSync(path.join(root,'core',resource))]));
  for(const resource of Object.keys(sources))if(sha(sources[resource])!==expectedSources[resource])throw Error('Reviewed source changed');
  const prior=Object.fromEntries(Object.keys(sources).map(resource=>[resource,sha(execFileSync('git',['show',`${BASE}:core${resource}`]))]));
  const token=execFileSync('gcloud',['auth','print-access-token','--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const request=async(resource,method='GET',body)=>{const response=await fetch('https://firebasehosting.googleapis.com/v1beta1/'+resource,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`Hosting ${method} ${response.status}`);return response.json();};
  const latest=async()=>(await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
  const filesFor=async version=>{let cursor;const files=[],seen=new Set();do{const result=await request(`${version}/files?pageSize=1000${cursor?'&pageToken='+encodeURIComponent(cursor):''}`);if(!Array.isArray(result.files))throw Error('Incomplete baseline files');files.push(...result.files);cursor=result.nextPageToken;if(cursor){if(typeof cursor!=='string'||seen.has(cursor))throw Error('Invalid cursor');seen.add(cursor);}}while(cursor);return files;};
  const verifyLive=async hashes=>{for(const [resource,hash]of Object.entries(hashes))for(const origin of ['https://core.archivepilates.com','https://archive-pilates-core.web.app']){const r=await fetch(origin+resource,{cache:'no-store',signal:AbortSignal.timeout(60000)});if(!r.ok||sha(Buffer.from(await r.arrayBuffer()))!==hash)throw Error('Live content mismatch; no replay');}};
  const baseline=await latest();if(!validRelease(baseline?.name)||baseline?.version?.name!==expected)throw Error('Baseline changed');
  await verifyLive(prior);
  const version=await request(expected),files=await filesFor(expected);
  if(!version.config||version.name!==expected)throw Error('Baseline config missing');
  const compressed=Object.fromEntries(Object.entries(sources).map(([resource,bytes])=>[resource,gzipSync(bytes,{level:9})]));
  const hashes=Object.fromEntries(Object.entries(compressed).map(([resource,bytes])=>[resource,sha(bytes)]));
  const manifest=assigneeReleaseManifest(files,hashes);
  const evidence={site:SITE,sourceCommit:commit,baselineVersion:expected,baselineRelease:baseline.name,changedPaths:Object.keys(sources),fileCount:files.length,unchangedFileCount:files.length-2,sourceHashes:expectedSources,bankAction:false,memberDispatch:false,mode:apply?'apply':'plan'};
  if(!apply)return evidence;
  const dir=path.join(os.homedir(),'ArchiveIN/operations/member-inquiry-current-assignees-20261110');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.mode&0o077||stat.uid!==process.getuid())throw Error('Private receipt directory required');
  const receipt=path.join(dir,'hosting-release.json');if(fs.existsSync(receipt))throw Error('Prior intent requires reconciliation');
  const save=()=>{const fd=fs.openSync(receipt+'.tmp','wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(evidence,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(receipt+'.tmp',receipt);};
  const lock=path.join(os.homedir(),`ArchiveIN/automation/locks/firebase-hosting-${SITE}.lock`),fd=fs.openSync(lock,'wx',0o600);
  try{
    const unchanged=async()=>{clean();const now=await latest();if(now?.name!==baseline.name||now?.version?.name!==expected)throw Error('Concurrent release');for(const resource of Object.keys(sources))if(sha(fs.readFileSync(path.join(root,'core',resource)))!==expectedSources[resource])throw Error('Source changed');};
    if(fs.existsSync(receipt))throw Error('Prior intent appeared');await unchanged();evidence.versionIntentAt=new Date().toISOString();save();
    const created=await request(`sites/${SITE}/versions`,'POST',{config:version.config});if(!validVersion(created.name)||created.name===expected)throw Error('Invalid created version');evidence.createdVersion=created.name;save();
    const result=await request(`${created.name}:populateFiles`,'POST',{files:manifest}),allowed=new Map(Object.entries(hashes).map(([resource,hash])=>[hash,compressed[resource]]));
    const needed=result.uploadRequiredHashes??[];if(!Array.isArray(needed)||needed.some(hash=>!allowed.has(hash)))throw Error('Unexpected required upload');
    for(const hash of new Set(needed)){const url=new URL(result.uploadUrl);if(url.origin!=='https://upload-firebasehosting.googleapis.com'||url.username||url.password||url.search||url.hash)throw Error('Unexpected upload host');const r=await fetch(url.href+'/'+hash,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:allowed.get(hash),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Upload failed; no replay');}
    assertManifest(await filesFor(created.name),manifest);if(!isDeepStrictEqual((await request(created.name)).config,version.config))throw Error('Config changed');
    await unchanged();await request(created.name+'?updateMask=status','PATCH',{status:'FINALIZED'});await unchanged();evidence.releaseIntentAt=new Date().toISOString();save();
    const released=await request(`sites/${SITE}/releases?versionName=${created.name}`,'POST',{message:`Current inquiry assignees only (${commit.slice(0,12)})`});if(!validRelease(released.name))throw Error('Invalid release receipt');evidence.releaseName=released.name;save();
    const current=await latest();if(current?.name!==released.name||current?.version?.name!==created.name)throw Error('Release outcome requires reconciliation');
    await verifyLive(expectedSources);assertManifest(await filesFor(created.name),manifest);if(!isDeepStrictEqual((await request(created.name)).config,version.config))throw Error('Final config changed');
    evidence.verifiedAt=new Date().toISOString();evidence.unchangedFilesVerified=true;save();return evidence;
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)releaseAssignees(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
