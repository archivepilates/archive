import assert from "node:assert/strict";
import test from "node:test";
import { createInquiryService } from "../../firebase/kangsain-functions/functions/src/memberInquiries/service";
import { hash, InquiryError, validateSubmission, type Actor } from "../../firebase/kangsain-functions/functions/src/memberInquiries/policy";
import { memberInquiryContract as contract } from "../../firebase/packages/contracts/src/member-inquiries";
import guidance from "../../firebase/kangsain-functions/functions/src/memberInquiries/guidance.json";

const NOW = Date.parse("2026-11-09T13:00:00.000Z");
const manager: Actor = { staffId: "manager-1", name: "테스트관리자", studioId: "5330", role: "manager", active: true };
const worker: Actor = { staffId: "worker-1", name: "테스트직원", studioId: "5330", role: "instructor", active: true,
  employmentStatus: "current", employmentSource: "studiomate_staff_tab_browser_scan" };
const copy = <T>(value: T): T => value === undefined ? value : structuredClone(value);

function submission(index = 1, patch: Record<string, unknown> = {}): any {
  return { requestKey: index.toString(16).padStart(48, "0"), category: "renewal", memberName: "테스트회원", memberPhone: "01000000000",
    answers: { lesson: "그룹레슨", start: "이번 달" }, details: "", contact: "문자", privacyConsent: true,
    policyVersion: contract.policyVersion, privacyVersion: contract.privacyVersion, website: "", ...patch };
}
const idFor = (key: string) => "mi_" + hash(["member_inquiry_v1", key]).slice(0, 32);
const requestPath = (id: string) => `${contract.requests}/${id}`;

type Filter = [string, string, unknown];
class FakeRef {
  readonly id: string;
  constructor(readonly db: FakeDb, readonly path: string) { this.id = path.split("/").at(-1)!; }
  collection(name: string) { return new FakeQuery(this.db, `${this.path}/${name}`); }
  async get() { return this.db.read(this); }
}
class FakeQuery {
  constructor(readonly db: FakeDb, readonly path: string, readonly filters: Filter[] = [],
    readonly order: [string, string] | null = null, readonly after: string | null = null, readonly max: number | null = null) {}
  doc(id: string) { return new FakeRef(this.db, `${this.path}/${id}`); }
  where(field: string, op: string, value: unknown) { return new FakeQuery(this.db, this.path, [...this.filters, [field, op, value]], this.order, this.after, this.max); }
  orderBy(field: string, direction = "asc") { return new FakeQuery(this.db, this.path, this.filters, [field, direction], this.after, this.max); }
  startAfter(snapshot: { id: string }) { return new FakeQuery(this.db, this.path, this.filters, this.order, snapshot.id, this.max); }
  limit(max: number) { return new FakeQuery(this.db, this.path, this.filters, this.order, this.after, max); }
  async get() { return this.db.read(this); }
}
class FakeDb {
  readonly rows = new Map<string, any>();
  readonly reads: string[] = [];
  readonly queries: Array<{ path: string; filters: Filter[]; order: [string, string] | null; after: string | null; max: number | null }> = [];
  readonly committedWrites: Array<{ kind: string; path: string }> = [];
  failStage: number | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  doc(path: string) { return new FakeRef(this, path); }
  collection(path: string) { return new FakeQuery(this, path); }
  seed(path: string, value: unknown) { this.rows.set(path, copy(value)); }
  snapshot(path: string, source = this.rows) {
    const value = copy(source.get(path));
    return { id: path.split("/").at(-1)!, exists: source.has(path), data: () => copy(value) };
  }
  async read(ref: FakeRef | FakeQuery, source = this.rows): Promise<any> {
    this.reads.push(ref.path);
    if (ref instanceof FakeRef) return this.snapshot(ref.path, source);
    this.queries.push({ path: ref.path, filters: copy(ref.filters), order: ref.order, after: ref.after, max: ref.max });
    let docs = [...source.keys()].filter(path => path.startsWith(`${ref.path}/`) && path.slice(ref.path.length + 1).split("/").length === 1)
      .map(path => this.snapshot(path, source));
    docs = docs.filter(doc => ref.filters.every(([field, op, value]) => { assert(["==","in"].includes(op)); return op==='in'?(value as unknown[]).includes(doc.data()?.[field]):doc.data()?.[field] === value; }));
    if (ref.order) {
      const [field, direction] = ref.order;
      docs.sort((a, b) => {
        const av = a.data()?.[field], bv = b.data()?.[field];
        const result = av < bv ? -1 : av > bv ? 1 : a.id.localeCompare(b.id);
        return direction === "desc" ? -result : result;
      });
    }
    if (ref.after) { const index = docs.findIndex(doc => doc.id === ref.after); assert.notEqual(index, -1); docs = docs.slice(index + 1); }
    if (ref.max !== null) docs = docs.slice(0, ref.max);
    return { docs, size: docs.length };
  }
  runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const result = this.serial.then(async () => {
      const before = new Map([...this.rows].map(([path, value]) => [path, copy(value)]));
      const staged: Array<{ kind: string; path: string; value: any }> = [];
      const stage = (kind: string, ref: FakeRef, value: any) => {
        staged.push({ kind, path: ref.path, value: copy(value) });
        if (this.failStage === staged.length) throw new Error("synthetic transaction failure");
      };
      const value = await fn({
        get: async (ref: FakeRef | FakeQuery) => { assert.equal(staged.length, 0, "Firestore transactions must read before writing"); return this.read(ref, before); },
        create: (ref: FakeRef, data: any) => stage("create", ref, data),
        update: (ref: FakeRef, patch: any) => stage("update", ref, patch),
        set: (ref: FakeRef, data: any) => stage("set", ref, data),
      });
      const after = new Map(before);
      for (const write of staged) {
        if (write.kind === "create") assert.equal(after.has(write.path), false, "create precondition");
        if (write.kind === "update") assert.equal(after.has(write.path), true, "update precondition");
        after.set(write.path, write.kind === "update" ? { ...after.get(write.path), ...write.value } : write.value);
      }
      // Commit only after the handler and every precondition succeeds. Failures preserve the entire prior map.
      this.rows.clear(); for (const [path, row] of after) this.rows.set(path, copy(row));
      this.committedWrites.push(...staged.map(({ kind, path }) => ({ kind, path })));
      return value;
    });
    this.serial = result.then(() => undefined, () => undefined);
    return result;
  }
}
function fixture(settings: Record<string, unknown> | null = {}, assigned = true) {
  const db = new FakeDb();
  if (settings !== null) db.seed(contract.settingsPath, { enabled: true, promotionApproved: true, privacyApproved: true, retentionReady: true, studioId: "5330",
    policyVersion: contract.policyVersion, privacyVersion: contract.privacyVersion, retentionDays: contract.retentionDays,
    defaultAssignees: assigned ? { renewal: worker.staffId } : {}, ...settings });
  db.seed(`staffs/${worker.staffId}`, worker);
  return { db, service: createInquiryService({ db, now: () => NOW }) };
}
function storedRow(index: number, assignedStaffId = worker.staffId, patch: Record<string, unknown> = {}) {
  const id = "mi_" + index.toString(16).padStart(32, "0");
  return { ...validateSubmission(submission()), id, studioId: "5330", assignedStaffId, assignedStaffName: "테스트직원",
    status: "received", revision: 1, createdAt: new Date(NOW - index * 1000).toISOString(), updatedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 86400000), approval: null, review: null, reviewHash: null, ...patch };
}
async function rejects(status: number, action: () => Promise<unknown>) {
  await assert.rejects(action(), (error: unknown) => error instanceof InquiryError && error.status === status);
}
const commandId = (index: number) => index.toString(16).padStart(48, "0");
function evidenceCommand(row: any, action: "record_execution" | "record_notification", index: number, patch: Record<string, unknown> = {}): any {
  return { action, id: row.id, commandId: commandId(index), expectedRevision: row.revision, expectedReviewHash: row.reviewHash,
    ...(action === "record_execution" ? { executionNote: "Manual processing checked", executionEvidence: "Synthetic processing record" } :
      { notificationOutcome: "manual_contact_recorded", notificationChannel: "phone",
        notificationNote: "Manual contact checked", notificationEvidence: "Synthetic contact record" }), ...patch };
}
async function approvedFixture() {
  const result = fixture();
  const { db, service } = result;
  const { receiptId: id } = await service.submit(submission(), "synthetic-ip");
  await service.staff(worker, { action: "review", id, commandId: commandId(1), expectedRevision: 1,
    resolutionKind: "guidance", policyFit: "within_policy", plan: "Synthetic plan", memberReply: "Synthetic reply" });
  await service.staff(manager, { action: "approve", id, commandId: commandId(2), expectedRevision: 2,
    expectedReviewHash: db.rows.get(requestPath(id)).reviewHash });
  return { ...result, id, current: () => db.rows.get(requestPath(id)) };
}

