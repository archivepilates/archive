import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import vm from "node:vm";
import path from "node:path";
import test from "node:test";
import { memberDispatchWindow, assertMemberDispatchAllowed, isMemberDispatchDeferred, MemberDispatchDeferredError } from "../lib/member-dispatch-window.mjs";
import { runStudioMateMembershipContractCandidates, firestoreJournal } from "../lib/studiomate-membership-contract-processor.mjs";
import { processContractSignatureReminder, planContractSignatureReminder, CONTRACT_REMINDER_POLICY } from "../lib/contract-signature-reminder.mjs";
import { sendContractReminderSms } from "../lib/contract-signature-reminder-browser.mjs";
import { dispatchVerifiedOperatorHolding, verifiedOperatorHoldingPlan } from "../lib/holding-notice-operator-dispatch.mjs";
import { HOLDING_SOURCE, holdingFingerprint, normalizeHoldingObservation } from "../lib/studiomate-holding-source.mjs";
import { dispatchHoldingNoticeSample } from "../lib/holding-notice-test-dispatch.mjs";
import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID } from "../lib/holding-allowance-notice.mjs";

const require = createRequire(new URL("../../firebase/kangsain-functions/functions/package.json", import.meta.url));
const ts = require("typescript");
const DAY = Date.parse("2026-10-22T01:00:00.000Z");
const NIGHT = Date.parse("2026-10-22T14:00:00.000Z");
const NEXT = "2026-10-23T00:00:00.000Z";
const fail = () => assert.fail("Unexpected external operation");
const workers = ["process-studiomate-refund-sms-jobs.mjs", "process-eformsign-refund-jobs.mjs", "process-eformsign-instructor-member-jobs.mjs"];

