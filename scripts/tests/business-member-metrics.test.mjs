import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { collectMetricRows, freshMetricRows, mergeMetricRows, metricMonths, ticketMemberCounts } from "../lib/business-member-metrics.mjs";
import { patchMemberMetrics } from "../sync-archive-business-member-metrics.mjs";
import { summarizeBookingMemberMetric } from "../sync-archive-dashboard-db-export.mjs";

const complete = (month) => ({ 월: month, 수강권보유회원수: 10, 예약이용회원수: 12, 출석회원수: 11 });

test("refreshes missing and recent months only, excluding future projections", () => {
  const snapshot = {
    summary: ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"].map((월) => ({ 월 })),
    월별회원지표: [complete("2026-07"), complete("2026-09")],
  };
  assert.deepEqual(metricMonths(snapshot, "2026-10"), ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(metricMonths(snapshot, "2026-10", ["2026-08", "2026-08"]), ["2026-08"]);
  assert.throws(() => metricMonths(snapshot, "2026-10", ["2026-11"]), /future/);
  assert.throws(() => metricMonths(snapshot, "2026-10", ["2026-13"]), /Invalid/);
});

test("null and missing metrics are incomplete; genuine zero is complete", () => {
  const snapshot = { summary: [{ 월: "2026-07" }], 월별회원지표: [{ ...complete("2026-07"), 수강권보유회원수: null }] };
  assert.deepEqual(metricMonths(snapshot, "2026-10"), ["2026-07", "2026-09", "2026-10"]);
  snapshot.월별회원지표[0].수강권보유회원수 = 0;
  assert.deepEqual(metricMonths(snapshot, "2026-10"), ["2026-09", "2026-10"]);
});

test("recent member months are independent of missing revenue months", () => {
  assert.deepEqual(metricMonths({ summary: [], 월별회원지표: [] }, "2026-10"), ["2026-09", "2026-10"]);
});

test("validates sheet count against distinct phones and does not turn missing into zero", () => {
  const header = ["기준월", "회원수", "회원목록"];
  const valid = [header, ["2026-08", 1, "테스트(010-0000-0001)"], ["2026-09", 0, ""]];
  assert.deepEqual([...ticketMemberCounts(valid, ["2026-08", "2026-09"])], [["2026-08", 1], ["2026-09", 0]]);
  assert.throws(() => ticketMemberCounts(valid, ["2026-10"]), /missing/);
  assert.throws(() => ticketMemberCounts([header, ["2026-08", "", ""]], ["2026-08"]), /mismatch/);
  assert.throws(() => ticketMemberCounts([header, ["2026-08", 2, "A(01000000001), B(01000000001)"]], ["2026-08"]), /mismatch/);
  assert.throws(() => ticketMemberCounts([header, ["2026-08", 0, ""], ["2026-08", 0, ""]], ["2026-08"]), /Duplicate/);
  assert.throws(() => ticketMemberCounts([["기준월", "회원수"]], []), /columns/);
});

test("keeps booking exclusions and distinct-member counts separate from reservation rows", () => {
  const booking = { id: "real1", memberId: "member1", memberPhone: "01000000001", lectureDate: "2026-08-01", startTime: "10:00", title: "그룹", appStatus: "reserved", attendanceStatus: "attended" };
  const rows = [booking, { ...booking, id: "excel_booking_copy" }, { ...booking, id: "real2", lectureDate: "2026-08-02", attendanceStatus: "absent" }, { ...booking, id: "cancel", memberId: "other", memberPhone: "01000000002", appStatus: "cancelled" }, { ...booking, id: "instructor", title: "강사레슨", memberId: "staff", memberPhone: "01000000003" }];
  const result = summarizeBookingMemberMetric("2026-08", rows, 2);
  assert.equal(result.예약이용회원수, 1);
  assert.equal(result.출석회원수, 1);
  assert.equal(result.수강권보유회원수, 2);
  assert.equal(result.중복정리행수, 1);
  assert.equal(result.취소제외행수, 1);
  assert.equal(result.강사레슨제외행수, 1);
  assert.equal(summarizeBookingMemberMetric("2026-08", [], null).수강권보유회원수, null);
});

test("empty booking source stops before a replacement; all-cancelled valid source yields real zero", async () => {
  const input = { months: ["2026-08"], counts: new Map([["2026-08", 1]]), summarize: summarizeBookingMemberMetric, now: "2026-10-08T00:00:00Z", source: "fixture" };
  await assert.rejects(collectMetricRows({ ...input, fetchBookings: async () => [] }), /empty/);
  const rows = await collectMetricRows({ ...input, fetchBookings: async () => [{ id: "cancel", appStatus: "cancelled" }] });
  assert.equal(rows[0].예약이용회원수, 0);
  assert.equal(rows[0].출석회원수, 0);
  assert.equal(rows[0].집계상태, "complete");
});

test("replaces exactly one row per target month and preserves historical values", () => {
  const july = complete("2026-07");
  const august = { ...complete("2026-08"), 출석회원수: 20 };
  assert.deepEqual(mergeMetricRows([july, complete("2026-08")], [august, august]), [july, august]);
});

test("guarded patch retries conflicts, preserves other months, and only writes metric fields", async () => {
  const july = complete("2026-07");
  const august = complete("2026-08");
  const row = complete("2026-09");
  let attempts = 0;
  const calls = [];
  const read = async () => ({ updateTime: `version${attempts}`, data: { summary: [{ 월: "2026-10", 총매출: 99 }], 월별회원지표: attempts === 0 ? [july] : attempts === 1 ? [july, august] : [july, august, row] } });
  const result = await patchMemberMetrics({ token: "fixture", rows: [row], now: "now", source: "source", read, request: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); attempts += 1; return attempts === 1 ? { status: 409, ok: false } : { status: 200, ok: true }; } });
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
  assert.match(calls[1].url, /currentDocument.updateTime=version1/);
  assert.match(new URL(calls[1].url).searchParams.get("updateMask.fieldPaths"), /^`월별회원지표`$/);
  assert.deepEqual(Object.keys(calls[1].body.fields).sort(), ["memberMetricsSource", "memberMetricsUpdatedAt", "월별회원지표"].sort());
  assert.equal(calls[1].body.fields.월별회원지표.arrayValue.values.length, 3);
});

