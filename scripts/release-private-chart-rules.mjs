import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {makeManifest, assertManifest} from './release-e261017-classroom.mjs';

export const CHART_RULES_BASE = 'cc52e05f7cc53a02ca87d922324b885ea9d5986a';
export const CHART_RULES_BASE_HASH = '64e0a5f175d1d85f992eeeb7297c555c54e4c8b25f38f0a806ea2a39a7ed9dc0';
const FILE = 'core/rules/index.html', RESOURCE = '/rules/index.html', SITE = 'archive-pilates-core';
const NOTE_ID = 'private-chart-source-repair-20261114';
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const VERSION = /^sites\/archive-pilates-core\/versions\/[A-Za-z0-9_-]+$/;
const RELEASE = /^sites\/archive-pilates-core\/releases\/[A-Za-z0-9_-]+$/;
const sha = value => createHash('sha256').update(value).digest('hex');

export function assertChartRulesScope(before, after) {
  before = Buffer.from(before); after = Buffer.from(after);
  if (sha(before) !== CHART_RULES_BASE_HASH) throw Error('Pinned Git rules baseline changed');
  const text = after.toString('utf8');
  const lines = text.split('\n').filter(line => line.includes(NOTE_ID));
  // Text is finalized by the command chat; only this standalone, asset-free note may be added.
  const note = /^          <div class="rule-note" id="private-chart-source-repair-20261114"><strong>[^<>\r\n]+<\/strong><span>[^<>\r\n]+<\/span><\/div>$/;
  if (!Buffer.from(text).equals(after) || lines.length !== 1 || !note.test(lines[0])) {
    throw Error('Exactly one standalone private-chart rule-note line is required');
  }
  const section = before.indexOf('          <div class="rule-note" id="ops-health-evidence-20261104"');
  const insertion = before.indexOf('\n', section) + 1;
  const addition = Buffer.from(lines[0] + '\n');
  if (section < 0 || insertion < 0 || !after.equals(Buffer.concat([
    before.subarray(0, insertion), addition, before.subarray(insertion),
  ]))) throw Error('Only the chart note before the original source may be added');
}

export function chartRulesManifest(files, replacement) {
  const manifest = makeManifest(files, replacement, RESOURCE);
  if (files.find(file => file.path === RESOURCE).hash === replacement) throw Error('No-op rules release');
  return manifest;
}

export function parseChartRulesArgs(args) {
  let apply = false, expected;
  for (const arg of args) {
    if (arg === '--apply' && !apply) apply = true;
    else if (arg.startsWith('--expected-version=') && expected === undefined) expected = arg.slice(19);
    else throw Error('Invalid scoped rules arguments');
  }
  if ((expected !== undefined && !VERSION.test(expected)) || (apply && !expected)) {
    throw Error('Apply requires an explicit reviewed archive-pilates-core version');
  }
  return {apply, expected};
}

export function assertChartRulesSource(state, commit) {
  if (state.branch !== 'main' || state.status !== '' || state.head !== commit || state.remote !== commit || !commit) {
    throw Error('Unchanged clean main aligned with fresh origin/main required');
  }
}

export function assertChartRulesSnapshot(version, files, expectedVersion, manifest, config) {
  if (version?.name !== expectedVersion || version.status !== 'FINALIZED'
    || !isDeepStrictEqual(version.config, config)) throw Error('Hosting version/config changed');
  assertManifest(files, manifest);
}

export function chartRulesUploads(result, batch, hash, uploaded = new Set()) {
  const needed = result.uploadRequiredHashes ?? [];
  if (!Array.isArray(needed) || needed.some(value => value !== hash || !Object.values(batch).includes(value))) {
    throw Error('Unexpected asset upload; only the compressed rules hash is permitted');
  }
  if (!needed.length || uploaded.has(hash)) return undefined;
  const url = new URL(result.uploadUrl);
  if (url.origin !== 'https://upload-firebasehosting.googleapis.com'
    || url.username || url.password || url.search || url.hash) throw Error('Unexpected upload host');
  return `${url.href.replace(/\/$/, '')}/${hash}`;
}

