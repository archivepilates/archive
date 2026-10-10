#!/usr/bin/env node
// Run: node scripts/test-sequence-firestore-rules.mjs (Firebase CLI + Java 21 required).
// Uses a disposable demo project, mock JWTs and REST; no npm install or real credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const project = 'demo-sequence-studio';
const config = JSON.parse(await readFile(join(root, 'firebase.json'), 'utf8'));
assert.equal(config.firestore.rules, 'firebase/kangsain-functions/firestore.rules');
assert.equal(config.firestore.indexes, 'firebase/kangsain-functions/firestore.indexes.json');
const indexes = JSON.parse(await readFile(join(root, config.firestore.indexes), 'utf8'));
assert(indexes.indexes.some((index) => index.collectionGroup === 'sequenceNotes' &&
  index.queryScope === 'COLLECTION' && JSON.stringify(index.fields) === JSON.stringify([
    { fieldPath: 'ownerUid', order: 'ASCENDING' },
    { fieldPath: 'deleted', order: 'ASCENDING' },
    { fieldPath: 'updatedAt', order: 'DESCENDING' },
  ])), 'Missing owner/deleted/updatedAt composite index');
assert(indexes.indexes.some((index) => index.collectionGroup === 'sequenceNoteImages' &&
  index.queryScope === 'COLLECTION' && JSON.stringify(index.fields) === JSON.stringify([
    { fieldPath: 'ownerUid', order: 'ASCENDING' },
    { fieldPath: 'noteId', order: 'ASCENDING' },
  ])), 'Missing image cleanup composite index');
for (const [collectionGroup, fieldPath] of [
  ['sequenceNotes', 'payload'], ['sequenceNoteImages', 'dataUrl'],
]) {
  assert(indexes.fieldOverrides.some((field) => field.collectionGroup === collectionGroup &&
    field.fieldPath === fieldPath && Array.isArray(field.indexes) && field.indexes.length === 0),
  `Missing index exemption: ${collectionGroup}.${fieldPath}`);
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePort);
  });
  const { port } = server.address();
  await new Promise((close) => server.close(close));
  return port;
}

