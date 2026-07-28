#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const surfaces = valuesFor("--surface");
const allowNonMain = args.includes("--allow-non-main");
const selectedSurfaces = surfaces.length ? surfaces : ["archivein", "core"];
const allowedSurfaces = new Set(["archivein", "core"]);

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const head = git(["rev-parse", "HEAD"]);
const originMain = git(["rev-parse", "origin/main"]);
const status = git(["status", "--porcelain"]);
const exactOriginMain = head === originMain;

if (!allowNonMain && !exactOriginMain) {
  fail("Release manifest can only be generated for production deploys from origin/main.", {
    branch,
    head,
    originMain,
  });
}
if (status.trim()) {
  const nonManifestDirty = status
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.endsWith(" release.json") && !line.endsWith(" archivein/release.json") && !line.endsWith(" core/release.json"));
  if (nonManifestDirty.length) {
    fail("Release manifest generation requires a clean worktree except generated release manifests.", {
      branch,
      head,
      dirty: nonManifestDirty,
    });
  }
}

const outputs = [];
for (const surface of selectedSurfaces) {
  if (!allowedSurfaces.has(surface)) fail(`Unknown release manifest surface: ${surface}`, { selectedSurfaces });
  const manifest = buildManifest(surface);
  const outputPath = surface === "archivein" ? "archivein/release.json" : "core/release.json";
  const absoluteOutputPath = path.join(repoRoot, outputPath);
  fs.writeFileSync(absoluteOutputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  outputs.push(outputPath);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      generated: outputs,
      head: head.slice(0, 7),
      originMain: originMain.slice(0, 7),
      exactOriginMain,
    },
    null,
    2,
  ),
);

function buildManifest(surface) {
  const base = {
    schemaVersion: 1,
    brand: "ARCHIVE PILATES",
    generatedAt: new Date().toISOString(),
    firebaseProject: "archive-pilates",
    source: {
      repo: "archivepilates/archive",
      branch,
      head,
      shortHead: head.slice(0, 7),
      originMain,
      exactOriginMain,
      clean: !status.trim(),
    },
    deploymentPolicy: {
      requiresOriginMain: true,
      rollbackGuards: "scripts/validate-live-release-rollback-guards.mjs",
      liveCanary: "scripts/validate-live-release-canary.mjs",
    },
  };
  if (surface === "archivein") {
    return {
      ...base,
      product: "ARCHIVE IN",
      surface,
      hostingSites: ["archive-pilates", "archive-pilates-in"],
      canonicalUrls: ["https://in.archivepilates.com/release.json", "https://archive-pilates.web.app/archivein/release.json"],
      criticalMarkers: [
        "ARCHIVE IN 운영자 앱 종료 안내",
        "ARCHIVE PILATES 프라이빗 사전설문",
        "api/privateSurveySubmit",
        "uploadMediaFileDirect",
        "completeMediaUpload",
        "Drive 직접 업로드 중",
        "focusMediaUploadPanelIfRequested",
      ],
    };
  }
  return {
    ...base,
    product: "ARCHIVE CORE",
    surface,
    runtimeContractVersion: "2026-07-28.1",
    hostingSites: ["archive-pilates", "archive-pilates-core"],
    canonicalUrls: ["https://core.archivepilates.com/release.json", "https://archive-pilates.web.app/core/release.json"],
    criticalMarkers: [
      "homeActionTotal",
      "재등록 관리",
      "renewalPipelineList",
      "renewalCandidateRows",
      "mergeMemberCardsWithProfiles",
      "coreDataHealthIssues",
      "수강료 문의 즉시발송",
      "pricingInquiryHistoryPanel",
      "privateInstructorPendingList",
      "CORE_RUNTIME_CONTRACT_VERSION",
      "renderReadHealth",
      "getBookingsForLessonWindow",
      "deriveLessonOccurrencesFromBookings",
      "normalizedLessonKind",
      "operatorLifecycle",
    ],
  };
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
  const result = spawnSync("git", commandArgs, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${commandArgs.join(" ")} failed`);
  return result.stdout.trim();
}

function fail(message, details = {}) {
  console.error("Release manifest generation failed.");
  console.error(JSON.stringify({ message, ...details }, null, 2));
  process.exit(1);
}
