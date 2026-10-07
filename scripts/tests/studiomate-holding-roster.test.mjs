import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  HOLDING_ROSTER_STATE,
  HOLDING_ROSTER_JOBS,
  buildHoldingRoster,
  holdingRosterPhone,
  holdingRosterMemberKey,
  planHoldingRoster,
  observeHoldingRoster,
} from "../lib/studiomate-holding-roster.mjs";

const PHONE = "01000001001";
const NAME = "Synthetic Member Alpha";
const PRODUCT = "Synthetic Annual Pass";
const at = minute => new Date(Date.UTC(2026, 9, 7, 3, minute)).toISOString();
const source = (minute = 0, patch = {}) => ({
  sourceImportId: `synthetic-import-${minute}`,
  downloadedAt: at(minute),
  studioId: "5330",
  complete: true,
  applied: true,
  ...patch,
});
const row = (patch = {}) => ({
  이름: NAME,
  전화번호: PHONE,
  수강권명: PRODUCT,
  수강권상태: "정지중",
  수강권시작일: "2026-01-01",
  수강권종료일: "2026-12-31",
  수강권최종수정일: "2026-10-07 11:00",
  메모: "Synthetic private memo, never persist in roster state",
  ...patch,
});
const profile = (patch = {}) => ({
  memberId: "101",
  studioId: "5330",
  phone: PHONE,
  name: NAME,
  ...patch,
});
const plan = (patch = {}) => planHoldingRoster({
  rows: [row()], source: source(), profiles: [profile()], now: at(1), ...patch,
});

function baseline(rows = [row()], profiles = [profile()]) {
  const result = plan({ rows, profiles });
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.state);
  return result;
}

function assertDiscoveryOnly(result) {
  assert.equal(result.mode, "discovery_only");
  assert.equal(result.sends, 0);
  for (const field of ["candidates", "candidateKeys", "candidateHints", "alimtalkCandidates"]) {
    assert.equal(Object.hasOwn(result, field), false, `${field} must not be produced`);
  }
  for (const job of result.jobs || []) {
    assert.equal(job.sendAllowed, false);
    assert.equal(job.absenceConfirmed, false);
    assert.match(job.jobId, /^[a-f0-9]{64}$/);
    assert.match(job.memberKey, /^[a-f0-9]{64}$/);
  }
}

function fakeDb() {
  const records = new Map();
  const reads = [];
  const writes = [];
  const allowed = key => key === HOLDING_ROSTER_STATE ||
    key.startsWith(`${HOLDING_ROSTER_JOBS}/`);
  return {
    records, reads, writes,
    doc(key) {
      assert.ok(allowed(key), `unexpected document access: ${key}`);
      return { key };
    },
    async runTransaction(callback) {
      const pending = [];
      let writeStarted = false;
      const result = await callback({
        async get(ref) {
          assert.equal(writeStarted, false, "all transaction reads precede writes");
          reads.push(ref.key);
          const value = structuredClone(records.get(ref.key));
          return { exists: records.has(ref.key), data: () => value };
        },
        set(ref, value) {
          assert.ok(allowed(ref.key), `unexpected document write: ${ref.key}`);
          writeStarted = true;
          pending.push([ref.key, structuredClone(value)]);
        },
      });
      for (const [key, value] of pending) {
        records.set(key, value);
        writes.push([key, value]);
      }
      return result;
    },
  };
}

const observe = (db, patch = {}) => observeHoldingRoster({
  db, rows: [row()], source: source(), profiles: [profile()], now: at(1), ...patch,
});

test("first held roster is a no-send baseline with read-only readback jobs", () => {
  const result = baseline();
  assert.equal(result.reason, "no_send_baseline");
  assert.equal(result.counts.baseline, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].transition, "baseline");
  assert.equal(result.jobs[0].baselineOnly, true);
  assert.equal(result.jobs[0].status, "pending");
  assert.equal(result.jobs[0].memberId, "101");
  assertDiscoveryOnly(result);
});

test("an all-active export initializes a valid empty held baseline", () => {
  const result = baseline([row({ 수강권상태: "사용중 (90일 남음)" })]);
  assert.deepEqual(result.state.held, {});
  assert.deepEqual(result.jobs, []);
  assert.equal(result.state.totalRows, 1);
  assertDiscoveryOnly(result);
});

