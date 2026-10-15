import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  HOLDING_ROSTER_STATE,
  HOLDING_ROSTER_JOBS,
  holdingRosterMemberKey,
  planHoldingRoster,
  observeHoldingRoster,
} from "../lib/studiomate-holding-roster.mjs";

const PHONE = "01000001901";
const NAME = "Synthetic Recent Ticket Member";
const PRODUCT = "Synthetic Recent Ticket Pass";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const at = minute => new Date(Date.UTC(2026, 9, 15, 3, minute)).toISOString();
const row = (patch = {}) => ({
  이름: NAME,
  전화번호: PHONE,
  수강권명: PRODUCT,
  수강권종류: "그룹",
  수강권상태: "사용중 (77일 남음)",
  수강권시작일: "2026-01-01",
  수강권종료일: "2026-12-31",
  수강권최종수정일: "2026-10-15",
  잔여횟수: 12,
  ...patch,
});
const profile = (patch = {}) => ({
  memberId: "1901", studioId: "5330", name: NAME, phone: PHONE, ...patch,
});
const linkedProfile = (patch = {}) => profile({
  memberId: "excel_synthetic_recent_1901",
  studiomateMemberId: "1901",
  studiomateMemberIdResolvedAt: at(-30),
  ...patch,
});
const source = (minute = 0, patch = {}) => ({
  studioId: "5330", sourceImportId: `synthetic-recent-${minute}`,
  downloadedAt: at(minute), applied: true, complete: true,
  recentTicketChanges: true, ...patch,
});
const plan = (patch = {}) => planHoldingRoster({
  rows: [row()], source: source(2), profiles: [profile()], now: at(3), ...patch,
});

function baseline(rows = [row()]) {
  const result = plan({ rows, source: source(), now: at(1) });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.reason, "no_send_baseline");
  assert.equal(result.state.schemaVersion, 2);
  return result.state;
}

const discover = (patch = {}) => plan({ previous: baseline(), ...patch });
const jobPath = job => `${HOLDING_ROSTER_JOBS}/${job.jobId}`;

function assertReadOnly(result) {
  assert.equal(result.mode, "discovery_only");
  assert.equal(result.sends, 0);
  for (const field of ["candidates", "candidateHints", "candidateKeys", "alimtalkCandidates", "settings"]) {
    assert.equal(Object.hasOwn(result, field), false, `unexpected ${field}`);
  }
  for (const job of result.jobs || []) {
    assert.equal(job.sendAllowed, false);
    assert.equal(job.absenceConfirmed, false);
    assert.match(job.jobId, /^[a-f0-9]{64}$/);
    assert.match(job.discoveryVersion, /^[a-f0-9]{64}$/);
    for (const field of ["holdingId", "holdingStartDate", "holdingEndDate", "allowance", "remainingCount"]) {
      assert.equal(Object.hasOwn(job, field), false, `Excel must not infer ${field}`);
    }
  }
}

function fakeDb(initial = baseline()) {
  const records = new Map([[HOLDING_ROSTER_STATE, structuredClone(initial)]]);
  const reads = [], writes = [];
  const allowed = path => path === HOLDING_ROSTER_STATE ||
    (path.startsWith(`${HOLDING_ROSTER_JOBS}/`) && /^[a-f0-9]{64}$/.test(path.split("/").at(-1)));
  return {
    records, reads, writes,
    doc(path) {
      assert.ok(allowed(path), `forbidden document access: ${path}`);
      return { path };
    },
    async runTransaction(callback) {
      const pending = [];
      const result = await callback({
        async get(ref) {
          assert.equal(pending.length, 0, "transaction reads must precede writes");
          reads.push(ref.path);
          const value = structuredClone(records.get(ref.path));
          return { exists: records.has(ref.path), data: () => value };
        },
        set(ref, value) {
          assert.ok(allowed(ref.path), `forbidden document write: ${ref.path}`);
          pending.push([ref.path, structuredClone(value)]);
        },
      });
      for (const [path, value] of pending) {
        records.set(path, value);
        writes.push([path, value]);
      }
      return result;
    },
  };
}

const observe = (db, minute = 2, patch = {}) => observeHoldingRoster({
  db, rows: [row()], source: source(minute), profiles: [profile()], now: at(minute + 1), ...patch,
});

