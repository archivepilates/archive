import assert from "node:assert/strict";
import { test } from "node:test";
import { processInstructorSignatureReminder } from "../lib/instructor-signature-reminder-processing.mjs";
import { INSTRUCTOR_SIGNATURE_REMINDER_POLICY } from "../lib/instructor-signature-reminder.mjs";
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE } from "../lib/instructor-lesson-registration-contract.mjs";
import { assertContractReminderDispatchAllowed } from "../lib/contract-signature-reminder-window.mjs";

const JOBS = "eformsignInstructorMemberJobs";
const REGISTRATIONS = "instructorLessonRegistrations";
const ID = `ilr_${"a".repeat(24)}`;
const PEER = `ilr_${"c".repeat(24)}`;
const DOCUMENT = "b".repeat(32);
const NOW = "2026-10-30T00:00:00.000Z";
const SENT = "2026-10-29T00:00:00.000Z";
const copy = value => structuredClone(value);

function fixture(id = ID) {
  return {
    id,
    job: {
      jobId: id, registrationId: id, studioId: "5330",
      memberName: "Synthetic Instructor", memberPhone: "01000000001",
      studiomateMemberId: "9000001", documentId: DOCUMENT,
      documentName: "2026-10-29_instructor_signup_Synthetic Instructor",
      ticketName: "Instructor lesson (2T)", lessonDate: "2026-11-28",
      status: "waiting_completion", sentAt: SENT,
      sendClickedAt: "2026-10-28T23:59:59.000Z", externalEffectStarted: false,
    },
    registration: {
      registrationId: id, studioId: "5330", memberName: "Synthetic Instructor",
      memberPhone: "01000000001", lessonDate: "2026-11-28", status: "waiting_signature",
      evidence: { studiomateMemberId: "9000001", eformsignDocumentId: DOCUMENT },
      steps: { ticket: { status: "verified" }, eformsign: { status: "sent" } },
    },
  };
}

function liveEvidence(plan, clock) {
  const checkedAt = clock.toISOString();
  return {
    checkedAt,
    document: {
      source: "eformsign_document_status", verified: true, documentId: plan.documentId,
      templateId: TEMPLATE, documentName: plan.documentName, status: "waiting",
      recipientName: plan.memberName, recipientPhone: plan.memberPhone,
      recipientCount: 1, checkedAt,
      expiresAt: '2026-11-05T00:00:00.000Z',
    },
    member: {
      verified: true, memberId: plan.memberId, name: plan.memberName,
      phone: plan.memberPhone, memberGrade: "\uac15\uc0ac\ud68c\uc6d0", inactive: false, checkedAt,
    },
    ticket: {
      verified: true, memberId: plan.memberId, lessonDate: plan.lessonDate,
      title: plan.ticketName, refunded: false, cancelled: false, checkedAt,
    },
  };
}

