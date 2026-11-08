import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  HOLDING_ROSTER_JOBS,
  HOLDING_ROSTER_STATE,
  buildHoldingRoster,
  holdingRosterMemberKey,
  observeHoldingRoster,
  planHoldingRoster,
} from "../lib/studiomate-holding-roster.mjs";

const PHONE = "01000001981";
const PRODUCT = "Synthetic Historical Discovery Pass";
const PROFILE = { memberId: "1981", studioId: "5330", phone: PHONE };
const MEMBER_KEY = holdingRosterMemberKey(PHONE);
const NOW = "2026-11-08T03:00:00.000Z";
const at = minute => new Date(Date.parse(NOW) + minute * 60_000).toISOString();
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const row = (patch = {}) => ({
  이름: "Synthetic Historical Discovery Member",
  전화번호: PHONE,
  수강권명: PRODUCT,
  수강권종류: "그룹",
  수강권상태: "사용중 (84일 남음)",
  수강권시작일: "2026-11-01",
  수강권종료일: "2027-01-31",
  수강권최종수정일: "2026-11-08",
  ...patch,
});
const historical = (patch = {}) => row({
  수강권상태: "이용만료",
  수강권시작일: "2025-01-01",
  수강권종료일: "2026-11-07",
  ...patch,
});
const current = mode => row({ 수강권상태: mode === "held" ? "정지중 (7일 정지)" : "사용중 (84일 남음)" });
const source = (minute = 2, now = at(minute + 1)) => ({
  studioId: "5330", sourceImportId: `synthetic-historical-${minute}`,
  downloadedAt: new Date(Date.parse(now) - 60_000).toISOString(),
  applied: true, complete: true, recentTicketChanges: true,
});
const plan = (rows, { previous = null, minute = 2, now = at(minute + 1) } = {}) =>
  planHoldingRoster({ rows, previous, source: source(minute, now), profiles: [PROFILE], now });

function baseline(rows) {
  const result = plan(rows, { minute: 0 });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.reason, "no_send_baseline");
  return result.state;
}

function discover(rows, mode, now = at(3)) {
  return plan(rows, { now, previous: mode === "recent" ? baseline(rows) : null });
}

function assertCounts(rows, expectedReadback, now = at(3)) {
  const member = buildHoldingRoster(rows, now).get(MEMBER_KEY);
  assert.equal(member.rows, rows.length);
  assert.equal(member.productCounts[PRODUCT], rows.length);
  assert.equal(member.readbackProductCounts[PRODUCT] || 0, expectedReadback);
}

function assertDiscovery(result) {
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.mode, "discovery_only");
  assert.equal(result.sends, 0);
  assert.equal(result.state.schemaVersion, 2);
  assert.deepEqual(Object.keys(result.state).sort(), [
    "schemaVersion", "mode", "sourceImportId", "downloadedAt", "initializedAt", "updatedAt",
    "totalRows", "rowCounts", "held",
  ].sort());
  for (const field of ["candidates", "candidateKeys", "candidateHints", "alimtalkCandidates", "settings"])
    assert.equal(Object.hasOwn(result, field), false);
  for (const job of result.jobs) {
    assert.equal(job.jobId, hash([MEMBER_KEY, PRODUCT]));
    assert.equal(job.memberKey, MEMBER_KEY);
    assert.equal(job.memberId, PROFILE.memberId);
    assert.equal(job.sendAllowed, false);
    assert.equal(job.absenceConfirmed, false);
    assert.deepEqual(Object.keys(job).sort(), [
      "jobId", "memberKey", "memberId", "studioId", "ticketName", "transition", "status", "reason",
      "sourceImportId", "downloadedAt", "discoveryVersion", "baselineOnly", "absenceConfirmed",
      "sendAllowed", "requestedAt", ...(job.transition === "ticket_changed" ? ["ticketRevision"] : []),
    ].sort());
  }
}

function assertJob(result, mode, status = "pending") {
  assertDiscovery(result);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].status, status);
  assert.equal(result.jobs[0].reason, status === "review" ? "duplicate_product_readback_review_required" : "");
  assert.equal(result.jobs[0].transition, mode === "held" ? "baseline" : "ticket_changed");
  assert.equal(result.jobs[0].baselineOnly, mode === "held");
  assert.equal(result.counts.review, status === "review" ? 1 : 0);
  assert.equal(result.state.rowCounts[MEMBER_KEY], result.state.totalRows);
}

