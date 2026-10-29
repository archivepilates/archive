import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { assertInstructorIntakeRuleOnly } from '../release-core-mcp-rules.mjs';
test('intake note is the only approved rules byte change', async () => {
  const before = execFileSync('git', ['show', '6f6e979c:core/rules/index.html'], { encoding: 'utf8' });
  const after = await readFile('core/rules/index.html', 'utf8');
  assert.doesNotThrow(() => assertInstructorIntakeRuleOnly(before, after));
  assert.throws(() => assertInstructorIntakeRuleOnly(before, after.replace('현재 운영 기준', 'changed')));
  assert.throws(() => assertInstructorIntakeRuleOnly(before, before));
  assert.throws(() => assertInstructorIntakeRuleOnly(after, after));
});
