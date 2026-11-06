import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createInstructorWaitlistApi, instructorWaitlistToken, instructorWaitlistLinks }
  from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonWaitlistPublic";
import { instructorLessonWaitlistFields } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonWaitlist";

const SECRET = "synthetic-private-key-for-test-only";
const NOW = Date.parse("2099-10-01T01:00:00Z");
function waiter(phone = "01000000001", stamp = "2099-09-01T00:00:00Z") {
  const lessonDate = "2099-11-28", studioId = "5330";
  const registrationId = "ilr_" + createHash("sha256").update(`${studioId}|${phone}|${lessonDate}`).digest("hex").slice(0, 24);
  return { registrationId, studioId, lessonDate, memberPhone: phone, memberName: "Synthetic Member",
    source: { type: "archive_core_operator" }, ...instructorLessonWaitlistFields(stamp), evidence: {} };
}
function fixture(initial = [waiter()], options: any = {}) {
  const rows = new Map(initial.map(row => [row.registrationId, structuredClone(row)]));
  const writes: any[] = [], reads: any[] = [];
  let serial = Promise.resolve();
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ({ name, id }),
      where: (field: string, op: string, value: any) => {
        const filters = [[field, value]];
        const query: any = { name, filters, where: (f: string, _o: string, v: any) => { filters.push([f, v]); return query; },
          limit: (n: number) => ({ name, filters, limit: n }) }; return query;
      } }),
    runTransaction: (fn: any) => {
      const result = serial.then(() => fn({
        get: async (ref: any) => {
          reads.push(ref);
          if (ref.name === "studiomateInstructorLessonJobs") return { exists: !!options.job, data: () => options.job };
          if (ref.filters) {
            const values = [...rows.values()].filter(row => ref.filters.every(([k, v]: any[]) => row[k] === v));
            return { size: options.overflow ? 501 : values.length,
              docs: values.map(row => ({ id: row.registrationId, data: () => row })) };
          }
          return { exists: rows.has(ref.id), data: () => rows.get(ref.id) };
        },
        update: (ref: any, patch: any) => { assert.equal(ref.name, "instructorLessonRegistrations");
          writes.push({ id: ref.id, patch }); rows.set(ref.id, { ...rows.get(ref.id), ...patch }); },
      }));
      serial = result.then(() => undefined, () => undefined); return result;
    },
  };
  const api = createInstructorWaitlistApi({ db, secret: () => SECRET, now: () => options.now || NOW });
  const call = async (row = initial[0], action = "status", patch: any = {}, requestPatch: any = {}) => {
    const response: any = { headers: {}, code: 0, body: null,
      set(k: string, v: string) { this.headers[k] = v; return this; },
      status(code: number) { this.code = code; return this; },
      json(body: any) { this.body = body; return this; }, send(body: any) { this.body = body; return this; } };
    const request = { method: "POST", ip: "synthetic", get: (k: string) => k === "content-type" ? "application/json" :
      k === "origin" ? "https://in.archivepilates.com" : undefined,
      body: { registrationId: row.registrationId, token: instructorWaitlistToken(row, SECRET), action, confirm: true, ...patch },
      ...requestPatch };
    await api(request, response); return response;
  };
  return { rows, writes, reads, call };
}

test("private links bind exact registration, source, phone, date and waitlist cycle", () => {
  const row = waiter(), token = instructorWaitlistToken(row, SECRET), link = instructorWaitlistLinks(row, SECRET);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(new URL(link.statusUrl).searchParams.has("token"), false);
  assert.equal(new URL(link.cancelUrl).hash, `#token=${token}&view=cancel`);
  assert.notEqual(instructorWaitlistToken(waiter("01000000002"), SECRET), token);
  assert.notEqual(instructorWaitlistToken(waiter(undefined, "2099-09-02T00:00:00Z"), SECRET), token);
  for (const patch of [{ studioId: "5331" }, { source: { type: "untrusted" } }, { memberPhone: "01000000002" },
    { lessonDate: "2099-02-30" }, { registrationId: "guess" }, { waitlistedAt: "bad" }]) {
    assert.throws(() => instructorWaitlistToken({ ...row, ...patch }, SECRET));
  }
  assert.throws(() => instructorWaitlistToken(row, ""));
});

