import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installExpiryWorker } from '../install-student-share-expiry.mjs';
import { EXPIRY_WORKER_POLICY } from '../lib/student-share-expiry-worker.mjs';
import { STUDENT_SHARE_SOURCES } from '../lib/imweb-student-share-policy.mjs';
import { MEAL_RELEASE_TARGETS, mealReleaseManifest } from '../release-team-instructor-intake-20261029.mjs';

const ledgers = () => STUDENT_SHARE_SOURCES.map(source => ({source,state:{
  accessPolicy:{id:source.policyId,approved:true,days:40,basis:'first_verified_grant',revocation:source.revocation},
  manualImmediateGrants:{},entitlements:{}}}));
test('expiry release replaces only CORE rules and preserves other assets', () => {
  assert.deepEqual(MEAL_RELEASE_TARGETS.studentShareExpiry.files,{'/rules/index.html':'core/rules/index.html'});
  const before='a'.repeat(64),after='b'.repeat(64);
  const files=[{path:'/rules/index.html',hash:before},{path:'/assets/app.js',hash:before}];
  const manifest=mealReleaseManifest(files,{'/rules/index.html':after},'studentShareExpiry');
  assert.equal(manifest['/assets/app.js'],before);
  assert.throws(()=>mealReleaseManifest(files,{'/rules/index.html':after,'/assets/app.js':after},'studentShareExpiry'));
});
test('prepare is read-only and does not install, create configuration or run a provider',async()=>{
  let calls=0;
  const result=await installExpiryWorker(['--prepare'],{readLedgers:ledgers,execute:()=>{calls++;throw Error('unexpected');}});
  assert.equal(result.status,'prepared');assert.equal(calls,0);
});
test('installer rejects unknown modes and dirty or wrong runtime before installation',async()=>{
  await assert.rejects(installExpiryWorker(['--apply']),/Use/);
  await assert.rejects(installExpiryWorker(['--install'],{root:'/tmp/not-runtime'}),/runtime/);
  await assert.rejects(installExpiryWorker(['--install'],{root:path.join(os.homedir(),'dev/archive-in-runtime'),
    execute:()=> ' M tracked-file'}),/runtime/);
});
test('activation requires the legacy schedule stopped and an installed disabled worker',async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'expiry-install-fixture-'));
  const directory=path.join(home,'ArchiveIN/automation/student-share-expiry');
  const automation=path.join(home,'.codex/automations/e-2');
  const file=path.join(directory,'config.json');
  try {
    fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.mkdirSync(automation,{recursive:true});
    const original={policy:EXPIRY_WORKER_POLICY,approved:true,enabled:false,sourceAutomationId:'e-2'};
    fs.writeFileSync(file,JSON.stringify(original),{mode:0o600});
    fs.writeFileSync(path.join(automation,'automation.toml'),'status = "ACTIVE"\n');
    const execute=(cmd,args)=>cmd==='git'?(args[0]==='status'?'':'synthetic-commit'):'com.archive.student-share-expiry';
    const options={home,root:path.join(home,'dev/archive-in-runtime'),execute,readLedgers:ledgers};
    await assert.rejects(installExpiryWorker(['--activate'],options),/deleted or paused/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)),original);
    fs.writeFileSync(path.join(automation,'automation.toml'),'status = "PAUSED"\n');
    const result=await installExpiryWorker(['--activate'],options);
    assert.equal(result.status,'activated');assert.equal(JSON.parse(fs.readFileSync(file)).enabled,true);
    await assert.rejects(installExpiryWorker(['--activate'],options),/disabled worker/);
  } finally {fs.rmSync(home,{recursive:true,force:true});}
});
test('LaunchAgent uses existing runtime and no member message, credential or browser command',()=>{
  const plist=fs.readFileSync(new URL('../../ops/launchagents/com.archive.student-share-expiry.plist',import.meta.url),'utf8');
  assert.match(plist,/StartInterval<\/key><integer>60<\/integer>/);
  assert.match(plist,/dev\/archive-in-runtime\/scripts\/run-student-share-expiry.mjs/);
  assert.doesNotMatch(plist,/send-|SOLAPI|token|browser-profile|secret/i);
});
test('CI runs synthetic expiry tests without a browser and UI only after Chromium setup',()=>{
  const functions=fs.readFileSync(new URL('../../.github/workflows/functions-affected-check.yml',import.meta.url),'utf8');
  const core=fs.readFileSync(new URL('../../.github/workflows/core-mcp-check.yml',import.meta.url),'utf8');
  assert.match(functions,/scripts\/tests\/student-share-expiry-worker\.test\.mjs scripts\/tests\/student-share-expiry-release\.test\.mjs/);
  assert.doesNotMatch(functions,/student-share-expiry\*|student-share-expiry-ui\.test\.mjs/);
  assert(core.indexOf('- run: npx playwright install')<core.indexOf('- run: node --test scripts/tests/student-share-expiry-ui.test.mjs'));
  assert.equal(core.split("- 'scripts/tests/student-share-expiry-ui.test.mjs'").length-1,2);
});
