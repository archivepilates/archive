import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';

const BASE = '84935deb18d4f28562680c91f0de18bab32ed9da';
const BASELINE_SHA256 = 'b4ce103c36a9775d41a058746ac1cb026318879865e6df8a7cc15a914b87b705';
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const sha = value => createHash('sha256').update(value).digest('hex');

export function lessonIdentityRulesTarget(target = 'core-rules') {
  if (target !== 'core-rules') throw Error('Unexpected release target; legacy mirror is retired');
  return { site: 'archive-pilates-core', base: BASE,
    files: [{ resource: '/rules/index.html', source: 'core/rules/index.html',
      url: 'https://archive-pilates-core.web.app/rules/', baselineSha256: BASELINE_SHA256 }] };
}

export function assertLessonIdentityRulesScope(before, after, target = 'core-rules', resource = '/rules/index.html') {
  const selected = lessonIdentityRulesTarget(target);
  if (resource !== selected.files[0].resource) throw Error('Unexpected release resource');
  before = before.toString(); after = after.toString();
  const id = 'imweb-student-share-first-grant-policy';
  const pattern = /^          <div class="rule-note" id="imweb-student-share-first-grant-policy"><strong>[^<>\r\n\u2028\u2029]+<\/strong><span>[^<>\r\n\u2028\u2029]+<\/span><\/div>\n/gm;
  const previous = before.match(pattern) || [], replacement = after.match(pattern) || [];
  if (previous.length !== 1 || replacement.length !== 1 || previous[0] === replacement[0]
      || before.split('id="' + id + '"').length !== 2 || after.split('id="' + id + '"').length !== 2
      || after !== before.replace(previous[0], () => replacement[0])) {
    throw Error('Only the existing imweb-student-share-first-grant-policy note may be replaced');
  }
}

export function makeLessonIdentityRulesManifest(files, hash) {
  const resource = '/rules/index.html';
  const manifest = makeManifest(files, hash, resource);
  if (files.find(file => file.path === resource).hash === hash) throw Error('Expected the scoped rules resource to change');
  return manifest;
}
export { assertManifest as assertLessonIdentityRulesManifest };