test("latest queue is read-only, minimal, and matches CORE FIFO after another cancellation", async () => {
  const a = waiter(), b = waiter("01000000002", "2099-09-02T00:00:00Z");
  const f = fixture([a, b]);
  const before = await f.call(b);
  assert.deepEqual(before.body, { ok: true, lessonDate: b.lessonDate, status: "waitlisted", position: 2, canCancel: true });
  assert.equal(f.writes.length, 0);
  const cancel = await f.call(a, "cancel"); assert.equal(cancel.body.status, "cancelled");
  assert.equal((await f.call(b)).body.position, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(JSON.stringify(before.body).includes("memberPhone"), false);
  assert.match(before.headers["Cache-Control"], /no-store/);
  assert.equal(before.headers["Referrer-Policy"], "no-referrer");
});

test("self cancellation is idempotent and changes only that unpaid registration", async () => {
  const row = waiter(), f = fixture(); const original = structuredClone(row);
  const results = await Promise.all([f.call(row, "cancel"), f.call(row, "cancel")]);
  assert.ok(results.every(r => r.code === 200 && r.body.status === "cancelled"));
  assert.equal(f.writes.length, 1);
  assert.deepEqual(Object.keys(f.writes[0].patch).sort(), ["status", "waitlistCancelledAt", "waitlistCancellation", "nextAction", "updatedAt"].sort());
  const after: any = f.rows.get(row.registrationId);
  assert.equal(after.status, "cancelled");
  for (const key of Object.keys(original).filter(k => !["status", "nextAction"].includes(k))) assert.deepEqual(after[key], original[key]);
});

for (const [name, patch, requestPatch, expected] of [
  ["GET prefetch", {}, { method: "GET" }, 405],
  ["query-only token", { token: undefined }, { query: { token: "a".repeat(64) } }, 400],
  ["no confirmation", { confirm: false }, {}, 400],
  ["unknown operation", { action: "confirm_paid" }, {}, 400],
  ["malformed id", { registrationId: "wrong" }, {}, 400],
  ["cross-origin", {}, { get: () => "https://evil.invalid" }, 403],
  ["form request", {}, { get: (key: string) => key === "origin" ? undefined : "application/x-www-form-urlencoded" }, 400],
  ["oversized body", {}, { rawBody: Buffer.alloc(4097) }, 400],
] as any[]) {
  test(`${name} cannot read or mutate a waitlist`, async () => {
    const f = fixture(), r = await f.call(waiter(), "cancel", patch, requestPatch);
    assert.equal(r.code, expected); assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
  });
}

test("wrong token, recipient, cycle and missing record fail without writes", async () => {
  const row = waiter(), f = fixture();
  for (const patch of [{ token: "0".repeat(64) }, { token: instructorWaitlistToken(waiter("01000000002"), SECRET) },
    { token: instructorWaitlistToken(waiter(undefined, "2099-09-02T00:00:00Z"), SECRET) }, { registrationId: "ilr_" + "a".repeat(24) }]) {
    assert.equal((await f.call(row, "cancel", patch)).code, 403);
  }
  assert.equal(f.writes.length, 0);
});

test("operator promotion after link issuance cannot be cancelled through old waitlist link", async () => {
  const row = waiter(), f = fixture();
  const promoted: any = { ...row, courseKind: "standard", mode: "returning_member", waitlistOnly: false,
    status: "queued", operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
    waitlistHistory: { registeredAt: row.waitlistedAt, convertedAt: "2099-09-03T00:00:00Z" } };
  delete promoted.waitlistedAt; f.rows.set(row.registrationId, promoted);
  assert.equal((await f.call(row)).body.status, "confirmed");
  assert.equal((await f.call(row, "cancel")).code, 409);
  assert.equal(f.writes.length, 0);
  for (const patch of [{ status: "cancellation_pending" }, { status: "cancellation_review" }, { status: "review_required" },
    { status: "failed" }, { cancellation: { status: "pending" } }]) {
    f.rows.set(row.registrationId, { ...promoted, ...patch });
    assert.equal((await f.call(row)).code, 409);
    assert.equal((await f.call(row, "cancel")).code, 409);
    assert.equal(f.writes.length, 0);
  }
});

test("uncertain state is not labelled confirmed; existing job blocks cancellation", async () => {
  const row = waiter();
  for (const patch of [{ status: "review" }, { paymentMethod: "card" }, { evidence: { ticketId: "issued" } },
    { operatorChecks: { paymentConfirmed: true, seatConfirmed: false } }]) {
    const f = fixture(); f.rows.set(row.registrationId, { ...row, ...patch });
    assert.equal((await f.call(row)).code, 409); assert.equal((await f.call(row, "cancel")).code, 409);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture([row], { job: { status: "pending" } });
  assert.equal((await f.call(row, "cancel")).code, 409); assert.equal(f.writes.length, 0);
});

test("ended waitlists and incomplete query coverage never allow mutation or guessed position", async () => {
  const row = waiter(), ended = fixture([row], { now: Date.parse("2099-11-29T00:00:00+09:00") });
  assert.equal((await ended.call(row)).body.status, "closed");
  assert.equal((await ended.call(row, "cancel")).code, 409); assert.equal(ended.writes.length, 0);
  const incomplete = fixture([row], { overflow: true });
  assert.equal((await incomplete.call(row)).code, 503); assert.equal(incomplete.writes.length, 0);
});

test("burst requests are bounded without more database reads", async () => {
  const f = fixture(); for (let i = 0; i < 30; i++) assert.equal((await f.call()).code, 200);
  const count = f.reads.length; assert.equal((await f.call()).code, 429); assert.equal(f.reads.length, count);
});

test("transaction retry revalidates promotion before any waitlist cancellation write", async () => {
  const original = waiter(); let row: any = original, attempts = 0, writes = 0;
  const abort = new Error("synthetic optimistic conflict");
  const db = { collection: (name: string) => ({ doc: (id: string) => ({ name, id }) }),
    runTransaction: async (fn: any) => {
      for (let i = 0; i < 2; i++) {
        attempts++;
        try {
          return await fn({ get: async (ref: any) => {
            if (ref.name === "studiomateInstructorLessonJobs") {
              row = { ...original, courseKind: "standard", mode: "returning_member", status: "queued", waitlistOnly: false,
                operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
                waitlistHistory: { registeredAt: original.waitlistedAt, convertedAt: "2099-09-03T00:00:00Z" } };
              throw abort;
            }
            return { data: () => structuredClone(row) };
          }, update: () => { writes++; } });
        } catch (error) { if (error !== abort) throw error; }
      }
    } };
  const api = createInstructorWaitlistApi({ db, secret: () => SECRET, now: () => NOW });
  const res: any = { set() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; } };
  await api({ method: "POST", get: (key: string) => key === "content-type" ? "application/json" : undefined, body: { registrationId: original.registrationId,
    token: instructorWaitlistToken(original, SECRET), action: "cancel", confirm: true } }, res);
  assert.equal(attempts, 2); assert.equal(res.code, 409); assert.equal(writes, 0);
  assert.equal(row.status, "queued");
});

test("deadline crossed while reading the job blocks mutation at and after cutoff", async () => {
  const row = waiter(), deadline = Date.parse(`${row.lessonDate}T23:59:59.999+09:00`);
  for (const end of [deadline, deadline + 1000]) {
    let clock = deadline - 1000, writes = 0;
    const db = { collection: (name: string) => ({ doc: (id: string) => ({ name, id }) }),
      runTransaction: (fn: any) => fn({ get: async (ref: any) => {
        if (ref.name === "studiomateInstructorLessonJobs") { clock = end; return { exists: false }; }
        return { data: () => row };
      }, update: () => { writes++; } }) };
    const api = createInstructorWaitlistApi({ db, secret: () => SECRET, now: () => clock });
    const res: any = { set() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; } };
    await api({ method: "POST", get: (key: string) => key === "content-type" ? "application/json" : undefined,
      body: { registrationId: row.registrationId, token: instructorWaitlistToken(row, SECRET), action: "cancel", confirm: true } }, res);
    assert.equal(res.code, 409); assert.equal(writes, 0);
  }
});
