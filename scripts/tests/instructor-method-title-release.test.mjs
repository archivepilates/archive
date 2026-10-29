import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTOR_METHOD_ASSETS as paths, instructorMethodManifest as manifest } from '../release-instructor-method-titles.mjs';
test('only three existing reviewed UI assets change, all unrelated hashes remain identical', () => {
  const files = [{ path: '/rules/index.html', hash: 'a'.repeat(64) }, ...paths.map(path => ({ path, hash: 'b'.repeat(64) }))];
  const hashes = Object.fromEntries(paths.map(p => [p, 'c'.repeat(64)]));
  const result = manifest(files, hashes); assert.equal(result['/rules/index.html'], 'a'.repeat(64)); assert.equal(Object.keys(result).length, files.length);
  for (const p of paths) assert.equal(result[p], hashes[p]);
  assert.throws(() => manifest(files, { ...hashes, '/index.html': 'd'.repeat(64) }));
  assert.throws(() => manifest(files.slice(0, -1), hashes));
  assert.throws(() => manifest([...files, files[0]], hashes));
  assert.throws(() => manifest(files, { ...hashes, [paths[0]]: 'b'.repeat(64) }));
  assert.throws(() => manifest(files, { ...hashes, [paths[0]]: 'invalid' }));
});
