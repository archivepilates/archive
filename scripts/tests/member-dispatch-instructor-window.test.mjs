import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../../firebase/kangsain-functions/functions/", import.meta.url);
let ts;
try {
  ts = createRequire(new URL("package.json", root))("typescript");
} catch {
  ts = createRequire(new URL("file:///Users/archivepilates/dev/archive-in-runtime/firebase/kangsain-functions/functions/package.json"))("typescript");
}
const SOURCE_DATE = "2026-10-22";
const LESSON_DATE = "2026-10-23";
const OPEN = "2026-10-22T00:00:00.000Z";
const LAST = "2026-10-22T13:59:59.999Z";
const CLOSED = "2026-10-22T14:00:00.000Z";
const NEXT = "2026-10-23T00:00:00.000Z";
const APPROVALS = "instructorLessonAlimtalkApprovals";
const SNAPSHOT = "opsState/studiomateReservationExcelEmergency";
const MANAGEMENT = "support-movement-261023";
const TEMPLATE = "SYNTHETIC_V3";
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const plain = (value) => JSON.parse(JSON.stringify(value));
const forbidden = (operation) => { throw new Error(`Unmocked operation forbidden: ${operation}`); };
const compiled = new Map();

function evaluate(file, dependencies, globals = {}) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(
    readFileSync(new URL(`src/${file}.ts`, root), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    },
  ).outputText);
  const exports = {};
  vm.runInNewContext(compiled.get(file), {
    exports, Error, process: { env: {}, memoryUsage: () => ({ rss: 0 }) },
    require: (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : forbidden(`import ${id}`),
    ...globals,
  }, { timeout: 1000 });
  return exports;
}
const crypto = { createHash, randomBytes };
const hash = evaluate("utils/hash", { "node:crypto": crypto });
const management = evaluate("alimtalk/instructorLessonManagement", {});
const bookingPolicy = evaluate("alimtalk/instructorLessonBookingPolicy", {});
const cancellation = evaluate("instructorLessonRegistration/instructorLessonCancellationPolicy", {
  "node:crypto": crypto, "../utils/errors": { AppError: Error },
});

// Synthetic, bounded store only. Optimistic retries exercise ownership and rollback races.
function memoryDb(allowedReads, allowedWrites) {
  const values = new Map();
  const versions = new Map();
  const reads = [];
  const writes = [];
  let onRead = () => {};
  let onCommit = () => {};
  const get = (path) => copy(values.get(path));
  const seed = (path, value) => {
    if (value === undefined) values.delete(path);
    else values.set(path, copy(value));
    versions.set(path, (versions.get(path) || 0) + 1);
  };
  const apply = ({ ref, value, options }) => {
    assert.ok(allowedWrites.has(ref.path), `Unscoped write: ${ref.path}`);
    seed(ref.path, options?.merge ? { ...get(ref.path), ...copy(value) } : value);
    writes.push({ path: ref.path, value: copy(value) });
  };
  async function read(ref, transaction) {
    assert.ok(allowedReads.has(ref.path), `Unscoped read: ${ref.path}`);
    await onRead(ref.path, transaction);
    reads.push({ path: ref.path, transaction });
    const value = get(ref.path);
    return { snapshot: { exists: value !== undefined, data: () => copy(value) }, version: versions.get(ref.path) || 0 };
  }
  const doc = (path) => ({ path,
    get: async () => (await read({ path }, false)).snapshot,
    set: async (value, options) => apply({ ref: { path }, value, options }),
  });
  function collection(name, filters = [], limit = Infinity) {
    return { doc: (id) => doc(`${name}/${id}`),
      where: (field, op, value) => collection(name, [...filters, [field, op, value]], limit),
      limit: (cap) => collection(name, filters, cap),
      get: async () => {
        assert.equal(name, APPROVALS, "No target rebuild or source collection scan");
        assert.deepEqual(filters, [["sourceDate", "==", SOURCE_DATE]]);
        assert.ok(limit <= 20);
        reads.push({ collection: name });
        return { docs: [...values].filter(([path, value]) => path.startsWith(`${name}/`)
          && value.sourceDate === SOURCE_DATE).slice(0, limit).map(([, value]) => ({ data: () => copy(value) })) };
      },
    };
  }
  const db = { doc, collection,
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const observed = new Map();
        const staged = [];
        const result = await callback({
          get: async (ref) => {
            assert.equal(staged.length, 0, "All reads precede writes");
            const { snapshot, version } = await read(ref, true);
            observed.set(ref.path, version);
            return snapshot;
          },
          set: (ref, value, options) => staged.push({ ref, value, options }),
          create: (ref, value) => staged.push({ ref, value }),
        });
        await onCommit(staged);
        if ([...observed].some(([path, version]) => version !== (versions.get(path) || 0))) continue;
        staged.forEach(apply);
        return result;
      }
      throw new Error("Synthetic transaction exhausted");
    },
  };
  return { db, get, seed, reads, writes,
    onRead: (hook) => { onRead = hook; }, onCommit: (hook) => { onCommit = hook; } };
}

