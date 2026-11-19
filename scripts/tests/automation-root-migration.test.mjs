import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { rewriteAutomationPaths } from "../../tools/automation-root-migration/policy.mjs";
import { acquireStudioMateBrowserLock } from "../lib/studiomate-browser-lock.mjs";
import { archiveAutomationRoot, canonicalAutomationPath } from "../lib/archive-automation-paths.mjs";
import { isManagedLocalStudioMateExcelPath } from "../lib/imported-source-retention.mjs";

test("root resolver handles preflight, prepared swap, canonical alias and conflicting roots", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "archive-root-resolver-")));
  const old = path.join(home, "ArchiveIN"), next = path.join(home, "archive-automation");
  try {
    assert.equal(archiveAutomationRoot(home), next);
    fs.mkdirSync(old);
    assert.equal(archiveAutomationRoot(home), old);
    fs.symlinkSync("archive-automation", next);
    assert.equal(archiveAutomationRoot(home), old);
    fs.unlinkSync(next); fs.renameSync(old, next); fs.symlinkSync("archive-automation", old);
    assert.equal(archiveAutomationRoot(home), next);
    assert.equal(canonicalAutomationPath(old + "/automation/state", home), next + "/automation/state");
    assert.equal(canonicalAutomationPath(old + "-unrelated/state", home), old + "-unrelated/state");
    assert.equal(canonicalAutomationPath("/custom/override", home), "/custom/override");
    const managed = path.join(next, "emergency/downloads");
    fs.mkdirSync(managed, { recursive: true });
    fs.writeFileSync(path.join(managed, "source.xlsx"), "synthetic");
    assert.equal(isManagedLocalStudioMateExcelPath(path.join(old, "emergency/downloads/source.xlsx"), home), true);
    assert.equal(isManagedLocalStudioMateExcelPath(path.join(managed, "source.xlsx"), home), true);
    fs.mkdirSync(path.join(home, "outside"));
    fs.writeFileSync(path.join(home, "outside/protected.xlsx"), "original");
    fs.symlinkSync(path.join(home, "outside"), path.join(managed, "escape"));
    assert.equal(isManagedLocalStudioMateExcelPath(path.join(managed, "escape/protected.xlsx"), home), false);
    fs.unlinkSync(old); fs.symlinkSync("outside", old);
    assert.throws(() => archiveAutomationRoot(home), /Unverified/);
    fs.unlinkSync(old); fs.mkdirSync(old);
    assert.throws(() => archiveAutomationRoot(home), /Conflicting/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("resolver revalidates a snapshot that straddles the atomic root transition", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "archive-root-race-")));
  const old = path.join(home, "ArchiveIN"), next = path.join(home, "archive-automation");
  try {
    fs.mkdirSync(old);
    let reads = 0;
    const io = { ...fs, lstatSync(file, options) {
      if (++reads === 2) { fs.renameSync(old, next); fs.symlinkSync("archive-automation", old); }
      return fs.lstatSync(file, options);
    } };
    assert.equal(archiveAutomationRoot(home, io), next);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("a journal created before migration can record an acceptance after the root transition", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "archive-root-journal-")));
  try {
    fs.mkdirSync(path.join(home, "ArchiveIN"), { mode: 0o700 });
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
      import assert from 'node:assert/strict';
      import { createImwebNativeFollowupStore, imwebPayloadDigest, runApprovedImwebWrite } from './scripts/lib/imweb-native-followup.mjs';
      const old=path.join(os.homedir(),'ArchiveIN'), next=path.join(os.homedir(),'archive-automation');
      const directory=path.join(old,'journal'); fs.mkdirSync(directory,{mode:0o700});
      const store=createImwebNativeFollowupStore({directory,now:()=> '2026-11-19T01:00:00Z'});
      const payload={synthetic:true};
      const operation={canonicalActionKey:'synthetic-root-migration',siteCode:'synthetic-site',unitCode:'synthetic-unit',
        approvedScope:{action:'synthetic',targetIds:['synthetic'],fields:['synthetic']},
        payloadDigest:imwebPayloadDigest(payload),approvalRef:'synthetic:approval',ledgerRef:'synthetic:ledger',
        approvedAt:'2026-11-19T00:00:00Z',approvalExpiresAt:'2026-11-19T02:00:00Z'};
      await runApprovedImwebWrite({store,operation,payload,execute:async()=>{
        fs.renameSync(old,next); fs.symlinkSync('archive-automation',old); return {ok:true};
      }});
      assert.equal(store.get(operation.canonicalActionKey).status,'cli_accepted');
    `], { cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("installed configuration changes only the exact root, preserving schedule, flags and identities", () => {
  const old = "/Users/synthetic/ArchiveIN", next = "/Users/synthetic/archive-automation";
  const input = { Label: "same-job", ProgramArguments: ["node", "/code/worker.mjs", "--apply"],
    StandardOutPath: old + "/automation/logs/worker.log", StartInterval: 3600, RunAtLoad: true,
    StartCalendarInterval: { Hour: 9, Minute: 30 }, KeepAlive: false,
    EnvironmentVariables: { KEY_PATH: old + "/secrets/operator.json", CUSTOM: "unchanged" },
    Other: [old, "~/ArchiveIN/automation/state", old + "-other/file", "https://example.test/ArchiveIN/file"] };
  const before = structuredClone(input), result = rewriteAutomationPaths(input, old, next);
  assert.deepEqual(input, before);
  assert.deepEqual(result, { ...input, StandardOutPath: next + "/automation/logs/worker.log",
    EnvironmentVariables: { KEY_PATH: next + "/secrets/operator.json", CUSTOM: "unchanged" },
    Other: [next, "~/archive-automation/automation/state", old + "-other/file", "https://example.test/ArchiveIN/file"] });
});

test("atomic directory/link swap preserves open files and serializes old/new browser lock paths", { skip: process.platform !== "darwin" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-root-migration-test-"));
  const old = path.join(dir, "ArchiveIN"), next = path.join(dir, "archive-automation"), binary = path.join(dir, "swap");
  const source = fileURLToPath(new URL("../../tools/automation-root-migration/swap.c", import.meta.url));
  let release, fd;
  try {
    const compiled = spawnSync("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", source, "-o", binary], { encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stderr);
    fs.mkdirSync(old, { mode: 0o700 });
    fs.mkdirSync(path.join(old, "locks"));
    fs.writeFileSync(path.join(old, "original"), "synthetic original", { mode: 0o600 });
    fd = fs.openSync(path.join(old, "original"), "r");
    const before = fs.statSync(old);
    release = await acquireStudioMateBrowserLock({ lockPath: path.join(old, "locks/profile.lock"), waitMs: 0 });
    fs.symlinkSync("archive-automation", next);
    const moved = spawnSync(binary, [old, next], { encoding: "utf8" });
    assert.equal(moved.status, 0, moved.stderr);
    assert.equal(fs.lstatSync(old).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(old), fs.realpathSync(next));
    assert.equal(fs.statSync(next).ino, before.ino);
    assert.equal(fs.statSync(next).mode, before.mode);
    assert.equal(fs.readFileSync(fd, "utf8"), "synthetic original");
    assert.equal(fs.readFileSync(path.join(next, "original"), "utf8"), "synthetic original");
    await assert.rejects(acquireStudioMateBrowserLock({ lockPath: path.join(next, "locks/profile.lock"), waitMs: 0 }),
      { code: "STUDIOMATE_BROWSER_BUSY" });
    await release(); release = null;
    const nextRelease = await acquireStudioMateBrowserLock({ lockPath: path.join(next, "locks/profile.lock"), waitMs: 0 });
    await assert.rejects(acquireStudioMateBrowserLock({ lockPath: path.join(old, "locks/profile.lock"), waitMs: 0 }),
      { code: "STUDIOMATE_BROWSER_BUSY" });
    await nextRelease();
    assert.equal(fs.existsSync(path.join(old, "locks/profile.lock")), false);
  } finally {
    if (release) await release();
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("native swap rejects an unrelated destination and never replaces an existing directory", { skip: process.platform !== "darwin" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-root-migration-reject-"));
  try {
    const source = fileURLToPath(new URL("../../tools/automation-root-migration/swap.c", import.meta.url));
    const binary = path.join(dir, "swap"), old = path.join(dir, "ArchiveIN"), next = path.join(dir, "archive-automation");
    assert.equal(spawnSync("/usr/bin/xcrun", ["clang", source, "-o", binary]).status, 0);
    fs.mkdirSync(old); fs.mkdirSync(next);
    assert.notEqual(spawnSync(binary, [old, next]).status, 0);
    assert.equal(fs.lstatSync(old).isDirectory(), true);
    assert.equal(fs.lstatSync(next).isDirectory(), true);
    fs.rmdirSync(next); fs.symlinkSync("wrong-target", next);
    assert.notEqual(spawnSync(binary, [old, next]).status, 0);
    assert.equal(fs.lstatSync(old).isDirectory(), true);
    assert.equal(fs.readlinkSync(next), "wrong-target");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
