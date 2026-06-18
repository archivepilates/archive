#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const skipFetch = args.has("--skip-fetch");

main();

function main() {
  if (!skipFetch) run("git", ["fetch", "origin", "main"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(["rev-parse", "HEAD"]);
  const originMain = git(["rev-parse", "origin/main"]);
  const status = git(["status", "--porcelain"]);
  if (status.trim()) {
    fail("Worktree is dirty. Commit or stash scoped changes before promoting to main.", { branch, head, originMain, status });
  }
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], { encoding: "utf8" });
  if (ancestor.status !== 0) {
    fail("HEAD is not a fast-forward descendant of origin/main. Rebase or merge origin/main first.", {
      branch,
      head,
      originMain,
    });
  }
  const pushedBranch = git(["branch", "-r", "--contains", head]);
  const result = {
    ok: true,
    mode: apply ? "apply" : "dry-run",
    branch,
    head,
    originMain,
    alreadyOnMain: head === originMain,
    pushedBranch: pushedBranch.split("\n").map((line) => line.trim()).filter(Boolean),
  };
  if (apply && head !== originMain) {
    run("git", ["push", "origin", "HEAD:main"]);
    run("git", ["fetch", "origin", "main"]);
    result.promoted = true;
    result.newOriginMain = git(["rev-parse", "origin/main"]);
  } else {
    result.promoted = false;
  }
  console.log(JSON.stringify(result, null, 2));
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function fail(message, details) {
  console.error(message);
  console.error(JSON.stringify(details, null, 2));
  process.exit(1);
}
