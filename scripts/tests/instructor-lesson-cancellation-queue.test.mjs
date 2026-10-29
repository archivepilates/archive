import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../../firebase/kangsain-functions/functions/", import.meta.url);
const ts = createRequire(new URL("package.json", root))("typescript");
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const plain = (value) => JSON.parse(JSON.stringify(value));
const TODAY = "2026-10-16";
const NOW = "2026-10-16T00:00:00.000Z";
const PHONE = "01000000000";
const NAME = "Synthetic instructor";
const TICKET = "강사레슨 (2T)";
const unavailable = (id) => { throw new Error(`Unmocked dependency prohibited: ${id}`); };
class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return Date.parse(NOW); }
}
const compiled = new Map();
function evaluate(file, dependencies) {
  if (!compiled.has(file)) {
    const source = readFileSync(new URL(`src/${file}.ts`, root), "utf8");
    compiled.set(file, ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText);
  }
  const exports = {};
  vm.runInNewContext(compiled.get(file), {
    exports, Date: FixedDate,
    require: (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : unavailable(id),
  }, { timeout: 1000 });
  return exports;
}
const crypto = { createHash };
const policy = evaluate("instructorLessonRegistration/instructorLessonCancellationPolicy", {
  "node:crypto": crypto, "../utils/errors": { AppError },
});
const teamIntake = evaluate("instructorLessonRegistration/instructorLessonTeamIntake", { "../utils/errors": { AppError } });
const schedule = evaluate("instructorLessonRegistration/instructorLessonSchedule", {
  "node:crypto": crypto, "./instructorLessonTeamIntake": teamIntake,
});

test("Team intake writes only one canonical registration, deduplicates concurrently and rejects changed payload", async () => {
  const f = fixture();
  f.store.delete(f.paths.registration);
  f.store.delete(f.paths.job);
  const data = { memberName: NAME, memberPhone: PHONE, lessonDate: TODAY, paymentMethod: "wiretransfer",
    paymentConfirmed: true, seatConfirmed: true, courseKind: "team", lessonTime: "14:00",
    lessonTopic: "ARCHIVE METHOD #1 Synthetic", paymentAmount: 80000 };
  const create = (patch = {}) => f.runtime.operatorCreateInstructorLessonRegistrationHandler({
    auth: f.request.auth, data: { ...data, ...patch },
  });
  const [first, second] = await Promise.all([create(), create()]);
  assert.equal(first.intakeOnly, true);
  assert.equal(second.duplicate, true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].path, f.paths.registration);
  assert.equal(f.store.get(f.paths.registration).paymentAmount, 80000);
  assert.equal(f.store.get(f.paths.registration).mode, "team_intake");
  for (const patch of [{ paymentAmount: 70000 }, { lessonTime: "15:00" }, { lessonTopic: "other" },
    { memberName: "Different" }, { paymentMethod: "card" }]) {
    await assert.rejects(create(patch), error => error.code === "INVALID_ARGUMENT");
  }
  assert.equal(f.writes.length, 1);
  assert.equal(f.store.has(f.paths.job), false);
});

test("Team intake rejects orphan issuance jobs, existing standard intake and cancelled registrations without writes", async () => {
  for (const issue of ["job", "standard", "cancelled"]) {
    const f = fixture();
    if (issue === "job") f.store.delete(f.paths.registration);
    if (issue === "cancelled") f.store.get(f.paths.registration).status = "cancelled";
    const before = clone(f.store);
    await assert.rejects(f.runtime.operatorCreateInstructorLessonRegistrationHandler({ auth: f.request.auth, data: {
      memberName: NAME, memberPhone: PHONE, lessonDate: TODAY, paymentMethod: "wiretransfer",
      paymentConfirmed: true, seatConfirmed: true, courseKind: "team", lessonTime: "14:00",
      lessonTopic: "Synthetic", paymentAmount: 80000,
    } }), error => error.code === "INVALID_ARGUMENT");
    assert.deepEqual(f.store, before);
    assert.equal(f.writes.length, 0);
  }
});

