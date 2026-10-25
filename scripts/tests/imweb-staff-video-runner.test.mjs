import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runStaffVideoJob } from '../run-imweb-staff-video-sync.mjs';
import { runStaffVideoSync, STAFF_VIDEO_LOCK_BUSY, MEMBER_GROUP_LOCK } from '../lib/imweb-staff-video-sync.mjs';
import { acquireStudioMateBrowserLock } from '../lib/studiomate-browser-lock.mjs';
import { observeAutomationRun, ALERT_STATE_FILE, LOCK_WAIT_DELAYED_CODE } from '../lib/automation-failure-notifications.mjs';

const start = Date.parse('2026-10-25T04:00:00.000Z');
const at = minutes => new Date(start + minutes * 60000).toISOString();
const busy = () => Object.assign(Error('synthetic private lock owner'),
  { code: STAFF_VIDEO_LOCK_BUSY, phase: 'lock_acquisition' });

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'staff-video-runner-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const events = [];
  const notify = async event => {
    if (event.reconcileOnly) return { notFound: true };
    events.push(event);
    return { messageId: `synthetic-${events.length}` };
  };
  return { directory, events, notify,
    state: async () => JSON.parse(await readFile(path.join(directory, ALERT_STATE_FILE), 'utf8')),
    invoke: (minutes, options = {}) => runStaffVideoJob({ args: ['--apply'], directory, notify,
      now: () => at(minutes), run: async () => { throw busy(); }, ...options }) };
}

test('real held work lock defers before config/source access and keeps its owner', async t => {
  const f = await fixture(t);
  const lockPath = path.join(f.directory, 'synthetic.lock');
  const release = await acquireStudioMateBrowserLock({ lockPath, owner: 'synthetic-owner', waitMs: 0 });
  try {
    const before = await readFile(path.join(lockPath, 'owner.json'), 'utf8');
    let sourceCalls = 0;
    const result = await f.invoke(0, { run: options => runStaffVideoSync({ ...options,
      run: () => { sourceCalls++; throw Error('Must not read sources'); },
      acquireLock: options => {
        assert.equal(options.lockPath, MEMBER_GROUP_LOCK);
        assert.equal(options.waitMs, 0);
        return acquireStudioMateBrowserLock({ ...options, lockPath });
      } }) });
    assert.equal(result.status, 'deferred');
    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.errorCode, STAFF_VIDEO_LOCK_BUSY);
    assert.equal(sourceCalls, 0);
    assert.equal(f.events.length, 0);
    assert.equal(await readFile(path.join(lockPath, 'owner.json'), 'utf8'), before);
    assert.deepEqual((await readdir(f.directory)).sort(), [ALERT_STATE_FILE, 'synthetic.lock']);
  } finally { await release(); }
});

test('short deferral preserves real failure and pending delivery instead of claiming recovery', async t => {
  const f = await fixture(t);
  await observeAutomationRun(f.directory, { ok: false, errorCode: 'AUTH_FAILURE' },
    async () => { throw Error('synthetic ambiguous mail result'); }, at(-1));
  const before = await f.state();
  await f.invoke(0);
  await f.invoke(5);
  const after = await f.state();
  for (const key of ['consecutiveFailures', 'errorCode', 'firstFailureAt', 'notifiedAt', 'pendingNotice']) {
    assert.deepEqual(after[key], before[key]);
  }
  assert.equal(after.lastOutcome, 'deferred_lock');
  assert.equal(after.lockWaitSince, at(0));
  assert.equal(f.events.length, 0);
});

test('30-minute lock starvation alerts once and only full completion recovers', async t => {
  const f = await fixture(t);
  for (const minute of [0, 5, 15, 29.99]) assert.equal((await f.invoke(minute)).exitCode, 0);
  assert.equal(f.events.length, 0);
  const delayed = await f.invoke(30);
  assert.equal(delayed.exitCode, 1);
  assert.equal(delayed.status, 'blocked');
  assert.equal(delayed.errorCode, LOCK_WAIT_DELAYED_CODE);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].errorCode, LOCK_WAIT_DELAYED_CODE);
  await f.invoke(35);
  assert.equal(f.events.length, 1);
  const complete = { ok: true, mode: 'apply', finishedAt: at(36) };
  await f.invoke(36, { args: ['--apply', '--member-code', 'm001'], run: async () => complete });
  assert.equal(f.events.length, 1, 'Targeted success must not recover the full job');
  await f.invoke(37, { run: async () => ({ ...complete, finishedAt: at(37) }) });
  await f.invoke(38, { run: async () => ({ ...complete, finishedAt: at(38) }) });
  assert.deepEqual(f.events.map(event => event.type), ['failure', 'recovery']);
  assert.equal((await f.state()).lockWaitSince, undefined);
  assert.equal((await f.state()).lastRunFinishedAt, at(38));
});

