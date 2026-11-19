import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {MATERIAL_PATHS, parseTeamD1Args, assertTeamD1RulesNoteOnly, teamD1Manifest,
  teamD1Uploads, releaseTeamD1} from '../release-team-261120-d1.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = char => char.repeat(64), commit = 'a'.repeat(40);
const site = 'archive-pilates-in', base = `sites/${site}/versions/base`, next = `sites/${site}/versions/new`;
const firstRelease = `sites/${site}/releases/first`, nextRelease = `sites/${site}/releases/second`;
const replacements = Object.fromEntries(MATERIAL_PATHS.map((resource, index) => [resource, hash(index ? 'b' : 'a')]));
const calendar = '/method/team-261120/calendar/index.html';
const baselineFiles = [{path: '/index.html', hash: hash('1')}, {path: calendar, hash: hash('2')},
  {path: '/method/team-261120/calendar/archive-method-261120.ics', hash: hash('3')},
  {path: '/assets/keep.js', hash: hash('4')}];
const json = data => ({ok: true, status: 200, json: async () => structuredClone(data)});
const bytes = (data, status = 200, location) => ({ok: status >= 200 && status < 300, status,
  headers: new Headers(location ? {location} : {}), arrayBuffer: async () => Buffer.from(data)});

test('arguments require one exact target and fully site-bound reviewed version', () => {
  assert.deepEqual(parseTeamD1Args(['--target=materials']), {target: 'materials', expected: undefined, apply: false});
  assert.equal(parseTeamD1Args(['--target=rules', '--apply', '--expected-version=sites/archive-pilates-core/versions/v1']).apply, true);
  for (const args of [[], ['--target=constructor'], ['--target=rules', '--target=rules'], ['--target=materials', '--apply'],
    ['--target=materials', '--apply', '--apply'], ['--target=materials', '--unknown'],
    ['--target=rules', '--expected-version=' + base], ['--target=materials', '--expected-version=' + base + '/suffix'],
    ['--target=materials', '--expected-version=' + base + '\n'], ['--target=materials', '--expected-version=' + base + '?q=1'],
    ['--target=materials', '--expected-version=' + base, '--expected-version=' + base], [null]]) {
    assert.throws(() => parseTeamD1Args(args), /arguments|required/);
  }
});

test('materials add exactly two files while preserving calendar and every other hash', () => {
  const original = structuredClone(baselineFiles), result = teamD1Manifest('materials', baselineFiles, replacements);
  assert.deepEqual(Object.keys(result).sort(), [...original.map(file => file.path), ...MATERIAL_PATHS].sort());
  for (const file of original) assert.equal(result[file.path], file.hash);
  assert.deepEqual(baselineFiles, original);
  for (const resource of MATERIAL_PATHS) {
    assert.throws(() => teamD1Manifest('materials', [...original, {path: resource, hash: hash('5')}], replacements), /initial addition/);
  }
  assert.throws(() => teamD1Manifest('materials', original, {...replacements, [calendar]: hash('5')}), /Exact target/);
  assert.throws(() => teamD1Manifest('materials', original, {[MATERIAL_PATHS[0]]: hash('a')}), /Exact target/);
});

test('manifest paths, duplicate rows, aliases, hashes and rules-only replacement fail closed', () => {
  for (const resource of ['/a/../b', '//a', '/a%2fb', '/a?b', '/a#b', '/a\\b', '/a\nb', '/a/', 'relative']) {
    assert.throws(() => teamD1Manifest('materials', [{path: resource, hash: hash('a')}], replacements), /Invalid/);
  }
  assert.throws(() => teamD1Manifest('materials', [...baselineFiles, baselineFiles[0]], replacements), /duplicate/);
  assert.throws(() => teamD1Manifest('materials', [{path: '/a', hash: hash('a') + '\n'}], replacements), /Invalid/);
  assert.throws(() => teamD1Manifest('materials', [], replacements), /nonempty/);
  assert.throws(() => teamD1Manifest('materials', [...baselineFiles, {path: '/method/team-261120.html', hash: hash('6')}], replacements), /initial/);
  const rules = [...baselineFiles, {path: '/rules/index.html', hash: hash('5')}];
  const result = teamD1Manifest('rules', rules, {'/rules/index.html': hash('6')});
  for (const file of baselineFiles) assert.equal(result[file.path], file.hash);
  assert.equal(result['/rules/index.html'], hash('6'));
  assert.throws(() => teamD1Manifest('rules', rules, {'/rules/index.html': hash('5')}), /changed rules/);
  assert.throws(() => teamD1Manifest('rules', baselineFiles, {'/rules/index.html': hash('6')}), /changed rules/);
});

