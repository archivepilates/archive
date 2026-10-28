import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { beforeEach, test } from "node:test";
import { deriveInstructorLessonRegistrationState } from "../lib/instructor-lesson-registration-contract.mjs";
import { resolvedEformErrorPatch } from "../lib/eformsign-send-readiness.mjs";

const require = createRequire(new URL("../../firebase/kangsain-functions/functions/package.json", import.meta.url));
const ts = require("typescript");
const workerUrl = new URL("../process-eformsign-instructor-member-jobs.mjs", import.meta.url);
const tree = ts.createSourceFile(workerUrl.pathname, readFileSync(workerUrl, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functionNames = ["markSending", "markSent", "writeSendClaimedState", "deriveRegistrationPatch", "stepValue"];
const declarations = functionNames.map(name => {
  const node = tree.statements.find(entry => ts.isFunctionDeclaration(entry) && entry.name?.text === name);
  assert.ok(node, `Missing source declaration: ${name}`);
  return node.getText(tree);
}).join("\n");

const NOW = new Date("2099-06-01T03:00:00.000Z");
const REGISTRATION_ID = "synthetic-registration-a";
const JOB_PATH = `eformsignInstructorMemberJobs/${REGISTRATION_ID}`;
const REGISTRATION_PATH = `instructorLessonRegistrations/${REGISTRATION_ID}`;
const STAMP = { syntheticServerTimestamp: NOW.toISOString() };
const SEND_RESULT = Object.freeze({
  documentName: "synthetic-accepted-form-a", documentId: "synthetic-document-a",
  documentUrl: "https://example.invalid/synthetic-document-a",
});
const clone = value => structuredClone(value);
const forbidden = () => assert.fail("Network/browser/production operations are forbidden in these synthetic tests");

beforeEach(t => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  t.mock.method(globalThis, "fetch", forbidden);
});

function applyPatch(row, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split(".");
    const last = parts.pop();
    let target = row;
    for (const part of parts) target = target[part] ??= {};
    target[last] = clone(value);
  }
}

// Never import the executable worker: evaluate only the named declarations.
// The store stages atomic writes and rejects transaction reads after writes.
function fixture() {
  const job = {
    registrationId: REGISTRATION_ID, status: "processing", claimToken: "synthetic-owned-claim",
    claimedAt: "2099-06-01T02:59:00.000Z", claimedBy: "synthetic-worker", attempts: 4, maxAttempts: 4,
    externalEffectStarted: false, lastError: "synthetic prior form failure",
    attemptHistory: [{ attempt: 3, outcome: "synthetic prior failure" }],
  };
  const registration = {
    registrationId: REGISTRATION_ID, mode: "new_member", status: "waiting_signature",
    nextAction: "synthetic form preparation", lastError: job.lastError,
    source: { type: "imweb_paid_order", sourceId: "synthetic-source-a" },
    externalOrder: { orderNo: "synthetic-order-a", paidAmount: 12345 },
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
    evidence: { ticketId: "900000002", confirmationCandidateId: "synthetic-candidate-a", confirmationSolapiMessageId: "synthetic-message-a" },
    steps: {
      member: { status: "verified" }, ticket: { status: "verified" },
      eformsign: { status: "processing", detail: "synthetic form preparation" },
      memo: { status: "waiting_external" },
      confirmation: { status: "verified", detail: "synthetic existing accepted Alimtalk", messageId: "synthetic-message-a" },
    },
  };
  let rows = new Map([[JOB_PATH, clone(job)], [REGISTRATION_PATH, clone(registration)]]);
  const writes = [], attemptedWrites = [], reads = [];
  const doc = path => ({ path, id: path.split("/").at(-1) });
  const db = {
    collection: name => ({ doc: id => doc(`${name}/${id}`) }),
    async runTransaction(callback) {
      const staged = clone(rows);
      const pending = [];
      function write(kind, ref, patch, options) {
        attemptedWrites.push({ kind, path: ref.path, patch: clone(patch) });
        if (kind === "update") assert.ok(staged.has(ref.path), "Update requires an existing document");
        const row = kind === "update" || options?.merge ? clone(staged.get(ref.path) || {}) : {};
        applyPatch(row, patch);
        staged.set(ref.path, row);
        pending.push({ kind, path: ref.path, patch: clone(patch) });
      }
      const result = await callback({
        async get(ref) {
          assert.equal(pending.length, 0, "Read after transaction write");
          reads.push(ref.path);
          return { exists: rows.has(ref.path), data: () => clone(rows.get(ref.path)) };
        },
        set: (ref, patch, options) => write("set", ref, patch, options),
        update: (ref, patch) => write("update", ref, patch),
      });
      rows = staged;
      writes.push(...pending);
      return result;
    },
  };
  const api = vm.runInNewContext(`${declarations}\n({${functionNames.join(",")}})`, {
    db, Date, FieldValue: { serverTimestamp: () => clone(STAMP) },
    deriveInstructorLessonRegistrationState, resolvedEformErrorPatch, fetch: forbidden,
  }, { timeout: 1000 });
  return {
    api, job, registration, ref: doc(JOB_PATH), writes, attemptedWrites, reads,
    getJob: () => clone(rows.get(JOB_PATH)), getRegistration: () => clone(rows.get(REGISTRATION_PATH)),
    changeJob: mutate => mutate(rows.get(JOB_PATH)),
    changeRegistration: mutate => mutate(rows.get(REGISTRATION_PATH)),
    deleteJob: () => rows.delete(JOB_PATH), deleteRegistration: () => rows.delete(REGISTRATION_PATH),
    state: () => clone([...rows]),
  };
}