// Serial execution models query/document conflicts: the loser rereads the winner's
// committed claim, rather than getting an independently writable query snapshot.
function memoryFirestore(fixtures, afterCommit) {
  const rows = new Map(fixtures.flatMap(({ id, job, registration }) => [
    [`${JOBS}/${id}`, copy(job)], [`${REGISTRATIONS}/${id}`, copy(registration)],
  ]));
  const metrics = { transactions: 0, contended: 0, active: 0, maxActive: 0, queries: [], commits: [] };
  let tail = Promise.resolve();
  let queued = 0;
  const snapshot = ref => {
    const value = copy(rows.get(ref.path));
    return { id: ref.id, ref, exists: value !== undefined, data: () => copy(value) };
  };
  const db = {
    metrics,
    peek: path => copy(rows.get(path)),
    put: (path, value) => rows.set(path, copy(value)),
    doc(path) {
      return { path, id: path.split("/").at(-1), get: async () => snapshot(db.doc(path)) };
    },
    collection(collection) {
      return {
        where(field, operator, value) {
          assert.equal(operator, "==");
          return { kind: "query", collection, field, value, limit(max) { return { ...this, max }; } };
        },
      };
    },
    async runTransaction(callback) {
      const previous = tail;
      let unlock;
      tail = new Promise(resolve => { unlock = resolve; });
      if (queued > 0) metrics.contended += 1;
      queued += 1;
      await previous;
      metrics.transactions += 1;
      metrics.active += 1;
      metrics.maxActive = Math.max(metrics.maxActive, metrics.active);
      const writes = new Map();
      try {
        const tx = {
          async get(target) {
            assert.equal(writes.size, 0, "Firestore requires reads before writes");
            if (target.kind !== "query") return snapshot(target);
            assert.equal(metrics.active, 1, "query reads hold the transaction lock");
            const docs = [...rows.entries()]
              .filter(([path, value]) => path.split("/").length === 2
                && path.startsWith(`${target.collection}/`) && value?.[target.field] === target.value)
              .slice(0, target.max ?? Infinity).map(([path]) => snapshot(db.doc(path)));
            metrics.queries.push({ collection: target.collection, field: target.field,
              value: target.value, max: target.max, ids: docs.map(row => row.id) });
            return { docs, size: docs.length, empty: docs.length === 0 };
          },
          update(ref, patch) {
            assert.ok(rows.has(ref.path), "updates require an existing document");
            writes.set(ref.path, { ...copy(rows.get(ref.path)), ...writes.get(ref.path), ...copy(patch) });
          },
        };
        const result = await callback(tx);
        for (const [path, value] of writes) rows.set(path, copy(value));
        const commit = [...writes].map(([path, value]) => ({ path, value: copy(value) }));
        metrics.commits.push(commit);
        await afterCommit?.(commit);
        return result;
      } finally {
        metrics.active -= 1;
        queued -= 1;
        unlock();
      }
    },
  };
  return db;
}

function harness({ fixtures = [fixture()], clock = NOW, afterCommit } = {}) {
  let time = new Date(clock);
  const hooks = {};
  const stats = { liveReads: 0, sendCalls: 0, providerPostCount: 0, receipts: [] };
  const db = memoryFirestore(fixtures, afterCommit);
  const now = () => new Date(time);
  const readLive = async context => {
    stats.liveReads += 1;
    const live = liveEvidence(context.plan, now());
    await hooks.onLive?.(live, context, stats.liveReads);
    return live;
  };
  const sendSms = async (plan, beforeFinalSend) => {
    stats.sendCalls += 1;
    await hooks.beforeGate?.(plan);
    const markStarted = await beforeFinalSend();
    assert.equal(typeof markStarted, "function");
    assertContractReminderDispatchAllowed(now());
    await hooks.beforeTransport?.(plan);
    markStarted();
    stats.providerPostCount += 1;
    const receipt = hooks.transport ? await hooks.transport(plan) : { smsId: 101 };
    stats.receipts.push(copy(receipt));
    return receipt;
  };
  return {
    db, hooks, stats,
    setClock: value => { time = new Date(value); },
    marker: (id = ID) => db.peek(`${JOBS}/${id}`).signatureReminder,
    run: (options = {}) => processInstructorSignatureReminder({
      db, id: ID, now, readLive, sendSms, apply: true, scheduled: true, ...options,
    }),
  };
}

function assertNoClaim(h) {
  assert.equal(h.marker(), undefined);
  assert.equal(h.stats.providerPostCount, 0);
  assert.equal(h.stats.receipts.length, 0);
  assert.equal(h.db.metrics.commits.flat().length, 0);
}

test('claim acknowledgement delayed over 60 seconds cannot use stale live evidence', async () => {
  let h;
  h = harness({ afterCommit: writes => {
    if (writes.some(row => row.value.signatureReminder?.status === 'attempting')) h.setClock('2026-10-30T00:01:01.001Z');
  } });
  const result = await h.run();
  assert.equal(result.status, 'review');
  assert.equal(h.stats.providerPostCount, 0);
  assert.equal(h.marker().status, 'review');
});

