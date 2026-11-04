import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { recoverVerifiedChartMemberLink, RECOVERY_PROFILE, RECOVERY_NATIVE_ID } from '../lib/ops-health-member-link.mjs';

const at = '2026-11-04T10:00:00Z', nowMs = Date.parse(at);
const profilePath = `memberProfiles/${RECOVERY_PROFILE}`;
const lookupPath = `studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${RECOVERY_PROFILE}`;
const profile = { memberId: RECOVERY_PROFILE, studioId: '5330', name: '합성회원', phone: '01000000001',
  activeTickets: [{ name: 'preserved' }], sourceField: 'untouched', updatedAt: 'original' };
const proof = { memberId: RECOVERY_PROFILE, nativeMemberId: RECOVERY_NATIVE_ID, memberName: profile.name,
  phoneSha256: createHash('sha256').update(profile.phone).digest('hex'), checkedAt: at, queryKind: 'full_phone',
  sourceKind: 'studiomate_rendered_dom', liveReadback: true, uniqueMatchCount: 1 };

function fixture({ now = () => nowMs } = {}) {
  const rows = new Map([[profilePath, structuredClone(profile)]]), writes = [];
  const doc = path => ({ path, id: path.split('/').at(-1) });
  const snap = ref => ({ ...ref, exists: rows.has(ref.path), data: () => rows.get(ref.path) });
  const db = { doc, collection: collection => ({ where: (field, _op, value) => ({
    limit: n => ({ collection, field, value, n }),
  }) }), runTransaction: async fn => {
    const pending = [];
    const result = await fn({ get: async ref => {
      if (ref.path) return snap(ref);
      const docs = [...rows].filter(([path, value]) => path.startsWith(ref.collection + '/') && value[ref.field] === ref.value)
        .slice(0, ref.n).map(([path]) => snap(doc(path)));
      return { size: docs.length, docs };
    }, update: (ref, data) => pending.push([ref.path, data]),
    set: (ref, data) => pending.push([ref.path, data]), create: (ref, data) => {
      assert.equal(rows.has(ref.path), false); pending.push([ref.path, data]);
    } });
    for (const [path, data] of pending) { rows.set(path, { ...rows.get(path), ...data }); writes.push(path); }
    return result;
  } };
  return { rows, writes, db, run: (p = proof) => recoverVerifiedChartMemberLink({ db, proof: p, resolvedAt: at, now }) };
}

test('atomic link preserves all source fields and creates no native profile', async () => {
  const h = fixture();
  assert.deepEqual(await h.run(), { status: 'linked' });
  const linked = h.rows.get(profilePath), { studiomateMemberId, studiomateMemberIdResolvedAt, ...original } = linked;
  assert.deepEqual(original, profile);
  assert.equal(studiomateMemberId, RECOVERY_NATIVE_ID);
  assert.equal(studiomateMemberIdResolvedAt, at);
  assert.equal(h.rows.has(`memberProfiles/${RECOVERY_NATIVE_ID}`), false);
  assert.equal(h.writes.length, 3);
  assert.equal(h.rows.get(lookupPath).status, 'done');
  assert.deepEqual(await h.run(), { status: 'already_linked' });
  assert.equal(h.writes.length, 3);
});

for (const patch of [{ nativeMemberId: '999' }, { memberId: 'excel_other' }, { liveReadback: false },
  { uniqueMatchCount: 2 }, { queryKind: 'name' }, { checkedAt: '2026-11-04T09:49:59Z' },
  { checkedAt: '2026-11-04T10:00:01Z' }, { sourceKind: 'snapshot' }]) {
  test(`invalid proof is rejected before writes: ${JSON.stringify(patch)}`, async () => {
    const h = fixture(); await assert.rejects(h.run({ ...proof, ...patch }), /live_proof/); assert.equal(h.writes.length, 0);
  });
}

test('changed identity, duplicate source, native profile and unknown prior work fail closed', async () => {
  for (const mutate of [
    h => h.rows.get(profilePath).name = 'changed', h => h.rows.get(profilePath).phone = '01000000002',
    h => h.rows.get(profilePath).status = 'merged',
    h => h.rows.set('memberProfiles/duplicate', { ...profile }),
    h => h.rows.set(`memberProfiles/${RECOVERY_NATIVE_ID}`, { ...profile }),
    h => h.rows.set(lookupPath, { status: 'processing' }),
    h => h.rows.set(lookupPath, { status: 'done' }),
    h => h.rows.set('memberProfiles/other', { studiomateMemberId: RECOVERY_NATIVE_ID }),
  ]) {
    const h = fixture(); mutate(h); await assert.rejects(h.run(), /member_link/); assert.equal(h.writes.length, 0);
  }
});

test('an inconsistent prior audit can never be replayed', async () => {
  const h = fixture(); await h.run(); h.rows.get(lookupPath).resolvedAt = 'different';
  await assert.rejects(h.run(), /prior_outcome/); assert.equal(h.writes.length, 3);
});

test('freshness is rechecked at transaction entry and after asynchronous reads', async () => {
  for (const expiresOnCall of [2, 3]) {
    let calls = 0;
    const h = fixture({ now: () => ++calls >= expiresOnCall ? nowMs + 31000 : nowMs });
    await assert.rejects(h.run(), /live_proof/);
    assert.equal(h.writes.length, 0);
  }
});

test('prior success requires consistent audit, lookup receipt and unique native ownership', async () => {
  const auditPath = 'workLanes/ops-monitor-accuracy-20261104/reports/member-link-5095448';
  for (const mutate of [
    h => h.rows.get(lookupPath).studioId = 'other',
    h => h.rows.get(auditPath).outcome = 'unknown',
    h => h.rows.get(auditPath).studiomateMemberId = 'other',
    h => h.rows.get(auditPath).resolvedAt = 'different',
    h => h.rows.get(auditPath).sourceCheckedAt = 'different',
    h => h.rows.get(lookupPath).verification.liveReadback = false,
    h => h.rows.set('memberProfiles/duplicate', { ...profile }),
    h => h.rows.set('memberProfiles/other', { studiomateMemberId: RECOVERY_NATIVE_ID }),
    h => h.rows.set(`memberProfiles/${RECOVERY_NATIVE_ID}`, { ...profile }),
  ]) {
    const h = fixture(); await h.run(); mutate(h);
    await assert.rejects(h.run(), /prior_outcome/);
    assert.equal(h.writes.length, 3);
  }
});
