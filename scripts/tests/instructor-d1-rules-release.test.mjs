import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import {
  INSTRUCTOR_D1_RULES_BASE, INSTRUCTOR_D1_RULES_BASE_HASH, INSTRUCTOR_D1_SOURCE_HASH,
  INSTRUCTOR_D1_CATALOG_BASE_HASH, INSTRUCTOR_D1_CATALOG_SOURCE_HASH,
  assertInstructorD1RulesScope, instructorD1RulesManifest, parseInstructorD1RulesArgs,
  assertInstructorD1RulesSource, assertInstructorD1RulesSnapshot, instructorD1RulesUploads,
  assertInstructorD1DirectoryEntry,
} from '../release-instructor-d1-rules.mjs';

// Local source bytes and synthetic manifests only: never run the authenticated release runner.
const root = new URL('../../', import.meta.url);
const rules = '/rules/index.html', catalog = '/assets/alimtalk-catalog.json';
const readBaseline = file => execFileSync('git', ['show', `${INSTRUCTOR_D1_RULES_BASE}:${file}`], {cwd: root});
const before = readBaseline('core/rules/index.html');
const catalogBefore = readBaseline('core/assets/alimtalk-catalog.json');
const after = fs.readFileSync(new URL('core/rules/index.html', root));
const catalogAfter = fs.readFileSync(new URL('core/assets/alimtalk-catalog.json', root));
const sha = value => createHash('sha256').update(value).digest('hex');
const version = 'sites/archive-pilates-core/versions/reviewed-123';
const files = [{path: rules, hash: 'a'.repeat(64)}, {path: '/index.html', hash: 'b'.repeat(64)},
  {path: catalog, hash: 'c'.repeat(64)}, {path: '/assets/app.js', hash: 'd'.repeat(64)},
  {path: '/release.json', hash: 'e'.repeat(64)}];
const replacements = {[rules]: 'f'.repeat(64), [catalog]: '1'.repeat(64)};

test('pins both exact reviewed assets and both original baseline byte hashes', () => {
  assert.equal(INSTRUCTOR_D1_RULES_BASE, '86cb30d28b5037069c80486ff5041303f16e3728');
  assert.equal(INSTRUCTOR_D1_RULES_BASE_HASH, '7d047f36bddf6cd3884f795bb9002bcb51a8d40cd93c9ab876f6a505aedc7ce3');
  assert.equal(INSTRUCTOR_D1_CATALOG_BASE_HASH, 'c75a054643a9aa3ef969bde695c3f15e189ca220e452f2741887d7db24f2a6cf');
  assert.equal(sha(before), INSTRUCTOR_D1_RULES_BASE_HASH);
  assert.equal(sha(catalogBefore), INSTRUCTOR_D1_CATALOG_BASE_HASH);
  assert.equal(sha(after), INSTRUCTOR_D1_SOURCE_HASH);
  assert.equal(sha(catalogAfter), INSTRUCTOR_D1_CATALOG_SOURCE_HASH);
  assert.doesNotThrow(() => assertInstructorD1RulesScope(before, after, catalogBefore, catalogAfter));
  for (const bytes of [after, catalogAfter]) assert.deepEqual(gunzipSync(gzipSync(bytes, {level: 9})), bytes);
  for (let index = 0; index < 4; index++) {
    const args = [before, after, catalogBefore, catalogAfter];
    args[index] = Buffer.concat([args[index], Buffer.from('\n')]);
    assert.throws(() => assertInstructorD1RulesScope(...args));
  }
  assert.throws(() => assertInstructorD1RulesScope(before, before, catalogBefore, catalogAfter));
  assert.throws(() => assertInstructorD1RulesScope(before, after, catalogBefore, catalogBefore));
});

