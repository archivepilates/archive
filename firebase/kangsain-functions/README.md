# 아카이브 강사IN Firebase Functions

이 폴더는 강사IN을 Google Apps Script 중심 구조에서 Firebase Cloud Functions + Firestore 구조로 전환하기 위한 1차 서버 구현입니다.

## 구조

```text
StudioMate API
  -> Cloud Functions
  -> Firestore
  -> 강사IN 앱
```

## 주요 함수

- `scheduledSyncLecturesDaily`: 매일 00:05 KST, 최근 30일 + 향후 14일 수업/예약 동기화
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

## Secret 설정

배포 전 Firebase Secret Manager에 아래 값을 등록해야 합니다.

```text
STUDIOMATE_LOGIN_ID
STUDIOMATE_LOGIN_PASSWORD
MANAGER_LOGIN_ID
MANAGER_LOGIN_PASSWORD
```

StudioMate API 토큰은 클라이언트에 노출하지 않고 서버 전용 Firestore 문서에 캐시합니다.

## 배포 순서

```bash
cd firebase/kangsain-functions/functions
npm install
npm run build
cd ..
firebase deploy --only functions,firestore:rules,firestore:indexes
```

GitHub Pages 강사IN 프론트는 `/kangsain` 폴더를 사용합니다. 실제 배포 전 `kangsain/firebase-config.example.js`를 복사해 `kangsain/firebase-config.js`를 만들고 Firebase Web App 설정값과 Web Push VAPID key를 입력해야 합니다.

## 검증

현재 코드 기준으로 아래 검증을 통과했습니다.

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
npm run deploy
```

전역 npm이 없는 로컬에서는 repo 루트에서 아래 스크립트로 도구 상태를 확인할 수 있습니다.

```bash
scripts/bootstrap-kangsain-tools.sh
```

## 주의

- 결제 금액, 매출, 정산 정보는 이번 범위에서 저장하지 않습니다.
- 강사 앱의 쓰기 작업은 직접 Firestore write가 아니라 Callable Function과 `writeQueue`를 통해 처리합니다.
- 관리자 알림 API는 `api.manager.studiomate.kr`의 `/api/staff/notice/common`을 사용합니다.
- v2 기준 1차 범위에서 운영자 전달사항, system 자동 태그, 일일 그룹 평균 인원은 제외했습니다.
