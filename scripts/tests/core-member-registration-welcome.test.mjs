import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { verifiedLegacyMembershipWelcomeDisposition } from "../lib/studiomate-membership-contract-completion-state.mjs";

const source = fs.readFileSync(new URL("../../core/assets/app.js", import.meta.url), "utf8");
const functions = new Map([...source.matchAll(/^(?:async )?function (\w+)\([^]*?^\}/gm)]
  .map((match) => [match[1], match[0]]));
const names = [
  "normalizePhone", "timestampMs", "formatDate", "isFailureStatus", "isPermissionDenied", "getCollectionBy", "getRecentStudioCollectionBy",
  "memberRegistrationReason", "membershipPhoneFingerprint", "memberRegistrationItemTime", "memberRegistrationLatest",
  "memberRegistrationReviewClosed", "memberRegistrationOpenEntry",
  "memberRegistrationExcludedProductTitle", "memberRegistrationTicketHint", "memberRegistrationWelcomeState", "memberRegistrationProfilePreference",
  "verifiedLegacyMembershipWelcomeDisposition", "memberRegistrationHistoricalContractReview",
  "preferredMemberRegistrationProfile", "memberRegistrationWelcomeReference", "memberRegistrationWelcomeRecordMatches",
  "loadMemberRegistrationWelcomeReferences", "loadMemberRegistrationDashboard",
];
for (const name of names) assert.ok(functions.has(name), name);
const reasons = source.slice(source.indexOf("const MEMBER_REGISTRATION_REASONS"), source.indexOf("function memberRegistrationReason"));
const NOW = "2026-10-21T08:00:00.000Z";
const OLD = "2026-10-19T08:00:00.000Z";
const NEW = "2026-10-21T07:00:00.000Z";
const PHONE = "01000000001";
const key = (phone = PHONE, studioId = "5330") => `membership_welcome_${createHash("sha256")
  .update(JSON.stringify([studioId, "new_member_welcome", phone])).digest("hex")}`;
const ID = key();
const welcomeReasons = {
  history_time_limit: "웰컴 발송 이력 조회가 제한시간을 초과했습니다. 실제 발송 여부를 확인하세요.",
  membership_welcome_preflight_state_conflict: "웰컴 발송 전 상태 검증이 일치하지 않습니다. 원본 상태와 발송 이력을 확인하세요.",
  unknown_welcome_template: "기존 알림톡 중 분류되지 않은 양식이 있습니다. 웰컴 중복 여부를 확인하세요.",
  welcome_preflight_unavailable: "웰컴 발송 전 검증을 완료하지 못했습니다. 원본 상태와 발송 이력을 다시 확인하세요.",
  invalid_or_stale_signature_time: "계약서 서명 시각이 유효하지 않거나 오래된 정보입니다. 서명 원본과 발송 이력을 확인하세요.",
  previous_welcome_attempt_requires_review: "이전 웰컴 처리 이력의 확인이 필요합니다. 실제 발송 여부를 확인하고 중복 발송하지 마세요.",
};
const contract = (extra = {}) => ({
  id: "a".repeat(64), studioId: "5330", memberName: "Synthetic Member", status: "signed",
  welcomeCandidateId: ID, welcomeStatus: "queued", updatedAt: OLD,
  binding: { memberId: "10001", memberPhone: PHONE, userTicketId: "ticket-1" },
  completion: { memberId: "10001", memberPhone: PHONE, studioId: "5330", checkedAt: OLD },
  ...extra,
});
const candidate = (extra = {}) => ({
  id: ID, candidateId: ID, studioId: "5330", memberId: "10001", memberPhone: PHONE,
  memberName: "Synthetic Member", type: "membership_welcome", status: "failed",
  attempts: 1, lastError: "history_time_limit", updatedAt: OLD, ...extra,
});
const send = (extra = {}) => ({ ...candidate(), type: undefined, sendId: ID, ...extra });
const unrelated = (count = 301) => Array.from({ length: count }, (_, index) => ({
  id: `unrelated-${index}`, candidateId: `unrelated-${index}`, studioId: "5330",
  memberId: `other-${index}`, memberPhone: "", type: "private_survey", status: "done", updatedAt: NEW,
}));
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness({ contracts = [contract()], candidates = [], sends = [], hints = [], profiles = [], errors = new Map(), overrides = new Map() } = {}) {
  const rows = new Map([
    ["memberProfiles", profiles], ["studiomateMembershipContracts", contracts],
    ["alimtalkCandidates", candidates], ["alimtalkSends", sends],
    ["workLanes/studiomate-membership-contract-automation/purchaseHints", hints],
  ]);
  const queries = [], reads = [];
  let inFlight = 0, peak = 0;
  const snapshot = (item) => ({ id: item.id, exists: () => true, data: () => ({ ...item }) });
  const runtime = {
    db: {},
    collection: (_db, path) => path,
    where: (field, op, value) => ({ kind: "where", field, op, value }),
    orderBy: (field, direction) => ({ kind: "order", field, direction }),
    limit: (count) => ({ kind: "limit", count }),
    query: (path, ...constraints) => ({ path, constraints }),
    getDocs: async (query) => {
      queries.push(query);
      let items = [...(rows.get(query.path) || [])];
      for (const condition of query.constraints) {
        if (condition.kind === "where") {
          assert.equal(condition.op, "==");
          items = items.filter((item) => item[condition.field] === condition.value);
        }
        if (condition.kind === "order") items.sort((a, b) => String(b[condition.field]).localeCompare(String(a[condition.field])));
        if (condition.kind === "limit") items = items.slice(0, condition.count);
      }
      return { docs: items.map(snapshot) };
    },
    doc: (_db, collection, id) => {
      assert.ok(["alimtalkCandidates", "alimtalkSends"].includes(collection));
      assert.match(id, /^membership_welcome_[a-f0-9]{64}$/);
      return `${collection}/${id}`;
    },
    getDoc: async (path) => {
      reads.push(path);
      peak = Math.max(peak, ++inFlight);
      try {
        await Promise.resolve();
        if (errors.has(path)) throw errors.get(path);
        if (overrides.has(path)) return snapshot(overrides.get(path));
        const [collection, id] = path.split("/");
        const item = rows.get(collection)?.find((item) => item.id === id);
        return item ? snapshot(item) : { id, exists: () => false };
      } finally { inFlight -= 1; }
    },
  };
  const context = {
    crypto: webcrypto, TextEncoder,
    Date: class extends Date { static now() { return Date.parse(NOW); } },
  };
  vm.runInNewContext(`const STUDIO_ID = "5330";\n${reasons}\n${names.map((name) => functions.get(name)).join("\n")}
    globalThis.api = { ${names.join(",")} };`, context);
  return {
    api: context.api, runtime, reads, queries, peak: () => peak,
    load: () => context.api.loadMemberRegistrationDashboard(runtime),
  };
}

function welcome(row) { return plain(row.steps.find((step) => step.name === "웰컴")); }

test("old failed welcome survives more than 250 unrelated recent candidates and sends", async () => {
  const h = harness({ candidates: [...unrelated(), candidate()], sends: [...unrelated(), send()] });
  const data = await h.load();
  assert.equal(data.items.length, 1);
  assert.deepEqual(plain(data.counts), { recent: 1, active: 0, review: 1, completed: 0, observation: 0 });
  assert.equal(data.items[0].status, "review");
  assert.equal(data.items[0].reason, welcomeReasons.history_time_limit);
  assert.deepEqual(welcome(data.items[0]), { name: "웰컴", status: "error", statusLabel: "확인필요" });
  assert.deepEqual(h.reads.sort(), [`alimtalkCandidates/${ID}`, `alimtalkSends/${ID}`]);
  for (const path of ["alimtalkCandidates", "alimtalkSends"]) {
    assert.equal(h.queries.find((query) => query.path === path).constraints.find((c) => c.kind === "limit").count, 250);
  }
});

