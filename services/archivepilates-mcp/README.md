# archivepilates-mcp

ARCHIVE PILATES StudioMate 업무를 위한 맥미니 로컬 MCP입니다. 운영 연결은 조회 전용입니다.

## 현재 상태

- 표준 MCP stdio 연결과 조회 도구 7개를 구현했습니다. 외부 HTTP 포트·별도 모델 호출·추가 스케줄러는 없습니다. 7번째 조건별 조회의 운영 전환은 아래 v2 보고서를 따릅니다.
- 회원 검색·현재 수강권·조건별 만료 목록·회원 예약은 요청 시 맥미니 StudioMate에서 직접 조회합니다. 계약·알림톡·작업은 기존 canonical 원장 조회입니다.
- 계약은 `binding.memberId`, `selection.memberId`, `completion.memberId`와 서명 증거를 구분합니다. 예전 `memberSignupContracts`는 이 도구의 조회 범위가 아닙니다.
- 메모 계획·승인·접수 코드는 격리 테스트만 완료했습니다. 실제 회원 메모 쓰기는 기본 비활성이며 운영 승격 전입니다.
- 기존 자동화와 기존 `archive-ai-server`는 변경하지 않습니다. CORE 챗봇과 이전 중단된 개발본도 사용하지 않습니다.
- 2026-10-15 조회 전용 Codex 등록·운영 소스 승격·인덱스 2개 READY·CORE 운영규칙 배포·명령 시험을 완료했습니다. 증거는 `docs/reports/2026-10-15-archivepilates-mcp-connection.html`을 따릅니다.

## 도구

| 이름 | 기능 |
| --- | --- |
| `members_find` | StudioMate 화면의 이름 또는 전체 휴대폰 번호 완전일치 검색, 검증한 원본 ID 반환 |
| `members_get_overview` | 선택 회원의 현재 수강권·등급·실시간 확인시각 |
| `members_list_expiring` | 기본값은 원본 전체 회원 페이지의 현재 수강권에서 오늘부터 N일 이하 만료 조회. 명시적 snapshot은 저장 목록 |
| `bookings_list` | 기본값은 선택 회원의 최대 31일 원본 예약·출석·취소 이력. 명시적 snapshot은 저장 원장 |
| `contracts_get_progress` | 계약 생성·서명 증거·관측 상태·웰컴 상태 |
| `messages_get_delivery` | 최대 31일 알림톡 후보·발송 원장, 최종 전달 미확인 구분 |
| `operations_get_job` | 허용된 업무 종류와 작업 ID의 상태 |
| `memos_prepare` | 비공개 로컬 메모 계획 작성, 실제 회원 변경 없음 |
| `memos_commit` | 별도 운영자 승인이 있는 메모만 기존 큐 접수, 기본 비활성 |

현재 지원하지 않는 것: 일반 예약 생성·취소, 수강권·홀딩 변경, 새 회원 생성, 계약 재발송, 실제 환불·송금, 알림톡 발송, 임의 URL·브라우저 명령·셸/Firestore 호출.

## 로컬 실행

Node.js 22 이상이 필요합니다. 이 폴더에서 `npm ci --ignore-scripts` 후 실행합니다.

```bash
ARCHIVE_MCP_OPERATOR_STAFF_ID=1979746 npm start
```

`stdout`은 MCP 전용이므로 일반 터미널에서는 대화 화면이 뜨지 않습니다. MCP 클라이언트가 실행·종료하는 구조입니다. 회원 검색·수강권 도구를 호출할 때만 로그인된 공유 브라우저 프로필을 잠금 후 열고 종료합니다. Playwright Chromium이 설치된 맥미니에서 사용합니다.

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
enabled_tools = ["members_find", "members_get_overview", "members_list_expiring", "bookings_list", "contracts_get_progress", "messages_get_delivery", "operations_get_job"]
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

