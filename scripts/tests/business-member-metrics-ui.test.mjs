import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../core/assets/app.js", import.meta.url), "utf8");
const functions = new Map([...source.matchAll(/^function (\w+)\([^]*?^\}/gm)].map((match) => [match[1], match[0]]));
const names = [
  "qs", "setText", "timestampMs", "formatDate", "normMonth", "formatMonth", "toNumber",
  "formatCount", "formatManwon", "formatRate", "deltaText", "memberCountDeltaText", "escapeHtml",
  "normalizeBusinessSnapshot", "latestDailyForMonth", "renderBusinessBars", "renderBusinessRanks",
  "renderBusinessMonth", "renderBusiness",
];
for (const name of names) assert.ok(functions.has(name), `${name} must remain available`);

// Run only presentation helpers, with synthetic DOM/data and no browser or Firebase startup.
function app(data) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: "", innerHTML: "", className: "", value: "" });
    return elements.get(id);
  };
  const context = { state: {}, document: { getElementById: element } };
  vm.runInNewContext(`${names.map((name) => functions.get(name)).join("\n")}\n
    globalThis.api = { normalizeBusinessSnapshot, renderBusiness, renderBusinessMonth };`, context);
  const snapshot = context.api.normalizeBusinessSnapshot(data);
  context.api.renderBusiness(snapshot);
  return { ...context.api, snapshot, element, text: (id) => element(id).textContent };
}

const memberFields = ["수강권보유회원수", "예약이용회원수", "출석회원수"];
const memberKeys = ["ticketMembers", "bookingMembers", "attendedMembers"];
const memberIds = ["businessTicketMembers", "businessBookingMembers", "businessAttendedMembers"];
const memberRow = (month, count = 12) => ({ 월: month, ...Object.fromEntries(memberFields.map((field) => [field, count])) });
const summaryRow = (month) => ({ 월: month, 총매출: 2000000, 수업매출: 1000000, 마진률: 42, 출석률: 88 });
const fixture = (rows = []) => ({
  summary: [summaryRow("2025-10"), summaryRow("2026-09"), summaryRow("2026-10")],
  월별회원지표: rows,
  updatedAt: "2026-10-08T00:00:00Z",
});

test("normalization preserves nullable/absent/blank counts and valid historical numbers", () => {
  for (const missing of [null, undefined, "", " ", "invalid", -1, 1.5]) {
    const a = app(fixture([{ 월: "2026-10", ...Object.fromEntries(memberFields.map((field) => [field, missing])) }]));
    for (const key of memberKeys) assert.equal(a.snapshot.memberMetrics[0][key], null);
  }
  const absent = app(fixture([{ 월: "2026-10" }]));
  for (const key of memberKeys) assert.equal(absent.snapshot.memberMetrics[0][key], null);
  const a = app(fixture([memberRow("2026-10", "1,234"), memberRow("2025-10", 0)]));
  assert.deepEqual(Array.from(a.snapshot.memberMetrics, (row) => row.month), ["2025-10", "2026-10"]);
  for (const key of memberKeys) {
    assert.equal(a.snapshot.memberMetrics[0][key], 0);
    assert.equal(a.snapshot.memberMetrics[1][key], 1234);
  }
});

test("each missing metric independently warns without discarding the available counts", () => {
  for (const [index, field] of memberFields.entries()) {
    const a = app(fixture([{ ...memberRow("2026-10"), [field]: null }]));
    for (const [cardIndex, id] of memberIds.entries()) {
      assert.equal(a.text(id), cardIndex === index ? "집계 필요" : "12명");
    }
    assert.equal(a.text("businessSnapshotStatus"), "회원 집계 필요");
    assert.equal(a.element("businessSnapshotStatus").className, "pill warn");
    assert.match(a.text(`${memberIds[index]}Note`), /집계 필요/);
  }
});

test("missing row for selected summary month does not reuse the latest available member row", () => {
  for (const rows of [[], [memberRow("2026-09", 99)]]) {
    const a = app(fixture(rows));
    assert.equal(a.element("businessMonthSelect").value, "2026-10");
    for (const id of memberIds) assert.equal(a.text(id), "집계 필요");
    assert.equal(a.text("businessSnapshotStatus"), "회원 집계 필요");
    assert.match(a.text("businessTicketMembersNote"), /정산 시트/);
    assert.match(a.text("businessBookingMembersNote"), /예약 원천/);
  }
});

test("explicit zero counts remain valid, and switching months refreshes connection status", () => {
  const a = app(fixture([memberRow("2026-09", 0), memberRow("2026-10", null)]));
  a.renderBusinessMonth("2026-09");
  for (const id of memberIds) assert.equal(a.text(id), "0명");
  assert.equal(a.text("businessSnapshotStatus"), "연결됨");
  assert.equal(a.element("businessSnapshotStatus").className, "pill good");
  a.renderBusinessMonth("2026-10");
  assert.equal(a.text("businessSnapshotStatus"), "회원 집계 필요");
  a.renderBusinessMonth("invalid-month");
  for (const id of memberIds) assert.equal(a.text(id), "집계 필요");
});

