# ARCHIVE IN 운영자 로그인 권한 오류 원인 분석

작성일: 2026-05-22

## 사건 요약

ARCHIVE IN 운영자 계정 `01029244425`로 로그인하면 운영자 화면 데이터가 보이지 않고, 화면이 강사 모드처럼 보이면서 `Missing or insufficient permissions.` 오류가 발생했다.

## 직접 원인

운영자 대시보드가 새로 읽기 시작한 Firestore 컬렉션 일부가 `firestore.rules`에 운영자 read 권한으로 등록되어 있지 않았다.

문제가 된 컬렉션:

- `privateSurveyResponses`
- `studiomateMemoWriteJobs`
- `alimtalkTemplateStates`
- `opsState`

이 컬렉션 중 하나라도 권한 오류가 나면 `loadAdminHomeFromFirestore()`의 `Promise.all()`이 전체 실패했고, 결과적으로 운영자 홈 화면 전체 로딩이 실패했다.

## 근본 원인

운영자 화면의 데이터 범위가 확장되었지만, Firestore rules와 운영자 화면 read 목록을 함께 검증하는 절차가 없었다.

기존 점검의 한계:

- `firebase deploy --only firestore:rules --dry-run`은 rules 문법 컴파일만 확인한다.
- 특정 운영자 계정이 실제로 운영자 화면의 모든 컬렉션을 읽을 수 있는지는 확인하지 않는다.
- Hosting 배포 후 화면 진입 확인만으로는 Firebase Auth custom claims, Firestore rules, 대시보드 read 목록의 조합 오류를 잡기 어렵다.
- 운영자 화면 로딩 실패 시 `appState.mode` 기본값이 `instructor`라서 실제 원인이 운영자 권한 오류인데도 강사 화면처럼 보이는 혼동이 있었다.

## 적용한 해결

`firebase/kangsain-functions/firestore.rules`에 운영자 read 권한을 추가했다.

- `privateSurveyResponses`: 운영자 + 같은 studioId
- `studiomateMemoWriteJobs`: 운영자 + 같은 studioId
- `alimtalkTemplateStates`: 운영자
- `opsState`: 운영자

운영자 계정 `01029244425`로 라이브 URL에 실제 Firebase Auth custom-token 로그인을 수행해 검증했다.

검증 결과:

- 운영자 타이틀 노출 확인
- 운영 현황/수업 목록/액션 필요 영역 노출 확인
- `Missing or insufficient permissions.` 미노출 확인
- 강사 화면으로 잘못 진입하지 않음 확인

2026-05-22 추가 조치:

- 운영자 판별을 데이터 로딩 전에 먼저 반영하도록 변경했다. 운영자 보조 컬렉션 권한 문제가 재발해도 화면이 강사 모드처럼 보이는 혼동을 줄인다.
- 운영자 홈의 보조 컬렉션 일부(`privateSurveyResponses`, `studiomateMemoWriteJobs`, `alimtalkTemplateStates`)는 권한 오류가 나도 홈 전체가 죽지 않고 빈 목록으로 로딩되도록 방어 처리했다.
- 운영자 검증 스크립트 기본 URL을 실제 ARCHIVE IN 운영 도메인 `https://in.archivepilates.com/`로 변경했다.
- ARCHIVE IN 운영 배포는 `npm run deploy:archivein-live`를 기본 명령으로 사용한다. 이 명령은 Firestore rules dry-run, Firestore rules + Hosting 배포, 운영자 계정 실검증을 한 번에 실행한다.

## 재발 원인 재분석

2026-05-22 20:41 KST 복구 직전 라이브 검증 결과, 운영자 custom token은 `manager / operator_01029244425`로 정상이었지만 아래 컬렉션 read가 permission-denied였다.

- `privateSurveyResponses`
- `studiomateMemoWriteJobs`
- `alimtalkTemplateStates`
- `opsState`

같은 시점 로컬 `firestore.rules`와 브랜치 히스토리에는 해당 권한이 존재했다. 따라서 앱 코드나 운영자 계정 데이터가 다시 깨진 것이 아니라, 라이브 Firestore rules가 로컬 최신 rules와 달랐던 것이 재발 원인이다.

가능성이 높은 운영 원인은 다음 중 하나다.

- rules 변경 커밋은 존재했지만 해당 시점에 Firestore rules 배포가 누락됐다.
- 이후 다른 배포가 Hosting 또는 Functions 중심으로 진행되면서, 운영자 검증 없이 오래된 Firestore rules가 다시 릴리스됐다.
- 배포 후 검증 URL이 예전 `https://archive-pilates.web.app/archivein/` 기준이라 실제 운영 도메인 `https://in.archivepilates.com/`의 운영자 홈 권한 오류를 놓쳤다.

재발 방지는 “배포했는지 기억”에 의존하지 않고, 실제 운영자 계정으로 라이브 앱과 Firestore reads를 검증하는 방식으로 처리한다.

배포 커밋:

- `62ff7b9 fix: allow operator dashboard reads`
- `e89efa7 fix: keep operator dashboard resilient to optional read failures`

## 재발 방지 조치

운영자 대시보드 권한 검증 스크립트를 추가했다.

```bash
source scripts/use-archivein-firebase-service-account.sh >/dev/null
npm run verify:archivein-admin
```

스크립트:

- `scripts/verify-archivein-admin-firestore-access.mjs`

검증 내용:

- 실제 운영자 계정 `p01029244425@archivepilates.com`으로 custom-token 로그인
- 라이브 ARCHIVE IN URL 접속
- 운영자 화면이 정상 렌더링되는지 확인
- 운영자 화면이 읽는 주요 Firestore 컬렉션 read 권한 확인
- 권한 오류 또는 강사 화면 오진입 시 실패 종료

## 앞으로의 운영 규칙

ARCHIVE IN 운영자 화면에서 읽는 Firestore 컬렉션을 추가하거나 변경할 때는 다음을 같이 처리한다.

1. `loadAdminHomeFromFirestore()` 또는 운영자 구독 로직에서 추가된 컬렉션을 확인한다.
2. `firebase/kangsain-functions/firestore.rules`에 운영자 read 규칙이 있는지 확인한다.
3. `scripts/verify-archivein-admin-firestore-access.mjs`의 검증 목록에 새 컬렉션을 추가한다.
4. rules dry-run 또는 배포 후 `npm run verify:archivein-admin`을 실행한다.
5. 운영자 화면 로딩 실패가 재발하면 먼저 “권한 누락 컬렉션”을 의심하고 컬렉션별 read probe로 좁힌다.
6. ARCHIVE IN 운영 배포는 기본적으로 `npm run deploy:archivein-live`를 사용한다. Hosting만 바꾼 것처럼 보여도 운영자 홈 read 목록이나 rules 영향이 있으면 이 명령으로 rules와 운영자 검증을 함께 처리한다.

## 남은 개선안

다음 개선은 별도 작업으로 검토한다.

- 운영자 홈 로딩에서 보조 컬렉션 권한 오류가 나도 핵심 화면은 열리도록 `Promise.allSettled()` 구조로 분리
- 운영자 로딩 실패 메시지를 “운영자 권한/Firestore rules 확인 필요”처럼 더 구체적으로 표시
- 배포 체크리스트에 `verify:archivein-admin`을 필수 항목으로 추가
