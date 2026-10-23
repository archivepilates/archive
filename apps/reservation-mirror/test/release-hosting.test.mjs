import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {releaseTarget, parseArgs, manifestMap, makeManifest, assertManifest, configHash, sha256,
  assertProductionBundle, assertMirrorAssets, assertGitSource, uploadUrl, makePlan, publishFiles} from '../release-hosting.mjs';

const SITE = 'archive-pilates-booking-test', CORE = 'archive-pilates-core';
const h = value => sha256(Buffer.from(value));
const bundle = Buffer.from('identitytoolkit.googleapis.com signInWithPassword real-sdk');
const assets = {'/index.html': Buffer.from('index'), '/app.js': bundle, '/style.css': Buffer.from('style'), '/symbol.png': Buffer.from('symbol')};
const files = [...Object.keys(assets).map(p => ({path: p, hash: h('old-' + p)})), {path: '/unrelated.txt', hash: h('untouched')}];
const baseline = {name: `sites/${SITE}/versions/baseline`, status: 'FINALIZED', config: {
  rewrites: [{glob: '/api/**', run: {serviceId: 'archive-reservation-mirror', region: 'asia-northeast3', tag: 'fh-existing-exact-tag'}}],
  headers: [{glob: '**', headers: {'Cache-Control': 'no-store'}}], cleanUrls: true,
}};
const release = {name: `sites/${SITE}/releases/original`, version: {name: baseline.name}};
const source = {commit: 'a'.repeat(40), files: {'web/app.js': h('source')}};
const plan = () => makePlan(SITE, release, baseline, files, assets, source);

test('targets cannot reach the sales/root site or any other CORE file', () => {
  assert.deepEqual(Object.keys(releaseTarget(SITE).files).sort(), Object.keys(assets).sort());
  assert.deepEqual(releaseTarget(CORE).files, {'/rules/index.html': 'core/rules/index.html'});
  for (const site of ['archive-pilates', 'archive-pilates-home', '../archive-pilates-core', '__proto__', undefined]) assert.throws(() => releaseTarget(site));
});

test('CLI requires explicit mode/site and reviewed expected version for apply', () => {
  assert.equal(parseArgs(['--plan', '--site', SITE]).plan, true);
  assert.equal(parseArgs(['--site=' + SITE, '--apply', '--expected-version=' + baseline.name]).expectedVersion, baseline.name);
  for (const args of [[], ['--site', SITE], ['--site', SITE, '--plan', '--apply'], ['--site', SITE, '--apply'],
    ['--site', SITE, '--plan=true'], ['--site', SITE, '--plan', '--plan'], ['--site', SITE, '--plan', '--force'],
    ['--site', SITE, '--apply', '--expected-version', 'sites/archive-pilates/versions/x'],
    ['--site', SITE, '--apply', '--expected-version', baseline.name + '?x'],
    ['--site', SITE, '--plan', '--expected-version', baseline.name]]) assert.throws(() => parseArgs(args));
});

test('whole manifest retains every unrelated path and restricts replacements exactly', () => {
  const replacements = Object.fromEntries(Object.entries(assets).map(([p, b]) => [p, h(b)]));
  const manifest = makeManifest(SITE, files, replacements);
  assert.equal(manifest['/unrelated.txt'], files.at(-1).hash);
  assert.equal(Object.keys(manifest).length, files.length);
  assert.throws(() => makeManifest(SITE, files, {...replacements, '/other': h('bad')}));
  assert.throws(() => makeManifest(SITE, files.slice(1), replacements), /missing/);
  assert.throws(() => makeManifest(SITE, files, {'/index.html': h('partial')}), /exact/);
  const coreFiles = [{path: '/rules/index.html', hash: h('old')}, {path: '/assets/app.js', hash: h('keep')}];
  assert.equal(makeManifest(CORE, coreFiles, {'/rules/index.html': h('new')})['/assets/app.js'], h('keep'));
  assert.throws(() => makeManifest(CORE, coreFiles, {'/assets/app.js': h('new')}));
});

test('manifest checks reject duplicate/missing/extra paths and invalid hashes', () => {
  assert.throws(() => manifestMap([...files, files[0]]), /Duplicate/);
  for (const entry of [{path: 'relative', hash: h('x')}, {path: '/a/../b', hash: h('x')},
    {path: '/valid', hash: 'invalid'}, {path: '/a?b', hash: h('x')}]) assert.throws(() => manifestMap([entry]));
  assert.throws(() => manifestMap([]));
  const expected = manifestMap(files);
  assert.doesNotThrow(() => assertManifest([...files].reverse(), expected));
  assert.throws(() => assertManifest(files.slice(1), expected));
  assert.throws(() => assertManifest([...files, {path: '/unexpected', hash: h('x')}], expected));
  assert.throws(() => assertManifest(files.map((f, i) => i ? f : {...f, hash: h('changed')}), expected));
});

