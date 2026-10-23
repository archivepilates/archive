import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SOURCE, HEALTH_PATH, READ_LIMIT, parseArgs, validateAck, validateServiceAccount, validateEnvironment,
  timestamp, sanitizeSourceRefs, sanitizeHealth, isUnreviewed, safeQueueItem, summarizeQueue,
  listOperationsMail, buildAckPatch, acknowledgeOperationsMail, runCli, safeError } from "../operations-mail-triage.mjs";

const id = `ops_mail_${"a".repeat(64)}`;
const at = "2026-10-24T10:00:00.000Z";
const command = { queueId: id, count: 2, messageId: "abcdef1234567890", outcome: "investigated" };
const row = overrides => ({ source: SOURCE, area: "alimtalk", title: "알림톡 실패 보고", priority: "high",
  status: "open", needsReview: true, messageCount: 2, reviewedMessageCount: 0, lastMessageId: command.messageId, lastSeenAt: at,
  sourceRefs: [`gmail:${command.messageId}`], ...overrides });
const doc = (data = row(), key = id) => ({ id: key, exists: true, data: () => data });
const code = expected => error => error.code === expected;

function fakeDb(data = row(), { exists = true, retryData } = {}) {
  const writes = [], calls = [];
  const ref = { id };
  const db = {
    collection(name) { calls.push(["collection", name]); return {
      doc(key) { calls.push(["doc", key]); return ref; },
    }; },
    async runTransaction(fn) {
      const attempt = value => fn({ get: async () => ({ exists, data: () => value }),
        update: (target, patch) => writes.push({ target, patch }) });
      if (retryData) { await attempt(data); writes.length = 0; return attempt(retryData); }
      return attempt(data);
    },
  };
  return { db, writes, calls };
}

test("import is inert even with invalid credential and database environment", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    `await import(${JSON.stringify(new URL("../operations-mail-triage.mjs", import.meta.url).href)}); console.log('inert');`],
  { encoding: "utf8", env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: "/not-a-credential",
    GOOGLE_CLOUD_PROJECT: "not-the-project", FIRESTORE_EMULATOR_HOST: "invalid" } });
  assert.equal(result.status, 0); assert.equal(result.stdout.trim(), "inert"); assert.equal(result.stderr, "");
});

test("default, include-tests, help and exact ack arguments", () => {
  assert.deepEqual(parseArgs([]), { mode: "list", includeTests: false });
  assert.deepEqual(parseArgs(["--include-tests"]), { mode: "list", includeTests: true });
  assert.equal(parseArgs(["--help"]).mode, "help");
  assert.deepEqual(parseArgs(["--ack", id, "--count", "2", "--message-id", command.messageId,
    "--outcome", "investigated"]), { mode: "ack", ...command });
});

for (const args of [["--resolved"], ["--help", "--include-tests"], ["--count", "2"],
  ["--include-tests", "--include-tests"], ["--ack"], ["--ack", id, "--ack", id],
  ["--project", "other"], ["--limit", "1000"], ["--ack", id, "--count", "2", "--message-id", command.messageId,
    "--outcome", "investigated", "--include-tests"]]) {
  test(`reject invalid arguments before connect: ${args[0]} (${args.length})`, async () => {
    let connects = 0;
    await assert.rejects(runCli(args, { connect: async () => { connects++; } }), code("INVALID_ARGUMENTS"));
    assert.equal(connects, 0);
  });
}

for (const patch of [{ queueId: "ops_mail_abc" }, { queueId: `${id}/child` }, { count: 0 }, { count: -1 },
  { count: 1.5 }, { count: Number.MAX_SAFE_INTEGER + 1 }, { messageId: "../secret" }, { messageId: "f".repeat(65) },
  { messageId: "x\n" }, { outcome: "sent" }]) {
  test(`ack validation rejects ${Object.keys(patch)[0]} ${JSON.stringify(patch)}`, () => {
    assert.throws(() => validateAck({ ...command, ...patch }), code("INVALID_ARGUMENTS"));
  });
}

for (const count of ["01", "1e2", "-2", "2.0", "9007199254740992", "0"]) {
  test(`strict count parsing ${count}`, () => assert.throws(() => parseArgs(["--ack", id, "--count", count,
    "--message-id", command.messageId, "--outcome", "investigated"]), code("INVALID_ARGUMENTS")));
}