function harness({ count = 2, now = OPEN, sample = false } = {}) {
  let clock = now;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return Date.parse(clock); }
  }
  const windowPolicy = evaluate("memberSignup/memberDispatchWindow", {}, { Date: Clock });
  const candidates = Array.from({ length: count }, (_, i) => ({
    candidateId: `candidate-${i}`, studioId: "5330", memberId: `member-${i}`,
    memberName: `Synthetic ${i}`, memberPhone: `010${String(i).padStart(8, "0")}`,
    type: "instructor_lesson_material", templateCode: TEMPLATE, sourceDate: SOURCE_DATE,
    status: i % 2 ? "reviewed" : "candidate", attempts: 0, maxAttempts: 2,
    reviewedByUid: "synthetic-original-reviewer", reviewedAt: 1,
    title: "Synthetic", reason: "Synthetic", lastError: null, createdAt: 1, updatedAt: 1,
    payload: { bookingId: `booking-${i}`, lectureId: "lecture", lessonDate: LESSON_DATE,
      lectureDate: LESSON_DATE, managementNumber: MANAGEMENT, shortLinkId: "material", parkingLinkId: `parking-${i}` },
  }));
  const approvalId = `instructor_lesson_${hash.stableHash({ studioId: "5330", sourceDate: SOURCE_DATE, managementNumber: MANAGEMENT }).slice(0, 24)}`;
  const approvalPath = `${APPROVALS}/${approvalId}`;
  const sampleId = `${approvalId}_sample`;
  const candidatePath = (id) => `alimtalkCandidates/${id}`;
  const ledgerPath = (id) => `alimtalkSends/${id}`;
  const allowedReads = new Set([approvalPath, SNAPSHOT, ledgerPath(sampleId), candidatePath(sampleId)]);
  const allowedWrites = new Set([approvalPath, ledgerPath(sampleId), candidatePath(sampleId)]);
  const registrationPath = (item) => `instructorLessonRegistrations/ilr_${createHash("sha256")
    .update(`${item.studioId}|${item.memberPhone}|${LESSON_DATE}`).digest("hex").slice(0, 24)}`;
  for (const item of candidates) {
    for (const path of [candidatePath(item.candidateId), ledgerPath(item.candidateId), registrationPath(item),
      `bookings/${item.payload.bookingId}`, "lectures/lecture", `memberProfiles/${item.memberId}`]) allowedReads.add(path);
    allowedWrites.add(candidatePath(item.candidateId));
    allowedWrites.add(ledgerPath(item.candidateId));
  }
  const store = memoryDb(allowedReads, allowedWrites);
  const sent = [];
  const mails = [];
  const routes = [];
  const eligibility = [];
  const duplicates = [];
  let providerHook = () => {};
  let acceptedHook = () => {};
  let parkingHook = () => {};
  let eligibilityHook = () => "";
  let duplicateHook = () => "";
  let parkingCalls = 0;
  const runtime = evaluate("alimtalk/instructorLessonSampleApproval", {
    "node:crypto": crypto,
    "firebase-functions": { logger: { info() {} } },
    "../config/constants": { DEFAULT_STUDIO_ID: "5330", REGION: "synthetic" },
    "../config/firebase": { db: store.db },
    "../firestore/refs": { refs: {
      alimtalkCandidate: (id) => store.db.doc(candidatePath(id)),
      alimtalkSend: (id) => store.db.doc(ledgerPath(id)),
      booking: (id) => store.db.doc(`bookings/${id}`), lecture: (id) => store.db.doc(`lectures/${id}`),
      memberProfile: (id) => store.db.doc(`memberProfiles/${id}`),
    } },
    "../google/driveDocsMailer": { sendAlimtalkLogEmail: async (mail) => { mails.push(copy(mail)); } },
    "../utils/date": { todayKst: () => new Date(Date.parse(clock) + 9 * 3600000).toISOString().slice(0, 10), nowTimestamp: () => clock },
    "../utils/hash": hash,
    "../memberSignup/memberDispatchWindow": windowPolicy,
    "./dedupe": { normalizePhone: (value) => String(value).replace(/\D/g, ""), alimtalkDedupeKey: (item) => `dedupe-${item.candidateId}` },
    "./targetValidationChecks": {
      targetEligibilityIssue: async (item, today) => { eligibility.push({ id: item.candidateId, today }); return eligibilityHook(item, today); },
      targetDuplicateIssue: async (item) => { duplicates.push(item.candidateId); return duplicateHook(item); },
    },
    "../instructorLessonRegistration/instructorLessonCancellationPolicy": cancellation,
    "./instructorLessonManagement": management, "./instructorLessonBookingPolicy": bookingPolicy,
    "./templates": { INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE: TEMPLATE,
      alimtalkDedupePolicy: () => ({ label: "Synthetic once", windowDays: null }) },
    "./processAlimtalkQueue": { sendSolapiAlimtalk: async (item) => {
      assert.equal(store.get(approvalPath).status, sample ? "sample_sending" : "sending");
      assert.equal(store.get(ledgerPath(item.candidateId)), undefined);
      await providerHook(item);
      // This models the shared transport's typed last-mile guard, not a provider attempt.
      windowPolicy.assertMemberDispatchAllowed();
      sent.push(copy(item));
      await acceptedHook(item);
      return { messageId: `synthetic-${item.candidateId}` };
    } },
    "./testRecipients": { primaryAlimtalkTestRecipient: () => ({ memberId: "synthetic-test", name: "Synthetic test", phone: "01000000099", reason: "Synthetic" }) },
    "../parking/instructorLessonParkingPreRegistration": { ensureInstructorLessonParkingPreviewShortLink: async () => {
      parkingCalls++; await parkingHook(); return "synthetic-parking";
    } },
    "../utils/shortLinks": { shortUrlForId: (id) => `https://synthetic.invalid/${id}` },
  }, {
    Date: Clock, AbortSignal: { timeout: () => ({ synthetic: true }) },
    fetch: async (url) => {
      assert.ok(url.startsWith(`https://in.archivepilates.com/method/${MANAGEMENT}`));
      routes.push(url);
      return { ok: true, text: async () => `data-method-date="${LESSON_DATE}" \uc218\uc5c5\uc790\ub8cc\ub294 \uc218\uc5c5 \ub2f9\uc77c 12\uc2dc\uc5d0 \uacf5\uac1c\ub429\ub2c8\ub2e4.` };
    },
  });
  const approval = { approvalId, studioId: "5330", sourceDate: SOURCE_DATE, lessonDate: LESSON_DATE,
    managementNumber: MANAGEMENT, templateCode: TEMPLATE, status: "approved",
    candidateIds: candidates.map((item) => item.candidateId), approvedTargetKeys: candidates.map(runtime.instructorLessonTargetKey),
    contentFingerprint: runtime.instructorLessonContentFingerprint(candidates[0]), candidateCount: count,
    candidateNames: candidates.map((item) => item.memberName), sampleCandidateId: sampleId, sampleRecipientName: "Synthetic test",
    sampleSolapiMessageId: "synthetic-sample", sampleSentAt: OPEN, approvedAt: OPEN, approvedBy: "synthetic-approval",
    approvalTokenHash: "original-token", createdAt: OPEN, updatedAt: OPEN };
  if (!sample) store.seed(approvalPath, approval);
  const refresh = () => store.seed(SNAPSHOT, { active: true, snapshotPolicy: "bookings_single_source_reconcile_import_range",
    dateRange: { startDate: SOURCE_DATE, endDate: LESSON_DATE }, importedBookings: count, updatedAt: clock });
  refresh();
  for (const item of candidates) {
    store.seed(candidatePath(item.candidateId), item);
    store.seed(`bookings/${item.payload.bookingId}`, { bookingId: item.payload.bookingId, lectureId: "lecture",
      studioId: item.studioId, memberId: item.memberId, memberPhone: item.memberPhone,
      appStatus: "reserved", lectureDate: LESSON_DATE, ticketClassType: "I" });
    store.seed(`memberProfiles/${item.memberId}`, { studioId: item.studioId, memberId: item.memberId, phone: item.memberPhone });
  }
  store.seed("lectures/lecture", { studioId: "5330", lectureId: "lecture", date: LESSON_DATE, status: "open", title: "Support Movement" });
  return { ...store, runtime, policy: windowPolicy, candidates, approval, approvalPath, candidatePath, ledgerPath, sampleId,
    registrationPath, sent, mails, routes, eligibility, duplicates, refresh,
    get parkingCalls() { return parkingCalls; },
    clock: (at) => { clock = at; },
    provider: (hook) => { providerHook = hook; }, parking: (hook) => { parkingHook = hook; },
    accepted: (hook) => { acceptedHook = hook; },
    exclude: (hook) => { eligibilityHook = hook; }, duplicate: (hook) => { duplicateHook = hook; },
    run: () => sample
      ? runtime.prepareInstructorLessonSampleApprovals({ studioId: "5330", sourceDate: SOURCE_DATE, candidates })
      : runtime.sendApprovedInstructorLessonAlimtalks({ studioId: "5330", sourceDate: SOURCE_DATE }),
  };
}

