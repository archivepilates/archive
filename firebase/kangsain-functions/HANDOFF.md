# 아카이브IN 프로젝트 핸드오프

마지막 업데이트: 2026-05-05

## 목적

아카이브IN은 아카이브필라테스 강사용 수업 확인/출결/메모 앱이다. 초기 Google Apps Script + Google Drive 구조에서 Firebase Storage/Firestore/Cloud Functions 기반으로 전환 중이다.

현재 운영 방향은 스튜디오메이트 API를 직접 앱에서 매번 호출하지 않고, 서버가 스튜디오메이트 데이터를 주기적으로 가져와 Firestore 캐시/뷰로 가공한 뒤 앱이 빠르게 읽는 구조다.

## 배포 위치

- 웹앱: `kangsain/`
- Firebase Functions: `firebase/kangsain-functions/functions/`
- Firebase rules/indexes: `firebase/kangsain-functions/`
- GitHub Pages URL: `https://archivepilates.github.io/archive/kangsain/`
- Firebase project: `archive-pilates`
- Functions region: `asia-northeast3`
- Firestore location: `asia-northeast3`

## 현재 구현 상태

- Firebase Auth 이메일 로그인 동작.
- 테스트용 계정은 Firebase Auth에 생성되어 있고 `staffs/2222464` 정은영 강사와 연결되어 있다.
- Google 로그인은 Firebase OAuth 클라이언트 설정 전이라 로그인 화면에서는 숨겼다.
- 앱 첫 로딩은 callable 함수가 아니라 Firestore의 `staffs/{staffId}` 및 `instructorViews/{staffId}_{date}`를 직접 읽는다.
- 출석/결석/메모 입력은 Firestore에 optimistic write 후 `writeQueue`에 작업을 넣고, `scheduledProcessWriteQueue`가 스튜디오메이트 API로 전송한다.
- 스튜디오메이트 기존 회원 메모는 `/v2/staff/memo?ref_id={memberId}&ref_type=member`에서 받아 `memberMemos`에 `studiomate_{memoId}`로 동기화한다. 앱 히스토리는 Firestore `memberMemos`를 읽는다.
- Cloud Run callable 공개 invoker는 조직 정책상 `allUsers` 권한 부여가 막혀 있어 앱의 주 경로에서 의존하지 않도록 조정했다.
- 30일 출석/결석 태그는 서버 집계 기반으로 `30일 출석 N회`, `30일 결석 N회`를 분리해 표시한다.
- 출석/결석 처리는 예약확정 회원이면서 수업 시작시간 이후인 경우에만 가능하다.
- 예약대기 회원은 출석/결석 버튼이 비활성화된다.
- 취소/대기취소 예약은 수업 카드에서 숨긴다.
- 그룹수업 회원에게는 수강권명/잔여횟수를 숨긴다.
- 프라이빗 수업 회원은 수강권명/잔여횟수를 표시한다.
- 수업 카드는 날짜 진입 시 기본 닫힘 상태이며, 수업 헤더 클릭으로 펼친다.
- 수업 시간은 Asia/Seoul 기준으로 `08:00-08:50` 형태로 표시한다.
- 앱 명칭은 `아카이브IN`으로 확정했다. 로그인 화면에는 `ARCHIVE IN` 브랜드 텍스트를 표시한다.
- `scheduledSyncLecturesDaily` 실행 시 `rebuildMemberInsights`가 회원 태그를 자동 생성한다.
- 자동 태그 1단계는 규칙 기반이다: 30일 출석/결석, 메모 통증 키워드, 최근 출석 10회 기준 강사/시간대 패턴.
- 강사용 앱의 회원 태그 표시는 30일 출석/결석 태그만 노출한다. 통증/최근강사/시간대 패턴 태그는 운영자 앱에서 다룬다.
- 강사용 앱은 14일치 `instructorViews`를 Firestore 실시간 구독한다. 알림 API 폴링으로 특정 수업/날짜가 갱신되면 앱 새로고침 없이 해당 날짜 뷰가 교체된다.
- 앱 확인 URL은 Firebase Hosting `https://archive-pilates.web.app/kangsain/`를 우선 사용한다. GitHub Pages legacy build가 간헐적으로 멈춰 Firebase Hosting으로 정적 파일을 배포했다.