test("certificate validates exact dedicated identity and environment validates canonical target", () => {
  const key = { type: "service_account", project_id: "archive-pilates",
    client_email: "archive-codex-operator@archive-pilates.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nsynthetic-not-a-real-key\n-----END PRIVATE KEY-----\n" };
  assert.equal(validateServiceAccount(key), key);
  for (const patch of [{ project_id: "other" }, { client_email: "other@example.invalid" },
    { type: "authorized_user" }, { private_key: "no" }]) {
    assert.throws(() => validateServiceAccount({ ...key, ...patch }), code("INVALID_CREDENTIALS"));
  }
  validateEnvironment({}); validateEnvironment({ GCLOUD_PROJECT: "archive-pilates" });
  for (const env of [{ GOOGLE_CLOUD_PROJECT: "other" }, { GCLOUD_PROJECT: "other" },
    { FIREBASE_PROJECT_ID: "other" }, { FIRESTORE_EMULATOR_HOST: "localhost:8080" }]) {
    assert.throws(() => validateEnvironment(env), code("INVALID_TARGET"));
  }
});

test("fixed Gmail references only; no source paths, arbitrary account, redirect or raw text; capped at ten", () => {
  const fixed = `https://mail.google.com/mail/u/?authuser=home%40archivepilates.com#all/${command.messageId}`;
  assert.deepEqual(sanitizeSourceRefs([`gmail:${command.messageId}`, fixed, fixed, "docs/private/report.html",
    "https://evil.invalid/", `${fixed}?token=secret`, "gmail:../secret", { path: "secret" },
    `https://mail.google.com/mail/u/?authuser=other%40example.com#all/${command.messageId}`]),
  [`gmail:${command.messageId}`, fixed]);
  assert.equal(sanitizeSourceRefs(Array.from({ length: 20 }, (_, n) => `gmail:${n.toString(16)}`)).length, 10);
});

test("queue output preserves only safe schema and fixed titles, rejects unsafe ids/source/status", () => {
  const item = safeQueueItem(id, row({ title: "Private member secret", subject: "private", body: "secret",
    credentials: "secret", member: "private", recentDocument: "/private/file" }));
  assert.equal(item.title, "알림톡 메일 확인 필요"); assert.equal(item.isTest, false);
  assert.equal(JSON.stringify(item).includes("secret"), false);
  assert.equal(safeQueueItem(id, row()).title, "알림톡 실패 보고");
  assert.equal(safeQueueItem(id, row({ area: "private@example.invalid" })).area, "operations");
  assert.equal(safeQueueItem("other", row()), null);
  assert.equal(safeQueueItem(id, row({ source: "other" })), null);
  assert.equal(safeQueueItem(id, row({ status: "private" })), null);
  assert.equal(safeQueueItem(id, row({ needsReview: false })), null);
  assert.equal(safeQueueItem(id, row({ needsReview: undefined })), null);
});

for (const [area, label] of Object.entries({ inbody_api: "인바디 API", youtube_video_list: "유튜브 영상리스트",
  inbody: "인바디", system_validation: "시스템검증", data_integrity: "데이터정합성", login: "로그인",
  referral: "친구초대", staff_benefits: "스텝 혜택", instructor_lesson_video: "강사레슨영상",
  staff_video_access: "스텝 영상권한" })) {
  test(`new policy area has safe title mapping: ${area}`, () => {
    const item = safeQueueItem(id, row({ area, title: `${label} 확인필요 보고` }));
    assert.equal(item.area, area); assert.equal(item.title, `${label} 확인필요 보고`);
    assert.equal(safeQueueItem(id, row({ area, title: "private secret" })).title, `${label} 메일 확인 필요`);
  });
}

test("outcome exposes only the three review enums, never arbitrary text", () => {
  for (const outcome of ["investigated", "already_handled", "needs_user"]) {
    assert.equal(safeQueueItem(id, row({ outcome })).outcome, outcome);
  }
  for (const outcome of [undefined, null, "secret member", "constructor", { private: "secret" }]) {
    assert.equal(safeQueueItem(id, row({ outcome })).outcome, null);
  }
});

