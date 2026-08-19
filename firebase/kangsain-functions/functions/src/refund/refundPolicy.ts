import { createHash } from "node:crypto";

export const REFUND_POLICY_VERSION = "archive-refund-notion-2026-08-19-v1";
export const REFUND_PENALTY_RATE = 0.1;

export type RefundTicketKind = "count" | "period";

export function inferRefundTicketKind(totalCount: unknown, usableCount: unknown): RefundTicketKind {
  const counts = [totalCount, usableCount].map(Number);
  return counts.some((count) => Number.isFinite(count) && count > 0) ? "count" : "period";
}

export function assertRefundRequestWindow(input: {
  requestedAt: string;
  expiresAt?: string | null;
  now?: Date;
}): void {
  const requestedAtMs = new Date(input.requestedAt).getTime();
  const nowMs = (input.now || new Date()).getTime();
  if (!Number.isFinite(requestedAtMs)) throw new Error("환불 요청일을 확인하세요.");
  if (requestedAtMs > nowMs + 5 * 60 * 1000) throw new Error("환불 요청일은 미래일 수 없습니다.");
  if (!input.expiresAt) throw new Error("수강권 유효기간 원천이 없어 환불 가능 여부를 확인할 수 없습니다.");
  const expiresAtMs = new Date(input.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) throw new Error("수강권 유효기간 원천을 확인하세요.");
  if (Number.isFinite(expiresAtMs) && nowMs > expiresAtMs) {
    throw new Error("유효기간이 지난 수강권은 환불할 수 없습니다.");
  }
}

export type RefundCalculationInput = {
  memberName: string;
  ticketName: string;
  ticketKind: RefundTicketKind;
  paidAmount: number;
  totalCount: number | null;
  remainingCount: number | null;
  usedCount?: number | null;
  normalUnitAmount?: number | null;
  totalContractWeeks?: number | null;
  usedWeeks?: number | null;
  giftDeductionAmount?: number | null;
  manualReason?: string;
};

export type RefundCalculation = {
  policyVersion: string;
  calculationMode: "count_ticket" | "period_ticket";
  paidAmount: number;
  penaltyAmount: number;
  usedAmount: number;
  giftDeductionAmount: number;
  totalDeductionAmount: number;
  refundAmount: number;
  usedCount: number | null;
  totalCount: number | null;
  remainingCount: number | null;
  unitAmount: number | null;
  totalContractWeeks: number | null;
  usedWeeks: number | null;
  requiresReview: boolean;
  reviewReasons: string[];
  formula: string;
  message: string;
  calculationHash: string;
};

