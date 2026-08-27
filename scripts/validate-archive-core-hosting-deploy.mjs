import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const required = [
  {
    file: "core/index.html",
    label: "ARCHIVE CORE home latest action dashboard",
    markers: [
      "오늘 처리할 일",
      "homeDecisionList",
      "재등록 관리",
      "renewalPipelineList",
      "주차등록",
      "parkingRegistrationForm",
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
      "data-section=\"staff\"",
      "https://in.archivepilates.com/onsiteWelcome/?v=icon-check",
      "./instructor-lessons/",
      "data-ticket-liability-link",
      "./business/#ticketLiability",
      "/site.webmanifest?v=1",
      "/icons/archive-pilates-icon-192.png?v=1",
    ],
  },
  {
    file: "core/site.webmanifest",
    label: "ARCHIVE CORE app icon manifest",
    markers: ["ARCHIVE CORE", "ARCHIVE PILATES Operations Platform", "/icons/archive-pilates-icon-512.png?v=1"],
  },
  {
    file: "core/assets/app.js",
    label: "pricing inquiry send history runtime",
    markers: [
      "renewalCandidateRows",
      "renderRenewalPipeline",
      "renewalCases",
      "handleRenewalActionClick",
      "ALIMTALK_TEMPLATE_LABELS_BY_CODE",
      "alimtalkTemplateTitle",
      "humanizeAlimtalkTemplateText",
      "강사용 프라이빗 차트 작성 안내 v3",
      "predictedDepletionDate",
      "mergeMemberCardsWithProfiles",
      "coreDataHealthIssues",
      "pricingInquiryAlimtalkRequests",
      "pricingInquiryDisplayPhone",
      "pricingInquiryHistoryPanel",
      "operatorSendPricingInquiryAlimtalk",
      "recommendedMealProgramRequests",
      "operatorSendRecommendedMealProgramAlimtalk",
      "removeParkingVehicle",
      "data-parking-vehicle-id",
      "submitInstructorEvaluationQuiz",
      "SECONDARY_NAV_SECTIONS",
      "hiddenSections",
      'data-section="onsite-welcome"',
      'data-section="instructor-lessons"',
      "enhanceRuleSections",
      "CORE_RUNTIME_CONTRACT_VERSION",
      "COMMAND_MEMBER_SEARCH_MIN_LENGTH",
      "ensureMemberDirectory",
      "hasCommandMenuMatch",
      "handleCommandPaletteInput",
      "getCollectionDocumentsByIds",
      "renewalMemberProfiles",
      "renderReadHealth",
      "getBookingsForLessonWindow",
      "deriveLessonOccurrencesFromBookings",
      "normalizedLessonKind",
      "operatorLifecycle",
      "emergencyLastAttendance",
      "getInstagramContentDashboard",
      "saveInstagramContentDraft",
      "approveInstagramContent",
      "holdInstagramContent",
      "renderInstagramContentDashboard",
      "ticketLiabilityReports",
      "renderTicketLiabilityReports",
      "renderTicketLiabilityMonth",
      "getRefundMemberTickets",
      "renderRefundCandidates",
      "previewRefund",
      "sendRefundAgreement",
      "queueRefundStudioMateSms",
      "handleRefundSmsSend",
      "renderRefundCases",
      "getVideoWatchDashboard",
      "renderVideoWatchDashboard",
      "videoWatchRangeDays",
      "getInstructorLessonRegistrationDashboard",
      "operatorCreateInstructorLessonRegistration",
      "renderInstructorLessonRegistrationDashboard",
      "handleInstructorLessonRegistrationSubmit",
    ],
  },
  {
    file: "core/instructor-lessons/index.html",
    label: "instructor lesson operations hub",
    markers: [
      "data-instructor-lessons-dashboard",
      "instructorLessonRegistrationForm",
      "instructorLessonMemberName",
      "instructorLessonMemberPhone",
      "instructorLessonDate",
      "instructorLessonPaymentMethod",
      "instructorLessonRegistrationList",
      "입금 확인",
      "접수 가능 확인",
      "강사레슨 (2T)",
      "강사회원 가입서",
      "신규 강사회원은 예약 전에도 발송",
      "수업 생성 전에도 접수",
    ],
    forbiddenMarkers: [
      'data-section="members"',
      'data-section="lessons"',
      'data-section="content"',
      "강사 기록",
      "강사 테스트",
    ],
  },
  {
    file: "core/business/index.html",
    label: "monthly ticket liability dashboard",
    markers: [
      "ticketLiability",
      "ticketLiabilityMonthSelect",
      "ticketLiabilityHolders",
      "ticketLiabilityRemaining",
      "ticketLiabilityValue",
      "ticketLiabilityDelta",
      "ticketLiabilityDeltaRate",
      "ticketLiabilityCoverage",
      "ticketLiabilityGroupAverage",
      "ticketLiabilityGroupAverageBasis",
      "ticketLiabilityPrivateAverage",
      "ticketLiabilityPrivateAverageBasis",
      "ticketLiabilityDuetAverage",
      "ticketLiabilityDuetAverageBasis",
      "잔여금액 비율",
      "ticketLiabilityTableBody",
    ],
  },
  {
    file: "core/content/index.html",
    label: "Instagram content operations page",
    markers: [
      "Instagram 운영",
      "instagramApprovalList",
      "instagramScheduleList",
      "instagramDraftForm",
      "instagramPreviewDialog",
      "instagramHistoryList",
    ],
  },
  {
    file: "core/staff/index.html",
    label: "staff HR cards page",
    markers: ["강사 현황", "staffHrList", "강사별 평가 차트", "강사 테스트"],
  },
  {
    file: "core/members/index.html",
    label: "member search page",
    markers: ["회원 찾기", "memberSearchInput", "membersTable", "memberPagination"],
  },
  {
    file: "core/members/detail/index.html",
    label: "member detail page",
    markers: ["memberDetailPrimaryAction", "memberDetailTicketsList", "memberDetailPurchasesList", "member-history-disclosure"],
  },
  {
    file: "core/lessons/index.html",
    label: "lesson operations page",
    markers: ["오늘 수업", "connectionLabel", "lessonsTodayList", "lessonsInstructorList", "lessonsDeletedList"],
  },
  {
    file: "core/private/index.html",
    label: "private lesson progress page",
    markers: ["진행 현황", "privateInstructorPendingList", "privateProgressList"],
  },
  {
    file: "core/refunds/index.html",
    label: "manager-reviewed refund workflow",
    markers: [
      "환불 안내·동의서",
      "refundLookupForm",
      "refundMemberCandidates",
      "refundTicketList",
      "refundCalculationForm",
      "refundCountUsage",
      "refundPeriodRange",
      "refundPeriodRemaining",
      "refundPeriodUsage",
      "refundOptionalDetails",
      "refundMessage",
      "refundResultBalance",
      "refundConfirmCheck",
      "refundSendButton",
      "refundCaseList",
    ],
  },
  {
    file: "core/messages/index.html",
    label: "alimtalk operations page",
    markers: ["발송 관리", "messagesDecisionList", "messagesTemplateList", "messagesSendList"],
  },
  {
    file: "core/automation/index.html",
    label: "automation status page",
    markers: ["자동화 상태", "automationHealthList", "automationList"],
  },
  {
    file: "core/staff/evaluation/index.html",
    label: "instructor evaluation quiz page",
    markers: ["instructorEvaluationQuizForm", "evaluationQuizQuestions", "평가 퀴즈 제출"],
  },
  {
    file: "core/video-analytics/index.html",
    label: "paid video watch analytics dashboard",
    markers: [
      "영상 시청 현황",
      "data-video-watch-dashboard",
      "videoWatchRange",
      "videoWatchVideoTableBody",
      "videoWatchBuyerList",
      "videoWatchRecentList",
      "시청 기록이 있는 회원명만 표시합니다.",
      "video-watch-member-list",
    ],
    forbiddenMarkers: ["측정 기준", "video-watch-policy"],
  },
  {
    file: "core/assets/styles.css",
    label: "stable KPI card sizing",
    markers: [
      ".kpis > .metric",
      "grid-auto-rows: 148px",
      "min-height: 148px",
      ".action-disclosure",
      ".renewal-actions",
      ".parking-delete-button",
      ".external-tool-grid",
      ".external-tool-link",
      ".instructor-tool-grid",
      ".instructor-tool-link",
      ".nav-secondary",
      ".admin-nav-open .nav-secondary",
      ".social-work-grid",
      ".social-item",
      ".social-preview-dialog",
      ".ticket-liability-summary",
      ".liability-table",
      ".refund-stepper",
      ".refund-ticket-option",
      ".refund-amount-grid",
      ".video-watch-kpis",
      ".video-watch-trend",
      ".video-watch-progress",
    ],
  },
  {
    file: "core/rules/index.html",
    label: "ARCHIVE CORE source health and operator lifecycle rules",
    markers: [
      "운영 액션 수명주기",
      "원천 신선도와 화면 상태",
      "canonicalActionKey",
      "Instagram 콘텐츠 운영",
      "수강권 잔여금액",
      "ticketLiabilityReports",
      "최근 8주",
      "renewalCases",
      "2026-08-22 비용 최적화",
      "환불 안내·동의서",
      "refundCases",
      "구매 영상 시청 분석",
      "videoWatchEvents",
      "videoWatchSessions",
      "상세 이벤트는 180일",
      "회원가입서 메뉴",
      "강사레슨 메뉴",
    ],
    patterns: [{ pattern: /\d{4}\.\d{2}\.\d{2} 기준/, label: "current rules date" }],
  },
  {
    file: "privacy/index.html",
    label: "paid video watch privacy disclosure",
    markers: [
      "2026년 8월 26일",
      "구매 영상 시청 분석",
      "가명 처리된 회원 식별값",
      "구매 영상 상세 시청 이벤트: 수집일로부터 180일",
      "구매 영상 시청 세션 요약: 수집일로부터 1년",
      "구매·권한·환불 여부를 자동 결정하거나 광고 및 자동 메시지 발송 대상을 정하는 데 사용하지 않습니다",
    ],
  },
  {
    file: "scripts/imweb-video-watch-tracker.js",
    label: "fail-open paid video watch tracker",
    markers: [
      "archive-method-watch-",
      "window.MEMBER_HASH",
      "SHA-256",
      "enablejsapi",
      "progress_${milestone}",
      "Analytics failure must never interrupt playback",
    ],
  },
  {
    file: "core/assets/imweb-video-watch-tracker-20260826.js",
    label: "deployed paid video watch tracker asset",
    markers: [
      "archive-method-watch-",
      "window.MEMBER_HASH",
      "videoWatchEventApi",
      "Analytics failure must never interrupt playback",
    ],
  },
];

