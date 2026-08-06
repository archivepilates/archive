export class MissingSettlementRateError extends Error {
  constructor(missing) {
    const details = missing.map((item) => `${item.instructorName}(${item.rateType} 탭)`).join(", ");
    super(`아카이브 강사 보수기준표 누락: ${details}`);
    this.name = "MissingSettlementRateError";
    this.code = "MISSING_SETTLEMENT_RATE";
    this.missing = missing;
  }
}

export function assertSettlementRateCoverage(rows, refs) {
  const missing = new Map();
  for (const row of rows || []) {
    const instructorName = clean(row?.instructorName);
    const finalType = clean(row?.finalType);
    if (!instructorName) continue;

    if (finalType === "그룹" && !Object.hasOwn(refs?.groupMap || {}, instructorName)) {
      missing.set(`${instructorName}:그룹`, { instructorName, rateType: "그룹" });
    }
    if (["프라이빗", "강사레슨"].includes(finalType) && !Object.hasOwn(refs?.privateMap || {}, instructorName)) {
      missing.set(`${instructorName}:프라이빗`, { instructorName, rateType: "프라이빗" });
    }
  }

  if (missing.size) throw new MissingSettlementRateError([...missing.values()]);
}

export function requireGroupRates(groupMap, instructorName) {
  if (!Object.hasOwn(groupMap || {}, instructorName)) {
    throw new MissingSettlementRateError([{ instructorName, rateType: "그룹" }]);
  }
  return groupMap[instructorName];
}

export function requirePrivateRate(privateMap, instructorName) {
  if (!Object.hasOwn(privateMap || {}, instructorName)) {
    throw new MissingSettlementRateError([{ instructorName, rateType: "프라이빗" }]);
  }
  return privateMap[instructorName];
}

function clean(value) {
  return String(value ?? "").trim();
}