test("notes retain sheet versus booking provenance and do not compare missing counts as zero", () => {
  const a = app(fixture([memberRow("2025-10", 10), memberRow("2026-10", 12)]));
  assert.match(a.text("businessTicketMembersNote"), /정산 시트 기준.*\+2명/);
  assert.match(a.text("businessBookingMembersNote"), /예약 원천 기준.*\+2명/);
  assert.match(a.text("businessAttendedMembersNote"), /예약 원천 기준.*출석 완료.*\+2명/);
  const b = app(fixture([memberRow("2025-10", null), memberRow("2026-10", 12)]));
  for (const id of memberIds) {
    assert.match(b.text(`${id}Note`), /전년동월 비교 대기/);
    assert.doesNotMatch(b.text(`${id}Note`), /[▲▼]/);
  }
  const c = app(fixture([memberRow("2025-10", 10), memberRow("2026-10", null)]));
  for (const id of memberIds) assert.doesNotMatch(c.text(`${id}Note`), /[▲▼]|-10명/);
});

test("optional aggregation metadata survives normalization without making null counts connected", () => {
  const collectedAt = "2026-10-08T01:00:00Z";
  const a = app({
    ...fixture([{ ...memberRow("2026-10", null), 집계시각: collectedAt, 수강권원천: "정산 시트", 집계상태: "partial" }]),
    memberMetricsUpdatedAt: collectedAt,
  });
  const [row] = a.snapshot.memberMetrics;
  assert.equal(row.collectedAt, collectedAt);
  assert.equal(row.ticketSource, "정산 시트");
  assert.equal(row.aggregationStatus, "partial");
  assert.equal(a.snapshot.memberMetricsUpdatedAt, collectedAt);
  assert.match(a.element("businessSnapshotStatus").title, /회원 지표 집계:/);
  assert.equal(a.text("businessSnapshotStatus"), "회원 집계 필요");
  const b = app(fixture([memberRow("2026-10")]));
  assert.equal(b.snapshot.memberMetricsUpdatedAt, null);
  assert.equal(b.snapshot.memberMetrics[0].collectedAt, null);
  assert.doesNotMatch(b.text("businessUpdatedAt"), /회원 지표/);
});

test("supplied sheet provenance is not relabeled as booking provenance", () => {
  const a = app(fixture([{ ...memberRow("2026-10"), 산출원천: "정산 시트", 수강권원천: "수강권 원천" }]));
  assert.match(a.text("businessTicketMembersNote"), /^정산 시트 기준/);
  assert.match(a.text("businessBookingMembersNote"), /^정산 시트 기준/);
  assert.doesNotMatch(a.text("businessBookingMembersNote"), /예약 원천/);
});

test("member metric gaps do not alter revenue cards, deltas, charts or rankings", () => {
  const data = {
    ...fixture(),
    강사별: [{ 월: "2026-10", 강사: "합성 강사", 총매출: 500000 }],
    수강권TOP5: [{ 월: "2026-10", 라벨: "합성 수강권", 값: 100000 }],
    매출일일누적: [{ 기준월: "2026-10", 기준일: "2026-10-08", 월누적매출: 1500000, 월누적수업매출: 800000, 월누적수업마진률: 40, 월누적그룹출석률: 90, 전월동일일누적: 1000000 }],
  };
  const a = app({ ...data, 월별회원지표: [memberRow("2026-10", 12)] });
  const b = app({ ...data, 월별회원지표: [memberRow("2026-10", null)] });
  for (const id of ["businessHeroValue", "businessHeroNote", "businessTotalRevenue", "businessLessonRevenue", "businessMarginRate", "businessAttendanceRate", "businessTotalDelta", "businessLessonDelta", "businessMarginDelta", "businessAttendanceDelta"]) {
    assert.equal(b.text(id), a.text(id), id);
  }
  assert.equal(b.text("businessTotalRevenue"), "150만");
  assert.match(b.text("businessTotalDelta"), /50\.0%/);
  for (const id of ["businessMonthlyBars", "businessRankList"]) {
    assert.ok(a.element(id).innerHTML.length > 0);
    assert.equal(b.element(id).innerHTML, a.element(id).innerHTML, id);
  }
  assert.match(b.element("businessRankList").innerHTML, /합성 강사/);
});

test("empty summary retains the existing no-data status", () => {
  const a = app({ summary: [], 월별회원지표: [memberRow("2026-10")] });
  assert.equal(a.text("businessSnapshotStatus"), "데이터 없음");
  assert.equal(a.element("businessSnapshotStatus").className, "pill warn");
});
