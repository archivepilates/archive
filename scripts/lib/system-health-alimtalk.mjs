const RESOLVED_FAILURE_STATUSES = new Set([
  "resolved",
  "superseded",
  "not_required",
]);

export function isActionableAlimtalkFailure(data = {}) {
  const status = String(data.status || "")
    .trim()
    .toLowerCase();
  if (!new Set(["failed", "error"]).has(status)) return false;
  const resolutionStatus = String(data.resolutionStatus || "")
    .trim()
    .toLowerCase();
  return !RESOLVED_FAILURE_STATUSES.has(resolutionStatus);
}
