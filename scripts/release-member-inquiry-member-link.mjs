import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';

export const MEMBER_LINK_BASELINE_COMMIT = '863942297e6ca6652e6a91a6dc48694d1ceb361c';
export const MEMBER_LINK_BASELINE_VERSION = 'sites/archive-pilates-core/versions/9f17a1e13333cd8c';
// Reviewed final raw-byte SHA-256 pins supplied by the main implementation lane.
export const MEMBER_LINK_SOURCE_PINS = Object.freeze({
  '/assets/member-inquiries.js': '4ebb94530221773538e7706012c59346df45de1982f0cacc37a8a2a209cc25be',
  '/assets/member-inquiries.css': '831d73d95e9e19db6f7093bc32d3745917a944dc65fd6ca5dd2567da1295f6e9',
  '/inquiries/index.html': 'e47a959dc435b70232bb08c8fe84e4ea521b706c93d1e480c7e9edcf3d4e2a38',
  '/rules/index.html': '75e3bba88db0bdf05742501ee4d96b62e86253d07b6f389cdb42a924aee4cec7',
});
const SITE = 'archive-pilates-core';
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const ORIGINS = ['https://core.archivepilates.com', 'https://archive-pilates-core.web.app'];
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const PATHS = Object.keys(MEMBER_LINK_SOURCE_PINS);
const FILE_COUNT = 70;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validName = (value, kind) => typeof value === 'string'
  && new RegExp(`^sites/${SITE}/${kind}/[a-zA-Z0-9_-]+$`).test(value);

