import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';

const HOME_BASE = 'e2b8001b';
const CORE_BASE = 'f15526bf';
const COMMITS = { [HOME_BASE]: 'e2b8001bb4c3e9f1eb9873a8021ac9db19783b87',
  [CORE_BASE]: 'f15526bf20895bdbd5720a2f2e6b6c0134cd5070' };
const HOME_HASHES = {
  '/index.html': '4873572240bda6c27c004691e6d90a099703ce1bf3d8d6fb5c9f5f240ad27435',
  '/instructor-lessons/index.html': 'e799c25feffabc25395aa93a5a082cc3c117213ebd1bb83ff98206485f64adb3',
  '/teams/index.html': '561b6090ca258a3fdd843b47471b77d2d42561a920adb9e8f182f7e2fd579f16',
  '/teams/minjin/index.html': '0277203a4f6ab48461d6c3ab0e94fbb671b60fa022f2cef10f536c23957a552f',
  '/teams/eunyoung/index.html': 'ef79ad491867c0519c4866cbd94eeef320ce8106f4ffff17ffd02c8e458df4e0',
  '/teams/chorim/index.html': 'f1268b2837dc80c8fc73c42caa3008b927663ee93238cdd1ef5c20ecd68a65af',
  '/teams/kihyo/index.html': 'f96a9cfe87ae705df6ecf64361a7c568dada8e23da6042b55e925f9b5ec48b2e',
  '/teams/yuri/index.html': '600c2b9aaa920bc879a1df7619e750cfd9dc7f447d5a5490dc21e129d624e634',
};
const CORE_HASH = 'a5103e9766ae2f1057ca17b3f3d0e904cbdc6d249b0312e839647b3e1f4cccb9';
const CLASSROOM = '/assets/imweb-my-classroom-20260723a.js';
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const sha = value => createHash('sha256').update(value).digest('hex');

export function homeCommunityNavTarget(target) {
  if (target === 'home') return { site: 'archive-pilates-home', base: HOME_BASE,
    files: Object.entries(HOME_HASHES).map(([resource, baselineSha256]) => ({ resource,
      source: `official-home${resource}`, url: `https://archivepilates.com${resource}`, baselineSha256 })) };
  if (!['rules', 'core-rules'].includes(target)) throw Error('Unexpected release target');
  const core = target === 'core-rules';
  return { site: core ? 'archive-pilates-core' : 'archive-pilates', base: CORE_BASE,
    files: [{ resource: core ? '/rules/index.html' : '/core/rules/index.html', source: 'core/rules/index.html',
      url: core ? 'https://archive-pilates-core.web.app/rules/' : 'https://archive-pilates.web.app/core/rules/', baselineSha256: CORE_HASH }] };
}