test('rules permit just one sibling note after the existing li with all other bytes identical', () => {
  const before = '<ul>\r\n  <li id="instructor-d1-team-1400"><strong>Existing</strong> rule</li>\r\n  <li>Keep</li>\r\n</ul>';
  const marker = '</li>', note = '\n  <li id="team-261120-manual-d1"><strong>D-1</strong>: reviewed note.</li>';
  const after = before.replace(marker, marker + note);
  assert.doesNotThrow(() => assertTeamD1RulesNoteOnly(Buffer.from(before), Buffer.from(after)));
  for (const changed of [before, after.replace('Existing', 'Changed'), after.replace('Keep', 'Change'),
    after + '\n', after.replace(note, note + '\n<li>Extra</li>'), after.replace(note, '\n<script>bad()</script>'),
    before.replace('<li>Keep</li>', '<li>Keep</li>' + note), after.replace(note, '\n  <li></li>')]) {
    assert.throws(() => assertTeamD1RulesNoteOnly(before, changed), /note|sibling/);
  }
  assert.throws(() => assertTeamD1RulesNoteOnly('<ul></ul>', after), /Unique/);
});

test('uploads accept only requested compressed target hashes and the exact upload host', () => {
  const uploadUrl = 'https://upload-firebasehosting.googleapis.com/upload/site/files';
  const result = {uploadUrl, uploadRequiredHashes: [hash('a'), hash('a')]};
  assert.deepEqual(teamD1Uploads(result, replacements, replacements), [{hash: hash('a'), url: uploadUrl + '/' + hash('a')}]);
  assert.deepEqual(teamD1Uploads(result, replacements, replacements, new Set([hash('a')])), []);
  assert.throws(() => teamD1Uploads({...result, uploadRequiredHashes: [hash('1')]}, replacements, replacements), /Only target/);
  assert.throws(() => teamD1Uploads(result, {}, replacements), /Only target/);
  assert.throws(() => teamD1Uploads({...result, uploadRequiredHashes: null}, replacements, replacements), /Only target/);
  for (const url of ['http://upload-firebasehosting.googleapis.com/files', 'https://evil.example/files',
    'https://upload-firebasehosting.googleapis.com.evil.example/files', 'https://user@upload-firebasehosting.googleapis.com/files',
    uploadUrl + '?token=x', uploadUrl + '#fragment']) {
    assert.throws(() => teamD1Uploads({...result, uploadUrl: url}, replacements, replacements), /upload host/);
  }
});

