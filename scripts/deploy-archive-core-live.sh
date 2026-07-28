#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/use-archivein-firebase-service-account.sh" >/dev/null

echo "== ARCHIVE CORE live deploy: guard =="
node scripts/validate-release-branch-state.mjs --require-origin-main
npm run validate:live-release-rollback-guards
npm run validate:archive-core-hosting
npm run verify:archive-core-responsive
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
curl -fsSL https://core.archivepilates.com/members/ -o "$TMP_DIR/members.html"
curl -fsSL https://core.archivepilates.com/members/detail/ -o "$TMP_DIR/member-detail.html"
curl -fsSL https://core.archivepilates.com/lessons/ -o "$TMP_DIR/lessons.html"
curl -fsSL https://core.archivepilates.com/private/ -o "$TMP_DIR/private.html"
curl -fsSL https://core.archivepilates.com/messages/ -o "$TMP_DIR/messages.html"
curl -fsSL https://core.archivepilates.com/staff/ -o "$TMP_DIR/staff.html"
curl -fsSL https://core.archivepilates.com/automation/ -o "$TMP_DIR/automation.html"
grep -q "오늘 처리할 일" "$TMP_DIR/core.html"
grep -q "homeDecisionList" "$TMP_DIR/core.html"
grep -q "재등록 관리" "$TMP_DIR/core.html"
grep -q "renewalPipelineList" "$TMP_DIR/core.html"
grep -q "renewalCandidateRows" "$TMP_DIR/app.js"
grep -q "parkingRegistrationForm" "$TMP_DIR/core.html"
grep -q "수강료 문의" "$TMP_DIR/core.html"
grep -q "pricingInquiryForm" "$TMP_DIR/core.html"
grep -q "pricingInquiryHistoryPanel" "$TMP_DIR/app.js"
grep -q ".kpis > .metric" "$TMP_DIR/styles.css"
grep -q ".action-disclosure" "$TMP_DIR/styles.css"
grep -q ".nav-secondary" "$TMP_DIR/styles.css"
grep -q "memberSearchInput" "$TMP_DIR/members.html"
grep -q "membersTable" "$TMP_DIR/members.html"
grep -q "memberDetailPrimaryAction" "$TMP_DIR/member-detail.html"
grep -q "memberDetailTicketsList" "$TMP_DIR/member-detail.html"
grep -q "lessonsTodayList" "$TMP_DIR/lessons.html"
grep -q "lessonsDeletedList" "$TMP_DIR/lessons.html"
grep -q "connectionLabel" "$TMP_DIR/lessons.html"
grep -q "privateInstructorPendingList" "$TMP_DIR/private.html"
grep -q "privateProgressList" "$TMP_DIR/private.html"
grep -q "messagesDecisionList" "$TMP_DIR/messages.html"
grep -q "messagesSendList" "$TMP_DIR/messages.html"
grep -q "staffHrList" "$TMP_DIR/staff.html"
grep -q "automationHealthList" "$TMP_DIR/automation.html"
grep -q "CORE_RUNTIME_CONTRACT_VERSION" "$TMP_DIR/app.js"
grep -q "renderReadHealth" "$TMP_DIR/app.js"
grep -q "getBookingsForLessonWindow" "$TMP_DIR/app.js"
grep -q "deriveLessonOccurrencesFromBookings" "$TMP_DIR/app.js"
grep -q "normalizedLessonKind" "$TMP_DIR/app.js"
grep -q "operatorLifecycle" "$TMP_DIR/app.js"
ARCHIVE_CORE_BASE_URL=https://core.archivepilates.com npm run verify:archive-core-responsive
node scripts/validate-live-release-canary.mjs --surface core

echo "== ARCHIVE CORE live deploy complete =="
