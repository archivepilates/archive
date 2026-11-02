import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';

export const REGISTRATION_RULES_BASE = '5b17ea289b7545447a711997083c4a3b2b9cb3c1';
export const REGISTRATION_RULES_BASE_HASH = '06a9d87a7b68c57ba93f2255084f1828a4c5d36c573f056f37c46e8c3bb33bd2';
const LINES_HASH = 'fd3b6cd5d65ae93f8694cbe44a8618e66a74c5d4dd4624d54e98da127503d5d9';
const SITE = 'archive-pilates-core', RESOURCE = '/rules/index.html', FILE = 'core/rules/index.html';
const URLS = ['https://core.archivepilates.com/rules/', 'https://archive-pilates-core.web.app/rules/'];
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const sha = b => createHash('sha256').update(b).digest('hex');
const versionPattern = /^sites\/archive-pilates-core\/versions\/[^/?#]+$/;
const releasePattern = /^sites\/archive-pilates-core\/releases\/[^/?#]+$/;

export function assertRegistrationRulesScope(before, after) {
  before = before.toString(); after = after.toString();
  const original = before.match(/^.*<li><a href="https:\/\/arcpilates.studiomate.kr\/users\/create".*\n/gm) || [];
  const updated = after.match(/^.*<li><a href="https:\/\/arcpilates.studiomate.kr\/users\/create".*\n/gm) || [];
  const added = after.match(/^.*<li data-studiomate-registration-revamp="notice225-v1".*\n/gm) || [];
  if (sha(before) !== REGISTRATION_RULES_BASE_HASH || before.includes('data-studiomate-registration-revamp')
      || original.length !== 1 || updated.length !== 1 || added.length !== 1
      || (after.match(/data-studiomate-registration-revamp/g) || []).length !== 1
      || sha(updated[0] + added[0]) !== LINES_HASH
      || after.replace(added[0], '').replace(updated[0], original[0]) !== before)
    throw Error('Only the reviewed StudioMate registration rules lines may change');
}

export function registrationManifest(files, replacement) {
  const manifest = makeManifest(files, replacement, RESOURCE);
  if (files.find(f => f.path === RESOURCE).hash === replacement) throw Error('No-op release is forbidden');
  return manifest;
}

export function parseRegistrationReleaseArgs(args) {
  const expected = args.find(a => a.startsWith('--expected-version='))?.slice(19);
  const apply = args.includes('--apply');
  if (new Set(args).size !== args.length || args.filter(a => a.startsWith('--expected-version=')).length > 1
      || args.some(a => a !== '--apply' && a !== `--expected-version=${expected}`)
      || expected !== undefined && !versionPattern.test(expected) || apply && !expected) throw Error('Invalid scoped release arguments');
  return { apply, expected };
}

export async function releaseRegistrationRules(args) {
  const { apply, expected } = parseRegistrationReleaseArgs(args);
  const git = args => execFileSync('git', args, { encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim();
  const root = git(['rev-parse','--show-toplevel']), sourceCommit = git(['rev-parse','HEAD']);
  const source = fs.readFileSync(path.join(root, FILE));
  assertRegistrationRulesScope(execFileSync('git',['show',`${REGISTRATION_RULES_BASE}:${FILE}`]), source);
  const cleanMain = () => {
    if (git(['branch','--show-current']) !== 'main' || git(['status','--porcelain']) || git(['rev-parse','HEAD']) !== sourceCommit)
      throw Error('Apply requires unchanged clean main');
    git(['merge-base','--is-ancestor',REGISTRATION_RULES_BASE,sourceCommit]);
    if (git(['rev-parse','origin/main']) !== sourceCommit) throw Error('Apply requires main equal to freshly fetched origin/main');
    git(['ls-files','--error-unmatch',FILE]);
  };
  if (apply) { git(['fetch','origin','main']); cleanMain(); }
  const directory = path.join(os.homedir(),'ArchiveIN/operations/registration-revamp-rules-release-20261102');
  const receipt = path.join(directory, 'hosting-release.json');
  const assertNoIntent = () => {
    if (fs.existsSync(receipt)) {
      const prior = JSON.parse(fs.readFileSync(receipt,'utf8'));
      if (prior.versionCreateIntentAt || prior.releaseIntentAt) throw Error('Prior write intent requires reconciliation; do not replay');
    }
  };
  if (apply) assertNoIntent();
  const token = execFileSync('gcloud',['auth','print-access-token',`--account=${ACCOUNT}`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
  const request = async (name, method='GET', body) => {
    const r = await fetch(API + name, { method, headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(60000) });
    if (!r.ok) throw Error(`Hosting ${method} failed (${r.status})`);
    return r.json();
  };
  const latest = async () => (await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
  const filesFor = async version => {
    const files=[],seen=new Set(); let cursor;
    do {
      const result=await request(`${version}/files?pageSize=1000${cursor?'&pageToken='+encodeURIComponent(cursor):''}`);
      if (!Array.isArray(result.files)) throw Error('Incomplete manifest');
      files.push(...result.files); cursor=result.nextPageToken;
      if (cursor && (typeof cursor !== 'string' || seen.has(cursor))) throw Error('Invalid manifest cursor');
      if (cursor) seen.add(cursor);
    } while(cursor);
    return files;
  };
  const verifyPage = async hash => {
    for (const url of URLS) {
      const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(60000)});
      if (!r.ok || sha(Buffer.from(await r.arrayBuffer())) !== hash) throw Error('Live rules hash mismatch; do not replay');
    }
  };
  const release=await latest();
  if (!versionPattern.test(release?.version?.name) || !releasePattern.test(release?.name)
      || expected && expected !== release.version.name) throw Error('Unexpected live version');
  await verifyPage(REGISTRATION_RULES_BASE_HASH);
  const baseline=await request(release.version.name);
  if (baseline.name !== release.version.name || !baseline.config || typeof baseline.config !== 'object' || Array.isArray(baseline.config)) throw Error('Invalid baseline configuration');
  const baselineFiles=await filesFor(baseline.name), compressed=gzipSync(source,{level:9});
  const assetHash=sha(compressed), manifest=registrationManifest(baselineFiles,assetHash);
  const evidence={site:SITE,sourceCommit,baselineVersion:baseline.name,baselineRelease:release.name,
    changedPaths:[RESOURCE],fileCount:baselineFiles.length,unchangedFileCount:baselineFiles.length-1,
    sourceSha256:sha(source),baselineSourceSha256:REGISTRATION_RULES_BASE_HASH,compressedHash:assetHash,mode:apply?'apply':'plan'};
  if (!apply) return evidence;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const info=fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077) throw Error('Unsafe private receipt directory');
  const save=()=>{
    const temp=`${receipt}.${process.pid}.tmp`, fd=fs.openSync(temp,'wx',0o600);
    try { fs.writeFileSync(fd,JSON.stringify(evidence,null,2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp,receipt);
    const parent=fs.openSync(directory,'r'); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  };
  const lock=path.join(os.homedir(),`ArchiveIN/automation/locks/firebase-hosting-${SITE}.lock`);
  const fd=fs.openSync(lock,'wx',0o600);
  try {
    fs.writeSync(fd,JSON.stringify({pid:process.pid,operation:'registration-revamp-rules',at:new Date().toISOString()}));
    assertNoIntent();
    const unchanged=async()=>{
      cleanMain();
      const current=await latest();
      if (current?.name !== release.name || current?.version?.name !== baseline.name || sha(fs.readFileSync(path.join(root,FILE))) !== evidence.sourceSha256) throw Error('Concurrent release or source change');
    };
    await unchanged();
    evidence.versionCreateIntentAt=new Date().toISOString(); save();
    const version=await request(`sites/${SITE}/versions`,'POST',{config:baseline.config});
    if (!versionPattern.test(version.name) || version.name === baseline.name) throw Error('Unexpected created version');
    evidence.createdVersion=version.name; save();
    const entries=Object.entries(manifest), uploaded=new Set();
    for (let i=0;i<entries.length;i+=1000) {
      const batch=Object.fromEntries(entries.slice(i,i+1000));
      const result=await request(`${version.name}:populateFiles`,'POST',{files:batch});
      const hashes=result.uploadRequiredHashes ?? [];
      if (!Array.isArray(hashes) || hashes.some(hash=>hash !== assetHash || !Object.values(batch).includes(hash))) throw Error('Unrelated upload requested');
      for (const hash of new Set(hashes)) {
        if (uploaded.has(hash)) continue;
        const url=new URL(result.uploadUrl);
        if (url.origin !== 'https://upload-firebasehosting.googleapis.com' || url.username || url.password || url.search || url.hash) throw Error('Unexpected upload host');
        const r=await fetch(`${url.href}/${hash}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:compressed,signal:AbortSignal.timeout(60000)});
        if (!r.ok) throw Error(`Rules upload failed (${r.status})`);
        uploaded.add(hash);
      }
    }
    assertManifest(await filesFor(version.name),manifest);
    if (!isDeepStrictEqual((await request(version.name)).config,baseline.config)) throw Error('Hosting configuration changed');
    await unchanged();
    await request(`${version.name}?updateMask=status`,'PATCH',{status:'FINALIZED'});
    await unchanged();
    evidence.releaseIntentAt=new Date().toISOString(); save();
    const published=await request(`sites/${SITE}/releases?versionName=${version.name}`,'POST',{message:`StudioMate registration common rules only (${sourceCommit.slice(0,12)})`});
    if (!releasePattern.test(published.name)) throw Error('Unexpected release result');
    evidence.releaseName=published.name; save();
    const current=await latest();
    if (current?.name !== published.name || current?.version?.name !== version.name) throw Error('Release readback mismatch; do not replay');
    await verifyPage(evidence.sourceSha256);
    assertManifest(await filesFor(version.name),manifest);
    evidence.verified=true; evidence.verifiedAt=new Date().toISOString(); save();
    return evidence;
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  releaseRegistrationRules(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r))).catch(error=>{
    console.error(`StudioMate registration rules release stopped: ${error.message}. Inspect the private receipt before retry.`);process.exitCode=1;
  });
}