## 스튜디오메이트 수업구분

중요: 수업구분은 정원으로 판단하지 않는다.

원본 `/v2/staff/lectures` 응답에서 확인한 필드:

- `type: "G"`: 그룹
- `type: "P"`: 프라이빗
- `course.type`에도 동일 값이 내려온다.

현재 정규화 우선순위:

1. `raw.type`
2. `raw.course?.type`
3. `raw.class_type`
4. `raw.lesson_type`
5. `raw.lecture_type`
6. `division.type`
7. `division.name`
8. `raw.division`
9. `raw.title`

정원 `max_trainee`는 수업구분 fallback으로 쓰지 않는다. 프라이빗 중 정원이 1명 이상인 경우가 있기 때문이다.

## 캐시/동기화

스케줄:

- `scheduledSyncLecturesDaily`: 매일 00:05 KST, 최근 30일 ~ 향후 14일 동기화.
- `scheduledPollManagerNotices`: 1분마다 스튜디오메이트 관리자 알림 확인.
- `scheduledProcessWriteQueue`: 1분마다 앱 입력 큐 처리.
- `scheduledAttendanceReminder`: 매시 정각 출석 미체크 알림.
- `rebuildMemberInsights`: 매일 동기화 범위의 예약/메모를 분석해 `memberTags`를 갱신.

캐시 보정 이력:

- 2026-05-05에 스튜디오메이트 원본 478개 수업을 `type` 기준으로 확인.
- 그룹 352개, 프라이빗 126개로 Firestore `lectures` 및 `instructorViews` 캐시를 즉시 보정했다.

## 최근 주요 커밋

- `c38c188`: 스튜디오메이트 `type` 기준 수업구분 적용.
- `577c5de`: 수업시간 KST 표시 및 수업 카드 기본 닫힘 처리.
- `4317433`: 테스트 로그인 화면 정리.
- `bf9efc1`: 취소 예약 숨김 및 그룹수업 수강권 정보 숨김.
- `06fc509`: 출석/메모 입력을 Firestore queue 방식으로 전환.
- `6eec928`: 앱 홈 데이터를 Firestore 캐시에서 직접 로드.

## 테스트 방법

1. `https://archivepilates.github.io/archive/kangsain/index.html?v=<latest-commit>` 접속.
2. 테스트 로그인은 이메일/비밀번호 방식 사용.
3. 로그인 후 정은영 강사 화면에서 날짜 이동.
4. 확인 항목:
   - 수업 시간이 실제 KST 시간과 맞는지.
   - CLASSES 요약에 그룹/프라이빗 수가 맞는지.
   - 각 수업 카드의 그룹/프라이빗 칩이 맞는지.
   - 날짜 진입 시 수업 카드가 기본 닫힘인지.
   - 수업 헤더 클릭 시 회원 목록이 펼쳐지는지.
   - 예약대기 회원 출석/결석 버튼이 disabled인지.
   - 취소 예약이 목록에서 숨겨지는지.

## 주의사항

- 이 문서에는 비밀번호/토큰/개인 인증값을 남기지 않는다.
- `kangsain/index 2.html`은 작업 중 생긴 untracked 파일로 보이며 현재 코드 작업에서는 건드리지 않았다.
- Firebase Functions 배포 시 Node.js 20 런타임 지원 종료 경고가 나온다. 이후 Node 22 업그레이드가 필요할 수 있다.
- `firebase-functions` 의존성도 구버전 경고가 나온다. 업그레이드는 breaking change 확인 후 별도 진행한다.

## 다음 작업 후보

- Google Workspace 로그인 설정 완성.
- MEMBERS 요약을 총 예약 수가 아니라 그룹수업 평균 출석 인원으로 재수정.
- 출석/메모 writeQueue 처리 결과를 앱에서 pending/synced/failed 상태로 더 명확하게 표시.
- 프라이빗/그룹 수업별 회원 정보 표시 규칙 추가 정리.
- 운영자 앱 설계 및 Firebase 기반 자동화 알림 확장.
