import { createHash } from "node:crypto";

export const REFUND_POLICY_VERSION = "archive-refund-studiomate-source-2026-08-20-v4";
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

export function deriveRefundPeriodUsage(input: {
  availableFrom?: string | null;
  expiresAt?: string | null;
  requestedAt: string;
  contractDays?: number | null;
}): { totalDays: number; usedDays: number; remainingDays: number; excludedDays: number } | null {
  const startDay = kstDayNumber(input.availableFrom || null);
  const endDay = kstDayNumber(input.expiresAt || null);
  const requestedDay = kstDayNumber(input.requestedAt);
  if (startDay == null || endDay == null || requestedDay == null || endDay < startDay) return null;
  const calendarDays = endDay - startDay + 1;
  const sourceContractDays = Number(input.contractDays);
  const totalDays = Number.isInteger(sourceContractDays) && sourceContractDays > 0 && sourceContractDays <= calendarDays
    ? sourceContractDays
    : calendarDays;
  const calendarRemainingDays = requestedDay < startDay
    ? calendarDays
    : Math.max(0, endDay - requestedDay);
  const remainingDays = Math.min(totalDays, calendarRemainingDays);
  const usedDays = totalDays - remainingDays;
  return { totalDays, usedDays, remainingDays, excludedDays: calendarDays - totalDays };
}

export function inferRefundContractDays(ticketName: unknown): number | null {
  const name = String(ticketName || "").replace(/\s+/g, "");
  const weekMatch = name.match(/(?:^|[^0-9])(\d{1,3})주(?:[^0-9]|$)/);
  if (weekMatch) return Number(weekMatch[1]) * 7;
  const dayMatch = name.match(/(?:^|[^0-9])(\d{1,3})일(?:[^0-9]|$)/);
  return dayMatch ? Number(dayMatch[1]) : null;
}

export type RefundCalculationInput = {
  memberName: string;
  ticketName: string;
  ticketKind: RefundTicketKind;
  paidAmount: number;
  totalCount: number | null;
  remainingCount: number | null;
  normalUnitAmount?: number | null;
  totalContractWeeks?: number | null;
  remainingWeeks?: number | null;
  giftDeductionAmount?: number | null;
  usageSource?: "studiomate_active_ticket" | "studiomate_period_weeks";
};

