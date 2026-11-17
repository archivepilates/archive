import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import {
  CONTRACT_NAME_RULES_BASE, CONTRACT_NAME_RULES_BASE_HASH, CONTRACT_NAME_RULE_HASH,
  assertContractNameRulesScope, contractNameRulesManifest, parseContractNameRulesArgs,
  assertContractNameRulesSource, assertContractNameRulesSnapshot, contractNameRulesUploads,
} from '../release-contract-name-rules.mjs';

// Fixtures are local Git/source bytes only. Never invoke the release runner, credentials or network.
const root = new URL('../../', import.meta.url);
const before = execFileSync('git', ['show', `${CONTRACT_NAME_RULES_BASE}:core/rules/index.html`], {cwd: root});
const after = fs.readFileSync(new URL('core/rules/index.html', root));
const sha = value => createHash('sha256').update(value).digest('hex');
const rulePattern = /<li data-contract-signer-name="20261116-v1">[\s\S]*?<\/li>/g;
const originalRule = before.toString().match(rulePattern)[0];
const reviewedRule = after.toString().match(rulePattern)[0];
const replace = rule => Buffer.from(before.toString().replace(originalRule, rule));
const version = 'sites/archive-pilates-core/versions/reviewed-123';
const files = [{path: '/rules/index.html', hash: 'a'.repeat(64)}, {path: '/index.html', hash: 'b'.repeat(64)},
  {path: '/assets/app.js', hash: 'd'.repeat(64)}, {path: '/release.json', hash: 'e'.repeat(64)}];
const hash = 'c'.repeat(64);

test('pins baseline commit, original raw bytes and the reviewed replacement li', () => {
  assert.equal(CONTRACT_NAME_RULES_BASE, '1ef91290f96501a39fbd53b50f429c7d52215657');
  assert.equal(CONTRACT_NAME_RULES_BASE_HASH, '5ffbd82707b4b46c68c0811f8b59670de9f9c08709340c82ca45190227477dac');
  assert.equal(CONTRACT_NAME_RULE_HASH, 'e8b5f930604ed96b0107baf8cedf6b6c4e383ad01a5002cbb048b5c3cc736d0c');
  assert.equal(sha(before), CONTRACT_NAME_RULES_BASE_HASH);
  assert.equal(sha(reviewedRule), CONTRACT_NAME_RULE_HASH);
  assert.equal(before.toString().match(rulePattern).length, 1);
  assert.equal(after.toString().match(rulePattern).length, 1);
  assert.deepEqual(replace(reviewedRule), after);
  assert.doesNotThrow(() => assertContractNameRulesScope(before, after));
  assert.deepEqual(gunzipSync(gzipSync(after, {level: 9})), after);
});

test('scope rejects no-op, changed baseline and every change outside the existing li', () => {
  for (const value of [before, replace(''), replace(reviewedRule + reviewedRule),
    Buffer.from(before.toString().replace(originalRule, '') + reviewedRule),
    Buffer.concat([after, Buffer.from('\n')]), Buffer.concat([Buffer.from(' '), after]),
    Buffer.from(after.toString().replace('<title>', '<title>unreviewed')),
    Buffer.from(after.toString().replace('                <li data-contract', ' <li data-contract')),
    Buffer.from(after.toString().replaceAll('\n', '\r\n')),
    Buffer.concat([after, Buffer.from([0xff])]), after.subarray(0, after.length - 1)]) {
    assert.throws(() => assertContractNameRulesScope(before, value));
  }
  assert.throws(() => assertContractNameRulesScope(Buffer.concat([before, Buffer.from('x')]), after), /baseline/);
});

