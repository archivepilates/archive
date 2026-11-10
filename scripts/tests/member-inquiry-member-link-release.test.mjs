import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {
  MEMBER_LINK_BASELINE_COMMIT, MEMBER_LINK_BASELINE_VERSION, MEMBER_LINK_SOURCE_PINS,
  memberLinkReleaseManifest, releaseMemberLink,
} from '../release-member-inquiry-member-link.mjs';

const paths = Object.keys(MEMBER_LINK_SOURCE_PINS);
const expected = MEMBER_LINK_BASELINE_VERSION;
const args = [`--expected-version=${expected}`];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const replacements = Object.fromEntries(paths.map((resource, index) => [resource, String(index + 1).repeat(64)]));
const baselineFiles = () => [...paths, ...Array.from({length: 66}, (_, index) => `/unchanged-${index}.js`)]
  .map(resource => ({path: resource, hash: 'a'.repeat(64)}));

function fixture(t, options = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'member-link-release-')));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const root = path.join(home, 'repo');
  const directory = path.join(home, 'ArchiveIN/operations/member-inquiry-member-link-20261110');
  const lock = path.join(home, 'ArchiveIN/automation/locks/firebase-hosting-archive-pilates-core.lock');
  fs.mkdirSync(path.dirname(lock), {recursive: true});
  const prior = Object.fromEntries(paths.map(resource => [resource, Buffer.from(`baseline:${resource}`)]));
  const source = Object.fromEntries(paths.map(resource => [resource, Buffer.from(`reviewed:${resource}`)]));
  const pins = Object.fromEntries(paths.map(resource => [resource, sha(source[resource])]));
  for (const resource of paths) {
    const filename = path.join(root, 'core', resource);
    fs.mkdirSync(path.dirname(filename), {recursive: true}); fs.writeFileSync(filename, source[resource]);
  }
  const config = {cleanUrls: true, headers: [{glob: '**', headers: {'Cache-Control': 'no-cache'}}],
    rewrites: [{glob: '/api/**', function: 'existingFunction'}]};
  const files = baselineFiles().map(file => ({...file,
    hash: prior[file.path] ? sha(gzipSync(prior[file.path], {level: 9})) : file.hash,
  }));
  const created = 'sites/archive-pilates-core/versions/created';
  const baselineRelease = 'sites/archive-pilates-core/releases/baseline';
  const newRelease = 'sites/archive-pilates-core/releases/new';
  const calls = [], writes = [], commands = [];
  let published = false, finalized = false, manifest;
  const receipt = () => JSON.parse(fs.readFileSync(path.join(directory, 'hosting-release.json'), 'utf8'));
  const dependencies = {
    home, sourcePins: pins, pause: async () => {},
    execFileSync(command, commandArgs) {
      commands.push([command, ...commandArgs]);
      if (command === 'gcloud') return 'offline-test-token';
      assert.equal(command, 'git');
      if (commandArgs[0] === 'fetch') return '';
      if (commandArgs[0] === 'branch') return options.branch ?? 'main';
      if (commandArgs[0] === 'status') return options.dirty ? ' M unrelated.js' : '';
      if (commandArgs[0] === 'merge-base') {
        assert.deepEqual(commandArgs.slice(0, 3), ['merge-base', '--is-ancestor', MEMBER_LINK_BASELINE_COMMIT]);
        if (options.notAncestor) throw Error('not an ancestor');
        return '';
      }
      if (commandArgs[0] === 'show') {
        const prefix = `${MEMBER_LINK_BASELINE_COMMIT}:core`;
        assert.ok(commandArgs[1].startsWith(prefix));
        return prior[commandArgs[1].slice(prefix.length)];
      }
      assert.equal(commandArgs[0], 'rev-parse');
      if (commandArgs[1] === '--show-toplevel') return root;
      if (commandArgs[1].endsWith('^{commit}')) return MEMBER_LINK_BASELINE_COMMIT;
      if (commandArgs[1] === 'origin/main' && options.unaligned) return 'c'.repeat(40);
      return 'b'.repeat(40);
    },
    async fetch(url, init = {}) {
      calls.push({url, method: init.method ?? 'GET'});
      assert.equal(init.redirect, 'error');
      if (!url.startsWith('https://firebasehosting.googleapis.com/') && !url.startsWith('https://upload-firebasehosting.googleapis.com/')) {
        const parsed = new URL(url);
        assert.ok(['https://core.archivepilates.com', 'https://archive-pilates-core.web.app'].includes(parsed.origin));
        assert.equal(init.headers, undefined, 'never leak auth to public origins');
        assert.equal(init.cache, 'no-store');
        const bytes = options.badLive === (published ? 'after' : 'before') ? Buffer.from('mismatch')
          : (published ? source : prior)[parsed.pathname];
        return {ok: true, arrayBuffer: async () => bytes};
      }
      assert.equal(init.headers.Authorization, 'Bearer offline-test-token');
      if (init.method && init.method !== 'GET') {
        assert.ok(fs.existsSync(lock), 'site lock must cover every write');
        assert.ok(fs.existsSync(path.join(directory, 'hosting-release-intent.json')), 'durable intent precedes every write');
        assert.equal(receipt().attempts.at(-1).state, 'pending_or_unknown');
        writes.push({url, method: init.method, body: init.body});
        const label = receipt().attempts.at(-1).label;
        if (options.failStage === label || (options.failStage === 'upload' && label.startsWith('upload:'))) {
          throw Error('ambiguous transport failure');
        }
      }
      const resource = url.replace('https://firebasehosting.googleapis.com/v1beta1/', '');
      let value;
      if (resource === 'sites/archive-pilates-core/releases?pageSize=1') {
        value = {releases: [{name: published ? newRelease : options.concurrent && writes.length ? 'sites/archive-pilates-core/releases/other' : baselineRelease,
          version: {name: published ? created : expected}}]};
      } else if (resource === expected) {
        value = {name: expected, config, status: 'FINALIZED'};
      } else if (resource === `${expected}/files?pageSize=1000`) {
        value = {files: options.badCount ? files.slice(1) : options.pagination ? files.slice(0, 30) : files,
          ...(options.pagination ? {nextPageToken: 'second'} : {})};
      } else if (resource === `${expected}/files?pageSize=1000&pageToken=second`) {
        value = {files: files.slice(30), ...(options.cursorLoop ? {nextPageToken: 'second'} : {})};
      } else if (resource === 'sites/archive-pilates-core/versions') {
        assert.deepEqual(JSON.parse(init.body), {config});
        if (options.sourceRace) fs.appendFileSync(path.join(root, 'core', paths[0]), 'concurrent edit');
        value = {name: created};
      } else if (resource === `${created}:populateFiles`) {
        manifest = JSON.parse(init.body).files;
        const needed = paths.map(resource => manifest[resource]);
        value = {uploadRequiredHashes: options.foreignUpload ? ['f'.repeat(64)] : options.duplicateUpload ? [needed[0], needed[0]] : needed,
          uploadUrl: options.uploadUrl ?? 'https://upload-firebasehosting.googleapis.com/upload/sites/archive-pilates-core/versions/created/files'};
      } else if (url.startsWith('https://upload-firebasehosting.googleapis.com/')) {
        const hash = url.split('/').at(-1);
        assert.equal(sha(init.body), hash, 'upload compressed bytes must match manifest hash');
        return {ok: true};
      } else if (resource === `${created}/files?pageSize=1000`) {
        value = {files: Object.entries(manifest).map(([path, hash]) => ({path, hash}))};
        if (options.corruptManifest) value.files[69].hash = 'd'.repeat(64);
      } else if (resource === created || resource === `${created}?updateMask=status`) {
        if (init.method === 'PATCH') { assert.deepEqual(JSON.parse(init.body), {status: 'FINALIZED'}); finalized = true; }
        value = {name: created, config: options.corruptConfig ? {...config, cleanUrls: false} : config,
          status: finalized ? 'FINALIZED' : 'CREATED'};
      } else if (resource === `sites/archive-pilates-core/releases?versionName=${created}`) {
        assert.ok(finalized); published = true; value = {name: newRelease};
      } else {
        throw Error(`Unexpected offline request: ${resource}`);
      }
      return {ok: true, json: async () => structuredClone(value)};
    },
  };
  return {dependencies, calls, writes, commands, directory, lock, receipt, files, root, pins, source};
}

