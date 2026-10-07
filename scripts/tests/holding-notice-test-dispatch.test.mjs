import test from "node:test";
import assert from "node:assert/strict";
import {
  dispatchHoldingNoticeSample,
  holdingNoticeSample,
  holdingNoticeSamplePlan,
  reconcileHoldingNoticeSample,
  completeProviderRows,
} from "../lib/holding-notice-test-dispatch.mjs";
import { HOLDING_NOTICE_TEMPLATE, HOLDING_NOTICE_TEMPLATE_ID } from "../lib/holding-allowance-notice.mjs";

const RECIPIENT = { memberId: "1982133", name: "김기효", phone: "01086488585" };
const DATE = "2026-10-06";
const STAMP = "2026-10-06T06:00:00.000Z";
const approvedTemplate = () => ({ ...structuredClone(HOLDING_NOTICE_TEMPLATE), templateId: HOLDING_NOTICE_TEMPLATE_ID, status: "APPROVED" });
const acceptance = () => ({ messageList: [{ to: RECIPIENT.phone, messageId: "fixture-message", groupId: "fixture-group", kakaoOptions: { templateId: HOLDING_NOTICE_TEMPLATE_ID } }] });

class FakeFirestore {
  constructor({ failBatches = [] } = {}) {
    this.docs = new Map();
    this.versions = new Map();
    this.failBatches = new Set(failBatches);
    this.transactionCalls = 0;
    this.transactionRetries = 0;
    this.transactionCommits = 0;
    this.batchCalls = 0;
    this.batchAttempts = 0;
    this.writeCount = 0;
    this.readCalls = [];
  }

  collection(name) {
    assert.ok(["alimtalkCandidates", "alimtalkSends"].includes(name), `Unexpected collection: ${name}`);
    return { doc: (id) => this.doc(`${name}/${id}`) };
  }

  doc(path) {
    assert.match(path, /^(alimtalkCandidates|alimtalkSends)\/[^/]+$/);
    return {
      path,
      get: async () => {
        this.readCalls.push(path);
        return { exists: this.docs.has(path), data: () => this.read(path) };
      },
    };
  }

  read(path) {
    return structuredClone(this.docs.get(path));
  }

  seed(path, data) {
    this.docs.set(path, structuredClone(data));
    this.versions.set(path, (this.versions.get(path) || 0) + 1);
  }

  // Snapshot reads and version validation model optimistic contention, not serial callbacks.
  async runTransaction(callback) {
    this.transactionCalls += 1;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const snapshot = new Map([...this.docs].map(([path, data]) => [path, structuredClone(data)]));
      const versions = new Map(this.versions);
      const reads = new Set();
      const writes = new Map();
      const tx = {
        get: async (ref) => {
          assert.equal(writes.size, 0, "Transaction reads must precede writes");
          reads.add(ref.path);
          return { exists: snapshot.has(ref.path), data: () => structuredClone(snapshot.get(ref.path)) };
        },
        create: (ref, data) => {
          assert.ok(!snapshot.has(ref.path), "create must not overwrite a document");
          assert.ok(!writes.has(ref.path), "create must not be duplicated");
          writes.set(ref.path, structuredClone(data));
        },
      };
      const result = await callback(tx);
      if ([...reads].some((path) => (versions.get(path) || 0) !== (this.versions.get(path) || 0))) {
        this.transactionRetries += 1;
        continue;
      }
      for (const path of writes.keys()) assert.ok(!this.docs.has(path), "create precondition failed");
      for (const [path, data] of writes) this.seed(path, data);
      this.writeCount += writes.size;
      this.transactionCommits += 1;
      return result;
    }
    throw new Error("Fake transaction retry limit exceeded");
  }

  batch() {
    this.batchCalls += 1;
    const updates = new Map();
    return {
      update: (ref, data) => updates.set(ref.path, structuredClone(data)),
      commit: async () => {
        this.batchAttempts += 1;
        if (this.failBatches.has(this.batchAttempts)) throw new Error(`Fixture batch failure ${this.batchAttempts}`);
        for (const path of updates.keys()) assert.ok(this.docs.has(path), "update requires an existing document");
        for (const [path, data] of updates) this.seed(path, { ...this.docs.get(path), ...data });
        this.writeCount += updates.size;
      },
    };
  }
}