- 회원 검색·현재 수강권은 `https://arcpilates.studiomate.kr`의 렌더링된 화면입니다. 원본 전체 회원 목록과 예약 이력은 화면의 페이지·탭 조작으로 발생한 GET 응답을 최소 필드로 투영합니다. 임의 API 요청·인증 헤더·프레임워크 상태 추출은 하지 않습니다. 검색 요청은 완료 상태만 관찰합니다.
- 명시적 snapshot과 나머지 원천은 `memberProfiles`, `bookings`, `studiomateMembershipContracts`, `alimtalkCandidates/Sends` 및 지정된 feature 작업 원장입니다. `workLanes`, `member360Cards`, `members` 미러는 사용하지 않습니다.
- 전화번호는 기본 마스킹합니다. 생년월일·이메일·설문 원문·메모 원문·서명 이미지·접근 토큰·자유 형식 오류는 조회 결과에 반환하지 않습니다.
- 이름 검색은 화면의 전체 이름 정확 일치입니다. 부분 이름·전화번호 뒤 4자리로 선택하지 않습니다. 전체 이름·전화번호를 대조하고 실제 상세 주소에서 원본 ID를 확인합니다. 검증한 선택은 같은 MCP 세션에서 10분간 보관하며 수강권은 매번 새로 조회합니다. 임시 Excel ID를 원본 ID로 추측하지 않습니다.
- 검증된 Excel ID 연결과 명시적 병합 이력만 사용합니다. 불완전하거나 상충하는 연결은 조회 보류이며 묵시적으로 전체 이력을 확인했다고 하지 않습니다.
- 실시간 결과에는 `liveReadback=true`, `checkedAt`, `elapsedMs`, `coverage`가 붙습니다. 현재 수강권 카드만 조회하며 종료·삭제 이력과 실제 결제 원장을 확인한 것으로 해석하지 않습니다. 화면에 없는 수강권 ID는 만들지 않으며 `ticketIdsAvailable=false`로 표시합니다. 이용기간은 한국 날짜 필드와 ISO 값을 함께 제공합니다.
- 원장 조회의 `syncedAt`은 저장시각입니다. 최신 다운로드와의 직접 연결 증거가 없으므로 `freshness=unknown`, `liveReadback=false`를 유지합니다. 실시간 도구가 실패해도 이 자료로 자동 대체하지 않습니다.
- 실시간 예약은 이용내역의 전체 상태를 수업일 내림차순으로 읽고 요청 시작일을 지난 페이지까지 검증합니다. 총건수·원본 ID·중복·정렬·회원 연결을 대조하며 최대 2,000행 수집·200행 반환, 31일 범위입니다. 취소 이력도 포함하므로 예약예정 0건을 전체 이력 0건으로 해석하지 않습니다. snapshot 예약과 메시지는 기존 날짜 쿼리·인덱스 제한을 유지합니다.
- 조회는 목록당 최대 200개 고유 문서, 원장 호출당 최대 400개 수신 문서로 제한합니다. 한도·권한·인덱스 오류를 빈 목록으로 바꾸지 않습니다.
- 후보 `sent`, 발송 작업 `done`, SOLAPI 메시지 ID는 최종 전달 증거가 아닙니다. 이 버전은 SOLAPI 최종 상태를 새로 조회하지 않습니다.
- 조회 시 Firestore 읽기 비용이 발생할 수 있습니다. MCP 전용 정기 조회·새 클라우드 런타임·모델 API 비용은 추가하지 않습니다.

### 조건별 수강권 조회

`members_list_expiring({daysRemainingMax:10,classType:"all"})`는 기본적으로 StudioMate 전체 회원 원본 페이지의 현재 수강권을 요청 시 조회합니다. `source:"snapshot"`을 명시한 경우만 저장 목록을 사용합니다. 한국 날짜 기준 오늘 만료 0일을 포함합니다. classType은 all/group/private/instructor이며 기존 필터·정지권 제외 정책은 유지합니다.

- Live source: 회원 화면에서 50/page로 전체 페이지를 읽고 페이지별 총수·중복·고유 회원/발급권 ID를 검사합니다. 첫 페이지를 다시 대조합니다. 최대 2,000회원·반환 200회원이며 잘못된 페이지·변경·로그인·잠금·시간초과는 실패로 반환하고 snapshot으로 대체하지 않습니다.
- Live coverage: 원본 회원 총수를 확인하지만 여러 페이지의 조회 구간이며 단일 시점 스냅샷은 아닙니다. `atomicSnapshot=false`, `sourceWindow`, `checkedAt`, `elapsedMs`를 표시합니다. 현재 userTickets 범위이며 종료·삭제 이력 또는 실제 결제 원장이 아닙니다. 동시 수동 변경을 완전히 검출한다고 보장하지 않습니다.
- 아래 캐시·연결 규칙은 명시적 snapshot에만 해당합니다. live 결과는 Firestore에 저장하거나 기존 자동화의 원천으로 승격하지 않습니다.