test('source evidence is checked again at actual transport, not only claim acknowledgement', async () => {
  const h = harness();
  h.hooks.beforeTransport = () => h.setClock('2026-10-30T00:01:01.001Z');
  assert.equal((await h.run()).status, 'review');
  assert.equal(h.stats.providerPostCount, 0);
});

for (const field of ['ticket', 'order', 'payment']) test(`changed ${field} binding during final live read blocks claim`, async () => {
  const h = harness();
  h.hooks.onLive = (_live, _context, count) => {
    if (count !== 2) return;
    const path = `${REGISTRATIONS}/${ID}`, row = h.db.peek(path);
    if (field === 'ticket') row.evidence.ticketId = '9999999';
    if (field === 'order') row.externalOrder = { orderNo: 'synthetic-changed-order' };
    if (field === 'payment') row.operatorChecks = { paymentConfirmed: false };
    h.db.put(path, row);
  };
  assert.equal((await h.run()).status, 'skipped');
  assertNoClaim(h);
});

test('document expiring while the claim waits is not reminded', async () => {
  let h;
  h = harness({ afterCommit: writes => {
    if (writes.some(row => row.value.signatureReminder?.status === 'attempting')) h.setClock('2026-10-30T00:00:20.000Z');
  } });
  h.hooks.onLive = live => { live.document.expiresAt = '2026-10-30T00:00:10.000Z'; };
  assert.equal((await h.run()).status, 'review');
  assert.equal(h.stats.providerPostCount, 0);
});

test('unknown transport outcome remains visible as review in subsequent runs', async () => {
  const h = harness();
  h.hooks.transport = () => { throw Error('synthetic lost response'); };
  assert.equal((await h.run()).status, 'review');
  const result = await h.run();
  assert.equal(result.status, 'review');
  assert.equal(result.stage, 'postclaim');
  assert.equal(h.stats.providerPostCount, 1);
});

test("an accepted receipt is recorded once and the same job cannot be replayed", async () => {
  const h = harness();
  assert.deepEqual(await h.run(), {
    status: "accepted", jobId: ID, documentId: DOCUMENT, smsId: 101, deliveryStatus: "not_verified",
  });
  const accepted = h.marker();
  assert.equal(accepted.policy, INSTRUCTOR_SIGNATURE_REMINDER_POLICY);
  assert.equal(accepted.key, `instructor_signature_reminder_${DOCUMENT}`);
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.smsId, 101);
  assert.equal(accepted.attempts, 1);
  assert.equal(accepted.originalSentAt, SENT);
  assert.equal(accepted.dueAt, NOW);
  assert.equal(accepted.acceptedAt, NOW);
  assert.equal(accepted.deliveryStatus, "not_verified");
  assert.ok(accepted.dispatchToken);
  assert.match(accepted.fingerprint, /^[a-f0-9]{64}$/);
  const before = copy(h.stats);
  assert.deepEqual(await h.run(), { status: "skipped", reason: "reminder_already_recorded", jobId: ID });
  assert.deepEqual(h.marker(), accepted);
  assert.deepEqual(h.stats, before);
  assert.equal(h.stats.providerPostCount, 1);
  assert.equal(h.stats.receipts.length, 1);
  assert.equal(h.stats.liveReads, 2);
});

for (const [label, patch] of [
  ["accepted signatureReminder", { signatureReminder: { status: "accepted", smsId: 202 } }],
  ["attempting signatureReminder", { signatureReminder: { status: "attempting" } }],
  ["review signatureReminder", { signatureReminder: { status: "review" } }],
  ["deferred signatureReminder", { signatureReminder: { status: "deferred", attempts: 0, providerPostCount: 0 } }],
  ["unclassified signatureReminder", { signatureReminder: {} }],
  ["completedAt", { completedAt: NOW }],
  ["done status", { status: "done" }],
]) test(`a same-document peer with ${label} blocks a new claim`, async () => {
  const peer = fixture(PEER);
  Object.assign(peer.job, patch);
  const h = harness({ fixtures: [fixture(), peer] });
  const peerBefore = h.db.peek(`${JOBS}/${PEER}`);
  assert.deepEqual(await h.run(), {
    status: "skipped", reason: "document_already_completed_or_claimed", jobId: ID,
  });
  assertNoClaim(h);
  assert.deepEqual(h.db.peek(`${JOBS}/${PEER}`), peerBefore);
  assert.equal(h.db.metrics.queries.length, 1);
  assert.deepEqual(h.db.metrics.queries[0].ids, [ID, PEER]);
});

