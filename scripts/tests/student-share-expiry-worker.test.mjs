import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EXPIRY_WORKER_POLICY, expiryPlan, runExpiryWorker } from '../lib/student-share-expiry-worker.mjs';
import { STUDENT_SHARE_SOURCES, STUDENT_SHARE_WINDOW_MS, validatedShareEntries } from '../lib/imweb-student-share-policy.mjs';
import { SITE, UNIT } from '../lib/imweb-staff-video-policy.mjs';

const HOUR = 3600000;
const START = '2026-10-25T01:16:33.501Z';
const START_MS = Date.parse(START);
const END_MS = START_MS + 960 * HOUR;
const END = new Date(END_MS).toISOString();
const MEMBER = 'm001';
const iso = time => new Date(time).toISOString();

// Match the policy tests' verified, preserving absent-to-present grant evidence.
function ledger(source, { start = START_MS, status = 'active', revocation, adopted = true } = {}) {
  const entry = { memberCode: MEMBER, policyId: source.policyId, groupCode: source.groupCode,
    grantedAt: iso(start), expiresAt: iso(start + STUDENT_SHARE_WINDOW_MS), status,
    grantEvidence: 'manualImmediateGrants:first_verified_transition' };
  if (revocation !== undefined) entry.revocation = { status: revocation };
  return { siteCode: SITE, unitCode: UNIT,
    accessPolicy: { id: source.policyId, approved: true, days: 40,
      basis: 'first_verified_grant', revocation: source.revocation },
    manualImmediateGrants: { [MEMBER]: { status: 'group_verified',
      beforeGroups: ['synthetic-paid'], afterGroups: ['synthetic-paid', source.groupCode],
      existingGroupsPreserved: true, verifiedAt: iso(start) } },
    entitlements: adopted ? { [MEMBER]: entry } : {} };
}

const ledgers = () => STUDENT_SHARE_SOURCES.map(source => ({ source, state: ledger(source) }));
// Preserve the canonical registry object identities required by expiryPlan.
const copyLedgers = rows => rows.map(({ source, state }) => ({ source, state: structuredClone(state) }));
const results = (actions = []) => STUDENT_SHARE_SOURCES.map((source, index) => ({
  ok: true, source: source.policyId, mode: 'apply', outcomes: actions[index] ? [{ action: actions[index] }] : [],
}));
function terminal(rows) {
  const after = copyLedgers(rows);
  for (const { state } of after) Object.assign(state.entitlements[MEMBER], {
    status: 'revoked', revocation: { status: 'verified' },
  });
  return after;
}

function fixture(t, { clock = END_MS, config = {}, rows = ledgers() } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'student-share-expiry-test-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'state.json');
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value), { mode: 0o600 });
  write('config.json', { policy: EXPIRY_WORKER_POLICY, approved: true, sourceAutomationId: 'e-2', enabled: true, ...config });
  const f = { directory, stateFile, clock, rows, held: false, releases: 0,
    events: [], executions: [], notices: [],
    readState: () => JSON.parse(fs.readFileSync(stateFile, 'utf8')),
    writeState: state => write('state.json', state) };
  f.run = (options = {}) => runExpiryWorker({ apply: true, directory, now: () => f.clock,
    readLedgers: () => {
      assert.equal(f.held, true);
      f.events.push('read');
      return f.read ? f.read() : copyLedgers(f.rows);
    },
    execute: async input => {
      assert.equal(f.held, true);
      f.events.push('execute');
      f.executions.push(structuredClone(input));
      assert.ok(f.execute, 'Unexpected execution: all remote operations must be injected');
      return f.execute(input);
    },
    notify: async event => {
      assert.equal(f.held, true);
      f.events.push('notify');
      f.notices.push(structuredClone(event));
      return f.notify ? f.notify(event) : { messageId: 'synthetic-notice' };
    },
    acquire: async options => {
      assert.deepEqual(options, { lockPath: path.join(directory, 'worker.lock'),
        owner: 'student-share-expiry-worker', waitMs: 0, staleMs: HOUR });
      assert.equal(f.held, false);
      f.held = true;
      f.events.push('acquire');
      return async () => {
        assert.equal(f.held, true);
        f.held = false;
        f.releases++;
        f.events.push('release');
      };
    }, ...options });
  return f;
}

function noRemoteCalls(f) {
  assert.deepEqual(f.executions, []);
  assert.deepEqual(f.notices, []);
}

