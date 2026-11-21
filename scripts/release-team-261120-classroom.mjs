import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';
import { archiveAutomationRoot } from './lib/archive-automation-paths.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const HOME = '/Users/archivepilates';
export const PRIVATE_ROOT = HOME + '/archive-automation/operations/team-lesson-videos-261120';
export const RELEASE_TARGETS = Object.freeze(Object.fromEntries(Object.entries({
  classroom: { site: 'archive-pilates-home', resource: '/assets/imweb-my-classroom-20260723a.js',
    source: 'official-home/assets/imweb-my-classroom-20260723a.js' },
  'core-rules': { site: 'archive-pilates-core', resource: '/rules/index.html', source: 'core/rules/index.html' },
  rules: { site: 'archive-pilates', resource: '/core/rules/index.html', source: 'core/rules/index.html' },
}).map(([key, value]) => [key, Object.freeze(value)])));
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const gzip = bytes => gzipSync(bytes, { level: 9 });
const versionPattern = site => new RegExp(`^sites/${site}/versions/[A-Za-z0-9_-]+$`);

export function releaseArguments(args) {
  const values = {};
  for (const arg of args) {
    const match = /^(--target|--base-commit|--expected-version)=(.+)$/.exec(arg);
    const key = match?.[1] || arg;
    if ((!match && arg !== '--apply') || Object.hasOwn(values, key)) throw Error('Unsupported or duplicate release argument');
    values[key] = match ? match[2] : true;
  }
  const target = values['--target'], baseCommit = values['--base-commit'];
  if (!Object.hasOwn(RELEASE_TARGETS, target) || !/^[a-f0-9]{40}$/.test(baseCommit || '')) {
    throw Error('Explicit allowlisted target and full base-commit SHA required');
  }
  const apply = values['--apply'] === true, expectedVersion = values['--expected-version'];
  if ((apply && !expectedVersion) || (expectedVersion && !versionPattern(RELEASE_TARGETS[target].site).test(expectedVersion))) {
    throw Error('Exact expected production version required');
  }
  return { target, baseCommit, apply, expectedVersion };
}

export function assertCleanMain(git, commit) {
  if (git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])
    || git(['rev-parse', 'HEAD']) !== commit || git(['rev-parse', 'origin/main']) !== commit) {
    throw Error('Apply requires clean main exactly equal to fresh origin/main');
  }
}

export function oneFileManifest(files, resource, baseHash, newHash) {
  const manifest = makeManifest(files, newHash, resource);
  if (files.find(file => file.path === resource)?.hash !== baseHash) throw Error('Active target gzip hash differs from Git base');
  const changed = files.filter(file => manifest[file.path] !== file.hash).map(file => file.path);
  if (!isDeepStrictEqual(changed, [resource])) throw Error('Exactly one existing file must change');
  return manifest;
}