test("recent accepted welcome keeps existing completed status without extra reads", async () => {
  const h = harness({ candidates: [candidate({ status: "sent", updatedAt: NEW })], sends: [send({ status: "accepted", updatedAt: NEW })] });
  const data = await h.load();
  assert.equal(data.items[0].status, "completed");
  assert.equal(welcome(data.items[0]).status, "done");
  assert.deepEqual(h.reads, []);
});

test("a recent candidate does not suppress an exact read for an old failed send", async () => {
  const h = harness({ candidates: [candidate({ status: "queued", lastError: null, updatedAt: NEW })],
    sends: [...unrelated(), send()] });
  const data = await h.load();
  assert.equal(data.items[0].status, "review");
  assert.equal(data.items[0].reason, welcomeReasons.history_time_limit);
  assert.deepEqual(h.reads, [`alimtalkSends/${ID}`]);
});

test("an old failed candidate remains actionable when no send document exists", async () => {
  const h = harness({ candidates: [...unrelated(), candidate()] });
  assert.equal((await h.load()).items[0].status, "review");
  assert.equal(h.reads.length, 2);
});

for (const status of ["failed", "accepted"]) {
  for (const candidateAbsent of [false, true]) {
    test(`exact ${status} send is used independently of ${candidateAbsent ? "absent" : "aged-out"} candidate`, async () => {
      const h = harness({ candidates: [...unrelated(), ...(candidateAbsent ? [] : [candidate()])],
        sends: [...unrelated(), send({ status })] });
      const data = await h.load();
      assert.equal(data.items[0].status, status === "failed" ? "review" : "completed");
      assert.equal(welcome(data.items[0]).status, status === "failed" ? "error" : "done");
      assert.equal(h.reads.length, 2);
    });
  }
}

test("permission-denied missing candidate cannot suppress an independently verified send", async () => {
  const h = harness({ sends: [...unrelated(), send({ status: "accepted" })], errors: new Map([
    [`alimtalkCandidates/${ID}`, Object.assign(new Error("missing"), { code: "permission-denied" })],
  ]) });
  assert.equal((await h.load()).items[0].status, "completed");
  assert.equal(h.reads.length, 2);
});

for (const agedOut of [false, true]) {
  for (const code of ["permission-denied", "unavailable"]) {
    test(`${agedOut ? "aged-out" : "recent"} queued candidate with ${code} send read stays row-level review`, async () => {
      const phone = "01000000002", otherId = key(phone);
      const affected = candidate({ status: "queued", lastError: null });
      const healthyContract = contract({ id: "b".repeat(64), welcomeCandidateId: otherId,
        binding: { memberId: "10002", memberPhone: phone }, completion: { memberId: "10002", memberPhone: phone } });
      const healthySend = send({ id: otherId, candidateId: otherId, sendId: otherId,
        memberId: "10002", memberPhone: phone, status: "accepted", lastError: null, updatedAt: NEW });
      const h = harness({ contracts: [contract(), healthyContract],
        candidates: agedOut ? [...unrelated(), affected] : [affected], sends: [healthySend],
        errors: new Map([[`alimtalkSends/${ID}`, Object.assign(new Error("synthetic send read failure"), { code })]]) });
      const dashboard = await h.load();
      const row = dashboard.items.find(item => item.memberId === "10001");
      assert.equal(row.status, "review");
      assert.equal(welcome(row).statusLabel, "확인필요");
      assert.match(row.reason, /웰컴 발송 원장을 읽지 못/);
      assert.doesNotMatch(row.reason, /발송을 준비|발송완료|발송대기/);
      assert.equal(dashboard.items.find(item => item.memberId === "10002").status, "completed");
      assert.deepEqual(plain(dashboard.counts), { recent: 2, active: 0, review: 1, completed: 1, observation: 0 });
      assert.ok(h.reads.includes(`alimtalkSends/${ID}`));
    });
  }
}

test("missing exact documents do not become sent or link to an unrelated recent welcome", async () => {
  const otherId = key("01000000002");
  const h = harness({ candidates: [candidate({ id: otherId, candidateId: otherId, status: "sent", updatedAt: NEW })],
    sends: [send({ id: otherId, candidateId: otherId, sendId: otherId, status: "done", updatedAt: NEW })] });
  const data = await h.load();
  assert.equal(data.items[0].status, "active");
  assert.equal(welcome(data.items[0]).status, "active");
  assert.equal(h.reads.length, 2);
});

test("ambiguous welcome preserves the current status helper and does not imply delivery", async () => {
  const h = harness({ contracts: [contract({ welcomeStatus: "review" })],
    candidates: [...unrelated(), candidate({ status: "processing", lastError: "provider_acceptance_unknown" })],
    sends: [...unrelated(), send({ status: "unknown", lastError: "provider_acceptance_unknown" })] });
  const data = await h.load();
  assert.equal(data.items[0].status, "review");
  assert.equal(welcome(data.items[0]).status, "error");
  assert.equal(data.items[0].reason, "provider acceptance unknown");
});

for (const [code, reason] of Object.entries(welcomeReasons)) {
  test(`${code} renders a staff-readable reason without claiming a send`, async () => {
    const h = harness({ candidates: [...unrelated(), candidate({ lastError: code })],
      sends: [...unrelated(), send({ lastError: code })] });
    const row = (await h.load()).items[0];
    assert.equal(row.reason, reason);
    assert.equal(row.status, "review");
    assert.equal(welcome(row).statusLabel, "확인필요");
    assert.doesNotMatch(row.reason, /발송완료|발송됐|발송되었|발송했습니다|발송을 준비|[a-z_]/i);
    assert.equal(h.api.memberRegistrationReason(code), reason);
    const contractOnly = harness({ contracts: [contract({ welcomeStatus: "review", welcomeReason: code })] });
    const contractRow = (await contractOnly.load()).items[0];
    assert.equal(contractRow.reason, reason);
    assert.equal(welcome(contractRow).statusLabel, "확인필요");
  });
}

for (const collection of ["alimtalkCandidates", "alimtalkSends"]) {
  test(`${collection} rejects mismatched member, phone, studio and document identity`, async () => {
    for (const change of [
      { memberId: "other-member" }, { memberId: undefined }, { memberPhone: "01000000002" },
      { memberPhone: undefined }, { studioId: "other-studio" }, { studioId: undefined },
      { candidateId: key("01000000002") }, { candidateId: undefined }, { id: key("01000000002") },
      ...(collection === "alimtalkCandidates" ? [{ type: "private_survey" }] : [{ sendId: "other-send" }]),
    ]) {
      const h = harness({ overrides: new Map([[`${collection}/${ID}`,
        collection === "alimtalkCandidates" ? candidate({ status: "sent", ...change }) : send({ status: "done", ...change })]]) });
      const data = await h.load();
      assert.equal(data.items[0].status, "active", JSON.stringify(change));
      assert.notEqual(welcome(data.items[0]).status, "done");
    }
  });
}

