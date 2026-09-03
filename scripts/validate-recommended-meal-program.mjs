#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  {
    file: "firebase/kangsain-functions/functions/src/mealPlan/recommendedMealProgram.ts",
    markers: [
      "generateRecommendedMealProgramDraftHandler",
      "generateRecommendedMealProgramDraftForSubmittedResponse",
      "saveRecommendedMealProgramDraftHandler",
      "recommendedMealPlanApiHandler",
      "RECOMMENDED_MEAL_DRAFT_COLLECTION",
      "RECOMMENDED_MEAL_REPORT_COLLECTION",
      "reviewGateIssue",
      "approvedMealPlanSnapshot",
      "private, no-store, max-age=0",
      "의료적 영양 처방",
      "safe_allergy_review",
      "safe_food_exclusion_review",
      "reportedFoodExclusions",
      "privacySafeGenerationInput",
      "measurementId",
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/mealPlan/recommendedMealReportAlimtalk.ts",
    markers: [
      "operatorPublishRecommendedMealPlanHandler",
      "confirmPublish",
      "does not create a second Alimtalk candidate",
      "reviewGateIssue",
      "approvedSnapshot",
      "accessTokenHash",
      'publicationStatus: "published"',
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/exports/app.ts",
    markers: [
      "recommendedMealPlanApi",
      "getRecommendedMealProgramReview",
      "generateRecommendedMealProgramDraft",
      "generateRecommendedMealDraftOnSurveySubmitted",
      "saveRecommendedMealProgramDraft",
    ],
  },
  {
    file: "firebase/kangsain-functions/functions/src/runtime/functionOptions.ts",
    markers: ["recommendedMealEventOptions", "secrets: [geminiApiKey]"],
  },
  {
    file: "firebase/kangsain-functions/functions/src/exports/alimtalk.ts",
    markers: ["operatorPublishRecommendedMealPlan"],
  },
  {
    file: "core/recommended-meals/index.html",
    markers: [
      "추천식단 검토",
      "AI 식단 다시 생성",
      "민감 설문 응답 확인",
      "검토 완료 후 리포트 공개",
    ],
  },
  {
    file: "core/assets/app.js",
    markers: [
      "getRecommendedMealProgramReview",
      "generateRecommendedMealProgramDraft",
      "saveRecommendedMealProgramDraft",
      "operatorPublishRecommendedMealPlan",
      "공개 후에는 수정할 수 없습니다.",
    ],
  },
  {
    file: "archivein/recommendedMealPlan/index.html",
    markers: [
      "noindex,nofollow,noarchive",
      "no-referrer",
      "/api/recommendedMealPlan",
      "생활 습관 개선을 위한 추천 자료",
    ],
  },
  {
    file: "archivein/recommendedMealSurvey/index.html",
    markers: ["mealReportLink", "추천식단 리포트 보기", "info.reportReady"],
  },
  {
    file: "firebase/kangsain-functions/firestore.rules",
    markers: [
      "match /recommendedMealProgramDrafts/{draftId}",
      "match /recommendedMealProgramReports/{reportId}",
      "allow write: if false;",
    ],
  },
  {
    file: "firebase.json",
    markers: [
      "\"source\": \"/api/recommendedMealPlan\"",
      "\"source\": \"/recommendedMealPlan/**\"",
      "\"functionId\": \"recommendedMealPlanApi\"",
      "\"Referrer-Policy\", \"value\": \"no-referrer\"",
    ],
  },
];

const failures = [];
for (const check of checks) {
  const absolute = path.join(repoRoot, check.file);
  if (!fs.existsSync(absolute)) {
    failures.push(`${check.file}: file missing`);
    continue;
  }
  const source = fs.readFileSync(absolute, "utf8");
  for (const marker of check.markers) {
    if (!source.includes(marker)) failures.push(`${check.file}: missing marker ${marker}`);
  }
}

if (failures.length) {
  console.error("Recommended meal program validation failed.");
  console.error(JSON.stringify({ failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checkedFiles: checks.length, guard: "recommended-meal-review-publish-link" }, null, 2));