test('repeated contention retains failure acknowledgements and never updates full success time', async t => {
  const f = await fixture(t);
  await observeAutomationRun(f.directory, { ok: true, runFinishedAt: at(-2) }, f.notify, at(-2));
  await observeAutomationRun(f.directory, { ok: false, errorCode: 'STAFF_GROUP_RESULT_UNKNOWN' }, f.notify, at(-1));
  const before = await f.state();
  for (const minute of [0, 5, 10]) await f.invoke(minute);
  const after = await f.state();
  for (const key of ['lastRunFinishedAt', 'consecutiveFailures', 'notifiedAt', 'notifiedCode', 'notifiedMessageId']) {
    assert.deepEqual(after[key], before[key]);
  }
  assert.equal(f.events.length, 1);
});

test('failed long-wait notification remains actionable and keeps one notice identity', async t => {
  const f = await fixture(t);
  const reject = async () => { throw Error('synthetic mail transport'); };
  await f.invoke(0);
  assert.equal((await f.invoke(30, { notify: reject })).exitCode, 1);
  const pending = (await f.state()).pendingNotice;
  assert.equal(pending.errorCode, LOCK_WAIT_DELAYED_CODE);
  await f.invoke(35);
  assert.equal(f.events[0].observedAt, pending.observedAt);
  assert.equal((await f.state()).pendingNotice, undefined);
});

test('late contention cannot replace a newer full success or a newer observed failure', async t => {
  const f = await fixture(t);
  await observeAutomationRun(f.directory, { ok: true, runFinishedAt: at(2) }, f.notify, at(2));
  const before = await readFile(path.join(f.directory, ALERT_STATE_FILE), 'utf8');
  await runStaffVideoJob({ args: ['--apply'], directory: f.directory, notify: f.notify,
    now: (() => { let i = 0; return () => at(i++ ? 3 : 1); })(), run: async () => { throw busy(); } });
  assert.equal(await readFile(path.join(f.directory, ALERT_STATE_FILE), 'utf8'), before);
  await observeAutomationRun(f.directory, { ok: false, errorCode: 'AUTH_FAILURE' }, f.notify, at(5));
  const failure = await readFile(path.join(f.directory, ALERT_STATE_FILE), 'utf8');
  await f.invoke(4);
  assert.equal(await readFile(path.join(f.directory, ALERT_STATE_FILE), 'utf8'), failure);
});

test('dry-run and individual contention never acknowledge full-job health', async t => {
  const f = await fixture(t);
  for (const args of [[], ['--apply', '--member-code', 'm001']]) {
    const result = await f.invoke(0, { args, observe: () => assert.fail('No health writes allowed') });
    assert.equal(result.status, 'deferred');
  }
  assert.deepEqual(await readdir(f.directory), []);
});

test('auth, unknown writes, ledger, raw lock errors and late lookalikes remain immediate failures', async t => {
  const f = await fixture(t);
  for (const error of [
    Object.assign(Error('synthetic'), { code: 'AUTH_FAILURE' }),
    Object.assign(Error('synthetic'), { code: 'STAFF_GROUP_RESULT_UNKNOWN' }),
    Object.assign(Error('synthetic'), { code: 'ENOENT' }),
    Object.assign(Error('synthetic'), { code: 'STUDIOMATE_BROWSER_BUSY' }),
    Object.assign(Error('synthetic'), { code: STAFF_VIDEO_LOCK_BUSY }),
  ].entries()) {
    const [index, current] = error;
    const result = await f.invoke(index, { run: async () => { throw current; } });
    assert.equal(result.exitCode, 1);
    assert.notEqual(result.status, 'deferred');
  }
  assert.equal(f.events.length, 5);
  const result = await f.invoke(1, { run: async () => ({ ok: true, mode: 'apply', finishedAt: at(1) }),
    observe: async () => { throw Object.assign(Error('synthetic health lock'), { code: 'STUDIOMATE_BROWSER_BUSY' }); } });
  assert.equal(result.exitCode, 1);
  assert.notEqual(result.status, 'deferred');
});

