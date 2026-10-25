import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { observeAutomationRun, ALERT_STATE_FILE, deferReferralHealthFinding, deferInstructorOrderHealthFinding, automationHealthEmailBody, automationHealthEventId, LOCK_WAIT_DELAYED_CODE, sendAutomationHealthEmail } from '../lib/automation-failure-notifications.mjs';
import { imwebRequestFailure, TRANSIENT_READ_CODE } from '../lib/imweb-read-failure.mjs';
import { imwebJson } from '../lib/imweb-referral-source.mjs';
import { imwebOrderRead, syncImwebInstructorOrders } from '../lib/imweb-instructor-orders.mjs';
import { IMWEB_LESSON_POLICY as policy } from '../lib/imweb-instructor-order-policy.mjs';
import { runReferralJob } from '../run-imweb-referral-job.mjs';
import { deliverAutomationReport, reportMessageId } from '../../firebase/kangsain-functions/macmini-studiomate/automation-report-delivery.mjs';

const failure = { ok: false, transient: true, errorCode: TRANSIENT_READ_CODE };
const now = '2026-10-05T01:00:00.000Z';

test('prolonged Imweb lock notice describes a delay rather than a provider failure', () => {
  const body = automationHealthEmailBody({ title: '자동 연결', link: 'https://example.test/rules' },
    { type: 'failure', errorCode: LOCK_WAIT_DELAYED_CODE, consecutiveFailures: 1,
      firstFailureAt: now, observedAt: now });
  assert.match(body, /30분 이상 지연/);
  assert.match(body, /원본 조회·권한 변경은 시작하지 않았/);
  assert.doesNotMatch(body, /1회 연속 실패/);
  const ordinary = automationHealthEmailBody({ title: '자동 연결' },
    { type: 'failure', errorCode: 'AUTH_FAILURE', consecutiveFailures: 1, firstFailureAt: now, observedAt: now });
  assert.match(ordinary, /1회 연속 실패/);
  assert.doesNotMatch(ordinary, /30분 이상 지연/);
});

test('lock-delay mail uses attention subject/label while real failures and recovery keep their routing', () => {
  for (const [type, errorCode, status, label] of [
    ['failure', LOCK_WAIT_DELAYED_CODE, '확인필요', '자동화 확인필요'],
    ['failure', 'AUTH_FAILURE', '실패', '자동화 실패'],
    ['recovery', LOCK_WAIT_DELAYED_CODE, '성공', '자동화 성공'],
  ]) {
    let calls = 0;
    const receipt = sendAutomationHealthEmail({ area: '스텝 영상권한', title: '자동 연결', link: 'https://example.test/rules' },
      { type, errorCode, consecutiveFailures: 1, firstFailureAt: now, observedAt: now },
      { execute: (_command, _args, options) => {
        calls++;
        assert.ok(options.env.AUTOMATION_REPORT_SUBJECT.startsWith(`[스텝 영상권한][${status}]`));
        assert.equal(options.env.AUTOMATION_REPORT_LABEL, label);
        return JSON.stringify({ messageId: 'synthetic-mail' });
      } });
    assert.equal(calls, 1);
    assert.equal(receipt.messageId, 'synthetic-mail');
  }
});
const scanFailure = { exitCode: 1, mode: 'apply', state: 'failed', errorCode: 'IMWEB_REQUEST_FAILED',
  summary: null, rewards: {}, failureDetails: { phase: 'member_scan', operation: 'member_list' } };
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'query-alert-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const events = [];
  const notify = async event => {
    if (event.reconcileOnly) return { notFound: true };
    events.push(event);
    return { messageId: `fixture-${events.length}` };
  };
  return { directory, events, notify,
    observe: (input, send = notify, time = now) => observeAutomationRun(directory, input, send, time),
    state: async () => JSON.parse(await readFile(path.join(directory, ALERT_STATE_FILE), 'utf8')) };
}

test('third consecutive failure alerts once across persisted reads; full recovery alerts once', async t => {
  const f = await fixture(t);
  await f.observe(failure); await f.observe(failure);
  assert.equal(f.events.length, 0);
  await f.observe(failure); await f.observe(failure);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].consecutiveFailures, 3);
  await f.observe({ ok: true }); await f.observe({ ok: true });
  assert.deepEqual(f.events.map(e => e.type), ['failure', 'recovery']);
  assert.equal((await f.state()).consecutiveFailures, 0);
  assert.equal((await stat(path.join(f.directory, ALERT_STATE_FILE))).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(f.directory), [ALERT_STATE_FILE]);
});

