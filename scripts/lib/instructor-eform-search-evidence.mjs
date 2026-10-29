import assert from 'node:assert/strict';

export function assertEformEmptySearchResponse({ httpStatus, request, body, name, mode }) {
  const query = request?.input?.query;
  assert(['ip', 'ai'].includes(mode));
  assert.equal(httpStatus, 200);
  assert.equal(query?.search, name);
  assert.equal(query?.type, mode);
  assert.equal(query?.skip, 0);
  assert.equal(query?.limit, 20);
  assert.deepEqual(Object.keys(query).sort(), ['limit', 'search', 'skip', 'sort', 'sort_type', 'type']);
  assert.equal(query.sort, 'update_date');
  assert.equal(query.sort_type, 'desc');
  assert.equal(body?.status, '200');
  assert.equal(body?.code, '-1');
  assert.equal(body?.result?.total_rows, 0);
  assert.deepEqual(body?.result?.documents, []);
  return { responseVerified: true, httpStatus, totalRows: 0, documentCount: 0 };
}
