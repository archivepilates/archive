import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertRegistrationRulesScope, registrationManifest, parseRegistrationReleaseArgs,
  REGISTRATION_RULES_BASE, REGISTRATION_RULES_BASE_HASH } from '../release-studiomate-registration-rules.mjs';
import { assertManifest } from '../release-e261017-classroom.mjs';

const before = execFileSync('git', ['show', `${REGISTRATION_RULES_BASE}:core/rules/index.html`], { encoding: 'utf8' });
// Keep the reviewed one-shot payload stable when future rules are added.
const after = execFileSync('git', ['show', '1541e6a8f74a42424fd7501074216569e6711925:core/rules/index.html'], { encoding: 'utf8' });
const hash = text => createHash('sha256').update(text).digest('hex');

test('registration rules release accepts exactly the reviewed two-line change', () => {
  assert.equal(hash(before), REGISTRATION_RULES_BASE_HASH);
  assert.doesNotThrow(() => assertRegistrationRulesScope(before, after));
});
test('registration rules release rejects unrelated HTML, text or marker changes', () => {
  const added = after.match(/^.*<li data-studiomate-registration-revamp=.*\n/m)[0];
  for (const value of [before, after + '\n', after + added,
    after.replace('수강권 발급을 외부 제출 전에 보류합니다.', '수강권 발급을 즉시 실행합니다.'),
    after.replace('<title>', '<title>changed'), after.replace('notice225-v1', 'notice225-v2')]) {
    assert.throws(() => assertRegistrationRulesScope(before, value));
  }
  assert.throws(() => assertRegistrationRulesScope(before + '\n', after));
});
test('registration release requires exact site and version for apply', () => {
  const version = 'sites/archive-pilates-core/versions/synthetic';
  assert.deepEqual(parseRegistrationReleaseArgs([]), { apply: false, expected: undefined });
  assert.deepEqual(parseRegistrationReleaseArgs(['--apply', `--expected-version=${version}`]), { apply: true, expected: version });
  for (const args of [['--apply'], ['--force'], ['--apply', '--apply'],
    ['--expected-version=sites/archive-pilates/versions/a'],
    ['--expected-version=sites/archive-pilates-core/versions/a?x=1'],
    [`--expected-version=${version}`, `--expected-version=${version}`]]) {
    assert.throws(() => parseRegistrationReleaseArgs(args));
  }
});
test('registration release preserves every unrelated Hosting file', () => {
  const files = [{ path: '/rules/index.html', hash: hash('old') },
    { path: '/index.html', hash: hash('home') }, { path: '/assets/app.js', hash: hash('app') }];
  const original = structuredClone(files), replacement = hash('new');
  const manifest = registrationManifest(files, replacement);
  assert.deepEqual(files, original);
  assert.deepEqual(files.filter(file => file.hash !== manifest[file.path]).map(file => file.path), ['/rules/index.html']);
  assertManifest(Object.entries(manifest).map(([path, hash]) => ({ path, hash })), manifest);
  for (const invalid of [files.slice(1), [...files, files[0]], files.map(file => ({ ...file, hash: 'bad' }))]) {
    assert.throws(() => registrationManifest(invalid, replacement));
  }
  assert.throws(() => registrationManifest(files, files[0].hash));
});
test('release keeps durable one-shot intent, main guard, shared lock and independent readback', () => {
  const source = fs.readFileSync(new URL('../release-studiomate-registration-rules.mjs', import.meta.url), 'utf8');
  for (const guard of ['Apply requires main equal to freshly fetched origin/main', 'assertNoIntent();',
    'versionCreateIntentAt', 'releaseIntentAt', "fs.fsyncSync(fd)", 'firebase-hosting-${SITE}.lock',
    'assertManifest(await filesFor(version.name),manifest)', 'isDeepStrictEqual', 'await verifyPage(evidence.sourceSha256)']) {
    assert.ok(source.includes(guard), guard);
  }
});
