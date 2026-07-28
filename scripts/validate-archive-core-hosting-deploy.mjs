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
      "data-core-external-shortcuts",
      "https://archivepilates.imweb.me/admin",
      "https://mail.google.com/mail/?authuser=home@archivepilates.com",
      "https://new.smartplace.naver.com/",
      "https://arcpilates.studiomate.kr/",
      "data-section=\"staff\"",
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
      "mergeMemberCardsWithProfiles",
      "coreDataHealthIssues",
      "pricingInquiryAlimtalkRequests",
      "pricingInquiryDisplayPhone",
      "pricingInquiryHistoryPanel",
      "operatorSendPricingInquiryAlimtalk",
      "removeParkingVehicle",
      "data-parking-vehicle-id",
      "submitInstructorEvaluationQuiz",
      "SECONDARY_NAV_SECTIONS",
      "enhanceRuleSections",
      "CORE_RUNTIME_CONTRACT_VERSION",
      "renderReadHealth",
      "getBookingsForLessonWindow",
      "deriveLessonOccurrencesFromBookings",
      "normalizedLessonKind",
      "operatorLifecycle",
      "emergencyLastAttendance",
    ],
  },
  {
    file: "core/staff/index.html",
    label: "staff HR cards page",
    markers: ["강사 현황", "staffHrList", "강사별 평가 차트", "지원자 시험"],
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
    file: "core/assets/styles.css",
    label: "stable KPI card sizing",
    markers: [
      ".kpis > .metric",
      "grid-auto-rows: 148px",
      "min-height: 148px",
      ".action-disclosure",
      ".parking-delete-button",
      ".external-tool-grid",
      ".external-tool-link",
      ".nav-secondary",
      ".admin-nav-open .nav-secondary",
    ],
  },
  {
    file: "core/rules/index.html",
    label: "ARCHIVE CORE source health and operator lifecycle rules",
    markers: ["2026.07.28", "운영 액션 수명주기", "원천 신선도와 화면 상태", "canonicalActionKey"],
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

for (const file of collectHtmlFiles(path.join(repoRoot, "core"))) {
  const relative = path.relative(repoRoot, file);
  const content = fs.readFileSync(file, "utf8");
  for (const marker of ["/site.webmanifest?v=1", "/icons/favicon-32.png?v=1", "/icons/apple-touch-icon.png?v=1"]) {
    if (!content.includes(marker)) {
      failures.push({ file: relative, label: "ARCHIVE CORE app icon links", missing: marker });
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
