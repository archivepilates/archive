import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTIONS } from '../src/actions.mjs';
import { createStore } from '../src/store.mjs';
import { createPlans } from '../src/plans.mjs';
import { CoreError, hash } from '../src/safety.mjs';

const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error('Real network forbidden in source guard tests'); }; });
after(() => { globalThis.fetch = originalFetch; });

const safeError = code => error => {
  assert.ok(error instanceof CoreError);
  assert.equal(error.code, code);
  assert.equal(error.safe, true);
  return true;
};

const memoParams = () => ({ bookingId: 'fake-booking-a', memberId: 'fake-member-a',
  lectureId: 'fake-lecture-a', content: 'Synthetic memo A' });

function storeFixture() {
  const records = {
    bookings: { 'fake-booking-a': { studioId: '5330', memberId: 'fake-member-a', lectureId: 'fake-lecture-a' } },
    memberProfiles: {
      'fake-member-a': { studioId: '5330', memberId: 'fake-member-a' },
      'fake-member-b': { studioId: '5330', memberId: 'fake-member-b' },
    },
    lectures: {
      'fake-lecture-a': { studioId: '5330', lectureId: 'fake-lecture-a' },
      'fake-lecture-b': { studioId: '5330', lectureId: 'fake-lecture-b' },
    },
  };
  const reads = [];
  const db = { collection(collection) {
    assert.ok(Object.hasOwn(records, collection), 'Only fake source collections are available');
    return { doc(id) { return { async get() {
      reads.push(`${collection}/${id}`);
      const value = structuredClone(records[collection][id]);
      return { exists: value !== undefined, data: () => structuredClone(value) };
    } }; } };
  } };
  const store = createStore(db);
  return { records, reads, store, fingerprints: (operation, params) => {
    const spec = ACTIONS.find(action => action.name === operation);
    assert.ok(spec, 'Use a real catalog action with fake source records');
    return store.fingerprints(spec, params);
  } };
}

async function plansFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'core-source-guards-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const plans = await createPlans(directory, { now: () => Date.parse('2026-01-01T04:00:00Z') });
  let sequence = 0;
  const prepare = (params = memoParams(), operation = 'submitMemberMemo') => plans.prepare({
    operation, params, actionKey: `fake-source-guard-key-${++sequence}`,
    actorId: 'fake-owner', actorHash: 'fake-binding', sources: [],
  });
  // Production serializes claim and completion under this same shared lock.
  const locked = async callback => {
    const unlock = await plans.lock();
    try { return await callback(); }
    finally { await unlock(); }
  };
  return { directory, plans, prepare,
    claim: plan => locked(() => plans.claim(plan)),
    complete: intent => locked(() => plans.complete(intent, { saved: true })),
  };
}

test('valid memo and kiosk relationships produce fingerprints of the exact fake sources', async t => {
  for (const operation of ['submitMemberMemo', 'submitKioskCheckin']) await t.test(operation, async () => {
    const { fingerprints, records, reads } = storeFixture();
    const params = operation === 'submitMemberMemo' ? memoParams()
      : { bookingId: 'fake-booking-a', memberId: 'fake-member-a' };
    const sources = await fingerprints(operation, params);
    const expected = [['bookings', params.bookingId], ['memberProfiles', params.memberId]];
    if (operation === 'submitMemberMemo') expected.push(['lectures', params.lectureId]);
    assert.deepEqual(sources, expected.map(([collection, id]) => ({ collection, id, hash: hash(records[collection][id]) })));
    assert.deepEqual(reads, expected.map(([collection, id]) => `${collection}/${id}`));
  });
});

test('existing same-studio member cannot be substituted for the booked member', async t => {
  for (const operation of ['submitMemberMemo', 'submitKioskCheckin']) await t.test(operation, async () => {
    const { fingerprints } = storeFixture();
    await assert.rejects(() => fingerprints(operation, { ...memoParams(), memberId: 'fake-member-b' }),
      safeError('SOURCE_RELATIONSHIP'));
  });
});

test('existing same-studio lecture cannot be substituted for the booked lecture', async t => {
  for (const operation of ['submitMemberMemo', 'submitKioskCheckin']) await t.test(operation, async () => {
    const { fingerprints } = storeFixture();
    await assert.rejects(() => fingerprints(operation, { ...memoParams(), lectureId: 'fake-lecture-b' }),
      safeError('SOURCE_RELATIONSHIP'));
  });
});

test('fresh fingerprints reject a booking reassigned after the first source read', async t => {
  for (const field of ['memberId', 'lectureId']) await t.test(field, async () => {
    const { fingerprints, records } = storeFixture();
    const params = memoParams();
    await fingerprints('submitMemberMemo', params);
    records.bookings[params.bookingId][field] = field === 'memberId' ? 'fake-member-b' : 'fake-lecture-b';
    await assert.rejects(() => fingerprints('submitMemberMemo', params), safeError('SOURCE_RELATIONSHIP'));
  });
});

test('missing or cross-studio sources cannot satisfy a memo relationship', async t => {
  for (const [collection, id] of [['bookings', 'fake-booking-a'], ['memberProfiles', 'fake-member-a'],
    ['lectures', 'fake-lecture-a']]) {
    for (const condition of ['missing', 'wrong studio']) await t.test(`${collection}: ${condition}`, async () => {
      const { records, fingerprints } = storeFixture();
      if (condition === 'missing') delete records[collection][id];
      else records[collection][id].studioId = 'other-studio';
      await assert.rejects(() => fingerprints('submitMemberMemo', memoParams()),
        safeError(condition === 'missing' ? 'SOURCE_MISSING' : 'SOURCE_SCOPE'));
    });
  }
});

