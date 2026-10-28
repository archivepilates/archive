import assert from 'node:assert/strict';
import test from 'node:test';
import { MEAL_RELEASE_TARGETS, mealReleaseManifest } from '../release-recommended-meal-20261029.mjs';
const hash = 'a'.repeat(64), old = 'b'.repeat(64);
for (const [target, config] of Object.entries(MEAL_RELEASE_TARGETS)) test(`only approved meal paths change: ${target}`, () => {
  const replacements = Object.fromEntries(Object.keys(config.files).map(f => [f, hash]));
  const files = [...Object.keys(config.files).map(path => ({ path, hash: old })), { path: '/unrelated.html', hash: old }];
  const manifest = mealReleaseManifest(files, replacements, target);
  assert.equal(manifest['/unrelated.html'], old);
  assert.deepEqual(Object.keys(manifest).sort(), files.map(f => f.path).sort());
  assert.throws(() => mealReleaseManifest(files, { ...replacements, '/unrelated.html': hash }, target));
  assert.throws(() => mealReleaseManifest(files.filter(f => f.path !== Object.keys(config.files)[0]), replacements, target));
});
test('unknown release target rejected', () => assert.throws(() => mealReleaseManifest([], {}, 'other')));
