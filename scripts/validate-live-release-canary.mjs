#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const surfaces = valuesFor("--surface");
const selectedSurfaces = surfaces.length ? surfaces : ["archivein", "core"];
const expectedSha = valueFor("--sha") || git(["rev-parse", "HEAD"]);
const cacheBust = `codex=${Date.now()}`;

const checks = [];

if (selectedSurfaces.includes("archivein")) {
  checks.push(
    jsonCheck("archivein-release-custom-domain", "https://in.archivepilates.com/release.json", (json) => json?.source?.head === expectedSha),
    jsonCheck("archivein-release-webapp-path", "https://archive-pilates.web.app/archivein/release.json", (json) => json?.source?.head === expectedSha),
    textCheck("archivein-root-retired-custom-domain", "https://in.archivepilates.com/", [
      "ARCHIVE IN 운영자 앱 종료 안내",
      "ARCHIVE CORE",
    ]),
    textCheck("archivein-root-retired-webapp-path", "https://archive-pilates.web.app/archivein/", [
      "ARCHIVE IN 운영자 앱 종료 안내",
      "ARCHIVE CORE",
    ]),
    textCheck("private-chart-upload-custom-domain", "https://in.archivepilates.com/private-chart/", [
      "수업 사진·영상",
      "uploadMediaFileDirect",
      "completeMediaUpload",
      "Drive 직접 업로드 중",
      "focusMediaUploadPanelIfRequested",
    ]),
    textCheck("private-chart-upload-webapp-path", "https://archive-pilates.web.app/archivein/private-chart/", [
      "수업 사진·영상",
      "uploadMediaFileDirect",
      "completeMediaUpload",
      "Drive 직접 업로드 중",
      "focusMediaUploadPanelIfRequested",
    ]),
    textCheck("private-survey-form-custom-domain", "https://in.archivepilates.com/privateSurvey/", [
      "ARCHIVE PILATES 프라이빗 사전설문",
      "surveyForm",
      "api/privateSurveySubmit",
    ]),
    textCheck("private-survey-form-webapp-path", "https://archive-pilates.web.app/archivein/privateSurvey/", [
      "ARCHIVE PILATES 프라이빗 사전설문",
      "surveyForm",
      "api/privateSurveySubmit",
    ]),
    statusCheck("private-survey-api-custom-domain", "https://in.archivepilates.com/api/privateSurveySubmit", [403]),
    statusCheck("private-survey-api-webapp-path", "https://archive-pilates.web.app/archivein/api/privateSurveySubmit", [403]),
    textCheck("recommended-meal-survey-custom-domain", "https://in.archivepilates.com/recommendedMealSurvey/", [
      "ARCHIVE PILATES 추천식단 프로그램",
      "mealSurveyForm",
      "api/recommendedMealSurvey",
    ]),
    textCheck(
      "recommended-meal-survey-webapp-path",
      "https://archive-pilates.web.app/archivein/recommendedMealSurvey/",
      ["ARCHIVE PILATES 추천식단 프로그램", "mealSurveyForm", "api/recommendedMealSurvey"],
    ),
    textCheck("method-breathing-cue-card-custom-domain", "https://in.archivepilates.com/method/breathing-260627/", [
      "호흡 큐카드 | ARCHIVE METHOD",
      "ARCHIVE METHOD VIDEO",
      "ARCHIVE PILATES 홈페이지 가입하기",
      "archivepilates.imweb.me/?mode=join",
    ]),
    textCheck("method-breathing-cue-card-webapp-path", "https://archive-pilates.web.app/archivein/method/breathing-260627/", [
      "호흡 큐카드 | ARCHIVE METHOD",
      "ARCHIVE METHOD VIDEO",
      "ARCHIVE PILATES 홈페이지 가입하기",
      "archivepilates.imweb.me/?mode=join",
    ]),
    textCheck("method-pelvis-hip-cue-card-custom-domain", "https://in.archivepilates.com/method/pelvis-hip-260725/", [
      "골반.고관절 큐카드 | ARCHIVE METHOD",
      "ARCHIVE METHOD VIDEO",
      "ARCHIVE PILATES 홈페이지 가입하기",
      "archivepilates.imweb.me/?mode=join",
    ]),
    textCheck("method-pelvis-hip-cue-card-webapp-path", "https://archive-pilates.web.app/archivein/method/pelvis-hip-260725/", [
      "골반.고관절 큐카드 | ARCHIVE METHOD",
      "ARCHIVE METHOD VIDEO",
      "ARCHIVE PILATES 홈페이지 가입하기",
      "archivepilates.imweb.me/?mode=join",
    ]),
    statusCheck("method-cue-card-review-api-custom-domain", "https://in.archivepilates.com/api/methodCueCardReview", [405]),
    statusCheck("method-cue-card-review-api-webapp-path", "https://archive-pilates.web.app/archivein/api/methodCueCardReview", [405]),
    textCheck("archivein-service-worker-cache-clear-custom-domain", "https://in.archivepilates.com/sw.js", [
      "LEGACY_CACHE_PREFIX",
      "caches.delete",
    ]),
    textCheck("archivein-service-worker-cache-clear-webapp-path", "https://archive-pilates.web.app/archivein/sw.js", [
      "LEGACY_CACHE_PREFIX",
      "caches.delete",
    ]),
  );
}

