# StudioMate Google Contacts Sync

작성일: 2026-05-14  
운영 기준 변경: 2026-05-15  
관리 기준 채팅: StudioMate/Codex 자동화 통합 관리 채팅

## 목적

StudioMate 엑셀 다운로드/반영으로 정리된 ARCHIVE IN 회원/상담 연락처를 기준으로 ARCHIVE PILATES Google 연락처를 동기화한다.

현재 동기화 대상은 `home@archivepilates.com` Google Contacts이다. `archivepilates@gmail.com` 주소록은 과거 자동화 대상/이관 원본으로만 본다.

## 계정 기준

| 용도 | 계정 | 인증 방식 |
| --- | --- | --- |
| Google Contacts 동기화 대상 | `home@archivepilates.com` | 서비스계정 도메인 전체 위임 / People API |
| 완료/실패 보고 메일 | `home@archivepilates.com` | 서비스계정 도메인 위임 |
| Google Drive 정산 폴더 | `home@archivepilates.com` | Google Drive Desktop / 서비스계정 |
| Google Cloud/Admin/API 설정 | `home@archivepilates.com` | 관리자/Cloud 계정 |

주의:

- `home@archivepilates.com` 주소록을 ARCHIVE IN 운영 기준 주소록으로 사용한다.
- 연락처 동기화는 Firebase Functions의 `memberContactIndex` / `contactSyncJobs` / `HomePeopleClient` 흐름을 기준으로 한다.
- Mac mini에 남아 있는 `archivepilates@gmail.com` OAuth 토큰 기반 스크립트는 레거시로 보고, 실행이 필요하면 `home@archivepilates.com` 기준으로 수정한 뒤 사용한다.
- 토큰, 서비스계정 JSON, 비밀번호는 Git에 올리지 않는다.

## 관련 경로

| 구분 | 경로 |
| --- | --- |
| 연락처 동기화 프로젝트 | `/Users/archivepilates/Documents/New project 2` |
| StudioMate 자동화 프로젝트 | `/Users/archivepilates/Documents/Codex/2026-05-07/archive` |
| Google Contacts 레거시 OAuth 토큰 | `/Users/archivepilates/Documents/New project 2/contacts-token-archivepilates-gmail.json` |
| 서비스계정 키 | `/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json` |
| StudioMate 회원목록 Drive 저장 폴더 | `/Users/archivepilates/Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산/회원원본데이터` |
| 연락처 동기화 리포트 | `/Users/archivepilates/Documents/New project 2/reports/studiomate-google-sync` |
| 자동화 작업 리포트 | `/Users/archivepilates/ArchiveIN/automation/reports/contacts-sync-job` |
| 자동화 로그 | `/Users/archivepilates/ArchiveIN/automation/logs` |

## 핵심 스크립트

| 파일 | 역할 |
| --- | --- |
| `scripts/auth-contacts.mjs` | 레거시 OAuth 토큰 발급 |
| `scripts/google-auth.mjs` | OAuth / 서비스계정 인증 공통 처리 |
| `scripts/export_studiomate_members.py` | 최신 StudioMate 회원목록 엑셀에서 `studiomate-members.json` 생성 |
| `scripts/sync_studiomate_to_google_contacts.mjs` | Google Contacts dry-run / apply 실행 |
| `scripts/run_studiomate_google_sync_job.mjs` | 정기 자동화용 preflight, apply, 검증, 메일 보고 래퍼 |
| `scripts/send_automation_report.mjs` | Gmail 완료/실패 보고 발송 및 라벨 적용 |

## 실행 명령

### 1. 주소록 연결 확인

```bash
cd "/Users/archivepilates/Documents/New project 2"
GOOGLE_AUTH_MODE=oauth \
GOOGLE_CONTACTS_TOKEN_PATH="/Users/archivepilates/Documents/New project 2/contacts-token-archivepilates-gmail.json" \
npm run contacts:smoke
```

### 2. 회원목록 추출 + dry-run

```bash
cd "/Users/archivepilates/Documents/New project 2"
GOOGLE_AUTH_MODE=oauth \
GOOGLE_CONTACTS_TOKEN_PATH="/Users/archivepilates/Documents/New project 2/contacts-token-archivepilates-gmail.json" \
npm run sync:studiomate-google:dry
```

### 3. 실제 반영

실제 반영은 dry-run 결과를 먼저 검토한 뒤 실행한다.

```bash
cd "/Users/archivepilates/Documents/New project 2"
GOOGLE_AUTH_MODE=oauth \
GOOGLE_CONTACTS_TOKEN_PATH="/Users/archivepilates/Documents/New project 2/contacts-token-archivepilates-gmail.json" \
npm run sync:studiomate-google
```