function fixture(t, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'team-d1-release-'));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const root = path.join(home, 'repo'); fs.mkdirSync(root);
  const source = Object.fromEntries(MATERIAL_PATHS.map((resource, i) => [resource, Buffer.from(`<html>fixture ${i}</html>\n`)]));
  for (const [resource, content] of Object.entries(source)) {
    fs.mkdirSync(path.dirname(path.join(root, 'archivein' + resource)), {recursive: true});
    fs.writeFileSync(path.join(root, 'archivein' + resource), content);
  }
  const calls = [], gitCalls = [], uploads = new Map(), config = {cleanUrls: true, trailingSlash: true,
    headers: [{source: '**', headers: [{key: 'X-Keep', value: 'exact'}]}], rewrites: [{source: '/keep/**', destination: '/index.html'}]};
  let current = firstRelease, status = 'CREATED', newManifest = {}, mutations = 0, tokenCalls = 0;
  const receipt = path.join(home, 'archive-automation/operations/2026-11-19-team-261120-d1/materials-hosting-release.json');
  const lock = path.join(home, `archive-automation/automation/locks/firebase-hosting-${site}.lock`);
  const git = args => {
    gitCalls.push(args);
    if (args[0] === 'show') return source[args[1].slice('HEAD:archivein'.length)] || Buffer.from('unexpected');
    if (args[0] === 'ls-files') {if (options.untracked) throw Error('Untracked'); return '';}
    if (args[0] === 'fetch') return '';
    if (args[0] === 'branch') return options.branch || 'main';
    if (args[0] === 'status') return options.dirty ? ' M unrelated' : '';
    if (args[0] === 'rev-parse') return args[1] === 'FETCH_HEAD' && options.staleRemote ? 'b'.repeat(40) : commit;
    throw Error('Unexpected Git command ' + args);
  };
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET'; calls.push({url, method});
    assert.equal(init.signal instanceof AbortSignal, true);
    if (method !== 'GET') {
      mutations++;
      assert.equal(fs.existsSync(lock), true, 'shared site lock must be held before writes');
      assert.ok(JSON.parse(fs.readFileSync(receipt)).versionCreateIntentAt, 'durable intent precedes all writes');
      if (options.fail === 'version' && url === API + `sites/${site}/versions`) throw Error('ambiguous version');
      if (options.fail === 'populate' && url.includes(':populateFiles')) throw Error('ambiguous populate');
      if (options.fail === 'upload' && url.startsWith('https://upload-')) throw Error('ambiguous upload');
      if (options.fail === 'finalize' && method === 'PATCH') throw Error('ambiguous finalize');
    }
    if (!url.startsWith(API) && !url.startsWith('https://upload-')) {
      assert.equal(method, 'GET'); assert.equal(init.cache, 'no-store');
      const route = new URL(url).pathname;
      const resource = MATERIAL_PATHS.find(resource => [resource, resource.slice(0, -11), resource.slice(0, -10)].includes(route));
      assert.ok(resource, 'only scoped public routes may be read');
      if (current === firstRelease) return bytes('', options.initialPresent ? 200 : 404);
      if (options.propagation) return bytes('old CDN');
      if (options.redirect && !route.endsWith('/')) return bytes('', 301, resource.slice(0, -10));
      return bytes(source[resource]);
    }
    if (url.startsWith('https://upload-')) {
      const digest = url.split('/').at(-1); assert.equal(sha(init.body), digest);
      uploads.set(digest, gunzipSync(init.body)); return bytes('');
    }
    const resource = url.slice(API.length);
    if (resource === `sites/${site}/releases?pageSize=1`) return json({releases: [{name: current, version: {name: current === firstRelease ? base : next}}]});
    if (resource === base) return json({name: base, status: 'FINALIZED', config});
    if (resource === base + '/files?pageSize=1000') return json({files: baselineFiles});
    if (resource === `sites/${site}/versions` && method === 'POST') {assert.deepEqual(JSON.parse(init.body), {config}); return json({name: next});}
    if (resource === next + ':populateFiles') {
      Object.assign(newManifest, JSON.parse(init.body).files);
      return json({uploadUrl: 'https://upload-firebasehosting.googleapis.com/upload/files',
        uploadRequiredHashes: MATERIAL_PATHS.map(resource => newManifest[resource])});
    }
    if (resource === next) return json({name: next, status, config: options.configDrift ? {...config, cleanUrls: false} : config});
    if (resource === next + '/files?pageSize=1000') return json({files: Object.entries(newManifest)
      .filter(([resource]) => !options.manifestDrift || resource !== calendar).map(([path, hash]) => ({path, hash}))});
    if (resource === next + '?updateMask=status') {status = 'FINALIZED'; return json({name: next});}
    if (resource === `sites/${site}/releases?versionName=${next}` && method === 'POST') {
      current = nextRelease;
      if (options.fail === 'release') throw Error('ambiguous release');
      if (options.sourceDrift) fs.appendFileSync(path.join(root, 'archivein' + MATERIAL_PATHS[0]), 'drift');
      return json({name: nextRelease, version: {name: next}});
    }
    throw Error('Unexpected synthetic HTTP request: ' + method + ' ' + resource);
  };
  const API = 'https://firebasehosting.googleapis.com/v1beta1/';
  const run = (apply = true) => releaseTeamD1({root, home, git, fetchImpl,
    getToken: () => {tokenCalls++; return 'synthetic-not-a-credential';},
    args: apply ? ['--target=materials', '--apply', '--expected-version=' + base] : ['--target=materials']});
  return {run, root, home, calls, gitCalls, uploads, config, receipt, lock, options,
    get mutations() {return mutations;}, get tokenCalls() {return tokenCalls;}};
}

