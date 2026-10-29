import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEformEmptySearchResponse } from '../lib/instructor-eform-search-evidence.mjs';
const fixture = () => ({ httpStatus: 200, name: 'Test Member', mode: 'ip',
  request: { input: { query: { skip: 0, limit: 20, type: 'ip', sort: 'update_date', sort_type: 'desc', search: 'Test Member' } } },
  body: { status: '200', code: '-1', result: { documents: [], total_rows: 0 } } });
test('verified exact empty search is accepted', () => assert.equal(assertEformEmptySearchResponse(fixture()).responseVerified, true));
for (const [label, change] of [
  ['http failure', p => { p.httpStatus = 500; }],
  ['application failure', p => { p.body.code = 'ERROR'; }],
  ['wrong name', p => { p.request.input.query.search = 'Other'; }],
  ['wrong mode', p => { p.request.input.query.type = 'ai'; }],
  ['partial page', p => { p.request.input.query.skip = 20; }],
  ['extra restriction', p => { p.request.input.query.template = 'other'; }],
  ['nonempty', p => { p.body.result.total_rows = 1; }],
  ['missing documents', p => { delete p.body.result.documents; }],
]) test(label + ' is rejected', () => { const p = fixture(); change(p); assert.throws(() => assertEformEmptySearchResponse(p)); });
