import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ASSET, BASELINE_SHA256, makeManifest, assertManifest } from '../release-e261017-classroom.mjs';

test('only E261017 is added to the pinned live classroom source', () => {
  const source = fs.readFileSync(`official-home${ASSET}`, 'utf8');
  const original = execFileSync('git', ['show', `cc2f803:official-home${ASSET}`], { encoding: 'utf8' });
  assert.equal(createHash('sha256').update(original).digest('hex'), BASELINE_SHA256);
  const added = ',\n    {"code":"E261017","path":"/private-lesson-external-feedback-e-261017","title":"10/17 외부 피드백 E팀 · 수강생 공유","group":"PRIVATE LESSON EXTERNAL FEEDBACK E 261017 40D","private":true}';
  assert.equal(source.split(added).length, 2);
  assert.equal(source.replace(added, ''), original);
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