test("date-only 2026-10-15 creates a read-only ticket_changed hint without inferring a hold", () => {
  const result = discover();
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.counts.ticketChanged, 1);
  assert.deepEqual(result.state.held, {});
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].transition, "ticket_changed");
  assert.equal(result.jobs[0].baselineOnly, false);
  assert.equal(result.jobs[0].status, "pending");
  assert.equal(result.jobs[0].memberId, "1901");
  assert.equal(result.jobs[0].ticketRevision, hash([
    PRODUCT, "그룹", "2026-01-01", "2026-12-31", "2026-10-15",
  ]));
  assertReadOnly(result);
});

test("only boolean true opts into recent-ticket discovery", async t => {
  for (const flag of [undefined, false, "true", 1]) {
    await t.test(String(flag), () => {
      const result = discover({ source: source(2, { recentTicketChanges: flag }) });
      assert.equal(result.ok, true, result.reason);
      assert.deepEqual(result.jobs, []);
      assert.equal(result.state.schemaVersion, 2);
      assertReadOnly(result);
    });
  }
});

test("initial active roster stays no-send and does not enqueue recent tickets", async () => {
  const db = fakeDb();
  db.records.clear();
  const result = await observe(db, 0);
  assert.equal(result.reason, "no_send_baseline");
  assert.equal(result.readbackJobs, 0);
  assert.equal(db.records.size, 1);
  assert.equal(db.records.get(HOLDING_ROSTER_STATE).initializedAt, at(1));
  assertReadOnly(result);
});

test("initial held roster retains baseline-only readback rather than ticket_changed", () => {
  const result = plan({ rows: [row({ 수강권상태: "정지중" })], previous: null });
  assert.equal(result.reason, "no_send_baseline");
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].transition, "baseline");
  assert.equal(result.jobs[0].baselineOnly, true);
  assertReadOnly(result);
});

test("stable member/product key survives phone formatting, linked IDs and later exports", () => {
  const original = discover().jobs[0];
  const expectedKey = holdingRosterMemberKey(PHONE);
  assert.equal(original.jobId, hash([expectedKey, PRODUCT]));
  for (const phone of [PHONE, "010-0000-1901", "+82 10-0000-1901"]) {
    const result = discover({
      rows: [row({ 전화번호: phone })], profiles: [linkedProfile()],
      source: source(4), now: at(5),
    });
    const job = result.jobs[0];
    assert.equal(job.jobId, original.jobId);
    assert.equal(job.memberKey, original.memberKey);
    assert.equal(job.memberId, "1901");
    assert.equal(job.ticketRevision, original.ticketRevision);
    assert.notEqual(job.discoveryVersion, original.discoveryVersion);
    assertReadOnly(result);
  }
});

test("revision excludes remaining count and countdown status", () => {
  const original = discover().jobs[0];
  const changed = discover({ rows: [row({ 잔여횟수: 0, 수강권상태: "사용중 (76일 남음)" })] }).jobs[0];
  assert.equal(changed.ticketRevision, original.ticketRevision);
  assert.equal(changed.jobId, original.jobId);
  assert.equal(changed.discoveryVersion, original.discoveryVersion);
});

test("each substantive ticket field changes revision even on the same modification calendar day", async t => {
  const original = discover().jobs[0];
  for (const [field, value] of [
    ["수강권명", "Synthetic Renamed Pass"],
    ["수강권종류", "개인"],
    ["수강권시작일", "2026-01-02"],
    ["수강권종료일", "2027-01-01"],
    ["수강권최종수정일", "2026-10-15 10:30:00"],
  ]) {
    await t.test(field, () => {
      const job = discover({ rows: [row({ [field]: value })] }).jobs[0];
      assert.notEqual(job.ticketRevision, original.ticketRevision);
      assert.notEqual(job.discoveryVersion, original.discoveryVersion);
      assert.equal(job.jobId === original.jobId, field !== "수강권명");
    });
  }
});

test("KST calendar-day selection includes boundary days, not a rolling native 48-hour cutoff", async t => {
  for (const [now, modified, expected] of [
    ["2026-10-15T14:59:00.000Z", "2026-10-13", 1],
    ["2026-10-15T15:00:00.000Z", "2026-10-13", 0],
    ["2026-10-15T15:00:00.000Z", "2026-10-14", 1],
    ["2026-10-15T15:00:00.000Z", "2026-10-16", 1],
    ["2026-10-15T15:00:00.000Z", "2026-10-17", 0],
  ]) {
    await t.test(`${now} / ${modified}`, () => {
      const result = discover({ rows: [row({ 수강권최종수정일: modified })],
        now, source: source(2, { downloadedAt: now }) });
      assert.equal(result.ok, true, result.reason);
      assert.equal(result.jobs.length, expected);
      assertReadOnly(result);
    });
  }
});