test('config hashing preserves array order and exact rewrite pin while ignoring object key order', () => {
  assert.equal(configHash({a: 1, b: 2}), configHash({b: 2, a: 1}));
  assert.notEqual(configHash([1, 2]), configHash([2, 1]));
  const changed = structuredClone(baseline.config); changed.rewrites[0].run.tag = 'different';
  assert.notEqual(configHash(changed), configHash(baseline.config));
});

test('source must be clean main or detached, exactly matching both origin/main refs', () => {
  const state = {branch: 'main', head: 'a'.repeat(40), originMain: 'a'.repeat(40), remoteMain: 'a'.repeat(40), status: ''};
  assert.doesNotThrow(() => assertGitSource(state));
  assert.doesNotThrow(() => assertGitSource({...state, branch: 'HEAD'}));
  for (const patch of [{branch: 'feature'}, {status: '?? unrelated'}, {originMain: 'b'.repeat(40)},
    {remoteMain: 'b'.repeat(40)}, {head: 'invalid'}]) assert.throws(() => assertGitSource({...state, ...patch}));
});

test('mirror build must byte-match index/style/icon and a fresh production bundle', () => {
  const sources = {index: assets['/index.html'], style: assets['/style.css'], symbol: assets['/symbol.png'], rebuiltBundle: bundle};
  assert.doesNotThrow(() => assertMirrorAssets(assets, sources));
  for (const p of Object.keys(assets)) assert.throws(() => assertMirrorAssets({...assets, [p]: Buffer.from('stale')}, sources), /Stale/);
  assert.throws(() => assertMirrorAssets({...assets, '/extra.txt': Buffer.from('private')}, sources), /exactly four/);
  for (const marker of ['SYNTHETIC_PREVIEW', 'synthetic-preview-token', 'demo-synthetic', 'preview-auth', 'preview-app', 'demo.invalid']) {
    assert.throws(() => assertProductionBundle(Buffer.from(bundle + marker)), /mock/);
  }
  assert.throws(() => assertProductionBundle(Buffer.from('no real auth')), /missing/);
});

test('upload URLs cannot redirect credentials to another origin or carry URL credentials', () => {
  assert.equal(uploadUrl('https://upload-firebasehosting.googleapis.com/upload/', h('x')), `https://upload-firebasehosting.googleapis.com/upload/${h('x')}`);
  for (const url of ['http://upload-firebasehosting.googleapis.com/upload', 'https://evil.invalid/upload',
    'https://user:password@upload-firebasehosting.googleapis.com/upload',
    'https://upload-firebasehosting.googleapis.com/upload?secret=x', 'https://upload-firebasehosting.googleapis.com/upload#x']) assert.throws(() => uploadUrl(url, h('x')));
});

test('review plan contains only hashes/provenance, and omits unchanged asset uploads', () => {
  const sameFiles = files.map(f => f.path === '/index.html' ? {...f, hash: sha256(gzipSync(assets[f.path], {level: 9}))} : f);
  const reviewed = makePlan(SITE, release, baseline, sameFiles, assets, source);
  assert.equal(reviewed.changes.length, 3);
  assert.ok(!reviewed.changes.some(c => c.path === '/index.html'));
  assert.equal(reviewed.configHash, configHash(baseline.config));
  assert.ok(!JSON.stringify(reviewed).includes('fh-existing-exact-tag'));
  assert.ok(!Object.hasOwn(reviewed, 'config'));
  assert.throws(() => makePlan(SITE, release, {...baseline, status: 'CREATED'}, files, assets, source));
});