if (selectedSurfaces.includes("core")) {
  checks.push(
    jsonCheck(
      "core-release-custom-domain",
      "https://core.archivepilates.com/release.json",
      (json) => json?.source?.head === expectedSha && json?.runtimeContractVersion === "2026-08-01.1",
    ),
    jsonCheck(
      "core-release-webapp-path",
      "https://archive-pilates.web.app/core/release.json",
      (json) => json?.source?.head === expectedSha && json?.runtimeContractVersion === "2026-08-01.1",
    ),
    textCheck("core-home-actions-custom-domain", "https://core.archivepilates.com/", [
      "오늘 처리할 일",
      "homeDecisionList",
      "renewalPipelineList",
      "parkingRegistrationForm",
      "수강료 문의",
      "pricingInquiryForm",
      "pricingInquiryHistoryPanel",
      "recommendedMealProgramForm",
      "recommendedMealHistoryPanel",
    ]),
    textCheck("core-home-actions-webapp-path", "https://archive-pilates.web.app/core/", [
      "오늘 처리할 일",
      "homeDecisionList",
      "renewalPipelineList",
      "parkingRegistrationForm",
      "수강료 문의",
      "pricingInquiryForm",
      "pricingInquiryHistoryPanel",
      "recommendedMealProgramForm",
      "recommendedMealHistoryPanel",
    ]),
    textCheck("core-app-bundle-custom-domain", "https://core.archivepilates.com/assets/app.js", [
      "pricingInquiryAlimtalkRequests",
      "recommendedMealProgramRequests",
      "operatorSendRecommendedMealProgramAlimtalk",
      "pendingPrivateProgressRows",
      "privateInstructorPendingList",
      "commandQueueStatus",
      "renewalCases",
      "handleRenewalActionClick",
      "SECONDARY_NAV_SECTIONS",
      "removeParkingVehicle",
      "data-parking-vehicle-id",
      "CORE_RUNTIME_CONTRACT_VERSION",
      "renderReadHealth",
      "getBookingsForLessonWindow",
      "deriveLessonOccurrencesFromBookings",
      "normalizedLessonKind",
      "operatorLifecycle",
      "data-renewal-action=\"excluded\"",
      "재등록 의사 없음",
      "alimtalkTemplateTitle",
      "강사용 프라이빗 차트 작성 안내 v3",
      "privateLessonSessions",
      '"preparation", "수업 준비"',
      '"delivered", "전달 완료"',
    ]),
    textCheck("core-app-bundle-webapp-path", "https://archive-pilates.web.app/core/assets/app.js", [
      "pricingInquiryAlimtalkRequests",
      "recommendedMealProgramRequests",
      "operatorSendRecommendedMealProgramAlimtalk",
      "pendingPrivateProgressRows",
      "privateInstructorPendingList",
      "commandQueueStatus",
      "renewalCases",
      "handleRenewalActionClick",
      "SECONDARY_NAV_SECTIONS",
      "removeParkingVehicle",
      "data-parking-vehicle-id",
      "CORE_RUNTIME_CONTRACT_VERSION",
      "renderReadHealth",
      "getBookingsForLessonWindow",
      "deriveLessonOccurrencesFromBookings",
      "normalizedLessonKind",
      "operatorLifecycle",
      "privateLessonSessions",
      '"preparation", "수업 준비"',
      '"delivered", "전달 완료"',
    ]),
    textCheck("core-rules-recommended-meal-custom-domain", "https://core.archivepilates.com/rules/", [
      "2026.07.31 기준",
      "아카이브 추천식단 프로그램",
      "강사용 프라이빗 차트 작성 안내 v3",
      "APPROVED·BA·IMAGE",
    ]),
    textCheck("core-rules-recommended-meal-webapp-path", "https://archive-pilates.web.app/core/rules/", [
      "2026.07.31 기준",
      "아카이브 추천식단 프로그램",
      "강사용 프라이빗 차트 작성 안내 v3",
      "APPROVED·BA·IMAGE",
    ]),
  );
}