function assertPending(f, sent = 0, deferred = f.candidates.length - sent) {
  const current = f.get(f.approvalPath);
  assert.equal(current.status, "approved");
  assert.equal(current.sentCount, sent);
  assert.equal(current.failedCount, 0);
  assert.equal(current.deferredCount, deferred);
  assert.equal(current.lastError, null);
  assert.equal(current.liveSendCompletedAt, undefined);
  assert.equal(current.nextAllowedAt, NEXT);
  for (const key of ["candidateIds", "approvedTargetKeys", "contentFingerprint", "approvedAt", "approvedBy", "approvalTokenHash", "sampleSolapiMessageId", "sampleSentAt", "createdAt"]) {
    assert.deepEqual(current[key], f.approval[key], `Preserve approval ${key}`);
  }
}

for (const at of ["2026-10-21T14:00:00.000Z", "2026-10-21T23:59:59.999Z", CLOSED]) {
  for (const sample of [false, true]) test(`${sample ? "real-phone sample" : "approved bulk"} defers before claims at ${at}`, async () => {
    const f = harness({ now: at, sample });
    const before = f.get(f.approvalPath);
    const result = await f.run();
    assert.equal(result.blocked, 1);
    assert.deepEqual(plain(result.blockedReasons), ["member_dispatch_quiet_hours"]);
    assert.equal(result.failed || 0, 0);
    assert.equal(f.sent.length, 0);
    assert.equal(f.writes.length, 0);
    assert.equal(f.routes.length, 0);
    assert.equal(f.parkingCalls, 0);
    assert.equal(f.mails.length, 0);
    assert.deepEqual(f.get(f.approvalPath), before);
  });
}

