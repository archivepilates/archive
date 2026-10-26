import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeManifest, assertManifest } from './release-e261017-classroom.mjs';

const ACCOUNT = 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com';
const BASE = '652c16ea1bc120306742bbe1e0b867dce80291f0';
const BASE_HASH = '4f1e879c2a5356f113d70b4126b9245afb8337e9fd8b595770c571fae503ef9d';
const SHARE_BASE = '074d9a6600bf00f5268bafc32d1d8958769edbf5';
const SHARE_BASE_HASH = '692397d07b4a443b6138a7a06773e4358e3eaf80bda24918a185fa9d935b5a93';
const WEBHOOK_BASE = 'e38a36e7b4f334ceac8757c4e685b0af46fec16e';
const WEBHOOK_BASE_HASH = '44a9c5c076e562279933c02c3f24562f0a504d20c7f946a71c6d296537849892';
const OAUTH_BASE = 'dac9e03c96416b066cc9717f0759698d2fed12d1';
const OAUTH_BASE_HASH = '00af19ccf93380b0f6aa025b6c9356289d41a9a8db1c05a0bcefedfe05e66534';
const STAFF_LOCK_BASE = '9aaf7a8c38145f60e5b1c0ebab8d562ab832e929';
const STAFF_LOCK_BASE_HASH = '42b17144216b720cff439930466b09a832979072a2e1ebe72d16e1e09f338a74';
const STAFF_LOCK_LIVE_HASH = '42b17144216b720cff439930466b09a832979072a2e1ebe72d16e1e09f338a74';
const REGISTERED_SHARE_BASE = '6e50653f20c243953c3bc03ec4bba00f02ab4ff4';
const REGISTERED_SHARE_BASE_HASH = '4d3d3063d82b4f2c2056dd29586bb3df371c200d023703107c28953f46e1faae';
const sha = value => createHash('sha256').update(value).digest('hex');

export function assertStaffNoteOnly(before, after) {
  const note = /^ +<div class="rule-note" id="imweb-staff-video-policy">[^\n]*<\/div>\n/gm;
  if (before.match(note) || (after.match(note) || []).length !== 1 || after.replace(note, '') !== before) {
    throw Error('Release must add only the staff video operating note');
  }
}

export function staffLockPolicySource(live, before, after) {
  const note = /^ +<div class="rule-note" id="imweb-staff-video-policy">[^\n]*<\/div>\n/gm;
  const previous = before.match(note);
  const next = after.match(note);
  const deployed = live.match(note);
  if (previous?.length !== 1 || next?.length !== 1 || deployed?.length !== 1
    || deployed[0] !== previous[0] || before.replace(note, '') !== after.replace(note, '')) {
    throw Error('Release must update only the reviewed staff video note');
  }
  return live.replace(note, () => next[0]);
}

export function assertStudentShareNoteOnly(before, after) {
  const note = /^ +<div class="rule-note" id="imweb-student-share-first-grant-policy">[^\n]*<\/div>\n/gm;
  if (before.match(note) || (after.match(note) || []).length !== 1 || after.replace(note, '') !== before) {
    throw Error('Release must add only the student-share operating note');
  }
}

export function assertWebhookOnboardingNoteOnly(before, after) {
  const note = /^ +<div class="rule-note" id="imweb-app-webhook-onboarding-policy">[^\n]*<\/div>\n/gm;
  if (before.match(note) || (after.match(note) || []).length !== 1 || after.replace(note, '') !== before)
    throw Error('Release must add only the webhook onboarding note');
}

export function assertWebhookOAuthNoteOnly(before, after) {
  const note = /^ +<div class="rule-note" id="imweb-app-webhook-onboarding-policy">[^\n]*<\/div>\n/gm;
  if ((before.match(note) || []).length !== 1 || (after.match(note) || []).length !== 1 ||
      after.replace(note, '') !== before.replace(note, ''))
    throw Error('Release must update only the existing webhook onboarding note');
}

