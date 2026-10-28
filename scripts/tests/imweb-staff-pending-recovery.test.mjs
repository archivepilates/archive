import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reconcilePendingStaffWrite, staffPendingDigest } from '../lib/imweb-staff-video-sync.mjs';
import { SITE, UNIT, STAFF_GRADE, STAFF_GROUP } from '../lib/imweb-staff-video-policy.mjs';
import { reconcileStaffPending } from '../reconcile-imweb-staff-pending.mjs';

const NOW = Date.parse('2026-10-29T01:30:00.000Z');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Match the production top-level key sort exactly; nested JSON is not canonicalized.
const metadataHash = member => hash(Object.fromEntries(Object.entries(member)
  .filter(([key]) => key !== 'group').sort(([a], [b]) => a.localeCompare(b))));
const sorted = values => [...values].sort();

function fixture() {
  const member = { siteCode: SITE, unitCode: UNIT, memberCode: 'm0001', uid: 'synthetic-staff',
    grade: STAFF_GRADE, group: ['baseline', 'purchased', STAFF_GROUP, 'video-old'], point: 1200,
    coupon: [{ code: 'synthetic-coupon', usable: true }], metadata: { consent: false, tags: ['keep'], note: null } };
  const entry = { memberCode: member.memberCode, uid: member.uid, baselineGroups: ['baseline', 'purchased'],
    ownedAddedGroups: [STAFF_GROUP, 'video-old'], firstObservedAt: '2026-10-20T00:00:00.000Z',
    lastVerifiedAt: '2026-10-27T00:00:00.000Z', status: 'staff_active', pending: {
      status: 'result_unknown', at: '2026-10-28T03:00:00.000Z', memberHash: metadataHash(member),
      beforeGroups: sorted(member.group), afterGroups: sorted([...member.group, 'video-new']),
      nextManagedGroups: sorted([STAFF_GROUP, 'video-old', 'video-new']),
      lastErrorCode: 'SYNTHETIC_UNKNOWN', originalEvidenceRef: 'synthetic-original-attempt',
    } };
  const approval = { memberCode: member.memberCode, pendingDigest: staffPendingDigest(entry.pending),
    approvalRef: 'human:staff-recovery-20261029:synthetic' };
  const f = { entry, member, approval, catalog: ['video-old', 'video-new'], now: NOW };
  f.reapprove = () => { f.approval.pendingDigest = staffPendingDigest(f.entry.pending); };
  f.run = () => reconcilePendingStaffWrite(f.entry, f.member, f.catalog, f.approval, f.now);
  f.args = (apply = false) => [`--member-code=${f.approval.memberCode}`, `--pending-digest=${f.approval.pendingDigest}`,
    `--approval-ref=${f.approval.approvalRef}`, ...(apply ? ['--apply'] : [])];
  return f;
}

function unchangedOnFailure(f) {
  const before = structuredClone({ entry: f.entry, member: f.member, catalog: f.catalog, approval: f.approval });
  assert.throws(f.run);
  assert.deepEqual({ entry: f.entry, member: f.member, catalog: f.catalog, approval: f.approval }, before);
}

test('pending digest hashes the complete exact saved JSON, including original unknown evidence', () => {
  const f = fixture();
  assert.equal(staffPendingDigest(f.entry.pending), hash(f.entry.pending));
  const changed = structuredClone(f.entry.pending); changed.originalEvidenceRef = 'other-attempt';
  assert.notEqual(staffPendingDigest(changed), f.approval.pendingDigest);
});

test('exact current absence is archived without claiming non-dispatch, granting access or changing ownership', () => {
  const f = fixture(), before = structuredClone({ entry: f.entry, member: f.member, catalog: f.catalog, approval: f.approval });
  f.run();
  assert.equal(f.entry.pending, undefined);
  assert.equal(f.entry.reconciledWrites.length, 1);
  const archived = f.entry.reconciledWrites[0];
  assert.deepEqual(archived.pending, before.entry.pending);
  assert.equal(archived.pending.status, 'result_unknown');
  assert.equal(archived.dispatchOutcome, 'unknown');
  assert.equal(archived.outcome, 'not_present_on_independent_readback');
  assert.equal(archived.approvalRef, before.approval.approvalRef);
  assert.equal(archived.reconciledAt, new Date(NOW).toISOString());
  const { pending, ...priorEntry } = before.entry;
  const { reconciledWrites, ...resultEntry } = f.entry;
  assert.deepEqual(resultEntry, priorEntry);
  assert.deepEqual(f.member, before.member);
  assert.deepEqual(f.catalog, before.catalog);
  assert.deepEqual(f.approval, before.approval);
  f.member.group.push('later-independent-change');
  assert.deepEqual(archived.pending, before.entry.pending, 'Archive must be an independent copy');
});

test('metadata hash ignores group order and top-level property order, but not metadata changes', () => {
  const f = fixture();
  f.member = Object.fromEntries(Object.entries(f.member).reverse()); f.member.group.reverse();
  assert.equal(metadataHash(f.member), f.entry.pending.memberHash);
  f.run(); assert.equal(f.entry.reconciledWrites.length, 1);
  for (const mutate of [member => { member.point++; }, member => { member.coupon[0].usable = false; },
    member => { member.metadata.tags.push('changed'); }, member => { member.metadata.consent = true; }]) {
    const changed = fixture(); mutate(changed.member); unchangedOnFailure(changed);
  }
});

test('stale pending digest and approval for another member fail without archiving', () => {
  for (const mutate of [f => { f.approval.pendingDigest = '0'.repeat(64); },
    f => { f.entry.pending.at = '2026-10-28T03:00:01.000Z'; },
    f => { f.entry.pending.originalEvidenceRef = 'newer-pending'; },
    f => { f.approval.memberCode = 'm0002'; }]) {
    const f = fixture(); mutate(f); unchangedOnFailure(f);
  }
});