### 4. 정기 작업 래퍼 수동 실행

정기 자동화와 같은 절차로 실행한다. preflight dry-run, 안전기준 확인, apply, 검증 dry-run, 메일 보고까지 수행한다.

```bash
cd "/Users/archivepilates/Documents/New project 2"
/usr/local/bin/node scripts/run_studiomate_google_sync_job.mjs
```

## 동기화 규칙

### 기본 매칭

- StudioMate 회원의 전화번호를 정규화해서 Google Contacts 전화번호와 매칭한다.
- 전화번호가 없거나 이름이 없는 StudioMate 행은 동기화 대상에서 제외한다.
- 동일 전화번호 Google 연락처가 여러 개 있으면 자동 반영하지 않고 보류한다.
- Google-only 연락처는 삭제하지 않는다.
- Google 연락처 삭제는 자동화 범위에 포함하지 않는다.

### 이름 규칙

일반 회원:

```text
StudioMate이름 회원 YYMMDD
```

- `YYMMDD`는 StudioMate 등록일 기준이다.
- 등록일이 없으면 `StudioMate이름 회원` 형식을 사용한다.

상담자:

```text
StudioMate이름 상담 YYMMDD
```

- `YYMMDD`는 상담 일정일 기준이다.
- 아직 수강권 등록/회원 등록일이 없는 연락처도 이름만 저장하지 않고 상담일을 붙인다.

체험자:

```text
StudioMate이름 YYMMDD 체험
```

- 상담 채널이나 메모에 `체험`, `trial`, `experience`가 있으면 체험자로 분류한다.
- 정식 등록되면 같은 전화번호를 기준으로 일반 회원 이름 규칙(`StudioMate이름 회원 YYMMDD`)으로 승격한다.
- 상담/체험 job과 회원 job이 같은 전화번호로 동시에 대기 중이면 회원 job을 우선 처리한다.

강사:

```text
StudioMate이름 강사님
```

- `instructors.json`에 정확히 등록된 이름만 강사로 처리한다.
- 유사 이름이나 동명이인은 자동으로 강사 처리하지 않는다.

스탭:

- Google 연락처에 `스탭` 라벨이 있으면 기존 표시 이름을 보존한다.
- `회원` 또는 `강사님` 형식으로 덮어쓰지 않는다.
- 아래 전화번호/이름은 StudioMate 회원목록 또는 상담 목록에 보여도 회원 연락처로 동기화하지 않는다.

| 이름 | 연락처 역할 | 전화번호 |
| --- | --- | --- |
| 김기효 | 스튜디오 오너 | 010-8648-8585 |
| 김민지 | 강사 | 010-7559-4765 |
| 김아영 | 강사/파트타임 | 010-3251-0242 |
| 배민진 | 스튜디오 오너 | 010-4403-3249 |
| 이초림 | 강사 | 010-4038-1248 |
| 정은영 | STAFF | 010-4018-0513 |

기타 보호 규칙:

- 기존 원장/대표 등 소유자/대표자 성격의 이름은 무리하게 회원명으로 덮어쓰지 않는다.
- 블랙/차단 성격의 라벨이 있으면 자동 반영하지 않고 보류한다.
- 동명이인, 같은 이름/다른 전화번호는 자동 병합하지 않는다.

### 메모 규칙

- StudioMate 회원카드 메모 또는 정상모드 엑셀 회원목록의 `메모` 컬럼은 Google 연락처 메모 필드에 동기화한다.
- 기존 Google 연락처 메모는 보존하고, 아래 Archive 전용 블록만 추가하거나 교체한다.

```text
[Archive StudioMate 메모]
StudioMate 메모 내용
[/Archive StudioMate 메모]
```

- 메모가 변경되면 연락처 이름/전화번호가 그대로여도 연락처 sync job을 다시 생성한다.
- 메모는 앞뒤 공백과 빈 줄을 정리하고 최대 1000자로 제한한다.
- 스탭/강사/오너 보호 대상 연락처에는 회원 메모를 동기화하지 않는다.

### 라벨 규칙

- 신규 회원 생성 시 필요한 Google 연락처 라벨을 추가한다.
- 기존 연락처에 라벨이 누락된 경우 추가 대상으로 잡는다.
- 라벨 추가는 dry-run에 `addLabels: true`로 표시된다.

### 이메일 규칙

- StudioMate에 이메일이 있고 Google 연락처에 같은 이메일이 없을 때만 이메일 추가 대상으로 잡는다.
- 2026-05-13에 dry-run 표시 로직을 수정했다.
- 이전에는 StudioMate에 이메일 값이 있으면 `addEmail: true`처럼 보일 수 있었으나, 현재는 실제 Google 연락처에 이메일이 없을 때만 `addEmail: true`가 된다.

