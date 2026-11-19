#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="archive-pilates"
SERVICE_ACCOUNT="archive-codex-operator@archive-pilates.iam.gserviceaccount.com"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_ROOT="$(node --input-type=module -e 'const { archiveAutomationRoot } = await import(process.argv[1]); console.log(archiveAutomationRoot())' "$SCRIPT_DIR/lib/archive-automation-paths.mjs")"
KEY_FILE="$AUTOMATION_ROOT/secrets/google/archive-codex-operator.json"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "Missing service account key: $KEY_FILE" >&2
  return 1 2>/dev/null || exit 1
fi

gcloud auth activate-service-account "$SERVICE_ACCOUNT" \
  --key-file="$KEY_FILE" \
  --project="$PROJECT_ID" >/dev/null
gcloud config set account "$SERVICE_ACCOUNT" >/dev/null
gcloud config set project "$PROJECT_ID" >/dev/null

export GOOGLE_APPLICATION_CREDENTIALS="$KEY_FILE"
export GOOGLE_CLOUD_PROJECT="$PROJECT_ID"
export GCLOUD_PROJECT="$PROJECT_ID"
# firebase-tools prefers its cached interactive login over ADC. Keep deployment
# commands on an isolated config path so they always use this service account.
export XDG_CONFIG_HOME="${ARCHIVE_FIREBASE_XDG_CONFIG_HOME:-$AUTOMATION_ROOT/automation/firebase-service-account-config}"
mkdir -p "$XDG_CONFIG_HOME"
# Firebase CLI now supports Application Default Credentials directly.
# Keeping FIREBASE_TOKEN in the environment makes firebase-tools print a
# deprecation warning and can make auth behavior harder to reason about.
unset FIREBASE_TOKEN

echo "ARCHIVE PILATES OPS Firebase service account ready for project $PROJECT_ID."
echo "Use: firebase --project $PROJECT_ID <command>"
