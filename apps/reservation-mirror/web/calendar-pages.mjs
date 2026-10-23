const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const MAX_ROWS = 1000;
const MAX_MS = 10_000;

// fetchPage(params, signal) adapts the existing authenticated calendar GET reader.
// complete means cursor exhaustion only, never complete source coverage.
export async function loadCalendarPages({fetchPage, query, signal}) {
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage is required');
  if (!query || ![query.from, query.to].every((day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) || query.from > query.to) {
    throw new TypeError('An ordered calendar date range is required');
  }
  if ((query.entity !== undefined && query.entity !== 'occurrences') || query.after !== undefined) {
    throw new TypeError('Start a fresh occurrences query without a cursor');
  }
  if ((query.search !== undefined && typeof query.search !== 'string') || (query.status !== undefined && query.status !== 'all')) {
    throw new TypeError('Calendar filters must use a string search and status all');
  }
  const fixedQuery = Object.freeze({entity: 'occurrences', limit: PAGE_SIZE, search: query.search ?? '', from: query.from, to: query.to, status: 'all'});
  const items = [];
  const ids = new Set();
  const cursors = new Set();
  let nextCursor = null;
  let snapshotId = null;
  let pagesRead = 0;
  let requests = 0;
  const result = (partialReason = null, errorStatus = null) => ({
    items, nextCursor, snapshotId, pagesRead, requests, query: fixedQuery,
    complete: partialReason === null, partialReason, errorStatus,
    restartRequired: ['invalid_page', 'snapshot_missing', 'snapshot_changed', 'cursor_cycle', 'duplicate_occurrence'].includes(partialReason),
  });
  const abortError = () => signal?.reason?.name === 'AbortError' ? signal.reason : new DOMException('Calendar read aborted', 'AbortError');
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  const deadlineError = new Error('Calendar time budget exceeded');
  const startedAt = performance.now();
  let rejectStop;
  // Race the whole batch deadline even if an injected reader ignores cancellation.
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  const cancel = () => {
    const error = abortError();
    rejectStop(error);
    controller.abort(error);
  };
  signal?.addEventListener('abort', cancel, {once: true});
  const timer = setTimeout(() => {
    rejectStop(deadlineError);
    controller.abort(deadlineError);
  }, MAX_MS);
  try {
    while (true) {
      if (signal?.aborted) throw abortError();
      if (performance.now() - startedAt >= MAX_MS) return result('time_budget');
      if (items.length >= MAX_ROWS) return result('row_budget');
      if (requests >= MAX_PAGES) return result('page_budget');
      const params = Object.freeze({...fixedQuery, ...(nextCursor ? {after: nextCursor} : {})});
      requests += 1;
      let data;
      try {
        data = await Promise.race([
          Promise.resolve().then(() => {
            if (controller.signal.aborted) throw controller.signal.reason;
            return fetchPage(params, controller.signal);
          }),
          stopped,
        ]);
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (error?.status === 401 || error?.status === 403) throw error;
        if (error === deadlineError) return result('time_budget');
        if (error?.name === 'AbortError') throw error;
        return result(error?.status === 409 ? 'snapshot_changed' : 'read_error', Number.isInteger(error?.status) ? error.status : null);
      }
      if (signal?.aborted) throw abortError();
      if (controller.signal.aborted || performance.now() - startedAt >= MAX_MS) return result('time_budget');
      if (!data || !Array.isArray(data.items) || data.items.length > PAGE_SIZE ||
        !(data.nextCursor === null || (typeof data.nextCursor === 'string' && data.nextCursor.trim() && data.nextCursor.length <= 1000)) ||
        (!data.items.length && data.nextCursor !== null)) return result('invalid_page');
      if (typeof data.snapshotId !== 'string' || !data.snapshotId.trim()) return result('snapshot_missing');
      if (snapshotId !== null && snapshotId !== data.snapshotId) return result('snapshot_changed');
      if (data.nextCursor !== null && cursors.has(data.nextCursor)) return result('cursor_cycle');
      const pageIds = new Set();
      for (const item of data.items) {
        if (!item || typeof item.id !== 'string' || !item.id.trim()) return result('invalid_page');
        if (ids.has(item.id) || pageIds.has(item.id)) return result('duplicate_occurrence');
        pageIds.add(item.id);
      }
      // A page is accepted atomically, only after all identity checks pass.
      items.push(...data.items);
      for (const id of pageIds) ids.add(id);
      if (data.nextCursor !== null) cursors.add(data.nextCursor);
      snapshotId = data.snapshotId;
      nextCursor = data.nextCursor;
      pagesRead += 1;
      if (nextCursor === null) return result();
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}
