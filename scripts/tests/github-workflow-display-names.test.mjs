import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = 'feb97c2a61ddbd7bb561a8bfbe448f19d1e821a8';
const names = [
  ['functions-affected-check.yml', 'ARCHIVE IN Functions Affected Check', 'ARCHIVE PILATES OPS Functions Affected Check'],
  ['core-mcp-check.yml', 'CORE MCP Check', 'ARCHIVE PILATES OPS CORE MCP Check'],
  ['firebase-hosting-release.yml', 'Firebase Hosting Release', 'ARCHIVE PILATES OPS Firebase Hosting Release'],
];

for (const [filename, beforeName, afterName] of names) {
  test(`${filename}: display name changes preserve all existing execution and connection settings`, () => {
    const file = `.github/workflows/${filename}`;
    const before = execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' });
    const after = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.ok(after.startsWith(`name: ${afterName}\n`));
    assert.doesNotMatch(after, /ARCHIVE IN/);
    let expected = before.replace(`name: ${beforeName}\n`, `name: ${afterName}\n`);
    if (filename === 'functions-affected-check.yml') {
      expected = expected.replace('### ARCHIVE IN Functions affected check', '### ARCHIVE PILATES OPS Functions affected check')
        .replace('scripts/tests/imweb-referral-runner.test.mjs\n',
          'scripts/tests/imweb-referral-runner.test.mjs scripts/tests/github-workflow-display-names.test.mjs\n');
    }
    // Byte equality outside the approved display labels and this regression test invocation.
    assert.equal(after, expected);
  });
}
