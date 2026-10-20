import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";

test("only explicitly scheduled runner forwards reminder permission",()=>{
  const runner=readFileSync(new URL("../run-studiomate-excel-emergency-mode.mjs",import.meta.url),"utf8");
  assert.match(runner,/const scheduledRun = args.has\("--scheduled-run"\)/);
  assert.match(runner,/scheduledRun \? \["--send-signature-reminders"\] : \[\]/);
  const plist=readFileSync(new URL("../../firebase/kangsain-functions/macmini-studiomate/com.archive.studiomate-excel-emergency-mode.plist",import.meta.url),"utf8");
  assert.match(plist,/<string>--scheduled-run<\/string>/);
  assert.doesNotMatch(plist,/<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist,/<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
});

test("exact-target and dry-run completion cannot be used as reminder send entrypoints",()=>{
  const file=new URL("../process-studiomate-membership-contract-completions.mjs",import.meta.url);
  for(const args of [["--dry-run","--send-signature-reminders"],["--apply","--contract-id","a".repeat(64),"--send-signature-reminders"]]) {
    const result=spawnSync(process.execPath,[file.pathname,...args],{encoding:"utf8",env:{...process.env,STUDIOMATE_MEMBERSHIP_CONTRACT_COMPLETION:"disabled"}});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Signature reminders require the scheduled apply path/);
  }
  const result=spawnSync(process.execPath,[file.pathname,"--apply"],{encoding:"utf8",env:{...process.env,STUDIOMATE_MEMBERSHIP_CONTRACT_COMPLETION:"disabled"}});
  assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).studioMateWrites,0);
});
