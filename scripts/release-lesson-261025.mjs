import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';

const BASE = '3e6bd160';
const ASSET = '/assets/imweb-my-classroom-20260723a.js';
const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const targets = {
  classroom: { site: 'archive-pilates-home', resource: ASSET,
    source: `official-home${ASSET}`, url: `https://archivepilates.com${ASSET}` },
  rules: { site: 'archive-pilates', resource: '/core/rules/index.html',
    source: 'core/rules/index.html', url: 'https://archive-pilates.web.app/core/rules/' },
  'core-rules': { site: 'archive-pilates-core', resource: '/rules/index.html',
    source: 'core/rules/index.html', url: 'https://archive-pilates-core.web.app/rules/' },
};
const sha = value => createHash('sha256').update(value).digest('hex');

export function assertLessonReleaseScope(before, after, target) {
  if (target === 'classroom') {
    const anchor = '    {"code":"B261024","path":"/private-lesson-external-feedback2-b-261024","title":"10/24 외부 피드백2 B팀 · 수강생 공유","group":"PRIVATE LESSON EXTERNAL FEEDBACK2 B 261024 40D","private":true}';
    const additions = ['C', 'D'].map(team => `    {"code":"${team}261025","path":"/private-lesson-external-feedback2-${team.toLowerCase()}-261025","title":"10/25 외부 피드백2 ${team}팀 · 수강생 공유","group":"PRIVATE LESSON EXTERNAL FEEDBACK2 ${team} 261025 40D","private":true}`);
    if (before.split(anchor).length !== 2
        || after !== before.replace(`${anchor}\n`, `${anchor},\n${additions.join(',\n')}\n`)) throw Error('Expected exact team tuples at the catalog insertion point');
  } else {
    if (!['rules', 'core-rules'].includes(target)) throw Error('Unexpected release target');
    const note = /^          <div class="rule-note" id="lesson-share-261025"><strong>[^<\n]+<\/strong><span>[^<\n]+<\/span><\/div>\n/gm;
    if ((after.match(note) || []).length !== 1 || (after.match(/id="lesson-share-261025"/g) || []).length !== 1
        || after.replace(note, '') !== before) throw Error('Only the 10/25 operating note may change');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find(x => x.startsWith('--target='))?.slice(9);
  const apply = args.includes('--apply');
  const expected = args.find(x => x.startsWith('--expected-version='))?.slice(19);
  if (!targets[target] || args.some(x => !['--apply', `--target=${target}`, `--expected-version=${expected}`].includes(x))) throw Error('Unsupported release argument');
  const selected = targets[target];
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const root = git(['rev-parse', '--show-toplevel']);
  const source = fs.readFileSync(path.join(root, selected.source));
  const baselineSource = execFileSync('git', ['show', `${selected.baseline || BASE}:${selected.source}`]);
  assertLessonReleaseScope(baselineSource.toString(), source.toString(), target);
  if (apply) {
    git(['fetch', 'origin', 'main']);
    if (!expected || git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])
        || git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main'])) throw Error('Apply requires reviewed version and clean synchronized main');
  }
  const token = execFileSync('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
  const request = async (name, method = 'GET', body) => {
    const response = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${name}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw Error(`Hosting ${method} failed: ${response.status}`);
    return response.json();
  };
  const latest = async () => (await request(`sites/${selected.site}/releases?pageSize=1`)).releases?.[0];
  const files = async version => {
    const all = []; let cursor;
    do {
      const result = await request(`${version}/files?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`);
      all.push(...(result.files || [])); cursor = result.nextPageToken;
    } while (cursor);
    return all;
  };
  const release = await latest();
  if (!release?.version?.name?.startsWith(`sites/${selected.site}/versions/`) || apply && release.version.name !== expected) throw Error('Unexpected live version');
  const live = await fetch(selected.url, { cache: 'no-store' });
  if (!live.ok || sha(Buffer.from(await live.arrayBuffer())) !== sha(baselineSource)) throw Error('Live source drift; review before release');
  const baseline = await request(release.version.name);
  const baselineFiles = await files(baseline.name);
  const compressed = gzipSync(source, { level: 9 }), hash = sha(compressed);
  const manifest = makeManifest(baselineFiles, hash, selected.resource);
  const evidence = { target, site: selected.site, baselineVersion: baseline.name,
    sourceCommit: git(['rev-parse', 'HEAD']), changedPaths: [selected.resource], fileCount: baselineFiles.length, sourceSha256: sha(source), mode: apply ? 'apply' : 'plan' };
  const output = path.join(root, 'artifacts/lesson-videos-261025'); fs.mkdirSync(output, { recursive: true });
  const save = () => fs.writeFileSync(path.join(output, `${target}-${apply ? 'release' : 'plan'}.json`), JSON.stringify(evidence, null, 2));
  save();
  if (!apply) { console.log(JSON.stringify(evidence)); return; }
  const lock = path.join(process.env.HOME, 'ArchiveIN/automation/locks', `firebase-hosting-${selected.site}.lock`);
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    if ((await latest()).name !== release.name) throw Error('Concurrent release');
    const version = await request(`sites/${selected.site}/versions`, 'POST', { config: baseline.config });
    if (!version.name?.startsWith(`sites/${selected.site}/versions/`)) throw Error('Unexpected version scope');
    evidence.createdVersion = version.name; save();
    const chunks = Object.entries(manifest);
    for (let start = 0; start < chunks.length; start += 1000) {
      const result = await request(`${version.name}:populateFiles`, 'POST', { files: Object.fromEntries(chunks.slice(start, start + 1000)) });
      if ((result.uploadRequiredHashes || []).some(value => value !== hash)) throw Error('Unrelated files require upload');
      if (result.uploadRequiredHashes?.length) {
        const url = new URL(result.uploadUrl);
        if (url.origin !== 'https://upload-firebasehosting.googleapis.com') throw Error('Unexpected upload destination');
        const response = await fetch(`${url.href}/${hash}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: compressed, signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw Error(`Asset upload failed: ${response.status}`);
      }
    }
    assertManifest(await files(version.name), manifest);
    if (!isDeepStrictEqual((await request(version.name)).config, baseline.config) || (await latest()).name !== release.name) throw Error('Configuration or release changed');
    await request(`${version.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
    if ((await latest()).name !== release.name) throw Error('Concurrent release after finalization');
    evidence.releaseIntentAt = new Date().toISOString(); save();
    const published = await request(`sites/${selected.site}/releases?versionName=${version.name}`, 'POST', { message: `10/25 student-share ${target} only (${evidence.sourceCommit.slice(0, 12)})` });
    evidence.releaseName = published.name; save();
    const verified = await fetch(selected.url, { cache: 'no-store' });
    if ((await latest()).version.name !== version.name || !verified.ok || sha(Buffer.from(await verified.arrayBuffer())) !== sha(source)) throw Error('Live readback failed; do not repeat release');
    evidence.verified = true; save(); console.log(JSON.stringify(evidence));
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Scoped Hosting release failed; inspect saved evidence before retry'); process.exitCode = 1; });
