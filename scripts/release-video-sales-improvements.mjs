import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';

const BASE = 'b4f52707';
const PRIVATE = path.join(os.homedir(),'Library/Application Support/ARCHIVE PILATES/video-sales-improvements-20261103');
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const REVIEWED_HOME_SHA256 = '13e499f681fabeb39d84c88c5b754caf2f9d5dcde49c4066da1cf45bb3bd01c1';
export const VIDEO_ROUTES = [
  { regex: '^/shop_view/([0-9]+)/?$', location: 'https://archivepilates.imweb.me/17/?idx=:1', statusCode: 301 },
  { regex: '^/(17|shop_view)/?$', location: 'https://archivepilates.imweb.me/17', statusCode: 301 }
];
const TARGETS = {
  home: { site: 'archive-pilates-home', source: 'official-home/index.html', resource: '/index.html', url: 'https://archivepilates.com/' },
  'core-rules': { site: 'archive-pilates-core', source: 'core/rules/index.html', resource: '/rules/index.html', url: 'https://core.archivepilates.com/rules/' }
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function salesHostingConfig(config,target) {
  assert(Object.hasOwn(TARGETS,target));
  const result = structuredClone(config);
  if (target === 'home') {
    assert(Array.isArray(result.redirects));
    assert(!result.redirects.some(rule => VIDEO_ROUTES.some(next => next.regex === rule.regex)));
    result.redirects = [...VIDEO_ROUTES,...result.redirects];
  }
  return result;
}
export function salesSourceScope(before,after,target) {
  assert(Object.hasOwn(TARGETS,target));
  if (target === 'core-rules') {
    const note = /^          <div class="rule-note" id="video-sales-conversion-20261103"><strong>[^<>\n]+<\/strong><span>[^<>\n]+<\/span><\/div>\n/gm;
    assert(!before.includes('video-sales-conversion-20261103'));
    assert.equal((after.match(note)||[]).length,1);
    assert.equal(after.replace(note,''),before);
    return;
  }
  assert.equal(sha(after),REVIEWED_HOME_SHA256,'Home source is not the reviewed exact patch');
  const normalize = value => value
    .replace(/<section id="classes"[\s\S]*?<\/section>/,'<section id="classes"></section>')
    .replace('<a class="button ghost" href="https://archivepilates.imweb.me/17">강사레슨 영상구매</a>', '<!-- video CTA -->')
    .replace('<a class="button ghost" href="#classes">신작 영상 살펴보기</a>', '<!-- video CTA -->')
    .replace('  <script src="/assets/public-home-ux-20260905.js" defer></script>\n','')
    .replace(/  <style>\n    \.public-home \.class-grid\.new-release-grid[\s\S]*?  <\/style>\n/,'')
    .replace(/    document\.querySelectorAll\("\[data-home-preview\]"\)\.forEach\([\s\S]*?\n    \}\);\n\n/,'');
  assert.notEqual(before,after);
  assert.equal(normalize(after),normalize(before),'Unexpected home content change');
  for (const code of ['AB11','AR7']) assert(after.includes(code));
  assert(!after.includes('Es-G6_WekWo') && !after.includes('qdS2a3KXnmU'));
}
export function salesManifest(files,hash,target) {
  assert(Object.hasOwn(TARGETS,target));
  if (target === 'home') {
    assert.equal(files.length,80,'Unexpected live home manifest size');
    assert(files.some(file => file.path === '/assets/imweb-my-classroom-20260723a.js'));
  }
  return makeManifest(files,hash,TARGETS[target].resource);
}
export function assertRedirectResult(requestPath,status,location) {
  assert.equal(status,301);
  const input = new URL(requestPath,'https://preview.invalid');
  const output = new URL(location);
  assert.equal(output.origin,'https://archivepilates.imweb.me');
  assert.equal(output.pathname.replace(/\/$/,''),'/17');
  const id = input.pathname.match(/^\/shop_view\/([0-9]+)/)?.[1] || input.searchParams.get('idx');
  if (id) assert.equal(output.searchParams.get('idx'),id,'Product identity lost during redirect');
  if (input.searchParams.has('utm_source')) assert.equal(output.searchParams.get('utm_source'),input.searchParams.get('utm_source'));
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.length===2);
  const target = args.find(x=>x.startsWith('--target='))?.slice(9), mode = args.find(x=>['--plan','--preview','--apply'].includes(x));
  assert(Object.hasOwn(TARGETS,target) && mode);
  assert(target==='home' || mode!=='--preview');
  const selected = TARGETS[target];
  const git = args => execFileSync('git',args,{encoding:'utf8'}).trim();
  const root = git(['rev-parse','--show-toplevel']);
  const source = fs.readFileSync(path.join(root,selected.source));
  const before = execFileSync('git',['show',`${BASE}:${selected.source}`]);
  salesSourceScope(before.toString(),source.toString(),target);
  const cleanMain = () => {
    assert.equal(git(['branch','--show-current']),'main');
    assert.equal(git(['status','--porcelain']),'');
    assert.equal(git(['rev-parse','HEAD']),git(['rev-parse','origin/main']));
  };
  if (mode==='--apply') { git(['fetch','origin','main']); cleanMain(); }
  const token = execFileSync('gcloud',['auth','print-access-token',`--account=${ACCOUNT}`],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const request = async (name,method='GET',body) => {
    const r = await fetch(API+name,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    if (!r.ok) throw new Error(`Hosting ${method} ${r.status}`);
    return r.status===204?{}:r.json();
  };
  const files = async version => {
    const result=[],seen=new Set(); let cursor;
    do {
      const page = await request(`${version}/files?pageSize=1000${cursor?`&pageToken=${encodeURIComponent(cursor)}`:''}`);
      assert(Array.isArray(page.files));result.push(...page.files);cursor=page.nextPageToken;
      if(cursor){assert(!seen.has(cursor));seen.add(cursor);}
    }while(cursor);
    return result;
  };
  const latest = async()=> (await request(`sites/${selected.site}/releases?pageSize=1`)).releases[0];
  const baseline = JSON.parse(fs.readFileSync(path.join(PRIVATE,`${selected.site}-baseline.json`)));
  assert.equal((await latest()).name,baseline.release.name,'Live deployment drift');
  assert.deepEqual((await request(baseline.version.name)).config,baseline.version.config,'Baseline configuration drift');
  assertManifest(await files(baseline.version.name),Object.fromEntries(baseline.files.map(file=>[file.path,file.hash])));
  const live = await fetch(selected.url,{cache:'no-store'});
  assert(live.ok && sha(Buffer.from(await live.arrayBuffer()))===sha(before),'Live source differs from reviewed base');
  const config = salesHostingConfig(baseline.version.config,target);
  const compressed = gzipSync(source,{level:9}), hash = sha(compressed);
  const manifest = salesManifest(baseline.files,hash,target);
  const save = (suffix,value)=>fs.writeFileSync(path.join(PRIVATE,`${target}-${suffix}.json`),JSON.stringify(value,null,2),{mode:0o600});
  const result = {target,sourceCommit:git(['rev-parse','HEAD']),sourceHash:sha(source),compressedHash:hash,baselineVersion:baseline.version.name,
    site:selected.site,resource:selected.resource,fileCount:baseline.files.length,config,mode};
  if(mode==='--plan'){save('plan',result);console.log(JSON.stringify({target,mode,files:result.fileCount,changedPaths:[selected.resource],routes:target==='home'?VIDEO_ROUTES:[]}));return;}
  const intentPath = path.join(PRIVATE,`${target}-${mode==='--apply'?'release':'preview'}-intent.json`);
  assert(!fs.existsSync(intentPath),'Prior release intent requires independent reconciliation, not replay');
  const lock = path.join(os.homedir(),'ArchiveIN/automation/locks',`firebase-hosting-${selected.site}.lock`);
  const fd = fs.openSync(lock,'wx',0o600);
  try {
    fs.writeSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString(),task:'video-sales-improvements'}));
    assert(!fs.existsSync(intentPath),'Concurrent intent requires reconciliation');
    const unchanged = async()=>{
      assert.equal((await latest()).name,baseline.release.name,'Concurrent release');
      assert.equal(sha(fs.readFileSync(path.join(root,selected.source))),result.sourceHash,'Local source drift');
      if(mode==='--apply')cleanMain();
    };
    await unchanged();
    const version = await request(`sites/${selected.site}/versions`,'POST',{config});
    assert(new RegExp(`^sites/${selected.site}/versions/[^/?#]+$`).test(version.name));
    result.version=version.name;save('prepared',result);
    const populated = await request(`${version.name}:populateFiles`,'POST',{files:manifest});
    assert((populated.uploadRequiredHashes||[]).every(required=>required===hash),'Unexpected file upload');
    if(populated.uploadRequiredHashes?.length){
      const url=new URL(populated.uploadUrl);assert.equal(url.origin,'https://upload-firebasehosting.googleapis.com');assert(!url.search&&!url.hash&&!url.username&&!url.password);
      const r=await fetch(`${url.href}/${hash}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:compressed});assert(r.ok);
    }
    assertManifest(await files(version.name),manifest);
    assert.deepEqual((await request(version.name)).config,config);
    await unchanged();
    await request(`${version.name}?updateMask=status`,'PATCH',{status:'FINALIZED'});
    await unchanged();
    fs.writeFileSync(intentPath,JSON.stringify({...result,intentAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
    if(mode==='--preview'){
      const channel=await request(`sites/${selected.site}/channels?channelId=video-sales-20261103`,'POST',{ttl:'86400s'});
      assert.equal(channel.name,`sites/${selected.site}/channels/video-sales-20261103`);
      result.channel=channel.name;result.previewUrl=channel.url;save('preview',result);
      await request(`${channel.name}/releases?versionName=${version.name}`,'POST',{message:'Video sales bounded route and home preview'});
      for(const route of ['/17','/17?idx=88&utm_source=qa','/shop_view?idx=89&utm_source=qa','/shop_view/88']){
        const response=await fetch(result.previewUrl+route,{redirect:'manual',cache:'no-store'});
        assertRedirectResult(route,response.status,response.headers.get('location'));
      }
      result.redirectsVerifiedAt=new Date().toISOString();save('preview',result);
    }else{
      if(target==='home'){
        const preview=JSON.parse(fs.readFileSync(path.join(PRIVATE,'home-preview.json')));
        assert(preview.redirectsVerifiedAt && preview.sourceHash===result.sourceHash && isDeepStrictEqual(preview.config,config));
      }
      await unchanged();
      const release=await request(`sites/${selected.site}/releases?versionName=${version.name}`,'POST',{message:`Video sales ${target} only (${result.sourceCommit.slice(0,12)})`});
      assert.equal(release.version.name,version.name);
      assert.equal((await latest()).version.name,version.name);
      const actual=await fetch(selected.url,{cache:'no-store'});assert.equal(sha(Buffer.from(await actual.arrayBuffer())),result.sourceHash);
      assertManifest(await files(version.name),manifest);
      result.verifiedAt=new Date().toISOString();save('release',result);
    }
    console.log(JSON.stringify({target,mode,version:result.version,url:result.previewUrl||selected.url,verifiedAt:result.verifiedAt||result.redirectsVerifiedAt}));
  } finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
