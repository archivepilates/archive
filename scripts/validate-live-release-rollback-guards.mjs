#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const guardGroups = [
  {
    id: "archive-in-retired-operator-root",
    reason: "ARCHIVE IN 운영자 루트가 예전 앱 화면으로 되돌아가고 private-chart 최신 화면을 덮는 것을 막습니다.",
    files: [
      {
        file: "archivein/index.html",
        markers: [
          "ARCHIVE IN 운영자 앱 종료 안내",
          "ARCHIVE CORE",
          "private-chart",
          "onsiteWelcome",
        ],
      },
      {
        file: "archivein/manifest.webmanifest",
        markers: [
          "ARCHIVE IN 운영자 앱 종료 안내",
          "\"short_name\": \"ARCHIVE IN\"",
        ],
      },
      {
        file: "archivein/sw.js",
        markers: [
          "LEGACY_CACHE_PREFIX",
          "archive-in-",
          "caches.delete",
        ],
      },
    ],
  },
  {
    id: "private-survey-native-form",
    reason: "회원 프라이빗 사전설문 페이지와 제출 API rewrite가 main 승격 과정에서 빠지는 것을 막습니다.",
    files: [
      {
        file: "archivein/privateSurvey/index.html",
        markers: [
          "ARCHIVE PILATES 프라이빗 사전설문",
          "id=\"surveyForm\"",
          "api/privateSurveySubmit",
          "제출이 완료되었습니다.",
        ],
      },
      {
        file: "firebase.json",
        markers: [
          "\"source\": \"/archivein/api/privateSurveySubmit\"",
          "\"source\": \"/archivein/privateSurvey/**\"",
          "\"source\": \"/api/privateSurveySubmit\"",
          "\"source\": \"/privateSurvey/**\"",
        ],
      },
      {
        file: "scripts/validate-live-release-canary.mjs",
        markers: [
          "private-survey-form-custom-domain",
          "private-survey-form-webapp-path",
        ],
      },
    ],
  },
  {
    id: "archive-method-breathing-cue-card",
    reason: "ARCHIVE METHOD 호흡 강사레슨 큐카드와 검토 저장 API가 main 승격이나 Hosting 배포에서 빠지는 것을 막습니다.",
    files: [
      {
        file: "archivein/method/breathing-260627/index.html",
        markers: [
          "호흡 큐카드 | ARCHIVE METHOD",
          "data-lesson-id=\"breathing-260627\"",
          "archive.method.review.",
          "window.location.pathname.startsWith('/archivein/')",
          "fetch(reviewEndpoint",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/method/methodCueCardReview.ts",
        markers: [
          "methodCueCardReviewHandler",
          "methodCueCardReviews",
          "METHOD_CUE_CARD_REVIEW_SPREADSHEET_ID",
          "ALLOWED_LESSON_IDS",
          "invalid_submission_id",
          "isAlreadyExistsError",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/exports/privateChart.ts",
        markers: [
          "methodCueCardReviewHandler",
          "export const methodCueCardReview",
        ],
      },
      {
        file: "firebase/codebase-boundaries.json",
        markers: [
          "\"methodCueCardReview\"",
        ],
      },
      {
        file: "firebase/packages/contracts/src/firestore.ts",
        markers: [
          "methodCueCardReviews: \"methodCueCardReviews\"",
          "archiveCollections.methodCueCardReviews",
        ],
      },
      {
        file: "scripts/lib/affected-functions.mjs",
        markers: [
          "firebase/kangsain-functions/functions/src/method/",
        ],
      },
      {
        file: ".github/workflows/functions-affected-check.yml",
        markers: [
          "archivein/method/**",
        ],
      },
      {
        file: "firebase.json",
        markers: [
          "\"source\": \"/archivein/method/**\"",
          "\"source\": \"/archivein/api/methodCueCardReview\"",
          "\"source\": \"/method/**\"",
          "\"source\": \"/api/methodCueCardReview\"",
        ],
      },
      {
        file: "scripts/validate-live-release-canary.mjs",
        markers: [
          "method-breathing-cue-card-custom-domain",
          "method-breathing-cue-card-webapp-path",
          "method-cue-card-review-api-custom-domain",
          "method-cue-card-review-api-webapp-path",
        ],
      },
    ],
  },
  {
    id: "deploy-release-safety",
    reason: "오래된 브랜치나 배포 스냅샷이 live Hosting을 덮어쓰는 것을 배포 스크립트 단계에서 차단합니다.",
    files: [
      {
        file: "scripts/validate-release-branch-state.mjs",
        markers: [
          "--require-origin-main",
          "Deploy guard requires HEAD to match origin/main exactly",
          "exactOriginMain",
        ],
      },
      {
        file: "scripts/write-release-manifest.mjs",
        markers: [
          "archivein/release.json",
          "core/release.json",
          "requiresOriginMain",
          "criticalMarkers",
        ],
      },
      {
        file: "scripts/validate-live-release-canary.mjs",
        markers: [
          "live-release-canary",
          "private-chart-upload-custom-domain",
          "core-home-actions-custom-domain",
          "sha_mismatch",
        ],
      },
      {
        file: "scripts/deploy-archivein-live.sh",
        markers: [
          "validate-release-branch-state.mjs --require-origin-main",
          "write-release-manifest.mjs --surface archivein",
          "validate-live-release-canary.mjs --surface archivein",
        ],
      },
      {
        file: "scripts/deploy-archive-core-live.sh",
        markers: [
          "validate-release-branch-state.mjs --require-origin-main",
          "write-release-manifest.mjs --surface core",
          "validate-live-release-canary.mjs --surface core",
        ],
      },
      {
        file: ".github/workflows/firebase-hosting-release.yml",
        markers: [
          "Firebase Hosting Release",
          "workflow_dispatch",
          "FIREBASE_SERVICE_ACCOUNT_ARCHIVE_PILATES",
          "validate:live-release-canary",
        ],
      },
    ],
  },
  {
    id: "archive-core-home-actions",
    reason: "ARCHIVE CORE 오늘 업무 큐와 재등록·주차·수강료 발송 UI가 예전 번들로 되돌아가는 것을 막습니다.",
    files: [
      {
        file: "core/index.html",
        markers: [
          "오늘 처리할 일",
          "homeDecisionList",
          "재등록 관리",
          "renewalPipelineList",
          "parkingRegistrationForm",
          "수강료 문의",
          "pricingInquiryForm",
          "pricingInquiryHistoryPanel",
          "최근 발송/메모 보기",
        ],
      },
      {
        file: "core/assets/app.js",
        markers: [
          "pricingInquiryAlimtalkRequests",
          "pricingInquiryDisplayPhone",
          "pricingInquiryHistoryPanel",
          "operatorSendPricingInquiryAlimtalk",
          "commandQueueStatus",
          "renewalCandidateRows",
          "renderRenewalPipeline",
          "mergeMemberCardsWithProfiles",
          "coreDataHealthIssues",
        ],
      },
      {
        file: "core/assets/styles.css",
        markers: [
          ".kpis > .metric",
          "min-height: 156px",
          ".action-disclosure",
          ".nav-secondary",
          ".admin-nav-open .nav-secondary",
        ],
      },
    ],
  },
  {
    id: "pricing-inquiry-alimtalk",
    reason: "수강료 문의 알림톡 발송과 내부 메모 기록 기능이 빠지는 것을 막습니다.",
    files: [
      {
        file: "firebase/kangsain-functions/functions/src/alimtalk/pricingInquiryAlimtalk.ts",
        markers: [
          "pricingInquiryAlimtalkRequests",
          "operatorSendPricingInquiryAlimtalkHandler",
          "note",
          "pricingUrl",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/exports/alimtalk.ts",
        markers: [
          "operatorSendPricingInquiryAlimtalk",
          "operatorSendPricingInquiryAlimtalkHandler",
        ],
      },
    ],
  },
  {
    id: "core-parking-vehicle-removal",
    reason: "등록 차량 삭제와 회원/강사 카드 미러 정리가 후속 CORE 또는 Functions 배포에서 빠지는 것을 막습니다.",
    files: [
      {
        file: "core/assets/app.js",
        markers: [
          "handleParkingVehicleListClick",
          "data-parking-vehicle-id",
          "removeParkingVehicle",
          "앞으로 자동 주차권을 적용하지 않습니다.",
        ],
      },
      {
        file: "core/assets/styles.css",
        markers: [
          ".parking-row-actions",
          ".parking-delete-button",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/parking/parkingOperations.ts",
        markers: [
          "removeParkingVehicleHandler",
          "status: \"archived\"",
          "defaultVehicleNumber: FieldValue.delete()",
          "ownerVehicleMirror",
          "SCHEDULED_BOOKING_LOOKBACK_MINUTES",
          "loadParkingCandidateBookings",
          "scanMode === \"full_day\"",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/exports/app.ts",
        markers: [
          "removeParkingVehicleHandler",
          "export const removeParkingVehicle",
        ],
      },
      {
        file: "firebase/codebase-boundaries.json",
        markers: [
          "\"removeParkingVehicle\"",
        ],
      },
      {
        file: "scripts/lib/affected-functions.mjs",
        markers: [
          "parking/parkingOperations.ts",
          "[\"functions-app\", \"functions-sync\"]",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/exports/sync.ts",
        markers: [
          "scheduledCreateParkingDiscountJobs",
          "scanMode: \"scheduled_window\"",
        ],
      },
      {
        file: "firebase/kangsain-functions/firestore.indexes.json",
        markers: [
          "\"fieldPath\": \"appStatus\"",
          "\"fieldPath\": \"lectureStartAt\"",
        ],
      },
      {
        file: "core/rules/index.html",
        markers: [
          "차량을 보관 상태로 전환",
          "최근 75분 구간만 읽습니다.",
          "오늘 자동적용 실행만 누락 복구를 위해 오늘 전체를 확인합니다.",
        ],
      },
    ],
  },
  {
    id: "parking-staff-fixed-four-hours",
    reason: "강사 차량의 4시간 고정 할인 규칙이 다른 주차 또는 Functions 배포에서 2시간으로 되돌아가는 것을 막습니다.",
    files: [
      {
        file: "firebase/kangsain-functions/functions/src/parking/parkingDiscountPolicy.ts",
        markers: [
          "PARKING_DISCOUNT_UNIT_HOURS = 2",
          "STAFF_REQUIRED_DISCOUNT_HOURS = 4",
          "isStaffParkingJob",
          "policy: \"staff_fixed_4h\"",
          "requestedDiscountHours: STAFF_REQUIRED_DISCOUNT_HOURS",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/parking/processParkingDiscountJob.ts",
        markers: [
          "resolveParkingDiscountPolicy(job)",
          "parkingPolicy: parkingPolicy.policy",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/parking/parkingOperations.ts",
        markers: [
          "STAFF_REQUIRED_DISCOUNT_HOURS,",
          "input.ownerType === \"staff\" ? STAFF_REQUIRED_DISCOUNT_HOURS",
          "parkingPolicy: input.ownerType === \"staff\" ? \"staff_fixed_4h\" : \"standard\"",
        ],
      },
      {
        file: "core/rules/index.html",
        markers: [
          "강사 차량은 수업 종류와 수업 시간에 관계없이",
          "총 4시간을 적용합니다.",
        ],
      },
    ],
  },
  {
    id: "private-chart-edit-before-send",
    reason: "프라이빗 리포트 발송 전 수정 기능과 다음수업 메모 분리 정책이 롤백되는 것을 막습니다.",
    files: [
      {
        file: "archivein/private-chart/index.html",
        markers: [
          "reportSummaryEdit",
          "reportNextDirectionEdit",
          "data-save-report-edit",
          "회원 리포트 알림톡 발송이 완료되어 기록을 수정할 수 없습니다.",
          "다음 수업 준비 메모",
          "회원 리포트의 다음 수업 방향에는 그대로 노출되지 않습니다.",
          "오늘의 핵심 키워드",
          "다음 수업 방향 키워드",
          "홈워크",
          "previousReportHtml",
          "withOtherChoice(field.options)",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts",
        markers: [
          "String(body.action || \"\") === \"editReport\"",
          "publicSummary",
          "publicNextDirection",
          "delete (postRecord as Record<string, unknown>).nextMemo",
          "summaryKeywords",
          "nextDirectionKeywords",
          "homework",
          "previousPrivateLessonReportSummary",
          "applyPrivateLessonReportKeywords",
          "점수, 평균, 등급, 평가처럼 느껴지는 표현은 쓰지 않습니다.",
          "다음 수업 방향",
          "white-space:pre-wrap",
          "overflow-wrap:anywhere",
          ".note{padding:16px",
        ],
      },
    ],
  },
  {
    id: "private-media-drive-direct-upload",
    reason: "프라이빗 사진/영상 업로드가 Drive 직접 업로드가 아닌 예전 Function 중계 구조로 되돌아가는 것을 막습니다.",
    files: [
      {
        file: "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonMedia.ts",
        markers: [
          "const CHUNK_SIZE = 16 * 1024 * 1024;",
          "directUpload",
          "uploadMode: \"drive_direct\"",
          "completePrivateLessonMediaUpload",
        ],
      },
      {
        file: "archivein/private-chart/index.html",
        markers: [
          "input type=\"file\" id=\"mediaFiles\" accept=\"image/*,video/*\" multiple",
          "init.chunkSize || 16 * 1024 * 1024",
          "uploadMediaFileDirect",
          "completeMediaUpload",
          "Drive 직접 업로드 중",
        ],
      },
      {
        file: "scripts/validate-private-media-upload-live.mjs",
        markers: [
          "uploadMode: \"drive_direct\"",
          "chunkSize",
          "completeMediaUpload",
        ],
      },
    ],
  },
  {
    id: "bookings-single-source-private-session-ledger",
    reason: "프라이빗 회차가 memberUsageEvents나 과거 미체크 예약으로 부풀려지는 것을 막고 bookings 단일 예약 원천 정책을 유지합니다.",
    files: [
      {
        file: "scripts/recompute-private-session-ledger.mjs",
        markers: [
          "computedFrom: [\"bookings\"]",
          "bookings_single_reservation_snapshot_attended_or_today_future",
          "past_unchecked_attendance",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts",
        markers: [
          "isPastUncheckedBooking",
          "past_unchecked_attendance",
          "nextSessionNumberFromPrivateLedger",
        ],
      },
      {
        file: "scripts/validate-data-source-policy.mjs",
        markers: [
          "memberUsageEvents is legacy audit data, not a live source",
          "privateSessionLedger must be recomputed from the single bookings reservation source",
        ],
      },
      {
        file: "core/rules/index.html",
        markers: [
          "예약·출석·프라이빗 회차 판단의 단일 예약 원천은 bookings입니다.",
          "memberUsageEvents는 legacy 검증·백필 자료로만 보관",
          "StudioMate 수업예약내역 Excel → bookings 단일 예약 원천 → privateSessionLedger 회차",
        ],
      },
    ],
  },
  {
    id: "private-session-reschedule-reconcile",
    reason: "프라이빗 수업 시간변경/취소 시 기존 설문 링크와 Notion 차트가 과거 예약으로 롤백되는 것을 막습니다.",
    files: [
      {
        file: "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts",
        markers: [
          "findReplacementPrivateBookingForChartRequest",
          "syncChartRequestToActiveBooking",
          "rescheduled_from_inactive_booking",
          "rescheduled_booking_reuse",
          "update private session record page title failed",
        ],
      },
      {
        file: "scripts/recompute-private-session-ledger.mjs",
        markers: [
          "migrate_chart_request_to_rescheduled_booking",
          "replacementBookingForRequest",
          "rescheduled booking matched during privateSessionLedger recompute",
        ],
      },
      {
        file: "core/rules/index.html",
        markers: [
          "삭제, 취소, 시간변경은 sessionOrder.counted=false와 제외 사유를 남기고 해당 수업 이후 회차까지 연쇄 재계산합니다.",
          "기존 설문 링크만 남아 있으면 같은 회원, 강사, 날짜의 active booking으로 요청과 차트를 자동 이관",
          "예약 시간이 바뀌거나 취소되면 Notion 제목, 날짜, 상태, 회차, 발송상태를 함께 갱신",
        ],
      },
    ],
  },
  {
    id: "onsite-welcome-current-flow",
    reason: "현장 웰컴 가입서 알림톡과 StudioMate 후속 처리 흐름이 예전 코드로 되돌아가는 것을 막습니다.",
    files: [
      {
        file: "archivein/onsiteWelcome/index.html",
        markers: [
          "가입서 링크 준비",
          "웰컴 알림톡 발송 완료",
          "스튜디오메이트 확인 대기",
          "서명완료 가입서 PDF 폴더",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/memberSignup/onsiteWelcomeRequest.ts",
        markers: [
          "onsiteWelcomeRequestHandler",
          "lookup_ready",
          "sendOnsiteWelcomeAlimtalkForRequest",
        ],
      },
      {
        file: "scripts/process-onsite-welcome-requests.mjs",
        markers: [
          "onsiteWelcomeRequests",
          "StudioMate",
          "memberSignupContracts",
        ],
      },
    ],
  },
  {
    id: "core-operating-rules",
    reason: "Notion 대신 ARCHIVE CORE 운영규칙 탭을 기준으로 쓰는 운영 정책이 빠지는 것을 막습니다.",
    files: [
      {
        file: "core/rules/index.html",
        markers: [
          "운영규칙",
          "수강료 문의 즉시발송",
          "Private Session Records DB는 사용하지 않습니다",
          "업로드는 16MB 청크 기준",
          "기능 브랜치만 라이브에 배포되고 main으로 승격되지 않은 상태는 rollback",
        ],
      },
    ],
  },
];

const failures = [];
for (const group of guardGroups) {
  for (const item of group.files) {
    const content = readFile(item.file);
    if (!content) {
      failures.push({ group: group.id, reason: group.reason, file: item.file, missing: "__file__" });
      continue;
    }
    for (const marker of item.markers) {
      if (!content.includes(marker)) {
        failures.push({ group: group.id, reason: group.reason, file: item.file, missing: marker });
      }
    }
    for (const marker of item.forbiddenMarkers || []) {
      if (content.includes(marker)) {
        failures.push({ group: group.id, reason: group.reason, file: item.file, forbidden: marker });
      }
    }
  }
}

if (failures.length) {
  console.error("Live release rollback guard failed.");
  console.error("This deploy appears to remove or overwrite a currently active ARCHIVE PILATES feature.");
  console.error(JSON.stringify({ failures }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      guard: "archive-live-release-rollback-guards",
      groups: guardGroups.map((group) => group.id),
      checkedFiles: [...new Set(guardGroups.flatMap((group) => group.files.map((item) => item.file)))],
    },
    null,
    2,
  ),
);

function readFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
}
