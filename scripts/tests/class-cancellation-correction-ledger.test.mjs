import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createClassCorrectionLedger} from '../lib/class-cancellation-correction-ledger.mjs';

test('durable exclusive claim, terminal no-replay, private files and reconstruction', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'class-ledger-'));
  try {
    const ledger = createClassCorrectionLedger(dir), key = 'a'.repeat(64);
    assert.equal(await ledger.read(key), null);
    assert.equal(await ledger.claim(key, {policy: 'weekend'}), true);
    assert.equal(await ledger.claim(key, {}), false);
    assert.equal((await fs.stat(path.join(dir, key + '.json'))).mode & 0o777, 0o600);
    await ledger.update(key, {status: 'submitted'});
    await ledger.update(key, {status: 'verified'});
    assert.equal((await createClassCorrectionLedger(dir).read(key)).status, 'verified');
    await assert.rejects(ledger.update(key, {status: 'intent'}), /Terminal/);
    const unknown = 'b'.repeat(64); await ledger.claim(unknown, {}); await ledger.update(unknown, {status: 'unknown'});
    assert.equal(await ledger.claim(unknown, {}), false);
    await assert.rejects(ledger.update(unknown, {status: 'intent'}), /Terminal/);
  } finally {await fs.rm(dir, {recursive: true, force: true});}
});

test('unsafe directory, symlink, invalid keys and corrupt source fail closed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'class-ledger-'));
  try {
    const ledger = createClassCorrectionLedger(dir), key = 'c'.repeat(64);
    await assert.rejects(ledger.read('../escape'), /Invalid/);
    const target = path.join(dir, key + '.json');
    await fs.writeFile(target, '{}', {mode: 0o600});
    await assert.rejects(ledger.read(key), /Invalid/);
    await fs.unlink(target); await fs.symlink('/tmp/unknown', target);
    await assert.rejects(ledger.read(key), /Unsafe/);
    await fs.chmod(dir, 0o755);
    await assert.rejects(ledger.read(key), /private/);
  } finally {await fs.rm(dir, {recursive: true, force: true});}
});