test("legacy standard intake still creates its original issuance job and rejects missing approvals", async () => {
  const f = fixture();
  f.store.delete(f.paths.registration);
  f.store.delete(f.paths.job);
  const data = { memberName: NAME, memberPhone: PHONE, lessonDate: TODAY, paymentMethod: "card",
    paymentConfirmed: true, seatConfirmed: true };
  await assert.rejects(f.runtime.operatorCreateInstructorLessonRegistrationHandler({ auth: f.request.auth,
    data: { ...data, paymentConfirmed: false } }));
  assert.equal(f.writes.length, 0);
  const result = await f.runtime.operatorCreateInstructorLessonRegistrationHandler({ auth: f.request.auth, data });
  assert.equal(result.status, "queued");
  assert.equal(result.intakeOnly, undefined);
  assert.equal(f.writes.length, 2);
  assert.equal(f.store.get(f.paths.job).ticketName, TICKET);
});

test("Team date/course collision, invalid dates and unauthenticated input cannot write", async () => {
  const data = { memberName: NAME, memberPhone: PHONE, lessonDate: TODAY, paymentMethod: "wiretransfer",
    paymentConfirmed: true, seatConfirmed: true, courseKind: "team", lessonTime: "14:00",
    lessonTopic: "Synthetic", paymentAmount: 80000 };
  for (const scenario of ["standard", "other_time", "lecture", "division", "date", "past", "auth"]) {
    const f = fixture();
    f.store.delete(f.paths.registration); f.store.delete(f.paths.job);
    if (scenario === "standard" || scenario === "other_time") f.store.set("instructorLessonRegistrations/other", {
      studioId: "5330", lessonDate: TODAY, status: "action_required",
      ...(scenario === "other_time" ? { ...data, lessonTime: "15:00", intakeOnly: true } : {}),
    });
    if (scenario === "lecture") f.store.set("lectures/existing", { studioId: "5330", date: TODAY,
      title: "강사레슨 (2T)", startAt: `${TODAY}T09:00:00+09:00` });
    if (scenario === "division") f.store.set("lectures/existing", { studioId: "5330", date: TODAY,
      divisionName: "강사레슨", startAt: `${TODAY}T09:00:00+09:00` });
    const before = clone(f.store);
    await assert.rejects(f.runtime.operatorCreateInstructorLessonRegistrationHandler({
      auth: scenario === "auth" ? undefined : f.request.auth,
      data: { ...data, ...(scenario === "date" ? { lessonDate: "2026-02-30" } : {}),
        ...(scenario === "past" ? { lessonDate: "2026-10-15" } : {}) },
    }));
    assert.deepEqual(f.store, before);
    assert.equal(f.writes.length, 0);
  }
});