test("count changes, including resolved rows, are unreviewed; reviewed rows and default test rows excluded", () => {
  assert.equal(isUnreviewed(row({ reviewedMessageCount: undefined })), true);
  assert.equal(isUnreviewed(row({ reviewedMessageCount: 2 })), false);
  assert.equal(isUnreviewed(row({ reviewedMessageCount: 1 })), true);
  assert.equal(isUnreviewed(row({ reviewedMessageCount: 3 })), true);
  const docs = [doc(row({ status: "resolved" })), doc(row({ reviewedMessageCount: 2 })), doc(row({ isTest: true }))];
  assert.equal(summarizeQueue(docs).items.length, 1);
  assert.equal(summarizeQueue(docs).items[0].status, "resolved");
  assert.equal(summarizeQueue(docs, { includeTests: true }).items.length, 2);
});

test("priority then lastSeenAt sort; 101 sentinel marks incomplete even if filtered rows hide results", () => {
  const docs = [doc(row({ priority: "normal", lastSeenAt: "2026-10-25T10:00:00Z" })),
    doc(row({ lastSeenAt: "2026-10-23T10:00:00Z" })), doc(row())];
  assert.deepEqual(summarizeQueue(docs).items.map(item => [item.priority, item.lastSeenAt]),
    [["high", at], ["high", "2026-10-23T10:00:00.000Z"], ["normal", "2026-10-25T10:00:00.000Z"]]);
  assert.equal(summarizeQueue(Array.from({ length: 100 }, () => doc())).complete, true);
  const result = summarizeQueue(Array.from({ length: 101 }, () => doc()));
  assert.equal(result.complete, false); assert.equal(result.truncated, true); assert.equal(result.items.length, 100);
  assert.equal(summarizeQueue(Array.from({ length: 101 }, () => doc(row({ isTest: true })))).complete, false);
});

test("health has only allowed fields and timestamp normalization", () => {
  const health = sanitizeHealth({ enabled: false, activatedAt: at, lastSyncAt: { toDate: () => new Date(at) },
    lastErrorCode: "mail_backlog_review_required", lastErrorAt: at, watchExpiresAt: at,
    historyCursor: "secret", labels: ["private"], mailbox: "secret", leaseOwner: "secret" });
  assert.deepEqual(Object.keys(health), ["enabled", "activatedAt", "lastSyncAt", "lastErrorCode", "lastErrorAt", "watchExpiresAt"]);
  assert.equal(health.lastSyncAt, at); assert.equal(JSON.stringify(health).includes("secret"), false);
  assert.equal(sanitizeHealth({ lastErrorCode: "raw private error" }).lastErrorCode, null);
  assert.equal(sanitizeHealth(null).enabled, null);
  assert.equal(timestamp({ toDate() { throw Error("private"); } }), null);
});

test("list reads source and needsReview with limit 101 and fixed health document without any writes", async () => {
  const calls = [], query = { where(...args) { calls.push(["where", ...args]); return this; },
    limit(value) { calls.push(["limit", value]); return this; }, get: async () => ({ docs: [doc()] }) };
  const db = { collection(name) { calls.push(["collection", name]); return query; },
    doc(key) { calls.push(["health", key]); return { get: async () => ({ exists: true, data: () => ({ enabled: true }) }) }; } };
  const result = await listOperationsMail(db);
  assert.deepEqual(calls, [["collection", "codexActionQueue"], ["where", "source", "==", SOURCE],
    ["where", "needsReview", "==", true], ["limit", READ_LIMIT], ["health", HEALTH_PATH]]);
  assert.equal(result.health.enabled, true); assert.equal(result.items.length, 1);
});

for (const outcome of ["investigated", "already_handled", "needs_user"]) {
  test(`exact-version ack outcome ${outcome}, including test row, updates only review fields`, async () => {
    const { db, writes, calls } = fakeDb(row({ isTest: true }));
    const result = await acknowledgeOperationsMail(db, { ...command, outcome }, () => new Date(at));
    assert.deepEqual(result, { id, reviewedMessageCount: 2, reviewedAt: at, outcome, needsReview: false,
      status: outcome === "needs_user" ? "blocked" : "resolved" });
    const { id: ignored, ...expectedPatch } = result;
    assert.deepEqual(writes.map(write => write.patch), [expectedPatch]);
    assert.deepEqual(calls, [["collection", "codexActionQueue"], ["doc", id]]);
  });
}

