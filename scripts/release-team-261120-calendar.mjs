import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertManifest } from './release-e261017-classroom.mjs';
import { TEAM_EVENT, renderTeamCalendarHtml, renderTeamCalendarIcs } from './build-team-261120-calendar.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SITE = 'archive-pilates-in';
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const VERSION = /^sites\/archive-pilates-in\/versions\/[A-Za-z0-9_-]+$/;
export const TEAM_CALENDAR_FILES = Object.freeze([
  '/method/team-261120/calendar/index.html', '/method/team-261120/calendar/archive-method-261120.ics',
]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function teamCalendarManifest(files, hashes) {
  if (!Array.isArray(files) || !hashes || typeof hashes !== 'object'
    || !isDeepStrictEqual(Object.keys(hashes).sort(), [...TEAM_CALENDAR_FILES].sort())) throw Error('Exact two calendar files required.');
  const result = {};
  for (const file of files) {
    if (typeof file?.path !== 'string' || !file.path.startsWith('/') || !validHash(file.hash)
      || Object.hasOwn(result, file.path) || file.path === '/method/team-261120'
      || file.path.startsWith('/method/team-261120/')) throw Error('Unexpected existing Team calendar surface.');
    result[file.path] = file.hash;
  }
  for (const file of TEAM_CALENDAR_FILES) {
    if (!validHash(hashes[file])) throw Error('Invalid calendar hash.');
    result[file] = hashes[file];
  }
  return result;
}

export function releaseArguments(args) {
  const versions = args.filter(a => a.startsWith('--expected-version='));
  if (new Set(args).size !== args.length || versions.length > 1
    || args.some(a => a !== '--apply' && !a.startsWith('--expected-version='))) throw Error('Invalid arguments.');
  const apply = args.includes('--apply'), expected = versions[0]?.slice(19);
  if ((versions.length && !VERSION.test(expected)) || (apply && !expected)) throw Error('Reviewed baseline version required.');
  return { apply, expected };
}

export function assertCleanMain(git, commit) {
  if (git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])
    || git(['rev-parse', 'HEAD']) !== commit || git(['rev-parse', 'origin/main']) !== commit) throw Error('Clean synchronized main required.');
}

export function assertCalendarSource(source) {
  if (!isDeepStrictEqual(Object.keys(source).sort(), [...TEAM_CALENDAR_FILES].sort())) throw Error('Exact two calendar sources required.');
  const html = source[TEAM_CALENDAR_FILES[0]].toString(), ics = source[TEAM_CALENDAR_FILES[1]].toString();
  const stamp = ics.match(/^DTSTAMP:(\d{8}T\d{6}Z)\r$/m)?.[1];
  if (!stamp || html !== renderTeamCalendarHtml() || ics !== renderTeamCalendarIcs(stamp)) throw Error('Team calendar source mismatch.');
}

