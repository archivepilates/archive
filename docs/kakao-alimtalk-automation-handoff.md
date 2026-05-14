# Archive Pilates Kakao Alimtalk Automation Handoff

Last updated: 2026-05-14

이 문서는 다른 Codex/작업자가 StudioMate API 연동 데이터 동기화와 Firebase Functions 기반 알림톡 자동화를 이어받기 위한 요약입니다.

## 목표

아카이브필라테스 회원 데이터와 수강권 상태를 기준으로 SOLAPI 알림톡을 자동 발송한다.

주요 목적:

- 현재 이용회원에게 수강권 기간 종료 임박 안내
- 현재 이용회원에게 수강권 잔여횟수 임박 안내
- 수강권 만료 회원에게 만료 안내
- 신규회원에게 웰컴/이용안내 발송
- 향후 예약오픈 안내, 이슈회원 안내, 단체 공지는 별도 템플릿/채널 메시지 정책에 맞춰 확장

## 현재 권장 아키텍처

```text
StudioMate API 또는 StudioMate export
  -> sync worker
  -> normalized member/pass records
  -> Firebase Firestore or Storage
  -> Firebase Scheduled Functions
  -> SOLAPI Kakao Alimtalk API
  -> Firestore send logs / dedupe records
```

역할 분리:

- StudioMate API sync: 회원, 연락처, 수강권 원천 데이터 수집 및 정규화
- Firebase Functions: 규칙 판단, 중복 발송 방지, SOLAPI 발송, 결과 저장
- SOLAPI: 승인된 카카오 알림톡 템플릿 발송

Google Contacts는 수강권 판단 원천이 아니라 보조 데이터다. 전화번호 검증, 중복 확인, 이름 정리에는 쓸 수 있지만 수강권 기간/횟수 판단은 StudioMate 데이터가 기준이다.

## SOLAPI / Kakao Channel

카카오 채널 PFID:

```text
KA01PF260511123220162lk0NUjstpVl
```

SOLAPI API Key/Secret은 절대 코드나 문서에 저장하지 않는다.

권장 저장 위치:

- 로컬 테스트: `.env.local`
- Firebase 운영: Firebase Secret Manager
  - `SOLAPI_API_KEY`
  - `SOLAPI_API_SECRET`
  - `SOLAPI_PFID`

기본 발송 엔드포인트:

```text
POST https://api.solapi.com/messages/v4/send-many/detail
```

템플릿 상태 확인:

```text
GET https://api.solapi.com/kakao/v2/templates/{templateId}
```

그룹 발송 결과 확인:

```text
GET https://api.solapi.com/messages/v4/groups/{groupId}
```

## 현재 살아있는 / 사용 가능한 템플릿

사용자가 확인한 현재 라이브 템플릿은 3개입니다.

| 목적 | Template ID | 현재 상태 | 변수 |
|---|---|---|---|
| 수강권 기간 안내 | `KA01TP260513132546274Sp5VtNf2pv7` | `APPROVED` | `#{이름}`, `#{남은일수}` |
| 수강권 잔여횟수 안내 | `KA01TP260513132546352nPdudb2yHnG` | `APPROVED` | `#{이름}`, `#{잔여횟수}` |
| 수강권 만료 안내 | `KA01TP260513132546446zCdmdJXDOW4` | `APPROVED` | `#{이름}`, `#{만료일}` |

주의:

- 신규회원 웰컴 v2 `KA01TP260513132546184k4RpQF0exqz`는 삭제 완료, 사용 금지.
- 신규회원 웰컴 v3 `KA01TP260514081318309wQGfeIJxIAJ`는 공식 인스타 링크 반영 후 검수중.
- 예약 안내 v2 `KA01TP2605131325462341f8ACO2THW6`는 반려 후 수정된 상태이며 운영 발송에 쓰지 않는다.

검수 전 초안:

| 목적 | Template ID | 현재 상태 | 변수 |
|---|---|---|---|
| 그룹 기간권 잔여기간 안내 v3 | `KA01TP260514145047261araXgWLVFRs` | `PENDING` | `#{이름}`, `#{남은일수}`, `#{수강권명}` |
| 그룹 횟수권 잔여횟수 안내 v3 | `KA01TP260514145047393VpTbcCZKkCV` | `PENDING` | `#{이름}`, `#{잔여횟수}`, `#{수강권명}`, `#{만료일}` |
| 프라이빗 횟수권 잔여횟수 안내 v1 | `KA01TP260514152235608d9icGOBotnV` | `PENDING` | `#{이름}`, `#{잔여횟수}`, `#{수강권명}`, `#{만료일}` |
| 프라이빗 사전설문 안내 v1 | `KA01TP260514153632171uiWXYoeiOLS` | `PENDING` | `#{이름}` |

