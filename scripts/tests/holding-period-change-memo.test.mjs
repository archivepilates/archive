import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID } from "../lib/holding-allowance-notice.mjs";
import { holdingOperatorNoticeId, holdingPeriodChangeFingerprint } from "../lib/holding-notice-identity.mjs";
import {
  HOLDING_MEMO_POLICY, HOLDING_ACCEPTANCE_MEMO_POLICY, holdingDeliveryMemoPlan,
  holdingMemoAcceptanceFingerprint, enqueueDeliveredHoldingMemo, enqueuePendingHoldingMemos,
  assertHoldingMemoWriteSource, holdingMemoContentPresent, pendingHoldingMemoAlerts, settleHoldingMemoAlert,
} from "../lib/holding-delivery-memo.mjs";

const AT = "2026-10-26T09:00:00.000Z";
const stamp = () => AT;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textHash = value => createHash("sha256").update(value).digest("hex");
const profile = { memberId:"701",studioId:"5330",name:"Synthetic Holding Member",phone:"01000000701" };
const issuanceFingerprint = hash("synthetic-issuance");
const creationEvidenceFingerprint = hash("synthetic-creation");
const identityKeys = ["id","creationEvidenceFingerprint","previousChangeId","changedAt","beforeStart","beforeEnd","start","end"];

function periodChange(patch = {}) {
  const change = { creationEvidenceFingerprint,previousChangeId:creationEvidenceFingerprint,
    changedAt:"2026-10-26T08:00:00.000Z",beforeStart:"2026-11-01",beforeEnd:"2026-11-05",
    start:"2026-11-01",end:"2026-11-10",...patch };
  return {...change,id:holdingPeriodChangeFingerprint(change)};
}

function bindIds(input) {
  const id = holdingOperatorNoticeId(input.send);
  Object.assign(input.send,{id,sendId:id,candidateId:id});
  Object.assign(input.candidate,{id,candidateId:id});
  input.claim.candidateId = id;
}

function receipt(input) {
  const proof = {holdingMemoAcceptedAt:AT,holdingMemoAcceptedMessageId:input.send.solapiMessageId,
    holdingMemoAcceptanceEvidence:"verified_provider_receipt",holdingMemoAcceptanceFingerprint:holdingMemoAcceptanceFingerprint(input.send)};
  Object.assign(input.send,proof);
  Object.assign(input.claim,proof);
}