function assertUnrelatedState(f, beforeJob, beforeRegistration) {
  const afterJob = f.getJob(), afterRegistration = f.getRegistration();
  assert.equal(afterJob.attempts, beforeJob.attempts);
  assert.equal(afterJob.maxAttempts, beforeJob.maxAttempts);
  assert.deepStrictEqual(afterJob.attemptHistory, beforeJob.attemptHistory);
  for (const key of ["member", "ticket", "memo", "confirmation"]) {
    assert.deepStrictEqual(afterRegistration.steps[key], beforeRegistration.steps[key], key);
  }
  for (const key of ["source", "externalOrder", "operatorChecks", "cancellation", "externalOrderReviewRequired"]) {
    assert.deepStrictEqual(afterRegistration[key], beforeRegistration[key], key);
  }
  for (const key of ["ticketId", "confirmationCandidateId", "confirmationSolapiMessageId"]) {
    assert.deepStrictEqual(afterRegistration.evidence[key], beforeRegistration.evidence[key], key);
  }
}

async function assertSendBlocked(f) {
  const before = f.state(), claimedBefore = clone(f.job);
  await assert.rejects(f.api.markSending(f.ref, f.job), error => {
    assert.equal(error.name, "Error");
    return true;
  });
  assert.deepStrictEqual(f.state(), before, "Rejected send must preserve both documents");
  assert.deepStrictEqual(f.job, claimedBefore, "Claimed input must remain unchanged");
  assert.deepStrictEqual(f.attemptedWrites, [], "Guard must run before any transaction write");
  assert.deepStrictEqual(f.writes, []);
  assert.deepStrictEqual(f.reads, [JOB_PATH, REGISTRATION_PATH]);
}

test("markSending writes only the owned sending intent after reading fresh canonical state", async () => {
  const f = fixture(), claimedBefore = clone(f.job), beforeJob = f.getJob(), beforeRegistration = f.getRegistration();
  await f.api.markSending(f.ref, f.job);
  const after = f.getJob();
  assert.equal(after.status, "sending");
  assert.equal(after.claimToken, f.job.claimToken);
  assert.equal(after.externalEffectStarted, true);
  assert.deepStrictEqual(after.sendClickedAt, STAMP);
  assert.equal(Object.hasOwn(after, "documentId"), false);
  assert.equal(Object.hasOwn(after, "sentAt"), false);
  assert.deepStrictEqual(f.reads, [JOB_PATH, REGISTRATION_PATH]);
  assert.deepStrictEqual(f.writes.map(({ kind, path }) => [kind, path]), [["set", JOB_PATH], ["update", REGISTRATION_PATH]]);
  assert.deepStrictEqual(f.job, claimedBefore);
  assertUnrelatedState(f, beforeJob, beforeRegistration);
});

for (const [name, change] of [
  ["concurrent cancellation", f => f.changeRegistration(row => { row.cancellation = { jobId: "synthetic-cancel-a" }; row.status = "cancellation_pending"; })],
  ["incomplete concurrent cancellation record", f => f.changeRegistration(row => { row.cancellation = {}; })],
  ["concurrent source hold", f => f.changeRegistration(row => { row.externalOrderReviewRequired = true; })],
  ["existing registration document evidence", f => f.changeRegistration(row => { row.evidence.eformsignDocumentId = "synthetic-existing-document"; })],
  ["changed claim", f => f.changeJob(row => { row.claimToken = "synthetic-other-claim"; })],
  ["released claim", f => f.changeJob(row => { row.claimToken = null; })],
  ["missing claim", f => f.changeJob(row => { delete row.claimToken; })],
  ["missing job", f => f.deleteJob()],
  ["missing canonical registration", f => f.deleteRegistration()],
]) {
  test(`markSending rejects ${name} before any writes`, async () => {
    const f = fixture();
    change(f);
    await assertSendBlocked(f);
  });
}

for (const status of ["cancelled", "canceled", "rejected", "completed", "cancellation_pending", "cancellation_review", "synthetic-unknown"]) {
  test(`markSending rejects fresh registration status ${status}`, async () => {
    const f = fixture();
    f.changeRegistration(row => { row.status = status; });
    await assertSendBlocked(f);
  });
}

test("markSending rejects missing fresh registration status", async () => {
  const f = fixture();
  f.changeRegistration(row => { delete row.status; });
  await assertSendBlocked(f);
});