test('plan is GET-only with committed source hashes and no intent/auth side effects beyond injected token', async t => {
  const f = fixture(t), result = await f.run(false);
  assert.equal(result.mode, 'plan'); assert.equal(result.fileCount, baselineFiles.length + 2);
  assert.equal(f.mutations, 0); assert.equal(fs.existsSync(f.receipt), false);
  assert.equal(f.gitCalls.some(args => args[0] === 'fetch'), false);
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.equal(result.sourceHashes[MATERIAL_PATHS[0]], sha('<html>fixture 0</html>\n'));
});

test('apply preserves full config/manifest and verifies all raw, clean and slash routes', async t => {
  const f = fixture(t), result = await f.run();
  assert.equal(result.verified, true); assert.equal(result.sourceCommit, commit);
  assert.equal(f.uploads.size, 2); assert.equal(fs.existsSync(f.lock), false);
  assert.equal(fs.statSync(f.receipt).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(f.receipt)).mode & 0o777, 0o700);
  assert.ok(f.gitCalls.filter(args => args[0] === 'fetch').length >= 3);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.url.endsWith(`releases?versionName=${next}`)).length, 1);
  const mutations = f.mutations, reconciled = await f.run(false);
  assert.equal(reconciled.mode, 'reconcile'); assert.equal(reconciled.verified, true);
  assert.equal(f.mutations, mutations);
  await assert.rejects(f.run(), /Existing intent/); assert.equal(f.mutations, mutations);
});

test('untracked, dirty, non-main, stale main and local source drift stop before transport', async t => {
  for (const options of [{untracked: true}, {dirty: true}, {branch: 'codex/test'}, {staleRemote: true}]) {
    const f = fixture(t, options); await assert.rejects(f.run()); assert.equal(f.calls.length, 0); assert.equal(f.tokenCalls, 0);
  }
  const f = fixture(t); fs.appendFileSync(path.join(f.root, 'archivein' + MATERIAL_PATHS[0]), 'not committed');
  await assert.rejects(f.run(false), /committed HEAD/); assert.equal(f.tokenCalls, 0);
});

test('initial 404 and full manifest/config guards prevent mutation or finalization', async t => {
  const present = fixture(t, {initialPresent: true}); await assert.rejects(present.run(), /Live route/);
  assert.equal(present.mutations, 0); assert.equal(fs.existsSync(present.receipt), false);
  for (const options of [{configDrift: true}, {manifestDrift: true}]) {
    const f = fixture(t, options); await assert.rejects(f.run(), /config|manifest/);
    assert.equal(f.calls.some(call => call.method === 'PATCH'), false);
    assert.equal(fs.existsSync(f.lock), false); assert.equal(fs.existsSync(f.receipt), true);
  }
});

test('ambiguous version/populate/upload/finalize/release intents never replay', async t => {
  for (const fail of ['version', 'populate', 'upload', 'finalize', 'release']) {
    const f = fixture(t, {fail}); await assert.rejects(f.run(), /ambiguous/);
    assert.equal(fs.existsSync(f.receipt), true); assert.equal(fs.existsSync(f.lock), false);
    const writes = f.mutations, auth = f.tokenCalls;
    await assert.rejects(f.run(), /Existing intent/); assert.equal(f.mutations, writes); assert.equal(f.tokenCalls, auth);
    const result = await f.run(false); assert.equal(result.mode, 'reconcile');
    assert.equal(result.verified, fail === 'release'); assert.equal(f.mutations, writes);
  }
});

test('CDN propagation is reconciled with GET only, never another release', async t => {
  const f = fixture(t, {propagation: true}); await assert.rejects(f.run(), /propagation/);
  const writes = f.mutations; f.options.propagation = false;
  const result = await f.run(false); assert.equal(result.verified, true); assert.equal(f.mutations, writes);
  await assert.rejects(f.run(), /Existing intent/);
});

test('post-release source drift is not reported as success', async t => {
  const f = fixture(t, {sourceDrift: true}); await assert.rejects(f.run(), /committed HEAD/);
  assert.equal(JSON.parse(fs.readFileSync(f.receipt)).verified, undefined);
  assert.equal(fs.existsSync(f.lock), false);
});
