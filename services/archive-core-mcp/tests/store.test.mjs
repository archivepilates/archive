import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { AREAS } from '../src/records.mjs';

function fixture(data) {
  const calls = [];
  const doc = { id: 'record', exists: true, data: () => data };
  const query = { doc: id => { calls.push(['doc', id]); return { get: async () => doc }; },
    where: (...args) => { calls.push(['where', ...args]); return query; },
    orderBy: name => { calls.push(['orderBy', name]); return query; },
    startAfter: id => { calls.push(['after', id]); return query; },
    limit: count => { calls.push(['limit', count]); return query; },
    get: async () => ({ docs: [doc, { ...doc, id: 'record2' }] }) };
  return { calls, store: createStore({ collection: name => { calls.push(['collection', name]); return query; } }) };
}
test('registered records are explicit projections and never source mirrors', () => {
  for (const spec of Object.values(AREAS)) {
    assert.ok(Array.isArray(spec.allowedFields));
    assert.ok(!['members', 'member360Cards', 'workLanes'].includes(spec.collection));
    assert.ok(spec.studioField || spec.allowUnscoped);
  }
});
test('list uses studio scope, bounded limit, exact fields and document cursor', async () => {
  const { store, calls } = fixture({ studioId: '5330', memberId: 'member', name: 'Example', password: 'PRIVATE', answers: 'PRIVATE' });
  const result = await store.list('memberProfiles', { name: 'Example' }, 1, 'after-record');
  assert.equal(result.hasMore, true); assert.equal(result.nextAfterId, 'record');
  assert.deepEqual(calls.filter(c => c[0] === 'where'), [['where', 'studioId', '==', '5330'], ['where', 'name', '==', 'Example']]);
  assert.ok(calls.some(c => c[0] === 'limit' && c[1] === 2));
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('unsupported areas, filters, limits and document paths fail closed', async () => {
  const { store } = fixture({ studioId: '5330' });
  await assert.rejects(store.get('members', 'record'), { code: 'UNKNOWN_AREA' });
  await assert.rejects(store.get('memberProfiles', '../secret'), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(store.list('memberProfiles', { secret: 'value' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(store.list('memberProfiles', {}, 51), { code: 'INVALID_ARGUMENT' });
});
test('missing or different studio cannot leak a direct document', async () => {
  for (const data of [{ studioId: 'other' }, {}]) {
    const { store } = fixture(data);
    await assert.rejects(store.get('mealDrafts', 'record'), { code: 'SOURCE_SCOPE' });
  }
});
