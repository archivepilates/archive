# ARCHIVE Systems Health Check Automation

Decision date: 2026-06-22

## Decision

ARCHIVE PILATES 운영 자동화는 Codex cron 대신 Mac mini LaunchAgent를 기본 실행 주체로 둔다.
기존 주간 스모크, 데이터 정합성 감사, E2E 성격의 점검은 `ARCHIVE Systems Health Check`로 통합한다.

## Repeated Failure Patterns Reflected

- 배포 브랜치/작업트리 혼재로 인한 기능 롤백처럼 보이는 회귀
- Firestore rules 또는 관리자 권한 누락으로 운영자 로그인이 빈 데이터/강사 화면처럼 보이는 문제
- StudioMate Excel 원본 최신화 실패로 취소/시간변경 수업이 뒤늦게 반영되는 문제
- `adminSyncRequests`, `onsiteWelcomeRequests`, `studiomateMemoWriteJobs`, `contactSyncJobs`, `writeQueue` stuck 상태
- 프라이빗 예약 취소/시간변경 후 `sessionOrder.privateCumulativeRound`, 강사용 설문, 노션 차트 회차가 어긋나는 문제
- 알림톡 후보에 dedupe/source key가 없어 중복 발송 위험이 생기는 문제
- 정산/대시보드 DB가 Google Drive 정산 결과물과 다른 계산 원천을 보게 되는 문제
- LaunchAgent와 Codex automation이 병행되어 실행 주체가 헷갈리는 문제

## Implementation

- Script: `scripts/run-system-health-check.mjs`
- Daily LaunchAgent: `com.archive.system-health-check`
  - Schedule: every day 08:40 KST
  - Mode: `quick`
  - Repair enabled
- Weekly LaunchAgent: `com.archive.system-health-check-weekly`
  - Schedule: Wednesday 14:30 KST
  - Mode: `weekly`
  - Repair enabled

## Safe Auto Repairs

The health check may automatically perform only low-risk repair actions:

- reload or kickstart a missing/stale LaunchAgent;
- move stale queue documents from stuck `running`/`processing` to `pending` or `retry`;
- trigger stale source or dashboard jobs by LaunchAgent kickstart.

## Forbidden Auto Repairs

The health check must not automatically:

- send real member-facing Kakao Alimtalk;
- create, delete, or change real StudioMate reservations;
- change settlement amounts;
- delete Firestore, Notion, or Google Drive source data;
- deploy Firebase, push Git, change IAM, or modify secrets.

## Firestore Records

- `systemHealthRuns/{runId}` stores each run summary.
- `systemHealthFindings/{findingId}` stores actionable findings.
- `automationStatus/{automationId}` stores the latest automation state shown by operator dashboards.
- `codexActionQueue/{findingId}` stores unresolved `critical` or `action_required` findings that require Codex follow-up.

## Codex Action Queue

Safe auto-repaired findings are not kept as operator tasks.
When a health check still sees a `critical` or `action_required` issue after repair attempts, the same finding id is upserted into `codexActionQueue` with `status=open`.

When a later health check no longer detects that issue, the queue item is marked `resolved` with `resolvedReason=not_detected_in_latest_health_check`.

Codex should run this before starting automation/system-error work:

```bash
npm run codex:queue
```

The queue is evidence for Codex triage. It does not grant permission to run production writes, member-facing sends, deploys, or destructive fixes.

## HohoYoga

HohoYoga monitoring is restored as a separate data-collection automation, not part of ARCHIVE PILATES operational health.

- Script: `scripts/run-hohoyoga-monitor.mjs`
- LaunchAgent: `com.archive.hohoyoga-monitor`
- Schedule: every day 09:00 KST
- Target spreadsheet: `1bP0m8_h6-jMFEHN9-_9LptuLoxZZE4Thbr0Fqpxk6tc`

## Reporting Rule

Routine successes are recorded to Firestore and JSON reports only.
Email is sent only for `critical` or `action_required` findings.

## 2026-07-23 Stabilization

- LaunchAgent checks use both evidence freshness and the actual `last exit code`.
- A command that never starts (`ENOENT`, `status=null`) is a failure, never exit code 0.
- Private session-order reconciliation belongs to the StudioMate Excel sync flow. The health check only verifies residual mismatch and does not start a second reconcile.
- Bookings intentionally excluded by `sessionOrder.counted=false`, superseded state, cancellation, wait state, absence, or late cancellation are not reported as missing rounds.
- Dirty worktrees remain visible in check evidence but do not affect the operational health status.
- The retired ARCHIVE IN operator page is not an active service-health target. Active ARCHIVE IN member/private/welcome routes remain monitored.
- Runtime LaunchAgent source moves to a stable Git worktree under `~/dev`; temporary feature worktrees must not be production runtime paths.
- Worktree cleanup is an interactive Codex maintenance command, not a LaunchAgent. The canonical repository Git metadata is under `Documents`, where background shell access is blocked by macOS TCC.