test("untrusted, missing and noncanonical IDs trigger no exact reads or sent inference", async () => {
  for (const id of [undefined, null, "", {}, 42, "../alimtalkSends/other", "alimtalkSends/other", "welcome_legacy",
    `membership_welcome_${"A".repeat(64)}`, `membership_welcome_${"b".repeat(64)}`, `${ID}/nested`, ` ${ID}`]) {
    const h = harness({ contracts: [contract({ welcomeCandidateId: id })], candidates: [candidate({ status: "sent" })], sends: [send({ status: "done" })] });
    assert.equal((await h.load()).items[0].status, "active", String(id));
    assert.deepEqual(h.reads, []);
  }
});

test("conflicting contract identities and other studios cannot create a trusted reference", async () => {
  const h = harness();
  for (const change of [
    { studioId: "other-studio" }, { studioId: undefined }, { welcomeCandidateId: key(PHONE, "other-studio") },
    { binding: { memberId: "different-member", memberPhone: PHONE } },
    { binding: { memberId: "10001", memberPhone: "01000000002" } },
    { completion: { memberId: "10001", memberPhone: PHONE, studioId: "other-studio" } },
    { binding: {}, completion: {} },
  ]) assert.equal(await h.api.memberRegistrationWelcomeReference(contract(change)), null);
  assert.deepEqual(h.reads, []);
});

test("recent reference contamination cannot override an old failure", async () => {
  const wrongId = key("01000000002");
  const h = harness({ candidates: [candidate(), candidate({ id: wrongId, candidateId: wrongId, status: "sent", updatedAt: NEW })],
    sends: [send(), send({ id: wrongId, candidateId: wrongId, sendId: wrongId, status: "done", updatedAt: NEW })] });
  assert.equal((await h.load()).items[0].status, "review");
  assert.deepEqual(h.reads, []);
});

test("deduplicated reference reads still validate each contract member independently", async () => {
  const h = harness({ candidates: [...unrelated(), candidate({ status: "sent" })],
    sends: [...unrelated(), send({ status: "done" })] });
  const first = contract();
  const second = contract({ id: "b".repeat(64),
    binding: { memberId: "10002", memberPhone: PHONE }, completion: { memberId: "10002", memberPhone: PHONE } });
  const references = await h.api.loadMemberRegistrationWelcomeReferences(h.runtime, [first, second], [], []);
  assert.equal(references.get(first).send.status, "done");
  assert.deepEqual(plain(references.get(second)), { candidate: null, send: null });
  assert.equal(h.reads.length, 2);
});

test("unreadable references fail the dashboard read instead of pretending the result is pending", async () => {
  const error = Object.assign(new Error("synthetic read unavailable"), { code: "permission-denied" });
  const h = harness({ errors: new Map([[`alimtalkCandidates/${ID}`, error], [`alimtalkSends/${ID}`, error]]) });
  await assert.rejects(h.load(), /synthetic read unavailable/);
  assert.equal(h.reads.length, 2);
});

test("backfill is bounded, deduplicated and concurrency-limited", async () => {
  const h = harness();
  const contracts = Array.from({ length: 101 }, (_, index) => {
    const phone = `010${String(index + 1).padStart(8, "0")}`;
    return contract({ id: String(index), welcomeCandidateId: key(phone),
      binding: { memberId: String(index + 1), memberPhone: phone },
      completion: { memberId: String(index + 1), memberPhone: phone } });
  });
  const result = await h.api.loadMemberRegistrationWelcomeReferences(h.runtime, contracts, [], []);
  assert.equal(result.size, 100);
  assert.equal(h.reads.length, 200);
  assert.equal(new Set(h.reads).size, 200);
  assert.ok(h.peak() <= 8);
  const duplicate = harness();
  const duplicatedContracts = Array.from({ length: 100 }, () => contract());
  assert.equal((await duplicate.api.loadMemberRegistrationWelcomeReferences(duplicate.runtime, duplicatedContracts, [], [])).size, 100);
  assert.equal(duplicate.reads.length, 2);
});

