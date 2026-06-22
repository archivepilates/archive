#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/use-archivein-firebase-service-account.sh" >/dev/null

echo "== ARCHIVE CORE live deploy: guard =="
npm run validate:release-branch-state
npm run validate:live-release-rollback-guards
npm run validate:archive-core-hosting

echo "== ARCHIVE CORE live deploy: hosting dry-run =="
firebase deploy --project archive-pilates --config firebase.json --only hosting:archive-pilates-core --dry-run --non-interactive

echo "== ARCHIVE CORE live deploy: hosting =="
firebase deploy --project archive-pilates --config firebase.json --only hosting:archive-pilates-core --non-interactive

echo "== ARCHIVE CORE live deploy: live verification =="
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
for attempt in 1 2 3 4 5; do
  curl -fsSL https://core.archivepilates.com/ -o "$TMP_DIR/core.html"
  curl -fsSL https://core.archivepilates.com/staff/ -o "$TMP_DIR/staff.html"
  curl -fsSL https://core.archivepilates.com/assets/app.js -o "$TMP_DIR/app.js"
  curl -fsSL https://core.archivepilates.com/assets/styles.css -o "$TMP_DIR/styles.css"
  if grep -q "수강료 문의 즉시발송" "$TMP_DIR/core.html" &&
    grep -q "Staff <small>강사</small>" "$TMP_DIR/core.html" &&
    grep -q "강사 인사기록카드" "$TMP_DIR/staff.html" &&
    grep -q "staffHrList" "$TMP_DIR/staff.html" &&
    grep -q "pricingInquiryHistoryPanel" "$TMP_DIR/app.js" &&
    grep -q "submitInstructorEvaluationQuiz" "$TMP_DIR/app.js" &&
    grep -q ".kpis > .metric" "$TMP_DIR/styles.css"; then
    echo "Live verification passed on attempt $attempt."
    break
  fi

  if [ "$attempt" = "5" ]; then
    echo "ARCHIVE CORE live verification failed after CDN propagation retries." >&2
    exit 1
  fi

  echo "Live verification retry $attempt/5: waiting for Hosting/CDN propagation..."
  sleep 2
done

echo "== ARCHIVE CORE live deploy complete =="
