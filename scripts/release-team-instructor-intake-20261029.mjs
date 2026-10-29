import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';

const BASE = '0029b186669339e45d3ef880af1758a1b0561fda';
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
export const MEAL_RELEASE_TARGETS = {
  core: { site: 'archive-pilates-core', files: {
    '/instructor-lessons/index.html': 'core/instructor-lessons/index.html',
    '/assets/app.js': 'core/assets/app.js', '/rules/index.html': 'core/rules/index.html',
    '/assets/alimtalk-catalog.json': 'core/assets/alimtalk-catalog.json',
  } },
  verification: { site: 'archive-pilates-core', files: { '/rules/index.html': 'core/rules/index.html' } },
};
const sha = value => createHash('sha256').update(value).digest('hex');

export function mealReleaseManifest(files, replacements, target) {
  const expected = MEAL_RELEASE_TARGETS[target]?.files;
  if (!expected || !isDeepStrictEqual(Object.keys(replacements).sort(), Object.keys(expected).sort())) throw Error('Unexpected meal release scope');
  const manifest = makeManifest(files, replacements[Object.keys(expected)[0]], Object.keys(expected)[0]);
  for (const [resource, hash] of Object.entries(replacements)) {
    if (!Object.hasOwn(manifest, resource) || !/^[a-f0-9]{64}$/.test(hash)) throw Error('Missing or invalid meal resource');
    manifest[resource] = hash;
  }
  return manifest;
}