export type RefundCalculation = {
  policyVersion: string;
  usageSource: "studiomate_active_ticket" | "studiomate_period_weeks";
  calculationMode: "count_ticket" | "period_ticket";
  paidAmount: number;
  penaltyAmount: number;
  usedAmount: number;
  giftDeductionAmount: number;
  totalDeductionAmount: number;
  remainingBalanceAmount: number;
  refundAmount: number;
  usedCount: number | null;
  totalCount: number | null;
  remainingCount: number | null;
  unitAmount: number | null;
  totalContractWeeks: number | null;
  usedWeeks: number | null;
  remainingWeeks: number | null;
  totalContractDays: number | null;
  usedDays: number | null;
  remainingDays: number | null;
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
  const totalCount = nullableInteger(input.totalCount, "총 횟수");
  const remainingCount = nullableInteger(input.remainingCount, "잔여 횟수");
  const reviewReasons: string[] = [];

  let calculationMode: RefundCalculation["calculationMode"];
  let usedAmount = 0;
  let usedCount: number | null = null;
  let unitAmount: number | null = null;
  let totalContractWeeks: number | null = null;
  let usedWeeks: number | null = null;
  let remainingWeeks: number | null = null;
  let totalContractDays: number | null = null;
  let usedDays: number | null = null;
  let remainingDays: number | null = null;
  let requiresReview = false;
  const usageSource = input.usageSource || (input.ticketKind === "count" ? "studiomate_active_ticket" : "studiomate_period_weeks");

  if (input.ticketKind === "count") {
    calculationMode = "count_ticket";
    if (usageSource !== "studiomate_active_ticket") throw new Error("횟수권 사용 횟수 원천을 확인하세요.");
    unitAmount = positiveWon(input.normalUnitAmount, "1회 정상 단가");
    const sourceUsedCount =
      totalCount != null && remainingCount != null && remainingCount <= totalCount
        ? totalCount - remainingCount
        : null;
    usedCount = sourceUsedCount;
    requiresReview = true;
    reviewReasons.push("1회 정상 단가는 운영자 입력값입니다.");
    if (usedCount == null) throw new Error("횟수권 사용 횟수를 확인하세요.");
    if (totalCount != null && usedCount > totalCount) throw new Error("사용 횟수는 총 횟수를 초과할 수 없습니다.");
    usedAmount = roundWon(unitAmount * usedCount);
  } else if (input.ticketKind === "period") {
    calculationMode = "period_ticket";
    if (usageSource !== "studiomate_period_weeks") throw new Error("기간권 잔여기간 원천을 확인하세요.");
    totalContractWeeks = positiveNumber(input.totalContractWeeks, "총 계약 주수");
    remainingWeeks = nonNegativeNumber(input.remainingWeeks, "잔여 주수");
    if (remainingWeeks > totalContractWeeks) throw new Error("잔여 주수는 총 계약 주수를 초과할 수 없습니다.");
    usedWeeks = roundDecimal(totalContractWeeks - remainingWeeks);
    usedAmount = roundWon(paidAmount * (usedWeeks / totalContractWeeks));
  } else {
    throw new Error("수강권 유형을 확인하세요.");
  }

  if (giftDeductionAmount > 0) {
    requiresReview = true;
    reviewReasons.push("증정·이벤트·프로모션 혜택 공제액이 포함되었습니다.");
  }

  const remainingBalanceAmount = Math.max(0, roundWon(paidAmount - usedAmount));
  const totalDeductionAmount = roundWon(penaltyAmount + usedAmount + giftDeductionAmount);
  const refundAmount = Math.max(0, roundWon(paidAmount - totalDeductionAmount));
  if (totalDeductionAmount > paidAmount) {
    requiresReview = true;
    reviewReasons.push("공제액이 실결제금액을 초과하여 환불액을 0원으로 제한했습니다.");
  }

  const formula = [
    `잔여금액 ${formatWon(remainingBalanceAmount)}`,
    `위약금 ${formatWon(penaltyAmount)}`,
    giftDeductionAmount > 0 ? `추가 공제 ${formatWon(giftDeductionAmount)}` : null,
  ].filter(Boolean).join(" - ");
  const message = buildRefundMessage(input.memberName, input.ticketName, {
    calculationMode,
    paidAmount,
    penaltyAmount,
    usedAmount,
    giftDeductionAmount,
    remainingBalanceAmount,
    refundAmount,
    totalCount,
    remainingCount,
    usedCount,
    unitAmount,
    totalContractWeeks,
    usedWeeks,
    remainingWeeks,
    totalContractDays,
    usedDays,
    remainingDays,
    formula,
  });
  const calculationHash = stableHash({
    policyVersion: REFUND_POLICY_VERSION,
    calculationMode,
    paidAmount,
    penaltyAmount,
    usedAmount,
    giftDeductionAmount,
    remainingBalanceAmount,
    totalDeductionAmount,
    refundAmount,
    totalCount,
    remainingCount,
    usedCount,
    unitAmount,
    totalContractWeeks,
    usedWeeks,
    remainingWeeks,
    totalContractDays,
    usedDays,
    remainingDays,
    usageSource,
  });

  return {
    policyVersion: REFUND_POLICY_VERSION,
    usageSource,
    calculationMode,
    paidAmount,
    penaltyAmount,
    usedAmount,
    giftDeductionAmount,
    totalDeductionAmount,
    remainingBalanceAmount,
    refundAmount,
    usedCount,
    totalCount,
    remainingCount,
    unitAmount,
    totalContractWeeks,
    usedWeeks,
    remainingWeeks,
    totalContractDays,
    usedDays,
    remainingDays,
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
    | "remainingBalanceAmount"
    | "refundAmount"
    | "totalCount"
    | "remainingCount"
    | "usedCount"
    | "unitAmount"
    | "totalContractWeeks"
    | "usedWeeks"
    | "remainingWeeks"
    | "totalContractDays"
    | "usedDays"
    | "remainingDays"
    | "formula"
  >,
): string {
  const remainingBasis = values.calculationMode === "count_ticket"
    ? `잔여횟수: ${values.remainingCount || 0}회 / ${values.totalCount || 0}회`
    : values.totalContractDays != null && values.remainingDays != null
      ? `잔여기간: ${values.remainingDays}일 / ${values.totalContractDays}일`
      : `잔여기간: ${formatDecimal(values.remainingWeeks || 0)}주 / ${formatDecimal(values.totalContractWeeks || 0)}주`;
  const deductionFormula = [
    `잔여금액 ${formatWon(values.remainingBalanceAmount)}`,
    `위약금 ${formatWon(values.penaltyAmount)}`,
    values.giftDeductionAmount > 0 ? `추가 공제 ${formatWon(values.giftDeductionAmount)}` : null,
  ].filter(Boolean).join(" - ");
  return [
    "[ARCHIVE PILATES 환불 예상금액 안내]",
    "",
    `${memberName} 회원님, 요청하신 ${ticketName} 수강권의 환불 예상금액입니다.`,
    "",
    `결제금액: ${formatWon(values.paidAmount)}`,
    remainingBasis,
    `잔여금액: ${formatWon(values.remainingBalanceAmount)}`,
    `위약금(결제금액의 10%): ${formatWon(values.penaltyAmount)}`,
    values.giftDeductionAmount > 0
      ? `증정·프로모션 추가 공제: ${formatWon(values.giftDeductionAmount)}`
      : null,
    `예상 환불금액: ${formatWon(values.refundAmount)}`,
    "",
    `산정식: ${deductionFormula} = ${formatWon(values.refundAmount)}`,
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

function kstDayNumber(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (![year, month, day].every(Number.isFinite)) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
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
