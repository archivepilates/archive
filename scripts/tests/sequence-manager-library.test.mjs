import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const source = await readFile(new URL('../../core/assets/sequence-store.js', import.meta.url), 'utf8');
const { createSequenceStore } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function fixture(role = 'manager') {
  const records = new Map(), writes = [], queries = [];
  const snapshot = path => ({ id: path.split('/').at(-1), exists: () => records.has(path), data: () => records.get(path) });
  const runtime = {
    db: {}, authClient: { currentUser: { uid: 'operator' } },
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    collection: (_db, name) => name,
    where: (field, op, value) => ({ type: 'where', field, value }),
    orderBy: (field, direction) => ({ type: 'order', field, direction }),
    documentId: () => '__name__', startAfter: (updatedAt, id) => ({ type: 'after', updatedAt, id }),
    limit: value => ({ type: 'limit', value }),
    query: (name, ...constraints) => ({ name, constraints }),
    getDocFromServer: async ref => snapshot(ref.path),
    getDocsFromServer: async query => {
      queries.push(query);
      let rows = [...records].filter(([path]) => path.startsWith(query.name + '/'));
      for (const constraint of query.constraints) {
        if (constraint.type === 'where') rows = rows.filter(([, data]) => data[constraint.field] === constraint.value);
        if (constraint.type === 'order' && constraint.field === 'updatedAt') rows.sort((a, b) => b[1].updatedAt - a[1].updatedAt || b[0].localeCompare(a[0]));
        if (constraint.type === 'after') rows = rows.filter(([path, data]) => data.updatedAt < constraint.updatedAt || data.updatedAt === constraint.updatedAt && path.split('/').at(-1) < constraint.id);
        if (constraint.type === 'limit') rows = rows.slice(0, constraint.value);
      }
      return { docs: rows.map(([path]) => snapshot(path)) };
    },
    onSnapshot: (query) => { queries.push(query); return () => {}; },
    runTransaction: async (_db, fn) => fn({ get: ref => snapshot(ref.path), set: (...args) => writes.push(args), update: (...args) => writes.push(args) }),
    serverTimestamp: () => 'server-time',
  };
  const state = id => ({ id, title: 'Fixture', teacher: 'Teacher', equipment: '체어', date: '', goal: '', moves: { main: [] } });
  const seed = (id, ownerUid, deleted = false, updatedAt = 1) => records.set(`sequenceNotes/${id}`,
    { ownerUid, deleted, updatedAt, revision: 1, payload: JSON.stringify(state(id)), title: 'Fixture' });
  return { store: createSequenceStore(runtime, { uid: 'operator' }, { role }), runtime, records, writes, queries, seed, state };
}

test('manager all and own queries retain deleted filter and bounded pagination', async () => {
  const f = fixture();
  for (let i = 0; i < 105; i++) f.seed(`note_${String(i).padStart(3, '0')}`, 'instructor', false, i);
  f.seed('own', 'operator', false, 106); f.seed('deleted', 'instructor', true, 107);
  assert.equal((await f.store.list()).length, 1);
  const first = await f.store.list('all'); assert.equal(first.length, 100);
  const next = await f.store.list('all', first.at(-1)); assert.equal(next.length, 6);
  assert.equal(new Set([...first, ...next].map(d => d.id)).size, 106);
  f.store.subscribe(() => {}, () => {}, 'all');
  assert.ok(f.queries.at(-1).constraints.some(c => c.field === 'deleted' && c.value === false));
  assert.equal(f.queries.at(-1).constraints.some(c => c.field === 'ownerUid'), false);
});

test('instructor cannot request an all-owner list or subscription', async () => {
  for (const role of ['instructor', 'owner', '']) {
    const f = fixture(role);
    await assert.rejects(f.store.list('all'), { code: 'permission-denied' });
    assert.throws(() => f.store.subscribe(() => {}, () => {}, 'all'), { code: 'permission-denied' });
    assert.equal(f.queries.length, 0);
  }
});

test('manager reads foreign payload and image but cannot save, delete or read tombstones', async () => {
  const f = fixture(); f.seed('foreign', 'teacher');
  const state = f.state('foreign'); state.moves.main.push({ image: 'hash' });
  f.records.get('sequenceNotes/foreign').payload = JSON.stringify(state);
  f.records.set('sequenceNoteImages/foreign_hash', { ownerUid: 'teacher', noteId: 'foreign', dataUrl: 'data:image/jpeg;base64,AQID' });
  const loaded = await f.store.get('foreign'); assert.equal(loaded.readOnly, true);
  assert.equal(loaded.state.moves.main[0].image, 'data:image/jpeg;base64,AQID');
  await assert.rejects(f.store.save(f.state('foreign'), 1), { code: 'sequence/conflict' });
  await assert.rejects(f.store.remove('foreign', 1), { code: 'sequence/conflict' });
  assert.equal(f.writes.length, 0);
  f.records.get('sequenceNotes/foreign').deleted = true;
  await assert.rejects(f.store.get('foreign'), { code: 'sequence/conflict' });
});

test('instructor foreign get remains blocked and manager rejects mismatched attachment owner', async () => {
  const f = fixture('instructor'); f.seed('foreign', 'teacher');
  await assert.rejects(f.store.get('foreign'), { code: 'sequence/conflict' });
  const m = fixture(); m.seed('foreign', 'teacher');
  const state = m.state('foreign'); state.moves.main.push({ image: 'hash' });
  m.records.get('sequenceNotes/foreign').payload = JSON.stringify(state);
  m.records.set('sequenceNoteImages/foreign_hash', { ownerUid: 'unrelated', noteId: 'foreign', dataUrl: 'image' });
  await assert.rejects(m.store.get('foreign'), /첨부 이미지/);
});

test('session swap prevents manager reads and ownership fields never determine access', async () => {
  const f = fixture(); f.seed('foreign', 'teacher');
  f.runtime.authClient.currentUser = { uid: 'someone-else' };
  await assert.rejects(f.store.get('foreign'), { code: 'permission-denied' });
  await assert.rejects(f.store.list('all'), { code: 'permission-denied' });
});