test('even one unreviewed character, changed identity or injected markup is forbidden', () => {
  for (const rule of [reviewedRule.replace('20261116-v1', '20261117-v1'),
    reviewedRule.replace('2026-11-17', '2026-11-18'), reviewedRule.replace('<strong>', '<strong>other'),
    reviewedRule.replace('<strong>', '<strong onclick="write()">'),
    reviewedRule.replace('</li>', '<script src="/other.js"></script></li>'),
    reviewedRule.replace('</li>', '<img src="https://example.test/pixel"></li>'),
    reviewedRule.replace('</li>', '<li>nested</li></li>'), reviewedRule.replace('</li>', '\n</li>'),
    reviewedRule.replace('<li ', '<li  '), reviewedRule.replace('</li>', ' </li>')]) {
    assert.throws(() => assertContractNameRulesScope(before, replace(rule)), /pinned reviewed/);
  }
});

test('manifest preserves all live paths and hashes except the single rules resource', () => {
  const original = structuredClone(files), manifest = contractNameRulesManifest(files, hash);
  assert.deepEqual(files, original);
  assert.equal(Object.keys(manifest).length, files.length);
  assert.deepEqual(Object.entries(manifest).filter(([key, value]) => original.find(file => file.path === key)?.hash !== value),
    [['/rules/index.html', hash]]);
  for (const invalid of [[...files, files[0]], files.slice(1), [{path: 'rules/index.html', hash}],
    [{path: '/rules/index.html', hash: 'bad'}], [{path: '/core/rules/index.html', hash}]]) {
    assert.throws(() => contractNameRulesManifest(invalid, hash));
  }
  for (const replacement of ['bad', '', 'C'.repeat(64), hash + '\n']) {
    assert.throws(() => contractNameRulesManifest(files, replacement));
  }
  assert.throws(() => contractNameRulesManifest(files, files[0].hash), /No-op/);
  const many = [...files, ...Array.from({length: 1100}, (_, i) => ({path: `/assets/existing-${i}`, hash: 'f'.repeat(64)}))];
  const full = contractNameRulesManifest(many, hash);
  assert.equal(Object.keys(full).length, many.length);
  for (const file of many.slice(1)) assert.equal(full[file.path], file.hash);
});

test('strict arguments select GET-only plan or apply with one exact CORE version', () => {
  assert.deepEqual(parseContractNameRulesArgs([]), {apply: false, expected: undefined});
  assert.deepEqual(parseContractNameRulesArgs([`--expected-version=${version}`]), {apply: false, expected: version});
  for (const args of [['--apply', `--expected-version=${version}`], [`--expected-version=${version}`, '--apply']]) {
    assert.deepEqual(parseContractNameRulesArgs(args), {apply: true, expected: version});
  }
  for (const args of [['--apply'], ['--force'], ['--plan'], ['--site=archive-pilates'], ['--functions'],
    ['--resource=/index.html'], ['--project=other'], ['--apply=true'], ['--expected-version', version],
    ['--apply', '--apply', `--expected-version=${version}`], [`--expected-version=${version}`, `--expected-version=${version}`],
    ['--expected-version='], ['--expected-version=sites/archive-pilates/versions/x'],
    ['--expected-version=sites/archive-pilates-core/releases/x'], [`--expected-version=${version}\n`],
    [`--expected-version=${version}?other=1`], [`--expected-version=${version}/other`],
    [`--expected-version=${version}%2fother`], [null]]) assert.throws(() => parseContractNameRulesArgs(args));
});

test('source guard rejects dirty, detached, non-main, changed or stale source', () => {
  const state = {branch: 'main', status: '', head: CONTRACT_NAME_RULES_BASE, remote: CONTRACT_NAME_RULES_BASE};
  assert.doesNotThrow(() => assertContractNameRulesSource(state, CONTRACT_NAME_RULES_BASE));
  for (const change of [{branch: 'codex/mini/feature'}, {branch: 'archive-runtime-main'}, {branch: ''},
    {status: ' M core/rules/index.html'}, {status: '?? secret'}, {status: undefined}, {head: 'other'}, {remote: 'stale'}]) {
    assert.throws(() => assertContractNameRulesSource({...state, ...change}, CONTRACT_NAME_RULES_BASE));
  }
  for (const invalid of ['', undefined, 'bad', CONTRACT_NAME_RULES_BASE + '\n']) {
    assert.throws(() => assertContractNameRulesSource(state, invalid));
  }
});