위 초안 4건은 SOLAPI에 생성만 해두었고, 카카오 검수 요청은 하지 않았다. 그룹 기간권/횟수권 초안에는 이용안내/홀딩규정 버튼을 붙였고, 프라이빗 사전설문 초안에는 Google Form 버튼을 붙였다. 프라이빗 기간권 초안은 운영 빈도가 낮아 삭제했다. 사용자가 문구를 최종 수정하고 검수 요청한 뒤 `APPROVED` 상태가 되기 전까지 자동 발송에 연결하지 않는다.

## 템플릿 본문

### 그룹 수강권 기간 안내

```text
#{이름}님,
이용 중인 그룹 수강권 기간이
#{남은일수}일 남았습니다. ⏳

보유 수강권
#{수강권명}

남은 이용 기간을 확인하시고
수업 일정을 계획해 주세요.

이용 규정은 아래 안내를
참고해 주세요.
```

버튼:

- 이용안내 보기: `https://archivepilates.notion.site/archivepilates`
- 홀딩규정 보기: `https://archivepilates.notion.site/hold`

### 그룹 수강권 잔여횟수 안내

```text
#{이름}님,
이용 중인 그룹 수강권의
잔여 횟수는 #{잔여횟수}회입니다. 🎟️

보유 수강권
#{수강권명}

만료일
#{만료일}

남은 이용 기간을 확인하시고
수업 일정을 계획해 주세요.

이용 규정은 아래 안내를
참고해 주세요.
```

버튼:

- 이용안내 보기: `https://archivepilates.notion.site/archivepilates`
- 홀딩규정 보기: `https://archivepilates.notion.site/hold`

### 프라이빗 수강권 잔여횟수 안내

```text
#{이름}님,
프라이빗 수강권의
잔여 횟수는 #{잔여횟수}회입니다. 🎟️

보유 수강권
#{수강권명}

만료일
#{만료일}

남은 이용 기간을 확인하시고
프라이빗 수업 일정을 계획해 주세요. 📅
```

버튼 없음.

### 프라이빗 사전설문 안내

```text
#{이름}님,
프라이빗 수업을 시작하기 전
사전 설문 작성을 부탁드립니다. 🧘

설문 내용은 회원님의 운동 경험,
생활 패턴, 원하는 수업 방향을
확인하기 위한 자료입니다.

작성해 주신 내용은
프라이빗 수업 준비에 참고하겠습니다.
```

버튼:

- 사전설문 작성: `https://forms.gle/pq9kakDAEr9vWwtC7`

### 수강권 만료 안내

```text
#{이름}님,
이용 중인 수강권이
#{만료일}에 종료되었습니다.

이용 내역 확인이 필요하시면
카카오채널로 연락주세요.

기간 연장 규정은
아래 안내에서 확인해 주세요.
```

버튼:

- 홀딩규정 보기: `https://archivepilates.notion.site/hold`

## 신규회원 웰컴 v3

검수중 템플릿:

```text
KA01TP260514081318309wQGfeIJxIAJ
```

공식 인스타 링크:

```text
https://www.instagram.com/archivepilates_official/
```

v3 승인 전까지 신규회원 자동 발송은 운영에 연결하지 않는다.

v3 승인 후 예상 변수:

- `#{이름}`

버튼:

- 이용안내 보기: `https://archivepilates.notion.site/archivepilates`
- 예약방법 보기: `https://archivepilates.notion.site/studiomate`
- 센터 소식 보기: `https://www.instagram.com/archivepilates_official/`

## StudioMate 동기화에 필요한 데이터 필드

회원 단위:

```json
{
  "memberId": "optional-but-recommended",
  "name": "배민진",
  "phone": "01044033249",
  "email": "member@example.com",
  "registeredAt": "2023-02-01",
  "lastAttendedAt": "2026-04-01",
  "appConnected": true
}
```

수강권 단위:

