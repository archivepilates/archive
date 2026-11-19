import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {assertManifest} from './release-e261017-classroom.mjs';
import {assertInstructorD1DirectoryEntry, assertInstructorD1RulesSource} from './release-instructor-d1-rules.mjs';
import {archiveAutomationRoot} from './lib/archive-automation-paths.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
export const RULES_BASE = '8772541dcc313d5368c9570b566e33cec5c1fa9b';
export const RULES_BASE_HASH = 'a3404c73078eaff111142f7e2b77f0edceac87bc1342acae193b659d77b02224';
export const MATERIAL_PATHS = Object.freeze(['/method/team-261120/index.html', '/method/team-261120/assignment/index.html']);
const TARGETS = {
  materials: {site: 'archive-pilates-in', prefix: 'archivein', paths: MATERIAL_PATHS,
    origins: ['https://in.archivepilates.com', 'https://archive-pilates-in.web.app']},
  rules: {site: 'archive-pilates-core', prefix: 'core', paths: ['/rules/index.html'],
    origins: ['https://core.archivepilates.com', 'https://archive-pilates-core.web.app']},
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashOK = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && value.length === 64;
const exactName = (value, site, kind) => typeof value === 'string'
  && new RegExp(`^sites/${site}/${kind}/[A-Za-z0-9_-]+$`).test(value) && value.trim() === value;
const digestManifest = manifest => sha(JSON.stringify(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b, 'en'))));
const configOK = config => config && typeof config === 'object' && !Array.isArray(config);

export function parseTeamD1Args(args) {
  let target, expected, apply = false;
  for (const arg of args) {
    if (arg === '--apply' && !apply) apply = true;
    else if (typeof arg === 'string' && arg.startsWith('--target=') && target === undefined) target = arg.slice(9);
    else if (typeof arg === 'string' && arg.startsWith('--expected-version=') && expected === undefined) expected = arg.slice(19);
    else throw Error('Invalid Team D-1 arguments');
  }
  if (!Object.hasOwn(TARGETS, target) || (expected !== undefined && !exactName(expected, TARGETS[target].site, 'versions'))
    || (apply && !expected)) throw Error('Exact target and reviewed site version required for apply');
  return {target, expected, apply};
}

export function assertTeamD1RulesNoteOnly(before, after) {
  before = Buffer.from(before); after = Buffer.from(after);
  const anchor = Buffer.from('<li id="instructor-d1-team-1400">');
  const start = before.indexOf(anchor), end = before.indexOf('</li>', start);
  if (start < 0 || end < 0 || before.indexOf(anchor, start + 1) !== -1) throw Error('Unique existing D-1 rule required');
  const cut = end + 5, added = after.length - before.length;
  if (added <= 0 || !after.subarray(0, cut).equals(before.subarray(0, cut))
    || !after.subarray(cut + added).equals(before.subarray(cut))) throw Error('Only an appended D-1 note is permitted');
  const note = after.subarray(cut, cut + added).toString('utf8');
  // One sibling list item, with all original whitespace and bytes retained after it.
  if (!Buffer.from(note).equals(after.subarray(cut, cut + added))
    || !/^\r?\n[ \t]*<li(?:\s[^<>]*)?>[\s\S]+<\/li>$/.test(note)
    || /<\/?(?:li\b|script\b|style\b)/i.test(note.replace(/^\r?\n[ \t]*<li(?:\s[^<>]*)?>/, '').replace(/<\/li>$/, '')))
    throw Error('Append exactly one nonempty sibling li immediately after the D-1 rule');
}

