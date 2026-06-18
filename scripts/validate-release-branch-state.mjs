#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const skipFetch = args.has("--skip-fetch");
const allowDirty = args.has("--allow-dirty");

if (!skipFetch) run("git", ["fetch", "origin", "main"]);

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const head = git(["rev-parse", "HEAD"]);
const originMain = git(["rev-parse", "origin/main"]);
const status = git(["status", "--porcelain"]);
const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], { encoding: "utf8" });

const failures = [];
if (ancestor.status !== 0) {
  failures.push("HEAD is not based on the latest origin/main. Rebase or fast-forward before deploying.");
}
if (!allowDirty && status.trim()) {
  failures.push("Worktree has uncommitted changes. Commit scoped changes before deploying.");
}

if (failures.length) {
  console.error("Release branch state guard failed.");
  console.error(
    JSON.stringify(
      {
        branch,
        head,
        originMain,
        failures,
        status,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      guard: "release-branch-state",
      branch,
      head: head.slice(0, 7),
      originMain: originMain.slice(0, 7),
      clean: !status.trim(),
      descendantOfOriginMain: true,
    },
    null,
    2,
  ),
);

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}
