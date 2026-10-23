import assert from 'node:assert/strict';
import test from 'node:test';
import {DATABASE, MODE, PROJECT, validateTarget} from '../safety.mjs';

const safeEnv = Object.freeze({
  GOOGLE_CLOUD_PROJECT: 'archive-pilates',
  RESERVATION_DATABASE: 'reservation-mirror',
  RESERVATION_MODE: 'read_only_mirror',
  RESERVATION_DISPATCH_ENABLED: 'false',
});

test('only the explicit isolated read-only mirror target is accepted', () => {
  assert.equal(PROJECT, 'archive-pilates');
  assert.equal(DATABASE, 'reservation-mirror');
  assert.equal(MODE, 'read_only_mirror');
  assert.deepEqual(validateTarget(safeEnv), {
    projectId: PROJECT, databaseId: DATABASE, mode: MODE, dispatchEnabled: false,
  });
});

test('empty configuration cannot fall back to a default database or mode', () => {
  assert.throws(() => validateTarget({}));
});

for (const [field, values] of [
  ['GOOGLE_CLOUD_PROJECT', [undefined, '', 'other-project']],
  ['RESERVATION_DATABASE', [undefined, '', '(default)', 'default', 'reservation-lab']],
  ['RESERVATION_MODE', [undefined, '', 'production', 'read_write', 'READ_ONLY_MIRROR']],
  ['RESERVATION_DISPATCH_ENABLED', [undefined, '', 'true', true, false, '0']],
]) {
  for (const value of values) {
    test(`target rejects ${field}=${JSON.stringify(value)}`, () => {
      assert.throws(() => validateTarget({...safeEnv, [field]: value}));
    });
  }
}

for (const host of ['firestore.googleapis.com:8080', '192.168.1.2:8080', '0.0.0.0:8080', 'localhost.evil.invalid:8080']) {
  test(`target rejects non-loopback emulator host ${host} without starting a client`, () => {
    assert.throws(() => validateTarget({...safeEnv, FIRESTORE_EMULATOR_HOST: host}));
  });
}
