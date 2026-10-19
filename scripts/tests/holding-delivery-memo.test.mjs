import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID } from "../lib/holding-allowance-notice.mjs";
import {
  HOLDING_MEMO_POLICY, holdingDeliveryMemoPlan, enqueueDeliveredHoldingMemo,
  enqueuePendingHoldingMemos, assertHoldingMemoWriteSource,
  holdingMemoContentPresent,
  assertHoldingMemoMemberProfile,
  pendingHoldingMemoAlerts,
  settleHoldingMemoAlert,
  HOLDING_ACCEPTANCE_MEMO_POLICY, holdingMemoAcceptanceFingerprint,
} from "../lib/holding-delivery-memo.mjs";
import { continueMemberOperation } from "../lib/member-operation-service.mjs";

const AT = "2026-10-19T10:00:00.000Z";
const stamp = () => AT;
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const profile = { memberId: "701", studioId: "5330", name: "Synthetic Holding Member", phone: "01000000701" };

for (const [label,body,expected] of [
  ["full content", "[홀딩 안내] 테스트\n잔여 9일\n[홀딩기록: holding_notice_memo_abc]", true],
  ["changed calculation", "[홀딩 안내] 테스트\n잔여 8일\n[홀딩기록: holding_notice_memo_abc]", false],
  ["partial content", "[홀딩 안내] 테스트\n[홀딩기록: holding_notice_memo_abc]", false],
  ["different event", "[홀딩 안내] 테스트\n잔여 9일\n[홀딩기록: holding_notice_memo_xyz]", false],
]) test(`StudioMate memo readback requires exact calculation and event: ${label}`,()=>{
  assert.equal(holdingMemoContentPresent(body,"[홀딩 안내] 테스트\n잔여 9일\n[홀딩기록: holding_notice_memo_abc]"),expected);
});