test('expiryPlan accepts all five canonical sources, independently validates fixtures and is order-independent', () => {
  const rows = ledgers(), before = copyLedgers(rows);
  assert.equal(rows.length, 5);
  for (const { source, state } of rows) assert.equal(validatedShareEntries(state, source, END_MS).get(MEMBER).adopted, true);
  const plan = expiryPlan(rows, END_MS);
  assert.equal(plan.status, 'due');
  assert.equal(plan.active, 5);
  assert.equal(plan.due, 5);
  assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(expiryPlan([...rows].reverse(), END_MS), plan);
  assert.deepEqual(rows, before);
});

test('expiryPlan rejects missing, extra, duplicate, cloned and wrong sources', () => {
  for (const invalid of [undefined, null, {}, [], ledgers().slice(1), [...ledgers(), ledgers()[0]],
    ledgers().map((row, index, rows) => index === 4 ? rows[0] : row),
    ledgers().map((row, index) => index === 4 ? { ...row, source: { ...row.source } } : row),
    ledgers().map((row, index) => index === 4 ? { ...row, source: { policyId: 'synthetic-unknown' } } : row)]) {
    assert.throws(() => expiryPlan(invalid, END_MS), /INVALID_EXPIRY_SOURCE_SET/);
  }
});

test('expiryPlan rejects non-finite and nonnumeric clocks', () => {
  for (const now of [NaN, Infinity, -Infinity, undefined, null, String(END_MS)]) {
    assert.throws(() => expiryPlan(ledgers(), now), /INVALID_EXPIRY_SOURCE_SET/);
  }
});

for (const [index, source] of STUDENT_SHARE_SOURCES.entries()) {
  test(`expiryPlan validates policy, source identity and grant evidence for ${source.policyId}`, () => {
    for (const mutate of [
      state => { state.accessPolicy.approved = false; },
      state => { state.accessPolicy.days = 39; },
      state => { state.accessPolicy.id = 'synthetic-wrong-policy'; },
      state => { state.accessPolicy.revocation = 'all_groups'; },
      state => { state.siteCode = 'synthetic-wrong-site'; },
      state => { state.unitCode = 'synthetic-wrong-unit'; },
      state => { state.entitlements[MEMBER].groupCode = 'synthetic-wrong-group'; },
      state => { state.entitlements[MEMBER].memberCode = 'm002'; },
      state => { state.manualImmediateGrants[MEMBER].existingGroupsPreserved = false; },
    ]) {
      const rows = ledgers(); mutate(rows[index].state);
      assert.throws(() => expiryPlan(rows, END_MS), /Student-share evidence/);
    }
  });

  test(`expiryPlan preserves the original 960-hour clock for ${source.policyId}`, () => {
    const rows = ledgers();
    rows[index].state = ledger(source, { start: START_MS + HOUR });
    const before = copyLedgers(rows);
    for (const now of [START_MS + HOUR, END_MS, END_MS + HOUR, END_MS + 24 * HOUR]) {
      expiryPlan(rows, now);
      const entry = validatedShareEntries(rows[index].state, source, now).get(MEMBER);
      assert.equal(entry.grantedAt, iso(START_MS + HOUR));
      assert.equal(entry.expiresAt, iso(END_MS + HOUR));
      assert.equal(Date.parse(entry.expiresAt) - Date.parse(entry.grantedAt), 960 * HOUR);
    }
    assert.deepEqual(rows, before);
    for (const delta of [-1, 1]) {
      const invalid = copyLedgers(rows);
      invalid[index].state.entitlements[MEMBER].expiresAt = iso(END_MS + HOUR + delta);
      assert.throws(() => expiryPlan(invalid, END_MS), /Student-share evidence/);
    }
  });
}

test('expiryPlan is not_due before the earliest expiry and due at the exact equality boundary', () => {
  const rows = ledgers();
  rows[0].state = ledger(rows[0].source, { start: START_MS + HOUR });
  const before = copyLedgers(rows);
  assert.equal(expiryPlan(rows, END_MS - 1).status, 'not_due');
  assert.equal(expiryPlan(rows, END_MS - 1).due, 0);
  assert.equal(expiryPlan(rows, END_MS - 1).nextExpiryAt, END);
  const boundary = expiryPlan(rows, END_MS);
  assert.equal(boundary.status, 'due');
  assert.equal(boundary.due, 4);
  assert.equal(boundary.nextExpiryAt, iso(END_MS + HOUR));
  assert.equal(expiryPlan(rows, END_MS + HOUR).due, 5);
  assert.equal(expiryPlan(rows, END_MS + HOUR).nextExpiryAt, null);
  assert.deepEqual(rows, before);
});