test("existing runtime provides doc/getDoc and the new helpers perform reads only", () => {
  assert.match(functions.get("initFirebase"), /\.\.\.firestore/);
  assert.match(functions.get("initFirebase"), /sharedNavigationRuntime\(\)/);
  const helpers = ["memberRegistrationWelcomeReference", "memberRegistrationWelcomeRecordMatches", "loadMemberRegistrationWelcomeReferences"]
    .map((name) => functions.get(name)).join("\n");
  assert.doesNotMatch(helpers, /setDoc|updateDoc|deleteDoc|addDoc|httpsCallable|fetch\(|getAuth|signIn|writeBatch/);
  assert.match(helpers, /runtime\.getDoc\(runtime\.doc\(runtime\.db, collectionName, id\)\)/);
  assert.doesNotMatch(functions.get("memberRegistrationWelcomeState"), /Reference|getDoc|attempts/);
});

const legacyContract = (extra = {}) => {
  const contractId = "a".repeat(64);
  return contract({
    schemaVersion: 1, source: "studiomate_native_contract", contractId, bindingVerified: true,
    welcomeCandidateId: undefined, welcomeStatus: "not_required", completion: null,
    binding: { contractId, studioId: "5330", memberId: "10001", memberPhone: PHONE,
      userTicketId: "20002", selectedAt: "2026-09-15T00:00:00.000Z", selectionJobKey: "original-contract-job" },
    signatureReceipt: { contractId, studioId: "5330", memberId: "10001", source: "studiomate_native_contract",
      authoritative: true, status: "signed", memberSigned: true, centerSigned: true, signedAt: "2026-10-01T00:00:00.000Z" },
    observationStatus: "review", observationReason: "invalid_native_binding",
    welcomeDisposition: { reason: "legacy_member_before_contract_cutover", verified: true, memberId: "10001", contractId,
      source: "studiomate_native_member_ticket", checkedAt: OLD, registeredAt: "2023-01-01T00:00:00.000Z",
      cutoverAt: "2026-09-14T00:00:00.000Z", priorRegularIssuanceIds: ["20001"] },
    ...extra,
  });
};

test("browser and observer use identical legacy disposition validation", () => {
  assert.equal(functions.get("verifiedLegacyMembershipWelcomeDisposition"), verifiedLegacyMembershipWelcomeDisposition.toString());
});

test("verified legacy source completes without claiming a welcome was sent or changing signature truth", async () => {
  const original = legacyContract(), before = structuredClone(original);
  const h = harness({ contracts: [original] });
  const dashboard = await h.load(), row = dashboard.items[0];
  assert.equal(h.api.verifiedLegacyMembershipWelcomeDisposition(original), true);
  assert.deepEqual(plain(dashboard.counts), { recent: 1, active: 0, review: 0, completed: 1, observation: 0 });
  assert.equal(row.reason, "기존 회원 · 대상 제외");
  assert.deepEqual(welcome(row), { name: "웰컴", status: "not_required", statusLabel: "기존 회원 · 대상 제외" });
  assert.equal(row.steps.find(step => step.name === "서명").statusLabel, "완료");
  assert.doesNotMatch(JSON.stringify(row), /발송완료|발송됐|웰컴 알림톡.*준비/);
  assert.deepEqual(original, before);
  assert.deepEqual(h.reads, []);
});

test("legacy exclusion never supplies a missing member signature", async () => {
  const h = harness({ contracts: [legacyContract({ status: "waiting", observationStatus: "waiting", signatureReceipt: null })] });
  const row = (await h.load()).items[0];
  assert.equal(row.status, "active");
  assert.equal(row.steps.find(step => step.name === "서명").statusLabel, "대기");
  assert.equal(welcome(row).status, "not_required");
});

const invalidDispositions = [
  ["missing disposition", row => { delete row.welcomeDisposition; }],
  ["unverified disposition", row => { row.welcomeDisposition.verified = "true"; }],
  ["wrong reason", row => { row.welcomeDisposition.reason = "welcome_already_sent"; }],
  ["worklane evidence", row => { row.welcomeDisposition.source = "workLanes"; }],
  ["wrong member", row => { row.welcomeDisposition.memberId = "10002"; }],
  ["wrong contract", row => { row.welcomeDisposition.contractId = "b".repeat(64); }],
  ["wrong binding contract", row => { row.binding.contractId = "b".repeat(64); }],
  ["wrong binding studio", row => { row.binding.studioId = "other"; }],
  ["temporary member", row => { row.binding.memberId = row.welcomeDisposition.memberId = "excel_10001"; }],
  ["unverified canonical binding", row => { row.bindingVerified = false; }],
  ["mirror source", row => { row.source = "member360Cards"; }],
  ["unknown schema", row => { row.schemaVersion = 2; }],
  ["wrong document ID", row => { row.id = "b".repeat(64); }],
  ["missing checked time", row => { delete row.welcomeDisposition.checkedAt; }],
  ["future checked time", row => { row.welcomeDisposition.checkedAt = "2026-10-22T00:00:00.000Z"; }],
  ["rollover checked date", row => { row.welcomeDisposition.checkedAt = "2026-02-30T00:00:00.000Z"; }],
  ["missing registration", row => { delete row.welcomeDisposition.registeredAt; }],
  ["post-cutover registration", row => { row.welcomeDisposition.registeredAt = "2026-09-15T00:00:00.000Z"; }],
  ["missing cutover", row => { delete row.welcomeDisposition.cutoverAt; }],
  ["cutover after audit", row => { row.welcomeDisposition.cutoverAt = "2026-10-20T00:00:00.000Z"; }],
  ["no prior regular proof", row => { delete row.welcomeDisposition.priorRegularIssuanceIds; }],
  ["empty prior regular proof", row => { row.welcomeDisposition.priorRegularIssuanceIds = []; }],
  ["duplicate prior proof", row => { row.welcomeDisposition.priorRegularIssuanceIds = ["20001", "20001"]; }],
  ["fallback prior proof", row => { row.welcomeDisposition.priorRegularIssuanceIds = ["excel_20001"]; }],
  ["current issuance not prior proof", row => { row.welcomeDisposition.priorRegularIssuanceIds = ["20002"]; }],
  ["conflicting completion", row => { row.completion = { ...row.signatureReceipt, memberId: "10002" }; }],
  ["conflicting receipt", row => { row.signatureReceipt.memberId = "10002"; }],
  ["conflicting saved registration", row => { row.selection = { member: { registeredAt: "2024-01-01T00:00:00.000Z" } }; }],
  ["conflicting saved cutover", row => { row.selection = { policy: { cutoverAt: "2026-09-13T00:00:00.000Z" } }; }],
];
for (const [name, mutate] of invalidDispositions) {
  test(`not_required rejects ${name} and cannot suppress contract review`, async () => {
    const source = legacyContract(); mutate(source);
    const h = harness({ contracts: [source] });
    assert.equal(h.api.verifiedLegacyMembershipWelcomeDisposition(source), false);
    assert.equal(verifiedLegacyMembershipWelcomeDisposition(source, Date.parse(NOW)), false);
    const row = (await h.load()).items[0];
    assert.equal(row.status, "review");
    assert.equal(welcome(row).status, "error");
    assert.notEqual(row.reason, "기존 회원 · 대상 제외");
  });
}

test("historical freshness review requires exact disposition; unrelated contract errors remain visible", async () => {
  for (const observationReason of ["stale_first_signed_observation", "invalid_or_stale_signature_time", "late_signature_welcome_review_required"])
    assert.equal((await harness({ contracts: [legacyContract({ observationReason })] }).load()).items[0].status, "completed");
  for (const observationReason of ["native_signature_receipt_identity_mismatch", "signature_history_regression", "native_contract_read_failed", "unexpected_error"])
    assert.equal((await harness({ contracts: [legacyContract({ observationReason })] }).load()).items[0].status, "review");
  const recent = legacyContract(); recent.binding.selectedAt = NEW;
  assert.equal((await harness({ contracts: [recent] }).load()).items[0].status, "review");
  const unprovenSignature = legacyContract(); unprovenSignature.signatureReceipt.authoritative = false;
  assert.equal((await harness({ contracts: [unprovenSignature] }).load()).items[0].status, "review");
  for (const status of ["review", "failed", "error"])
    assert.equal((await harness({ contracts: [legacyContract({ status, observationStatus: "signed" })] }).load()).items[0].status, "review");
});

test("verified exclusion does not hide reminder or welcome send/candidate failures", async () => {
  for (const signatureReminder of [{ status: "review" }, { status: "attempting" }]) {
    const row = (await harness({ contracts: [legacyContract({ signatureReminder })] }).load()).items[0];
    assert.equal(row.status, "review"); assert.match(row.reason, /서명 요청 문자/);
  }
  for (const status of ["failed", "unknown", "queued", "processing"]) {
    const row = (await harness({ contracts: [legacyContract({ welcomeCandidateId: ID })], sends: [send({ status })] }).load()).items[0];
    assert.equal(row.status, "review");
  }
  const row = (await harness({ contracts: [legacyContract({ welcomeCandidateId: ID })], candidates: [candidate()] }).load()).items[0];
  assert.equal(row.status, "review");
  for (const status of ["unknown", "reviewed", "pending", undefined]) {
    const row = (await harness({ contracts: [legacyContract({ welcomeCandidateId: ID })], candidates: [candidate({ status, lastError: null })] }).load()).items[0];
    assert.equal(row.status, "review");
  }
});

for (const collection of ["candidates", "sends"]) {
  for (const field of ["sendStatus", "deliveryStatus", "resultStatus", "solapiStatus", "alimtalkStatus", "providerStatus"]) {
    test(`legacy exclusion cannot hide ${collection} ${field} failure behind accepted status`, async () => {
      for (const failure of ["failed", "error", "critical", "blocked", "FAILED"]) {
        const record = collection === "candidates" ? candidate : send;
        const row = (await harness({ contracts: [legacyContract({ welcomeCandidateId: ID })],
          [collection]: [record({ status: "accepted", lastError: null, [field]: failure })] }).load()).items[0];
        assert.equal(row.status, "review", failure);
        assert.equal(welcome(row).statusLabel, "확인필요", failure);
        assert.equal(row.reason, "알림톡 전달에 실패했습니다. 제공사 결과를 확인하고 별도 승인 없이 재발송하지 않습니다.");
      }
    });
  }
}

test("successful delivery fields keep a verified legacy exclusion distinct from delivery", async () => {
  const fields = { sendStatus: "sent", deliveryStatus: "delivered", resultStatus: "success",
    solapiStatus: "accepted", alimtalkStatus: "done", lastError: null };
  const row = (await harness({ contracts: [legacyContract({ welcomeCandidateId: ID })],
    candidates: [candidate({ ...fields, status: "sent" })], sends: [send({ ...fields, status: "accepted" })] }).load()).items[0];
  assert.equal(row.status, "completed");
  assert.equal(welcome(row).status, "not_required");
  assert.doesNotMatch(JSON.stringify(row), /발송완료/);
});

const purchaseHint = (extra = {}) => ({
  id: "original-hint", contractId: "a".repeat(64), jobKey: "original-contract-job", status: "processed",
  phoneFingerprint: createHash("sha256").update(JSON.stringify(PHONE)).digest("hex"), discoveredAt: OLD,
  hints: [{ productName: "Original regular pass", paymentAmountText: "100000", issuedAtText: OLD }], ...extra,
});

test("ticket label prefers bound name, then source ticket title, over newer ignored toesox hint", async () => {
  for (const bindingName of ["Bound regular pass", undefined]) {
    const source = legacyContract(); source.binding.ticketName = bindingName;
    source.selection = { ticket: { title: "Source regular pass" } };
    const row = (await harness({ contracts: [source], hints: [purchaseHint(), purchaseHint({ id: "toesox", contractId: undefined,
      jobKey: undefined, status: "ignored", discoveredAt: NEW,
      hints: [{ productName: "ToeSox", paymentAmountText: "20000", issuedAtText: NEW }] })] }).load()).items[0];
    assert.equal(row.ticketName, bindingName || "Source regular pass");
  }
});

test("ticket fallback uses only the exact original contract/job hint, never a later unrelated purchase", async () => {
  for (const association of [{ contractId: "a".repeat(64), jobKey: undefined }, { contractId: undefined, jobKey: "original-contract-job" }]) {
    const row = (await harness({ contracts: [legacyContract()], hints: [purchaseHint(association), purchaseHint({ id: "toesox", contractId: undefined,
      jobKey: "different-job", status: "ignored", discoveredAt: NEW,
      hints: [{ productName: "ToeSox", paymentAmountText: "20000", issuedAtText: NEW }] })] }).load()).items[0];
    assert.equal(row.ticketName, "Original regular pass");
  }
  const unmatched = (await harness({ contracts: [legacyContract()], hints: [purchaseHint({ contractId: "b".repeat(64), jobKey: "other" })] }).load()).items[0];
  assert.equal(unmatched.ticketName, "수강권 확인");
  const conflicting = (await harness({ contracts: [legacyContract()], hints: [purchaseHint(), purchaseHint({ id: "conflicting", discoveredAt: NEW,
    contractId: "b".repeat(64), hints: [{ productName: "ToeSox", paymentAmountText: "20000", issuedAtText: NEW }] })] }).load()).items[0];
  assert.equal(conflicting.ticketName, "Original regular pass");
});

const hintProfile = (extra = {}) => ({
  id: "10001", memberId: "10001", name: "Synthetic Member", phone: PHONE, memberGrade: "일반회원", updatedAt: OLD, ...extra,
});
const unverifiedHint = (extra = {}) => purchaseHint({
  contractId: undefined, jobKey: undefined, status: "native_verification_required", ...extra,
});
const outdoorProduct = { productName: "야외수업 1회권", paymentAmountText: "10000", issuedAtText: NEW };

test("outdoor-only, trial-only and single-use hints without canonical work are excluded", async () => {
  for (const productName of ["야외수업 1회권", "야외수업 참가권", "체험 수강권", "그룹 1회권",
    "OUTDOOR CLASS", " O U T D O O R 참가권 ", "ＯＵＴＤＯＯＲ 참가권", "그룹 １회권", "야 외 수 업", "체 험 수 강 권"]) {
    const hint = unverifiedHint({ hints: [{ ...outdoorProduct, productName }] });
    const before = structuredClone(hint);
    const h = harness({ contracts: [], hints: [hint], profiles: [hintProfile()] });
    const data = await h.load();
    assert.deepEqual(plain(data.counts), { recent: 0, active: 0, review: 0, completed: 0, observation: 0 }, productName);
    assert.equal(data.items.length, 0);
    assert.deepEqual(h.reads, []);
    assert.deepEqual(hint, before);
    assert.equal(h.api.memberRegistrationTicketHint(hint), null);
  }
  const excludedOnly = await harness({ contracts: [], profiles: [hintProfile()], hints: [unverifiedHint({ hints: [
    outdoorProduct, { productName: "ＯＵＴＤＯＯＲ 참가권" }, { productName: "체 험 수강권" }, { productName: "그룹 １회권" },
  ] })] }).load();
  assert.equal(excludedOnly.items.length, 0);
});

test("mixed historical holdings remain an observation, never evidence of a new regular issuance", async () => {
  const hint = unverifiedHint({ hints: [outdoorProduct, ...purchaseHint().hints] });
  const before = structuredClone(hint);
  const h = harness({ contracts: [], hints: [hint], profiles: [hintProfile()] });
  const data = await h.load(), row = data.items[0];
  assert.deepEqual(plain(data.counts), { recent: 1, active: 0, review: 0, completed: 0, observation: 1 });
  assert.equal(row.status, "observation");
  assert.equal(row.key, hint.phoneFingerprint);
  assert.equal(row.memberId, "10001");
  assert.equal(row.ticketName, "수강권 원천 미확인");
  assert.equal(row.steps.find(step => step.name === "수강권").status, "pending");
  assert.equal(row.steps.find(step => step.name === "계약서").statusLabel, "미생성");
  assert.equal(welcome(row).statusLabel, "미확인");
  assert.match(row.reason, /새 정규 수강권 발급.*원천 미확인/);
  assert.doesNotMatch(row.reason, /생성합니다|준비합니다/);
  assert.deepEqual(h.reads, []);
  assert.deepEqual(hint, before);
});

test("unknown and processed hint states cannot become active, even with no profile or a dangling contract ID", async () => {
  for (const status of ["native_verification_required", "processed", "unknown", "", undefined]) {
    for (const profiles of [[], [hintProfile()]]) {
      const row = (await harness({ contracts: [], profiles, hints: [purchaseHint({ status })] }).load()).items[0];
      assert.equal(row.status, "observation", String(status));
      assert.equal(row.steps.find(step => step.name === "수강권").statusLabel, "미확인");
    }
  }
});

test("exclusion requires every product to be known excluded across all member hints", async () => {
  for (const other of ["그룹 30회권", "그룹 11회권", "", "Unknown product"]) {
    const data = await harness({ contracts: [], profiles: [hintProfile()], hints: [
      unverifiedHint({ hints: [outdoorProduct] }),
      unverifiedHint({ id: "historical", discoveredAt: NEW, hints: [{ productName: other }] }),
    ] }).load();
    assert.equal(data.items[0].status, "observation", other);
  }
  for (const hints of [[], undefined, [null]]) {
    const row = (await harness({ contracts: [], profiles: [hintProfile()], hints: [unverifiedHint({ hints })] }).load()).items[0];
    assert.equal(row.status, "observation");
  }
});

test("explicit title exclusion never broadens regular counts, weekly cadence or unapproved labels", async () => {
  const h = harness({ contracts: [] });
  for (const productName of ["그룹 10회권", "그룹 11회권", "그룹 21회권", "그룹 １１회권", "그룹 ２１회권",
    "10주(주1회)", "10주(주1회권)", "10주 (주 1 회권)", "10주(주１회권)",
    "원데이 클래스", "단회 이용권", "oneoff pass", "trial pass"]) {
    assert.equal(h.api.memberRegistrationExcludedProductTitle(productName), false, productName);
    for (const products of [[{ productName }], [outdoorProduct, { productName }]]) {
      const data = await harness({ contracts: [], profiles: [hintProfile()],
        hints: [unverifiedHint({ hints: products })],
      }).load();
      assert.equal(data.items.length, 1, productName);
      assert.equal(data.items[0].status, "observation", productName);
      assert.equal(data.counts.active, 0, productName);
    }
  }
  for (const value of [undefined, null, 1, {}, ["OUTDOOR"]]) {
    assert.equal(h.api.memberRegistrationExcludedProductTitle(value), false);
  }
  for (const productName of ["그룹 상품권", "그룹 쿠폰"]) {
    assert.equal(h.api.memberRegistrationTicketHint({ hints: [{ productName, paymentAmountText: "100000" }] }), null);
  }
});

for (const memberGrade of ["강사회원", "강사", "스텝", "직원", "체험회원", "상담회원"]) {
  test(`${memberGrade} excludes only non-review hints, never canonical work or welcome history`, async () => {
    const profiles = [hintProfile({ memberGrade })], hints = [unverifiedHint()];
    assert.equal((await harness({ contracts: [], profiles, hints }).load()).items.length, 0);
    const baseline = plain(await harness({ profiles }).load());
    assert.deepEqual(plain(await harness({ profiles, hints }).load()), baseline);
    const review = await harness({ contracts: [], profiles, hints: [unverifiedHint({ status: "review", reason: "identity_ambiguous" })] }).load();
    assert.equal(review.items[0].status, "review");
    for (const status of ["queued", "sent", "failed", "review"]) {
      const data = await harness({ contracts: [], profiles, hints,
        candidates: [candidate({ status, lastError: null })],
        sends: status === "sent" ? [send({ status: "accepted", lastError: null })] : [],
      }).load();
      assert.equal(data.items.length, 1, status);
      assert.notEqual(data.items[0].status, "observation", status);
      assert.equal(welcome(data.items[0]).status, status === "sent" ? "done" : status === "failed" ? "error" : status === "queued" ? "active" : "pending");
    }
  });
}

test("mixed outdoor/history hints leave canonical regular contract, review and signed welcome flows unchanged", async () => {
  for (const extra of [
    { status: "waiting", completion: null },
    { status: "failed", observationStatus: "review", observationReason: "native_contract_read_failed" },
    { status: "signed", welcomeStatus: "accepted" },
    { status: "signed", welcomeStatus: "review", welcomeReason: "late_signature_welcome_review_required" },
  ]) {
    const source = contract(extra);
    source.binding.ticketName = "Canonical regular pass";
    const options = { contracts: [source], profiles: [hintProfile()] };
    const baseline = plain(await harness(options).load());
    for (const products of [[outdoorProduct, ...purchaseHint().hints],
      [{ productName: "ＯＵＴＤＯＯＲ 참가권" }, ...purchaseHint().hints], [{ productName: "OUTDOOR CLASS" }]]) {
      const withHints = await harness({ ...options,
        hints: [unverifiedHint({ hints: products })],
      }).load();
      assert.deepEqual(plain(withHints), baseline);
    }
  }
});

test("outdoor hints do not suppress unsubmitted hint reviews, canonical failures, or sent welcome history", async () => {
  const hints = [unverifiedHint({ hints: [outdoorProduct] })], profiles = [hintProfile()];
  const review = await harness({ contracts: [], profiles, hints: [{ ...hints[0], status: "review", reason: "unsubmitted_review" }] }).load();
  assert.equal(review.items[0].status, "review");
  assert.equal(review.items[0].reason, "unsubmitted review");
  for (const status of ["failed", "error", "review"]) {
    const row = (await harness({ contracts: [contract({ status })], profiles, hints }).load()).items[0];
    assert.equal(row.status, "review");
  }
  const sent = await harness({ contracts: [], profiles, hints,
    candidates: [candidate({ status: "sent", lastError: null })], sends: [send({ status: "accepted", lastError: null })],
  }).load();
  assert.equal(sent.items.length, 1);
  assert.equal(welcome(sent.items[0]).status, "done");
});

test("a newer unverified outdoor hint cannot hide an older genuine hint review", async () => {
  const data = await harness({ contracts: [], profiles: [hintProfile({ memberGrade: "체험회원" })], hints: [
    unverifiedHint({ status: "review", reason: "unsubmitted_review", hints: [outdoorProduct] }),
    unverifiedHint({ id: "newer-outdoor", discoveredAt: NEW, hints: [outdoorProduct] }),
  ] }).load();
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].status, "review");
  assert.equal(data.items[0].reason, "unsubmitted review");
  assert.deepEqual(plain(data.counts), { recent: 1, active: 0, review: 1, completed: 0, observation: 0 });
});

