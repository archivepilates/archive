import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import {
  CHART_RULES_BASE, CHART_RULES_BASE_HASH, assertChartRulesScope, chartRulesManifest,
  parseChartRulesArgs, assertChartRulesSource, assertChartRulesSnapshot, chartRulesUploads,
} from '../release-private-chart-rules.mjs';

const before = execFileSync('git', ['show', `${CHART_RULES_BASE}:core/rules/index.html`]);
const sha = value => createHash('sha256').update(value).digest('hex');
const section = before.indexOf('          <div class="rule-note" id="ops-health-evidence-20261104"');
const offset = before.indexOf('\n', section) + 1;
const note = '          <div class="rule-note" id="private-chart-source-repair-20261114"><strong>Guard 2026.11.13</strong><span>Implemented; verification and deployment tracked separately.</span></div>\n';
const insert = (line = note, index = offset) => Buffer.concat([before.subarray(0, index), Buffer.from(line), before.subarray(index)]);
const after = insert();
const version = 'sites/archive-pilates-core/versions/reviewed-123';
const files = [{path: '/rules/index.html', hash: 'a'.repeat(64)}, {path: '/index.html', hash: 'b'.repeat(64)},
  {path: '/assets/app.js', hash: 'd'.repeat(64)}, {path: '/release.json', hash: 'e'.repeat(64)}];
const hash = 'c'.repeat(64);

test('Git baseline hash is pinned and exactly one note can precede the original source', () => {
  assert.equal(sha(before), CHART_RULES_BASE_HASH);
  assert.doesNotThrow(() => assertChartRulesScope(before, after));
  assert.doesNotThrow(() => assertChartRulesScope(before, insert(note.replace('Implemented;', 'Pending;'))));
  assert.deepEqual(after.subarray(offset + Buffer.byteLength(note)), before.subarray(offset));
  assert.deepEqual(gunzipSync(gzipSync(after, {level: 9})), after);
});

test('scope rejects deletions, edits, duplicate notes, relocation and byte drift', () => {
  for (const value of [before, insert(note + note), insert(note, 0), insert(note, offset + 1),
    Buffer.concat([after, Buffer.from('\n')]), Buffer.from(after.toString().replace('<title>', '<title>other')),
    Buffer.from(after.toString().replaceAll('\n', '\r\n')),
    Buffer.concat([after, Buffer.from([0xff])]), after.subarray(0, after.length - 1)]) {
    assert.throws(() => assertChartRulesScope(before, value));
  }
  assert.throws(() => assertChartRulesScope(Buffer.concat([before, Buffer.from('x')]), after), /baseline/);
});

test('note cannot add markup, resources, multiline content or another identity', () => {
  for (const line of [note.replace('private-chart-source-repair-20261114', 'different-id'),
    note.replace('<span>', '<span>\n'), note.replace('<span>', '<span><script src="/other.js"></script>'),
    note.replace('<span>', '<span><img src="https://example.test/pixel">'),
    note.replace('<span>', '<span><div>extra</div>'), note.replace('<strong>', '<strong onclick="write()">'),
    note.replace('<span>', '<span id="other">'), note.replace('          <div', ' <div')]) {
    assert.throws(() => assertChartRulesScope(before, insert(line)));
  }
});

test('manifest changes exactly the rules path without mutating any source entry', () => {
  const original = structuredClone(files), manifest = chartRulesManifest(files, hash);
  assert.deepEqual(files, original);
  assert.deepEqual(Object.entries(manifest).filter(([key, value]) => original.find(file => file.path === key)?.hash !== value),
    [['/rules/index.html', hash]]);
  assert.equal(Object.keys(manifest).length, files.length);
  for (const invalid of [[...files, files[0]], files.slice(1), [{path: 'rules/index.html', hash}],
    [{path: '/rules/index.html', hash: 'bad'}]]) assert.throws(() => chartRulesManifest(invalid, hash));
  assert.throws(() => chartRulesManifest(files, files[0].hash), /No-op/);
  assert.throws(() => chartRulesManifest(files, 'bad'));
});

test('arguments default to GET plan and require exact explicit CORE version on apply', () => {
  assert.deepEqual(parseChartRulesArgs([]), {apply: false, expected: undefined});
  assert.deepEqual(parseChartRulesArgs([`--expected-version=${version}`]), {apply: false, expected: version});
  assert.deepEqual(parseChartRulesArgs(['--apply', `--expected-version=${version}`]), {apply: true, expected: version});
  for (const args of [['--apply'], ['--force'], ['--plan'], ['--site=archive-pilates'],
    ['--apply', '--apply', `--expected-version=${version}`], [`--expected-version=${version}`, `--expected-version=${version}`],
    ['--expected-version='], ['--expected-version=sites/archive-pilates/versions/x'],
    [`--expected-version=${version}?other=1`], [`--expected-version=${version}/other`],
    [`--expected-version=${version}%2fother`]]) assert.throws(() => parseChartRulesArgs(args));
});

test('write guard rejects dirty, non-main, changed or unaligned source', () => {
  const state = {branch: 'main', status: '', head: CHART_RULES_BASE, remote: CHART_RULES_BASE};
  assert.doesNotThrow(() => assertChartRulesSource(state, CHART_RULES_BASE));
  for (const change of [{branch: 'codex/mini/feature'}, {branch: 'archive-runtime-main'}, {status: ' M core/rules/index.html'},
    {status: '?? secret'}, {status: undefined}, {head: 'other'}, {remote: 'stale'}]) {
    assert.throws(() => assertChartRulesSource({...state, ...change}, CHART_RULES_BASE));
  }
});