for (const now of [OPEN, LAST]) for (const sample of [false, true]) {
  test(`${sample ? "sample" : "bulk"} may dispatch inside the shared window at ${now}`, async () => {
    const f = harness({ now, sample });
    const result = await f.run();
    assert.equal(result[sample ? "sampleSent" : "sent"], sample ? 1 : 2);
    assert.equal(f.sent.length, sample ? 1 : 2);
    assert.equal((await f.run())[sample ? "sampleSent" : "sent"], 0);
    assert.equal(f.sent.length, sample ? 1 : 2);
  });
}

test("sample crossing 23:00 during preparation does not claim or create an attempt", async () => {
  const f = harness({ sample: true, now: LAST });
  f.parking(() => f.clock(CLOSED));
  assert.equal((await f.run()).blocked, 1);
  assert.equal(f.get(f.approvalPath), undefined);
  assert.equal(f.writes.length, 0);
  assert.equal(f.sent.length, 0);
});

test("sample last-mile deferral stays pending without audit, then resumes once on the same ID", async () => {
  const f = harness({ sample: true, now: LAST });
  f.provider(() => f.clock(CLOSED));
  assert.equal((await f.run()).blocked, 1);
  const pending = f.get(f.approvalPath);
  assert.equal(pending.status, "sample_pending");
  assert.equal(pending.lastError, null);
  assert.equal(pending.nextAllowedAt, NEXT);
  assert.equal(pending.sampleSentAt, undefined);
  assert.equal(f.get(f.candidatePath(f.sampleId)), undefined);
  assert.equal(f.get(f.ledgerPath(f.sampleId)), undefined);
  assert.equal(f.sent.length, 0);
  assert.equal(f.mails.length, 0);
  f.clock(NEXT); f.refresh(); f.provider(() => {});
  assert.equal((await f.run()).sampleSent, 1);
  assert.deepEqual(f.get(f.approvalPath).candidateIds, pending.candidateIds);
  assert.equal(f.get(f.approvalPath).createdAt, pending.createdAt);
  assert.equal(f.get(f.approvalPath).dispatchDeferredReason, null);
  assert.equal(f.get(f.ledgerPath(f.sampleId)).attempts, 1);
  assert.equal((await f.run()).sampleSent, 0);
  assert.equal(f.sent.length, 1);
});

