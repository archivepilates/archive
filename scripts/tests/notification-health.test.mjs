import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Each fixture has a private HOME; reads, database writes and mail are synthetic.
async function fixture(t, code) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'notification-health-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
    import os from 'node:os';
    import path from 'node:path';
    import { observeStudioMateNotifications } from './scripts/observe-studiomate-notifications.mjs';
    import { recordNotificationIngressHealth } from './scripts/lib/studiomate-notification-health.mjs';
    import { notificationHint, observeNotificationHints, NOTIFICATION_POLL_MS } from './scripts/lib/studiomate-notification-ingress.mjs';
    import { automationHealthEventId } from './scripts/lib/automation-failure-notifications.mjs';
    import { kstTimestamp } from './scripts/lib/operations-email-format.mjs';

    globalThis.fetch = () => { throw new Error('unexpected_network'); };
    const statePath = path.join(os.homedir(), 'ArchiveIN/automation/state/studiomate-notification-ingress.json');
    const reportDir = path.join(os.homedir(), 'ArchiveIN/automation/reports/notification-ingress');
    const alertPath = path.join(reportDir, 'query-alert-state.json');
    const now = Date.now();
    const row = body => ({ title: '예약', body });
    const A = row('synthetic A'), B = row('synthetic B'), C = row('synthetic C');
    const observe = (rows, time = now, options = {}) => observeStudioMateNotifications({
      now: time, forceRead: true, read: async () => ({ rows, checkedAt: new Date(time).toISOString() }), ...options,
    });
    const state = async () => JSON.parse(await readFile(statePath, 'utf8'));
    const writes = [], emails = [];
    const db = { collection(name) {
      assert.equal(name, 'automationStatus');
      return { doc(id) {
        assert.equal(id, 'studiomate-notification-ingress');
        return { async set(value, options) {
          assert.deepEqual(options, { merge: true });
          writes.push(structuredClone(value));
        } };
      } };
    } };
    const execute = (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.deepEqual(args, ['firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs']);
      assert.ok(options.env.AUTOMATION_REPORT_BODY.includes('홀딩은 기존 정기 Excel 처리 경로를 사용하며, 그 실행의 정상 여부는 별도 확인합니다.'));
      assert.doesNotMatch(options.env.AUTOMATION_REPORT_BODY, /홀딩과 기존 시간별 Excel 동기화는 유지됩니다/);
      emails.push(options.env);
      return JSON.stringify({ messageId: 'synthetic-message-' + emails.length });
    };
    const health = result => recordNotificationIngressHealth(db, result, { execute });
    async function seedFailure() {
      const past = new Date(now - 60000).toISOString();
      const seed = { version: 1, consecutiveFailures: 3, firstFailureAt: past,
        notifiedAt: past, notifiedCode: 'LIVE_TIMEOUT', errorCode: 'LIVE_TIMEOUT',
        lastOutcome: 'read_failure', observedAt: past, lastRunFinishedAt: past };
      await mkdir(reportDir, { recursive: true, mode: 0o700 });
      await writeFile(alertPath, JSON.stringify(seed), { mode: 0o600 });
      return seed;
    }
    async function assertLocksReleased() {
      for (const lock of [path.join(os.homedir(), 'ArchiveIN/automation/locks/studiomate-notification-ingress.lock'),
        path.join(reportDir, 'query-alert.lock')]) {
        await assert.rejects(access(lock), { code: 'ENOENT' });
      }
    }
    ${code}
    await assertLocksReleased();
  `], {
    cwd: new URL('../../', import.meta.url), env: { ...process.env, HOME: home },
    encoding: 'utf8', timeout: 20000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('fresh overlap retains the persisted gap in observer results, saved state and health', async t => {
  await fixture(t, `
    const baseline = await observe([A]);
    assert.equal(baseline.continuityLost, false);
    assert.equal(baseline.currentContinuityLost, false);
    await health(baseline);
    assert.equal(writes.at(-1).status, 'healthy');

    const gap = await observe([B], now + NOTIFICATION_POLL_MS);
    assert.equal(gap.continuityLost, true);
    assert.equal(gap.currentContinuityLost, true);
    const before = await state();
    const time = now + 2 * NOTIFICATION_POLL_MS;
    const recovered = await observe([C, B], time);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.continuityLost, true);
    assert.equal(recovered.currentContinuityLost, false);
    assert.equal(recovered.routing.status, 'shadow');
    assert.equal(recovered.externalActions, 0);
    assert.deepEqual(await state(), observeNotificationHints(before, [C, B].map(notificationHint), time).state);
    assert.equal((await state()).nextPollAt, time + NOTIFICATION_POLL_MS);
    await health(recovered);
    assert.equal(writes.at(-1).status, 'warning');
    assert.match(writes.at(-1).lastResult, /기존 알림 공백 대조 필요/);
    assert.match(writes.at(-1).warnings.join(' '), /기존 알림 공백 미대조/);
    assert.equal(emails.length, 0);

    const repeated = await observe([C, B], time + NOTIFICATION_POLL_MS);
    assert.equal(repeated.newHints, 0);
    assert.equal(repeated.continuityLost, true);
    assert.equal(repeated.currentContinuityLost, false);
    await health(repeated);
    assert.equal(writes.at(-1).status, 'warning');
    assert.equal((await state()).continuityLost, true);
  `);
});

test('query recovery with an unresolved gap uses attention status and preserves event identity and dedupe', async t => {
  await fixture(t, `
    await observe([A]);
    await observe([B], now + NOTIFICATION_POLL_MS);
    const recovered = await observe([C, B], now + 2 * NOTIFICATION_POLL_MS);
    const before = await readFile(statePath, 'utf8');
    const seed = await seedFailure();
    await health(recovered);
    assert.equal(writes.at(-1).status, 'warning');
    assert.equal(emails.length, 1);
    const mail = emails[0];
    const alert = JSON.parse(await readFile(alertPath, 'utf8'));
    assert.equal(alert.lastOutcome, 'success');
    assert.equal(alert.consecutiveFailures, 0);
    assert.equal(mail.AUTOMATION_REPORT_FROM, 'home@archivepilates.com');
    assert.equal(mail.AUTOMATION_REPORT_TO, 'home@archivepilates.com');
    assert.equal(mail.AUTOMATION_REPORT_LABEL, '자동화 확인필요');
    assert.match(mail.AUTOMATION_REPORT_SUBJECT, /^\\[알림감지\\]\\[확인필요\\] StudioMate 조회 복구 · 기존 알림 공백 미대조/);
    assert.equal(mail.AUTOMATION_REPORT_EVENT_ID, automationHealthEventId('알림감지', {
      noticeVersion: 2, type: 'recovery', ...seed, observedAt: alert.observedAt,
    }));
    assert.equal(mail.AUTOMATION_REPORT_RECONCILE_ONLY, '0');
    assert.ok(mail.AUTOMATION_REPORT_BODY.includes('확인: ' + kstTimestamp(alert.observedAt)));
    assert.doesNotMatch(mail.AUTOMATION_REPORT_BODY, /확인 불가/);
    assert.match(mail.AUTOMATION_REPORT_BODY, /읽기가 복구됐습니다.*공백은 아직 미대조/);
    assert.match(mail.AUTOMATION_REPORT_BODY, /다음:\\n- 기존 알림 공백 구간을 정기 Excel 원본과 실행 장부로 대조/);
    assert.doesNotMatch(mail.AUTOMATION_REPORT_BODY, /다음:\\n- 없음/);
    await health(recovered);
    assert.equal(emails.length, 1);
    assert.equal(writes.at(-1).status, 'warning');
    await health({ ...recovered, continuityLost: false });
    assert.equal(emails.length, 1);
    assert.equal(await readFile(statePath, 'utf8'), before);
  `);
});

test('query recovery without a persisted gap stays healthy and retains the existing recovery routing', async t => {
  await fixture(t, `
    await observe([A]);
    const recovered = await observe([B, A], now + NOTIFICATION_POLL_MS);
    assert.equal(recovered.continuityLost, false);
    await seedFailure();
    await health(recovered);
    assert.equal(writes.at(-1).status, 'healthy');
    assert.deepEqual(writes.at(-1).warnings, []);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].AUTOMATION_REPORT_LABEL, '자동화 성공');
    assert.match(emails[0].AUTOMATION_REPORT_SUBJECT, /^\\[알림감지\\]\\[성공\\] StudioMate 조회 복구 · \\d{4}-\\d{2}-\\d{2}$/);
    assert.match(emails[0].AUTOMATION_REPORT_BODY, /다음:\\n- 없음/);
    assert.doesNotMatch(emails[0].AUTOMATION_REPORT_BODY, /확인 불가|공백은 아직 미대조/);
    await health({ ...recovered, continuityLost: true });
    assert.equal(writes.at(-1).status, 'warning');
    assert.equal(emails.length, 1);
  `);
});

test('queue acknowledgement clears only pending hints, not the unresolved continuity warning', async t => {
  await fixture(t, `
    await observe([A]);
    await observe([B], now + NOTIFICATION_POLL_MS);
    const creates = [];
    const queueDb = {
      doc(value) { assert.match(value, /^adminSyncRequests\\/studiomate_notification_/); return { path: value }; },
      async runTransaction(run) { return run({
        async get() { return { exists: false }; },
        create(ref, data) { creates.push({ ref, data }); },
      }); },
    };
    const queued = await observe([C, B], now + 2 * NOTIFICATION_POLL_MS, { apply: true, db: queueDb });
    assert.equal(queued.routing.status, 'queued');
    assert.equal(queued.currentContinuityLost, false);
    assert.equal(queued.continuityLost, true);
    assert.equal(queued.externalActions, 0);
    assert.equal(creates.length, 1);
    assert.equal(creates[0].data.notificationIsExecutionAuthority, false);
    assert.equal(creates[0].data.holdingNotificationEnabled, false);
    assert.equal(creates[0].data.notificationHintCount, 2);
    const saved = await state();
    assert.deepEqual(saved.pending, []);
    assert.equal(saved.lastRequestId, queued.routing.requestId);
    assert.equal(saved.continuityLost, true);
    await health(queued);
    assert.equal(writes.at(-1).status, 'warning');
  `);
});

test('failure mail retains both read recovery and unresolved gap reconciliation actions', async t => {
  await fixture(t, `
    await observe([A]);
    await observe([B], now + NOTIFICATION_POLL_MS);
    await seedFailure();
    await writeFile(alertPath, JSON.stringify({ version: 1, consecutiveFailures: 2,
      firstFailureAt: new Date(now - 60000).toISOString(), notifiedAt: null }), { mode: 0o600 });
    const failed = await observe([], now + 2 * NOTIFICATION_POLL_MS, { read: async () => {
      throw Object.assign(new Error('synthetic read failure'), { code: 'LIVE_TIMEOUT' });
    } });
    await health(failed);
    assert.equal(emails.length, 1);
    const mail = emails[0];
    const alert = JSON.parse(await readFile(alertPath, 'utf8'));
    assert.equal(mail.AUTOMATION_REPORT_LABEL, '자동화 실패');
    assert.match(mail.AUTOMATION_REPORT_SUBJECT, /^\\[알림감지\\]\\[실패\\]/);
    assert.ok(mail.AUTOMATION_REPORT_BODY.includes('확인: ' + kstTimestamp(alert.observedAt)));
    assert.match(mail.AUTOMATION_REPORT_BODY, /다음:\\n- StudioMate 로그인과 공유 브라우저 잠금 상태를 확인하세요.\\n- 기존 알림 공백 구간을 정기 Excel 원본과 실행 장부로 대조/);
    assert.doesNotMatch(mail.AUTOMATION_REPORT_BODY, /확인 불가|다음:\\n- 없음/);
    assert.equal((await state()).continuityLost, true);
  `);
});

test('read-only and failed reads preserve a prior unresolved gap without rewriting ingress state', async t => {
  await fixture(t, `
    await observe([A]);
    await observe([B], now + NOTIFICATION_POLL_MS);
    const before = await readFile(statePath, 'utf8');
    const readonly = await observe([B], now + 2 * NOTIFICATION_POLL_MS, { readOnly: true });
    assert.equal(readonly.status, 'read_only');
    assert.equal(readonly.continuityLost, true);
    assert.equal(readonly.currentContinuityLost, false);
    assert.equal(await readFile(statePath, 'utf8'), before);
    const failed = await observe([], now + 2 * NOTIFICATION_POLL_MS, { read: async () => {
      throw Object.assign(new Error('synthetic read failure'), { code: 'LIVE_TIMEOUT' });
    } });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'LIVE_TIMEOUT');
    assert.equal(failed.continuityLost, true);
    await health(failed);
    assert.equal(writes.at(-1).status, 'warning');
    assert.deepEqual(writes.at(-1).warnings.slice(0, 1), ['LIVE_TIMEOUT']);
    assert.match(writes.at(-1).warnings.join(' '), /기존 알림 공백 미대조/);
    assert.equal(emails.length, 0);
    assert.equal(await readFile(statePath, 'utf8'), before);
  `);
});

test('deferred statuses do not replace health, send mail or read the source before the poll is due', async t => {
  await fixture(t, `
    await observe([A]);
    await observe([B], now + NOTIFICATION_POLL_MS);
    const before = await readFile(statePath, 'utf8');
    const skipped = await observe([], now + NOTIFICATION_POLL_MS + 1, { forceRead: false,
      read: async () => { throw new Error('unexpected_read_before_poll_due'); } });
    assert.equal(skipped.status, 'not_due');
    for (const status of ['not_due', 'busy', 'browser_busy']) await health({ ok: true, status });
    assert.equal(writes.length, 0);
    assert.equal(emails.length, 0);
    assert.equal(await readFile(statePath, 'utf8'), before);
  `);
});