function source(seed = "first") {
  const issuanceFingerprint = fingerprint(["synthetic-issuance", seed]);
  const creationEvidenceFingerprint = fingerprint(["synthetic-hold", seed]);
  const id = `holding_operator_notice_${fingerprint([profile.studioId, profile.memberId, issuanceFingerprint, creationEvidenceFingerprint])}`;
  const variables = {
    "#{이름}": profile.name, "#{수강권명}": "Synthetic 120-day Pass",
    "#{홀딩시작일}": "2026-09-16", "#{홀딩종료일}": "2026-09-30",
    "#{이번홀딩일수}": "15", "#{전체홀딩일수}": "24", "#{사용홀딩일수}": "15", "#{잔여홀딩일수}": "9",
  };
  const common = {
    id, candidateId: id, memberId: profile.memberId, memberName: profile.name, memberPhone: profile.phone,
    studioId: profile.studioId, issuanceFingerprint, creationEvidenceFingerprint,
    observationFingerprint: fingerprint(["synthetic-observation", seed]), observedAt: AT,
    sourceDate: "2026-09-16", templateCode: HOLDING_NOTICE_TEMPLATE_ID, isTest: false,
    calculationMode: "live_studiomate_readback", attempts: 1, maxAttempts: 1,
    payload: { holdingNotice: true, source: "studiomate_live_ticket_readback", deliveryMode: "automatic_live_readback" },
    summary: { ok: true, originalDays: 120, totalDays: 24, usedDays: 15, remainingDays: 9, overageDays: 0 },
    variables, message: HOLDING_NOTICE_TEMPLATE.content.replace(/#\{[^}]+\}/g, key => variables[key]),
  };
  return {
    send: { ...structuredClone(common), sendId: id, status: "done", providerStatus: "COMPLETE", providerStatusCode: "4000",
      solapiMessageId: `synthetic-message-${seed}`, holdingMemoPolicy: HOLDING_MEMO_POLICY, holdingMemoStatus: "ready",
      holdingMemoRanges: [{ start: "2026-09-16", end: "2026-09-30" }] },
    candidate: { ...structuredClone(common), status: "sent" },
    claim: { candidateId: id, memberId: profile.memberId, memberPhone: profile.phone,
      issuanceFingerprint, creationEvidenceFingerprint, status: "delivered", solapiMessageId: `synthetic-message-${seed}` },
  };
}

const planFor = ({ send, candidate, claim }) => holdingDeliveryMemoPlan(send, candidate, claim);

function acceptanceSource(seed = "accepted") {
  const input = source(seed);
  Object.assign(input.send, { holdingMemoPolicy: HOLDING_ACCEPTANCE_MEMO_POLICY,
    providerStatus: "SENDING", providerStatusCode: "3000", providerOutcome: "accepted_verified" });
  const proof = { holdingMemoAcceptedAt: AT, holdingMemoAcceptedMessageId: input.send.solapiMessageId,
    holdingMemoAcceptanceEvidence: "verified_provider_receipt", holdingMemoAcceptanceFingerprint: holdingMemoAcceptanceFingerprint(input.send) };
  Object.assign(input.send, proof);
  Object.assign(input.claim, proof, {status:"accepted"});
  return input;
}

// Serialized transactions stage all writes; aborts cannot leak a half-created memo/job pair.
class MemoryDb {
  docs = new Map();
  reads = [];
  queries = [];
  commits = [];
  tail = Promise.resolve();
  failPath = null;

  doc(path) {
    return { path, id: path.split("/").at(-1), get: async () => this.read({ path }) };
  }

  snapshot(path) {
    const value = structuredClone(this.docs.get(path));
    return { id: path.split("/").at(-1), ref: this.doc(path), exists: this.docs.has(path), data: () => structuredClone(value) };
  }

  collection(name) {
    const query = (filters = [], maximum, order = []) => ({
      query: true, name, filters, maximum, order,
      doc: id => this.doc(`${name}/${id}`),
      where: (field, operator, value) => query([...filters, { field, operator, value }], maximum, order),
      limit: n => {
        assert.ok(Number.isSafeInteger(n) && n > 0, "queries must use a positive integer bound");
        return query(filters, n, order);
      },
      orderBy: (field, direction = "asc") => query(filters, maximum, [...order, { field, direction }]),
      get: async () => this.read({ query: true, name, filters, maximum, order }),
    });
    return query();
  }

  read(ref) {
    this.reads.push(ref.query ? { collection: ref.name, filters: structuredClone(ref.filters) } : { path: ref.path });
    if (!ref.query) return this.snapshot(ref.path);
    assert.ok(Number.isSafeInteger(ref.maximum) && ref.maximum > 0, "unbounded collection scans are forbidden");
    this.queries.push(ref);
    let rows = [...this.docs].filter(([path]) => path.startsWith(`${ref.name}/`) && path.split("/").length === 2);
    for (const { field, operator, value } of ref.filters) {
      assert.ok(["==", "in"].includes(operator), `unsupported query operator: ${operator}`);
      rows = rows.filter(([, row]) => operator === "==" ? row[field] === value : value.includes(row[field]));
    }
    for (const { field, direction } of [...ref.order].reverse()) {
      rows.sort((a, b) => (a[1][field] < b[1][field] ? -1 : a[1][field] > b[1][field] ? 1 : 0) * (direction === "desc" ? -1 : 1));
    }
    const docs = rows.slice(0, ref.maximum).map(([path]) => this.snapshot(path));
    return { docs, size: docs.length, empty: docs.length === 0, forEach: callback => docs.forEach(callback) };
  }

  async runTransaction(callback) {
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    const writes = [];
    const stage = (operation, ref, value, options) => {
      if (ref.path === this.failPath) throw new Error("synthetic_transaction_failure");
      if (operation === "create") assert.equal(this.docs.has(ref.path), false, "create must not overwrite an existing record");
      if (operation === "update") assert.equal(this.docs.has(ref.path), true, "update requires an existing record");
      writes.push({ operation, path: ref.path, value: structuredClone(value), options });
    };
    try {
      const result = await callback({
        get: async ref => {
          assert.equal(writes.length, 0, "Firestore transactions require every read before the first write");
          return this.read(ref);
        },
        getAll: async (...refs) => {
          assert.equal(writes.length, 0, "Firestore transactions require every read before the first write");
          return refs.map(ref => this.read(ref));
        },
        create: (ref, value) => stage("create", ref, value),
        update: (ref, value) => stage("update", ref, value),
        set: (ref, value, options) => stage("set", ref, value, options),
      });
      for (const { operation, path, value, options } of writes) {
        this.docs.set(path, operation === "update" || options?.merge ? { ...this.docs.get(path), ...value } : value);
      }
      this.commits.push(writes);
      return result;
    } finally {
      release();
    }
  }
}

function harness(input = source()) {
  const db = new MemoryDb();
  db.docs.set(`alimtalkSends/${input.send.id}`, structuredClone(input.send));
  db.docs.set(`alimtalkCandidates/${input.send.id}`, structuredClone(input.candidate));
  db.docs.set(`holdingNoticeClaims/${input.send.id}`, structuredClone(input.claim));
  db.docs.set(`memberProfiles/${profile.memberId}`, structuredClone(profile));
  return { db, input, run: () => enqueueDeliveredHoldingMemo({ db, stamp, id: input.send.id }) };
}

const pairPaths = memoId => [`memberMemos/${memoId}`, `studiomateMemoWriteJobs/${memoId}`];
const pair = (db, memoId) => {
  const [memoPath, jobPath] = pairPaths(memoId);
  assert.ok(db.docs.has(memoPath), "canonical member memo must exist");
  assert.ok(db.docs.has(jobPath), "downstream write job must exist");
  return { memo: db.docs.get(memoPath), job: db.docs.get(jobPath) };
};
const guard = (h, records) => assertHoldingMemoWriteSource({ ...h.input,
  send:structuredClone(h.db.docs.get(`alimtalkSends/${h.input.send.id}`)), ...records });

async function rejectsWithoutWrites(h) {
  const before = structuredClone(h.db.docs);
  const committedBefore = h.db.commits.length;
  await assert.rejects(h.run());
  assert.deepEqual(h.db.docs, before, "invalid source must not mutate any record");
  assert.ok(h.db.commits.slice(committedBefore).every(writes => writes.length === 0));
}

test("planner uses the opt-in policy and deterministic delivered-source identity", () => {
  assert.equal(HOLDING_MEMO_POLICY, "holding_delivery_memo_v1");
  const input = source(), before = structuredClone(input), plan = planFor(input);
  assert.deepEqual(input, before, "planning must not mutate source records");
  assert.deepEqual(planFor(structuredClone(input)), plan);
  for (const key of ["memberId", "memberName", "memberPhone", "studioId", "solapiMessageId"]) assert.equal(plan[key], input.send[key]);
  assert.equal(plan.holdingNoticeId, input.send.id);
  assert.ok(typeof plan.memoId === "string" && plan.memoId.length > 0 && !plan.memoId.includes("/"));
  assert.equal(plan.contentHash, createHash("sha256").update(plan.content).digest("hex"));
  assert.notEqual(planFor(source("second")).memoId, plan.memoId, "separate stable sends must not share a memo");
});

test("new acceptance policy queues a memo without terminal delivery and labels it only accepted", async () => {
  const h = harness(acceptanceSource());
  const outcome = await continueMemberOperation({db:h.db,stamp,kind:"holding",operationId:h.input.send.id});
  assert.equal(outcome.status,"queued");
  const records = pair(h.db,outcome.memoId);
  assert.match(records.memo.content,/알림톡: 발송 접수/);
  assert.doesNotMatch(records.memo.content,/알림톡: 전달 완료/);
  assert.equal(records.memo.holdingMemoPolicy,HOLDING_ACCEPTANCE_MEMO_POLICY);
  guard(h,records);
  assert.equal(h.db.docs.get(`alimtalkSends/${h.input.send.id}`).providerStatus,"SENDING");
});

test("acceptance fingerprint survives Firestore map ordering and later provider failure", async () => {
  const input=acceptanceSource();
  input.send.variables=Object.fromEntries(Object.entries(input.send.variables).reverse());
  input.candidate.variables=structuredClone(input.send.variables);
  Object.assign(input.send,{providerStatus:"COMPLETE",providerStatusCode:"5000",providerOutcome:"delivery_failed",status:"failed"});
  input.claim.status="reconciliation_required";
  input.candidate.status="failed";
  const h=harness(input),outcome=await h.run();
  assert.equal(outcome.status,"queued");
  guard(h,pair(h.db,outcome.memoId));
  assert.equal(h.db.docs.get(`alimtalkSends/${input.send.id}`).providerStatusCode,"5000");
});

test("acceptance cannot be inferred from a message ID or mutable accepted status",async t=>{
  for(const [name,mutate] of [
    ["missing proof",s=>{delete s.send.holdingMemoAcceptedAt;}],
    ["different timestamp",s=>{s.claim.holdingMemoAcceptedAt="2026-10-19T10:01:00Z";}],
    ["wrong receipt",s=>{s.send.holdingMemoAcceptedMessageId="other-message";}],
    ["changed digest",s=>{s.send.holdingMemoAcceptanceFingerprint="0".repeat(64);} ],
    ["missing claim proof",s=>{delete s.claim.holdingMemoAcceptanceFingerprint;}],
    ["unverified origin",s=>{s.send.holdingMemoAcceptanceEvidence="post_timeout";}],
    ["claim unverified origin",s=>{delete s.claim.holdingMemoAcceptanceEvidence;}],
  ])await t.test(name,async()=>{const input=acceptanceSource(name);mutate(input);await rejectsWithoutWrites(harness(input));});
});

test("acceptance projection is atomic and preserves an existing completed memo on repeated/concurrent calls",async()=>{
  const h=harness(acceptanceSource("repeat"));
  const results=await Promise.all([h.run(),h.run()]);
  assert.deepEqual(results.map(r=>r.status).sort(),["existing","queued"]);
  const id=results[0].memoId, records=pair(h.db,id);
  records.job.status="done";records.job.attempts=2;records.memo.syncStatus="synced";
  const before=structuredClone(records);
  await h.run();
  assert.deepEqual(pair(h.db,id),before);
});

test("common processor rejects other operation kinds and arbitrary paths before reading",async()=>{
  for(const [kind,operationId] of [["refund","abc"],["holding","../secret"],["send","holding_operator_notice_"+"a".repeat(64)]]){
    const h=harness();
    await assert.rejects(continueMemberOperation({db:h.db,stamp,kind,operationId}),/unsupported/);
    assert.deepEqual(h.db.reads,[]);
  }
});

test("full memo shows original allowance, inclusive usage range, remaining days, check date and one final source marker", () => {
  const input = source(), plan = planFor(input);
  const compact = plan.content.replace(/\s+/g, "");
  assert.match(compact, /최초[^\n]*120일/);
  assert.match(compact, /(?:총|홀딩가능)24일/);
  assert.match(compact, /사용[^\n]*15일/);
  assert.match(compact, /(?:2026[-/.])?0?9[/.]16~(?:2026[-/.])?0?9[/.]30/);
  assert.match(compact, /잔여[^\n]*9일/);
  assert.match(compact, /확인일(?:[:：])?(?:2026[-/.])?10[-/.]19/);
  const lines = plan.content.trimEnd().split("\n"), marker = lines.at(-1);
  assert.ok(marker.includes(input.send.id) || marker.includes(plan.memoId), "last line must identify this stable source or memo");
  assert.equal(lines.filter(line => line === marker).length, 1, "source marker must appear exactly once");
  assert.notEqual(planFor(source("second")).content.trimEnd().split("\n").at(-1), marker);
});

test("automatic and operator-verified delivered notices are both eligible", () => {
  for (const deliveryMode of ["automatic_live_readback", "operator_verified_one_off"]) {
    const input = source();
    input.send.payload.deliveryMode = deliveryMode;
    input.candidate.payload.deliveryMode = deliveryMode;
    assert.ok(planFor(input).memoId);
  }
});

test("summary arithmetic is revalidated instead of trusting a stored ok flag", async t => {
  for (const [label, patch] of [
    ["failed calculation", { ok: false }], ["allowance not twenty percent", { totalDays: 25, remainingDays: 10 }],
    ["wrong remaining", { remainingDays: 10 }], ["wrong used days", { usedDays: 14, remainingDays: 10 }],
    ["wrong overage", { overageDays: 1 }], ["negative usage", { usedDays: -1, remainingDays: 25 }],
    ["fractional period", { originalDays: 120.5 }], ["zero original period", { originalDays: 0 }],
    ["string allowance", { totalDays: "24" }], ["missing usage", { usedDays: undefined }],
  ]) await t.test(label, () => {
    const input = source();
    Object.assign(input.send.summary, patch);
    Object.assign(input.candidate.summary, patch);
    assert.throws(() => planFor(input));
  });
});

test("missing, impossible, reversed, overlapping or arithmetically incomplete ranges are forbidden", async t => {
  for (const [label, ranges] of [
    ["missing", undefined], ["empty", []], ["not an array", {}], ["null range", [null]],
    ["impossible date", [{ start: "2026-02-30", end: "2026-03-16" }]],
    ["non-leap February", [{ start: "2026-02-29", end: "2026-03-15" }]],
    ["non-ISO date", [{ start: "9/16", end: "9/30" }]],
    ["missing end", [{ start: "2026-09-16" }]],
    ["reversed", [{ start: "2026-09-30", end: "2026-09-16" }]],
    ["wrong inclusive duration", [{ start: "2026-09-17", end: "2026-09-30" }]],
    ["duplicate", [{ start: "2026-09-16", end: "2026-09-30" }, { start: "2026-09-16", end: "2026-09-30" }]],
    ["overlapping boundary", [{ start: "2026-09-16", end: "2026-09-23" }, { start: "2026-09-23", end: "2026-09-30" }]],
    ["current hold absent", [{ start: "2026-08-16", end: "2026-08-30" }]],
  ]) await t.test(label, () => {
    const input = source(); input.send.holdingMemoRanges = ranges;
    assert.throws(() => planFor(input));
  });
});

test("each current template variable must agree with source identity, dates and arithmetic", async t => {
  for (const [key, bad] of [
    ["#{이름}", "Synthetic Other Member"], ["#{수강권명}", ""],
    ["#{홀딩시작일}", "2026-09-17"], ["#{홀딩종료일}", "2026-09-29"],
    ["#{이번홀딩일수}", "14"], ["#{전체홀딩일수}", "25"], ["#{사용홀딩일수}", "14"], ["#{잔여홀딩일수}", "10"],
  ]) await t.test(key, () => {
    const input = source();
    input.send.variables[key] = bad;
    input.candidate.variables[key] = bad;
    assert.throws(() => planFor(input));
  });
  for (const key of Object.keys(source().send.variables)) await t.test(`missing ${key}`, () => {
    const input = source(); delete input.send.variables[key]; delete input.candidate.variables[key];
    assert.throws(() => planFor(input));
  });
});

const forbiddenSources = [
  ["pending send", x => { x.send.status = "processing"; }],
  ["failed send", x => { x.send.status = "failed"; }],
  ["pending provider", x => { x.send.providerStatus = "SENDING"; x.send.providerStatusCode = "2000"; }],
  ["failed provider", x => { x.send.providerStatus = "FAILED"; x.send.providerStatusCode = "3000"; }],
  ["unknown provider", x => { delete x.send.providerStatus; }],
  ["wrong completion code", x => { x.send.providerStatusCode = "2000"; }],
  ["missing receipt", x => { delete x.send.solapiMessageId; }],
  ["unsent candidate", x => { x.candidate.status = "processing"; }],
  ["failed candidate", x => { x.candidate.status = "failed"; }],
  ["accepted claim", x => { x.claim.status = "accepted"; }],
  ["unknown claim", x => { x.claim.status = "reconciliation_required"; }],
  ["different claim receipt", x => { x.claim.solapiMessageId = "synthetic-other-receipt"; }],
  ["sample send", x => { x.send.isTest = true; }],
  ["missing test marker", x => { delete x.send.isTest; }],
  ["sample delivery mode", x => { x.send.payload.deliveryMode = "test"; }],
  ["not a holding notice", x => { x.send.payload.holdingNotice = false; }],
  ["mirror source", x => { x.send.payload.source = "member360Cards"; }],
  ["snapshot calculation", x => { x.send.calculationMode = "saved_snapshot"; }],
  ["old template", x => { x.send.templateCode = "KA01TP261006054728079NtSGrYdtSQH"; }],
  ["multiple send attempts", x => { x.send.attempts = 2; }],
  ["retries enabled", x => { x.send.maxAttempts = 3; }],
  ["invalid observation date", x => { x.send.observedAt = "2026-02-30T10:00:00.000Z"; }],
  ["missing observation", x => { delete x.send.observedAt; }],
];

test("pending, failed, unknown, sample and unsupported sources never plan or create memos", async t => {
  for (const [label, mutate] of forbiddenSources) await t.test(label, async () => {
    const input = source(); mutate(input);
    assert.throws(() => planFor(input));
    await rejectsWithoutWrites(harness(input));
  });
});

test("source, candidate and claim identities must match the exact canonical send", async t => {
  for (const [label, mutate] of [
    ["send id", x => { x.send.id += "_other"; }],
    ["send candidate id", x => { x.send.candidateId += "_other"; }],
    ["send send id", x => { x.send.sendId += "_other"; }],
    ["send issuance", x => { x.send.issuanceFingerprint = fingerprint("other"); }],
    ["send creation", x => { x.send.creationEvidenceFingerprint = fingerprint("other"); }],
    ["fallback member", x => { x.send.memberId = "excel_synthetic_701"; }],
    ["candidate document id", x => { x.candidate.id += "_other"; }],
    ["candidate source id", x => { x.candidate.candidateId += "_other"; }],
    ...["memberId", "memberName", "memberPhone", "studioId", "issuanceFingerprint", "creationEvidenceFingerprint"].map(key =>
      [`candidate ${key}`, x => { x.candidate[key] = `other-${x.candidate[key]}`; }]),
    ...["candidateId", "memberId", "memberPhone", "issuanceFingerprint", "creationEvidenceFingerprint"].map(key =>
      [`claim ${key}`, x => { x.claim[key] = `other-${x.claim[key]}`; }]),
    ["candidate variables", x => { x.candidate.variables["#{수강권명}"] = "Synthetic Different Pass"; }],
  ]) await t.test(label, async () => {
    const input = source(); mutate(input);
    assert.throws(() => planFor(input));
    await rejectsWithoutWrites(harness(input));
  });
});

test("missing or different opt-in policy returns not_enabled without backfilling historical sends", async t => {
  for (const policy of [undefined, null, "", "holding_delivery_memo_v0"]) await t.test(String(policy), async () => {
    const input = source(); input.send.holdingMemoPolicy = policy;
    assert.throws(() => planFor(input));
    const h = harness(input), before = structuredClone(h.db.docs);
    assert.equal((await h.run()).status, "not_enabled");
    assert.deepEqual(h.db.docs, before);
    assert.ok(h.db.commits.every(writes => writes.length === 0));
  });
});

test("enqueue atomically creates the canonical memo and same-key pending StudioMate job", async () => {
  const h = harness(), plan = planFor(h.input), result = await h.run();
  assert.deepEqual(result, { status: "queued", memoId: plan.memoId });
  const records = pair(h.db, plan.memoId);
  assert.equal(records.memo.memoId, plan.memoId);
  assert.equal(records.memo.syncStatus, "pending");
  assert.equal(records.job.jobId, plan.memoId);
  assert.equal(records.job.status, "pending");
  assert.equal(records.job.attempts, 0);
  for (const record of Object.values(records)) {
    assert.equal(record.content, plan.content);
    assert.equal(record.memberId, profile.memberId);
    assert.equal(record.studioId, profile.studioId);
  }
  assert.doesNotThrow(() => guard(h, records));
  const creation = h.db.commits.filter(writes => pairPaths(plan.memoId).some(path => writes.some(write => write.path === path)));
  assert.equal(creation.length, 1);
  for (const path of pairPaths(plan.memoId)) assert.ok(creation[0].some(write => write.path === path));
  assert.ok(h.db.reads.some(read => read.path === `memberProfiles/${profile.memberId}`));
  const allowed = new Set([...pairPaths(plan.memoId), `alimtalkSends/${h.input.send.id}`]);
  assert.ok(h.db.commits.flat().every(write => allowed.has(write.path)), "enqueue must not modify profiles, candidates, claims or other jobs");
});

test("a transaction failure leaves neither member memo nor downstream job and retry creates the pair once", async () => {
  const h = harness(), plan = planFor(h.input), before = structuredClone(h.db.docs);
  h.db.failPath = pairPaths(plan.memoId)[1];
  await assert.rejects(h.run(), /synthetic_transaction_failure/);
  assert.deepEqual(h.db.docs, before);
  assert.equal(h.db.commits.length, 0);
  h.db.failPath = null;
  assert.equal((await h.run()).status, "queued");
  pair(h.db, plan.memoId);
});

test("enqueue requires the canonical numeric member profile and exact identity", async t => {
  for (const [label, mutate] of [
    ["missing profile", db => db.docs.delete(`memberProfiles/${profile.memberId}`)],
    ...["memberId", "studioId", "name", "phone"].map(key =>
      [`wrong ${key}`, db => { db.docs.get(`memberProfiles/${profile.memberId}`)[key] = "synthetic-other"; }]),
  ]) await t.test(label, async () => {
    const h = harness(); mutate(h.db); await rejectsWithoutWrites(h);
  });
});

test("repeat and concurrent enqueue calls produce one pair with a stable memo id", async () => {
  const h = harness(), results = await Promise.all(Array.from({ length: 4 }, () => h.run()));
  assert.equal(results.filter(result => result.status === "queued").length, 1);
  assert.equal(results.filter(result => result.status === "existing").length, 3);
  const memoId = results[0].memoId;
  assert.ok(results.every(result => result.memoId === memoId));
  assert.equal([...h.db.docs.keys()].filter(path => path.startsWith("memberMemos/")).length, 1);
  assert.equal([...h.db.docs.keys()].filter(path => path.startsWith("studiomateMemoWriteJobs/")).length, 1);
  const before = structuredClone(h.db.docs);
  assert.deepEqual(await h.run(), { status: "existing", memoId });
  assert.deepEqual(h.db.docs, before);
});

test("existing done/retry jobs and memo sync state never have attempts, errors or timestamps reset", async t => {
  for (const [status, syncStatus] of [["done", "synced"], ["retry", "retry"]]) await t.test(status, async () => {
    const h = harness(), { memoId } = await h.run(), { memo, job } = pair(h.db, memoId);
    Object.assign(job, { status, attempts: 2, maxAttempts: 3, lastError: status === "retry" ? "synthetic_retry" : null,
      updatedAt: "2026-10-19T11:00:00.000Z", writtenAt: status === "done" ? "2026-10-19T11:00:00.000Z" : null });
    Object.assign(memo, { syncStatus, updatedAt: "2026-10-19T11:00:00.000Z", syncError: job.lastError });
    const before = structuredClone(h.db.docs);
    const results = await Promise.all([h.run(), h.run()]);
    assert.ok(results.every(result => result.status === "existing" && result.memoId === memoId));
    assert.deepEqual(h.db.docs, before);
  });
});

test("partial memo/job pairs block without healing, resetting or overwriting either record", async t => {
  for (const missing of ["memberMemos", "studiomateMemoWriteJobs"]) await t.test(missing, async () => {
    const h = harness(), { memoId } = await h.run();
    h.db.docs.delete(`${missing}/${memoId}`);
    await rejectsWithoutWrites(h);
  });
});

test("worker accepts an untouched pair but blocks content and identity metadata tampering", async t => {
  const h = harness(), { memoId } = await h.run(), original = structuredClone(pair(h.db, memoId));
  assert.doesNotThrow(() => guard(h, original));
  for (const recordName of ["memo", "job"]) {
    for (const [key, value] of [
      ["content", `${original[recordName].content}\nSynthetic tamper`],
      ["memberId", "702"], ["studioId", "9001"], ["memberName", "Synthetic Other Member"],
      [recordName === "memo" ? "memoId" : "jobId", "synthetic-other-key"],
    ]) await t.test(`${recordName} ${key}`, () => {
      const records = structuredClone(original); records[recordName][key] = value;
      assert.throws(() => guard(h, records));
    });
  }
  for (const recordName of ["memo", "job"]) {
    const keys = ["contentHash", "holdingNoticeId", "solapiMessageId", "source", "holdingMemoPolicy",
      ...(recordName === "job" ? ["memberPhone", "studiomateMemberId"] : [])];
    for (const key of keys) {
      await t.test(`${recordName} metadata ${key}`, () => {
        assert.ok(Object.hasOwn(original[recordName], key), `persisted ${recordName} must bind ${key}`);
        const records = structuredClone(original); records[recordName][key] = "synthetic-tampered";
        assert.throws(() => guard(h, records));
      });
    }
  }
  for (const [label, mutate] of forbiddenSources) await t.test(`worker source ${label}`, () => {
    const changed = structuredClone(h.input); changed.send.holdingMemoStatus="queued"; mutate(changed);
    assert.throws(() => assertHoldingMemoWriteSource({ ...changed, ...structuredClone(original) }));
  });
  for (const missing of ["memo", "job", "send", "candidate", "claim"]) await t.test(`missing ${missing}`, () => {
    assert.throws(() => assertHoldingMemoWriteSource({ ...h.input, ...structuredClone(original), [missing]: undefined }));
  });
  for (const recordName of ["memo", "job"]) await t.test(`${recordName} missing final source marker`, () => {
    const records = structuredClone(original);
    records[recordName].content = records[recordName].content.split("\n").slice(0, -1).join("\n");
    records[recordName].contentHash = createHash("sha256").update(records[recordName].content).digest("hex");
    assert.throws(() => guard(h, records), "even rehashing content must not authorize a missing source marker");
  });
  for (const key of ["profileUpdate", "registrationId"]) await t.test(`unrelated job capability ${key}`, () => {
    const records = structuredClone(original); records.job[key] = key === "profileUpdate" ? {} : "synthetic-registration";
    assert.throws(() => guard(h, records));
  });
});

test("existing pair metadata conflicts are rejected instead of silently reported existing", async t => {
  for (const recordName of ["memo", "job"]) {
    for (const key of ["content", "memberId", "studioId"]) await t.test(`${recordName} ${key}`, async () => {
      const h = harness(), { memoId } = await h.run();
      pair(h.db, memoId)[recordName][key] = "synthetic-tampered";
      await rejectsWithoutWrites(h);
    });
  }
});

test("bounded ready scan excludes unmarked or already queued sends and honors an explicit limit", async () => {
  const h = harness(source("ready-1"));
  for (const seed of ["ready-2", "ready-3", "legacy", "already-queued"]) {
    const input = source(seed);
    if (seed === "legacy") delete input.send.holdingMemoPolicy;
    if (seed === "already-queued") input.send.holdingMemoStatus = "queued";
    h.db.docs.set(`alimtalkSends/${input.send.id}`, input.send);
    h.db.docs.set(`alimtalkCandidates/${input.send.id}`, input.candidate);
    h.db.docs.set(`holdingNoticeClaims/${input.send.id}`, input.claim);
  }
  const outcomes = await enqueuePendingHoldingMemos({ db: h.db, stamp, limit: 2 });
  assert.ok(Array.isArray(outcomes));
  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every(result => result.status === "queued"));
  const scans = h.db.queries.filter(query => query.name === "alimtalkSends");
  assert.ok(scans.length > 0);
  assert.ok(scans.every(query => query.maximum <= 2));
  assert.ok(scans.every(query => query.filters.some(filter => filter.field === "holdingMemoStatus" && filter.operator === "==" && filter.value === "ready")));
  assert.equal([...h.db.docs.keys()].filter(path => path.startsWith("memberMemos/")).length, 2);
  for (const seed of ["legacy", "already-queued"]) {
    const input = source(seed);
    const memoId = planFor(input).memoId;
    assert.equal(h.db.docs.has(`memberMemos/${memoId}`), false);
    assert.equal(h.db.docs.has(`studiomateMemoWriteJobs/${memoId}`), false);
  }
});