test("member registration dashboard remains read-only and never dispatches hint-based actions", () => {
  const dashboard = functions.get("loadMemberRegistrationDashboard");
  assert.doesNotMatch(dashboard, /setDoc|updateDoc|deleteDoc|addDoc|httpsCallable|fetch\(|writeBatch|\.doc\([^]*?\.(?:set|update|delete)\(/);
});

test("existing no-action hints stay absent without losing canonical records", async () => {
  for (const extra of [{ status: "ignored" }, { status: "excluded" }, { status: "review", reason: "fresh_native_issuance_not_found" }]) {
    const hints = [unverifiedHint(extra)], profiles = [hintProfile()];
    assert.equal((await harness({ contracts: [], profiles, hints }).load()).items.length, 0);
    assert.equal((await harness({ profiles, hints }).load()).items.length, 1);
  }
});

const CLOSED_AT = "2026-10-20T08:00:00.000Z";
const reviewClosedContract = () => ({
  id: "a".repeat(64), contractId: "a".repeat(64), schemaVersion: 1,
  source: "studiomate_native_contract", studioId: "5330", bindingVerified: true,
  memberName: "Synthetic Member", status: "excluded", observationStatus: "excluded",
  observationHold: true, updatedAt: CLOSED_AT,
  binding: { verified: true, contractId: "a".repeat(64), studioId: "5330",
    memberId: "10001", userTicketId: "20001", memberPhone: PHONE, selectionJobKey: "original-contract-job" },
  operatorReviewDisposition: {
    schemaVersion: 1, policy: "operator_contract_review_closed_v1", status: "excluded",
    contractId: "a".repeat(64), memberId: "10001", userTicketId: "20001",
    closedAt: CLOSED_AT, approvalReference: "user_close_review_20261106", noReplay: true, sendAllowed: false,
  },
});
const registrationEntry = (extra = {}) => ({
  fingerprint: purchaseHint().phoneFingerprint, profiles: [hintProfile()],
  contracts: [reviewClosedContract()], hints: [purchaseHint()], candidates: [candidate()], sends: [send()], ...extra,
});

test("valid operator closure removes pending review without signing, completion or source mutation", async () => {
  const source = reviewClosedContract();
  const options = { contracts: [source], profiles: [hintProfile({ updatedAt: NEW })],
    hints: [purchaseHint()], candidates: [candidate()], sends: [send()] };
  const before = structuredClone(options);
  const h = harness(options);
  assert.equal(h.api.memberRegistrationReviewClosed(source), true);
  const data = await h.load();
  assert.equal(data.items.length, 0);
  assert.deepEqual(plain(data.counts), { recent: 0, active: 0, review: 0, completed: 0, observation: 0 });
  assert.equal(source.completion, undefined);
  assert.equal(source.signatureReceipt, undefined);
  assert.equal(source.status, "excluded");
  assert.deepEqual(options, before);
});

const invalidReviewClosures = [
  ["missing marker", row => { delete row.operatorReviewDisposition; }],
  ["malformed marker", row => { row.operatorReviewDisposition = "excluded"; }],
  ["source schema", row => { row.schemaVersion = 2; }],
  ["non-native source", row => { row.source = "excel_contract"; }],
  ["unverified source", row => { row.bindingVerified = false; }],
  ["unverified binding", row => { row.binding.verified = false; }],
  ["wrong binding studio", row => { row.binding.studioId = "5331"; }],
  ["non-excluded source status", row => { row.status = "review"; }],
  ["non-excluded observation", row => { row.observationStatus = "review"; }],
  ["missing observation hold", row => { delete row.observationHold; }],
  ["false observation hold", row => { row.observationHold = false; }],
  ["malformed contract ID", row => {
    row.contractId = row.binding.contractId = row.operatorReviewDisposition.contractId = "not-a-native-contract";
  }],
  ["wrong binding contract", row => { row.binding.contractId = "b".repeat(64); }],
  ["wrong marker contract", row => { row.operatorReviewDisposition.contractId = "b".repeat(64); }],
  ["wrong marker member", row => { row.operatorReviewDisposition.memberId = "10002"; }],
  ["wrong marker ticket", row => { row.operatorReviewDisposition.userTicketId = "20002"; }],
  ["fallback member ID", row => { row.binding.memberId = row.operatorReviewDisposition.memberId = "excel_10001"; }],
  ["fallback ticket ID", row => { row.binding.userTicketId = row.operatorReviewDisposition.userTicketId = "ticket-1"; }],
  ["numeric member instead of string", row => { row.binding.memberId = row.operatorReviewDisposition.memberId = 10001; }],
  ["numeric ticket instead of string", row => { row.binding.userTicketId = row.operatorReviewDisposition.userTicketId = 20001; }],
  ["marker schema", row => { row.operatorReviewDisposition.schemaVersion = 2; }],
  ["wrong policy", row => { row.operatorReviewDisposition.policy = "other_policy"; }],
  ["wrong marker status", row => { row.operatorReviewDisposition.status = "review"; }],
  ["replay allowed", row => { row.operatorReviewDisposition.noReplay = false; }],
  ["missing no-replay guard", row => { delete row.operatorReviewDisposition.noReplay; }],
  ["send allowed", row => { row.operatorReviewDisposition.sendAllowed = true; }],
  ["missing send guard", row => { delete row.operatorReviewDisposition.sendAllowed; }],
  ["missing approval", row => { delete row.operatorReviewDisposition.approvalReference; }],
  ["blank approval", row => { row.operatorReviewDisposition.approvalReference = " "; }],
  ["invalid close time", row => { row.operatorReviewDisposition.closedAt = "invalid"; }],
  ["missing close time", row => { delete row.operatorReviewDisposition.closedAt; }],
  ["future close time", row => { row.operatorReviewDisposition.closedAt = "2026-10-21T08:00:00.001Z"; }],
];
for (const [name, mutate] of invalidReviewClosures) {
  test(`operator review closure rejects ${name} and keeps the contract visible`, async () => {
    const source = reviewClosedContract(); mutate(source);
    const before = structuredClone(source);
    const h = harness({ contracts: [source], profiles: [hintProfile()] });
    assert.equal(h.api.memberRegistrationReviewClosed(source), false);
    const entry = registrationEntry({ contracts: [source] });
    assert.equal(h.api.memberRegistrationOpenEntry(entry), entry);
    const data = await h.load();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].memberId, String(source.binding?.memberId || "10001"));
    assert.notEqual(data.items[0].status, "completed");
    assert.deepEqual(source, before);
  });
}

test("out-of-studio or unbound contracts cannot establish an operator closure", async () => {
  for (const mutate of [row => { row.studioId = "5331"; }, row => { delete row.binding; }]) {
    const source = reviewClosedContract(); mutate(source);
    const h = harness({ contracts: [source], profiles: [hintProfile()] });
    assert.equal(h.api.memberRegistrationReviewClosed(source), false);
    const entry = registrationEntry({ contracts: [source] });
    assert.equal(h.api.memberRegistrationOpenEntry(entry), entry);
    const withoutMarker = structuredClone(source);
    delete withoutMarker.operatorReviewDisposition;
    assert.deepEqual(plain(await h.load()), plain(await harness({ contracts: [withoutMarker], profiles: [hintProfile()] }).load()));
  }
});

test("operator closure expires related hints, candidates and sends inclusively at their close time", () => {
  const h = harness();
  const first = reviewClosedContract();
  first.operatorReviewDisposition.closedAt = OLD;
  const last = reviewClosedContract();
  last.id = last.contractId = last.binding.contractId = last.operatorReviewDisposition.contractId = "b".repeat(64);
  const records = [OLD, CLOSED_AT, NEW].map(updatedAt => ({ contractId: last.contractId, updatedAt }));
  const entry = registrationEntry({ contracts: [first, last], hints: records, candidates: records, sends: records });
  const before = structuredClone(entry);
  const open = h.api.memberRegistrationOpenEntry(entry);
  assert.deepEqual(plain(open.contracts), []);
  for (const field of ["hints", "candidates", "sends"]) assert.deepEqual(plain(open[field]), [records[2]], field);
  assert.equal(open.profiles, entry.profiles);
  assert.deepEqual(entry, before);
  last.operatorReviewDisposition.closedAt = NOW;
  assert.equal(h.api.memberRegistrationReviewClosed(last), true);
});

test("each item-time field can preserve genuinely new work after operator closure", () => {
  const h = harness();
  for (const field of ["updatedAt", "createdAt", "discoveredAt", "sourceDownloadedAt", "sentAt", "completion"]) {
    const record = { contractId: "a".repeat(64), updatedAt: OLD, [field]: field === "completion" ? { checkedAt: NEW } : NEW };
    const open = h.api.memberRegistrationOpenEntry(registrationEntry({ hints: [record], candidates: [record], sends: [record] }));
    for (const collection of ["hints", "candidates", "sends"]) assert.deepEqual(plain(open[collection]), [record], `${collection}.${field}`);
  }
});

test("operator closure leaves a different member's pending review unchanged", async () => {
  const phone = "01000000002";
  const other = contract({ id: "b".repeat(64), status: "review", welcomeCandidateId: undefined,
    welcomeStatus: undefined, completion: undefined,
    binding: { memberId: "10002", memberPhone: phone, userTicketId: "20002" } });
  const options = { contracts: [other], profiles: [hintProfile(), hintProfile({ id: "10002", memberId: "10002", phone })] };
  const baseline = plain(await harness(options).load());
  const result = plain(await harness({ ...options, contracts: [reviewClosedContract(), other] }).load());
  assert.deepEqual(result, baseline);
  assert.equal(result.items[0].memberId, "10002");
  assert.equal(result.items[0].status, "review");
});

test("a contract created after closure reappears as pending, never signed or completed", async () => {
  const next = contract({ id: "b".repeat(64), status: "waiting", updatedAt: NEW,
    completion: undefined, welcomeCandidateId: undefined, welcomeStatus: undefined });
  const options = { contracts: [next], profiles: [hintProfile()] };
  const baseline = plain(await harness(options).load());
  const data = plain(await harness({ ...options, contracts: [reviewClosedContract(), next] }).load());
  assert.deepEqual(data, baseline);
  assert.equal(data.items[0].status, "active");
  assert.equal(data.items[0].steps.find(step => step.name === "서명").status, "active");
  assert.equal(data.counts.completed, 0);
});

test("a genuinely new hint reappears after closure while profile-only and old history stay absent", async () => {
  const options = { contracts: [reviewClosedContract()], profiles: [hintProfile({ updatedAt: NEW })],
    candidates: [candidate()], sends: [send()] };
  assert.equal((await harness(options).load()).items.length, 0);
  for (const discoveredAt of [OLD, CLOSED_AT]) {
    assert.equal((await harness({ ...options, hints: [unverifiedHint({ contractId: "a".repeat(64), discoveredAt })] }).load()).items.length, 0);
  }
  const data = await harness({ ...options, hints: [unverifiedHint({ contractId: "a".repeat(64), discoveredAt: NEW })] }).load();
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].status, "observation");
  assert.equal(data.items[0].steps.find(step => step.name === "계약서").status, "pending");
});

