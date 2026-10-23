import assert from 'node:assert/strict';
import test from 'node:test';
import {loadCalendarPages} from '../web/calendar-pages.mjs';

const range = {from: '2026-10-19', to: '2026-10-25', search: '', status: 'all'};
const row = (id) => ({id, title: 'Synthetic class', startAt: '2026-10-24T09:00:00+09:00'});
const page = (items, nextCursor = null, snapshotId = 'synthetic-snapshot') => ({items, nextCursor, snapshotId});
const read = (fetchPage, options = {}) => loadCalendarPages({fetchPage, query: {...range}, ...options});

test('returns the existing API shape plus explicit pagination-only completion', async () => {
  const response = page([row('a')]);
  const before = structuredClone(response);
  const result = await read(async () => response);
  assert.deepEqual(result, {
    items: [row('a')], nextCursor: null, snapshotId: 'synthetic-snapshot', pagesRead: 1, requests: 1,
    query: {entity: 'occurrences', limit: 50, search: '', ...range},
    complete: true, partialReason: null, errorStatus: null, restartRequired: false,
  });
  assert.deepEqual(response, before);
});

test('accepts an empty terminal first page only with a snapshot', async () => {
  const result = await read(async () => page([]));
  assert.equal(result.complete, true);
  assert.equal(result.items.length, 0);
  assert.equal(result.pagesRead, 1);
});

test('reads sequentially with fixed query ordering, limit 50, and opaque cursors', async () => {
  const query = {...range, search: 'Synthetic', limit: 100};
  const calls = [];
  let active = 0;
  const result = await read(async (params, signal) => {
    assert.equal(active++, 0);
    assert.equal(signal.aborted, false);
    calls.push(params);
    assert.equal(Object.isFrozen(params), true);
    if (calls.length === 1) { query.from = '2027-01-01'; query.search = 'Changed'; }
    await Promise.resolve();
    active -= 1;
    return page([row(String(calls.length))], calls.length < 3 ? `opaque+/=${calls.length}` : null);
  }, {query});
  assert.equal(result.items.length, 3);
  assert.equal(result.complete, true);
  const binding = new URLSearchParams(calls[0]).toString();
  for (const [index, params] of calls.entries()) {
    const copy = new URLSearchParams(params); copy.delete('after');
    assert.equal(copy.toString(), binding);
    assert.equal(params.from, range.from);
    assert.equal(params.search, 'Synthetic');
    assert.equal(params.limit, 50);
    assert.equal(params.entity, 'occurrences');
    assert.equal(params.after, index ? `opaque+/=${index}` : undefined);
  }
});

for (const [count, reason] of [[1, 'page_budget'], [50, 'row_budget']]) {
  test(`stops after at most 20 requests and 1000 rows: ${reason}`, async () => {
    let calls = 0;
    const result = await read(async () => {
      calls += 1;
      return page(Array.from({length: count}, (_, i) => row(`${calls}-${i}`)), `cursor-${calls}`);
    });
    assert.equal(calls, 20);
    assert.equal(result.requests, 20);
    assert.equal(result.pagesRead, 20);
    assert.equal(result.items.length, count * 20);
    assert.equal(result.nextCursor, 'cursor-20');
    assert.equal(result.partialReason, reason);
    assert.equal(result.complete, false);
    assert.equal(result.restartRequired, false);
  });
}

test('a terminal page at exactly 1000 rows is complete, not budget-limited', async () => {
  let calls = 0;
  const result = await read(async () => {
    calls += 1;
    return page(Array.from({length: 50}, (_, i) => row(`${calls}-${i}`)), calls < 20 ? `cursor-${calls}` : null);
  });
  assert.equal(result.items.length, 1000);
  assert.equal(result.complete, true);
});

for (const status of [undefined, 409, 429, 503]) {
  test(`read failure ${status} preserves accepted rows and the failed request cursor`, async () => {
    let calls = 0;
    const result = await read(async () => {
      if (++calls === 1) return page([row('a')], 'retry-cursor');
      throw Object.assign(new Error('Synthetic read failure'), {status});
    });
    assert.deepEqual(result.items, [row('a')]);
    assert.equal(result.nextCursor, 'retry-cursor');
    assert.equal(result.snapshotId, 'synthetic-snapshot');
    assert.equal(result.pagesRead, 1);
    assert.equal(result.requests, 2);
    assert.equal(result.partialReason, status === 409 ? 'snapshot_changed' : 'read_error');
    assert.equal(result.errorStatus, status ?? null);
    assert.equal(result.restartRequired, status === 409);
    assert.equal(result.complete, false);
  });
}

test('first-page failure is incomplete even though its nextCursor is null', async () => {
  const result = await read(async () => { throw new Error('Synthetic failure'); });
  assert.equal(result.nextCursor, null);
  assert.equal(result.snapshotId, null);
  assert.equal(result.pagesRead, 0);
  assert.equal(result.partialReason, 'read_error');
  assert.equal(result.complete, false);
});

for (const status of [401, 403]) {
  test(`throws the original ${status} error for existing UI auth guards`, async () => {
    let calls = 0;
    const error = Object.assign(new Error('Synthetic auth failure'), {status});
    await assert.rejects(read(async () => {
      if (++calls === 1) return page([row('a')], 'cursor');
      throw error;
    }), (caught) => caught === error);
    assert.equal(calls, 2);
  });
}