async function main() {
  const args = process.argv.slice(2), target = args.find(x => x.startsWith('--target='))?.slice(9);
  const selected = MEAL_RELEASE_TARGETS[target], apply = args.includes('--apply');
  const expected = args.find(x => x.startsWith('--expected-version='))?.slice(19);
  if (!selected || new Set(args).size !== args.length
    || args.some(x => ![`--target=${target}`, '--apply', `--expected-version=${expected}`].includes(x))) throw Error('Invalid meal release arguments');
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const root = git(['rev-parse', '--show-toplevel']), commit = git(['rev-parse', 'HEAD']);
  const clean = () => {
    if (git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])
      || commit !== git(['rev-parse', 'HEAD']) || commit !== git(['rev-parse', 'origin/main'])) throw Error('Meal release requires synchronized clean main');
  };
  if (apply) { git(['fetch', 'origin', 'main']); clean(); if (!expected) throw Error('Expected version required'); }
  const token = execFileSync('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const request = async (resource, method = 'GET', body) => {
    const r = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${resource}`, { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw Error(`Scoped meal Hosting ${method}: ${r.status}`);
    return r.json();
  };
  const latest = async () => (await request(`sites/${selected.site}/releases?pageSize=1`)).releases?.[0];
  const fileList = async name => {
    const files = [], seen = new Set(); let cursor;
    do {
      const result = await request(`${name}/files?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`);
      if (!Array.isArray(result.files)) throw Error('Incomplete meal manifest');
      files.push(...result.files); cursor = result.nextPageToken;
      if (cursor && seen.has(cursor)) throw Error('Repeated manifest page');
      seen.add(cursor);
    } while (cursor);
    return files;
  };
  const baselineRelease = await latest(), versionPattern = new RegExp(`^sites/${selected.site}/versions/[^/?#]+$`);
  if (!versionPattern.test(baselineRelease?.version?.name) || apply && baselineRelease.version.name !== expected) throw Error('Meal live version changed');
  const baseline = await request(baselineRelease.version.name), files = await fileList(baseline.name);
  if (!baseline.config || baseline.name !== baselineRelease.version.name) throw Error('Missing baseline config');
  const sources = [];
  for (const [resource, file] of Object.entries(selected.files)) {
    const sourceBase = target === 'verification' ? 'd918050bc51bd24da9dce7466c07937e0a0799ea' : BASE;
    const base = execFileSync('git', ['show', `${sourceBase}:${file}`]), source = fs.readFileSync(path.join(root, file));
    const url = `https://${selected.site}.web.app${resource.replace(/index\.html$/, '')}`;
    const live = await fetch(url, { cache: 'no-store' });
    if (!live.ok || sha(Buffer.from(await live.arrayBuffer())) !== sha(base)) throw Error(`Meal baseline source drift: ${resource}`);
    if (sha(base) === sha(source)) throw Error(`Expected scoped source change: ${resource}`);
    const compressed = gzipSync(source, { level: 9 });
    sources.push({ resource, file, source, compressed, hash: sha(compressed), sourceSha256: sha(source), url });
  }
  const manifest = mealReleaseManifest(files, Object.fromEntries(sources.map(s => [s.resource, s.hash])), target);
  const evidence = { target, site: selected.site, sourceCommit: commit, baselineVersion: baseline.name, fileCount: files.length,
    paths: sources.map(s => ({ resource: s.resource, sourceSha256: s.sourceSha256 })), mode: apply ? 'apply' : 'plan' };
  const output = path.join(root, 'artifacts/team-instructor-intake-20261029'); fs.mkdirSync(output, { recursive: true });
  const record = path.join(output, `${target}-${apply ? 'release' : 'plan'}.json`);
  if (apply && fs.existsSync(record) && JSON.parse(fs.readFileSync(record)).releaseIntentAt) throw Error('Prior release intent: reconcile, do not replay');
  const save = () => fs.writeFileSync(record, JSON.stringify(evidence, null, 2));
  if (!apply) { save(); console.log(JSON.stringify(evidence)); return; }
  const lock = path.join(process.env.HOME, 'ArchiveIN/automation/locks', `firebase-hosting-${selected.site}.lock`);
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); save();
    const unchanged = async () => {
      clean(); if ((await latest()).name !== baselineRelease.name) throw Error('Concurrent Hosting release');
      for (const s of sources) if (sha(fs.readFileSync(s.file)) !== s.sourceSha256) throw Error('Local source drift');
    };
    await unchanged();
    const version = await request(`sites/${selected.site}/versions`, 'POST', { config: baseline.config });
    if (!versionPattern.test(version.name)) throw Error('Unexpected meal version');
    evidence.createdVersion = version.name; save();
    const populated = await request(`${version.name}:populateFiles`, 'POST', { files: manifest });
    for (const hash of populated.uploadRequiredHashes || []) {
      const source = sources.find(s => s.hash === hash); if (!source) throw Error('Unexpected asset upload');
      const upload = new URL(populated.uploadUrl);
      if (upload.origin !== 'https://upload-firebasehosting.googleapis.com') throw Error('Unexpected upload host');
      const r = await fetch(`${upload.href}/${hash}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: source.compressed,
        signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw Error(`Meal asset upload failed ${r.status}`);
    }
    assertManifest(await fileList(version.name), manifest);
    if (!isDeepStrictEqual((await request(version.name)).config, baseline.config)) throw Error('Hosting config drift');
    await unchanged();
    await request(`${version.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
    await unchanged(); evidence.releaseIntentAt = new Date().toISOString(); save();
    const release = await request(`sites/${selected.site}/releases?versionName=${version.name}`, 'POST', { message: `ARCHIVE PILATES OPS Team intake ${commit.slice(0, 12)}` });
    evidence.releaseName = release.name; save();
    for (const s of sources) {
      const r = await fetch(s.url, { cache: 'no-store' });
      if (!r.ok || sha(Buffer.from(await r.arrayBuffer())) !== s.sourceSha256) throw Error('Live readback failed; do not replay release');
    }
    if ((await latest()).version.name !== version.name) throw Error('Live release changed');
    evidence.verified = true; save(); console.log(JSON.stringify(evidence));
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('Scoped meal release stopped. Inspect saved evidence before any retry.'); process.exitCode = 1;
});