```json
{
  "memberId": "same-as-member",
  "name": "배민진",
  "phone": "01044033249",
  "ticketName": "사전등록 100회권",
  "ticketType": "그룹",
  "ticketStatus": "사용중",
  "ticketStartAt": "2023-02-15",
  "ticketEndAt": "2027-03-13",
  "remainingSessions": 76,
  "bookableSessions": 73,
  "cancelableSessions": 9,
  "instructor": ""
}
```

필수 정규화:

- 전화번호는 숫자만 저장: `01044033249`
- `+82` 또는 `82` 형태는 `010...`으로 변환
- `ticketStatus`는 원문과 파싱값을 함께 보관 권장
  - 원문 예: `사용중 (306일 남음)`
  - 파싱값 예: `active`
- `ticketEndAt`는 `YYYY-MM-DD`
- `remainingSessions`는 숫자 또는 null
- 회원/수강권 식별자는 가능하면 StudioMate 내부 ID를 사용

## 현재 로컬 데이터 파일 참고

현재 로컬 파일 기준:

- `studiomate-members.json`
  - count: 890
  - source: 2026-05-13 StudioMate 회원목록 export
- `studiomate-pass-snapshot.json`
  - count: 2938
  - source: 2026-05-11 StudioMate 회원목록 export

향후 API 연동 시 위 JSON은 임시 산출물로 보고, Firestore/Storage에 같은 구조로 최신 데이터를 올리면 된다.

## 자동 발송 규칙 초안

### 1. 수강권 기간 종료 임박

대상:

- `ticketStatus = active`
- `ticketEndAt` 존재
- 오늘 기준 남은 일수 계산 가능

권장 트리거:

- D-14
- D-7
- D-3
- D-1

발송 템플릿:

```text
KA01TP260513132546274Sp5VtNf2pv7
```

변수:

```json
{
  "#{이름}": "회원명",
  "#{남은일수}": "7"
}
```

### 2. 수강권 잔여횟수 임박

대상:

- `ticketStatus = active`
- `remainingSessions` 숫자

권장 트리거:

- 잔여 5회
- 잔여 3회
- 잔여 1회

발송 템플릿:

```text
KA01TP260513132546352nPdudb2yHnG
```

변수:

```json
{
  "#{이름}": "회원명",
  "#{잔여횟수}": "3"
}
```

### 3. 수강권 만료 안내

대상:

- 오늘 기준 이미 종료된 수강권
- 같은 회원에게 더 최신의 active 수강권이 없는 경우에만 발송

권장 트리거:

- D-day
- D+1

발송 템플릿:

```text
KA01TP260513132546446zCdmdJXDOW4
```

변수:

```json
{
  "#{이름}": "회원명",
  "#{만료일}": "2026.05.31"
}
```

## 중복 발송 방지 규칙

Firestore에 발송 이력을 저장한다.

추천 document key:

```text
alimtalkSends/{memberId}_{ticketId}_{ruleId}_{triggerValue}
```

예:

```text
alimtalkSends/stm_123_ticket_456_period_d7
alimtalkSends/stm_123_ticket_456_remaining_3
alimtalkSends/stm_123_ticket_456_expired_d1
```

저장 필드:

```json
{
  "memberId": "stm_123",
  "ticketId": "ticket_456",
  "ruleId": "period_d7",
  "templateId": "KA01TP260513132546274Sp5VtNf2pv7",
  "toMasked": "010-****-3249",
  "variables": {
    "#{이름}": "배민진",
    "#{남은일수}": "7"
  },
  "solapiGroupId": "G...",
  "status": "COMPLETE",
  "sentAt": "2026-05-14T07:29:35.970Z",
  "createdBy": "firebase-function"
}
```

중복 방지:

- 같은 `memberId + ticketId + ruleId + triggerValue`는 1회만 발송
- SOLAPI 요청 전 Firestore transaction으로 lock 문서 생성
- 실패 시 `FAILED`로 저장하고 재시도 정책 별도 적용
- 오래된 데이터로 발송하지 않도록 sync freshness guard 필수

## 데이터 신선도 가드

자동 발송 전 반드시 최신 동기화 상태를 확인한다.

권장 조건:

- 마지막 StudioMate sync가 24시간 이내
- sync 결과에 members/pass count가 0이 아님
- 데이터 파싱 오류가 없음
- SOLAPI 템플릿 상태가 `APPROVED`

조건 미충족 시:

