import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Pin the unpatched adapter so the same fixture proves the original failure.
const prepatchCommit = '708b863e6c7d88a31439d1f0e73649f4df11adaf';
const root = new URL('../../', import.meta.url);
const adapterPath = 'core/assets/sequence-store.js';
const prepatchSource = execFileSync('git', ['show', `${prepatchCommit}:${adapterPath}`], {
  cwd: root, encoding: 'utf8',
});
const currentSource = await readFile(new URL(adapterPath, root), 'utf8');
const image = 'data:image/jpeg;base64,AQID';
const changedImage = 'data:image/jpeg;base64,BAUG';
const imageId = async (dataUrl = image) => `note_1_${Buffer.from(
  await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl)),
).toString('hex')}`;
const input = (dataUrl) => ({
  id: 'note_1', title: 'Fixture sequence', teacher: 'Fixture teacher',
  equipment: 'Reformer', date: '2026-10-12', goal: 'Fixture goal',
  moves: { main: [{ name: 'Fixture move', ...(dataUrl ? { image: dataUrl } : {}) }] },
});

const parentSdkSource = `
  const records = new Map();
  const attempts = [];
  const writes = [];
  const deletes = [];
  const sentinels = [];
  let transactionCount = 0;
  let readCount = 0;
  class Timestamp {
    constructor(seconds) { this.seconds = seconds; this.nanoseconds = 123; }
    toJSON() { throw new Error('Timestamp must not be serialized'); }
  }
  class ServerTimestamp {
    toJSON() { throw new Error('serverTimestamp must not be serialized'); }
  }
  const timestamp = new Timestamp(123456);
  const date = new Date('2026-10-01T00:00:00Z');
  date.toJSON = () => { throw new Error('Date must not be serialized'); };
  const authClient = { currentUser: { uid: 'owner_1' } };
  const db = {};
  const doc = (_db, collection, id) => ({ path: collection + '/' + id, id });
  const snapshot = (ref) => ({
    ref, id: ref.id, exists: () => records.has(ref.path), data: () => records.get(ref.path),
  });
  // This validator runs with the parent's Object, Date and SDK constructors.
  function validate(value) {
    if (value === null || typeof value !== 'object') return;
    if (value instanceof Timestamp || value instanceof ServerTimestamp || value instanceof Date) return;
    if (Array.isArray(value)) { value.forEach(validate); return; }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw Object.assign(new Error('Unsupported field value: a custom Object object'), { code: 'invalid-argument' });
    }
    Object.values(value).forEach(validate);
  }
  function stage(staged, kind, ref, data) {
    attempts.push({ kind, path: ref.path, data });
    validate(data);
    staged.push({ kind, path: ref.path, data });
  }
  const runtime = {
    db, doc, authClient,
    collection: (_db, name) => ({ name }),
    where: (field, op, value) => ({ field, op, value }),
    orderBy: () => null, limit: () => null,
    query: (collection, ...filters) => ({ collection, filters: filters.filter(Boolean) }),
    getDocFromServer: async (ref) => { readCount += 1; return snapshot(ref); },
    getDocsFromServer: async ({ collection, filters }) => {
      readCount += 1;
      return { docs: [...records].filter(([path, data]) =>
        path.startsWith(collection.name + '/') && filters.every(({ field, value }) => data[field] === value)
      ).map(([path]) => snapshot({ path, id: path.split('/')[1] })) };
    },
    onSnapshot: () => { readCount += 1; return () => {}; },
    serverTimestamp: () => { const value = new ServerTimestamp(); sentinels.push(value); return value; },
    runTransaction: async (_db, callback) => {
      transactionCount += 1;
      const staged = [];
      const result = await callback({
        get: async (ref) => { readCount += 1; return snapshot(ref); },
        set: (ref, data) => stage(staged, 'set', ref, data),
        update: (ref, data) => stage(staged, 'update', ref, data),
      });
      for (const write of staged) {
        const previous = write.kind === 'update' ? records.get(write.path) : undefined;
        records.set(write.path, Object.assign({}, previous, write.data));
        writes.push(write);
      }
      return result;
    },
    writeBatch: () => {
      const staged = [];
      return {
        delete: (ref) => staged.push(ref.path),
        commit: async () => { for (const path of staged) { records.delete(path); deletes.push(path); } },
      };
    },
  };
  ({ runtime, records, attempts, writes, deletes, sentinels, timestamp, date,
    ObjectPrototype: Object.prototype, validate,
    counts: () => ({ transactions: transactionCount, reads: readCount }),
    seed: (path, data) => records.set(path, Object.assign({}, data)),
  });
`;