function memoryFirestore(seed) {
  const store = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]));
  const writes = [];
  const reads = [];
  let tail = Promise.resolve();
  let beforeTransaction;
  const valueAt = (object, key) => key.split(".").reduce((value, field) => value?.[field], object);
  const snapshot = (path) => {
    const data = clone(store.get(path));
    return { id: path.split("/").at(-1), ref: doc(path), exists: data !== undefined, data: () => clone(data) };
  };
  function doc(path) {
    assert.ok(typeof path === "string" && path.split("/").length % 2 === 0, "valid document path");
    return { path, id: path.split("/").at(-1), get: async () => { reads.push(path); return snapshot(path); } };
  }
  function query(path, filters = [], ordering = [], cap = Infinity) {
    return {
      path, filters, ordering, cap,
      doc: (id) => doc(`${path}/${id}`),
      where: (field, op, expected) => query(path, [...filters, { field, op, expected }], ordering, cap),
      orderBy: (field, direction = "asc") => query(path, filters, [...ordering, { field, direction }], cap),
      limit: (limit) => query(path, filters, ordering, limit),
      get: async () => {
        reads.push({ collection: path, filters: clone(filters), limit: cap });
        let rows = [...store].filter(([key]) => key.startsWith(`${path}/`)
          && key.split("/").length === path.split("/").length + 1);
        rows = rows.filter(([, data]) => filters.every(({ field, op, expected }) => {
          const value = valueAt(data, field);
          switch (op) {
            case "==": return value === expected;
            case ">=": return value !== undefined && value >= expected;
            case "<=": return value !== undefined && value <= expected;
            case "in": return expected.includes(value);
            case "array-contains": return Array.isArray(value) && value.includes(expected);
            default: return unavailable(`Firestore query ${op}`);
          }
        }));
        rows.sort(([aPath, a], [bPath, b]) => {
          for (const { field, direction } of ordering) {
            const av = valueAt(a, field), bv = valueAt(b, field);
            if (av !== bv) return (av < bv ? -1 : 1) * (direction === "desc" ? -1 : 1);
          }
          return aPath.localeCompare(bPath);
        });
        const docs = rows.slice(0, cap).map(([key]) => snapshot(key));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }
  const merge = (base, patch) => {
    const result = clone(base || {});
    for (const [key, value] of Object.entries(patch)) {
      result[key] = value && typeof value === "object" && !Array.isArray(value)
        ? merge(result[key], value) : clone(value);
    }
    return result;
  };
  const db = {
    doc, collection: (path) => query(path),
    runTransaction: (callback) => {
      const run = tail.then(async () => {
        if (beforeTransaction) { const hook = beforeTransaction; beforeTransaction = null; await hook(store); }
        const staged = [];
        const transaction = {
          get: async (ref) => {
            assert.equal(staged.length, 0, "Firestore transaction reads must precede writes");
            return ref.get();
          },
          create: (ref, data) => staged.push({ method: "create", path: ref.path, data: clone(data) }),
          set: (ref, data, options) => staged.push({ method: "set", path: ref.path, data: clone(data), merge: options?.merge === true }),
          update: (ref, data) => staged.push({ method: "update", path: ref.path, data: clone(data) }),
        };
        const result = await callback(transaction);
        const next = new Map(store);
        for (const write of staged) {
          if (write.method === "create") assert.ok(!next.has(write.path), "create cannot overwrite an existing document");
          if (write.method === "update") assert.ok(next.has(write.path), "update requires an existing document");
          next.set(write.path, write.merge || write.method === "update"
            ? merge(next.get(write.path), write.data) : clone(write.data));
        }
        store.clear();
        for (const [path, data] of next) store.set(path, data);
        writes.push(...staged);
        return result;
      });
      tail = run.catch(() => {});
      return run;
    },
  };
  return { db, store, reads, writes, beforeTransaction: (hook) => { beforeTransaction = hook; } };
}

function fixture() {
  const registrationId = `ilr_${createHash("sha256").update(`5330|${PHONE}|${TODAY}`).digest("hex").slice(0, 24)}`;
  const jobId = policy.instructorCancellationId("5330", "101", TODAY);
  const paths = { profile: "memberProfiles/101", registration: `instructorLessonRegistrations/${registrationId}`,
    job: `studiomateInstructorLessonJobs/${registrationId}`, eform: `eformsignInstructorMemberJobs/${registrationId}`,
    candidate: "alimtalkCandidates/confirmation-a", cancellation: `${policy.INSTRUCTOR_CANCELLATIONS}/${jobId}` };
  const seed = {
    [paths.profile]: { studioId: "5330", name: NAME, phone: PHONE, studiomateMemberId: "101",
      activeTicketNames: [TICKET], activeTickets: [{ name: TICKET, availableFrom: TODAY }] },
    [paths.registration]: { registrationId, studioId: "5330", memberName: NAME, memberPhone: PHONE,
      lessonDate: TODAY, status: "completed", evidence: { studiomateMemberId: "101", ticketId: "201",
        confirmationCandidateId: "confirmation-a" }, steps: { ticket: { status: "verified" } }, immutable: "retained" },
    [paths.job]: { status: "pending", immutable: "registration-job" },
    [paths.eform]: { status: "pending", immutable: "eform-job" },
    [paths.candidate]: { studioId: "5330", memberPhone: PHONE, type: "instructor_lesson_confirmation",
      sourceDate: TODAY, status: "queued", immutable: "candidate" },
    "bookings/901": { studioId: "5330", memberId: "101", memberName: NAME, memberPhone: PHONE,
      ticketName: TICKET, lectureDate: TODAY, startTime: "10:00", staffName: "Synthetic staff", appStatus: "reserved" },
  };
  const memory = memoryFirestore(seed);
  const staff = { staffId: "operator-a", uid: "operator-uid", studioId: "5330", name: "Synthetic manager",
    active: true, role: "manager" };
  const runtime = evaluate("instructorLessonRegistration/instructorLessonRegistration", {
    "node:crypto": crypto, "../config/firebase": { db: memory.db }, "../utils/errors": { AppError },
    "../utils/date": { nowTimestamp: () => ({ seconds: Date.parse(NOW) / 1000 }), todayKst: () => TODAY },
    "../security/authGuards": {
      requireStaff: async (request) => {
        if (!request.auth?.uid) throw new AppError("AUTH_REQUIRED", "Authentication required");
        if (request.auth.uid !== staff.uid || !staff.active) throw new AppError("PERMISSION_DENIED", "Invalid account");
        return clone(staff);
      },
      requireManager: (value) => {
        if (!["manager", "owner"].includes(value.role)) throw new AppError("PERMISSION_DENIED", "Manager required");
      },
    },
    "./instructorLessonCancellationPolicy": policy, "./instructorLessonSchedule": schedule,
    "./instructorLessonTeamIntake": teamIntake,
  });
  const request = { auth: { uid: staff.uid }, data: { memberId: "101", lessonDate: TODAY,
    registrationId, confirmed: true, reason: "Operator cancellation" } };
  return { ...memory, runtime, staff, paths, registrationId, jobId, request,
    queue: (req = request) => runtime.operatorQueueInstructorLessonCancellationHandler(req) };
}

async function rejectsWithoutWrites(f, code = "INVALID_ARGUMENT") {
  const before = clone(f.store);
  await assert.rejects(f.queue(), (error) => error.code === code);
  assert.deepEqual(f.store, before);
  assert.equal(f.writes.length, 0);
}

test("parse policy accepts today/future native identity, trims reason and has stable scoped queue keys", () => {
  const input = { memberId: 101, lessonDate: TODAY, confirmed: true, reason: "  valid reason  " };
  assert.deepEqual(plain(policy.parseInstructorCancellation(input, TODAY)), {
    memberId: "101", lessonDate: TODAY, reason: "valid reason", registrationId: "",
  });
  const future = { ...input, lessonDate: "2026-10-17", reason: "x".repeat(200) };
  assert.equal(policy.parseInstructorCancellation(future, TODAY).reason.length, 200);
  assert.equal(policy.instructorCancellationId("5330", "101", TODAY), policy.instructorCancellationId("5330", "101", TODAY));
  for (const args of [["5331", "101", TODAY], ["5330", "102", TODAY], ["5330", "101", "2026-10-17"]]) {
    assert.notEqual(policy.instructorCancellationId(...args), policy.instructorCancellationId("5330", "101", TODAY));
  }
});

test("parse policy rejects fallback IDs, malformed identity/calendar, missing approval and invalid reason", () => {
  const valid = { memberId: "101", lessonDate: TODAY, confirmed: true, reason: "valid" };
  const invalid = [
    ...["excel_101", "usage_booking_101", "0", "00101", " 101", "101 ", "-1", "1.2", "1".repeat(17), null]
      .map((memberId) => ({ memberId })),
    ...["2026-10-15", "2026-02-30", "2026-13-01", "2026-1-16", "2026-10-16T00:00:00Z"]
      .map((lessonDate) => ({ lessonDate })),
    ...["", "a", " ", "x".repeat(201)].map((reason) => ({ reason })),
    { confirmed: false }, { confirmed: "true" }, { registrationId: "untrusted-registration" },
  ];
  for (const patch of invalid) assert.throws(() => policy.parseInstructorCancellation({ ...valid, ...patch }, TODAY),
    (error) => error.code === "INVALID_ARGUMENT", JSON.stringify(patch));
  assert.throws(() => policy.parseInstructorCancellation(null, TODAY));
});

test("no auth, wrong role and inactive account fail before any DB access", async () => {
  for (const mode of ["noauth", "instructor", "viewer", "inactive"]) {
    const f = fixture();
    if (mode === "noauth") delete f.request.auth;
    else if (mode === "inactive") f.staff.active = false;
    else f.staff.role = mode;
    await rejectsWithoutWrites(f, mode === "noauth" ? "AUTH_REQUIRED" : "PERMISSION_DENIED");
    assert.equal(f.reads.length, 0);
  }
});

test("cross-studio profile and registration cannot authorize a queue", async () => {
  for (const path of ["profile", "registration"]) {
    const f = fixture(); f.store.get(f.paths[path]).studioId = "9999";
    await rejectsWithoutWrites(f);
  }
  const f = fixture(); f.staff.studioId = "9999";
  await rejectsWithoutWrites(f);
});

test("invalid/fallback requested IDs and past dates fail before reading the queue or roster", async () => {
  for (const patch of [{ memberId: "excel_101" }, { memberId: "0" }, { memberId: "101/other" },
    { lessonDate: "2026-10-15" }, { lessonDate: "2026-02-30" }, { confirmed: false }]) {
    const f = fixture(); Object.assign(f.request.data, patch);
    await rejectsWithoutWrites(f);
    assert.equal(f.reads.length, 0);
  }
});

test("member must be on the current server roster, not a client-selected stale or unlinked row", async () => {
  for (const mode of ["missing", "other-date", "wrong-registration"]) {
    const f = fixture();
    if (mode === "wrong-registration") f.request.data.registrationId = `ilr_${"f".repeat(24)}`;
    else {
      f.store.delete(f.paths.registration);
      f.store.delete("bookings/901");
      if (mode === "missing") f.store.get(f.paths.profile).activeTicketNames = [];
      else f.store.get(f.paths.profile).activeTickets[0].availableFrom = "2026-10-17";
    }
    await rejectsWithoutWrites(f);
  }
});

test("server owns queued identity and effect scope, ignoring client name/phone/studio/refund overrides", async () => {
  const f = fixture();
  Object.assign(f.request.data, { memberName: "Forged name", memberPhone: "01099999999", studioId: "9999",
    expectedTicketId: "999", paymentRefundAllowed: true, requestedBy: { uid: "forged" } });
  const sourceProfile = clone(f.store.get(f.paths.profile));
  const sourceBooking = clone(f.store.get("bookings/901"));
  const sourceEvidence = clone(f.store.get(f.paths.registration).evidence);
  const result = plain(await f.queue());
  assert.deepEqual(result, { ok: true, jobId: f.jobId, status: "pending", duplicate: false });
  const queued = f.store.get(f.paths.cancellation);
  assert.equal(queued.memberId, "101"); assert.equal(queued.memberName, NAME); assert.equal(queued.memberPhone, PHONE);
  assert.equal(queued.studioId, "5330"); assert.equal(queued.expectedTicketId, "201");
  assert.equal(queued.paymentRefundAllowed, false); assert.equal(queued.externalEffectStarted, false);
  assert.equal(queued.profilePath, f.paths.profile); assert.equal(queued.reason, f.request.data.reason);
  assert.deepEqual(queued.requestedBy, { staffId: f.staff.staffId, uid: f.staff.uid, name: f.staff.name });
  assert.deepEqual(f.store.get(f.paths.profile), sourceProfile); assert.deepEqual(f.store.get("bookings/901"), sourceBooking);
  assert.equal(f.store.get(f.paths.registration).status, "cancellation_pending");
  assert.equal(f.store.get(f.paths.registration).immutable, "retained");
  assert.deepEqual(f.store.get(f.paths.registration).evidence, sourceEvidence);
  assert.equal(f.store.get(f.paths.job).status, "cancelled");
  assert.equal(f.store.get(f.paths.job).immutable, "registration-job");
  assert.equal(f.store.get(f.paths.eform).status, "cancelled");
  assert.equal(f.store.get(f.paths.eform).immutable, "eform-job");
  assert.equal(f.store.get(f.paths.candidate).status, "skipped");
  assert.ok(f.writes.every((write) => [f.paths.cancellation, f.paths.registration, f.paths.job, f.paths.eform, f.paths.candidate].includes(write.path)));
});

test("owner is allowed and profile phone formatting is normalized without rewriting the profile", async () => {
  for (const phone of ["010-0000-0000", "+82 10 0000 0000"]) {
    const f = fixture(); f.staff.role = "owner"; f.store.get(f.paths.profile).phone = phone;
    const before = clone(f.store.get(f.paths.profile));
    await f.queue();
    assert.equal(f.store.get(f.paths.cancellation).memberPhone, PHONE);
    assert.deepEqual(f.store.get(f.paths.profile), before);
  }
});

test("exact canonical profile identity rejects masked/invalid phone and wrong name", async () => {
  for (const patch of [{ phone: "010****0000" }, { phone: "0000" }, { phone: "" }]) {
    const f = fixture(); Object.assign(f.store.get(f.paths.profile), patch);
    await rejectsWithoutWrites(f);
  }
  const f = fixture();
  f.beforeTransaction((store) => { store.get(f.paths.profile).name = "Changed server name"; });
  await assert.rejects(f.queue(), (error) => error.code === "INVALID_ARGUMENT");
  assert.equal(f.writes.length, 0);
});

test("profile lookup may resolve one explicit native-ID link but never guesses ambiguous aliases", async () => {
  for (const count of [0, 1, 2]) {
    const f = fixture(); const profile = clone(f.store.get(f.paths.profile)); f.store.delete(f.paths.profile);
    for (let index = 0; index < count; index++) f.store.set(`memberProfiles/excel_alias_${index}`, clone(profile));
    if (count === 1) {
      assert.equal((await f.queue()).duplicate, false);
      assert.equal(f.store.get(f.paths.cancellation).profilePath, "memberProfiles/excel_alias_0");
    } else await rejectsWithoutWrites(f);
  }
});

test("profile phone/name/studio is reread transactionally before queue writes", async () => {
  for (const patch of [{ phone: "01099999999" }, { name: "Changed identity" }, { studioId: "9999" }]) {
    const f = fixture();
    f.beforeTransaction((store) => Object.assign(store.get(f.paths.profile), patch));
    await assert.rejects(f.queue(), (error) => error.code === "INVALID_ARGUMENT");
    assert.equal(f.writes.length, 0);
    assert.ok(!f.store.has(f.paths.cancellation));
  }
});

test("registration source identity and cancellation state are immutable between roster and transaction", async () => {
  for (const patch of [{ studioId: "9999" }, { memberPhone: "01099999999" }, { lessonDate: "2026-10-17" },
    { status: "cancellation_pending" }, { cancellation: { jobId: "prior-cancellation" } }]) {
    const f = fixture(); f.beforeTransaction((store) => Object.assign(store.get(f.paths.registration), patch));
    await assert.rejects(f.queue(), (error) => error.code === "INVALID_ARGUMENT");
    assert.equal(f.writes.length, 0);
  }
});

test("processing registration/candidate and external-effect evidence block all transactional writes", async () => {
  for (const [path, patch] of [["job", { status: "processing" }], ["job", { externalEffectStarted: true }],
    ["job", { effectStartedAt: NOW }], ["registration", { externalEffectStarted: true }],
    ["candidate", { status: "processing" }]]) {
    const f = fixture(); Object.assign(f.store.get(f.paths[path]), patch);
    await rejectsWithoutWrites(f);
  }
});

test("processing, sending or checking_completion eform blocks; completed eform and sent confirmation are preserved", async () => {
  for (const status of ["processing", "sending", "checking_completion"]) {
    const f = fixture(); f.store.get(f.paths.eform).status = status;
    await rejectsWithoutWrites(f);
  }
  const f = fixture(); f.store.get(f.paths.eform).status = "completed"; f.store.get(f.paths.candidate).status = "sent";
  const before = clone([f.store.get(f.paths.eform), f.store.get(f.paths.candidate)]);
  await f.queue();
  assert.deepEqual([f.store.get(f.paths.eform), f.store.get(f.paths.candidate)], before);
});

test("processing memo blocks by explicit eform pointer or registration query before any writes", async () => {
  for (const linked of [true, false]) {
    const f = fixture();
    f.store.set("studiomateMemoWriteJobs/memo-processing", { registrationId: f.registrationId,
      source: "instructor_member_eformsign", status: "processing", immutable: "native-copy-evidence" });
    if (linked) f.store.get(f.paths.eform).profileMemoJobId = "memo-processing";
    await rejectsWithoutWrites(f);
    if (!linked) assert.ok(f.reads.some((read) => read.collection === "studiomateMemoWriteJobs" && read.limit === 21
      && read.filters.some((filter) => filter.field === "registrationId" && filter.expected === f.registrationId)));
  }
});

test("pending/retry owned memo jobs are cancelled once while source and unrelated jobs remain intact", async () => {
  const f = fixture();
  const owned = ["pending", "retry"].map((status, index) => {
    const path = `studiomateMemoWriteJobs/owned-${index}`;
    f.store.set(path, { registrationId: f.registrationId, source: "instructor_member_eformsign",
      status, memberId: "101", memoId: `canonical-memo-${index}`, text: "Synthetic memo retained" });
    return [path, clone(f.store.get(path))];
  });
  f.store.get(f.paths.eform).profileMemoJobId = "owned-0";
  const ignored = [
    { source: "other_workflow", status: "pending" },
    { source: "other_workflow", status: "processing" },
    { registrationId: "other-registration", status: "pending" },
    { status: "synced" }, { status: "failed" }, { status: "cancelled" },
  ].map((patch, index) => {
    const path = `studiomateMemoWriteJobs/unrelated-${index}`;
    f.store.set(path, { registrationId: f.registrationId, source: "instructor_member_eformsign",
      status: "pending", ...patch });
    return [path, clone(f.store.get(path))];
  });
  const profile = clone(f.store.get(f.paths.profile));
  const booking = clone(f.store.get("bookings/901"));
  const memoSource = { memberId: "101", text: "Canonical member memo must not change", syncStatus: "pending" };
  f.store.set("memberMemos/canonical-memo-0", clone(memoSource));
  await f.queue();
  for (const [path, before] of owned) {
    assert.deepEqual(f.store.get(path), { ...before, status: "cancelled", cancellationJobId: f.jobId,
      updatedAt: { seconds: Date.parse(NOW) / 1000 } });
    assert.equal(f.writes.filter((write) => write.path === path).length, 1, "linked/query overlap must not double-update");
  }
  for (const [path, before] of ignored) assert.deepEqual(f.store.get(path), before);
  assert.deepEqual(f.store.get(f.paths.profile), profile);
  assert.deepEqual(f.store.get("bookings/901"), booking);
  assert.deepEqual(f.store.get("memberMemos/canonical-memo-0"), memoSource);
  assert.ok(f.reads.some((read) => read.collection === "studiomateMemoWriteJobs" && read.limit === 21));
});

test("memo query cap fails closed at 21 records, while 20 owned jobs can be cancelled atomically", async () => {
  for (const count of [20, 21]) {
    const f = fixture();
    for (let index = 0; index < count; index++) f.store.set(`studiomateMemoWriteJobs/owned-${index}`, {
      registrationId: f.registrationId, source: "instructor_member_eformsign", status: "pending",
    });
    if (count === 21) await rejectsWithoutWrites(f);
    else {
      await f.queue();
      assert.equal(f.writes.filter((write) => write.path.startsWith("studiomateMemoWriteJobs/")).length, 20);
      for (let index = 0; index < count; index++) {
        assert.equal(f.store.get(`studiomateMemoWriteJobs/owned-${index}`).status, "cancelled");
      }
    }
  }
});

test("memo becoming processing at transaction entry blocks queue without partially cancelling pending siblings", async () => {
  const f = fixture();
  for (const key of ["pending-sibling", "racing-job"]) f.store.set(`studiomateMemoWriteJobs/${key}`, {
    registrationId: f.registrationId, source: "instructor_member_eformsign", status: "pending",
  });
  f.beforeTransaction((store) => { store.get("studiomateMemoWriteJobs/racing-job").status = "processing"; });
  await assert.rejects(f.queue(), (error) => error.code === "INVALID_ARGUMENT");
  assert.equal(f.writes.length, 0);
  assert.equal(f.store.get("studiomateMemoWriteJobs/pending-sibling").status, "pending");
  assert.ok(!f.store.has(f.paths.cancellation));
});

test("unlinked processing D1 material candidate blocks cancellation by exact recipient/date/studio", async () => {
  const f = fixture();
  f.store.set("alimtalkCandidates/d1-material", { memberPhone: PHONE, studioId: "5330",
    type: "instructor_lesson_material", payload: { lessonDate: TODAY }, status: "processing" });
  await rejectsWithoutWrites(f);
  assert.ok(f.reads.some((read) => read.collection === "alimtalkCandidates" && read.limit === 501
    && read.filters.some((filter) => filter.field === "memberPhone" && filter.expected === PHONE)));
});

test("processing candidates outside the exact recipient/date/studio/type scope do not block or change", async () => {
  for (const patch of [{ sourceDate: "2026-10-17" }, { studioId: "9999" },
    { memberPhone: "01099999999" }, { type: "private_survey" }]) {
    const f = fixture();
    const candidate = { memberPhone: PHONE, studioId: "5330", sourceDate: TODAY,
      type: "instructor_lesson_material", status: "processing", ...patch };
    f.store.set("alimtalkCandidates/other-processing", clone(candidate));
    await f.queue();
    assert.deepEqual(f.store.get("alimtalkCandidates/other-processing"), candidate);
  }
});

test("same-date unsent material/confirmation candidates are skipped; other dates/studios/types/recipients stay unchanged", async () => {
  const f = fixture();
  const affected = ["candidate", "reviewed", "queued", "pending"].map((status, index) => {
    const path = `alimtalkCandidates/material-${index}`;
    f.store.set(path, { memberPhone: PHONE, studioId: "5330", status,
      type: index % 2 ? "instructor_lesson_confirmation" : "instructor_lesson_material",
      ...(index % 2 ? { payload: { lessonDate: TODAY } } : { sourceDate: TODAY }) });
    return path;
  });
  const ignored = [
    { sourceDate: "2026-10-17" }, { studioId: "9999" }, { type: "private_survey" },
    { memberPhone: "01099999999" }, { status: "sent" }, { status: "failed" },
  ].map((patch, index) => {
    const path = `alimtalkCandidates/ignored-${index}`;
    f.store.set(path, { memberPhone: PHONE, studioId: "5330", status: "queued",
      type: "instructor_lesson_material", sourceDate: TODAY, ...patch });
    return [path, clone(f.store.get(path))];
  });
  await f.queue();
  for (const path of affected) {
    assert.equal(f.store.get(path).status, "skipped");
    assert.equal(f.store.get(path).reasonCode, "instructor_lesson_cancellation_requested");
  }
  for (const [path, before] of ignored) assert.deepEqual(f.store.get(path), before);
});

test("recipient candidate cap fails closed at 501 records, with no partial job or candidate changes", async () => {
  const f = fixture();
  for (let index = 0; index < 500; index++) f.store.set(`alimtalkCandidates/extra-${index}`, {
    memberPhone: PHONE, studioId: "5330", type: "instructor_lesson_material", sourceDate: TODAY, status: "queued",
  });
  await rejectsWithoutWrites(f);
});

test("duplicate queue returns durable status without overwriting payload, even after roster disappears", async () => {
  const f = fixture(); await f.queue();
  f.store.get(f.paths.cancellation).status = "completed";
  f.store.delete(f.paths.profile);
  const before = clone(f.store); const count = f.writes.length; f.reads.length = 0;
  f.request.data.reason = "Later conflicting request";
  assert.deepEqual(plain(await f.queue()), { ok: true, jobId: f.jobId, status: "completed", duplicate: true });
  assert.deepEqual(f.store, before); assert.equal(f.writes.length, count);
  assert.deepEqual(f.reads, [f.paths.cancellation]);
});

test("two concurrent queue requests serialize to one create and one duplicate without overwrite", async () => {
  const f = fixture();
  const results = await Promise.all([f.queue(), f.queue()]);
  assert.deepEqual(results.map((result) => result.duplicate).sort(), [false, true]);
  assert.equal(f.writes.filter((write) => write.path === f.paths.cancellation && write.method === "create").length, 1);
  assert.equal([...f.store.keys()].filter((path) => path.startsWith(`${policy.INSTRUCTOR_CANCELLATIONS}/`)).length, 1);
});

test("cancelled and cancellation-pending registrations cannot be recreated or automatically reissued", async () => {
  for (const patch of [{ status: "cancelled" }, { status: "cancellation_pending" }, { status: "cancellation_review" },
    { status: "completed", cancellation: { jobId: "prior-cancellation" } }]) {
    const f = fixture(); Object.assign(f.store.get(f.paths.registration), patch);
    const before = clone(f.store);
    await assert.rejects(f.runtime.operatorCreateInstructorLessonRegistrationHandler({ auth: f.request.auth, data: {
      memberName: NAME, memberPhone: PHONE, lessonDate: TODAY, paymentMethod: "card", paymentConfirmed: true, seatConfirmed: true,
    } }), (error) => error.code === "INVALID_ARGUMENT");
    assert.deepEqual(f.store, before); assert.equal(f.writes.length, 0);
    assert.equal(policy.cancellationBlocksRegistration(f.store.get(f.paths.registration)), true);
  }
});