test("default ready scan processes at most ten sends, never an unbounded backlog", async () => {
  const h = harness(source("default-0"));
  for (let n = 1; n < 12; n++) {
    const input = source(`default-${n}`);
    h.db.docs.set(`alimtalkSends/${input.send.id}`, input.send);
    h.db.docs.set(`alimtalkCandidates/${input.send.id}`, input.candidate);
    h.db.docs.set(`holdingNoticeClaims/${input.send.id}`, input.claim);
  }
  const outcomes = await enqueuePendingHoldingMemos({ db: h.db, stamp });
  assert.equal(outcomes.length, 10);
  assert.ok(outcomes.every(result => result.status === "queued"));
  assert.ok(h.db.queries.filter(query => query.name === "alimtalkSends").every(query => query.maximum <= 10));
  assert.equal([...h.db.docs.keys()].filter(path => path.startsWith("memberMemos/")).length, 10);
});

test("invalid ready-scan limits are rejected before any reads or writes", async t => {
  for (const limit of [0, -1, 11, 1.5, "2", NaN, Infinity, null]) await t.test(String(limit), async () => {
    const h = harness(), before = structuredClone(h.db.docs);
    await assert.rejects(enqueuePendingHoldingMemos({ db: h.db, stamp, limit }));
    assert.deepEqual(h.db.docs, before);
    assert.deepEqual(h.db.reads, []);
    assert.deepEqual(h.db.commits, []);
  });
});

