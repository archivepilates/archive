export const PROJECT_ID = 'archive-pilates';
export const RATE_GUARD_COLLECTION = 'videoWatchRateLimits';
export const RETIRED_JOB_ID = 'archive-reservation-mirror-isolation';
export const RATE_GUARD_RETENTION_MS = 2 * 86400000;
export const CLEANUP_GRACE_MS = 3600000;

export function utcHour(value) {
  return new Date(value).toISOString().slice(0,13).replace(/[-T:]/g,'');
}

export function isExpiredVideoRateGuard(row, nowMs) {
  if (!row || !['buyer','network'].includes(row.scope)) return false;
  if (![row.expiresAtMs,row.updatedAtMs,nowMs].every(value =>
    Number.isFinite(value) && value >= 0 && value <= 8640000000000000)) return false;
  if (!Number.isSafeInteger(row.count) || row.count < 1) return false;
  if (typeof row.subjectKey !== 'string' || !row.subjectKey || row.subjectKey.includes('/')) return false;
  if (row.id !== `${row.scope}_${row.subjectKey}_${utcHour(row.updatedAtMs)}`) return false;
  if (row.expiresAtMs-row.updatedAtMs !== RATE_GUARD_RETENTION_MS) return false;
  return row.expiresAtMs < nowMs-CLEANUP_GRACE_MS;
}

export function assertRateGuardPath(path) {
  if (typeof path !== 'string' || path.split('/').length !== 2 || !path.split('/')[1] ||
      !path.startsWith(RATE_GUARD_COLLECTION+'/')) throw Error('Only exact video rate-guard documents may be deleted');
}
