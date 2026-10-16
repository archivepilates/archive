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
const SOURCE_DATE = "2026-10-16";
const LESSON_DATE = "2026-10-17";
const NOW = "2026-10-16T09:00:00.000Z";
const MANAGEMENT = "support-movement-261017";
const TEMPLATE = "SYNTHETIC_V3";
const APPROVALS = "instructorLessonAlimtalkApprovals";
const SNAPSHOT = "opsState/studiomateReservationExcelEmergency";
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const plain = (value) => JSON.parse(JSON.stringify(value));
const candidatePath = (id) => `alimtalkCandidates/${id}`;
const ledgerPath = (id) => `alimtalkSends/${id}`;
const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("8210") ? `0${digits.slice(2)}` : digits;
};
const registrationPath = (candidate, date = LESSON_DATE) => `instructorLessonRegistrations/ilr_${createHash("sha256")
  .update(`${candidate.studioId}|${normalizePhone(candidate.memberPhone)}|${date}`).digest("hex").slice(0, 24)}`;
const prohibited = (operation) => { throw new Error(`Unmocked operation prohibited: ${operation}`); };
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return Date.parse(NOW); }
}

const compiled = new Map();
function evaluate(file, dependencies, globals = {}) {
  if (!compiled.has(file)) {
    compiled.set(file, ts.transpileModule(readFileSync(new URL(`src/${file}.ts`, root), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText);
  }
  const exports = {};
  vm.runInNewContext(compiled.get(file), {
    exports, Date: FixedDate, Error,
    process: { env: {}, memoryUsage: () => ({ rss: 0, heapUsed: 0 }) },
    require: (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : prohibited(`import ${id}`),
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

// All collection scans are forbidden except the date-scoped approval lookup.
// Versions make concurrent claims and commit-time source changes replay callbacks.
function syntheticDb(allowedReads, allowedWrites) {
  const values = new Map();
  const versions = new Map();
  const reads = [];
  const writes = [];
  let conflicts = 0;
  let commitHook;
  let readHook;
  let activeCandidateReads = 0;
  let maxCandidateReads = 0;
  const seed = (path, value) => {
    if (value === undefined) values.delete(path);
    else values.set(path, clone(value));
    versions.set(path, (versions.get(path) || 0) + 1);
  };
  const get = (path) => clone(values.get(path));
  const snap = (path) => {
    const value = get(path);
    return { id: path.split("/").at(-1), ref: doc(path), exists: value !== undefined, data: () => clone(value) };
  };
  const apply = ({ ref, value, options }) => {
    assert.ok(allowedWrites.has(ref.path), `Unscoped write: ${ref.path}`);
    seed(ref.path, options?.merge ? { ...get(ref.path), ...clone(value) } : value);
    writes.push({ path: ref.path, value: clone(value) });
  };
  async function read(ref, transaction = false) {
    assert.ok(allowedReads.has(ref.path), `Unscoped document read: ${ref.path}`);
    const hook = readHook;
    if (hook && await hook({ path: ref.path, transaction, seed, get }) && readHook === hook) readHook = undefined;
    reads.push({ path: ref.path, transaction });
    const version = versions.get(ref.path) || 0;
    const snapshot = snap(ref.path);
    const candidateRead = !transaction && ref.path.startsWith("alimtalkCandidates/");
    if (candidateRead) maxCandidateReads = Math.max(maxCandidateReads, ++activeCandidateReads);
    await Promise.resolve();
    if (candidateRead) activeCandidateReads--;
    return { snapshot, version };
  }
  function doc(path) {
    assert.ok(typeof path === "string" && /^[^/]+\/[^/]+$/.test(path), `Invalid document path: ${path}`);
    return { path, id: path.split("/").at(-1),
      get: async () => (await read({ path })).snapshot,
      set: async (value, options) => apply({ ref: { path }, value, options }) };
  }
  function collection(name, filters = [], cap = Infinity) {
    return { doc: (id) => doc(`${name}/${id}`),
      where: (field, op, expected) => collection(name, [...filters, [field, op, expected]], cap),
      limit: (limit) => collection(name, filters, limit),
      get: async () => {
        assert.equal(name, APPROVALS, `Unscoped collection read: ${name}`);
        assert.ok(filters.some(([field, op, value]) => field === "sourceDate" && op === "==" && value === SOURCE_DATE));
        assert.ok(filters.every(([field, op, value]) => op === "=="
          && ((field === "sourceDate" && value === SOURCE_DATE) || (field === "studioId" && value === "5330"))));
        assert.ok(Number.isFinite(cap) && cap <= 20, "Approval query must stay bounded");
        reads.push({ collection: name, filters: clone(filters), cap });
        const docs = [...values].filter(([path, value]) => path.startsWith(`${name}/`)
          && filters.every(([field, , expected]) => value[field] === expected)).slice(0, cap).map(([path]) => snap(path));
        return { docs, size: docs.length, empty: !docs.length };
      } };
  }
  const db = { doc, collection,
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const observed = new Map();
        const staged = [];
        const result = await callback({
          get: async (ref) => {
            assert.equal(staged.length, 0, "Transaction reads must precede writes");
            const { snapshot, version } = await read(ref, true);
            observed.set(ref.path, version);
            return snapshot;
          },
          set: (ref, value, options) => staged.push({ ref, value, options }),
        });
        if (commitHook?.({ staged, seed, get })) commitHook = undefined;
        if ([...observed].some(([path, version]) => version !== (versions.get(path) || 0))) {
          conflicts++;
          continue;
        }
        staged.forEach(apply);
        return result;
      }
      throw new Error("Synthetic transaction retries exhausted");
    } };
  return { db, seed, get, reads, writes,
    onRead: (hook) => { readHook = hook; },
    onCommit: (hook) => { commitHook = hook; },
    get conflicts() { return conflicts; },
    get maxCandidateReads() { return maxCandidateReads; } };
}

function candidate(index) {
  return { candidateId: `approved-${index}`, studioId: "5330", memberId: `member-${index}`,
    memberName: `Synthetic ${index}`, memberPhone: `010${String(index).padStart(8, "0")}`,
    type: "instructor_lesson_material", status: "candidate", templateCode: TEMPLATE,
    sourceDate: SOURCE_DATE, title: "Synthetic material", reason: "Synthetic D-1",
    payload: { bookingId: `booking-${index}`, lectureId: "lecture-1", lessonDate: LESSON_DATE,
      lectureDate: LESSON_DATE, managementNumber: MANAGEMENT, shortLinkId: "material-link",
      parkingLinkId: `parking-${index}` },
    attempts: 0, maxAttempts: 2, lastError: null, createdAt: 1, updatedAt: 1 };
}

function harness({ count = 1, approvals = true, providerError = false, duplicate = "", autoIssue = "" } = {}) {
  const candidates = Array.from({ length: count }, (_, index) => candidate(index + 1));
  const approvedIds = candidates.map((item) => item.candidateId);
  const approvalId = `instructor_lesson_${hash.stableHash({ studioId: "5330", sourceDate: SOURCE_DATE, managementNumber: MANAGEMENT }).slice(0, 24)}`;
  const approvalPath = `${APPROVALS}/${approvalId}`;
  const allowedReads = new Set([approvalPath, SNAPSHOT]);
  const allowedWrites = new Set([approvalPath]);
  for (const item of candidates) {
    for (const path of [candidatePath(item.candidateId), ledgerPath(item.candidateId), registrationPath(item),
      `bookings/${item.payload.bookingId}`, `lectures/${item.payload.lectureId}`, `memberProfiles/${item.memberId}`]) allowedReads.add(path);
    allowedWrites.add(candidatePath(item.candidateId));
    allowedWrites.add(ledgerPath(item.candidateId));
  }
  const store = syntheticDb(allowedReads, allowedWrites);
  const sent = [];
  const mails = [];
  const eligibilityCalls = [];
  const dedupeCalls = [];
  const routes = [];
  const deps = {
    "node:crypto": crypto,
    "firebase-functions": { logger: { info() {} } },
    "../config/constants": { DEFAULT_STUDIO_ID: "5330", REGION: "synthetic" },
    "../config/firebase": { db: store.db },
    "../firestore/refs": { refs: {
      alimtalkCandidate: (id) => store.db.doc(candidatePath(id)),
      alimtalkSend: (id) => store.db.doc(ledgerPath(id)),
      booking: (id) => store.db.doc(`bookings/${id}`),
      lecture: (id) => store.db.doc(`lectures/${id}`),
      memberProfile: (id) => store.db.doc(`memberProfiles/${id}`),
    } },
    "../google/driveDocsMailer": { sendAlimtalkLogEmail: async (message) => { mails.push(clone(message)); } },
    "../utils/date": { todayKst: () => SOURCE_DATE, nowTimestamp: () => NOW },
    "../utils/hash": hash,
    "./dedupe": { normalizePhone,
      alimtalkDedupeKey: (item) => hash.stableHash({ memberId: item.memberId, lessonDate: item.payload.lessonDate, managementNumber: item.payload.managementNumber }),
      findCompletedDuplicateForCandidate: async (item, key, window) => { dedupeCalls.push({ id: item.candidateId, key, window }); return duplicate; } },
    "./eligibility": { autoSendabilityIssue: async (item, date) => { eligibilityCalls.push({ id: item.candidateId, date }); return autoIssue; } },
    "./targetValidationChecks": {
      targetEligibilityIssue: async (item, date) => { eligibilityCalls.push({ id: item.candidateId, date }); return autoIssue; },
      targetDuplicateIssue: async (item, key, window) => { dedupeCalls.push({ id: item.candidateId, key, window }); return duplicate; },
    },
    "../instructorLessonRegistration/instructorLessonCancellationPolicy": cancellation,
    "./instructorLessonManagement": management,
    "./instructorLessonBookingPolicy": bookingPolicy,
    "./templates": { INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE: TEMPLATE,
      alimtalkDedupePolicy: () => ({ label: "Synthetic lesson once", windowDays: null }) },
    "./processAlimtalkQueue": { sendSolapiAlimtalk: async (item) => {
      assert.ok(approvedIds.includes(item.candidateId), "Only approved IDs may dispatch");
      assert.equal(store.get(approvalPath).status, "sending");
      assert.equal(store.get(candidatePath(item.candidateId)).status, "processing");
      assert.equal(store.get(ledgerPath(item.candidateId)), undefined);
      sent.push(clone(item));
      if (providerError) throw new Error("Synthetic unknown provider outcome");
      return { messageId: `synthetic-${item.candidateId}` };
    } },
    "./testRecipients": { primaryAlimtalkTestRecipient: () => prohibited("sample recipient") },
    "../parking/instructorLessonParkingPreRegistration": { ensureInstructorLessonParkingPreviewShortLink: () => prohibited("sample parking") },
    "../utils/shortLinks": { shortUrlForId: () => prohibited("short-link preparation") },
  };
  const runtime = evaluate("alimtalk/instructorLessonSampleApproval", deps, {
    AbortSignal: { timeout: () => ({ synthetic: true }) },
    fetch: async (url) => {
      const material = `https://in.archivepilates.com/method/${MANAGEMENT}`;
      assert.ok(url === material || url === `${material}/assignment`, `Unmocked URL: ${url}`);
      routes.push(url);
      return { ok: true, text: async () => `data-method-date="${LESSON_DATE}" \uc218\uc5c5\uc790\ub8cc\ub294 \uc218\uc5c5 \ub2f9\uc77c 12\uc2dc\uc5d0 \uacf5\uac1c\ub429\ub2c8\ub2e4.` };
    },
  });
  const approval = { approvalId, studioId: "5330", sourceDate: SOURCE_DATE, lessonDate: LESSON_DATE,
    managementNumber: MANAGEMENT, templateCode: TEMPLATE, status: "approved", candidateIds: approvedIds,
    approvedTargetKeys: candidates.map(runtime.instructorLessonTargetKey),
    contentFingerprint: runtime.instructorLessonContentFingerprint(candidates[0]),
    candidateCount: count, candidateNames: candidates.map((item) => item.memberName),
    sampleCandidateId: `${approvalId}_sample`, sampleRecipientName: "Synthetic operator",
    sampleSolapiMessageId: "synthetic-sample", sampleSentAt: NOW, approvedAt: NOW, createdAt: NOW, updatedAt: NOW };
  if (approvals) store.seed(approvalPath, approval);
  store.seed(SNAPSHOT, { active: true, snapshotPolicy: "bookings_single_source_reconcile_import_range",
    dateRange: { startDate: SOURCE_DATE, endDate: LESSON_DATE }, importedBookings: count, updatedAt: NOW });
  for (const item of candidates) {
    store.seed(candidatePath(item.candidateId), item);
    store.seed(`bookings/${item.payload.bookingId}`, { bookingId: item.payload.bookingId, lectureId: item.payload.lectureId,
      studioId: item.studioId, memberId: item.memberId, memberPhone: item.memberPhone,
      appStatus: "reserved", lectureDate: LESSON_DATE, ticketName: "\uac15\uc0ac\ub808\uc2a8 (2T)" });
    store.seed(`memberProfiles/${item.memberId}`, { studioId: item.studioId, memberId: item.memberId, phone: item.memberPhone });
  }
  store.seed("lectures/lecture-1", { lectureId: "lecture-1", studioId: "5330", date: LESSON_DATE, status: "open", title: "Support Movement" });
  // These realistic distractions must never be discovered or regenerated.
  store.seed(candidatePath("not-approved"), { ...candidate(99), candidateId: "not-approved" });
  store.seed("memberProfiles/unrelated", { memberId: "unrelated", studioId: "5330" });
  store.seed("bookings/unrelated", { studioId: "5330", lectureDate: LESSON_DATE, appStatus: "reserved" });
  store.seed("lectures/unrelated", { studioId: "5330", date: LESSON_DATE, status: "open" });
  store.seed("renewalCases/unrelated", { studioId: "5330" });
  return { ...store, store, runtime, approvalPath, approval, candidates, approvedIds, sent, mails, routes, eligibilityCalls, dedupeCalls,
    run: () => runtime.sendApprovedInstructorLessonAlimtalks({ studioId: "5330", sourceDate: SOURCE_DATE }) };
}

function assertNoDispatch(f) {
  assert.equal(f.sent.length, 0);
  assert.ok(f.writes.every((write) => !write.path.startsWith("alimtalkSends/")));
  assert.ok(!f.writes.some((write) => write.value.status === "processing"));
}

function assertBlockedBatch(f, result, { sent = 0, blockedId = f.approvedIds[0] } = {}) {
  assert.deepEqual(plain(result), { batches: 1, sent, skipped: 0, failed: 0, blocked: 1 });
  const approval = f.get(f.approvalPath);
  assert.equal(approval.status, "failed");
  assert.equal(approval.sentCount, sent);
  assert.equal(approval.blockedCount, 1);
  assert.equal(approval.skippedCount, 0);
  assert.equal(approval.failedCount, 0);
  assert.equal(approval.blockedReasons.length, 1);
  assert.ok(approval.blockedReasons[0].startsWith(`${blockedId}: `));
  assert.ok(approval.blockedReasons[0].length > `${blockedId}: `.length);
  assert.ok(approval.lastError);
  assert.equal(f.mails.length, 1);
  assert.equal(f.mails[0].status, "attention");
  assert.ok(f.mails[0].subject.includes("[\ud655\uc778\ud544\uc694]"));
  assert.ok(f.mails[0].body.includes(approval.blockedReasons[0]));
}

test("zero approvals reads only the scoped approval query", async () => {
  const f = harness({ approvals: false });
  assert.deepEqual(plain(await f.run()), { batches: 0, sent: 0, skipped: 0, failed: 0, blocked: 0 });
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].collection, APPROVALS);
  assert.equal(f.writes.length, 0);
  assert.equal(f.routes.length, 0);
  assert.equal(f.mails.length, 0);
  assertNoDispatch(f);
});

test("the DB harness rejects every unscoped source, renewal, and candidate read", async () => {
  const f = harness();
  for (const name of ["memberProfiles", "bookings", "lectures", "renewalCases", "renewals", "alimtalkCandidates"]) {
    await assert.rejects(f.store.db.collection(name).get(), /Unscoped collection read/);
    await assert.rejects(f.store.db.collection(name).where("studioId", "==", "5330").get(), /Unscoped collection read/);
    await assert.rejects(f.store.db.doc(`${name}/unapproved-read`).get(), /Unscoped document read/);
  }
  await assert.rejects(f.store.db.collection(APPROVALS).limit(20).get());
  assert.equal(f.reads.length, 0);
});

test("five approved IDs are read sequentially and sent exactly once without discovering new IDs", async () => {
  const f = harness({ count: 5 });
  const untouched = f.get(candidatePath("not-approved"));
  assert.deepEqual(plain(await f.run()), { batches: 1, sent: 5, skipped: 0, failed: 0, blocked: 0 });
  assert.deepEqual(f.sent.map((item) => item.candidateId), f.approvedIds);
  assert.deepEqual(f.reads.filter((read) => read.path?.startsWith("alimtalkCandidates/") && !read.transaction)
    .map((read) => read.path), f.approvedIds.map(candidatePath));
  assert.equal(f.store.maxCandidateReads, 1);
  assert.equal(f.reads.filter((read) => read.collection).length, 1);
  assert.deepEqual(f.get(candidatePath("not-approved")), untouched);
  assert.equal(f.eligibilityCalls.length, 5);
  assert.equal(f.dedupeCalls.length, 5);
  assert.ok(f.dedupeCalls.every((call) => call.window === null));
  assert.deepEqual(f.get(f.approvalPath).candidateIds, f.approvedIds);
  for (const item of f.sent) {
    assert.equal(item.payload.deliveryMode, "approved_live");
    assert.equal(item.payload.approvalId, f.approval.approvalId);
    assert.equal(f.get(candidatePath(item.candidateId)).status, "sent");
    assert.equal(f.get(ledgerPath(item.candidateId)).status, "done");
  }
  assert.equal((await f.run()).sent, 0);
  assert.equal(f.sent.length, 5);
});

const candidateChanges = {
  "type": (c) => { c.type = "private_survey"; },
  "studio": (c) => { c.studioId = "9999"; },
  "source date": (c) => { c.sourceDate = "2026-10-15"; },
  "embedded ID": (c) => { c.candidateId = "not-approved"; },
  "member ID": (c) => { c.memberId = "different-member"; },
  "phone": (c) => { c.memberPhone = "01099999999"; },
  "template": (c) => { c.templateCode = "STALE_V2"; },
  "lesson date": (c) => { c.payload.lessonDate = "2026-10-18"; },
  "management number": (c) => { c.payload.managementNumber = "different-topic-261017"; },
  "material link": (c) => { c.payload.shortLinkId = "different-link"; },
  "missing booking ID": (c) => { delete c.payload.bookingId; },
  "missing lecture ID": (c) => { delete c.payload.lectureId; },
};
for (const [label, mutate] of Object.entries(candidateChanges)) {
  test(`the fifth candidate's changed ${label} blocks the entire approved batch`, async () => {
    const f = harness({ count: 5 });
    const path = candidatePath(f.approvedIds[4]);
    const changed = f.get(path);
    mutate(changed);
    f.seed(path, changed);
    assert.equal((await f.run()).blocked, 1);
    assert.equal(f.get(f.approvalPath).status, "blocked_content_changed");
    assertNoDispatch(f);
  });
}

for (const [label, change] of Object.entries({
  "target keys": (a) => { a.approvedTargetKeys = []; },
  "fingerprint": (a) => { a.contentFingerprint = "changed"; },
  "empty candidate IDs": (a) => { a.candidateIds = []; },
})) {
  test(`invalid approval ${label} cannot authorize dispatch`, async () => {
    const f = harness();
    const approval = f.get(f.approvalPath);
    change(approval);
    f.seed(f.approvalPath, approval);
    assert.equal((await f.run()).blocked, 1);
    assertNoDispatch(f);
  });
}

test("a missing approved candidate blocks the batch instead of silently shrinking it", async () => {
  const f = harness({ count: 5 });
  f.seed(candidatePath(f.approvedIds[2]), undefined);
  assert.equal((await f.run()).blocked, 1);
  assert.equal(f.get(f.approvalPath).status, "blocked_content_changed");
  assertNoDispatch(f);
});

for (const status of ["failed", "processing", "queued", "pending", "unknown"]) {
  test(`persisted ${status} candidate blocks all five targets before source reads or dispatch`, async () => {
    const f = harness({ count: 5 });
    const path = candidatePath(f.approvedIds[4]);
    const persisted = { ...f.get(path), status };
    f.seed(path, persisted);
    assert.deepEqual(plain(await f.run()), { batches: 1, sent: 0, skipped: 0, failed: 0, blocked: 1 });
    const approval = f.get(f.approvalPath);
    assert.equal(approval.status, "blocked_content_changed");
    assert.ok(approval.lastError.includes("\uc790\ub3d9 \uc7ac\uc2dc\ub3c4 \uae08\uc9c0"));
    assert.deepEqual(f.get(path), persisted);
    assert.equal(f.eligibilityCalls.length, 0);
    assert.equal(f.dedupeCalls.length, 0);
    assert.equal(f.routes.length, 0);
    assert.ok(!f.reads.some((read) => read.path === SNAPSHOT || read.path?.startsWith("bookings/")));
    assert.equal(f.mails.length, 1);
    assert.equal(f.mails[0].status, "urgent");
    assertNoDispatch(f);
  });
}

test("cancellation checks use canonical lesson date, not the D-1 source date", async () => {
  const f = harness();
  const c = f.candidates[0];
  assert.notEqual(registrationPath(c), registrationPath(c, SOURCE_DATE));
  assert.equal(`instructorLessonRegistrations/${f.runtime.instructorLessonCancellationRegistrationId(c)}`, registrationPath(c));
  f.seed(registrationPath(c), { status: "cancellation_pending", cancellation: { jobId: "synthetic-cancel" } });
  assert.equal((await f.run()).blocked, 1);
  assert.ok(f.reads.some((read) => read.path === registrationPath(c)));
  assert.ok(!f.reads.some((read) => read.path === registrationPath(c, SOURCE_DATE)));
  assertNoDispatch(f);
});

const sourceChanges = {
  "non-instructor ticket": (f) => f.seed("bookings/booking-1", { ...f.get("bookings/booking-1"), ticketName: "Group package", ticketClassType: "G", ticketType: "GROUP" }),
  "cancelled booking": (f) => f.seed("bookings/booking-1", { ...f.get("bookings/booking-1"), appStatus: "cancelled" }),
  "missing booking": (f) => f.seed("bookings/booking-1", undefined),
  "superseded booking": (f) => f.seed("bookings/booking-1", { ...f.get("bookings/booking-1"), supersededByBookingId: "canonical-other" }),
  "session-order superseded booking": (f) => f.seed("bookings/booking-1", { ...f.get("bookings/booking-1"), sessionOrder: { supersededByBookingId: "canonical-other" } }),
  "wrong booking member": (f) => f.seed("bookings/booking-1", { ...f.get("bookings/booking-1"), memberId: "other" }),
  "wrong booking phone": (f) => f.seed("bookings/booking-1", { ...f.get("bookings/booking-1"), memberPhone: "01099999999" }),
  "wrong booking studio": (f) => f.seed("bookings/booking-1", { ...f.get("bookings/booking-1"), studioId: "9999" }),
  "wrong booking ID": (f) => f.seed("bookings/booking-1", { ...f.get("bookings/booking-1"), bookingId: "other" }),
  "wrong booking lecture": (f) => f.seed("bookings/booking-1", { ...f.get("bookings/booking-1"), lectureId: "other" }),
  "moved booking": (f) => f.seed("bookings/booking-1", { ...f.get("bookings/booking-1"), lectureDate: "2026-10-18" }),
  "missing lecture": (f) => f.seed("lectures/lecture-1", undefined),
  "closed lecture": (f) => f.seed("lectures/lecture-1", { ...f.get("lectures/lecture-1"), status: "closed" }),
  "wrong lecture studio": (f) => f.seed("lectures/lecture-1", { ...f.get("lectures/lecture-1"), studioId: "9999" }),
  "wrong lecture ID": (f) => f.seed("lectures/lecture-1", { ...f.get("lectures/lecture-1"), lectureId: "other" }),
  "moved lecture": (f) => f.seed("lectures/lecture-1", { ...f.get("lectures/lecture-1"), date: "2026-10-18" }),
  "changed lecture topic": (f) => f.seed("lectures/lecture-1", { ...f.get("lectures/lecture-1"), title: "Different Topic" }),
  "conflicting candidate dates": (f) => {
    const path = candidatePath(f.approvedIds[0]);
    const c = f.get(path); c.payload.lectureDate = "2026-10-18"; f.seed(path, c);
  },
};
for (const [label, mutate] of Object.entries(sourceChanges)) {
  test(`${label} blocks source preflight`, async () => {
    const f = harness();
    mutate(f);
    assert.equal((await f.run()).blocked, 1);
    assert.equal(f.get(f.approvalPath).status, "blocked_source_stale");
    assertNoDispatch(f);
  });
}

for (const [field, code] of [["ticketClassType", "I"], ["ticketClassType", "INSTRUCTOR"],
  ["ticketType", "I"], ["ticketType", " instructor "]]) {
  test(`actual booking policy accepts ${field}=${code} without an instructor ticket name`, async () => {
    const f = harness();
    f.seed("bookings/booking-1", { ...f.get("bookings/booking-1"), ticketName: "", [field]: code });
    assert.equal((await f.run()).sent, 1);
    assert.equal(f.sent.length, 1);
    assert.equal(f.get(f.approvalPath).status, "sent");
    assert.equal(f.mails[0].status, "success");
  });
}

for (const [label, patch] of Object.entries({
  stale: { updatedAt: "2026-10-15T08:59:59.000Z" },
  inactive: { active: false },
  "wrong policy": { snapshotPolicy: "unreconciled" },
  "outside range": { dateRange: { startDate: SOURCE_DATE, endDate: SOURCE_DATE } },
  empty: { importedBookings: 0 },
})) {
  test(`${label} reservation snapshot blocks dispatch`, async () => {
    const f = harness(); f.seed(SNAPSHOT, { ...f.get(SNAPSHOT), ...patch });
    assert.equal((await f.run()).blocked, 1);
    assert.equal(f.get(f.approvalPath).status, "blocked_source_stale");
    assertNoDispatch(f);
  });
}

for (const status of ["done", "failed", "processing", "unknown"]) {
  test(`prior ${status} send ledger is never retried or overwritten`, async () => {
    const f = harness();
    const path = ledgerPath(f.approvedIds[0]);
    const ledger = { status, attempts: 1, immutable: "provider evidence" };
    f.seed(path, ledger);
    assertBlockedBatch(f, await f.run());
    assert.deepEqual(f.get(path), ledger);
    assertNoDispatch(f);
    assert.equal((await f.run()).sent, 0);
    assert.equal(f.mails.length, 1, "A failed blocked batch must not automatically resume");
  });
}

test("one prior ledger in five approved targets reports partial delivery as attention, not success", async () => {
  const f = harness({ count: 5 });
  const blockedId = f.approvedIds[2];
  const path = ledgerPath(blockedId);
  const ledger = { status: "unknown", immutable: "provider evidence" };
  f.seed(path, ledger);
  assertBlockedBatch(f, await f.run(), { sent: 4, blockedId });
  assert.deepEqual(f.sent.map((item) => item.candidateId), f.approvedIds.filter((id) => id !== blockedId));
  assert.deepEqual(f.get(path), ledger);
});

for (const status of ["sending", "failed", "sent", "no_targets", "sample_sent", "sample_unknown"]) {
  test(`${status} approval cannot start or resume a send`, async () => {
    const f = harness(); f.seed(f.approvalPath, { ...f.approval, status });
    assert.equal((await f.run()).sent, 0);
    assert.equal(f.reads.filter((read) => read.path?.startsWith("alimtalkCandidates/")).length, 0);
    assertNoDispatch(f);
    if (["sending", "failed", "sent", "no_targets"].includes(status)) assert.equal(f.get(f.approvalPath).status, status);
  });
}

test("provider outcome unknown is one attempt and cannot be retried by another invocation", async () => {
  const f = harness({ providerError: true });
  assert.equal((await f.run()).failed, 1);
  assert.equal(f.get(f.approvalPath).status, "failed");
  assert.equal(f.get(ledgerPath(f.approvedIds[0])).status, "failed");
  assert.equal(f.get(candidatePath(f.approvedIds[0])).maxAttempts, 1);
  assert.equal((await f.run()).sent, 0);
  assert.equal(f.sent.length, 1);
});

test("eligibility and historical duplicate guards still run before the final claim", async () => {
  for (const options of [{ autoIssue: "Synthetic exclusion" }, { duplicate: "historical-other-id" }]) {
    const f = harness(options);
    assert.equal((await f.run()).skipped, 1);
    assert.equal(f.get(candidatePath(f.approvedIds[0])).reasonCode,
      options.autoIssue ? "instructor_lesson_final_guard_blocked" : "duplicate_send_blocked");
    assertNoDispatch(f);
  }
});

test("concurrent invocations claim each of five approved candidates at most once", async () => {
  const f = harness({ count: 5 });
  const results = await Promise.all([f.run(), f.run()]);
  assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 5);
  assert.equal(f.sent.length, 5);
  assert.equal(new Set(f.sent.map((item) => item.candidateId)).size, 5);
  assert.ok(f.store.conflicts > 0, "The test must exercise an optimistic conflict");
  assert.equal(f.get(f.approvalPath).status, "sent");
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("losing concurrent invocation cannot preflight or overwrite the owner's active sending state", { timeout: 3000 }, async () => {
  const f = harness({ count: 5 });
  const entered = deferred();
  const release = deferred();
  f.store.onRead(async ({ path, transaction }) => {
    if (transaction || path !== candidatePath(f.approvedIds[0])) return false;
    assert.equal(f.get(f.approvalPath).status, "sending", "Ownership must precede candidate preflight");
    entered.resolve();
    await release.promise;
    return true;
  });
  const runs = [f.run(), f.run()];
  try {
    await entered.promise;
    const loser = await Promise.race(runs);
    assert.equal(loser.blocked, 1);
    assert.equal(loser.sent, 0);
    assert.equal(f.get(f.approvalPath).status, "sending");
    assert.deepEqual(f.writes.map((write) => [write.path, write.value.status]), [[f.approvalPath, "sending"]]);
    assert.equal(f.mails.length, 0);
    assert.equal(f.routes.length, 0);
    assert.equal(f.sent.length, 0);
  } finally {
    release.resolve();
    await Promise.all(runs);
  }
  assert.equal(f.sent.length, 5);
  assert.equal(f.get(f.approvalPath).status, "sent");
  assert.equal(f.reads.filter((read) => !read.transaction && read.path?.startsWith("alimtalkCandidates/")).length, 5);
});

test("stale losing claim cannot overwrite no_targets after the owner completes preflight", { timeout: 3000 }, async () => {
  const f = harness({ count: 5 });
  for (const id of f.approvedIds) {
    const path = candidatePath(id);
    f.seed(path, { ...f.get(path), status: "skipped" });
  }
  const entered = deferred();
  const release = deferred();
  let approvalReads = 0;
  f.store.onRead(async ({ path, transaction }) => {
    if (!transaction || path !== f.approvalPath || ++approvalReads !== 2) return false;
    entered.resolve();
    await release.promise;
    return true;
  });
  const runs = [f.run(), f.run()];
  try {
    await entered.promise;
    await Promise.race(runs);
    assert.equal(f.get(f.approvalPath).status, "no_targets");
    const terminal = f.get(f.approvalPath);
    const writeCount = f.writes.length;
    release.resolve();
    const results = await Promise.all(runs);
    assert.ok(results.every((result) => result.sent === 0 && result.blocked === 1));
    assert.deepEqual(f.get(f.approvalPath), terminal);
    assert.equal(f.writes.length, writeCount, "A losing claim cannot write a terminal result");
    assert.deepEqual(f.writes.map((write) => write.value.status), ["sending", "no_targets"]);
    assert.equal(f.reads.filter((read) => !read.transaction && read.path?.startsWith("alimtalkCandidates/")).length, 5);
    assert.equal(f.mails.length, 0);
    assertNoDispatch(f);
  } finally {
    release.resolve();
    await Promise.all(runs);
  }
});

for (const [label, mutate] of Object.entries({
  "candidate payload": (f) => {
    const path = candidatePath(f.approvedIds[0]); const c = f.get(path);
    c.payload.parkingLinkId = "changed-after-preflight"; f.seed(path, c);
  },
  "candidate update stamp": (f) => {
    const path = candidatePath(f.approvedIds[0]); f.seed(path, { ...f.get(path), updatedAt: 2 });
  },
  "booking cancellation": sourceChanges["cancelled booking"],
  "booking ticket type": sourceChanges["non-instructor ticket"],
  "booking session-order supersession": sourceChanges["session-order superseded booking"],
  "lecture closure": sourceChanges["closed lecture"],
  "canonical cancellation": (f) => f.seed(registrationPath(f.candidates[0]), { status: "cancelled" }),
  "profile phone": (f) => f.seed("memberProfiles/member-1", { studioId: "5330", memberId: "member-1", phone: "01099999999" }),
  "profile studio": (f) => f.seed("memberProfiles/member-1", { studioId: "9999", memberId: "member-1", phone: f.candidates[0].memberPhone }),
  "profile member ID": (f) => f.seed("memberProfiles/member-1", { studioId: "5330", memberId: "other", phone: f.candidates[0].memberPhone }),
  "missing profile": (f) => f.seed("memberProfiles/member-1", undefined),
  "new unknown ledger": (f) => f.seed(ledgerPath(f.approvedIds[0]), { status: "unknown" }),
})) {
  test(`${label} changed at candidate transaction entry is blocked with attention`, async () => {
    const f = harness();
    f.store.onRead(({ path, transaction }) => {
      if (!transaction || path !== candidatePath(f.approvedIds[0])) return false;
      mutate(f); return true;
    });
    assertBlockedBatch(f, await f.run());
    assertNoDispatch(f);
  });
}

test("source changed after transactional reads forces replay and blocks without leaking the aborted claim", async () => {
  const f = harness();
  f.store.onCommit(({ staged }) => {
    if (!staged.some((write) => write.value.status === "processing")) return false;
    sourceChanges["cancelled booking"](f); return true;
  });
  assertBlockedBatch(f, await f.run());
  assert.ok(f.store.conflicts > 0);
  assert.equal(f.get(candidatePath(f.approvedIds[0])).status, "candidate");
  assertNoDispatch(f);
});

test("candidate changed after transactional reads is revalidated on conflict, not sent from the aborted snapshot", async () => {
  const f = harness();
  const path = candidatePath(f.approvedIds[0]);
  f.store.onCommit(({ staged }) => {
    if (!staged.some((write) => write.value.status === "processing")) return false;
    const current = f.get(path);
    current.payload.parkingLinkId = "rebuilt-at-commit";
    f.seed(path, current);
    return true;
  });
  assertBlockedBatch(f, await f.run());
  assert.ok(f.store.conflicts > 0);
  assert.equal(f.get(path).payload.parkingLinkId, "rebuilt-at-commit");
  assertNoDispatch(f);
});

test("approval targets changed during batch claim cannot authorize the original candidates", async () => {
  const f = harness();
  f.store.onCommit(({ staged }) => {
    if (!staged.some((write) => write.value.status === "sending")) return false;
    f.seed(f.approvalPath, { ...f.get(f.approvalPath), approvedTargetKeys: [] }); return true;
  });
  assert.equal((await f.run()).blocked, 1);
  assert.ok(f.store.conflicts > 0);
  assertNoDispatch(f);
});
