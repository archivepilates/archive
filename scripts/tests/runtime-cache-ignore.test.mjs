import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('generated Python cache is ignored without hiding untracked source', () => {
  const check = file => spawnSync('git', ['check-ignore', '--no-index', file], { encoding: 'utf8' });
  assert.equal(check('scripts/__pycache__/publish-approved-reel.cpython-311.pyc').status, 0);
  assert.equal(check('scripts/unexpected-source.mjs').status, 1);
});
