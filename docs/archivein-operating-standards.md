# ARCHIVE IN 운영 기준 초안

마지막 업데이트: 2026-05-14

## 1. 제품 원칙

ARCHIVE IN은 StudioMate 대체제가 아니다. 예약, 출결, 회원 원장 전체를 복제하는 범용 운영 시스템이 아니라, ARCHIVE PILATES의 운영 판단과 회원 케어를 빠르게 돕는 맞춤 도구로 본다.

운영 기준은 아래 우선순위를 따른다.

1. ARCHIVE PILATES 현장 운영자가 오늘 처리해야 할 일을 빠르게 판단한다.
2. 강사가 수업 직전 회원 상태와 주의사항을 놓치지 않는다.
3. ACTIONS는 실제 후속 조치로 이어질 후보만 보여준다.
4. StudioMate, 아카이브DB, Firebase 캐시, 맥미니 자동화의 역할을 섞지 않는다.
5. 모바일에서 강사와 운영자가 실제로 쓰기 쉬운지를 주요 품질 기준으로 둔다.

## 2. 역할별 화면 깊이

### 운영자

운영자 화면은 회원 케어와 매출/이탈 리스크 판단에 필요한 넓은 정보를 다룬다.

- 회원 연락처 및 식별 정보
- 활성 수강권, 만료일, 잔여 횟수
- 최근 30일 예약/출석/결석 패턴
- 장기 미방문, 출석 감소, 잔여 횟수 부족, 만료 임박 등 리스크
- 상담 후 등록 전환 여부
- 누적 매출이나 정산성 지표가 필요한 경우 아카이브DB 기준으로만 표시
- 운영 메모, 알림톡 발송 이력, 후속 처리 상태

운영자용 회원카드는 "지금 연락하거나 조치해야 하는가"를 판단할 수 있어야 한다.

### 강사

강사용 화면은 수업 준비와 안전한 티칭에 필요한 정보로 제한한다.

- 오늘/선택일 수업 목록
- 수업별 예약 확정 회원
- 회원별 건강 이슈, 통증 키워드, 임신/산후, 강도 조절 필요 여부
- 최근 수업 메모 요약
- 최근 출석/결석 흐름 중 티칭에 필요한 범위
- 강사가 직접 남겨야 할 수업 메모와 출결 처리 상태

강사용 회원카드는 결제, 정산, 과도한 운영 리스크 정보를 기본 노출하지 않는다.

## 3. ACTIONS 운영 기준

ACTIONS는 단순 경고 목록이 아니라 운영자가 검토하고 실행할 수 있는 의미 있는 후보 목록이어야 한다. 각 ACTION은 근거, 추천 조치, 대상, 실행 후 기록이 함께 있어야 한다.

우선 후보 유형:

- 수강권 만료 임박
- 잔여 횟수 부족
- 활성 수강권이 있는데 장기 미방문
- 최근 출석 빈도 급감
- 신규 회원 첫 30일 케어 필요
- 상담 후 등록 전환 follow-up 필요
- 예약률이 낮은 수업 또는 반복적으로 취소가 많은 수업
- 결석/취소 패턴이 회원 케어가 필요한 수준으로 변화

제외하거나 후순위로 둘 항목:

- 운영자가 당장 조치할 수 없는 단순 통계
- 너무 먼 미래의 만료/소진 예측
- 같은 회원에게 반복적으로 뜨는 중복 경고
- 근거 데이터가 불명확한 후보

### 알림톡 연결 기준

ACTIONS는 카카오 알림톡 자동화와 자연스럽게 연결될 수 있어야 한다.

권장 흐름:

1. 서버가 ACTION 후보를 계산한다.
2. 운영자가 ARCHIVE IN에서 후보와 근거를 검토한다.
3. 운영자가 발송 대상과 메시지 유형을 확정한다.
4. ARCHIVE IN이 추천 메시지 템플릿과 개인화 맥락을 보여준다.
5. 발송 버튼은 알림톡 자동화로 연결한다.
6. 발송 결과, 시간, 템플릿, 대상 회원, 후속 상태를 ARCHIVE IN에 기록한다.

자동 발송은 기본값으로 두지 않는다. 초안 단계에서는 운영자 검토 후 발송을 기준으로 한다.

## 4. 데이터 원천과 동기화 구분

ARCHIVE IN은 데이터 원천별 책임을 명확히 나눈다.

