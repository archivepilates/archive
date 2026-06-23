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
if [ "${RUN_ARCHIVEIN_ADMIN_VERIFY:-0}" = "1" ]; then
  if [ ! -d "$ROOT_DIR/node_modules/playwright" ]; then
    echo "== ARCHIVE IN live deploy: installing root verification dependencies =="
    npm ci
  fi
  npm run verify:archivein-admin
else
  echo "Skipping retired ARCHIVE IN operator root verification. Set RUN_ARCHIVEIN_ADMIN_VERIFY=1 to run the legacy admin probe."
fi
node scripts/validate-live-release-canary.mjs --surface archivein

echo "== ARCHIVE IN live deploy complete =="
