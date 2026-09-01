import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "firebase", "codebase-boundaries.json"), "utf8"));
const allCodebases = Object.keys(manifest.targetCodebases || {}).sort();

export function detectAffectedFromCli(argv) {
  const args = parseArgs(argv);
  const base = args.base || process.env.AFFECTED_BASE || defaultBase();
  const head = args.head || process.env.AFFECTED_HEAD || "HEAD";
  const files = args.files ? args.files.split(",").map((value) => value.trim()).filter(Boolean) : changedFiles(base, head);
  const affected = new Set();
  const reasons = [];
  for (const file of files) {
    const codebases = codebasesForFile(file);
    for (const codebase of codebases) affected.add(codebase);
    reasons.push({ file, codebases });
  }
  const codebases = [...affected].sort();
  return {
    base,
    head,
    changedFiles: files,
    codebases,
    deployOnly: codebases.map((codebase) => `functions:${codebase}`).join(","),
    allCodebasesAffected: codebases.length === allCodebases.length,
    reasons,
  };
}

export function codebasesForFile(file) {
  const normalized = file.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("docs/") || normalized.startsWith("artifacts/")) return [];
  if (isSharedPath(normalized)) return allCodebases;
  if (normalized.includes("/social/") || normalized.endsWith("/exports/social.ts")) return ["functions-social"];
  if (normalized.includes("/alimtalk/") || normalized.endsWith("/exports/alimtalk.ts")) return ["functions-alimtalk"];
  if (
    normalized.includes("/privateLessonChart/") ||
    normalized.includes("/privateSurvey/") ||
    normalized.includes("/inbody/") ||
    normalized.startsWith("firebase/kangsain-functions/functions/src/method/") ||
    normalized.endsWith("/exports/privateChart.ts")
  ) {
    return ["functions-private-chart"];
  }
  if (
    normalized.includes("/sync/") ||
    normalized.includes("/studiomate/") ||
    normalized.includes("/queue/") ||
    normalized.includes("/google/") ||
    normalized.includes("/push/") ||
    normalized.endsWith("/exports/sync.ts")
  ) {
    return ["functions-sync"];
  }
  if (normalized.endsWith("/parking/parkingOperations.ts")) return ["functions-app", "functions-sync"];
  if (normalized.includes("/parking/")) return ["functions-app"];
  if (normalized.includes("/refund/")) return ["functions-app"];
  if (normalized.includes("/videoAnalytics/")) return ["functions-app"];
  if (normalized.endsWith("/instructorLessonRegistration/instructorLessonConfirmation.ts")) {
    return ["functions-alimtalk", "functions-app"];
  }
  if (normalized.includes("/instructorLessonRegistration/")) return ["functions-app"];
  if (normalized.includes("/callable/") || normalized.includes("/security/") || normalized.endsWith("/exports/app.ts")) {
    return ["functions-app"];
  }
  return [];
}

function isSharedPath(file) {
  return [
    ".github/",
    "firebase.json",
    "package.json",
    "package-lock.json",
    "firebase/codebase-boundaries.json",
    "firebase/packages/contracts/",
    "firebase/kangsain-functions/functions/package",
    "firebase/kangsain-functions/functions/tsconfig.json",
    "firebase/kangsain-functions/functions/src/config/",
    "firebase/kangsain-functions/functions/src/runtime/",
    "firebase/kangsain-functions/functions/src/firestore/",
    "firebase/kangsain-functions/functions/src/types/",
    "firebase/kangsain-functions/functions/src/utils/",
    "scripts/prepare-functions-codebase.mjs",
    "scripts/validate-functions-boundaries.mjs",
    "scripts/detect-affected-function-codebases.mjs",
    "scripts/deploy-affected-functions.mjs",
    "scripts/lib/affected-functions.mjs",
  ].some((prefix) => file === prefix || file.startsWith(prefix));
}

function changedFiles(baseRef, headRef) {
  const files = new Set();
  if (!baseRef) return [];
  for (const args of [
    ["diff", "--name-only", `${baseRef}...${headRef}`],
    ["diff", "--name-only", "--cached"],
    ["diff", "--name-only"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    const output = execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
    for (const line of output.split("\n")) {
      const file = line.trim();
      if (file) files.add(file);
    }
  }
  return [...files].sort();
}

function defaultBase() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