| 구분 | 역할 | 사용 예 | 주의사항 |
| --- | --- | --- | --- |
| StudioMate 엑셀 다운로드 | 기본 수업/예약/회원 운영 원천 | 강사용 수업 목록, 예약 상태, 회원카드, 수강권, 알림톡 후보 | 자사 사이트 운영 전까지 API 대신 기본 동기화 방식으로 사용한다. |
| StudioMate API | 보류 중인 과거/대기 경로 | 자사 사이트 운영 이후 재검토 | 평상시 ARCHIVE IN 운영에서는 사용하지 않는다. |
| Firebase Firestore 캐시 | 앱이 빠르게 읽는 운영 뷰와 처리 상태 | `instructorViews`, `memberProfiles`, 회원 태그, write queue, ACTION 후보 | 캐시가 원천이라고 착각하지 않는다. 동기화 시각과 근거를 함께 본다. |
| Google 주소록 | 전화 발신/검색/운영 커뮤니케이션 보조 저장소 | `home@archivepilates.com` 연락처 | 회원 원천이 아니다. StudioMate 엑셀 동기화로 갱신된 `memberProfiles`와 상담 연락처를 기준으로 동기화한다. |
| 아카이브DB | 정산/월별 분석/운영 지표의 기준 데이터 | 월별 유효회원, 매출성 지표, 정산 후 데이터마트 | StudioMate 실시간 상태와 다를 수 있다. 정산 완료 기준임을 표시한다. |
| 맥미니 자동화 | StudioMate 엑셀/관리자 흐름 보조 자동화 | 엑셀 다운로드, Drive 정리, 아카이브DB 갱신 보조 | 자동화 실패나 지연을 Firebase 장애로 오해하지 않는다. |

동기화 이슈를 조사할 때는 "어느 원천에서 틀렸는지"를 먼저 분리한다.

### 회원 프로필/연락처 동기화 기준

회원카드 연락처, Google 주소록, 알림톡 발송 대상은 모두 같은 StudioMate 엑셀 동기화 결과를 기준으로 한다. 엑셀에서 내려받은 회원명단과 앱 회원카드가 서로 다른 기준으로 움직이면 동명이인, 연락처 변경, 신규회원 판단이 꼬이기 쉽다.

기준 흐름:

1. StudioMate 웹에서 회원목록 엑셀을 내려받는다.
2. Firestore `memberProfiles/{memberId}`에 회원명, 연락처, 등록일, 활성 수강권 요약, 갱신 시각을 저장한다.
3. 앱 회원카드는 역할에 따라 같은 `memberProfiles`를 다르게 보여준다.
4. Google 주소록 동기화는 `memberContactIndex/{memberId}`와 `contactSyncJobs`를 통해 처리한다.
5. 알림톡 후보 산정은 같은 회원 프로필과 수강권/출석 요약을 사용한다.

회원 매칭은 `memberId -> 전화번호 -> 이름` 순서로만 허용한다. 같은 이름이 여러 명이면 전화번호 또는 `memberId`가 확인되기 전까지 출결 30일 요약, 수강권, 알림톡 후보, 주소록 상태를 한 카드로 합치지 않는다.

2026-05-15 이후 주소록 기준 계정은 `home@archivepilates.com` 하나로 통일한다. `archivepilates@gmail.com` 주소록은 과거 자동화 대상/이관 원본으로만 본다. 단, Google 주소록 자체는 보조 저장소이므로 앱 표시의 원천으로 삼지 않는다.

Firebase 주소록 동기화는 `home@archivepilates.com`을 Google People API 위임 대상으로 사용한다. Mac mini에 남아 있는 `archivepilates@gmail.com` 기준 자동화는 더 이상 운영 기준이 아니며, 실행이 필요하면 `home@archivepilates.com` 기준으로 수정한 뒤 사용한다. 기존 자동화의 dry-run, 신규 생성 10건 이하, 수정 50건 이하, Google-only 연락처 삭제 금지 원칙은 유지한다.

앱 내 채팅 기능은 사용도가 낮아 운영 화면에서 숨긴다. 숨김 상태에서는 채팅 실시간 구독도 시작하지 않아 Firestore 읽기 사용량을 줄인다.

### 운영자 화면 Firestore 권한 변경 기준

운영자 화면이 읽는 Firestore 컬렉션을 추가하거나 변경하면 앱 코드와 Firestore rules를 같은 변경 단위로 본다. `loadAdminHomeFromFirestore()` 또는 운영자 실시간 구독에서 새 컬렉션을 읽기 시작했는데 rules가 따라오지 않으면 운영자 화면 전체가 `Missing or insufficient permissions.`로 실패할 수 있다.

필수 점검:

