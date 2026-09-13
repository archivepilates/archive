# ARCHIVE IN Firebase Functions

ARCHIVE IN과 ARCHIVE CORE의 Firebase Cloud Functions 공통 소스입니다. 현재 기준 저장소는 `~/dev/archive-in-runtime`, 기준 브랜치는 `origin/main`입니다. 아래 초기 함수 목록은 전환 이력이며, 현재 배포 소유권과 함수 목록은 루트 `firebase/codebase-boundaries.json`을 확인합니다.

## 구조

```text
StudioMate 회원목록/예약내역 Excel
  -> Mac mini 동기화
  -> Firestore memberProfiles/bookings
  -> Cloud Functions / ARCHIVE CORE / ARCHIVE IN
```

StudioMate API는 정상 운영 동기화 원천이 아닙니다. 운영 규칙은 ARCHIVE CORE > `운영규칙` (`/core/rules/`)을 우선하며, Notion은 기존 차트 연동과 역사 자료로만 유지합니다.

## 초기 구현 함수 목록 (역사 참고)

- `scheduledSyncLecturesDaily`: 매일 00:05 KST, 최근 30일 + 향후 14일 수업/예약 동기화
- `scheduledSyncDashboardDaily`: 매일 00:20 KST, Google Sheets `아카이브 DB`를 Firestore 현황판 데이터마트로 동기화
- `scheduledPollManagerNotices`: 5분마다 StudioMate 관리자 알림 변경분 확인
- `scheduledProcessWriteQueue`: 1분마다 출석/메모 쓰기 큐 처리
- `scheduledAttendanceReminder`: 매시간 출석 미체크 수업 리마인드 푸시
- `getInstructorHome`: 로그인 강사의 14일 앱 화면 데이터 조회
- `getMemberMemoHistory`: 담당 회원 메모 히스토리 + 최근 30일 출석 요약 조회
- `searchMembers`: 담당 회원 이름/전화번호 검색
- `submitBookingAttendance`: 출석/결석 변경 요청
- `submitMemberMemo`: 회원 메모 작성
- `registerFcmToken`: 강사 단말 FCM 토큰 등록
- `adminSyncLecturesRange`: 운영자 수동 기간 동기화
- `adminPollManagerNotices`: 운영자 수동 알림 polling

## 현황판 Firebase 전환

현황판의 기준 원천은 StudioMate API가 아니라 정산 완료된 Google Sheets `아카이브 DB`입니다.

```text
원본 엑셀 데이터
  -> 아카이브 정산 자동화
  -> 아카이브 DB
  -> Cloud Functions
  -> Firestore dashboard 데이터마트
  -> dashboard/ 현황판
```

Firestore에는 운영 화면 호환용 `dashboardSnapshots/current`와 분석용 컬렉션을 함께 저장합니다.

- `dashboardMonthlyMetrics/{YYYY-MM}`
- `dashboardInstructorMetrics/{YYYY-MM}_{강사명}`
- `dashboardTicketMetrics/{YYYY-MM}_{rank}`

Cloud Functions 서비스 계정이 `아카이브 DB` 스프레드시트를 읽을 수 있도록 해당 시트 공유 권한을 부여해야 합니다. 현재 운영 화면은 `dashboardSnapshots/current`를 Firestore에서 직접 읽고, 정기 갱신은 `scheduledSyncDashboardDaily`가 담당합니다.

## Secret 설정 (기존 연동 참고)

기존 연동에서 사용한 Secret 이름은 아래와 같습니다. 이 목록은 현재 배포를 위해 Secret을 생성하거나 변경하라는 지시가 아닙니다. 승인된 대상 함수의 실제 설정을 확인하고 인증·권한 통제를 유지합니다.

```text
STUDIOMATE_LOGIN_ID
STUDIOMATE_LOGIN_PASSWORD
MANAGER_LOGIN_ID
MANAGER_LOGIN_PASSWORD
```

StudioMate API 토큰은 클라이언트에 노출하지 않고 서버 전용 Firestore 문서에 캐시합니다.

## 범위를 지정한 배포

