const BUSY_REASON = "holding_browser_busy_deferred";
const FIRST_DELAY_MS = 5 * 60_000;
const MAX_DELAY_MS = 30 * 60_000;
const ALERT_AFTER_MS = 2 * 60 * 60_000;
const MAX_COUNT = 1000;
const RETRY_FIELDS = ["reason", "browserBusySince", "browserBusyCount", "nextAttemptAt", "browserBusyAlertedAt"];

function pastInstant(value, nowMs) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const ms = Date.parse(value);
  const day = value.slice(0, 10), dayMs = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) && ms <= nowMs && Number.isFinite(dayMs) &&
    new Date(dayMs).toISOString().slice(0, 10) === day ? value : null;
}

export function holdingBrowserBusyState(job, nowMs = Date.now()) {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs) ||
      !Number.isFinite(new Date(nowMs + MAX_DELAY_MS).getTime())) throw new RangeError("Invalid holding browser retry time");
  const now = new Date(nowMs).toISOString();
  const since = pastInstant(job?.browserBusySince, nowMs) || now;
  const alertedAt = pastInstant(job?.browserBusyAlertedAt, nowMs);
  const previousCount = Number.isSafeInteger(job?.browserBusyCount) && job.browserBusyCount >= 0 ? job.browserBusyCount : 0;
  const count = Math.min(MAX_COUNT, previousCount + 1);
  const delayMs = Math.min(MAX_DELAY_MS, FIRST_DELAY_MS * 2 ** Math.min(count - 1, 3));
  const shouldAlert = nowMs - Date.parse(since) >= ALERT_AFTER_MS && alertedAt === null;
  return {
    patch: {
      status: "pending",
      reason: BUSY_REASON,
      browserBusySince: since,
      browserBusyCount: count,
      nextAttemptAt: new Date(nowMs + delayMs).toISOString(),
      browserBusyAlertedAt: shouldAlert ? now : alertedAt,
    },
    shouldAlert,
  };
}

export function holdingBrowserRetryCarry(old, job) {
  if (old?.status !== "pending" || old.reason !== BUSY_REASON || !job || job.reason ||
      !["memberId", "memberKey", "ticketName"].every(key =>
        typeof job[key] === "string" && job[key].trim() && old[key] === job[key])) return {};
  // Only retry state is carried; source fields and requestedAt stay caller-owned.
  return Object.fromEntries(RETRY_FIELDS.filter(key => Object.hasOwn(old, key) && old[key] !== undefined)
    .map(key => [key, old[key]]));
}
