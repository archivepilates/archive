import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {makeManifest, assertManifest} from './release-e261017-classroom.mjs';

export const CONTRACT_NAME_RULES_BASE = '1ef91290f96501a39fbd53b50f429c7d52215657';
export const CONTRACT_NAME_RULES_BASE_HASH = '5ffbd82707b4b46c68c0811f8b59670de9f9c08709340c82ca45190227477dac';
export const CONTRACT_NAME_RULE_HASH = 'e8b5f930604ed96b0107baf8cedf6b6c4e383ad01a5002cbb048b5c3cc736d0c';
const FILE = 'core/rules/index.html', RESOURCE = '/rules/index.html', SITE = 'archive-pilates-core';
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const VERSION = /^sites\/archive-pilates-core\/versions\/[A-Za-z0-9_-]+$/;
const RELEASE = /^sites\/archive-pilates-core\/releases\/[A-Za-z0-9_-]+$/;
const exactName = (value, pattern) => typeof value === 'string' && value.trim() === value && pattern.test(value);
const sha = value => createHash('sha256').update(value).digest('hex');

export function assertContractNameRulesScope(before, after) {
  before = Buffer.from(before); after = Buffer.from(after);
  if (sha(before) !== CONTRACT_NAME_RULES_BASE_HASH) throw Error('Pinned Git rules baseline changed');
  const previous = before.toString('utf8'), next = after.toString('utf8');
  const rule = /<li data-contract-signer-name="20261116-v1">[\s\S]*?<\/li>/g;
  const oldRules = [...previous.matchAll(rule)], newRules = [...next.matchAll(rule)];
  if (!Buffer.from(next).equals(after) || oldRules.length !== 1 || newRules.length !== 1
    || sha(newRules[0][0]) !== CONTRACT_NAME_RULE_HASH) throw Error('Exactly one pinned reviewed contract-name li is required');
  const start = Buffer.byteLength(previous.slice(0, oldRules[0].index));
  const end = start + Buffer.byteLength(oldRules[0][0]);
  if (!after.equals(Buffer.concat([before.subarray(0, start), Buffer.from(newRules[0][0]), before.subarray(end)]))) {
    throw Error('Only the existing contract-name li may be replaced; all other bytes must remain unchanged');
  }
}

export function contractNameRulesManifest(files, replacement) {
  const manifest = makeManifest(files, replacement, RESOURCE);
  if (files.find(file => file.path === RESOURCE).hash === replacement) throw Error('No-op rules release');
  return manifest;
}

export function parseContractNameRulesArgs(args) {
  let apply = false, expected;
  for (const arg of args) {
    if (arg === '--apply' && !apply) apply = true;
    else if (typeof arg === 'string' && arg.startsWith('--expected-version=') && expected === undefined) expected = arg.slice(19);
    else throw Error('Invalid scoped contract-name rules arguments');
  }
  if ((expected !== undefined && !exactName(expected, VERSION)) || (apply && !expected)) {
    throw Error('Apply requires an exact reviewed archive-pilates-core version');
  }
  return {apply, expected};
}

export function assertContractNameRulesSource(state, commit) {
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit) || commit.trim() !== commit
    || state.branch !== 'main' || state.status !== '' || state.head !== commit || state.remote !== commit) {
    throw Error('Unchanged clean main aligned with fresh origin/main required');
  }
}

export function assertContractNameRulesSnapshot(version, files, expectedVersion, manifest, config) {
  if (!exactName(expectedVersion, VERSION) || version?.name !== expectedVersion || version.status !== 'FINALIZED'
    || !config || typeof config !== 'object' || Array.isArray(config)
    || !isDeepStrictEqual(version.config, config)) throw Error('Hosting version/config changed');
  assertManifest(files, manifest);
}

export function contractNameRulesUploads(result, batch, hash, uploaded = new Set()) {
  const needed = result.uploadRequiredHashes === undefined ? [] : result.uploadRequiredHashes;
  if (!/^[a-f0-9]{64}$/.test(hash) || hash.trim() !== hash || !Array.isArray(needed)
    || needed.some(value => value !== hash || batch[RESOURCE] !== value)) {
    throw Error('Unexpected asset upload; only this batch compressed rules hash is permitted');
  }
  if (!needed.length || uploaded.has(hash)) return undefined;
  const url = new URL(result.uploadUrl);
  if (url.origin !== 'https://upload-firebasehosting.googleapis.com'
    || url.username || url.password || url.search || url.hash) throw Error('Unexpected upload host');
  return `${url.href.replace(/\/$/, '')}/${hash}`;
}