if (!process.argv.includes('--emulator')) {
  assert(!process.env.FIRESTORE_EMULATOR_HOST,
    'Unset FIRESTORE_EMULATOR_HOST; this runner starts its own isolated emulator.');
  await mkdir(join(root, 'artifacts'), { recursive: true });
  const directory = await mkdtemp(join(root, 'artifacts/sequence-firestore-qa-'));
  let child;
  const forwardSignal = (signal) => child?.kill(signal);
  const onInt = () => forwardSignal('SIGINT');
  const onTerm = () => forwardSignal('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    const ports = new Set();
    while (ports.size < 3) ports.add(await unusedPort());
    const [firestore, hub, logging] = ports;
    const emulatorConfig = join(directory, 'firebase.json');
    await writeFile(emulatorConfig, JSON.stringify({
      firestore: {
        rules: join(root, config.firestore.rules),
        indexes: join(root, config.firestore.indexes),
      },
      emulators: {
        firestore: { host: '127.0.0.1', port: firestore },
        hub: { host: '127.0.0.1', port: hub },
        logging: { host: '127.0.0.1', port: logging },
        ui: { enabled: false },
        singleProjectMode: true,
      },
    }, null, 2));
    const env = { ...process.env, CI: 'true', FIREBASE_CLI_DISABLE_USAGE: 'true' };
    for (const key of ['FIREBASE_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS',
      'GOOGLE_OAUTH_ACCESS_TOKEN', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) delete env[key];
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    child = spawn('firebase', [
      'emulators:exec', '--project', project, '--config', emulatorConfig, '--only', 'firestore',
      `${quote(process.execPath)} ${quote(script)} --emulator`,
    ], { cwd: directory, env, stdio: 'inherit' });
    const exitCode = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => done(code ?? 1));
    });
    process.exitCode = exitCode;
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    await rm(directory, { recursive: true, force: true });
  }
} else {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert(host && /^127\.0\.0\.1:[0-9]+$/.test(host), 'Loopback emulator host required');
  assert.equal(process.env.GCLOUD_PROJECT, project, 'Demo project required');
  const base = `http://${host}`;
  const database = `projects/${project}/databases/(default)`;
  const documents = `${database}/documents`;
  const uid = 'sequence-operator-a';
  const otherUid = 'sequence-operator-b';

  function mockToken(user, role = 'manager', extra = {}) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
    return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      iss: `https://securetoken.google.com/${project}`, aud: project,
      sub: user, user_id: user, iat: now, auth_time: now, exp: now + 3600,
      email: `${user}@example.test`, role, studioId: 'qa-studio', staffId: 'qa-staff',
      firebase: { sign_in_provider: 'custom', identities: {} }, ...extra,
    })}.`;
  }
  const manager = mockToken(uid);
  const other = mockToken(otherUid, 'owner');
  const nonmanager = mockToken(uid, 'instructor');

  function value(data) {
    if (data === null) return { nullValue: null };
    if (typeof data === 'string') return { stringValue: data };
    if (typeof data === 'boolean') return { booleanValue: data };
    if (typeof data === 'number') return Number.isInteger(data)
      ? { integerValue: String(data) } : { doubleValue: data };
    if (Array.isArray(data)) return { arrayValue: { values: data.map(value) } };
    return { mapValue: { fields: fields(data) } };
  }
  function fields(data) {
    return Object.fromEntries(Object.entries(data).map(([key, data]) => [key, value(data)]));
  }
  async function request(path, token, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(`${base}/v1/${path}`, {
      method, headers: {
        'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
    });
    return { status: response.status, body: await response.json() };
  }
  function note(overrides = {}) {
    return {
      ownerUid: uid, revision: 1, payload: '{"moves":[]}', title: 'Sequence', teacher: 'Teacher',
      equipment: 'Reformer', date: '2026-10-06', goal: 'Control', moveCount: 0, deleted: false,
      ...overrides,
    };
  }
  function noteWrite(id, data, { create = false, serverTime = true, timestamp, createdTimestamp, createdServerTime = false } = {}) {
    const encoded = fields(data);
    if (timestamp) encoded.updatedAt = { timestampValue: timestamp };
    if (createdTimestamp) encoded.createdAt = { timestampValue: createdTimestamp };
    const transforms = [
      ...(serverTime ? [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] : []),
      ...(createdServerTime ? [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] : []),
    ];
    return {
      update: { name: `${documents}/sequenceNotes/${id}`, fields: encoded },
      currentDocument: { exists: !create },
      ...(transforms.length ? { updateTransforms: transforms } : {}),
    };
  }
  const jpeg = 'data:image/jpeg;base64,/9j/2Q==';
  const appendedJpeg = 'data:image/jpeg;base64,/9j/AA==';
  const maximumJpeg = `data:image/jpeg;base64,/9j/${'A'.repeat(89972)}`;
  const jpegFor = (label) => `data:image/jpeg;base64,${Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(label), Buffer.from([0xff, 0xd9]),
  ]).toString('base64')}`;
  const deletedParentJpeg = jpegFor('deleted-parent');
  const assetId = (id, dataUrl = jpeg) => `${id}_${createHash('sha256').update(dataUrl).digest('hex')}`;
  function imageWrite(id, data, create = true) {
    return {
      update: { name: `${documents}/sequenceNoteImages/${id}`, fields: fields(data) },
      currentDocument: { exists: !create },
    };
  }
  const image = (id, overrides = {}) => ({ ownerUid: uid, noteId: id, dataUrl: jpeg, ...overrides });
  const commit = (writes, token = manager) => request(`${documents}:commit`, token, { writes });
  const get = (path, token = manager) => request(`${documents}/${path}`, token);
  const remove = (path, token = manager) => commit([{ delete: `${documents}/${path}` }], token);
  function query(collection, owner = uid, limit = 100, token = manager, ordered = true, noteId, deleted = false) {
    const filters = [];
    for (const [fieldPath, data] of [
      ['ownerUid', owner], ['noteId', noteId], ['deleted', collection === 'sequenceNotes' ? deleted : undefined],
    ]) {
      if (data !== null && data !== undefined) filters.push({
        fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: value(data) },
      });
    }
    return request(`${documents}:runQuery`, token, { structuredQuery: {
      from: [{ collectionId: collection }],
      ...(filters.length ? { where: filters.length === 1 ? filters[0]
        : { compositeFilter: { op: 'AND', filters } } } : {}),
      ...(ordered ? { orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'DESCENDING' }] } : {}),
      ...(limit === null ? {} : { limit }),
    } });
  }
  async function allowed(operation) {
    const result = await operation;
    assert.equal(result.status, 200, JSON.stringify(result.body).slice(0, 1000));
    return result.body;
  }
  async function denied(operation) {
    const result = await operation;
    assert.equal(result.status, 403, JSON.stringify(result.body).slice(0, 1000));
    assert.equal(result.body.error.status, 'PERMISSION_DENIED');
  }
  async function absent(operation) {
    const result = await operation;
    assert.equal(result.status, 404, JSON.stringify(result.body).slice(0, 1000));
    assert.equal(result.body.error.status, 'NOT_FOUND');
  }

  await test('Sequence Studio real Firestore rules emulator regression', async (t) => {
    const check = (label, operation, expectation = denied) => t.test(label, () => expectation(operation()));
    await check('atomic note + image transaction succeeds (getAfter)', async () => {
      const transaction = await allowed(request(`${documents}:beginTransaction`, manager,
        { options: { readWrite: {} } }));
      const reads = await allowed(request(`${documents}:batchGet`, manager, {
        transaction: transaction.transaction,
        documents: [`${documents}/sequenceNotes/atomic`, `${documents}/sequenceNoteImages/${assetId('atomic')}`],
      }));
      assert.equal(reads.length, 2);
      assert(reads.every((read) => read.missing), 'Transaction must read absent note + image');
      return request(`${documents}:commit`, manager, {
        transaction: transaction.transaction,
        writes: [
          imageWrite(assetId('atomic'), image('atomic')),
          noteWrite('atomic', note(), { create: true }),
        ],
      });
    }, allowed);
    await check('owner gets own note', () => get('sequenceNotes/atomic'), allowed);
    await check('owner gets own image', () => get(`sequenceNoteImages/${assetId('atomic')}`), allowed);
    await check('manager gets missing note for first-save transaction', () => get('sequenceNotes/missing'), absent);
    await check('manager gets missing image for first-save transaction', () => get('sequenceNoteImages/missing'), absent);
    await check('other manager creates own note', () => commit([
      noteWrite('other', note({ ownerUid: otherUid }), { create: true }),
      imageWrite(assetId('other'), image('other', { ownerUid: otherUid })),
    ], other), allowed);

    for (const [label, token] of [['signed-out', null], ['nonmanager', nonmanager], ['cross-operator', other]]) {
      await check(`${label} note read denied`, () => get('sequenceNotes/atomic', token));
      await check(`${label} image read denied`, () => get(`sequenceNoteImages/${assetId('atomic')}`, token));
      await check(`${label} note creation denied`, () => commit([
        noteWrite(`denied-${label}`, note(), { create: true }),
      ], token));
      await check(`${label} note update denied`, () => commit([noteWrite('atomic', note({ revision: 2 }))], token));
      await check(`${label} note deletion denied`, () => remove('sequenceNotes/atomic', token));
      await check(`${label} image creation denied`, () => commit([
        imageWrite(assetId('atomic', jpegFor(label)), image('atomic', { dataUrl: jpegFor(label) })),
      ], token));
      await check(`${label} notes query denied`, () => query('sequenceNotes', uid, 100, token));
      await check(`${label} images query denied`, () => query('sequenceNoteImages', uid, 100, token, false));
    }
    for (const [label, token] of [['signed-out', null], ['nonmanager', nonmanager]]) {
      await check(`${label} missing note read denied`, () => get('sequenceNotes/missing', token));
      await check(`${label} missing image read denied`, () => get('sequenceNoteImages/missing', token));
    }
    await check('nonmanager cannot create even with own UID', () => commit([
      noteWrite('nonmanager-own', note(), { create: true }),
    ], nonmanager));
    const noRole = mockToken(uid, 'instructor', { role: undefined, email: 'unknown@example.test' });
    await check('missing manager claims denied', () => get('sequenceNotes/atomic', noRole));
    await check('existing email allowlist still grants manager access', () =>
      get('sequenceNotes/atomic', mockToken(uid, 'instructor', { email: 'p01086488585@archivepilates.com' })), allowed);
    const noRoleAllowlisted = mockToken(uid, 'instructor', { role: undefined, email: 'p01086488585@archivepilates.com' });
    await check('existing allowlisted email without role is preserved', () => get('sequenceNotes/atomic', noRoleAllowlisted), allowed);

    await check('own live notes query with deleted:false + updatedAt DESC + limit100 works', async () => {
      const result = await query('sequenceNotes');
      assert.deepEqual(result.body.filter((row) => row.document).map((row) => row.document.fields.ownerUid.stringValue), [uid]);
      return result;
    }, allowed);
    await check('own notes query limit1 works', () => query('sequenceNotes', uid, 1), allowed);
    await check('notes query limit101 denied', () => query('sequenceNotes', uid, 101));
    await check('unlimited notes query denied', () => query('sequenceNotes', uid, null));
    await check('unfiltered notes query denied', () => query('sequenceNotes', null));
    await check('other owner notes query denied', () => query('sequenceNotes', otherUid));
    await check('notes query without deleted filter denied', () =>
      query('sequenceNotes', uid, 100, manager, true, undefined, null));
    await check('notes query for deleted:true denied', () =>
      query('sequenceNotes', uid, 100, manager, true, undefined, true));
    await check('own images query works', () => query('sequenceNoteImages', uid, 100, manager, false), allowed);
    await check('cleanup query owner + noteId without limit works', () =>
      query('sequenceNoteImages', uid, null, manager, false, 'atomic'), allowed);
    await check('cleanup query without owner denied', () =>
      query('sequenceNoteImages', null, null, manager, false, 'atomic'));
    await check('unfiltered images query denied', () => query('sequenceNoteImages', null, 100, manager, false));
    await check('other owner images query denied', () => query('sequenceNoteImages', otherUid, 100, manager, false));

    const invalidNotes = [
      ['unexpected field', { extra: true }], ['owner mismatch', { ownerUid: otherUid }],
      ['owner type', { ownerUid: 3 }], ['revision zero', { revision: 0 }],
      ['negative revision', { revision: -1 }], ['fractional revision', { revision: 1.5 }],
      ['revision type', { revision: '1' }], ['payload type', { payload: {} }],
      ['oversize payload', { payload: 'a'.repeat(180001) }],
      ['moveCount negative', { moveCount: -1 }], ['moveCount oversize', { moveCount: 91 }],
      ['moveCount fractional', { moveCount: 1.5 }], ['moveCount type', { moveCount: '1' }],
      ['deleted type', { deleted: 'false' }],
    ];
    for (const [field, max] of [['title', 70], ['teacher', 30], ['equipment', 35], ['date', 10], ['goal', 180]]) {
      invalidNotes.push([`${field} type`, { [field]: 1 }], [`${field} oversize`, { [field]: 'a'.repeat(max + 1) }]);
    }
    for (const field of Object.keys(note())) {
      invalidNotes.push([`missing ${field}`, (data) => { delete data[field]; return data; }]);
    }
    let counter = 0;
    for (const [label, mutation] of invalidNotes) {
      for (const create of [true, false]) {
        const data = note({ revision: create ? 1 : 2 });
        const invalid = typeof mutation === 'function' ? mutation(data) : { ...data, ...mutation };
        await check(`${create ? 'create' : 'update'} rejects ${label}`, () => commit([
          noteWrite(create ? `invalid-${++counter}` : 'atomic', invalid, { create }),
        ]));
      }
    }
    for (const create of [true, false]) {
      for (const [label, options, data] of [
        ['missing updatedAt', { serverTime: false }, {}],
        ['updatedAt wrong type', { serverTime: false }, { updatedAt: 'now' }],
        ['client timestamp', { serverTime: false, timestamp: '2020-01-01T00:00:00Z' }, {}],
      ]) {
        await check(`${create ? 'create' : 'update'} rejects ${label}`, () => commit([
          noteWrite(create ? `bad-time-${++counter}` : 'atomic', note({ revision: create ? 1 : 2, ...data }), { create, ...options }),
        ]));
      }
    }
    for (const id of ['dot.id', 'bad id', 'bad+id', 'x'.repeat(101)]) {
      await check(`unsafe note ID denied (${id.slice(0, 12)})`, () => commit([noteWrite(id, note(), { create: true })]));
    }
    await check('create revision2 denied', () => commit([noteWrite('bad-revision', note({ revision: 2 }), { create: true })]));
    await check('unchanged revision denied', () => commit([noteWrite('atomic', note())]));
    await check('skipped revision denied', () => commit([noteWrite('atomic', note({ revision: 3 }))]));
    await check('owner transfer denied', () => commit([noteWrite('atomic', note({ ownerUid: otherUid, revision: 2 }))], other));
    await check('maximum note field lengths and integer boundaries accepted', () => commit([
      noteWrite('x'.repeat(100), note({
        payload: 'a'.repeat(180000), title: 'a'.repeat(70), teacher: 'a'.repeat(30),
        equipment: 'a'.repeat(35), goal: 'a'.repeat(180), moveCount: 90,
      }), { create: true }),
    ]), allowed);
    await check('empty strings and minimum counts accepted', () => commit([
      noteWrite('_', note({ payload: '', title: '', teacher: '', equipment: '', date: '', goal: '' }), { create: true }),
    ]), allowed);
    await check('maximum note ID produces valid 165-character image ID', () => commit([
      imageWrite(assetId('x'.repeat(100)), image('x'.repeat(100))),
    ]), allowed);

    const invalidImages = [
      ['owner mismatch', { ownerUid: otherUid }], ['owner type', { ownerUid: 1 }],
      ['noteId type', { noteId: 1 }], ['unsafe noteId', { noteId: 'bad.id' }],
      ['oversize noteId', { noteId: 'n'.repeat(101) }], ['missing parent', { noteId: 'absent' }],
      ['other parent owner', { noteId: 'other' }], ['unexpected field', { extra: true }],
      ['dataUrl type', { dataUrl: {} }], ['empty data', { dataUrl: 'data:image/jpeg;base64,' }],
      ['PNG prefix', { dataUrl: 'data:image/png;base64,/9j/2Q==' }],
      ['non-JPEG signature', { dataUrl: 'data:image/jpeg;base64,AAAA' }],
      ['bad base64 alphabet', { dataUrl: 'data:image/jpeg;base64,/9j/!!!!' }],
      ['base64 whitespace', { dataUrl: `${jpeg}\n` }],
      ['bad base64 padding', { dataUrl: 'data:image/jpeg;base64,/9j/2===' }],
      ['oversize image', { dataUrl: `data:image/jpeg;base64,/9j/${'A'.repeat(89976)}` }],
    ];
    for (const field of ['ownerUid', 'noteId', 'dataUrl']) {
      invalidImages.push([`missing ${field}`, (data) => { delete data[field]; return data; }]);
    }
    for (const [label, mutation] of invalidImages) {
      const data = image('atomic', { dataUrl: jpegFor(`invalid-${++counter}`) });
      const invalid = typeof mutation === 'function' ? mutation(data) : { ...data, ...mutation };
      const id = assetId(String(invalid.noteId ?? 'atomic'), String(invalid.dataUrl));
      await check(`image rejects ${label}`, () => commit([imageWrite(id, invalid)]));
    }
    for (const id of ['atomic', `atomic_${'a'.repeat(63)}`, `atomic_${'A'.repeat(64)}`,
      `atomic_${'g'.repeat(64)}`, `other_${'a'.repeat(64)}`, `atomic_${'a'.repeat(65)}`,
      `atomic_${'a'.repeat(64)}`]) {
      await check(`mismatched asset ID denied (${id.slice(0, 14)})`, () => commit([imageWrite(id, image('atomic'))]));
    }
    await check('correct ID shape but wrong data URL SHA-256 denied', () => commit([
      imageWrite(assetId('atomic', 'wrong-hash'), image('atomic')),
    ]));
    await check('maximum well-formed base64 size accepted', () => commit([
      imageWrite(assetId('atomic', maximumJpeg), image('atomic', { dataUrl: maximumJpeg })),
    ]), allowed);
    await check('image appended to existing live note', () => commit([
      imageWrite(assetId('atomic', appendedJpeg), image('atomic', { dataUrl: appendedJpeg })),
    ]), allowed);
    await check('image overwrite denied', () => commit([
      imageWrite(assetId('atomic'), image('atomic'), false),
    ]));
    await check('image owner/parent changes denied', () => commit([
      imageWrite(assetId('atomic'), image('other', { ownerUid: otherUid }), false),
    ], other));
    await check('image deletion from live note denied', () => remove(`sequenceNoteImages/${assetId('atomic')}`));

    await check('invalid atomic parent/image owner mismatch rolls back', () => commit([
      noteWrite('rollback', note(), { create: true }),
      imageWrite(assetId('rollback'), image('rollback', { ownerUid: otherUid })),
    ]));
    await check('failed atomic write left no note', () => get('sequenceNotes/rollback'), absent);
    await check('failed atomic write left no image', () => get(`sequenceNoteImages/${assetId('rollback')}`), absent);
    await check('cross-operator transaction reads denied', async () => {
      const transaction = await allowed(request(`${documents}:beginTransaction`, other,
        { options: { readWrite: {} } }));
      try {
        return await request(`${documents}:batchGet`, other, {
          transaction: transaction.transaction,
          documents: [`${documents}/sequenceNotes/atomic`, `${documents}/sequenceNoteImages/${assetId('atomic')}`],
        });
      } finally {
        await allowed(request(`${documents}:rollback`, other, { transaction: transaction.transaction }));
      }
    });
    await check('image create with simultaneous parent softdelete denied', () => commit([
      noteWrite('atomic', note({ revision: 2, deleted: true })),
      imageWrite(assetId('atomic', deletedParentJpeg), image('atomic', { dataUrl: deletedParentJpeg })),
    ]));
    await check('valid revision2 update accepted', () => commit([
      noteWrite('atomic', note({ revision: 2, title: 'Updated' })),
    ]), allowed);
    await check('stale revision2 retry denied', () => commit([noteWrite('atomic', note({ revision: 2 }))]));
    await check('softdelete without increment denied', () => commit([
      noteWrite('atomic', note({ revision: 2, deleted: true })),
    ]));
    await check('store-style partial softdelete revision3 accepted', () => commit([
      {
        update: { name: `${documents}/sequenceNotes/atomic`, fields: fields({
          revision: 3, deleted: true, payload: '{}',
        }) },
        updateMask: { fieldPaths: ['revision', 'deleted', 'payload'] },
        currentDocument: { exists: true },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ]), allowed);
    await check('softdeleted state persisted', async () => {
      const result = await get('sequenceNotes/atomic');
      assert.equal(result.body.fields.deleted.booleanValue, true);
      assert.equal(result.body.fields.revision.integerValue, '3');
      assert.equal(result.body.fields.payload.stringValue, '{}');
      assert.equal(result.body.fields.title.stringValue, 'Updated');
      return result;
    }, allowed);
    await check('deleted note remains owner-readable', () => get('sequenceNotes/atomic'), allowed);
    await check('recent own live notes exclude tombstones', async () => {
      const result = await query('sequenceNotes');
      const notes = result.body.filter((row) => row.document).map((row) => row.document);
      assert.equal(notes.length, 2);
      assert(notes.every((doc) => doc.fields.ownerUid.stringValue === uid));
      assert(notes.every((doc) => !doc.fields.deleted.booleanValue));
      assert(!notes.some((doc) => doc.name.endsWith('/atomic')));
      const dates = notes.map((doc) => doc.fields.updatedAt.timestampValue);
      assert.deepEqual(dates, [...dates].sort().reverse());
      return result;
    }, allowed);
    await check('undelete denied', () => commit([noteWrite('atomic', note({ revision: 4 }))]));
    await check('any update to deleted note denied', () => commit([
      noteWrite('atomic', note({ revision: 4, deleted: true })),
    ]));
    await check('direct note deletion still denied', () => remove('sequenceNotes/atomic'));
    await check('new image on deleted parent denied', () => commit([
      imageWrite(assetId('atomic', deletedParentJpeg), image('atomic', { dataUrl: deletedParentJpeg })),
    ]));
    await check('cleanup query finds images of owner tombstone without limit', async () => {
      const result = await query('sequenceNoteImages', uid, null, manager, false, 'atomic');
      assert.equal(result.body.filter((row) => row.document).length, 3);
      return result;
    }, allowed);
    for (const [label, token] of [['signed-out', null], ['nonmanager', nonmanager], ['cross-operator', other]]) {
      await check(`${label} tombstone image deletion denied`, () => remove(`sequenceNoteImages/${assetId('atomic')}`, token));
    }
    await check('owner deletes image after softdelete', () => remove(`sequenceNoteImages/${assetId('atomic')}`), allowed);
    await check('removed image is gone', () => get(`sequenceNoteImages/${assetId('atomic')}`), absent);
    await check('cleanup batch deletes remaining tombstone images', async () => {
      const assets = await allowed(query('sequenceNoteImages', uid, null, manager, false, 'atomic'));
      return commit(assets.filter((row) => row.document).map((row) => ({ delete: row.document.name })));
    }, allowed);
    await check('cleanup leaves no images and preserves tombstone', async () => {
      const assets = await allowed(query('sequenceNoteImages', uid, null, manager, false, 'atomic'));
      assert.equal(assets.filter((row) => row.document).length, 0);
      const result = await get('sequenceNotes/atomic');
      assert.equal(result.body.fields.deleted.booleanValue, true);
      assert.equal(result.body.fields.revision.integerValue, '3');
      return result;
    }, allowed);
    await check('atomic softdelete + image cleanup allowed', () => commit([
      noteWrite('other', note({ ownerUid: otherUid, revision: 2, deleted: true })),
      { delete: `${documents}/sequenceNoteImages/${assetId('other')}` },
    ], other), allowed);
    // Admin fixture writes stay inside the isolated demo emulator, never production.
    const mismatchedParentAsset = assetId('other', jpegFor('mismatched-parent'));
    const absentParentAsset = assetId('absent', jpegFor('absent-parent'));
    await allowed(commit([
      imageWrite(mismatchedParentAsset, image('other', { dataUrl: jpegFor('mismatched-parent') })),
      imageWrite(absentParentAsset, image('absent', { dataUrl: jpegFor('absent-parent') })),
    ], 'owner'));
    await check('image deletion with mismatched tombstone parent owner denied', () =>
      remove(`sequenceNoteImages/${mismatchedParentAsset}`));
    await check('orphan image deletion without parent denied', () =>
      remove(`sequenceNoteImages/${absentParentAsset}`));

    const manyImages = Array.from({ length: 90 }, (_, index) => {
      const bytes = Buffer.from([0xff, 0xd8, 0xff, index, 0xff, 0xd9]);
      const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
      return [assetId('ninety-images', dataUrl), image('ninety-images', { dataUrl })];
    });
    await check('90-image atomic transaction stays within rules access-call limits', async () => {
      const transaction = await allowed(request(`${documents}:beginTransaction`, manager,
        { options: { readWrite: {} } }));
      const reads = await allowed(request(`${documents}:batchGet`, manager, {
        transaction: transaction.transaction,
        documents: [`${documents}/sequenceNotes/ninety-images`,
          ...manyImages.map(([id]) => `${documents}/sequenceNoteImages/${id}`)],
      }));
      assert.equal(reads.length, 91);
      assert(reads.every((read) => read.missing));
      return request(`${documents}:commit`, manager, {
        transaction: transaction.transaction,
        writes: [
          ...manyImages.map(([id, data]) => imageWrite(id, data)),
          noteWrite('ninety-images', note({ moveCount: 90 }), { create: true }),
        ],
      });
    }, allowed);
    await check('all 90 images and revision1 note persisted', async () => {
      const assets = await allowed(query('sequenceNoteImages', uid, null, manager, false, 'ninety-images'));
      assert.equal(assets.filter((row) => row.document).length, 90);
      const result = await get('sequenceNotes/ninety-images');
      assert.equal(result.body.fields.moveCount.integerValue, '90');
      assert.equal(result.body.fields.revision.integerValue, '1');
      return result;
    }, allowed);
    await check('90-image atomic softdelete cleanup stays within access-call limits', () => commit([
      noteWrite('ninety-images', note({ revision: 2, moveCount: 90, deleted: true, payload: '{}' })),
      ...manyImages.map(([id]) => ({ delete: `${documents}/sequenceNoteImages/${id}` })),
    ]), allowed);
    await check('90-image cleanup preserves tombstone and deletes all images', async () => {
      const assets = await allowed(query('sequenceNoteImages', uid, null, manager, false, 'ninety-images'));
      assert.equal(assets.filter((row) => row.document).length, 0);
      const result = await get('sequenceNotes/ninety-images');
      assert.equal(result.body.fields.deleted.booleanValue, true);
      assert.equal(result.body.fields.revision.integerValue, '2');
      return result;
    }, allowed);

    await check('server creation timestamp accepted', () => commit([
      noteWrite('created-time', note(), { create: true, createdServerTime: true }),
    ]), allowed);
    const createdAt = (await allowed(get('sequenceNotes/created-time'))).fields.createdAt.timestampValue;
    await check('creation timestamp immutable on normal edit', () => commit([
      noteWrite('created-time', note({ revision: 2 }), { createdTimestamp: createdAt }),
    ]), allowed);
    await check('creation timestamp removal denied', () => commit([
      noteWrite('created-time', note({ revision: 3 })),
    ]));
    await check('creation timestamp replacement denied', () => commit([
      noteWrite('created-time', note({ revision: 3 }), { createdTimestamp: '2020-01-01T00:00:00Z' }),
    ]));
    await check('backdated new note denied', () => commit([
      noteWrite('backdated', note(), { create: true, createdTimestamp: '2020-01-01T00:00:00Z' }),
    ]));
    await check('creation timestamp wrong type denied', () => commit([
      noteWrite('wrong-created-type', note({ createdAt: 'today' }), { create: true }),
    ]));
    await check('legacy client without creation metadata remains compatible', () => commit([
      noteWrite('legacy-time', note(), { create: true }),
    ]), allowed);
    await check('legacy creation time cannot be guessed by client', () => commit([
      noteWrite('legacy-time', note({ revision: 2 }), { createdServerTime: true }),
    ]));
    await check('soft deletion preserves creation timestamp', () => commit([
      noteWrite('created-time', note({ revision: 3, deleted: true, payload: '{}' }), { createdTimestamp: createdAt }),
    ]), allowed);

    // Preserve representative pre-existing grants and denies outside the new collections.
    await allowed(commit([
      { update: { name: `${documents}/studios/qa-studio`, fields: fields({ name: 'QA' }) } },
      { update: { name: `${documents}/memberProfiles/qa-member`, fields: fields({ studioId: 'qa-studio' }) } },
    ], 'owner'));
    await check('unprovisioned instructor cannot read studio metadata', () => get('studios/qa-studio', nonmanager));
    await check('existing signed-out studio read denied', () => get('studios/qa-studio', null));
    await check('existing studio write denied even for manager', () => commit([
      { update: { name: `${documents}/studios/qa-studio`, fields: fields({ name: 'No' }) } },
    ]));
    await check('existing manager profile read preserved', () => get('memberProfiles/qa-member'), allowed);
    await check('existing nonmanager profile read denied', () => get('memberProfiles/qa-member', nonmanager));
    await check('existing default-deny collection preserved', () => commit([
      { update: { name: `${documents}/unknownCollection/test`, fields: fields({ ownerUid: uid }) } },
    ]));

    const instructorUid = 'core-instructor-a';
    const instructorId = 'core-staff-a';
    const authTime = Math.floor(Date.now() / 1000);
    const instructor = mockToken(instructorUid, 'instructor', { staffId: instructorId, auth_time: authTime });
    const coreStaff = { uid: instructorUid, staffId: instructorId, studioId: 'qa-studio', role: 'instructor', active: true,
      employmentStatus: 'current', employmentSource: 'studiomate_staff_tab_browser_scan',
      coreAccessEnabled: true, coreMustChangePassword: true, coreAuthAfter: authTime };
    const putStaff = (changes = {}) => commit([
      { update: { name: `${documents}/staffs/${instructorId}`, fields: fields({ ...coreStaff, ...changes }) } },
    ], 'owner');
    await allowed(putStaff());
    await check('initial instructor cannot create a sequence', () => commit([
      noteWrite('core-own', note({ ownerUid: instructorUid }), { create: true }),
    ], instructor));
    await check('initial instructor cannot read own credential document', () => get(`staffs/${instructorId}`, instructor));
    await check('initial instructor cannot read a missing sequence', () => get('sequenceNotes/core-own', instructor));
    await allowed(putStaff({ coreMustChangePassword: false }));
    await check('ready instructor creates only own sequence', () => commit([
      noteWrite('core-own', note({ ownerUid: instructorUid }), { create: true }),
    ], instructor), allowed);
    await check('ready instructor reads own sequence', () => get('sequenceNotes/core-own', instructor), allowed);
    await check('ready instructor queries own sequence list', () => query('sequenceNotes', instructorUid, 100, instructor), allowed);
    await check('ready instructor cannot read manager sequence', () => get('sequenceNotes/atomic', instructor));
    await check('ready instructor cannot query another owner', () => query('sequenceNotes', uid, 100, instructor));
    await check('ready instructor cannot read credential hashes', () => get(`staffs/${instructorId}`, instructor));
    await check('ready instructor cannot read member profile', () => get('memberProfiles/qa-member', instructor));
    await allowed(commit(['dashboardSnapshots/current', 'conversations/core-test', 'privateLessonChartRequests/core-test',
      'privateSurveyResponses/core-test', 'alimtalkSends/core-test'].map(id => ({
      update: { name: `${documents}/${id}`, fields: fields({ studioId: 'qa-studio', staffId: instructorId }) },
    })), 'owner'));
    for (const path of ['dashboardSnapshots/current', 'conversations/core-test', 'privateLessonChartRequests/core-test',
      'privateSurveyResponses/core-test', 'alimtalkSends/core-test']) {
      await check(`ready instructor raw read denied ${path}`, () => get(path, instructor));
    }
    await allowed(putStaff({ coreMustChangePassword: false, coreAuthAfter: authTime + 1 }));
    await check('old session stays blocked after password change', () => get('sequenceNotes/core-own', instructor));
    await allowed(putStaff({ coreMustChangePassword: false, employmentStatus: 'inactive' }));
    await check('departure blocks existing instructor token', () => get('sequenceNotes/core-own', instructor));
    await allowed(putStaff({ coreMustChangePassword: false, coreAccessEnabled: false }));
    await check('operator access switch blocks existing token', () => get('sequenceNotes/core-own', instructor));
    await allowed(putStaff({ coreMustChangePassword: false }));
    await check('wrong canonical UID cannot access sequence', () => get('sequenceNotes/core-own',
      mockToken('different-instructor', 'instructor', { staffId: instructorId })));
    await check('manager access remains unchanged after instructor policy', () => get('sequenceNotes/_', manager), allowed);
  });
}