test("null, old, future and malformed modification dates produce no hint", async t => {
  for (const modified of [null, undefined, "", "2026-10-12", "2026-10-16", "not-a-date",
    "2026-02-30", "2026-13-15", "2026-10-32", "2026-10-00", "15/10/2026", "2026-10-15T03:00:00Z"]) {
    await t.test(String(modified), () => {
      const result = discover({ rows: [row({ 수강권최종수정일: modified })] });
      assert.equal(result.ok, true, result.reason);
      assert.deepEqual(result.jobs, []);
      assertReadOnly(result);
    });
  }
});

test("modification timestamps with invalid clock values must not create hints", async t => {
  for (const modified of ["2026-10-15 99:99", "2026-10-15 25:00", "2026-10-15 10:60", "2026-10-15 10:30:99"]) {
    await t.test(modified, () => {
      const result = discover({ rows: [row({ 수강권최종수정일: modified })] });
      assert.equal(result.ok, true, result.reason);
      assert.deepEqual(result.jobs, []);
    });
  }
});

test("non-usable and expired statuses never create recent-ticket hints", async t => {
  for (const status of ["이용만료", "사용만료", "환불", "사용취소", "양도", "삭제", "사용예정", "이용예정", "미사용", ""]) {
    await t.test(status || "empty", () => {
      const result = discover({ rows: [row({ 수강권상태: status })] });
      assert.equal(result.ok, true, result.reason);
      assert.deepEqual(result.jobs, []);
      assertReadOnly(result);
    });
  }
});

test("an already expired ticket cannot create a currently-usable hint even with stale active status", () => {
  const result = discover({ rows: [row({ 수강권종료일: "2026-10-14" })] });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.jobs, []);
});

test("one missing modification column blocks the entire enabled observation without baseline reset", async t => {
  for (const initial of [null, baseline()]) {
    await t.test(initial ? "existing baseline" : "first observation", async () => {
      const db = fakeDb();
      if (initial === null) db.records.clear();
      const missing = row({ 수강권명: "Synthetic Other Pass" });
      delete missing.수강권최종수정일;
      const before = structuredClone([...db.records]);
      const result = await observe(db, 2, { rows: [row(), missing] });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "ticket_modification_column_required");
      assert.deepEqual([...db.records], before);
      assert.deepEqual(db.writes, []);
      assertReadOnly(result);
    });
  }
});

test("missing modification column does not change the legacy opt-out held comparison", () => {
  const held = row({ 수강권상태: "정지중" });
  delete held.수강권최종수정일;
  const result = discover({ rows: [held], source: source(2, { recentTicketChanges: false }) });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.jobs[0].transition, "entered");
  assertReadOnly(result);
});

test("unfresh, incomplete or unapplied exports make no writes", async t => {
  for (const [label, sourcePatch, now] of [
    ["older than 30 minutes", {}, at(33)],
    ["future download", { downloadedAt: at(4) }, at(3)],
    ["incomplete", { complete: false }, at(3)],
    ["unapplied", { applied: false }, at(3)],
    ["wrong studio", { studioId: "9001" }, at(3)],
  ]) {
    await t.test(label, async () => {
      const db = fakeDb();
      const before = structuredClone([...db.records]);
      const result = await observe(db, 2, { source: source(2, sourcePatch), now });
      assert.equal(result.reason, "fresh_complete_applied_member_export_required");
      assert.equal(result.ok, false);
      assert.deepEqual([...db.records], before);
      assert.deepEqual(db.writes, []);
    });
  }
});

test("schema 2 baseline and coverage guards stay fail-closed when discovery is enabled", async t => {
  for (const [label, mutate, rows, reason] of [
    ["invalid schema", state => { state.schemaVersion = 1; }, [row()], "invalid_roster_baseline_review_required"],
    ["missing member coverage", () => {}, [row({ 전화번호: "01000001902" })], "holding_export_coverage_loss_review_required"],
  ]) {
    await t.test(label, async () => {
      const db = fakeDb();
      mutate(db.records.get(HOLDING_ROSTER_STATE));
      const before = structuredClone([...db.records]);
      const result = await observe(db, 2, { rows });
      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.deepEqual([...db.records], before);
      assert.deepEqual(db.writes, []);
    });
  }
});