const results = [];
for (const check of checks) {
  results.push(await runCheck(check));
}

const failures = results.filter((result) => !result.ok);
if (failures.length) {
  console.error("Live release canary failed.");
  console.error(JSON.stringify({ expectedSha, failures, results }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      guard: "live-release-canary",
      expectedSha,
      surfaces: selectedSurfaces,
      checked: results.map((result) => result.id),
    },
    null,
    2,
  ),
);

async function runCheck(check) {
  try {
    const response = await fetch(withCacheBust(check.url), {
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      redirect: "follow",
    });
    const body = await response.text();
    if (check.type === "status") {
      const ok = check.statuses.includes(response.status);
      return {
        id: check.id,
        url: check.url,
        ok,
        status: response.status,
        expectedStatuses: check.statuses,
        reason: ok ? undefined : "unexpected_status",
      };
    }
    if (!response.ok) {
      return { id: check.id, url: check.url, ok: false, status: response.status, reason: "http_status" };
    }
    if (check.type === "json") {
      let json;
      try {
        json = JSON.parse(body);
      } catch {
        return { id: check.id, url: check.url, ok: false, status: response.status, reason: "invalid_json" };
      }
      const ok = check.predicate(json);
      return {
        id: check.id,
        url: check.url,
        ok,
        status: response.status,
        reason: ok ? undefined : "sha_mismatch",
        liveSha: json?.source?.head,
      };
    }
    const missing = check.markers.filter((marker) => !body.includes(marker));
    return { id: check.id, url: check.url, ok: missing.length === 0, status: response.status, missing };
  } catch (error) {
    return { id: check.id, url: check.url, ok: false, reason: error?.message || String(error) };
  }
}

function jsonCheck(id, url, predicate) {
  return { id, url, type: "json", predicate };
}

function textCheck(id, url, markers) {
  return { id, url, type: "text", markers };
}

function statusCheck(id, url, statuses) {
  return { id, url, type: "status", statuses };
}

function withCacheBust(url) {
  return `${url}${url.includes("?") ? "&" : "?"}${cacheBust}`;
}

function valueFor(flag) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) return args[index + 1];
    if (args[index].startsWith(`${flag}=`)) return args[index].slice(flag.length + 1);
  }
  return "";
}

function valuesFor(flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
    if (args[index].startsWith(`${flag}=`)) values.push(args[index].slice(flag.length + 1));
  }
  return values;
}

function git(commandArgs) {
  const result = spawnSync("git", commandArgs, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${commandArgs.join(" ")} failed`);
  return result.stdout.trim();
}