for (const [name, settings] of Object.entries({ missing: null, disabled: { enabled: false }, unpromoted: { promotionApproved: false }, privacyUnapproved: { privacyApproved: false }, retentionUnready: { retentionReady: false },
  oldPolicy: { policyVersion: "old" }, oldPrivacy: { privacyVersion: "old" }, retention: { retentionDays: 1 }, studio: { studioId: "other" } })) {
  test(`service fails closed for ${name} settings`, async () => {
    const { db, service } = fixture(settings);
    await rejects(503, () => service.submit(submission(), "synthetic-ip"));
    await rejects(503, () => service.lookup({ action: "lookup", requestKey: submission().requestKey }, "synthetic-ip"));
    await rejects(503, () => service.staff(manager, { action: "list" }));
    assert.equal(db.committedWrites.length, 0);
  });
}

test("public submit is idempotent, persists one unverified member intent, and exposes a minimal receipt", async () => {
  const { db, service } = fixture();
  const input = submission(), id = idFor(input.requestKey);
  const results = await Promise.all([service.submit(input, "synthetic-ip"), service.submit(input, "synthetic-ip")]);
  assert.deepEqual(results[0], { ok: true, receiptId: id, status: "received", duplicate: false });
  assert.deepEqual(results[1], { ok: true, receiptId: id, status: "received", duplicate: true });
  assert.equal(db.committedWrites.filter(write => write.path === requestPath(id) && write.kind === "create").length, 1);
  assert.equal(db.rows.get(requestPath(id)).identityStatus, "unverified");
  assert.equal(db.rows.get(requestPath(id)).externalExecutionAuthorized, false);
  assert.equal(db.rows.get(requestPath(id)).assignedStaffId, worker.staffId);
  assert.equal(db.reads.some(path => /^(memberProfiles|bookings|memberContactIndex|member360Cards|members)\//.test(path)), false);
  assert.equal(JSON.stringify(results).includes("테스트회원"), false);
  assert.equal(JSON.stringify(results).includes("01000000000"), false);
  const writes = db.committedWrites.length;
  await rejects(409, () => service.submit({ ...input, details: "다른 내용" }, "synthetic-ip"));
  assert.equal(db.committedWrites.length, writes);
});

test("a failure while staging receipt and event rolls back all records and rate counters", async () => {
  const { db, service } = fixture();
  const before = copy([...db.rows]); db.failStage = 2;
  await assert.rejects(service.submit(submission(), "synthetic-ip"), /synthetic transaction failure/);
  assert.deepEqual([...db.rows], before);
  assert.equal(db.committedWrites.length, 0);
});

test("phone and IP rate limits are durable transaction counters", async () => {
  for (const [kind, identity, count] of [["phone", "01000000000", 5], ["ip", "synthetic-ip", 20]] as const) {
    const { db, service } = fixture();
    const bucket = Math.floor(NOW / 900000), path = `${contract.limits}/${hash([kind, identity, bucket])}`;
    db.seed(path, { count, bucket });
    await rejects(429, () => service.submit(submission(), "synthetic-ip"));
    assert.equal(db.rows.get(path).count, count);
    assert.equal(db.committedWrites.length, 0);
  }
});

test("default assignee must exist and have canonical current employment in the correct studio before any write", async () => {
  for (const target of [null, { ...worker, staffId: "wrong" }, { ...worker, active: false },
    { ...worker, role: "viewer" }, { ...worker, studioId: "other" },
    { ...worker, employmentStatus: "retired" }, { ...worker, employmentStatus: undefined },
    { ...worker, employmentSource: undefined }, { ...worker, employmentSource: "excel_import" }]) {
    const { db, service } = fixture();
    if (target === null) db.rows.delete(`staffs/${worker.staffId}`); else db.seed(`staffs/${worker.staffId}`, target);
    const before = copy([...db.rows]);
    await assert.rejects(service.submit(submission(), "synthetic-ip"), (error: unknown) => error instanceof InquiryError && [403, 503].includes(error.status));
    assert.equal(db.committedWrites.length, 0);
    assert.deepEqual([...db.rows], before);
  }
});
test("default active instructor assignment does not require the retired inquiry-access flag", async () => {
  const { db, service } = fixture();
  db.seed(`staffs/${worker.staffId}`, { ...worker, memberInquiryAccess: false });
  const result = await service.submit(submission(), "synthetic-ip");
  assert.equal(db.rows.get(requestPath(result.receiptId)).assignedStaffId, worker.staffId);
});

test("assignee picker hides retired active accounts, unverified employment, disabled, foreign and mismatched identities", async () => {
  const { db, service } = fixture();
  const candidates = [
    { ...worker, staffId: "retired", employmentStatus: "retired" },
    { ...worker, staffId: "missing-status", employmentStatus: undefined },
    { ...worker, staffId: "missing-source", employmentSource: undefined },
    { ...worker, staffId: "invalid-source", employmentSource: "excel_import" },
    { ...worker, staffId: "disabled", active: false },
    { ...worker, staffId: "foreign", studioId: "other" },
    { ...worker, staffId: "viewer", role: "viewer" },
    { ...manager, staffId: "retired-manager", employmentStatus: "retired" },
    { ...manager, staffId: "retired-owner", role: "owner", employmentStatus: "retired" },
    manager, { ...manager, staffId: "owner-1", role: "owner" },
  ];
  for (const candidate of candidates) db.seed(`staffs/${candidate.staffId}`, candidate);
  db.seed("staffs/mismatched-document", { ...worker, staffId: "unrelated-id" });
  const before = copy([...db.rows]);
  const result = await service.staff(manager, { action: "access" });
  assert.deepEqual(result.assignees, [worker, manager, candidates.at(-1)!].map(({ staffId, name }) => ({ staffId, name })));
  assert.deepEqual([...db.rows], before);
  assert.equal(db.committedWrites.length, 0);
});

for (const role of ["manager", "owner"]) {
  test(`legacy ${role} without employment fields remains eligible for default assignment, manual assignment and claim`, async () => {
    const { db, service } = fixture({ defaultAssignees: { renewal: manager.staffId } });
    const operator = { ...manager, role };
    db.seed(`staffs/${operator.staffId}`, operator);
    const { receiptId: id } = await service.submit(submission(), "synthetic-ip");
    assert.equal(db.rows.get(requestPath(id)).assignedStaffId, operator.staffId);
    await service.staff(manager, { action: "assign", id, assignedStaffId: worker.staffId, assignmentReason: "Instructor handoff", expectedRevision: 1, commandId: commandId(1) });
    await service.staff(manager, { action: "assign", id, assignedStaffId: operator.staffId, assignmentReason: "Operator handoff", expectedRevision: 2, commandId: commandId(2) });
    assert.equal(db.rows.get(requestPath(id)).assignedStaffId, operator.staffId);
    assert.equal((await service.staff(operator, { action: "claim", id, expectedRevision: 3, commandId: commandId(3) })).revision, 4);
    assert.deepEqual(db.rows.get(`staffs/${operator.staffId}`), operator);
    assert.equal(db.committedWrites.some(write => write.path.startsWith("staffs/")), false);
  });
}

for (const [name, patch] of Object.entries({
  retired: { employmentStatus: "retired" }, missingStatus: { employmentStatus: undefined },
  missingSource: { employmentSource: undefined }, invalidSource: { employmentSource: "excel_import" },
  disabled: { active: false }, foreign: { studioId: "other" }, mismatchedIdentity: { staffId: "different-worker" },
})) {
  test(`manual assignment rechecks ${name} drift after picker load without writes or revision changes`, async () => {
    const { db, service } = fixture();
    const source = storedRow(1, ""); db.seed(requestPath(source.id), source);
    assert.deepEqual((await service.staff(manager, { action: "access" })).assignees, [{ staffId: worker.staffId, name: worker.name }]);
    db.seed(`staffs/${worker.staffId}`, { ...worker, ...patch });
    const before = copy([...db.rows]);
    await rejects(name === "mismatchedIdentity" ? 400 : 403, () => service.staff(manager, { action: "assign", id: source.id,
      assignedStaffId: worker.staffId, expectedRevision: source.revision, commandId: commandId(1) }));
    assert.deepEqual([...db.rows], before);
    assert.equal(db.rows.get(requestPath(source.id)).revision, source.revision);
    assert.equal(db.committedWrites.length, 0);
  });
}

test("historic retired assignment remains visible and intact until a manager reassigns to a current instructor", async () => {
  const { db, service } = fixture();
  const retired = { ...worker, employmentStatus: "retired" };
  const current = { ...worker, staffId: "current-worker", name: "현재테스트직원" };
  db.seed(`staffs/${retired.staffId}`, retired); db.seed(`staffs/${current.staffId}`, current);
  const source = storedRow(1); db.seed(requestPath(source.id), source);
  const eventPath = `${requestPath(source.id)}/${contract.events}/r000001`;
  const event = { action: "created", revision: 1, actor: retired.staffId, expiresAt: source.expiresAt };
  db.seed(eventPath, event);
  const before = copy([...db.rows]);
  const access = await service.staff(manager, { action: "access" });
  assert.deepEqual(access.assignees, [{ staffId: current.staffId, name: current.name }]);
  for (const actor of [manager, current, retired]) {
    const detail = await service.staff(actor, { action: "get", id: source.id });
    assert.equal(detail.row.assignedStaffId, retired.staffId);
    assert.equal(detail.row.assignedStaffName, retired.name);
    assert.equal(detail.events[0].actor, retired.staffId);
    assert.equal((await service.staff(actor, { action: "list" })).rows[0].assignedStaffName, retired.name);
  }
  assert.deepEqual([...db.rows], before); assert.equal(db.committedWrites.length, 0);
  assert.equal((await service.staff(manager, { action: "assign", id: source.id, assignedStaffId: current.staffId,
    assignmentReason: "Current instructor handoff", expectedRevision: 1, commandId: commandId(1) })).revision, 2);
  assert.deepEqual(db.rows.get(requestPath(source.id)), { ...source, assignedStaffId: current.staffId,
    assignedStaffName: current.name, handoffReason: "Current instructor handoff", revision: 2, updatedAt: new Date(NOW).toISOString() });
  assert.deepEqual(db.rows.get(eventPath), event);
  assert.deepEqual(db.rows.get(`staffs/${retired.staffId}`), retired);
  assert.deepEqual(db.rows.get(`staffs/${current.staffId}`), current);
  assert.equal(db.committedWrites.length, 3);
  assert.ok(db.committedWrites.every(write => write.path.startsWith(requestPath(source.id))));
});

for (const actor of [
  { ...worker, employmentStatus: "retired" }, { ...worker, employmentStatus: undefined },
  { ...worker, employmentSource: undefined }, { ...worker, employmentSource: "excel_import" },
  { ...manager, employmentStatus: "retired" }, { ...manager, role: "owner", employmentStatus: "retired" },
]) {
  test(`claim rejects ${actor.role}/${actor.employmentStatus}/${actor.employmentSource} without writes`, async () => {
    const { db, service } = fixture({}, false);
    const source = storedRow(1, ""); db.seed(requestPath(source.id), source);
    const before = copy([...db.rows]);
    await rejects(403, () => service.staff(actor, { action: "claim", id: source.id, expectedRevision: 1, commandId: commandId(1) }));
    assert.deepEqual([...db.rows], before);
    assert.equal(db.committedWrites.length, 0);
  });
}

test("active staff lists every same-studio inquiry before pagination, regardless of assignment", async () => {
  const { db, service } = fixture();
  for (let index = 1; index <= 120; index++) { const row = storedRow(index, "other-worker"); db.seed(requestPath(row.id), row); }
  for (let index = 201; index <= 301; index++) { const row = storedRow(index); db.seed(requestPath(row.id), row); }
  const foreign = storedRow(0, worker.staffId, { studioId: "other" }); db.seed(requestPath(foreign.id), foreign);
  const first = await service.staff(worker, { action: "list" });
  assert.equal(first.rows.length, 100); assert.ok(first.nextCursor); assert.equal(first.coverage.scanned, 100);
  const query = db.queries.at(-1)!;
  assert.deepEqual(query.filters, [["studioId", "==", "5330"]]);
  assert.deepEqual(query.order, ["createdAt", "desc"]); assert.equal(query.max, 100);
  assert.equal(first.rows.some((item: any) => item.id === foreign.id), false);
  assert.equal(first.rows.some((item: any) => item.id === storedRow(1).id), true);
  assert.equal(first.rows.some((item: any) => "memberPhone" in item || "answers" in item || "details" in item), false);
  assert.ok(first.rows.every((item: any) => item.maskedPhone === "010-****-0000"));
  const second = await service.staff(worker, { action: "list", cursor: first.nextCursor });
  assert.equal(second.rows.length, 100); assert.ok(second.nextCursor);
  const third = await service.staff(worker, { action: "list", cursor: second.nextCursor });
  assert.equal(third.rows.length, 21); assert.equal(third.nextCursor, null);
  const allIds = [...first.rows, ...second.rows, ...third.rows].map((item: any) => item.id);
  assert.equal(new Set(allIds).size, 221);
  await rejects(403, () => service.staff(worker, { action: "list", cursor: foreign.id }));
});

test("only active same-studio staff roles may access, list or get inquiries", async () => {
  for (const actor of [worker, manager, { ...manager, role: "owner" }]) {
    const { db, service } = fixture(); const source = storedRow(1, "other-worker"); db.seed(requestPath(source.id), source);
    assert.equal((await service.staff(actor, { action: "access" })).ok, true);
    assert.equal((await service.staff(actor, { action: "list" })).rows.length, 1);
    assert.equal((await service.staff(actor, { action: "get", id: source.id })).row.id, source.id);
  }
  for (const actor of [{ ...worker, active: false }, { ...worker, role: "viewer" }, { ...worker, studioId: "other" }]) {
    const { db, service } = fixture(); const source = storedRow(1); db.seed(requestPath(source.id), source);
    for (const action of ["access", "list", "get"])
      await rejects(403, () => service.staff(actor, { action, id: source.id }));
  }
});

test("manager list is studio scoped and excludes expired rows before TTL deletion", async () => {
  const { db, service } = fixture();
  const allowed = storedRow(1), foreign = storedRow(2, worker.staffId, { studioId: "other" }), expired = storedRow(3, worker.staffId, { expiresAt: new Date(NOW) });
  for (const row of [allowed, foreign, expired]) db.seed(requestPath(row.id), row);
  const result = await service.staff(manager, { action: "list" });
  assert.deepEqual(result.rows.map((item: any) => item.id), [allowed.id]);
  assert.deepEqual(db.queries.at(-1)!.filters, [["studioId", "==", "5330"]]);
});

test("get permits other same-studio assignees but denies foreign-studio and expired inquiries", async () => {
  const { db, service } = fixture();
  const other = storedRow(1, "other-worker"), expired = storedRow(2, worker.staffId, { expiresAt: new Date(NOW - 1) });
  db.seed(requestPath(other.id), other); db.seed(requestPath(expired.id), expired);
  assert.equal((await service.staff(worker, { action: "get", id: other.id })).row.id, other.id);
  const foreign = storedRow(4, "other-worker", { studioId: "other" }); db.seed(requestPath(foreign.id), foreign);
  await rejects(403, () => service.staff(worker, { action: "get", id: foreign.id }));
  assert.equal(db.reads.includes(`${requestPath(foreign.id)}/${contract.events}`), false);
  await rejects(404, () => service.staff(manager, { action: "get", id: expired.id }));
  const own = storedRow(3); db.seed(requestPath(own.id), own);
  const result = await service.staff(worker, { action: "get", id: own.id });
  assert.equal(result.row.id, own.id); assert.deepEqual(result.events, []);
});

test("review, administrator approval and manual completion atomically record sequential evidence", async () => {
  const { db, service } = fixture();
  const { receiptId: id } = await service.submit(submission(), "synthetic-ip");
  const review = { action: "review", id, commandId: commandId(1), expectedRevision: 1, resolutionKind: "guidance", policyFit: "within_policy",
    plan: "수강료 상담 안내", memberReply: "확인 후 안내드리겠습니다.", internalNote: "" };
  assert.deepEqual(await service.staff(worker, review), { ok: true, id, revision: 2, status: "awaiting_approval" });
  const count = db.committedWrites.length;
  assert.equal((await service.staff(worker, review)).replayed, true);
  assert.equal(db.committedWrites.length, count);
  await rejects(409, () => service.staff(worker, { ...review, plan: "다른 상담안" }));
  assert.equal(db.committedWrites.length, count);
  const reviewHash = db.rows.get(requestPath(id)).reviewHash;
  const approve = { action: "approve", id, commandId: commandId(2), expectedRevision: 2, expectedReviewHash: reviewHash, reason: "" };
  await rejects(403, () => service.staff(worker, approve));
  assert.equal(db.rows.get(requestPath(id)).revision, 2);
  assert.equal((await service.staff(manager, approve)).revision, 3);
  assert.equal(db.rows.get(requestPath(id)).approval.externalExecutionAuthorized, false);
  await service.staff(worker, evidenceCommand(db.rows.get(requestPath(id)), "record_execution", 3));
  await service.staff(worker, evidenceCommand(db.rows.get(requestPath(id)), "record_notification", 4));
  assert.equal((await service.staff(worker, { action: "complete", id, commandId: commandId(5), expectedRevision: 5,
    expectedReviewHash: reviewHash, completionNote: "상담안 전달을 직접 확인", evidence: "합성 테스트 확인 기록" })).status, "completed");
  const current = db.rows.get(requestPath(id));
  assert.equal(current.revision, 6); assert.equal(current.memberNotificationStatus, "not_sent_by_system");
  assert.equal(current.completion.providerSendVerified, false);
  const events = [...db.rows.keys()].filter(path => path.startsWith(`${requestPath(id)}/${contract.events}/`));
  const commands = [...db.rows.keys()].filter(path => path.startsWith(`${requestPath(id)}/${contract.commands}/`));
  assert.equal(events.length, 6); assert.equal(commands.length, 5);
  assert.deepEqual(events.map(path => db.rows.get(path).revision).sort(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(db.rows.get(`${requestPath(id)}/${contract.events}/r000004`).execution, current.execution);
  assert.deepEqual(db.rows.get(`${requestPath(id)}/${contract.events}/r000005`).notification, current.notification);
});

test("an active employee can claim an unassigned inquiry, while reading another assignee does not grant mutation permission", async () => {
  const { db, service } = fixture({}, false);
  const { receiptId: id } = await service.submit(submission(), "synthetic-ip");
  const review = { action: "review", id, commandId: commandId(1), expectedRevision: 1,
    resolutionKind: "guidance", policyFit: "within_policy", plan: "상담 안내", memberReply: "확인 후 안내", internalNote: "" };
  assert.equal((await service.staff(worker, { action: "get", id })).row.assignedStaffId, "");
  const writes = db.committedWrites.length;
  await rejects(403, () => service.staff(worker, review));
  assert.equal(db.committedWrites.length, writes);
  assert.equal((await service.staff(worker, { action: "claim", id, commandId: commandId(2), expectedRevision: 1 })).status, "in_review");
  assert.equal(db.rows.get(requestPath(id)).assignedStaffId, worker.staffId);
  assert.equal((await service.staff(worker, { ...review, expectedRevision: 2 })).status, "awaiting_approval");
  const another: Actor = { ...worker, staffId: "other-worker", name: "다른테스트직원" };
  assert.equal((await service.staff(another, { action: "get", id })).row.id, id);
  const afterReview = db.committedWrites.length;
  await rejects(403, () => service.staff(another, { ...review, expectedRevision: 3, commandId: commandId(3) }));
  await rejects(403, () => service.staff(another, { action: "claim", id, expectedRevision: 3, commandId: commandId(4) }));
  assert.equal(db.committedWrites.length, afterReview);
  assert.equal((await service.staff(manager, { ...review, expectedRevision: 3, commandId: commandId(5) })).revision, 4);
});

test("transaction failure after a staged staff update cannot leave a changed row without its audit evidence", async () => {
  const { db, service } = fixture();
  const source = storedRow(1); db.seed(requestPath(source.id), source);
  const before = copy([...db.rows]); db.failStage = 2;
  await assert.rejects(service.staff(worker, { action: "review", id: source.id, commandId: commandId(1), expectedRevision: 1,
    resolutionKind: "guidance", policyFit: "within_policy", plan: "상담안", memberReply: "안내문", internalNote: "" }), /synthetic transaction failure/);
  assert.deepEqual([...db.rows], before); assert.equal(db.committedWrites.length, 0);
});

test("random-key public lookup reveals only receipt existence, not member identity or processing state", async () => {
  const { db, service } = fixture();
  const input = submission(), { receiptId } = await service.submit(input, "synthetic-ip");
  db.rows.get(requestPath(receiptId)).status = "approved";
  const lookup = () => service.lookup({ action: "lookup", requestKey: input.requestKey }, "lookup-ip");
  assert.deepEqual(await lookup(), { ok: true, receiptId, status: "received" });
  assert.deepEqual(await service.lookup({ action: "lookup", requestKey: submission(2).requestKey }, "lookup-ip"), { ok: true, receiptId: null, status: "unconfirmed" });
  db.rows.get(requestPath(receiptId)).expiresAt = new Date(NOW);
  assert.deepEqual(await lookup(), { ok: true, receiptId: null, status: "unconfirmed" });
  for (const patch of [{ requestKey: "short" }, { memberPhone: "01000000000" }, { id: receiptId }])
    await rejects(400, () => service.lookup({ action: "lookup", requestKey: input.requestKey, ...patch }, "lookup-ip"));
  assert.equal(db.reads.some(path => /^(memberProfiles|bookings|memberContactIndex|member360Cards|members)\//.test(path)), false);
});

test("public lookup is bounded to thirty confirmations per IP window without writing a thirty-first count", async () => {
  const { db, service } = fixture();
  for (let i = 0; i < 30; i++) await service.lookup({ action: "lookup", requestKey: submission(i + 1).requestKey }, "lookup-ip");
  const count = db.committedWrites.length;
  await rejects(429, () => service.lookup({ action: "lookup", requestKey: submission().requestKey }, "lookup-ip"));
  assert.equal(db.committedWrites.length, count);
  const path = `${contract.limits}/${hash(["lookup", "lookup-ip", Math.floor(NOW / 900000)])}`;
  assert.equal(db.rows.get(path).count, 30);
});

test('member context uses the same staff, studio and retention guards before source reads and cannot mutate',async()=>{
  const {db,service}=fixture();const source=storedRow(700);db.seed(requestPath(source.id),source);
  db.seed('memberProfiles/native',{studioId:'5330',name:source.memberName,phone:source.memberPhone,memberId:'native',activeTickets:[],syncedAt:new Date(NOW)});
  const before=copy([...db.rows]);
  const result=await service.staff(worker,{action:'context',id:source.id});assert.equal(result.context.status,'unique_stored_match');
  assert.deepEqual([...db.rows],before);assert.equal(db.committedWrites.length,0);
  for(const actor of [{...worker,active:false},{...worker,studioId:'other'},{...worker,role:'viewer'}])await rejects(403,()=>service.staff(actor,{action:'context',id:source.id}));
  const expired=storedRow(701,worker.staffId,{expiresAt:new Date(NOW)});db.seed(requestPath(expired.id),expired);
  const reads=db.reads.filter(item=>item==='memberProfiles').length;
  await rejects(404,()=>service.staff(worker,{action:'context',id:expired.id}));
  const foreign=storedRow(702,worker.staffId,{studioId:'other'});db.seed(requestPath(foreign.id),foreign);
  await rejects(403,()=>service.staff(worker,{action:'context',id:foreign.id}));
  assert.equal(db.reads.filter(item=>item==='memberProfiles').length,reads);
});

test("public submission snapshots curated guidance and starts with no execution or notification authority", async () => {
  const { db, service } = fixture();
  const input = submission();
  const { receiptId: id } = await service.submit(input, "synthetic-ip");
  const row = db.rows.get(requestPath(id));
  assert.deepEqual(row.policyGuidance, { version: guidance.version,
    ruleIds: guidance.rules.filter(rule => rule.category === input.category && Object.entries(rule.when || {}).every(([key, value]) =>
      Array.isArray(input.answers[key]) ? input.answers[key].includes(value) : input.answers[key] === value)).map(rule => rule.id),
    source: "curated_existing_notion_rules", basis:'server_rules_at_receipt',memberReadVerified:false,automaticDecision: false });
  assert.ok(row.policyGuidance.ruleIds.length > 0);
  assert.equal(row.workflowVersion, 2);
  for (const field of ["review", "reviewHash", "approval", "execution", "notification", "completion"]) assert.equal(row[field], null);
  assert.equal(row.externalExecutionAuthorized, false);
  assert.equal(row.memberNotificationStatus, "not_sent_by_system");
  const snapshot = copy(row.policyGuidance);
  await service.staff(worker, { action: "review", id, expectedRevision: 1, commandId: commandId(1),
    resolutionKind: "guidance", policyFit: "within_policy", plan: "Synthetic plan", memberReply: "Synthetic reply" });
  assert.deepEqual(db.rows.get(requestPath(id)).policyGuidance, snapshot);
});

test("access reports missing or invalid response delay as null without inventing a default", async () => {
  for (const responseDelayHours of [undefined, null, 0, 12, "24", 24, 48]) {
    const { db, service } = fixture(responseDelayHours === undefined ? {} : { responseDelayHours });
    const before = copy([...db.rows]);
    for (const actor of [worker, manager])
      assert.equal((await service.staff(actor, { action: "access" })).responseDelayHours,
        responseDelayHours === 24 || responseDelayHours === 48 ? responseDelayHours : null);
    assert.deepEqual([...db.rows], before);
    assert.equal(db.committedWrites.length, 0);
  }
});

for (const action of ["assign", "claim"] as const) {
  test(`${action} requires a bounded reason for reassignment and preserves each audited handoff exactly once`, async () => {
    const { db, service } = fixture();
    db.seed(`staffs/${manager.staffId}`, manager);
    const source = storedRow(1); db.seed(requestPath(source.id), source);
    const command = { action, id: source.id, assignedStaffId: manager.staffId, expectedRevision: 1, commandId: commandId(1) };
    for (const assignmentReason of [undefined, "", "  ", "x".repeat(501)]) {
      const before = copy([...db.rows]);
      await rejects(400, () => service.staff(manager, { ...command, assignmentReason }));
      assert.deepEqual([...db.rows], before);
      assert.equal(db.committedWrites.length, 0);
    }
    const first = { ...command, assignmentReason: "  Manager handoff  " };
    const results = await Promise.all([service.staff(manager, first), service.staff(manager, first)]);
    assert.equal(results[0].revision, 2); assert.equal(results[1].replayed, true);
    assert.equal(db.committedWrites.length, 3);
    const firstEventPath = `${requestPath(source.id)}/${contract.events}/r000002`;
    const firstEvent = copy(db.rows.get(firstEventPath));
    assert.deepEqual(firstEvent.assignment, { fromStaffId: worker.staffId, fromName: source.assignedStaffName,
      toStaffId: manager.staffId, toName: manager.name, reason: "Manager handoff" });
    await rejects(409, () => service.staff(manager, { ...first, assignmentReason: "Changed reason" }));
    assert.equal(db.committedWrites.length, 3);
    await service.staff(manager, { action: "assign", id: source.id, assignedStaffId: worker.staffId,
      assignmentReason: "Instructor follow-up", expectedRevision: 2, commandId: commandId(2) });
    assert.deepEqual(db.rows.get(firstEventPath), firstEvent);
    assert.deepEqual(db.rows.get(`${requestPath(source.id)}/${contract.events}/r000003`).assignment,
      { fromStaffId: manager.staffId, fromName: manager.name, toStaffId: worker.staffId, toName: worker.name, reason: "Instructor follow-up" });
    assert.equal(db.rows.get(requestPath(source.id)).handoffReason, "Instructor follow-up");
    assert.equal(db.committedWrites.length, 6);
  });
  test(`${action} accepts an initially blank assignment without a reason`, async () => {
    const { db, service } = fixture();
    const source = storedRow(1, "", { assignedStaffName: "" }); db.seed(requestPath(source.id), source);
    const actor = action === "assign" ? manager : worker;
    await service.staff(actor, { action, id: source.id, assignedStaffId: worker.staffId,
      expectedRevision: 1, commandId: commandId(1) });
    assert.deepEqual(db.rows.get(`${requestPath(source.id)}/${contract.events}/r000002`).assignment,
      { fromStaffId: "", fromName: "", toStaffId: worker.staffId, toName: worker.name, reason: "" });
  });
}

for (const action of ["record_execution", "record_notification"] as const) {
  test(`${action} is canonical, actor scoped and exactly once including reordered command keys`, async () => {
    const { db, service, id, current } = await approvedFixture();
    const command = evidenceCommand(current(), action, 3);
    const before = db.committedWrites.length;
    const results = await Promise.all([service.staff(worker, command), service.staff(worker, command)]);
    assert.equal(results[0].revision, 4); assert.equal(results[1].replayed, true);
    assert.equal(db.committedWrites.length, before + 3);
    const reordered = Object.fromEntries(Object.entries(command).reverse());
    assert.equal((await service.staff(worker, reordered)).replayed, true);
    const field = action === "record_execution" ? "execution" : "notification";
    assert.equal(current()[field].recordedManually, true);
    assert.equal(current()[field].reviewHash, current().reviewHash);
    assert.equal(current().memberNotificationStatus, "not_sent_by_system");
    assert.equal(current().externalExecutionAuthorized, false);
    assert.equal(action === "record_execution" ? current().execution.externalChangeVerifiedBySystem : current().notification.providerSendVerified, false);
    assert.deepEqual(db.rows.get(`${requestPath(id)}/${contract.events}/r000004`)[field], current()[field]);
    const snapshot = copy([...db.rows]);
    await rejects(409, () => service.staff(worker, { ...command,
      [action === "record_execution" ? "executionEvidence" : "notificationEvidence"]: "Changed evidence" }));
    await rejects(409, () => service.staff(manager, command));
    assert.deepEqual([...db.rows], snapshot);
    assert.equal(db.committedWrites.length, before + 3);
    assert.equal([...db.rows.keys()].filter(path => path.startsWith(`${requestPath(id)}/${contract.commands}/`)).length, 3);
  });
  test(`${action} rejects unapproved, stale, foreign and missing command evidence without writes`, async () => {
    const { db, service, current } = await approvedFixture();
    const row = current();
    const command = evidenceCommand(row, action, 3);
    const fields = action === "record_execution" ? ["executionNote", "executionEvidence"] : ["notificationNote", "notificationEvidence"];
    const patches: Array<[number, Record<string, unknown>]> = [
      [409, { expectedRevision: undefined }], [409, { expectedRevision: row.revision - 1 }],
      [409, { expectedReviewHash: undefined }], [409, { expectedReviewHash: "foreign-review" }],
      [400, { commandId: undefined }], [400, { commandId: "invalid" }],
      ...fields.flatMap(field => [undefined, "", "  ", "x".repeat(field.endsWith("Note") ? 1501 : 501)]
        .map(value => [400, { [field]: value }] as [number, Record<string, unknown>])),
    ];
    if (action === "record_notification") patches.push(
      [400, { notificationOutcome: "not_required", notificationChannel: "phone" }],
      [400, { notificationOutcome: "manual_contact_recorded", notificationChannel: "none" }]);
    const before = copy([...db.rows]), writes = db.committedWrites.length;
    for (const [status, patch] of patches) await rejects(status, () => service.staff(worker, { ...command, ...patch }));
    for (const actor of [{ ...worker, staffId: "other-worker" }, { ...manager, studioId: "other" }])
      await rejects(403, () => service.staff(actor, command));
    assert.deepEqual([...db.rows], before); assert.equal(db.committedWrites.length, writes);
    for (const patch of [{ status: "awaiting_approval", approval: null }, { approval: { ...row.approval, reviewHash: "foreign-review" } }]) {
      db.seed(requestPath(row.id), { ...row, ...patch });
      const snapshot = copy([...db.rows]);
      await rejects(409, () => service.staff(worker, command));
      assert.deepEqual([...db.rows], snapshot); assert.equal(db.committedWrites.length, writes);
    }
  });
  test(`${action} transaction failure rolls back row, audit event and command together`, async () => {
    const { db, service, current } = await approvedFixture();
    const before = copy([...db.rows]), writes = db.committedWrites.length;
    db.failStage = 3;
    await assert.rejects(service.staff(worker, evidenceCommand(current(), action, 3)), /synthetic transaction failure/);
    assert.deepEqual([...db.rows], before); assert.equal(db.committedWrites.length, writes);
  });
}

test("completion requires both current records, survives exact replay and cannot use another inquiry's evidence", async () => {
  const { db, service, id, current } = await approvedFixture();
  const complete = (index: number) => ({ action: "complete", id, expectedRevision: current().revision,
    expectedReviewHash: current().reviewHash, commandId: commandId(index), completionNote: "Manual completion", evidence: "Synthetic verification" });
  const expectBlocked = async () => {
    const before = copy([...db.rows]), writes = db.committedWrites.length;
    await rejects(409, () => service.staff(worker, complete(9)));
    assert.deepEqual([...db.rows], before); assert.equal(db.committedWrites.length, writes);
  };
  await expectBlocked();
  await service.staff(worker, evidenceCommand(current(), "record_execution", 3));
  await expectBlocked();
  await service.staff(worker, evidenceCommand(current(), "record_notification", 4,
    { notificationOutcome: "not_required", notificationChannel: "none" }));
  const valid = copy(current());
  for (const field of ["execution", "notification"])
    for (const value of [null, { ...valid[field], reviewHash: "superseded-review" }, { ...valid[field], reviewHash: hash(["other-inquiry", id]) }]) {
      db.seed(requestPath(id), { ...valid, [field]: value });
      await expectBlocked();
    }
  db.seed(requestPath(id), valid);
  const command = complete(5), writes = db.committedWrites.length;
  const results = await Promise.all([service.staff(worker, command), service.staff(worker, command)]);
  assert.equal(results[0].status, "completed"); assert.equal(results[1].replayed, true);
  assert.equal(current().revision, 6); assert.equal(current().completion.providerSendVerified, false);
  assert.equal(db.committedWrites.length, writes + 3);
  const snapshot = copy([...db.rows]);
  await rejects(409, () => service.staff(worker, { ...command, evidence: "Changed completion evidence" }));
  for (const action of ["assign", "claim", "review", "approve", "record_execution", "record_notification", "complete"])
    await rejects(409, () => service.staff(manager, { ...command, action, assignedStaffId: worker.staffId,
      expectedRevision: current().revision, commandId: commandId(10) }));
  assert.deepEqual([...db.rows], snapshot); assert.equal(db.committedWrites.length, writes + 3);
});

test("new review and approval clear prior evidence but preserve immutable event history and replay results", async () => {
  const { db, service, id, current } = await approvedFixture();
  const execution = evidenceCommand(current(), "record_execution", 3);
  await service.staff(worker, execution);
  await service.staff(worker, evidenceCommand(current(), "record_notification", 4));
  const oldHash = current().reviewHash;
  const oldEvent = copy(db.rows.get(`${requestPath(id)}/${contract.events}/r000004`));
  await service.staff(worker, { action: "review", id, commandId: commandId(5), expectedRevision: 5,
    resolutionKind: "guidance", policyFit: "within_policy", plan: "Replacement plan", memberReply: "Replacement reply" });
  for (const field of ["approval", "execution", "notification", "completion"]) assert.equal(current()[field], null);
  assert.notEqual(current().reviewHash, oldHash);
  await service.staff(manager, { action: "approve", id, commandId: commandId(6), expectedRevision: 6,
    expectedReviewHash: current().reviewHash });
  const before = copy([...db.rows]), writes = db.committedWrites.length;
  await rejects(409, () => service.staff(worker, { action: "complete", id, commandId: commandId(7), expectedRevision: 7,
    expectedReviewHash: current().reviewHash, completionNote: "Manual completion", evidence: "Synthetic record" }));
  await rejects(409, () => service.staff(worker, { ...execution, commandId: commandId(8), expectedRevision: 7 }));
  assert.equal((await service.staff(worker, execution)).replayed, true);
  assert.deepEqual([...db.rows], before); assert.equal(db.committedWrites.length, writes);
  assert.deepEqual(db.rows.get(`${requestPath(id)}/${contract.events}/r000004`), oldEvent);
  await service.staff(worker, evidenceCommand(current(), "record_execution", 9));
  await service.staff(worker, evidenceCommand(current(), "record_notification", 10));
  assert.equal(current().execution.reviewHash, current().reviewHash);
  assert.equal(current().notification.reviewHash, current().reviewHash);
});

test("completed historical inquiries without new evidence remain readable and are never backfilled", async () => {
  const { db, service } = fixture();
  const source = storedRow(1, worker.staffId, { status: "completed", completion: { recordedManually: true, providerSendVerified: false } });
  db.seed(requestPath(source.id), source);
  const before = copy([...db.rows]);
  for (const actor of [worker, manager]) {
    const result = await service.staff(actor, { action: "get", id: source.id });
    assert.equal(result.row.status, "completed");
    assert.equal(result.row.execution, undefined); assert.equal(result.row.notification, undefined);
    assert.equal((await service.staff(actor, { action: "list" })).rows[0].status, "completed");
  }
  assert.deepEqual([...db.rows], before); assert.equal(db.committedWrites.length, 0);
});