test("terminal expiry statuses exclude history only from held and recent readback counts", async t => {
  for (const status of ["이용만료", "사용만료", "기간만료", "만료"]) {
    for (const decorated of [status, `  ${status}  `, `${status} (기간 종료)`, ` ${status.split("").join(" ")} ( 종료 ) `]) {
      await t.test(JSON.stringify(decorated), () => {
        for (const mode of ["held", "recent"]) {
          const rows = [historical({ 수강권상태: decorated }), current(mode)];
          assertCounts(rows, 1);
          const result = discover(rows, mode);
          assertJob(result, mode);
          assert.equal(result.state.totalRows, 2);
          assert.deepEqual(result.jobs, discover([current(mode)], mode).jobs,
            "historical rows must not change job keys, revisions, versions or baseline flags");
        }
      });
    }
  }
});

test("cancelled and refunded rows remain counted and ambiguous regardless of dates", async t => {
  for (const status of ["수강권취소", "수강권환불", "취소", "환불", "취소완료", "환불완료"]) {
    for (const decorated of [status, ` ${status} (처리 완료) `, status.split("").join(" ")]) {
      await t.test(JSON.stringify(decorated), () => {
        for (const dates of [
          { 수강권시작일: "2025-01-01", 수강권종료일: "2026-11-07" },
          { 수강권시작일: undefined, 수강권종료일: undefined },
          { 수강권시작일: "bad", 수강권종료일: "2026-02-30" },
          { 수강권시작일: "2027-12-31", 수강권종료일: "2027-01-01" },
          { 수강권시작일: "2026-11-08", 수강권종료일: "2026-11-08" },
        ]) {
          for (const mode of ["held", "recent"]) {
            const rows = [historical({ 수강권상태: decorated, ...dates }), current(mode)];
            assertCounts(rows, 2);
            assertJob(discover(rows, mode), mode, "review");
          }
        }
      });
    }
  }
});

test("two historical rows plus one current ticket keep complete coverage and one pending read", () => {
  for (const mode of ["held", "recent"]) {
    const rows = [historical(), historical({ 수강권상태: "기간만료 (종료)" }), current(mode)];
    const original = discover(rows, mode);
    for (const ordered of [rows, [...rows].reverse()]) {
      assertCounts(ordered, 1);
      const result = discover(ordered, mode);
      assertJob(result, mode);
      assert.equal(result.state.totalRows, 3);
      assert.equal(result.state.rowCounts[MEMBER_KEY], 3);
      assert.deepEqual(result.jobs, original.jobs);
      assert.deepEqual(result.state.held, original.state.held);
    }
  }
});

test("historical filtering is scoped to each product and normalized member identity", () => {
  const otherProduct = "Synthetic Other Product";
  const otherPhone = "01000001982";
  const rows = [historical(), row({ 전화번호: "010-0000-1981" }),
    row({ 수강권명: otherProduct }), historical({ 전화번호: otherPhone })];
  const roster = buildHoldingRoster(rows, NOW);
  const member = roster.get(MEMBER_KEY);
  assert.equal(roster.size, 2);
  assert.equal(member.rows, 3);
  assert.deepEqual({ ...member.productCounts }, { [PRODUCT]: 2, [otherProduct]: 1 });
  assert.deepEqual({ ...member.readbackProductCounts }, { [PRODUCT]: 1, [otherProduct]: 1 });
  const other = roster.get(holdingRosterMemberKey(otherPhone));
  assert.equal(other.rows, 1);
  assert.deepEqual({ ...other.productCounts }, { [PRODUCT]: 1 });
  assert.deepEqual({ ...other.readbackProductCounts }, {});
});

test("two current same-product tickets remain review-only even alongside historical rows", async t => {
  for (const mode of ["held", "recent"]) {
    for (const secondStatus of ["사용중", "정지중"]) {
      await t.test(`${mode} / ${secondStatus}`, () => {
        for (const history of [[], [historical()], [historical(), historical({ 수강권상태: "사용만료" })]]) {
          const rows = [...history, current(mode), row({ 수강권상태: secondStatus })];
          assertCounts(rows, 2);
          // A held ticket takes precedence over a recent-ticket hint for the same key.
          const effectiveMode = secondStatus === "정지중" ? "held" : mode;
          const result = discover(rows, effectiveMode);
          assertJob(result, effectiveMode, "review");
          assert.equal(result.state.totalRows, rows.length);
        }
      });
    }
  }
});

