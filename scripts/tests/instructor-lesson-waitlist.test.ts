import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { parseRegistrationInput, instructorLessonRegistrationId } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonRegistration";
import { sameInstructorCourse, teamIntakeFields } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonTeamIntake";
import { instructorLessonWaitlistFields, isInstructorLessonWaitlist } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonWaitlist";
import { buildInstructorLessonScheduleSummaries } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonSchedule";
import { cancellationBlocksRegistration } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonCancellationPolicy";
import { instructorLessonTicketConfirmationIssue, queueInstructorLessonConfirmationOnTicketVerifiedHandler } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonConfirmation";
import { deriveInstructorLessonRegistrationState } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonRegistrationState";
import { isInstructorLessonWaitlist as runtimeWaitlist, deriveInstructorLessonRegistrationState as runtimeState }
  from "../lib/instructor-lesson-registration-contract.mjs";
import { activeIdentities } from "../lib/imweb-instructor-orders.mjs";

const requireFunctions = createRequire(path.resolve("firebase/kangsain-functions/functions/package.json"));
const ts = requireFunctions("typescript");
const source = fs.readFileSync("firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonRegistration.ts", "utf8");
const tree = ts.createSourceFile("registration.ts", source, ts.ScriptTarget.ES2022, true);
const names = new Set(["operatorCreateInstructorLessonRegistrationHandler", "assertSameRegistration", "cleanText", "normalizePhone", "step"]);
const declarations = tree.statements.filter((node: any) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(declarations.length, names.size);
const compiled = ts.transpileModule(declarations.map((d: any) => d.getText(tree)).join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const input = { courseKind: "waitlist", memberName: "Fake Member", memberPhone: "01000000001", lessonDate: "2099-11-29",
  paymentMethod: "none", paymentConfirmed: false, seatConfirmed: false };
const paid = { ...input, courseKind: "standard", paymentMethod: "card", paymentConfirmed: true, seatConfirmed: true };

function fixture() {
  const rows = new Map<string, any>(), writes: string[] = [];
  let chain = Promise.resolve();
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }),
      where: () => ({ where: () => ({ collection: name }) }) }),
    runTransaction: (fn: any) => {
      const run = chain.then(async () => {
        const staged = new Map<string, any>();
        const result = await fn({ get: async (r: any) => r.path
          ? { exists: rows.has(r.path), data: () => rows.get(r.path) ? structuredClone(rows.get(r.path)) : undefined }
          : { docs: [...rows].filter(([key]) => key.startsWith(`${r.collection}/`)).map(([id, data]) => ({ id, data: () => structuredClone(data) })) },
        set: (r: any, value: any) => staged.set(r.path, structuredClone(value)) });
        for (const [key, value] of staged) { rows.set(key, value); writes.push(key); }
        return result;
      });
      chain = run.then(() => undefined, () => undefined); return run;
    },
  };
  class FakeError extends Error {}
  const handler = vm.runInNewContext(`${compiled}\noperatorCreateInstructorLessonRegistrationHandler`, {
    exports: {}, db, parseRegistrationInput, instructorLessonRegistrationId, sameInstructorCourse, teamIntakeFields,
    instructorLessonWaitlistFields, isInstructorLessonWaitlist, cancellationBlocksRegistration,
    manager: async (r: any) => { if (r.role !== "manager") throw Error("fake permission denied");
      return { studioId: "5330", staffId: "fake-manager", name: "Fake Manager" }; },
    nowTimestamp: () => "2099-10-01T00:00:00.000Z", AppError: FakeError,
    REGISTRATIONS: "instructorLessonRegistrations", STUDIOMATE_JOBS: "studiomateInstructorLessonJobs",
    TICKET_NAME: "강사레슨 (2T)", isInstructorLesson: () => false,
  });
  const call = (data: any, role = "manager") => handler({ data, role });
  return { rows, writes, call };
}

test("waitlist parse requires no payment and retains false checks", () => {
  assert.deepEqual(parseRegistrationInput(input), input);
  for (const patch of [{ paymentMethod: "card" }, { paymentConfirmed: true }, { seatConfirmed: true },
    { paymentAmount: 0 }, { lessonTopic: "fake" }, { lessonTime: "14:00" }, { lessonDate: "2099-02-30" },
    { lessonDate: "2000-01-01" }, { memberPhone: "bad" }]) {
    assert.throws(() => parseRegistrationInput({ ...input, ...patch }));
  }
  assert.throws(() => parseRegistrationInput({ ...paid, paymentConfirmed: false }));
});