test('replaces exactly two manifest entries and preserves every other live asset', () => {
  const copy = structuredClone(files), manifest = instructorD1RulesManifest(files, replacements);
  assert.deepEqual(files, copy);
  assert.equal(Object.keys(manifest).length, files.length);
  assert.deepEqual(files.filter(file => manifest[file.path] !== file.hash).map(file => file.path).sort(), [rules, catalog].sort());
  for (const file of files) assert.equal(manifest[file.path], replacements[file.path] || file.hash);
  for (const invalid of [undefined, {}, {[rules]: replacements[rules]}, {...replacements, '/index.html': '2'.repeat(64)},
    {...replacements, [rules]: files[0].hash}, {...replacements, [catalog]: files[2].hash},
    {...replacements, [catalog]: 'bad'}]) assert.throws(() => instructorD1RulesManifest(files, invalid));
  for (const invalid of [files.slice(1), files.filter(file => file.path !== catalog), [...files, files[0]],
    files.map(file => file.path === catalog ? {...file, hash: 'bad'} : file)])
    assert.throws(() => instructorD1RulesManifest(invalid, replacements));
});

test('argument whitelist requires exact site version for apply and rejects scope expansion', () => {
  assert.deepEqual(parseInstructorD1RulesArgs([]), {apply: false, expected: undefined});
  assert.deepEqual(parseInstructorD1RulesArgs([`--expected-version=${version}`]), {apply: false, expected: version});
  assert.deepEqual(parseInstructorD1RulesArgs(['--apply', `--expected-version=${version}`]), {apply: true, expected: version});
  for (const args of [['--apply'], ['--force'], ['--plan'], ['--site=archive-pilates'], ['--functions'],
    ['--resource=/index.html'], ['--project=other'], ['--apply=true'], ['--expected-version', version],
    ['--apply', '--apply', `--expected-version=${version}`], [`--expected-version=${version}`, `--expected-version=${version}`],
    ['--expected-version='], ['--expected-version=sites/archive-pilates/versions/x'],
    ['--expected-version=sites/archive-pilates-core/releases/x'], [`--expected-version=${version}\n`],
    [`--expected-version=${version}?other=1`], [`--expected-version=${version}/other`], [null]])
    assert.throws(() => parseInstructorD1RulesArgs(args));
});

test('apply source must be clean main exactly equal to freshly fetched origin/main', () => {
  const commit = '6'.repeat(40), state = {branch: 'main', status: '', head: commit, remote: commit};
  assert.doesNotThrow(() => assertInstructorD1RulesSource(state, commit));
  for (const change of [{branch: 'codex/mini/feature'}, {branch: 'archive-runtime-main'}, {branch: ''},
    {status: ' M core/rules/index.html'}, {status: '?? file'}, {status: undefined}, {head: 'other'}, {remote: 'stale'}])
    assert.throws(() => assertInstructorD1RulesSource({...state, ...change}, commit));
  for (const invalid of ['', undefined, 'bad', commit + '\n'])
    assert.throws(() => assertInstructorD1RulesSource(state, invalid));
});

test('independent snapshots require complete manifests and unchanged complete configuration', () => {
  const manifest = instructorD1RulesManifest(files, replacements);
  const actual = files.map(file => ({...file, hash: manifest[file.path]}));
  const config = {headers: [{glob: '**', headers: {'Cache-Control': 'no-cache'}}], cleanUrls: true,
    rewrites: [{glob: '/api/**', function: {functionId: 'existing', region: 'asia-northeast3'}}],
    redirects: [{glob: '/old', location: '/existing', statusCode: 301}]};
  const snapshot = {name: version, status: 'FINALIZED', config: structuredClone(config)};
  assert.doesNotThrow(() => assertInstructorD1RulesSnapshot(snapshot, actual, version, manifest, config));
  for (const change of [{name: 'sites/archive-pilates/versions/other'}, {status: 'CREATED'},
    {config: {...config, redirects: []}}, {config: {...config, rewrites: []}}, {config: {}}])
    assert.throws(() => assertInstructorD1RulesSnapshot({...snapshot, ...change}, actual, version, manifest, config));
  for (const invalid of [actual.slice(1), [...actual, actual[0]],
    actual.map(file => ({...file, hash: '2'.repeat(64)})), [...actual.slice(0, -1), {...actual[0]}]])
    assert.throws(() => assertInstructorD1RulesSnapshot(snapshot, invalid, version, manifest, config));
  for (const invalid of [undefined, null, [], 'config'])
    assert.throws(() => assertInstructorD1RulesSnapshot({...snapshot, config: invalid}, actual, version, manifest, invalid));
});