const failures = [];
for (const item of required) {
  const absolutePath = path.join(repoRoot, item.file);
  const content = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
  for (const marker of item.markers) {
    if (!content.includes(marker)) {
      failures.push({ file: item.file, label: item.label, missing: marker });
    }
  }
  for (const marker of item.forbiddenMarkers || []) {
    if (content.includes(marker)) {
      failures.push({ file: item.file, label: item.label, unexpected: marker });
    }
  }
  for (const expected of item.patterns || []) {
    if (!expected.pattern.test(content)) {
      failures.push({ file: item.file, label: item.label, missing: expected.label });
    }
  }
}

const externalToolLinks = [
  {
    id: "imweb",
    href: "https://archivepilates.imweb.me/admin",
    label: "아임웹 관리자, 새 창에서 열기",
  },
  {
    id: "gmail",
    href: "https://mail.google.com/mail/?authuser=home@archivepilates.com",
    label: "공식 이메일, 새 창에서 열기",
  },
  {
    id: "smartplace",
    href: "https://new.smartplace.naver.com/",
    label: "스마트플레이스, 새 창에서 열기",
  },
  {
    id: "studiomate",
    href: "https://arcpilates.studiomate.kr/",
    label: "StudioMate, 새 창에서 열기",
  },
];
const coreHomeHtml = fs.readFileSync(path.join(repoRoot, "core/index.html"), "utf8");
for (const tool of externalToolLinks) {
  const openingTag =
    coreHomeHtml.match(new RegExp(`<a\\b[^>]*data-external-tool="${tool.id}"[^>]*>`, "i"))?.[0] || "";
  const requiredAttributes = [
    `href="${tool.href}"`,
    'target="_blank"',
    'rel="noopener noreferrer"',
    `aria-label="${tool.label}"`,
  ];
  for (const attribute of requiredAttributes) {
    if (!openingTag.includes(attribute)) {
      failures.push({
        file: "core/index.html",
        label: `external operation shortcut: ${tool.id}`,
        missing: attribute,
      });
    }
  }
}