for (const [data, expected] of [[row({ source: "other" }), "SOURCE_MISMATCH"],
  [row({ messageCount: 3 }), "QUEUE_VERSION_CONFLICT"], [row({ lastMessageId: "abcdef99" }), "QUEUE_VERSION_CONFLICT"],
  [row({ messageCount: null }), "INVALID_QUEUE_VERSION"], [row({ reviewedMessageCount: 9 }), "INVALID_QUEUE_VERSION"]]) {
  test(`unsafe ack holds without write ${expected} ${JSON.stringify(data.messageCount)}`, async () => {
    const { db, writes } = fakeDb(data);
    await assert.rejects(acknowledgeOperationsMail(db, command), code(expected)); assert.equal(writes.length, 0);
  });
}

test("missing ledger never creates; transaction retry observes concurrent new message and refuses", async () => {
  const missing = fakeDb(undefined, { exists: false });
  await assert.rejects(acknowledgeOperationsMail(missing.db, command), code("QUEUE_NOT_FOUND"));
  assert.equal(missing.writes.length, 0);
  const changed = fakeDb(row(), { retryData: row({ messageCount: 3, lastMessageId: "abcdef99" }) });
  await assert.rejects(acknowledgeOperationsMail(changed.db, command), code("QUEUE_VERSION_CONFLICT"));
  assert.equal(changed.writes.length, 0);
});

test("reviewed history beyond 101 cannot starve new queues; previous needs_user survives a new receipt", async () => {
  const history = Array.from({ length: 150 }, (_, n) => doc(row({ needsReview: false, status: "resolved",
    reviewedMessageCount: 2 }), `ops_mail_${n.toString(16).padStart(64, "0")}`));
  const pending = doc(row({ status: "resolved", outcome: "needs_user", messageCount: 3, reviewedMessageCount: 2 }));
  let selected = [...history, pending], limit;
  const query = {
    where(field, operator, value) {
      assert.equal(operator, "=="); selected = selected.filter(item => item.data()[field] === value); return this;
    },
    limit(value) { limit = value; return this; },
    get: async () => ({ docs: selected.slice(0, limit) }),
  };
  const result = await listOperationsMail({ collection: () => query,
    doc: () => ({ get: async () => ({ exists: false }) }) });
  assert.equal(result.complete, true); assert.equal(result.scannedCount, 1);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].id, id);
  assert.equal(result.items[0].outcome, "needs_user"); assert.equal(result.items[0].messageCount, 3);
});

test("needs_user ack clears pending flag, while an exact retry remains allowed without requiring needsReview", () => {
  const patch = buildAckPatch(row(), { ...command, outcome: "needs_user" }, at);
  assert.equal(patch.needsReview, false); assert.equal(patch.status, "blocked");
  const acknowledged = row(patch);
  assert.equal(summarizeQueue([doc(acknowledged)]).items.length, 0);
  assert.deepEqual(buildAckPatch(acknowledged, { ...command, outcome: "needs_user" }, at), patch);
});

for (const firstOutcome of ["needs_user", "investigated", "already_handled"]) {
  for (const lateOutcome of ["needs_user", "investigated", "already_handled"]) {
    test(`reviewed version outcome CAS: ${firstOutcome} then ${lateOutcome}`, async () => {
      const originalPatch = buildAckPatch(row(), { ...command, outcome: firstOutcome }, at);
      const reviewed = row(originalPatch);
      const { db, writes } = fakeDb(reviewed);
      if (firstOutcome !== lateOutcome) {
        await assert.rejects(acknowledgeOperationsMail(db, { ...command, outcome: lateOutcome },
          () => new Date("2026-10-25T10:00:00Z")), code("QUEUE_VERSION_CONFLICT"));
        assert.equal(writes.length, 0);
      } else {
        const result = await acknowledgeOperationsMail(db, { ...command, outcome: lateOutcome },
          () => new Date("2026-10-25T10:00:00Z"));
        assert.deepEqual(result, { id, ...originalPatch });
        assert.deepEqual(writes.map(write => write.patch), [originalPatch]);
      }
    });
  }
}

