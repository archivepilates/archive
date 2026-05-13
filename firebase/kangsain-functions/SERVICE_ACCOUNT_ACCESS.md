# Archive Pilates Service Account Access

이 문서는 다른 Codex/AI가 `archive-pilates` Firebase/GCP 작업을 이어받을 때 사용하는 접속 가이드다.

중요: 서비스계정 개인키 JSON은 이 문서 안에 붙여넣지 않는다. 키를 Markdown에 평문으로 넣으면 GitHub, 백업, 로그, 검색 인덱스에 노출될 수 있다. 키 파일은 로컬 보안 경로에만 둔다.

## Project

- GCP/Firebase project: `archive-pilates`
- Project number: `904688188103`
- Primary app path: `/Users/kihyokim/Documents/Codex/2026-05-02/in-ai/archive-publish`
- ArchiveIN hosting URL: `https://archive-pilates.web.app/archivein/`
- Service account: `archive-codex-operator@archive-pilates.iam.gserviceaccount.com`

## Current Status

서비스계정은 생성되어 있고 운영 권한도 부여되어 있다.

서비스계정 JSON 키가 로컬 보안 경로에 생성되어 있고, 로컬 `gcloud` 기본 계정도 서비스계정으로 전환되어 있다.

```bash
gcloud auth list --filter=status:ACTIVE --format='value(account)'
# archive-codex-operator@archive-pilates.iam.gserviceaccount.com

gcloud projects describe archive-pilates --format='value(projectId,projectNumber)'
# archive-pilates    904688188103
```

키 파일 위치:

```bash
$HOME/.config/archive-pilates/archive-codex-operator.json
```

Google Drive 공유용 암호화 파일:

```text
Google Drive/내 드라이브/10_업무/ArchiveIN/ServiceAccount/archive-codex-operator.json.enc
Google Drive/내 드라이브/10_업무/ArchiveIN/ServiceAccount/SERVICE_ACCOUNT_ENCRYPTED_KEY_README.md
```

암호 힌트:

```text
6-digit number
```

복구:

```bash
mkdir -p "$HOME/.config/archive-pilates"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in archive-codex-operator.json.enc \
  -out "$HOME/.config/archive-pilates/archive-codex-operator.json"
chmod 600 "$HOME/.config/archive-pilates/archive-codex-operator.json"
```

파일 권한:

```bash
chmod 600 "$HOME/.config/archive-pilates/archive-codex-operator.json"
```

## Preferred Long-Term Setup

완전한 로컬 장기 인증은 서비스계정 JSON 키 파일을 사용한다. 현재 이 방식으로 설정되어 있다.

권장 키 위치:

```bash
$HOME/.config/archive-pilates/archive-codex-operator.json
```

권장 환경 변수:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/archive-pilates/archive-codex-operator.json"
```

다른 컴퓨터나 다른 Codex에서 같은 키 파일을 안전하게 전달받은 뒤에는 아래 명령으로 전환한다.

```bash
gcloud auth activate-service-account \
  archive-codex-operator@archive-pilates.iam.gserviceaccount.com \
  --key-file="$HOME/.config/archive-pilates/archive-codex-operator.json" \
  --project=archive-pilates

gcloud config set account archive-codex-operator@archive-pilates.iam.gserviceaccount.com
gcloud config set project archive-pilates
```

Firebase CLI도 같은 인증을 사용하게 하려면 작업 셸에서 아래 환경 변수를 먼저 잡는다.

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/archive-pilates/archive-codex-operator.json"
```

현재 이 환경 변수는 `~/.zshrc`에도 등록되어 있다.

```bash
# >>> archive-pilates service account >>>
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/archive-pilates/archive-codex-operator.json"
export GCLOUD_PROJECT="archive-pilates"
export GOOGLE_CLOUD_PROJECT="archive-pilates"
# <<< archive-pilates service account <<<
```

Firebase CLI에 남아 있던 사용자 토큰은 로그아웃 처리했다. 따라서 Firebase CLI는 서비스계정 키를 사용한다.