test("a ready scan returns an outcome for a blocked source and still processes the following valid source", async () => {
  const failed = source("scan-failed"); failed.send.providerStatus = "FAILED";
  const h = harness(failed), valid = source("scan-valid");
  h.db.docs.set(`alimtalkSends/${valid.send.id}`, valid.send);
  h.db.docs.set(`alimtalkCandidates/${valid.send.id}`, valid.candidate);
  h.db.docs.set(`holdingNoticeClaims/${valid.send.id}`, valid.claim);
  const outcomes = await enqueuePendingHoldingMemos({ db: h.db, stamp, limit: 2 });
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes.filter(result => result.status === "queued").length, 1);
  assert.ok(outcomes.some(result => result.status !== "queued" && result.status !== "existing"));
  pair(h.db, planFor(valid).memoId);
  assert.equal([...h.db.docs.keys()].filter(path => path.startsWith("memberMemos/")).length, 1);
  const changed=h.db.docs.get(`alimtalkSends/${failed.send.id}`);
  assert.equal(changed.holdingMemoStatus,"review");
  assert.equal(changed.holdingMemoProjectionAttempts,1);
  const {holdingMemoError,holdingMemoCheckedAt,holdingMemoProjectionAttempts,holdingMemoAlertStatus,...rest}=changed;
  assert.deepEqual({...rest,holdingMemoStatus:"ready"},failed.send);
});

