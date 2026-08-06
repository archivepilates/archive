export function readRegularCompensationCarryForward(ledgerRows, row) {
  const adjustmentTextIndex = findHeaderIndex(ledgerRows, "조정내용");
  const regularPayoutIndex = findHeaderIndex(ledgerRows, "정규직 실지급");
  const adjustmentText = adjustmentTextIndex >= 0 ? clean(row?.[adjustmentTextIndex]) : "";

  return {
    regularPayout: regularPayoutIndex >= 0 ? money(row?.[regularPayoutIndex]) : 0,
    regularGrossDeduction: parseRegularGrossDeduction(adjustmentText),
  };
}

export function calculateSplitCompensation({
  groupPay,
  privatePay,
  lessonPay,
  regularPayout,
  regularGrossDeduction,
}) {
  const normalizedRegularPayout = money(regularPayout);
  const normalizedRegularGross = money(regularGrossDeduction);

  if (normalizedRegularPayout > 0 && normalizedRegularGross <= 0) {
    throw new Error("정규직 실지급이 있으나 프리랜서 수업 보수에서 차감할 정규직 급여 기준액이 없습니다.");
  }

  const adjustmentAmount = normalizedRegularGross ? money(lessonPay) - normalizedRegularGross : money(lessonPay);
  const pretaxPay = money(groupPay) + money(privatePay) + adjustmentAmount;
  const incomeTax = pretaxPay > 0 ? pretaxPay * 0.03 : 0;
  const localTax = pretaxPay > 0 ? pretaxPay * 0.003 : 0;
  const deductionTotal = incomeTax + localTax;
  const freelancerPayout = pretaxPay - deductionTotal;
  const combinedPayout = normalizedRegularPayout ? freelancerPayout + normalizedRegularPayout : 0;

  return {
    adjustmentAmount,
    pretaxPay,
    incomeTax,
    localTax,
    deductionTotal,
    freelancerPayout,
    regularPayout: normalizedRegularPayout,
    combinedPayout,
    finalPayout: combinedPayout || freelancerPayout,
  };
}

export function parseRegularGrossDeduction(text) {
  const matched = clean(text).match(/정규직급여\s*\(([-,\d]+)\)/);
  return matched ? Math.abs(money(matched[1])) : 0;
}

function findHeaderIndex(rows, label) {
  for (const row of (rows || []).slice(0, 4)) {
    const index = (row || []).findIndex((value) => clean(value) === label);
    if (index >= 0) return index;
  }
  return -1;
}

function clean(value) {
  return String(value ?? "").trim();
}

function money(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = clean(value).replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