const coreAppSource = fs.readFileSync(path.join(repoRoot, "core/assets/app.js"), "utf8");
const videoWatchBuyerListSource = coreAppSource.slice(
  coreAppSource.indexOf("function renderVideoWatchBuyerList(rows)"),
  coreAppSource.indexOf("function renderVideoWatchRecentList(rows)"),
);
if (
  !videoWatchBuyerListSource.includes("row.buyerName") ||
  /row\.(videoCodes|sessions|activeDays|totalWatchSeconds|lastWatchedAt|maxProgressPercent)/.test(videoWatchBuyerListSource)
) {
  failures.push({
    file: "core/assets/app.js",
    label: "paid video buyer list privacy and presentation",
    missing: "render only the member name in the buyer list",
  });
}
const refreshSource = coreAppSource.slice(
  coreAppSource.indexOf("async function refresh()"),
  coreAppSource.indexOf("enhanceNav();"),
);
const openCommandPaletteSource = coreAppSource.slice(
  coreAppSource.indexOf("function openCommandPalette()"),
  coreAppSource.indexOf("function handleCommandPaletteInput()"),
);
const commandPaletteInputSource = coreAppSource.slice(
  coreAppSource.indexOf("function handleCommandPaletteInput()"),
  coreAppSource.indexOf("function closeCommandPalette()"),
);
const collectionReadSource = coreAppSource.slice(
  coreAppSource.indexOf("async function getCollectionBy"),
  coreAppSource.indexOf("async function getOptionalCollectionBy"),
);
if (!refreshSource || refreshSource.includes("shouldLoadMembers || shouldLoadHome")) {
  failures.push({
    file: "core/assets/app.js",
    label: "ARCHIVE CORE home read budget",
    missing: "load the full member directory only on the Members page",
  });
}
if (!refreshSource || /const shouldLoadPrivate\s*=.*shouldLoadHome/.test(refreshSource)) {
  failures.push({
    file: "core/assets/app.js",
    label: "ARCHIVE CORE home read budget",
    missing: "keep private lesson session reads off the Home route",
  });
}
if (!openCommandPaletteSource || openCommandPaletteSource.includes("ensureMemberDirectory")) {
  failures.push({
    file: "core/assets/app.js",
    label: "ARCHIVE CORE command palette read budget",
    missing: "opening the command palette must not load the member directory",
  });
}
if (!commandPaletteInputSource.includes("hasCommandMenuMatch(term)")) {
  failures.push({
    file: "core/assets/app.js",
    label: "ARCHIVE CORE command palette read budget",
    missing: "do not load the member directory for known operation menu searches",
  });
}
if (!refreshSource.includes('getCollectionDocumentsByIds(db, runtime, "memberProfiles", renewalMemberIds, 1000)')) {
  failures.push({
    file: "core/assets/app.js",
    label: "ARCHIVE CORE renewal accuracy",
    missing: "load only renewal-case member profiles before validating Home renewal rows",
  });
}
if ((collectionReadSource.match(/firestore\.limit\(maxItems\)/g) || []).length < 2) {
  failures.push({
    file: "core/assets/app.js",
    label: "ARCHIVE CORE collection read budget",
    missing: "bound both ordered and fallback collection reads on the Firestore server",
  });
}
const alimtalkTemplateSource = fs.readFileSync(
  path.join(repoRoot, "firebase/kangsain-functions/functions/src/alimtalk/templates.ts"),
  "utf8",
);
const knownTemplateCodes = [...new Set(alimtalkTemplateSource.match(/KA\d{2}TP[0-9A-Za-z]+/g) || [])];
for (const templateCode of knownTemplateCodes) {
  if (!coreAppSource.includes(`${templateCode}:`)) {
    failures.push({
      file: "core/assets/app.js",
      label: "ARCHIVE CORE Korean Alimtalk template title map",
      missing: templateCode,
    });
  }
}
const coreRulesSource = fs.readFileSync(path.join(repoRoot, "core/rules/index.html"), "utf8");
if (/KA\d{2}TP[0-9A-Za-z]+/.test(coreRulesSource)) {
  failures.push({
    file: "core/rules/index.html",
    label: "operator-facing Korean Alimtalk template titles",
    missing: "remove raw SOLAPI template IDs from visible rules",
  });
}

const firebaseConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "firebase.json"), "utf8"));
const firestoreIndexes = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "firebase/kangsain-functions/firestore.indexes.json"), "utf8"),
);
const ttlCollectionGroups = new Set(
  (firestoreIndexes.fieldOverrides || [])
    .filter((entry) => entry.fieldPath === "expiresAt" && entry.ttl === true)
    .map((entry) => entry.collectionGroup),
);
for (const collectionGroup of ["videoWatchEvents", "videoWatchSessions", "videoWatchRateLimits"]) {
  if (!ttlCollectionGroups.has(collectionGroup)) {
    failures.push({
      file: "firebase/kangsain-functions/firestore.indexes.json",
      label: "paid video watch data retention",
      missing: `${collectionGroup}.expiresAt TTL`,
    });
  }
}
const coreHostingConfig = (firebaseConfig.hosting || []).find((entry) => entry.site === "archive-pilates-core");
const coreHeaders = coreHostingConfig?.headers || [];
const headerPolicy = new Map(
  coreHeaders.map((entry) => [entry.source, entry.headers?.find((header) => header.key === "Cache-Control")?.value]),
);
const requiredCachePolicies = [
  ["/index.html", "no-cache, no-store, must-revalidate"],
  ["/", "no-cache, no-store, must-revalidate"],
  ["/**/", "no-cache, no-store, must-revalidate"],
  ["/**/*.html", "no-cache, no-store, must-revalidate"],
  ["/release.json", "no-cache, no-store, must-revalidate"],
  ["/site.webmanifest", "no-cache, no-store, must-revalidate"],
  ["/**/*.js", "public, max-age=0, must-revalidate"],
  ["/**/*.css", "public, max-age=0, must-revalidate"],
  ["/**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,otf}", "public, max-age=3600, stale-while-revalidate=86400"],
];
if (!coreHostingConfig) {
  failures.push({ file: "firebase.json", label: "ARCHIVE CORE Hosting target", missing: "archive-pilates-core" });
} else {
  for (const [source, expected] of requiredCachePolicies) {
    if (headerPolicy.get(source) !== expected) {
      failures.push({
        file: "firebase.json",
        label: `ARCHIVE CORE cache policy: ${source}`,
        missing: `${source} => ${expected}`,
      });
    }
  }
  if (headerPolicy.has("/**")) {
    failures.push({
      file: "firebase.json",
      label: "ARCHIVE CORE cache policy",
      missing: "remove /** no-store catch-all",
    });
  }
}

