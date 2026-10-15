# archivepilates-mcp

ARCHIVE PILATES StudioMate 업무를 위한 맥미니 로컬 MCP입니다. 운영 연결은 조회 전용입니다.

## 현재 상태

- 표준 MCP stdio 연결과 조회 도구 6개를 구현했습니다. 외부 HTTP 포트·별도 모델 호출·추가 스케줄러는 없습니다.
- 회원·예약은 기존 canonical 동기화 원장 조회입니다. StudioMate 화면의 실시간 조회가 아닙니다.
- 계약은 `binding.memberId`, `selection.memberId`, `completion.memberId`와 서명 증거를 구분합니다. 예전 `memberSignupContracts`는 이 도구의 조회 범위가 아닙니다.
- 메모 계획·승인·접수 코드는 격리 테스트만 완료했습니다. 실제 회원 메모 쓰기는 기본 비활성이며 운영 승격 전입니다.
- 기존 자동화와 기존 `archive-ai-server`는 변경하지 않습니다. CORE 챗봇과 이전 중단된 개발본도 사용하지 않습니다.
- 2026-10-15 조회 전용 Codex 등록·운영 소스 승격·인덱스 2개 READY·CORE 운영규칙 배포·명령 시험을 완료했습니다. 증거는 `docs/reports/2026-10-15-archivepilates-mcp-connection.html`을 따릅니다.

## 도구

| 이름 | 기능 |
| --- | --- |
| `members_find` | 이름 또는 전체 휴대폰 번호 완전일치 검색, 동명이인 후보 반환 |
| `members_get_overview` | 선택 회원의 수강권·등급·저장 기준시각 |
| `bookings_list` | 최대 31일 예약 원장, 대체·fallback 표시 |
| `contracts_get_progress` | 계약 생성·서명 증거·관측 상태·웰컴 상태 |
| `messages_get_delivery` | 최대 31일 알림톡 후보·발송 원장, 최종 전달 미확인 구분 |
| `operations_get_job` | 허용된 업무 종류와 작업 ID의 상태 |
| `memos_prepare` | 비공개 로컬 메모 계획 작성, 실제 회원 변경 없음 |
| `memos_commit` | 별도 운영자 승인이 있는 메모만 기존 큐 접수, 기본 비활성 |

현재 지원하지 않는 것: 일반 예약 생성·취소, 수강권·홀딩 변경, 새 회원 생성, 계약 재발송, 실제 환불·송금, 알림톡 발송, 브라우저 직접 실행, 임의 셸/Firestore 호출.

## 로컬 실행

Node.js 22 이상이 필요합니다. 이 폴더에서 `npm ci --ignore-scripts` 후 실행합니다.

```bash
ARCHIVE_MCP_OPERATOR_STAFF_ID=1979746 npm start
```

`stdout`은 MCP 전용이므로 일반 터미널에서는 대화 화면이 뜨지 않습니다. MCP 클라이언트가 실행·종료하는 구조입니다. 이미 로그인된 브라우저를 자동으로 열지 않습니다.

- Firebase 프로젝트: `archive-pilates`
- 계정: `archive-codex-operator@archive-pilates.iam.gserviceaccount.com`
- 기본 키 위치: `~/ArchiveIN/secrets/google/archive-codex-operator.json`. 키를 복사·커밋·응답에 반환하지 않습니다.
- 운영자: `staffs/{ARCHIVE_MCP_OPERATOR_STAFF_ID}`의 활성 owner/manager를 매 도구 호출마다 재확인합니다.
- 이 로컬 서버의 인증 경계는 맥미니 OS 계정과 허용된 MCP 실행 설정입니다. CORE 강사 로그인용 서버가 아니며 원격 HTTP로 노출하면 안 됩니다.
- 현재 기존 서비스 계정을 사용합니다. read-only는 애플리케이션 경계이며 해당 계정의 IAM 자체가 조회 전용이라는 뜻은 아닙니다. 외부 공개·다중 사용자 전환 전에는 전용 최소권한 계정과 사용자 인증 설계가 필요합니다.

맥미니 Codex의 운영 등록 설정은 다음 정책을 사용합니다. 실행 경로는 `~/dev/archive-in-runtime/services/archivepilates-mcp/src/index.mjs`입니다. 서버도 기본 조회 전용이므로 클라이언트 제한만 우회해 쓰기 도구를 호출할 수 없습니다.

```toml
[mcp_servers.archivepilates-mcp]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/repo/services/archivepilates-mcp/src/index.mjs"]
enabled_tools = ["members_find", "members_get_overview", "bookings_list", "contracts_get_progress", "messages_get_delivery", "operations_get_job"]
tool_timeout_sec = 60

[mcp_servers.archivepilates-mcp.env]
ARCHIVE_MCP_OPERATOR_STAFF_ID = "1979746"
ARCHIVE_MCP_ENABLE_MEMO_WRITES = "false"
ARCHIVE_MCP_READ_ONLY = "true"
```

## 메모 승인과 실행 경계

