import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {makeManifest,assertManifest} from './release-e261017-classroom.mjs';
import {archiveAutomationPath} from './lib/archive-automation-paths.mjs';

const site='archive-pilates-home', origin='https://archivepilates.com',
  api='https://firebasehosting.googleapis.com/v1beta1/',
  source='official-home/index.html', resource='/index.html', base='0a2c6f2d',
  baselineHash='13e499f681fabeb39d84c88c5b754caf2f9d5dcde49c4066da1cf45bb3bd01c1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',timeout:30000}).trim();
const [mode,expectedVersion,...extra]=process.argv.slice(2);
assert(!extra.length && (mode==='--plan' && !expectedVersion || mode==='--apply' && expectedVersion));
const versionPattern=/^sites\/archive-pilates-home\/versions\/[a-zA-Z0-9_-]+$/;
if(expectedVersion)assert(versionPattern.test(expectedVersion));
if(mode==='--apply')git('fetch','origin','main');
const commit=git('rev-parse','HEAD');
const cleanMain=()=>{
  assert.equal(git('branch','--show-current'),'main');
  assert.equal(git('status','--porcelain'),'');
  assert.equal(git('rev-parse','HEAD'),commit);
  assert.equal(commit,git('rev-parse','origin/main'));
};
if(mode==='--apply')cleanMain();
const before=execFileSync('git',['show',base+':'+source]), after=fs.readFileSync(source);
assert.equal(sha(before),baselineHash);
const proposed=after.toString();
const allowed=[
 /  <style id="archive-mobile-v12">[\s\S]*?\n  <\/style>\n/,
 /      <details class="ap12-menu">[\s\S]*?\n      <\/details>\n/,
 /      <div class="ap12-mobile" data-design-version="1\.2">[\s\S]*?\n      <\/div>\n/,
 /    <section class="ap12-mobile ap12-guide" id="first-visit"[\s\S]*?<\/section>\n\n/,
 /    \(\(\) => \{\n      const menu = document\.querySelector\("\.ap12-menu"\);[\s\S]*?\n    \}\)\(\);\n\n/
];
let pared=proposed;
for(const block of allowed){assert(block.test(pared));pared=pared.replace(block,'');}
assert.equal(pared,before.toString(),'Unexpected changes outside the reviewed homepage mobile sections');
assert(!proposed.includes('@@'));
const compressed=gzipSync(after,{level:9}), fileHash=sha(compressed), sourceHash=sha(after);

const token=execFileSync('gcloud',['auth','print-access-token','--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com'],
  {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
assert(token);
async function request(name,method='GET',body){
  const r=await fetch(api+name,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw Error('Hosting '+method+' returned '+r.status);
  return r.json();
}
const latest=async ()=>(await request('sites/'+site+'/releases?pageSize=1')).releases[0];
const files=async version=>{
  let cursor,all=[],seen=new Set();
  do{
    const page=await request(version+'/files?pageSize=1000'+(cursor?'&pageToken='+encodeURIComponent(cursor):''));
    assert(Array.isArray(page.files));
    all.push(...page.files);cursor=page.nextPageToken;
    if(cursor){assert(!seen.has(cursor));seen.add(cursor);}
  }while(cursor);
  return all;
};
const actualHash=async domain=>{
  const r=await fetch(domain+'/',{cache:'no-store',signal:AbortSignal.timeout(20000)});
  assert(r.ok);return sha(Buffer.from(await r.arrayBuffer()));
};
const prior=await latest();
assert(versionPattern.test(prior.version.name));
if(expectedVersion)assert.equal(prior.version.name,expectedVersion);
assert.equal(await actualHash(origin),baselineHash,'Live homepage changed: reconcile before applying');
const baseline=await request(prior.version.name);
assert(baseline.config && Array.isArray(baseline.config.redirects));
const originals=await files(baseline.name), manifest=makeManifest(originals,fileHash,resource);
assert(Object.hasOwn(manifest,'/assets/imweb-my-classroom-20260723a.js'));
assert.notEqual(originals.find(x=>x.path===resource).hash,fileHash);
const result={baselineVersion:baseline.name,commit,fileCount:originals.length,changedPaths:[resource],sourceHash};
if(mode==='--plan'){console.log(JSON.stringify(result));process.exit(0);}
const output=archiveAutomationPath('automation','reports','home-mobile-v12-20261127');
fs.mkdirSync(output,{recursive:true,mode:0o700});
const intent=path.join(output,'mobile-v12-release-intent.json');
const lock=archiveAutomationPath('automation','locks','firebase-hosting-'+site+'.lock');
const fd=fs.openSync(lock,'wx',0o600);
try{
  fs.writeFileSync(fd,JSON.stringify({pid:process.pid,task:'home-mobile-v12'}));
  assert(!fs.existsSync(intent),'Previous release intent: read back rather than replay');
  const unchanged=async()=>{
    assert.equal((await latest()).name,prior.name,'Concurrent release');
    cleanMain();assert.equal(sha(fs.readFileSync(source)),sourceHash);
  };
  await unchanged();
  const created=await request('sites/'+site+'/versions','POST',{config:baseline.config});
  assert(versionPattern.test(created.name)&&created.name!==baseline.name);
  const populated=await request(created.name+':populateFiles','POST',{files:manifest});
  assert((populated.uploadRequiredHashes||[]).every(x=>x===fileHash),'Unexpected upload request');
  if(populated.uploadRequiredHashes?.length){
    const u=new URL(populated.uploadUrl);
    assert.equal(u.origin,'https://upload-firebasehosting.googleapis.com');
    assert(!u.username&&!u.password&&!u.search&&!u.hash);
    const uploaded=await fetch(u.href+'/'+fileHash,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body:compressed,signal:AbortSignal.timeout(25000)});
    assert(uploaded.ok);
  }
  assertManifest(await files(created.name),manifest);
  assert.deepEqual((await request(created.name)).config,baseline.config);
  await unchanged();
  await request(created.name+'?updateMask=status','PATCH',{status:'FINALIZED'});
  await unchanged();
  fs.writeFileSync(intent,JSON.stringify({...result,newVersion:created.name,at:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
  const released=await request('sites/'+site+'/releases?versionName='+created.name,'POST',{message:'Official homepage mobile v1.2 only ('+commit.slice(0,12)+')'});
  assert.equal(released.version.name,created.name);
  assert.equal((await latest()).version.name,created.name);
  assertManifest(await files(created.name),manifest);
  assert.deepEqual((await request(created.name)).config,baseline.config);
  assert.equal(await actualHash(origin),sourceHash);
  console.log(JSON.stringify({...result,newVersion:created.name,liveUrl:origin,configUnchanged:true}));
}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
