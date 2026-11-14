import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chartRepairHash as hash, repairPrivateChartMemberLink } from '../lib/private-chart-member-link-repair.mjs';

function fixture() {
  const at = '2026-11-14T09:00:00.000Z', nowMs = Date.parse(at);
  const scope = { taskId: 'synthetic', profileId: 'excel_aabb', nativeId: '123',
    recordIds: ['plc_100', 'plc_101'], auditPath: 'workLanes/synthetic/reports/source-repair' };
  const profile = { memberId: scope.profileId, studioId: '5330', name: '합성회원', phone: '01000000001', preserved: ['source'] };
  const staff = { staffId: '200', studioId: '5330', active: true, role: 'instructor', name: '합성강사' };
  const rows = new Map([[`memberProfiles/${scope.profileId}`, profile], ['staffs/200', staff]]);
  const lookupPath = `studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${scope.profileId}`;
  const lookup = { memberId: scope.profileId, studioId: '5330', memberPhone: profile.phone, memberName: profile.name,
    status: 'pending', attempts: 3, lastError: 'historical error' };
  rows.set(lookupPath, lookup);
  const bookings = [], records = [];
  for (const id of scope.recordIds) {
    const identity = { memberId: scope.profileId, staffId: '200', studioId: '5330', memberPhone: profile.phone, bookingId: id.slice(4) };
    const r = { ...identity, recordId: id, requestId: id, lessonDate: '2026-11-17', lessonStartAt: at,
      gptStatus: 'waiting_post', notionSync: { status: 'failed', error: 'identity mismatch', failedAt: at } };
    const q = { ...identity, requestId: id, status: 'pending', preStatus: 'pending', postStatus: 'pending' };
    const b = { ...identity, sourceStatus: 'booked', appStatus: 'reserved' };
    rows.set(`privateLessonChartRecords/${id}`, r); rows.set(`privateLessonChartRequests/${id}`, q); rows.set(`bookings/${id.slice(4)}`, b);
    records.push({ id, recordHash: hash(r), requestHash: hash(q), bookingHash: hash(b), hasAnswers: false, record: structuredClone(r) });
    bookings.push({ bookingId: id.slice(4), lectureDate: r.lessonDate, startAt: at, staffName: staff.name, sourceStatus: 'booked' });
  }
  const audit = { observedAt: at, priorRepairExists: false, profile: { sourceHash: hash(profile) }, staff, lookup: { sourceHash: hash(lookup) }, records,
    proof: { memberId: scope.profileId, nativeMemberId: scope.nativeId, queryKind: 'full_phone', uniqueMatchCount: 1, liveReadback: true,
      sourceKind: 'studiomate_rendered_dom', coverage: { complete: true, traversalComplete: true, atomicSnapshot: false },
      phoneSha256: createHash('sha256').update(profile.phone).digest('hex'), nameSha256: hash(profile.name), checkedAt: at, bookingCheckedAt: at, bookings },
    notionProof: { checkedAt: at, complete: true, rootActive: true, matchingFolderIds: [], peerCount: 2,
      peers: records.map(r => ({ id: r.id, sourceHash: r.recordHash, hasPage: false })),
      bindings: [{ path: 'syncStates/binding', exists: false }, { path: 'syncStates/title', exists: false }] } };
  const writes = [], doc = path => ({ path, id: path.split('/').at(-1) });
  const snap = ref => ({ ref, id: ref.id, exists: rows.has(ref.path), data: () => rows.get(ref.path) });
  const db = { doc, collection: collection => ({ where: (key, _op, value) => ({ limit: limit => ({ collection, key, value, limit }) }) }),
    runTransaction: async fn => {
      const pending = [];
      const result = await fn({ get: async ref => ref.path ? snap(ref) : (() => {
        const docs = [...rows].filter(([p, v]) => p.startsWith(ref.collection + '/') && v[ref.key] === ref.value)
          .slice(0, ref.limit).map(([p]) => snap(doc(p)));
        return { size: docs.length, docs };
      })(), update: (ref, value) => pending.push([ref.path, value]), set: (ref, value) => pending.push([ref.path, value]),
      create: (ref, value) => { assert.ok(!rows.has(ref.path)); pending.push([ref.path, value]); } });
      for (const [p, v] of pending) { rows.set(p, { ...rows.get(p), ...v }); writes.push(p); }
      return result;
    } };
  return { rows, writes, audit, scope, profile, lookupPath, nowMs, run: (now = () => nowMs) => repairPrivateChartMemberLink({ db, scope, audit, now }) };
}

test('scope repair links only existing profile, preserves charts/requests/bookings and old lookup evidence', async () => {
  const h = fixture(), before = structuredClone(h.rows);
  assert.equal((await h.run()).outcome, 'linked');
  assert.equal(h.writes.length, 3);
  assert.equal(h.rows.get(`memberProfiles/${h.scope.profileId}`).studiomateMemberId, h.scope.nativeId);
  assert.equal(h.rows.has(`memberProfiles/${h.scope.nativeId}`), false);
  for (const [p, r] of before) if (/privateLessonChart|bookings\//.test(p)) assert.deepEqual(h.rows.get(p), r);
  assert.equal(h.rows.get(h.lookupPath).attempts, 3);
  assert.equal(h.rows.get(h.scope.auditPath).lookupBefore.lastError, 'historical error');
  const count = h.writes.length;
  await assert.rejects(h.run(), /Prior repair/);
  assert.equal(h.writes.length, count);
});

for (const [label, mutate] of [
  ['stale proof', h => h.audit.proof.checkedAt = '2026-11-14T08:00:00Z'],
  ['partial native traversal', h => h.audit.proof.coverage.complete = false],
  ['ambiguous native', h => h.audit.proof.uniqueMatchCount = 2],
  ['snapshot instead of live', h => h.audit.proof.sourceKind = 'snapshot'],
  ['existing folder', h => h.audit.notionProof.matchingFolderIds.push('folder')],
  ['uncertain parent', h => h.audit.notionProof.bindings[0].exists = true],
  ['new source binding', h => h.rows.set('syncStates/binding', { status: 'creating' })],
  ['changed source', h => h.rows.get('privateLessonChartRequests/plc_100').memberId = 'other'],
  ['submitted chart', h => h.rows.get('privateLessonChartRecords/plc_100').postSubmittedAt = 'now'],
  ['cancelled request', h => h.rows.get('privateLessonChartRequests/plc_100').status = 'cancelled'],
  ['unknown transport', h => h.rows.get('privateLessonChartRecords/plc_100').notionSync.creationTitle = 'uncertain'],
  ['active lookup', h => h.rows.get(h.lookupPath).status = 'processing'],
  ['duplicate profile', h => h.rows.set('memberProfiles/other', { ...h.profile })],
  ['native owner', h => h.rows.set('memberProfiles/other', { studiomateMemberId: h.scope.nativeId })],
  ['extra peer', h => h.rows.set('privateLessonChartRecords/plc_102', { memberId: h.scope.profileId })],
]) test(`${label} blocks all mutations`, async () => {
  const h = fixture(); mutate(h); await assert.rejects(h.run()); assert.equal(h.writes.length, 0);
});

test('freshness is rechecked inside transaction after asynchronous source reads', async () => {
  const h = fixture(); let calls = 0;
  await assert.rejects(h.run(() => ++calls >= 9 ? h.nowMs + 11 * 60000 : h.nowMs), /Fresh live proof/);
  assert.equal(h.writes.length, 0);
});
