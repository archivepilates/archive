#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const guardGroups = [
  {
    id: "staff-member-contact-precedence",
    reason: "현재 근무 강사와 회원이 같은 전화번호를 쓸 때 회원 동기화가 Google 연락처의 강사명을 덮는 회귀를 막습니다.",
    files: [
      {
        file: "firebase/kangsain-functions/functions/src/sync/protectedContactRules.ts",
        markers: [
          "buildActiveStaffContactIndex",
          "staff_profile_refresh",
          "activeStaffs.phones.has(phone)",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/sync/processContactSyncJobs.ts",
        markers: [
          "loadActiveStaffContactsByStudio",
          "finishProtectedStaffJob",
          "home_archivepilates: \"skipped\"",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/sync/queueStaffContactSync.ts",
        markers: [
          "queueActiveStaffContactSync",
          "sourceReason: \"staff_profile_refresh\"",
          "home_archivepilates: \"pending\"",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/exports/sync.ts",
        markers: [
          "export const queueStaffContactSync = onDocumentWritten",
          "document: \"staffs/{staffId}\"",
        ],
      },
      {
        file: "scripts/emergency-import-studiomate-member-excel.mjs",
        markers: [
          "loadActiveStaffContacts",
          "const protectedStaffContact",
          "`${group.name} 강사님`",
        ],
      },
      {
        file: "scripts/sync-studiomate-staffs-from-browser.mjs",
        markers: [
          "const staffIdScope = valueArg(\"--staff-id\")",
          "retireMissing: !staffIdScope",
          "if (options.retireMissing !== false)",
        ],
      },
      {
        file: "core/rules/index.html",
        markers: [
          "회원카드는 유지하고 Google 연락처 이름만 강사명을 우선합니다.",
          "active staffs의 전화번호로 판단",
        ],
      },
    ],
  },
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
    id: "recommended-meal-program",
    reason: "추천식단 설문, API, CORE 단건 발송, SOLAPI 짧은 링크 연결이 다른 배포에서 빠지는 것을 막습니다.",
    files: [
      {
        file: "archivein/recommendedMealSurvey/index.html",
        markers: [
          "ARCHIVE PILATES 추천식단 프로그램",
          "id=\"mealSurveyForm\"",
          "api/recommendedMealSurvey",
          "설문 제출이 완료되었습니다.",
        ],
      },
      {
        file: "firebase.json",
        markers: [
          "\"source\": \"/archivein/api/recommendedMealSurvey\"",
          "\"source\": \"/archivein/recommendedMealSurvey/**\"",
          "\"source\": \"/api/recommendedMealSurvey\"",
          "\"source\": \"/recommendedMealSurvey/**\"",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/mealPlan/recommendedMealAlimtalk.ts",
        markers: [
          "operatorSendRecommendedMealProgramAlimtalkHandler",
          "RECOMMENDED_MEAL_REQUEST_COLLECTION",
          "recommended_meal_survey",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/alimtalk/templates.ts",
        markers: [
          "KA01TP260728111926523p2JzzTgHsS8",
          "ST01FZ260730122108103pEzxH5jOOpU",
          "KA01PF260511123220162lk0NUjstpVl",
          "label: \"아카이브 추천식단 프로그램\"",
          "status: \"approved\"",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/alimtalk/eligibility.ts",
        markers: [
          "recommendedMealTemplateContractIssue",
          "추천식단 템플릿 설문 버튼 계약 불일치",
          "추천식단 템플릿 설문 버튼 URL 불일치",
        ],
      },
      {
        file: "scripts/audit-recommended-meal-alimtalk-template.mjs",
        markers: [
          "KA01TP260728111926523p2JzzTgHsS8",
          "ST01FZ260730122108103pEzxH5jOOpU",
          "survey short-link button mismatch",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/mealPlan/recommendedMealSurvey.ts",
        markers: [
          "recommendedMealSurveyApiHandler",
          "recommendedMealProgramResponses",
          "review_required",
        ],
      },
    ],
  },
  {
    id: "archive-method-cue-card-video-cta",
    reason: "ARCHIVE METHOD 강사레슨 큐카드의 수업촬영영상 시청용 아임웹 가입 CTA가 main 승격이나 Hosting 배포에서 빠지는 것을 막습니다.",
    files: [
      {
        file: "archivein/method/breathing-260627/index.html",
        markers: [
          "호흡 큐카드 | ARCHIVE METHOD",
          "ARCHIVE METHOD VIDEO",
          "ARCHIVE PILATES 홈페이지 가입하기",
          "archivepilates.imweb.me/?mode=join&amp;back_url=LzQ4",
          "../../logo120.png",
        ],
      },
      {
        file: "archivein/method/pelvis-hip-260725/index.html",
        markers: [
          "골반.고관절 큐카드 | ARCHIVE METHOD",
          "ARCHIVE METHOD VIDEO",
          "ARCHIVE PILATES 홈페이지 가입하기",
          "archivepilates.imweb.me/?mode=join&amp;back_url=LzQ4",
          "../../logo120.png",
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
          "\"source\": \"/method/**\"",
        ],
      },
      {
        file: "scripts/validate-live-release-canary.mjs",
        markers: [
          "method-breathing-cue-card-custom-domain",
          "method-breathing-cue-card-webapp-path",
          "method-pelvis-hip-cue-card-custom-domain",
          "method-pelvis-hip-cue-card-webapp-path",
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
        forbiddenMarkers: [
          "write-release-manifest.mjs --surface archivein --surface core",
        ],
      },
      {
        file: "scripts/deploy-archive-core-live.sh",
        markers: [
          "validate-release-branch-state.mjs --require-origin-main",
          "write-release-manifest.mjs --surface core",
          "validate-live-release-canary.mjs --surface core",
          "verify:archive-core-responsive",
          "validate:ticket-liability-price",
          "ARCHIVE_CORE_BASE_URL=https://core.archivepilates.com",
        ],
        forbiddenMarkers: [
          "write-release-manifest.mjs --surface core --surface archivein",
        ],
      },
      {
        file: "scripts/deploy-affected-functions.mjs",
        markers: [
          "for (const codebase of affected.codebases)",
          "`functions:${codebase}`",
          "command.push(\"--force\")",
          "Deploying Functions codebase:",
          "failed to update function",
          "Firebase reported an incomplete Functions deployment",
        ],
      },
      {
        file: "scripts/reject-legacy-functions-deploy.mjs",
        markers: [
          "legacy firebase/kangsain-functions default Functions deploy is retired",
          "deploy-affected-functions.mjs",
          "process.exit(1)",
        ],
      },
      {
        file: "firebase/kangsain-functions/firebase.json",
        markers: [
          "reject-legacy-functions-deploy.mjs",
          "\"codebase\": \"default\"",
        ],
      },
      {
        file: "scripts/verify-archive-core-responsive.mjs",
        markers: [
          "mobile-320",
          "mobile-390",
          "tablet-768",
          "desktop-1440",
          "horizontalOverflow",
          "metricHeightMismatch",
          "metricContentOverflow",
          "shortTouchTarget",
        ],
      },
      {
        file: ".github/workflows/firebase-hosting-release.yml",
        markers: [
          "Firebase Hosting Release",
          "workflow_dispatch",
          "FIREBASE_SERVICE_ACCOUNT_ARCHIVE_PILATES",
          "validate:live-release-canary",
          "hosting:archive-pilates,hosting:archive-pilates-core",
        ],
      },
      {
        file: "firebase.json",
        markers: [
          "\"site\": \"archive-pilates\"",
          "\"site\": \"archive-pilates-core\"",
          "validate-release-branch-state.mjs --require-origin-main",
          "npm run validate:onsite-welcome",
          "npm run validate:archive-core-hosting",
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
          "parkingOwnerNameField",
          "parkingOwnerPhoneField",
          "수강료 문의",
          "pricingInquiryForm",
          "pricingInquiryHistoryPanel",
          "최근 발송/메모 보기",
          "recommendedMealProgramForm",
          "recommendedMealHistoryPanel",
          "추천식단 프로그램",
          "data-core-external-shortcuts",
          "https://archivepilates.imweb.me/admin",
          "https://mail.google.com/mail/?authuser=home@archivepilates.com",
          "https://new.smartplace.naver.com/",
          "https://arcpilates.studiomate.kr/",
          "target=\"_blank\"",
          "rel=\"noopener noreferrer\"",
          "새 창에서 열기",
        ],
      },
      {
        file: "core/assets/app.js",
        markers: [
          "pricingInquiryAlimtalkRequests",
          "pricingInquiryDisplayPhone",
          "pricingInquiryHistoryPanel",
          "operatorSendPricingInquiryAlimtalk",
          "recommendedMealProgramRequests",
          "operatorSendRecommendedMealProgramAlimtalk",
          "commandQueueStatus",
          "renewalCandidateRows",
          "renderRenewalPipeline",
          "renewalCases",
          "handleRenewalActionClick",
          "data-renewal-action=\"excluded\"",
          "재등록 의사 없음",
          "predictedDepletionDate",
          "mergeMemberCardsWithProfiles",
          "coreDataHealthIssues",
          "CORE_RUNTIME_CONTRACT_VERSION",
          "renderReadHealth",
          "getBookingsForLessonWindow",
          "deriveLessonOccurrencesFromBookings",
          "normalizedLessonKind",
          "operatorLifecycle",
          "emergencyLastAttendance",
          "syncParkingVisitorFields",
          "if (isVisitor) input.value = \"\"",
          "input.disabled = isVisitor",
          "addEventListener(\"change\", syncParkingVisitorFields)",
        ],
      },
      {
        file: "core/assets/styles.css",
        markers: [
          ".kpis > .metric",
          "grid-auto-rows: 148px",
          "min-height: 148px",
          ".action-disclosure",
          ".renewal-actions",
          ".action-form label.is-disabled input:disabled",
          ".nav-secondary",
          ".admin-nav-open .nav-secondary",
        ],
      },
    ],
  },
  {
    id: "ticket-liability-price-quality",
    reason: "수강권 잔여금액 보고서가 분할결제를 회당가로 오인하거나 듀엣·강사레슨을 프라이빗·그룹 평균에 다시 섞는 회귀를 막습니다.",
    files: [
      {
        file: "scripts/generate-studiomate-ticket-liability-report.mjs",
        markers: [
          "loadPurchasePriceIndex",
          "ticketCycleKey",
          "ticket-liability-v4",
          "1:1 프라이빗 평균 회당가격",
          "잔여금액 비율",
        ],
      },
      {
        file: "scripts/lib/ticket-liability-price-policy.mjs",
        markers: [
          "ticketPriceCategory",
          "reservation_only",
          "동일권종 기준가 보정",
          "adjustedPriceRows",
        ],
      },
      {
        file: "core/business/index.html",
        markers: [
          "1:1 프라이빗 평균 회당가격",
          "ticketLiabilityDuetAverage",
          "ticketLiabilityDuetAverageBasis",
          "잔여금액 비율",
        ],
      },
      {
        file: "core/assets/app.js",
        markers: [
          "ticketLiabilityDuetAverage",
          "ticketLiabilityDuetAverageBasis",
        ],
      },
    ],
  },
  {
    id: "renewal-personalization",
    reason: "재등록 듀엣 분류, 예상 소진일, 상담 장부, 발송 직전 재등록 차단이 후속 배포에서 빠지는 것을 막습니다.",
    files: [
      {
        file: "firebase/kangsain-functions/functions/src/renewal/renewalPolicy.ts",
        markers: [
          "hasSameKindAlternativeTicket",
          '"쿠폰"',
          "renewalSourceTicketKey",
          "predictedDepletionDate",
          "weeklyPace",
          "듀엣|duet|세미",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/alimtalk/renewalSendGuard.ts",
        markers: [
          "renewalCandidateSendabilityIssue",
          "동일 유형 후속 수강권 보유",
          "renewalCandidateProfileIssue",
        ],
      },
      {
        file: "core/assets/app.js",
        markers: ['"쿠폰"', "sameKindTickets.length < 2", "isHealthyBackupTicket"],
      },
      {
        file: "firebase/kangsain-functions/firestore.rules",
        markers: ["match /renewalCases/{caseId}", "operatorUpdatedByUid", "nextActionAt"],
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
          "ownerType === \"visitor\" ? \"방문객\"",
          "ownerType === \"visitor\" ? \"\"",
          "ownerName: isVisitor ? \"방문객\" : vehicle.ownerName",
          "ownerPhone: isVisitor ? \"\" : vehicle.ownerPhone",
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
          "방문 차량은 일회성 등록이므로 차량번호와 선택 메모만 입력",
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
          "resolveIparkingAccountStoreSeq(account, params.storSeq)",
          "role: account.role",
          "product_store_mismatch",
          "applied_verify",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/parking/iparkingClient.ts",
        markers: [
          "IPARKING_ACCOUNT_POOL_JSON",
          "parseIparkingAccountPool",
          "resolveIparkingAccountStoreSeq",
          "role: \"main\" | \"sub\"",
          "storeSeq?: number",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/exports/app.ts",
        markers: [
          "iparkingAccountPoolJson,",
          "const parkingDiscountJobOptions",
          "secrets: [",
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
          "메인 계정은 704호와 705호",
          "서브 계정은 504호부터 508호",
          "각 계정의 고유 상점 번호",
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
          "회원에게는 노출되지 않습니다.",
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
        ],
      },
      {
        file: "scripts/lib/private-session-order-policy.mjs",
        markers: [
          "past_unchecked_attendance",
          "usage_booking_",
          "missing_from_latest_reservation_import",
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
          "예약 원천은 bookings, 회차 원천은 bookings에서 계산한 privateSessionLedger입니다.",
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
          "supersededByBookingId",
          "replacePageContent",
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
          "supersededByBookingId를 우선 따라 같은 수업 세션으로 이관",
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
    id: "reservation-open-alimtalk-v4",
    reason: "삭제된 예약안내 v3가 다시 연결되거나 승인된 v4의 이미지·변수·버튼 계약이 빠지는 것을 막습니다.",
    files: [
      {
        file: "firebase/kangsain-functions/functions/src/alimtalk/templates.ts",
        markers: [
          "KA01TP26072806273194229P2ZesQwPp",
          "ST01FZ260728062730347ZXJsa4lUJuP",
          "스튜디오메이트 예약 안내 v4",
        ],
        forbiddenMarkers: [
          "KA01TP260518023011547VpbovK8MrI9",
          "스튜디오메이트 예약 안내 v3",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/alimtalk/eligibility.ts",
        markers: [
          "reservationOpenTemplateContractIssue",
          "예약오픈 안내 템플릿 예약주차 변수 없음",
          "https://archivepilates.notion.site/notice",
          "https://archivepilates.notion.site/studiomate",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/alimtalk/dedupe.ts",
        markers: [
          "\"private_survey\", \"reservation_open\"",
          "sameWeekSend",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/alimtalk/approvalGate.ts",
        markers: [
          "alimtalkApprovalId",
          "reservation_open",
        ],
      },
      {
        file: "firebase/kangsain-functions/functions/src/alimtalk/queueDailyAlimtalk.ts",
        markers: [
          "approvalScope: \"reservation_open\"",
        ],
      },
      {
        file: "core/rules/index.html",
        markers: [
          "스튜디오메이트 예약 안내 v4",
          "동일 예약주차 기준 6일",
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
          "Notion은 표시·열람용입니다. Private Session Records DB, 웹훅 승인, 예약 스케줄러는 사용하지 않습니다.",
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