async function fixture(source = currentSource) {
  const parent = vm.createContext({});
  const sdk = vm.runInContext(parentSdkSource, parent);
  const child = vm.createContext({ crypto: webcrypto, TextEncoder, atob });
  const module = new vm.SourceTextModule(source, { context: child, identifier: adapterPath });
  await module.link(() => { throw new Error('Unexpected adapter dependency'); });
  await module.evaluate();
  const store = module.namespace.createSequenceStore(sdk.runtime, { uid: 'owner_1' });
  const foreignObject = vm.runInContext('({ fixture: true })', child);
  assert.notStrictEqual(Object.getPrototypeOf(foreignObject), sdk.ObjectPrototype);
  return { ...sdk, store, foreignObject };
}

function seedNote(f, overrides = {}) {
  f.seed('sequenceNotes/note_1', {
    ownerUid: 'owner_1', revision: 4, deleted: false, createdAt: f.timestamp,
    payload: JSON.stringify(input()), ...overrides,
  });
}

function assertNullRecords(f) {
  assert.ok(f.writes.length > 0);
  for (const { data } of f.writes) assert.strictEqual(Object.getPrototypeOf(data), null);
}

const conflict = (error) => error.code === 'sequence/conflict';

test('parent SDK accepts its own records/null records and rejects foreign ordinary objects', async () => {
  const f = await fixture(prepatchSource);
  assert.doesNotThrow(() => f.validate(f.runtime.authClient.currentUser));
  assert.doesNotThrow(() => f.validate(Object.assign(Object.create(null), {
    timestamp: f.timestamp, sentinel: f.runtime.serverTimestamp(), date: f.date,
  })));
  assert.throws(() => f.validate(f.foreignObject), { code: 'invalid-argument' });
});

for (const scenario of ['image create', 'note create', 'note update', 'tombstone update']) {
  test(`prepatch HEAD rejects foreign Object at ${scenario}`, async () => {
    const f = await fixture(prepatchSource);
    if (scenario.endsWith('update')) seedNote(f);
    const action = scenario === 'tombstone update'
      ? () => f.store.remove('note_1', 4)
      : () => f.store.save(input(scenario === 'image create' ? image : undefined), scenario === 'note update' ? 4 : 0);
    await assert.rejects(action, { code: 'invalid-argument', message: /custom Object/ });
    assert.equal(f.attempts.length, 1);
    assert.equal(f.attempts[0].kind, scenario === 'tombstone update' ? 'update' : 'set');
    assert.equal(f.attempts[0].path, scenario === 'image create'
      ? `sequenceNoteImages/${await imageId()}` : 'sequenceNotes/note_1');
    assert.notStrictEqual(Object.getPrototypeOf(f.attempts[0].data), f.ObjectPrototype);
    assert.notStrictEqual(Object.getPrototypeOf(f.attempts[0].data), null);
    assert.equal(f.writes.length, 0);
    assert.equal(f.deletes.length, 0);
  });
}

test('fixed create writes null records, preserves sentinels and round-trips the image', async () => {
  const f = await fixture();
  const state = input(image);
  assert.equal(await f.store.save(state, 0), 1);
  assertNullRecords(f);
  assert.deepEqual(Array.from(f.writes, ({ kind, path }) => `${kind}:${path}`), [
    `set:sequenceNoteImages/${await imageId()}`, 'set:sequenceNotes/note_1',
  ]);
  const note = f.records.get('sequenceNotes/note_1');
  assert.strictEqual(note.updatedAt, f.sentinels[0]);
  assert.strictEqual(note.createdAt, f.sentinels[1]);
  assert.notStrictEqual(note.updatedAt, note.createdAt);
  assert.equal(note.ownerUid, 'owner_1');
  assert.equal(note.revision, 1);
  assert.equal(note.deleted, false);
  assert.equal(note.moveCount, 1);
  assert.equal(f.records.get(`sequenceNoteImages/${await imageId()}`).dataUrl, image);
  assert.equal(JSON.parse(note.payload).moves.main[0].image, (await imageId()).slice('note_1_'.length));
  assert.equal(state.moves.main[0].image, image);
  const loaded = await f.store.get('note_1');
  assert.equal(loaded.revision, 1);
  assert.equal(JSON.stringify(loaded.state), JSON.stringify(state));
});

