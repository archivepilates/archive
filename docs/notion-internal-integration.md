# Notion 내부 통합 운영 메모

ARCHIVE IN 운영 규칙을 Codex Notion 플러그인 OAuth 만료와 무관하게 갱신하기 위한 내부 통합 방식이다.

## 계정

- Notion 계정: `archivepilates@gmail.com`
- 대상 페이지: `카카오 알림톡 운영 규칙`
- 대상 페이지 ID: `361d49eae4bf8189adf5f7effcdf5bfd`

## Notion에서 1회 설정

1. `archivepilates@gmail.com`으로 Notion에 로그인한다.
2. Notion Developers에서 internal integration을 만든다.
3. integration 이름은 `ARCHIVE AI`를 사용한다.
4. 권한은 운영 문서 갱신에 필요한 범위로 둔다.
   - Read content
   - Update content
   - Insert content
5. `카카오 알림톡 운영 규칙` 페이지에서 이 integration을 초대/share 한다.
6. 발급된 internal integration token은 GitHub, Notion, 채팅, 문서에 적지 않는다.

## 프라이빗 사전설문 Firestore to Notion 동기화

Google Form 응답 Apps Script는 Firestore `privateSurveyIntakes/{intakeId}` 저장까지만 담당한다. Firebase Function `processPrivateSurveyIntake`가 응답을 `privateSurveyResponses`, 공개 상세 문서, 강사 메모 큐로 처리한 뒤 Notion 프라이빗 회원 차트 DB에도 upsert한다. Notion 전송 실패는 설문 처리 자체를 막지 않고 Firestore의 `notionSync` 상태에만 기록한다.

대상:

- Google 계정: `home@archivepilates.com`
- Google Sheet: `아카이브필라테스 프라이빗 사전설문(응답)`
- Apps Script: `apps-script/private-survey/Code.js`
- Firestore intake: `privateSurveyIntakes/{intakeId}`
- Firebase Function: `processPrivateSurveyIntake`
- Notion sync module: `firebase/kangsain-functions/functions/src/privateSurvey/notionSync.ts`
- Notion 계정: `archivepilates@gmail.com`
- Notion 페이지: `ARCHIVE PILATES 프라이빗 회원 차트 시스템`
- Members DB: `c58a39ceb7ac405ba43b38d3b5871ed3`
- Intake Survey DB: `87064e93fd834c0ab2e2da8070522922`

Firebase Functions secret에 아래 값을 넣는다.

```text
NOTION_TOKEN=secret_...
```

선택값:

```text
NOTION_PRIVATE_MEMBERS_DATABASE_ID=c58a39ceb7ac405ba43b38d3b5871ed3
NOTION_PRIVATE_INTAKE_DATABASE_ID=87064e93fd834c0ab2e2da8070522922
```

Notion에서 `ARCHIVE PILATES 프라이빗 회원 차트 시스템` 페이지 또는 두 DB를 internal integration에 share해야 한다. 설정 후 `processPrivateSurveyIntake`를 테스트 응답 1건으로 실행해 Firestore `notionSync.status`가 `synced`가 되는지 확인한다.

2026-05-27 확인: Firebase project `archive-pilates`에 `NOTION_TOKEN` secret version 1 생성 완료. Notion integration `ARCHIVE AI`가 Members DB와 Intake Survey DB를 조회할 수 있다.

2026-05-27 E2E QA:

- 실제 Google Form 테스트 응답 제출 완료: `테스트_노션동기화 / 01000009999`
- Firestore intake: `psr-d81b99b8b88d-6e7f7ee7944e16a3`
- Firestore response: `psr-d81b99b8b88d`
- Notion sync result: `status=synced`, `action=created`, `failed=0`
- Notion Intake page: `36dd49ea-e4bf-81cc-92d7-f709764727fc`
- Notion Member page: `36dd49ea-e4bf-81ad-a839-f1860e6318c5`
- 테스트 응답은 실제 회원이 아니므로 Intake `Survey Status`를 `보류`로 변경했다.

운영 기준:

- Apps Script는 Notion API를 직접 호출하지 않는다.
- Notion 실패 시 `privateSurveyIntakes/{intakeId}.notionSync.status = failed`로 남긴다.
- Notion 실패 시 `privateSurveyResponses/{responseId}.notionSync.status = failed`로도 남긴다.
- 기존 응답을 다시 처리하거나 duplicate로 잡혀도 기존 `privateSurveyResponses` 문서를 기준으로 Notion 재동기화를 시도한다.
- `scheduledSyncPrivateSurveyNotion`이 30분마다 미동기화/실패 응답을 재시도한다. `NOTION_TOKEN`이 없으면 쓰기 없이 skip한다.

중복 방지 기준:

- 회원은 `Phone`으로 먼저 찾고, 없으면 `Name`으로 찾는다.
- 설문 응답은 `Raw Response URL`로 찾는다.
- 같은 응답을 다시 처리하면 새로 만들지 않고 기존 Notion 페이지를 업데이트한다.

## 로컬 실행

2026-06-10 이후 이 스크립트는 legacy 보정용이다. 현재 운영규칙은 Notion이 아니라 ARCHIVE CORE `/core/rules/`에 기록한다. 아래 명령은 과거 Notion 페이지를 1회 보정해야 할 때만 명시적으로 실행한다.

토큰은 로컬 shell 환경변수 또는 로컬 전용 env 파일에만 둔다.

```bash
export NOTION_TOKEN="secret_..."
ALLOW_LEGACY_NOTION_RULE_SYNC=1 node scripts/sync-notion-alimtalk-rules.mjs
```

선택 env:

```bash
export NOTION_ALIMTALK_PARENT_PAGE_ID="361d49eae4bf8189adf5f7effcdf5bfd"
export NOTION_ALIMTALK_TEMPLATE_PAGE_TITLE="카카오 알림톡 템플릿 분류와 SOLAPI 네이밍 규칙"
```

처음 실행하면 `카카오 알림톡 운영 규칙` 아래에 `카카오 알림톡 템플릿 분류와 SOLAPI 네이밍 규칙` child page를 만든다. 이후 같은 제목의 페이지를 찾아 내용을 교체한다.

## 보안 규칙

- `NOTION_TOKEN`은 repo에 커밋하지 않는다.
- `.gitignore`는 `notion*.env`, `notion*.token`, `secrets/`를 제외한다.
- 토큰이 노출되면 Notion Developers에서 즉시 revoke 후 재발급한다.

## 동기화 원본

- `docs/solapi-template-data-operating-rules.md`
- `docs/kakao-alimtalk-automation-handoff.md`
- `docs/archivein-member-contact-alimtalk-pipeline.md`

현재 스크립트는 legacy Notion child page 보정용으로만 남긴다. 새 운영 기준은 ARCHIVE CORE 운영규칙 탭에 반영한다.