test('unalerted recovery is quiet and resets streak; skips do not reset', async t => {
  const f = await fixture(t);
  await f.observe(failure); await f.observe({ ok: true });
  await f.observe(failure); await f.observe({ skipped: true }); await f.observe(failure);
  assert.equal(f.events.length, 0);
  await f.observe(failure);
  assert.equal(f.events.length, 1);
});

test('auth/write/ledger errors alert immediately; same failure repeats only after a day', async t => {
  const f = await fixture(t);
  await f.observe({ ok: false, errorCode: 'LEDGER_INVALID' });
  await f.observe({ ok: false, errorCode: 'LEDGER_INVALID' });
  assert.equal(f.events.length, 1);
  await f.observe({ ok: false, errorCode: 'WORKER_INCOMPLETE' });
  assert.equal(f.events.length, 2);
  await f.observe({ ok: false, errorCode: 'WORKER_INCOMPLETE' }, f.notify, '2026-10-06T01:00:01Z');
  assert.equal(f.events.length, 3);
});

test('failed email delivery is not acknowledged and both failure/recovery retry next run', async t => {
  const f = await fixture(t);
  await f.observe(failure); await f.observe(failure);
  const reject = async () => { throw new Error('synthetic mail transport failure'); };
  assert.equal((await f.observe(failure, reject)).notificationFailed, true);
  assert.equal((await f.state()).notifiedAt, null);
  await f.observe(failure);
  assert.equal(f.events.length, 1);
  await f.observe({ ok: true }, reject);
  assert.ok((await f.state()).notifiedAt);
  await f.observe({ ok: true }); await f.observe({ ok: true });
  assert.deepEqual(f.events.map(e => e.type), ['failure', 'recovery']);
});

test('business review blocks recovery until resolved and does not count as transient failure', async t => {
  const f = await fixture(t);
  await f.observe(failure); await f.observe(failure); await f.observe(failure);
  await f.observe({ blocked: true });
  assert.equal(f.events.length, 1);
  assert.equal((await f.state()).consecutiveFailures, 0);
  await f.observe({ ok: true });
  assert.equal(f.events[1].type, 'recovery');
});

test('unknown structured errors/auth/validation/write timeouts are never deferred', () => {
  for (const statusCode of [429, 500, 502, 503, 504]) {
    assert.equal(imwebRequestFailure({ statusCode }, { readOnly: true }).code, TRANSIENT_READ_CODE);
  }
  for (const error of [{ statusCode: 401 }, { statusCode: 403 }, new SyntaxError('json'),
    new Error('timeout secret member@example.test'), { code: 'ENOENT' }]) {
    assert.notEqual(imwebRequestFailure(error, { readOnly: true }).code, TRANSIENT_READ_CODE);
  }
  assert.notEqual(imwebRequestFailure({ code: 'ETIMEDOUT' }).code, TRANSIENT_READ_CODE);
  assert.notEqual(imwebRequestFailure({ statusCode: 401, code: 'ECONNRESET' }, { readOnly: true }).code, TRANSIENT_READ_CODE);
  assert.notEqual(imwebRequestFailure({ stdout: JSON.stringify({ statusCode: 403, error: { code: 'EAI_AGAIN' } }) }, { readOnly: true }).code, TRANSIENT_READ_CODE);
  assert.equal(imwebRequestFailure({ stdout: JSON.stringify({ statusCode: 503, secret: 'private' }) }, { readOnly: true }).code, TRANSIENT_READ_CODE);
});

test('late or replayed observations cannot reset a newer failure or duplicate recovery', async t => {
  const f = await fixture(t);
  for (let i = 1; i <= 3; i++) await f.observe({ ...failure, runFinishedAt: `2026-10-05T01:00:0${i}Z` });
  await f.observe({ ok: true, runFinishedAt: '2026-10-05T01:00:02Z' });
  assert.equal(f.events.length, 1);
  assert.equal((await f.state()).consecutiveFailures, 3);
  await f.observe({ ok: true, runFinishedAt: '2026-10-05T01:00:04Z' });
  await f.observe({ ...failure, runFinishedAt: '2026-10-05T01:00:03Z' });
  assert.equal((await f.state()).consecutiveFailures, 0);
  assert.equal(f.events.length, 2);
});

