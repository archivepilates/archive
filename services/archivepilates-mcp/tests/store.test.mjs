import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { sourceHash, validateProfile } from '../src/service.mjs';

const now = Date.parse('2026-10-15T10:00:00Z');
const person = () => ({ memberId: '123', studioId: '5330', name: '테스트', phone: '01000001234', syncedAt: new Date(now) });
const owner = () => ({ staffId: 'operator', studioId: '5330', role: 'owner', active: true });
function fake(seed = {}) {
  const data = new Map(Object.entries(seed)), reads = [], writes = [];
  const snapshot = path => ({ id: path.split('/').at(-1), exists: data.has(path), data: () => data.get(path) });
  const nested = (value, field) => field.split('.').reduce((v, key) => v?.[key], value);
  function collection(name) {
    const build = (filters = [], cap = Infinity) => ({
      where: (field, operator, value) => { assert.equal(operator, '=='); return build([...filters, [field, value]], cap); },
      limit: max => build(filters, max),
      select: (...fields) => { assert.ok(fields.includes('activeTickets')); assert.ok(!fields.includes('answers')); return build(filters, cap); },
      async get() {
        reads.push({ name, filters, cap });
        const docs = [...data.entries()].filter(([key, value]) => key.startsWith(`${name}/`)
          && filters.every(([field, expected]) => nested(value, field) === expected)).slice(0, cap).map(([key]) => snapshot(key));
        return { docs, size: docs.length };
      },
      doc: key => ({ path: `${name}/${key}`, get: async () => snapshot(`${name}/${key}`) }),
    });
    return build();
  }
  let tail = Promise.resolve();
  return { data, reads, writes, db: { collection, getAll: async (...refs) => refs.map(ref => snapshot(ref.path)),
    runTransaction(fn) {
      const next = tail.then(async () => {
        const pending = [];
        const result = await fn({ get: ref => ref.path ? Promise.resolve(snapshot(ref.path)) : ref.get(),
          create: (ref, value) => { assert.equal(data.has(ref.path), false); pending.push([ref.path, value]); } });
        pending.forEach(([key, value]) => { data.set(key, value); writes.push(key); });
        return result;
      });
      tail = next.catch(() => {}); return next;
    },
  } };
}
const timestamps = { fromMillis: value => new Date(value) };

test('queries native contract member bindings instead of silently returning an empty top-level query', async () => {
  const f = fake({ 'studiomateMembershipContracts/c1': { studioId: '5330', binding: { memberId: '123' }, selection: { memberId: '123' } } });
  const rows = await createStore(f.db, timestamps).getRows('studiomateMembershipContracts', ['123']);
  assert.equal(rows.length, 1); assert.equal(rows[0]._id, 'c1');
  assert.deepEqual(f.reads.map(x => x.filters[1][0]), ['binding.memberId', 'selection.memberId', 'completion.memberId', 'memberId']);
  assert.equal(f.writes.length, 0);
});
test('collection names and paths cannot be supplied by callers', async () => {
  const store = createStore(fake().db, timestamps);
  await assert.rejects(store.getRows('members', ['123']), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(store.getJob('__proto__', 'x'), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(store.getProfile('../secrets'), { code: 'INVALID_ARGUMENT' });
});
test('cross-studio direct records are rejected and lists are constrained at query time', async () => {
  const f = fake({ 'memberProfiles/123': { ...person(), studioId: 'other' }, 'bookings/b1': { studioId: 'other', memberId: '123' } });
  const store = createStore(f.db, timestamps);
  await assert.rejects(store.getProfile('123'), { code: 'SOURCE_SCOPE_MISMATCH' });
  assert.deepEqual(await store.getRows('bookings', ['123']), []);
  assert.deepEqual(f.reads[0].filters[0], ['studioId', '5330']);
});
test('bounded list never reports truncated results as complete', async () => {
  const seed = Object.fromEntries(Array.from({ length: 201 }, (_, n) => [`bookings/b${n}`, { studioId: '5330', memberId: '123' }]));
  await assert.rejects(createStore(fake(seed).db, timestamps).getRows('bookings', ['123']), { code: 'SOURCE_LIMIT' });
});
test('exact member search is capped and preserves source IDs', async () => {
  const f = fake({ 'memberProfiles/123': person() });
  assert.equal((await createStore(f.db, timestamps).findMembers('테스트', false))[0]._id, '123');
  assert.equal(f.reads[0].cap, 11);
});

test('ticket inventory is scoped, projected and cached for five minutes without writes', async () => {
  const f = fake({ 'memberProfiles/123': person(), 'memberProfiles/999': { ...person(), studioId: 'other' } });
  let clock = now;
  const store = createStore(f.db, timestamps, { now: () => clock });
  assert.equal((await store.getTicketInventory()).cacheHit, false);
  assert.equal((await store.getTicketInventory()).cacheHit, true);
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].cap, 2001);
  assert.equal((await store.getTicketInventory()).profiles.length, 1);
  await store.getTicketInventory({ forceRefresh: true });
  assert.equal(f.reads.length, 2);
  clock += 300000;
  assert.equal((await store.getTicketInventory()).cacheHit, false);
  assert.equal(f.reads.length, 3);
  assert.equal(f.writes.length, 0);
});