// This store never overwrites an existing intent on entry, nor follows nested symlinks.
export function privateReleaseStore(target, io = fs, { privateRoot = PRIVATE_ROOT } = {}) {
  if (!Object.hasOwn(RELEASE_TARGETS, target)) throw Error('Unknown store target');
  if (![PRIVATE_ROOT, HOME + '/archive-automation/operations/team-lesson-videos-261121'].includes(privateRoot)) {
    throw Error('Unknown Team release ledger');
  }
  const file = path.join(privateRoot, `${target}-release.json`);
  const lock = path.join(HOME, 'archive-automation/automation/locks', `firebase-hosting-${RELEASE_TARGETS[target].site}.lock`);
  const stat = name => io.lstatSync(name, { throwIfNoEntry: false });
  const directory = (name, create, privateLeaf = false) => {
    const relative = path.relative(HOME, name);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Unsafe private path');
    let current = HOME;
    for (const segment of ['', ...relative.split(path.sep)]) {
      if (segment) current = path.join(current, segment);
      let info = stat(current);
      if (!info) {
        if (!create) return false;
        io.mkdirSync(current, { mode: 0o700 }); info = stat(current);
      }
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()
        || (info.mode & 0o022) || (privateLeaf && current === name && (info.mode & 0o077))) {
        throw Error('Unsafe private directory');
      }
    }
    return true;
  };
  const read = () => {
    if (!directory(privateRoot, false, true) || !stat(file)) return null;
    const fd = io.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const info = io.fstatSync(fd);
      if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.nlink !== 1) {
        throw Error('Unsafe release intent');
      }
      return JSON.parse(io.readFileSync(fd, 'utf8'));
    } finally { io.closeSync(fd); }
  };
  const acquire = () => {
    if (archiveAutomationRoot(HOME, io) !== path.join(HOME, 'archive-automation')) throw Error('Canonical automation root required');
    directory(privateRoot, true, true); directory(path.dirname(lock), true);
    const fd = io.openSync(lock, 'wx', 0o600);
    const { ino, dev } = io.fstatSync(fd);
    const close = () => {
      try {
        const now = stat(lock);
        if (!now || now.ino !== ino || now.dev !== dev) throw Error('Site lock ownership changed');
        io.unlinkSync(lock);
      } finally { io.closeSync(fd); }
    };
    try { io.writeSync(fd, JSON.stringify({ pid: process.pid, operation: 'team-261120-classroom', target })); io.fsyncSync(fd); }
    catch (error) { close(); throw error; }
    return close;
  };
  const create = evidence => {
    const fd = io.openSync(file, 'wx', 0o600);
    const save = value => {
      const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
      io.ftruncateSync(fd, 0);
      for (let offset = 0; offset < bytes.length;) {
        const written = io.writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (written <= 0) throw Error('Incomplete release intent write');
        offset += written;
      }
      io.fsyncSync(fd);
    };
    try {
      save(evidence);
      const parent = io.openSync(privateRoot, fs.constants.O_RDONLY);
      try { io.fsyncSync(parent); } finally { io.closeSync(parent); }
    } catch (error) { io.closeSync(fd); throw error; }
    return { save, close: () => io.closeSync(fd) };
  };
  return { file, lock, read, acquire, create };
}