test('pinned baseline and exactly four replacements retain all 70 paths and 66 untouched hashes', () => {
  assert.equal(MEMBER_LINK_BASELINE_COMMIT, '863942297e6ca6652e6a91a6dc48694d1ceb361c');
  assert.equal(expected, 'sites/archive-pilates-core/versions/9f17a1e13333cd8c');
  const files = baselineFiles(), manifest = memberLinkReleaseManifest(files, replacements);
  assert.equal(Object.keys(manifest).length, 70);
  assert.deepEqual(Object.keys(manifest).sort(), files.map(file => file.path).sort());
  for (const file of files) assert.equal(manifest[file.path], replacements[file.path] ?? file.hash);
});

test('manifest rejects additions, removals, wrong counts, duplicates, missing targets and no-ops', () => {
  const files = baselineFiles();
  for (const candidate of [files.slice(1), [...files, files[0]], [files[0], ...files.slice(0, -1)],
    [...files.slice(1), {path: '/foreign.js', hash: 'a'.repeat(64)}],
    [...files.slice(1), {path: '/../invalid', hash: 'a'.repeat(64)}],
    [...files.slice(1), {path: '/bad.js', hash: 'invalid'}]]) {
    assert.throws(() => memberLinkReleaseManifest(candidate, replacements));
  }
  assert.throws(() => memberLinkReleaseManifest(files, {...replacements, '/extra.js': 'c'.repeat(64)}));
  assert.throws(() => memberLinkReleaseManifest(files, Object.fromEntries(Object.entries(replacements).slice(1))));
  assert.throws(() => memberLinkReleaseManifest(files, {...replacements, [paths[0]]: 'a'.repeat(64)}));
  assert.throws(() => memberLinkReleaseManifest(files, {...replacements, [paths[0]]: null}));
});