export async function releaseChartRules(args) {
  const {apply, expected} = parseChartRulesArgs(args);
  const git = args => execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const root = git(['rev-parse', '--show-toplevel']), commit = git(['rev-parse', 'HEAD']);
  const source = fs.readFileSync(path.join(root, FILE));
  assertChartRulesScope(execFileSync('git', ['show', `${CHART_RULES_BASE}:${FILE}`]), source);
  const clean = (fresh = false) => {
    if (fresh) {
      git(['fetch', 'origin', 'main']);
      if (git(['rev-parse', 'FETCH_HEAD']) !== commit) throw Error('Freshly fetched main differs from release source');
    }
    assertChartRulesSource({branch: git(['branch', '--show-current']), status: git(['status', '--porcelain']),
      head: git(['rev-parse', 'HEAD']), remote: git(['rev-parse', 'origin/main'])}, commit);
    git(['merge-base', '--is-ancestor', CHART_RULES_BASE, commit]);
    git(['ls-files', '--error-unmatch', FILE]);
    if (sha(fs.readFileSync(path.join(root, FILE))) !== sha(source)) throw Error('Rules source changed');
  };
  if (apply) clean(true);
  const dir = path.join(os.homedir(), 'ArchiveIN/operations/2026-11-14-private-chart-release');
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
    if (!RELEASE.test(release?.name) || !VERSION.test(release?.version?.name)) throw Error('Invalid latest release');
    return release;
  };
  const filesFor = async version => {
    const files = [], seen = new Set(); let cursor;
    do {
      const page = await request(`${version}/files?pageSize=1000${cursor ? '&pageToken=' + encodeURIComponent(cursor) : ''}`);
      if (!Array.isArray(page.files)) throw Error('Incomplete Hosting manifest');
      files.push(...page.files); cursor = page.nextPageToken;
      if (cursor && (typeof cursor !== 'string' || seen.has(cursor))) throw Error('Invalid manifest cursor');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return files;
  };
  const verifyLive = async hash => {
    const observations = [];
    for (const url of ['https://core.archivepilates.com/rules/', 'https://archive-pilates-core.web.app/rules/']) {
      const response = await fetch(url, {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000)});
      if (!response.ok || sha(Buffer.from(await response.arrayBuffer())) !== hash) throw Error('Live rules mismatch; do not replay');
      observations.push({url, sha256: hash, verifiedAt: new Date().toISOString()});
    }
    return observations;
  };
  const release = await latest();
  if (expected && expected !== release.version.name) throw Error('Live version changed since review');
  const liveBefore = await verifyLive(CHART_RULES_BASE_HASH);
  const baseline = await request(release.version.name);
  if (baseline.name !== release.version.name || baseline.status !== 'FINALIZED'
    || !baseline.config || typeof baseline.config !== 'object' || Array.isArray(baseline.config)) throw Error('Invalid baseline configuration');
  const files = await filesFor(baseline.name), compressed = gzipSync(source, {level: 9}), hash = sha(compressed);
  const manifest = chartRulesManifest(files, hash), priorManifest = makeManifest(files, files.find(file => file.path === RESOURCE).hash, RESOURCE);
  const evidence = {site: SITE, account: ACCOUNT, sourceCommit: commit, baselineCommit: CHART_RULES_BASE,
    baselineVersion: baseline.name, baselineRelease: release.name, baselineRawSha256: CHART_RULES_BASE_HASH,
    changedPaths: [RESOURCE], fileCount: files.length, unchangedFileCount: files.length - 1,
    sourceSha256: sha(source), compressedSha256: hash, liveBefore, uploadedHashes: [], mode: apply ? 'apply' : 'plan'};
  const priorUnchanged = async () => {
    const version = await request(baseline.name);
    if (!isDeepStrictEqual(version, baseline)) throw Error('Prior Hosting version changed');
    assertChartRulesSnapshot(version, await filesFor(baseline.name), baseline.name, priorManifest, baseline.config);
  };
  const unchanged = async (fresh = false) => {
    if (apply) clean(fresh);
    const current = await latest();
    if (current.name !== release.name || current.version.name !== baseline.name) throw Error('Concurrent release change');
    await priorUnchanged();
  };
  await unchanged();
  if (!apply) return evidence;

  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid()) throw Error('Private receipt directory required');
  const syncDir = () => {const fd = fs.openSync(dir, 'r'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}};
  const writeReceipt = (file, flag) => {
    const fd = fs.openSync(file, flag, 0o600);
    try {fs.writeFileSync(fd, JSON.stringify(evidence, null, 2)); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  };
  const save = () => {
    const tmp = receipt + '.tmp'; writeReceipt(tmp, 'wx'); fs.renameSync(tmp, receipt); syncDir();
  };
  const lockDir = path.join(os.homedir(), 'ArchiveIN/automation/locks');
  fs.mkdirSync(lockDir, {recursive: true, mode: 0o700});
  const lock = path.join(lockDir, `firebase-hosting-${SITE}.lock`), fd = fs.openSync(lock, 'wx', 0o600);
  const lockStat = fs.fstatSync(fd);
  try {
    fs.writeSync(fd, JSON.stringify({pid: process.pid, operation: 'private-chart-rules', at: new Date().toISOString()}));
    fs.fsyncSync(fd);
    await unchanged(true); evidence.liveBefore = await verifyLive(CHART_RULES_BASE_HASH);
    evidence.versionCreateIntentAt = new Date().toISOString();
    // Exclusive, durable pretransport intent is never removed, including on ambiguous errors.
    writeReceipt(receipt, 'wx'); syncDir();
    const version = await request(`sites/${SITE}/versions`, 'POST', {config: baseline.config});
    if (!VERSION.test(version.name) || version.name === baseline.name) throw Error('Unexpected created version');
    evidence.createdVersion = version.name; save();
    const entries = Object.entries(manifest), uploaded = new Set();
    for (let i = 0; i < entries.length; i += 1000) {
      const batch = Object.fromEntries(entries.slice(i, i + 1000));
      const result = await request(`${version.name}:populateFiles`, 'POST', {files: batch});
      const upload = chartRulesUploads(result, batch, hash, uploaded);
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
      message: `Private chart prevention rule note only (${commit.slice(0, 12)})`,
    });
    if (!RELEASE.test(published.name) || published.name === release.name
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
    if (current.ino === lockStat.ino && current.dev === lockStat.dev) fs.unlinkSync(lock);
    else throw Error('Shared Hosting lock ownership changed; lock retained');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  releaseChartRules(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {console.error(error.message); process.exitCode = 1;});
}