test('only the two compressed assets in their own batch may upload once to the official host', () => {
  const batch = instructorD1RulesManifest(files, replacements), hashes = Object.values(replacements);
  const uploadUrl = 'https://upload-firebasehosting.googleapis.com/upload/site/version';
  const result = {uploadRequiredHashes: hashes, uploadUrl};
  const expected = hashes.map(hash => ({hash, url: `${uploadUrl}/${hash}`}));
  assert.deepEqual(instructorD1RulesUploads(result, batch, replacements), expected);
  assert.deepEqual(instructorD1RulesUploads({...result, uploadUrl: uploadUrl + '/'}, batch, replacements), expected);
  assert.deepEqual(instructorD1RulesUploads({...result, uploadRequiredHashes: [...hashes, ...hashes]}, batch, replacements), expected);
  assert.deepEqual(instructorD1RulesUploads(result, batch, replacements, new Set(hashes)), []);
  assert.deepEqual(instructorD1RulesUploads(result, batch, replacements, new Set([hashes[0]])), [expected[1]]);
  assert.deepEqual(instructorD1RulesUploads({}, batch, replacements), []);
  assert.throws(() => instructorD1RulesUploads(result, {[rules]: hashes[0]}, replacements));
  for (const needed of [[files[1].hash], [...hashes, files[1].hash], 'not-an-array', [null], null])
    assert.throws(() => instructorD1RulesUploads({...result, uploadRequiredHashes: needed}, batch, replacements));
  for (const invalid of [{}, {...replacements, [rules]: 'bad'}, {...replacements, '/index.html': hashes[0]}])
    assert.throws(() => instructorD1RulesUploads(result, batch, invalid));
  for (const url of ['https://example.test/upload', 'http://upload-firebasehosting.googleapis.com/upload',
    'https://upload-firebasehosting.googleapis.com.evil.test/upload',
    'https://user:password@upload-firebasehosting.googleapis.com/upload', uploadUrl + '?token=never', uploadUrl + '#fragment'])
    assert.throws(() => instructorD1RulesUploads({...result, uploadUrl: url}, batch, replacements));
});

test('directories reject symlinks, foreign owners and writable parents; receipt leaves stay private', () => {
  const stat = {uid: 1000, mode: 0o755, isDirectory: () => true, isSymbolicLink: () => false};
  assert.doesNotThrow(() => assertInstructorD1DirectoryEntry(stat, {uid: 1000, leaf: true, privateLeaf: false}));
  assert.throws(() => assertInstructorD1DirectoryEntry(stat, {uid: 1000, leaf: true}));
  assert.doesNotThrow(() => assertInstructorD1DirectoryEntry({...stat, mode: 0o700}, {uid: 1000, leaf: true}));
  for (const change of [{uid: 1001}, {mode: 0o775}, {mode: 0o777}, {isDirectory: () => false}, {isSymbolicLink: () => true}])
    assert.throws(() => assertInstructorD1DirectoryEntry({...stat, ...change}, {uid: 1000, leaf: true, privateLeaf: false}));
});