test("an older other active contract preserves its hints and welcome history despite a later closure", async () => {
  const active = contract({ id: "c".repeat(64), status: "waiting", completion: undefined,
    welcomeStatus: undefined, updatedAt: OLD });
  const options = { contracts: [active], profiles: [hintProfile()], hints: [purchaseHint()],
    candidates: [candidate()], sends: [send()] };
  const h = harness(options);
  const pending = contract({ ...active, welcomeCandidateId: undefined });
  const pendingData = await harness({ contracts: [pending, reviewClosedContract()] }).load();
  assert.equal(pendingData.items.length, 1);
  assert.equal(pendingData.items[0].status, "active");
  const entry = registrationEntry({ contracts: [active, reviewClosedContract()] });
  const open = h.api.memberRegistrationOpenEntry(entry);
  assert.deepEqual(plain(open.contracts), plain([active]));
  for (const field of ["hints", "candidates", "sends"]) assert.equal(open[field], entry[field]);
  const baseline = plain(await h.load());
  const data = plain(await harness({ ...options, contracts: [active, reviewClosedContract()] }).load());
  assert.deepEqual(data, baseline);
  assert.equal(data.items[0].status, "review");
  assert.equal(data.items[0].reason, welcomeReasons.history_time_limit);
});

test("closure suppresses old records only with an explicit matching identity or source reference", () => {
  const h = harness();
  for (const reference of [
    { contractId: "a".repeat(64) }, { sourceContractId: "a".repeat(64) },
    { binding: { contractId: "a".repeat(64) } },
    { jobKey: "original-contract-job" }, { selectionJobKey: "original-contract-job" },
    { memberId: "10001" }, { binding: { memberId: "10001" } }, { completion: { memberId: "10001" } },
    { memberId: "10001", userTicketId: "20001" },
  ]) {
    const record = { updatedAt: OLD, ...reference };
    const entry = registrationEntry({ hints: [record], candidates: [record], sends: [record] });
    const before = structuredClone(entry);
    const open = h.api.memberRegistrationOpenEntry(entry);
    for (const field of ["hints", "candidates", "sends"]) assert.deepEqual(plain(open[field]), [], JSON.stringify(reference));
    assert.deepEqual(entry, before);
  }
});

