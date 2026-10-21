import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardRuntime, installReceiver, validateActivation } from '../installer.mjs';
import { RUNTIME, NODE } from '../config.mjs';
import { createLogger, safeCode } from '../logger.mjs';

test('installer requires canonical runtime, clean checkout and HEAD equal origin/main', () => {
  const run = (command, args) => {
    if (command === NODE) return 'v25.9.0';
    if (args.includes('--show-toplevel')) return RUNTIME;
    if (args[0] === 'status') return '';
    return 'same-sha';
  };
  const opts = { root: RUNTIME, realpath: value => value, run };
  assert.doesNotThrow(() => guardRuntime(opts));
  assert.throws(() => guardRuntime({ ...opts, root: '/worktree' }), { code: 'RUNTIME_GUARD' });
  assert.throws(() => guardRuntime({ ...opts, realpath: () => '/other' }), { code: 'RUNTIME_GUARD' });
  assert.throws(() => guardRuntime({ ...opts, run: (cmd, args) => args[0] === 'status' ? ' M user-file' : run(cmd, args) }), { code: 'RUNTIME_GUARD' });
  assert.throws(() => guardRuntime({ ...opts, run: (cmd, args) => args.includes('HEAD') ? 'different-sha' : run(cmd, args) }), { code: 'RUNTIME_GUARD' });
  assert.throws(() => guardRuntime({ ...opts, run: (cmd, args) => cmd === NODE ? 'v20.0.0' : run(cmd, args) }), { code: 'RUNTIME_GUARD' });
});

test('prepare is credential-blind and non-mutating; missing configuration blocks apply before npm/launchctl/write', () => {
  const calls = [];
  const opts = { root: RUNTIME, guard: () => {}, run: (cmd, args) => { calls.push([cmd, args]); return ''; },
    validate: () => { throw Error('prepare must not read credentials'); } };
  assert.deepEqual(installReceiver({ ...opts, mode: '--prepare' }), {
    prepared: true, installed: false, credentialsChecked: false,
  });
  assert.deepEqual(calls.map(([cmd]) => cmd), ['plutil']);
  calls.length = 0;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-events-missing-config-'));
  try {
    assert.throws(() => installReceiver({ ...opts, mode: '--apply',
      validate: () => validateActivation(path.join(directory, 'not-created.json')) }), { code: 'CONFIG_MISSING' });
    assert.deepEqual(calls.map(([cmd]) => cmd), ['plutil']);
    assert.equal(fs.readdirSync(directory).length, 0);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('plist is singleton daemon template, absolute runtime/node, no polling interval or credential values', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const text = fs.readFileSync(path.join(root, 'ops/launchagents/com.archive.lg-climate-events.plist'), 'utf8');
  assert.ok(text.includes(`<string>${RUNTIME}</string>`)); assert.ok(text.includes(`<string>${NODE}</string>`));
  assert.match(text, /<key>KeepAlive<\/key><true\/>/);
  assert.match(text, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(text, /<key>ThrottleInterval<\/key><integer>30<\/integer>/);
  assert.match(text, /<key>Umask<\/key><integer>63<\/integer>/);
  assert.ok(!text.includes('StartInterval')); assert.ok(!text.includes('Bearer'));
});

test('diagnostics are fixed category-only, rate limited and rotated with restricted permissions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-events-logs-'));
  const file = path.join(directory, 'receiver.log'); let time = 0;
  try {
    const log = createLogger({ file, now: () => time, limit: 64 });
    log('secret-token'); log('secret-token');
    assert.equal(fs.readFileSync(file, 'utf8'), '{"code":"RECEIVER_FAILED"}\n');
    for (let i = 0; i < 20; i += 1) { time += 60_000; log('MQTT_ERROR'); }
    assert.ok(fs.statSync(file).size < 100); assert.ok(fs.statSync(`${file}.1`).size < 100);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(safeCode({ code: 'secret-token' }), 'RECEIVER_FAILED');
    assert.equal(safeCode({ code: 'CONFIG_MISSING' }), 'CONFIG_MISSING');
  } finally { fs.rmSync(directory, { recursive: true }); }
});