Functions는 `functions-alimtalk`, `functions-private-chart`, `functions-sync`, `functions-app`, `functions-social`의 5개 코드베이스로 분리되어 있습니다. 루트 `firebase.json`을 사용하고, 사용자 승인 후 영향받는 코드베이스를 프로세스별로 하나씩 배포합니다.

```bash
cd ~/dev/archive-in-runtime
npm --prefix firebase/kangsain-functions/functions ci
npm --prefix firebase/kangsain-functions/functions run build
node scripts/detect-affected-function-codebases.mjs --base <base-sha> --head HEAD
```

검토된 변경을 `origin/main`에 승격하고 배포 승인을 받은 뒤 실행합니다.

```bash
npm run deploy:affected-functions:dry -- --base <base-sha> --head HEAD
npm run deploy:affected-functions -- --base <base-sha> --head HEAD
```

루트의 직접 지정 배포(`--only functions:<codebase>`)도 기존 준비·빌드 훅 전에 동일한 predeploy 가드를 실행합니다. 가드는 스크립트 위치에서 저장소 루트를 정하고, Firebase가 전달한 프로젝트(`archive-pilates`), 프로젝트 디렉터리, 코드베이스 소스 디렉터리가 일치하는지 확인합니다. 이후 깨끗한 로컬 `main`, 새로 fetch한 `origin/main`과의 동일성, 기존 live rollback 가드를 요구합니다.

Firebase dry-run도 같은 가드를 통과해야 하며 네트워크 접근이나 API 활성화가 발생할 수 있습니다. 기능 브랜치의 오프라인 검토에는 위의 영향 분석과 아래 테스트를 사용합니다. dry-run 환경변수나 우회 인자로 실제 배포 검증을 생략할 수 없습니다.

이 하위 폴더의 `firebase.json`과 Functions 패키지의 레거시 직접 배포는 `default` 통합 코드베이스를 대상으로 하므로 계속 차단합니다. Functions·Hosting·Firestore 전체를 한 번에 직접 배포하던 예전 안내와 GitHub Pages 배포 안내는 폐기되었습니다. Hosting은 루트의 기존 범위 지정 스크립트를, Firestore는 별도 승인된 rules/indexes 대상만 사용합니다.

ARCHIVE IN 프론트의 회원용 흐름은 `/archivein` 폴더를 사용합니다. 기존 `/kangsain` 경로는 `/archivein`으로 리다이렉트하며, 운영자 도구는 ARCHIVE CORE를 사용합니다. 기존 인증 설정을 유지하고 별도 승인 없이 프로덕션 설정을 덮어쓰지 않습니다.

## 검증

로컬에서 실제 실행한 결과를 기록합니다. 이 문서는 검증 완료 증거가 아닙니다. 루트에서 배포 가드 집중 테스트와 현재 기능 검증을 실행합니다.

```bash
node --test scripts/tests/functions-predeploy.test.mjs
node scripts/validate-live-release-rollback-guards.mjs
node scripts/validate-instructor-lesson-registration-release.mjs
```

Functions 패키지의 기본 검증:

```bash
npm run typecheck
npm run build
npm run format:check
```

## 개발 도구

Functions 폴더에는 빠른 작업을 위해 `firebase-tools`, `typescript`, `tsx`, `eslint`, `prettier`, `npm`을 devDependency로 고정했습니다.

```bash
cd firebase/kangsain-functions/functions
npm install
npm run typecheck
npm run build
npm run format
```

전역 npm이 없는 로컬에서는 repo 루트에서 아래 스크립트로 도구 상태를 확인할 수 있습니다.

```bash
scripts/bootstrap-archivein-tools.sh
```

## 주의

- 결제 금액, 매출, 정산 정보는 이번 범위에서 저장하지 않습니다.
- 강사 앱의 쓰기 작업은 직접 Firestore write가 아니라 Callable Function과 `writeQueue`를 통해 처리합니다.
- 관리자 알림 API는 `api.manager.studiomate.kr`의 `/api/staff/notice/common`을 사용합니다.
- v2 기준 1차 범위에서 운영자 전달사항, system 자동 태그, 일일 그룹 평균 인원은 제외했습니다.