// All external and persistence boundaries are injectable; importing this file is inert.
export async function releaseTeamClassroom({ args = process.argv.slice(2), root = REPO,
  git = a => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
  gitBytes = a => execFileSync('git', a, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }),
  readSource = file => fs.readFileSync(path.join(root, file)),
  promotedGuard = () => execFileSync(process.execPath, ['scripts/validate-release-branch-state.mjs',
    '--require-origin-main', '--require-main-branch'], { cwd: root, stdio: 'pipe', timeout: 120000 }),
  getToken = () => execFileSync('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim(),
  fetchImpl = fetch, store: suppliedStore, lessonLabel = '261120',
} = {}) {
  if (!['261120', '261121'].includes(lessonLabel)) throw Error('Unknown Team lesson');
  const { target, baseCommit, apply, expectedVersion } = releaseArguments(args);
  const selected = RELEASE_TARGETS[target], pattern = versionPattern(selected.site);
  const commit = git(['rev-parse', 'HEAD']);
  if (git(['rev-parse', '--verify', `${baseCommit}^{commit}`]) !== baseCommit) throw Error('Local base commit required');
  git(['merge-base', '--is-ancestor', baseCommit, 'HEAD']);
  const before = Buffer.from(gitBytes(['show', `${baseCommit}:${selected.source}`]));
  const source = Buffer.from(readSource(selected.source));
  const compressed = gzip(source), newHash = sha(compressed), baseHash = sha(gzip(before));
  if (source.equals(before) || newHash === baseHash) throw Error('Exactly one changed source required');
  const guard = () => {
    if (git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])) throw Error('Apply requires clean main');
    promotedGuard(); // Existing guard performs a fresh fetch and enforces promoted main.
    assertCleanMain(git, commit);
    if (!source.equals(Buffer.from(gitBytes(['show', `HEAD:${selected.source}`])))
      || !source.equals(Buffer.from(readSource(selected.source)))) throw Error('Source changed since preparation');
  };
  if (apply) guard();
  const store = suppliedStore || privateReleaseStore(target);
  const unlock = apply ? store.acquire() : () => {};
  let journal;
  try {
    const prior = store.read();
    const token = getToken();
    const request = async (resource, method = 'GET', body) => {
      const response = await fetchImpl(API + resource, { method, redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      if (!response.ok) {
        const error = Error(`Hosting ${method} failed (${response.status}); no workaround or replay`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    };
    const latest = async () => {
      const value = (await request(`sites/${selected.site}/releases?pageSize=1`)).releases?.[0];
      if (!pattern.test(value?.version?.name || '')
        || !new RegExp(`^sites/${selected.site}/releases/[A-Za-z0-9_-]+$`).test(value?.name || '')) throw Error('Invalid production release');
      return value;
    };
    const filesFor = async version => {
      const files = [], seen = new Set(); let cursor;
      do {
        const page = await request(`${version}/files?pageSize=1000${cursor ? '&pageToken=' + encodeURIComponent(cursor) : ''}`);
        if (!Array.isArray(page.files)) throw Error('Incomplete Hosting manifest');
        files.push(...page.files); cursor = page.nextPageToken;
        if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || seen.has(cursor))) throw Error('Invalid manifest pagination');
        if (cursor) seen.add(cursor);
      } while (cursor);
      return files;
    };
    const liveBytes = async () => {
      const response = await fetchImpl(`https://${selected.site}.web.app${selected.resource}`, {
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw Error(`Live resource read failed (${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    };
    const assertVersion = async (name, manifest, config) => {
      const version = await request(name);
      if (version.name !== name || !isDeepStrictEqual(version.config, config)) throw Error('Hosting configuration changed');
      const files = await filesFor(name);
      makeManifest(files, newHash, selected.resource); // Also rejects duplicate paths during readback.
      assertManifest(files, manifest);
      return version;
    };
    const binding = { target, ...selected, baseCommit, sourceCommit: commit, sourceHash: sha(source), baseHash, newHash };
    const verifyPublished = async evidence => {
      if (!pattern.test(evidence.createdVersion || '') || !evidence.releaseIntentAt) throw Error('Uncertain intent; manual review required, no replay');
      const observed = await latest();
      if (observed.version.name !== evidence.createdVersion) throw Error('Release outcome unknown; no replay');
      if (!evidence.config || !Array.isArray(evidence.baselineFiles)
        || !isDeepStrictEqual(oneFileManifest(evidence.baselineFiles, selected.resource, baseHash, newHash), evidence.manifest)) {
        throw Error('Invalid saved one-file plan; no replay');
      }
      const version = await assertVersion(evidence.createdVersion, evidence.manifest, evidence.config);
      if (version.status !== 'FINALIZED' || !(await liveBytes()).equals(source)
        || (await latest()).name !== observed.name) throw Error('Release readback mismatch; no replay');
      return { ...evidence, verified: true, releaseName: observed.name, reconciled: true };
    };
    if (prior) {
      if (!isDeepStrictEqual(prior.binding, binding) || prior.baselineVersion !== expectedVersion) throw Error('Existing intent binding differs; no replay');
      // Existing attempts are only read back, never submitted again or silently rewritten.
      return { ...await verifyPublished(prior), mode: apply ? 'apply' : 'prepare',
        state: 'verified_readback', persistedState: prior.state };
    }
    const release = await latest();
    if (expectedVersion && release.version.name !== expectedVersion) throw Error('Stale expected production version');
    const baseline = await request(release.version.name);
    if (baseline.name !== release.version.name || baseline.status !== 'FINALIZED' || !baseline.config
      || typeof baseline.config !== 'object' || Array.isArray(baseline.config)) throw Error('Invalid active Hosting version');
    const files = await filesFor(baseline.name);
    const manifest = oneFileManifest(files, selected.resource, baseHash, newHash);
    if (!(await liveBytes()).equals(before)) throw Error('Live raw bytes differ from Git base');
    const evidence = { binding, mode: apply ? 'apply' : 'prepare', baselineVersion: baseline.name,
      baselineRelease: release.name, baselineFiles: files, manifest, config: baseline.config,
      changedPaths: [selected.resource], state: 'prepared' };
    const assertProduction = async () => {
      const now = await latest();
      if (now.name !== release.name || now.version.name !== baseline.name) throw Error('Stale production version; no release');
    };
    await assertProduction();
    if (!apply) return evidence;
    guard();
    await assertProduction();
    evidence.state = 'version_intent'; evidence.versionIntentAt = new Date().toISOString();
    journal = store.create(evidence);
    const created = await request(`sites/${selected.site}/versions`, 'POST', { config: baseline.config });
    if (!pattern.test(created.name || '') || created.name === baseline.name) throw Error('Unexpected new Hosting version');
    evidence.createdVersion = created.name; journal.save(evidence);
    const entries = Object.entries(manifest);
    for (let offset = 0; offset < entries.length; offset += 1000) {
      const result = await request(`${created.name}:populateFiles`, 'POST', { files: Object.fromEntries(entries.slice(offset, offset + 1000)) });
      const required = result.uploadRequiredHashes || [];
      if (!Array.isArray(required) || required.some(hash => hash !== newHash)) throw Error('Unrelated files require upload');
      if (required.length) {
        const url = new URL(result.uploadUrl);
        if (url.origin !== 'https://upload-firebasehosting.googleapis.com' || url.username || url.password || url.search || url.hash) {
          throw Error('Unexpected upload destination');
        }
        const response = await fetchImpl(url.href.replace(/\/$/, '') + '/' + newHash, { method: 'POST', redirect: 'error',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
          body: compressed, signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw Error(`Upload failed (${response.status}); no workaround or replay`);
      }
    }
    await assertVersion(created.name, manifest, baseline.config);
    await assertProduction();
    await request(`${created.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
    const finalized = await assertVersion(created.name, manifest, baseline.config);
    if (finalized.status !== 'FINALIZED') throw Error('Hosting version is not finalized');
    guard();
    if (!(await liveBytes()).equals(before)) throw Error('Live raw bytes changed before release');
    evidence.state = 'release_intent'; evidence.releaseIntentAt = new Date().toISOString(); journal.save(evidence);
    await assertProduction(); // Last provider read immediately before the irreversible release request.
    let transportError;
    try {
      const result = await request(`sites/${selected.site}/releases?versionName=${created.name}`, 'POST', {
        message: `Team ${lessonLabel} ${target} one-file release (${commit.slice(0, 12)})`,
      });
      evidence.releaseName = result.name;
    } catch (error) {
      transportError = error;
      if (Number.isInteger(error.status)) evidence.releaseErrorStatus = error.status;
    }
    let verified;
    try {
      verified = await verifyPublished(evidence);
    } catch (error) {
      evidence.state = 'unknown'; journal.save(evidence);
      throw transportError || error;
    }
    Object.assign(evidence, verified, { state: 'verified', verifiedAt: new Date().toISOString() });
    if (transportError) evidence.transportOutcome = Number.isInteger(transportError.status)
      ? 'provider_error_with_verified_readback' : 'ambiguous_reconciled_by_readback';
    journal.save(evidence);
    if (Number.isInteger(transportError?.status)) throw transportError;
    return evidence;
  } finally {
    try { journal?.close(); } finally { unlock(); }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  releaseTeamClassroom().then(value => console.log(JSON.stringify({
    mode: value.mode, target: value.binding.target, baselineVersion: value.baselineVersion,
    changedPaths: value.changedPaths, state: value.state, verified: value.verified === true,
  }))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