test('email label failure does not invalidate delivery; event ID reconciles repeated attempts', async () => {
  const messageId = reportMessageId('a'.repeat(64));
  let sends = 0;
  const gmailFetch = async url => {
    if (url.includes('?q=')) return { messages: sends ? [{ id: 'sent-fixture' }] : [] };
    if (url.endsWith('/send')) { sends++; return { id: 'sent-fixture' }; }
    throw new Error('label API failure');
  };
  const first = await deliverAutomationReport({ gmailFetch, raw: 'fixture', messageId, labelId: 'test' });
  assert.equal(first.messageId, 'sent-fixture');
  assert.equal(first.labelApplied, false);
  await deliverAutomationReport({ gmailFetch, raw: 'fixture', messageId, labelId: 'test' });
  assert.equal(sends, 1);
  await assert.rejects(deliverAutomationReport({ gmailFetch: async () => { throw new Error('lookup failed'); }, messageId }), /lookup failed/);
  assert.throws(() => reportMessageId('bad\r\nheader'), /Invalid/);
  assert.deepEqual(await deliverAutomationReport({ gmailFetch: async url => {
    assert.ok(url.includes('?q=')); return { messages: [] };
  }, messageId, reconcileOnly: true }), { notFound: true });
});

test('delivered-but-unacknowledged failure is reconciled before sending recovery', async t => {
  const f = await fixture(t);
  await f.observe(failure); await f.observe(failure);
  await f.observe(failure, async () => { throw new Error('sent but caller timed out'); });
  assert.ok((await f.state()).pendingNotice);
  const calls = [];
  const notify = async event => {
    calls.push(event);
    return { messageId: event.reconcileOnly ? 'previously-sent' : 'recovery-sent' };
  };
  await f.observe({ ok: true }, notify);
  assert.equal(calls[0].reconcileOnly, true);
  assert.equal(calls[1].type, 'recovery');
  assert.equal((await f.state()).notifiedAt, null);
});

test('existing order review issue remains immediate and prevents a false recovery', async t => {
  const f = await fixture(t);
  await f.observe(failure); await f.observe(failure); await f.observe(failure);
  await writeFile(path.join(f.directory, 'state.json'), JSON.stringify({ issues: { fixture: '정원 초과' } }));
  const attention = [];
  const result = await syncImwebInstructorOrders({}, { apply: true, force: true, stateDir: f.directory,
    read: healthyRead, recordStatus: async () => {}, notify: f.notify,
    attention: async (_directory, detail) => { attention.push(detail); } });
  assert.equal(result.ok, false);
  assert.equal(attention.length, 1);
  assert.equal(f.events.length, 1);
});

test('actual CLI adapters classify reads but not config or award writes and sanitize output', () => {
  const execute = () => { throw Object.assign(new Error('person@example.test secret'), { code: 'ETIMEDOUT' }); };
  for (const [fn, args] of [[imwebJson, ['member', 'list']], [imwebOrderRead, ['order', 'list']], [imwebOrderRead, ['order', 'get']]]) {
    assert.throws(() => fn(args, { execute }), error => error.code === TRANSIENT_READ_CODE && !error.message.includes('secret'));
  }
  for (const args of [['config', 'context'], ['promotion', 'point', 'change', 'member', 'fixture']]) {
    assert.throws(() => imwebJson(args, { execute }), error => error.code !== TRANSIENT_READ_CODE);
  }
  assert.throws(() => imwebOrderRead(['order', 'list'], { execute: () => JSON.stringify({ statusCode: 429 }) }), { code: TRANSIENT_READ_CODE });
});

test('referral wrapper leaves failed exit code intact and disabled runs cannot recover', async t => {
  const f = await fixture(t);
  const invoke = result => runReferralJob({ directory: f.directory, notify: f.notify, run: async () => result });
  for (let i = 0; i < 3; i++) assert.equal((await invoke({ ...scanFailure, errorCode: TRANSIENT_READ_CODE })).exitCode, 1);
  await invoke({ exitCode: 0, mode: 'disabled' });
  assert.equal(f.events.length, 1);
  await invoke({ exitCode: 0, mode: 'apply', summary: { disabled: 0 } });
  assert.equal(f.events[1].type, 'recovery');
});

