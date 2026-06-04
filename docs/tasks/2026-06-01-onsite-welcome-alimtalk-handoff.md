# 현장 웰컴 즉시발송 알림톡 스레드 핸드오프

작성일: 2026-06-01

## 결론

ARCHIVE IN 본 앱이 아니라 별도 현장용 웹페이지로 `현장 웰컴 즉시발송` 진입점을 배포했다.

현장 페이지에서 StudioMate 단건 조회가 완료되어 `lookup_ready` 상태가 되면, 직원이 `웰컴 알림톡 전송` 버튼을 눌러 승인된 `신규회원 웰컴 v5` 템플릿으로 즉시 발송한다.

라이브 페이지:

```text
https://in.archivepilates.com/onsiteWelcome/
```

## 이미 구현/배포된 것

- 현장 직원용 별도 페이지: `archivein/onsiteWelcome/index.html`
- 요청 API: `onsiteWelcomeRequest`
- 요청 컬렉션: `onsiteWelcomeRequests`
- 회원가입서 초안 컬렉션: `memberSignupContracts`
- 회원가입서 작성 페이지: `https://in.archivepilates.com/memberSignup/?id=...&token=...`
- Mac mini Playwright 처리 스크립트: `scripts/process-onsite-welcome-requests.mjs`
- Mac mini LaunchAgent 템플릿: `firebase/kangsain-functions/macmini-studiomate/com.archive.onsite-welcome-requests.plist`
- 현장 웰컴 발송 함수: `firebase/kangsain-functions/functions/src/alimtalk/onsiteWelcomeAlimtalk.ts`
- 현장 웰컴 템플릿: `신규회원 웰컴 v5`

배포 커밋:

```text
79591a0 Add onsite welcome request page
8b95b1b Add onsite welcome signup consent flow
15add34 Deploy alimtalk survey routing improvements
```

브랜치:

```text
codex/mini/archivein-live-setup
```

## 목표 운영 흐름

1. 현장에서 StudioMate에 회원 기본정보와 수강권을 먼저 저장한다.
2. 직원이 `https://in.archivepilates.com/onsiteWelcome/`를 연다.
3. 휴대폰 번호와 필요 시 회원명을 입력한다.
4. `onsiteWelcomeRequests/{requestId}` 문서가 생성된다.
5. Mac mini LaunchAgent가 15초 간격으로 pending 요청을 확인한다.
6. Playwright가 StudioMate 웹에서 전화번호로 회원 단건 조회를 한다.
7. 검색 결과가 정확히 1명일 때만 회원명/전화번호/수강권 정보를 읽는다.
8. `memberSignupContracts/{contractId}` 초안을 만든다.
9. `signupUrl`이 `onsiteWelcomeRequests/{requestId}`에 저장된다.
10. 직원이 현장 페이지에서 `웰컴 알림톡 전송` 버튼을 누른다.
11. `onsiteWelcomeRequest` API가 중복 이력을 확인한 뒤 `onsite_welcome` 후보를 생성하고 즉시 발송한다.
12. 발송 결과를 `onsiteWelcomeRequests/{requestId}`에 `sent/error`로 남긴다.

## 현장 웰컴 알림톡 기준

### 1. 템플릿

현재 사용하는 템플릿:

```text
신규회원 웰컴 v5
KA01TP260602101939427lPhGyuDLvFM
```

운영 규칙:

- v5는 현재 승인된 현장 웰컴 즉시발송용 템플릿이다.
- v3, v4는 삭제/사용금지 상태로 보고 신규 후보나 발송에 연결하지 않는다.
- 버튼 URL은 짧은 링크를 사용한다.

권장 버튼 URL 형태:

```text
https://in.archivepilates.com/s/#{링크ID}/
```

직접 URL을 쓸 경우:

```text
https://in.archivepilates.com/memberSignup/?id=#{가입서ID}&token=#{접근토큰}
```

단, 알림톡 버튼 URL 길이 제한을 고려하면 short link 방식이 안전하다.

### 2. 알림톡 payload 필드 연결

`onsiteWelcomeRequests` 처리 결과에는 아래 값이 저장된다.

```text
contractId
signupUrl
lookup.memberName
lookup.memberPhone
lookup.ticketName
lookup.startDate
lookup.endDate
```

알림톡 발송 후보 또는 즉시 발송 payload에 필요한 값:

```text
memberName
memberPhone
ticketName
signupUrl 또는 signupLinkId
contractId
sourceRequestId
```

### 3. 즉시 발송 상태 업데이트

알림톡 발송 후 `onsiteWelcomeRequests/{requestId}`에 결과를 남겨야 한다.

권장 필드:

```text
status: sent | error
alimtalkCandidateId
alimtalkSendId
progressPercent: 100
progressLabel: 웰컴 알림톡 발송 완료
lastError: null 또는 실패 사유
completedAt
updatedAt
```

현재 페이지는 `lookup_ready`, `sent`, `error`, `cancelled` 상태를 종료 상태로 본다.
`lookup_ready` 상태에서는 직원이 `웰컴 알림톡 전송` 버튼을 눌러야 실제 발송이 진행된다.

### 4. 중복 방지

즉시 발송 전 다음 중복을 확인해야 한다.

- 같은 전화번호 또는 같은 StudioMate memberId로 이미 신규회원 웰컴 발송 완료
- 같은 `memberSignupContracts` 초안이 이미 생성됨
- 같은 `onsiteWelcomeRequests` 요청이 이미 `sent`

중복일 때 권장 처리:

```text
status: error 또는 lookup_ready
progressLabel: 이미 웰컴/가입서가 생성된 회원입니다
lastError: 중복 발송 방지 사유
```

직원이 재발송을 원할 수 있으므로, 자동 재발송보다는 운영자 확인을 거치는 것이 안전하다.

## 구현상 주의점

- 이 기능은 정기 엑셀 동기화 기반 `new_member` 자동 발송과 별개다.
- `studiomate_playwright_lookup` 값은 현장 즉시발송용으로만 사용한다.
- 정식 `memberProfiles` 정합성은 이후 정기 엑셀 동기화가 맞춘다.
- 조회 결과가 0명 또는 2명 이상이면 발송하지 않는다.
- StudioMate Playwright는 공유 프로필 락을 사용한다.
- 알림톡 발송 전 실제 발송 버튼/큐는 반드시 중복 차단을 먼저 확인한다.

## 현재 남은 배포/운영 작업

Mac mini에서 LaunchAgent 설치/load 여부는 별도 운영 점검이 필요하다.

템플릿 파일:

```text
firebase/kangsain-functions/macmini-studiomate/com.archive.onsite-welcome-requests.plist
```

설치 대상:

```text
/Users/archivepilates/Library/LaunchAgents/com.archive.onsite-welcome-requests.plist
```

주의:

- 이 LaunchAgent는 StudioMate 웹 단건 조회를 실행한다.
- `~/ArchiveIN/automation/browser-profile` 공유 프로필을 사용한다.
- 기존 StudioMate 엑셀/메모 자동화와 같은 락을 공유한다.

## 알림톡 스레드에 전달할 한 줄 요약

현장용 `https://in.archivepilates.com/onsiteWelcome/` 페이지와 `onsiteWelcomeRequests` 큐는 배포됨. `lookup_ready` 상태에서 직원이 `웰컴 알림톡 전송` 버튼을 누를 때만 `signupUrl` short link를 받아 승인된 `신규회원 웰컴 v5` 템플릿으로 즉시 발송하고, 결과를 `onsiteWelcomeRequests`에 `sent/error`로 업데이트한다.