test("identical retry preserves stored timestamp identity and status, rather than recomputing them", () => {
  const reviewedAt = { toDate: () => new Date(at) };
  const data = row({ reviewedMessageCount: 2, needsReview: false, outcome: "needs_user", reviewedAt, status: "in_progress" });
  const patch = buildAckPatch(data, { ...command, outcome: "needs_user" }, "2026-10-26T10:00:00Z");
  assert.equal(patch.reviewedAt, reviewedAt); assert.equal(patch.status, "in_progress");
});

test("reviewed state without enum outcome or valid review metadata fails closed", async () => {
  for (const overrides of [{ outcome: undefined }, { outcome: "unknown" }, { outcome: "secret" },
    { reviewedAt: undefined }, { status: "unknown" }]) {
    const data = row({ reviewedMessageCount: 2, needsReview: false, outcome: "investigated", reviewedAt: at,
      status: "resolved", ...overrides });
    const { db, writes } = fakeDb(data);
    await assert.rejects(acknowledgeOperationsMail(db, command), code("INVALID_QUEUE_VERSION"));
    assert.equal(writes.length, 0);
  }
});

test("transaction retry cannot replace another completed outcome at the same count and message ID", async () => {
  const reviewed = row(buildAckPatch(row(), { ...command, outcome: "needs_user" }, at));
  const { db, writes } = fakeDb(row(), { retryData: reviewed });
  await assert.rejects(acknowledgeOperationsMail(db, command), code("QUEUE_VERSION_CONFLICT"));
  assert.equal(writes.length, 0);
});

test("new receipt count permits a new outcome, while missing reviewed count retains legacy behavior", () => {
  const reviewed = row(buildAckPatch(row(), { ...command, outcome: "needs_user" }, at));
  const fresh = { ...reviewed, messageCount: 3, lastMessageId: "abcdef99", needsReview: true };
  const patch = buildAckPatch(fresh, { ...command, count: 3, messageId: "abcdef99" }, "2026-10-25T10:00:00Z");
  assert.equal(patch.outcome, "investigated"); assert.equal(patch.status, "resolved");
  assert.equal(patch.reviewedMessageCount, 3); assert.equal(patch.needsReview, false);
  assert.equal(patch.reviewedAt, "2026-10-25T10:00:00.000Z");
  assert.equal(buildAckPatch(row({ reviewedMessageCount: undefined, needsReview: false }), command, at).outcome, "investigated");
});

test("pure patch supports missing review count and validates clock", () => {
  assert.equal(buildAckPatch(row({ reviewedMessageCount: undefined }), command, at).reviewedMessageCount, 2);
  assert.throws(() => buildAckPatch(row(), command, null), code("INVALID_ARGUMENTS"));
});

test("help never connects; failure cleanup always runs and raw exceptions are never printed", async () => {
  const help = await runCli(["--help"], { connect: () => { throw Error("must not connect"); } });
  assert.match(help.usage, /--include-tests/);
  let closed = 0;
  await assert.rejects(runCli([], { connect: async () => ({ db: { collection() { throw Error("secret subject private_key"); } },
    close: async () => { closed++; } }) }));
  assert.equal(closed, 1);
  assert.deepEqual(safeError(Error("secret subject private_key")), { error: { code: "TRIAGE_FAILED",
    message: "처리를 확인하지 못했습니다. 원장을 다시 조회하세요." } });
});

test("successful CLI ack closes its dedicated connection and reads no health or Gmail surface", async () => {
  const { db, writes } = fakeDb();
  let closed = 0;
  const result = await runCli(["--ack", id, "--count", "2", "--message-id", command.messageId,
    "--outcome", "already_handled"], { connect: async () => ({ db, close: async () => { closed++; } }),
    now: () => new Date(at) });
  assert.equal(result.status, "resolved"); assert.equal(closed, 1); assert.equal(writes.length, 1);
});

test("missing health is visibly unknown, and --include-tests reaches list only", async () => {
  let closed = 0;
  const query = { where() { return this; }, limit() { return this; },
    get: async () => ({ docs: [doc(row({ isTest: true }))] }) };
  const db = { collection: () => query, doc: key => {
    assert.equal(key, HEALTH_PATH); return { get: async () => ({ exists: false }) };
  } };
  const result = await runCli(["--include-tests"], {
    connect: async () => ({ db, close: async () => { closed++; } }),
  });
  assert.equal(result.items[0].isTest, true); assert.equal(result.health.enabled, null); assert.equal(closed, 1);
});