test("real handler writes one canonical waitlist and no downstream job", async () => {
  const f = fixture(); const result = await f.call(input);
  assert.equal(result.waitlistOnly, true); assert.equal(result.status, "waitlisted");
  assert.equal(f.rows.size, 1); assert.ok([...f.rows.keys()][0].startsWith("instructorLessonRegistrations/"));
  const row = [...f.rows.values()][0]; assert.equal(row.paymentMethod, "none"); assert.equal(row.waitlistOnly, true);
  assert.deepEqual(row.operatorChecks, { paymentConfirmed: false, seatConfirmed: false });
  assert.ok(Object.values(row.steps).every((s: any) => s.status === "not_required"));
  assert.equal(row.ticketName, "");
});

test("concurrent normalized-phone duplicates do not change the original position", async () => {
  const f = fixture(); const r = await Promise.all([f.call(input), f.call({ ...input, memberPhone: "+82 10-0000-0001" })]);
  assert.equal(r.filter(v => v.duplicate === false).length, 1); assert.equal(r.filter(v => v.duplicate === true).length, 1);
  assert.equal(f.rows.size, 1); assert.equal(f.writes.length, 1);
});

test("only an explicit paid intake converts a waitlist; no automatic promotion", async () => {
  const f = fixture(); await f.call(input);
  await assert.rejects(f.call({ ...paid, paymentConfirmed: false })); assert.equal(f.rows.size, 1);
  const result = await f.call(paid); assert.equal(result.status, "queued"); assert.equal(f.rows.size, 2);
  const row = f.rows.get(`instructorLessonRegistrations/${result.registrationId}`);
  assert.equal(row.waitlistOnly, false); assert.equal(row.courseKind, "standard");
  assert.equal(row.waitlistHistory.registeredAt, "2099-10-01T00:00:00.000Z");
  const duplicate = await f.call(paid); assert.equal(duplicate.duplicate, true); assert.equal(f.rows.size, 2);
  await assert.rejects(f.call(input)); assert.equal(row.status, "queued");
});

test("a stray issuance job or insufficient permission blocks waitlist writes", async () => {
  const f = fixture(); await assert.rejects(f.call(input, "instructor")); assert.equal(f.rows.size, 0);
  const id = instructorLessonRegistrationId("5330", input.memberPhone, input.lessonDate);
  f.rows.set(`studiomateInstructorLessonJobs/${id}`, { status: "pending" });
  await assert.rejects(f.call(input)); assert.equal(f.rows.size, 1);
});

test("schedule separates unpaid FIFO waitlist without changing occupied seats or metadata", () => {
  const registrations = [
    { ...input, ...instructorLessonWaitlistFields("2099-10-02T00:00:00Z"), registrationId: "wait-b", memberPhone: "01000000002" },
    { ...input, ...instructorLessonWaitlistFields("2099-10-01T00:00:00Z"), registrationId: "wait-a" },
    { ...paid, memberPhone: "01000000003", registrationId: "paid", status: "queued", operatorChecks: { paymentConfirmed: true, seatConfirmed: true } },
  ];
  const build = (rows: any[]) => buildInstructorLessonScheduleSummaries({ startDate: "2099-11-01", endDate: "2099-11-30", registrations: rows })[0];
  const summary = build(registrations), baseline = build(registrations.slice(2));
  for (const key of ["occupiedCount", "remainingSeats", "capacity", "confirmedPendingRegistrationCount", "registrationCount", "courseKind"] as const) {
    assert.equal(summary[key], baseline[key]);
  }
  assert.equal(summary.waitlistCount, 2); assert.equal(summary.roster?.length, 1);
  assert.deepEqual(summary.waitlist.map(w => w.registrationId), ["wait-a", "wait-b"]);
  assert.deepEqual(summary.waitlist.map(w => w.position), [1, 2]);
  assert.equal(summary.waitlist[0].memberPhone, input.memberPhone);
  assert.equal(build(registrations.slice(0, 2)).occupiedCount, 0);
  assert.equal(build(registrations.slice(0, 2)).waitlistCount, 2);
});

test("waitlist cannot trigger confirmation or completion even with forged verified steps", async () => {
  const record = { ...instructorLessonWaitlistFields("2099-01-01"), intakeOnly: false,
    steps: { ticket: { status: "verified" }, member: { status: "verified" } } };
  assert.match(instructorLessonTicketConfirmationIssue(record), /수강대기/);
  assert.equal((await queueInstructorLessonConfirmationOnTicketVerifiedHandler({ registrationId: "fake", after: record })).skipped, "waitlist_only");
  assert.equal(deriveInstructorLessonRegistrationState(record).status, "waitlisted");
});

