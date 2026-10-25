import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { retainUiShareWindow, recoverUiShareIntent, releaseUiShareLocks } from '../ui-lesson-261024-recovery.mjs';
import { SITE, UNIT, assertMemberPreserved } from '../lib/imweb-staff-video-policy.mjs';
import { A261024_SHARE, B261024_SHARE, STUDENT_SHARE_SOURCES } from '../lib/imweb-student-share-policy.mjs';

// Import only the guarded module's pure exports; never invoke main or real filesystem adapters.
const sourceText = readFileSync(new URL('../ui-lesson-261024-recovery.mjs', import.meta.url), 'utf8');
const START = '2026-10-25T01:00:00.000Z';
const NOW = Date.parse(START);
const WINDOW = 960 * 3600000;
const MEMBER = 'm0001';
const OTHER = 'm0002';
const NAME = '\uC724\uC18C\uC5B8';
const copy = value => structuredClone(value);

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function fixture(source = A261024_SHARE, status = 'intent') {
  const before = { siteCode: SITE, unitCode: UNIT, uid: 'synthetic-uid', memberCode: MEMBER,
    name: NAME, callnum: '01000000001', grade: 'ordinary', group: ['synthetic-paid', 'synthetic-e-share'],
    point: 123, coupon: [{ code: 'synthetic-coupon' }] };
  const afterGroups = [...before.group, source.groupCode];
  const receipt = { status, intentAt: '2026-10-25T00:59:00.000Z', memberCode: MEMBER,
    beforeGroups: [...before.group], afterGroups: [...afterGroups], beforeGrade: before.grade,
    execution: 'native_admin_ui_user_resume_20261025',
    memberInvariantHash: createHash('sha256').update(JSON.stringify(Object.fromEntries(
      Object.entries(before).filter(([key]) => key !== 'group')))).digest('hex') };
  const ledgers = STUDENT_SHARE_SOURCES.map(registered => ({ source: registered, state: {
    accessPolicy: { id: registered.policyId, approved: true, days: 40,
      basis: 'first_verified_grant', revocation: registered.revocation },
    manualImmediateGrants: {}, entitlements: {},
  } }));
  const state = ledgers.find(item => item.source === source).state;
  state.manualImmediateGrants[MEMBER] = receipt;
  const snapshot = { name: NAME, team: source === A261024_SHARE ? 'A' : 'B',
    before, afterGroups: [...afterGroups], receipt: { ...copy(receipt), status: 'intent' } };
  return { source, before, receipt, ledgers, state, snapshot };
}