for (const createdAt of ['timestamp', 'date', 'absent']) {
  test(`fixed update retains parent ${createdAt} without serializing and writes a new image`, async () => {
    const f = await fixture();
    seedNote(f, { createdAt: createdAt === 'absent' ? undefined : f[createdAt] });
    assert.equal(await f.store.save(input(changedImage), 4), 5);
    assertNullRecords(f);
    assert.equal(f.writes.length, 2);
    const note = f.records.get('sequenceNotes/note_1');
    assert.strictEqual(note.updatedAt, f.sentinels[0]);
    assert.equal(f.sentinels.length, 1);
    if (createdAt === 'absent') assert.equal(Object.hasOwn(f.writes[1].data, 'createdAt'), false);
    else assert.strictEqual(note.createdAt, f[createdAt]);
    assert.equal(note.revision, 5);
    assert.equal(f.records.get(`sequenceNoteImages/${await imageId(changedImage)}`).dataUrl, changedImage);
  });
}

test('fixed repeated image is not rewritten and tombstone keeps identity before cleanup', async () => {
  const f = await fixture();
  assert.equal(await f.store.save(input(image), 0), 1);
  const createdAt = f.records.get('sequenceNotes/note_1').createdAt;
  assert.equal(await f.store.save(input(image), 1), 2);
  assert.equal(f.writes.filter(({ path }) => path.startsWith('sequenceNoteImages/')).length, 1);
  assert.strictEqual(f.records.get('sequenceNotes/note_1').createdAt, createdAt);
  await f.store.remove('note_1', 2);
  assertNullRecords(f);
  const tombstone = f.records.get('sequenceNotes/note_1');
  assert.equal(f.writes.at(-1).kind, 'update');
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.revision, 3);
  assert.equal(tombstone.payload, '{}');
  assert.strictEqual(tombstone.createdAt, createdAt);
  assert.strictEqual(tombstone.updatedAt, f.sentinels.at(-1));
  assert.deepEqual(Array.from(f.deletes), [`sequenceNoteImages/${await imageId()}`]);
  assert.equal(f.records.has(`sequenceNoteImages/${await imageId()}`), false);
  const writes = f.writes.length;
  await assert.rejects(() => f.store.save(input(), 0), conflict);
  await assert.rejects(() => f.store.get('note_1'), conflict);
  assert.equal(f.writes.length, writes);
});

for (const operation of ['save', 'remove']) {
  for (const reason of ['stale revision', 'missing record', 'cross-owner', 'deleted']) {
    test(`fixed ${operation} rejects ${reason} without any write`, async () => {
      const f = await fixture();
      if (reason !== 'missing record') seedNote(f, {
        ...(reason === 'cross-owner' ? { ownerUid: 'owner_2' } : {}),
        ...(reason === 'deleted' ? { deleted: true } : {}),
      });
      const revision = reason === 'stale revision' ? 3 : 4;
      await assert.rejects(() => operation === 'save'
        ? f.store.save(input(image), revision) : f.store.remove('note_1', revision), conflict);
      assert.equal(f.attempts.length, 0);
      assert.equal(f.writes.length, 0);
      assert.equal(f.deletes.length, 0);
    });
  }
}

for (const mismatch of ['ownerUid', 'noteId', 'dataUrl']) {
  test(`fixed save rejects existing image ${mismatch} mismatch atomically`, async () => {
    const f = await fixture();
    f.seed(`sequenceNoteImages/${await imageId()}`, {
      ownerUid: 'owner_1', noteId: 'note_1', dataUrl: image, [mismatch]: 'wrong',
    });
    await assert.rejects(() => f.store.save(input(image), 0), conflict);
    assert.equal(f.attempts.length, 0);
    assert.equal(f.records.has('sequenceNotes/note_1'), false);
  });
}

test('fixed save reuses a matching parent-realm image record', async () => {
  const f = await fixture();
  f.seed(`sequenceNoteImages/${await imageId()}`, { ownerUid: 'owner_1', noteId: 'note_1', dataUrl: image });
  assert.equal(await f.store.save(input(image), 0), 1);
  assertNullRecords(f);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].path, 'sequenceNotes/note_1');
});

for (const currentUser of [{ uid: 'owner_2' }, null]) {
  test(`fixed session ${currentUser ? 'change' : 'sign-out'} blocks reads and writes`, async () => {
    const f = await fixture();
    seedNote(f);
    f.runtime.authClient.currentUser = currentUser;
    const actions = [
      () => f.store.save(input(image), 4), () => f.store.remove('note_1', 4),
      () => f.store.get('note_1'), () => f.store.cleanupImages('note_1'),
      () => f.store.list(), () => f.store.subscribe(() => {}, () => {}),
      () => f.store.watch('note_1', () => {}, () => {}),
    ];
    for (const action of actions) {
      await assert.rejects(async () => action(), { code: 'permission-denied' });
    }
    assert.equal(f.counts().transactions, 0);
    assert.equal(f.counts().reads, 0);
    assert.equal(f.attempts.length, 0);
    assert.equal(f.deletes.length, 0);
  });
}
