import { lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { acquireStudioMateBrowserLock } from './studiomate-browser-lock.mjs';
import { TRANSIENT_READ_CODE } from './imweb-read-failure.mjs';

export const FAILURE_THRESHOLD = 3;
export const ALERT_STATE_FILE = 'query-alert-state.json';

export function sendAutomationHealthEmail({ area, title, link }, event) {
  const recovered = event.type === 'recovery';
  const eventId = createHash('sha256').update(JSON.stringify([area, event.type,
    event.firstFailureAt, event.notifiedAt, event.errorCode])).digest('hex');
  const body = [
    `주체: ARCHIVE IN / ${title}`,
    `결론: ${recovered ? '알림을 보낸 오류 이후 전체 정기 실행이 정상 완료됐습니다.' : `${event.consecutiveFailures}회 연속 실패했습니다.`}`,
    `발생: ${event.firstFailureAt} / 확인: ${event.observedAt}`,
    `원인 코드: ${event.errorCode}`,
    recovered ? '검증: 전체 조회와 해당 실행의 처리가 완료됐습니다. 개별 적립·수강권 발급의 과거 누락 해소를 뜻하지 않습니다.'
      : '현재: 해당 실행이 완료되지 않았습니다. 처리 결과가 불명확한 적립·접수는 자동 쓰기 재시도하지 않습니다.',
    `다음: ${recovered ? '추가 조치 없음. 기존 확인필요 건은 별도 검토합니다.' : '원본과 실행 장부를 확인하세요.'}`,
    `상세: ${link}`,
  ].join('\n');
  const output = execFileSync(process.execPath, ['firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env,
      GOOGLE_SERVICE_ACCOUNT_KEY: path.join(os.homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json'),
      AUTOMATION_REPORT_FROM: 'home@archivepilates.com', AUTOMATION_REPORT_TO: 'home@archivepilates.com',
      AUTOMATION_REPORT_EVENT_ID: eventId,
      AUTOMATION_REPORT_RECONCILE_ONLY: event.reconcileOnly ? '1' : '0',
      AUTOMATION_REPORT_SUBJECT: `[${area}][${recovered ? '성공' : '실패'}] ${title} ${recovered ? '복구' : '확인 필요'}`,
      AUTOMATION_REPORT_LABEL: recovered ? '자동화 성공' : '자동화 실패', AUTOMATION_REPORT_BODY: body,
    },
  });
  return JSON.parse(output);
}

export async function observeAutomationRun(directory, observation, notify, now = new Date().toISOString()) {
  if (observation.skipped) return { skipped: true };
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) throw new Error('Unsafe alert directory');
  const release = await acquireStudioMateBrowserLock({ lockPath: path.join(directory, 'query-alert.lock'),
    owner: 'automation-query-alert', waitMs: 120000, staleMs: 180000 });
  try {
    const file = path.join(directory, ALERT_STATE_FILE);
    let state = { version: 1, consecutiveFailures: 0, notifiedAt: null };
    try {
      const entry = await lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.uid !== process.getuid() || entry.mode & 0o077) throw new Error('Unsafe alert state');
      state = JSON.parse(await readFile(file, 'utf8'));
      if (state.version !== 1 || !Number.isSafeInteger(state.consecutiveFailures) || state.consecutiveFailures < 0) throw new Error('Invalid alert state');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // The referral runner releases its work lock before notification; ignore late observations.
    if (observation.runFinishedAt && state.lastRunFinishedAt
      && Date.parse(observation.runFinishedAt) <= Date.parse(state.lastRunFinishedAt)) return { ...state, skipped: true };
    const lastRunFinishedAt = observation.runFinishedAt || state.lastRunFinishedAt;
    if ((observation.ok || observation.blocked) && state.pendingNotice && !state.notifiedAt) {
      try {
        const receipt = await notify({ ...state.pendingNotice, reconcileOnly: true });
        if (receipt?.messageId) {
          state.notifiedAt = state.pendingNotice.observedAt;
          state.notifiedCode = state.pendingNotice.errorCode;
          state.notifiedMessageId = receipt.messageId;
        } else if (!receipt?.notFound) throw new Error('Unconfirmed notification lookup');
        delete state.pendingNotice;
      } catch {
        console.error('기존 오류 알림 전달 여부 확인 실패: 복구 판정을 보류합니다.');
        return { ...state, notificationFailed: true };
      }
    }
    let event;
    if (observation.blocked) {
      state.consecutiveFailures = 0;
      state.lastOutcome = 'blocked';
      if (!state.notifiedAt) delete state.firstFailureAt;
    } else if (observation.ok) {
      if (state.notifiedAt) event = { type: 'recovery', ...state, observedAt: now };
      state.consecutiveFailures = 0;
      state.lastOutcome = 'success';
      if (!event) state = { version: 1, consecutiveFailures: 0, notifiedAt: null, lastOutcome: 'success' };
    } else {
      if (!state.consecutiveFailures && !state.notifiedAt) state.firstFailureAt = now;
      state.consecutiveFailures += 1;
      state.errorCode = observation.errorCode;
      state.lastOutcome = observation.transient ? 'transient_failure' : 'failure';
      const due = !state.notifiedAt || !observation.transient && state.notifiedCode !== observation.errorCode
        || Date.parse(now) - Date.parse(state.notifiedAt) >= 86400000;
      if ((!observation.transient || state.consecutiveFailures >= FAILURE_THRESHOLD) && due) {
        event = { type: 'failure', ...state, observedAt: now };
      }
    }
    state.observedAt = now;
    if (lastRunFinishedAt) state.lastRunFinishedAt = lastRunFinishedAt;
    const persist = async () => {
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    };
    if (event?.type === 'failure') state.pendingNotice = { type: event.type, firstFailureAt: event.firstFailureAt,
      notifiedAt: event.notifiedAt, errorCode: event.errorCode, consecutiveFailures: event.consecutiveFailures, observedAt: event.observedAt };
    // Persist the observation even when delivery fails; acknowledge only after success.
    await persist();
    if (event) {
      try {
        const receipt = await notify(event);
        if (event.type === 'recovery') state = { version: 1, consecutiveFailures: 0, notifiedAt: null, lastOutcome: 'success', observedAt: now,
          ...(lastRunFinishedAt ? { lastRunFinishedAt } : {}) };
        else {
          state.notifiedAt = now; state.notifiedCode = observation.errorCode;
          if (receipt?.messageId) state.notifiedMessageId = receipt.messageId;
          delete state.pendingNotice;
        }
        await persist();
      } catch {
        console.error('자동화 상태 알림 발송 확인 실패: 다음 정기 실행에서 다시 확인합니다.');
        return { ...state, notificationFailed: true };
      }
    }
    return state;
  } finally { await release(); }
}

export function isDeferredTransientAlert(state, { now = Date.now(), maxAgeMs = 20 * 60000 } = {}) {
  const age = now - Date.parse(state?.observedAt);
  return state?.lastOutcome === 'transient_failure' && !state.notifiedAt
    && Number.isInteger(state.consecutiveFailures) && state.consecutiveFailures > 0
    && state.consecutiveFailures < FAILURE_THRESHOLD && age >= 0 && age < maxAgeMs;
}

export function deferReferralHealthFinding(report, state, options) {
  return report?.state === 'failed' && report.errorCode === TRANSIENT_READ_CODE
    && Number.isFinite(Date.parse(report.finishedAt))
    && Date.parse(state?.observedAt) >= Date.parse(report.finishedAt)
    && Date.parse(state?.observedAt) - Date.parse(report.finishedAt) < 60000
    && isDeferredTransientAlert(state, options);
}

export function deferInstructorOrderHealthFinding(report, state, options) {
  return report?.ok === false && report.failed === 0 && report.reviewRequired === 0
    && report.websiteOrders?.errorCode === TRANSIENT_READ_CODE
    && report.websiteOrders.queryAlertObservedAt === state?.observedAt
    && isDeferredTransientAlert(state, options);
}