test("sample deferral restores pre-existing source-blocked approval and its history", async () => {
  const f = harness({ sample: true, now: LAST });
  const original = { ...f.approval, status: "blocked_source_stale", sampleSolapiMessageId: "", sampleSentAt: null,
    lastError: "old source issue", sourceRecoveryCount: 4, sourceRecoveredAt: OPEN };
  f.seed(f.approvalPath, original);
  f.provider(() => f.clock(CLOSED));
  await f.run();
  const restored = f.get(f.approvalPath);
  assert.equal(restored.status, original.status);
  for (const [key, value] of Object.entries(original)) assert.deepEqual(restored[key], value);
  assert.equal(f.get(f.ledgerPath(f.sampleId)), undefined);
});

test("pending sample cannot rebuild changed approved targets or replay a prior ledger", async () => {
  for (const change of ["target", "ledger"]) {
    const f = harness({ sample: true, now: LAST });
    f.provider(() => f.clock(CLOSED)); await f.run();
    const original = f.get(f.approvalPath);
    if (change === "target") f.candidates[0].memberPhone = "01099999999";
    else f.seed(f.ledgerPath(f.sampleId), { status: "unknown", attempts: 1 });
    f.clock(NEXT); f.refresh(); f.provider(() => {});
    await f.run();
    assert.equal(f.sent.length, 0);
    assert.deepEqual(f.get(f.approvalPath), original);
  }
});

test("sample rollback preserves accepted evidence for readback recovery, never resends it", async () => {
  const f = harness({ sample: true, now: LAST });
  const evidence = { status: "done", solapiMessageId: "synthetic-already-accepted", attempts: 1, updatedAt: LAST };
  f.provider(() => { f.seed(f.ledgerPath(f.sampleId), evidence); f.clock(CLOSED); });
  assert.equal((await f.run()).blocked, 1);
  assert.equal(f.get(f.approvalPath).status, "sample_sending");
  assert.deepEqual(f.get(f.ledgerPath(f.sampleId)), evidence);
  f.clock(NEXT); f.refresh(); f.provider(() => forbidden("accepted sample replay"));
  assert.equal((await f.run()).sampleSent, 1);
  assert.equal(f.get(f.approvalPath).sampleSolapiMessageId, evidence.solapiMessageId);
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.get(f.ledgerPath(f.sampleId)), evidence);
});