test('referral alert persists only sanitized diagnostics and recovery includes the failure stage', async t => {
  const f = await fixture(t);
  const result = { ...scanFailure, errorCode: TRANSIENT_READ_CODE, failureDetails: {
    phase: 'member_scan', operation: 'member_list', statusCode: 503, providerCode: '30001', private: 'token=secret',
  } };
  for (let i = 0; i < 3; i++) await runReferralJob({ directory: f.directory, notify: f.notify, run: async () => result });
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].failureDetails.private, undefined);
  assert.equal((await f.state()).failureDetails.statusCode, 503);
  await f.observe({ ok: true });
  assert.equal(f.events[1].failureDetails.operation, 'member_list');
  const body = automationHealthEmailBody({ title: '자동 적립', link: 'https://example.test' }, f.events[1]);
  assert.match(body, /member_scan/);
  assert.doesNotMatch(body, /token=secret/);
});

test('generic pre-award member scan failures and quiet recoveries never generate isolated email pairs', async t => {
  const f = await fixture(t);
  const invoke = result => runReferralJob({ directory: f.directory, notify: f.notify, run: async () => result });
  for (let i = 0; i < 3; i++) {
    assert.equal((await invoke(scanFailure)).exitCode, 1);
    assert.equal((await f.state()).lastOutcome, 'read_failure');
    await invoke({ exitCode: 0, mode: 'apply', state: 'success', summary: { disabled: 0 } });
    assert.equal((await f.state()).consecutiveFailures, 0);
  }
  assert.equal(f.events.length, 0);
});

test('generic pre-award scans alert on the third failure, throttle, and recover exactly once', async t => {
  const f = await fixture(t);
  const invoke = result => runReferralJob({ directory: f.directory, notify: f.notify, run: async () => result });
  await invoke(scanFailure); await invoke(scanFailure);
  assert.equal(f.events.length, 0);
  await invoke(scanFailure); await invoke(scanFailure);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].consecutiveFailures, 3);
  await invoke({ exitCode: 0, mode: 'apply', summary: { disabled: 0 } });
  await invoke({ exitCode: 0, mode: 'apply', summary: { disabled: 0 } });
  assert.deepEqual(f.events.map(e => e.type), ['failure', 'recovery']);
});

test('referral auth, validation, unknown phase and award risk remain immediate even with read-like codes', async t => {
  const cases = [
    ...[401, 403, 422].map(statusCode => ({ failureDetails: { ...scanFailure.failureDetails, statusCode } })),
    ...['invalid_json', 'invalid_envelope', 'source_validation', 'conflicting_status'].map(failureKind => ({ failureDetails: { ...scanFailure.failureDetails, failureKind } })),
    ...['point_send', 'point_verify', 'point_prepare'].flatMap(phase => [
      { failureDetails: { operation: 'member_list', phase } },
      { errorCode: TRANSIENT_READ_CODE, failureDetails: { operation: 'member_list', phase } },
    ]),
    { failureDetails: {} }, { failureDetails: { phase: 'member_scan', operation: 'other_request' } },
    { summary: {} }, { rewards: { inviter: {} } }, { rewards: null },
    { errorCode: 'LEDGER_INVALID' }, { errorCode: 'WORKER_INCOMPLETE' }, { mode: 'simulate' },
  ];
  for (const change of cases) {
    const f = await fixture(t);
    await runReferralJob({ directory: f.directory, notify: f.notify, run: async () => ({ ...scanFailure, ...change }) });
    assert.equal(f.events.length, 1, JSON.stringify(change));
    assert.equal((await f.state()).lastOutcome, 'failure');
  }
});

test('an alerted read outage cannot suppress a new point or authentication failure with the same generic code', async t => {
  const f = await fixture(t);
  const invoke = change => runReferralJob({ directory: f.directory, notify: f.notify,
    run: async () => ({ ...scanFailure, ...change }) });
  await invoke({}); await invoke({}); await invoke({});
  await invoke({ failureDetails: { phase: 'point_send', operation: 'other_request', role: 'inviter' }, rewards: { inviter: {} } });
  await invoke({ failureDetails: { phase: 'point_send', operation: 'other_request', role: 'inviter' }, rewards: { inviter: {} } });
  assert.equal(f.events.length, 2);
  await invoke({ failureDetails: { ...scanFailure.failureDetails, statusCode: 401 } });
  assert.equal(f.events.length, 3);
});