for (const source of [A261024_SHARE, B261024_SHARE]) {
  test(`${source.policyId}: first verified readback starts exactly 960 hours without mutating input`, () => {
    const f = fixture(source);
    const original = copy(f.receipt);
    const result = retainUiShareWindow(freeze(f.receipt), undefined, source, NOW);
    assert.deepEqual(f.receipt, original);
    assert.equal(result.receipt.status, 'group_verified');
    assert.equal(result.receipt.verifiedAt, START);
    assert.deepEqual(result.receipt.beforeGroups, original.beforeGroups);
    assert.deepEqual(result.receipt.afterGroups, original.afterGroups);
    assert.equal(result.entitlement.grantedAt, START);
    assert.equal(Date.parse(result.entitlement.expiresAt) - NOW, WINDOW);
    assert.equal(result.entitlement.memberCode, MEMBER);
    assert.equal(result.entitlement.policyId, source.policyId);
    assert.equal(result.entitlement.groupCode, source.groupCode);
  });

  test(`${source.policyId}: unknown retry retains the first persisted receipt and complete entitlement`, () => {
    const first = retainUiShareWindow(fixture(source).receipt, undefined, source, NOW);
    const unknown = { ...first.receipt, status: 'result_unknown' };
    const existing = { ...first.entitlement, audit: { marker: 'synthetic-original' } };
    const originalReceipt = copy(unknown), originalEntitlement = copy(existing);
    freeze(unknown); freeze(existing);
    for (const now of [NOW + 3600000, NOW + WINDOW - 1, NOW + WINDOW, NOW + WINDOW + 1]) {
      const result = retainUiShareWindow(unknown, existing, source, now);
      assert.equal(result.receipt.verifiedAt, START);
      assert.deepEqual(result.entitlement, originalEntitlement);
      assert.notEqual(result.entitlement, existing);
      assert.notEqual(result.entitlement.audit, existing.audit);
    }
    assert.deepEqual(unknown, originalReceipt);
    assert.deepEqual(existing, originalEntitlement);
  });

  test(`${source.policyId}: retained verifiedAt without an adopted entitlement never starts a new clock`, () => {
    const first = retainUiShareWindow(fixture(source).receipt, undefined, source, NOW);
    const receipt = { ...first.receipt, status: 'result_unknown' };
    const result = retainUiShareWindow(receipt, undefined, source, NOW + 3600000);
    assert.equal(result.receipt.verifiedAt, START);
    assert.deepEqual(result.entitlement, first.entitlement);
  });

  test(`${source.policyId}: conflicting or terminal existing rights are rejected without mutation`, () => {
    const first = retainUiShareWindow(fixture(source).receipt, undefined, source, NOW);
    for (const change of [{ status: 'revoked' }, { status: 'removed_externally' },
      { memberCode: OTHER }, { policyId: 'synthetic-other-policy' }, { groupCode: 'synthetic-other-group' },
      { grantedAt: new Date(NOW + 1).toISOString() },
      { expiresAt: new Date(NOW + WINDOW + 1).toISOString() }]) {
      const existing = { ...first.entitlement, ...change }, original = copy(existing);
      assert.throws(() => retainUiShareWindow(first.receipt, freeze(existing), source, NOW + 3600000));
      assert.deepEqual(existing, original);
    }
    assert.throws(() => retainUiShareWindow(fixture(source).receipt, first.entitlement, source, NOW + 3600000));
    assert.throws(() => retainUiShareWindow({ ...first.receipt, verifiedAt: '2026-10-25' }, undefined, source, NOW));
    assert.throws(() => retainUiShareWindow({ ...first.receipt, verifiedAt: new Date(NOW + 1).toISOString() }, undefined, source, NOW));
  });

  for (const status of ['intent', 'result_unknown']) {
    test(`${source.policyId}: exact saved ${status} recovers only its pending identity`, () => {
      const f = fixture(source, status), original = copy({ ledgers: f.ledgers, snapshot: f.snapshot });
      const pending = recoverUiShareIntent(freeze(f.ledgers), freeze(f.snapshot));
      assert.deepEqual(pending, { name: NAME, team: f.snapshot.team, before: f.before,
        memberCode: MEMBER, source });
      assert.deepEqual({ ledgers: f.ledgers, snapshot: f.snapshot }, original);
      assert.equal(f.receipt.status, status);
      assert.equal(Object.hasOwn(f.receipt, 'verifiedAt'), false);
      assert.deepEqual(f.state.entitlements, {});
    });
  }
}

test('recovery returns no pending identity when all receipts are already verified', () => {
  const f = fixture();
  const first = retainUiShareWindow(f.receipt, undefined, f.source, NOW);
  f.state.manualImmediateGrants[MEMBER] = first.receipt;
  f.state.entitlements[MEMBER] = first.entitlement;
  const original = copy(f.ledgers);
  assert.equal(recoverUiShareIntent(freeze(f.ledgers), null), null);
  assert.deepEqual(f.ledgers, original);
});

test('recovery rejects a missing, wrong-target, cross-team or conflicting saved snapshot', () => {
  const mutations = [
    f => { f.snapshot = null; },
    f => { f.snapshot.name = 'Synthetic Unapproved'; },
    f => { f.snapshot.team = 'B'; },
    f => { f.snapshot.before.memberCode = OTHER; },
    f => { f.receipt.memberCode = OTHER; },
    f => { f.snapshot.before.siteCode = 'synthetic-other-site'; },
    f => { f.snapshot.before.unitCode = 'synthetic-other-unit'; },
    f => { f.snapshot.before.uid = 'synthetic-other-uid'; },
    f => { f.snapshot.before.grade = 'synthetic-other-grade'; },
    f => { f.snapshot.before.group.push(f.source.groupCode); },
    f => { f.snapshot.afterGroups = [f.source.groupCode]; },
    f => { f.receipt.beforeGroups = []; },
    f => { f.receipt.afterGroups.push('synthetic-extra-right'); },
    f => { f.snapshot.receipt.intentAt = '2026-10-25T00:58:00.000Z'; },
    f => { f.receipt.execution = 'synthetic-unapproved-flow'; },
    f => { f.receipt.memberInvariantHash = 'synthetic-conflicting-hash'; },
    f => { f.receipt.status = 'synthetic-unsupported-status'; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f);
    const original = copy({ ledgers: f.ledgers, snapshot: f.snapshot });
    assert.throws(() => recoverUiShareIntent(freeze(f.ledgers), freeze(f.snapshot)));
    assert.deepEqual({ ledgers: f.ledgers, snapshot: f.snapshot }, original);
  }
});