test('unknown canonical outcome blocks a fresh action key, even with an altered body', async t => {
  for (const change of ['new key only', 'changed content', 'added note']) await t.test(change, async t => {
    const { plans, prepare, claim } = await plansFixture(t);
    const first = await prepare();
    const intent = await claim(first);
    const params = memoParams();
    if (change === 'changed content') params.content = 'Synthetic memo B';
    if (change === 'added note') params.note = 'Synthetic optional note';
    const next = await prepare(params);
    assert.notEqual(next.actionKey, first.actionKey);
    assert.notEqual(plans.intentId(next), intent.intentId);
    await assert.rejects(() => claim(next), safeError('CANONICAL_OUTCOME_UNKNOWN'));
    assert.equal(await plans.existingIntent(plans.intentId(next)), null);
    assert.equal((await plans.receipt(intent.intentId)).status, 'outcome_unknown');
  });
});

test('unknown phone-scoped outcome remains blocked across domestic and international formatting', async t => {
  for (const phone of ['01000000000', '010 0000 0000', '+82-10-0000-0000', '+82 10 0000 0000']) {
    await t.test(phone, async t => {
      const { plans, prepare, claim } = await plansFixture(t);
      const operation = 'operatorSendPricingInquiryAlimtalk';
      const first = await prepare({ phone: '010-0000-0000' }, operation);
      const intent = await claim(first);
      const next = await prepare({ phone, note: 'Synthetic changed body' }, operation);
      await assert.rejects(() => claim(next), safeError('CANONICAL_OUTCOME_UNKNOWN'));
      assert.equal(await plans.existingIntent(plans.intentId(next)), null);
      assert.equal((await plans.receipt(intent.intentId)).status, 'outcome_unknown');
    });
  }
});

test('completed canonical scope permits changed business params under a fresh action key', async t => {
  const { plans, prepare, claim, complete } = await plansFixture(t);
  const first = await prepare();
  const firstIntent = await claim(first);
  await complete(firstIntent);
  const next = await prepare({ ...memoParams(), content: 'Synthetic memo B' });
  assert.notEqual(next.actionKey, first.actionKey);
  const nextIntent = await claim(next);
  assert.notEqual(nextIntent.intentId, firstIntent.intentId);
  assert.equal((await plans.receipt(firstIntent.intentId)).status, 'request_completed');
  assert.equal((await plans.receipt(nextIntent.intentId)).status, 'outcome_unknown');
  await complete(nextIntent);
  assert.equal((await plans.receipt(nextIntent.intentId)).status, 'request_completed');
});

test('exact completed duplicate is blocked under a fresh action key', async t => {
  const { plans, prepare, claim, complete } = await plansFixture(t);
  const first = await prepare();
  const intent = await claim(first);
  await complete(intent);
  const duplicate = await prepare();
  assert.notEqual(duplicate.actionKey, first.actionKey);
  await assert.rejects(() => claim(duplicate), safeError('CANONICAL_DUPLICATE'));
  assert.equal(await plans.existingIntent(plans.intentId(duplicate)), null);
  assert.equal((await plans.receipt(intent.intentId)).status, 'request_completed');
});

test('rejected claims leave no execution lock or replacement scope temporary files', async t => {
  const { directory, prepare, claim, complete } = await plansFixture(t);
  const first = await prepare();
  await complete(await claim(first));
  const duplicate = await prepare();
  await assert.rejects(() => claim(duplicate), safeError('CANONICAL_DUPLICATE'));
  const names = await readdir(directory);
  assert.ok(!names.includes('execution.lock'));
  assert.ok(names.every(name => /\.(plan|intent|result|scope)\.json$/.test(name)));
});

test('unknown pricing action cannot escape its canonical scope using an ignored extra identity', async t => {
  const { plans, prepare, claim } = await plansFixture(t);
  const operation = 'operatorSendPricingInquiryAlimtalk';
  const first = await prepare({ phone: '010-0000-0000' }, operation);
  await claim(first);
  const next = await prepare({ phone: '010-0000-0000', memberId: 'fake-ignored-member' }, operation);
  await assert.rejects(() => claim(next), safeError('CANONICAL_OUTCOME_UNKNOWN'));
  assert.equal(await plans.existingIntent(plans.intentId(next)), null);
});

test('completed phone action cannot become new work through formatting alone', async t => {
  const { prepare, claim, complete } = await plansFixture(t);
  const operation = 'operatorSendPricingInquiryAlimtalk';
  const first = await prepare({ phone: '010-0000-0000' }, operation);
  await complete(await claim(first));
  const duplicate = await prepare({ phone: '+82 10 0000 0000' }, operation);
  await assert.rejects(() => claim(duplicate), safeError('CANONICAL_DUPLICATE'));
});

test('completed duplicate history survives a later changed-params success (A -> B -> A)', async t => {
  const { plans, prepare, claim, complete } = await plansFixture(t);
  const first = await prepare();
  const firstIntent = await claim(first);
  await complete(firstIntent);
  const changed = await prepare({ ...memoParams(), content: 'Synthetic memo B' });
  const changedIntent = await claim(changed);
  await complete(changedIntent);
  const duplicate = await prepare();
  await assert.rejects(() => claim(duplicate), safeError('CANONICAL_DUPLICATE'));
  assert.equal(await plans.existingIntent(plans.intentId(duplicate)), null);
  assert.equal((await plans.receipt(firstIntent.intentId)).status, 'request_completed');
  assert.equal((await plans.receipt(changedIntent.intentId)).status, 'request_completed');
});