test('uncertain same-code point delivery cannot acknowledge an unsent auth alert; legacy notices keep their identity', async t => {
  const f = await fixture(t);
  const delivered = new Map();
  let uncertain = true;
  const notify = async event => {
    const id = automationHealthEventId('친구초대', event);
    if (delivered.has(id)) return { messageId: delivered.get(id) };
    if (event.reconcileOnly) return { notFound: true };
    delivered.set(id, `message-${delivered.size + 1}`);
    if (event.failureDetails.phase === 'point_send' && uncertain) {
      uncertain = false;
      throw new Error('delivered but caller timed out');
    }
    return { messageId: delivered.get(id) };
  };
  const invoke = change => runReferralJob({ directory: f.directory, notify,
    run: async () => ({ ...scanFailure, ...change }) });
  await invoke({}); await invoke({}); await invoke({});
  await invoke({ failureDetails: { phase: 'point_send', operation: 'other_request' }, rewards: { inviter: {} } });
  assert.equal((await f.state()).pendingNotice.noticeVersion, 2);
  await invoke({ failureDetails: { ...scanFailure.failureDetails, statusCode: 401 } });
  assert.equal(delivered.size, 3);
  assert.equal((await f.state()).notifiedFailureDetails.statusCode, 401);
  const old = { type: 'failure', firstFailureAt: now, errorCode: 'IMWEB_REQUEST_FAILED' };
  assert.equal(automationHealthEventId('친구초대', old), automationHealthEventId('친구초대', {
    ...old, failureDetails: { phase: 'point_send' }, reconcileOnly: true,
  }));
});

test('contradictory CLI statuses stay immediate through wrapper and system health', async t => {
  const f = await fixture(t);
  let error;
  try {
    imwebJson(['member', 'list'], { execute: () => { throw {
      stdout: JSON.stringify({ statusCode: 503 }), stderr: JSON.stringify({ statusCode: 502 }),
    }; }, wait: () => assert.fail('must not retry') });
  } catch (caught) { error = caught; }
  assert.equal(error.failureDetails.failureKind, 'conflicting_status');
  const report = { ...scanFailure, finishedAt: now, failureDetails: { ...error.failureDetails, phase: 'member_scan' } };
  await runReferralJob({ directory: f.directory, notify: f.notify, run: async () => report });
  assert.equal(f.events.length, 1);
  assert.equal(deferReferralHealthFinding(report, await f.state(), { now: Date.now() }), false);
});

test('same-stage retry preserves a delivered legacy pending notice identity without sending again', async t => {
  const f = await fixture(t);
  const pending = { type: 'failure', firstFailureAt: now, notifiedAt: null,
    errorCode: scanFailure.errorCode, failureDetails: scanFailure.failureDetails,
    consecutiveFailures: 3, observedAt: now };
  const legacyId = automationHealthEventId('친구초대', pending);
  await writeFile(path.join(f.directory, ALERT_STATE_FILE), JSON.stringify({ version: 1,
    consecutiveFailures: 3, notifiedAt: null, firstFailureAt: now, errorCode: pending.errorCode,
    failureDetails: pending.failureDetails, pendingNotice: pending }), { mode: 0o600 });
  let deliveries = 1;
  await runReferralJob({ directory: f.directory, run: async () => scanFailure, notify: async event => {
    const id = automationHealthEventId('친구초대', event);
    if (id !== legacyId) deliveries++;
    assert.equal(id, legacyId);
    return { messageId: 'legacy-delivered' };
  } });
  assert.equal(deliveries, 1);
  assert.equal((await f.state()).notifiedMessageId, 'legacy-delivered');
  assert.equal((await f.state()).pendingNotice, undefined);
});

const context = { resolved_profile: { site_code: policy.siteCode, unit_code: policy.unitCode } };
const healthyRead = args => args[0] === 'config' ? context : {
  data: args[1] === 'get' ? { orderNo: args[2], sections: [] } : { list: [], currentPage: 1, totalPage: 0, totalCount: 0 },
};
const failedRead = args => {
  if (args[0] === 'config') return context;
  throw imwebRequestFailure({ code: 'ETIMEDOUT' }, { readOnly: true });
};

