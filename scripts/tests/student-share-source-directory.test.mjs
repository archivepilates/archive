import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  E261017_SHARE, STUDENT_SHARE_SOURCES, studentShareSourceDirectory, readStudentShareLedgers,
} from '../lib/imweb-student-share-policy.mjs';
import { runStudentShareAccess } from '../e261017-access.mjs';

const operationsSource = { ...E261017_SHARE, storage: 'automation_operations' };

function fixture(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'student-share-directory-')));
  fs.chmodSync(home, 0o700);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  t.mock.method(os, 'homedir', () => home);
  const legacy = path.join(home, 'Library/Application Support/ARCHIVE PILATES');
  const automation = path.join(home, 'archive-automation');
  const operations = path.join(automation, 'operations');
  const override = path.join(home, 'test-parent');
  for (const parent of [legacy, operations, override]) {
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    for (const source of STUDENT_SHARE_SOURCES) {
      const directory = path.join(parent, source.lane);
      fs.mkdirSync(directory, { mode: 0o700 });
      fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ marker: parent }), { mode: 0o600 });
    }
  }
  return { home, legacy, automation, operations, override,
    directory: path.join(operations, operationsSource.lane) };
}

test('all five unmodified sources retain Application Support paths even when operations ledgers exist', t => {
  const f = fixture(t);
  const legacySources = STUDENT_SHARE_SOURCES.filter(source => !Object.hasOwn(source, 'storage'));
  assert.equal(legacySources.length, 5);
  for (const source of legacySources) {
    assert.equal(Object.hasOwn(source, 'storage'), false);
    assert.equal(studentShareSourceDirectory(source), path.join(f.legacy, source.lane));
  }
  const legacyLedgers = readStudentShareLedgers().filter(item => legacySources.includes(item.source));
  assert.deepEqual(legacyLedgers.map(item => item.source), legacySources);
  assert.deepEqual(legacyLedgers.map(item => item.state.marker), Array(5).fill(f.legacy));
});

test('only explicit automation_operations storage selects operations/<lane> without writes or registry changes', t => {
  const f = fixture(t);
  const before = JSON.stringify(STUDENT_SHARE_SOURCES);
  assert.equal(studentShareSourceDirectory(operationsSource), f.directory);
  assert.equal(JSON.stringify(STUDENT_SHARE_SOURCES), before);
  assert.deepEqual(fs.readdirSync(f.directory), ['state.json']);
  assert.equal(fs.readFileSync(path.join(f.directory, 'state.json'), 'utf8'), JSON.stringify({ marker: f.operations }));
});

for (const target of ['archive-automation', 'absolute']) {
  test(`verified top-level compatibility alias (${target}) resolves to the canonical directory`, t => {
    const f = fixture(t);
    fs.symlinkSync(target === 'absolute' ? f.automation : target, path.join(f.home, 'ArchiveIN'));
    assert.equal(studentShareSourceDirectory(operationsSource), f.directory);
  });
}

test('pre-migration real legacy root follows the existing automation helper', t => {
  const f = fixture(t);
  const old = path.join(f.home, 'ArchiveIN');
  fs.renameSync(f.automation, old);
  assert.equal(studentShareSourceDirectory(operationsSource), path.join(old, 'operations', operationsSource.lane));
});

test('explicit root overrides both storage modes and keeps shared read-only parent permissions', t => {
  const f = fixture(t);
  fs.chmodSync(f.override, 0o755);
  fs.mkdirSync(path.join(f.home, 'ArchiveIN'), { mode: 0o700 });
  for (const source of [...STUDENT_SHARE_SOURCES, operationsSource]) {
    assert.equal(studentShareSourceDirectory(source, { root: f.override }), path.join(f.override, source.lane));
  }
  const ledgers = readStudentShareLedgers({ root: f.override });
  assert.equal(ledgers.length, STUDENT_SHARE_SOURCES.length);
  assert.deepEqual(ledgers.map(item => item.source), STUDENT_SHARE_SOURCES);
  assert.deepEqual(ledgers.map(item => item.state.marker), STUDENT_SHARE_SOURCES.map(() => f.override));
  assert.equal(fs.lstatSync(f.override).mode & 0o777, 0o755);
});

