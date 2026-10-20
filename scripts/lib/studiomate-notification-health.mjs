import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { observeAutomationRun, automationHealthEventId } from './automation-failure-notifications.mjs';
import { formatOperationsReport, kstTimestamp } from './operations-email-format.mjs';
import { recordAutomationStatus } from './archive-core-ops-logging.mjs';

export async function recordNotificationIngressHealth(db, result) {
  if (['not_due', 'busy', 'browser_busy'].includes(result.status)) return;
  await recordAutomationStatus(db, { automationId: 'studiomate-notification-ingress',
    title: 'StudioMate 알림 감지', ownerArea: 'studiomate', status: result.ok && !result.continuityLost ? 'healthy' : 'warning',
    lastResult: result.ok ? `알림목록 ${result.received}건 확인 · ${result.routing?.status || result.status}`
      : `알림목록 확인 보류 · ${result.code}`,
    warnings: [...(result.ok ? [] : [result.code]), ...(result.continuityLost ? ['알림목록 연속성 미확인. 기존 정기 Excel 대조 유지.'] : [])],
  });
  const directory = path.join(os.homedir(), 'ArchiveIN/automation/reports/notification-ingress');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await observeAutomationRun(directory, { ok: result.ok, deferredRead: true,
    errorCode: result.code || '', runFinishedAt: new Date().toISOString() }, event => {
    const recovered = event.type === 'recovery';
    const message = formatOperationsReport({ area: '알림감지', status: recovered ? '성공' : '실패',
      title: 'StudioMate 알림목록 확인', context: 'ARCHIVE CORE / StudioMate 알림 기반 감지',
      conclusion: recovered ? '알림목록 읽기가 복구됐습니다.' : '알림목록 읽기가 3회 이상 연속 실패했습니다.',
      key: [`원인 코드: ${event.errorCode}`, '홀딩과 기존 시간별 Excel 동기화는 유지됩니다.'],
      verification: ['알림목록 조회 상태이며 계약·알림톡 발송 완료를 뜻하지 않습니다.'],
      caution: ['감지 실패 중 변경은 기존 정기 Excel 대조로 확인합니다.'],
      next: [recovered ? '없음' : 'StudioMate 로그인과 공유 브라우저 잠금 상태를 확인하세요.'],
      details: ['https://core.archivepilates.com/automation/'],
    });
    const output = execFileSync(process.execPath,
      ['firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs'], {
        cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GOOGLE_SERVICE_ACCOUNT_KEY: path.join(os.homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json'),
          AUTOMATION_REPORT_FROM: 'home@archivepilates.com', AUTOMATION_REPORT_TO: 'home@archivepilates.com',
          AUTOMATION_REPORT_EVENT_ID: automationHealthEventId('알림감지', event),
          AUTOMATION_REPORT_RECONCILE_ONLY: event.reconcileOnly ? '1' : '0',
          AUTOMATION_REPORT_SUBJECT: `[알림감지][${recovered ? '성공' : '실패'}] StudioMate ${recovered ? '조회 복구' : '확인 필요'} · ${kstTimestamp(event.observedAt).slice(0, 10)}`,
          AUTOMATION_REPORT_LABEL: recovered ? '자동화 성공' : '자동화 실패', AUTOMATION_REPORT_BODY: message.body },
      });
    return JSON.parse(output);
  });
}