- Source: `memberProfiles.activeTickets`를 센터 5330으로 제한한 투영 조회. 최대 2,000프로필, 결과 최대 200회원 초과 시 차단합니다. 새로운 Firestore 컬렉션·미러·정기 작업은 생성하지 않습니다.
- Destination: 이 MCP 프로세스의 비공개 메모리에서만 최대 5분 보관. 동시에 들어온 최초 조회는 합치며 실패한 갱신 후 이전 결과로 자동 대체하지 않습니다. `forceRefresh:true`는 Firestore 재조회이지 StudioMate 강제 동기화가 아닙니다.
- Identity: 원본 document ID=memberId와 센터·전체 이름·전화번호를 검사합니다. 병합·삭제 원본은 제외합니다. Excel/native 쌍은 최대20건의 완료된 ID lookup receipt와 이름·전체 전화번호·원본 ID·동일한 해결시각을 확인한 경우만 native 목록을 우선하며 수강권 배열을 합치지 않습니다. 이름이 달라도 전체 전화번호가 겹치거나 native 목록이 불완전하면 별도 확인 대상으로 표시합니다.
- Reader: 매 호출 활성 owner/manager 재확인. 회원별 연락처는 마스킹하며 설문·메모·서명 원문을 반환하지 않습니다.
- Forbidden downstream: 두 모드 모두 목록을 예약·환불·발송·계약·연락처 쓰기의 대상 원천으로 사용하지 않습니다. `allowedForExternalActions=false`를 유지합니다. snapshot은 `liveReadback=false`, `freshness=unknown`, `coverage.liveRosterComplete=false`입니다. 캐시 재조회 시각과 수강권 원천 확인시각을 구분합니다.
- Coverage: 최신 전체 Excel과 직접 연결된 명단 manifest가 없습니다. 누락된 프로필·신분만 보완된 프로필·수강권 미갱신이 있을 수 있습니다. 프로필 timestamp는 수강권 최신 확인시각이 아닙니다. `ticketRowCount`는 저장 표시 행 수이며 실제 구매 건수가 아닙니다. 미래 사용권·빈 횟수·확인 불가 상태를 함께 고려해야 합니다.
- Verification: `node scripts/verify-read-candidate.mjs --live-read-only`와 native-model/native-pages/freshness/ticket-query 테스트, `docs/reports/2026-10-16-mcp-freshness-policy.html`을 따릅니다. 기존 시간별 Excel·발송·연락처·예약 실행기는 변경하지 않습니다.

## 실시간 브라우저 안전장치

- 기존 `~/ArchiveIN/automation/browser-profile`과 공통 `scripts/lib/studiomate-browser-lock.mjs`를 사용합니다. 잠금은 최대 5초 대기 후 `LIVE_BUSY`로 종료하며 실행 중인 동기화를 중지하지 않습니다.
- 처리 예산은 잠금 대기 포함 45초, 종료 확인은 최대 5초입니다. MCP 취소·연결 종료도 브라우저 종료를 요청합니다. 종료를 확인하지 못하면 `LIVE_CLEANUP_REQUIRED`로 알리고 잠금을 유지합니다. 이후 종료가 확인되면 같은 소유 잠금만 해제합니다.
- 모든 작업은 GET/HEAD/OPTIONS만 통과시킵니다. 로그인 POST도 차단하므로 로그인 만료 시 `LIVE_LOGIN_REQUIRED`를 반환하고 맥미니에서 재인증해야 합니다. 로그인 유지나 CAPTCHA 우회를 보장하지 않습니다.
- 수강권은 화면 자체가 요청한 목록의 동일 member_id 응답 완료·성공 상태를 확인하고 화면 통신이 안정된 뒤 새 상세에서 두 번 대조합니다. 응답 본문·인증 헤더는 읽지 않습니다. 로딩 마스크가 잠깐 없다는 이유만으로 빈 목록을 확정하지 않습니다. 조회 중 변경·중복·불완전 목록·잘못된 날짜/횟수·마스킹된 원본 전화번호는 확인필요로 중단합니다. 검색은 화면에 보인 정확 일치 후보만이며 10개 이상은 조회 범위를 줄여야 합니다.
- 브라우저 프로필의 세션 보관 외에 회원·수강권·예약·계약·메모·발송 원장은 변경하지 않습니다. 정기 실행도 추가하지 않습니다.

