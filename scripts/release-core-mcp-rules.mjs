import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';

const BASE = 'af06646964c0dff68e44b8eabd09445c88f28630';
const SITE = 'archive-pilates-core';
const ASSET = '/rules/index.html';
const FILE = 'core/rules/index.html';
const sha = value => createHash('sha256').update(value).digest('hex');
export function assertMcpRuleOnly(before, after) {
  const section = /^        <section class="panel rule-section" id="core-ops-mcp">\n(?:(?!        <\/section>)[\s\S])*?        <\/section>\n\n/gm;
  if (before.includes('id="core-ops-mcp"') || (after.match(section) || []).length !== 1 || after.replace(section, '') !== before)
    throw Error('Only the reviewed CORE MCP rule section may be added.');
}
async function main() {
  const args = process.argv.slice(2), apply = args.includes('--apply');
  const expected = args.find(a => a.startsWith('--expected-version='))?.slice(19);
  if (new Set(args).size !== args.length || args.some(a => a !== '--apply' && !a.startsWith('--expected-version='))) throw Error('Invalid release arguments');
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  const source = fs.readFileSync(FILE), baselineBytes = execFileSync('git', ['show', `${BASE}:${FILE}`]);
  assertMcpRuleOnly(baselineBytes.toString(), source.toString());
  const clean = () => {
    if (git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain'])
      || git(['rev-parse', 'HEAD']) !== commit || git(['rev-parse', 'origin/main']) !== commit) throw Error('Release requires synchronized clean main');
  };
  if (apply) { git(['fetch', 'origin', 'main']); clean(); if (!expected) throw Error('Reviewed version required'); }
  const token = execFileSync('gcloud', ['auth', 'print-access-token', '--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const request = async (resource, method = 'GET', body) => {
    const response = await fetch('https://firebasehosting.googleapis.com/v1beta1/' + resource, {
      method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw Error(`Hosting ${method} failed (${response.status})`);
    return response.json();
  };
  const latest = async () => (await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
  const filesFor = async name => {
    const files = [], seen = new Set(); let page;
    do {
      const result = await request(`${name}/files?pageSize=1000${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
      if (!Array.isArray(result.files)) throw Error('Incomplete Hosting manifest');
      files.push(...result.files); page = result.nextPageToken;
      if (page && seen.has(page)) throw Error('Repeated manifest cursor');
      seen.add(page);
    } while (page);
    return files;
  };
  const release = await latest();
  const versionPattern = /^sites\/archive-pilates-core\/versions\/[^/?#]+$/;
  if (!versionPattern.test(release?.version?.name) || apply && release.version.name !== expected) throw Error('Live version changed');
  const baseline = await request(release.version.name), files = await filesFor(baseline.name);
  const url = 'https://core.archivepilates.com/rules/';
  const live = await fetch(url, { cache: 'no-store' });
  if (!live.ok || sha(Buffer.from(await live.arrayBuffer())) !== sha(baselineBytes)) throw Error('Unreviewed live rules drift');
  const compressed = gzipSync(source, { level: 9 }), assetHash = sha(compressed);
  const manifest = makeManifest(files, assetHash, ASSET);
  const evidence = { site: SITE, sourceCommit: commit, baselineVersion: baseline.name, fileCount: files.length,
    changedPaths: [ASSET], unchangedFileCount: files.length - 1, sourceHash: sha(source), mode: apply ? 'apply' : 'plan' };
  if (!apply) { console.log(JSON.stringify(evidence)); return; }
  const directory = path.join(os.homedir(), 'ArchiveIN/operations/core-mcp');
  const output = path.join(directory, 'hosting-release-20261029.json');
  if (fs.existsSync(output)) throw Error('Release evidence exists; reconcile before any retry');
  const lock = path.join(os.homedir(), 'ArchiveIN/automation/locks/firebase-hosting-' + SITE + '.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  const unchanged = async () => { clean(); if ((await latest()).name !== release.name || sha(fs.readFileSync(FILE)) !== evidence.sourceHash) throw Error('Concurrent release/source change'); };
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, operation: 'core-mcp-rules', at: new Date().toISOString() }));
    await unchanged(); save();
    const created = await request(`sites/${SITE}/versions`, 'POST', { config: baseline.config });
    if (!versionPattern.test(created.name)) throw Error('Unexpected created version');
    evidence.createdVersion = created.name; save();
    const populated = await request(`${created.name}:populateFiles`, 'POST', { files: manifest });
    for (const required of populated.uploadRequiredHashes || []) {
      if (required !== assetHash) throw Error('Unexpected unchanged asset upload');
      const upload = new URL(populated.uploadUrl);
      if (upload.origin !== 'https://upload-firebasehosting.googleapis.com') throw Error('Unexpected upload host');
      const result = await fetch(`${upload.href}/${assetHash}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: compressed,
        signal: AbortSignal.timeout(60000) });
      if (!result.ok) throw Error('Rules upload failed');
    }
    assertManifest(await filesFor(created.name), manifest);
    if (!isDeepStrictEqual((await request(created.name)).config, baseline.config)) throw Error('Hosting config changed');
    await unchanged(); await request(`${created.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
    await unchanged(); evidence.releaseIntentAt = new Date().toISOString(); save();
    const result = await request(`sites/${SITE}/releases?versionName=${created.name}`, 'POST', { message: `CORE MCP operating rules ${commit.slice(0, 12)}` });
    evidence.releaseName = result.name; save();
    const verified = await fetch(url, { cache: 'no-store' });
    if (!verified.ok || sha(Buffer.from(await verified.arrayBuffer())) !== sha(source) || (await latest()).version.name !== created.name) throw Error('Live release mismatch; never blindly replay');
    evidence.verified = true; evidence.verifiedAt = new Date().toISOString(); save(); console.log(JSON.stringify(evidence));
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('CORE MCP rules release stopped. Read saved release evidence before retry.'); process.exitCode = 1;
});