test('invalid arguments and unfinalized pins stop before local commands, auth or network', async () => {
  const dependencies = {execFileSync: () => assert.fail('must not execute'), fetch: () => assert.fail('must not fetch')};
  for (const candidate of [[], ['--apply'], ['--expected-version=9f17a1e13333cd8c'],
    ['--expected-version=sites/archive-pilates-help/versions/9f17a1e13333cd8c'],
    [...args, '--override'], [...args, '--target=core'], [...args, ...args], [...args, '--apply', '--apply']]) {
    await assert.rejects(releaseMemberLink(candidate, dependencies), /Exact pinned/);
  }
  // This assertion follows the production pins, so finalizing pins does not break the suite.
  await assert.rejects(releaseMemberLink(args, {...dependencies, sourcePins: {...MEMBER_LINK_SOURCE_PINS, [paths[0]]: null}}), /Final reviewed/);
});

test('plan checks fresh aligned main, paginated full manifest, config and baseline bytes without writes', async t => {
  const f = fixture(t, {pagination: true});
  const result = await releaseMemberLink(args, f.dependencies);
  assert.equal(result.mode, 'plan'); assert.equal(result.baselineCount, 70); assert.equal(result.unchangedCount, 66);
  assert.equal(f.writes.length, 0); assert.equal(fs.existsSync(f.directory), false);
  assert.ok(f.commands.find(command => command.join(' ') === 'git fetch origin main'));
  assert.equal(f.calls.filter(call => call.url.startsWith('https://core.archivepilates.com/')).length, 4);
  assert.equal(f.calls.filter(call => call.url.startsWith('https://archive-pilates-core.web.app/')).length, 4);
});

for (const options of [{branch: 'feature'}, {dirty: true}, {unaligned: true}, {notAncestor: true}]) {
  test(`non-release Git state stops before auth: ${JSON.stringify(options)}`, async t => {
    const f = fixture(t, options);
    await assert.rejects(releaseMemberLink(args, f.dependencies));
    assert.equal(f.commands.some(command => command[0] === 'gcloud'), false); assert.equal(f.calls.length, 0);
  });
}

for (const options of [{badCount: true}, {pagination: true, cursorLoop: true}, {badLive: 'before'}]) {
  test(`baseline failure performs no Hosting writes: ${JSON.stringify(options)}`, async t => {
    const f = fixture(t, options);
    await assert.rejects(releaseMemberLink([...args, '--apply'], f.dependencies));
    assert.equal(f.writes.length, 0); assert.equal(fs.existsSync(f.lock), false);
  });
}