for (const file of collectHtmlFiles(path.join(repoRoot, "core"))) {
  const relative = path.relative(repoRoot, file);
  const content = fs.readFileSync(file, "utf8");
  for (const marker of ["/site.webmanifest?v=1", "/icons/favicon-32.png?v=1", "/icons/apple-touch-icon.png?v=1"]) {
    if (!content.includes(marker)) {
      failures.push({ file: relative, label: "ARCHIVE CORE app icon links", missing: marker });
    }
  }
  for (const marker of ['data-section="members"', 'data-section="lessons"', 'data-section="content"']) {
    if (content.includes(marker)) {
      failures.push({ file: relative, label: "ARCHIVE CORE simplified navigation", missing: `remove ${marker}` });
    }
  }
}

let branch = "unknown";
let head = "unknown";
try {
  branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
} catch {
  // Content markers are the actual deploy gate; git metadata is only for reporting.
}

if (failures.length) {
  console.error("ARCHIVE CORE hosting deploy guard failed.");
  console.error("This prevents deploying an older CORE bundle that loses current home actions or sizing fixes.");
  console.error(JSON.stringify({ branch, head, failures }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      branch,
      head,
      checked: required.map((item) => item.file),
      guard: "archive-core-hosting-current-ui",
    },
    null,
    2,
  ),
);

function collectHtmlFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectHtmlFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".html")) files.push(absolutePath);
  }
  return files;
}