test('offline protocol guard orders fresh checks, shared lock, durable intents and independent readbacks', () => {
  const source = fs.readFileSync(new URL('../release-instructor-d1-rules.mjs', import.meta.url), 'utf8');
  const position = token => {const index = source.indexOf(token); assert.ok(index >= 0, token); return index;};
  assert.ok(position('if (apply) clean(true)') < position("execFileSync('gcloud'"));
  assert.ok(position('if (apply && exists(receipt))') < position("execFileSync('gcloud'"));
  assert.ok(position("if (!apply && method !== 'GET')") < position('fetch(API + name'));
  assert.ok(position('if (!apply) return evidence;') < position('const privateDir'));
  assert.ok(position("fs.openSync(lock, 'wx', 0o600)") < position("writeReceipt(receipt, 'wx');"));
  assert.ok(position('await unchanged(true); evidence.liveBefore = await verifyLive') < position("writeReceipt(receipt, 'wx');"));
  assert.ok(position("writeReceipt(receipt, 'wx'); syncDir(dir);") < position('request(`sites/${SITE}/versions`, \'POST\''));
  assert.ok(position('evidence.populateIntents.push') < position('request(`${version.name}:populateFiles`'));
  assert.ok(position('evidence.uploadIntentHash = upload.hash; save();') < position('fetch(upload.url'));
  assert.ok(position("await verifyNew('CREATED'); await unchanged(true);") < position('evidence.finalizeIntentAt'));
  assert.ok(position('evidence.finalizeIntentAt') < position('request(`${version.name}?updateMask=status`'));
  assert.ok(position("await verifyNew('FINALIZED'); await unchanged(true);") < position('evidence.releaseIntentAt'));
  assert.ok(position('evidence.releaseIntentAt') < position('request(`sites/${SITE}/releases?versionName='));
  for (const guard of ['fs.fsyncSync(fd)', "writeReceipt(tmp, 'wx')", 'fs.renameSync(tmp, receipt); syncDir(dir);',
    'archiveAutomationRoot(home)', "path.join(automationRoot, 'automation/locks')", 'firebase-hosting-${SITE}.lock',
    'current.ino === lockStat.ino && current.dev === lockStat.dev', 'stat.isSymbolicLink()', 'stat.uid !== uid',
    'stat.mode & 0o077', 'stat.mode & 0o022', 'privateDir(lockDir, false)',
    "git(['fetch', 'origin', 'main'])", "git(['rev-parse', 'FETCH_HEAD']) !== commit",
    "git(['merge-base', '--is-ancestor', INSTRUCTOR_D1_RULES_BASE, commit])", 'assertInstructorD1RulesSource',
    "SITE = 'archive-pilates-core'", "RESOURCE = '/rules/index.html'", "CATALOG_RESOURCE = '/assets/alimtalk-catalog.json'",
    'changedPaths: [RESOURCE, CATALOG_RESOURCE]', 'unchangedFileCount: files.length - 2',
    'priorVersion: baseline, priorManifest, manifest', 'if (!isDeepStrictEqual(version, baseline))',
    'config: baseline.config', 'isDeepStrictEqual(current.config, baseline.config)',
    'assertManifest(await filesFor(version.name), manifest)', 'await priorUnchanged(); clean();',
    'https://core.archivepilates.com', 'https://archive-pilates-core.web.app',
    'evidence.liveAfter = await verifyLive(sourceHashes)', 'evidence.latestRelease = await verifyLatest()',
    'evidence.priorVersionUnchanged = true', 'evidence.configUnchanged = true', 'i += 1000', 'seen.has(cursor)',
    'import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href']) assert.ok(source.includes(guard), guard);
  assert.equal((source.match(/await fetch\(/g) || []).length, 3);
  assert.equal((source.match(/redirect: 'error'/g) || []).length, 3);
  assert.equal((source.match(/fs\.unlinkSync\(/g) || []).length, 1);
  assert.equal((source.match(/fs\.rmSync|fs\.rmdirSync|setTimeout|retry\(|firebase deploy|cloudfunctions\.googleapis/g) || []).length, 0);
  assert.ok(!source.includes('ArchiveIN/'));
  assert.ok(!source.includes('console.error(error'));
  assert.ok(!source.includes('console.log(token'));
});