test("non-self member redirects block both projection and the shared downstream identity guard",async()=>{
  for(const field of ["canonicalMemberId","mergedInto"]) {
    const h=harness(), changed={...profile,[field]:"999"};
    h.db.docs.set(`memberProfiles/${profile.memberId}`,changed);
    await rejectsWithoutWrites(h);
    assert.throws(()=>assertHoldingMemoMemberProfile(changed,planFor(h.input)));
  }
});

test("ten quarantined outbox rows cannot permanently starve an eleventh valid delivery",async()=>{
  const h=harness();h.db.docs.clear();h.db.docs.set(`memberProfiles/${profile.memberId}`,profile);
  for(let i=0;i<11;i++) {
    const input=source(`ring-${i}`);
    if(i<10) input.send.providerStatus="FAILED";
    for(const [collection,key] of [["alimtalkSends","send"],["alimtalkCandidates","candidate"],["holdingNoticeClaims","claim"]])
      h.db.docs.set(`${collection}/${input.send.id}`,input[key]);
  }
  const first=await enqueuePendingHoldingMemos({db:h.db,stamp});
  assert.equal(first.length,10);assert.ok(first.every(r=>r.status==="review"));
  const second=await enqueuePendingHoldingMemos({db:h.db,stamp});
  assert.equal(second.length,1);assert.equal(second[0].status,"queued");
});

