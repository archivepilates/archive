import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { assertManifest } from './release-e261017-classroom.mjs';

const SITE = 'archive-pilates-in';
export const TEAM_CALENDAR_FILES = ['/method/team-261121/calendar/index.html', '/method/team-261121/calendar/archive-method-261121.ics'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function teamCalendarManifest(files, hashes) {
  const result = {};
  for (const file of files) {
    if (!file.path?.startsWith('/') || !/^[a-f0-9]{64}$/.test(file.hash) || Object.hasOwn(result, file.path)
      || file.path.startsWith('/method/team-261121/')) throw Error('Unexpected existing Team calendar surface.');
    result[file.path] = file.hash;
  }
  if (Object.keys(hashes).sort().join('|') !== [...TEAM_CALENDAR_FILES].sort().join('|')) throw Error('Exact two calendar files required.');
  for (const file of TEAM_CALENDAR_FILES) {
    if (!/^[a-f0-9]{64}$/.test(hashes[file])) throw Error('Invalid calendar hash.');
    result[file] = hashes[file];
  }
  return result;
}
async function main() {
  const args = process.argv.slice(2), apply = args.includes('--apply');
  if (new Set(args).size !== args.length || args.some(a => a !== '--apply' && !a.startsWith('--expected-version='))) throw Error('Invalid arguments.');
  const expected = args.find(a => a.startsWith('--expected-version='))?.slice(19);
  const git = a => execFileSync('git', a, { encoding: 'utf8' }).trim(), commit = git(['rev-parse', 'HEAD']);
  if (apply) {
    git(['fetch', 'origin', 'main']);
    if (!expected || git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain']) || git(['rev-parse', 'origin/main']) !== commit) throw Error('Clean synchronized main required.');
  }
  const source = Object.fromEntries(TEAM_CALENDAR_FILES.map(f => [f, fs.readFileSync('archivein' + f)]));
  const html = source[TEAM_CALENDAR_FILES[0]].toString(), ics = source[TEAM_CALENDAR_FILES[1]].toString();
  if (!html.includes('2026년 11월 21일') || !html.includes('13:30') || !html.includes('15:20')
    || !ics.includes('DTSTART:20261121T043000Z') || !ics.includes('DTEND:20261121T062000Z')
    || !ics.includes('UID:team-261121@archivepilates.com')) throw Error('Team calendar source mismatch.');
  const blobs = Object.fromEntries(Object.entries(source).map(([f,b]) => [f,gzipSync(b,{level:9})]));
  const hashes = Object.fromEntries(Object.entries(blobs).map(([f,b]) => [f,sha(b)]));
  const token = execFileSync('gcloud', ['auth','print-access-token','--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const request = async (resource, method='GET', body) => {
    const r = await fetch('https://firebasehosting.googleapis.com/v1beta1/'+resource,{method,
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    if (!r.ok) throw Error(`Hosting ${method} ${r.status}`); return r.json();
  };
  const latest = async () => (await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
  const filesFor = async name => {const rows=[],seen=new Set();let cursor;do {const p=await request(`${name}/files?pageSize=1000${cursor?'&pageToken='+encodeURIComponent(cursor):''}`);if(!Array.isArray(p.files))throw Error('Incomplete manifest');rows.push(...p.files);cursor=p.nextPageToken;if(cursor&&seen.has(cursor))throw Error('Repeated cursor');seen.add(cursor);}while(cursor);return rows;};
  const release=await latest();
  if(!/^sites\/archive-pilates-in\/versions\/[^/?#]+$/.test(release?.version?.name)||apply&&release.version.name!==expected)throw Error('Live version changed.');
  const baseline=await request(release.version.name), files=await filesFor(baseline.name), manifest=teamCalendarManifest(files,hashes);
  for(const f of TEAM_CALENDAR_FILES){const r=await fetch('https://in.archivepilates.com'+f,{cache:'no-store'});if(r.status!==404)throw Error('New calendar URL must be absent before initial release.');}
  const evidence={site:SITE,sourceCommit:commit,baselineVersion:baseline.name,addedPaths:TEAM_CALENDAR_FILES,
    preservedFiles:files.length,finalFiles:files.length+2,sourceHashes:Object.fromEntries(Object.entries(source).map(([f,b])=>[f,sha(b)])),mode:apply?'apply':'plan'};
  if(!apply){console.log(JSON.stringify(evidence));return;}
  const directory=path.join(os.homedir(),'ArchiveIN/operations/november-instructor-confirmation-20261029');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const out=path.join(directory,'team-calendar-release.json');if(fs.existsSync(out))throw Error('Existing release intent requires reconciliation.');
  const lock=path.join(os.homedir(),`ArchiveIN/automation/locks/firebase-hosting-${SITE}.lock`),fd=fs.openSync(lock,'wx',0o600);
  const save=()=>fs.writeFileSync(out,JSON.stringify(evidence,null,2),{mode:0o600});
  try{
    fs.writeSync(fd,JSON.stringify({pid:process.pid,owner:'team-calendar-261121',startedAt:new Date().toISOString()}));
    if((await latest()).name!==release.name)throw Error('Concurrent release.');
    const v=await request(`sites/${SITE}/versions`,'POST',{config:baseline.config});evidence.createdVersion=v.name;save();
    if(!v.name?.startsWith(`sites/${SITE}/versions/`))throw Error('Unexpected version.');
    const entries=Object.entries(manifest);
    for(let i=0;i<entries.length;i+=1000){const p=await request(`${v.name}:populateFiles`,'POST',{files:Object.fromEntries(entries.slice(i,i+1000))});
      for(const h of p.uploadRequiredHashes||[]){const f=TEAM_CALENDAR_FILES.find(f=>hashes[f]===h);if(!f)throw Error('Unexpected upload.');const u=new URL(p.uploadUrl);if(u.origin!=='https://upload-firebasehosting.googleapis.com')throw Error('Unexpected upload host.');const r=await fetch(u.href+'/'+h,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body:blobs[f],signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Upload failed.');}}
    assertManifest(await filesFor(v.name),manifest);
    if(!isDeepStrictEqual((await request(v.name)).config,baseline.config)||(await latest()).name!==release.name)throw Error('Hosting config or baseline changed.');
    await request(v.name+'?updateMask=status','PATCH',{status:'FINALIZED'});
    if((await latest()).name!==release.name)throw Error('Concurrent finalization.');
    evidence.releaseIntentAt=new Date().toISOString();save();
    const r=await request(`sites/${SITE}/releases?versionName=${v.name}`,'POST',{message:'Team 261121 calendar additions only '+commit.slice(0,12)});evidence.releaseName=r.name;save();
    if((await latest()).version.name!==v.name)throw Error('Release readback mismatch.');
    for(const f of TEAM_CALENDAR_FILES){const r=await fetch('https://in.archivepilates.com'+f,{cache:'no-store'});if(!r.ok||sha(Buffer.from(await r.arrayBuffer()))!==sha(source[f]))throw Error('Live file mismatch.');}
    const landing=await fetch('https://in.archivepilates.com/method/team-261121/calendar/',{cache:'no-store'});if(!landing.ok||sha(Buffer.from(await landing.arrayBuffer()))!==sha(source[TEAM_CALENDAR_FILES[0]]))throw Error('Landing route mismatch.');
    evidence.verified=true;evidence.verifiedAt=new Date().toISOString();save();console.log(JSON.stringify(evidence));
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(()=>{console.error(JSON.stringify({ok:false,code:'TEAM_CALENDAR_RELEASE_STOPPED',replay:false}));process.exitCode=1;});