test('expiryPlan completes terminal and empty ledgers without resurrecting grants', () => {
  const ended = terminal(ledgers());
  ended[0].state.entitlements[MEMBER].status = 'removed_externally';
  const empty = ledgers();
  for (const { state } of empty) { state.manualImmediateGrants = {}; state.entitlements = {}; }
  for (const rows of [ended, empty]) {
    const plan = expiryPlan(rows, END_MS);
    assert.equal(plan.status, 'complete');
    assert.equal(plan.active, 0);
    assert.equal(plan.due, 0);
    assert.equal(plan.nextExpiryAt, null);
  }
});

for (const status of ['intent', 'result_unknown']) {
  test(`expiryPlan blocks ${status} before and after expiry, even during backoff`, () => {
    for (const now of [END_MS - 1, END_MS, END_MS + 1]) {
      const rows = ledgers();
      rows[4].state.entitlements[MEMBER].revocation = { status };
      const plan = expiryPlan(rows, now);
      assert.equal(plan.status, 'blocked_unknown_result');
      assert.equal(expiryPlan(rows, now, { fingerprint: plan.fingerprint, nextReviewAt: iso(now + HOUR) }).status,
        'blocked_unknown_result');
    }
  });
}

test('expiryPlan rejects grant-only unadopted evidence in every source without changing it', () => {
  for (const [index, source] of STUDENT_SHARE_SOURCES.entries()) {
    const rows = ledgers(); rows[index].state = ledger(source, { adopted: false });
    const before = copyLedgers(rows);
    for (const now of [END_MS - 1, END_MS]) {
      assert.throws(() => expiryPlan(rows, now), /UNADOPTED_GRANT_REQUIRES_REVIEW/);
    }
    assert.deepEqual(rows, before);
  }
});

test('expiryPlan backoff requires an unchanged fingerprint and ends at equality', () => {
  const rows = ledgers(), plan = expiryPlan(rows, END_MS);
  const previous = { fingerprint: plan.fingerprint, nextReviewAt: iso(END_MS + HOUR) };
  assert.equal(expiryPlan(rows, END_MS, previous).status, 'backoff');
  assert.equal(expiryPlan(rows, END_MS + HOUR, previous).status, 'due');
  rows[0].state.entitlements[MEMBER].status = 'revoked';
  assert.equal(expiryPlan(rows, END_MS, previous).status, 'due');
});

test('runExpiryWorker makes no remote calls before due and saves only a private checkpoint', async t => {
  const f = fixture(t, { clock: END_MS - 1 });
  const original = copyLedgers(f.rows);
  const result = await f.run();
  assert.equal(result.status, 'not_due');
  assert.equal(result.remoteCalls, 0);
  noRemoteCalls(f);
  assert.deepEqual(f.events, ['acquire', 'read', 'release']);
  assert.equal(f.readState().nextExpiryAt, END);
  assert.equal(fs.statSync(f.stateFile).mode & 0o777, 0o600);
  assert.deepEqual(f.rows, original);
  assert.equal(f.held, false);
});

test('runExpiryWorker disabled config avoids even acquiring a lock or reading ledgers', async t => {
  const f = fixture(t, { config: { enabled: false } });
  assert.deepEqual(await f.run(), { ok: true, status: 'disabled', remoteCalls: 0 });
  assert.deepEqual(f.events, []);
  noRemoteCalls(f);
  assert.equal(fs.existsSync(f.stateFile), false);
});

test('runExpiryWorker without --apply remains read-only even when due', async t => {
  const f = fixture(t);
  const result = await f.run({ apply: false });
  assert.equal(result.status, 'due');
  assert.equal(result.mode, 'read_only');
  assert.equal(result.remoteCalls, 0);
  noRemoteCalls(f);
  assert.equal(fs.existsSync(f.stateFile), false);
  assert.deepEqual(f.events, ['acquire', 'read', 'release']);
});

