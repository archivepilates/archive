import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRefundRequestWindow,
  calculateRefund,
  deriveRefundPeriodUsage,
  inferRefundContractDays,
  inferRefundTicketKind,
  REFUND_POLICY_VERSION,
} from "../../firebase/kangsain-functions/functions/src/refund/refundPolicy";

test("수강권 유형은 원천 횟수 필드로만 판정한다", () => {
  assert.equal(inferRefundTicketKind(10, null), "count");
  assert.equal(inferRefundTicketKind(0, 20), "count");
  assert.equal(inferRefundTicketKind(null, 20), "count");
  assert.equal(inferRefundTicketKind(null, null), "period");
});

test("기간권 잔여기간은 StudioMate 화면과 같은 날짜 차이로 계산한다", () => {
  const usage = deriveRefundPeriodUsage({
    availableFrom: "2026-08-01T00:00:00+09:00",
    expiresAt: "2026-08-31T23:59:59+09:00",
    requestedAt: "2026-08-10T00:00:00+09:00",
  });
  assert.deepEqual(usage, { totalDays: 31, usedDays: 10, remainingDays: 21, excludedDays: 0 });
  assert.deepEqual(
    deriveRefundPeriodUsage({
      availableFrom: "2026-08-01T00:00:00+09:00",
      expiresAt: "2026-08-31T23:59:59+09:00",
      requestedAt: "2026-07-20T00:00:00+09:00",
    }),
    { totalDays: 31, usedDays: 0, remainingDays: 31, excludedDays: 0 },
  );
});

test("기간권 수강권명에서 계약 일수를 읽어 StudioMate 잔여일수를 산출한다", () => {
  assert.equal(inferRefundContractDays("10주(주2회)"), 70);
  assert.equal(inferRefundContractDays("그룹 20회"), null);
  const usage = deriveRefundPeriodUsage({
    availableFrom: "2026-06-29T00:00:00+09:00",
    expiresAt: "2026-09-20T23:59:59+09:00",
    requestedAt: "2026-08-20T00:00:00+09:00",
    contractDays: 70,
  });
  assert.deepEqual(usage, { totalDays: 70, usedDays: 39, remainingDays: 31, excludedDays: 14 });
});

test("만료된 수강권과 미래 요청일은 차단한다", () => {
  const now = new Date("2026-08-20T12:00:00+09:00");
  assert.throws(
    () => assertRefundRequestWindow({
      requestedAt: "2026-08-19T00:00:00+09:00",
      expiresAt: "2026-08-20T08:00:00+09:00",
      now,
    }),
    /유효기간/,
  );
  assert.throws(
    () => assertRefundRequestWindow({
      requestedAt: "2026-08-21T00:00:00+09:00",
      expiresAt: "2026-09-20T00:00:00+09:00",
      now,
    }),
    /미래일/,
  );
  assert.throws(
    () => assertRefundRequestWindow({ requestedAt: "2026-08-20T00:00:00+09:00", expiresAt: null, now }),
    /유효기간 원천/,
  );
});

test("미사용 횟수권도 결제금액의 10퍼센트 위약금을 공제한다", () => {
  const result = calculateRefund({
    memberName: "테스트회원",
    ticketName: "프라이빗 10회",
    ticketKind: "count",
    paidAmount: 600000,
    totalCount: 10,
    remainingCount: 10,
    normalUnitAmount: 70000,
    usageSource: "studiomate_active_ticket",
  });
  assert.equal(result.policyVersion, REFUND_POLICY_VERSION);
  assert.equal(result.calculationMode, "count_ticket");
  assert.equal(result.penaltyAmount, 60000);
  assert.equal(result.usedAmount, 0);
  assert.equal(result.refundAmount, 540000);
});

test("횟수권은 결제 회당가가 아니라 정상 1회 단가로 사용분을 계산한다", () => {
  const result = calculateRefund({
    memberName: "테스트회원",
    ticketName: "그룹 20회",
    ticketKind: "count",
    paidAmount: 400000,
    totalCount: 20,
    remainingCount: 15,
    normalUnitAmount: 30000,
    usageSource: "studiomate_active_ticket",
  });
  assert.equal(result.usedCount, 5);
  assert.equal(result.unitAmount, 30000);
  assert.equal(result.usedAmount, 150000);
  assert.equal(result.penaltyAmount, 40000);
  assert.equal(result.refundAmount, 210000);
});

test("StudioMate 횟수권은 잔여횟수로 사용횟수를 자동 확정한다", () => {
  const result = calculateRefund({
    memberName: "테스트회원",
    ticketName: "그룹 20회",
    ticketKind: "count",
    paidAmount: 400000,
    totalCount: 20,
    remainingCount: 15,
    normalUnitAmount: 30000,
    usageSource: "studiomate_active_ticket",
  });
  assert.equal(result.usedCount, 5);
  assert.equal(result.usedAmount, 150000);
  assert.equal(result.refundAmount, 210000);
  assert.match(result.reviewReasons.join(" "), /정상 단가/);
});

