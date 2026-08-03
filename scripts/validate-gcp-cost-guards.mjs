#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  {
    file: "scripts/run-studiomate-excel-emergency-mode.mjs",
    required: ["privateSessionLedgerDelta", "affectedPrivateMemberIds", "--member-ids"],
    forbidden: ["gcloud\", \"scheduler\", \"jobs\", \"run", "PRIVATE_CHART_RECONCILE_SCHEDULER_JOB"],
  },
  {
    file: "scripts/emergency-import-studiomate-member-excel.mjs",
    required: ["emergencyImportHash", "plannedProfileWrites", "unchangedProfiles", "writeContactIndex"],
    forbidden: [],
  },
  {
    file: "scripts/emergency-import-studiomate-reservation-excel.mjs",
    required: [
      "changedBookings",
      "unchangedBookings",
      "affectedPrivateMemberIds",
      "emergencyImportHash",
      "emergencySourceFile === sourceFile",
    ],
    forbidden: [],
    negateRequired: ["emergencySourceFile === sourceFile"],
  },
  {
    file: "firebase/kangsain-functions/functions/src/privateSurvey/privateSurveyResponse.ts",
    required: [
      "sourceDateCutoff",
      "sourceDateToday",
      "existingSurveySubmissionAlertIds",
      ".where(\"type\", \"==\", \"private_survey\")",
    ],
    forbidden: ['refs.alimtalkCandidates().where("status", "==", "sent").limit(500)'],
  },
  {
    file: "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts",
    required: ['gptStatus: "waiting_post"', 'where("gptStatus", "==", "pending").limit(100)'],
    forbidden: [],
  },
  {
    file: "firebase/kangsain-functions/functions/src/exports/privateChart.ts",
    required: [
      "scheduledProcessMissingSurveySubmissionAlerts",
      'schedule: "every 60 minutes"',
      'schedule: "0 6,14,22 * * *"',
    ],
    forbidden: [],
  },
  {
    file: "firebase/kangsain-functions/functions/src/sync/processContactSyncJobs.ts",
    required: [
      '.where("target", "==", "home_archivepilates")',
      '.where("nextRunAt", "<=", now)',
      '.orderBy("nextRunAt", "asc")',
    ],
    forbidden: ['where("status", "in", ["pending", "retry"]).limit(100)'],
  },
  {
    file: "firebase/kangsain-functions/functions/src/parking/parkingOperations.ts",
    required: [
      "SCHEDULED_BOOKING_LOOKBACK_MINUTES",
      "scanMode === \"full_day\"",
      ".where(\"lectureStartAt\", \">=\"",
      ".where(\"lectureStartAt\", \"<=\"",
      "if (!bookings.length && !input.includeVisitors)",
    ],
    forbidden: [],
  },
  {
    file: "firebase/kangsain-functions/functions/src/social/socialContentOperations.ts",
    required: [
      'where("status", "in", ["pending", "retry", "processing"]).limit(30)',
      'where("status", "==", "published").limit(50)',
      "socialPublishIdempotencyKey",
      'status: "manual_review"',
    ],
    forbidden: [],
  },
  {
    file: "core/rules/index.html",
    required: ["변경된 프라이빗 예약의 회원만", "매일 23:30 안전 점검", "이미 확인 메일을 만든 요청"],
    forbidden: [],
  },
];

const failures = [];
for (const check of checks) {
  const absolutePath = path.join(repoRoot, check.file);
  const source = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
  if (!source) {
    failures.push(`${check.file}: file missing or empty`);
    continue;
  }
  for (const marker of check.required || []) {
    if ((check.negateRequired || []).includes(marker)) continue;
    if (!source.includes(marker)) failures.push(`${check.file}: missing ${marker}`);
  }
  for (const marker of check.negateRequired || []) {
    if (source.includes(marker)) failures.push(`${check.file}: stale file-scoped filter ${marker}`);
  }
  for (const marker of check.forbidden || []) {
    if (source.includes(marker)) failures.push(`${check.file}: forbidden ${marker}`);
  }
}

if (failures.length) {
  console.error("validate-gcp-cost-guards failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checkedFiles: checks.length,
      guards: [
        "hourly import cannot trigger full-month reconcile",
        "unchanged member and reservation documents are skipped",
        "instructor views do not depend on the latest source file name",
        "survey alert scans are bounded and idempotent",
        "pre-lesson records stay out of report generation scans",
        "Notion recovery and missing-survey scans use reduced schedules",
        "contact sync reads only due home-account jobs",
        "parking scheduler scans only the recent due-time window",
        "Instagram publishing and insight scans are bounded and idempotent",
      ],
    },
    null,
    2,
  ),
);