function source(change = periodChange(), acceptance = false) {
  const start = change?.start ?? "2026-11-01", end = change?.end ?? "2026-11-05";
  const used = (Date.parse(end)-Date.parse(start))/86400000+1;
  const variables = {"#{이름}":profile.name,"#{수강권명}":"Synthetic 120-day Pass",
    "#{홀딩시작일}":start,"#{홀딩종료일}":end,"#{이번홀딩일수}":String(used),
    "#{전체홀딩일수}":"24","#{사용홀딩일수}":String(used),"#{잔여홀딩일수}":String(24-used)};
  const common = {studioId:profile.studioId,memberId:profile.memberId,memberName:profile.name,memberPhone:profile.phone,
    issuanceFingerprint,creationEvidenceFingerprint,observedAt:AT,
    templateCode:HOLDING_NOTICE_TEMPLATE_ID,isTest:false,calculationMode:"live_studiomate_readback",
    payload:{holdingNotice:true,source:"studiomate_live_ticket_readback",deliveryMode:"automatic_live_readback"},
    variables,message:HOLDING_NOTICE_TEMPLATE.content.replace(/#\{[^}]+\}/g,key=>variables[key]),
    summary:{ok:true,originalDays:120,totalDays:24,usedDays:used,remainingDays:24-used,overageDays:0}};
  const input = {
    send:{...structuredClone(common),attempts:1,maxAttempts:1,status:"done",providerStatus:"COMPLETE",providerStatusCode:"4000",
      solapiMessageId:`synthetic-message-${change?.id ?? "original"}`,holdingMemoPolicy:HOLDING_MEMO_POLICY,
      holdingMemoStatus:"ready",holdingMemoRanges:[{start,end}]},
    candidate:{...structuredClone(common),status:"sent"},
    claim:{memberId:profile.memberId,memberPhone:profile.phone,issuanceFingerprint,creationEvidenceFingerprint,status:"delivered",
      solapiMessageId:`synthetic-message-${change?.id ?? "original"}`},
  };
  if (change) {
    const metadata = {noticePurpose:"holding_period_change",changeFingerprint:change.id,
      originalNoticeId:holdingOperatorNoticeId(common),periodChange:change};
    Object.assign(input.send,structuredClone(metadata));
    Object.assign(input.candidate,structuredClone(metadata));
    Object.assign(input.claim,{noticePurpose:metadata.noticePurpose,changeFingerprint:change.id});
  }
  bindIds(input);
  if (acceptance) {
    Object.assign(input.send,{holdingMemoPolicy:HOLDING_ACCEPTANCE_MEMO_POLICY,status:"processing",providerStatus:"SENDING",providerStatusCode:"3000"});
    input.candidate.status="sending";
    input.claim.status="accepted";
    receipt(input);
  }
  return input;
}

const planFor = input => holdingDeliveryMemoPlan(input.send,input.candidate,input.claim);

// Synthetic, serializable transactions stage all writes until the callback succeeds.
class MemoryDb {
  docs = new Map();
  commits = [];
  tail = Promise.resolve();
  failPath = null;
  doc(path) { return {path}; }
  snapshot(path) {
    const row=structuredClone(this.docs.get(path));
    return {id:path.split("/").at(-1),exists:this.docs.has(path),data:()=>structuredClone(row)};
  }
  collection(name) {
    const query=(filters=[],maximum)=>({
      where:(field,op,value)=>query([...filters,{field,op,value}],maximum),
      limit:n=>query(filters,n),
      get:async()=>{
        assert.ok(Number.isSafeInteger(maximum) && maximum>0 && maximum<=10);
        const docs=[...this.docs].filter(([path,row])=>path.startsWith(`${name}/`) &&
          filters.every(({field,op,value})=>op==="in"?value.includes(row[field]):row[field]===value))
          .slice(0,maximum).map(([path])=>this.snapshot(path));
        return {docs,size:docs.length};
      },
    });
    return query();
  }
  async runTransaction(callback) {
    const previous=this.tail;
    let release;
    this.tail=new Promise(resolve=>{release=resolve;});
    await previous;
    const writes=[];
    const stage=(operation,ref,value)=>{
      if(ref.path===this.failPath) throw new Error("synthetic_transaction_failure");
      assert.equal(this.docs.has(ref.path),operation==="update","create must never overwrite");
      writes.push({operation,path:ref.path,value:structuredClone(value)});
    };
    try {
      const result=await callback({
        get:async ref=>{assert.equal(writes.length,0);return this.snapshot(ref.path);},
        create:(ref,value)=>stage("create",ref,value),update:(ref,value)=>stage("update",ref,value),
      });
      for(const {operation,path,value} of writes)
        this.docs.set(path,operation==="update"?{...this.docs.get(path),...value}:value);
      this.commits.push(writes);
      return result;
    } finally { release(); }
  }
}

function store(db,input) {
  for(const [collection,key] of [["alimtalkSends","send"],["alimtalkCandidates","candidate"],["holdingNoticeClaims","claim"]])
    db.docs.set(`${collection}/${input.send.id}`,structuredClone(input[key]));
}
function harness(input = source()) {
  const db=new MemoryDb();
  db.docs.set(`memberProfiles/${profile.memberId}`,structuredClone(profile));
  store(db,input);
  return {db,input,run:()=>enqueueDeliveredHoldingMemo({db,stamp,id:input.send.id})};
}
function records(db,memoId) {
  return {memo:db.docs.get(`memberMemos/${memoId}`),job:db.docs.get(`studiomateMemoWriteJobs/${memoId}`)};
}
const guard=(h,pair)=>assertHoldingMemoWriteSource({...h.input,...pair,
  send:h.db.docs.get(`alimtalkSends/${h.input.send.id}`)});
async function rejectsWithoutWrites(h) {
  const before=structuredClone(h.db.docs),commits=h.db.commits.length;
  await assert.rejects(h.run(),/holding_delivery_memo_source_mismatch/);
  assert.deepEqual(h.db.docs,before);
  assert.equal(h.db.commits.length,commits);
}

test("registration memo paths, exact content and acceptance digest remain byte-compatible",()=>{
  for(const acceptance of [false,true]) {
    const input=source(null,acceptance),s=input.send;
    const oldId=`holding_operator_notice_${hash([s.studioId,s.memberId,s.issuanceFingerprint,s.creationEvidenceFingerprint])}`;
    assert.equal(s.id,oldId);
    assert.equal(holdingMemoAcceptanceFingerprint(s),hash([s.id,s.memberId,s.memberPhone,s.templateCode,s.message,
      Object.entries(s.variables).sort(([a],[b])=>a.localeCompare(b)),s.issuanceFingerprint,s.creationEvidenceFingerprint,s.solapiMessageId]));
    for(const markerFormat of ["compact","legacy"]) {
      const plan=holdingDeliveryMemoPlan(s,input.candidate,input.claim,{markerFormat});
      const memoHash=oldId.slice("holding_operator_notice_".length),memoId=`holding_notice_memo_${memoHash}`;
      const marker=markerFormat==="compact"?`H-${memoHash.slice(0,24)}`:memoId;
      const content=["[홀딩 안내] Synthetic 120-day Pass · 최초 120일권",
        "홀딩 가능 24일 · 사용 5일 (11/1~11/5)","잔여 19일","이번 홀딩: 2026-11-01~2026-11-05","확인일: 2026-10-26",
        ...(acceptance?["알림톡: 발송 접수 (전달 완료 여부와 별도)"]:[]),`[홀딩기록: ${marker}]`].join("\n");
      assert.deepEqual(plan,{memoId,content,contentHash:textHash(content),studioId:s.studioId,memberId:s.memberId,
        memberName:s.memberName,memberPhone:s.memberPhone,holdingNoticeId:oldId,solapiMessageId:s.solapiMessageId,holdingMemoPolicy:s.holdingMemoPolicy});
    }
  }
});

test("change memo uses six-entry identity, unchanged eight-variable template and strict full-content readback",()=>{
  for(const acceptance of [false,true]) {
    const input=source(periodChange(),acceptance),before=structuredClone(input),s=input.send,plan=planFor(input);
    assert.equal(s.id,`holding_operator_notice_${hash([s.studioId,s.memberId,s.issuanceFingerprint,s.creationEvidenceFingerprint,
      "holding_period_change",s.changeFingerprint])}`);
    assert.notEqual(plan.memoId,planFor(source(null,acceptance)).memoId);
    assert.match(plan.memoId,/^holding_notice_memo_[a-f0-9]{64}$/);
    assert.equal(plan.content.split("\n")[0],"[홀딩 안내] Synthetic 120-day Pass · 최초 120일권");
    assert.ok(plan.content.includes("유형: 홀딩 기간 변경"));
    assert.ok(plan.content.includes("기간 변경: 2026-11-01~2026-11-05 -> 2026-11-01~2026-11-10"));
    assert.equal(Object.keys(s.variables).length,8);
    assert.equal(s.message,HOLDING_NOTICE_TEMPLATE.content.replace(/#\{[^}]+\}/g,key=>s.variables[key]));
    assert.equal(holdingMemoContentPresent(`Unrelated memo\n${plan.content}`,plan.content),true);
    for(const removed of ["유형: 홀딩 기간 변경\n","기간 변경: 2026-11-01~2026-11-05 -> 2026-11-01~2026-11-10\n"])
      assert.equal(holdingMemoContentPresent(plan.content.replace(removed,""),plan.content),false);
    assert.equal(holdingMemoContentPresent(plan.content.split("\n").at(-1),plan.content),false);
    assert.deepEqual(input,before);
  }
});

test("change keys and candidate/claim identity mismatches fail without writes",async t=>{
  const mutations=[];
  for(const [record,key] of [["send","id"],["send","sendId"],["send","candidateId"],
    ["candidate","id"],["candidate","candidateId"],["claim","candidateId"],
    ["send","originalNoticeId"],["candidate","originalNoticeId"]])
    mutations.push([`${record} ${key}`,input=>{input[record][key]=`holding_operator_notice_${hash("other-notice")}`;}]);
  for(const record of ["send","candidate","claim"]) for(const key of ["noticePurpose","changeFingerprint"])
    for(const value of [undefined,"synthetic-wrong"])
      mutations.push([`${record} ${key} ${value}`,input=>{input[record][key]=value;}]);
  for(const record of ["send","candidate"]) {
    mutations.push([`${record} missing periodChange`,input=>{delete input[record].periodChange;}]);
    for(const key of identityKeys) mutations.push([`${record} periodChange.${key}`,input=>{
      input[record].periodChange[key]=key.endsWith("Start")||key==="start"?"2026-11-02":
        key.endsWith("End")||key==="end"?"2026-11-09":key==="changedAt"?"2026-10-26T08:01:00.000Z":hash("other");
    }]);
  }
  mutations.push(["claim wrong optional original",input=>{input.claim.originalNoticeId="synthetic-other";}]);
  mutations.push(["claim wrong optional periodChange",input=>{input.claim.periodChange={...input.send.periodChange,beforeEnd:"2026-11-04"};}]);
  for(const acceptance of [false,true]) for(const [label,mutate] of mutations) await t.test(`${acceptance} ${label}`,async()=>{
    const input=source(periodChange(),acceptance);mutate(input);
    assert.throws(()=>planFor(input),/holding_delivery_memo_source_mismatch/);
    await rejectsWithoutWrites(harness(input));
  });
});

test("claims may omit change details but any supplied change identity must match",()=>{
  const input=source();
  assert.equal(Object.hasOwn(input.claim,"periodChange"),false);
  assert.doesNotThrow(()=>planFor(input));
  input.claim.periodChange=structuredClone(input.send.periodChange);
  assert.doesNotThrow(()=>planFor(input));
  input.claim.originalNoticeId=input.send.originalNoticeId;
  assert.doesNotThrow(()=>planFor(input));
});

test("copying fully matching source records under another document key cannot create a memo",async()=>{
  for(const input of [source(),source(periodChange(),true),source(null)]) {
    const h=harness(input),foreignId=`holding_operator_notice_${hash("foreign-document-key")}`;
    for(const [collection,key] of [["alimtalkSends","send"],["alimtalkCandidates","candidate"],["holdingNoticeClaims","claim"]])
      h.db.docs.set(`${collection}/${foreignId}`,structuredClone(input[key]));
    const before=structuredClone(h.db.docs);
    await assert.rejects(enqueueDeliveredHoldingMemo({db:h.db,stamp,id:foreignId}),/holding_delivery_memo_source_mismatch/);
    assert.deepEqual(h.db.docs,before);
    assert.equal(h.db.commits.length,0);
  }
});

test("rekeying cannot authorize a bad change hash, creation anchor or periodChange id",async t=>{
  const mutations=[
    ["unbound hash",input=>{input.send.changeFingerprint=hash("forged-change");input.send.periodChange.id=input.send.changeFingerprint;}],
    ["wrong id",input=>{input.send.periodChange.id=hash("forged-id");}],
    ["foreign creation",input=>{
      input.send.periodChange=periodChange({creationEvidenceFingerprint:hash("foreign-hold")});
      input.send.changeFingerprint=input.send.periodChange.id;
    }],
  ];
  for(const [label,patch] of [
    ["no actual change",{beforeEnd:"2026-11-10"}],
    ["impossible day",{beforeStart:"2026-02-30"}],
    ["reversed before range",{beforeStart:"2026-11-06"}],
    ["noncanonical timestamp",{changedAt:"2026-10-26T17:00:00+09:00"}],
    ["invalid previous change",{previousChangeId:"synthetic-not-a-hash"}],
  ]) mutations.push([label,input=>{
    const change={...input.send.periodChange,...patch};
    // An attacker can recompute the bytes, but invalid canonical evidence must still fail.
    change.id=hash(["holding_period_change_v1",change.creationEvidenceFingerprint,change.previousChangeId,
      change.changedAt,change.beforeStart,change.beforeEnd,change.start,change.end]);
    input.send.periodChange=change;
    input.send.changeFingerprint=change.id;
  }]);
  for(const acceptance of [false,true]) for(const [label,mutate] of mutations) await t.test(`${acceptance} ${label}`,async()=>{
    const input=source(periodChange(),acceptance);mutate(input);
    for(const key of ["changeFingerprint","periodChange"]) input.candidate[key]=structuredClone(input.send[key]);
    input.claim.changeFingerprint=input.send.changeFingerprint;
    bindIds(input);
    if(acceptance) receipt(input);
    await rejectsWithoutWrites(harness(input));
  });
});

test("current message dates must be the changed period even when both ranges and arithmetic are valid",async()=>{
  const input=source(periodChange({start:"2026-11-11",end:"2026-11-20"}));
  for(const row of [input.send,input.candidate]) {
    row.variables["#{홀딩시작일}"]="2026-11-01";
    row.variables["#{홀딩종료일}"]="2026-11-10";
    row.variables["#{사용홀딩일수}"]="20";
    row.variables["#{잔여홀딩일수}"]="4";
    Object.assign(row.summary,{usedDays:20,remainingDays:4});
    row.message=HOLDING_NOTICE_TEMPLATE.content.replace(/#\{[^}]+\}/g,key=>row.variables[key]);
  }
  input.send.holdingMemoRanges.unshift({start:"2026-11-01",end:"2026-11-10"});
  await rejectsWithoutWrites(harness(input));
});

test("acceptance digest binds every change field without depending on Firestore map order",async t=>{
  const input=source(periodChange(),true),expected=holdingMemoAcceptanceFingerprint(input.send);
  for(const key of ["noticePurpose","originalNoticeId","changeFingerprint",...identityKeys.map(key=>`periodChange.${key}`)])
    await t.test(key,()=>{
      const changed=structuredClone(input.send);
      if(key.startsWith("periodChange.")) changed.periodChange[key.slice("periodChange.".length)]="synthetic-tamper";
      else changed[key]="synthetic-tamper";
      assert.notEqual(holdingMemoAcceptanceFingerprint(changed),expected);
    });
  for(const row of [input.send,input.candidate]) {
    row.periodChange=Object.fromEntries(Object.entries(row.periodChange).reverse());
    row.variables=Object.fromEntries(Object.entries(row.variables).reverse());
  }
  assert.equal(holdingMemoAcceptanceFingerprint(input.send),expected);
  const h=harness(input);
  assert.equal((await h.run()).status,"queued");
});

test("stale, original or mismatched provider-acceptance proof cannot authorize a changed memo",async t=>{
  for(const [label,mutate] of [
    ["original proof",input=>{
      const old=source(null,true);
      input.send.holdingMemoAcceptanceFingerprint=old.send.holdingMemoAcceptanceFingerprint;
      input.claim.holdingMemoAcceptanceFingerprint=old.claim.holdingMemoAcceptanceFingerprint;
    }],
    ["claim proof",input=>{input.claim.holdingMemoAcceptanceFingerprint=hash("wrong-proof");}],
    ["claim receipt",input=>{input.claim.holdingMemoAcceptedMessageId="synthetic-other";}],
    ["claim timestamp",input=>{input.claim.holdingMemoAcceptedAt="2026-10-26T09:01:00.000Z";}],
    ["unverified proof",input=>{input.send.holdingMemoAcceptanceEvidence="timeout";}],
    ["missing proof",input=>{delete input.send.holdingMemoAcceptedAt;}],
    ["rekeyed change with stale proof",input=>{
      const change=periodChange({beforeEnd:"2026-11-04"});
      for(const row of [input.send,input.candidate]) Object.assign(row,{periodChange:change,changeFingerprint:change.id});
      input.claim.changeFingerprint=change.id;
      bindIds(input);
    }],
  ]) await t.test(label,async()=>{
    const input=source(periodChange(),true);mutate(input);
    await rejectsWithoutWrites(harness(input));
  });
});

test("change delivery still requires provider completion, recipient, unchanged body, eight variables and full ranges",async t=>{
  for(const [label,mutate] of [
    ["failed delivery",input=>{input.send.providerStatusCode="5000";}],
    ["unsent candidate",input=>{input.candidate.status="pending";}],
    ["unproven claim",input=>{input.claim.status="accepted";}],
    ["recipient",input=>{input.claim.memberPhone="01000000999";}],
    ["changed body",input=>{input.send.message+="\nsynthetic";input.candidate.message=input.send.message;}],
    ["extra variable",input=>{for(const row of [input.send,input.candidate]) row.variables["#{유형}"]="변경";}],
    ["wrong summary",input=>{for(const row of [input.send,input.candidate]) row.summary.usedDays=9;}],
    ["missing ranges",input=>{delete input.send.holdingMemoRanges;}],
    ["overlapping ranges",input=>{input.send.holdingMemoRanges.push({...input.send.holdingMemoRanges[0]});}],
    ["test send",input=>{input.send.isTest=true;}],
    ["wrong source",input=>{input.send.payload.source="member360Cards";input.candidate.payload.source="member360Cards";}],
  ]) await t.test(label,async()=>{
    const input=source();mutate(input);await rejectsWithoutWrites(harness(input));
  });
});

test("change append creates a separate pair and never overwrites original, previous or completed memos",async()=>{
  for(const acceptance of [false,true]) for(const markerFormat of ["compact","legacy"]) {
    const original=source(null,acceptance),h=harness(original),first=await h.run();
    const existing=records(h.db,first.memoId);
    const oldPlan=holdingDeliveryMemoPlan(original.send,original.candidate,original.claim,{markerFormat});
    for(const row of Object.values(existing)) Object.assign(row,{content:oldPlan.content,contentHash:oldPlan.contentHash});
    Object.assign(existing.memo,{syncStatus:"synced",updatedAt:"2026-10-26T09:10:00.000Z"});
    Object.assign(existing.job,{status:"done",attempts:2,lastError:null,writtenAt:"2026-10-26T09:10:00.000Z"});
    const originalBefore=structuredClone(existing),originalSendBefore=structuredClone(h.db.docs.get(`alimtalkSends/${original.send.id}`));
    const changes=[periodChange()];
    changes.push(periodChange({previousChangeId:changes[0].id,changedAt:"2026-10-26T08:30:00.000Z",
      beforeEnd:changes[0].end,start:"2026-11-02",end:"2026-11-11"}));
    const ids=new Set([first.memoId]);
    for(const change of changes) {
      const prior=structuredClone(h.db.docs);
      const input=source(change,acceptance);store(h.db,input);
      const run=()=>enqueueDeliveredHoldingMemo({db:h.db,stamp,id:input.send.id});
      const results=await Promise.all([run(),run(),run()]);
      assert.deepEqual(results.map(row=>row.status).sort(),["existing","existing","queued"]);
      for(const [path,row] of prior) assert.deepEqual(h.db.docs.get(path),row,"older records must be immutable");
      const memoId=results[0].memoId;
      assert.equal(ids.has(memoId),false);ids.add(memoId);
      const pair=records(h.db,memoId);
      assert.equal(pair.memo.noticePurpose,"holding_period_change");
      assert.equal(pair.job.changeFingerprint,change.id);
      assert.equal(pair.job.status,"pending");
      assert.equal(pair.job.attempts,0);
      assert.equal(assertHoldingMemoWriteSource({...input,...pair,send:h.db.docs.get(`alimtalkSends/${input.send.id}`)}).memoId,memoId);
      Object.assign(pair.job,{status:"retry",attempts:2,lastError:"synthetic-retry"});
      pair.memo.syncStatus="retry";
      const before=structuredClone(h.db.docs);
      assert.equal((await run()).status,"existing");
      assert.deepEqual(h.db.docs,before);
    }
    assert.equal([...h.db.docs.keys()].filter(path=>path.startsWith("memberMemos/")).length,3);
    assert.equal([...h.db.docs.keys()].filter(path=>path.startsWith("studiomateMemoWriteJobs/")).length,3);
    assert.deepEqual(records(h.db,first.memoId),originalBefore);
    assert.deepEqual(h.db.docs.get(`alimtalkSends/${original.send.id}`),originalSendBefore);
  }
});

test("partial and rehashed tampered change pairs block without healing or overwriting",async t=>{
  for(const record of ["memo","job"]) for(const field of ["missing","content","noticePurpose","originalNoticeId","changeFingerprint",...identityKeys])
    await t.test(`${record} ${field}`,async()=>{
      const h=harness(),{memoId}=await h.run(),pair=records(h.db,memoId),row=pair[record];
      if(field==="missing") {
        h.db.docs.delete(`${record==="memo"?"memberMemos":"studiomateMemoWriteJobs"}/${memoId}`);
        delete pair[record];
      } else if(field==="content") {
        row.content=row.content.replace("11-05 ->","11-04 ->");
        row.contentHash=textHash(row.content);
      } else if(identityKeys.includes(field)) row.periodChange[field]="synthetic-tamper";
      else row[field]="synthetic-tamper";
      assert.throws(()=>guard(h,pair));
      await rejectsWithoutWrites(h);
    });
});

test("transaction failure cannot leave a half-created change memo or downstream job",async()=>{
  const h=harness(),plan=planFor(h.input),before=structuredClone(h.db.docs);
  h.db.failPath=`studiomateMemoWriteJobs/${plan.memoId}`;
  await assert.rejects(h.run(),/synthetic_transaction_failure/);
  assert.deepEqual(h.db.docs,before);
  h.db.failPath=null;
  assert.equal((await h.run()).status,"queued");
});

test("unchanged ready-scan and alert prefixes accept change ids and quarantine invalid change evidence",async()=>{
  const valid=source(),invalid=source(periodChange({beforeEnd:"2026-11-04"}));
  invalid.claim.changeFingerprint=hash("wrong-claim");
  const h=harness(valid);store(h.db,invalid);
  const outcomes=await enqueuePendingHoldingMemos({db:h.db,stamp,limit:2});
  assert.equal(outcomes.find(row=>row.id===valid.send.id).status,"queued");
  assert.equal(outcomes.find(row=>row.id===invalid.send.id).status,"review");
  const alerts=await pendingHoldingMemoAlerts(h.db);
  assert.equal(alerts.length,1);assert.equal(alerts[0].id,invalid.send.id);
  const observed=structuredClone(h.db.docs.get(`alimtalkSends/${invalid.send.id}`));
  assert.equal(await settleHoldingMemoAlert({db:h.db,stamp,id:invalid.send.id,observed,status:"sent"}),true);
  assert.deepEqual(await pendingHoldingMemoAlerts(h.db),[]);
  assert.equal(h.db.docs.get(`alimtalkSends/${invalid.send.id}`).providerStatus,"COMPLETE");
});
