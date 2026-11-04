import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { observeAutomationRun, automationHealthEventId } from './automation-failure-notifications.mjs';
import { formatOperationsReport, kstTimestamp } from './operations-email-format.mjs';
import { recordAutomationStatus } from './archive-core-ops-logging.mjs';

export async function recordNotificationIngressHealth(db, result, { execute = execFileSync } = {}) {
  if (['not_due', 'busy', 'browser_busy'].includes(result.status)) return;
  const gapWarning = '기존 알림 공백 미대조. 조회 복구나 새 알림 겹침은 과거 누락 해소를 뜻하지 않습니다. 기존 정기 Excel 대조 유지.';
  const gapNextAction = '기존 알림 공백 구간을 정기 Excel 원본과 실행 장부로 대조하고 누락 여부를 확인하세요. 대조 완료 전에는 연속성 경고를 유지하세요.';
  await recordAutomationStatus(db, { automationId: 'studiomate-notification-ingress',
    title: 'StudioMate 알림 감지', ownerArea: 'studiomate', status: result.ok && !result.continuityLost ? 'healthy' : 'warning',
    lastResult: result.ok ? `알림목록 ${result.received}건 확인 · ${result.routing?.status || result.status}${result.continuityLost ? ' · 기존 알림 공백 대조 필요' : ''}`
      : `알림목록 확인 보류 · ${result.code}`,
    warnings: [...(result.ok ? [] : [result.code]), ...(result.continuityLost ? [gapWarning] : [])],
  });
  const directory = path.join(os.homedir(), 'ArchiveIN/automation/reports/notification-ingress');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await observeAutomationRun(directory, { ok: result.ok, deferredRead: true,
    errorCode: result.code || '', runFinishedAt: new Date().toISOString() }, event => {
    const recovered = event.type === 'recovery';
    const status = recovered ? (result.continuityLost ? '확인필요' : '성공') : '실패';
    const outcome = recovered ? (result.continuityLost ? '조회 복구 · 기존 알림 공백 미대조' : '조회 복구') : '확인 필요';
    const message = formatOperationsReport({ area: '알림감지', status,
      observedAt: event.observedAt,
      title: 'StudioMate 알림목록 확인', context: 'ARCHIVE CORE / StudioMate 알림 기반 감지',
      conclusion: recovered ? `알림목록 읽기가 복구됐습니다.${result.continuityLost ? ' 기존 알림 공백은 아직 미대조 상태입니다.' : ''}` : '알림목록 읽기가 3회 이상 연속 실패했습니다.',
      key: [`원인 코드: ${event.errorCode}`, '홀딩은 기존 정기 Excel 처리 경로를 사용하며, 그 실행의 정상 여부는 별도 확인합니다.'],
      verification: ['알림목록 조회 상태이며 계약·알림톡 발송 완료를 뜻하지 않습니다.'],
      caution: ['감지 실패 중 변경은 기존 정기 Excel 대조로 확인합니다.', ...(result.continuityLost ? [gapWarning] : [])],
      next: [...(recovered ? [] : ['StudioMate 로그인과 공유 브라우저 잠금 상태를 확인하세요.']),
        ...(result.continuityLost ? [gapNextAction] : recovered ? ['없음'] : [])],
      details: ['https://core.archivepilates.com/automation/'],
    });
    const output = execute(process.execPath,
      ['firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs'], {
        cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GOOGLE_SERVICE_ACCOUNT_KEY: path.join(os.homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json'),
          AUTOMATION_REPORT_FROM: 'home@archivepilates.com', AUTOMATION_REPORT_TO: 'home@archivepilates.com',
          AUTOMATION_REPORT_EVENT_ID: automationHealthEventId('알림감지', event),
          AUTOMATION_REPORT_RECONCILE_ONLY: event.reconcileOnly ? '1' : '0',
          AUTOMATION_REPORT_SUBJECT: `[알림감지][${status}] StudioMate ${outcome} · ${kstTimestamp(event.observedAt).slice(0, 10)}`,
          AUTOMATION_REPORT_LABEL: `자동화 ${status}`, AUTOMATION_REPORT_BODY: message.body },
      });
    return JSON.parse(output);
  });
}