test("transient projection failure retries only three times and preserves delivered evidence",async()=>{
  const h=harness();h.db.failPath=`memberMemos/${planFor(h.input).memoId}`;
  for(let attempt=1;attempt<=3;attempt++) {
    const result=await enqueuePendingHoldingMemos({db:h.db,stamp});
    assert.equal(result[0].status,attempt<3?"retry":"review");
    const send=h.db.docs.get(`alimtalkSends/${h.input.send.id}`);
    assert.equal(send.holdingMemoProjectionAttempts,attempt);
    assert.equal(send.status,"done");assert.equal(send.providerStatus,"COMPLETE");
    assert.equal(send.solapiMessageId,h.input.send.solapiMessageId);
  }
  assert.deepEqual(await enqueuePendingHoldingMemos({db:h.db,stamp}),[]);
  assert.equal([...h.db.docs.keys()].filter(p=>p.startsWith("memberMemos/")).length,0);
});

test("writer bounds pre-claim holding failures and independently reports a global outbox read failure",async()=>{
  const code=await readFile(new URL("../process-studiomate-memo-write-jobs.mjs",import.meta.url),"utf8");
  assert.match(code,/let claimedThisRun = false/);
  assert.match(code,/claimedThisRun \? Number\(activeData.attempts \|\| 0\) : Number\(data.attempts \|\| 0\)\+1/);
  assert.match(code,/error\.nonRetryable=true/);
  assert.match(code,/assertHoldingMemoMemberProfile\(profile,data\)/);
  assert.match(code,/holding_memo_outbox_read_unavailable:\$\{day\}/);
  assert.match(code,/AUTOMATION_REPORT_EVENT_ID:eventId/);
  assert.match(code,/send-automation-report\.mjs/);
  assert.match(code,/AUTOMATION_REPORT_LABEL:item.id\?"자동화 확인필요":"자동화 실패"/);
  assert.match(code,/if \(!reportHoldingMemoProjection\(item\)\) result.holdingMemoEmailUnconfirmed=true/);
  assert.match(code,/pendingHoldingMemoAlerts\(db\)/);
  assert.match(code,/settleHoldingMemoAlert\(\{db/);
});

test("a stale ready scan cannot create a new memo after another worker quarantines the send",async()=>{
  const h=harness();
  const staleReadySnapshot=h.db.snapshot(`alimtalkSends/${h.input.send.id}`);
  assert.equal(staleReadySnapshot.data().holdingMemoStatus,"ready");
  h.db.docs.get(`alimtalkSends/${h.input.send.id}`).holdingMemoStatus="review";
  const before=structuredClone(h.db.docs);
  const result=await h.run();
  assert.equal(result.status,"held");
  assert.deepEqual(h.db.docs,before);
});

test("quarantine alert remains pending independently of ready scans until confirmed notification",async()=>{
  const input=source("alert-retained");input.send.providerStatus="FAILED";
  const h=harness(input);
  await enqueuePendingHoldingMemos({db:h.db,stamp});
  assert.deepEqual(await enqueuePendingHoldingMemos({db:h.db,stamp}),[]);
  for(let run=0;run<2;run++) {
    const alerts=await pendingHoldingMemoAlerts(h.db);
    assert.equal(alerts.length,1);assert.equal(alerts[0].id,input.send.id);
  }
  h.db.docs.get(`alimtalkSends/${input.send.id}`).holdingMemoAlertStatus="sent";
  assert.deepEqual(await pendingHoldingMemoAlerts(h.db),[]);
  assert.equal(h.db.docs.get(`alimtalkSends/${input.send.id}`).status,"done");
});

test("a stale alert resolver cannot erase a concurrently refreshed pending review",async()=>{
  const h=harness(),ref=`alimtalkSends/${h.input.send.id}`;
  h.db.docs.get(ref).holdingMemoStatus="queued";
  h.db.docs.get(ref).holdingMemoAlertStatus="pending";
  const observed=structuredClone(h.db.docs.get(ref));
  h.db.docs.get(ref).holdingMemoStatus="review";
  h.db.docs.get(ref).holdingMemoProjectionAttempts=2;
  const before=structuredClone(h.db.docs);
  assert.equal(await settleHoldingMemoAlert({db:h.db,stamp,id:h.input.send.id,observed,status:"resolved"}),false);
  assert.deepEqual(h.db.docs,before);
  const latest=structuredClone(h.db.docs.get(ref));
  assert.equal(await settleHoldingMemoAlert({db:h.db,stamp,id:h.input.send.id,observed:latest,status:"sent"}),true);
  assert.equal(h.db.docs.get(ref).holdingMemoAlertStatus,"sent");
  assert.equal(h.db.docs.get(ref).holdingMemoFailureEmailSentAt,AT);
  assert.equal(h.db.docs.get(ref).providerStatus,"COMPLETE");
});
