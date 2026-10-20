import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';

const SITE = 'archive-pilates';
const ASSET = '/core/rules/index.html';
const LIVE = 'https://archive-pilates.web.app/core/rules/';
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const BASE = '652c16ea1bc120306742bbe1e0b867dce80291f0';
const BASE_HASH = '4f1e879c2a5356f113d70b4126b9245afb8337e9fd8b595770c571fae503ef9d';
const sha = value => createHash('sha256').update(value).digest('hex');

export function assertStaffNoteOnly(before, after) {
  const note = /^ +<div class="rule-note" id="imweb-staff-video-policy">[^\n]*<\/div>\n/gm;
  if (before.match(note) || (after.match(note) || []).length !== 1 || after.replace(note, '') !== before) {
    throw Error('Release must add only the staff video operating note');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && !arg.startsWith('--expected-version='))) throw Error('Unsupported release argument');
  const apply = args.includes('--apply');
  const expected = args.find(arg => arg.startsWith('--expected-version='))?.slice(19);
  const git = values => execFileSync('git', values, { encoding: 'utf8' }).trim();
  const root = git(['rev-parse', '--show-toplevel']);
  const source = fs.readFileSync(path.join(root, ASSET));
  const baselineSource = execFileSync('git', ['show', `${BASE}:${ASSET.slice(1)}`]);
  if (sha(baselineSource) !== BASE_HASH) throw Error('Pinned baseline mismatch');
  assertStaffNoteOnly(baselineSource.toString(), source.toString());
  if (apply && (!expected || git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain']))) {
    throw Error('Apply requires clean local main and reviewed live version');
  }
  if (apply) execFileSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
  const token = execFileSync('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const request = async (resource, method = 'GET', body) => {
    const response = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${resource}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw Error(`Hosting ${method} failed (${response.status})`);
    return response.json();
  };
  const latest = async () => (await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
  const filesFor = async version => {
    const all = []; let cursor;
    do {
      const page = await request(`${version}/files?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`);
      all.push(...(page.files || [])); cursor = page.nextPageToken;
    } while (cursor);
    return all;
  };
  const release = await latest();
  if (!release?.version?.name?.startsWith(`sites/${SITE}/versions/`)) throw Error('Unexpected live version');
  if (apply && release.version.name !== expected) throw Error('Live version changed since review');
  const baseline = await request(release.version.name);
  const files = await filesFor(baseline.name);
  const live = await fetch(LIVE, { cache: 'no-store' });
  if (!live.ok || sha(Buffer.from(await live.arrayBuffer())) !== BASE_HASH) throw Error('Unreviewed live CORE rules');
  const compressed = gzipSync(source, { level: 9 }); const hash = sha(compressed);
  const manifest = makeManifest(files, hash, ASSET);
  const evidence = { site: SITE, sourceCommit: git(['rev-parse', 'HEAD']), baselineVersion: baseline.name,
    changedPaths: [ASSET], unchangedFileCount: files.length-1, mode: apply ? 'apply' : 'plan', sourceHash: sha(source) };
  if (!apply) { console.log(JSON.stringify(evidence)); return; }
  const directory = path.join(os.homedir(), 'ArchiveIN/automation/imweb-staff-video');
  const evidenceFile = path.join(directory, 'hosting-release.json');
  const save = () => fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2)+'\n', { mode: 0o600 });
  const lock = path.join(os.homedir(), 'ArchiveIN/automation/locks/firebase-hosting-archive-pilates.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true }); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, operation: 'staff-video-core-rules', at: new Date().toISOString() }));
    if ((await latest()).name !== release.name) throw Error('Concurrent deployment detected');
    save();
    const created = await request(`sites/${SITE}/versions`, 'POST', { config: baseline.config });
    if (!created.name?.startsWith(`sites/${SITE}/versions/`)) throw Error('Unexpected new version');
    evidence.createdVersion = created.name; save();
    for (let i = 0; i < files.length; i += 1000) {
      const result = await request(`${created.name}:populateFiles`, 'POST', {
        files: Object.fromEntries(files.slice(i, i+1000).map(file => [file.path, manifest[file.path]])),
      });
      const required = result.uploadRequiredHashes || [];
      if (required.some(value => value !== hash)) throw Error('Unexpected unchanged-file upload');
      if (required.length) {
        const upload = new URL(result.uploadUrl);
        if (upload.origin !== 'https://upload-firebasehosting.googleapis.com') throw Error('Unexpected upload host');
        const response = await fetch(`${upload.href}/${hash}`, { method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: compressed,
          signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw Error(`CORE rules upload failed (${response.status})`);
      }
    }
    assertManifest(await filesFor(created.name), manifest);
    if (!isDeepStrictEqual((await request(created.name)).config, baseline.config)) throw Error('Hosting configuration changed');
    if ((await latest()).name !== release.name) throw Error('Concurrent deployment detected');
    await request(`${created.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
    if ((await latest()).name !== release.name) throw Error('Concurrent deployment detected after finalization');
    evidence.releaseIntentAt = new Date().toISOString(); save();
    const result = await request(`sites/${SITE}/releases?versionName=${created.name}`, 'POST', {
      message: `Staff video policy only (${evidence.sourceCommit.slice(0,12)})`,
    });
    evidence.releaseName = result.name; save();
    if ((await latest()).version.name !== created.name) throw Error('Release readback mismatch');
    const verified = await fetch(LIVE, { cache: 'no-store' });
    if (!verified.ok || sha(Buffer.from(await verified.arrayBuffer())) !== sha(source)) throw Error('Live rules mismatch');
    evidence.verified = true; evidence.verifiedAt = new Date().toISOString(); save();
    console.log(JSON.stringify(evidence));
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