test("same-product duplicates are review-only while distinct products get distinct stable jobs", () => {
  const duplicateRows = [row(), row({ 수강권최종수정일: "2026-01-01", 수강권상태: "이용만료" })];
  for (const rows of [duplicateRows, [...duplicateRows].reverse()]) {
    const result = discover({ rows });
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].status, "review");
    assert.equal(result.jobs[0].reason, "duplicate_product_readback_review_required");
    assert.equal(result.counts.review, 1);
    assertReadOnly(result);
  }
  const distinct = discover({ rows: [row(), row({ 수강권명: "Synthetic Private Pass" })] });
  assert.equal(distinct.jobs.length, 2);
  assert.equal(new Set(distinct.jobs.map(job => job.jobId)).size, 2);
  assert.ok(distinct.jobs.every(job => job.status === "pending"));
});

test("existing held transitions take precedence over a recent-ticket hint for the same key", async t => {
  const held = row({ 수강권상태: "정지중" });
  for (const [transition, previous, current] of [
    ["entered", baseline(), held],
    ["continued", baseline([held]), held],
    ["changed", baseline([held]), { ...held, 수강권종료일: "2027-01-01" }],
    ["left", baseline([held]), row()],
  ]) {
    await t.test(transition, () => {
      const result = discover({ previous, rows: [current] });
      assert.equal(result.jobs.length, 1);
      assert.equal(result.jobs[0].transition, transition);
      assert.equal(result.counts[transition], 1);
      assert.equal(result.counts.ticketChanged, 0);
      assert.equal(result.jobs[0].jobId, hash([holdingRosterMemberKey(PHONE), PRODUCT]));
      assertReadOnly(result);
    });
  }
});

test("unresolved, mismatched-phone and conflicting native identities remain review-only", async t => {
  for (const [label, profiles] of [
    ["no identity", []],
    ["name alone", [profile({ phone: "01000001902" })]],
    ["unresolved Excel", [linkedProfile({ studiomateMemberId: undefined })]],
    ["unverified pointer", [linkedProfile({ studiomateMemberIdResolvedAt: undefined })]],
    ["missing linked name", [linkedProfile({ name: "" })]],
    ["wrong studio", [profile({ studioId: "9001" })]],
    ["conflicting pointer", [profile(), linkedProfile({ studiomateMemberId: "1902" })]],
  ]) {
    await t.test(label, () => {
      const result = discover({ profiles });
      assert.equal(result.jobs[0].memberId, null);
      assert.equal(result.jobs[0].status, "review");
      assert.equal(result.jobs[0].reason, "native_member_phone_match_required");
      assertReadOnly(result);
    });
  }
});

test("pending refresh keeps requestedAt, advances import/version and never resets baseline", async () => {
  const db = fakeDb();
  const initializedAt = db.records.get(HOLDING_ROSTER_STATE).initializedAt;
  await observe(db);
  const path = jobPath(discover().jobs[0]);
  const first = structuredClone(db.records.get(path));
  const result = await observe(db, 4);
  const current = db.records.get(path);
  assert.equal(current.status, "pending");
  assert.equal(current.requestedAt, first.requestedAt);
  assert.equal(current.sourceImportId, source(4).sourceImportId);
  assert.equal(current.downloadedAt, at(4));
  assert.equal(current.updatedAt, at(5));
  assert.notEqual(current.discoveryVersion, first.discoveryVersion);
  assert.equal(current.ticketRevision, first.ticketRevision);
  assert.equal(db.records.get(HOLDING_ROSTER_STATE).initializedAt, initializedAt);
  assert.equal(db.records.size, 2, "only baseline plus readback job may be written");
  assertReadOnly({ ...result, jobs: [current] });
});