test('another pending member or team cannot be concealed by an otherwise exact snapshot', () => {
  for (const source of STUDENT_SHARE_SOURCES) {
    const f = fixture();
    const state = f.ledgers.find(item => item.source === source).state;
    state.manualImmediateGrants[OTHER] = { ...copy(f.receipt), memberCode: OTHER, status: 'result_unknown' };
    const original = copy(f.ledgers);
    assert.throws(() => recoverUiShareIntent(freeze(f.ledgers), freeze(f.snapshot)), /unrelated_pending_share/);
    assert.deepEqual(f.ledgers, original);
  }
});

test('recovered snapshot must still match the current native member, uid and team before resuming', () => {
  const start = sourceText.indexOf('  if (recovery) {');
  const end = sourceText.indexOf('  for (const source of Object.values(sources)) {', start);
  assert.ok(start >= 0 && end > start, 'Bounded recovery identity-check source required');
  const fragment = sourceText.slice(start, end), f = fixture();
  const recovery = recoverUiShareIntent(f.ledgers, f.snapshot);
  const current = { memberCode: MEMBER, before: { ...copy(f.before), group: [...f.snapshot.afterGroups] },
    target: { name: NAME, team: 'A', source: f.source } };
  for (const change of [value => { value.memberCode = OTHER; },
    value => { value.before.uid = 'synthetic-replacement-uid'; },
    value => { value.target.team = 'B'; }]) {
    const changed = copy(current); change(changed);
    const bindings = { recovery, pending: undefined, identify: () => changed };
    assert.throws(() => runInNewContext(fragment, bindings), /pending_ui_identity_changed/);
    assert.equal(bindings.pending, undefined);
  }
  const bindings = { recovery, pending: undefined, identify: () => current };
  runInNewContext(fragment, bindings);
  assert.equal(bindings.pending.memberCode, MEMBER);
  assert.equal(bindings.pending.before, f.before);
  assert.deepEqual(bindings.pending.before.group, ['synthetic-paid', 'synthetic-e-share']);
});

test('post-save uncertainty followed by readback-only retry preserves the original persisted window', () => {
  const start = sourceText.indexOf("        if (!pending || command.name !== pending.target.name)");
  const end = sourceText.indexOf('\n      } else throw', start);
  assert.ok(start >= 0 && end > start, 'Bounded verify branch required');
  const verify = `{\n${sourceText.slice(start, end)}\n}`, f = fixture();
  let disk = copy(f.state), firstSave = true, now = NOW;
  const calls = [];
  const target = { name: NAME, team: 'A', source: f.source };
  const bindings = { pending: { target, before: f.before, memberCode: MEMBER }, command: { name: NAME },
    readPrivate: () => copy(disk), file: () => 'synthetic-state-memory-only',
    identify: () => ({ before: { ...copy(f.before), group: [...f.receipt.afterGroups] } }),
    assertMemberPreserved, retainUiShareWindow,
    imwebJson: args => {
      assert.deepEqual(Array.from(args), ['member', 'groups', 'members', f.source.groupCode]);
      calls.push(Array.from(args));
      return { data: [{ memberCode: MEMBER }] };
    },
    save: (_file, state) => {
      disk = copy(state);
      if (firstSave) { firstSave = false; throw Error('synthetic-post-rename-fsync-failure'); }
    },
    console: { log() {} },
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
  };
  assert.throws(() => runInNewContext(verify, bindings), /ui_result_requires_readback_no_repeat_write/);
  assert.ok(bindings.pending);
  assert.equal(disk.manualImmediateGrants[MEMBER].status, 'result_unknown');
  assert.equal(disk.manualImmediateGrants[MEMBER].verifiedAt, START);
  const original = copy(disk.entitlements[MEMBER]);
  const recovered = recoverUiShareIntent([{ source: f.source, state: disk }], f.snapshot);
  assert.equal(recovered.memberCode, MEMBER);
  now += 3600000;
  runInNewContext(verify, bindings);
  assert.equal(bindings.pending, undefined);
  assert.equal(disk.manualImmediateGrants[MEMBER].status, 'group_verified');
  assert.equal(disk.manualImmediateGrants[MEMBER].verifiedAt, START);
  assert.deepEqual(disk.entitlements[MEMBER], original);
  assert.equal(calls.length, 2);
});

