#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));

export function validateFunctionsPredeploy({
  argv = process.argv.slice(2),
  env = process.env,
  run = spawnSync,
} = {}) {
  if (argv.length !== 1 || argv[0].startsWith("--")) {
    throw new Error("Expected exactly one Functions codebase; guard override flags are not supported.");
  }
  const [codebase] = argv;
  if (codebase === "default") {
    throw new Error("The legacy default Functions deploy is retired. Use the repository-root affected-only flow.");
  }
  const manifest = readJson("firebase/codebase-boundaries.json");
  const target = Object.hasOwn(manifest.targetCodebases, codebase) && manifest.targetCodebases[codebase];
  if (!target?.physicalSource) throw new Error(`Unknown Functions codebase: ${codebase}`);
  if (manifest.project !== "archive-pilates" || env.GCLOUD_PROJECT !== "archive-pilates") {
    throw new Error("GCLOUD_PROJECT and the Functions manifest must target archive-pilates.");
  }
  if (environmentDirectory(env, "PROJECT_DIR") !== repoRoot) {
    throw new Error("PROJECT_DIR must match this script's repository root; use the root firebase.json.");
  }
  const sourceDir = path.resolve(repoRoot, target.physicalSource);
  const relativeSource = path.relative(repoRoot, sourceDir);
  if (!relativeSource || relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) {
    throw new Error("Functions source must be inside this repository.");
  }
  const config = readJson("firebase.json");
  const configured = config.functions.filter((entry) => entry.codebase === codebase);
  if (configured.length !== 1 || configured[0].source !== target.physicalSource) {
    throw new Error(`Root Firebase config does not match the manifest target: ${codebase}`);
  }
  if (environmentDirectory(env, "RESOURCE_DIR") !== sourceDir) {
    throw new Error(`RESOURCE_DIR does not match the source for ${codebase}.`);
  }
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
    if (env[name] !== undefined) {
      throw new Error(`${name} must be unset so the release guard checks this repository.`);
    }
  }

  // Firebase does not expose dry-run/--only to hooks. Never trust inherited
  // dry-run flags to relax a production predeploy; both modes use these guards.
  for (const args of [
    ["scripts/validate-release-branch-state.mjs", "--require-main-branch", "--require-origin-main"],
    ["scripts/validate-live-release-rollback-guards.mjs"],
  ]) {
    const result = run(process.execPath, [path.join(repoRoot, args[0]), ...args.slice(1)], {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Functions predeploy blocked by ${path.basename(args[0])}.`, { cause: result.error });
    }
  }
  return { ok: true, guard: "functions-predeploy", codebase, project: env.GCLOUD_PROJECT };
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function environmentDirectory(env, name) {
  const value = env[name];
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute Firebase hook directory.`);
  try {
    return realpathSync(value);
  } catch {
    throw new Error(`${name} must be an existing Firebase hook directory.`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(validateFunctionsPredeploy(), null, 2));
  } catch (error) {
    console.error(`Functions predeploy guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