async function parsed(name) {
  const source = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
  return ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function functions(tree, names, globals) {
  const declarations = names.map(name => {
    const node = tree.statements.find(n => (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name?.text === name);
    assert.ok(node, `Missing function ${name}`);
    return node.getText(tree);
  });
  return vm.runInNewContext(`${declarations.join("\n")}\n({${names.join(",")}})`, globals);
}

// Pure in-memory transactions; these tests never initialize Firebase or a browser.
function store(initial = {}) {
  const rows = new Map(Object.entries(structuredClone(initial)));
  const deleted = Symbol("delete");
  const fieldValue = { delete: () => deleted, serverTimestamp: () => "synthetic-stamp" };
  const apply = (data, patch) => {
    for (const [field, value] of Object.entries(patch)) {
      const parts = field.split("."), key = parts.pop();
      let target = data;
      for (const part of parts) target = target[part] ??= {};
      if (value === deleted) delete target[key]; else target[key] = structuredClone(value);
    }
    return data;
  };
  const snap = ref => ({ exists: rows.has(ref.path), data: () => structuredClone(rows.get(ref.path)) });
  const db = {
    rows, fieldValue, commits: [],
    doc: path => ({ path, id: path.split("/").at(-1), get: async () => snap({path}),
      set: async patch => rows.set(path, apply(rows.get(path) || {}, patch)) }),
    collection: name => ({ doc: id => db.doc(`${name}/${id}`) }),
    async runTransaction(callback) {
      const writes = [];
      const tx = {
        get: async ref => snap(ref),
        create: (ref, row) => { assert.equal(rows.has(ref.path), false); writes.push(["create",ref,row]); },
        update: (ref, patch) => writes.push(["update",ref,patch]),
        set: (ref, patch) => writes.push(["update",ref,patch]),
        delete: ref => writes.push(["delete",ref]),
      };
      const result = await callback(tx);
      for (const [op,ref,patch] of writes) {
        if (op === "delete") rows.delete(ref.path);
        else rows.set(ref.path, apply(rows.get(ref.path) || {}, patch));
      }
      db.commits.push(writes);
      return result;
    },
    batch() {
      const writes=[];
      return {set:(ref,patch)=>writes.push([ref,patch]),update:(ref,patch)=>writes.push([ref,patch]),
        commit:async()=>{for(const [ref,patch] of writes)rows.set(ref.path,apply(rows.get(ref.path)||{},patch));}};
    },
  };
  return db;
}

test("absolute KST boundaries, including the last quiet millisecond", () => {
  for (const [instant, allowed, next] of [
    ["2026-10-22T00:00:00.000Z",true,null],
    ["2026-10-22T13:59:59.999Z",true,null],
    ["2026-10-22T14:00:00.000Z",false,NEXT],
    ["2026-10-22T15:00:00.000Z",false,NEXT],
    ["2026-10-22T23:59:59.999Z",false,NEXT],
    [NEXT,true,null],
  ]) {
    assert.equal(memberDispatchWindow(instant).allowed,allowed);
    assert.equal(memberDispatchWindow(instant).nextAllowedAt,next);
    if (allowed) assert.doesNotThrow(()=>assertMemberDispatchAllowed(instant));
    else assert.throws(()=>assertMemberDispatchAllowed(instant),isMemberDispatchDeferred);
  }
});

test("library early defers touch no DB, browser, source, or transport, even for approved tests", async () => {
  for (const now of [()=>NIGHT,()=>Date.parse("2026-10-22T23:59:59.999Z")]) {
    const deps={db:new Proxy({}, {get:fail}), request:fail, readLatest:fail, stamp:fail, confirmed:true, now};
    for (const run of [dispatchVerifiedOperatorHolding,dispatchHoldingNoticeSample]) {
      const result=await run(deps);
      assert.equal(result.status,"deferred");assert.equal(result.providerPostCount,0);assert.equal(result.nextAllowedAt,NEXT);
    }
    assert.equal((await processContractSignatureReminder({db:deps.db,readLive:fail,sendSms:fail,
      now:()=>new Date(now()),apply:true,scheduled:true})).status,"deferred");
    await assert.rejects(sendContractReminderSms({goto:fail},{},fail,{now}),isMemberDispatchDeferred);
  }
});

test("purchase hints retain the only loadable status and original discovery timestamps", async () => {
  const discovery={previousDownloadedAt:"previous",sourceDownloadedAt:"source",candidateHints:[{hintId:"one"},{hintId:"two"}]};
  const original=structuredClone(discovery), writes=[];
  const db={doc:path=>({set:async(patch,options)=>writes.push({path,patch,options})})};
  const result=await runStudioMateMembershipContractCandidates({db,discovery,now:()=>NIGHT});
  assert.equal(result.status,"deferred");assert.equal(result.checked,0);
  assert.equal(writes.length,2);
  for(const {patch,options} of writes){
    assert.equal(patch.status,"native_verification_required");assert.equal(patch.nextAllowedAt,NEXT);
    assert.equal(patch.reason,"member_dispatch_quiet_hours");assert.deepEqual(options,{merge:true});
    assert.equal(Object.hasOwn(patch,"processedAt"),false);
  }
  assert.deepEqual(discovery,original);
});

test("journal quiet claim cannot mutate and prepared checkpoint is bounded and returned on resume", async () => {
  const db=store(), journal=firestoreJournal(db,null,()=>NIGHT);
  await assert.rejects(journal.claim({jobKey:"job",payloadHash:"hash",selection:{}}),isMemberDispatchDeferred);
  assert.equal(db.rows.size,0);
  const id="a".repeat(64), preparedPayload=JSON.stringify({contract_id_hash:id,contractor_name:"Synthetic Member",
    studio_name:"ARCHIVE PILATES",contract_link:`https://sign.studiomate.kr/${id}`,message:"Synthetic message"});
  await journal.stage("job","signature_prepared",{contractId:id,payloadHash:"hash",preparedPayload});
  assert.equal((await journal.claim({jobKey:"job",payloadHash:"hash",selection:{}})).preparedPayload,preparedPayload);
  for(const value of ["x".repeat(16_385),JSON.stringify({seal:"private"}),"{bad"])
    await assert.rejects(journal.stage("bad","signature_prepared",{contractId:id,preparedPayload:value}));
  assert.equal(db.rows.has("studiomateMembershipContractJobs/bad"),false);
});

test("each queue writes only a neutral local heartbeat before exiting, without admin or browser initialization", async t => {
  for(const worker of workers)await t.test(worker,async()=>{
    const tree=await parsed(worker), statements=tree.statements.filter(n=>!ts.isImportDeclaration(n));
    const requireAt=statements.findIndex(n=>n.getText(tree).startsWith("const require ="));
    assert.ok(requireAt>0);
    const logs=[],exit={},files=[],directories=[],heartbeats=[];
    const prefix=statements.slice(0,requireAt).map(n=>n.getText(tree)).join("\n");
    await assert.rejects(vm.runInNewContext(`(async()=>{${prefix}})()`,{
      memberDispatchWindow:()=>memberDispatchWindow(NIGHT),console:{log:value=>logs.push(JSON.parse(value))},
      process:{argv:[],env:{},exit:code=>{assert.equal(code,0);throw exit;}},
      parseArgs:()=>({}),expandHome:value=>value,path,
      mkdir:async value=>directories.push(value),writeFile:async (...args)=>files.push(args),
      appendIdleHeartbeatIfDue:(...args)=>heartbeats.push(args),
    }),error=>error===exit);
    assert.equal(logs.length,1);assert.equal(logs[0].status,"deferred");assert.equal(logs[0].ok,true);
    assert.equal(logs[0].nextAllowedAt,NEXT);
    assert.ok(logs[0].finishedAt);assert.equal(logs[0].processed,0);assert.equal(logs[0].sent,0);
    assert.equal(files.length,1);assert.ok(files[0][0].endsWith("latest.json"));
    assert.equal(JSON.parse(files[0][1]).status,"deferred");
    assert.equal(heartbeats.length,1);assert.equal(heartbeats[0][2],30*60*1000);
    assert.equal(directories.length,2);assert.equal(directories.some(value=>value.includes("browser-profile")),false);
  });
  const tree=await parsed("recover-approved-membership-welcomes.mjs"),logs=[];
  const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="main");
  const prefix=node.body.statements[0].getText(tree);
  const main=vm.runInNewContext(`(async()=>{${prefix}})`,{memberDispatchWindow:()=>memberDispatchWindow(NIGHT),console:{log:v=>logs.push(JSON.parse(v))}});
  await main();assert.equal(logs[0].status,"deferred");assert.equal(logs[0].providerPostCount,0);
});

test("queue quiet defer restores attempts and removes pre-click send markers without touching other fields",async t=>{
  for(const [index,worker] of workers.entries())await t.test(worker,async()=>{
    const jobRoot=["studiomateRefundSmsJobs","eformsignRefundJobs","eformsignInstructorMemberJobs"][index];
    const sourceRoot=index===2?"instructorLessonRegistrations":"refundCases";
    const job={status:"retry",attempts:2,caseId:"one",unrelated:"keep",lastError:"prior error"};
    const source={status:"pending",nextAction:"prior action",smsNotice:{status:"pending",unrelated:"keep"},steps:{eformsign:{status:"pending"}},unrelated:"keep"};
    const db=store({[`${jobRoot}/one`]:job,[`${sourceRoot}/one`]:source});
    let clock=DAY;
    const tree=await parsed(worker);
    const names=["claimJob","restoreFields","deferClaim","markSending",...(index===2?["writeSendClaimedState"]:[])];
    const api=functions(tree,names,{db,FieldValue:db.fieldValue,os:{hostname:()=>"test"},randomUUID:()=>"test-claim",process:{pid:1},
      memberDispatchWindow:()=>memberDispatchWindow(clock),assertMemberDispatchAllowed:()=>assertMemberDispatchAllowed(clock),
      deriveRegistrationPatch:(_current,patch)=>({...patch,status:"processing",nextAction:"sending"}),
      resolvedEformErrorPatch:()=>({}),stepValue:()=>({status:"processing"}),
    });
    const ref=db.doc(`${jobRoot}/one`),claimed=await api.claimJob(ref);
    assert.equal(db.rows.get(ref.path).attempts,3);
    await api.markSending(ref,claimed);
    assert.equal(db.rows.get(ref.path).status,"sending");
    clock=NIGHT;
    await api.deferClaim(ref,claimed);
    const {dispatchDeferrals,...restored}=db.rows.get(ref.path);
    assert.deepEqual(restored,{...job,nextAllowedAt:NEXT});
    assert.equal(dispatchDeferrals.length,1);assert.equal(dispatchDeferrals[0].providerPostCount,0);
    assert.deepEqual(db.rows.get(`${sourceRoot}/one`),source);
    const count=db.commits.length;
    assert.equal(await api.claimJob(ref),null);
    assert.equal(db.commits[count].length,0);
    assert.equal(db.rows.get(ref.path).attempts,2);
  });
});

test("queue last-mile clock crossing skips the irreversible click",async t=>{
  for(const worker of workers)await t.test(worker,async()=>{
    const tree=await parsed(worker),sms=worker.includes("sms");
    const name=sms?"sendRefundSms":worker.includes("instructor")?"sendInstructorMemberForm":"sendRefundAgreement";
    const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
    const statements=fn.body.statements;
    const start=statements.findIndex(n=>n.getText(tree).includes("const onClick = await beforeFinalSend()"));
    const end=statements.findIndex((n,i)=>i>=start&&n.getText(tree).includes(".click()"));
    assert.ok(start>=0&&end>start);
    let marked=0,clicked=0;
    const button={click:async()=>{clicked++;}};
    const page={waitForResponse:()=>Promise.resolve({}),getByRole:()=>button};
    const run=vm.runInNewContext(`(async()=>{${statements.slice(start,end+1).map(n=>n.getText(tree)).join("\n")}})`,{
      beforeFinalSend:async()=>()=>marked++,assertMemberDispatchAllowed:()=>assertMemberDispatchAllowed(NIGHT),
      finalSendButton:button,confirmation:page,page,
    });
    await assert.rejects(run(),isMemberDispatchDeferred);
    assert.equal(clicked,0);assert.equal(marked,0);
  });
});

test("sample claimed at 22:59 defers without failed ledger or consumed test attempt",async()=>{
  const db=store();let clock=Date.parse("2026-10-22T13:59:59.999Z"),posts=0;
  const transact=db.runTransaction;
  db.runTransaction=async callback=>{const result=await transact(callback);clock=NIGHT;return result;};
  const result=await dispatchHoldingNoticeSample({db,stamp:()=>"stamp",confirmed:true,now:()=>clock,
    recipient:{memberId:"1982133",name:"김기효",phone:"01086488585"},date:"2026-10-22",
    template:{...HOLDING_NOTICE_TEMPLATE,templateId:HOLDING_NOTICE_TEMPLATE_ID,status:"APPROVED"},request:async()=>{posts++;fail();}});
  assert.equal(result.status,"deferred");assert.equal(posts,0);assert.equal(db.rows.size,2);
  for(const row of db.rows.values()){
    assert.equal(row.status,"deferred");assert.equal(row.attempts,0);assert.equal(row.dispatchDeferrals.length,1);
    assert.equal(row.dispatchDeferrals[0].providerPostCount,0);
  }
  db.runTransaction=transact;clock=Date.parse(NEXT);
  const run=()=>dispatchHoldingNoticeSample({db,stamp:()=>"stamp",confirmed:true,now:()=>clock,
    recipient:{memberId:"1982133",name:"김기효",phone:"01086488585"},date:"2026-10-23",
    template:{...HOLDING_NOTICE_TEMPLATE,templateId:HOLDING_NOTICE_TEMPLATE_ID,status:"APPROVED"},request:async()=>{
      posts++;return{messageList:[{messageId:"fixture",to:"01086488585",kakaoOptions:{templateId:HOLDING_NOTICE_TEMPLATE_ID}}]};
    }});
  assert.equal((await run()).providerPostCount,1);assert.equal(posts,1);
  assert.equal((await run()).duplicateBlocked,true);assert.equal(posts,1);
  for(const row of db.rows.values())assert.equal(row.dispatchDeferrals.length,1);
});

test("reminder retains an audited pre-transport deferral and resumes only its exact canonical fingerprint",async()=>{
  const id="a".repeat(64),sourcePath=`studiomateMembershipContracts/${id}`;
  const tree=await parsed("tests/contract-signature-reminder.test.mjs");
  const {sourceFixture,liveFixture,configFixture}=functions(tree,["sourceFixture","sentObservation","liveFixture","configFixture"],{
    ID:id,NOW:"2026-10-20T01:00:00.000Z",SENT:"2026-10-19T01:00:00.000Z",createHash,
    CONTRACT_REMINDER_POLICY,WAITING_TEXT:"요청대기",
  });
  const source=sourceFixture(),db=store({[sourcePath]:source,"systemSettings/membershipContractAutomation":configFixture()});
  let clock=Date.parse("2026-10-20T01:00:00.000Z"),posts=0;
  const transact=db.runTransaction;
  db.runTransaction=async callback=>{
    const result=await transact(callback);
    if(db.rows.get(sourcePath).signatureReminder?.status==="attempting") clock=Date.parse("2026-10-20T14:00:00.000Z");
    return result;
  };
  const run=()=>processContractSignatureReminder({db,source:db.rows.get(sourcePath),id,now:()=>new Date(clock),apply:true,scheduled:true,
    readLive:async()=>liveFixture(source,new Date(clock).toISOString()),sendSms:async(_plan,before)=>{
      const onClick=await before();assertMemberDispatchAllowed(clock);onClick();posts++;return{smsId:42};
    }});
  assert.equal((await run()).status,"deferred");assert.equal(posts,0);
  const deferred=structuredClone(db.rows.get(sourcePath).signatureReminder);
  assert.equal(deferred.status,"deferred");assert.equal(deferred.attempts,0);assert.equal(deferred.deferrals.length,1);
  assert.equal(deferred.deferrals[0].attemptedAt,deferred.attemptedAt);
  clock=Date.parse("2026-10-21T00:00:00.000Z");
  const changed=structuredClone(db.rows.get(sourcePath));changed.memberName="Other Member";
  assert.notEqual(planContractSignatureReminder(changed,id,new Date(clock)).status,"ready");
  for(const patch of [{deferredBeforeTransport:false},{deferrals:[]},{status:"review"},{status:"accepted"},{attempts:1}]){
    const row=structuredClone(db.rows.get(sourcePath));Object.assign(row.signatureReminder,patch);
    assert.notEqual(planContractSignatureReminder(row,id,new Date(clock)).status,"ready");
  }
  db.runTransaction=transact;
  assert.equal((await run()).status,"accepted");assert.equal(posts,1);
  assert.deepEqual(db.rows.get(sourcePath).signatureReminder.deferrals,deferred.deferrals);
  assert.equal((await run()).status,"skipped");assert.equal(posts,1);
});

test("operator holding preserves all three canonical audit rows on quiet crossing and resumes only proven unsent",async()=>{
  const edge=new Date("2026-10-07T13:59:59.999Z"),member={memberId:"101",name:"Fixture Member",phone:"01000000001",studioId:"5330"};
  const approve=raw=>{const obs=normalizeHoldingObservation(raw);return {confirmed:true,approvedBy:"fixture-human-approval",reason:"Explicit member one-off",
    memberId:member.memberId,memberPhone:member.phone,observationFingerprint:obs.observationFingerprint,creationEvidenceFingerprint:obs.history[2].fingerprint};};
  const tree=await parsed("tests/holding-notice-operator-dispatch.test.mjs");
  const {harness,evidence}=functions(tree,["Store","evidence","harness"],{
    NOW:edge,member,structuredClone,assert,HOLDING_SOURCE,HOLDING_NOTICE_TEMPLATE,HOLDING_NOTICE_TEMPLATE_ID,
    holdingFingerprint,normalizeHoldingObservation,dispatchVerifiedOperatorHolding,
    change:(field,before,after)=>({field,before,after}),
    planFor:raw=>verifiedOperatorHoldingPlan(raw,member,approve(raw),edge),
    template:()=>({...structuredClone(HOLDING_NOTICE_TEMPLATE),templateId:HOLDING_NOTICE_TEMPLATE_ID,status:"APPROVED"}),
  });
  const h=harness(),transact=h.db.runTransaction.bind(h.db);let clock=edge.getTime();
  const preclaim=harness();
  const held=await preclaim.run({now:()=>new Date(clock),readLatest:async()=>{
    clock=Date.parse("2026-10-07T14:00:00.000Z");return evidence();
  }});
  assert.equal(held.status,"deferred");assert.equal(preclaim.posts.length,0);assert.equal(preclaim.db.docs.size,2);
  clock=edge.getTime();
  h.db.runTransaction=async callback=>{const result=await transact(callback);clock=Date.parse("2026-10-07T14:00:00.000Z");return result;};
  assert.equal((await h.run({now:()=>new Date(clock)})).status,"deferred");
  const paths=[`alimtalkCandidates/${h.plan.id}`,`alimtalkSends/${h.plan.id}`,`holdingNoticeClaims/${h.plan.id}`];
  for(const path of paths){const row=h.db.docs.get(path);assert.equal(row.status,"deferred");assert.equal(row.attempts,0);assert.equal(row.dispatchDeferrals.length,1);}
  assert.equal(h.posts.length,0);
  h.db.runTransaction=transact;clock=Date.parse("2026-10-08T00:00:00.000Z");
  const raw={...evidence(),observedAt:new Date(clock).toISOString()};
  const plan=verifiedOperatorHoldingPlan(raw,member,approve(raw),new Date(clock));
  const result=await h.run({plan,readLatest:async({memberId,ticketName})=>{
    assert.equal(memberId,member.memberId);assert.equal(ticketName,raw.ticketName);return raw;
  },now:()=>new Date(clock)});
  assert.equal(result.providerPostCount,1);assert.equal(h.posts.length,1);
  for(const path of paths)assert.equal(h.db.docs.get(path).dispatchDeferrals.length,1);
  await assert.rejects(h.run({plan,readLatest:async()=>raw,now:()=>new Date(clock)}));
  assert.equal(h.posts.length,1);
});

test("a transport that already began is never cleaned up as a harmless quiet defer",async()=>{
  const db=store();let posts=0;
  await assert.rejects(dispatchHoldingNoticeSample({db,stamp:()=>"stamp",confirmed:true,now:()=>DAY,
    recipient:{memberId:"1982133",name:"김기효",phone:"01086488585"},date:"2026-10-22",
    template:{...HOLDING_NOTICE_TEMPLATE,templateId:HOLDING_NOTICE_TEMPLATE_ID,status:"APPROVED"},
    request:async()=>{posts++;throw new MemberDispatchDeferredError(NIGHT);}}));
  assert.equal(posts,1);assert.equal(db.rows.size,2);
  for(const row of db.rows.values())assert.equal(row.status,"failed");
});
