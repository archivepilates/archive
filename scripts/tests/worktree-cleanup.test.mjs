import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../daily-worktree-cleanup.sh", import.meta.url));
const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();

function fixture(t) {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "worktree-cleanup-")));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const root = path.join(tmp, "runtime");
  const wtRoot = path.join(tmp, "worktrees");
  const remote = path.join(tmp, "remote.git");
  const agents = path.join(tmp, "LaunchAgents");
  const bin = path.join(tmp, "bin");
  const home = path.join(tmp, "home");
  for (const dir of [root, wtRoot, agents, bin, home]) mkdirSync(dir);
  const env = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_AUTHOR_NAME: "Cleanup Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Cleanup Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    ARCHIVE_SOURCE_REPO: root,
    WORKTREE_CLEANUP_ROOT: wtRoot,
    WORKTREE_CLEANUP_LAUNCH_AGENT_DIRS: agents,
    WORKTREE_CLEANUP_LOCK_DIR: path.join(tmp, "locks", "cleanup.lock"),
    WORKTREE_CLEANUP_LOG_DIR: path.join(tmp, "logs"),
    FIXTURE_REAL_GIT: realGit,
    FIXTURE_GIT_LOG: path.join(tmp, "git-calls.jsonl"),
    FIXTURE_LSOF_LOG: path.join(tmp, "lsof-calls.jsonl"),
    FIXTURE_CWDS: JSON.stringify([root]),
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "WORKTREE_CLEANUP_APPLY", "WORKTREE_CLEANUP_ALLOWLIST"]) delete env[name];

  function git(cwd, ...args) {
    const result = spawnSync(realGit, ["-C", cwd, "-c", "core.hooksPath=/dev/null", ...args], { env, encoding: "utf8" });
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  }
  function shim(name, body) {
    const module = path.join(bin, `${name}.cjs`);
    writeFileSync(module, body);
    writeFileSync(path.join(bin, name), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(module)} "$@"\n`, { mode: 0o755 });
  }
  shim("git", `
    const fs = require("node:fs");
    const args = process.argv.slice(2);
    fs.appendFileSync(process.env.FIXTURE_GIT_LOG, JSON.stringify(args) + "\\n");
    if (process.env.FIXTURE_FAIL_GIT && args.includes(process.env.FIXTURE_FAIL_GIT)) process.exit(81);
    const result = require("node:child_process").spawnSync(process.env.FIXTURE_REAL_GIT, args, { stdio: "inherit" });
    process.exit(result.status === null ? 82 : result.status);
  `);
  shim("lsof", `
    const fs = require("node:fs");
    const log = process.env.FIXTURE_LSOF_LOG;
    const previous = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\\n").length : 0;
    fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + "\\n");
    const mode = process.env.FIXTURE_LSOF_MODE;
    if (mode === "fail") process.exit(1);
    if (mode === "warn") console.error("cannot inspect a process");
    if (mode === "empty") process.exit(0);
    if (mode === "malformed") { console.log("unknown"); process.exit(0); }
    if (process.env.FIXTURE_LSOF_RAW) { process.stdout.write(process.env.FIXTURE_LSOF_RAW); process.exit(0); }
    const cwds = previous && process.env.FIXTURE_LATE_CWD
      ? [process.env.FIXTURE_LATE_CWD] : JSON.parse(process.env.FIXTURE_CWDS);
    for (let i = 0; i < cwds.length; i++) console.log("p" + (1000 + i) + "\\nfcwd\\nn" + cwds[i]);
  `);
  shim("plutil", `
    if (process.env.FIXTURE_PLUTIL_FAIL) process.exit(1);
    const file = process.argv.at(-1);
    process.stdout.write(require("node:fs").readFileSync(file, "utf8"));
  `);
  git(root, "init", "--initial-branch=main");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "remote", "add", "origin", remote);
  writeFileSync(path.join(root, ".gitignore"), "node_modules/\nartifacts/\n.playwright-cli/\nprofiles/\nbackup-reports/\n");
  writeFileSync(path.join(root, "package.json"), '{"name":"cleanup-fixture","private":true}\n');
  writeFileSync(path.join(root, "tracked.txt"), "base\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "Initialize disposable cleanup fixture");
  git(root, "push", "origin", "main");

  function add(name) {
    const wt = path.join(wtRoot, name);
    git(root, "worktree", "add", "-b", `fixture/${name.replaceAll(" ", "-")}`, wt, "main");
    return wt;
  }
  function put(wt, relative, value = "preserve\n") {
    const file = path.join(wt, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, value);
    return file;
  }
  function run(args = [], extraEnv = {}, cwd = root) {
    const result = spawnSync("/bin/sh", [script, ...args], { cwd, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 30000 });
    assert.equal(result.error, undefined);
    const records = result.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return { ...result, records };
  }
  function calls() {
    return existsSync(env.FIXTURE_GIT_LOG) ? readFileSync(env.FIXTURE_GIT_LOG, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  }
  function assertNoRemoval() {
    assert.ok(calls().every((args) => !args.includes("remove") && !args.includes("prune") && !args.includes("--force")));
    assert.equal(existsSync(env.WORKTREE_CLEANUP_LOCK_DIR), false);
  }
  return { tmp, root, wtRoot, remote, agents, env, git, add, put, run, calls, assertNoRemoval };
}

test("canonical default is the active runtime; old cleanup shortcuts are absent", () => {
  const source = readFileSync(script, "utf8");
  assert.ok(source.startsWith("#!/bin/sh\nset -eu\n"));
  assert.ok(source.includes('const runtime = "/Users/archivepilates/dev/archive-in-runtime"'));
  assert.ok(!source.includes("Documents/ARCHIVE-IN"));
  assert.ok(!source.includes("is_safe_playwright_cache"));
  assert.ok(!source.includes("@{u}"));
  assert.ok(!source.includes("rmSync"));
});

test("default is audit and never removes even allowlisted merged dependencies", (t) => {
  const f = fixture(t);
  const wt = f.add("audit");
  const dep = f.put(wt, "node_modules/module/index.js");
  const result = f.run(["--allow-worktree", wt]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.records.some((record) => record.action === "audit_eligible" && record.path === wt));
  assert.ok(existsSync(dep));
  f.assertNoRemoval();
});

test("apply without an exact allowlist skips before fetch, lock, or dependency deletion", (t) => {
  const f = fixture(t);
  const wt = f.add("no-allowlist");
  const dep = f.put(wt, "node_modules/module/index.js");
  for (const [args, env] of [[["--apply"], {}], [[], { WORKTREE_CLEANUP_APPLY: "1" }]]) {
    const result = f.run(args, env);
    assert.equal(result.status, 0);
    assert.equal(result.records[0].reason, "apply_requires_explicit_worktree_allowlist");
  }
  assert.ok(existsSync(dep));
  assert.equal(f.calls().length, 0);
  f.assertNoRemoval();
});

test("pushed but unmerged feature HEAD and its Playwright artifacts stay", (t) => {
  const f = fixture(t);
  const wt = f.add("unmerged");
  f.put(wt, "feature.txt");
  f.git(wt, "add", "feature.txt");
  f.git(wt, "commit", "-m", "Unmerged disposable feature");
  f.git(wt, "push", "-u", "origin", "HEAD");
  const cache = f.put(wt, ".playwright-cli/report.json");
  const result = f.run(["--apply", "--allow-worktree", wt]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.records.some((record) => record.path === wt && record.reason === "HEAD_not_confirmed_merged_into_fresh_origin_main"));
  assert.ok(existsSync(cache));
  f.assertNoRemoval();
});

test("tracked, staged, and untracked dirty trees retain dependencies and browser data", (t) => {
  const f = fixture(t);
  const trees = [];
  for (const kind of ["tracked", "staged", "untracked"]) {
    const wt = f.add(kind);
    f.put(wt, kind === "untracked" ? "new.txt" : "tracked.txt", "changed\n");
    if (kind === "staged") f.git(wt, "add", "tracked.txt");
    f.put(wt, "node_modules/module/index.js");
    f.put(wt, ".playwright-cli/evidence.png");
    trees.push(wt);
  }
  const result = f.run(["--apply", ...trees.flatMap((wt) => ["--allow-worktree", wt])]);
  assert.equal(result.status, 0, result.stderr);
  for (const wt of trees) {
    assert.ok(result.records.some((record) => record.path === wt && record.reason === "dirty_including_untracked"));
    assert.ok(existsSync(path.join(wt, "node_modules/module/index.js")));
    assert.ok(existsSync(path.join(wt, ".playwright-cli/evidence.png")));
  }
  f.assertNoRemoval();
});

test("every ignored artifact/profile/cache is preserved regardless of extension", (t) => {
  const f = fixture(t);
  const files = ["artifacts/backup.json", "profiles/profile.png", "backup-reports/report.yaml", ".playwright-cli/result.log"];
  const trees = files.map((file, i) => {
    const wt = f.add(`ignored-${i}`);
    f.put(wt, file);
    f.put(wt, "node_modules/module/index.js");
    return wt;
  });
  const result = f.run(["--apply", ...trees.flatMap((wt) => ["--allow-worktree", wt])]);
  assert.equal(result.status, 0, result.stderr);
  for (const [i, wt] of trees.entries()) {
    assert.ok(result.records.some((record) => record.path === wt && record.reason === "ignored_files_preserved"));
    assert.ok(existsSync(path.join(wt, files[i])));
    assert.ok(existsSync(path.join(wt, "node_modules/module/index.js")));
  }
  f.assertNoRemoval();
});

test("canonical runtime and other unallowlisted worktrees are never removed", (t) => {
  const f = fixture(t);
  const other = f.add("unallowlisted");
  const result = f.run(["--apply", "--allow-worktree", f.root]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.records.some((record) => record.path === f.root && record.reason === "runtime_or_main_worktree"));
  assert.ok(result.records.some((record) => record.path === other && record.reason === "not_allowlisted"));
  assert.ok(existsSync(f.root));
  assert.ok(existsSync(other));
  f.assertNoRemoval();
});

test("clean merged allowlisted worktree is removed without --force; branch survives", (t) => {
  const f = fixture(t);
  const wt = f.add("merged with spaces");
  f.put(wt, "feature.txt");
  f.git(wt, "add", "feature.txt");
  f.git(wt, "commit", "-m", "Merged disposable feature");
  f.git(f.root, "merge", "--ff-only", "fixture/merged-with-spaces");
  f.git(f.root, "push", "origin", "main");
  f.put(wt, "node_modules/module/index.js");
  const result = f.run(["--apply", "--allow-worktree", wt]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.records.some((record) => record.path === wt && record.action === "removed"));
  assert.equal(existsSync(wt), false);
  assert.ok(f.git(f.root, "rev-parse", "--verify", "refs/heads/fixture/merged-with-spaces"));
  const removes = f.calls().filter((args) => args.includes("remove"));
  assert.equal(removes.length, 1);
  assert.deepEqual(removes[0].slice(-3), ["worktree", "remove", wt]);
  assert.ok(f.calls().every((args) => !args.includes("--force") && !args.includes("prune")));
  assert.equal(existsSync(f.env.WORKTREE_CLEANUP_LOCK_DIR), false);
});

test("newline allowlist env works, and --audit overrides apply env", (t) => {
  const f = fixture(t);
  const one = f.add("env-one");
  const two = f.add("env-two");
  const env = { WORKTREE_CLEANUP_APPLY: "1", WORKTREE_CLEANUP_ALLOWLIST: `${one}\n${two}` };
  assert.equal(f.run(["--audit"], env).status, 0);
  assert.ok(existsSync(one) && existsSync(two));
  f.assertNoRemoval();
  const result = f.run([], env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.records.filter((record) => record.action === "removed").length, 2);
  assert.ok(!existsSync(one) && !existsSync(two));
});

test("fresh fetch rejects a locally stale origin/main that claims a feature was merged", (t) => {
  const f = fixture(t);
  const wt = f.add("stale-main");
  f.put(wt, "feature.txt");
  f.git(wt, "add", "feature.txt");
  f.git(wt, "commit", "-m", "Not in remote main");
  f.git(f.root, "update-ref", "refs/remotes/origin/main", f.git(wt, "rev-parse", "HEAD"));
  const dep = f.put(wt, "node_modules/module/index.js");
  const result = f.run(["--apply", "--allow-worktree", wt]);
  assert.equal(result.status, 1);
  assert.ok(existsSync(dep));
  assert.ok(f.calls().some((args) => args.includes("fetch") && args.includes("refs/heads/main:refs/remotes/origin/main")));
  f.assertNoRemoval();
});

test("a feature merged only into unpushed local main is still preserved", (t) => {
  const f = fixture(t);
  const wt = f.add("local-main-only");
  f.put(wt, "feature.txt");
  f.git(wt, "add", "feature.txt");
  f.git(wt, "commit", "-m", "Local main only");
  f.git(f.root, "merge", "--ff-only", "fixture/local-main-only");
  const result = f.run(["--apply", "--allow-worktree", wt]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.records.some((record) => record.path === wt && record.reason === "HEAD_not_confirmed_merged_into_fresh_origin_main"));
  assert.ok(existsSync(wt));
  f.assertNoRemoval();
});

test("process cwd inside a worktree protects it before deleting dependencies", (t) => {
  const f = fixture(t);
  const wt = f.add("active");
  const dep = f.put(wt, "node_modules/module/index.js");
  const result = f.run(["--apply", "--allow-worktree", wt], { FIXTURE_CWDS: JSON.stringify([path.dirname(dep)]) });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.records.some((record) => record.path === wt && record.reason === "active_cwd"));
  assert.ok(existsSync(dep));
  const calls = readFileSync(f.env.FIXTURE_LSOF_LOG, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(calls.every((args) => args.includes("cwd") && args.includes("-d")));
  f.assertNoRemoval();
});

test("activity is checked again immediately before apply", (t) => {
  const f = fixture(t);
  const wt = f.add("newly-active");
  const dep = f.put(wt, "node_modules/module/index.js");
  const result = f.run(["--apply", "--allow-worktree", wt], { FIXTURE_LATE_CWD: wt });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.records.some((record) => record.path === wt && record.reason === "active_cwd"));
  assert.ok(existsSync(dep));
  f.assertNoRemoval();
});

test("macOS fcwd metadata is accepted without weakening active cwd protection", (t) => {
  const f = fixture(t);
  const wt = f.add("mac-cwd");
  const dep = f.put(wt, "node_modules/module/index.js");
  const result = f.run(["--apply", "--allow-worktree", wt], {
    FIXTURE_LSOF_RAW: `p1000\nfcwd\nn${f.root}\np1001\nfcwd\nn${wt}\n`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.records.some((record) => record.path === wt && record.reason === "active_cwd"));
  assert.ok(existsSync(dep));
  f.assertNoRemoval();
});

test("p/n-only output remains valid, but unknown descriptors and incomplete records block", (t) => {
  const f = fixture(t);
  const wt = f.add("cwd-field-validation");
  const args = ["--apply", "--allow-worktree", wt];
  const valid = f.run(args, { FIXTURE_LSOF_RAW: `p1000\nn${wt}\n` });
  assert.equal(valid.status, 0, valid.stderr);
  assert.ok(valid.records.some((record) => record.path === wt && record.reason === "active_cwd"));
  for (const raw of [
    `p1000\nf3\nn${f.root}\n`,
    `p1000\ng123\nn${f.root}\n`,
    `fcwd\nn${f.root}\n`,
    `p1000\nfcwd\nfcwd\nn${f.root}\n`,
    `p1000\nfcwd\nn${f.root}\np1001\nfcwd\n`,
  ]) {
    const result = f.run(args, { FIXTURE_LSOF_RAW: raw });
    assert.equal(result.status, 1);
    assert.ok(existsSync(wt));
  }
  f.assertNoRemoval();
});

test("LaunchAgent working directory and program arguments preserve referenced trees", (t) => {
  const f = fixture(t);
  const one = f.add("launch-one");
  const two = f.add("launch two");
  const dep = f.put(two, "node_modules/module/index.js");
  const nested = path.join(f.agents, "nested");
  mkdirSync(nested);
  writeFileSync(path.join(nested, "example.plist"), JSON.stringify({ WorkingDirectory: one, ProgramArguments: ["/bin/zsh", `${two}/run & report.sh`] }));
  const result = f.run(["--apply", "--allow-worktree", one, "--allow-worktree", two]);
  assert.equal(result.status, 0, result.stderr);
  for (const wt of [one, two]) assert.ok(result.records.some((record) => record.path === wt && record.reason === "LaunchAgent_reference"));
  assert.ok(existsSync(dep));
  f.assertNoRemoval();
});

test("lsof failure, warning, empty output, and unknown output all fail closed", (t) => {
  const f = fixture(t);
  const wt = f.add("unknown-cwd");
  const dep = f.put(wt, "node_modules/module/index.js");
  for (const mode of ["fail", "warn", "empty", "malformed"]) {
    const result = f.run(["--apply", "--allow-worktree", wt], { FIXTURE_LSOF_MODE: mode });
    assert.equal(result.status, 1, mode);
    assert.ok(existsSync(dep));
    f.assertNoRemoval();
  }
});

test("unreadable or malformed LaunchAgent evidence fails closed", (t) => {
  const f = fixture(t);
  const wt = f.add("unknown-agent");
  const dep = f.put(wt, "node_modules/module/index.js");
  const plist = path.join(f.agents, "unknown.plist");
  writeFileSync(plist, "{}");
  assert.equal(f.run(["--apply", "--allow-worktree", wt], { FIXTURE_PLUTIL_FAIL: "1" }).status, 1);
  writeFileSync(plist, "not a plist");
  assert.equal(f.run(["--apply", "--allow-worktree", wt]).status, 1);
  assert.ok(existsSync(dep));
  f.assertNoRemoval();
});

test("Git fetch/status/ignored inspection failures cannot delete dependencies", (t) => {
  const f = fixture(t);
  const wt = f.add("git-failure");
  const dep = f.put(wt, "node_modules/module/index.js");
  for (const operation of ["fetch", "status", "ls-files"]) {
    const result = f.run(["--apply", "--allow-worktree", wt], { FIXTURE_FAIL_GIT: operation });
    assert.ok(result.status === 1 || result.records.some((record) => record.path === wt && record.action === "kept"));
    assert.ok(existsSync(dep));
    f.assertNoRemoval();
  }
});

test("locked worktrees and hidden tracked changes require manual review", (t) => {
  const f = fixture(t);
  const locked = f.add("locked");
  const hidden = f.add("hidden-change");
  f.git(f.root, "worktree", "lock", locked);
  f.git(hidden, "update-index", "--assume-unchanged", "tracked.txt");
  f.put(hidden, "tracked.txt", "hidden change\n");
  const result = f.run(["--apply", "--allow-worktree", locked, "--allow-worktree", hidden]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.records.some((record) => record.path === locked && record.reason === "locked_detached_or_unknown_worktree"));
  assert.ok(result.records.some((record) => record.path === hidden && record.reason.includes("Hidden")));
  assert.ok(existsSync(locked) && existsSync(hidden));
  f.assertNoRemoval();
});

test("unknown node_modules locations and symlink dependencies are preserved", (t) => {
  const f = fixture(t);
  const wt = f.add("unknown-modules");
  const dep = f.put(wt, "nested/node_modules/backup.json");
  const result = f.run(["--apply", "--allow-worktree", wt]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(dep));
  const linked = f.add("symlink-modules");
  const external = path.join(f.tmp, "external-dependencies");
  mkdirSync(external);
  writeFileSync(path.join(external, "important.json"), "{}");
  symlinkSync(external, path.join(linked, "node_modules"), "dir");
  assert.equal(f.run(["--apply", "--allow-worktree", linked]).status, 0);
  assert.ok(existsSync(path.join(linked, "node_modules")));
  assert.ok(existsSync(path.join(external, "important.json")));
  f.assertNoRemoval();
});

test("empty ignored directories are kept too", (t) => {
  const f = fixture(t);
  const wt = f.add("empty-artifacts");
  mkdirSync(path.join(wt, "artifacts"));
  const result = f.run(["--apply", "--allow-worktree", wt]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(path.join(wt, "artifacts")));
  f.assertNoRemoval();
});

test("invalid allowlist, unknown arguments, and Git context overrides block safely", (t) => {
  const f = fixture(t);
  const wt = f.add("bad-input");
  for (const args of [["--apply", "--allow-worktree", "*"], ["--apply", "--allow-worktree", f.tmp], ["--unknown"]]) {
    assert.equal(f.run(args).status, 1);
  }
  assert.equal(f.run(["--apply", "--allow-worktree", wt], { GIT_WORK_TREE: f.root }).status, 1);
  assert.ok(existsSync(wt));
  f.assertNoRemoval();
});

test("an existing cleanup lock is neither acquired nor removed", (t) => {
  const f = fixture(t);
  const wt = f.add("existing-lock");
  mkdirSync(f.env.WORKTREE_CLEANUP_LOCK_DIR, { recursive: true });
  const result = f.run(["--apply", "--allow-worktree", wt]);
  assert.equal(result.status, 1);
  assert.ok(existsSync(f.env.WORKTREE_CLEANUP_LOCK_DIR));
  assert.ok(existsSync(wt));
  assert.equal(f.calls().length, 0);
});

test("Git removal failure is reported and is never retried with --force", (t) => {
  const f = fixture(t);
  const wt = f.add("remove-failure");
  const dep = f.put(wt, "node_modules/module/index.js");
  const result = f.run(["--apply", "--allow-worktree", wt], { FIXTURE_FAIL_GIT: "remove" });
  assert.equal(result.status, 1);
  assert.ok(result.records.some((record) => record.path === wt && record.action === "removal_failed"));
  assert.ok(existsSync(wt));
  assert.ok(existsSync(dep));
  assert.equal(f.calls().filter((args) => args.includes("remove")).length, 1);
  assert.ok(f.calls().every((args) => !args.includes("--force") && !args.includes("prune")));
});