const unrelatedClosureRecords = [
  ["anonymous phone-only record", {}],
  ["anonymous ticket-only record", { userTicketId: "20001" }],
  ["different member", { memberId: "10002" }],
  ["different bound member", { binding: { memberId: "10002" } }],
  ["different completion member", { completion: { memberId: "10002" } }],
  ["different member despite exact contract", { memberId: "10002", contractId: "a".repeat(64) }],
  ["different ticket", { memberId: "10001", userTicketId: "20002" }],
  ["different bound ticket", { memberId: "10001", binding: { userTicketId: "20002" } }],
  ["different ticket despite exact contract", { contractId: "a".repeat(64), userTicketId: "20002" }],
  ["different contract", { memberId: "10001", contractId: "b".repeat(64) }],
  ["different source contract", { memberId: "10001", sourceContractId: "b".repeat(64) }],
  ["different bound contract", { memberId: "10001", binding: { contractId: "b".repeat(64) } }],
  ["different job", { memberId: "10001", jobKey: "other-contract-job" }],
  ["different selection job", { memberId: "10001", selectionJobKey: "other-contract-job" }],
  ["ambiguous names despite exact member", { memberId: "10001", ambiguousNames: true }],
  ["ambiguous names despite exact contract", { contractId: "a".repeat(64), ambiguousNames: true }],
];
for (const [name, reference] of unrelatedClosureRecords) {
  test(`operator closure preserves ${name} in the same phone group`, () => {
    const record = { memberPhone: PHONE, updatedAt: OLD, ...reference };
    const entry = registrationEntry({ hints: [record], candidates: [record], sends: [record] });
    const before = structuredClone(entry);
    const open = harness().api.memberRegistrationOpenEntry(entry);
    for (const field of ["hints", "candidates", "sends"]) assert.deepEqual(plain(open[field]), [record], field);
    assert.deepEqual(entry, before);
  });
}