export function assertHomeCommunityNavScope(before, after, target, resource) {
  const selected = homeCommunityNavTarget(target);
  if (!selected.files.some(file => file.resource === resource)) throw Error('Unexpected release resource');
  before = before.toString(); after = after.toString();
  if (target === 'home') {
    // Remove the one complete anchor line/block, including only its own indentation
    // and trailing newline. CSS selectors and body/community links stay byte-identical.
    const anchor = /^[ \t]*<a\b[^>\r\n]*\bdata-nav="community"[^>\r\n]*>(?:(?!<\/?a\b)[\s\S])*?<\/a>[ \t]*\n/gm;
    const matches = before.match(anchor) || [];
    const openings = before.match(/<a\b[^>]*\bdata-nav\s*=\s*["']community["'][^>]*>/g) || [];
    if (matches.length !== 1 || openings.length !== 1 || after !== before.replace(anchor, '')
        || /<a\b[^>]*\bdata-nav\s*=\s*["']community["'][^>]*>/.test(after)) {
      throw Error('Only one complete community navigation anchor may be removed');
    }
    return;
  }
  const id = 'home-community-nav-20261028', anchorId = 'imweb-local-quota-native-continuation';
  const anchor = `          <div class="rule-note" id="${anchorId}">`;
  const note = /^          <div class="rule-note" id="home-community-nav-20261028"><strong>[^<>\r\n\u2028\u2029]+<\/strong><span>[^<>\r\n\u2028\u2029]+<\/span><\/div>\n/gm;
  const added = after.match(note) || [];
  if (before.includes(id) || before.split(anchor).length !== 2 || before.split(`id="${anchorId}"`).length !== 2
      || after.split(`id="${id}"`).length !== 2 || added.length !== 1
      || after !== before.replace(anchor, () => added[0] + anchor)) {
    throw Error('Only one home community navigation note immediately before native continuation is allowed');
  }
}

export function makeHomeCommunityNavManifest(files, replacements, target) {
  const resources = homeCommunityNavTarget(target).files.map(file => file.resource);
  if (!replacements || !isDeepStrictEqual(Object.keys(replacements).sort(), [...resources].sort())) throw Error('Unexpected replacement scope');
  if (target === 'home' && files.length !== 80) throw Error('Home baseline must retain all 80 live files');
  const manifest = makeManifest(files, replacements[resources[0]], resources[0]);
  if (target === 'home' && !Object.hasOwn(manifest, CLASSROOM)) throw Error('Current classroom asset is missing');
  for (const resource of resources) {
    if (!Object.hasOwn(manifest, resource) || !/^[a-f0-9]{64}$/.test(replacements[resource])) throw Error('Invalid replacement');
    if (files.find(file => file.path === resource)?.hash === replacements[resource]) throw Error('Expected every scoped resource to change');
    manifest[resource] = replacements[resource];
  }
  return manifest;
}
export { assertManifest as assertHomeCommunityNavManifest };

export async function runHomeCommunityNavRelease(args, { io = fs, execute = execFileSync, fetcher = fetch,
  home = process.env.HOME, clock = () => new Date().toISOString() } = {}) {
  const target = args.find(arg => arg.startsWith('--target='))?.slice(9);
  const selected = homeCommunityNavTarget(target), apply = args.includes('--apply');
  const expected = args.find(arg => arg.startsWith('--expected-version='))?.slice(19);
  const versionPattern = new RegExp(`^sites/${selected.site}/versions/[^/?#]+$`);
  const releasePattern = new RegExp(`^sites/${selected.site}/releases/[^/?#]+$`);
  if (new Set(args).size !== args.length || args.filter(arg => arg.startsWith('--target=')).length !== 1
      || args.filter(arg => arg.startsWith('--expected-version=')).length > 1
      || args.some(arg => !['--apply', `--target=${target}`, `--expected-version=${expected}`].includes(arg))
      || (expected !== undefined && !versionPattern.test(expected)) || (apply && !expected)) throw Error('Unsupported release argument');
  const git = args => execute('git', args, { encoding: 'utf8' }).trim();
  const root = git(['rev-parse', '--show-toplevel']);
  if (apply) git(['fetch', 'origin', 'main']);
  const sourceCommit = git(['rev-parse', 'HEAD']);
  const cleanMain = () => {
    if (git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])
        || git(['rev-parse', 'HEAD']) !== sourceCommit || sourceCommit !== git(['rev-parse', 'origin/main'])) {
      throw Error('Apply requires clean main equal to freshly fetched origin/main');
    }
    git(['ls-files', '--error-unmatch', ...selected.files.map(file => file.source)]);
  };
  if (apply) cleanMain();
  if (git(['rev-parse', '--verify', `${selected.base}^{commit}`]) !== COMMITS[selected.base]
      || !git(['branch', '--all', '--contains', COMMITS[selected.base]])) throw Error('Pinned Git baseline is missing or unreachable');
  const sources = selected.files.map(file => {
    const before = execute('git', ['show', `${selected.base}:${file.source}`]);
    const source = io.readFileSync(path.join(root, file.source));
    if (sha(before) !== file.baselineSha256) throw Error('Pinned source baseline hash changed');
    assertHomeCommunityNavScope(before, source, target, file.resource);
    const compressed = gzipSync(source, { level: 9 });
    return { ...file, compressed, hash: sha(compressed), sourceSha256: sha(source) };
  });
  const output = path.join(root, 'artifacts/home-community-nav-20261028');
  const evidencePath = path.join(output, `${target}-${apply ? 'release' : 'plan'}.json`);
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
  const manifest = makeHomeCommunityNavManifest(baselineFiles, Object.fromEntries(sources.map(file => [file.resource, file.hash])), target);
  const evidence = { target, site: selected.site, sourceBaseline: selected.base, sourceCommit,
    baselineVersion: baseline.name, changedPaths: sources.map(file => file.resource), fileCount: baselineFiles.length,
    sources: sources.map(({ resource, baselineSha256, sourceSha256, hash }) => ({ resource, baselineSha256, sourceSha256, compressedHash: hash })),
    mode: apply ? 'apply' : 'plan' };
  io.mkdirSync(output, { recursive: true });
  const save = () => io.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  if (!apply) { save(); return evidence; }
  const lock = path.join(home, 'ArchiveIN/automation/locks', `firebase-hosting-${selected.site}.lock`);
  const fd = io.openSync(lock, 'wx', 0o600);
  try {
    io.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: clock() }));
    assertNoPriorIntent();
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
      message: `Home community navigation ${target} only (${sourceCommit.slice(0, 12)})`,
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
  runHomeCommunityNavRelease(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('Scoped home community navigation release failed; inspect saved evidence before retry'); process.exitCode = 1;
  });
}
