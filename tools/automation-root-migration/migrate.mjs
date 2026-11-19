import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { rewriteAutomationPaths } from "./policy.mjs";

const home = os.homedir(), oldRoot = path.join(home, "ArchiveIN"), newRoot = path.join(home, "archive-automation");
const auditRelative = "operations/2026-11-19-automation-root-migration";
const audit = path.join(oldRoot, auditRelative);
const apply = process.argv.includes("--apply");
const hash = value => createHash("sha256").update(value).digest("hex");
const run = (name, args) => {
  const result = spawnSync(name, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(name)} failed: ${result.status}`);
  return result.stdout;
};
const readPlist = p => JSON.parse(run("/usr/bin/plutil", ["-convert", "json", "-o", "-", p]));
const identity = p => {
  const s = fs.statSync(p);
  return { dev: s.dev, ino: s.ino, mode: s.mode, uid: s.uid, gid: s.gid,
    ...(s.isFile() ? { sha256: hash(fs.readFileSync(p)) } : {}) };
};
const write = (name, data) => fs.writeFileSync(path.join(audit, name), JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });

if (process.platform !== "darwin" || home !== "/Users/archivepilates") throw new Error("Configured Mac mini host required");
if (fs.lstatSync(oldRoot).isSymbolicLink() || !fs.lstatSync(oldRoot).isDirectory()) throw new Error("Unexpected old root");
if (fs.existsSync(newRoot)) throw new Error("Destination already exists");
try { fs.lstatSync(newRoot); throw new Error("Destination entry already exists"); }
catch (error) { if (error.code !== "ENOENT") throw error; }

fs.mkdirSync(audit, { recursive: true, mode: 0o700 });
fs.chmodSync(audit, 0o700);
if (fs.existsSync(path.join(audit, "migration-result.json"))) throw new Error("Existing result; no replay");
const plistDir = path.join(home, "Library/LaunchAgents");
const jobs = [];
for (const name of fs.readdirSync(plistDir).filter(p => p.endsWith(".plist"))) {
  const full = path.join(plistDir, name), object = readPlist(full);
  if (!JSON.stringify(object).includes(oldRoot)) continue;
  const bytes = fs.readFileSync(full), stat = fs.statSync(full);
  const loaded = run("/bin/launchctl", ["print", `gui/${process.getuid()}/${object.Label}`]);
  jobs.push({ name, full, object, next: rewriteAutomationPaths(object, oldRoot, newRoot), sha256: hash(bytes), mode: stat.mode & 0o777,
    baseline: { loaded: true, state: loaded.match(/^\s*state = (.+)$/m)?.[1], pid: loaded.match(/^\s*pid = (\d+)$/m)?.[1] || null,
      lastExitCode: loaded.match(/^\s*last exit code = (.+)$/m)?.[1] || null } });
}
const paths = [".", "automation/state", "automation/locks", "automation/config", "automation/recovery",
  "automation/browser-profile", "automation/eformsign-browser-profile", "automation/browser-profiles",
  "automation/assets", "secrets", "emergency/downloads", "emergency/archive", "automation/reports", "operations",
  "secrets/google/archive-codex-operator.json", "automation/referral-production/config.json"];
const protectedPaths = paths.filter(p => fs.existsSync(path.join(oldRoot, p))).map(p => ({ path: p, ...identity(path.join(oldRoot, p)) }));
write("migration-plan.json", { createdAt: new Date().toISOString(), oldRoot, newRoot, protectedPaths,
  jobs: jobs.map(({ name, sha256, baseline }) => ({ name, sha256, baseline })),
  schedulesChanged: false, forcedRestarts: false, memberActions: false });
if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", jobs: jobs.length, protectedPaths: protectedPaths.length, oldRoot, newRoot }));
} else {
  const backups = path.join(audit, "plist-backups");
  fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  const binary = path.join(audit, "atomic-root-swap");
  const c = fileURLToPath(new URL("./swap.c", import.meta.url));
  run("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", "-O2", c, "-o", binary]);
  fs.chmodSync(binary, 0o700);
  const staged = [];
  for (const job of jobs) {
    if (hash(fs.readFileSync(job.full)) !== job.sha256) throw new Error("Concurrent plist change");
    fs.copyFileSync(job.full, path.join(backups, job.name));
    fs.chmodSync(path.join(backups, job.name), 0o600);
    const json = path.join(audit, `${job.name}.stage.json`), xml = path.join(audit, `${job.name}.stage.plist`);
    fs.writeFileSync(json, JSON.stringify(job.next), { mode: 0o600 });
    run("/usr/bin/plutil", ["-convert", "xml1", "-o", xml, json]);
    fs.chmodSync(xml, job.mode);
    if (!isDeepStrictEqual(readPlist(xml), job.next)) throw new Error("Staged plist mismatch");
    staged.push({ ...job, xml, json });
  }
  for (const job of jobs) if (hash(fs.readFileSync(job.full)) !== job.sha256) throw new Error("Plist changed before swap");
  const rootBefore = identity(oldRoot);
  fs.symlinkSync(path.basename(newRoot), newRoot);
  try { run(binary, [oldRoot, newRoot]); }
  catch (error) {
    if (fs.lstatSync(oldRoot).isDirectory() && fs.lstatSync(newRoot).isSymbolicLink()) fs.unlinkSync(newRoot);
    throw error;
  }
  const newAudit = path.join(newRoot, auditRelative);
  const valid = fs.lstatSync(oldRoot).isSymbolicLink() && fs.readlinkSync(oldRoot) === path.basename(newRoot) &&
    isDeepStrictEqual(identity(newRoot), rootBefore) && fs.realpathSync(oldRoot) === newRoot &&
    protectedPaths.every(p => isDeepStrictEqual(identity(path.join(newRoot, p.path)),
      Object.fromEntries(Object.entries(p).filter(([k]) => k !== "path"))) &&
      isDeepStrictEqual(identity(path.join(oldRoot, p.path)), identity(path.join(newRoot, p.path))));
  if (!valid) throw new Error("Root verification failed; preserve state for explicit recovery");
  const changed = [];
  for (const job of staged) {
    if (hash(fs.readFileSync(job.full)) !== job.sha256) throw new Error("Concurrent installed plist change after swap");
    const installedStage = `${job.full}.archive-migration-stage`;
    if (fs.existsSync(installedStage)) throw new Error("Unexpected installation staging file");
    fs.copyFileSync(path.join(newAudit, path.basename(job.xml)), installedStage, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(installedStage, job.mode);
    run("/usr/bin/plutil", ["-lint", installedStage]);
    fs.renameSync(installedStage, job.full);
    if (!isDeepStrictEqual(readPlist(job.full), job.next)) throw new Error("Installed plist readback failed");
    changed.push(job.name);
    fs.unlinkSync(path.join(newAudit, path.basename(job.xml)));
    fs.unlinkSync(path.join(newAudit, path.basename(job.json)));
  }
  write("migration-result.json", { status: "verified", finishedAt: new Date().toISOString(), oldRoot, newRoot,
    legacyLink: fs.readlinkSync(oldRoot), identityPreserved: valid, changedLaunchAgents: changed,
    forcedRestarts: 0, schedulesChanged: false, credentialsContentsChanged: false,
    pendingNativeLaunchConfiguration: "Existing loaded jobs keep their old textual paths through the compatibility symlink until their normal reload. No manual restart or member action." });
  console.log(JSON.stringify({ status: "verified", jobs: changed.length, oldRoot, newRoot,
    legacyLink: fs.readlinkSync(oldRoot), identitiesPreserved: valid, forcedRestarts: 0 }));
}
