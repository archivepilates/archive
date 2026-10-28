import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';

const HOME_BASE = 'bd04987f';
const CORE_BASE = 'f09b901d';
const COMMITS = { [HOME_BASE]: 'bd04987fe511648ce9daafb2d5ab4b58d3959093',
  [CORE_BASE]: 'f09b901d33e4ec31ab5f0b7249a9a15b610065e5' };
const HOME_HASHES = {
  "/index.html": "c81b2f56fdccacfae369e09b4fe3b1801d70fe3cf37549fd4072939962927768",
  "/instructor-lessons/index.html": "b1657e6d60ad4a4019ab51e886b5eb2f00d5b5a0b12ef205b4899735c8b4be04",
  "/teams/index.html": "382ce1bc7260ea5bf36c68dce59af1d7b70d385895c95195a287443040cc3831",
  "/teams/minjin/index.html": "7fafeaf13c32d0865303505a50d40ece1957fc97a0f59bfa417382d4dc1a68bb",
  "/teams/eunyoung/index.html": "4a9ab38cd528b406c3c1f5a9dee26c90aaa036aeca5057f13cb153faa07d7242",
  "/teams/chorim/index.html": "a53e8241d7714a401eaa505a41ea8fef561ebe333278d58ab299f7f107ce52b2",
  "/teams/kihyo/index.html": "8cab05ed72a0bd6a669716efc326a0ac934f6dd02dda3cf3830089036333cead",
  "/teams/yuri/index.html": "0c1d14607a79ab66a2cdde9ad912c369099bc02a15dd35014a66df860171b579"
};
const CORE_HASH = 'cdabcfd615d863c8c5e2ce0f069292c771d7660f64c379a682e2d35f9be3138a';
const CLASSROOM = '/assets/imweb-my-classroom-20260723a.js';
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const sha = value => createHash('sha256').update(value).digest('hex');

export function homeShopNavTarget(target) {
  if (target === 'home') return { site: 'archive-pilates-home', base: HOME_BASE,
    files: Object.entries(HOME_HASHES).map(([resource, baselineSha256]) => ({ resource,
      source: `official-home${resource}`, url: `https://archivepilates.com${resource}`, baselineSha256 })) };
  if (target !== 'core-rules') throw Error('Unexpected release target');
  return { site: 'archive-pilates-core', base: CORE_BASE,
    files: [{ resource: '/rules/index.html', source: 'core/rules/index.html',
      url: 'https://archive-pilates-core.web.app/rules/', baselineSha256: CORE_HASH }] };
}

export function assertHomeShopNavScope(before, after, target, resource) {
  const selected = homeShopNavTarget(target);
  if (!selected.files.some(file => file.resource === resource)) throw Error('Unexpected release resource');
  before = before.toString(); after = after.toString();
  if (target === 'home') {
    const oldLine = /^[ \t]*<a data-nav="products" href="\/shop">\uD310\uB9E4\uC0C1\uD488<\/a>\n/gm;
    const career = /^([ \t]*)<a class="nav-swap" data-nav="career"[^>\r\n]*>/gm;
    const submenu = /<div class="nav-submenu" id="academy-links">(?:(?!<\/div>)[\s\S])*?<\/div>/g;
    const old = [...before.matchAll(oldLine)], careers = [...before.matchAll(career)], menus = [...before.matchAll(submenu)];
    const products = before.match(/<a\b[^>]*\bdata-nav\s*=\s*["']products["'][^>]*>/g) || [];
    if (old.length !== 1 || careers.length !== 1 || menus.length !== 1 || products.length !== 1
        || old[0].index < menus[0].index || old[0].index + old[0][0].length > menus[0].index + menus[0][0].length
        || !before.slice(0, careers[0].index).endsWith('</details>\n')) {
      throw Error('Expected exactly one Academy submenu product link and following top-level career anchor');
    }
    const shop = '<a class="nav-swap" data-nav="products" href="/shop" aria-label="\uD310\uB9E4\uC0C1\uD488"><span class="nav-ko">\uD310\uB9E4\uC0C1\uD488</span><span class="nav-en" aria-hidden="true">SHOP</span></a>';
    const expected = before.replace(oldLine, '').replace(career, (opening, indent) => indent + shop + '\n' + opening);
    if (after !== expected) throw Error('Only the exact submenu-to-top-level product navigation move is allowed');
    return;
  }
  const id = 'home-community-nav-20261028';
  const note = /^          <div class="rule-note" id="home-community-nav-20261028"><strong>[^<>\r\n\u2028\u2029]+<\/strong><span>[^<>\r\n\u2028\u2029]+<\/span><\/div>\n/gm;
  const previous = before.match(note) || [], replacement = after.match(note) || [];
  if (previous.length !== 1 || replacement.length !== 1 || previous[0] === replacement[0]
      || before.split('id="' + id + '"').length !== 2 || after.split('id="' + id + '"').length !== 2
      || after !== before.replace(previous[0], () => replacement[0])) {
    throw Error('Only the existing home community navigation note may be replaced');
  }
}

export function makeHomeShopNavManifest(files, replacements, target) {
  const resources = homeShopNavTarget(target).files.map(file => file.resource);
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
export { assertManifest as assertHomeShopNavManifest };

export async function runHomeShopNavRelease(args, { io = fs, execute = execFileSync, fetcher = fetch,
  home = process.env.HOME, clock = () => new Date().toISOString() } = {}) {
  const target = args.find(arg => arg.startsWith('--target='))?.slice(9);
  const selected = homeShopNavTarget(target), apply = args.includes('--apply');
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
    assertHomeShopNavScope(before, source, target, file.resource);
    const compressed = gzipSync(source, { level: 9 });
    return { ...file, compressed, hash: sha(compressed), sourceSha256: sha(source) };
  });
  const output = path.join(root, 'artifacts/home-shop-nav-20261028');
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
  const manifest = makeHomeShopNavManifest(baselineFiles, Object.fromEntries(sources.map(file => [file.resource, file.hash])), target);
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
      message: `Home shop navigation ${target} only (${sourceCommit.slice(0, 12)})`,
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
  runHomeShopNavRelease(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('Scoped home shop navigation release failed; inspect saved evidence before retry'); process.exitCode = 1;
  });
}