export function calculateRefund(input: RefundCalculationInput): RefundCalculation {
  const paidAmount = positiveWon(input.paidAmount, "실결제금액");
  const penaltyAmount = roundWon(paidAmount * REFUND_PENALTY_RATE);
  const giftDeductionAmount = optionalWon(input.giftDeductionAmount, "증정·프로모션 공제액");
  const manualReason = String(input.manualReason || "").trim();
  const totalCount = nullableInteger(input.totalCount, "총 횟수");
  const remainingCount = nullableInteger(input.remainingCount, "잔여 횟수");
  const reviewReasons: string[] = [];

  let calculationMode: RefundCalculation["calculationMode"];
  let usedAmount = 0;
  let usedCount: number | null = null;
  let unitAmount: number | null = null;
  let totalContractWeeks: number | null = null;
  let usedWeeks: number | null = null;
  let requiresReview = false;

  if (input.ticketKind === "count") {
    calculationMode = "count_ticket";
    unitAmount = positiveWon(input.normalUnitAmount, "1회 정상 단가");
    if (!manualReason) throw new Error("1회 정상 단가와 사용 횟수의 확인 근거를 작성하세요.");
    const sourceUsedCount =
      totalCount != null && remainingCount != null && remainingCount <= totalCount
        ? totalCount - remainingCount
        : null;
    usedCount = input.usedCount == null ? sourceUsedCount : nullableInteger(input.usedCount, "사용 횟수");
    if (usedCount == null) throw new Error("횟수권 사용 횟수를 확인하세요.");
    if (totalCount != null && usedCount > totalCount) throw new Error("사용 횟수는 총 횟수를 초과할 수 없습니다.");
    if (sourceUsedCount != null && usedCount !== sourceUsedCount) {
      requiresReview = true;
      reviewReasons.push("운영자가 원천과 다른 사용 횟수를 확인했습니다.");
    }
    usedAmount = roundWon(unitAmount * usedCount);
  } else if (input.ticketKind === "period") {
    calculationMode = "period_ticket";
    totalContractWeeks = positiveNumber(input.totalContractWeeks, "총 계약 주수");
    usedWeeks = nonNegativeNumber(input.usedWeeks, "실제 사용 주수");
    if (usedWeeks > totalContractWeeks) throw new Error("실제 사용 주수는 총 계약 주수를 초과할 수 없습니다.");
    if (!manualReason) throw new Error("홀딩을 제외한 실제 사용 주수의 확인 근거를 작성하세요.");
    usedAmount = roundWon(paidAmount * (usedWeeks / totalContractWeeks));
    requiresReview = true;
    reviewReasons.push("기간권 사용 주수와 홀딩 제외 기간을 운영자가 확인했습니다.");
  } else {
    throw new Error("수강권 유형을 확인하세요.");
  }

  if (giftDeductionAmount > 0) {
    requiresReview = true;
    reviewReasons.push("증정·이벤트·프로모션 혜택 공제액이 포함되었습니다.");
  }

  const totalDeductionAmount = roundWon(penaltyAmount + usedAmount + giftDeductionAmount);
  const refundAmount = Math.max(0, roundWon(paidAmount - totalDeductionAmount));
  if (totalDeductionAmount > paidAmount) {
    requiresReview = true;
    reviewReasons.push("공제액이 실결제금액을 초과하여 환불액을 0원으로 제한했습니다.");
  }

  const formula = [
    formatWon(paidAmount),
    `위약금 ${formatWon(penaltyAmount)}`,
    `사용분 ${formatWon(usedAmount)}`,
    giftDeductionAmount > 0 ? `증정·프로모션 ${formatWon(giftDeductionAmount)}` : null,
  ].filter(Boolean).join(" - ");
  const message = buildRefundMessage(input.memberName, input.ticketName, {
    calculationMode,
    paidAmount,
    penaltyAmount,
    usedAmount,
    giftDeductionAmount,
    refundAmount,
    usedCount,
    unitAmount,
    totalContractWeeks,
    usedWeeks,
    formula,
  });
  const calculationHash = stableHash({
    policyVersion: REFUND_POLICY_VERSION,
    calculationMode,
    paidAmount,
    penaltyAmount,
    usedAmount,
    giftDeductionAmount,
    totalDeductionAmount,
    refundAmount,
    totalCount,
    remainingCount,
    usedCount,
    unitAmount,
    totalContractWeeks,
    usedWeeks,
    manualReason,
  });

  return {
    policyVersion: REFUND_POLICY_VERSION,
    calculationMode,
    paidAmount,
    penaltyAmount,
    usedAmount,
    giftDeductionAmount,
    totalDeductionAmount,
    refundAmount,
    usedCount,
    totalCount,
    remainingCount,
    unitAmount,
    totalContractWeeks,
    usedWeeks,
    requiresReview,
    reviewReasons,
    formula,
    message,
    calculationHash,
  };
}

function buildRefundMessage(
  memberName: string,
  ticketName: string,
  values: Pick<
    RefundCalculation,
    | "calculationMode"
    | "paidAmount"
    | "penaltyAmount"
    | "usedAmount"
    | "giftDeductionAmount"
    | "refundAmount"
    | "usedCount"
    | "unitAmount"
    | "totalContractWeeks"
    | "usedWeeks"
    | "formula"
  >,
): string {
  const usageBasis = values.calculationMode === "count_ticket"
    ? `사용분: 정상 단가 ${formatWon(values.unitAmount || 0)} × ${values.usedCount || 0}회`
    : `사용분: 결제금액 × ${formatDecimal(values.usedWeeks || 0)}주 / ${formatDecimal(values.totalContractWeeks || 0)}주 (홀딩 제외)`;
  return [
    `${memberName} 회원님, 요청하신 ${ticketName} 환불 예상금액을 안내드립니다.`,
    "",
    `결제금액: ${formatWon(values.paidAmount)}`,
    `위약금(결제금액의 10%): ${formatWon(values.penaltyAmount)}`,
    `${usageBasis}: ${formatWon(values.usedAmount)}`,
    values.giftDeductionAmount > 0
      ? `증정·프로모션 혜택 공제: ${formatWon(values.giftDeductionAmount)}`
      : null,
    `예상 환불금액: ${formatWon(values.refundAmount)}`,
    "",
    `산정식: ${values.formula}`,
    "",
    "최종 환불금액은 환불동의서 작성과 운영자 확인 후 확정됩니다.",
  ].filter((line) => line != null).join("\n");
}

function nullableInteger(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return numberValue;
}

function positiveWon(value: number | null | undefined, label: string): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) throw new Error(`${label}은 0원보다 커야 합니다.`);
  return roundWon(numberValue);
}

function optionalWon(value: number | null | undefined, label: string): number {
  if (value == null) return 0;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return roundWon(numberValue);
}

function positiveNumber(value: number | null | undefined, label: string): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) throw new Error(`${label}는 0보다 커야 합니다.`);
  return roundDecimal(numberValue);
}

function nonNegativeNumber(value: number | null | undefined, label: string): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return roundDecimal(numberValue);
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function roundWon(value: number): number {
  return Math.round(value);
}

function roundDecimal(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatWon(value: number): string {
  return `${roundWon(value).toLocaleString("ko-KR")}원`;
}