export async function runLessonIdentityRulesRelease(args, { io = fs, execute = execFileSync, fetcher = fetch,
  home = process.env.HOME, clock = () => new Date().toISOString() } = {}) {
  const target = args.find(arg => arg.startsWith('--target='))?.slice(9) ?? 'core-rules';
  const selected = lessonIdentityRulesTarget(target), apply = args.includes('--apply');
  const expected = args.find(arg => arg.startsWith('--expected-version='))?.slice(19);
  const versionPattern = new RegExp(`^sites/${selected.site}/versions/[^/?#]+$`);
  const releasePattern = new RegExp(`^sites/${selected.site}/releases/[^/?#]+$`);
  if (new Set(args).size !== args.length || args.filter(arg => arg.startsWith('--target=')).length > 1
      || args.filter(arg => arg.startsWith('--expected-version=')).length > 1
      || args.some(arg => !['--apply', `--target=${target}`, `--expected-version=${expected}`].includes(arg))
      || (expected !== undefined && !versionPattern.test(expected)) || (apply && !expected)) throw Error('Unsupported release argument');
  const git = args => execute('git', args, { encoding: 'utf8' }).trim();
  const root = git(['rev-parse', '--show-toplevel']);
  if (apply) git(['fetch', 'origin', 'main']);
  const sourceCommit = git(['rev-parse', 'HEAD']);
  const cleanMain = () => {
    if (git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])
        || git(['rev-parse', 'HEAD']) !== sourceCommit) {
      throw Error('Apply requires unchanged clean main');
    }
    try {
      git(['merge-base', '--is-ancestor', BASE, sourceCommit]);
      git(['merge-base', '--is-ancestor', 'origin/main', sourceCommit]);
    } catch {
      throw Error('Apply requires pinned baseline and freshly fetched origin/main to be ancestors of HEAD');
    }
    git(['ls-files', '--error-unmatch', ...selected.files.map(file => file.source)]);
  };
  if (apply) cleanMain();
  if (git(['rev-parse', '--verify', `${selected.base}^{commit}`]) !== BASE
      || !git(['branch', '--all', '--contains', BASE])) throw Error('Pinned Git baseline is missing or unreachable');
  const sources = selected.files.map(file => {
    const before = execute('git', ['show', `${selected.base}:${file.source}`]);
    const source = io.readFileSync(path.join(root, file.source));
    if (sha(before) !== file.baselineSha256) throw Error('Pinned source baseline hash changed');
    assertLessonIdentityRulesScope(before, source, target, file.resource);
    const compressed = gzipSync(source, { level: 9 });
    return { ...file, compressed, hash: sha(compressed), sourceSha256: sha(source) };
  });
  const output = path.join(root, 'artifacts/lesson-identity-20261029');
  const evidencePath = path.join(output, 'rules-release.json');
  const assertNoPriorIntent = () => {
    if (io.existsSync(evidencePath) && JSON.parse(io.readFileSync(evidencePath, 'utf8')).releaseIntentAt) throw Error('Prior release intent requires read-only reconciliation; do not replay');
  };
  if (apply) assertNoPriorIntent();
  const token = execute('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  }).trim();
  const request = async (name, method = 'GET', body) => {
    const response = await fetcher(API + name, { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error(`Hosting ${method} failed: ${response.status}`);
    return response.json();
  };
  const latest = async () => (await request(`sites/${selected.site}/releases?pageSize=1`)).releases?.[0];
  const files = async version => {
    const all = [], seen = new Set(); let cursor;
    do {
      const result = await request(`${version}/files?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`);
      if (!Array.isArray(result.files)) throw Error('Incomplete version manifest');
      all.push(...result.files); cursor = result.nextPageToken;
      if (cursor && (typeof cursor !== 'string' || seen.has(cursor))) throw Error('Invalid manifest cursor');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return all;
  };
  const release = await latest();
  if (!versionPattern.test(release?.version?.name) || !releasePattern.test(release?.name)
      || (expected && release.version.name !== expected)) throw Error('Unexpected live version');
  const verifyLive = async baseline => {
    for (const file of sources) {
      const response = await fetcher(file.url, { cache: 'no-store' });
      if (!response.ok || sha(Buffer.from(await response.arrayBuffer())) !== (baseline ? file.baselineSha256 : file.sourceSha256)) throw Error('Live source drift; reconcile before any repeat');
    }
  };
  await verifyLive(true);
  const baseline = await request(release.version.name);
  if (baseline.name !== release.version.name || !baseline.config || typeof baseline.config !== 'object' || Array.isArray(baseline.config)) throw Error('Unexpected baseline configuration');
  const baselineFiles = await files(baseline.name);
  const manifest = makeLessonIdentityRulesManifest(baselineFiles, sources[0].hash);
  const evidence = { target, site: selected.site, sourceBaseline: selected.base, sourceCommit,
    baselineVersion: baseline.name, changedPaths: sources.map(file => file.resource), fileCount: baselineFiles.length,
    sources: sources.map(({ resource, baselineSha256, sourceSha256, hash }) => ({ resource, baselineSha256, sourceSha256, compressedHash: hash })),
    mode: apply ? 'apply' : 'plan' };
  const save = () => {
    const temporary = `${evidencePath}.${process.pid}.tmp`;
    const descriptor = io.openSync(temporary, 'wx', 0o600);
    try {
      try {
        io.writeFileSync(descriptor, JSON.stringify(evidence, null, 2));
        io.fsyncSync(descriptor);
      } finally { io.closeSync(descriptor); }
      io.renameSync(temporary, evidencePath);
      const parent = io.openSync(output, 'r');
      try { io.fsyncSync(parent); } finally { io.closeSync(parent); }
    } finally {
      try { io.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  };
  if (!apply) return evidence;
  const lock = path.join(home, 'ArchiveIN/automation/locks', `firebase-hosting-${selected.site}.lock`);
  const fd = io.openSync(lock, 'wx', 0o600);
  try {
    io.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: clock() }));
    assertNoPriorIntent();
    io.mkdirSync(output, { recursive: true });
    save();
    const unchanged = async () => {
      const current = await latest();
      if (current?.name !== release.name || current?.version?.name !== baseline.name) throw Error('Concurrent release');
      cleanMain();
      for (const file of sources) if (sha(io.readFileSync(path.join(root, file.source))) !== file.sourceSha256) throw Error('Local source changed');
    };
    await unchanged();
    const version = await request(`sites/${selected.site}/versions`, 'POST', { config: baseline.config });
    if (!versionPattern.test(version.name) || version.name === baseline.name) throw Error('Unexpected version scope');
    evidence.createdVersion = version.name; save();
    const uploads = new Map(sources.map(file => [file.hash, file.compressed]));
    const entries = Object.entries(manifest), uploaded = new Set();
    for (let start = 0; start < entries.length; start += 1000) {
      const batch = Object.fromEntries(entries.slice(start, start + 1000));
      const result = await request(`${version.name}:populateFiles`, 'POST', { files: batch });
      const required = result.uploadRequiredHashes ?? [];
      if (!Array.isArray(required) || required.some(hash => !uploads.has(hash) || !Object.values(batch).includes(hash))) throw Error('Unrelated files require upload');
      for (const hash of new Set(required)) {
        if (uploaded.has(hash)) continue;
        const url = new URL(result.uploadUrl);
        if (url.origin !== 'https://upload-firebasehosting.googleapis.com' || url.username || url.password || url.search || url.hash) throw Error('Unexpected upload destination');
        const response = await fetcher(`${url.href}/${hash}`, { method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
          body: uploads.get(hash), signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw Error(`Asset upload failed: ${response.status}`);
        uploaded.add(hash);
      }
    }
    assertManifest(await files(version.name), manifest);
    const prepared = await request(version.name);
    if (prepared.name !== version.name || !isDeepStrictEqual(prepared.config, baseline.config)) throw Error('Configuration changed');
    await unchanged();
    await request(`${version.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
    await unchanged();
    evidence.releaseIntentAt = clock(); save();
    const published = await request(`sites/${selected.site}/releases?versionName=${version.name}`, 'POST', {
      message: `Lesson identity rules ${target} only (${sourceCommit.slice(0, 12)})`,
    });
    if (!releasePattern.test(published.name)) throw Error('Unexpected published release');
    evidence.releaseName = published.name; save();
    const current = await latest();
    if (current?.name !== published.name || current?.version?.name !== version.name) throw Error('Release readback failed; do not repeat');
    await verifyLive(false);
    evidence.verified = true; evidence.verifiedAt = clock(); save();
    return evidence;
  } finally { try { io.closeSync(fd); } finally { io.unlinkSync(lock); } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLessonIdentityRulesRelease(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('Scoped lesson identity rules release failed; inspect saved evidence before retry'); process.exitCode = 1;
  });
}