test('missing or malformed explicit operator approval is rejected', () => {
  for (const approvalRef of ['', undefined, 'not approved', 'https://example.test/approval', '_invalid']) {
    const f = fixture(); f.approval.approvalRef = approvalRef; unchangedOnFailure(f);
  }
  const f = fixture(); f.approval = null; unchangedOnFailure(f);
});

test('wrong native staff grade, site, unit, member identity or ledger identity fails closed', () => {
  for (const mutate of [f => { f.member.grade = 'ordinary'; }, f => { f.member.siteCode = 'other-site'; },
    f => { f.member.unitCode = 'other-unit'; }, f => { f.member.memberCode = 'm0002'; },
    f => { f.member.uid = 'other-uid'; }, f => { f.entry.memberCode = 'm0002'; }, f => { f.entry.uid = 'other-uid'; }]) {
    const f = fixture(); mutate(f);
    f.entry.pending.memberHash = metadataHash(f.member); f.reapprove();
    unchangedOnFailure(f);
  }
});

test('current after-state, partial state or unrelated group changes cannot be treated as before-state absence', () => {
  for (const groups of [f => f.entry.pending.afterGroups, f => [...f.member.group, 'unrelated-permission'],
    f => f.member.group.filter(code => code !== 'purchased')]) {
    const f = fixture(); f.member.group = [...groups(f)]; unchangedOnFailure(f);
  }
});

test('recovery permits only strict catalog additions with exact next-managed ownership', () => {
  for (const mutate of [
    f => { f.entry.pending.afterGroups = f.entry.pending.afterGroups.filter(code => code !== 'purchased'); },
    f => { f.entry.pending.afterGroups.push('outside-catalog'); f.entry.pending.nextManagedGroups.push('outside-catalog'); },
    f => { f.entry.pending.afterGroups.push('video-new'); },
    f => { f.entry.pending.afterGroups = [...f.entry.pending.beforeGroups]; },
    f => { f.entry.pending.nextManagedGroups = ['video-new']; },
    f => { f.entry.pending.nextManagedGroups.push('baseline'); },
  ]) { const f = fixture(); mutate(f); f.reapprove(); unchangedOnFailure(f); }
});

test('baseline and worker ownership overlap is rejected before pending is archived', () => {
  const f = fixture(); f.entry.baselineGroups.push('video-old'); unchangedOnFailure(f);
});

test('non-unknown pending states cannot use the operator unknown-result exception', () => {
  for (const status of ['intent', 'blocked_before_dispatch', 'verified', 'not_dispatched']) {
    const f = fixture(); f.entry.pending.status = status; f.reapprove(); unchangedOnFailure(f);
  }
});

test('existing archive history is preserved and an immediate duplicate cannot reconcile twice', () => {
  const f = fixture(); const previous = { pending: { status: 'result_unknown', at: 'synthetic-old' }, approvalRef: 'human:previous' };
  f.entry.reconciledWrites = [structuredClone(previous)]; f.run();
  assert.deepEqual(f.entry.reconciledWrites[0], previous);
  const entry = structuredClone(f.entry);
  assert.throws(f.run); assert.deepEqual(f.entry, entry);
});

test('restoring an archived pending cannot replay the same digest and human approval', () => {
  const f = fixture(), original = structuredClone(f.entry.pending); f.run();
  f.entry.pending = original; unchangedOnFailure(f);
});

test('operator wrapper defaults to preview and forwards only exact approved member/digest/reference', async () => {
  for (const apply of [false, true]) {
    const f = fixture(), calls = [], result = { ok: true, mode: apply ? 'apply' : 'dry_run' };
    const actual = await reconcileStaffPending(f.args(apply), { run: async options => { calls.push(options); return result; } });
    assert.equal(actual, result); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { apply, onlyMemberCode: f.member.memberCode, reconcilePending: f.approval });
  }
});

test('operator wrapper rejects missing, duplicate, contradictory and extra options before running', async () => {
  const f = fixture(); let calls = 0;
  for (const args of [[], f.args().slice(0, 2), [...f.args(), '--apply', '--apply'],
    [...f.args(), '--member-code=m0002'], [...f.args(), '--unapproved'],
    f.args().map(arg => arg.startsWith('--pending-digest=') ? '--pending-digest=invalid' : arg),
    f.args().map(arg => arg.startsWith('--member-code=') ? '--member-code=excel_1' : arg),
    f.args().map(arg => arg.startsWith('--approval-ref=') ? '--approval-ref=has spaces' : arg)]) {
    await assert.rejects(() => reconcileStaffPending(args, { run: () => { calls++; } }));
  }
  assert.equal(calls, 0);
});

test('operator wrapper propagates failed reconciliation once without retry or implicit success', async () => {
  const f = fixture(); let calls = 0;
  const error = Object.assign(Error('Synthetic readback mismatch'), { code: 'SYNTHETIC_RECONCILIATION_FAILED' });
  await assert.rejects(() => reconcileStaffPending(f.args(true), { run: async () => { calls++; throw error; } }), value => value === error);
  assert.equal(calls, 1);
  const stale = fixture(); stale.approval.pendingDigest = '0'.repeat(64);
  await assert.rejects(() => reconcileStaffPending(stale.args(true), { run: options => {
    assert.equal(options.apply, true); assert.equal(options.onlyMemberCode, stale.member.memberCode);
    reconcilePendingStaffWrite(stale.entry, stale.member, stale.catalog, options.reconcilePending, stale.now);
  } }));
  assert.equal(stale.entry.pending.status, 'result_unknown');
  assert.equal(stale.entry.reconciledWrites, undefined);
});