test("a completed peer for another document does not block the intended document", async () => {
  const peer = fixture(PEER);
  peer.job.documentId = "d".repeat(32);
  peer.job.status = "done";
  peer.job.signatureReminder = { status: "accepted", smsId: 202 };
  const h = harness({ fixtures: [fixture(), peer] });
  assert.equal((await h.run()).status, "accepted");
  assert.deepEqual(h.db.metrics.queries[0], {
    collection: JOBS, field: "documentId", value: DOCUMENT, max: 101, ids: [ID],
  });
  assert.equal(h.stats.providerPostCount, 1);
});

test("two concurrent jobs for one document serialize query/claim conflicts and get one receipt", { timeout: 2000 }, async () => {
  const h = harness({ fixtures: [fixture(), fixture(PEER)] });
  let release;
  let arrivals = 0;
  const bothAtFinalGate = new Promise(resolve => { release = resolve; });
  h.hooks.beforeGate = async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await bothAtFinalGate;
  };
  const results = await Promise.all([h.run(), h.run({ id: PEER })]);
  assert.deepEqual(results.map(row => row.status).sort(), ["accepted", "skipped"]);
  const winner = results.find(row => row.status === "accepted");
  const loser = results.find(row => row.status === "skipped");
  assert.equal(loser.reason, "document_already_completed_or_claimed");
  assert.equal(h.marker(winner.jobId).status, "accepted");
  assert.equal(h.marker(loser.jobId), undefined);
  assert.equal(h.stats.providerPostCount, 1);
  assert.deepEqual(h.stats.receipts, [{ smsId: 101 }]);
  assert.equal(h.db.metrics.maxActive, 1);
  assert.ok(h.db.metrics.contended > 0, "both jobs actually contend for the fake transaction lock");
  assert.equal(h.db.metrics.queries.length, 2);
  for (const query of h.db.metrics.queries) assert.deepEqual(query.ids, [ID, PEER]);
  const accepted = copy(h.marker(winner.jobId));
  await h.run({ id: loser.jobId });
  assert.equal(h.stats.providerPostCount, 1);
  assert.deepEqual(h.marker(winner.jobId), accepted);
});

for (const [label, options] of [
  ["dry", { apply: false, scheduled: true }],
  ["manual", { apply: true, scheduled: false }],
  ["default flags", { apply: undefined, scheduled: undefined }],
]) test(`${label} processing performs no live reads, claims or sends`, async () => {
  const h = harness();
  assert.deepEqual(await h.run(options), {
    status: "dry_run", reason: "no_dispatch", jobId: ID, documentId: DOCUMENT,
  });
  assertNoClaim(h);
  assert.equal(h.stats.liveReads, 0);
  assert.equal(h.stats.sendCalls, 0);
  assert.equal(h.db.metrics.transactions, 0);
});

test("under-24-hour processing performs no live reads, claims or sends", async () => {
  const f = fixture();
  f.job.sentAt = "2026-10-29T00:00:00.001Z";
  const h = harness({ fixtures: [f] });
  assert.deepEqual(await h.run(), { status: "skipped", reason: "under_24_hours", jobId: ID });
  assertNoClaim(h);
  assert.equal(h.stats.liveReads, 0);
  assert.equal(h.stats.sendCalls, 0);
  assert.equal(h.db.metrics.transactions, 0);
});

test("cancellation discovered on the final source read blocks before claim", async () => {
  const h = harness();
  h.hooks.onLive = (_live, _context, count) => {
    if (count === 1) {
      const registration = h.db.peek(`${REGISTRATIONS}/${ID}`);
      registration.status = "cancelled";
      h.db.put(`${REGISTRATIONS}/${ID}`, registration);
    }
  };
  assert.deepEqual(await h.run(), { status: "skipped", reason: "source_or_duplicate_changed", jobId: ID });
  assertNoClaim(h);
  assert.equal(h.stats.liveReads, 1);
  assert.equal(h.db.metrics.transactions, 0);
});