test('runExpiryWorker rejects unapproved policy or a source other than approved e-2 before all hooks', async t => {
  for (const config of [{ approved: false }, { approved: 'true' },
    { policy: 'synthetic-policy' }, { sourceAutomationId: 'e-3' }]) {
    const f = fixture(t, { config });
    await assert.rejects(f.run(), /EXPIRY_ACTIVATION_UNVERIFIED/);
    assert.deepEqual(f.events, []);
    noRemoteCalls(f);
  }
});

test('runExpiryWorker due invokes exactly --apply, then validates a fresh five-source reread', async t => {
  const f = fixture(t);
  const original = copyLedgers(f.rows);
  f.execute = () => {
    f.rows = terminal(f.rows);
    return results(['remove_group_only', 'reconcile_absent_unknown', 'already_absent', 'staff_access_preserved', 'terminal']);
  };
  const result = await f.run();
  assert.deepEqual(f.executions, [{ args: ['--apply'] }]);
  assert.deepEqual(f.events, ['acquire', 'read', 'execute', 'read', 'release']);
  assert.deepEqual(result, { ok: true, status: 'processed', active: 0, due: 0, removed: 3, nextExpiryAt: null });
  assert.equal(f.notices.length, 0);
  const checkpoint = f.readState();
  assert.equal(checkpoint.fingerprint, expiryPlan(f.rows, f.clock).fingerprint);
  assert.equal(checkpoint.lastRunAt, END);
  assert.equal(checkpoint.nextReviewAt, null);
  assert.equal(checkpoint.lastErrorKey, null);
  for (const [index, { state }] of f.rows.entries()) {
    assert.equal(state.entitlements[MEMBER].grantedAt, original[index].state.entitlements[MEMBER].grantedAt);
    assert.equal(state.entitlements[MEMBER].expiresAt, original[index].state.entitlements[MEMBER].expiresAt);
    assert.deepEqual(state.manualImmediateGrants, original[index].state.manualImmediateGrants);
  }
  assert.equal((await f.run()).status, 'complete');
  assert.equal(f.executions.length, 1);
  assert.equal(f.releases, 2);
  assert.equal(f.held, false);
});

for (const [name, invalidResults] of [
  ['missing', () => undefined],
  ['missing source', () => results().slice(1)],
  ['duplicate source', () => { const rows = results(); rows[4] = rows[0]; return rows; }],
  ['wrong source', () => { const rows = results(); rows[4].source = 'synthetic-unknown'; return rows; }],
  ['unsuccessful result', () => { const rows = results(); rows[4].ok = false; return rows; }],
  ['read-only result', () => { const rows = results(); rows[4].mode = 'read_only'; return rows; }],
  ['missing outcomes', () => { const rows = results(); delete rows[4].outcomes; return rows; }],
]) {
  test(`runExpiryWorker rejects ${name} execution results rather than claiming completion`, async t => {
    const f = fixture(t); f.execute = invalidResults;
    const result = await f.run();
    assert.deepEqual(result, { ok: false, status: 'review_required', errorCode: 'EXPIRY_REVIEW_REQUIRED', retryWrites: false });
    assert.deepEqual(f.executions, [{ args: ['--apply'] }]);
    assert.deepEqual(f.events, ['acquire', 'read', 'execute', 'notify', 'release']);
    assert.equal(f.notices.length, 1);
    assert.equal(f.readState().lastRunAt, undefined);
    assert.equal(f.releases, 1);
    assert.equal(f.held, false);
  });
}

test('runExpiryWorker rejects corrupt, incomplete or unknown post-execution ledgers on the independent reread', async t => {
  for (const corrupt of [
    rows => rows.slice(1),
    rows => { rows[4].state.entitlements[MEMBER].expiresAt = iso(END_MS + 1); return rows; },
    rows => { rows[4].state.entitlements[MEMBER].revocation = { status: 'result_unknown' }; return rows; },
  ]) {
    const f = fixture(t);
    f.execute = () => { f.rows = corrupt(copyLedgers(f.rows)); return results(); };
    const result = await f.run();
    assert.equal(result.ok, false);
    assert.equal(result.status, 'review_required');
    assert.equal(result.retryWrites, false);
    assert.deepEqual(f.events, ['acquire', 'read', 'execute', 'read', 'notify', 'release']);
    assert.equal(f.readState().lastRunAt, undefined);
    assert.equal(f.releases, 1);
    assert.equal(f.held, false);
  }
});

