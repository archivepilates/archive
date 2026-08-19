import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRefundRequestWindow,
  calculateRefund,
  deriveRefundPeriodUsage,
  inferRefundTicketKind,
  REFUND_POLICY_VERSION,
} from "../../firebase/kangsain-functions/functions/src/refund/refundPolicy";

test("수강권 유형은 원천 횟수 필드로만 판정한다", () => {
  assert.equal(inferRefundTicketKind(10, null), "count");
  assert.equal(inferRefundTicketKind(0, 20), "count");
  assert.equal(inferRefundTicketKind(null, 20), "count");
  assert.equal(inferRefundTicketKind(null, null), "period");
});

test("기간권 잔여기간은 StudioMate 날짜를 한국 날짜 기준으로 포함 계산한다", () => {
  const usage = deriveRefundPeriodUsage({
    availableFrom: "2026-08-01T00:00:00+09:00",
    expiresAt: "2026-08-31T23:59:59+09:00",
    requestedAt: "2026-08-10T00:00:00+09:00",
  });
  assert.deepEqual(usage, { totalDays: 31, usedDays: 9, remainingDays: 22 });
  assert.deepEqual(
    deriveRefundPeriodUsage({
      availableFrom: "2026-08-01T00:00:00+09:00",
      expiresAt: "2026-08-31T23:59:59+09:00",
      requestedAt: "2026-07-20T00:00:00+09:00",
    }),
    { totalDays: 31, usedDays: 0, remainingDays: 31 },
  );
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
    usedCount: 0,
    normalUnitAmount: 70000,
    manualReason: "정상가표와 이용내역 확인",
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
    usedCount: 5,
    normalUnitAmount: 30000,
    manualReason: "정상가표와 이용내역 확인",
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

test("StudioMate 횟수권은 원천과 다른 사용횟수 덮어쓰기를 차단한다", () => {
  assert.throws(
    () => calculateRefund({
      memberName: "테스트회원",
      ticketName: "그룹 20회",
      ticketKind: "count",
      paidAmount: 400000,
      totalCount: 20,
      remainingCount: 15,
      usedCount: 6,
      normalUnitAmount: 30000,
      usageSource: "studiomate_active_ticket",
    }),
    /원천과 다른 사용 횟수/,
  );
});

test("원천과 다른 횟수를 입력하면 확인 근거를 요구한다", () => {
  assert.throws(
    () => calculateRefund({
      memberName: "테스트회원",
      ticketName: "그룹 20회",
      ticketKind: "count",
      paidAmount: 400000,
      totalCount: 20,
      remainingCount: 15,
      usedCount: 6,
      normalUnitAmount: 30000,
    }),
    /근거/,
  );
  const result = calculateRefund({
    memberName: "테스트회원",
    ticketName: "그룹 20회",
    ticketKind: "count",
    paidAmount: 400000,
    totalCount: 20,
    remainingCount: 15,
    usedCount: 6,
    normalUnitAmount: 30000,
    manualReason: "노쇼 1회를 사용으로 포함함",
  });
  assert.equal(result.requiresReview, true);
});

test("기간권은 홀딩 제외 실제 사용 주수 비율로 사용분을 계산한다", () => {
  const result = calculateRefund({
    memberName: "테스트회원",
    ticketName: "주2회 12주",
    ticketKind: "period",
    paidAmount: 360000,
    totalCount: null,
    remainingCount: null,
    totalContractWeeks: 12,
    usedWeeks: 3,
    manualReason: "StudioMate 이용기간과 홀딩 이력을 확인함",
  });
  assert.equal(result.calculationMode, "period_ticket");
  assert.equal(result.usedAmount, 90000);
  assert.equal(result.penaltyAmount, 36000);
  assert.equal(result.refundAmount, 234000);
});

test("StudioMate 기간권은 총기간과 잔여기간으로 사용분을 자동 계산한다", () => {
  const result = calculateRefund({
    memberName: "테스트회원",
    ticketName: "주2회 12주",
    ticketKind: "period",
    paidAmount: 360000,
    totalCount: null,
    remainingCount: null,
    totalContractDays: 84,
    usedDays: 21,
    remainingDays: 63,
    usageSource: "studiomate_active_ticket",
  });
  assert.equal(result.totalContractDays, 84);
  assert.equal(result.usedDays, 21);
  assert.equal(result.remainingDays, 63);
  assert.equal(result.usedAmount, 90000);
  assert.equal(result.refundAmount, 234000);
  assert.match(result.message, /StudioMate 잔여기간 기준/);
});

test("StudioMate 기간권은 총기간과 사용·잔여기간이 맞지 않으면 중단한다", () => {
  assert.throws(
    () => calculateRefund({
      memberName: "테스트회원",
      ticketName: "주2회 12주",
      ticketKind: "period",
      paidAmount: 360000,
      totalCount: null,
      remainingCount: null,
      totalContractDays: 84,
      usedDays: 21,
      remainingDays: 64,
      usageSource: "studiomate_active_ticket",
    }),
    /일치하지 않습니다/,
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
    usedCount: 5,
    normalUnitAmount: 30000,
    giftDeductionAmount: 50000,
    manualReason: "정상가표와 이용내역 확인",
  });
  assert.equal(result.giftDeductionAmount, 50000);
  assert.equal(result.totalDeductionAmount, 240000);
  assert.equal(result.refundAmount, 160000);
  assert.match(result.message, /증정·프로모션 혜택 공제/);
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
    usedWeeks: 4,
    giftDeductionAmount: 10000,
    manualReason: "전체 기간 사용 및 혜택 확인",
  });
  assert.equal(result.refundAmount, 0);
  assert.equal(result.requiresReview, true);
});
