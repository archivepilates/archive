import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

export const ASSET = '/assets/imweb-my-classroom-20260723a.js';
export const BASELINE_SHA256 = '6145954b623ae8ad1bd8541a582eaafe0e1c964aa82cc10b28195ccfcf6cc646';
const CORE_RULES = process.argv.includes('--core-rules');
const SITE = CORE_RULES ? 'archive-pilates' : 'archive-pilates-home';
const RESOURCE_PATH = CORE_RULES ? '/core/rules/index.html' : ASSET;
const LIVE_URL = CORE_RULES ? 'https://archive-pilates.web.app/core/rules/' : `https://archivepilates.com${ASSET}`;
const EXPECTED_BASELINE = CORE_RULES ? '79e6db699f1d342349dc17c35b6a436e930df92d40d2c0a3fd7620e259829651' : BASELINE_SHA256;
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const sha = value => createHash('sha256').update(value).digest('hex');

export function makeManifest(files, newHash, asset = ASSET) {
  const map = {};
  for (const file of files) {
    if (!file.path?.startsWith('/') || !/^[a-f0-9]{64}$/.test(file.hash)) throw Error('Invalid baseline file');
    if (Object.hasOwn(map, file.path)) throw Error('Duplicate baseline path');
    map[file.path] = file.hash;
  }
  if (!Object.hasOwn(map, asset)) throw Error('Baseline target asset is missing');
  if (!/^[a-f0-9]{64}$/.test(newHash)) throw Error('Invalid replacement hash');
  map[asset] = newHash;
  return map;
}