```bash
npx firebase projects:list --json
# "status": "success"
# "projectId": "archive-pilates"
```

## Key Creation Policy

현재 프로젝트와 조직에는 서비스계정 키 생성 금지 정책이 다시 적용되어 있다.

정책:

```text
constraints/iam.disableServiceAccountKeyCreation
enforce: true
```

콘솔 위치:

```text
Google Cloud Console
IAM 및 관리자
조직 정책
Disable service account key creation
```

직접 링크:

```text
https://console.cloud.google.com/iam-admin/orgpolicies?project=archive-pilates
```

이미 키는 생성되어 있다. 추가 키를 발급해야 할 때만 운영자가 이 정책을 잠깐 `Enforcement off`로 바꾼 뒤 아래 명령을 실행한다.

```bash
mkdir -p "$HOME/.config/archive-pilates"
chmod 700 "$HOME/.config/archive-pilates"

gcloud iam service-accounts keys create \
  "$HOME/.config/archive-pilates/archive-codex-operator.json" \
  --iam-account="archive-codex-operator@archive-pilates.iam.gserviceaccount.com" \
  --project=archive-pilates

chmod 600 "$HOME/.config/archive-pilates/archive-codex-operator.json"
```

키 생성 후에는 정책을 다시 `Enforcement on`으로 잠근다. 현재는 다시 잠긴 상태다.

## Verification Commands

서비스계정 인증이 정상인지 확인:

```bash
gcloud auth list --format='table(account,status)'
gcloud config get-value project
gcloud projects describe archive-pilates --format='value(projectId,projectNumber)'
```

최근 함수 로그 확인:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND timestamp>="-24h" AND (resource.labels.service_name="scheduledpollmanagernotices" OR resource.labels.service_name="scheduledsynclecturesdaily")' \
  --project=archive-pilates \
  --limit=30 \
  --format='table(timestamp,severity,resource.labels.service_name,textPayload,jsonPayload.message,jsonPayload.phase,jsonPayload.seen,jsonPayload.saved,jsonPayload.errorMessage)'
```

Hosting 배포:

```bash
cd /Users/kihyokim/Documents/Codex/2026-05-02/in-ai/archive-publish
npx firebase deploy --only hosting --project archive-pilates
```

Functions 배포:

```bash
cd /Users/kihyokim/Documents/Codex/2026-05-02/in-ai/archive-publish
npx firebase deploy --only functions --project archive-pilates
```

Rules 배포:

```bash
cd /Users/kihyokim/Documents/Codex/2026-05-02/in-ai/archive-publish
npx firebase deploy --only firestore:rules --project archive-pilates
```

## Roles Granted

`archive-codex-operator@archive-pilates.iam.gserviceaccount.com`에 부여한 역할:

- `roles/firebase.admin`
- `roles/firebasehosting.admin`
- `roles/cloudfunctions.admin`
- `roles/run.admin`
- `roles/cloudbuild.builds.editor`
- `roles/artifactregistry.admin`
- `roles/iam.serviceAccountUser`
- `roles/logging.viewer`
- `roles/datastore.user`
- `roles/cloudscheduler.admin`
- `roles/eventarc.admin`
- `roles/pubsub.admin`
- `roles/secretmanager.admin`
- `roles/storage.admin`
- `roles/serviceusage.serviceUsageConsumer`

사용자 `home@archivepilates.com`에는 서비스계정 가장을 위해 해당 서비스계정에 `roles/iam.serviceAccountTokenCreator`가 부여되어 있다.
조직 `archivepilates.com`에는 정책 제어를 위해 사용자 `home@archivepilates.com`에 `roles/orgpolicy.policyAdmin`도 부여되어 있다.

## Security Rules

- 서비스계정 JSON 키는 절대 GitHub에 올리지 않는다.
- 키를 전달해야 하면 Markdown에 붙여넣지 말고 로컬 파일 또는 비밀관리 도구로 전달한다.
- 키가 노출됐다고 의심되면 즉시 해당 키를 폐기한다.
- 이 저장소의 `.gitignore`는 서비스계정 키 JSON을 무시하도록 설정되어 있다.