test("a cancellation racing the final live read is rechecked inside the claim transaction", async () => {
  const h = harness();
  h.hooks.onLive = (_live, _context, count) => {
    if (count === 2) {
      const registration = h.db.peek(`${REGISTRATIONS}/${ID}`);
      registration.status = "cancelled";
      h.db.put(`${REGISTRATIONS}/${ID}`, registration);
    }
  };
  assert.equal((await h.run()).reason, "source_or_duplicate_changed");
  assertNoClaim(h);
  assert.equal(h.stats.liveReads, 2);
  assert.equal(h.db.metrics.queries.length, 1);
});

for (const [label, change] of [
  ["completed document", live => { live.document.status = "completed"; live.document.completedAt = NOW; }],
  ["stale document", live => { live.document.checkedAt = new Date(Date.parse(NOW) - 60_001).toISOString(); }],
]) test(`a ${label} on the final live read blocks before claim`, async () => {
  const h = harness();
  h.hooks.onLive = (live, _context, count) => { if (count === 2) change(live); };
  const result = await h.run();
  assert.equal(result.status, "review");
  assert.equal(result.stage, "preclaim");
  assert.equal(result.reason, "source_or_claim_unverified");
  assertNoClaim(h);
  assert.equal(h.stats.liveReads, 2);
  assert.equal(h.db.metrics.transactions, 0);
});

for (const [label, failTransport] of [
  ["transport uncertainty", () => { throw new Error("synthetic transport lost its response"); }],
  ["a quiet-hour error after transport started", h => {
    h.setClock("2026-10-30T23:00:00+09:00");
    assertContractReminderDispatchAllowed(new Date("2026-10-30T23:00:00+09:00"));
  }],
]) test(`${label} remains review and is never retried`, async () => {
  const h = harness();
  h.hooks.transport = async () => failTransport(h);
  const result = await h.run();
  assert.equal(result.status, "review");
  assert.equal(result.stage, "postclaim");
  assert.equal(result.reason, "send_outcome_unknown");
  assert.equal(result.jobId, ID);
  assert.equal(result.documentId, DOCUMENT);
  assert.doesNotMatch(JSON.stringify(result), /synthetic transport/);
  const review = h.marker();
  assert.equal(review.status, "review");
  assert.equal(review.attempts, 1);
  assert.equal(review.reason, "send_outcome_unknown");
  assert.equal(review.smsId, undefined);
  assert.equal(h.stats.providerPostCount, 1);
  const before = copy(h.stats);
  h.setClock("2026-10-31T00:00:00.000Z");
  assert.equal((await h.run()).reason, "reminder_already_recorded");
  assert.deepEqual(h.stats, before);
  assert.deepEqual(h.marker(), review);
});

