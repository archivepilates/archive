import assert from "node:assert/strict";
import test from "node:test";
import { dedupeSettlementSourceRows } from "../lib/monthly-settlement-source.mjs";

const baseRow = {
  originalType: "그룹",
  finalType: "그룹",
  classDate: "2026-08-03",
  classTime: "19:00",
  endTime: "19:50",
  weekday: "월",
  memberName: "회원A",
  ticketName: "50회권",
  revenue: 17_900,
  instructorName: "강사A",
  attendance: "출석",
};

test("removes only exact duplicate settlement source rows", () => {
  const changedTicket = { ...baseRow, ticketName: "다른 수강권" };
  const result = dedupeSettlementSourceRows([baseRow, { ...baseRow }, changedTicket]);

  assert.equal(result.rows.length, 2);
  assert.equal(result.removedCount, 1);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].sourceCount, 2);
  assert.equal(result.duplicates[0].removedCount, 1);
  assert.deepEqual(result.rows[1], changedTicket);
});

test("counts every excluded copy when one source row repeats", () => {
  const result = dedupeSettlementSourceRows([baseRow, { ...baseRow }, { ...baseRow }]);

  assert.equal(result.rows.length, 1);
  assert.equal(result.removedCount, 2);
  assert.equal(result.duplicates[0].sourceCount, 3);
});