for (const status of ['intent', 'result_unknown']) {
  test(`runExpiryWorker never executes or replays an existing ${status}`, async t => {
    const f = fixture(t); f.rows[4].state.entitlements[MEMBER].revocation = { status };
    const original = copyLedgers(f.rows);
    assert.equal((await f.run({ apply: false })).status, 'blocked_unknown_result');
    noRemoteCalls(f);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await f.run();
      assert.deepEqual(result, { ok: false, status: 'review_required', errorCode: 'EXPIRY_UNKNOWN_RESULT', retryWrites: false });
      f.clock += HOUR;
    }
    assert.deepEqual(f.executions, []);
    assert.equal(f.notices.length, 1);
    assert.equal(f.notices[0].errorCode, 'EXPIRY_UNKNOWN_RESULT');
    assert.deepEqual(f.rows, original);
    assert.equal(f.releases, 3);
    assert.equal(f.held, false);
  });
}

test('runExpiryWorker deduplicates email for unchanged failures across persisted checkpoints', async t => {
  const f = fixture(t);
  f.execute = () => { throw Error('synthetic execution failure'); };
  assert.equal((await f.run()).status, 'review_required');
  const first = f.readState();
  assert.equal(first.firstFailureAt, END);
  assert.equal(first.notifiedKey, first.lastErrorKey);
  assert.equal(first.pendingNotice, undefined);
  assert.equal(f.notices[0].type, 'failure');
  assert.equal(f.notices[0].noticeVersion, 2);
  f.clock += HOUR;
  assert.equal((await f.run()).status, 'review_required');
  const second = f.readState();
  assert.equal(f.notices.length, 1);
  assert.equal(second.firstFailureAt, first.firstFailureAt);
  assert.equal(second.lastErrorKey, first.lastErrorKey);
  assert.equal(second.notifiedKey, first.notifiedKey);
  assert.equal(f.executions.length, 2);
  assert.equal(f.releases, 2);
  assert.equal(f.held, false);
});

for (const [name, state, expected] of [
  ['malformed JSON', undefined, SyntaxError],
  ['unsupported version', { version: 2 }, /INVALID_EXPIRY_CHECKPOINT/],
  ['invalid review date', { version: 1, nextReviewAt: 'not-a-date' }, /INVALID_EXPIRY_CHECKPOINT/],
  ['excessive backoff', { version: 1, nextReviewAt: iso(END_MS + 24 * HOUR + 1) }, /INVALID_EXPIRY_CHECKPOINT/],
]) {
  test(`runExpiryWorker releases its lock for corrupt state: ${name}`, async t => {
    const f = fixture(t);
    if (state === undefined) fs.writeFileSync(f.stateFile, '{', { mode: 0o600 });
    else f.writeState(state);
    const original = fs.readFileSync(f.stateFile, 'utf8');
    await assert.rejects(f.run(), expected);
    assert.deepEqual(f.events, ['acquire', 'release']);
    noRemoteCalls(f);
    assert.equal(fs.readFileSync(f.stateFile, 'utf8'), original);
    assert.equal(f.releases, 1);
    assert.equal(f.held, false);
  });
}

test('runExpiryWorker releases its lock when reading ledgers throws', async t => {
  const f = fixture(t);
  f.read = () => { throw Error('synthetic ledger read failure'); };
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'EXPIRY_REVIEW_REQUIRED');
  assert.deepEqual(f.executions, []);
  assert.equal(f.notices.length, 1);
  assert.equal(f.releases, 1);
  assert.equal(f.held, false);
});

test('runExpiryWorker preserves pending notice and releases its lock when notification is unverified', async t => {
  const f = fixture(t);
  f.execute = () => { throw Error('synthetic execution failure'); };
  f.notify = () => ({});
  await assert.rejects(f.run(), /EXPIRY_OPERATOR_NOTICE_UNVERIFIED/);
  assert.equal(f.readState().pendingNotice.errorCode, 'EXPIRY_REVIEW_REQUIRED');
  assert.equal(f.readState().notifiedKey, undefined);
  assert.equal(f.releases, 1);
  assert.equal(f.held, false);
});