test('snapshots retain complete config and manifest, including unrelated existing function rewrites', () => {
  const manifest = contractNameRulesManifest(files, hash), actual = files.map(file => ({...file, hash: manifest[file.path]}));
  const config = {headers: [{glob: '**', headers: {'Cache-Control': 'no-cache'}}], cleanUrls: true,
    rewrites: [{glob: '/api/**', function: {functionId: 'existing', region: 'asia-northeast3'}}],
    redirects: [{glob: '/old', location: '/existing', statusCode: 301}]};
  const snapshot = {name: version, status: 'FINALIZED', config: structuredClone(config)};
  assert.doesNotThrow(() => assertContractNameRulesSnapshot(snapshot, actual, version, manifest, config));
  assert.deepEqual(snapshot.config, config);
  for (const change of [{name: 'sites/archive-pilates/versions/other'}, {status: 'CREATED'},
    {config: {...config, redirects: []}}, {config: {...config, rewrites: []}}, {config: {}}]) {
    assert.throws(() => assertContractNameRulesSnapshot({...snapshot, ...change}, actual, version, manifest, config));
  }
  for (const badFiles of [actual.slice(1), [...actual, actual[0]],
    actual.map(file => ({...file, hash: 'f'.repeat(64)})), [...actual.slice(0, -1), {...actual[0]}]]) {
    assert.throws(() => assertContractNameRulesSnapshot(snapshot, badFiles, version, manifest, config));
  }
  for (const invalid of [undefined, null, [], 'config']) {
    assert.throws(() => assertContractNameRulesSnapshot({...snapshot, config: invalid}, actual, version, manifest, invalid));
  }
  assert.throws(() => assertContractNameRulesSnapshot({...snapshot, name: 'foreign'}, actual, 'foreign', manifest, config));
});

test('only the compressed rules hash in its own batch can upload once to the official host', () => {
  const batch = contractNameRulesManifest(files, hash);
  const result = {uploadRequiredHashes: [hash], uploadUrl: 'https://upload-firebasehosting.googleapis.com/upload/site/version'};
  assert.equal(contractNameRulesUploads(result, batch, hash), result.uploadUrl + '/' + hash);
  assert.equal(contractNameRulesUploads({...result, uploadRequiredHashes: [hash, hash]}, batch, hash), result.uploadUrl + '/' + hash);
  assert.equal(contractNameRulesUploads(result, batch, hash, new Set([hash])), undefined);
  assert.equal(contractNameRulesUploads({}, batch, hash), undefined);
  assert.equal(contractNameRulesUploads({uploadRequiredHashes: []}, batch, hash), undefined);
  assert.throws(() => contractNameRulesUploads(result, {'/index.html': hash}, hash));
  assert.throws(() => contractNameRulesUploads(result, batch, 'bad'));
  for (const needed of [[files[1].hash], [hash, files[1].hash], 'not-an-array', [null], null]) {
    assert.throws(() => contractNameRulesUploads({...result, uploadRequiredHashes: needed}, batch, hash));
  }
  for (const url of ['https://example.test/upload', 'http://upload-firebasehosting.googleapis.com/upload',
    'https://upload-firebasehosting.googleapis.com.evil.test/upload',
    'https://user:password@upload-firebasehosting.googleapis.com/upload',
    result.uploadUrl + '?token=never', result.uploadUrl + '#fragment']) {
    assert.throws(() => contractNameRulesUploads({...result, uploadUrl: url}, batch, hash));
  }
});