test("StudioMate 횟수권은 잔여횟수가 총횟수를 넘으면 중단한다", () => {
  assert.throws(
    () => calculateRefund({
      memberName: "테스트회원",
      ticketName: "그룹 20회",
      ticketKind: "count",
      paidAmount: 400000,
      totalCount: 20,
      remainingCount: 21,
      normalUnitAmount: 30000,
      usageSource: "studiomate_active_ticket",
    }),
    /사용 횟수/,
  );
});

test("횟수권은 StudioMate 횟수 원천만 허용한다", () => {
  assert.throws(
    () => calculateRefund({
      memberName: "테스트회원",
      ticketName: "그룹 20회",
      ticketKind: "count",
      paidAmount: 400000,
      totalCount: 20,
      remainingCount: 15,
      normalUnitAmount: 30000,
      usageSource: "studiomate_period_weeks",
    }),
    /횟수 원천/,
  );
});

test("기간권은 StudioMate 잔여 주수로 사용분을 자동 계산한다", () => {
  const result = calculateRefund({
    memberName: "테스트회원",
    ticketName: "주2회 12주",
    ticketKind: "period",
    paidAmount: 360000,
    totalCount: null,
    remainingCount: null,
    totalContractWeeks: 12,
    remainingWeeks: 9,
    usageSource: "studiomate_period_weeks",
  });
  assert.equal(result.calculationMode, "period_ticket");
  assert.equal(result.usedAmount, 90000);
  assert.equal(result.penaltyAmount, 36000);
  assert.equal(result.refundAmount, 234000);
});

test("StudioMate 기간권 결과에는 자동 환산된 사용·잔여 주수가 기록된다", () => {
  const result = calculateRefund({
    memberName: "테스트회원",
    ticketName: "주2회 12주",
    ticketKind: "period",
    paidAmount: 360000,
    totalCount: null,
    remainingCount: null,
    totalContractWeeks: 12,
    remainingWeeks: 9,
    usageSource: "studiomate_period_weeks",
  });
  assert.equal(result.totalContractWeeks, 12);
  assert.equal(result.usedWeeks, 3);
  assert.equal(result.remainingWeeks, 9);
  assert.equal(result.usedAmount, 90000);
  assert.equal(result.refundAmount, 234000);
  assert.match(result.message, /잔여기간: 9주 \/ 12주/);
});

test("10주 기간권의 잔여 4주 환불 안내는 119,400원으로 계산한다", () => {
  const result = calculateRefund({
    memberName: "테스트회원",
    ticketName: "10주(주2회)",
    ticketKind: "period",
    paidAmount: 398000,
    totalCount: null,
    remainingCount: null,
    totalContractWeeks: 10,
    remainingWeeks: 4,
    usageSource: "studiomate_period_weeks",
  });
  assert.equal(result.remainingWeeks, 4);
  assert.equal(result.remainingBalanceAmount, 159200);
  assert.equal(result.penaltyAmount, 39800);
  assert.equal(result.usedAmount, 238800);
  assert.equal(result.refundAmount, 119400);
  assert.equal(result.formula, "잔여금액 159,200원 - 위약금 39,800원");
  assert.match(result.message, /잔여기간: 4주 \/ 10주/);
  assert.match(result.message, /잔여금액: 159,200원/);
  assert.match(result.message, /예상 환불금액: 119,400원/);
  assert.match(result.message, /잔여금액 159,200원 - 위약금 39,800원 = 119,400원/);
});

test("StudioMate 기간권은 잔여 주수가 총 주수를 넘으면 중단한다", () => {
  assert.throws(
    () => calculateRefund({
      memberName: "테스트회원",
      ticketName: "주2회 12주",
      ticketKind: "period",
      paidAmount: 360000,
      totalCount: null,
      remainingCount: null,
      totalContractWeeks: 12,
      remainingWeeks: 13,
      usageSource: "studiomate_period_weeks",
    }),
    /초과할 수 없습니다/,
  );
});

test("증정과 프로모션 혜택 공제액을 별도로 반영한다", () => {
  const result = calculateRefund({
    memberName: "테스트회원",
    ticketName: "그룹 20회",
    ticketKind: "count",
    paidAmount: 400000,
    totalCount: 20,
    remainingCount: 15,
    normalUnitAmount: 30000,
    giftDeductionAmount: 50000,
    usageSource: "studiomate_active_ticket",
  });
  assert.equal(result.giftDeductionAmount, 50000);
  assert.equal(result.totalDeductionAmount, 240000);
  assert.equal(result.refundAmount, 160000);
  assert.match(result.message, /증정·프로모션 추가 공제/);
});

test("공제액이 결제액을 넘으면 환불액을 0원으로 제한한다", () => {
  const result = calculateRefund({
    memberName: "테스트회원",
    ticketName: "기간권",
    ticketKind: "period",
    paidAmount: 100000,
    totalCount: null,
    remainingCount: null,
    totalContractWeeks: 4,
    remainingWeeks: 0,
    giftDeductionAmount: 10000,
    usageSource: "studiomate_period_weeks",
  });
  assert.equal(result.refundAmount, 0);
  assert.equal(result.requiresReview, true);
});
