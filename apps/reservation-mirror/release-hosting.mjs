import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const APP = 'apps/reservation-mirror';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const TARGETS = Object.freeze({
  'archive-pilates-booking-test': Object.freeze({
    '/index.html': `${APP}/dist/index.html`, '/app.js': `${APP}/dist/app.js`,
    '/style.css': `${APP}/dist/style.css`, '/symbol.png': `${APP}/dist/symbol.png`,
  }),
  'archive-pilates-core': Object.freeze({'/rules/index.html': 'core/rules/index.html'}),
});
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const configHash = value => sha256(JSON.stringify(canonical(value)));

export function releaseTarget(site) {
  if (!Object.hasOwn(TARGETS, site)) throw Error('Only the mirror site or CORE rules-only site is allowed');
  return {site, files: {...TARGETS[site]}};
}

export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    const key = {'--site': 'site', '--expected-version': 'expectedVersion', '--plan': 'plan', '--apply': 'apply'}[flag];
    if (!key || Object.hasOwn(options, key)) throw Error('Unknown or duplicate release option');
    if (['plan', 'apply'].includes(key)) {
      if (inline !== undefined) throw Error('Mode flags do not accept values');
      options[key] = true;
    } else {
      const value = inline ?? args[++i];
      if (!value || value.startsWith('--')) throw Error('Missing release option value');
      options[key] = value;
    }
  }
  releaseTarget(options.site);
  if (Boolean(options.plan) === Boolean(options.apply)) throw Error('Choose exactly one of --plan or --apply');
  if (options.apply && !options.expectedVersion) throw Error('Apply requires --expected-version from the reviewed plan');
  if (options.plan && options.expectedVersion) throw Error('--expected-version is only accepted with --apply');
  if (options.expectedVersion) assertVersion(options.site, options.expectedVersion);
  return options;
}

function assertVersion(site, name) {
  if (typeof name !== 'string' || !name.startsWith(`sites/${site}/versions/`)
      || !/^[A-Za-z0-9_-]+$/.test(name.slice(`sites/${site}/versions/`.length))) throw Error('Unexpected Hosting version');
}