test("unknown, nonterminal and stale active rows stay counted and ambiguous", async t => {
  for (const status of [
    "", "알수없음", "정지해제", "홀딩취소", "사용예정", "이용예정", "사용취소", "취소예정", "환불예정",
    "만료예정", "이용만료 예정", "미만료", "만료됨", "수강권취소요청", "취소완료후사용중",
    "이용만료 (종료) 추가", "이용만료 (미완료", "환불 (처리) 추가", "사용중", "이용중 (오래된 날짜)",
  ]) {
    await t.test(status || "empty", () => {
      for (const mode of ["held", "recent"]) {
        const rows = [historical({ 수강권상태: status }), current(mode)];
        assertCounts(rows, 2);
        assertJob(discover(rows, mode), mode, "review");
      }
    });
  }
});

test("expired status requires valid ordered full dates strictly before KST today", async t => {
  for (const [label, start, end] of [
    ["missing start", undefined, "2026-11-07"],
    ["missing end", "2026-01-01", undefined],
    ["empty start", "", "2026-11-07"],
    ["empty end", "2026-01-01", ""],
    ["null start", null, "2026-11-07"],
    ["null end", "2026-01-01", null],
    ["bad start", "bad", "2026-11-07"],
    ["bad end", "2026-01-01", "bad"],
    ["rolled start day", "2026-02-30", "2026-11-07"],
    ["rolled end day", "2026-01-01", "2026-02-30"],
    ["nonleap start", "2025-02-29", "2026-11-07"],
    ["nonleap end", "2025-01-01", "2025-02-29"],
    ["invalid month", "2026-01-01", "2026-13-01"],
    ["zero day", "2026-01-01", "2026-11-00"],
    ["un-padded start", "2026-1-01", "2026-11-07"],
    ["un-padded end", "2026-01-01", "2026-1-01"],
    ["start timestamp", "2026-01-01T00:00:00Z", "2026-11-07"],
    ["end timestamp", "2026-01-01", "2026-11-07T00:00:00Z"],
    ["reversed dates", "2026-11-07", "2026-11-06"],
    ["same-day end", "2026-01-01", "2026-11-08"],
    ["future end", "2026-01-01", "2026-11-09"],
    ["future start and end", "2027-01-01", "2027-12-31"],
  ]) {
    await t.test(label, () => {
      for (const mode of ["held", "recent"]) {
        const rows = [historical({ 수강권시작일: start, 수강권종료일: end }), current(mode)];
        assertCounts(rows, 2);
        assertJob(discover(rows, mode), mode, "review");
      }
    });
  }
  for (const dates of [
    { 수강권시작일: "2026-11-07", 수강권종료일: "2026-11-07" },
    { 수강권시작일: "2024-02-29", 수강권종료일: "2024-02-29" },
  ]) assertCounts([historical(dates), row()], 1);
});

test("expiry becomes historical exactly at KST midnight rather than UTC midnight", () => {
  for (const mode of ["held", "recent"]) {
    for (const [now, expectedCount, expectedStatus] of [
      ["2026-11-08T14:59:59.999Z", 2, "review"],
      ["2026-11-08T15:00:00.000Z", 1, "pending"],
      ["2026-11-08T23:59:59.999Z", 1, "pending"],
      ["2026-11-09T00:00:00.000Z", 1, "pending"],
    ]) {
      const rows = [historical({ 수강권종료일: "2026-11-08" }), current(mode)];
      assertCounts(rows, expectedCount, now);
      assertJob(discover(rows, mode, now), mode, expectedStatus);
    }
  }
});

test("historical-only recent modifications never create a new recent-ticket job", () => {
  const rows = [historical(), historical({ 수강권상태: "만료 (종료)" })];
  assertCounts(rows, 0);
  const first = plan(rows, { minute: 0 });
  const next = plan(rows, { previous: first.state });
  for (const result of [first, next]) {
    assertDiscovery(result);
    assert.deepEqual(result.jobs, []);
    assert.deepEqual(result.state.held, {});
    assert.equal(result.state.totalRows, 2);
    assert.equal(result.state.rowCounts[MEMBER_KEY], 2);
  }
  assert.equal(next.counts.ticketChanged, 0);
  assert.equal(next.state.initializedAt, first.state.initializedAt);
});

test("history never enables recent-ticket discovery during initial baseline", () => {
  const result = plan([historical(), row()], { minute: 0 });
  assertDiscovery(result);
  assert.equal(result.reason, "no_send_baseline");
  assert.deepEqual(result.jobs, []);
  assert.deepEqual(result.state.held, {});
});