export async function releaseContractNameRules(args) {
  const {apply, expected} = parseContractNameRulesArgs(args);
  const git = args => execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const root = git(['rev-parse', '--show-toplevel']), commit = git(['rev-parse', 'HEAD']);
  const source = fs.readFileSync(path.join(root, FILE));
  assertContractNameRulesScope(execFileSync('git', ['show', `${CONTRACT_NAME_RULES_BASE}:${FILE}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }), source);
  const clean = (fresh = false) => {
    if (fresh) {
      git(['fetch', 'origin', 'main']);
      if (git(['rev-parse', 'FETCH_HEAD']) !== commit) throw Error('Freshly fetched main differs from release source');
    }
    assertContractNameRulesSource({branch: git(['branch', '--show-current']), status: git(['status', '--porcelain']),
      head: git(['rev-parse', 'HEAD']), remote: git(['rev-parse', 'origin/main'])}, commit);
    git(['merge-base', '--is-ancestor', CONTRACT_NAME_RULES_BASE, commit]);
    git(['ls-files', '--error-unmatch', FILE]);
    if (sha(fs.readFileSync(path.join(root, FILE))) !== sha(source)) throw Error('Rules source changed');
  };
  if (apply) clean(true);
  const home = os.homedir();
  const dir = path.join(home, 'ArchiveIN/operations/2026-11-17-contract-name-rules-release');
  const receipt = path.join(dir, 'hosting-release.json');
  const exists = file => {try {fs.lstatSync(file); return true;} catch (error) {if (error.code === 'ENOENT') return false; throw error;}};
  if (apply && exists(receipt)) throw Error('Existing intent requires read-only reconciliation; never replay');
  let token;
  try {
    token = execFileSync('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
    }).trim();
    if (!token) throw Error('Empty token');
  } catch {throw Error('Operator gcloud authentication unavailable; no credentials printed');}
  const request = async (name, method = 'GET', body) => {
    if (!apply && method !== 'GET') throw Error('Plan permits GET only');
    const response = await fetch(API + name, {method, redirect: 'error',
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000)});
    if (!response.ok) throw Error(`Hosting ${method} failed (${response.status}); do not replay writes`);
    return response.json();
  };
  const latest = async () => {
    const release = (await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
    if (!exactName(release?.name, RELEASE) || !exactName(release?.version?.name, VERSION)) throw Error('Invalid latest release');
    return release;
  };
  const filesFor = async version => {
    const files = [], seen = new Set(); let cursor;
    do {
      const page = await request(`${version}/files?pageSize=1000${cursor ? '&pageToken=' + encodeURIComponent(cursor) : ''}`);
      if (!Array.isArray(page.files)) throw Error('Incomplete Hosting manifest');
      files.push(...page.files); cursor = page.nextPageToken;
      if (cursor !== undefined && (typeof cursor !== 'string' || (cursor && seen.has(cursor)))) throw Error('Invalid manifest cursor');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return files;
  };
  const verifyLive = async hash => {
    const observations = [];
    for (const url of ['https://core.archivepilates.com/rules/', 'https://archive-pilates-core.web.app/rules/']) {
      const response = await fetch(url, {method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000)});
      if (!response.ok || sha(Buffer.from(await response.arrayBuffer())) !== hash) throw Error('Live rules mismatch; do not replay');
      observations.push({url, sha256: hash, verifiedAt: new Date().toISOString()});
    }
    return observations;
  };
  const release = await latest();
  if (expected && expected !== release.version.name) throw Error('Live version changed since review');
  const liveBefore = await verifyLive(CONTRACT_NAME_RULES_BASE_HASH);
  const baseline = await request(release.version.name);
  if (baseline.name !== release.version.name || baseline.status !== 'FINALIZED'
    || !baseline.config || typeof baseline.config !== 'object' || Array.isArray(baseline.config)) throw Error('Invalid baseline configuration');
  const files = await filesFor(baseline.name), compressed = gzipSync(source, {level: 9}), hash = sha(compressed);
  const manifest = contractNameRulesManifest(files, hash);
  const priorManifest = makeManifest(files, files.find(file => file.path === RESOURCE).hash, RESOURCE);
  const evidence = {site: SITE, account: ACCOUNT, sourceCommit: commit, baselineCommit: CONTRACT_NAME_RULES_BASE,
    baselineVersion: baseline.name, baselineRelease: release.name, baselineRawSha256: CONTRACT_NAME_RULES_BASE_HASH,
    reviewedRuleSha256: CONTRACT_NAME_RULE_HASH, changedPaths: [RESOURCE], fileCount: files.length,
    unchangedFileCount: files.length - 1, priorVersion: baseline, priorManifest, manifest,
    sourceSha256: sha(source), compressedSha256: hash, liveBefore, uploadedHashes: [], mode: apply ? 'apply' : 'plan'};
  const priorUnchanged = async () => {
    const version = await request(baseline.name);
    if (!isDeepStrictEqual(version, baseline)) throw Error('Prior Hosting version changed');
    assertContractNameRulesSnapshot(version, await filesFor(baseline.name), baseline.name, priorManifest, baseline.config);
  };
  const unchanged = async (fresh = false) => {
    if (apply) clean(fresh);
    const current = await latest();
    if (current.name !== release.name || current.version.name !== baseline.name) throw Error('Concurrent release change');
    await priorUnchanged();
  };
  await unchanged();
  if (!apply) return evidence;

  const privateDir = directory => {
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    // Refuse redirected receipt/lock parents as well as a publicly readable leaf.
    let current = home;
    for (const segment of path.relative(home, directory).split(path.sep)) {
      current = path.join(current, segment);
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
        || (current === directory && stat.mode & 0o077)) throw Error('Private owned receipt/lock directory required');
    }
  };
  privateDir(dir);
  const syncDir = directory => {const fd = fs.openSync(directory, 'r'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}};
  const writeReceipt = (file, flag) => {
    const fd = fs.openSync(file, flag, 0o600);
    try {fs.writeFileSync(fd, JSON.stringify(evidence, null, 2)); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  };
  const save = () => {
    const tmp = receipt + '.tmp'; writeReceipt(tmp, 'wx'); fs.renameSync(tmp, receipt); syncDir(dir);
  };
  const lockDir = path.join(home, 'ArchiveIN/automation/locks');
  privateDir(lockDir);
  const lock = path.join(lockDir, `firebase-hosting-${SITE}.lock`), fd = fs.openSync(lock, 'wx', 0o600);
  const lockStat = fs.fstatSync(fd);
  try {
    fs.writeSync(fd, JSON.stringify({pid: process.pid, operation: 'contract-name-rules', at: new Date().toISOString()}));
    fs.fsyncSync(fd); syncDir(lockDir);
    await unchanged(true); evidence.liveBefore = await verifyLive(CONTRACT_NAME_RULES_BASE_HASH);
    evidence.versionCreateIntentAt = new Date().toISOString();
    // A durable exclusive intent survives any ambiguous transport; there is no resume/replay mode.
    writeReceipt(receipt, 'wx'); syncDir(dir);
    const version = await request(`sites/${SITE}/versions`, 'POST', {config: baseline.config});
    if (!exactName(version.name, VERSION) || version.name === baseline.name) throw Error('Unexpected created version');
    evidence.createdVersion = version.name; save();
    const entries = Object.entries(manifest), uploaded = new Set();
    for (let i = 0; i < entries.length; i += 1000) {
      const batch = Object.fromEntries(entries.slice(i, i + 1000));
      const result = await request(`${version.name}:populateFiles`, 'POST', {files: batch});
      const upload = contractNameRulesUploads(result, batch, hash, uploaded);
      if (upload) {
        evidence.uploadIntentAt = new Date().toISOString(); save();
        const response = await fetch(upload, {method: 'POST', redirect: 'error', headers: {Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream'}, body: compressed, signal: AbortSignal.timeout(60000)});
        if (!response.ok) throw Error(`Rules upload failed (${response.status}); do not replay`);
        uploaded.add(hash); evidence.uploadedHashes = [...uploaded]; save();
      }
    }
    const verifyNew = async status => {
      const current = await request(version.name);
      if (current.name !== version.name || current.status !== status || !isDeepStrictEqual(current.config, baseline.config)) throw Error('Hosting config/status changed');
      assertManifest(await filesFor(version.name), manifest);
    };
    await verifyNew('CREATED'); await unchanged(true);
    evidence.finalizeIntentAt = new Date().toISOString(); save();
    await request(`${version.name}?updateMask=status`, 'PATCH', {status: 'FINALIZED'});
    await verifyNew('FINALIZED'); await unchanged(true);
    evidence.releaseIntentAt = new Date().toISOString(); save();
    const published = await request(`sites/${SITE}/releases?versionName=${version.name}`, 'POST', {
      message: `Contract signer-name reconciliation rule only (${commit.slice(0, 12)})`,
    });
    if (!exactName(published.name, RELEASE) || published.name === release.name
      || published.version?.name !== version.name) throw Error('Invalid release response; do not replay');
    evidence.releaseName = published.name; evidence.releaseTime = published.releaseTime; save();
    const verifyLatest = async () => {
      const current = await latest();
      if (current.name !== published.name || current.version.name !== version.name) throw Error('Latest release readback mismatch; do not replay');
      return current;
    };
    await verifyLatest(); evidence.liveAfter = await verifyLive(evidence.sourceSha256);
    await verifyNew('FINALIZED'); await priorUnchanged(); clean();
    evidence.latestRelease = await verifyLatest();
    evidence.verifiedAt = new Date().toISOString(); evidence.unchangedFilesVerified = true;
    evidence.priorVersionUnchanged = true; evidence.configUnchanged = true; save(); return evidence;
  } finally {
    fs.closeSync(fd);
    const current = fs.lstatSync(lock);
    if (current.ino === lockStat.ino && current.dev === lockStat.dev) {fs.unlinkSync(lock); syncDir(lockDir);}
    else throw Error('Shared Hosting lock ownership changed; lock retained');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  releaseContractNameRules(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(() => {console.error('Contract-name rules release stopped; do not replay. Inspect private intent and reconcile read-only.'); process.exitCode = 1;});
}