export function manifestMap(files) {
  if (!Array.isArray(files) || !files.length) throw Error('Empty or invalid Hosting manifest');
  const result = {};
  for (const file of files) {
    if (typeof file.path !== 'string' || !file.path.startsWith('/') || /[\x00-\x1f\\?#]/.test(file.path)
        || path.posix.normalize(file.path) !== file.path || !HASH.test(file.hash)) throw Error('Invalid Hosting manifest entry');
    if (Object.hasOwn(result, file.path)) throw Error('Duplicate Hosting manifest path');
    result[file.path] = file.hash;
  }
  return result;
}

export function makeManifest(site, files, replacements) {
  const allowed = releaseTarget(site).files;
  if (configHash(Object.keys(replacements).sort()) !== configHash(Object.keys(allowed).sort())) throw Error('Replacement paths must match the exact site asset scope');
  const result = manifestMap(files);
  for (const [resource, hash] of Object.entries(replacements)) {
    if (!Object.hasOwn(result, resource)) throw Error('Baseline target asset is missing');
    if (!HASH.test(hash)) throw Error('Invalid replacement hash');
    result[resource] = hash;
  }
  return result;
}

export function assertManifest(files, expected) {
  if (configHash(manifestMap(files)) !== configHash(expected)) throw Error('Whole Hosting manifest differs from the reviewed plan');
}

export function assertProductionBundle(bytes) {
  const text = Buffer.from(bytes).toString('utf8');
  for (const marker of ['synthetic-preview-token', 'synthetic-browser-preview', 'SYNTHETIC_PREVIEW',
    'demo-synthetic', 'demo.invalid', 'preview-auth', 'preview-app']) {
    if (text.toLowerCase().includes(marker.toLowerCase())) throw Error('Test auth mock marker found in production bundle');
  }
  if (!text.includes('identitytoolkit.googleapis.com') || !text.includes('signInWithPassword')) throw Error('Production Firebase Auth bundle is missing');
}

export function assertMirrorAssets(assets, {index, style, symbol, rebuiltBundle}) {
  const expected = Object.keys(releaseTarget('archive-pilates-booking-test').files).sort();
  if (configHash(Object.keys(assets).sort()) !== configHash(expected)) throw Error('Mirror build must contain exactly four assets');
  for (const [resource, source] of [['/index.html', index], ['/style.css', style], ['/symbol.png', symbol], ['/app.js', rebuiltBundle]]) {
    if (!Buffer.from(assets[resource]).equals(Buffer.from(source))) throw Error(`Stale or unverified build asset: ${resource}`);
  }
  assertProductionBundle(assets['/app.js']);
}

export function assertGitSource({branch, head, originMain, remoteMain, status}) {
  if (status) throw Error('Apply requires a clean tracked Git source checkout, including untracked files');
  if (!/^[a-f0-9]{40}$/.test(head) || head !== originMain || head !== remoteMain) throw Error('Apply requires HEAD exactly equal to local and live origin/main');
  if (!['main', 'HEAD'].includes(branch)) throw Error('Release from clean main or detached exact origin/main');
}

export function uploadUrl(base, hash) {
  const url = new URL(base);
  if (url.origin !== 'https://upload-firebasehosting.googleapis.com' || url.username || url.password
      || url.search || url.hash || !HASH.test(hash)) throw Error('Unexpected Hosting upload destination');
  return `${url.href.replace(/\/$/, '')}/${hash}`;
}

export function makePlan(site, release, baseline, files, assets, source) {
  assertVersion(site, baseline.name);
  if (release.version?.name !== baseline.name || !release.name?.startsWith(`sites/${site}/releases/`)
      || baseline.status !== 'FINALIZED' || !baseline.config || typeof baseline.config !== 'object' || Array.isArray(baseline.config)) throw Error('A finalized live Hosting baseline is required');
  const hashes = Object.fromEntries(Object.entries(assets).map(([key, bytes]) => [key, sha256(gzipSync(bytes, {level: 9}))]));
  const before = manifestMap(files), manifest = makeManifest(site, files, hashes);
  const changes = Object.entries(hashes).filter(([key, hash]) => before[key] !== hash)
    .map(([resource, hash]) => ({path: resource, before: before[resource], after: hash, sourceHash: sha256(assets[resource])}));
  return {schema: 1, site, baselineVersion: baseline.name, baselineRelease: release.name,
    configHash: configHash(baseline.config), baselineFilesHash: configHash(before),
    manifestHash: configHash(manifest), fileCount: files.length, source, changes};
}

// The injected API makes the write protocol testable without credentials or network.
export async function publishFiles({plan, baseline, files, assets, api, checkSource, progress}) {
  const freshPlan = makePlan(plan.site, {name: plan.baselineRelease, version: {name: baseline.name}}, baseline, files, assets, plan.source);
  if (configHash(freshPlan) !== configHash(plan)) throw Error('Baseline or assets no longer match the reviewed plan');
  if (!plan.changes.length) throw Error('No changed assets to release');
  const guard = async () => {
    const current = await api.latest();
    if (current?.name !== plan.baselineRelease || current?.version?.name !== plan.baselineVersion) throw Error('Concurrent Hosting release detected');
  };
  const hashes = Object.fromEntries(Object.entries(assets).map(([p, b]) => [p, sha256(gzipSync(b, {level: 9}))]));
  const manifest = makeManifest(plan.site, files, hashes);
  const uploads = new Map(plan.changes.map(change => [change.after, gzipSync(assets[change.path], {level: 9})]));
  await checkSource(); await guard();
  const created = await api.request(`sites/${plan.site}/versions`, 'POST', {config: structuredClone(baseline.config)});
  assertVersion(plan.site, created.name);
  if (created.name === baseline.name) throw Error('Hosting returned the baseline as the new version');
  await progress({createdVersion: created.name});
  const entries = Object.entries(manifest), uploaded = new Set();
  for (let i = 0; i < entries.length; i += 1000) {
    const result = await api.request(`${created.name}:populateFiles`, 'POST', {files: Object.fromEntries(entries.slice(i, i + 1000))});
    const required = result.uploadRequiredHashes || [];
    if (!Array.isArray(required) || required.some(hash => !uploads.has(hash))) throw Error('Unexpected upload hash: unchanged live files must already exist');
    for (const hash of new Set(required)) {
      if (uploaded.has(hash)) continue;
      const destination = uploadUrl(result.uploadUrl, hash);
      await api.upload(destination, uploads.get(hash)); uploaded.add(hash);
    }
  }
  const verify = async () => {
    assertManifest(await api.filesFor(created.name), manifest);
    const version = await api.request(created.name);
    if (version.name !== created.name || configHash(version.config) !== plan.configHash) throw Error('Live Hosting configuration was not preserved exactly');
  };
  await verify(); await checkSource(); await guard();
  await api.request(`${created.name}?updateMask=status`, 'PATCH', {status: 'FINALIZED'});
  await verify(); await guard(); await checkSource();
  // Persist intent before the irreversible release request; ambiguous responses must not be replayed.
  await progress({releaseIntentAt: new Date().toISOString()});
  const released = await api.request(`sites/${plan.site}/releases?versionName=${encodeURIComponent(created.name)}`, 'POST', {
    message: `ARCHIVE PILATES scoped Hosting files (${plan.source.commit.slice(0, 12)})`,
  });
  await progress({releaseName: released.name, releaseTime: released.releaseTime});
  const current = await api.latest();
  if (current?.version?.name !== created.name || current?.name !== released.name) throw Error('Hosting release readback mismatch; do not replay apply');
  await verify();
  return {version: created.name, releaseName: released.name};
}

function git(args, binary = false) {
  try { return execFileSync('git', args, {cwd: ROOT, encoding: binary ? undefined : 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000}); }
  catch { throw Error('Git source verification failed'); }
}

function gitState(apply) {
  if (fs.realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== fs.realpathSync(ROOT)) throw Error('Unexpected Git source root');
  const state = {head: git(['rev-parse', 'HEAD']).trim(), branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()};
  if (apply) {
    Object.assign(state, {originMain: git(['rev-parse', 'origin/main']).trim(),
      remoteMain: git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']).trim().split(/\s+/)[0],
      status: git(['status', '--porcelain', '--untracked-files=all']).trim()});
    assertGitSource(state);
  }
  return state;
}

async function loadSource(site, apply) {
  const target = releaseTarget(site), state = gitState(apply);
  const assets = Object.fromEntries(Object.entries(target.files).map(([p, local]) => [p, fs.readFileSync(path.join(ROOT, local))]));
  const inputs = new Set([`${APP}/release-hosting.mjs`, `${APP}/test/release-hosting.test.mjs`]);
  if (site === 'archive-pilates-booking-test') {
    const {build} = await import('esbuild');
    const dist = path.join(ROOT, APP, 'dist');
    if (fs.readdirSync(dist).sort().join('|') !== 'app.js|index.html|style.css|symbol.png'
        || Object.keys(target.files).some(p => !fs.lstatSync(path.join(dist, p.slice(1))).isFile())) throw Error('Unexpected file or symlink in mirror dist');
    const built = await build({absWorkingDir: ROOT, entryPoints: [path.join(ROOT, APP, 'web/app.js')], bundle: true,
      format: 'esm', outfile: path.join(dist, 'app.js'), minify: true, target: 'es2022', write: false, metafile: true, logLevel: 'silent'});
    for (const input of Object.keys(built.metafile.inputs)) {
      const relative = path.relative(ROOT, path.resolve(ROOT, input)).split(path.sep).join('/');
      if (relative.startsWith(`${APP}/web/`)) inputs.add(relative);
      else if (!relative.startsWith(`${APP}/node_modules/`)) throw Error('Bundle input outside production web sources and dependencies');
    }
    for (const file of [`${APP}/web/index.html`, `${APP}/web/style.css`, `${APP}/build.mjs`, `${APP}/package.json`, `${APP}/package-lock.json`, 'core/icons/archive-pilates-icon-192.png']) inputs.add(file);
    assertMirrorAssets(assets, {index: fs.readFileSync(path.join(ROOT, APP, 'web/index.html')),
      style: fs.readFileSync(path.join(ROOT, APP, 'web/style.css')),
      symbol: fs.readFileSync(path.join(ROOT, 'core/icons/archive-pilates-icon-192.png')), rebuiltBundle: built.outputFiles[0].contents});
  } else inputs.add('core/rules/index.html');
  const source = {commit: state.head, files: Object.fromEntries([...inputs].sort().map(file => {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    if (apply) {
      git(['ls-files', '--error-unmatch', '--', file]);
      if (!bytes.equals(git(['show', `${state.head}:${file}`], true))) throw Error('Source bytes differ from the tracked release commit');
    }
    return [file, sha256(bytes)];
  }))};
  return {assets, source};
}

function hostingApi() {
  let token;
  try { token = execFileSync('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000}).trim(); }
  catch { throw Error('Unable to obtain the fixed operator account access token'); }
  if (!token || /\s/.test(token)) throw Error('Invalid operator access token');
  const request = async (resource, method = 'GET', body) => {
    let response;
    try { response = await fetch(API + resource, {method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)}); }
    catch { throw Error(`Hosting API transport failed (${method}); inspect release state before retrying`); }
    if (!response.ok) throw Error(`Hosting API returned ${response.status} (${method})`);
    try { return await response.json(); } catch { throw Error('Hosting API returned an unreadable response'); }
  };
  return {request,
    latest: async site => (await request(`sites/${site}/releases?pageSize=1`)).releases?.[0],
    filesFor: async version => {
      const files = [], seen = new Set(); let pageToken;
      do {
        const page = await request(`${version}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
        if (!Array.isArray(page.files || [])) throw Error('Invalid Hosting file page');
        files.push(...(page.files || [])); pageToken = page.nextPageToken;
        if (pageToken && seen.has(pageToken)) throw Error('Repeated Hosting file page');
        seen.add(pageToken);
      } while (pageToken);
      return files;
    },
    upload: async (url, bytes) => {
      let response;
      try { response = await fetch(url, {method: 'POST', redirect: 'error', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream'}, body: bytes, signal: AbortSignal.timeout(60000)}); }
      catch { throw Error('Hosting asset upload transport failed'); }
      if (!response.ok) throw Error(`Hosting asset upload returned ${response.status}`);
    },
  };
}

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600}); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function lockSite(site) {
  const dir = path.join(os.homedir(), 'ArchiveIN/automation/locks'); fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `firebase-hosting-${site}.lock`);
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch { throw Error('Site Hosting lock is held or unavailable; inspect its owner, never remove it automatically'); }
  const owned = fs.fstatSync(fd);
  const release = () => {
    fs.closeSync(fd);
    const current = fs.lstatSync(file, {throwIfNoEntry: false});
    if (current?.ino === owned.ino && current?.dev === owned.dev) fs.unlinkSync(file);
  };
  try { fs.writeSync(fd, JSON.stringify({pid: process.pid, owner: 'reservation-mirror-file-release', startedAt: new Date().toISOString()})); }
  catch { release(); throw Error('Unable to record site Hosting lock ownership'); }
  return release;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args), {site} = options;
  const runtime = path.join(ROOT, APP, '.runtime');
  const planFile = path.join(runtime, `release-${site}-plan.json`), resultFile = path.join(runtime, `release-${site}-result.json`);
  const loaded = await loadSource(site, options.apply);
  const transport = hostingApi(), api = {...transport, latest: () => transport.latest(site)};
  const capture = async () => {
    const release = await api.latest(); assertVersion(site, release?.version?.name);
    const baseline = await api.request(release.version.name), files = await api.filesFor(baseline.name);
    const plan = makePlan(site, release, baseline, files, loaded.assets, loaded.source);
    const after = await api.latest();
    if (after?.name !== release.name || after?.version?.name !== baseline.name) throw Error('Concurrent Hosting release detected during planning');
    return {plan, baseline, files};
  };
  if (options.plan) {
    const {plan} = await capture(); saveJson(planFile, plan); console.log(JSON.stringify(plan, null, 2)); return;
  }
  const reviewed = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (reviewed.site !== site || reviewed.baselineVersion !== options.expectedVersion) throw Error('Expected version does not match the reviewed site plan');
  const unlock = lockSite(site);
  try {
    if (fs.existsSync(resultFile)) {
      const previous = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      if (previous.releaseIntentAt && !previous.verified) throw Error('Unresolved prior release intent: read-only verification and operator resolution required before another apply');
    }
    const {plan, baseline, files} = await capture();
    if (configHash(plan) !== configHash(reviewed)) throw Error('Live baseline, build or Git source changed since the reviewed plan');
    const evidence = {site, baselineVersion: plan.baselineVersion, sourceCommit: plan.source.commit,
      configHash: plan.configHash, manifestHash: plan.manifestHash, changedPaths: plan.changes.map(c => c.path)};
    const progress = async patch => { Object.assign(evidence, patch); saveJson(resultFile, evidence); };
    const checkSource = async () => {
      const current = await loadSource(site, true);
      if (configHash(current.source) !== configHash(loaded.source)
          || Object.entries(loaded.assets).some(([p, b]) => !current.assets[p].equals(b))) throw Error('Git source or build changed during release');
    };
    await publishFiles({plan, baseline, files, assets: loaded.assets, api, checkSource, progress});
    for (const change of plan.changes) {
      let response;
      try { response = await fetch(`https://${site}.web.app${change.path}`, {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000)}); }
      catch { throw Error('Public asset verification failed; do not replay apply'); }
      if (!response.ok || sha256(Buffer.from(await response.arrayBuffer())) !== change.sourceHash) throw Error('Public asset hash differs after release; do not replay apply');
    }
    await progress({verified: true}); console.log(JSON.stringify(evidence, null, 2));
  } finally { unlock(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Scoped Hosting release stopped. No automatic retry or rollback. Inspect the reviewed plan and release-result state; never replay an ambiguous release request.'); process.exitCode = 1; });
}