function fixture({ failBatches, respond = acceptance } = {}) {
  const db = new FakeFirestore({ failBatches });
  const posts = [];
  const plan = holdingNoticeSamplePlan(RECIPIENT, DATE, approvedTemplate());
  const paths = { candidate: `alimtalkCandidates/${plan.id}`, send: `alimtalkSends/${plan.id}` };
  const request = async (url, method, body) => {
    if (!method) return { messageList: { "recipient-not-proven": { messageId: "recipient-not-proven", to: RECIPIENT.phone,
      kakaoOptions: { templateId: HOLDING_NOTICE_TEMPLATE_ID } } } };
    assert.equal(db.read(paths.candidate)?.status, "reviewed", "Candidate claim must precede POST");
    assert.equal(db.read(paths.send)?.status, "processing", "Send claim must precede POST");
    assert.equal(db.writeCount, 2, "Both claims must be atomically persisted before POST");
    assert.equal(url, "/messages/v4/send-many/detail");
    assert.equal(method, "POST");
    posts.push({ url, method, body: structuredClone(body) });
    return respond();
  };
  const run = (patch = {}) => dispatchHoldingNoticeSample({
    db, stamp: () => STAMP, recipient: { ...RECIPIENT }, date: DATE,
    template: approvedTemplate(), request, confirmed: true, ...patch,
  });
  return { db, posts, plan, paths, run };
}

function assertUntouched(h) {
  assert.equal(h.db.docs.size, 0);
  assert.equal(h.db.transactionCalls, 0);
  assert.equal(h.db.batchCalls, 0);
  assert.equal(h.db.writeCount, 0);
  assert.equal(h.posts.length, 0);
}

