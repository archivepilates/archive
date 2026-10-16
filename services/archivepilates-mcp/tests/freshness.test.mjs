import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationError, safeError } from '../src/errors.mjs';
import { liveSource, snapshotSource } from '../src/freshness.mjs';

const checkedAt = '2026-10-16T01:00:00.000Z';
const queriedAt = '2026-10-16T01:00:01.000Z';
const kind = 'studiomate_live';
const invalidDates = [undefined, null, '', 'not-a-date', '2026-02-30T00:00:00Z',
  '2026-13-01T00:00:00Z', '2026-10-16', '2026-10-16T01:00:00',
  '10/16/2026', '2026-10-16T24:00:00Z', '2026-10-16T01:60:00Z',
  '2026-10-16T01:00:60Z', '2026-10-16T01:00:00+24:00',
  NaN, Infinity, 0, Date.parse(checkedAt), new Date(checkedAt), {}];

function invalidArgument(run) {
  assert.throws(run, error => {
    assert.ok(error instanceof OperationError);
    assert.equal(error.code, 'INVALID_ARGUMENT');
    assert.equal(error.safe, true);
    assert.deepEqual(safeError(error), { code: 'INVALID_ARGUMENT', message: error.message });
    return true;
  });
}

test('live metadata preserves explicit source, original check time and coverage without authorizing actions', () => {
  const coverage = Object.freeze({ liveRosterComplete: false });
  const input = Object.freeze({ kind, checkedAt, queriedAt, coverage });
  assert.deepEqual(liveSource(input), { kind, observedAt: checkedAt, checkedAt, queriedAt,
    freshness: 'live_at_checked_time', liveReadback: true, allowedForExternalActions: false, coverage });
  assert.equal(liveSource(input).coverage, coverage);
});

test('live timestamps compare instants, allow equality and reject future checks', () => {
  assert.equal(liveSource({ kind, checkedAt, queriedAt: checkedAt }).checkedAt, checkedAt);
  assert.equal(liveSource({ kind, checkedAt: '2026-10-16T10:00:00+09:00', queriedAt: checkedAt }).liveReadback, true);
  invalidArgument(() => liveSource({ kind, checkedAt: queriedAt, queriedAt: checkedAt }));
  invalidArgument(() => liveSource({ kind, checkedAt: '2026-10-16T00:00:00-02:00', queriedAt }));
});

test('live freshness names the checked time, not query time or a wall-clock age policy', () => {
  const result = liveSource({ kind, checkedAt: '1970-01-01T00:00:00Z', queriedAt });
  assert.equal(result.observedAt, '1970-01-01T00:00:00Z');
  assert.equal(result.freshness, 'live_at_checked_time');
  assert.equal(result.coverage, null);
  assert.equal(result.allowedForExternalActions, false);
});

test('live rejects invalid or missing checkedAt and queriedAt as public argument errors', () => {
  for (const field of ['checkedAt', 'queriedAt']) {
    for (const value of invalidDates) invalidArgument(() => liveSource({ kind, checkedAt, queriedAt, [field]: value }));
  }
});

test('snapshots keep cache fetch and source observation separate on cache hits and fresh fetches', () => {
  const observedAt = '2026-10-01T00:00:00Z';
  const coverage = Object.freeze({ liveRosterComplete: false });
  for (const cacheHit of [false, true]) {
    const input = Object.freeze({ kind: 'member_profiles_snapshot', queriedAt, fetchedAt: checkedAt, observedAt, cacheHit, coverage });
    assert.deepEqual(snapshotSource(input), { ...input, freshness: 'unknown', liveReadback: false, allowedForExternalActions: false });
    assert.equal(snapshotSource(input).coverage, coverage);
  }
});

test('snapshot defaults leave both source observation and fetch time unknown', () => {
  assert.deepEqual(snapshotSource({ kind: 'firestore_snapshot', queriedAt }), {
    kind: 'firestore_snapshot', queriedAt, fetchedAt: null, observedAt: null, cacheHit: false, coverage: null,
    freshness: 'unknown', liveReadback: false, allowedForExternalActions: false });
  assert.equal(snapshotSource({ kind, queriedAt, fetchedAt: queriedAt }).observedAt, null);
  assert.equal(snapshotSource({ kind, queriedAt, observedAt: checkedAt }).fetchedAt, null);
});

test('profile timestamps and caller-supplied flags cannot promote ticket snapshots', () => {
  const result = snapshotSource({ kind: 'ticket_inventory_snapshot', queriedAt, fetchedAt: queriedAt,
    collectedAt: checkedAt, originalCheckedAt: checkedAt, checkedAt, syncedAt: queriedAt, updatedAt: queriedAt,
    profile: { updatedAt: queriedAt }, freshness: 'live_at_checked_time', liveReadback: true, allowedForExternalActions: true });
  assert.equal(result.observedAt, null);
  assert.equal(result.freshness, 'unknown');
  assert.equal(result.liveReadback, false);
  assert.equal(result.allowedForExternalActions, false);
  assert.equal(Object.hasOwn(result, 'checkedAt'), false);
  assert.equal(liveSource({ kind, checkedAt, queriedAt, allowedForExternalActions: true }).allowedForExternalActions, false);
});

test('snapshots reject malformed query and optional timestamps but allow explicitly unknown times', () => {
  for (const value of invalidDates) invalidArgument(() => snapshotSource({ kind, queriedAt: value }));
  for (const field of ['fetchedAt', 'observedAt']) {
    for (const value of invalidDates.filter(value => value !== null && value !== undefined)) {
      invalidArgument(() => snapshotSource({ kind, queriedAt, [field]: value }));
    }
    assert.equal(snapshotSource({ kind, queriedAt, [field]: null })[field], null);
    assert.equal(snapshotSource({ kind, queriedAt, [field]: undefined })[field], null);
  }
});

test('valid leap days and finite epoch timestamps are accepted without normalization', () => {
  for (const observedAt of ['2024-02-29T00:00:00Z', '1970-01-01T00:00:00.000Z']) {
    assert.equal(snapshotSource({ kind, queriedAt, observedAt }).observedAt, observedAt);
  }
  invalidArgument(() => snapshotSource({ kind, queriedAt, observedAt: '2025-02-29T00:00:00Z' }));
});

test('source kind must be explicit and cacheHit must be boolean', () => {
  for (const value of [undefined, null, '', '  ', 1, {}]) {
    invalidArgument(() => liveSource({ kind: value, checkedAt, queriedAt }));
    invalidArgument(() => snapshotSource({ kind: value, queriedAt }));
  }
  for (const cacheHit of [null, 'false', 0, 1]) invalidArgument(() => snapshotSource({ kind, queriedAt, cacheHit }));
  invalidArgument(() => liveSource());
  invalidArgument(() => snapshotSource());
});
