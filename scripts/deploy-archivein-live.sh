#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/use-archivein-firebase-service-account.sh" >/dev/null

echo "== ARCHIVE IN live deploy: onsite welcome guard =="
node scripts/validate-release-branch-state.mjs --require-origin-main
npm run validate:live-release-rollback-guards
npm run validate:onsite-welcome
node scripts/write-release-manifest.mjs --surface archivein --surface core

echo "== ARCHIVE IN live deploy: Firestore rules dry-run =="
firebase deploy --project archive-pilates --config firebase.json --only firestore:rules --dry-run

echo "== ARCHIVE IN live deploy: Firestore rules + Hosting =="
firebase deploy \
  --project archive-pilates \
  --config firebase.json \
  --only firestore:rules,hosting:archive-pilates,hosting:archive-pilates-in

echo "== ARCHIVE IN live deploy: operator access verification =="
npm run verify:archivein-admin
node scripts/validate-live-release-canary.mjs --surface archivein

echo "== ARCHIVE IN live deploy complete =="
