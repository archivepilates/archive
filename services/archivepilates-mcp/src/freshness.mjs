import { requireValue } from './errors.mjs';

function timestamp(value, field) {
  const match = typeof value === 'string'
    && /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  const time = match ? Date.parse(value) : NaN;
  const day = match ? Date.parse(`${match[1]}T00:00:00Z`) : NaN;
  requireValue(Number.isFinite(time) && Number.isFinite(day)
    && new Date(day).toISOString().slice(0, 10) === match[1],
  'INVALID_ARGUMENT', `${field} must be a valid ISO timestamp with a timezone.`);
  return time;
}

function sourceKind(kind) {
  requireValue(typeof kind === 'string' && kind.trim().length > 0,
    'INVALID_ARGUMENT', 'kind must explicitly identify the source.');
}

export function liveSource({ kind, checkedAt, queriedAt, coverage = null } = {}) {
  sourceKind(kind);
  const checkedTime = timestamp(checkedAt, 'checkedAt');
  const queryTime = timestamp(queriedAt, 'queriedAt');
  requireValue(checkedTime <= queryTime, 'INVALID_ARGUMENT', 'checkedAt must not be later than queriedAt.');
  return { kind, observedAt: checkedAt, checkedAt, queriedAt,
    freshness: 'live_at_checked_time', liveReadback: true, allowedForExternalActions: false, coverage };
}

export function snapshotSource({ kind, queriedAt, fetchedAt = null, observedAt = null,
  cacheHit = false, coverage = null } = {}) {
  sourceKind(kind);
  timestamp(queriedAt, 'queriedAt');
  if (fetchedAt !== null) timestamp(fetchedAt, 'fetchedAt');
  if (observedAt !== null) timestamp(observedAt, 'observedAt');
  requireValue(typeof cacheHit === 'boolean', 'INVALID_ARGUMENT', 'cacheHit must be a boolean.');
  // Cache fetch time is not evidence of when the underlying source was observed.
  return { kind, observedAt, queriedAt, fetchedAt, cacheHit,
    freshness: 'unknown', liveReadback: false, allowedForExternalActions: false, coverage };
}