test("unknown sample outcome remains non-retryable even if the clock also crosses 23:00", async () => {
  const f = harness({ sample: true, now: LAST });
  f.provider(() => { f.clock(CLOSED); throw new Error("Synthetic unknown sample outcome"); });
  assert.equal((await f.run()).blocked, 1);
  assert.equal(f.get(f.approvalPath).status, "sample_unknown");
  const ledger = f.get(f.ledgerPath(f.sampleId));
  assert.equal(ledger.attempts, 1);
  f.clock(NEXT); f.refresh(); f.provider(() => forbidden("unknown sample replay"));
  assert.equal((await f.run()).blocked, 1);
  assert.deepEqual(f.get(f.ledgerPath(f.sampleId)), ledger);
});

test("bulk last-mile deferral restores candidate and reviewed snapshots with zero attempts", async () => {
  const f = harness({ now: LAST });
  f.provider(() => f.clock(CLOSED));
  const result = await f.run();
  assert.equal(result.failed, 0);
  assert.equal(result.blocked, 2);
  assertPending(f);
  for (const item of f.candidates) {
    assert.deepEqual(f.get(f.candidatePath(item.candidateId)), item);
    assert.equal(f.get(f.ledgerPath(item.candidateId)), undefined);
  }
  assert.equal(f.sent.length, 0);
  assert.ok(f.mails.every((mail) => mail.status !== "failure"));
  assert.ok(f.mails[0].body.includes("\uc2dc\uac04 \ubcf4\ub958: 2\uac74"));
});

test("clock crossing during canonical source reads defers before candidate processing claim", async () => {
  const f = harness({ now: LAST });
  f.onRead((path, transaction) => {
    if (transaction && path === "memberProfiles/member-0") f.clock(CLOSED);
  });
  await f.run();
  assertPending(f);
  assert.ok(!f.writes.some((write) => write.value.status === "processing"));
  assert.equal(f.sent.length, 0);
});

for (const crossAfterClaim of [false, true]) test(`partial batch resumes only unfinished original IDs (last-mile=${crossAfterClaim})`, async () => {
  const f = harness({ now: LAST, count: 3 });
  if (crossAfterClaim) f.provider((item) => { if (item.candidateId === "candidate-1") f.clock(CLOSED); });
  else f.accepted(() => f.clock(CLOSED));
  const first = await f.run();
  assert.equal(first.sent, 1);
  assert.equal(first.failed, 0);
  assertPending(f, 1, 2);
  const accepted = f.get(f.ledgerPath("candidate-0"));
  const started = f.get(f.approvalPath).liveSendStartedAt;
  const candidateBefore = f.get(f.candidatePath("candidate-0"));
  for (const item of f.candidates.slice(1)) assert.deepEqual(f.get(f.candidatePath(item.candidateId)), item);
  f.clock(NEXT); f.refresh(); f.provider(() => {}); f.accepted(() => {});
  // This unrelated candidate must not be discovered even if newly eligible.
  f.seed(f.candidatePath("not-approved"), { ...f.candidates[0], candidateId: "not-approved" });
  const second = await f.run();
  assert.equal(second.sent, 2);
  assert.equal(second.failed, 0);
  assert.equal(f.get(f.approvalPath).status, "sent");
  assert.equal(f.get(f.approvalPath).sentCount, 3);
  assert.equal(f.get(f.approvalPath).liveSendStartedAt, started);
  assert.equal(f.get(f.approvalPath).deferredCount, 0);
  assert.deepEqual(f.get(f.ledgerPath("candidate-0")), accepted);
  assert.deepEqual(f.get(f.candidatePath("candidate-0")), candidateBefore);
  assert.deepEqual(f.sent.map((item) => item.candidateId), ["candidate-0", "candidate-1", "candidate-2"]);
  assert.equal(new Set(f.sent.map((item) => item.candidateId)).size, 3);
  assert.equal((await f.run()).sent, 0);
});

test("parent claim rechecks the clock after its transactional approval read", async () => {
  const f = harness({ now: LAST });
  f.onRead((path, transaction) => { if (transaction && path === f.approvalPath) f.clock(CLOSED); });
  assert.equal((await f.run()).blocked, 1);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.get(f.approvalPath), f.approval);
});

