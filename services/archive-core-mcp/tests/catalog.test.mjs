import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, UNSUPPORTED, catalog } from '../src/catalog.mjs';
import { AREAS } from '../src/records.mjs';

const areas = Object.entries(AREAS).map(([name, spec]) => ({
  name, collection: spec.collection, filters: spec.filters, sensitive: !!spec.sensitive,
}));

test('summary preserves discoverability and exclusions while reducing payload', () => {
  const result = catalog(areas);
  const legacy = { actions: ACTIONS, areas, unsupported: UNSUPPORTED };
  assert.deepEqual(result.actions.map(a => a.name), ACTIONS.map(a => a.name));
  assert.deepEqual(result.areas.map(a => a.name), areas.map(a => a.name));
  assert.deepEqual(result.unsupported, UNSUPPORTED);
  for (const spec of ACTIONS) {
    const summary = result.actions.find(a => a.name === spec.name);
    assert.deepEqual(summary.required, spec.required);
    assert.equal(summary.mode, spec.mode);
    assert.equal(summary.memberFacing, spec.memberFacing);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < Buffer.byteLength(JSON.stringify(legacy)) * 0.65);
});

test('exact operation returns all notes and source requirements without unrelated areas', () => {
  const spec = ACTIONS.find(a => a.name === 'submitMemberMemo');
  const result = catalog(areas, { operation: spec.name });
  assert.equal(result.view, 'detail');
  assert.deepEqual(result.actions, [spec]);
  assert.equal(result.areas.length, 0);
  assert.ok(result.actions[0].notes.includes('writeQueue'));
});

test('exact area returns filters; full view preserves legacy metadata', () => {
  assert.deepEqual(catalog(areas, { area: 'memberProfiles' }).areas, [areas[0]]);
  assert.deepEqual(catalog(areas, { area: 'memberProfiles' }).actions, []);
  const full = catalog(areas, { view: 'detail' });
  assert.deepEqual(full.actions, ACTIONS);
  assert.deepEqual(full.areas, areas);
  assert.deepEqual(full.unsupported, UNSUPPORTED);
  const both = catalog(areas, { operation: ACTIONS[0].name, area: areas[0].name });
  assert.deepEqual(both.actions, [ACTIONS[0]]);
  assert.deepEqual(both.areas, [areas[0]]);
  assert.throws(() => catalog(areas, { operation: 'unknown' }), { code: 'UNKNOWN_ACTION' });
  assert.throws(() => catalog(areas, { area: 'unknown' }), { code: 'UNKNOWN_AREA' });
});