async function assertReplayBlocked(h) {
  const before = structuredClone([...h.db.docs]);
  const writes = h.db.writeCount;
  const result = await h.run();
  assert.deepEqual(result, { ok: true, duplicateBlocked: true, id: h.plan.id, providerPostCount: 0 });
  assert.equal(h.posts.length, 1);
  assert.equal(h.db.writeCount, writes);
  assert.deepEqual([...h.db.docs], before);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("exact recipient produces the synthetic 16/7/9 fixture and stays outside the automatic queue", async () => {
  const h = fixture();
  assert.deepEqual(h.plan.summary, { ok: true, originalDays: 84, totalDays: 16, usedDays: 7, remainingDays: 9, overageDays: 0 });
  assert.equal(h.plan.sendAllowed, false);
  assert.equal(h.plan.snapshot.holds[0].end, "2026-10-12");
  const result = await h.run();
  assert.equal(result.providerPostCount, 1);
  assert.equal(result.messageId, "fixture-message");
  assert.equal(result.groupId, "fixture-group");
  assert.deepEqual(result.summary, h.plan.summary);
  assert.equal(result.message, h.plan.message);
  assert.equal(/#\{/.test(result.message), false);
  assert.deepEqual(h.posts[0].body, {
    messages: [{ to: RECIPIENT.phone, type: "ATA", kakaoOptions: {
      pfId: HOLDING_NOTICE_TEMPLATE.channelId, templateId: HOLDING_NOTICE_TEMPLATE_ID,
      disableSms: true, variables: h.plan.variables,
    } }], strict: true, allowDuplicates: false, showMessageList: true,
  });
  assert.equal(h.plan.variables["#{전체홀딩일수}"], "16");
  assert.equal(h.plan.variables["#{사용홀딩일수}"], "7");
  assert.equal(h.plan.variables["#{잔여홀딩일수}"], "9");
  const candidate = h.db.read(h.paths.candidate);
  const send = h.db.read(h.paths.send);
  assert.equal(candidate.type, "manual_review");
  assert.equal(candidate.status, "sent");
  assert.equal(candidate.isTest, true);
  assert.equal(candidate.attempts, 1);
  assert.equal(candidate.maxAttempts, 1);
  assert.equal(candidate.queuedBy, "operator");
  assert.deepEqual(candidate.payload, { deliveryMode: "sample", source: "holding_notice_operator_sample" });
  assert.equal(send.status, "done");
  assert.equal(send.solapiMessageId, result.messageId);
  assert.equal(send.solapiGroupId, result.groupId);
  assert.equal(send.isTest, true);
  assert.equal(send.maxAttempts, 1);
  assert.deepEqual(send.variables, h.plan.variables);
  assert.equal(h.db.docs.size, 2);
  await assertReplayBlocked(h);
});

test("every recipient identity field must match exactly before any writes or POST", async (t) => {
  for (const field of Object.keys(RECIPIENT)) {
    const mismatches = [undefined, null, "", 0, false, {}, "different", ` ${RECIPIENT[field]}`, `${RECIPIENT[field]} `];
    if (field === "memberId") mismatches.push(Number(RECIPIENT.memberId), "excel_1982133", "01982133");
    if (field === "name") mismatches.push("김 기효", "김기효 테스트");
    if (field === "phone") mismatches.push("010-8648-8585", "+821086488585", Number(RECIPIENT.phone));
    for (const [index, value] of mismatches.entries()) {
      await t.test(`${field} mismatch ${index}`, async () => {
        const h = fixture();
        const recipient = { ...RECIPIENT, [field]: value };
        assert.throws(() => holdingNoticeSample(recipient, DATE), /Only the registered/);
        await assert.rejects(h.run({ recipient }), /Only the registered/);
        assertUntouched(h);
      });
    }
  }
  for (const recipient of [undefined, null, {}, []]) {
    const h = fixture();
    await assert.rejects(h.run({ recipient }), /Only the registered/);
    assertUntouched(h);
  }
});

test("valid sample dates include leap days and calendar boundaries", () => {
  for (const [start, end] of [[DATE, "2026-10-12"], ["2028-02-29", "2028-03-06"], ["2026-12-29", "2027-01-04"], ["2026-01-29", "2026-02-04"]]) {
    const sample = holdingNoticeSample(RECIPIENT, start);
    assert.equal(sample.holds[0].start, start);
    assert.equal(sample.holds[0].end, end);
    assert.equal(holdingNoticeSamplePlan(RECIPIENT, start, approvedTemplate()).snapshot.holds[0].start, DATE);
  }
});

test("invalid and non-date inputs block dispatch before writes or POST", async () => {
  for (const date of [undefined, null, "", 20261006, {}, [], "not-a-date", "2026-02-29", "2026-02-30", "2026-04-31", "2026-00-06", "2026-13-06", "2026-10-00", "2026-10-32", "2026-1-06", "2026-10-6", "2026-10-06 ", "2026-10-06T00:00:00Z"]) {
    const h = fixture();
    await assert.rejects(h.run({ date }), /Invalid sample date/);
    assertUntouched(h);
  }
});

test("confirmation must be literal true before writes or POST", async () => {
  for (const confirmed of [undefined, null, false, 0, 1, "true", {}, []]) {
    const h = fixture();
    await assert.rejects(h.run({ confirmed }), /Explicit live-test confirmation required/);
    assertUntouched(h);
  }
});

test("unapproved, missing or mismatched template contracts cause no writes or POST", async () => {
  const contracts = [undefined, null, {}, ...[
    { status: "INSPECTING" }, { status: "REJECTED" }, { status: "approved" }, { status: undefined },
    { templateId: "wrong" }, { name: "wrong" }, { channelId: "wrong" }, { messageType: "AT" },
    { emphasizeType: "NONE" }, { imageId: "wrong" }, { content: "wrong" },
    { buttons: [{}] }, { buttons: undefined }, { quickReplies: [{}] },
  ].map((patch) => ({ ...approvedTemplate(), ...patch }))];
  for (const template of contracts) {
    const h = fixture();
    await assert.rejects(h.run({ template }), /template_/);
    assertUntouched(h);
  }
});

test("concurrent dispatch and in-flight replay commit one claim and POST exactly once", async () => {
  const entered = deferred();
  const release = deferred();
  const h = fixture({ respond: async () => { entered.resolve(); await release.promise; return acceptance(); } });
  const calls = Array.from({ length: 8 }, () => h.run());
  try {
    await entered.promise;
    assert.equal(h.posts.length, 1);
    assert.equal(h.db.docs.size, 2);
    assert.equal(h.db.read(h.paths.send).status, "processing");
    await assertReplayBlocked(h);
  } finally {
    release.resolve();
  }
  const results = await Promise.all(calls);
  assert.equal(results.filter((result) => result.providerPostCount === 1).length, 1);
  assert.equal(results.filter((result) => result.duplicateBlocked).length, 7);
  assert.ok(h.db.transactionRetries > 0, "Contention must actually retry a transaction");
  assert.equal(h.posts.length, 1);
  assert.equal(h.db.writeCount, 4);
  assert.equal(h.db.read(h.paths.send).status, "done");
  await assertReplayBlocked(h);
});

test("either pre-existing candidate or send record blocks dispatch regardless of status", async () => {
  for (const path of ["candidate", "send"]) {
    for (const status of ["reviewed", "processing", "sent", "done", "failed"]) {
      const h = fixture();
      h.db.seed(h.paths[path], { status });
      const before = structuredClone([...h.db.docs]);
      const result = await h.run();
      assert.equal(result.duplicateBlocked, true);
      assert.equal(result.providerPostCount, 0);
      assert.equal(h.posts.length, 0);
      assert.equal(h.db.writeCount, 0);
      assert.equal(h.db.batchCalls, 0);
      assert.deepEqual([...h.db.docs], before);
    }
  }
});

test("v2 test identity is stable across days and a later execution cannot resend", async () => {
  const h = fixture();
  assert.equal(h.plan.id, "holding_v2_operator_test_20261006");
  assert.equal(holdingNoticeSamplePlan(RECIPIENT, "2026-10-07", approvedTemplate()).id, h.plan.id);
  await h.run();
  const replay = await h.run({ date: "2026-10-07" });
  assert.equal(replay.duplicateBlocked, true);
  assert.equal(h.posts.length, 1);
});

test("provider history must be structurally complete", () => {
  for (const response of [null, {}, { messageList: null }, { messageList: "invalid" },
    { messageList: {}, nextKey: "more" }, { messageList: { broken: null } }])
    assert.throws(() => completeProviderRows(response));
  assert.deepEqual(completeProviderRows({ messageList: {} }), []);
});

test("fresh later-date dispatch freezes persisted date and variables", async () => {
  const h = fixture();
  await h.run({ date: "2026-10-07" });
  assert.equal(h.db.read(h.paths.candidate).sourceDate, DATE);
  assert.deepEqual(h.db.read(h.paths.send).variables, h.plan.variables);
});

test("wrong-template and multiple acceptance receipts block success", async () => {
  for (const response of [
    { messageList: [{ ...acceptance().messageList[0], kakaoOptions: { templateId: "wrong" } }] },
    { messageList: [acceptance().messageList[0], { ...acceptance().messageList[0], messageId: "second" }] },
  ]) {
    const h = fixture({ respond: () => response });
    await assert.rejects(h.run(), /acceptance not proven/);
    await assertReplayBlocked(h);
  }
});

test("ID-only lookup timeout preserves provisional receipt and blocks retry", async () => {
  const h = fixture();
  let posts = 0;
  await assert.rejects(h.run({ request: async (_url, method) => {
    if (method === "POST") { posts++; return { messageList: [{ messageId: "provisional", groupId: "group" }] }; }
    throw new Error("Lookup timeout");
  } }), /Lookup timeout/);
  assert.equal(posts, 1);
  assert.equal(h.db.read(h.paths.send).solapiMessageId, "provisional");
  assert.equal(h.db.read(h.paths.send).solapiGroupId, "group");
  assert.equal((await h.run()).duplicateBlocked, true);
});

test("provider timeout is held as unknown and cannot be retried", async () => {
  const timeout = new Error("Fixture provider timeout after possible acceptance");
  const h = fixture({ respond: () => { throw timeout; } });
  await assert.rejects(h.run(), (error) => error === timeout);
  assert.equal(h.db.read(h.paths.candidate).reasonCode, "holding_test_reconciliation_required");
  assert.equal(h.db.read(h.paths.send).status, "failed");
  assert.equal(h.db.read(h.paths.send).providerOutcome, "unknown");
  assert.match(h.db.read(h.paths.send).lastError, /do not resend/);
  await assertReplayBlocked(h);
});

test("rejected, missing-ID and wrong-recipient responses retain claims and forbid rePOST", async (t) => {
  const cases = [
    ["provider rejection", { ...acceptance(), failedMessageList: [{ statusMessage: "rejected" }] }],
    ["missing message ID", { messageList: [{ to: RECIPIENT.phone }] }],
    ["empty message ID", { messageList: [{ to: RECIPIENT.phone, messageId: "" }] }],
    ["group ID alone", { groupInfo: { groupId: "not-a-message-ID" } }],
    ["empty response", {}],
    ["wrong recipient", { messageList: [{ to: "01000000000", messageId: "wrong-recipient" }] }],
    ["null response", null],
  ];
  for (const [name, response] of cases) {
    await t.test(name, async () => {
      const h = fixture({ respond: () => response });
      await assert.rejects(h.run());
      assert.equal(h.db.docs.size, 2);
      assert.equal(h.db.read(h.paths.candidate).status, "failed");
      assert.equal(h.db.read(h.paths.send).providerOutcome, "unknown");
      assert.equal(h.db.read(h.paths.send).solapiMessageId, undefined);
      await assertReplayBlocked(h);
    });
  }
});

test("object-shaped accepted message list uses the groupInfo fallback", async () => {
  const h = fixture({ respond: () => ({ messageList: { first: { to: RECIPIENT.phone, messageId: "object-message", kakaoOptions: { templateId: HOLDING_NOTICE_TEMPLATE_ID } } }, groupInfo: { groupId: "object-group" } }) });
  const result = await h.run();
  assert.equal(result.messageId, "object-message");
  assert.equal(result.groupId, "object-group");
  assert.equal(h.db.read(h.paths.send).solapiGroupId, "object-group");
});

test("provider acceptance plus success-ledger failure retains claims and forbids rePOST", async () => {
  const h = fixture({ failBatches: [1] });
  await assert.rejects(h.run(), /Fixture batch failure 1/);
  assert.equal(h.posts.length, 1);
  assert.equal(h.db.docs.size, 2);
  assert.equal(h.db.batchAttempts, 2);
  assert.equal(h.db.read(h.paths.candidate).status, "failed");
  assert.equal(h.db.read(h.paths.send).providerOutcome, "accepted_ledger_error");
  assert.match(h.db.read(h.paths.send).lastError, /Provider accepted/);
  assert.equal(h.db.read(h.paths.send).solapiMessageId, acceptance().messageList[0].messageId);
  await assertReplayBlocked(h);
});

test("failure of both ledger batches still preserves the original durable claim", async () => {
  const h = fixture({ failBatches: [1, 2] });
  await assert.rejects(h.run(), /Fixture batch failure 1/);
  assert.equal(h.db.batchAttempts, 2);
  assert.equal(h.db.writeCount, 2);
  assert.equal(h.db.read(h.paths.candidate).status, "reviewed");
  assert.equal(h.db.read(h.paths.send).status, "processing");
  await assertReplayBlocked(h);
});

test("unknown provider outcome plus reconciliation-write failure still forbids rePOST", async () => {
  const timeout = new Error("Fixture provider timeout");
  const h = fixture({ failBatches: [1], respond: () => { throw timeout; } });
  await assert.rejects(h.run(), (error) => error === timeout);
  assert.equal(h.db.writeCount, 2);
  assert.equal(h.db.read(h.paths.send).status, "processing");
  await assertReplayBlocked(h);
});

test("documented ID-only acceptance is independently resolved before accepting", async () => {
  const h = fixture({ respond: () => ({ messageList: [{ messageId: "recipient-not-proven" }] }) });
  const result = await h.run();
  assert.equal(result.messageId, "recipient-not-proven");
  assert.equal(h.db.read(h.paths.send).status, "done");
  await assertReplayBlocked(h);
});

test("ID-only acceptance with unproven provider identity retains the claim", async () => {
  const h = fixture({ respond: () => ({ messageList: [{ messageId: "unproven" }] }) });
  await assert.rejects(h.run(), /acceptance not proven/);
  assert.equal(h.db.read(h.paths.send).providerOutcome, "unknown");
  await assertReplayBlocked(h);
});

test("an object-shaped failed-message list prevents acceptance", async () => {
  const h = fixture({ respond: () => ({ ...acceptance(), failedMessageList: { failure: { statusMessage: "rejected" } } }) });
  await assert.rejects(h.run(), /acceptance not proven/);
  assert.equal(h.db.read(h.paths.send).providerOutcome, "unknown");
  await assertReplayBlocked(h);
});

function reconciliationFixture({ respond, failBatches } = {}) {
  const db = new FakeFirestore({ failBatches });
  const plan = holdingNoticeSamplePlan(RECIPIENT, DATE, approvedTemplate());
  const paths = { candidate: `alimtalkCandidates/${plan.id}`, send: `alimtalkSends/${plan.id}` };
  db.seed(paths.candidate, {
    candidateId: plan.id, sourceActionKey: plan.id, dedupeKey: plan.id, sourceDate: DATE,
    studioId: "5330", memberId: RECIPIENT.memberId, memberName: RECIPIENT.name, memberPhone: RECIPIENT.phone,
    templateCode: HOLDING_NOTICE_TEMPLATE_ID, isTest: true, type: "manual_review", status: "failed",
    payload: { deliveryMode: "sample", source: "holding_notice_operator_sample" },
    reasonCode: "holding_test_reconciliation_required", lastError: "Fixture unknown provider outcome",
  });
  db.seed(paths.send, {
    sendId: plan.id, candidateId: plan.id, dedupeKey: plan.id, studioId: "5330",
    memberId: RECIPIENT.memberId, memberName: RECIPIENT.name, memberPhone: RECIPIENT.phone,
    templateCode: HOLDING_NOTICE_TEMPLATE_ID, variables: structuredClone(plan.variables),
    createdByUid: "codex:operator-approved-holding-test", isTest: true, status: "failed",
    providerOutcome: "unknown", attempts: 1, maxAttempts: 1, lastError: "Fixture unknown provider outcome",
  });
  const delivered = {
    messageId: "reconciled-message", groupId: "reconciled-group", to: RECIPIENT.phone,
    type: "ATA", text: plan.message, statusCode: "4000", status: "COMPLETE",
    kakaoOptions: { templateId: HOLDING_NOTICE_TEMPLATE_ID, pfId: HOLDING_NOTICE_TEMPLATE.channelId,
      disableSms: true, variables: structuredClone(plan.variables) },
  };
  const requests = [];
  const request = async (url, method, body) => {
    requests.push({ url, method: method || "GET", body });
    assert.equal(method || "GET", "GET", "Reconciliation must never POST");
    assert.equal(body, undefined);
    const parsed = new URL(url, "https://fixture.invalid");
    assert.equal(parsed.pathname, "/messages/v4/list");
    assert.equal(parsed.searchParams.get("startDate"), `${DATE}T00:00:00+09:00`);
    assert.equal(parsed.searchParams.get("dateType"), "CREATED");
    assert.equal(parsed.searchParams.get("type"), "ATA");
    assert.equal(parsed.searchParams.get("to"), RECIPIENT.phone);
    assert.equal(parsed.searchParams.get("limit"), "500");
    assert.ok(Number.isFinite(Date.parse(parsed.searchParams.get("endDate"))));
    return respond ? respond(delivered) : { messageList: { [delivered.messageId]: delivered } };
  };
  const run = (patch = {}) => reconcileHoldingNoticeSample({
    db, stamp: () => STAMP, recipient: { ...RECIPIENT }, date: DATE,
    template: approvedTemplate(), request, ...patch,
  });
  return { db, plan, paths, delivered, requests, run };
}

async function assertReconciliationBlocked(h, issue) {
  const before = structuredClone([...h.db.docs]);
  await assert.rejects(h.run(), issue);
  assert.equal(h.db.writeCount, 0);
  assert.deepEqual([...h.db.docs], before);
  assert.ok(h.requests.every(({ method }) => method === "GET"));
}

test("reconciliation completes a matching durable sample using GET only and all eight variables", async () => {
  const h = reconciliationFixture();
  assert.equal(Object.keys(h.plan.variables).length, 8);
  const result = await h.run();
  assert.deepEqual(result, { ok: true, id: h.plan.id, providerPostCount: 0,
    messageId: "reconciled-message", groupId: "reconciled-group", deliveryComplete: true });
  assert.equal(h.requests.length, 1);
  assert.equal(h.db.transactionCalls, 0);
  assert.equal(h.db.batchAttempts, 1);
  assert.equal(h.db.writeCount, 2);
  assert.equal(h.db.docs.size, 2);
  const candidate = h.db.read(h.paths.candidate);
  const send = h.db.read(h.paths.send);
  assert.equal(candidate.status, "sent");
  assert.equal(candidate.sentAt, STAMP);
  assert.equal(candidate.lastError, null);
  assert.equal(send.status, "done");
  assert.equal(send.providerOutcome, "delivered_reconciled");
  assert.equal(send.providerStatusCode, "4000");
  assert.equal(send.reconciledAt, STAMP);
  assert.equal(send.solapiMessageId, result.messageId);
  assert.equal(send.solapiGroupId, result.groupId);
  assert.equal(send.lastError, null);
  assert.deepEqual(send.variables, h.plan.variables);
});

test("reconciliation cannot replace an existing receipt", async () => {
  for (const patch of [{ solapiMessageId: "another-message" }, { solapiGroupId: "another-group" }]) {
    const h = reconciliationFixture();
    h.db.seed(h.paths.send, { ...h.db.read(h.paths.send), ...patch });
    await assertReconciliationBlocked(h, /receipt differs/);
  }
});

test("reconciliation rejects recipient, date and template input mismatches before GET or writes", async (t) => {
  const cases = [
    ["recipient ID", { recipient: { ...RECIPIENT, memberId: "different" } }],
    ["recipient name", { recipient: { ...RECIPIENT, name: "different" } }],
    ["recipient phone", { recipient: { ...RECIPIENT, phone: "01000000000" } }],
    ["invalid date", { date: "2026-02-29" }],
    ["unapproved template", { template: { ...approvedTemplate(), status: "INSPECTING" } }],
    ["wrong template ID", { template: { ...approvedTemplate(), templateId: "different" } }],
    ["wrong template body", { template: { ...approvedTemplate(), content: "different" } }],
  ];
  for (const [name, patch] of cases) {
    await t.test(name, async () => {
      const h = reconciliationFixture();
      const before = structuredClone([...h.db.docs]);
      await assert.rejects(h.run(patch));
      assert.deepEqual([...h.db.docs], before);
      assert.equal(h.db.writeCount, 0);
      assert.equal(h.db.batchCalls, 0);
      assert.equal(h.requests.length, 0);
    });
  }
});

test("reconciliation rejects a missing send claim before GET and a missing candidate without writes", async (t) => {
  for (const path of ["send", "candidate"]) {
    await t.test(`missing ${path}`, async () => {
      const h = reconciliationFixture();
      h.db.docs.delete(h.paths[path]);
      await assertReconciliationBlocked(h);
      if (path === "send") {
        assert.equal(h.requests.length, 0);
        assert.equal(h.db.batchCalls, 0);
      }
    });
  }
});

test("reconciliation rejects mismatched durable send claims before GET or writes", async (t) => {
  for (const patch of [
    { isTest: false }, { memberPhone: "01000000000" }, { memberId: "different" },
    { templateCode: "different" }, { dedupeKey: "different" }, { createdByUid: "different" },
    { variables: undefined }, { variables: {} },
  ]) {
    await t.test(Object.keys(patch)[0] + ": " + JSON.stringify(patch), async () => {
      const h = reconciliationFixture();
      h.db.seed(h.paths.send, { ...h.db.read(h.paths.send), ...patch });
      await assertReconciliationBlocked(h, /Matching durable test claim required/);
      assert.equal(h.requests.length, 0);
      assert.equal(h.db.batchCalls, 0);
    });
  }
});

test("reconciliation requires every variable in both durable claim and provider evidence", async (t) => {
  const keys = Object.keys(holdingNoticeSamplePlan(RECIPIENT, DATE, approvedTemplate()).variables);
  for (const location of ["claim", "provider"]) {
    for (const key of keys) {
      for (const mutation of ["missing", "mismatched"]) {
        await t.test(`${location} ${mutation} ${key}`, async () => {
          const h = reconciliationFixture();
          const record = location === "claim" ? h.db.read(h.paths.send) : h.delivered;
          const variables = location === "claim" ? record.variables : record.kakaoOptions.variables;
          if (mutation === "missing") delete variables[key];
          else variables[key] = "wrong";
          if (location === "claim") h.db.seed(h.paths.send, record);
          await assertReconciliationBlocked(h);
          assert.equal(h.db.batchCalls, 0);
          assert.equal(h.requests.length, location === "claim" ? 0 : 1);
        });
      }
    }
  }
});

test("reconciliation rejects mismatched provider recipient, template, text and receipt fields", async (t) => {
  const cases = [
    ["recipient", (row) => { row.to = "01000000000"; }],
    ["missing recipient", (row) => { delete row.to; }],
    ["template", (row) => { row.kakaoOptions.templateId = "different"; }],
    ["text", (row) => { row.text += " "; }],
    ["missing text", (row) => { delete row.text; }],
    ["SMS fallback enabled", (row) => { row.kakaoOptions.disableSms = false; }],
    ["missing SMS policy", (row) => { delete row.kakaoOptions.disableSms; }],
    ["missing message ID", (row) => { delete row.messageId; }],
    ["missing group ID", (row) => { delete row.groupId; }],
    ["missing variables", (row) => { delete row.kakaoOptions.variables; }],
    ["missing kakao options", (row) => { delete row.kakaoOptions; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const h = reconciliationFixture();
      mutate(h.delivered);
      await assertReconciliationBlocked(h, /Provider evidence ambiguous|Malformed provider history/);
      assert.equal(h.db.batchCalls, 0);
    });
  }
});

test("reconciliation blocks missing, ambiguous or paginated provider evidence without writes", async (t) => {
  const cases = [
    ["empty response", () => ({})],
    ["empty list", () => ({ messageList: {} })],
    ["null list", () => ({ messageList: null })],
    ["multiple exact matches", (row) => ({ messageList: { first: row, second: { ...row, messageId: "second-message" } } })],
    ["duplicate matching evidence", (row) => ({ messageList: { first: row, second: row } })],
    ["pagination", (row) => ({ messageList: { first: row }, nextKey: "fixture-next-page" })],
  ];
  for (const [name, respond] of cases) {
    await t.test(name, async () => {
      const h = reconciliationFixture({ respond });
      await assertReconciliationBlocked(h, /Provider evidence ambiguous|Incomplete provider history/);
      assert.equal(h.requests.length, 1);
      assert.equal(h.db.batchCalls, 0);
    });
  }
});

test("reconciliation requires both 4000 and COMPLETE, not acceptance or a partial status", async (t) => {
  for (const [statusCode, status] of [
    ["2000", "COMPLETE"], ["4000", "SENDING"], ["4000", "FAILED"],
    [undefined, "COMPLETE"], ["4000", undefined], ["4000", "complete"],
  ]) {
    await t.test(`${statusCode}/${status}`, async () => {
      const h = reconciliationFixture();
      Object.assign(h.delivered, { statusCode, status });
      await assertReconciliationBlocked(h, /Delivery not complete/);
      assert.equal(h.db.batchCalls, 0);
    });
  }
});

test("reconciliation can isolate one exact delivered row from unrelated evidence", async () => {
  const h = reconciliationFixture({ respond: (row) => ({ messageList: [
    { ...row, messageId: "other-recipient", to: "01000000000" }, row,
    { ...row, messageId: "other-template", kakaoOptions: { ...row.kakaoOptions, templateId: "different" } },
  ] }) });
  h.delivered.statusCode = 4000;
  assert.equal((await h.run()).deliveryComplete, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.db.writeCount, 2);
});

test("GET failure and reconciliation batch failure preserve existing claims without POST", async (t) => {
  for (const stage of ["GET", "batch"]) {
    await t.test(stage, async () => {
      const h = reconciliationFixture(stage === "GET"
        ? { respond: () => { throw new Error("Fixture GET failure"); } }
        : { failBatches: [1] });
      await assertReconciliationBlocked(h, /Fixture GET failure|Fixture batch failure/);
      assert.equal(h.requests.length, 1);
    });
  }
});

// These are rejection requirements, not characterizations that bless incomplete proof.
test("reconciliation rejects a mismatched candidate even with a matching send claim", async (t) => {
  for (const patch of [{ memberId: "different" }, { memberPhone: "01000000000" }, { templateCode: "different" }]) {
    await t.test(Object.keys(patch)[0], async () => {
      const h = reconciliationFixture();
      h.db.seed(h.paths.candidate, { ...h.db.read(h.paths.candidate), ...patch });
      await assertReconciliationBlocked(h);
    });
  }
});

test("reconciliation requires a literal true durable test marker", async () => {
  const h = reconciliationFixture();
  h.db.seed(h.paths.send, { ...h.db.read(h.paths.send), isTest: "true" });
  await assertReconciliationBlocked(h);
});

test("reconciliation rejects extra variables rather than accepting more than eight", async (t) => {
  for (const location of ["claim", "provider"]) {
    await t.test(location, async () => {
      const h = reconciliationFixture();
      if (location === "claim") {
        const ledger = h.db.read(h.paths.send);
        ledger.variables["#{unexpected}"] = "extra";
        h.db.seed(h.paths.send, ledger);
      } else {
        h.delivered.kakaoOptions.variables["#{unexpected}"] = "extra";
      }
      await assertReconciliationBlocked(h);
    });
  }
});