for (const step of ["member", "ticket"]) {
  for (const status of ["pending", "failed", "review_required", "missing"]) {
    test(`markSending rejects ${step} step ${status} in the current source`, async () => {
      const f = fixture();
      f.changeRegistration(row => {
        if (status === "missing") delete row.steps[step];
        else row.steps[step].status = status;
      });
      await assertSendBlocked(f);
    });
  }
}

for (const [marker, value] of Object.entries({
  externalEffectStarted: true, effectStartedAt: NOW.toISOString(), sendStartedAt: NOW.toISOString(),
  sendClickedAt: NOW.toISOString(), sentAt: NOW.toISOString(), documentId: "synthetic-existing-document",
  documentUrl: "https://example.invalid/synthetic-existing-document", providerMessageId: "synthetic-provider-message",
  completedAt: NOW.toISOString(),
})) {
  test(`markSending rejects current ${marker} despite an unchanged claim`, async () => {
    const f = fixture();
    f.changeJob(row => { row[marker] = value; });
    await assertSendBlocked(f);
  });
}

for (const status of ["pending", "retry", "sending", "sent", "waiting_completion", "done", "failed", "send_review_required"]) {
  test(`markSending rejects current job status ${status} without writing`, async () => {
    const f = fixture();
    f.changeJob(row => { row.status = status; });
    await assertSendBlocked(f);
  });
}

for (const status of ["sent", "verified", "waiting_completion"]) {
  test(`markSending must not replay canonical eform step ${status} even without a document ID`, async () => {
    const f = fixture();
    f.changeRegistration(row => { row.steps.eformsign.status = status; });
    await assertSendBlocked(f);
  });
}

for (const [name, change] of [
  ["no concurrent change", () => {}],
  ["cancellation after the send click", f => f.changeRegistration(row => {
    row.cancellation = { jobId: "synthetic-cancel-after-click", status: "pending" };
    row.status = "cancellation_pending"; row.nextAction = "synthetic cancellation review";
    row.lastError = "synthetic cancellation attention";
  })],
  ["source hold after the send click", f => f.changeRegistration(row => { row.externalOrderReviewRequired = true; })],
]) {
  test(`markSent records accepted evidence with ${name} and preserves confirmation and attempts`, async () => {
    const f = fixture();
    await f.api.markSending(f.ref, f.job);
    change(f);
    const beforeJob = f.getJob(), beforeRegistration = f.getRegistration(), claimedBefore = clone(f.job);
    const priorWriteCount = f.writes.length;
    await f.api.markSent(f.ref, f.job, SEND_RESULT);
    const after = f.getJob(), source = f.getRegistration();
    assert.equal(after.status, "waiting_completion");
    assert.equal(after.externalEffectStarted, false);
    assert.equal(after.claimToken, null);
    assert.equal(after.claimedAt, null);
    assert.equal(after.claimedBy, null);
    assert.deepStrictEqual(after.sendClickedAt, STAMP, "Keep evidence that dispatch was attempted");
    assert.deepStrictEqual(after.sentAt, STAMP);
    for (const [key, value] of Object.entries(SEND_RESULT)) assert.equal(after[key], value, key);
    assert.equal(source.evidence.eformsignDocumentId, SEND_RESULT.documentId);
    assert.equal(source.steps.eformsign.status, "sent");
    assert.equal(f.writes.length - priorWriteCount, 2);
    assert.deepStrictEqual(f.job, claimedBefore);
    assertUnrelatedState(f, beforeJob, beforeRegistration);
    if (beforeRegistration.cancellation) {
      assert.equal(source.status, beforeRegistration.status);
      assert.equal(source.nextAction, beforeRegistration.nextAction);
      assert.equal(source.lastError, beforeRegistration.lastError);
    }
  });
}

for (const issue of ["changed claim", "changed job status", "missing registration"]) {
  test(`markSent does not bypass claim/source existence guard after ${issue}`, async () => {
    const f = fixture();
    await f.api.markSending(f.ref, f.job);
    if (issue === "changed claim") f.changeJob(row => { row.claimToken = "synthetic-other-claim"; });
    if (issue === "changed job status") f.changeJob(row => { row.status = "done"; });
    if (issue === "missing registration") f.deleteRegistration();
    const before = f.state(), priorWriteCount = f.writes.length, priorAttemptCount = f.attemptedWrites.length;
    await assert.rejects(f.api.markSent(f.ref, f.job, SEND_RESULT), error => error.name === "Error");
    assert.deepStrictEqual(f.state(), before);
    assert.equal(f.writes.length, priorWriteCount);
    assert.equal(f.attemptedWrites.length, priorAttemptCount);
  });
}

test("a second markSending is blocked by the first owned sending intent", async () => {
  const f = fixture();
  await f.api.markSending(f.ref, f.job);
  const before = f.state(), priorWriteCount = f.writes.length, priorAttemptCount = f.attemptedWrites.length;
  await assert.rejects(f.api.markSending(f.ref, f.job), error => error.name === "Error");
  assert.deepStrictEqual(f.state(), before);
  assert.equal(f.writes.length, priorWriteCount);
  assert.equal(f.attemptedWrites.length, priorAttemptCount);
});