- 발송 중단
- 관리자 알림 또는 자동화 완료보고 발송
- Firestore에 blocked run 기록

## SOLAPI 발송 payload 예시

```json
{
  "messages": [
    {
      "to": "01044033249",
      "type": "ATA",
      "kakaoOptions": {
        "pfId": "KA01PF260511123220162lk0NUjstpVl",
        "templateId": "KA01TP260513132546274Sp5VtNf2pv7",
        "variables": {
          "#{이름}": "배민진",
          "#{남은일수}": "303"
        },
        "disableSms": true
      },
      "customFields": {
        "source": "archive-firebase-alimtalk",
        "ruleId": "period_d303",
        "memberId": "stm_member_id",
        "ticketId": "stm_ticket_id"
      }
    }
  ],
  "allowDuplicates": true,
  "showMessageList": true,
  "strict": true
}
```

주의:

- `disableSms: true` 유지. 알림톡 실패 시 문자 대체발송을 자동으로 하지 않는다.
- 같은 수신자에게 여러 템플릿을 한 번에 보낼 수 있으므로 `allowDuplicates: true`가 필요할 수 있다.
- 운영에서는 한 회원에게 같은 날 너무 많은 알림톡이 가지 않도록 우선순위 큐를 둔다.

## 실제 발송 검증 기록

### 김기효 테스트

2026-05-14에 당시 승인된 4개 템플릿을 김기효 회원에게 테스트 발송했다.

- 결과: 4건 성공 / 실패 0건
- groupId: `G4V20260514155853C5RBIVTQ5XZZ6RK`
- 비용: 52원
- 주의: 이 테스트에는 이후 삭제된 신규회원 웰컴 v2도 포함되어 있으므로 현재 운영 기준으로는 참고만 한다.

### 배민진 실제 수강권 기준 발송

2026-05-14에 배민진 회원의 실제 사용중 수강권 기준으로 발송했다.

사용중 수강권:

- 사전등록 100회권
- 종료일: 2027-03-13
- 잔여횟수: 76회

발송:

- 수강권 기간 안내: `#{남은일수}=303`
- 수강권 잔여횟수 안내: `#{잔여횟수}=76`
- 만료 안내는 active 수강권이 있어 제외

결과:

- 2건 성공 / 실패 0건
- groupId: `G4V20260514162909VGRIU33GZFGEFV1`
- 비용: 26원

## 알림톡 정책 주의사항

알림톡은 정보성 메시지에 한해 발송한다.

가능:

- 회원가입 완료 후 이용안내
- 수강권 기간/횟수/만료 안내
- 예약 방법 안내
- 이용 규정/홀딩 규정 안내

주의 또는 불가:

- 가격, 할인, 이벤트, 재등록 유도 문구 직접 포함
- 리뷰 이벤트, 쿠폰, 혜택 홍보
- 매주 바뀌는 자유 공지 내용을 알림톡 변수로 크게 넣는 방식
- 광고성 내용이 포함된 링크를 알림톡 버튼에 연결

이벤트 수강권 홍보, 누적회원 대상 마케팅, 자유형 단체공지 등은 알림톡보다 브랜드메시지 또는 채널 메시지로 분리하는 것이 안전하다.

## 다음 작업 체크리스트

1. StudioMate API에서 회원/수강권 필드 매핑 확정
2. Firestore schema 설계
3. `members`, `passes`, `syncRuns`, `alimtalkSends` 컬렉션 생성
4. SOLAPI credentials를 Firebase Secret Manager에 등록
5. 템플릿 상태 확인 함수 구현
6. dry-run 대상 추출 함수 구현
7. 1명 대상 live-send 테스트
8. 중복 발송 transaction 검증
9. Scheduler를 운영 시간에 맞춰 등록
10. 관리자 완료보고/실패보고 연결

## 관련 로컬 파일

작업 기준 폴더:

```text
/Users/archivepilates/Documents/New project 2
```

주요 파일:

- `KAKAO_TEMPLATE_PLAN.md`
- `KAKAO_MESSAGE_TEMPLATES.md`
- `scripts/solapi_templates.mjs`
- `scripts/prepare_kakao_test_target.mjs`
- `studiomate-members.json`
- `studiomate-pass-snapshot.json`

발송/검수 기록:

- `reports/kakao-channel/`
- `/Users/archivepilates/Documents/macmini-archive/contacts-kakao/reports/kakao-channel/`