test('scheduled order sync counts read failures, skips throttled/manual checks and recovers', async t => {
  const f = await fixture(t);
  const db = { runTransaction: () => assert.fail('no production writes'), collection: () => assert.fail('no DB calls') };
  const options = { apply: true, force: true, stateDir: f.directory, notify: f.notify,
    recordStatus: async () => {}, attention: async () => assert.fail('no review alert expected') };
  for (let i = 0; i < 3; i++) await assert.rejects(syncImwebInstructorOrders(db, { ...options, read: failedRead }), { code: TRANSIENT_READ_CODE });
  assert.equal(f.events.length, 1);
  assert.equal((await syncImwebInstructorOrders(db, { ...options, force: false, read: healthyRead })).skipped, 'throttled');
  await syncImwebInstructorOrders(db, { ...options, orderNo: '209901010000001', read: healthyRead });
  assert.equal(f.events.length, 1);
  await syncImwebInstructorOrders(db, { ...options, read: healthyRead });
  assert.equal(f.events[1].type, 'recovery');
  assert.equal((await readdir(f.directory)).some(name => name.endsWith('.lock')), false);
});

test('order DB/status failures remain immediate and cannot prevent notification', async t => {
  const f = await fixture(t);
  await assert.rejects(syncImwebInstructorOrders({}, { apply: true, force: true, stateDir: f.directory,
    read: healthyRead, recordStatus: async () => { throw new Error('status write failure'); }, notify: f.notify }), /status write failure/);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].errorCode, 'ORDER_INTAKE_FAILED');
});

test('system health defers only fresh matching first/second query failures, never corrupt/stale evidence', async t => {
  const f = await fixture(t);
  const report = { ...scanFailure, errorCode: TRANSIENT_READ_CODE, finishedAt: now };
  await f.observe({ ...failure, failureDetails: report.failureDetails, runFinishedAt: now });
  const state = await f.state();
  const options = { now: Date.parse(now) + 1000 };
  assert.equal(deferReferralHealthFinding(report, state, options), true);
  assert.equal(deferReferralHealthFinding(report, undefined, options), false);
  assert.equal(deferReferralHealthFinding({ ...report, errorCode: 'LEDGER_INVALID' }, state, options), false);
  assert.equal(deferReferralHealthFinding(report, { ...state, consecutiveFailures: 3 }, options), false);
  assert.equal(deferReferralHealthFinding(report, state, { now: Date.parse(now) + 21 * 60000 }), false);
  assert.equal(deferReferralHealthFinding({ ...report, finishedAt: '2026-10-05T02:00:00Z' }, state, options), false);
  await writeFile(path.join(f.directory, ALERT_STATE_FILE), '{}');
  await assert.rejects(f.observe({ ok: true }), /Invalid alert state/);
});

test('system health shares the generic pre-award scan policy and requires exact current-run evidence', async t => {
  const f = await fixture(t);
  const report = { ...scanFailure, finishedAt: now };
  await f.observe({ ok: false, deferredRead: true, errorCode: report.errorCode,
    failureDetails: report.failureDetails, runFinishedAt: now });
  const state = await f.state();
  const options = { now: Date.parse(now) + 1000 };
  assert.equal(deferReferralHealthFinding(report, state, options), true);
  for (const change of [{ consecutiveFailures: 3 }, { lastRunFinishedAt: undefined },
    { errorCode: TRANSIENT_READ_CODE }, { failureDetails: { phase: 'point_send' } },
    { lastOutcome: 'failure' }, { notifiedAt: now }]) {
    assert.equal(deferReferralHealthFinding(report, { ...state, ...change }, options), false);
  }
  assert.equal(deferReferralHealthFinding(report, state, { now: Date.parse(now) + 21 * 60000 }), false);
  assert.equal(deferReferralHealthFinding({ ...report, failureDetails: { phase: 'point_send', operation: 'member_list' } }, state, options), false);
});

test('system health never hides actual instructor registration failures or mismatched runs', async t => {
  const f = await fixture(t);
  await f.observe(failure);
  const state = await f.state();
  const report = { ok: false, failed: 0, reviewRequired: 0,
    websiteOrders: { errorCode: TRANSIENT_READ_CODE, queryAlertObservedAt: state.observedAt } };
  const options = { now: Date.parse(now) + 1000 };
  assert.equal(deferInstructorOrderHealthFinding(report, state, options), true);
  assert.equal(deferInstructorOrderHealthFinding({ ...report, failed: 1 }, state, options), false);
  assert.equal(deferInstructorOrderHealthFinding({ ...report, reviewRequired: 1 }, state, options), false);
  assert.equal(deferInstructorOrderHealthFinding(report, { ...state, consecutiveFailures: 3 }, options), false);
  assert.equal(deferInstructorOrderHealthFinding(report, { ...state, observedAt: '2026-10-05T00:59:00Z' }, options), false);
});