test("each new export rechecks recently modified tickets even when same-day revisions look unchanged", async () => {
  const db = fakeDb();
  await observe(db);
  const path = jobPath(discover().jobs[0]);
  Object.assign(db.records.get(path), { status: "observed", lastCheckedAt: at(3) });
  const observed = structuredClone(db.records.get(path));
  for (const minute of [4, 6]) {
    const start = db.writes.length;
    const result = await observe(db, minute, { rows: [row({ 잔여횟수: 10 - minute, 수강권상태: "사용중 (76일 남음)" })] });
    assert.equal(result.ok, true, result.reason);
    const current = db.records.get(path);
    assert.equal(current.status, "pending");
    assert.equal(current.ticketRevision, observed.ticketRevision);
    assert.equal(current.lastCheckedAt, observed.lastCheckedAt);
    assert.equal(current.sourceImportId, source(minute).sourceImportId);
    assert.deepEqual(db.writes.slice(start).map(([key]) => key), [path, HOLDING_ROSTER_STATE]);
    assert.equal(db.records.get(HOLDING_ROSTER_STATE).sourceImportId, source(minute).sourceImportId);
    assertReadOnly(result);
  }
});

test("an observed ticket with a changed end on the same modification day is reopened", async () => {
  const db = fakeDb();
  await observe(db);
  const path = jobPath(discover().jobs[0]);
  Object.assign(db.records.get(path), { status: "observed", lastCheckedAt: at(3) });
  const old = structuredClone(db.records.get(path));
  const result = await observe(db, 4, { rows: [row({ 수강권종료일: "2027-01-01" })] });
  const current = db.records.get(path);
  assert.equal(current.status, "pending");
  assert.equal(current.requestedAt, at(5));
  assert.equal(current.lastCheckedAt, old.lastCheckedAt);
  assert.notEqual(current.ticketRevision, old.ticketRevision);
  assert.equal(current.jobId, old.jobId);
  assertReadOnly({ ...result, jobs: [current] });
});

test("unchanged unresolved review is skipped, but a verified pointer can reopen it", async () => {
  const db = fakeDb();
  await observe(db, 2, { profiles: [linkedProfile({ studiomateMemberId: undefined })] });
  const path = jobPath(discover().jobs[0]);
  const review = structuredClone(db.records.get(path));
  assert.equal(review.status, "review");
  const start = db.writes.length;
  await observe(db, 4, { profiles: [] });
  assert.deepEqual(db.records.get(path), review);
  assert.deepEqual(db.writes.slice(start).map(([key]) => key), [HOLDING_ROSTER_STATE]);
  await observe(db, 6, { profiles: [linkedProfile()] });
  const current = db.records.get(path);
  assert.equal(current.memberId, "1901");
  assert.equal(current.status, "pending");
  assert.equal(current.reason, "");
  assert.equal(current.requestedAt, at(7));
  assert.equal(current.ticketRevision, review.ticketRevision);
});

test("changed resolved native pointer reopens an observed revision under the same stable job key", async () => {
  const db = fakeDb();
  await observe(db, 2, { profiles: [linkedProfile()] });
  const path = jobPath(discover().jobs[0]);
  Object.assign(db.records.get(path), { status: "observed", lastCheckedAt: at(3) });
  const old = structuredClone(db.records.get(path));
  await observe(db, 4, { profiles: [linkedProfile({ studiomateMemberId: "1902" })] });
  const current = db.records.get(path);
  assert.equal(current.jobId, old.jobId);
  assert.equal(current.ticketRevision, old.ticketRevision);
  assert.equal(current.memberId, "1902");
  assert.equal(current.status, "pending");
  assert.equal(current.requestedAt, at(5));
});

test("an observed revision becomes review-only if a later export introduces a duplicate product", async () => {
  const db = fakeDb();
  await observe(db);
  const path = jobPath(discover().jobs[0]);
  Object.assign(db.records.get(path), { status: "observed", lastCheckedAt: at(3) });
  const old = structuredClone(db.records.get(path));
  const rows = [row(), row({ 수강권상태: "이용만료", 수강권최종수정일: "2026-01-01" })];
  const planned = discover({ rows });
  assert.equal(planned.jobs[0].status, "review");
  await observe(db, 4, { rows });
  const current = db.records.get(path);
  assert.equal(current.ticketRevision, old.ticketRevision);
  assert.equal(current.status, "review");
  assert.equal(current.reason, "duplicate_product_readback_review_required");
  assert.equal(current.sendAllowed, false);
});

test("same or older exports never rewrite queue or baseline after discovery", async () => {
  const db = fakeDb();
  await observe(db, 2);
  const before = structuredClone([...db.records]);
  const start = db.writes.length;
  for (const minute of [2, 0]) {
    const result = await observe(db, minute, { now: at(5) });
    assert.equal(result.reason, "already_observed_or_older_download");
    assert.deepEqual([...db.records], before);
    assert.equal(db.writes.length, start);
    assertReadOnly(result);
  }
});