## 안전장치

정기 작업 래퍼 `scripts/run_studiomate_google_sync_job.mjs`는 실제 반영 전에 preflight dry-run을 실행한다.

기본 자동 반영 제한:

| 항목 | 기본 제한 |
| --- | --- |
| 신규 생성 | 10건 이하 |
| 기존 수정 | 50건 이하 |

환경변수로 조정 가능:

```bash
CONTACTS_SYNC_MAX_AUTO_CREATE=10
CONTACTS_SYNC_MAX_AUTO_UPDATE=50
```

제한을 초과하면 실제 반영하지 않고 실패 보고 메일을 보낸다.

재시도:

- 네트워크 일시 오류, Google API 일시 오류, `EAGAIN`, `ETIMEDOUT`, `ECONNRESET` 등은 최대 3회 재시도한다.
- 각 단계 기본 timeout은 600초이다.

## 자동화 스케줄

### Mac mini LaunchAgent

| 자동화 | LaunchAgent | 시간 | 상태 |
| --- | --- | --- | --- |
| StudioMate 회원목록 다운로드 | `com.archive.studiomate-member-excel` | 매일 23:00 | 삭제됨. 정상모드 엑셀 자동화 `com.archive.studiomate-excel-emergency-mode`가 회원목록을 포함해 처리 |
| StudioMate → Google Contacts 동기화 | `com.archive.studiomate-contacts-sync` | 매일 23:10 | 레거시 작업으로 비활성 |
| StudioMate 예약 가능 기한 설정 | `com.archive.studiomate-reservation-deadline` | 매주 월요일 12:30 | 활성 |

연락처 동기화 LaunchAgent:

```text
/Users/archivepilates/Library/LaunchAgents/com.archive.studiomate-contacts-sync.plist.disabled-20260519
```

실행 내용:

```bash
cd "/Users/archivepilates/Documents/New project 2" && /usr/local/bin/node scripts/run_studiomate_google_sync_job.mjs
```

2026-05-22부터 이 레거시 23:10 작업은 unload 상태로 유지하고 `.disabled-20260519`로 보관한다. 최신 정상모드 엑셀 연락처 동기화는 `com.archive.studiomate-emergency-contacts-sync`가 1시간 간격으로 담당한다. LaunchAgent 이름의 `emergency`는 호환용 레거시 이름이다.

로그:

```text
/Users/archivepilates/ArchiveIN/automation/logs/studiomate-contacts-sync.out.log
/Users/archivepilates/ArchiveIN/automation/logs/studiomate-contacts-sync.err.log
```

### Codex 앱 자동화

Codex 앱 자동화는 혼선을 줄이기 위해 보조/수동 테스트용으로 보고, 실제 정기 실행은 Mac mini LaunchAgent를 우선한다.

이전 Codex 앱 자동화:

- `StudioMate 회원목록 엑셀 다운로드`
- `StudioMate 예약가능기한 주간 갱신`
- `daily-studiomate-to-google-contacts-sync`

현재 운영 기준:

- 실제 정기 실행: LaunchAgent
- Codex 앱 자동화: 필요 시 테스트/수동 확인용

## 완료/실패 보고 메일

모든 자동화는 성공/실패 모두 메일로 보고한다.

| 항목 | 기준 |
| --- | --- |
| 발신 | `home@archivepilates.com` |
| 수신 | `home@archivepilates.com` |
| 라벨 | `자동화 완료보고` |
| 성공 제목 예시 | `[연락처 동기화 완료] YYYY-MM-DD` |
| 실패 제목 예시 | `[연락처 동기화 실패] YYYY-MM-DD` |

보고서에는 다음만 짧게 포함한다.

- 작업명
- 실행 일시
- 원본 파일명
- 회원 수 / Google 연락처 확인
- 추가, 수정, 보류 건수
- 검증 결과
- 필요한 수동 조치

보고서에는 다음을 넣지 않는다.

- 긴 파일 경로
- 구현 세부사항
- 전체 전화번호
- 전체 이메일 주소
- 불필요한 회원 개인정보

신규 연락처가 생성되면 보고서에 다음 문구를 포함한다.

```text
카톡친구: 신규 N명 수동 추가 필요
```

## 최근 작업 이력

### 2026-05-15 주소록 기준 계정 통일

- ARCHIVE IN 운영 기준 Google Contacts 계정을 `home@archivepilates.com`으로 통일했다.
- Firebase Functions `HomePeopleClient`는 서비스계정 도메인 전체 위임으로 `home@archivepilates.com` Contacts를 수정한다.
- `archivepilates@gmail.com` 주소록은 과거 이관 원본/레거시 자동화 대상으로만 둔다.
- Mac mini 연락처 자동화가 계속 필요하면 `home@archivepilates.com` 기준으로 수정한 뒤 실행한다.

