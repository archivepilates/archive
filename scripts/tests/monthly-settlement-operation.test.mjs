import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCurrentSettlementOperation } from "../lib/monthly-settlement-operation.mjs";

test("reads totals from current settlement sheets without relying on legacy fixed columns", () => {
  const result = summarizeCurrentSettlementOperation({
    auxRows: [
      ["최종수업구분", "정산매출"],
      ["그룹", 100_000],
      ["그룹", 120_000],
      ["프라이빗", 80_000],
      ["강사레슨", 60_000],
    ],
    payrollRows: [
      ["성명", "그룹횟수", "프라이빗횟수", "그룹보수합계", "프라이빗보수합계"],
      ["강사A", 2, 1, 70_000, 40_000],
      ["강사B", 1, 2, 30_000, 55_000],
    ],
    reportRows: [
      ["전체 그룹 세션 수", "그룹 예약평균", "그룹 출석평균"],
      [3, 4.5, 4.1],
    ],
  });

  assert.deepEqual(result, {
    groupAttendanceAverage: 4.1,
    groupReservationAverage: 4.5,
    groupRevenue: 220_000,
    groupPay: 100_000,
    privateCount: 3,
    privateRevenue: 80_000,
    privatePay: 95_000,
  });
});

test("returns null when current settlement sheets are absent", () => {
  assert.equal(summarizeCurrentSettlementOperation({ auxRows: [], payrollRows: [], reportRows: [] }), null);
});