function lockFixture(failures = []) {
  const locks = [{ lock: 'synthetic-a.lock', fd: 11 }, { lock: 'synthetic-b.lock', fd: 12 }];
  const events = [], errors = failures.map(label => Object.assign(Error(label), { code: label }));
  const record = label => { events.push(label); const error = errors.find(value => value.code === label); if (error) throw error; };
  const io = { closeSync: fd => record(`close:${fd}`), unlinkSync: file => record(`unlink:${file}`) };
  const release = async () => { record('release'); };
  return { locks, events, errors, io, release };
}
const cleanupOrder = ['close:12', 'unlink:synthetic-b.lock', 'close:11', 'unlink:synthetic-a.lock', 'release'];

test('lock cleanup releases owned lanes in reverse order and the shared lock last', async () => {
  const f = lockFixture(), original = copy(f.locks);
  await releaseUiShareLocks(freeze(f.locks), f.release, f.io);
  assert.deepEqual(f.events, cleanupOrder);
  assert.deepEqual(f.locks, original);
});

for (const failure of cleanupOrder) {
  test(`cleanup continues through ${failure} failure and reports the original error`, async () => {
    const f = lockFixture([failure]);
    await assert.rejects(releaseUiShareLocks(f.locks, f.release, f.io), error => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, f.errors);
      return true;
    });
    assert.deepEqual(f.events, cleanupOrder);
  });
}

test('multiple cleanup failures are aggregated after every lane and shared release is attempted', async () => {
  const f = lockFixture(cleanupOrder);
  await assert.rejects(releaseUiShareLocks(f.locks, f.release, f.io), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, f.errors);
    return true;
  });
  assert.deepEqual(f.events, cleanupOrder);
});

test('a lock metadata failure cannot occur before the acquired lock is registered for cleanup', async () => {
  const start = sourceText.indexOf('  for (const source of Object.values(sources)) {');
  const end = sourceText.indexOf('\n  console.log(JSON.stringify({ ready:', start);
  assert.ok(start >= 0 && end > start, 'Bounded lock-acquisition source required');
  assert.equal(sourceText.indexOf('  for (const source of Object.values(sources)) {', start + 1), -1);
  const acquisition = sourceText.slice(start, end);
  for (const failureAt of [1, 2]) {
    const locks = [], events = [];
    let acquired = 0;
    assert.throws(() => runInNewContext(acquisition, {
      sources: { A: A261024_SHARE, B: B261024_SHARE }, locks,
      file: source => `synthetic/${source.lane}/state.json`,
      path: { dirname: file => file.slice(0, file.lastIndexOf('/')), join: (...parts) => parts.join('/') },
      process: { pid: 12345 },
      fs: { openSync() { return ++acquired; }, writeSync(fd) {
        assert.equal(locks.some(item => item.fd === fd), true, 'Register immediately after acquiring');
        if (fd === failureAt) throw Error('synthetic-metadata-failure');
      } },
    }), /synthetic-metadata-failure/);
    assert.equal(locks.length, failureAt);
    await releaseUiShareLocks(locks, async () => { events.push('release'); }, {
      closeSync: fd => events.push(`close:${fd}`), unlinkSync: lock => events.push(`unlink:${lock}`),
    });
    assert.equal(events.length, failureAt * 2 + 1);
    assert.equal(events.at(-1), 'release');
  }
});

test('failure acquiring the second lock never registers or deletes the other owner lock', async () => {
  const start = sourceText.indexOf('  for (const source of Object.values(sources)) {');
  const end = sourceText.indexOf('\n  console.log(JSON.stringify({ ready:', start);
  assert.ok(start >= 0 && end > start, 'Bounded lock-acquisition source required');
  const locks = [], events = [];
  let attempts = 0;
  assert.throws(() => runInNewContext(sourceText.slice(start, end), {
    sources: { A: A261024_SHARE, B: B261024_SHARE }, locks,
    file: source => `synthetic/${source.lane}/state.json`,
    path: { dirname: file => file.slice(0, file.lastIndexOf('/')), join: (...parts) => parts.join('/') },
    process: { pid: 12345 },
    fs: { openSync() {
      if (++attempts === 2) throw Object.assign(Error('synthetic-occupied-lock'), { code: 'EEXIST' });
      return 11;
    }, writeSync() {} },
  }), /synthetic-occupied-lock/);
  assert.equal(locks.length, 1);
  assert.equal(locks[0].fd, 11);
  await releaseUiShareLocks(locks, async () => { events.push('release'); }, {
    closeSync: fd => events.push(`close:${fd}`), unlinkSync: lock => events.push(`unlink:${lock}`),
  });
  assert.deepEqual(events, ['close:11', `unlink:synthetic/${A261024_SHARE.lane}/run.lock`, 'release']);
});
