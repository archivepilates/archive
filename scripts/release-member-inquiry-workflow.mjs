import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {assertManifest} from './release-e261017-classroom.mjs';

const BASE='7c54d6215aa94765ec22bc1daa64ad89fa7a6da6',NEW='/assets/member-inquiry-guidance.json';
const TARGETS={
  core:{site:'archive-pilates-core',directory:'core',origins:['https://core.archivepilates.com','https://archive-pilates-core.web.app'],sources:{
    '/assets/member-inquiries.js':'ad1cb06aea119b20a6b34cf4e1841144d282827716f413d7f01c643936688cfe',
    '/assets/member-inquiries.css':'f6b9246431ca0e7cca46d632adcdc19cb6d748cedebf6bd73e56192715642681',
    [NEW]:'3f88c8b36e84dace42d4b67bb37f10c019041ab4a038c163b89af5f2f43d6d00',
    '/inquiries/index.html':'84f809e3d0f4362759014b3c865e1499322261b7fe03598f8afdd27f9deda961',
    '/rules/index.html':'3fdcaf62c55427d5f16e3c62ec65c2efcaf32868f0c5b3a65d0d05b86ceb7677',
  }},
  help:{site:'archive-pilates-help',directory:'help',origins:['https://help.archivepilates.com','https://archive-pilates-help.web.app'],sources:{
    '/assets/app.js':'1396f5a85319069d2a875082e7a840d90db2f1c3df1bbaa60e4ce26f3bbedb84',
    '/assets/styles.css':'49b58d639ecb369bff87fa4b6c0246108ad7cfc0fd7a88a533f2f9d5fb34d671',
    [NEW]:'3f88c8b36e84dace42d4b67bb37f10c019041ab4a038c163b89af5f2f43d6d00',
    '/index.html':'9b21018ee93132ee6365f472a329e2215095163145fb1535f80b1ce16c48b7c4',
  }},
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function workflowManifest(files,replacements,target){
  const config=TARGETS[target];if(!config||!isDeepStrictEqual(Object.keys(replacements).sort(),Object.keys(config.sources).sort()))throw Error('Reviewed paths required');
  const manifest={};for(const file of files){if(!/^\//.test(file.path)||!/^[a-f0-9]{64}$/.test(file.hash)||Object.hasOwn(manifest,file.path))throw Error('Invalid baseline');manifest[file.path]=file.hash;}
  if(Object.hasOwn(manifest,NEW))throw Error('Prior guidance asset requires reconciliation');
  for(const [resource,hash]of Object.entries(replacements)){if(!/^[a-f0-9]{64}$/.test(hash)||resource!==NEW&&!Object.hasOwn(manifest,resource)||manifest[resource]===hash)throw Error('Missing or no-op reviewed replacement');manifest[resource]=hash;}
  return manifest;
}
export async function releaseWorkflow(args){
  const target=args.find(arg=>arg.startsWith('--target='))?.slice(9),expected=args.find(arg=>arg.startsWith('--expected-version='))?.slice(19),apply=args.includes('--apply');
  const config=TARGETS[target];
  if(!config||!new RegExp(`^sites/${config.site}/versions/[^/?#]+$`).test(expected||'')||new Set(args).size!==args.length||args.some(arg=>!['--apply',`--target=${target}`,`--expected-version=${expected}`].includes(arg)))throw Error('Exact target and version required');
  const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const root=git(['rev-parse','--show-toplevel']),commit=git(['rev-parse','HEAD']);
  const clean=()=>{if(git(['branch','--show-current'])!=='main'||git(['status','--porcelain'])||git(['rev-parse','HEAD'])!==commit||git(['rev-parse','origin/main'])!==commit)throw Error('Clean aligned main required');};
  if(apply){git(['fetch','origin','main']);clean();}
  const sources=Object.fromEntries(Object.keys(config.sources).map(resource=>[resource,fs.readFileSync(path.join(root,config.directory,resource))]));
  for(const resource of Object.keys(sources))if(sha(sources[resource])!==config.sources[resource])throw Error('Reviewed source changed');
  const before=Object.fromEntries(Object.keys(sources).filter(resource=>resource!==NEW).map(resource=>[resource,sha(execFileSync('git',['show',`${BASE}:${config.directory}${resource}`]))]));
  const token=execFileSync('gcloud',['auth','print-access-token','--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const request=async(resource,method='GET',body)=>{const r=await fetch('https://firebasehosting.googleapis.com/v1beta1/'+resource,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`Hosting ${method} ${r.status}`);return r.json();};
  const latest=async()=>(await request(`sites/${config.site}/releases?pageSize=1`)).releases?.[0];
  const filesFor=async version=>{let cursor;const files=[],seen=new Set();do{const page=await request(`${version}/files?pageSize=1000${cursor?'&pageToken='+encodeURIComponent(cursor):''}`);if(!Array.isArray(page.files))throw Error('Incomplete manifest');files.push(...page.files);cursor=page.nextPageToken;if(cursor){if(typeof cursor!=='string'||seen.has(cursor))throw Error('Invalid cursor');seen.add(cursor);}}while(cursor);return files;};
  const verifyLive=async hashes=>{for(const [resource,hash]of Object.entries(hashes))for(const origin of config.origins){let matched=false;for(let attempt=0;attempt<5;attempt++){const r=await fetch(origin+resource,{cache:'no-store',signal:AbortSignal.timeout(60000)});if(r.ok&&sha(Buffer.from(await r.arrayBuffer()))===hash){matched=true;break;}if(attempt<4)await new Promise(resolve=>setTimeout(resolve,1500));}if(!matched)throw Error('Live mismatch; GET reconciliation only, never replay');}};
  const baseline=await latest();if(baseline?.version?.name!==expected||!baseline?.name?.startsWith(`sites/${config.site}/releases/`))throw Error('Baseline changed');
  await verifyLive(before);const version=await request(expected),files=await filesFor(expected);if(!version.config)throw Error('Missing baseline config');
  const compressed=Object.fromEntries(Object.entries(sources).map(([resource,bytes])=>[resource,gzipSync(bytes,{level:9})]));
  const hashes=Object.fromEntries(Object.entries(compressed).map(([resource,bytes])=>[resource,sha(bytes)]));
  const manifest=workflowManifest(files,hashes,target),evidence={site:config.site,sourceCommit:commit,baselineVersion:expected,baselineRelease:baseline.name,changedPaths:Object.keys(sources),baselineCount:files.length,newCount:Object.keys(manifest).length,unchangedCount:files.length-Object.keys(sources).length+1,sourceHashes:config.sources,mode:apply?'apply':'plan',memberDispatch:false};
  if(!apply)return evidence;
  const dir=path.join(os.homedir(),'ArchiveIN/operations/member-inquiry-workflow-20261110');fs.mkdirSync(dir,{recursive:true,mode:0o700});const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.mode&0o077||stat.uid!==process.getuid())throw Error('Private receipt directory required');
  const receipt=path.join(dir,`${target}-hosting-release.json`);if(fs.existsSync(receipt))throw Error('Prior intent requires reconciliation');
  const save=()=>{const fd=fs.openSync(receipt+'.tmp','wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(evidence,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(receipt+'.tmp',receipt);};
  const lock=path.join(os.homedir(),`ArchiveIN/automation/locks/firebase-hosting-${config.site}.lock`),fd=fs.openSync(lock,'wx',0o600);
  try{
    const unchanged=async()=>{clean();const current=await latest();if(current?.name!==baseline.name||current?.version?.name!==expected)throw Error('Concurrent release');for(const resource of Object.keys(sources))if(sha(fs.readFileSync(path.join(root,config.directory,resource)))!==config.sources[resource])throw Error('Concurrent source');};
    if(fs.existsSync(receipt))throw Error('Prior intent appeared');await unchanged();evidence.versionIntentAt=new Date().toISOString();save();
    const created=await request(`sites/${config.site}/versions`,'POST',{config:version.config});if(!new RegExp(`^sites/${config.site}/versions/[^/?#]+$`).test(created.name)||created.name===expected)throw Error('Invalid new version');evidence.createdVersion=created.name;save();
    const populated=await request(`${created.name}:populateFiles`,'POST',{files:manifest}),allowed=new Map(Object.entries(hashes).map(([resource,hash])=>[hash,compressed[resource]]));
    const needed=populated.uploadRequiredHashes??[];if(!Array.isArray(needed)||needed.some(hash=>!allowed.has(hash)))throw Error('Unexpected required upload');
    for(const hash of new Set(needed)){const url=new URL(populated.uploadUrl);if(url.origin!=='https://upload-firebasehosting.googleapis.com'||url.username||url.password||url.search||url.hash)throw Error('Unexpected upload host');const r=await fetch(url.href+'/'+hash,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:allowed.get(hash),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Upload failed; no replay');}
    assertManifest(await filesFor(created.name),manifest);if(!isDeepStrictEqual((await request(created.name)).config,version.config))throw Error('Config changed');await unchanged();
    await request(created.name+'?updateMask=status','PATCH',{status:'FINALIZED'});await unchanged();evidence.releaseIntentAt=new Date().toISOString();save();
    const released=await request(`sites/${config.site}/releases?versionName=${created.name}`,'POST',{message:`Inquiry workflow and matched rules (${commit.slice(0,12)})`});if(!released.name?.startsWith(`sites/${config.site}/releases/`))throw Error('Invalid release');evidence.releaseName=released.name;save();
    const current=await latest();if(current?.name!==released.name||current?.version?.name!==created.name)throw Error('Release outcome unknown; reconcile only');
    await verifyLive(config.sources);assertManifest(await filesFor(created.name),manifest);if(!isDeepStrictEqual((await request(created.name)).config,version.config))throw Error('Final config changed');evidence.verifiedAt=new Date().toISOString();evidence.unchangedFilesVerified=true;save();return evidence;
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)releaseWorkflow(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