test('offline protocol guard orders clean/fresh checks, exclusive durable intent and verification before writes', () => {
  const source = fs.readFileSync(new URL('../release-contract-name-rules.mjs', import.meta.url), 'utf8');
  const position = token => {const index = source.indexOf(token); assert.ok(index >= 0, token); return index;};
  assert.ok(position('if (apply) clean(true)') < position("execFileSync('gcloud'"));
  assert.ok(position('if (apply && exists(receipt))') < position("execFileSync('gcloud'"));
  assert.ok(position("if (!apply && method !== 'GET')") < position('fetch(API + name'));
  assert.ok(position('if (!apply) return evidence;') < position('const privateDir'));
  assert.ok(position("fs.openSync(lock, 'wx', 0o600)") < position("writeReceipt(receipt, 'wx');"));
  assert.ok(position('await unchanged(true); evidence.liveBefore = await verifyLive') < position("writeReceipt(receipt, 'wx');"));
  assert.ok(position("writeReceipt(receipt, 'wx'); syncDir(dir);") < position('request(`sites/${SITE}/versions`, \'POST\''));
  assert.ok(position("await verifyNew('CREATED'); await unchanged(true);") < position('evidence.finalizeIntentAt'));
  assert.ok(position('evidence.finalizeIntentAt') < position('request(`${version.name}?updateMask=status`'));
  assert.ok(position("await verifyNew('FINALIZED'); await unchanged(true);") < position('evidence.releaseIntentAt'));
  assert.ok(position('evidence.releaseIntentAt') < position('request(`sites/${SITE}/releases?versionName='));
  for (const guard of ['fs.fsyncSync(fd)', "writeReceipt(tmp, 'wx')", 'fs.renameSync(tmp, receipt); syncDir(dir);',
    'firebase-hosting-${SITE}.lock', 'current.ino === lockStat.ino && current.dev === lockStat.dev',
    'stat.isSymbolicLink()', 'stat.uid !== process.getuid()', 'stat.mode & 0o077',
    "git(['fetch', 'origin', 'main'])", "git(['rev-parse', 'FETCH_HEAD']) !== commit",
    "git(['merge-base', '--is-ancestor', CONTRACT_NAME_RULES_BASE, commit])", 'assertContractNameRulesSource',
    "gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`]", "stdio: ['ignore', 'pipe', 'pipe']",
    'archive-codex-operator@archive-pilates.iam.gserviceaccount.com',
    'ArchiveIN/operations/2026-11-17-contract-name-rules-release',
    "SITE = 'archive-pilates-core'", "RESOURCE = '/rules/index.html'",
    'priorVersion: baseline, priorManifest, manifest', 'if (!isDeepStrictEqual(version, baseline))',
    'assertContractNameRulesSnapshot', 'config: baseline.config', 'isDeepStrictEqual(current.config, baseline.config)',
    'assertManifest(await filesFor(version.name), manifest)', 'await priorUnchanged(); clean();',
    'https://core.archivepilates.com/rules/', 'https://archive-pilates-core.web.app/rules/',
    'evidence.liveAfter = await verifyLive(evidence.sourceSha256)', 'evidence.latestRelease = await verifyLatest()',
    'evidence.priorVersionUnchanged = true', 'new Set()', 'i += 1000', 'seen.has(cursor)',
    'import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href']) assert.ok(source.includes(guard), guard);
  assert.equal((source.match(/await fetch\(/g) || []).length, 3);
  assert.equal((source.match(/redirect: 'error'/g) || []).length, 3);
  assert.equal((source.match(/fs\.unlinkSync\(/g) || []).length, 1);
  assert.ok(source.includes('fs.unlinkSync(lock)'));
  assert.equal((source.match(/fs\.rmSync|fs\.rmdirSync|setTimeout|retry\(|firebase deploy|cloudfunctions\.googleapis/g) || []).length, 0);
  assert.ok(!source.includes('console.error(error'));
  assert.ok(!source.includes('console.log(token'));
});
