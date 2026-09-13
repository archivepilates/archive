import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateFunctionsPredeploy } from "../validate-functions-predeploy.mjs";

const repoRoot = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
const read = (file) => readFileSync(path.join(repoRoot, file), "utf8");
const rootConfig = JSON.parse(read("firebase.json"));
const codebases = ["alimtalk", "private-chart", "sync", "app", "social"];

function environment(name = "app") {
  return {
    ...process.env,
    GCLOUD_PROJECT: "archive-pilates",
    PROJECT_DIR: repoRoot,
    RESOURCE_DIR: path.join(repoRoot, "firebase/function-codebases", name),
  };
}

function rejectBeforeGuards(env, pattern, argv = ["functions-app"]) {
  assert.throws(() => validateFunctionsPredeploy({
    argv,
    env,
    run: () => assert.fail("Invalid target must fail before any Git/network/build operation"),
  }), pattern);
}

// Execute the existing branch validator unchanged, but intercept every Git
// command with a closed fixture. No fetch, commit, or deployment is performed.
function gitFixture(t, state = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "functions-predeploy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, "git.cjs");
  const log = path.join(dir, "git-calls.jsonl");
  writeFileSync(script, `
    const fs = require("node:fs");
    const state = JSON.parse(process.env.FIXTURE_GIT_STATE);
    const args = process.argv.slice(2);
    if (fs.realpathSync(process.cwd()) !== state.root) process.exit(70);
    fs.appendFileSync(state.log, JSON.stringify(args) + "\\n");
    switch (args.join(" ")) {
      case "fetch origin main": process.exit(state.fetchStatus || 0);
      case "rev-parse --abbrev-ref HEAD": console.log(state.branch || "main"); break;
      case "rev-parse HEAD": console.log(state.head || "aaaaaaa"); break;
      case "rev-parse origin/main": console.log(state.originMain || "aaaaaaa"); break;
      case "status --porcelain": console.log(state.dirty || ""); break;
      case "merge-base --is-ancestor origin/main HEAD": process.exit(state.ancestorStatus || 0);
      default: process.exit(71);
    }
  `);
  writeFileSync(path.join(dir, "git"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`, { mode: 0o755 });
  const env = {
    ...environment(),
    PATH: `${dir}${path.delimiter}${process.env.PATH}`,
    FIXTURE_GIT_STATE: JSON.stringify({ root: repoRoot, log, ...state }),
  };
  const calls = [];
  return {
    env,
    calls,
    gitCalls: () => readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)),
    run(command, args, options) {
      assert.equal(command, process.execPath);
      assert.equal(options.cwd, repoRoot);
      const result = spawnSync(command, args, { ...options, stdio: "pipe", encoding: "utf8" });
      calls.push({ args, ...result });
      return result;
    },
  };
}

test("all five root codebases guard before the unchanged prepare/build hooks", () => {
  assert.deepEqual(rootConfig.functions.map((entry) => entry.codebase), codebases.map((name) => `functions-${name}`));
  for (const entry of rootConfig.functions) {
    assert.deepEqual(entry.predeploy, [
      `node "$PROJECT_DIR/scripts/validate-functions-predeploy.mjs" ${entry.codebase}`,
      'node scripts/prepare-functions-codebase.mjs "$RESOURCE_DIR"',
      'node firebase/kangsain-functions/functions/node_modules/typescript/bin/tsc -p "$RESOURCE_DIR/tsconfig.json"',
    ]);
  }
});

test("alternate direct Functions config remains blocked, including dry-run", () => {
  const alternate = JSON.parse(read("firebase/kangsain-functions/firebase.json"));
  assert.equal(alternate.functions.length, 1);
  assert.equal(alternate.functions[0].codebase, "default");
  assert.deepEqual(alternate.functions[0].predeploy, [
    'node "$PROJECT_DIR/../../scripts/validate-functions-predeploy.mjs" default',
    'node "$RESOURCE_DIR/../../../scripts/reject-legacy-functions-deploy.mjs"',
  ]);
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts/validate-functions-predeploy.mjs"), "default"], {
    cwd: path.join(repoRoot, "firebase/kangsain-functions"),
    env: { ...environment(), DRY_RUN: "true" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /legacy default Functions deploy is retired/);
});

test("CI covers both root configs and the current registration validator", () => {
  const workflow = read(".github/workflows/functions-affected-check.yml");
  for (const config of ["firebase.json", ".firebaserc"]) {
    assert.equal(workflow.split(`- "${config}"`).length - 1, 2);
  }
  assert.ok(workflow.includes("npm run test:system-hardening"));
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.ok(scripts["test:system-hardening"].includes("scripts/tests/functions-predeploy.test.mjs"));
  assert.ok(workflow.includes("node scripts/validate-instructor-lesson-registration-release.mjs"));
});

test("each declared codebase accepts only its matching Firebase resource", () => {
  for (const name of codebases) {
    const calls = [];
    const result = validateFunctionsPredeploy({
      argv: [`functions-${name}`], env: environment(name),
      run(command, args, options) {
        calls.push(args);
        assert.equal(command, process.execPath);
        assert.equal(options.cwd, repoRoot);
        return { status: 0 };
      },
    });
    assert.equal(result.codebase, `functions-${name}`);
    assert.deepEqual(calls, [
      [path.join(repoRoot, "scripts/validate-release-branch-state.mjs"), "--require-main-branch", "--require-origin-main"],
      [path.join(repoRoot, "scripts/validate-live-release-rollback-guards.mjs")],
    ]);
  }
});

test("rejects missing or wrong project, resource, and project root before Git", () => {
  for (const project of [undefined, "", "other-project"]) {
    rejectBeforeGuards({ ...environment(), GCLOUD_PROJECT: project }, /GCLOUD_PROJECT/);
  }
  for (const name of ["RESOURCE_DIR", "PROJECT_DIR"]) {
    for (const value of [undefined, "", ".", path.join(repoRoot, "does-not-exist")]) {
      rejectBeforeGuards({ ...environment(), [name]: value }, new RegExp(name));
    }
  }
  rejectBeforeGuards({ ...environment(), PROJECT_DIR: path.join(repoRoot, "firebase/kangsain-functions") }, /PROJECT_DIR/);
  rejectBeforeGuards({ ...environment(), RESOURCE_DIR: repoRoot }, /RESOURCE_DIR/);
  rejectBeforeGuards(environment("social"), /RESOURCE_DIR/);
});

test("resource symlinks to another target cannot pass", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "functions-resource-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, "app");
  symlinkSync(environment("social").RESOURCE_DIR, link, "dir");
  rejectBeforeGuards({ ...environment(), RESOURCE_DIR: link }, /RESOURCE_DIR/);
});

test("rejects unknown targets and all CLI override flags", () => {
  for (const argv of [[], ["--dry-run"], ["functions-unknown"], ["toString"], ["functions-app", "--dry-run"], ["functions-app", "--allow-dirty"], ["functions-app", "--skip-fetch"]]) {
    rejectBeforeGuards(environment(), /Expected exactly one|Unknown Functions codebase/, argv);
  }
});

test("Git context overrides cannot redirect validation to a different checkout/index", () => {
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
    for (const value of ["", "/tmp/other-checkout"]) {
      rejectBeforeGuards({ ...environment(), [name]: value }, new RegExp(`${name} must be unset`));
    }
  }
});

for (const dirty of [" M README.md", "M  firebase.json", "?? untracked.mjs"]) {
  test(`real branch validator rejects dirty state: ${dirty}`, (t) => {
    const fixture = gitFixture(t, { dirty });
    assert.throws(() => validateFunctionsPredeploy({ argv: ["functions-app"], ...fixture }), /release-branch-state/);
    assert.equal(fixture.calls.length, 1);
    assert.match(fixture.calls[0].stderr, /uncommitted changes/);
  });
}

for (const branch of ["codex/mini/feature", "HEAD"]) {
  test(`real branch validator rejects non-main even at origin/main: ${branch}`, (t) => {
    const fixture = gitFixture(t, { branch });
    assert.throws(() => validateFunctionsPredeploy({ argv: ["functions-app"], ...fixture }), /release-branch-state/);
    assert.equal(fixture.calls.length, 1);
    assert.match(fixture.calls[0].stderr, /local branch name to be main/);
  });
}

for (const ancestorStatus of [0, 1]) {
  test(`real branch validator rejects HEAD differing from origin/main (ancestor=${ancestorStatus})`, (t) => {
    const fixture = gitFixture(t, { head: "bbbbbbb", ancestorStatus });
    assert.throws(() => validateFunctionsPredeploy({ argv: ["functions-app"], ...fixture }), /release-branch-state/);
    assert.match(fixture.calls[0].stderr, /match origin\/main exactly/);
  });
}

test("a failed origin refresh blocks predeploy", (t) => {
  const fixture = gitFixture(t, { fetchStatus: 1 });
  assert.throws(() => validateFunctionsPredeploy({ argv: ["functions-app"], ...fixture }), /release-branch-state/);
  assert.deepEqual(fixture.gitCalls(), [["fetch", "origin", "main"]]);
  assert.equal(fixture.calls.length, 1);
});

test("inherited dry-run/CI hints cannot permit a dirty feature deploy", (t) => {
  const fixture = gitFixture(t, { dirty: " M firebase.json", branch: "codex/mini/feature" });
  Object.assign(fixture.env, { DRY_RUN: "true", FIREBASE_DEPLOY_DRY_RUN: "true", npm_config_dry_run: "true", CI: "true" });
  assert.throws(() => validateFunctionsPredeploy({ argv: ["functions-app"], ...fixture }), /release-branch-state/);
  assert.match(fixture.calls[0].stderr, /uncommitted changes/);
  assert.match(fixture.calls[0].stderr, /local branch name to be main/);
});

test("clean main runs origin refresh and the real rollback validator", (t) => {
  const fixture = gitFixture(t);
  const result = validateFunctionsPredeploy({ argv: ["functions-app"], ...fixture });
  assert.equal(result.ok, true);
  assert.equal(fixture.calls.length, 2);
  assert.equal(JSON.parse(fixture.calls[0].stdout).exactOriginMain, true);
  assert.equal(JSON.parse(fixture.calls[1].stdout).guard, "archive-live-release-rollback-guards");
  assert.deepEqual(fixture.gitCalls()[0], ["fetch", "origin", "main"]);
});

test("rollback failure and process launch failures fail closed", () => {
  for (const failure of [{ status: 1 }, { status: null, signal: "SIGTERM" }, { error: new Error("spawn failed") }]) {
    let calls = 0;
    assert.throws(() => validateFunctionsPredeploy({
      argv: ["functions-app"], env: environment(),
      run() { return ++calls === 1 ? { status: 0 } : failure; },
    }), /live-release-rollback-guards/);
    assert.equal(calls, 2);
  }
});

test("CLI validates this script's repo, even when launched from another cwd", (t) => {
  const fixture = gitFixture(t, { dirty: " M firebase.json" });
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts/validate-functions-predeploy.mjs"), "functions-app"], {
    cwd: os.tmpdir(), env: fixture.env, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /uncommitted changes/);
  assert.match(result.stderr, /Functions predeploy guard failed/);
});