1. 운영자 화면 read 목록과 `firebase/kangsain-functions/firestore.rules`의 `isManager()` 허용 범위를 대조한다.
2. 새 운영자 read 컬렉션은 `scripts/verify-archivein-admin-firestore-access.mjs` 검증 목록에 추가한다.
3. Firestore rules 변경 또는 운영자 대시보드 데이터 변경 후에는 `npm run verify:archivein-admin`을 실행한다.
4. 검증은 `01029244425` 운영자 계정 기준으로 라이브 또는 배포 대상 URL에서 수행한다.

### 엑셀 동기화 수동 실행 기준

운영자 모드의 수동 동기화 버튼은 API 동기화를 직접 실행하지 않는다. 버튼은 `adminSyncRequests`에 `requestMode: emergency_excel` 요청을 만들고, 맥미니 LaunchAgent `com.archive.archivein-admin-emergency-sync`가 요청을 받아 엑셀 다운로드와 Firestore 반영을 수행한다. 내부 식별자 `emergency_excel`은 호환을 위해 유지하지만, 운영상 의미는 기본 엑셀 동기화 모드다.

수동 동기화 중에는 버튼을 잠그고 진행률을 표시한다. 같은 요청이 `pending` 또는 `running` 상태이면 새 요청을 만들지 않고 기존 요청을 추적한다. 운영자는 진행률이 완료 또는 실패로 바뀔 때까지 버튼을 반복해서 누르지 않는다.

점검 순서:

1. 화면에서 보이는 값과 기준 날짜/시간을 확인한다.
2. Firebase 캐시 문서의 갱신 시각과 원천 참조를 확인한다.
3. StudioMate 웹 엑셀 원본과 비교한다.
4. 아카이브DB 기준 지표라면 시트 갱신 시각과 정산 기준을 확인한다.
5. 맥미니 자동화가 필요한 흐름이면 자동화 실행 로그와 결과 파일을 확인한다.

### 월말 정산 자동화

맥미니 LaunchAgent `com.archive.monthly-settlement-statements`는 매월 1일 09:30에 전월 `YYYYMM` 기준으로 `scripts/generate-monthly-settlement-statements.mjs --apply`를 실행한다.

이 스크립트는 `월별정산백업/아카이브 정산_YYYY-MM.gsheet`가 있으면 서비스계정으로 xlsx export 후 `아카이브 월말정산/YYYYMM`에 `아카이브 정산 YYYYMM.xlsx`, `아카이브 정산명세서 YYYYMM.xlsx`, 강사별 HTML 명세서와 INDEX를 생성한다. 백업 gsheet가 아직 없으면 `수업매출원본데이터`의 전월 전체 범위 파일을 사용해 정산 workbook을 생성한 뒤 같은 명세서 생성 과정을 진행한다.

강사레슨 정산은 프라이빗 정산 요율을 그대로 적용한다. 강사레슨 별도 요율표나 그룹식 1회 고정 보수로 계산하지 않는다. 여러 회원이 참여한 강사레슨은 같은 세션 안의 참여자별 정산대상 행보수를 모두 합산하고, 세션 수는 수업 1건으로만 센다.

실패 시 우선 확인 순서는 `~/ArchiveIN/emergency/logs/monthly-settlement-statements.err.log`, 전월 전체 범위 원본 엑셀, 월별정산백업 gsheet, `아카이브 월말정산/YYYYMM` 출력물이다.

### 월말 수강권 잔여금액 자동화

Mac mini LaunchAgent `com.archive.monthly-ticket-liability`는 매일 23:50에 기동하고, `scripts/generate-studiomate-ticket-liability-report.mjs --month-end-only --publish`가 KST 월말인 날에만 실제 집계를 수행한다. 월 길이와 윤년은 스크립트가 판정하며, 말일이 아닌 날에는 Firestore를 읽지 않고 즉시 종료한다.

집계 원천은 최신 적용 완료 StudioMate 회원목록과 `memberProfiles.activeTickets`다. 게시 시점 기준 회원목록이 3시간보다 오래됐거나 다른 스튜디오 원천이면 게시를 중단한다. 횟수권은 잔여횟수, 기간권은 잔여일수와 주당횟수를 이용해 환산 잔여횟수를 계산하고, 동일 수강권 실결제 회당금액 중앙값을 대표값으로 사용한다.

집계 결과는 `ticketLiabilityReports/current`와 `ticketLiabilityReports/{YYYY-MM}`에 월별 스냅샷으로 보관한다. 운영자는 `https://core.archivepilates.com/business/#ticketLiability`에서 최신 결과와 과거 월을 확인한다. 이 컬렉션은 경영 검토용 computed 데이터이며 알림톡 대상, 예약, 결제, 환불 또는 StudioMate 쓰기 원천으로 사용하지 않는다.