test('unknown storage and unsafe lane values fail before filesystem access', t => {
  fixture(t);
  const lstat = t.mock.method(fs, 'lstatSync', () => { throw Error('Unexpected filesystem access'); });
  for (const storage of [null, '', 'operations', 'automation_operation', false]) {
    assert.throws(() => studentShareSourceDirectory({ ...E261017_SHARE, storage }), /Unsupported student-share source path/);
  }
  for (const lane of [undefined, '', '.', '..', '../outside', 'nested/lane', '/absolute', 'lane\\escape', ' lane', 'lane\n']) {
    assert.throws(() => studentShareSourceDirectory({ ...operationsSource, lane }), /Unsupported student-share source path/);
  }
  assert.equal(lstat.mock.callCount(), 0);
});

for (const target of ['automation', 'operations', 'directory']) {
  test(`operations resolver rejects symlinked ${target} without following or replacing it`, t => {
    const f = fixture(t);
    const moved = path.join(f.home, `moved-${target}`);
    fs.renameSync(f[target], moved);
    fs.symlinkSync(moved, f[target]);
    assert.throws(() => studentShareSourceDirectory(operationsSource), /Unsafe/);
    assert.equal(fs.lstatSync(f[target]).isSymbolicLink(), true);
  });

  for (const mode of target === 'directory' ? [0o755, 0o750, 0o770] : [0o775, 0o777, 0o770]) {
    test(`operations resolver rejects ${target} permissions ${mode.toString(8)} without repairing them`, t => {
      const f = fixture(t);
      fs.chmodSync(f[target], mode);
      assert.throws(() => studentShareSourceDirectory(operationsSource), /Unsafe share ledger/);
      assert.equal(fs.lstatSync(f[target]).mode & 0o777, mode);
    });
  }

  test(`operations resolver rejects missing ${target} without creating it or falling back`, t => {
    const f = fixture(t);
    fs.rmSync(f[target], { recursive: true });
    assert.throws(() => studentShareSourceDirectory(operationsSource), { code: 'ENOENT' });
    assert.equal(fs.existsSync(f[target]), false);
    assert.equal(fs.existsSync(path.join(f.legacy, E261017_SHARE.lane, 'state.json')), true);
  });

  test(`operations resolver rejects non-directory ${target}`, t => {
    const f = fixture(t);
    fs.rmSync(f[target], { recursive: true });
    fs.writeFileSync(f[target], 'synthetic', { mode: 0o600 });
    assert.throws(() => studentShareSourceDirectory(operationsSource), /Unsafe/);
  });

  test(`operations resolver rejects wrong-owner ${target}`, t => {
    const f = fixture(t);
    const lstat = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', (file, ...args) => {
      const stat = lstat(file, ...args);
      if (file === f[target]) stat.uid = process.getuid() + 1;
      return stat;
    });
    assert.throws(() => studentShareSourceDirectory(operationsSource), /Unsafe/);
  });
}

test('canonical shared parents may be readable while each lane remains private', t => {
  const f = fixture(t);
  fs.chmodSync(f.automation, 0o755);
  fs.chmodSync(f.operations, 0o755);
  assert.equal(studentShareSourceDirectory(operationsSource), f.directory);
  assert.equal(fs.lstatSync(f.directory).mode & 0o777, 0o700);
});

test('unverified compatibility alias and conflicting real roots remain blocked', t => {
  const f = fixture(t);
  const old = path.join(f.home, 'ArchiveIN');
  fs.symlinkSync(f.override, old);
  assert.throws(() => studentShareSourceDirectory(operationsSource), /Unverified legacy automation alias/);
  fs.unlinkSync(old);
  fs.mkdirSync(old, { mode: 0o700 });
  assert.throws(() => studentShareSourceDirectory(operationsSource), /Conflicting automation roots/);
});

for (const target of ['parent', 'lane', 'file']) {
  test(`reader retains wrong-owner rejection for legacy ${target}`, t => {
    const f = fixture(t);
    const directory = path.join(f.legacy, E261017_SHARE.lane);
    const selected = { parent: f.legacy, lane: directory, file: path.join(directory, 'state.json') }[target];
    const lstat = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', (file, ...args) => {
      const stat = lstat(file, ...args);
      if (file === selected) stat.uid = process.getuid() + 1;
      return stat;
    });
    assert.throws(() => readStudentShareLedgers());
  });
}

test('reader and expiry/adopt runner route directories through the same resolver', () => {
  assert.match(readStudentShareLedgers.toString(), /studentShareSourceDirectory\(source, \{ root \}\)/);
  assert.match(runStudentShareAccess.toString(), /studentShareSourceDirectory\(source\)/);
  assert.doesNotMatch(runStudentShareAccess.toString(), /Application Support/);
});
