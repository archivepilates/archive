import { createHash } from "node:crypto";

const digest = (value) => /^[a-f0-9]{64}$/.test(value);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const utc = (value) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() ===
    (value.length === 20 ? value.replace("Z", ".000Z") : value);
const counts = (value) => record(value) && Object.entries(value).every(([key, count]) =>
  digest(key) && Number.isSafeInteger(count) && count > 0);
const contains = (larger, smaller) => Object.entries(smaller).every(([key, count]) =>
  (larger[key] || 0) >= count);

function validEntry(entry) {
  return record(entry) && entry.schemaVersion === 1 && typeof entry.reviewId === "string" &&
    digest(entry.reviewId) && utc(entry.reviewedAt) && utc(entry.originalObservedAt) &&
    Date.parse(entry.originalObservedAt) <= Date.parse(entry.reviewedAt) &&
    counts(entry.historicalRows) && counts(entry.minimumRows) && counts(entry.lastRows) &&
    contains(entry.historicalRows, entry.minimumRows) && contains(entry.lastRows, entry.minimumRows);
}

export function validateCoverageReconciliations(map) {
  return map === undefined || (record(map) && Object.entries(map).every(([key, entry]) =>
    digest(key) && validEntry(entry)));
}

// Input is the normalized hint objects produced by contractObservationGroups.
export function contractHintRowCounts(hints) {
  const result = {};
  for (const hint of hints) {
    const key = createHash("sha256").update(JSON.stringify(hint)).digest("hex");
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

export function classifyCoverageReconciliationTransition(entry, currentRows) {
  const valid = validEntry(entry) && counts(currentRows);
  if (!valid) return { valid: false, minimumPresent: false, lossIsHistorical: false,
    historicalOnly: false, hasNovelAdditions: false, suppressHint: false, waiveCoverageLoss: false };
  const minimumPresent = contains(currentRows, entry.minimumRows);
  const lossIsHistorical = Object.entries(entry.lastRows).every(([key, count]) => {
    const removed = count - (currentRows[key] || 0);
    // A duplicate beyond historical multiplicity cannot safely disappear.
    return removed <= 0 || (count <= (entry.historicalRows[key] || 0) &&
      removed <= entry.historicalRows[key]);
  });
  const historicalOnly = contains(entry.historicalRows, currentRows);
  const hasNovelAdditions = Object.entries(currentRows).some(([key, count]) =>
    count > Math.max(entry.historicalRows[key] || 0, entry.lastRows[key] || 0));
  const waiveCoverageLoss = minimumPresent && lossIsHistorical;
  return { valid: true, minimumPresent, lossIsHistorical, historicalOnly, hasNovelAdditions,
    suppressHint: waiveCoverageLoss && !hasNovelAdditions, waiveCoverageLoss };
}