// Dependencies are injectable so release safety can be exercised without credentials or network.
export async function releaseTeamCalendar({ args = process.argv.slice(2), root = ROOT, home = os.homedir(),
  git = a => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
  getToken = () => execFileSync('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim(),
  fetchImpl = fetch,
} = {}) {
  const { apply, expected } = releaseArguments(args);
  const commit = git(['rev-parse', 'HEAD']);
  if (apply) {
    git(['fetch', 'origin', 'main']);
    assertCleanMain(git, commit);
    git(['ls-files', '--error-unmatch', ...TEAM_CALENDAR_FILES.map(f => 'archivein' + f)]);
  }
  const source = Object.fromEntries(TEAM_CALENDAR_FILES.map(f => [f, fs.readFileSync(path.join(root, 'archivein' + f))]));
  assertCalendarSource(source);
  const blobs = Object.fromEntries(Object.entries(source).map(([f, b]) => [f, gzipSync(b, { level: 9 })]));
  const hashes = Object.fromEntries(Object.entries(blobs).map(([f, b]) => [f, sha(b)]));
  const token = getToken();
  const request = async (resource, method = 'GET', body) => {
    const r = await fetchImpl('https://firebasehosting.googleapis.com/v1beta1/' + resource, { method, redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw Error(`Hosting ${method} ${r.status}`);
    return r.json();
  };
  const latest = async () => (await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
  const filesFor = async name => {
    const rows = [], seen = new Set(); let cursor;
    do {
      const p = await request(`${name}/files?pageSize=1000${cursor ? '&pageToken=' + encodeURIComponent(cursor) : ''}`);
      if (!Array.isArray(p.files)) throw Error('Incomplete manifest.');
      rows.push(...p.files); cursor = p.nextPageToken;
      if (cursor && (typeof cursor !== 'string' || seen.has(cursor))) throw Error('Invalid manifest cursor.');
      seen.add(cursor);
    } while (cursor);
    return rows;
  };
  const release = await latest();
  if (!release?.name || !VERSION.test(release?.version?.name)
    || (expected && release.version.name !== expected)) throw Error('Live version changed.');
  const baseline = await request(release.version.name);
  if (baseline.name !== release.version.name || baseline.status !== 'FINALIZED'
    || !baseline.config || typeof baseline.config !== 'object' || Array.isArray(baseline.config)) throw Error('Invalid baseline config.');
  const files = await filesFor(baseline.name);
  if (!files.length) throw Error('Empty baseline manifest.');
  const manifest = teamCalendarManifest(files, hashes);
  for (const url of [...TEAM_CALENDAR_FILES.map(f => 'https://in.archivepilates.com' + f), TEAM_EVENT.url]) {
    const r = await fetchImpl(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (r.status !== 404) throw Error('New calendar URL must be absent before initial release.');
  }
  const evidence = { site: SITE, sourceCommit: commit, baselineVersion: baseline.name, addedPaths: TEAM_CALENDAR_FILES,
    preservedFiles: files.length, finalFiles: files.length + 2,
    sourceHashes: Object.fromEntries(Object.entries(source).map(([f, b]) => [f, sha(b)])), mode: apply ? 'apply' : 'plan' };
  if (!apply) return evidence;
  const directory = path.join(home, 'ArchiveIN/operations/november-instructor-confirmation-20261029');
  const lockDir = path.join(home, 'ArchiveIN/automation/locks');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  const out = path.join(directory, 'team-261120-calendar-release.json');
  const lock = path.join(lockDir, `firebase-hosting-${SITE}.lock`);
  const fd = fs.openSync(lock, 'wx', 0o600);
  let intent;
  const save = () => {
    fs.ftruncateSync(intent, 0);
    fs.writeSync(intent, JSON.stringify(evidence, null, 2), 0, 'utf8');
    fs.fsyncSync(intent);
  };
  const assertBaseline = async () => {
    const now = await latest();
    if (now?.name !== release.name || now?.version?.name !== baseline.name) throw Error('Concurrent release.');
  };
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, owner: 'team-calendar-261120', startedAt: new Date().toISOString() }));
    intent = fs.openSync(out, 'wx', 0o600);
    evidence.versionIntentAt = new Date().toISOString(); save();
    assertCleanMain(git, commit);
    await assertBaseline();
    const v = await request(`sites/${SITE}/versions`, 'POST', { config: baseline.config });
    evidence.createdVersion = v.name; save();
    if (!VERSION.test(v.name) || v.name === baseline.name) throw Error('Unexpected version.');
    const entries = Object.entries(manifest);
    for (let i = 0; i < entries.length; i += 1000) {
      const p = await request(`${v.name}:populateFiles`, 'POST', { files: Object.fromEntries(entries.slice(i, i + 1000)) });
      if (!Array.isArray(p.uploadRequiredHashes || [])) throw Error('Invalid upload requirements.');
      for (const h of p.uploadRequiredHashes || []) {
        const f = TEAM_CALENDAR_FILES.find(f => hashes[f] === h);
        if (!f) throw Error('Unexpected upload.');
        const u = new URL(p.uploadUrl);
        if (u.origin !== 'https://upload-firebasehosting.googleapis.com' || u.username || u.password || u.search || u.hash) throw Error('Unexpected upload host.');
        const r = await fetchImpl(u.href.replace(/\/$/, '') + '/' + h, { method: 'POST', redirect: 'error',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' },
          body: blobs[f], signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw Error('Upload failed.');
      }
    }
    assertManifest(await filesFor(v.name), manifest);
    if (!isDeepStrictEqual((await request(v.name)).config, baseline.config)) throw Error('Hosting config changed.');
    await assertBaseline();
    await request(v.name + '?updateMask=status', 'PATCH', { status: 'FINALIZED' });
    await assertBaseline();
    assertCleanMain(git, commit);
    evidence.releaseIntentAt = new Date().toISOString(); save();
    const r = await request(`sites/${SITE}/releases?versionName=${v.name}`, 'POST', {
      message: 'Team 261120 calendar additions only ' + commit.slice(0, 12),
    });
    evidence.releaseName = r.name; save();
    if ((await latest())?.version?.name !== v.name) throw Error('Release readback mismatch.');
    for (const [url, f] of [...TEAM_CALENDAR_FILES.map(f => ['https://in.archivepilates.com' + f, f]), [TEAM_EVENT.url, TEAM_CALENDAR_FILES[0]]]) {
      const r = await fetchImpl(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000) });
      if (!r.ok || sha(Buffer.from(await r.arrayBuffer())) !== sha(source[f])) throw Error('Live file mismatch.');
    }
    evidence.verified = true; evidence.verifiedAt = new Date().toISOString(); save();
    return evidence;
  } finally {
    try { if (intent !== undefined) fs.closeSync(intent); }
    finally { try { fs.closeSync(fd); } finally { fs.unlinkSync(lock); } }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  releaseTeamCalendar().then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error(JSON.stringify({ ok: false, code: 'TEAM_261120_CALENDAR_RELEASE_STOPPED', replay: false }));
    process.exitCode = 1;
  });
}
