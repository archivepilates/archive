import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { assertNewInstructorRecoveryRuleOnly } from '../release-core-mcp-rules.mjs';
test('new recovery release preserves every unrelated rules byte', async () => {
  const before = execFileSync('git', ['show', '5c3dcc1a:core/rules/index.html'], { encoding: 'utf8' });
  const after = await readFile('core/rules/index.html', 'utf8');
  assert.doesNotThrow(() => assertNewInstructorRecoveryRuleOnly(before, after));
  assert.throws(() => assertNewInstructorRecoveryRuleOnly(before, after.replace('현재 운영 기준', 'changed')));
  assert.throws(() => assertNewInstructorRecoveryRuleOnly(before, before));
  assert.throws(() => assertNewInstructorRecoveryRuleOnly(after, after));
});
