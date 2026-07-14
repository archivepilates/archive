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
    jsonCheck("core-release-custom-domain", "https://core.archivepilates.com/release.json", (json) => json?.source?.head === expectedSha),
    jsonCheck("core-release-webapp-path", "https://archive-pilates.web.app/core/release.json", (json) => json?.source?.head === expectedSha),
    textCheck("core-home-actions-custom-domain", "https://core.archivepilates.com/", [
      "오늘 처리할 일",
      "homeDecisionList",
      "renewalPipelineList",
      "parkingRegistrationForm",
      "수강료 문의",
      "pricingInquiryForm",
      "pricingInquiryHistoryPanel",
    ]),
    textCheck("core-home-actions-webapp-path", "https://archive-pilates.web.app/core/", [
      "오늘 처리할 일",
      "homeDecisionList",
      "renewalPipelineList",
      "parkingRegistrationForm",
      "수강료 문의",
      "pricingInquiryForm",
      "pricingInquiryHistoryPanel",
    ]),
    textCheck("core-app-bundle-custom-domain", "https://core.archivepilates.com/assets/app.js", [
      "pricingInquiryAlimtalkRequests",
      "pendingPrivateProgressRows",
      "privateInstructorPendingList",
      "commandQueueStatus",
      "SECONDARY_NAV_SECTIONS",
    ]),
    textCheck("core-app-bundle-webapp-path", "https://archive-pilates.web.app/core/assets/app.js", [
      "pricingInquiryAlimtalkRequests",
      "pendingPrivateProgressRows",
      "privateInstructorPendingList",
      "commandQueueStatus",
      "SECONDARY_NAV_SECTIONS",
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