test("Firestore FAILED_PRECONDITION HTTP 400 retries with the new document version", async () => {
  const row = complete("2026-08");
  let attempt = 0;
  await patchMemberMetrics({ token: "fixture", rows: [row], now: "now", source: "source", read: async () => ({ updateTime: `v${attempt}`, data: { 월별회원지표: attempt < 2 ? [] : [row] } }), request: async () => {
    attempt += 1;
    return attempt === 1 ? { status: 400, ok: false, json: async () => ({ error: { status: "FAILED_PRECONDITION" } }) } : { status: 200, ok: true };
  } });
  assert.equal(attempt, 2);
});

test("older overlapping collection does not overwrite newer results or timestamps", async () => {
  const older = { ...complete("2026-08"), 집계시각: "2026-10-08T00:00:00Z" };
  const newer = { ...complete("2026-08"), 집계시각: "2026-10-08T01:00:00Z" };
  assert.deepEqual(freshMetricRows([newer], [older]), []);
  const result = await patchMemberMetrics({ token: "fixture", rows: [older], now: older.집계시각, source: "source", read: async () => ({ updateTime: "v", data: { 월별회원지표: [newer] } }), request: async () => { throw new Error("Must not write stale rows"); } });
  assert.equal(result.status, "superseded");
  assert.deepEqual(result.skippedMonths, ["2026-08"]);
});

test("readback mismatch is not reported as success", async () => {
  await assert.rejects(patchMemberMetrics({ token: "fixture", rows: [complete("2026-08")], now: "now", source: "source", read: async () => ({ updateTime: "v", data: { 월별회원지표: [] } }), request: async () => ({ status: 200, ok: true }) }), /readback mismatch/);
});

function runDaily({ directOk = true, memberOk = true, downloadOk = true } = {}) {
  const source = readFileSync(new URL("../run-archive-dashboard-sales-daily.mjs", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
  const calls = [];
  const context = vm.createContext({
    process: { argv: ["node", "runner", "--apply", "--sync-firebase"], execPath: "node", cwd: () => "/fixture", env: {}, exitCode: 0 },
    os: { homedir: () => "/fixture" }, path: { join: (...parts) => parts.join("/") }, mkdirSync() {}, writeFileSync() {}, console: { log() {} },
    spawnSync: (_node, command) => { calls.push(command[0]); const ok = command[0].includes("business-member") ? memberOk : command[0].includes("-db.mjs") ? directOk : command[0].includes("download-") ? downloadOk : true; return { status: ok ? 0 : 1, stdout: JSON.stringify({ ok }), stderr: "" }; },
  });
  vm.runInContext(source, context);
  return { calls, exitCode: context.process.exitCode, summary: vm.runInContext("JSON.stringify(summary)", context) };
}

test("primary revenue success still runs member metrics and skips expensive EXPORT", () => {
  const result = runDaily();
  assert.ok(result.calls.includes("scripts/sync-archive-business-member-metrics.mjs"));
  assert.ok(!result.calls.includes("scripts/sync-archive-dashboard-db-export.mjs"));
  assert.equal(result.exitCode, 0);
});

test("member metrics run after revenue fallback or download failure and failure affects overall status", () => {
  assert.ok(runDaily({ directOk: false }).calls.includes("scripts/sync-archive-business-member-metrics.mjs"));
  assert.ok(runDaily({ downloadOk: false }).calls.includes("scripts/sync-archive-business-member-metrics.mjs"));
  const result = runDaily({ memberOk: false });
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(result.summary).memberMetricsSucceeded, false);
});
