import assert from 'node:assert/strict';
import test from 'node:test';
import { firestoreRestDenied } from '../lib/firestore-rest-denial.mjs';

const error = { error: { code: 403, status: 'PERMISSION_DENIED' } };
test('unary REST permission denial', () => assert.equal(firestoreRestDenied({ status: 403, body: error }), true));
test('streamed runQuery permission denial', () => assert.equal(firestoreRestDenied({ status: 403, body: [error] }), true));
for (const [name, status, body] of [
  ['successful empty stream', 200, []],
  ['successful document', 200, [{ document: {} }]],
  ['other error', 403, { error: { status: 'INVALID_ARGUMENT' } }],
  ['authentication error', 401, error],
  ['missing error', 403, {}],
  ['empty error stream', 403, []],
  ['document and error in one row', 403, [{ ...error, document: {} }]],
  ['partial document stream followed by error', 403, [{ document: {} }, error]],
  ['successful HTTP status with embedded error', 200, [error]],
  ['null payload', 403, null],
]) test(name, () => assert.equal(firestoreRestDenied({ status, body }), false));
