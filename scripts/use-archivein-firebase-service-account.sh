#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="archive-pilates"
SERVICE_ACCOUNT="archive-codex-operator@archive-pilates.iam.gserviceaccount.com"
KEY_FILE="/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json"

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
# Firebase CLI now supports Application Default Credentials directly.
# Keeping FIREBASE_TOKEN in the environment makes firebase-tools print a
# deprecation warning and can make auth behavior harder to reason about.
unset FIREBASE_TOKEN

echo "ArchiveIN Firebase service account ready for project $PROJECT_ID."
echo "Use: firebase --project $PROJECT_ID <command>"
