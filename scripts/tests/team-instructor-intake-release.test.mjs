import assert from 'node:assert/strict';
import test from 'node:test';
import { MEAL_RELEASE_TARGETS, mealReleaseManifest } from '../release-team-instructor-intake-20261029.mjs';
const hash = 'a'.repeat(64), old = 'b'.repeat(64);
test('Team release replaces only four CORE assets and preserves all other paths', () => {
  assert.deepEqual(Object.keys(MEAL_RELEASE_TARGETS), ['core', 'verification']);
  const expected = ['/instructor-lessons/index.html', '/assets/app.js', '/rules/index.html', '/assets/alimtalk-catalog.json'];
  assert.deepEqual(Object.keys(MEAL_RELEASE_TARGETS.core.files), expected);
  const replacements = Object.fromEntries(expected.map(f => [f, hash]));
  const files = [...expected.map(path => ({ path, hash: old })), { path: '/unrelated.html', hash: old }];
  const manifest = mealReleaseManifest(files, replacements, 'core');
  assert.equal(manifest['/unrelated.html'], old);
  assert.equal(Object.keys(manifest).length, files.length);
  assert.throws(() => mealReleaseManifest(files, { ...replacements, '/unrelated.html': hash }, 'core'));
  assert.throws(() => mealReleaseManifest(files.slice(1), replacements, 'core'));
  assert.throws(() => mealReleaseManifest(files, replacements, 'member'));
});
test('post-verification release cannot change app or other assets', () => {
  assert.deepEqual(MEAL_RELEASE_TARGETS.verification.files, { '/rules/index.html': 'core/rules/index.html' });
  const files = [{ path: '/rules/index.html', hash: old }, { path: '/assets/app.js', hash: old }];
  assert.equal(mealReleaseManifest(files, { '/rules/index.html': hash }, 'verification')['/assets/app.js'], old);
  assert.throws(() => mealReleaseManifest(files, { '/rules/index.html': hash, '/assets/app.js': hash }, 'verification'));
});
