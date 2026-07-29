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
  "privateLessonReportMutationLockReason",
  "reportUrlForRevision",
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
