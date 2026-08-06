import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSplitCompensation,
  readRegularCompensationCarryForward,
} from "../lib/monthly-settlement-compensation.mjs";

test("reads regular pay and gross deduction by header after instructor lesson column was added", () => {
  const ledger = [
    [],
    [],
    ["순번", "성 명", "직 책", "그룹", "프라이빗", "강사레슨", "그룹평균", "수업보수 (그룹)", "수업보수 (프라이빗)", "조정금액", "조정내용", "세전 보수총액"],
    ["", "", "", "", "", "", "", "", "", "", "", "", "공제합계", "소득세", "주민세", "지급액", "실지급 합산", "정규직 실지급"],
  ];
  const row = [5, "정은영", "부원장", 105, 58, 2, 4.44, 3_505_000, 1_860_750, -1_990_630, "정규직급여 (2,156,880)\n강사 레슨 166,250", 3_375_120, 111_378.96, 101_253.6, 10_125.36, 3_263_741.04, 5_314_421.04, 2_050_680];

  assert.deepEqual(readRegularCompensationCarryForward(ledger, row), {
    regularPayout: 2_050_680,
    regularGrossDeduction: 2_156_880,
  });
});

test("keeps support for the older ledger without an instructor lesson column", () => {
  const ledger = [
    [],
    [],
    ["순번", "성 명", "직 책", "그룹", "프라이빗", "그룹평균", "수업보수 (그룹)", "수업보수 (프라이빗)", "조정금액", "조정내용", "세전 보수총액"],
    ["", "", "", "", "", "", "", "", "", "", "", "공제합계", "소득세", "주민세", "지급액", "실지급 합산", "정규직 실지급"],
  ];
  const row = [5, "정은영", "부원장", 109, 53, 4.47, 3_640_000, 1_872_000, -2_028_016, "정규직급여 (2,156,880)\n강사 레슨 128,864", 3_483_984, 114_971.472, 104_519.52, 10_451.952, 3_369_012.528, 5_419_692.528, 2_050_680];

  assert.deepEqual(readRegularCompensationCarryForward(ledger, row), {
    regularPayout: 2_050_680,
    regularGrossDeduction: 2_156_880,
  });
});

test("splits July regular and freelancer pay without counting regular pay twice", () => {
  const result = calculateSplitCompensation({
    groupPay: 3_688_000,
    privatePay: 1_483_000,
    lessonPay: 232_500,
    regularPayout: 2_050_680,
    regularGrossDeduction: 2_156_880,
  });

  assert.equal(result.pretaxPay, 3_246_620);
  assert.equal(result.freelancerPayout, 3_139_481.54);
  assert.equal(result.regularPayout, 2_050_680);
  assert.equal(result.finalPayout, 5_190_161.54);
});

test("stops instead of double counting when regular net pay exists without the gross deduction", () => {
  assert.throws(
    () => calculateSplitCompensation({
      groupPay: 3_688_000,
      privatePay: 1_483_000,
      lessonPay: 232_500,
      regularPayout: 2_050_680,
      regularGrossDeduction: 0,
    }),
    /정규직 급여 기준액이 없습니다/,
  );
});