for (const snapshotId of [undefined, '', ' ', 'different-snapshot']) {
  test(`rejects missing/changed snapshot ${JSON.stringify(snapshotId)} atomically`, async () => {
    let calls = 0;
    const result = await read(async () => ++calls === 1 ? page([row('a')], 'cursor') : {...page([row('b')]), snapshotId});
    assert.deepEqual(result.items, [row('a')]);
    assert.equal(result.nextCursor, 'cursor');
    assert.equal(result.snapshotId, 'synthetic-snapshot');
    assert.equal(result.partialReason, snapshotId?.trim() ? 'snapshot_changed' : 'snapshot_missing');
    assert.equal(result.restartRequired, true);
  });
}

test('a missing first snapshot cannot be presented as an empty completed calendar', async () => {
  const result = await read(async () => ({...page([]), snapshotId: ''}));
  assert.equal(result.complete, false);
  assert.equal(result.partialReason, 'snapshot_missing');
});

for (const sequence of [['A', 'A'], ['A', 'B', 'A']]) {
  test(`detects cursor cycle ${sequence.join(' -> ')} without accepting the bad page`, async () => {
    let calls = 0;
    const result = await read(async () => page([row(String(calls))], sequence[calls++]));
    assert.equal(calls, sequence.length);
    assert.equal(result.items.length, sequence.length - 1);
    assert.equal(result.nextCursor, sequence.at(-2));
    assert.equal(result.partialReason, 'cursor_cycle');
    assert.equal(result.restartRequired, true);
  });
}

for (const badRows of [[row('a'), row('b')], [row('b'), row('b')]]) {
  test('rejects duplicate occurrence IDs within/across pages atomically', async () => {
    let calls = 0;
    const result = await read(async () => ++calls === 1 ? page([row('a')], 'cursor') : page(badRows));
    assert.deepEqual(result.items, [row('a')]);
    assert.equal(result.nextCursor, 'cursor');
    assert.equal(result.pagesRead, 1);
    assert.equal(result.partialReason, 'duplicate_occurrence');
  });
}

for (const invalid of [null, {}, {...page([]), items: {}}, {...page([]), nextCursor: undefined},
  page([], 'cursor'), page([{}]), page([row(' ')]), page([row(42)]), page([row('b')], ''),
  page([row('b')], 7), page([row('b')], 'x'.repeat(1001)),
  page(Array.from({length: 51}, (_, i) => row(String(i))))]) {
  test('invalid page shapes preserve the last accepted cursor and rows', async () => {
    let calls = 0;
    const result = await read(async () => ++calls === 1 ? page([row('a')], 'cursor') : invalid);
    assert.deepEqual(result.items, [row('a')]);
    assert.equal(result.nextCursor, 'cursor');
    assert.equal(result.partialReason, 'invalid_page');
    assert.equal(result.restartRequired, true);
  });
}

test('pre-aborted input never calls the reader', async () => {
  const controller = new AbortController(); controller.abort(new Error('Caller invalidated query'));
  await assert.rejects(read(() => assert.fail('must not read'), {signal: controller.signal}), {name: 'AbortError'});
});

test('caller cancellation rejects promptly even when the reader ignores its signal', async () => {
  const controller = new AbortController();
  let seenSignal;
  const pending = read((params, signal) => {
    seenSignal = signal;
    controller.abort();
    return new Promise(() => {});
  }, {signal: controller.signal});
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(seenSignal.aborted, true);
});

test('an AbortError from the reader is rethrown unchanged', async () => {
  const error = new DOMException('Synthetic stale generation', 'AbortError');
  await assert.rejects(read(async () => { throw error; }), (caught) => caught === error);
});

test('the 10-second deadline aborts a hung reader and retains accepted data', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let calls = 0;
  let timedSignal;
  const result = await read((params, signal) => {
    if (++calls === 1) return page([row('a')], 'cursor');
    timedSignal = signal;
    t.mock.timers.tick(10_000);
    return new Promise(() => {});
  });
  assert.equal(calls, 2);
  assert.equal(timedSignal.aborted, true);
  assert.equal(result.partialReason, 'time_budget');
  assert.deepEqual(result.items, [row('a')]);
  assert.equal(result.nextCursor, 'cursor');
  assert.equal(result.complete, false);
});

test('a terminal response arriving at the deadline is not accepted', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const result = await read(() => { t.mock.timers.tick(10_000); return page([row('late')]); });
  assert.equal(result.partialReason, 'time_budget');
  assert.deepEqual(result.items, []);
});

test('timers and external abort listeners are cleaned up after success', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const controller = new AbortController();
  const add = t.mock.method(controller.signal, 'addEventListener');
  const remove = t.mock.method(controller.signal, 'removeEventListener');
  const result = await read(async () => page([]), {signal: controller.signal});
  assert.equal(add.mock.callCount(), 1);
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(add.mock.calls[0].arguments[1], remove.mock.calls[0].arguments[1]);
  controller.abort();
  t.mock.timers.tick(10_000);
  assert.equal(result.complete, true);
});

for (const query of [{}, {...range, from: 'bad'}, {...range, from: '2027-01-01'},
  {...range, entity: 'bookings'}, {...range, after: 'cursor'}, {...range, status: 'booked'}, {...range, search: {}}]) {
  test('rejects non-calendar/unbounded query inputs before any read', async () => {
    await assert.rejects(read(() => assert.fail('must not read'), {query}), TypeError);
  });
}
