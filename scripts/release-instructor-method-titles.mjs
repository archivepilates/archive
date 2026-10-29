import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { assertManifest } from './release-e261017-classroom.mjs';

const SITE = 'archive-pilates-core';
const BASE = '9d9536037f5b2e5a5bf4c868ed97cb6e9e5c229c';
const REVIEWED = '0a7a64513b4e5d019ea1a41d74125ca8281d1be9';
export const INSTRUCTOR_METHOD_ASSETS = Object.freeze(['/assets/app.js', '/assets/styles.css', '/assets/alimtalk-catalog.json']);
const sha = value => createHash('sha256').update(value).digest('hex');
export function instructorMethodManifest(files, hashes) {
  if (Object.keys(hashes).sort().join('|') !== [...INSTRUCTOR_METHOD_ASSETS].sort().join('|')) throw Error('Exact three assets required.');
  const result = {};
  for (const f of files) {
    if (!f.path?.startsWith('/') || !/^[a-f0-9]{64}$/.test(f.hash) || Object.hasOwn(result, f.path)) throw Error('Invalid baseline manifest.');
    result[f.path] = f.hash;
  }
  for (const f of INSTRUCTOR_METHOD_ASSETS) {
    if (!Object.hasOwn(result, f) || !/^[a-f0-9]{64}$/.test(hashes[f]) || result[f] === hashes[f]) throw Error('Expected existing changed asset.');
    result[f] = hashes[f];
  }
  return result;
}
async function main() {
  const args = process.argv.slice(2), apply = args.includes('--apply');
  if (new Set(args).size !== args.length || args.some(a => a !== '--apply' && !a.startsWith('--expected-version='))) throw Error('Invalid arguments.');
  const expected = args.find(a => a.startsWith('--expected-version='))?.slice(19);
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim(), commit = git(['rev-parse', 'HEAD']);
  const sources = Object.fromEntries(INSTRUCTOR_METHOD_ASSETS.map(f => [f, fs.readFileSync('core' + f)]));
  const before = Object.fromEntries(INSTRUCTOR_METHOD_ASSETS.map(f => [f, execFileSync('git', ['show', BASE + ':core' + f])]));
  const checkSource = () => { for (const f of INSTRUCTOR_METHOD_ASSETS) {
    if (sha(fs.readFileSync('core' + f)) !== sha(sources[f]) || sha(sources[f]) !== sha(execFileSync('git', ['show', REVIEWED + ':core' + f]))) throw Error('Source is not the reviewed UI.');
  } };
  const clean = () => { if (git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])
    || git(['rev-parse', 'HEAD']) !== commit || git(['rev-parse', 'origin/main']) !== commit) throw Error('Unchanged synchronized clean main required.'); checkSource(); };
  checkSource();
  if (apply) { git(['fetch', 'origin', 'main']); clean(); if (!expected) throw Error('Expected version required.'); }
  const blobs = Object.fromEntries(INSTRUCTOR_METHOD_ASSETS.map(f => [f, gzipSync(sources[f], { level: 9 })]));
  const hashes = Object.fromEntries(INSTRUCTOR_METHOD_ASSETS.map(f => [f, sha(blobs[f])]));
  const token = execFileSync('gcloud', ['auth', 'print-access-token', '--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
  const request = async (resource, method = 'GET', body) => {
    const r = await fetch('https://firebasehosting.googleapis.com/v1beta1/' + resource, { method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw Error(`Hosting ${method} ${r.status}`); return r.json();
  };
  const latest = async () => (await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
  const filesFor = async name => { const files = [], seen = new Set(); let cursor;
    do { const p = await request(`${name}/files?pageSize=1000${cursor ? '&pageToken=' + encodeURIComponent(cursor) : ''}`);
      if (!Array.isArray(p.files)) throw Error('Incomplete manifest.'); files.push(...p.files); cursor = p.nextPageToken;
      if (cursor && (typeof cursor !== 'string' || seen.has(cursor))) throw Error('Invalid cursor.'); seen.add(cursor);
    } while (cursor); return files; };
  const release = await latest();
  if (!/^sites\/archive-pilates-core\/versions\/[^/?#]+$/.test(release?.version?.name)
    || !/^sites\/archive-pilates-core\/releases\/[^/?#]+$/.test(release?.name) || expected && release.version.name !== expected) throw Error('Live baseline changed.');
  const baseline = await request(release.version.name), files = await filesFor(baseline.name);
  if (!baseline.config || baseline.name !== release.version.name) throw Error('Invalid baseline version.');
  for (const f of INSTRUCTOR_METHOD_ASSETS) { const r = await fetch('https://core.archivepilates.com' + f, { cache: 'no-store' });
    if (!r.ok || sha(Buffer.from(await r.arrayBuffer())) !== sha(before[f])
      || files.find(row => row.path === f)?.hash !== sha(gzipSync(before[f], { level: 9 }))) throw Error('Unreviewed live asset drift.'); }
  const manifest = instructorMethodManifest(files, hashes);
  const evidence = { site: SITE, baselineVersion: baseline.name, sourceCommit: commit, reviewedSource: REVIEWED,
    changedPaths: INSTRUCTOR_METHOD_ASSETS, preservedFiles: files.length - 3, finalFiles: files.length,
    sourceHashes: Object.fromEntries(INSTRUCTOR_METHOD_ASSETS.map(f => [f, sha(sources[f])])), mode: apply ? 'apply' : 'plan' };
  if (!apply) { console.log(JSON.stringify(evidence)); return; }
  const directory = path.join(os.homedir(), 'ArchiveIN/operations/core-instructor-method-titles-20261029');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const output = path.join(directory, 'hosting-release.json'), lock = path.join(os.homedir(), 'ArchiveIN/automation/locks/firebase-hosting-' + SITE + '.lock');
  if (fs.existsSync(output)) throw Error('Existing release journal requires reconciliation, not replay.');
  const fd = fs.openSync(lock, 'wx', 0o600);
  const save = () => { const tmp = output + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(evidence, null, 2), { mode: 0o600 }); fs.renameSync(tmp, output); };
  const unchanged = async () => { clean(); if ((await latest()).name !== release.name) throw Error('Concurrent release.'); };
  try {
    fs.writeSync(fd, JSON.stringify({ owner: 'instructor-method-titles', pid: process.pid, startedAt: new Date().toISOString() }));
    if (fs.existsSync(output)) throw Error('Concurrent journal.'); await unchanged(); save();
    const v = await request(`sites/${SITE}/versions`, 'POST', { config: baseline.config });
    if (!/^sites\/archive-pilates-core\/versions\/[^/?#]+$/.test(v.name)) throw Error('Unexpected created version.'); evidence.createdVersion = v.name; save();
    const p = await request(v.name + ':populateFiles', 'POST', { files: manifest });
    for (const hash of p.uploadRequiredHashes || []) { const f = INSTRUCTOR_METHOD_ASSETS.find(f => hashes[f] === hash); if (!f) throw Error('Unexpected upload.');
      const url = new URL(p.uploadUrl); if (url.origin !== 'https://upload-firebasehosting.googleapis.com') throw Error('Unexpected upload host.');
      const r = await fetch(url.href + '/' + hash, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: blobs[f], signal: AbortSignal.timeout(60000) }); if (!r.ok) throw Error('Upload failed.'); }
    assertManifest(await filesFor(v.name), manifest);
    if (!isDeepStrictEqual((await request(v.name)).config, baseline.config)) throw Error('Hosting config changed.');
    await unchanged(); await request(v.name + '?updateMask=status', 'PATCH', { status: 'FINALIZED' });
    await unchanged(); evidence.releaseIntentAt = new Date().toISOString(); save();
    const result = await request(`sites/${SITE}/releases?versionName=${v.name}`, 'POST', { message: 'Instructor method-title UI only ' + commit.slice(0, 12) }); evidence.releaseName = result.name; save();
    let verified = false;
    for (let attempt = 0; attempt < 5 && !verified; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 2000)); verified = true;
      for (const f of INSTRUCTOR_METHOD_ASSETS) { const r = await fetch('https://core.archivepilates.com' + f, { cache: 'no-store' });
        if (!r.ok || sha(Buffer.from(await r.arrayBuffer())) !== sha(sources[f])) verified = false; }
    }
    if (!verified || (await latest()).version.name !== v.name) throw Error('Live readback mismatch; never replay release.');
    evidence.verified = true; evidence.verifiedAt = new Date().toISOString(); save(); console.log(JSON.stringify(evidence));
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(() => { console.error('CORE method-title release stopped; inspect journal before any retry.'); process.exitCode = 1; });
