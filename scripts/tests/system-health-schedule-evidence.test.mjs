import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedMonthlySettlementMonth,
  monthlySettlementIndexPath,
} from "../lib/system-health-schedule-evidence.mjs";

test("uses the completed previous month after the monthly run window", () => {
  assert.equal(expectedMonthlySettlementMonth(new Date("2026-08-28T00:00:00Z")), "202607");
});

test("keeps the prior completed month before the first-day run grace ends", () => {
  assert.equal(expectedMonthlySettlementMonth(new Date("2026-09-01T00:40:00Z")), "202607");
  assert.equal(expectedMonthlySettlementMonth(new Date("2026-09-01T02:00:00Z")), "202608");
});

test("handles year boundaries and builds the expected result path", () => {
  assert.equal(expectedMonthlySettlementMonth(new Date("2027-01-02T00:00:00Z")), "202612");
  assert.equal(
    monthlySettlementIndexPath("/Users/test", new Date("2026-08-28T00:00:00Z")),
    "/Users/test/Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브필라테스/아카이브필라테스/03_재무_대출_정산/아카이브 월말정산/202607/아카이브 정산명세서 202607_INDEX.html",
  );
});