test('health persistence errors are failures and never a successful deferral', async t => {
  const f = await fixture(t);
  const result = await f.invoke(0, { observe: async () => { throw Error('synthetic disk error'); } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.errorCode, 'STAFF_VIDEO_HEALTH_FAILED');
});

test('incomplete, skipped and wrong-mode returned results cannot claim recovery', async t => {
  const f = await fixture(t);
  for (const result of [{ ok: false }, { ok: true, skipped: true },
    { ok: true, mode: 'dry_run', finishedAt: at(0) }, { ok: true, mode: 'apply', finishedAt: 'invalid' }]) {
    const actual = await f.invoke(0, { run: async () => result });
    assert.equal(actual.exitCode, 1);
    assert.equal(actual.errorCode, 'STAFF_VIDEO_RUN_INCOMPLETE');
  }
  assert.deepEqual(f.events.map(event => event.type), ['failure']);
});

test('starvation preserves an ambiguous real incident and reconciles its original delivery identity', async t => {
  const f = await fixture(t);
  const reject = async () => { throw Error('synthetic uncertain mail result'); };
  await observeAutomationRun(f.directory, { ok: false, errorCode: 'STAFF_GROUP_RESULT_UNKNOWN', runFailedAt: at(-1) }, reject, at(-1));
  const original = (await f.state()).pendingNotice;
  await f.invoke(0);
  await f.invoke(30, { notify: reject });
  const delayed = await f.state();
  assert.equal(delayed.errorCode, 'STAFF_GROUP_RESULT_UNKNOWN');
  assert.equal(delayed.consecutiveFailures, 1);
  assert.deepEqual(delayed.pendingNotice, original);
  const notices = [];
  await f.invoke(31, { run: async () => ({ ok: true, mode: 'apply', finishedAt: at(31) }),
    notify: async event => { notices.push(event); return { messageId: 'synthetic-original-receipt' }; } });
  assert.equal(notices[0].reconcileOnly, true);
  assert.equal(notices[0].observedAt, original.observedAt);
  assert.equal(notices[0].errorCode, original.errorCode);
  assert.equal(notices[1].type, 'recovery');
});

test('long wait cannot replace or duplicate an acknowledged real failure', async t => {
  const f = await fixture(t);
  await observeAutomationRun(f.directory, { ok: false, errorCode: 'AUTH_FAILURE', runFailedAt: at(-1) }, f.notify, at(-1));
  const original = await f.state();
  await f.invoke(0);
  const delayed = await f.invoke(30);
  assert.equal(delayed.exitCode, 1);
  assert.equal(delayed.errorCode, 'AUTH_FAILURE');
  const after = await f.state();
  for (const key of ['consecutiveFailures', 'notifiedAt', 'notifiedCode', 'notifiedMessageId']) {
    assert.deepEqual(after[key], original[key]);
  }
  assert.equal(f.events.length, 1);
});

test('older success cannot clear newer timestamped failure even when observed later', async t => {
  const f = await fixture(t);
  await observeAutomationRun(f.directory, { ok: false, errorCode: 'AUTH_FAILURE', runFailedAt: at(3) }, f.notify, at(3));
  const before = await readFile(path.join(f.directory, ALERT_STATE_FILE), 'utf8');
  await observeAutomationRun(f.directory, { ok: true, runFinishedAt: at(2) }, f.notify, at(4));
  assert.equal(await readFile(path.join(f.directory, ALERT_STATE_FILE), 'utf8'), before);
  assert.equal(f.events.length, 1);
  await observeAutomationRun(f.directory, { ok: true, runFinishedAt: at(5) }, f.notify, at(5));
  assert.deepEqual(f.events.map(event => event.type), ['failure', 'recovery']);
});

test('late real failure cannot replace a newer full success or a newer failure', async t => {
  const f = await fixture(t);
  await observeAutomationRun(f.directory, { ok: true, runFinishedAt: at(4) }, f.notify, at(4));
  let before = await readFile(path.join(f.directory, ALERT_STATE_FILE), 'utf8');
  await observeAutomationRun(f.directory, { ok: false, errorCode: 'AUTH_FAILURE', runFailedAt: at(2) }, f.notify, at(5));
  assert.equal(await readFile(path.join(f.directory, ALERT_STATE_FILE), 'utf8'), before);
  await observeAutomationRun(f.directory, { ok: false, errorCode: 'AUTH_FAILURE', runFailedAt: at(6) }, f.notify, at(6));
  before = await readFile(path.join(f.directory, ALERT_STATE_FILE), 'utf8');
  await observeAutomationRun(f.directory, { ok: false, errorCode: 'OTHER_FAILURE', runFailedAt: at(5) }, f.notify, at(7));
  assert.equal(await readFile(path.join(f.directory, ALERT_STATE_FILE), 'utf8'), before);
});