### 2026-05-13 계정 분리 정리

- `archivepilates@gmail.com` 주소록 OAuth 토큰을 새로 발급했다.
- 토큰 권한:
  - Contacts
  - Drive
  - Sheets
  - Gmail send
  - Gmail modify
- 주소록 smoke test에서 Google Contacts 1163명을 조회했다.
- `home@archivepilates.com` 서비스계정 도메인 위임은 완료보고 메일과 Drive/Sheets 작업에 사용하도록 정리했다.

### 2026-05-13 대량 정리 승인 반영

사용자 승인 후 `archivepilates@gmail.com` 주소록에 실제 반영했다.

반영 전 dry-run:

| 항목 | 건수 |
| --- | ---: |
| StudioMate 회원 | 889 |
| 전체 작업 예정 | 139 |
| 신규 생성 | 3 |
| 기존 수정 | 136 |
| 보류 | 0 |

수정 136건의 내용:

| 유형 | 건수 |
| --- | ---: |
| 기존 이름에 괄호/메모 포함 → 표준 이름 변경 | 94 |
| 회원 등록일 suffix 추가 | 42 |
| 실제 이메일 추가 | 0 |
| 라벨 추가 | 0 |

반영 결과:

| 항목 | 건수 |
| --- | ---: |
| 신규 생성 | 3 |
| 기존 수정 | 136 |
| 보류 | 0 |

검증 dry-run:

| 항목 | 건수 |
| --- | ---: |
| 신규 생성 | 0 |
| 기존 수정 | 0 |
| 보류 | 0 |

완료보고 메일을 발송했고 `자동화 완료보고` 라벨이 적용됐다.

### 2026-05-13 LaunchAgent 즉시 테스트

연락처 동기화 LaunchAgent를 다시 활성화하고 즉시 테스트 실행했다.

테스트 당시 최신 회원목록 기준:

| 항목 | 건수 |
| --- | ---: |
| StudioMate 회원 | 890 |
| preflight 작업 예정 | 1 |
| 신규 생성 | 1 |
| 기존 수정 | 0 |
| 보류 | 0 |

적용 후 검증:

| 항목 | 건수 |
| --- | ---: |
| 신규 생성 | 0 |
| 기존 수정 | 0 |
| 보류 | 0 |

작업 리포트:

```text
/Users/archivepilates/ArchiveIN/automation/reports/contacts-sync-job/2026-05-13T14-59-29-668Z.json
```

## 현재 상태

2026-05-15 기준:

| 항목 | 상태 |
| --- | --- |
| Google Contacts 대상 계정 | `home@archivepilates.com` |
| 완료보고 메일 계정 | `home@archivepilates.com` |
| 연락처 동기화 LaunchAgent | 23:10 레거시 작업 비활성. 정상모드 엑셀 연락처 작업은 `com.archive.studiomate-emergency-contacts-sync` |
| 회원목록 다운로드 LaunchAgent | 삭제됨. 정상모드 엑셀 자동화가 회원목록 다운로드를 담당 |
| 예약 가능 기한 LaunchAgent | 활성 |
| Firebase 연락처 큐 | `memberContactIndex` / `contactSyncJobs` 기준 |
| 완료보고 메일 | `home@archivepilates.com` 기준 |

## 운영 원칙

1. 자동화 관련 관리는 StudioMate/Codex 자동화 통합 채팅에서 진행한다.
2. 실제 정기 실행은 Mac mini LaunchAgent를 우선한다.
3. Google 계정이 필요한 작업 전에는 항상 사용할 계정을 먼저 명시한다.
4. 연락처 동기화는 반드시 dry-run을 먼저 본다.
5. 대량 수정/신규 생성은 사용자 승인 후 실제 반영한다.
6. 모든 자동화는 성공/실패 모두 메일로 보고한다.
7. Google-only 연락처는 삭제하지 않는다.
8. 연락처 병합/삭제/대량 이동은 별도 승인 없이는 하지 않는다.

## 다음 개선 후보

- 연락처 동기화 보고서에서 변경사항을 최대 10건까지만 요약하고, 상세 CSV/JSON 링크를 함께 남기기
- 신규 연락처 생성 시 카톡 친구 수동 추가 목록을 별도 CSV로 저장하기
- LaunchAgent 상태 점검 스크립트 만들기
- `STUDIOMATE_GOOGLE_CONTACTS_SYNC.md`를 자동화 변경 때마다 갱신하는 루틴 추가하기
- 서비스계정/토큰 파일이 Git에 포함되지 않도록 `.gitignore` 점검하기