## 검증

```bash
npm test
npm audit --omit=dev
ARCHIVE_MCP_OPERATOR_STAFF_ID=1979746 npm run smoke -- --live-read-only
npm run smoke -- --live-read-only --registered --require-date-indexes
```

라이브 smoke는 김기효 테스트 계정의 실시간 회원·수강권 2개와 저장 원장 조회 4개, 조건별 조회와 운영 쓰기 차단을 확인합니다. 서버·브라우저·잠금·임시 로컬 상태를 종료·정리합니다. 실제 회원·수강권·예약·메모·발송·스케줄러는 변경하지 않습니다.

## 다음 단계

조회 전용 연결은 구현 커밋 `c5254165`로 배포·검증됐습니다. 등록 설정을 읽은 SDK 시험과 앱 실행기의 자연어 검색→수강권 조회를 모두 확인했습니다. 기존 앱·대화의 도구 목록은 새 연결 또는 앱 재시작이 필요할 수 있습니다. 메모 큐는 별도 승인된 제한 테스트와 보존정책 확정 뒤 활성화합니다. 예약·취소 등 새 쓰기 도구는 각각 원본 읽기·승인·저장·전체 재검증 절차가 완성된 후 추가합니다.

2026-10-16 실시간 조회 소스 `6927f98d`의 main 승격·맥미니 운영 소스 전환·CORE 운영규칙 Hosting 배포·등록 실행기 시험을 완료했습니다. 연결 갱신 후 메인 채팅의 실제 MCP 도구도 `liveReadback=true`를 반환했습니다. 다른 이미 열린 연결이 구버전을 유지하면 다시 연결하고 결과 메타데이터를 확인합니다. 증거는 `docs/tasks/2026-10-15-archivepilates-mcp-live-lookup.md`와 대응 HTML 보고서를 따릅니다.

2026-10-16 초기 v2는 검색 누락·중복 조회를 수정하고 조건별 동기화 조회를 추가했습니다. 이후 실시간 목록 전환은 아래 최신 기록을 따릅니다. 월간 고정예약·수업 복제 실행까지 완료한 것은 아닙니다. 초기 단계의 실측·운영 반영 상태는 `docs/reports/2026-10-16-archivepilates-mcp-operations-v2.html`과 대응 task에 기록합니다.

v2 운영 소스 `cc2a287b`의 main/feature 푸시·기존 맥미니 실행 경로 전환·조회7개 Codex 허용목록·CORE 운영규칙 Hosting 배포·등록 SDK 재검증을 완료했습니다. 서비스161건과 공유 잠금7건, CORE 로컬/라이브 정적 반응형 각각95건이 통과했습니다. 원래 열려 있던 채팅은 MCP 연결을 새로고침해야 새 도구 목록을 사용할 수 있습니다. 기존 쓰기·회원 발송·예약·정기 실행은 변경하지 않았습니다.

2026-10-16 최신 운영 소스 `cc9ac525`는 만료 목록·예약 이력의 기본값을 실시간 원본 조회로 전환했습니다. MCP 234건·잠금 7건·CORE 로컬/라이브 각각95건·등록 stdio 조회7개와 쓰기 차단·GitHub Actions가 통과했습니다. 원본 1,036회원/21페이지를 확인했으며 조회 구간의 순회 완료와 단일 시점 원장 완전성은 구분합니다. CORE 운영규칙 Hosting·맥미니 실행 소스·main/feature 반영 완료입니다. 상세 증거는 `docs/reports/2026-10-16-mcp-freshness-policy.html`과 대응 task를 따릅니다. 기존에 열린 MCP 연결은 다시 연결해야 새 설명과 동작을 사용합니다.