function fakeApi({unexpectedUpload = false, corruptManifest = false, corruptConfig = false,
  concurrentAt = 0, sourceFailsAt = 0, ambiguousRelease = false, chunkCount = 0} = {}) {
  const calls = [], uploads = [], progress = [], created = `sites/${SITE}/versions/new`;
  let manifest = {}, released = false, finalized = false, guards = 0, checks = 0;
  const api = {
    latest: async () => {
      guards++;
      return concurrentAt === guards ? {...release, name: release.name + '-concurrent'}
        : released ? {name: `sites/${SITE}/releases/new-release`, version: {name: created}} : release;
    },
    request: async (resource, method = 'GET', body) => {
      calls.push({resource, method, body});
      if (resource === `sites/${SITE}/versions` && method === 'POST') return {name: created};
      if (resource === `${created}:populateFiles`) {
        Object.assign(manifest, body.files);
        const required = unexpectedUpload ? [h('not-a-changed-asset')]
          : Object.entries(body.files).filter(([p]) => Object.hasOwn(assets, p)).map(([, hash]) => hash);
        return {uploadRequiredHashes: required, uploadUrl: 'https://upload-firebasehosting.googleapis.com/upload'};
      }
      if (resource === created && method === 'GET') {
        const config = structuredClone(baseline.config); if (corruptConfig) config.rewrites[0].run.tag = 'retagged';
        return {name: created, config, status: finalized ? 'FINALIZED' : 'CREATED'};
      }
      if (resource === `${created}?updateMask=status`) { finalized = true; return {name: created}; }
      if (resource.startsWith(`sites/${SITE}/releases?`) && method === 'POST') {
        if (ambiguousRelease) throw Error('synthetic ambiguous transport');
        released = true; return {name: `sites/${SITE}/releases/new-release`, releaseTime: 'synthetic-time'};
      }
      throw Error('Unexpected synthetic API call');
    },
    filesFor: async () => Object.entries(manifest).map(([p, hash], i) => ({path: p, hash: corruptManifest && !i ? h('wrong') : hash})),
    upload: async (url, bytes) => uploads.push({url, hash: sha256(bytes)}),
  };
  const extraFiles = Array.from({length: chunkCount}, (_, i) => ({path: `/untouched-${i}`, hash: h('keep-' + i)}));
  const allFiles = [...files, ...extraFiles];
  return {calls, uploads, progress, api, allFiles,
    run: () => publishFiles({plan: makePlan(SITE, release, baseline, allFiles, assets, source), baseline,
      files: allFiles, assets, api, checkSource: async () => { if (++checks === sourceFailsAt) throw Error('Source changed'); },
      progress: async patch => progress.push(patch)})};
}

test('release clones exact live config/pin, retains all files across pages, and uploads only changed gzip bytes', async () => {
  const f = fakeApi({chunkCount: 1100}); await f.run();
  assert.deepEqual(f.calls[0].body, {config: baseline.config});
  assert.equal(f.calls.filter(c => c.resource.endsWith(':populateFiles')).length, 2);
  assert.equal(f.uploads.length, 4);
  assert.deepEqual(f.uploads.map(u => u.hash).sort(), Object.values(assets).map(b => sha256(gzipSync(b, {level: 9}))).sort());
  assert.equal(f.calls.filter(c => c.method === 'PATCH').length, 1);
  assert.deepEqual(f.calls.find(c => c.method === 'PATCH').body, {status: 'FINALIZED'});
  assert.ok(f.progress.find(p => p.releaseIntentAt));
  assert.equal(f.calls.filter(c => c.resource.includes('/releases?')).length, 1);
  assert.ok(f.calls.every(c => c.resource.startsWith(`sites/${SITE}/`)));
});

for (const [label, options] of [
  ['unexpected upload', {unexpectedUpload: true}], ['manifest mismatch', {corruptManifest: true}],
  ['config/pin change', {corruptConfig: true}], ['baseline race before creation', {concurrentAt: 1}],
  ['baseline race before finalize', {concurrentAt: 2}], ['source changed before creation', {sourceFailsAt: 1}],
  ['source changed before finalize', {sourceFailsAt: 2}],
]) test(`${label} aborts before finalization and release`, async () => {
  const f = fakeApi(options); await assert.rejects(f.run());
  assert.ok(!f.calls.some(c => c.method === 'PATCH' || c.resource.includes('/releases?')));
});

test('race after finalization blocks the release request', async () => {
  const f = fakeApi({concurrentAt: 3}); await assert.rejects(f.run(), /Concurrent/);
  assert.ok(f.calls.some(c => c.method === 'PATCH'));
  assert.ok(!f.calls.some(c => c.resource.includes('/releases?')));
});

test('ambiguous release is attempted once, with intent already recorded', async () => {
  const f = fakeApi({ambiguousRelease: true}); await assert.rejects(f.run(), /ambiguous/);
  assert.equal(f.calls.filter(c => c.resource.includes('/releases?')).length, 1);
  assert.ok(f.progress.at(-1).releaseIntentAt);
});

test('tampered review plan and no-op release cannot create a version', async () => {
  const f = fakeApi(), reviewed = plan(); reviewed.configHash = h('wrong');
  await assert.rejects(publishFiles({plan: reviewed, baseline, files, assets, api: f.api}), /reviewed/);
  const same = files.map(file => Object.hasOwn(assets, file.path) ? {...file, hash: sha256(gzipSync(assets[file.path], {level: 9}))} : file);
  await assert.rejects(publishFiles({plan: makePlan(SITE, release, baseline, same, assets, source), baseline, files: same, assets, api: f.api}), /No changed/);
  assert.equal(f.calls.length, 0);
});
