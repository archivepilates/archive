# Notion 내부 통합 운영 메모

ARCHIVE IN 운영 규칙을 Codex Notion 플러그인 OAuth 만료와 무관하게 갱신하기 위한 내부 통합 방식이다.

## 계정

- Notion 계정: `archivepilates@gmail.com`
- 대상 페이지: `카카오 알림톡 운영 규칙`
- 대상 페이지 ID: `361d49eae4bf8189adf5f7effcdf5bfd`

## Notion에서 1회 설정

1. `archivepilates@gmail.com`으로 Notion에 로그인한다.
2. Notion Developers에서 internal integration을 만든다.
3. integration 이름은 `ARCHIVE IN Ops Sync`처럼 운영 용도를 알 수 있게 만든다.
4. 권한은 운영 문서 갱신에 필요한 범위로 둔다.
   - Read content
   - Update content
   - Insert content
5. `카카오 알림톡 운영 규칙` 페이지에서 이 integration을 초대/share 한다.
6. 발급된 internal integration token은 GitHub, Notion, 채팅, 문서에 적지 않는다.

## 로컬 실행

토큰은 로컬 shell 환경변수 또는 로컬 전용 env 파일에만 둔다.

```bash
export NOTION_TOKEN="secret_..."
node scripts/sync-notion-alimtalk-rules.mjs
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

현재 스크립트는 위 원본의 핵심 운영 기준을 Notion child page에 요약 반영한다. 원본 문서 전체를 1:1 렌더링하는 목적이 아니라, Notion 운영자가 빠르게 확인할 분류/네이밍/자동화 기준을 유지하는 목적이다.