for (const field of ["waitlistOnly", "courseKind", "mode", "status"]) {
  test(`independent ${field} marker excludes downstream sends in both runtimes`, () => {
    const value = { [field]: field === "waitlistOnly" ? true : field === "status" ? "waitlisted" : "waitlist" };
    assert.equal(isInstructorLessonWaitlist(value), true); assert.equal(runtimeWaitlist(value), true);
    assert.match(instructorLessonTicketConfirmationIssue({ ...value, operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
      steps: { member: { status: "verified" }, ticket: { status: "verified" } } }), /수강대기/);
  });
}

test("waiters do not consume homepage paid-order capacity", () => {
  const registrations = { docs: [
    { id: "wait", data: () => ({ ...input, ...instructorLessonWaitlistFields("2099-10-01"), studioId: "5330" }) },
    { id: "paid", data: () => ({ ...paid, status: "queued", memberPhone: "01000000002", studioId: "5330" }) },
  ] };
  const people = activeIdentities(registrations, { docs: [] }, input.lessonDate, { docs: [] }, []);
  assert.equal(people.size, 1); assert.equal(people.has(input.memberPhone), false);
  assert.equal(runtimeState({ mode: "waitlist", steps: {} }).status, "waitlisted");
});

test("real Mac worker quarantines a stray job without mutating a waiter or starving paid jobs", async () => {
  const worker = fs.readFileSync("scripts/process-instructor-lesson-registration-jobs.mjs", "utf8");
  const ast = ts.createSourceFile("worker.mjs", worker, ts.ScriptTarget.ES2022, true);
  const claim = ast.statements.find((n: any) => ts.isFunctionDeclaration(n) && n.name?.text === "claimJob");
  assert.ok(claim);
  let reads = 0;
  const jobs = new Map<string, any>([["fake-job", { status: "pending", attempts: 0 }], ["paid-job", { status: "pending" }]]);
  const writes: string[] = [];
  const run = vm.runInNewContext(`${claim.getText(ast)}\nclaimJob`, {
    isInstructorLessonWaitlist: runtimeWaitlist, registration: () => ({ kind: "registration" }),
    FieldValue: { serverTimestamp: () => "synthetic-now" },
    db: { runTransaction: (fn: any) => fn({
      get: async (ref: any) => { reads++; return { exists: true, data: () => ref.kind === "registration"
        ? instructorLessonWaitlistFields("2099-10-01") : jobs.get(ref.id) }; },
      set: (ref: any, patch: any) => { assert.notEqual(ref.kind, "registration");
        jobs.set(ref.id, { ...jobs.get(ref.id), ...patch }); writes.push(ref.id); },
      update: () => { throw Error("Unexpected waitlist mutation"); },
    }) },
  });
  assert.equal(await run({ id: "fake-job" }), null); assert.equal(reads, 2);
  assert.equal(jobs.get("fake-job").status, "review_required");
  assert.equal(jobs.get("fake-job").attempts, 0);
  assert.deepEqual([...jobs].filter(([, row]) => ["pending", "retry"].includes(row.status)).map(([id]) => id), ["paid-job"]);
  await run({ id: "fake-job" }); assert.deepEqual(writes, ["fake-job"]);
});

test("explicit team conversion preserves waitlist history and duplicate replay creates no job", async () => {
  const f = fixture(); await f.call(input);
  const team = { ...paid, courseKind: "team", lessonTime: "14:00", lessonTopic: "Synthetic team", paymentAmount: 80000 };
  const result = await f.call(team); assert.equal(result.intakeOnly, true);
  const row = f.rows.get(`instructorLessonRegistrations/${result.registrationId}`);
  assert.equal(row.courseKind, "team"); assert.equal(row.waitlistOnly, false);
  assert.equal(row.waitlistHistory.registeredAt, "2099-10-01T00:00:00.000Z");
  assert.equal(f.rows.size, 1); assert.equal((await f.call(team)).duplicate, true);
  assert.equal(f.rows.size, 1); await assert.rejects(f.call(input));
});

test("waitlist duplicates are de-duplicated per date without hiding distinct contacts", () => {
  const row = { ...input, ...instructorLessonWaitlistFields("2099-10-01"), registrationId: "first" };
  const day = buildInstructorLessonScheduleSummaries({ startDate: "2099-11-01", endDate: "2099-11-30", registrations: [row,
    { ...row, registrationId: "duplicate", memberPhone: "+82 10-0000-0001", waitlistedAt: "2099-10-02" },
    { ...row, registrationId: "namesake", memberPhone: "01000000002" },
    { ...row, registrationId: "cancelled", memberPhone: "01000000003", status: "cancelled" },
    { ...row, registrationId: "synthetic", memberPhone: "01000000004", newMemberSimulation: true },
  ] })[0];
  assert.equal(day.waitlistCount, 2); assert.equal(day.occupiedCount, 0);
  assert.equal(day.waitlist[0].registrationId, "first");
});
