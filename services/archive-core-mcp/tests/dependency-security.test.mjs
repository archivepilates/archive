import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { rimraf } from 'rimraf';

test('reviewed glob security patches stay pinned without changing direct SDK versions', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url)));
  assert.deepEqual(pkg.dependencies, { '@modelcontextprotocol/sdk': '1.32.1', 'firebase-admin': '14.5.0', ajv: '8.20.0' });
  assert.deepEqual(pkg.overrides, { glob: '14.0.2', minimatch: '11.0.1' });
  for (const [name, expected] of Object.entries(pkg.overrides)) {
    const rows = Object.entries(lock.packages).filter(([file]) => file.endsWith('node_modules/' + name));
    assert(rows.length > 0);
    assert(rows.every(([, value]) => value.version === expected));
  }
});

test('patched glob remains compatible with the existing rimraf cleanup boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-core-glob-compat-'));
  try {
    await mkdir(path.join(root, 'keep'));
    await writeFile(path.join(root, 'keep', 'sentinel'), 'keep');
    await writeFile(path.join(root, 'fixture.tmp'), 'remove');
    assert.equal(await rimraf(path.join(root, '*.tmp'), { glob: true }), true);
    await assert.rejects(access(path.join(root, 'fixture.tmp')));
    await access(path.join(root, 'keep', 'sentinel'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