export function assertManifest(actual, expected) {
  const values = Object.fromEntries(actual.map(file => [file.path, file.hash]));
  if (actual.length !== Object.keys(expected).length || !isDeepStrictEqual(values, expected)) {
    throw Error('Version manifest differs from the one-file release plan');
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const expectedVersion = process.argv.find(arg => arg.startsWith('--expected-version='))?.slice(19);
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const root = git(['rev-parse', '--show-toplevel']);
  const trackedPath = CORE_RULES ? 'core/rules/index.html' : `official-home${ASSET}`;
  const source = fs.readFileSync(path.join(root, trackedPath));
  const oldSource = execFileSync('git', ['show', `${CORE_RULES ? 'c05484a2' : 'cc2f803'}:${trackedPath}`]);
  if (sha(oldSource) !== EXPECTED_BASELINE) throw Error('Pinned Git baseline changed');
  const addition = ',\n    {"code":"E261017","path":"/private-lesson-external-feedback-e-261017","title":"10/17 외부 피드백 E팀 · 수강생 공유","group":"PRIVATE LESSON EXTERNAL FEEDBACK E 261017 40D","private":true}';
  if (CORE_RULES) {
    const withoutNotes = source.toString().replace(/^[ \t]*<div class="rule-note"><strong>(?:2026\.10\.17 E팀|E팀)[^\n]*\n/gm, '');
    const normalize = text => text.replace(/\n{3,}/g, '\n\n');
    if (normalize(withoutNotes) !== normalize(oldSource.toString())) throw Error('CORE change must contain only E-team operating notes');
  } else if (!source.toString().includes(addition) || source.toString().replace(addition, '') !== oldSource.toString()) {
    throw Error('Classroom change must be exactly the E261017 catalog entry');
  }
  if (apply) {
    if (!expectedVersion) throw Error('Apply requires the reviewed baseline version');
    git(['ls-files', '--error-unmatch', trackedPath]);
    if (git(['status', '--porcelain'])) throw Error('Release requires a clean Git source worktree');
    execFileSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
  }
  const token = execFileSync('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  }).trim();
  const request = async (resource, method = 'GET', body) => {
    const response = await fetch(API + resource, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw Error(`Hosting API ${response.status}: ${method} ${resource.split('?')[0]}`);
    return response.json();
  };
  const latest = async () => (await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
  const filesFor = async version => {
    const all = []; let pageToken;
    do {
      const page = await request(`${version}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      all.push(...(page.files || [])); pageToken = page.nextPageToken;
    } while (pageToken);
    return all;
  };
  const release = await latest();
  if (!release?.version?.name?.startsWith(`sites/${SITE}/versions/`)) throw Error('Unexpected live site/version');
  if (apply && release.version.name !== expectedVersion) throw Error('Live version changed since review');
  const baseline = await request(release.version.name);
  const baselineFiles = await filesFor(baseline.name);
  const compressed = gzipSync(source, { level: 9 });
  const hash = sha(compressed);
  const manifest = makeManifest(baselineFiles, hash, RESOURCE_PATH);
  const live = await fetch(LIVE_URL, { cache: 'no-store' });
  if (!live.ok || sha(Buffer.from(await live.arrayBuffer())) !== EXPECTED_BASELINE) throw Error('Live asset is not the reviewed baseline');
  const evidenceDir = path.join(root, 'artifacts/student-share-261017');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, `${CORE_RULES ? 'core-rules-' : ''}${apply ? 'hosting-release.json' : 'hosting-plan.json'}`);
  const evidence = { site: SITE, sourceCommit: git(['rev-parse', 'HEAD']), baselineVersion: baseline.name,
    changedPaths: [RESOURCE_PATH], fileCount: baselineFiles.length, newSourceHash: sha(source), compressedHash: hash, mode: apply ? 'apply' : 'plan' };
  const save = () => fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  save();
  if (!apply) { console.log(JSON.stringify(evidence, null, 2)); return; }
  const lockDir = path.join(process.env.HOME, 'ArchiveIN/automation/locks');
  fs.mkdirSync(lockDir, { recursive: true });
  const lock = path.join(lockDir, `firebase-hosting-${SITE}.lock`);
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const created = await request(`sites/${SITE}/versions`, 'POST', { config: baseline.config });
    evidence.createdVersion = created.name; save();
    if (!created.name?.startsWith(`sites/${SITE}/versions/`)) throw Error('Unexpected new version');
    for (let i = 0; i < baselineFiles.length; i += 1000) {
      const batch = Object.fromEntries(baselineFiles.slice(i, i + 1000).map(file => [file.path, manifest[file.path]]));
      const result = await request(`${created.name}:populateFiles`, 'POST', { files: batch });
      const required = result.uploadRequiredHashes || [];
      if (required.some(value => value !== hash)) throw Error('Unexpected upload: unchanged live files must already exist');
      if (required.length) {
        const upload = new URL(result.uploadUrl);
        if (upload.origin !== 'https://upload-firebasehosting.googleapis.com') throw Error('Unexpected upload host');
        const response = await fetch(`${upload.href}/${hash}`, { method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: compressed,
          signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw Error(`Asset upload failed: ${response.status}`);
      }
    }
    assertManifest(await filesFor(created.name), manifest);
    if (!isDeepStrictEqual((await request(created.name)).config, baseline.config)) throw Error('Hosting configuration changed');
    if ((await latest()).name !== release.name) throw Error('Concurrent deployment detected');
    await request(`${created.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
    if ((await latest()).name !== release.name) throw Error('Concurrent deployment detected after finalization');
    evidence.releaseIntentAt = new Date().toISOString(); save();
    const result = await request(`sites/${SITE}/releases?versionName=${created.name}`, 'POST', {
      message: `E261017 ${CORE_RULES ? 'operating notes' : 'classroom catalog'} only (${evidence.sourceCommit.slice(0, 12)})`,
    });
    evidence.releaseName = result.name; evidence.releaseTime = result.releaseTime; save();
    if ((await latest()).version.name !== created.name) throw Error('Release readback mismatch');
    const verified = await fetch(LIVE_URL, { cache: 'no-store' });
    if (!verified.ok || sha(Buffer.from(await verified.arrayBuffer())) !== sha(source)) throw Error('Live asset readback mismatch');
    evidence.verified = true; save(); console.log(JSON.stringify(evidence, null, 2));
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