test("old-held multiplicity still requires review after current duplicates become history", () => {
  const previous = baseline([current("held"), current("held"), historical()]);
  for (const status of ["정지중", "사용중", "이용만료"]) {
    const rows = [row({ 수강권상태: status }), historical(), historical({ 수강권상태: "기간만료" })];
    const result = plan(rows, { previous });
    assertCounts(rows, 1);
    assertDiscovery(result);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].transition, status === "정지중" ? "changed" : "left");
    assert.equal(result.jobs[0].status, "review");
    assert.equal(result.jobs[0].reason, "duplicate_product_readback_review_required");
    assert.equal(result.counts.review, 1);
    assert.equal(result.state.initializedAt, previous.initializedAt);
    assert.equal(result.state.rowCounts[MEMBER_KEY], 3);
  }
});

function fakeDb(entries) {
  const records = new Map(structuredClone(entries));
  const writes = [];
  const allowed = path => path === HOLDING_ROSTER_STATE || path === `${HOLDING_ROSTER_JOBS}/${hash([MEMBER_KEY, PRODUCT])}`;
  return {
    records, writes,
    doc(path) {
      assert.ok(allowed(path), `unexpected document access: ${path}`);
      return { path };
    },
    async runTransaction(callback) {
      const pending = [];
      const result = await callback({
        async get(ref) {
          assert.equal(pending.length, 0, "all transaction reads must precede writes");
          const value = structuredClone(records.get(ref.path));
          return { exists: records.has(ref.path), data: () => value };
        },
        set(ref, value) {
          assert.ok(allowed(ref.path), `unexpected document write: ${ref.path}`);
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

test("fresh observation replaces a legacy historical-duplicate review under the same key without reset", async t => {
  for (const mode of ["held", "recent"]) {
    await t.test(mode, async () => {
      const rows = [historical(), current(mode)];
      const initial = baseline(rows);
      const prior = plan(rows, { previous: initial });
      assertDiscovery(prior);
      assert.equal(prior.jobs.length, 1);
      // Model the persisted review produced before historical rows were filtered.
      const oldJob = { ...prior.jobs[0], status: "review", reason: "duplicate_product_readback_review_required",
        lastCheckedAt: at(3), updatedAt: at(3) };
      const path = `${HOLDING_ROSTER_JOBS}/${oldJob.jobId}`;
      const db = fakeDb([[HOLDING_ROSTER_STATE, prior.state], [path, oldJob]]);
      const observe = minute => observeHoldingRoster({
        db, rows, profiles: [PROFILE], source: source(minute), now: at(5),
      });
      const before = structuredClone([...db.records]);
      for (const minute of [0, 2]) {
        const result = await observe(minute);
        assert.equal(result.reason, "already_observed_or_older_download");
        assert.equal(result.sends, 0);
        assert.deepEqual([...db.records], before);
        assert.deepEqual(db.writes, []);
      }
      const result = await observe(4);
      assert.equal(result.ok, true, result.reason);
      assert.equal(result.readbackJobs, 1);
      assert.equal(result.sends, 0);
      assert.equal(result.counts.review, 0);
      const refreshed = db.records.get(path);
      assert.equal(refreshed.jobId, oldJob.jobId);
      assert.equal(refreshed.status, "pending");
      assert.equal(refreshed.reason, "");
      assert.equal(refreshed.ticketRevision, oldJob.ticketRevision);
      assert.notEqual(refreshed.discoveryVersion, oldJob.discoveryVersion);
      assert.equal(refreshed.lastCheckedAt, oldJob.lastCheckedAt);
      assert.equal(refreshed.requestedAt, at(5));
      assert.equal(refreshed.downloadedAt, at(4));
      assert.equal(refreshed.sourceImportId, source(4).sourceImportId);
      assert.equal(refreshed.baselineOnly, false);
      assert.equal(refreshed.sendAllowed, false);
      assert.equal(refreshed.absenceConfirmed, false);
      const state = db.records.get(HOLDING_ROSTER_STATE);
      assert.equal(state.schemaVersion, 2);
      assert.equal(state.initializedAt, initial.initializedAt);
      assert.deepEqual(state.rowCounts, prior.state.rowCounts);
      assert.deepEqual(state.held, prior.state.held);
      assert.equal(state.totalRows, 2);
      assert.equal(db.records.size, 2);
      assert.deepEqual(db.writes.map(([key]) => key), [path, HOLDING_ROSTER_STATE]);
    });
  }
});
