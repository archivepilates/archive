import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { collectCoreAuthTokens } from '../lib/core-auth-storage.mjs';

const require = createRequire(import.meta.url);
const { parseEvaluationResultValue, serializeAsCallArgument } = require(join(dirname(require.resolve('playwright-core')),
  'lib/utils/isomorphic/utilityScriptSerializers.js'));
const scope = { origin: 'https://core.example.test', apiKey: 'fixture-key', uid: 'fixture-user', decodeIndexedDB: parseEvaluationResultValue };
const key = `firebase:authUser:${scope.apiKey}:[DEFAULT]`;
const user = (uid = scope.uid, token = 'fixture-token') => ({ uid, stsTokenManager: { accessToken: token } });
const local = (name = key, value = user()) => ({ name, value: JSON.stringify(value) });
const record = (encoded = false, name = key, value = user()) => {
  const stored = { fbase_key: name, value };
  return encoded ? { valueEncoded: serializeAsCallArgument(stored, v => ({ fallThrough: v })) } : { value: stored };
};
const state = (records = [], localStorage = [], origin = scope.origin, database = 'firebaseLocalStorageDb', store = 'firebaseLocalStorage') => ({
  origins: [{ origin, localStorage, indexedDB: [{ name: database, stores: [{ name: store, records }] }] }],
});
const tokens = fixture => [...collectCoreAuthTokens(fixture, scope)];

test('plain IndexedDB auth record', () => assert.deepEqual(tokens(state([record()])), ['fixture-token']));
test('encoded IndexedDB handles undefined user fields', () => assert.deepEqual(tokens(state([record(true, key, { ...user(), optional: undefined })])), ['fixture-token']));
test('LocalStorage JSON auth record', () => assert.deepEqual(tokens(state([], [local()])), ['fixture-token']));
test('same token is deduplicated across persistence formats', () => assert.deepEqual(tokens(state([record(), record(true)], [local()])), ['fixture-token']));
test('conflicting tokens are retained for caller rejection', () => assert.equal(tokens(state([record()], [local(key, user(scope.uid, 'other-token'))])).length, 2));
for (const encoded of [false, true]) {
  test(`wrong origin ignored, encoded=${encoded}`, () => assert.deepEqual(tokens(state([record(encoded)], [local()], 'https://other.example.test')), []));
  test(`wrong DB ignored, encoded=${encoded}`, () => assert.deepEqual(tokens(state([record(encoded)], [], scope.origin, 'otherDb')), []));
  test(`wrong store ignored, encoded=${encoded}`, () => assert.deepEqual(tokens(state([record(encoded)], [], scope.origin, 'firebaseLocalStorageDb', 'otherStore')), []));
  test(`wrong key ignored, encoded=${encoded}`, () => assert.deepEqual(tokens(state([record(encoded, 'wrong')], [local('wrong')])), []));
  test(`wrong UID ignored, encoded=${encoded}`, () => assert.deepEqual(tokens(state([record(encoded, key, user('wrong'))], [local(key, user('wrong'))])), []));
}
test('missing/empty tokens ignored', () => assert.deepEqual(tokens(state([record(false, key, { uid: scope.uid }), record(true, key, user(scope.uid, ''))])), []));
test('matching malformed JSON fails closed', () => assert.throws(() => tokens(state([], [{ name: key, value: '{' }]))));
test('unrelated malformed JSON is not parsed', () => assert.deepEqual(tokens(state([], [{ name: 'other', value: '{' }])), []));
test('absent records produce no token', () => assert.deepEqual(tokens({ origins: [] }), []));
test('missing scope fails closed', () => assert.throws(() => collectCoreAuthTokens(state(), { ...scope, uid: '' })));