function fileMap(files) {
  if (!Array.isArray(files) || !files.length) throw Error('Complete nonempty manifest required');
  const result = {};
  for (const file of files) {
    const name = file?.path;
    if (typeof name !== 'string' || !name.startsWith('/') || name.endsWith('/')
      || /[\\%?#\u0000-\u0020\u007f]/.test(name) || path.posix.normalize(name) !== name
      || !hashOK(file.hash) || Object.hasOwn(result, name)) throw Error('Invalid or duplicate Hosting path/hash');
    result[name] = file.hash;
  }
  return result;
}

export function teamD1Manifest(target, files, replacements) {
  if (!Object.hasOwn(TARGETS, target) || !replacements
    || !isDeepStrictEqual(Object.keys(replacements).sort(), [...TARGETS[target].paths].sort())
    || Object.values(replacements).some(hash => !hashOK(hash))) throw Error('Exact target paths and hashes required');
  const manifest = fileMap(files);
  for (const resource of TARGETS[target].paths) {
    if (target === 'materials') {
      const route = resource.slice(0, -'/index.html'.length);
      if ([resource, route, route + '.html'].some(name => Object.hasOwn(manifest, name))) throw Error('Material must be an initial addition');
    } else if (!Object.hasOwn(manifest, resource) || manifest[resource] === replacements[resource]) throw Error('Existing changed rules required');
    manifest[resource] = replacements[resource];
  }
  return manifest;
}

export function teamD1Uploads(result, batch, replacements, uploaded = new Set()) {
  const needed = result?.uploadRequiredHashes === undefined ? [] : result.uploadRequiredHashes;
  if (!Array.isArray(needed) || needed.some(hash => !hashOK(hash)
    || !Object.keys(replacements).some(resource => replacements[resource] === hash && batch[resource] === hash)))
    throw Error('Only target compressed hashes in this populate batch may upload');
  const hashes = [...new Set(needed)].filter(hash => !uploaded.has(hash));
  if (!hashes.length) return [];
  const url = new URL(result.uploadUrl);
  if (url.origin !== 'https://upload-firebasehosting.googleapis.com' || url.username || url.password || url.search || url.hash
    || /%|\\/.test(result.uploadUrl)) throw Error('Unexpected upload host');
  return hashes.map(hash => ({hash, url: `${url.href.replace(/\/$/, '')}/${hash}`}));
}

// Injected Git/auth/transport let tests exercise the real state machine entirely offline.
export async function releaseTeamD1({args = process.argv.slice(2), root = ROOT, home = os.homedir(),
  git = args => execFileSync('git', args, {cwd: root, stdio: ['ignore', 'pipe', 'pipe']}),
  getToken = () => execFileSync('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000}).trim(), fetchImpl = fetch,
} = {}) {
  const {target, expected, apply} = parseTeamD1Args(args), spec = TARGETS[target];
  const textGit = args => String(git(args)).trim(), commit = textGit(['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Committed HEAD required');
  const readSource = resource => {
    const file = spec.prefix + resource;
    let current = root;
    for (const segment of file.split('/')) {
      current = path.join(current, segment);
      if (fs.lstatSync(current).isSymbolicLink()) throw Error('Source symlink forbidden');
    }
    if (!fs.lstatSync(current).isFile()) throw Error('Regular source file required');
    git(['ls-files', '--error-unmatch', file]);
    const bytes = fs.readFileSync(current);
    if (!bytes.equals(Buffer.from(git(['show', `HEAD:${file}`])))) throw Error('Source differs from committed HEAD');
    return bytes;
  };
  const source = Object.fromEntries(spec.paths.map(resource => [resource, readSource(resource)]));
  if (target === 'rules') {
    git(['merge-base', '--is-ancestor', RULES_BASE, commit]);
    const before = Buffer.from(git(['show', `${RULES_BASE}:core/rules/index.html`]));
    if (sha(before) !== RULES_BASE_HASH) throw Error('Pinned Git rules baseline changed');
    assertTeamD1RulesNoteOnly(before, source['/rules/index.html']);
  }
  const sourceHashes = Object.fromEntries(spec.paths.map(resource => [resource, sha(source[resource])]));
  const compressed = Object.fromEntries(spec.paths.map(resource => [resource, gzipSync(source[resource], {level: 9})]));
  const replacements = Object.fromEntries(spec.paths.map(resource => [resource, sha(compressed[resource])]));
  const clean = (fresh = false) => {
    if (apply) {
      if (fresh) {
        git(['fetch', 'origin', 'main']);
        if (textGit(['rev-parse', 'FETCH_HEAD']) !== commit) throw Error('Fresh origin/main differs');
      }
      assertInstructorD1RulesSource({branch: textGit(['branch', '--show-current']), status: textGit(['status', '--porcelain']),
        head: textGit(['rev-parse', 'HEAD']), remote: textGit(['rev-parse', 'origin/main'])}, commit);
    } else if (textGit(['rev-parse', 'HEAD']) !== commit) throw Error('Source HEAD changed');
    for (const resource of spec.paths) if (sha(readSource(resource)) !== sourceHashes[resource]) throw Error('Source changed');
  };
  const automationRoot = archiveAutomationRoot(home);
  const directory = path.join(automationRoot, 'operations/2026-11-19-team-261120-d1');
  const receipt = path.join(directory, `${target}-hosting-release.json`);
  const exists = file => fs.lstatSync(file, {throwIfNoEntry: false}) !== undefined;
  const privateDir = (directory, privateLeaf = true, create = true) => {
    assertInstructorD1DirectoryEntry(fs.lstatSync(home), {privateLeaf: false});
    let current = home;
    for (const segment of path.relative(home, directory).split(path.sep)) {
      current = path.join(current, segment);
      if (create) {try {fs.mkdirSync(current, {mode: 0o700});} catch (error) {if (error.code !== 'EEXIST') throw error;}}
      assertInstructorD1DirectoryEntry(fs.lstatSync(current), {leaf: current === directory, privateLeaf});
    }
  };
  const priorIntent = exists(receipt);
  if (apply && priorIntent) throw Error('Existing intent: GET-only reconciliation required; never replay');
  clean(apply);
  const token = getToken();
  if (typeof token !== 'string' || !token.trim()) throw Error('Operator authentication unavailable');
  const request = async (name, method = 'GET', body) => {
    if (!apply && method !== 'GET') throw Error('Plan/reconciliation permits GET only');
    if (method !== 'GET') await beforeMutation();
    const response = await fetchImpl(API + name, {method, redirect: 'error',
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000)});
    if (!response.ok) throw Error(`Hosting ${method} failed (${response.status}); never replay writes`);
    return response.json();
  };
  const latest = async () => {
    const release = (await request(`sites/${spec.site}/releases?pageSize=1`)).releases?.[0];
    if (!exactName(release?.name, spec.site, 'releases') || !exactName(release?.version?.name, spec.site, 'versions')) throw Error('Invalid latest release');
    return release;
  };
  const filesFor = async name => {
    const files = [], seen = new Set(); let cursor;
    do {
      const page = await request(`${name}/files?pageSize=1000${cursor ? '&pageToken=' + encodeURIComponent(cursor) : ''}`);
      if (!Array.isArray(page.files)) throw Error('Incomplete Hosting manifest');
      files.push(...page.files); cursor = page.nextPageToken;
      if (cursor !== undefined && (typeof cursor !== 'string' || (cursor && seen.has(cursor)))) throw Error('Invalid manifest cursor');
      if (cursor) seen.add(cursor);
    } while (cursor);
    fileMap(files); return files;
  };
  const live = async (hashes, absent = false) => {
    for (const origin of spec.origins) for (const resource of spec.paths) {
      const route = resource.slice(0, -'/index.html'.length);
      for (const suffix of [resource, route, route + '/']) {
        const response = await fetchImpl(origin + suffix, {method: 'GET', cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(60000)});
        // A bare directory commonly redirects to its slash route; follow only that exact same-origin route.
        if (suffix === route && [301, 302, 307, 308].includes(response.status)
          && new URL(response.headers.get('location'), origin + suffix).href === origin + route + '/') continue;
        if (absent ? response.status !== 404 : !response.ok || sha(Buffer.from(await response.arrayBuffer())) !== hashes[resource])
          throw Error('Live route mismatch/propagation pending; reconcile GET-only, never release again');
      }
    }
  };
  let evidence;
  if (priorIntent) {
    privateDir(directory, true, false);
    const stat = fs.lstatSync(receipt);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.nlink !== 1) throw Error('Unsafe private intent');
    evidence = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    if (evidence.site !== spec.site || evidence.target !== target || evidence.sourceCommit !== commit
      || !isDeepStrictEqual(evidence.sourceHashes, sourceHashes) || !isDeepStrictEqual(evidence.compressedHashes, replacements)
      || !exactName(evidence.baselineVersion, spec.site, 'versions') || !exactName(evidence.baselineRelease, spec.site, 'releases')) throw Error('Intent/source identity mismatch');
  }
  const release = await latest();
  if (expected && release.version.name !== expected) throw Error('Live version differs from reviewed version');
  const baselineName = evidence?.baselineVersion || release.version.name;
  const baseline = await request(baselineName);
  if (baseline.name !== baselineName || baseline.status !== 'FINALIZED' || !configOK(baseline.config)) throw Error('Invalid baseline configuration');
  const files = await filesFor(baselineName), priorManifest = fileMap(files);
  const manifest = teamD1Manifest(target, files, replacements);
  const proof = {baselineManifestSha256: digestManifest(priorManifest), manifestSha256: digestManifest(manifest), configSha256: sha(JSON.stringify(baseline.config))};
  const verifyNew = async (name, status) => {
    if (!exactName(name, spec.site, 'versions') || name === baselineName) throw Error('Unexpected created version');
    const version = await request(name);
    if (version.name !== name || version.status !== status || !isDeepStrictEqual(version.config, baseline.config)) throw Error('Version/config/status mismatch');
    assertManifest(await filesFor(name), manifest);
  };
  if (priorIntent) {
    if (!Object.entries(proof).every(([key, value]) => evidence[key] === value)) throw Error('Intent manifest/config mismatch');
    if (evidence.createdVersion && release.version.name === evidence.createdVersion) {
      await verifyNew(evidence.createdVersion, 'FINALIZED'); await live(sourceHashes); clean();
      if (!isDeepStrictEqual(await latest(), release)) throw Error('Concurrent reconciliation release');
      return {...evidence, mode: 'reconcile', verified: true, observedRelease: release.name};
    }
    return {...evidence, mode: 'reconcile', verified: false, observedRelease: release.name, next: 'Read-only operator reconciliation; never replay'};
  }
  const baselineHashes = target === 'rules' ? {'/rules/index.html': RULES_BASE_HASH} : {};
  const priorUnchanged = async () => {
    if (!isDeepStrictEqual(await request(baselineName), baseline)) throw Error('Prior version changed');
    assertManifest(await filesFor(baselineName), priorManifest);
  };
  const beforeMutation = async () => {
    clean();
    const current = await latest();
    if (current.name !== release.name || current.version.name !== baselineName) throw Error('Concurrent release');
    await priorUnchanged();
  };
  await live(baselineHashes, target === 'materials'); await beforeMutation();
  evidence = {target, site: spec.site, account: ACCOUNT, sourceCommit: commit, baselineVersion: baselineName,
    baselineRelease: release.name, ...(target === 'rules' ? {baselineCommit: RULES_BASE, baselineRawSha256: RULES_BASE_HASH} : {}),
    ...proof, sourceHashes, compressedHashes: replacements, changedPaths: spec.paths,
    priorFileCount: files.length, fileCount: Object.keys(manifest).length, mode: apply ? 'apply' : 'plan'};
  if (!apply) return evidence;

  privateDir(directory);
  const lockDir = path.join(automationRoot, 'automation/locks'); privateDir(lockDir, false);
  const syncDir = directory => {const fd = fs.openSync(directory, 'r'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}};
  const write = (file, flag) => {
    const fd = fs.openSync(file, flag, 0o600);
    try {fs.writeFileSync(fd, JSON.stringify(evidence, null, 2)); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  };
  const save = () => {const tmp = receipt + '.tmp'; write(tmp, 'wx'); fs.renameSync(tmp, receipt); syncDir(directory);};
  const lock = path.join(lockDir, `firebase-hosting-${spec.site}.lock`), fd = fs.openSync(lock, 'wx', 0o600);
  const lockStat = fs.fstatSync(fd);
  try {
    fs.writeSync(fd, JSON.stringify({pid: process.pid, operation: `team-261120-d1-${target}`, at: new Date().toISOString()}));
    fs.fsyncSync(fd); syncDir(lockDir);
    if (exists(receipt)) throw Error('Existing intent; never replay');
    clean(true); await beforeMutation(); await live(baselineHashes, target === 'materials');
    evidence.versionCreateIntentAt = new Date().toISOString(); write(receipt, 'wx'); syncDir(directory);
    const version = await request(`sites/${spec.site}/versions`, 'POST', {config: baseline.config});
    if (!exactName(version.name, spec.site, 'versions') || version.name === baselineName) throw Error('Unexpected created version');
    evidence.createdVersion = version.name; save();
    const entries = Object.entries(manifest), uploaded = new Set();
    for (let offset = 0; offset < entries.length; offset += 1000) {
      const batch = Object.fromEntries(entries.slice(offset, offset + 1000));
      evidence.populateIntent = {offset, at: new Date().toISOString()}; save();
      const result = await request(`${version.name}:populateFiles`, 'POST', {files: batch});
      for (const upload of teamD1Uploads(result, batch, replacements, uploaded)) {
        evidence.uploadIntent = {hash: upload.hash, at: new Date().toISOString()}; save();
        await beforeMutation();
        const resource = spec.paths.find(resource => replacements[resource] === upload.hash);
        const response = await fetchImpl(upload.url, {method: 'POST', redirect: 'error', headers: {Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream'}, body: compressed[resource], signal: AbortSignal.timeout(60000)});
        if (!response.ok) throw Error('Upload failed; never replay');
        uploaded.add(upload.hash);
      }
    }
    clean(true); await verifyNew(version.name, 'CREATED');
    evidence.finalizeIntentAt = new Date().toISOString(); save();
    await request(`${version.name}?updateMask=status`, 'PATCH', {status: 'FINALIZED'});
    clean(true); await verifyNew(version.name, 'FINALIZED');
    evidence.releaseIntentAt = new Date().toISOString(); save();
    const published = await request(`sites/${spec.site}/releases?versionName=${version.name}`, 'POST', {
      message: `Team 261120 D-1 ${target} only (${commit.slice(0, 12)})`,
    });
    if (!exactName(published.name, spec.site, 'releases') || published.name === release.name || published.version?.name !== version.name) throw Error('Ambiguous release; never replay');
    evidence.releaseName = published.name; save();
    const verifyLatest = async () => {
      const current = await latest();
      if (current.name !== published.name || current.version.name !== version.name) throw Error('Release readback mismatch; never replay');
    };
    await verifyLatest(); await verifyNew(version.name, 'FINALIZED'); await priorUnchanged();
    await live(sourceHashes); clean(); await verifyLatest();
    evidence.verifiedAt = new Date().toISOString(); evidence.verified = true; save(); return evidence;
  } finally {
    fs.closeSync(fd);
    const current = fs.lstatSync(lock);
    if (current.ino === lockStat.ino && current.dev === lockStat.dev) {fs.unlinkSync(lock); syncDir(lockDir);}
    else throw Error('Hosting lock ownership changed; retained');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  releaseTeamD1().then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(() => {console.error('Team D-1 stopped; never replay an intent. Reconcile GET-only.'); process.exitCode = 1;});
}
