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
      "homeActionTotal",
      "회원 응대",
      "재등록 관리",
      "renewalPipelineList",
      "수강료 문의 즉시발송",
      "pricingInquiryForm",
      "pricingInquiryHistoryPanel",
      "최근 발송/메모 보기",
      "Staff <small>강사</small>",
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
      "pricingInquiryAlimtalkRequests",
      "pricingInquiryDisplayPhone",
      "pricingInquiryHistoryPanel",
      "operatorSendPricingInquiryAlimtalk",
      "submitInstructorEvaluationQuiz",
    ],
  },
  {
    file: "core/staff/index.html",
    label: "staff HR cards page",
    markers: ["강사 인사기록카드", "staffHrList", "강사별 평가 차트", "지원자 시험"],
  },
  {
    file: "core/staff/evaluation/index.html",
    label: "instructor evaluation quiz page",
    markers: ["instructorEvaluationQuizForm", "evaluationQuizQuestions", "평가 퀴즈 제출"],
  },
  {
    file: "core/assets/styles.css",
    label: "stable KPI card sizing",
    markers: [".kpis > .metric", "min-height: 156px"],
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
