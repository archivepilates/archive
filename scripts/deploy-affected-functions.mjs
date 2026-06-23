import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectAffectedFromCli } from "./lib/affected-functions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;
const affected = detectAffectedFromCli(process.argv.slice(2));

run("node", apply
  ? ["scripts/validate-release-branch-state.mjs", "--require-origin-main"]
  : ["scripts/validate-release-branch-state.mjs"]);
run("node", ["scripts/validate-live-release-rollback-guards.mjs"]);

if (!affected.deployOnly) {
  console.log("No Functions codebase changes detected.");
  process.exit(0);
}

const firebaseBin = path.join(repoRoot, "firebase", "kangsain-functions", "functions", "node_modules", ".bin", "firebase");
const command = [
  "--config",
  "firebase.json",
  "--project",
  "archive-pilates",
  "deploy",
  "--only",
  affected.deployOnly,
  "--non-interactive",
];
if (dryRun) command.push("--dry-run");

console.log(
  JSON.stringify(
    {
      mode: dryRun ? "dry-run" : "apply",
      codebases: affected.codebases,
      deployOnly: affected.deployOnly,
      changedFiles: affected.changedFiles,
    },
    null,
    2,
  ),
);

const result = spawnSync(firebaseBin, command, { cwd: repoRoot, stdio: "inherit", env: process.env });
process.exit(result.status || 0);

function run(commandName, commandArgs) {
  const result = spawnSync(commandName, commandArgs, { cwd: repoRoot, stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