test('apply uses write-ahead private evidence, single guarded writes and independent final verification', async t => {
  const f = fixture(t), result = await releaseMemberLink([...args, '--apply'], f.dependencies);
  assert.equal(fs.statSync(f.directory).mode & 0o777, 0o700);
  for (const filename of ['hosting-release-intent.json', 'hosting-release.json']) {
    assert.equal(fs.statSync(path.join(f.directory, filename)).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(f.directory, filename), 'utf8').includes('offline-test-token'), false);
  }
  assert.equal(result.newCount, 70); assert.equal(result.unchangedFilesVerified, true); assert.ok(result.verifiedAt);
  assert.equal(result.memberDispatch, false); assert.equal(fs.existsSync(f.lock), false);
  assert.equal(f.writes.length, 8); assert.equal(new Set(result.attempts.map(attempt => attempt.label)).size, 8);
  assert.ok(result.attempts.every(attempt => attempt.state === 'accepted'));
  assert.equal(f.calls.filter(call => call.url.startsWith('https://core.archivepilates.com/')).length, 8);
  assert.equal(f.calls.filter(call => call.url.startsWith('https://archive-pilates-core.web.app/')).length, 8);
  assert.deepEqual(f.receipt(), result);
  const count = f.writes.length;
  await assert.rejects(releaseMemberLink([...args, '--apply'], f.dependencies), /Prior intent/);
  assert.equal(f.writes.length, count);
});

for (const stage of ['create-version', 'populate-files', 'upload', 'finalize-version', 'release-version']) {
  test(`ambiguous ${stage} transport is never retried and blocks a later run`, async t => {
    const f = fixture(t, {failStage: stage});
    await assert.rejects(releaseMemberLink([...args, '--apply'], f.dependencies), /ambiguous transport/);
    const result = f.receipt(), count = f.writes.length;
    assert.equal(result.attempts.at(-1).state, 'pending_or_unknown'); assert.equal(result.verifiedAt, undefined);
    assert.equal(fs.existsSync(f.lock), false);
    await assert.rejects(releaseMemberLink([...args, '--apply'], f.dependencies), /Prior intent/);
    assert.equal(f.writes.length, count);
  });
}

for (const options of [{corruptManifest: true}, {corruptConfig: true}, {foreignUpload: true}, {duplicateUpload: true},
  {uploadUrl: 'https://evil.example/upload/x'}, {uploadUrl: 'https://upload-firebasehosting.googleapis.com/upload/x?redirect=bad'},
  {sourceRace: true}, {concurrent: true}, {badLive: 'after'}]) {
  test(`fail closed on drift or invalid provider response: ${JSON.stringify(options)}`, async t => {
    const f = fixture(t, options);
    await assert.rejects(releaseMemberLink([...args, '--apply'], f.dependencies));
    assert.equal(f.receipt().verifiedAt, undefined); assert.equal(fs.existsSync(f.lock), false);
    if (options.sourceRace || options.concurrent) assert.equal(f.writes.length, 1);
    if (!options.badLive) assert.equal(f.writes.some(write => write.url.includes('/releases?versionName=')), false);
  });
}

for (const kind of ['mode', 'symlink', 'intent', 'receipt', 'tmp', 'lock']) {
  test(`unsafe private state or held site lock is preserved: ${kind}`, async t => {
    const f = fixture(t);
    fs.mkdirSync(f.directory, {recursive: true, mode: 0o700});
    let sentinel;
    if (kind === 'mode') fs.chmodSync(f.directory, 0o755);
    else if (kind === 'symlink') {
      fs.rmdirSync(f.directory); const target = path.join(path.dirname(f.directory), 'other');
      fs.mkdirSync(target, {mode: 0o700}); fs.symlinkSync(target, f.directory);
    } else {
      sentinel = kind === 'lock' ? f.lock : path.join(f.directory,
        kind === 'intent' ? 'hosting-release-intent.json' : kind === 'tmp' ? 'hosting-release.json.tmp' : 'hosting-release.json');
      fs.writeFileSync(sentinel, 'preserve', {mode: 0o600});
    }
    await assert.rejects(releaseMemberLink([...args, '--apply'], f.dependencies));
    assert.equal(f.writes.length, 0);
    if (sentinel) assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
    if (kind !== 'lock') assert.equal(fs.existsSync(f.lock), false);
  });
}
