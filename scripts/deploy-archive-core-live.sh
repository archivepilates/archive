#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/use-archivein-firebase-service-account.sh" >/dev/null

echo "== ARCHIVE CORE live deploy: guard =="
node scripts/validate-release-branch-state.mjs --require-origin-main
npm run validate:live-release-rollback-guards
npm run validate:archive-core-hosting
node scripts/write-release-manifest.mjs --surface core --surface archivein

echo "== ARCHIVE CORE live deploy: hosting dry-run =="
firebase deploy --project archive-pilates --config firebase.json --only hosting:archive-pilates,hosting:archive-pilates-core --dry-run --non-interactive

echo "== ARCHIVE CORE live deploy: hosting =="
firebase deploy --project archive-pilates --config firebase.json --only hosting:archive-pilates,hosting:archive-pilates-core --non-interactive

echo "== ARCHIVE CORE live deploy: live verification =="
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
curl -fsSL https://core.archivepilates.com/ -o "$TMP_DIR/core.html"
curl -fsSL https://core.archivepilates.com/assets/app.js -o "$TMP_DIR/app.js"
curl -fsSL https://core.archivepilates.com/assets/styles.css -o "$TMP_DIR/styles.css"
grep -q "재등록 관리" "$TMP_DIR/core.html"
grep -q "renewalPipelineList" "$TMP_DIR/core.html"
grep -q "renewalCandidateRows" "$TMP_DIR/app.js"
grep -q "수강료 문의 즉시발송" "$TMP_DIR/core.html"
grep -q "pricingInquiryHistoryPanel" "$TMP_DIR/app.js"
grep -q ".kpis > .metric" "$TMP_DIR/styles.css"
node scripts/validate-live-release-canary.mjs --surface core

echo "== ARCHIVE CORE live deploy complete =="