test("entered, continued, changed and left are discovery transitions, never confirmed absence", async t => {
  for (const transition of ["entered", "continued", "changed", "left"]) {
    await t.test(transition, () => {
      const active = row({ 수강권상태: "사용중" });
      const previous = baseline([transition === "entered" ? active : row()]).state;
      const current = transition === "left" ? active :
        transition === "changed" ? row({ 수강권종료일: "2027-01-02" }) : row();
      const result = plan({ previous, rows: [current], source: source(2), now: at(3) });
      assert.equal(result.ok, true, result.reason);
      assert.equal(result.counts[transition], 1);
      assert.equal(result.jobs.length, 1);
      assert.equal(result.jobs[0].transition, transition);
      assert.equal(result.jobs[0].baselineOnly, false);
      assert.equal(result.jobs[0].status, "pending");
      assert.equal(result.state.initializedAt, previous.initializedAt);
      assertDiscoveryOnly(result);
    });
  }
});

test("each observable held-ticket field change requests another readback", async t => {
  const previous = baseline().state;
  for (const [field, value] of [
    ["수강권상태", "홀딩중"],
    ["수강권시작일", "2026-01-02"],
    ["수강권종료일", "2027-01-02"],
    ["수강권최종수정일", "2026-10-07 12:30"],
  ]) {
    await t.test(field, () => {
      const result = plan({ previous, rows: [row({ [field]: value })], source: source(2), now: at(3) });
      assert.equal(result.ok, true, result.reason);
      assert.equal(result.jobs[0].transition, "changed");
      assert.notEqual(result.jobs[0].discoveryVersion, baseline().jobs[0].discoveryVersion);
      assertDiscoveryOnly(result);
    });
  }
});

test("unchanged current-held Excel still requests readback for hidden hold-date changes", () => {
  const first = baseline();
  const result = plan({ previous: first.state, source: source(2), now: at(3) });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.jobs.length, 1, "Excel cannot prove unchanged native hold dates");
  assert.equal(result.jobs[0].transition, "continued");
  assert.equal(result.jobs[0].status, "pending");
  assert.equal(result.jobs[0].jobId, first.jobs[0].jobId);
  assert.notEqual(result.jobs[0].discoveryVersion, first.jobs[0].discoveryVersion);
  assertDiscoveryOnly(result);
});

test("historical parenthesized holding statuses are recognized", async t => {
  for (const status of [
    "정지중 (8일 정지)", "정지중 (372일 정지)", "정지중 (1,234일 정지)",
    " 정지중 (7일 정지) ", "정지", "중지중", "홀딩", "일시정지", "정지예정",
  ]) {
    await t.test(status, () => {
      const result = plan({ rows: [row({ 수강권상태: status })] });
      assert.equal(result.ok, true, result.reason);
      assert.equal(result.jobs.length, 1);
      assert.equal(result.counts.baseline, 1);
      assertDiscoveryOnly(result);
    });
  }
});

