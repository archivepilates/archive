import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {makeManifest,assertManifest} from './release-e261017-classroom.mjs';

export const RECIPIENT_RULES_BASE='303049697c491ae6285604b8dcd4e963fd69fe2a';
export const RECIPIENT_RULES_BASE_HASH='83c58d7007ab8fabe8672045954e3ddb15ac4e75846b241168e5f16d5041c43e';
const ADDITION_HASH='338513a45a22e9474f47ae1111cde8b5cea145e37a53c694a4d98d027cb2cb97';
const FILE='core/rules/index.html',RESOURCE='/rules/index.html',SITE='archive-pilates-core';
const ACCOUNT='archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API='https://firebasehosting.googleapis.com/v1beta1/';
const sha=b=>createHash('sha256').update(b).digest('hex');
const versionPattern=/^sites\/archive-pilates-core\/versions\/[^/?#]+$/;
const releasePattern=/^sites\/archive-pilates-core\/releases\/[^/?#]+$/;

export function assertRecipientRulesScope(before,after){
  before=before.toString();after=after.toString();
  const lines=after.split('\n').filter(l=>l.includes('<strong>수신자용 HTML 통일 · 2026-11-10')||l.includes('<strong>지급일·반영 기준 · 2026-11-10')).map(l=>l+'\n');
  const addition=lines.join('');
  if(sha(before)!==RECIPIENT_RULES_BASE_HASH||lines.length!==2||sha(addition)!==ADDITION_HASH||after.replace(addition,'')!==before)
    throw Error('Only the approved settlement recipient rules may be added');
}
export function recipientRulesManifest(files,replacement){
  const m=makeManifest(files,replacement,RESOURCE);
  if(files.find(f=>f.path===RESOURCE).hash===replacement)throw Error('No-op rules release');
  return m;
}
export function parseRecipientRulesArgs(args){
  const expected=args.find(a=>a.startsWith('--expected-version='))?.slice(19),apply=args.includes('--apply');
  if(new Set(args).size!==args.length||args.some(a=>a!=='--apply'&&a!==`--expected-version=${expected}`)
    ||expected!==undefined&&!versionPattern.test(expected)||apply&&!expected)throw Error('Invalid scoped rules arguments');
  return {apply,expected};
}
export async function releaseRecipientRules(args){
  const {apply,expected}=parseRecipientRulesArgs(args);
  const git=a=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const root=git(['rev-parse','--show-toplevel']),commit=git(['rev-parse','HEAD']);
  const source=fs.readFileSync(path.join(root,FILE));
  assertRecipientRulesScope(execFileSync('git',['show',`${RECIPIENT_RULES_BASE}:${FILE}`]),source);
  const clean=()=>{
    if(git(['branch','--show-current'])!=='main'||git(['status','--porcelain'])||git(['rev-parse','HEAD'])!==commit||git(['rev-parse','origin/main'])!==commit)throw Error('Unchanged clean aligned main required');
    git(['merge-base','--is-ancestor',RECIPIENT_RULES_BASE,commit]);git(['ls-files','--error-unmatch',FILE]);
  };
  if(apply){git(['fetch','origin','main']);clean();}
  const dir=path.join(os.homedir(),'ArchiveIN/operations/settlement-template-rules-release-20261110'),receipt=path.join(dir,'hosting-release.json');
  if(apply&&fs.existsSync(receipt))throw Error('Existing intent requires read-only reconciliation; never replay');
  const token=execFileSync('gcloud',['auth','print-access-token',`--account=${ACCOUNT}`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
  const request=async(name,method='GET',body)=>{const r=await fetch(API+name,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`Hosting ${method} failed (${r.status})`);return r.json();};
  const latest=async()=>(await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
  const filesFor=async v=>{const result=[],seen=new Set();let cursor;do{const page=await request(`${v}/files?pageSize=1000${cursor?'&pageToken='+encodeURIComponent(cursor):''}`);if(!Array.isArray(page.files))throw Error('Incomplete manifest');result.push(...page.files);cursor=page.nextPageToken;if(cursor&&(typeof cursor!=='string'||seen.has(cursor)))throw Error('Invalid manifest cursor');if(cursor)seen.add(cursor);}while(cursor);return result;};
  const verifyLive=async hash=>{for(const url of ['https://core.archivepilates.com/rules/','https://archive-pilates-core.web.app/rules/']){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(60000)});if(!r.ok||sha(Buffer.from(await r.arrayBuffer()))!==hash)throw Error('Live rules mismatch; do not replay');}};
  const release=await latest();
  if(!versionPattern.test(release?.version?.name)||!releasePattern.test(release?.name)||expected&&expected!==release.version.name)throw Error('Unexpected baseline release');
  await verifyLive(RECIPIENT_RULES_BASE_HASH);
  const baseline=await request(release.version.name);if(!baseline.config||baseline.name!==release.version.name)throw Error('Invalid baseline configuration');
  const files=await filesFor(baseline.name),compressed=gzipSync(source,{level:9}),hash=sha(compressed),manifest=recipientRulesManifest(files,hash);
  const evidence={site:SITE,sourceCommit:commit,baselineVersion:baseline.name,baselineRelease:release.name,changedPaths:[RESOURCE],fileCount:files.length,unchangedFileCount:files.length-1,sourceSha256:sha(source),compressedSha256:hash,mode:apply?'apply':'plan'};
  if(!apply)return evidence;
  fs.mkdirSync(dir,{recursive:true,mode:0o700});const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.mode&0o077||stat.uid!==process.getuid())throw Error('Private receipt directory required');
  const save=()=>{const tmp=receipt+'.tmp',fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(evidence,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,receipt);const parent=fs.openSync(dir,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}};
  const lock=path.join(os.homedir(),`ArchiveIN/automation/locks/firebase-hosting-${SITE}.lock`),fd=fs.openSync(lock,'wx',0o600);
  try{
    fs.writeSync(fd,JSON.stringify({pid:process.pid,operation:'settlement-recipient-rules',at:new Date().toISOString()}));
    const unchanged=async()=>{clean();const current=await latest();if(current?.name!==release.name||current?.version?.name!==baseline.name||sha(fs.readFileSync(path.join(root,FILE)))!==evidence.sourceSha256)throw Error('Concurrent source or release change');};
    if(fs.existsSync(receipt))throw Error('Prior write intent requires reconciliation');
    await unchanged();evidence.versionCreateIntentAt=new Date().toISOString();save();
    const version=await request(`sites/${SITE}/versions`,'POST',{config:baseline.config});if(!versionPattern.test(version.name)||version.name===baseline.name)throw Error('Unexpected version');evidence.createdVersion=version.name;save();
    const entries=Object.entries(manifest),uploaded=new Set();
    for(let i=0;i<entries.length;i+=1000){
      const batch=Object.fromEntries(entries.slice(i,i+1000));const result=await request(`${version.name}:populateFiles`,'POST',{files:batch});const needed=result.uploadRequiredHashes??[];
      if(!Array.isArray(needed)||needed.some(h=>h!==hash||!Object.values(batch).includes(h)))throw Error('Unexpected asset upload');
      for(const h of new Set(needed)){if(uploaded.has(h))continue;const url=new URL(result.uploadUrl);if(url.origin!=='https://upload-firebasehosting.googleapis.com'||url.username||url.password||url.search||url.hash)throw Error('Unexpected upload host');const r=await fetch(`${url.href}/${h}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:compressed,signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`Rules upload failed (${r.status})`);uploaded.add(h);}
    }
    assertManifest(await filesFor(version.name),manifest);if(!isDeepStrictEqual((await request(version.name)).config,baseline.config))throw Error('Hosting config changed');
    await unchanged();await request(`${version.name}?updateMask=status`,'PATCH',{status:'FINALIZED'});await unchanged();
    evidence.releaseIntentAt=new Date().toISOString();save();
    const published=await request(`sites/${SITE}/releases?versionName=${version.name}`,'POST',{message:`Settlement recipient rules only (${commit.slice(0,12)})`});if(!releasePattern.test(published.name))throw Error('Invalid release response');evidence.releaseName=published.name;save();
    const current=await latest();if(current?.name!==published.name||current?.version?.name!==version.name)throw Error('Release readback mismatch; no replay');
    await verifyLive(evidence.sourceSha256);assertManifest(await filesFor(version.name),manifest);if(!isDeepStrictEqual((await request(version.name)).config,baseline.config))throw Error('Final config mismatch');
    evidence.verifiedAt=new Date().toISOString();evidence.unchangedFilesVerified=true;save();return evidence;
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)releaseRecipientRules(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
