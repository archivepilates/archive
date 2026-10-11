import { formatOperationsReport } from './operations-email-format.mjs';

export function systemHealthEmail(summary, reportPath) {
  const findings = summary.findings.slice(0, 6);
  return formatOperationsReport({
    area: '시스템점검', status: summary.status === 'critical' ? '긴급' : '확인필요',
    title: `${summary.criticalCount ? '긴급' : '점검 필요'} ${summary.findingCount}건`,
    observedAt: summary.finishedAt, context: 'Mac mini 시스템 점검 자동화',
    conclusion: `${summary.findingCount}건 감지 · 직접 복구 ${summary.repairedCount}건 · 재실행 요청 ${summary.restartRequestedCount}건입니다.`,
    key: [`긴급 ${summary.criticalCount}건 · 확인필요 ${summary.actionRequiredCount}건 · 경고 ${summary.warningCount}건`,
      ...findings.flatMap(item => [`${item.title}: ${item.cause}`,
        ...(String(item.cause).match(/member_coverage_review_(\d+)/) ? ['설명: 최신 Excel에서 기존 회원의 수강권 행이 줄어 해당 회원만 원천 검토합니다. 다른 신규회원 감지는 유지합니다.'] : []),
        `영향: ${item.impact || '원천 상태 확인 필요'}`])],
    verification: [`공개 화면 점검은 로그인 후 기능 성공을 의미하지 않습니다. 모드: ${summary.mode}${summary.repair ? ' / repair' : ''}`, `실행 리포트: ${reportPath}`, `Firestore: systemHealthRuns/${summary.runId}`],
    caution: ['재실행 요청은 복구 완료가 아닙니다. 실제 정상 반영 결과로 재검증합니다.', '회원 발송·예약 생성/삭제·정산 금액 변경은 자동복구 대상에서 제외합니다.'],
    next: findings.map(item => `${item.title}: ${item.suggestedAction || '원천 자료와 실행 기록을 확인하세요.'}`),
    details: ['https://core.archivepilates.com/automation/'],
  });
}