1. `memos_prepare`는 회원·내용·원본 해시를 10분 유효한 비공개 로컬 계획으로 저장합니다. 승인이나 회원 원장 저장이 아닙니다.
2. 실제 운영자가 직접 연 터미널에서 `npm run approve:memo -- <proposalId>`를 실행하고 화면에 나온 대상·내용을 확인합니다. 자동화가 사용자 대신 승인하거나 TTY를 만들어 입력해서는 안 됩니다.
3. 계획 내용·운영자·만료시간에 묶인 승인 파일이 있어야 `memos_commit`이 허용됩니다. 모델이 `approved=true`를 넘기는 방식은 지원하지 않습니다.
4. `ARCHIVE_MCP_ENABLE_MEMO_WRITES=true`와 별도 검증·승격 표시가 모두 있어야 접수할 수 있습니다. 개발본에서는 켜지 않습니다.
5. 직접 숫자 ID의 canonical 회원만 허용합니다. 임시 Excel ID와 불완전 연결은 쓰기 대상에서 제외합니다. 최근 저장시각은 보수적 차단 조건이며 실시간 원본 검증 증거가 아닙니다.
6. 트랜잭션에서 운영자 권한과 회원 원본 해시를 재확인하고 `memberMemos`·`studiomateMemoWriteJobs`를 함께 생성합니다. 같은 회원·같은 내용은 날짜·실행 횟수와 무관한 같은 키를 사용합니다.
7. 기존 작업이 failed/processing이어도 자동 재접수하지 않습니다. 원장 한쪽만 있으면 보류합니다. 응답이 불명확하면 먼저 작업 ID로 조회합니다.
8. 실제 StudioMate 쓰기는 기존 메모 실행기만 수행하며 기존 공유 브라우저 잠금을 사용합니다. MCP는 해당 실행기를 직접 실행하거나 스케줄러를 추가하지 않습니다.

기존 실행기의 자체 구현은 변경하지 않았습니다. 큐 스키마 호환 검증과 mock 트랜잭션 테스트는 실제 메모 저장·전체 브라우저 E2E 성공을 뜻하지 않습니다. 운영 활성화 전 별도 승인된 테스트가 필요합니다.

로컬 승인 파일은 `~/ArchiveIN/automation/archivepilates-mcp`에 디렉터리 0700/파일 0600으로 생성됩니다. 내용에 회원 메모가 포함되므로 공유·백업 공개를 금지합니다. 10분이 지나면 실행할 수 없지만 자동 삭제 주기는 아직 없습니다. 운영 승격 시 보존·폐기 절차를 확정해야 합니다.

## 데이터·비용·결과 해석

- 원천은 `memberProfiles`, `bookings`, `studiomateMembershipContracts`, `alimtalkCandidates/Sends` 및 지정된 feature 작업 원장입니다. `workLanes`, `member360Cards`, `members` 미러는 사용하지 않습니다.
- 전화번호는 기본 마스킹합니다. 생년월일·이메일·설문 원문·메모 원문·서명 이미지·접근 토큰·자유 형식 오류는 조회 결과에 반환하지 않습니다.
- 현재 이름 검색은 정확히 저장된 이름 기준입니다. 부분 이름·별명·국가번호 변형 검색은 후순위입니다.
- 검증된 Excel ID 연결과 명시적 병합 이력만 사용합니다. 불완전하거나 상충하는 연결은 조회 보류이며 묵시적으로 전체 이력을 확인했다고 하지 않습니다.
- 기록의 `syncedAt`은 저장시각입니다. 최신 다운로드와의 직접 연결 증거가 없으므로 `freshness=unknown`, `liveReadback=false`를 반환합니다.
- 예약은 기간을 서버 쿼리에 적용합니다. 메시지는 생성시각의 한국 날짜를 원본 쿼리에 적용합니다. 두 복합 인덱스는 운영 READY 및 실제 날짜 쿼리 성공을 확인했습니다. 인덱스가 없을 때만 기존 회원 이력을 엄격한 한도로 읽는 호환 경로를 쓰며 `coverage.needsIndexDeployment=true`로 표시합니다. 이 경로에서 한도를 넘으면 날짜 축소 대신 인덱스 배포 필요로 차단합니다. 다른 권한·통신 오류에는 대체 조회하지 않습니다.
- 조회는 목록당 최대 200개 고유 문서, 원장 호출당 최대 400개 수신 문서로 제한합니다. 한도·권한·인덱스 오류를 빈 목록으로 바꾸지 않습니다.
- 후보 `sent`, 발송 작업 `done`, SOLAPI 메시지 ID는 최종 전달 증거가 아닙니다. 이 버전은 SOLAPI 최종 상태를 새로 조회하지 않습니다.
- 조회 시 Firestore 읽기 비용이 발생할 수 있습니다. MCP 전용 정기 조회·새 클라우드 런타임·모델 API 비용은 추가하지 않습니다.

## 검증

```bash
npm test
npm audit --omit=dev
ARCHIVE_MCP_OPERATOR_STAFF_ID=1979746 npm run smoke -- --live-read-only
npm run smoke -- --live-read-only --registered --require-date-indexes
```

라이브 smoke는 김기효 테스트 프로필의 조회 도구 6개와 운영 쓰기 차단만 확인합니다. 서버와 임시 로컬 상태를 종료·정리합니다. 실제 회원·수강권·예약·메모·발송·스케줄러는 변경하지 않습니다.

## 다음 단계

조회 전용 연결은 구현 커밋 `c5254165`로 배포·검증됐습니다. 등록 설정을 읽은 SDK 시험과 앱 실행기의 자연어 검색→수강권 조회를 모두 확인했습니다. 기존 앱·대화의 도구 목록은 새 연결 또는 앱 재시작이 필요할 수 있습니다. 메모 큐는 별도 승인된 제한 테스트와 보존정책 확정 뒤 활성화합니다. 예약·취소 등 새 쓰기 도구는 각각 원본 읽기·승인·저장·전체 재검증 절차가 완성된 후 추가합니다.
