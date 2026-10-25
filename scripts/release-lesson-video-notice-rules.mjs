import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';

export const BASE = '89020f76e77c49d0a2fe7d81352163bd56e9dfc0';
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const SOURCE = 'core/rules/index.html';
const API = 'https://firebasehosting.googleapis.com/v1beta1/';
export const TARGETS = Object.freeze({
  rules: Object.freeze({ site: 'archive-pilates', resource: '/core/rules/index.html', source: SOURCE,
    url: 'https://archive-pilates.web.app/core/rules/' }),
  'core-rules': Object.freeze({ site: 'archive-pilates-core', resource: '/rules/index.html', source: SOURCE,
    url: 'https://archive-pilates-core.web.app/rules/' }),
});
const sha = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (ok, message) => { if (!ok) throw Error(message); };

function utf8(value) {
  check(typeof value === 'string' || Buffer.isBuffer(value), 'Rules source must be UTF-8 bytes');
  const bytes = Buffer.from(value), text = bytes.toString('utf8');
  check(Buffer.from(text, 'utf8').equals(bytes), 'Invalid UTF-8 rules source');
  return text;
}

export function assertLessonVideoNoticeRulesScope(before, after, target) {
  check(Object.hasOwn(TARGETS, target), 'Unexpected release target');
  const original = utf8(before), proposed = utf8(after);
  const id = /\bid\s*=\s*["']lesson-video-upload-notice["']/g;
  const note = /^ +<div class="rule-note" id="lesson-video-upload-notice"><strong>[^<\r\n]+<\/strong><span>[^<\r\n]+<\/span><\/div>\n/gm;
  const matches = [...proposed.matchAll(note)];
  check(!id.test(original) && matches.length === 1 && [...proposed.matchAll(id)].length === 1,
    'Add exactly one new lesson-video-upload-notice rule-note');
  check(proposed.replace(note, '') === original, 'Every other rules byte must equal the pinned baseline');
}

export function parseLessonVideoNoticeRulesArgs(args) {
  check(Array.isArray(args) && args.every(arg => typeof arg === 'string'), 'Invalid release arguments');
  const targetArgs = args.filter(arg => arg.startsWith('--target='));
  const versionArgs = args.filter(arg => arg.startsWith('--expected-version='));
  check(targetArgs.length === 1 && versionArgs.length <= 1 && new Set(args).size === args.length,
    'Choose exactly one target and reviewed version');
  const target = targetArgs[0].slice(9), expected = versionArgs[0]?.slice(19);
  check(Object.hasOwn(TARGETS, target), 'Unexpected release target');
  check(args.every(arg => ['--apply', '--plan', targetArgs[0], versionArgs[0]].includes(arg)) &&
    !(args.includes('--apply') && args.includes('--plan')), 'Unsupported release argument');
  const selected = TARGETS[target], apply = args.includes('--apply');
  if (expected !== undefined)
    check(new RegExp(`^sites/${selected.site}/versions/[A-Za-z0-9_-]+$`).test(expected), 'Expected version must belong to selected site');
  check(!apply || expected, 'Apply requires the reviewed expected version');
  return { target, selected, expected, apply };
}

// Dependency injection keeps every release-path unit test entirely synthetic.
export async function releaseLessonVideoNoticeRules(args, runtime = {}) {
  const { target, selected, expected, apply } = parseLessonVideoNoticeRulesArgs(args);
  const io = runtime.fs || fs, exec = runtime.execFileSync || execFileSync;
  const fetcher = runtime.fetch || globalThis.fetch;
  const home = runtime.home || os.homedir(), pid = runtime.pid || process.pid;
  const stamp = () => new Date().toISOString();
  const git = values => exec('git', values, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const root = git(['rev-parse', '--show-toplevel']);
  const sourcePath = path.join(root, SOURCE), source = io.readFileSync(sourcePath);
  const before = exec('git', ['show', `${BASE}:${SOURCE}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  assertLessonVideoNoticeRulesScope(before, source, target);
  const commit = git(['rev-parse', 'HEAD']);
  const assertSource = () => {
    check(git(['branch', '--show-current']) === 'main' && !git(['status', '--porcelain']) &&
      git(['rev-parse', 'HEAD']) === commit && commit === git(['rev-parse', 'origin/main']),
    'Apply requires clean synchronized main and unchanged source commit');
    check(sha(io.readFileSync(sourcePath)) === sha(source), 'Actual source changed during release');
    check(sha(exec('git', ['show', `HEAD:${SOURCE}`], { stdio: ['ignore', 'pipe', 'pipe'] })) === sha(source),
      'Actual source differs from tracked HEAD');
  };
  if (apply) {
    git(['fetch', 'origin', 'main']);
    assertSource();
  }
  const token = exec('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  }).trim();
  check(token.length > 0, 'Missing Hosting access token');
  const request = async (resource, method = 'GET', body) => {
    check(resource.startsWith(`sites/${selected.site}/`), 'Unexpected Hosting site');
    const response = await fetcher(API + resource, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000),
    });
    check(response.ok, `Hosting ${method} failed (${response.status})`);
    return response.json();
  };
  const validVersion = name => typeof name === 'string' && new RegExp(`^sites/${selected.site}/versions/[A-Za-z0-9_-]+$`).test(name);
  const latest = async () => {
    const result = await request(`sites/${selected.site}/releases?pageSize=1`);
    check(Array.isArray(result.releases) && result.releases.length === 1, 'Missing live release');
    const release = result.releases[0];
    check(typeof release.name === 'string' && new RegExp(`^sites/${selected.site}/releases/[A-Za-z0-9_-]+$`).test(release.name) &&
      validVersion(release.version?.name), 'Unexpected live site/version');
    return release;
  };
  const filesFor = async version => {
    check(validVersion(version), 'Unexpected manifest version');
    const rows = [], seen = new Set(); let cursor;
    do {
      const page = await request(`${version}/files?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`);
      check(object(page) && Array.isArray(page.files) && !page.error, 'Incomplete file manifest');
      rows.push(...page.files);
      const next = page.nextPageToken;
      check(next === undefined || next === null || typeof next === 'string', 'Invalid manifest cursor');
      if (next) {
        check(!seen.has(next) && seen.size < 1000, 'Repeated or excessive manifest pagination');
        seen.add(next);
      }
      cursor = next;
    } while (cursor);
    return rows;
  };
  const liveHash = async () => {
    const response = await fetcher(selected.url, { cache: 'no-store', signal: AbortSignal.timeout(60000) });
    check(response.ok, 'Live rules request failed');
    return sha(Buffer.from(await response.arrayBuffer()));
  };
  const release = await latest();
  check(!expected || release.version.name === expected, 'Live version changed since review');
  check(await liveHash() === sha(before), 'Live baseline source drift');
  const baseline = await request(release.version.name);
  check(baseline.name === release.version.name && object(baseline.config), 'Missing current live configuration');
  const config = structuredClone(baseline.config), baselineFiles = await filesFor(baseline.name);
  const compressed = gzipSync(source, { level: 9 }), hash = sha(compressed);
  const manifest = makeManifest(baselineFiles, hash, selected.resource);
  const evidence = { target, site: selected.site, baselineCommit: BASE, baselineVersion: baseline.name,
    sourceCommit: commit, changedPaths: [selected.resource], fileCount: baselineFiles.length,
    sourceSha256: sha(source), baselineSourceSha256: sha(before), compressedSha256: hash,
    mode: apply ? 'apply' : 'plan' };
  if (!apply) return evidence;
  const directory = path.join(root, 'artifacts/lesson-video-notice-rules');
  const evidenceFile = path.join(directory, `${target}-release.json`);
  io.mkdirSync(directory, { recursive: true });
  const save = () => io.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  const lock = path.join(home, 'ArchiveIN/automation/locks', `firebase-hosting-${selected.site}.lock`);
  io.mkdirSync(path.dirname(lock), { recursive: true });
  const fd = io.openSync(lock, 'wx', 0o600), owner = { pid, token: randomUUID(), operation: 'lesson-video-upload-notice', startedAt: stamp() };
  const unchangedRelease = async () => {
    const current = await latest();
    check(current.name === release.name && current.version.name === release.version.name, 'Concurrent Hosting release');
  };
  try {
    io.writeSync(fd, JSON.stringify(owner)); io.fsyncSync(fd);
    await unchangedRelease();
    assertSource();
    check(await liveHash() === sha(before), 'Live baseline drift after lock');
    save();
    const created = await request(`sites/${selected.site}/versions`, 'POST', { config });
    check(validVersion(created.name) && created.name !== baseline.name, 'Unexpected new version');
    evidence.createdVersion = created.name; save();
    const entries = Object.entries(manifest);
    for (let start = 0; start < entries.length; start += 1000) {
      const populated = await request(`${created.name}:populateFiles`, 'POST', {
        files: Object.fromEntries(entries.slice(start, start + 1000)),
      });
      check(Array.isArray(populated.uploadRequiredHashes) && populated.uploadRequiredHashes.every(value => value === hash),
        'Unrelated or unknown uploads requested');
      if (populated.uploadRequiredHashes.length) {
        const upload = new URL(populated.uploadUrl);
        check(upload.origin === 'https://upload-firebasehosting.googleapis.com' && !upload.username && !upload.password &&
          !upload.search && !upload.hash, 'Unexpected upload destination');
        const response = await fetcher(`${upload.href.replace(/\/$/, '')}/${hash}`, { method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
          body: compressed, signal: AbortSignal.timeout(60000) });
        check(response.ok, 'Rules upload failed');
      }
    }
    const assertSnapshot = async () => {
      assertManifest(await filesFor(created.name), manifest);
      const version = await request(created.name);
      check(version.name === created.name && isDeepStrictEqual(version.config, config), 'Hosting configuration changed');
    };
    await assertSnapshot();
    await unchangedRelease();
    assertSource();
    await request(`${created.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
    await assertSnapshot();
    await unchangedRelease();
    assertSource();
    check(await liveHash() === sha(before), 'Live rules drift before publication');
    evidence.releaseIntentAt = stamp(); save();
    const published = await request(`sites/${selected.site}/releases?versionName=${created.name}`, 'POST', {
      message: `lesson-video-upload-notice ${target} only (${commit.slice(0, 12)})`,
    });
    evidence.releaseName = published.name; save();
    const current = await latest();
    check(current.version.name === created.name && current.name === published.name && await liveHash() === sha(source),
      'Live readback failed; do not repeat release');
    await assertSnapshot();
    assertSource();
    evidence.verified = true; evidence.verifiedAt = stamp(); save();
    return evidence;
  } finally {
    try {
      const locked = JSON.parse(io.readFileSync(lock, 'utf8'));
      check(locked.pid === owner.pid && locked.token === owner.token, 'Lock owner changed; preserve other owner lock');
      io.unlinkSync(lock);
    } finally { io.closeSync(fd); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  releaseLessonVideoNoticeRules(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('Scoped CORE rules release failed; inspect saved evidence before retry'); process.exitCode = 1;
  });
}