test("released or cancelled statuses are not current holds and unknown holding text is blocked", () => {
  for (const status of ["정지해제", "홀딩취소", "사용예정", "이용만료"]) {
    assert.deepEqual(baseline([row({ 수강권상태: status })]).state.held, {});
  }
  const result = plan({ rows: [row({ 수강권상태: "정지 상태 확인불가" })] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unrecognized_holding_status");
  assert.deepEqual(result.jobs, []);
  assertDiscoveryOnly(result);
});

test("phone variants share a SHA-256 member key and state contains no plaintext member PII", () => {
  const expected = createHash("sha256").update(JSON.stringify(PHONE)).digest("hex");
  for (const phone of [PHONE, "010-0000-1001", "+82 10-0000-1001"]) {
    assert.equal(holdingRosterPhone(phone), PHONE);
    assert.equal(holdingRosterMemberKey(phone), expected);
  }
  assert.equal(holdingRosterMemberKey("not-a-phone"), "");
  const result = baseline();
  assert.deepEqual(Object.keys(result.state.rowCounts), [expected]);
  assert.deepEqual(Object.keys(result.state.held), [expected]);
  const serialized = JSON.stringify(result.state);
  for (const privateValue of [PHONE, NAME, row().메모]) assert.equal(serialized.includes(privateValue), false);
  for (const field of ["phone", "memberPhone", "memberName", "이름", "전화번호", "메모"]) {
    assert.equal(serialized.includes(`"${field}":`), false);
  }
});

test("same-phone row multiplicity is retained and row order does not change fingerprints", () => {
  const rows = [row(), row({ 수강권명: "Synthetic Private Pass" }), row({ 수강권명: "Synthetic Used Pass", 수강권상태: "이용만료" })];
  const key = holdingRosterMemberKey(PHONE);
  const member = buildHoldingRoster(rows).get(key);
  assert.equal(member.rows, 3);
  assert.equal(member.tickets.length, 2);
  assert.equal(member.productCounts[PRODUCT], 1);
  const first = baseline(rows);
  const result = plan({ previous: first.state, rows: [...rows].reverse(), source: source(2), now: at(3) });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.state.rowCounts[key], 3);
  assert.equal(result.state.held[key].fingerprint, first.state.held[key].fingerprint);
  assert.equal(result.jobs.length, 2);
  assert.ok(result.jobs.every(job => job.transition === "continued" && job.status === "pending"));
  assertDiscoveryOnly(result);
});

test("same-product duplicates require review even when only one duplicate is held", async t => {
  for (const status of ["정지중", "사용중", "이용만료"]) {
    await t.test(status, () => {
      const rows = [row(), row({ 수강권상태: status })];
      const result = baseline(rows);
      const key = holdingRosterMemberKey(PHONE);
      assert.equal(result.state.rowCounts[key], 2);
      assert.equal(result.state.held[key].tickets.length, status === "정지중" ? 2 : 1);
      assert.equal(result.jobs.length, 1);
      assert.equal(result.jobs[0].status, "review");
      assert.equal(result.jobs[0].reason, "duplicate_product_readback_review_required");
      assert.equal(result.counts.review, 1);
      assertDiscoveryOnly(result);
    });
  }
});

test("only a unique native member ID in this studio can resolve a phone", async t => {
  for (const [label, profiles, expectedId] of [
    ["native unique", [profile()], "101"],
    ["same native ID repeated", [profile(), profile()], "101"],
    ["normalized native phone", [profile({ phone: "+82 10-0000-1001" })], "101"],
    ["fallback ignored beside native", [profile({ memberId: "excel_101" }), profile()], "101"],
    ["wrong studio ignored beside native", [profile({ memberId: "102", studioId: "9001" }), profile()], "101"],
    ["no profile", [], null],
    ["fallback only", [profile({ memberId: "excel_101" })], null],
    ["numeric ID value", [profile({ memberId: 101 })], null],
    ["zero ID", [profile({ memberId: "0" })], null],
    ["wrong studio", [profile({ studioId: "9001" })], null],
    ["wrong phone same name", [profile({ phone: "01000001002" })], null],
    ["two native IDs", [profile(), profile({ memberId: "102" })], null],
  ]) {
    await t.test(label, () => {
      const result = baseline([row()], profiles);
      assert.equal(result.jobs[0].memberId, expectedId);
      assert.equal(result.jobs[0].status, expectedId ? "pending" : "review");
      assert.equal(result.jobs[0].reason, expectedId ? "" : "native_member_phone_match_required");
      assertDiscoveryOnly(result);
    });
  }
});

test("invalid, incomplete, stale, future and replayed exports never overwrite persisted state or jobs", async t => {
  for (const [label, patch, reason] of [
    ["empty rows", { rows: [] }, "empty_or_incomplete_holding_export"],
    ["missing status column", { rows: [{ 전화번호: PHONE, 수강권명: PRODUCT }] }, "empty_or_incomplete_holding_export"],
    ["null row", { rows: [null] }, "empty_or_incomplete_holding_export"],
    ["held missing phone", { rows: [row({ 전화번호: "" })] }, "holding_row_identity_missing"],
    ["held missing product", { rows: [row({ 수강권명: "" })] }, "holding_row_identity_missing"],
    ["incomplete export", { source: source(2, { complete: false }) }, "fresh_complete_applied_member_export_required"],
    ["not applied", { source: source(2, { applied: false }) }, "fresh_complete_applied_member_export_required"],
    ["wrong studio", { source: source(2, { studioId: "9001" }) }, "fresh_complete_applied_member_export_required"],
    ["missing import ID", { source: source(2, { sourceImportId: "" }) }, "fresh_complete_applied_member_export_required"],
    ["invalid timestamp", { source: source(2, { downloadedAt: "invalid" }) }, "fresh_complete_applied_member_export_required"],
    ["stale export", { source: source(2), now: at(33) }, "fresh_complete_applied_member_export_required"],
    ["future export", { source: source(4) }, "fresh_complete_applied_member_export_required"],
    ["same export replay", { source: source() }, "already_observed_or_older_download"],
    ["older export", { source: source(-1) }, "already_observed_or_older_download"],
  ]) {
    await t.test(label, async () => {
      const db = fakeDb();
      assert.equal((await observe(db)).ok, true);
      const before = structuredClone([...db.records]);
      const writes = db.writes.length;
      const result = await observe(db, { source: source(2), now: at(3), ...patch });
      assert.equal(result.reason, reason);
      assert.equal(result.ok, reason === "already_observed_or_older_download");
      assert.deepEqual([...db.records], before);
      assert.equal(db.writes.length, writes);
      assert.equal(result.state, undefined);
      assertDiscoveryOnly(result);
    });
  }
});

test("invalid prior state is preserved for explicit review instead of replaced by a baseline", async () => {
  const db = fakeDb();
  await observe(db);
  db.records.get(HOLDING_ROSTER_STATE).schemaVersion = -1;
  const before = structuredClone([...db.records]);
  const writes = db.writes.length;
  const result = await observe(db, { source: source(2), now: at(3) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_roster_baseline_review_required");
  assert.deepEqual([...db.records], before);
  assert.equal(db.writes.length, writes);
  assertDiscoveryOnly(result);
});

test("truncation guards independently reject lost member coverage and lost row multiplicity", async t => {
  const members = Array.from({ length: 20 }, (_, index) => row({ 전화번호: `010${String(2000 + index).padStart(8, "0")}` }));
  for (const [label, initial, truncated] of [
    ["missing identities with unchanged row count", members, [...members.slice(2), { ...members[2] }, { ...members[3] }]],
    ["same identities with fewer ticket rows", Array.from({ length: 20 }, (_, index) => row({ 수강권명: `Synthetic Pass ${index}` })), Array.from({ length: 18 }, (_, index) => row({ 수강권명: `Synthetic Pass ${index}` }))],
  ]) {
    await t.test(label, async () => {
      const db = fakeDb();
      assert.equal((await observe(db, { rows: initial })).ok, true);
      const before = structuredClone([...db.records]);
      const writes = db.writes.length;
      const result = await observe(db, { rows: truncated, source: source(2), now: at(3) });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "holding_export_coverage_loss_review_required");
      assert.deepEqual([...db.records], before);
      assert.equal(db.writes.length, writes);
      assertDiscoveryOnly(result);
    });
  }
});

test("a missing member within coverage tolerance produces left but never proves cancellation", () => {
  const rows = Array.from({ length: 20 }, (_, index) => row({ 전화번호: `010${String(2000 + index).padStart(8, "0")}` }));
  const first = baseline(rows);
  const result = plan({ previous: first.state, rows: rows.slice(1), source: source(2), now: at(3) });
  assert.equal(result.ok, true, result.reason);
  const left = result.jobs.find(job => job.memberKey === holdingRosterMemberKey(rows[0].전화번호));
  assert.ok(left);
  assert.equal(left.transition, "left");
  assert.equal(left.absenceConfirmed, false);
  assertDiscoveryOnly(result);
});

test("mock transaction preserves pending requestedAt across continued and changed observations", async () => {
  const db = fakeDb();
  const first = await observe(db);
  assert.equal(first.ok, true);
  assertDiscoveryOnly(first);
  const path = [...db.records.keys()].find(key => key.startsWith(`${HOLDING_ROSTER_JOBS}/`));
  assert.ok(path);
  const original = structuredClone(db.records.get(path));
  for (const [minute, rows, transition] of [
    [2, [row()], "continued"],
    [4, [row({ 수강권최종수정일: "2026-10-07 12:30" })], "changed"],
    [6, [row({ 수강권상태: "사용중" })], "left"],
  ]) {
    const previousVersion = db.records.get(path).discoveryVersion;
    const result = await observe(db, { rows, source: source(minute), now: at(minute + 1) });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.readbackJobs, 1);
    const job = db.records.get(path);
    assert.equal(job.requestedAt, original.requestedAt);
    assert.equal(job.updatedAt, at(minute + 1));
    assert.equal(job.transition, transition);
    assert.equal(job.status, "pending");
    assert.notEqual(job.discoveryVersion, previousVersion);
    assertDiscoveryOnly({ ...result, jobs: [job] });
  }
  assert.equal(db.records.size, 2, "one baseline and one stable readback job, no candidate documents");
  assert.ok(db.reads.every(key => key === HOLDING_ROSTER_STATE || key.startsWith(`${HOLDING_ROSTER_JOBS}/`)));
  assert.ok(db.writes.every(([key]) => key === HOLDING_ROSTER_STATE || key.startsWith(`${HOLDING_ROSTER_JOBS}/`)));
});

test("a completed readback is reopened for a fresh observation with a new requestedAt", async () => {
  const db = fakeDb();
  await observe(db);
  const path = [...db.records.keys()].find(key => key.startsWith(`${HOLDING_ROSTER_JOBS}/`));
  db.records.get(path).status = "completed";
  db.records.get(path).lastCheckedAt = at(1);
  const result = await observe(db, { source: source(2), now: at(3) });
  assert.equal(result.ok, true, result.reason);
  const job = db.records.get(path);
  assert.equal(job.status, "pending");
  assert.equal(job.requestedAt, at(3));
  assert.equal(job.lastCheckedAt, at(1), "fresh roster must preserve rotation across completed observations");
  assertDiscoveryOnly({ ...result, jobs: [job] });
});