for (const status of ['not_due', 'complete', 'backoff']) {
  for (const receiptFound of [true, false]) {
    test(`runExpiryWorker reconciles the exact pending event before ${status}: receipt ${receiptFound ? 'found' : 'not found'}`, async t => {
      const f = fixture(t);
      f.execute = () => { throw Error('synthetic execution failure'); };
      f.notify = () => { throw Error('synthetic notification failure'); };
      await assert.rejects(f.run(), /synthetic notification failure/);
      const failed = f.readState();
      const pending = structuredClone(failed.pendingNotice);
      assert.deepEqual(pending, f.notices[0]);
      assert.equal(failed.pendingNoticeKey, failed.lastErrorKey);
      f.clock += 60000;
      if (status === 'not_due') {
        f.rows = STUDENT_SHARE_SOURCES.map(source => ({ source, state: ledger(source, { start: START_MS + HOUR }) }));
      } else if (status === 'complete') f.rows = terminal(f.rows);
      assert.equal(expiryPlan(f.rows, f.clock, failed).status, status);
      f.events.length = 0;
      let calls = 0;
      f.notify = event => {
        assert.deepEqual(f.readState().pendingNotice, pending);
        assert.equal(f.readState().pendingNoticeKey, failed.pendingNoticeKey);
        if (++calls === 1) {
          assert.deepEqual(event, { ...pending, reconcileOnly: true });
          return receiptFound ? { messageId: 'synthetic-existing-receipt' } : { notFound: true };
        }
        assert.equal(receiptFound, false);
        assert.deepEqual(event, pending);
        return { messageId: 'synthetic-retried-receipt' };
      };
      f.read = () => {
        assert.equal(f.readState().pendingNotice, undefined);
        assert.equal(f.readState().pendingNoticeKey, undefined);
        return copyLedgers(f.rows);
      };
      const result = await f.run();
      assert.equal(result.ok, true);
      assert.equal(result.status, status);
      assert.equal(result.remoteCalls, 0);
      assert.deepEqual(f.events, ['acquire', 'notify', ...(!receiptFound ? ['notify'] : []), 'read', 'release']);
      assert.deepEqual(f.executions, [{ args: ['--apply'] }]);
      assert.deepEqual(f.notices, [pending, { ...pending, reconcileOnly: true }, ...(!receiptFound ? [pending] : [])]);
      assert.equal(calls, receiptFound ? 1 : 2);
      const recovered = f.readState();
      assert.equal(recovered.pendingNotice, undefined);
      assert.equal(recovered.pendingNoticeKey, undefined);
      if (status === 'backoff') assert.equal(recovered.notifiedKey, failed.pendingNoticeKey);
      else {
        assert.equal(recovered.notifiedKey, undefined);
        assert.equal(recovered.firstFailureAt, undefined);
        assert.equal(recovered.lastErrorKey, undefined);
        assert.equal(recovered.lastErrorCode, undefined);
      }
      assert.equal(f.releases, 2);
      assert.equal(f.held, false);
    });
  }
}

for (const [name, receipts] of [
  ['missing reconciliation receipt', [undefined]],
  ['empty reconciliation receipt', [{}]],
  ['unverified acceptance', [{ accepted: true }]],
  ['reconciliation transport error', [new Error('synthetic reconciliation failure')]],
  ['unverified resend after confirmed absence', [{ notFound: true }, {}]],
]) {
  test(`runExpiryWorker holds business writes while pending notification is ambiguous: ${name}`, async t => {
    const f = fixture(t);
    f.execute = () => { throw Error('synthetic execution failure'); };
    f.notify = () => ({});
    await assert.rejects(f.run(), /EXPIRY_OPERATOR_NOTICE_UNVERIFIED/);
    const failed = f.readState();
    const pending = structuredClone(failed.pendingNotice);
    const originalRows = copyLedgers(f.rows);
    f.clock += HOUR;
    assert.equal(expiryPlan(f.rows, f.clock, failed).status, 'due');
    for (let attempt = 0; attempt < 2; attempt++) {
      let calls = 0;
      f.events.length = 0;
      f.notify = event => {
        assert.deepEqual(event, calls === 0 ? { ...pending, reconcileOnly: true } : pending);
        const receipt = receipts[calls++];
        if (receipt instanceof Error) throw receipt;
        return receipt;
      };
      assert.deepEqual(await f.run(), { ok: false, status: 'notification_pending',
        errorCode: 'EXPIRY_OPERATOR_NOTICE_UNVERIFIED', retryWrites: false });
      assert.equal(calls, receipts.length);
      assert.deepEqual(f.events, ['acquire', ...receipts.map(() => 'notify'), 'release']);
      assert.deepEqual(f.executions, [{ args: ['--apply'] }]);
      assert.deepEqual(f.readState(), failed);
      assert.deepEqual(f.rows, originalRows);
      assert.equal(f.releases, attempt + 2);
      assert.equal(f.held, false);
      f.clock += 60000;
    }
  });
}

