import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { ASSET, BASELINE_SHA256, makeManifest, assertManifest, assertETeamNoteOnly, releaseTarget } from '../release-e261017-classroom.mjs';

test('historical E261017 addition stays intact beneath the separately reviewed A/B additions', () => {
  const current = fs.readFileSync(`official-home${ASSET}`, 'utf8');
  const later = ',\n' + ['A', 'B'].map(team => `    {"code":"${team}261024","path":"/private-lesson-external-feedback2-${team.toLowerCase()}-261024","title":"10/24 외부 피드백2 ${team}팀 · 수강생 공유","group":"PRIVATE LESSON EXTERNAL FEEDBACK2 ${team} 261024 40D","private":true}`).join(',\n');
  assert.equal(current.split(later).length, 2);
  const source = current.replace(later, '');
  const added = ',\n    {"code":"E261017","path":"/private-lesson-external-feedback-e-261017","title":"10/17 외부 피드백 E팀 · 수강생 공유","group":"PRIVATE LESSON EXTERNAL FEEDBACK E 261017 40D","private":true}';
  assert.equal(source.split(added).length, 2);
  assert.equal(createHash('sha256').update(source.replace(added, '')).digest('hex'), BASELINE_SHA256);
  const entry = JSON.parse(added.slice(added.indexOf('{')));
  assert.deepEqual(Object.keys(entry).sort(), ['code', 'group', 'path', 'private', 'title']);
});

test('release preserves every other file and rejects missing/duplicate baseline paths', () => {
  const files = [{ path: ASSET, hash: 'a'.repeat(64) }, { path: '/index.html', hash: 'b'.repeat(64) }];
  const manifest = makeManifest(files, 'c'.repeat(64));
  assert.equal(manifest['/index.html'], files[1].hash);
  assertManifest(files.map(f => ({ ...f, hash: manifest[f.path] })), manifest);
  assert.throws(() => makeManifest(files.slice(1), 'c'.repeat(64)), /missing/);
  assert.throws(() => makeManifest([...files, files[0]], 'c'.repeat(64)), /Duplicate/);
  assert.throws(() => assertManifest(files, manifest), /differs/);
  assert.throws(() => assertManifest(files.slice(1), manifest), /differs/);
});

test('CORE rule-only manifest cannot alter any other resource', () => {
  const asset = '/core/rules/index.html';
  const files = [{ path: asset, hash: 'a'.repeat(64) }, { path: '/archivein/index.html', hash: 'b'.repeat(64) }];
  const manifest = makeManifest(files, 'c'.repeat(64), asset);
  assert.equal(manifest[asset], 'c'.repeat(64));
  assert.equal(manifest['/archivein/index.html'], 'b'.repeat(64));
  assert.throws(() => makeManifest(files, 'c'.repeat(64)), /missing/);
});

test('CORE replacement is restricted to one existing E-team note without whitespace drift', () => {
  const old = '<p>untouched</p>\n  <div class="rule-note"><strong>E팀 수강생 영상 · 2026.10.18 verified</strong><span>old</span></div>\n<footer>end</footer>\n';
  const next = old.replace(' verified', '').replace('>old<', '>new<');
  assert.doesNotThrow(() => assertETeamNoteOnly(old, next));
  for (const bad of [old, next.replace('untouched', 'changed'), next + '\n',
    next.replace('E팀 수강생 영상', '다른 팀'), next + next.match(/  <div[^\n]+\n/)[0]]) {
    assert.throws(() => assertETeamNoteOnly(old, bad), /exactly one/);
  }
});


test('E-team rule release selects only the matching CORE path on each site', () => {
  assert.deepEqual(releaseTarget({ coreRules: true }), {
    site: 'archive-pilates', resource: '/core/rules/index.html', live: 'https://archive-pilates.web.app/core/rules/',
  });
  assert.deepEqual(releaseTarget({ coreRules: true, coreSite: true }), {
    site: 'archive-pilates-core', resource: '/rules/index.html', live: 'https://archive-pilates-core.web.app/rules/',
  });
  assert.equal(releaseTarget().resource, ASSET);
  assert.throws(() => releaseTarget({ coreSite: true }), /rules-only scope/);
});