for (const [label, crossing] of [
  ["stricter contract window at 20:00", "2026-10-30T20:00:00+09:00"],
  ["global quiet hours at 23:00", "2026-10-30T23:00:00+09:00"],
]) test(`crossing ${label} after claim defers with zero posts and resumes next 09:00`, async () => {
  let crossed = false;
  const h = harness({ clock: "2026-10-30T19:59:59.999+09:00", afterCommit: writes => {
    if (!crossed && writes.some(row => row.value.signatureReminder?.status === "attempting")) {
      crossed = true;
      h.setClock(crossing);
    }
  } });
  const result = await h.run();
  assert.equal(crossed, true);
  assert.equal(result.status, "deferred");
  assert.equal(result.nextAllowedAt, "2026-10-31T00:00:00.000Z");
  const deferred = h.marker();
  assert.equal(deferred.status, "deferred");
  assert.equal(deferred.attempts, 0);
  assert.equal(deferred.providerPostCount, 0);
  assert.equal(deferred.deferredBeforeTransport, true);
  assert.equal(deferred.nextAllowedAt, result.nextAllowedAt);
  assert.equal(deferred.originalSentAt, SENT);
  assert.equal(deferred.smsId, undefined);
  assert.equal(deferred.acceptedAt, undefined);
  assert.equal(deferred.deferrals.length, 1);
  assert.deepEqual(deferred.deferrals[0], {
    dispatchToken: deferred.dispatchToken, attemptedAt: deferred.attemptedAt,
    fingerprint: deferred.fingerprint, deferredAt: new Date(crossing).toISOString(), providerPostCount: 0,
  });
  assert.equal(h.stats.providerPostCount, 0);
  assert.equal(h.stats.receipts.length, 0);
  const before = copy(h.stats);
  h.setClock("2026-10-31T08:59:59.999+09:00");
  await h.run();
  assert.deepEqual(h.stats, before);
  assert.deepEqual(h.marker(), deferred);
  h.setClock("2026-10-31T09:00:00+09:00");
  assert.equal((await h.run()).status, "accepted");
  const accepted = h.marker();
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.attempts, 1);
  assert.equal(accepted.key, deferred.key);
  assert.equal(accepted.fingerprint, deferred.fingerprint);
  assert.notEqual(accepted.dispatchToken, deferred.dispatchToken);
  assert.deepEqual(accepted.deferrals, deferred.deferrals);
  assert.equal(h.stats.liveReads, 4, "resumption revalidates both live reads");
  assert.equal(h.stats.providerPostCount, 1);
  assert.equal(h.stats.receipts.length, 1);
  assert.equal((await h.run()).reason, "reminder_already_recorded");
  assert.equal(h.stats.providerPostCount, 1);
});

for (const [label, receipt] of [
  ["missing receipt", undefined], ["null receipt", null], ["missing smsId", {}],
  ["zero smsId", { smsId: 0 }], ["negative smsId", { smsId: -1 }],
  ["string smsId", { smsId: "101" }], ["fractional smsId", { smsId: 1.5 }],
  ["unsafe smsId", { smsId: Number.MAX_SAFE_INTEGER + 1 }],
]) test(`an invalid ${label} after transport requires review and cannot be retried`, async () => {
  const h = harness();
  h.hooks.transport = async () => receipt;
  const result = await h.run();
  assert.equal(result.status, "review");
  assert.equal(result.stage, "postclaim");
  assert.equal(result.reason, "send_outcome_unknown");
  assert.equal(h.marker().status, "review");
  assert.equal(h.marker().attempts, 1);
  assert.equal(h.marker().smsId, undefined);
  assert.equal(h.marker().acceptedAt, undefined);
  assert.equal(h.stats.providerPostCount, 1);
  const before = copy(h.stats);
  assert.equal((await h.run()).reason, "reminder_already_recorded");
  assert.deepEqual(h.stats, before);
});

test("accepted state is not downgraded when settlement commits then throws", async () => {
  let thrownAfterAcceptedCommit = false;
  const h = harness({ afterCommit: writes => {
    if (!thrownAfterAcceptedCommit && writes.some(row => row.value.signatureReminder?.status === "accepted")) {
      thrownAfterAcceptedCommit = true;
      throw new Error("synthetic commit succeeded but acknowledgement was lost");
    }
  } });
  assert.deepEqual(await h.run(), {
    status: "accepted", jobId: ID, documentId: DOCUMENT, smsId: 101, deliveryStatus: "not_verified",
  });
  assert.equal(thrownAfterAcceptedCommit, true);
  assert.equal(h.marker().status, "accepted");
  assert.equal(h.marker().smsId, 101);
  assert.equal(h.marker().reason, undefined);
  assert.deepEqual(h.db.metrics.commits.flat().map(row => row.value.signatureReminder.status), ["attempting", "accepted"]);
  assert.equal(h.stats.providerPostCount, 1);
  assert.equal(h.stats.receipts.length, 1);
  const before = copy(h.stats);
  assert.equal((await h.run()).reason, "reminder_already_recorded");
  assert.deepEqual(h.stats, before);
});