자동화 상태는 `automationStatus/monthly-ticket-liability`, 결과 파일은 `~/ArchiveIN/automation/reports/ticket-liability/latest.json`, 로그는 `~/ArchiveIN/emergency/logs/monthly-ticket-liability.*.log`에서 확인한다.

### StudioMate 예약 가능 기한 설정 자동화

매주 월요일 12:30에 수행하는 StudioMate 예약 가능 기한 설정 변경은 현재 Mac mini 브라우저 자동화 기준이다. ARCHIVE IN Firebase Functions의 StudioMate API 클라이언트에는 아직 이 설정 변경 전용 endpoint가 확인되어 있지 않다.

API 전환 조건:

1. StudioMate 관리자 설정 화면에서 실제 네트워크 요청의 endpoint, method, payload, 인증 헤더를 캡처한다.
2. 동일 계정/동일 권한으로 저빈도 테스트 호출이 성공하는지 확인한다.
3. 실패 시 브라우저 자동화로 fallback할 수 있게 둔다.
4. 확인 전까지는 설정 변경 자동화를 Firebase 서버 API로 옮기지 않는다.

## 5. 모바일 UI 운영 기준

ARCHIVE IN은 모바일 사용성이 핵심 품질 기준이다.

필수 확인 항목:

- iPhone Safari와 Android Chrome에서 로그인, 날짜 이동, 수업 펼침/접힘이 자연스럽게 동작한다.
- 작은 화면에서 회원명, 태그, 버튼, 상태 뱃지가 겹치지 않는다.
- 터치 대상은 손가락으로 누르기 충분한 크기다.
- 출석/결석/메모 입력 후 닫았다 다시 열어도 상태가 사라지지 않는다.
- 취소 예약은 강사용 수업 카드에서 기본 노출하지 않는다.
- 네트워크가 느릴 때 로딩, 빈 상태, 실패 상태가 구분된다.
- 홈 화면 추가/PWA 캐시 때문에 이전 버전이 보이지 않는지 확인한다.

모바일 검증은 데스크톱 브라우저 확인의 부가 단계가 아니라 배포 전 필수 단계로 본다.

## 6. 운영 변경 원칙

- StudioMate 정책이나 API 제약이 바뀌면 직접 쓰기/자동화 범위를 먼저 재확인한다.
- 강사용 앱의 화면 깊이를 운영자 앱 수준으로 넓히지 않는다.
- 운영자 화면도 장식형 대시보드보다 오늘의 판단과 후속 조치를 우선한다.
- Firebase Hosting, service worker, Firestore rules, Cloud Functions 배포 상태를 함께 본다.
- 비밀번호, 토큰, 개인 인증값은 문서에 기록하지 않는다.
- 테스트 계정 정보는 계정 식별자와 권한 범위만 문서화하고 비밀번호는 별도 안전 채널로 관리한다.

## 7. Firebase 배포와 공개 호출 기준

ARCHIVE IN 앱에서 Firebase SDK로 호출하는 Callable Function은 Cloud Run 앞단에서 막히면 앱 안에서는 `Missing or insufficient permissions`처럼 보일 수 있다. 이때 Firestore rules만 의심하지 말고 Cloud Run Invoker 설정을 함께 확인한다.

현재 프로젝트에는 `constraints/iam.allowedPolicyMemberDomains` 조직정책이 적용되어 있어 `allUsers -> roles/run.invoker` 바인딩은 막힌다. 대신 `constraints/run.managed.requireInvokerIam`은 꺼져 있으므로, 앱이 호출해야 하는 Callable Function은 서비스 단위로 Invoker IAM 체크를 끄는 방식을 우선 사용한다.

권장 확인 명령:

```bash
gcloud run services describe loginstaffwithpin \
  --project=archive-pilates \
  --region=asia-northeast3 \
  --format=json
```

`metadata.annotations["run.googleapis.com/invoker-iam-disabled"]` 값이 `true`이면 Cloud Run 앞단 공개 호출은 허용된 상태다. 이 설정은 앱 내부 인증을 없애는 것이 아니라 Cloud Run IAM 관문을 통과시키는 설정이다. 실제 권한 판단은 Callable Function 내부의 Firebase Auth, staff role, manager role 검증에서 계속 수행한다.

조직정책 자체를 `allowAll`로 넓게 푸는 것은 마지막 수단으로 둔다. 필요한 경우에도 전체 조직이 아니라 프로젝트/서비스 단위 영향 범위를 먼저 검토한다.