test('runExpiryWorker processed recovery resets notifiedKey so a separate same-fingerprint failure alerts again', async t => {
  const f = fixture(t);
  f.execute = () => { throw Error('synthetic execution failure'); };
  assert.equal((await f.run()).status, 'review_required');
  const first = f.readState();
  assert.equal(first.notifiedKey, first.lastErrorKey);
  assert.equal(f.notices.length, 1);
  f.clock += HOUR;
  f.execute = () => results(STUDENT_SHARE_SOURCES.map(() => 'staff_access_preserved'));
  assert.equal((await f.run()).status, 'processed');
  const recovered = f.readState();
  assert.equal(recovered.fingerprint, first.fingerprint);
  assert.equal(recovered.due, 5);
  assert.equal(recovered.notifiedKey, undefined);
  assert.equal(recovered.firstFailureAt, undefined);
  assert.equal(recovered.lastErrorKey, null);
  assert.equal(recovered.lastErrorCode, null);
  assert.equal(recovered.pendingNotice, undefined);
  assert.equal(recovered.pendingNoticeKey, undefined);
  f.clock = Date.parse(recovered.nextReviewAt);
  f.execute = () => { throw Error('synthetic execution failure'); };
  assert.equal((await f.run()).status, 'review_required');
  const separate = f.readState();
  assert.equal(separate.fingerprint, first.fingerprint);
  assert.equal(separate.lastErrorKey, first.lastErrorKey);
  assert.equal(separate.notifiedKey, separate.lastErrorKey);
  assert.equal(separate.firstFailureAt, iso(f.clock));
  assert.notEqual(separate.firstFailureAt, first.firstFailureAt);
  assert.equal(f.notices.length, 2);
  assert.equal(f.notices[0].errorCode, f.notices[1].errorCode);
  assert.equal(f.notices[1].firstFailureAt, iso(f.clock));
  assert.notEqual(f.notices[0].observedAt, f.notices[1].observedAt);
  assert.deepEqual(f.executions, [{ args: ['--apply'] }, { args: ['--apply'] }, { args: ['--apply'] }]);
  assert.equal(f.releases, 3);
  assert.equal(f.held, false);
});

test('runExpiryWorker protected-expiry backoff never skips the next future expiry', async t => {
  const f = fixture(t);
  const next = END_MS + 2 * HOUR;
  f.rows[1].state = ledger(f.rows[1].source, { start: START_MS + 2 * HOUR });
  const original = copyLedgers(f.rows);
  f.execute = () => {
    for (const [index, { state }] of f.rows.entries()) {
      if (index !== 0 && Date.parse(state.entitlements[MEMBER].expiresAt) <= f.clock) {
        Object.assign(state.entitlements[MEMBER], { status: 'revoked', revocation: { status: 'verified' } });
      }
    }
    return results(['staff_access_preserved', f.clock >= next ? 'remove_group_only' : 'not_due']);
  };
  const first = await f.run();
  assert.equal(first.status, 'processed');
  assert.equal(first.due, 1);
  assert.equal(first.nextExpiryAt, iso(next));
  assert.equal(f.readState().nextReviewAt, iso(next));
  f.clock = next - 1;
  assert.equal((await f.run()).status, 'backoff');
  assert.equal(f.executions.length, 1);
  f.clock = next;
  assert.equal((await f.run()).status, 'processed');
  assert.deepEqual(f.executions, [{ args: ['--apply'] }, { args: ['--apply'] }]);
  assert.equal(f.rows[1].state.entitlements[MEMBER].status, 'revoked');
  assert.equal(f.rows[0].state.entitlements[MEMBER].status, 'active');
  assert.equal(f.readState().nextReviewAt, iso(next + 24 * HOUR));
  for (const [index, { state }] of f.rows.entries()) {
    assert.equal(state.entitlements[MEMBER].grantedAt, original[index].state.entitlements[MEMBER].grantedAt);
    assert.equal(state.entitlements[MEMBER].expiresAt, original[index].state.entitlements[MEMBER].expiresAt);
  }
  assert.equal(f.notices.length, 0);
  assert.equal(f.releases, 3);
  assert.equal(f.held, false);
});