for (const sample of [false, true]) test(`${sample ? "sample" : "bulk"} crossing during eligibility remains deferred, not failed or skipped`, async () => {
  const f = harness({ now: LAST, sample });
  f.exclude(() => { f.clock(CLOSED); return "Synthetic stale eligibility"; });
  const result = await f.run();
  assert.equal(result.blocked, sample ? 1 : 2);
  assert.equal(result.failed || 0, 0);
  assert.equal(result.skipped || 0, 0);
  assert.equal(f.sent.length, 0);
  if (sample) assert.equal(f.get(f.approvalPath).status, "sample_pending");
  else assertPending(f);
});

test("a resumed approval uses real KST today for expiry checks, not its original lookup date", async () => {
  const f = harness({ now: LAST });
  f.provider((item) => { if (item.candidateId === "candidate-1") f.clock(CLOSED); });
  await f.run();
  f.clock(NEXT); f.refresh(); f.provider(() => {});
  f.exclude((item, today) => item.sourceDate === today ? "" : "Synthetic expired D-1 source");
  const result = await f.run();
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
  assert.equal(f.get(f.approvalPath).sentCount, 1);
  assert.equal(f.get(f.approvalPath).skippedCount, 1);
  assert.equal(f.eligibility.at(-1).today, LESSON_DATE);
  assert.equal(f.sent.length, 1);
});

test("a fully finished original target set is not rebuilt or counted as a blocked batch", async () => {
  const f = harness({ now: OPEN });
  await f.run();
  f.seed(f.approvalPath, { ...f.get(f.approvalPath), status: "approved" });
  const evidence = f.candidates.map((item) => f.get(f.ledgerPath(item.candidateId)));
  const result = await f.run();
  assert.equal(result.sent, 0);
  assert.equal(result.blocked, 0);
  assert.equal(f.get(f.approvalPath).status, "sent");
  assert.equal(f.get(f.approvalPath).sentCount, 2);
  assert.deepEqual(f.candidates.map((item) => f.get(f.ledgerPath(item.candidateId))), evidence);
  assert.equal(f.sent.length, 2);
});

for (const issue of ["stale", "cancelled", "phone", "excluded", "duplicate", "unknown-ledger", "content"]) {
  test(`resumed pending batch revalidates ${issue} without replaying the accepted member`, async () => {
    const f = harness({ now: LAST });
    f.provider((item) => { if (item.candidateId === "candidate-1") f.clock(CLOSED); });
    await f.run();
    assertPending(f, 1, 1);
    const accepted = f.get(f.ledgerPath("candidate-0"));
    f.clock(NEXT); f.refresh(); f.provider(() => {});
    if (issue === "stale") f.seed(SNAPSHOT, { ...f.get(SNAPSHOT), active: false });
    if (issue === "cancelled") f.seed(f.registrationPath(f.candidates[1]), { status: "cancelled" });
    if (issue === "phone") f.seed("memberProfiles/member-1", { studioId: "5330", memberId: "member-1", phone: "01099999999" });
    if (issue === "excluded") f.exclude(() => "Synthetic exclusion");
    if (issue === "duplicate") f.duplicate(() => "prior-canonical-send");
    if (issue === "unknown-ledger") f.seed(f.ledgerPath("candidate-1"), { status: "unknown", attempts: 1 });
    if (issue === "content") f.seed(f.candidatePath("candidate-1"), { ...f.candidates[1], templateCode: "changed" });
    const result = await f.run();
    assert.equal(result.sent, 0);
    assert.equal(f.sent.length, 1);
    assert.equal(f.get(f.approvalPath).sentCount, 1);
    assert.deepEqual(f.get(f.ledgerPath("candidate-0")), accepted);
  });
}

test("unknown transport error is not quiet deferral, consumes one attempt and cannot resume", async () => {
  const f = harness({ now: LAST, count: 1 });
  f.provider(() => { f.clock(CLOSED); throw new Error("member_dispatch_quiet_hours"); });
  assert.equal((await f.run()).failed, 1);
  assert.equal(f.get(f.approvalPath).status, "failed");
  assert.equal(f.get(f.ledgerPath("candidate-0")).attempts, 1);
  f.clock(NEXT); f.refresh(); f.provider(() => {});
  assert.equal((await f.run()).sent, 0);
});

