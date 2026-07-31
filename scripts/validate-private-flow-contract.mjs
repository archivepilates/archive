#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const violations = [];

requireMarkers("archivein/privateSurvey/index.html", [
  "ARCHIVE PILATES 프라이빗 사전설문",
  'data-radio="primaryGoal"',
  "체형교정·자세 개선",
  "다이어트·체력 향상",
  "통증·회복 관리",
  "산전·산후·컨디션 관리",
  "목",
  "어깨",
  "api/privateSurveySubmit",
  "[hidden]",
]);
requireMarkers("firebase/kangsain-functions/functions/src/privateSurvey/privateSurveyResponse.ts", [
  "submitNativePrivateSurveyResponseHandler",
  "readNativePrivateSurveyRequest",
  "activePrivateSurveyBooking",
  'kind: "native"',
  'request.method === "GET"',
  'request.method !== "POST"',
]);
requireMarkers("firebase/kangsain-functions/functions/src/alimtalk/rebuildAlimtalkCandidates.ts", [
  "upsertPrivateSurveyRequest",
  "privateSurveyRequestId",
  "accessTokenHash",
  "hasSubmittedPrivateSurvey",
]);
requireMarkers("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonReportRevision.ts", [
  "currentPrivateLessonReportRevision",
  "createPrivateLessonReportSnapshot",
  "privateLessonReportSnapshotForView",
  "privateLessonReportSourceChangePatch",
  "privateLessonReportCandidateId",
  "privateLessonReportMutationLockReason",
  "reportUrlForRevision",
  "record.legacySentReportSnapshot?.revision",
]);
requireMarkers("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonMedia.ts", [
  '"uploaded_to_drive"',
  '"attached"',
  "resumeMediaAttachment",
  "프라이빗 회차 폴더에 업로드된 파일만 첨부할 수 있습니다.",
  "invalidatePendingPrivateLessonReportCandidates",
]);
requireMarkers("firebase/kangsain-functions/functions/src/alimtalk/privateSurveySendGuard.ts", [
  "privateSurveySendabilityIssue",
  "privateSurveySourceIssue",
  "취소·삭제·변경된 프라이빗 예약입니다.",
  "effectiveBooking.sessionOrder?.counted === false",
  "supersededByBookingId",
]);
requireMarkers("firebase/kangsain-functions/functions/src/alimtalk/templateStatus.ts", [
  'state?.source === "solapi"',
  "SOLAPI template not found",
  "templateReadinessFromState",
  "alimtalkImageTemplateContractIssue",
  '"IMAGE"',
  "imageId",
]);
requireMarkers("firebase/kangsain-functions/functions/src/alimtalk/templates.ts", [
  "LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE",
  "LEGACY_STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_CODE",
  "PRIVATE_SURVEY_ALIMTALK_TEMPLATE_ID",
  "STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_ID",
  "NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID",
  "NATIVE_STAFF_PRIVATE_CHART_ALIMTALK_IMAGE_ID",
]);
requireMarkers("firebase/kangsain-functions/functions/src/alimtalk/eligibility.ts", [
  "privateSurveyTemplateContractIssue",
  "프라이빗 자체설문 링크형 v2 템플릿 승인·설정 전",
  "프라이빗 사전설문 템플릿 자체설문 버튼 URL 불일치",
  "NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID",
  "RETRYABLE_TEMPLATE_STATUS_PREFIX",
]);
requireMarkers("scripts/create-private-survey-solapi-template.mjs", [
  'REFERENCE_TEMPLATE_ID = "KA01TP260729144645970fv13He8mfsK"',
  "Refusing to create a SOLAPI template without --apply.",
  "https://in.archivepilates.com/s/#{링크ID}/",
  "PRIVATE_SURVEY_ALIMTALK_TEMPLATE_ID",
  "referenceImageContract",
  "inspection/cancel",
  "emphasizeType: imageContract.emphasizeType",
]);
requireMarkers("scripts/create-staff-private-chart-solapi-template.mjs", [
  'REFERENCE_TEMPLATE_ID = "KA01TP260729144657202OV26yAD15wR"',
  "Refusing to create a SOLAPI template without --apply.",
  "https://in.archivepilates.com/s/#{수업전계획링크ID}/",
  "https://in.archivepilates.com/s/#{수업후기록링크ID}/",
  "https://in.archivepilates.com/s/#{사진영상업로드링크ID}/",
  "legacy Notion copy remains",
  "STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_ID",
  "referenceImageContract",
  "inspection/cancel",
  "emphasizeType: imageContract.emphasizeType",
]);
requireMarkers("scripts/verify-private-flow-ui.mjs", [
  "native member survey completion state",
  "media picker presence",
  "320/390/768/1440px horizontal overflow",
]);
requireMarkers("scripts/audit-private-report-runtime.ts", [
  '"read-only"',
  "legacyActionableSurveyCandidates",
  "staleActionableReportCandidates",
]);
requireMarkers("scripts/audit-private-alimtalk-templates.mjs", [
  'REFERENCE_TEMPLATE_ID = "KA01TP260729144645970fv13He8mfsK"',
  '"member_private_survey"',
  '"staff_private_chart"',
  '"member_private_report"',
  "expectedEmphasizeType",
  "expectedImageId",
  "--strict",
]);
requireMarkers("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonSession.ts", [
  "privateLessonSessionProjection",
  '"preparation"',
  '"recording"',
  '"report_review"',
  '"delivered"',
]);
requireMarkers("firebase/kangsain-functions/functions/src/alimtalk/processAlimtalkQueue.ts", [
  "lockPrivateLessonReportForSend",
  "approvedRevision",
  "approvedReportSnapshot",
  "privateSurveySendabilityIssue",
  "deferCandidateForTemplateStatus",
  "finalPrivateLessonReportSendabilityIssue",
  "booking.sessionOrder?.counted === false",
  "reportRevision",
  "sentRevision",
]);
requireMarkers("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts", [
  'status: "display_only"',
  "replacePageContent",
  "approvedReportSnapshot",
  "reportUrlForRevision",
  "supersededByBookingId",
]);
forbidMarkers("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts", [
  "notionApprovedReportPages",
  "enqueuePrivateLessonReportForNotionPage",
  "NOTION_PRIVATE_SESSION_RECORDS_DATABASE_ID",
]);
forbidMarkers("firebase/kangsain-functions/functions/src/exports/privateChart.ts", [
  "scheduledEnqueuePrivateLessonReportAlimtalks",
]);
requireMarkers("core/assets/app.js", [
  '"privateLessonSessions"',
  "getCurrentPrivateLessonSessions",
  '"preparation", "수업 준비"',
  '"recording", "수업 기록"',
  '"report_review", "리포트 확인"',
  '"delivered", "전달 완료"',
]);
requireMarkers("core/rules/index.html", [
  "privateLessonSessions",
  "Notion은 표시·열람용입니다.",
  "immutable snapshot",
  "supersededByBookingId",
  "자체설문 링크형 v2는 기존 ARCHIVE PILATES 로고 이미지형 양식을 유지하며",
  "v3도 기존 ARCHIVE PILATES 로고 이미지형 양식을 유지하며",
]);