test("same-phone other member's failed welcome remains visible without another open contract", async () => {
  const options = { contracts: [], profiles: [hintProfile({ id: "10002", memberId: "10002" })],
    candidates: [candidate({ memberId: "10002" })], sends: [send({ memberId: "10002" })] };
  const baseline = plain(await harness(options).load());
  const data = plain(await harness({ ...options, contracts: [reviewClosedContract()] }).load());
  assert.deepEqual(data, baseline);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].memberId, "10002");
  assert.equal(data.items[0].status, "review");
  assert.equal(data.items[0].reason, welcomeReasons.history_time_limit);
});

test("anonymous old hint remains an observation after same-phone contract closure", async () => {
  const options = { contracts: [], profiles: [hintProfile()], hints: [unverifiedHint()] };
  const baseline = plain(await harness(options).load());
  const data = plain(await harness({ ...options, contracts: [reviewClosedContract()] }).load());
  assert.deepEqual(data, baseline);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].status, "observation");
});

test("a legacy hint's exact recovery receipt connects only its own closed contract", async () => {
  const receipt = { type: "dispatch_accepted_not_all_signed", signatureCompletion: "not_asserted",
    contractId: "a".repeat(64), memberId: "10001", userTicketId: "20001", jobId: "original-contract-job" };
  const hint = unverifiedHint({ status: "review", reason: "official_seal_outcome_unknown",
    signatureMaintenanceRecoveryClosure: receipt });
  const options = { contracts: [reviewClosedContract()], hints: [hint], profiles: [hintProfile()] };
  assert.equal((await harness(options).load()).counts.review, 0);
  for (const field of Object.keys(receipt)) {
    const changed = { ...hint, signatureMaintenanceRecoveryClosure: { ...receipt, [field]: "mismatch" } };
    assert.equal((await harness({ ...options, hints: [changed] }).load()).counts.review, 1, field);
  }
  for (const extra of [{ memberId: "10002" }, { userTicketId: "20002" }, { contractId: "b".repeat(64) },
    { jobKey: "other-job" }, { ambiguousNames: true }, { discoveredAt: NEW }]) {
    assert.equal((await harness({ ...options, hints: [{ ...hint, ...extra }] }).load()).counts.review, 1, JSON.stringify(extra));
  }
});

test("a later unrelated closure cannot suppress work newer than its own referenced closure", () => {
  const first = reviewClosedContract();
  first.operatorReviewDisposition.closedAt = OLD;
  const second = reviewClosedContract();
  second.id = second.contractId = second.binding.contractId = second.operatorReviewDisposition.contractId = "b".repeat(64);
  second.binding.selectionJobKey = "later-contract-job";
  for (const reference of [{ contractId: first.contractId }, { sourceContractId: first.contractId },
    { binding: { contractId: first.contractId } }, { jobKey: first.binding.selectionJobKey },
    { selectionJobKey: first.binding.selectionJobKey }]) {
    const record = { updatedAt: CLOSED_AT, ...reference };
    const entry = registrationEntry({ contracts: [first, second], hints: [record], candidates: [record], sends: [record] });
    const open = harness().api.memberRegistrationOpenEntry(entry);
    for (const field of ["hints", "candidates", "sends"]) assert.deepEqual(plain(open[field]), [record], JSON.stringify(reference));
  }
});
