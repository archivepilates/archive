#!/bin/sh
set -eu

# Audit by default. Apply needs --apply (or WORKTREE_CLEANUP_APPLY=1) AND
# repeated --allow-worktree /absolute/path arguments or a newline-delimited
# WORKTREE_CLEANUP_ALLOWLIST. No globs, branch deletion, pruning, or --force.
# Node is already a runtime dependency; keep structured Git/plist parsing here.
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] && [ -x /opt/homebrew/bin/node ]; then
  NODE_BIN=/opt/homebrew/bin/node
fi
if [ -z "$NODE_BIN" ]; then
  printf '%s\n' "Node is unavailable; no worktree cleanup performed" >&2
  exit 73
fi
exec "$NODE_BIN" - "$@" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const env = process.env;
const runtime = "/Users/archivepilates/dev/archive-in-runtime";
let root;
let logFile;
let lock;
let locked = false;

function log(action, details = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), action, ...details });
  if (logFile) fs.appendFileSync(logFile, line + "\n");
  console.log(line);
}

function absolute(value) {
  if (!value || !path.isAbsolute(value) || /[\r\n\0]/.test(value)) throw new Error("Expected an exact absolute path");
  return path.resolve(value);
}

function directory(value) {
  const resolved = fs.realpathSync(absolute(value));
  if (!fs.statSync(resolved).isDirectory()) throw new Error("Expected an existing directory");
  return resolved;
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function command(program, args, cwd = root) {
  const result = spawnSync(program, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.signal || result.status !== 0) throw new Error(`${program} inspection/operation failed (${args[0] || ""})`);
  return result;
}

function git(cwd, ...args) {
  return command("git", ["-C", cwd, "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args]).stdout;
}

function nulFields(output) {
  if (!output) return [];
  if (!output.endsWith("\0")) throw new Error("Incomplete Git output");
  return output.slice(0, -1).split("\0");
}

function worktrees() {
  const records = [];
  let record = {};
  for (const field of nulFields(git(root, "worktree", "list", "--porcelain", "-z"))) {
    if (!field) {
      if (!record.worktree) throw new Error("Unknown worktree record");
      records.push(record);
      record = {};
      continue;
    }
    const split = field.indexOf(" ");
    const key = split < 0 ? field : field.slice(0, split);
    const value = split < 0 ? true : field.slice(split + 1);
    if (Object.hasOwn(record, key)) throw new Error("Duplicate worktree field");
    record[key] = value;
  }
  if (Object.keys(record).length || !records.length) throw new Error("Incomplete worktree list");
  return records;
}

function launchAgentStrings(dirs) {
  const values = [];
  function collect(value) {
    if (typeof value === "string") values.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  }
  function scan(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (entry.isSymbolicLink() && !entry.name.endsWith(".plist")) throw new Error("Unknown LaunchAgent symlink");
      if (!entry.name.endsWith(".plist")) continue;
      const result = command("plutil", ["-convert", "json", "-o", "-", file]);
      if (result.stderr.trim()) throw new Error("LaunchAgent inspection warning");
      const plist = JSON.parse(result.stdout);
      if (!plist || typeof plist !== "object" || Array.isArray(plist)) throw new Error("Unknown LaunchAgent plist");
      collect(plist);
    }
  }
  dirs.forEach(scan);
  return values;
}

function activity(dirs) {
  const result = command("lsof", ["-nP", "-a", "-d", "cwd", "-Fpn"]);
  if (result.stderr.trim()) throw new Error("Incomplete lsof visibility");
  const cwds = [];
  let awaitingPath = false;
  let descriptorSeen = false;
  for (const line of result.stdout.trimEnd().split("\n")) {
    if (/^p\d+$/.test(line)) {
      if (awaitingPath) throw new Error("Incomplete lsof cwd record");
      awaitingPath = true;
      descriptorSeen = false;
      continue;
    }
    // macOS emits the cwd descriptor even when only p/n fields are requested.
    if (line === "fcwd" && awaitingPath && !descriptorSeen) {
      descriptorSeen = true;
      continue;
    }
    if (!awaitingPath || !line.startsWith("n/")) throw new Error("Unknown lsof cwd output");
    cwds.push(directory(line.slice(1)));
    awaitingPath = false;
  }
  if (awaitingPath) throw new Error("Incomplete lsof cwd record");
  if (!cwds.length) throw new Error("No process cwd evidence");
  return { cwds, agents: launchAgentStrings(dirs) };
}

function activeReason(wt, snapshot) {
  if (snapshot.cwds.some((cwd) => inside(wt, cwd))) return "active_cwd";
  for (const value of snapshot.agents) {
    const expanded = value.replaceAll("${HOME}", os.homedir()).replaceAll("$HOME", os.homedir()).replaceAll("~/", os.homedir() + "/");
    if (expanded.includes(wt)) return "LaunchAgent_reference";
    if (path.isAbsolute(expanded)) {
      try { if (inside(wt, fs.realpathSync(expanded))) return "LaunchAgent_reference"; }
      catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; }
    }
  }
  return "";
}

function inspect(wt, record, main) {
  if (git(wt, "rev-parse", "--show-toplevel").trim() !== wt) throw new Error("Worktree root mismatch");
  const head = git(wt, "rev-parse", "--verify", "HEAD^{commit}").trim();
  if (head !== record.HEAD) throw new Error("Worktree HEAD changed during inspection");
  if (git(wt, "symbolic-ref", "HEAD").trim() !== record.branch) throw new Error("Worktree branch changed");
  if (git(wt, "status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none", "-z")) {
    throw new Error("dirty_including_untracked");
  }
  if (nulFields(git(wt, "ls-files", "-v", "-z")).some((entry) => /^[a-zS]/.test(entry))) {
    throw new Error("Hidden assume-unchanged/sparse worktree files");
  }
  if (nulFields(git(wt, "ls-files", "--stage", "-z")).some((entry) => entry.startsWith("160000 "))) {
    throw new Error("Submodule worktree requires manual review");
  }
  // Compare to freshly fetched main, never to the feature branch's upstream.
  try { git(wt, "merge-base", "--is-ancestor", head, main); }
  catch { throw new Error("HEAD_not_confirmed_merged_into_fresh_origin_main"); }
  for (const entry of nulFields(git(wt, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"))) {
    const relative = entry.replace(/\/$/, "");
    const full = path.resolve(wt, relative);
    if (!inside(wt, full) || path.basename(full) !== "node_modules") throw new Error("ignored_files_preserved");
    if (!fs.lstatSync(full).isDirectory() || fs.realpathSync(full) !== full) throw new Error("Unknown node_modules path");
    const manifest = path.posix.join(path.posix.dirname(relative), "package.json");
    git(wt, "ls-files", "--error-unmatch", "--", `:(literal)${manifest}`);
    const pkg = JSON.parse(fs.readFileSync(path.join(wt, manifest), "utf8"));
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error("Unknown dependency manifest");
  }
}

try {
  if (![undefined, "0", "1"].includes(env.WORKTREE_CLEANUP_APPLY)) throw new Error("Invalid apply mode");
  let apply = env.WORKTREE_CLEANUP_APPLY === "1";
  const allowlist = (env.WORKTREE_CLEANUP_ALLOWLIST || "").split("\n").filter(Boolean);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = true;
    else if (args[i] === "--audit") apply = false;
    else if (args[i] === "--allow-worktree" && args[i + 1]) allowlist.push(args[++i]);
    else throw new Error("Unknown argument; use --audit/--apply and --allow-worktree /absolute/path");
  }
  if (apply && !allowlist.length) {
    log("skipped", { reason: "apply_requires_explicit_worktree_allowlist" });
  } else {
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
      if (env[name] !== undefined) throw new Error(`Unset ${name} before cleanup`);
    }
    root = directory(env.ARCHIVE_SOURCE_REPO || runtime);
    const wtRoot = directory(env.WORKTREE_CLEANUP_ROOT || "/Users/archivepilates/codex-worktrees");
    const allowed = new Set(allowlist.map(directory));
    const agentDirs = (env.WORKTREE_CLEANUP_LAUNCH_AGENT_DIRS === undefined
      ? [path.join(os.homedir(), "Library/LaunchAgents"), "/Library/LaunchAgents", "/Library/LaunchDaemons"]
      : env.WORKTREE_CLEANUP_LAUNCH_AGENT_DIRS.split("\n")).map(absolute);
    lock = absolute(env.WORKTREE_CLEANUP_LOCK_DIR || "/Users/archivepilates/ArchiveIN/automation/locks/worktree-cleanup.lock");
    const logDir = absolute(env.WORKTREE_CLEANUP_LOG_DIR || "/Users/archivepilates/ArchiveIN/automation/logs/worktree-cleanup");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.mkdirSync(lock);
    locked = true;
    fs.mkdirSync(logDir, { recursive: true });
    logFile = path.join(logDir, new Date().toISOString().slice(0, 10) + ".log");
    log("started", { mode: apply ? "apply" : "audit" });
    const records = worktrees();
    for (const allowedPath of allowed) {
      if (!records.some((record) => record.worktree === allowedPath)) throw new Error("Allowlisted path is not a registered worktree");
    }
    git(root, "fetch", "--no-tags", "--no-recurse-submodules", "origin", "refs/heads/main:refs/remotes/origin/main");
    const main = git(root, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}").trim();
    const snapshot = activity(agentDirs);
    for (const record of records) {
      const wt = record.worktree;
      let removalStarted = false;
      try {
        if (wt === root || wt === runtime || record.branch === "refs/heads/main") throw new Error("runtime_or_main_worktree");
        if (wt === wtRoot || !inside(wtRoot, wt)) throw new Error("outside_worktree_root");
        if (apply && !allowed.has(wt)) throw new Error("not_allowlisted");
        if (Object.keys(record).some((key) => !["worktree", "HEAD", "branch"].includes(key))) throw new Error("locked_detached_or_unknown_worktree");
        if (!record.HEAD || !record.branch || directory(wt) !== wt) throw new Error("Unknown worktree identity");
        if (inside(wt, root) || inside(wt, logDir) || inside(wt, lock) || agentDirs.some((dir) => inside(wt, dir))) throw new Error("operational_path");
        const reason = activeReason(wt, snapshot);
        if (reason) throw new Error(reason);
        inspect(wt, record, main);
        if (!apply) {
          log("audit_eligible", { path: wt, allowlisted: allowed.has(wt), main });
          continue;
        }
        // Recheck activity, metadata, and every file guard before deleting even
        // rebuildable dependencies. All other ignored files preserve the tree.
        const current = worktrees().find((entry) => entry.worktree === wt);
        if (JSON.stringify(current) !== JSON.stringify(record)) throw new Error("Worktree metadata changed");
        const active = activeReason(wt, activity(agentDirs));
        if (active) throw new Error(active);
        inspect(wt, record, main);
        removalStarted = true;
        git(root, "worktree", "remove", wt);
        if (fs.existsSync(wt) || worktrees().some((entry) => entry.worktree === wt)) throw new Error("Worktree removal not verified");
        log("removed", { path: wt, main });
      } catch (error) {
        log(removalStarted ? "removal_failed" : "kept", { path: wt, reason: error.message });
        if (removalStarted) process.exitCode = 1;
      }
    }
    log("finished", { mode: apply ? "apply" : "audit" });
  }
} catch (error) {
  console.error(JSON.stringify({ action: "blocked", reason: error.message }));
  process.exitCode = 1;
} finally {
  if (locked) {
    try { fs.rmdirSync(lock); }
    catch { console.error("Cleanup lock release failed; manual review required"); process.exitCode = 1; }
  }
}
NODE