const trackedStaticPrivateArtifacts = gitLines([
  "ls-files",
  "archivein/private-reports",
  "archivein/private-surveys",
]).filter((relativePath) => fs.existsSync(path.join(repoRoot, relativePath)));
if (trackedStaticPrivateArtifacts.length) {
  violations.push({
    file: trackedStaticPrivateArtifacts.join(", "),
    reason: "private survey/report output must be dynamic Functions content, not tracked static Hosting files",
  });
}

if (violations.length) {
  console.error("validate-private-flow-contract failed");
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.reason}`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      guard: "private-flow-contract",
      checked: [
        "native private survey",
        "permanent intake dedupe",
        "four-stage private session projection",
        "immutable report revision",
        "send-time booking lock",
        "native-link Alimtalk template contract",
        "Notion display-only projection",
        "no static private member artifacts",
      ],
    },
    null,
    2,
  ),
);

function requireMarkers(relativePath, markers) {
  const text = read(relativePath);
  for (const marker of markers) {
    if (!text.includes(marker)) violations.push({ file: relativePath, reason: `missing marker: ${marker}` });
  }
}

function forbidMarkers(relativePath, markers) {
  const text = read(relativePath);
  for (const marker of markers) {
    if (text.includes(marker)) violations.push({ file: relativePath, reason: `forbidden legacy marker: ${marker}` });
  }
}

function read(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    violations.push({ file: relativePath, reason: "missing file" });
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function gitLines(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    violations.push({ file: "git", reason: result.stderr || result.stdout || `git ${args.join(" ")} failed` });
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