test('ticket inventory rejects overflow and never falls back to an old snapshot after refresh failure', async () => {
  const f = fake({ 'memberProfiles/123': person() });
  const store = createStore(f.db, timestamps, { now: () => now });
  await store.getTicketInventory();
  for (let n = 0; n < 2001; n++) f.data.set(`memberProfiles/x${n}`, person());
  await assert.rejects(store.getTicketInventory({ forceRefresh: true }), { code: 'SOURCE_LIMIT' });
  await assert.rejects(store.getTicketInventory(), { code: 'SOURCE_LIMIT' });
});

test('concurrent inventory requests share one bounded source read', async () => {
  const f = fake({ 'memberProfiles/123': person() });
  const store = createStore(f.db, timestamps, { now: () => now });
  const [one, two] = await Promise.all([store.getTicketInventory(), store.getTicketInventory({ forceRefresh: true })]);
  assert.equal(f.reads.length, 1);
  assert.equal(one.fetchedAt, two.fetchedAt);
});

test('inventory links native and Excel identities only with a matching completion receipt', async () => {
  const alias = { ...person(), memberId: 'excel_123', studiomateMemberId: '123', studiomateMemberIdResolvedAt: new Date(now) };
  const proof = { status: 'done', studioId: '5330', memberId: 'excel_123', studiomateMemberId: '123',
    memberName: alias.name, memberPhone: alias.phone, resolvedAt: new Date(now) };
  for (const patch of [{}, { status: 'pending' }, { studioId: 'other' }, { memberName: '다른이름' },
    { memberPhone: '01099995678' }, { resolvedAt: new Date(now - 1) }]) {
    const f = fake({ 'memberProfiles/123': person(), 'memberProfiles/excel_123': alias,
      'studiomateMemberIdLookupJobs/studiomate_member_id_lookup_excel_123': { ...proof, ...patch } });
    const result = await createStore(f.db, timestamps).getTicketInventory();
    assert.equal(result.verifiedLinks.length, Object.keys(patch).length ? 0 : 1);
  }
});
function input(f) {
  const profile = { ...person(), _id: '123' };
  return { proposal: { proposalId: 'p1', jobId: 'mcp_memo_test', memberId: '123', content: '추가 메모', sourceHash: sourceHash(profile) },
    actor: { staffId: 'operator', uid: 'uid' }, now, sourceHash,
    validateProfile: value => validateProfile(value, true, now) };
}
test('canonical memo and existing queue item are atomic and concurrent repeats create once', async () => {
  const f = fake({ 'memberProfiles/123': person(), 'staffs/operator': owner() }), store = createStore(f.db, timestamps);
  const results = await Promise.all([store.commitMemo(input(f)), store.commitMemo(input(f))]);
  assert.equal(results.filter(x => !x.duplicate).length, 1); assert.equal(f.writes.length, 2);
  const memo = f.data.get('memberMemos/mcp_memo_test'), job = f.data.get('studiomateMemoWriteJobs/mcp_memo_test');
  assert.equal(memo.syncStatus, 'pending'); assert.equal(job.status, 'pending'); assert.equal(job.maxAttempts, 1);
  assert.equal(job.writeMode, 'playwright'); assert.equal(job.studiomateMemberId, '123');
  assert.equal(memo.approval.method, 'local_operator_terminal');
});
test('source changed after approval causes no queue or memo mutation', async () => {
  const f = fake({ 'memberProfiles/123': { ...person(), phone: '01000009999' }, 'staffs/operator': owner() });
  await assert.rejects(createStore(f.db, timestamps).commitMemo(input(f)), { code: 'SOURCE_CHANGED' });
  assert.equal(f.writes.length, 0);
});
test('operator revoked during transaction causes no mutation', async () => {
  const f = fake({ 'memberProfiles/123': person(), 'staffs/operator': { ...owner(), active: false } });
  await assert.rejects(createStore(f.db, timestamps).commitMemo(input(f)), { code: 'PERMISSION_DENIED' });
  assert.equal(f.writes.length, 0);
});
test('one-sided existing operation is not repaired or retried', async () => {
  const f = fake({ 'memberProfiles/123': person(), 'staffs/operator': owner(), 'memberMemos/mcp_memo_test': { studioId: '5330', memberId: '123', content: '추가 메모' } });
  await assert.rejects(createStore(f.db, timestamps).commitMemo(input(f)), { code: 'INCOMPLETE_OPERATION' });
  assert.equal(f.writes.length, 0);
});
test('failed existing memo job remains failed without requeue', async () => {
  const existing = { studioId: '5330', memberId: '123', content: '추가 메모', status: 'failed' };
  const f = fake({ 'memberProfiles/123': person(), 'staffs/operator': owner(), 'memberMemos/mcp_memo_test': existing,
    'studiomateMemoWriteJobs/mcp_memo_test': existing });
  const result = await createStore(f.db, timestamps).commitMemo(input(f));
  assert.equal(result.duplicate, true); assert.equal(result.status, 'failed'); assert.equal(f.writes.length, 0);
});
