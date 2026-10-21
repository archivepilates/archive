import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, isPidAlive } from '../lock.mjs';

test('exclusive lock rejects live owner, reclaims dead owner only after 3 minutes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-events-lock-'));
  const file = path.join(directory, 'receiver.lock');
  try {
    const release = acquireLock({ file });
    assert.throws(() => acquireLock({ file }), { code: 'LOCK_BUSY' });
    const past = new Date(Date.now() - 181_000); fs.utimesSync(file, past, past);
    assert.throws(() => acquireLock({ file, pidAlive: () => true }), { code: 'LOCK_BUSY' });
    release();
    fs.writeFileSync(file, JSON.stringify({ pid: 999999, token: 'dead' }));
    assert.throws(() => acquireLock({ file, pidAlive: () => false }), { code: 'LOCK_BUSY' });
    fs.utimesSync(file, past, past);
    const releaseNew = acquireLock({ file, pidAlive: () => false });
    assert.equal(JSON.parse(fs.readFileSync(file)).pid, process.pid);
    releaseNew(); assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('finally release is ownership checked and invalid owners fail closed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-events-lock-'));
  const file = path.join(directory, 'receiver.lock');
  try {
    const release = acquireLock({ file });
    fs.unlinkSync(file);
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token: 'replacement' }));
    release(); assert.equal(fs.existsSync(file), true);
    fs.writeFileSync(file, 'not-json');
    assert.throws(() => acquireLock({ file, pidAlive: () => false }), { code: 'LOCK_INVALID' });
    assert.equal(fs.existsSync(`${file}.reap`), false);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('EPERM is live; only ESRCH proves death', () => {
  assert.equal(isPidAlive(100, () => {}), true);
  assert.equal(isPidAlive(100, () => { throw Object.assign(Error(), { code: 'EPERM' }); }), true);
  assert.equal(isPidAlive(100, () => { throw Object.assign(Error(), { code: 'ESRCH' }); }), false);
});
