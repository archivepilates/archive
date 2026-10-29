import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { assertMcpRuleOnly } from '../../../scripts/release-core-mcp-rules.mjs';
const root = new URL('../../../', import.meta.url);
test('release changes only the MCP rules section with all other bytes preserved', async () => {
  const before = execFileSync('git', ['show', 'af066469:core/rules/index.html'], { cwd: root, encoding: 'utf8' });
  const after = await readFile(new URL('core/rules/index.html', root), 'utf8');
  assert.doesNotThrow(() => assertMcpRuleOnly(before, after));
  assert.throws(() => assertMcpRuleOnly(before, after.replace('현재 운영 기준', 'changed')));
  assert.throws(() => assertMcpRuleOnly(before, before));
  assert.throws(() => assertMcpRuleOnly(after, after));
});