function fileMap(files) {
  if (!Array.isArray(files) || files.length !== FILE_COUNT) throw Error('Exactly 70 manifest files required');
  const manifest = {};
  for (const file of files) {
    const resource = file?.path;
    if (typeof resource !== 'string' || !resource.startsWith('/') || resource.startsWith('//')
      || path.posix.normalize(resource) !== resource || /[\\?#\u0000-\u001f]/.test(resource)
      || !validHash(file.hash) || Object.hasOwn(manifest, resource)) throw Error('Invalid or duplicate manifest path/hash');
    manifest[resource] = file.hash;
  }
  return manifest;
}

export function memberLinkReleaseManifest(files, replacements) {
  if (!replacements || !isDeepStrictEqual(Object.keys(replacements).sort(), [...PATHS].sort())) {
    throw Error('Exactly the four reviewed existing paths required');
  }
  const manifest = fileMap(files);
  for (const [resource, hash] of Object.entries(replacements)) {
    if (!Object.hasOwn(manifest, resource) || !validHash(hash) || manifest[resource] === hash) {
      throw Error('Missing, invalid or no-op reviewed replacement');
    }
    manifest[resource] = hash;
  }
  return manifest;
}

function assertManifest(files, expected) {
  if (!isDeepStrictEqual(fileMap(files), expected)) throw Error('Complete manifest differs from release plan');
}

function parseArgs(args) {
  const expected = args.find(arg => arg.startsWith('--expected-version='))?.slice(19);
  if (expected !== MEMBER_LINK_BASELINE_VERSION || new Set(args).size !== args.length
    || args.some(arg => arg !== '--apply' && arg !== `--expected-version=${expected}`)) {
    throw Error('Exact pinned --expected-version required; only optional --apply allowed');
  }
  return {expected, apply: args.includes('--apply')};
}

// Dependencies are an in-process offline test seam, never CLI/environment overrides.
export async function releaseMemberLink(args, dependencies = {}) {
  const {expected, apply} = parseArgs(args);
  const pins = dependencies.sourcePins ?? MEMBER_LINK_SOURCE_PINS;
  if (!isDeepStrictEqual(Object.keys(pins).sort(), [...PATHS].sort()) || !Object.values(pins).every(validHash)) {
    throw Error('Final reviewed source hash pins required; placeholders block all authentication/network');
  }
  const exec = dependencies.execFileSync ?? execFileSync;
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const home = dependencies.home ?? os.homedir();
  const pause = dependencies.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const git = args => exec('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const root = git(['rev-parse', '--show-toplevel']);
  const commit = git(['rev-parse', 'HEAD']);
  const clean = () => {
    if (git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])
      || git(['rev-parse', 'HEAD']) !== commit || git(['rev-parse', 'origin/main']) !== commit) {
      throw Error('Clean local main equal freshly fetched origin/main required');
    }
  };
  // Even a plan must use a freshly fetched, clean main; no branch/dirty-state bypass.
  git(['fetch', 'origin', 'main']);
  clean();
  if (git(['rev-parse', `${MEMBER_LINK_BASELINE_COMMIT}^{commit}`]) !== MEMBER_LINK_BASELINE_COMMIT) {
    throw Error('Pinned Git baseline missing');
  }
  git(['merge-base', '--is-ancestor', MEMBER_LINK_BASELINE_COMMIT, commit]);
  const readSource = resource => {
    const filename = path.join(root, 'core', resource);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(filename) !== filename) throw Error('Regular source file required');
    return fs.readFileSync(filename);
  };
  const sources = Object.fromEntries(PATHS.map(resource => [resource, readSource(resource)]));
  const checkSources = () => {
    for (const resource of PATHS) if (sha(readSource(resource)) !== pins[resource]) throw Error('Reviewed source changed');
  };
  checkSources();
  const before = Object.fromEntries(PATHS.map(resource => [resource, sha(exec('git', [
    'show', `${MEMBER_LINK_BASELINE_COMMIT}:core${resource}`,
  ], {stdio: ['ignore', 'pipe', 'pipe']}))]));

  const directory = path.join(home, 'ArchiveIN/operations/member-inquiry-member-link-20261110');
  const intent = path.join(directory, 'hosting-release-intent.json');
  const receipt = path.join(directory, 'hosting-release.json');
  const assertNoReplay = () => {
    for (const filename of [intent, receipt, receipt + '.tmp']) {
      try { fs.lstatSync(filename); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw Error('Prior intent/receipt requires GET-only reconciliation; never replay');
    }
  };
  if (apply) {
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700
      || stat.uid !== process.getuid() || fs.realpathSync(directory) !== directory) throw Error('Owned private mode700 directory required');
    assertNoReplay();
  }

  const token = exec('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!token) throw Error('Missing access token');
  const request = async (resource, method = 'GET', body) => {
    const response = await fetcher(API + resource, {
      method, redirect: 'error', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw Error(`Hosting ${method} ${response.status}; reconcile only, never replay`);
    return response.json();
  };
  const latest = async () => (await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
  const filesFor = async version => {
    const files = [], seen = new Set();
    let cursor;
    do {
      const page = await request(`${version}/files?pageSize=1000${cursor ? '&pageToken=' + encodeURIComponent(cursor) : ''}`);
      if (!Array.isArray(page.files)) throw Error('Incomplete manifest');
      files.push(...page.files);
      if (files.length > FILE_COUNT) throw Error('Manifest exceeds 70 files');
      cursor = page.nextPageToken;
      if (cursor !== undefined && cursor !== '' && (typeof cursor !== 'string' || seen.has(cursor))) throw Error('Invalid pagination cursor');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return files;
  };
  const verifyLive = async hashes => {
    for (const [resource, hash] of Object.entries(hashes)) for (const origin of ORIGINS) {
      let matched = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const response = await fetcher(origin + resource, {
          cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000),
        });
        if (response.ok && sha(Buffer.from(await response.arrayBuffer())) === hash) { matched = true; break; }
        if (attempt < 4) await pause(1500);
      }
      if (!matched) throw Error('Live raw-byte mismatch; GET-only reconciliation, never replay');
    }
  };

  const baseline = await latest();
  if (!validName(baseline?.name, 'releases') || baseline?.version?.name !== expected) throw Error('Baseline changed');
  const version = await request(expected);
  if (version.name !== expected || version.status !== 'FINALIZED' || !version.config
    || typeof version.config !== 'object' || Array.isArray(version.config)) throw Error('Finalized baseline config required');
  const files = await filesFor(expected), baselineManifest = fileMap(files);
  await verifyLive(before);
  const compressed = Object.fromEntries(PATHS.map(resource => [resource, gzipSync(sources[resource], {level: 9})]));
  const hashes = Object.fromEntries(PATHS.map(resource => [resource, sha(compressed[resource])]));
  const manifest = memberLinkReleaseManifest(files, hashes);
  const evidence = {
    site: SITE, sourceCommit: commit, baselineCommit: MEMBER_LINK_BASELINE_COMMIT,
    baselineVersion: expected, baselineRelease: baseline.name, changedPaths: PATHS,
    baselineCount: FILE_COUNT, newCount: FILE_COUNT, unchangedCount: FILE_COUNT - PATHS.length,
    sourceHashes: pins, manifestHash: sha(JSON.stringify(Object.entries(manifest).sort())),
    configHash: sha(JSON.stringify(version.config)), account: ACCOUNT,
    mode: apply ? 'apply' : 'plan', memberDispatch: false, attempts: [],
  };
  if (!apply) return evidence;

  const durableWrite = (filename, value) => {
    const fd = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };
  const syncDirectory = () => {
    const fd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };
  const save = () => {
    durableWrite(receipt + '.tmp', evidence);
    fs.renameSync(receipt + '.tmp', receipt);
    syncDirectory();
  };
  const lock = path.join(home, `ArchiveIN/automation/locks/firebase-hosting-${SITE}.lock`);
  const lockFd = fs.openSync(lock, 'wx', 0o600);
  const lockStat = fs.fstatSync(lockFd);
  try {
    fs.writeFileSync(lockFd, JSON.stringify({pid: process.pid, sourceCommit: commit, operation: 'member-inquiry-member-link'}));
    fs.fsyncSync(lockFd);
    const unchanged = async () => {
      clean(); checkSources();
      const current = await latest();
      if (current?.name !== baseline.name || current?.version?.name !== expected) throw Error('Concurrent release');
    };
    assertNoReplay();
    await unchanged();
    evidence.versionIntentAt = new Date().toISOString();
    durableWrite(intent, evidence);
    syncDirectory();
    save();
    // Persist every write intent before transport, never retry any write or uncertain outcome.
    const singleWrite = async (label, transport) => {
      if (evidence.attempts.some(attempt => attempt.label === label)) throw Error('Duplicate write blocked');
      await unchanged();
      const attempt = {label, intentAt: new Date().toISOString(), state: 'pending_or_unknown'};
      evidence.attempts.push(attempt); save();
      const result = await transport();
      attempt.state = 'accepted'; attempt.acceptedAt = new Date().toISOString(); save();
      return result;
    };
    const created = await singleWrite('create-version', () => request(`sites/${SITE}/versions`, 'POST', {config: version.config}));
    if (!validName(created.name, 'versions') || created.name === expected) throw Error('Invalid created version');
    evidence.createdVersion = created.name; save();
    const populated = await singleWrite('populate-files', () => request(`${created.name}:populateFiles`, 'POST', {files: manifest}));
    const allowed = new Map(PATHS.map(resource => [hashes[resource], compressed[resource]]));
    const needed = populated.uploadRequiredHashes ?? [];
    if (!Array.isArray(needed) || needed.some(hash => !allowed.has(hash)) || new Set(needed).size !== needed.length) {
      throw Error('Unexpected or duplicate required upload');
    }
    if (needed.length) {
      const url = new URL(populated.uploadUrl);
      if (url.origin !== 'https://upload-firebasehosting.googleapis.com' || url.username || url.password
        || url.search || url.hash || !url.pathname.startsWith('/upload/')) throw Error('Unexpected upload URL');
      for (const hash of needed) await singleWrite(`upload:${hash}`, async () => {
        const response = await fetcher(url.href.replace(/\/$/, '') + '/' + hash, {
          method: 'POST', redirect: 'error', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream'},
          body: allowed.get(hash), signal: AbortSignal.timeout(60000),
        });
        if (!response.ok) throw Error('Upload failed; reconcile only, never replay');
      });
    }
    const verifyVersion = async (name, expectedManifest, status) => {
      assertManifest(await filesFor(name), expectedManifest);
      const current = await request(name);
      if (current.name !== name || !isDeepStrictEqual(current.config, version.config)
        || (status && current.status !== status)) throw Error('Version config/status changed');
    };
    await verifyVersion(created.name, manifest);
    await singleWrite('finalize-version', () => request(created.name + '?updateMask=status', 'PATCH', {status: 'FINALIZED'}));
    await verifyVersion(created.name, manifest, 'FINALIZED');
    await verifyVersion(expected, baselineManifest, 'FINALIZED');
    const released = await singleWrite('release-version', () => request(`sites/${SITE}/releases?versionName=${created.name}`, 'POST', {
      message: `Inquiry member link and matched rules (${commit.slice(0, 12)})`,
    }));
    if (!validName(released.name, 'releases') || released.name === baseline.name) throw Error('Invalid release receipt');
    evidence.releaseName = released.name; save();
    const assertReleased = async () => {
      const current = await latest();
      if (current?.name !== released.name || current?.version?.name !== created.name) throw Error('Release outcome unknown; GET reconciliation only');
    };
    await assertReleased();
    await verifyLive(pins);
    await verifyVersion(created.name, manifest, 'FINALIZED');
    await assertReleased(); clean(); checkSources();
    evidence.verifiedAt = new Date().toISOString(); evidence.unchangedFilesVerified = true; save();
    return evidence;
  } finally {
    fs.closeSync(lockFd);
    const current = fs.lstatSync(lock);
    if (current.dev !== lockStat.dev || current.ino !== lockStat.ino) throw Error('Site lock ownership changed; manual reconciliation required');
    fs.unlinkSync(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  releaseMemberLink(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
