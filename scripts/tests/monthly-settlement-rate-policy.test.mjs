import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSettlementRateCoverage,
  requireGroupRates,
  requirePrivateRate,
} from "../lib/monthly-settlement-rate-policy.mjs";

const refs = {
  groupMap: { 정은영: [15_000, 25_000, 25_000, 30_000] },
  privateMap: { 정은영: 0.55 },
};

test("accepts instructors covered for every settlement type they teach", () => {
  assert.doesNotThrow(() => assertSettlementRateCoverage([
    { instructorName: "정은영", finalType: "그룹" },
    { instructorName: "정은영", finalType: "프라이빗" },
    { instructorName: "정은영", finalType: "강사레슨" },
  ], refs));
});

test("reports every missing instructor and required rate tab without fallback", () => {
  assert.throws(
    () => assertSettlementRateCoverage([
      { instructorName: "신규강사", finalType: "그룹" },
      { instructorName: "신규강사", finalType: "프라이빗" },
    ], refs),
    (error) => {
      assert.equal(error.code, "MISSING_SETTLEMENT_RATE");
      assert.match(error.message, /신규강사\(그룹 탭\)/);
      assert.match(error.message, /신규강사\(프라이빗 탭\)/);
      return true;
    },
  );
});

test("rate accessors fail instead of applying guessed defaults", () => {
  assert.deepEqual(requireGroupRates(refs.groupMap, "정은영"), refs.groupMap.정은영);
  assert.equal(requirePrivateRate(refs.privateMap, "정은영"), 0.55);
  assert.throws(() => requireGroupRates(refs.groupMap, "신규강사"), /보수기준표 누락/);
  assert.throws(() => requirePrivateRate(refs.privateMap, "신규강사"), /보수기준표 누락/);
});