test("mixed unknown failure and quiet deferrals never reapprove an unsafe batch", async () => {
  const f = harness({ now: LAST, count: 3 });
  f.provider(() => { f.clock(CLOSED); throw new Error("Synthetic ambiguous provider result"); });
  const result = await f.run();
  assert.equal(result.failed, 1);
  assert.equal(result.blocked, 2);
  assert.equal(f.get(f.approvalPath).status, "failed");
  assert.equal(f.get(f.ledgerPath("candidate-0")).attempts, 1);
  for (const item of f.candidates.slice(1)) {
    assert.deepEqual(f.get(f.candidatePath(item.candidateId)), item);
    assert.equal(f.get(f.ledgerPath(item.candidateId)), undefined);
  }
  f.clock(NEXT); f.refresh(); f.provider(() => {});
  assert.equal((await f.run()).sent, 0);
});

for (const race of ["candidate", "accepted-ledger"]) test(`last-mile rollback never overwrites a concurrent ${race}`, async () => {
  const f = harness({ now: LAST, count: 1 });
  const evidence = { status: "done", solapiMessageId: "already-accepted", attempts: 1 };
  f.provider(() => {
    f.clock(CLOSED);
    if (race === "candidate") f.seed(f.candidatePath("candidate-0"), { ...f.get(f.candidatePath("candidate-0")), updatedAt: "external-change" });
    else f.seed(f.ledgerPath("candidate-0"), evidence);
  });
  const result = await f.run();
  assert.equal(result.failed, 0);
  assert.equal(f.get(f.approvalPath).status, "failed", "An unresolved claim must not be automatically resumable");
  if (race === "candidate") assert.equal(f.get(f.candidatePath("candidate-0")).updatedAt, "external-change");
  else assert.deepEqual(f.get(f.ledgerPath("candidate-0")), evidence);
  assert.equal(f.sent.length, 0);
});

test("concurrent pending-batch resumes send each remaining ID at most once", async () => {
  const f = harness({ now: LAST, count: 3 });
  f.provider((item) => { if (item.candidateId === "candidate-1") f.clock(CLOSED); });
  await f.run();
  f.clock(NEXT); f.refresh(); f.provider(() => {});
  const results = await Promise.all([f.run(), f.run()]);
  assert.equal(results.reduce((n, result) => n + result.sent, 0), 2);
  assert.equal(f.get(f.approvalPath).sentCount, 3);
  assert.equal(f.sent.length, 3);
  assert.equal(new Set(f.sent.map((item) => item.candidateId)).size, 3);
});

test("shared last-mile policy and approved-ID boundary remain wired without a scheduler", () => {
  const source = readFileSync(new URL("src/alimtalk/instructorLessonSampleApproval.ts", root), "utf8");
  assert.match(source, /from "\.\.\/memberSignup\/memberDispatchWindow"/);
  assert.match(source, /candidatesByIds\(approval\.candidateIds/);
  assert.match(source, /instructorLessonGroupSourceIssue\(group\)/);
  assert.match(source, /if \(send\.exists\) return blocked/);
  assert.doesNotMatch(source, /onSchedule|CloudTasks|setInterval|buildAlimtalkCandidates/);
  const transport = readFileSync(new URL("src/alimtalk/processAlimtalkQueue.ts", root), "utf8");
  const fn = transport.slice(transport.indexOf("export async function sendSolapiAlimtalk"));
  assert.match(fn, /await assertCandidateDispatchAllowed\(candidate\)/);
  assert.match(fn, /await assertCandidateDispatchAllowed\(candidate, true\)/);
  const guard = readFileSync(new URL("src/alimtalk/recommendedMealTestWindow.ts", root), "utf8");
  assert.match(guard, /if \(!isMealWindowTest\(candidate\)\)/);
  assert.match(guard, /if \(!memberDispatchWindow\(\)\.allowed\) throw new MemberDispatchDeferredError/);
});