export function assertRegistrationPolicyNotesOnly(before, after) {
  const ids = ['imweb-student-share-first-grant-policy', 'lesson-share-261025', 'lesson-share-261024'];
  const utf8 = value => {
    if (typeof value !== 'string' && !Buffer.isBuffer(value)) throw Error('Rules source must be UTF-8 bytes');
    const bytes = Buffer.from(value), text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw Error('Invalid UTF-8 rules source');
    return text;
  };
  const original = utf8(before), proposed = utf8(after);
  const note = new RegExp(`^( +<div class="rule-note" id="(${ids.join('|')})">)<strong>[^<\\r\\n]+</strong><span>[^<\\r\\n]+</span>(</div>\\n)`, 'gm');
  const previous = [...original.matchAll(note)], next = [...proposed.matchAll(note)];
  for (const id of ids) {
    const attribute = new RegExp(`\\bid\\s*=\\s*(?:"${id}"|'${id}'|${id}(?=[\\s/>]))`, 'gi');
    if (previous.filter(match => match[2] === id).length !== 1 || next.filter(match => match[2] === id).length !== 1
      || [...original.matchAll(attribute)].length !== 1 || [...proposed.matchAll(attribute)].length !== 1) {
      throw Error('Release must replace exactly one of each existing registration policy note');
    }
  }
  let beforeCursor = 0, afterCursor = 0;
  for (let i = 0; i < previous.length; i++) {
    const old = previous[i], replacement = next[i];
    if (old[2] !== replacement[2] || old[1] !== replacement[1] || old[3] !== replacement[3]
      || old[0] === replacement[0]
      || original.slice(beforeCursor, old.index) !== proposed.slice(afterCursor, replacement.index)) {
      throw Error('All three registration policy notes must change in place with every surrounding byte preserved');
    }
    beforeCursor = old.index + old[0].length;
    afterCursor = replacement.index + replacement[0].length;
  }
  if (original.slice(beforeCursor) !== proposed.slice(afterCursor)) {
    throw Error('Every surrounding registration policy byte must equal the pinned baseline');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--staff-lock-policy', '--student-share-policy', '--registered-share-policy', '--webhook-onboarding', '--webhook-oauth', '--site=archive-pilates', '--site=archive-pilates-core'].includes(arg)
      && !arg.startsWith('--expected-version='))) throw Error('Unsupported release argument');
  const apply = args.includes('--apply');
  const studentShare = args.includes('--student-share-policy');
  const registeredShare = args.includes('--registered-share-policy');
  const webhook = args.includes('--webhook-onboarding');
  const oauth = args.includes('--webhook-oauth');
  const staffLock = args.includes('--staff-lock-policy');
  if ([studentShare, webhook, oauth, staffLock, registeredShare].filter(Boolean).length > 1) throw Error('Choose one policy release');
  const SITE = args.includes('--site=archive-pilates-core') ? 'archive-pilates-core' : 'archive-pilates';
  if (!studentShare && !webhook && !oauth && !staffLock && !registeredShare && SITE !== 'archive-pilates') throw Error('Historical release is main-site only');
  const ASSET = SITE === 'archive-pilates' ? '/core/rules/index.html' : '/rules/index.html';
  const LIVE = `https://${SITE}.web.app${ASSET.slice(0, -10)}`;
  const baselineCommit = registeredShare ? REGISTERED_SHARE_BASE : staffLock ? STAFF_LOCK_BASE : oauth ? OAUTH_BASE : webhook ? WEBHOOK_BASE : studentShare ? SHARE_BASE : BASE;
  const baselineHash = registeredShare ? REGISTERED_SHARE_BASE_HASH : staffLock ? STAFF_LOCK_BASE_HASH : oauth ? OAUTH_BASE_HASH : webhook ? WEBHOOK_BASE_HASH : studentShare ? SHARE_BASE_HASH : BASE_HASH;
  const expected = args.find(arg => arg.startsWith('--expected-version='))?.slice(19);
  const git = values => execFileSync('git', values, { encoding: 'utf8' }).trim();
  const root = git(['rev-parse', '--show-toplevel']);
  let source = fs.readFileSync(path.join(root, 'core/rules/index.html'));
  const baselineSource = execFileSync('git', ['show', `${baselineCommit}:core/rules/index.html`]);
  if (sha(baselineSource) !== baselineHash) throw Error('Pinned baseline mismatch');
  if (staffLock) staffLockPolicySource(baselineSource.toString(), baselineSource.toString(), source.toString());
  else if (registeredShare) assertRegistrationPolicyNotesOnly(baselineSource, source);
  else (oauth ? assertWebhookOAuthNoteOnly : webhook ? assertWebhookOnboardingNoteOnly : studentShare ? assertStudentShareNoteOnly : assertStaffNoteOnly)(baselineSource.toString(), source.toString());
  if (apply && (!expected || git(['branch', '--show-current']) !== 'main' || git(['status', '--porcelain']))) {
    throw Error('Apply requires clean local main and reviewed live version');
  }
  if (apply) execFileSync(process.execPath, ['scripts/validate-release-branch-state.mjs',
    '--require-origin-main', '--require-main-branch'], { cwd: root, stdio: 'pipe' });
  const token = execFileSync('gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const request = async (resource, method = 'GET', body) => {
    const response = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${resource}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw Error(`Hosting ${method} failed (${response.status})`);
    return response.json();
  };
  const latest = async () => (await request(`sites/${SITE}/releases?pageSize=1`)).releases?.[0];
  const filesFor = async version => {
    const all = []; let cursor;
    do {
      const page = await request(`${version}/files?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`);
      all.push(...(page.files || [])); cursor = page.nextPageToken;
    } while (cursor);
    return all;
  };
  const release = await latest();
  if (!release?.version?.name?.startsWith(`sites/${SITE}/versions/`)) throw Error('Unexpected live version');
  if (apply && release.version.name !== expected) throw Error('Live version changed since review');
  const baseline = await request(release.version.name);
  const files = await filesFor(baseline.name);
  const live = await fetch(LIVE, { cache: 'no-store' });
  const liveBytes = Buffer.from(await live.arrayBuffer());
  if (!live.ok || sha(liveBytes) !== (staffLock ? STAFF_LOCK_LIVE_HASH : baselineHash)) throw Error('Unreviewed live CORE rules');
  if (staffLock) source = Buffer.from(staffLockPolicySource(liveBytes.toString(), baselineSource.toString(), source.toString()));
  const compressed = gzipSync(source, { level: 9 }); const hash = sha(compressed);
  const manifest = makeManifest(files, hash, ASSET);
  const evidence = { site: SITE, sourceCommit: git(['rev-parse', 'HEAD']), baselineVersion: baseline.name,
    changedPaths: [ASSET], unchangedFileCount: files.length-1, mode: apply ? 'apply' : 'plan', sourceHash: sha(source) };
  if (!apply) { console.log(JSON.stringify(evidence)); return; }
  const directory = path.join(os.homedir(), 'ArchiveIN/automation/imweb-staff-video');
  const evidenceFile = path.join(directory, registeredShare ? `registered-share-hosting-${SITE}.json` : staffLock ? `lock-policy-hosting-${SITE}.json` : oauth ? `webhook-oauth-hosting-${SITE}.json` : webhook ? `webhook-onboarding-hosting-${SITE}.json` : studentShare ? `student-share-hosting-${SITE}.json` : 'hosting-release.json');
  const save = () => fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2)+'\n', { mode: 0o600 });
  const lock = path.join(os.homedir(), `ArchiveIN/automation/locks/firebase-hosting-${SITE}.lock`);
  fs.mkdirSync(path.dirname(lock), { recursive: true }); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, operation: 'staff-video-core-rules', at: new Date().toISOString() }));
    if ((await latest()).name !== release.name) throw Error('Concurrent deployment detected');
    save();
    const created = await request(`sites/${SITE}/versions`, 'POST', { config: baseline.config });
    if (!created.name?.startsWith(`sites/${SITE}/versions/`)) throw Error('Unexpected new version');
    evidence.createdVersion = created.name; save();
    for (let i = 0; i < files.length; i += 1000) {
      const result = await request(`${created.name}:populateFiles`, 'POST', {
        files: Object.fromEntries(files.slice(i, i+1000).map(file => [file.path, manifest[file.path]])),
      });
      const required = result.uploadRequiredHashes || [];
      if (required.some(value => value !== hash)) throw Error('Unexpected unchanged-file upload');
      if (required.length) {
        const upload = new URL(result.uploadUrl);
        if (upload.origin !== 'https://upload-firebasehosting.googleapis.com') throw Error('Unexpected upload host');
        const response = await fetch(`${upload.href}/${hash}`, { method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: compressed,
          signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw Error(`CORE rules upload failed (${response.status})`);
      }
    }
    assertManifest(await filesFor(created.name), manifest);
    if (!isDeepStrictEqual((await request(created.name)).config, baseline.config)) throw Error('Hosting configuration changed');
    if ((await latest()).name !== release.name) throw Error('Concurrent deployment detected');
    await request(`${created.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
    if ((await latest()).name !== release.name) throw Error('Concurrent deployment detected after finalization');
    evidence.releaseIntentAt = new Date().toISOString(); save();
    const result = await request(`sites/${SITE}/releases?versionName=${created.name}`, 'POST', {
      message: `${registeredShare ? 'Registered student-share' : studentShare ? 'Student-share first-grant and staff-exit' : 'Staff video'} policy only (${evidence.sourceCommit.slice(0,12)})`,
    });
    evidence.releaseName = result.name; save();
    if ((await latest()).version.name !== created.name) throw Error('Release readback mismatch');
    const verified = await fetch(LIVE, { cache: 'no-store' });
    if (!verified.ok || sha(Buffer.from(await verified.arrayBuffer())) !== sha(source)) throw Error('Live rules mismatch');
    evidence.verified = true; evidence.verifiedAt = new Date().toISOString(); save();
    console.log(JSON.stringify(evidence));
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