test('snapshot rejects config, status, path, hash and count changes', () => {
  const manifest = chartRulesManifest(files, hash), actual = files.map(file => ({...file, hash: manifest[file.path]}));
  const config = {headers: [{glob: '**', headers: {'Cache-Control': 'no-cache'}}], rewrites: [{glob: '/api/**', function: 'existing'}]};
  const snapshot = {name: version, status: 'FINALIZED', config: structuredClone(config)};
  assert.doesNotThrow(() => assertChartRulesSnapshot(snapshot, actual, version, manifest, config));
  for (const change of [{name: 'sites/archive-pilates/versions/other'}, {status: 'CREATED'},
    {config: {...config, redirects: []}}, {config: {}}]) {
    assert.throws(() => assertChartRulesSnapshot({...snapshot, ...change}, actual, version, manifest, config));
  }
  for (const badFiles of [actual.slice(1), [...actual, actual[0]],
    actual.map(file => ({...file, hash: 'f'.repeat(64)})), [...actual.slice(0, -1), {...actual[0]}]]) {
    assert.throws(() => assertChartRulesSnapshot(snapshot, badFiles, version, manifest, config));
  }
});

test('only one compressed rules hash can be uploaded, once, to the official upload host', () => {
  const batch = chartRulesManifest(files, hash);
  const result = {uploadRequiredHashes: [hash], uploadUrl: 'https://upload-firebasehosting.googleapis.com/upload/site/version'};
  assert.equal(chartRulesUploads(result, batch, hash), result.uploadUrl + '/' + hash);
  assert.equal(chartRulesUploads({...result, uploadRequiredHashes: [hash, hash]}, batch, hash), result.uploadUrl + '/' + hash);
  assert.equal(chartRulesUploads(result, batch, hash, new Set([hash])), undefined);
  assert.equal(chartRulesUploads({}, batch, hash), undefined);
  assert.throws(() => chartRulesUploads(result, {'/index.html': files[1].hash}, hash));
  for (const needed of [[files[1].hash], [hash, files[1].hash], 'not-an-array', [null]]) {
    assert.throws(() => chartRulesUploads({...result, uploadRequiredHashes: needed}, batch, hash));
  }
  for (const url of ['https://example.test/upload', 'http://upload-firebasehosting.googleapis.com/upload',
    'https://user:password@upload-firebasehosting.googleapis.com/upload',
    result.uploadUrl + '?token=never', result.uploadUrl + '#fragment']) {
    assert.throws(() => chartRulesUploads({...result, uploadUrl: url}, batch, hash));
  }
});

test('offline protocol contract persists exclusive intent before mutation and never clears it for replay', () => {
  const source = fs.readFileSync(new URL('../release-private-chart-rules.mjs', import.meta.url), 'utf8');
  const position = token => {const index = source.indexOf(token); assert.ok(index >= 0, token); return index;};
  assert.ok(position("if (!apply) return evidence;") < position('fs.mkdirSync(dir'));
  assert.ok(position("if (!apply && method !== 'GET')") < position('fetch(API + name'));
  assert.ok(position("writeReceipt(receipt, 'wx'); syncDir();") < position('request(`sites/${SITE}/versions`, \'POST\''));
  assert.ok(position("fs.openSync(lock, 'wx', 0o600)") < position("writeReceipt(receipt, 'wx');"));
  assert.ok(position("await verifyNew('CREATED'); await unchanged(true);") < position('evidence.finalizeIntentAt'));
  assert.ok(position("await verifyNew('FINALIZED'); await unchanged(true);") < position('evidence.releaseIntentAt'));
  assert.ok(position('evidence.releaseIntentAt') < position('request(`sites/${SITE}/releases?versionName='));
  for (const guard of ["if (apply && exists(receipt))", 'fs.fsyncSync(fd)', "writeReceipt(tmp, 'wx')",
    'fs.renameSync(tmp, receipt); syncDir();', 'firebase-hosting-${SITE}.lock',
    "git(['fetch', 'origin', 'main'])", "git(['rev-parse', 'FETCH_HEAD']) !== commit",
    'assertChartRulesSource', 'if (apply) clean(true)', 'versionCreateIntentAt',
    "gcloud', ['auth', 'print-access-token', `--account=${ACCOUNT}`]",
    "archive-codex-operator@archive-pilates.iam.gserviceaccount.com",
    'ArchiveIN/operations/2026-11-14-private-chart-release',
    "redirect: 'error'", 'if (!isDeepStrictEqual(version, baseline))', 'await priorUnchanged(); clean();',
    'https://core.archivepilates.com/rules/', 'https://archive-pilates-core.web.app/rules/',
    'evidence.liveAfter = await verifyLive(evidence.sourceSha256)',
    'evidence.latestRelease = await verifyLatest()', 'evidence.priorVersionUnchanged = true']) {
    assert.ok(source.includes(guard), guard);
  }
  assert.equal((source.match(/await fetch\(/g) || []).length, 3);
  assert.equal((source.match(/redirect: 'error'/g) || []).length, 3);
  assert.equal((source.match(/fs\.unlinkSync\(/g) || []).length, 1);
  assert.ok(source.includes('fs.unlinkSync(lock)'));
  assert.equal((source.match(/fs\.rmSync|fs\.rmdirSync|setTimeout|retry\(/g) || []).length, 0);
  assert.ok(source.includes('import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href'));
});
