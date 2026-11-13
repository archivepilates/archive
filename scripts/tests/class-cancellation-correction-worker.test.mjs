import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runClassCancellationCorrection as run} from '../lib/class-cancellation-correction-worker.mjs';

const clone = value => structuredClone(value);
const row = (patch = {}) => {
  const value = {date: '2026-11-21', startTime: '09:30', staffName: 'Synthetic Instructor',
    lessonType: '그룹', category: '그룹', title: 'Synthetic Group', room: '',
    cancelDeadline: '2026-11-21 03:30:00 까지', ...patch};
  value.nativeCells = [value.date, value.startTime, '10:20', value.staffName, value.lessonType, value.title,
    value.category, value.room, '6', '1', '4', '2026-11-01 09:00:00 까지', value.cancelDeadline, '2026-11-21 07:30:00 까지'];
  return value;
};
const setCell = (value, index, text) => {
  value.nativeCells[index] = text;
  const field = {0: 'date', 1: 'startTime', 3: 'staffName', 4: 'lessonType', 5: 'title', 6: 'category', 7: 'room', 12: 'cancelDeadline'}[index];
  if (field) value[field] = text;
};
function fixture(rows = [row()], hooks = {}) {
  const f = {rows: clone(rows), clock: '2026-11-13T10:00:00+09:00', exports: 0, reads: 0,
    calls: [], claims: [], updates: [], store: new Map(), submits: 0};
  f.adapter = {
    async exportClasses({from, through}) {
      f.exports++;
      await hooks.export?.(f);
      const value = {rows: clone(f.rows), total: f.rows.length, from, through, observedAt: f.clock,
        sourceHash: createHash('sha256').update(JSON.stringify(f.rows)).digest('hex')};
      return hooks.snapshot ? hooks.snapshot(value, f) : value;
    },
    async readClass(target) {
      f.reads++;
      await hooks.read?.(f);
      return clone(f.rows.find(value => value.title === target.title && value.room === target.room));
    },
    async correctClass(target, policy, {beforeSubmit}) {
      f.calls.push(clone({target, policy}));
      await hooks.beforeGuard?.(f);
      if (!hooks.skipGuard) await beforeSubmit();
      if (hooks.repeatGuard) await beforeSubmit();
      await hooks.afterGuard?.(f);
      f.submits++;
      const targetRow = f.rows.find(value => value.title === target.title && value.room === target.room);
      if (hooks.save) await hooks.save(targetRow, policy, f);
      else setCell(targetRow, 12, policy.expectedDeadline + ' 까지');
      await hooks.afterSave?.(f);
      return Object.hasOwn(hooks, 'outcome') ? hooks.outcome : {accepted: true};
    },
  };
  f.ledger = {
    async read(key) {return clone(f.store.get(key) ?? null);},
    async claim(key, evidence) {
      assert.match(key, /^[a-f0-9]{64}$/);
      f.claims.push(key);
      if (hooks.claim) return hooks.claim(key, evidence, f);
      if (f.store.has(key)) return false;
      f.store.set(key, {key, ...clone(evidence)});
      return true;
    },
    async update(key, patch) {
      f.updates.push(clone(patch));
      await hooks.update?.(key, patch, f);
      const previous = f.store.get(key);
      assert.ok(previous);
      assert.ok(!['verified', 'unknown'].includes(previous.status), 'terminal claim cannot be overwritten');
      assert.ok(['intent', 'submitted', 'unknown', 'verified', 'review'].includes(patch.status));
      f.store.set(key, {...previous, ...clone(patch)});
    },
  };
  f.options = extra => ({adapter: f.adapter, ledger: f.ledger, now: () => new Date(f.clock),
    from: '2026-11-13', through: '2026-12-31', apply: true, ...extra});
  return f;
}
const keyFor = async f => (await run(f.options({apply: false}))).details.find(detail => detail.key)?.key;
const statusOf = f => [...f.store.values()].map(value => value.status);

test('onlyKeys corrects exactly one target while auditing full source and preserving every other cell', async () => {
  const target = row({title: 'Selected'});
  const selectedKey = await keyFor(fixture([target]));
  const outside = row({title: 'Outside'});
  const outsideKey = await keyFor(fixture([outside]));
  const f = fixture([outside, target, row({title: 'Weekday', date: '2026-11-23'}),
    row({title: 'Private', lessonType: '프라이빗', category: ''})]);
  const original = clone(f.rows);
  const existingOutside = {status: 'unknown', reason: 'before_submit_blocked'};
  f.store.set(outsideKey, clone(existingOutside));
  const ledgerReads = [], ranges = [], counts = [];
  const read = f.ledger.read, exportClasses = f.adapter.exportClasses;
  f.ledger.read = async key => {ledgerReads.push(key); return read(key);};
  f.adapter.exportClasses = async range => {
    ranges.push(clone(range));
    const snapshot = await exportClasses(range);
    counts.push(snapshot.rows.length);
    return snapshot;
  };
  const result = await run(f.options({onlyKeys: [selectedKey]}));
  assert.equal(result.status, 'success');
  assert.equal(result.checkedCount, 2);
  assert.equal(result.mismatchCount, 2);
  assert.equal(result.correctedCount, 1);
  assert.equal(result.reviewCount, 0);
  assert.deepEqual(ledgerReads, [selectedKey]);
  assert.deepEqual(f.claims, [selectedKey]);
  assert.deepEqual(f.calls.map(call => call.target.title), ['Selected']);
  assert.deepEqual(result.details.find(detail => detail.key === outsideKey),
    {status: 'outside_operator_scope', key: outsideKey, matches: false});
  assert.deepEqual(f.store.get(outsideKey), existingOutside);
  assert.equal(ranges.length, 5);
  assert.ok(ranges.every(range => range.from === '2026-11-13' && range.through === '2026-12-31'));
  assert.deepEqual(counts, Array(5).fill(4));
  for (let i = 0; i < f.rows.length; i++) {
    if (i !== 1) assert.deepEqual(f.rows[i], original[i]);
    else {
      assert.equal(f.rows[i].cancelDeadline, '2026-11-20 21:00:00 까지');
      assert.deepEqual(f.rows[i].nativeCells.filter((_, column) => column !== 12),
        original[i].nativeCells.filter((_, column) => column !== 12));
    }
  }
});

for (const onlyKeys of [null, [], ['a'.repeat(64), 'a'.repeat(64)], ['a'.repeat(64), 'b'.repeat(64)],
  'a'.repeat(64), ['A'.repeat(64)], ['a'.repeat(63)], ['g'.repeat(64)], [123], [undefined], new Array(1)]) {
  test(`invalid onlyKeys blocks before source or ledger access: ${JSON.stringify(onlyKeys)}`, async () => {
    const f = fixture();
    f.ledger.read = async () => {assert.fail('invalid scope must not read ledger');};
    const result = await run(f.options({onlyKeys}));
    assert.equal(result.status, 'review');
    assert.equal(result.details[0].reason, 'invalid_only_keys');
    assert.equal(f.exports, 0);
    assert.equal(f.claims.length, 0);
    assert.equal(f.calls.length, 0);
  });
}

for (const status of ['intent', 'submitted', 'unknown', 'review', 'verified']) {
  test(`onlyKeys does not bypass selected ${status} claim`, async () => {
    const target = row();
    const selectedKey = await keyFor(fixture([target]));
    const f = fixture([target, row({title: 'Outside'})]);
    const existing = {status, reason: 'before_submit_blocked'};
    f.store.set(selectedKey, clone(existing));
    const result = await run(f.options({onlyKeys: [selectedKey]}));
    assert.equal(result.status, 'review');
    assert.equal(result.reviewCount, 1);
    assert.equal(result.correctedCount, 0);
    assert.deepEqual(f.store.get(selectedKey), existing);
    assert.equal(f.claims.length, 0);
    assert.equal(f.calls.length, 0);
  });
}

for (const patch of [{category: 'Unknown'}, {lessonType: 'Unknown'}, {cancelDeadline: 'invalid'}]) {
  test(`onlyKeys still blocks unrecognized out-of-scope weekend policy: ${JSON.stringify(patch)}`, async () => {
    const selected = row();
    const selectedKey = await keyFor(fixture([selected]));
    const f = fixture([selected, row({title: 'Invalid outside', ...patch})]);
    const result = await run(f.options({onlyKeys: [selectedKey]}));
    assert.equal(result.status, 'review');
    assert.equal(result.correctedCount, 0);
    assert.equal(f.claims.length, 0);
    assert.equal(f.calls.length, 0);
  });
}

for (const corrupt of [s => {s.total++;}, s => {s.rows[1].nativeCells.pop();},
  s => {s.rows.push(clone(s.rows[1])); s.total++;}, s => {s.from = '2026-11-14';}]) {
  test(`onlyKeys does not hide full-source corruption: ${corrupt.toString()}`, async () => {
    const selected = row();
    const selectedKey = await keyFor(fixture([selected]));
    const f = fixture([selected, row({title: 'Outside'})], {snapshot: s => {corrupt(s); return s;}});
    const result = await run(f.options({onlyKeys: [selectedKey]}));
    assert.equal(result.status, 'review');
    assert.equal(f.claims.length, 0);
    assert.equal(f.calls.length, 0);
  });
}

test('onlyKeys detects unrelated changes during selected correction readback', async () => {
  const selected = row();
  const selectedKey = await keyFor(fixture([selected]));
  const f = fixture([selected, row({title: 'Outside'})], {afterSave: f => {setCell(f.rows[1], 8, '7');}});
  const result = await run(f.options({onlyKeys: [selectedKey]}));
  assert.equal(result.status, 'review');
  assert.equal(result.correctedCount, 0);
  assert.deepEqual(statusOf(f), ['unknown']);
});

test('onlyKeys not present in current source requires review without ledger access', async () => {
  const f = fixture();
  f.ledger.read = async () => {assert.fail('out-of-scope ledger must not be read');};
  const result = await run(f.options({onlyKeys: ['0'.repeat(64)]}));
  assert.equal(result.status, 'review');
  assert.equal(result.correctedCount, 0);
  assert.ok(result.details.some(detail => detail.reason === 'operator_scope_key_not_found'));
  assert.equal(f.claims.length, 0);
  assert.equal(f.calls.length, 0);
});

test('safe edit uses minutes, claims first, and independently verifies only cancellation', async () => {
  const original = row();
  const f = fixture([original], {beforeGuard: f => {
    assert.deepEqual(statusOf(f), ['intent']);
    assert.equal(f.submits, 0);
  }});
  const result = await run(f.options());
  assert.deepEqual({...result, details: []}, {ok: true, status: 'success', checkedCount: 1,
    mismatchCount: 1, correctedCount: 1, reviewCount: 0, deferredCount: 0, details: [], bookingRosterVerified: false});
  assert.equal(f.calls[0].policy.leadHours, 12);
  assert.equal(f.calls[0].policy.leadMinutes, 30);
  assert.equal(f.rows[0].cancelDeadline, '2026-11-20 21:00:00 까지');
  assert.deepEqual(f.rows[0].nativeCells.filter((_, i) => i !== 12), original.nativeCells.filter((_, i) => i !== 12));
  assert.deepEqual(f.updates.map(patch => patch.status), ['submitted', 'verified']);
  assert.equal(f.exports, 5);
  assert.equal(f.reads, 3);
  assert.deepEqual(statusOf(f), ['verified']);
});

test('no-op and excluded/weekday/holiday dates never claim', async () => {
  const f = fixture([row({cancelDeadline: '2026-11-20 21:00:00까지'}),
    row({title: 'Weekday', date: '2026-11-23'}),
    row({title: 'Private', lessonType: '프라이빗', category: ''}),
    row({title: 'Special', category: '강사레슨'})]);
  const result = await run(f.options());
  assert.equal(result.ok, true);
  assert.equal(result.checkedCount, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(f.claims.length, 0);
  assert.equal(f.exports, 1);
});

test('dry-run is default and has no claims or detail/UI calls', async () => {
  const f = fixture();
  const options = f.options(); delete options.apply;
  const result = await run(options);
  assert.equal(result.status, 'deferred');
  assert.equal(result.deferredCount, 1);
  assert.equal(f.claims.length, 0);
  assert.equal(f.reads, 0);
  assert.equal(f.calls.length, 0);
});

for (const status of ['intent', 'submitted', 'unknown', 'review', 'verified', 'unrecognized']) {
  test(`existing ${status} mismatch never replays`, async () => {
    const f = fixture();
    const key = await keyFor(f);
    f.store.set(key, {status});
    const result = await run(f.options());
    assert.equal(result.status, 'review');
    assert.equal(f.calls.length, 0);
    assert.equal(f.claims.length, 0);
    assert.equal(result.details[0].reason, status === 'verified' ? 'verified_policy_drift' : 'existing_claim_blocks_replay');
  });
}

for (const status of ['intent', 'submitted', 'unknown', 'review', 'verified', 'unrecognized']) {
  test(`existing ${status} blocks only its exact row while independent correction succeeds`, async () => {
    const f = fixture([row(), row({title: 'Independent'})]);
    const key = await keyFor(f);
    const existing = {status, reason: 'before_submit_blocked', history: [{status: 'intent'}]};
    f.store.set(key, clone(existing));
    const original = clone(f.rows[0]);
    const result = await run(f.options());
    assert.equal(result.ok, false);
    assert.equal(result.status, 'partial');
    assert.equal(result.checkedCount, 2);
    assert.equal(result.mismatchCount, 2);
    assert.equal(result.correctedCount, 1);
    assert.equal(result.reviewCount, 1);
    assert.equal(result.deferredCount, 0);
    assert.equal(result.details[0].reason, status === 'verified' ? 'verified_policy_drift' : 'existing_claim_blocks_replay');
    assert.deepEqual(f.store.get(key), existing);
    assert.deepEqual(f.rows[0], original);
    assert.deepEqual(f.calls.map(call => call.target.title), ['Independent']);
    assert.equal(f.claims.length, 1);
    assert.notEqual(f.claims[0], key);
    assert.deepEqual(statusOf(f), [status, 'verified']);
    assert.equal(f.rows[1].cancelDeadline, '2026-11-20 21:00:00 까지');
  });
}

test('unknown matching row remains immutable while another mismatch is corrected', async () => {
  const f = fixture([row(), row({title: 'Independent'})]);
  const key = await keyFor(f);
  const existing = {status: 'unknown', reason: 'before_submit_blocked'};
  f.store.set(key, clone(existing));
  setCell(f.rows[0], 12, '2026-11-20 21:00:00');
  const result = await run(f.options());
  assert.equal(result.status, 'partial');
  assert.equal(result.reviewCount, 1);
  assert.equal(result.mismatchCount, 1);
  assert.equal(result.correctedCount, 1);
  assert.deepEqual(f.store.get(key), existing);
  assert.deepEqual(f.calls.map(call => call.target.title), ['Independent']);
});

for (const patch of [{category: 'Unknown'}, {lessonType: 'Unknown'}, {cancelDeadline: 'invalid'}]) {
  test(`unrecognized weekend policy still blocks independent valid rows ${JSON.stringify(patch)}`, async () => {
    const f = fixture([row(), row({title: 'Blocked policy', ...patch})]);
    const result = await run(f.options());
    assert.equal(result.status, 'review');
    assert.equal(result.reviewCount, 1);
    assert.equal(result.correctedCount, 0);
    assert.equal(f.claims.length, 0);
    assert.equal(f.calls.length, 0);
  });
}

test('verified unchanged record is no-op; unknown matching source remains blocked', async () => {
  const f = fixture();
  const key = await keyFor(f);
  setCell(f.rows[0], 12, '2026-11-20 21:00:00');
  f.store.set(key, {status: 'verified'});
  assert.equal((await run(f.options())).status, 'success');
  f.store.set(key, {status: 'unknown'});
  assert.equal((await run(f.options())).status, 'review');
  assert.equal(f.calls.length, 0);
});

test('repeat after successful correction cannot claim again; future drift requires review', async () => {
  const f = fixture();
  assert.equal((await run(f.options())).correctedCount, 1);
  assert.equal((await run(f.options())).correctedCount, 0);
  setCell(f.rows[0], 12, '2026-11-21 03:30:00');
  assert.equal((await run(f.options())).status, 'review');
  assert.equal(f.calls.length, 1);
  assert.equal(f.claims.length, 1);
});

test('claim race loses without entering native corrector', async () => {
  const f = fixture(undefined, {claim: () => false});
  assert.equal((await run(f.options())).status, 'review');
  assert.equal(f.calls.length, 0);
});

test('canonical key is stable and room-sensitive, with exact identity, studio and policy versions', async () => {
  const a = fixture(), b = fixture(), other = fixture([row({room: 'Other'})]);
  const key = await keyFor(a);
  assert.equal(key, await keyFor(b));
  assert.notEqual(key, await keyFor(other));
  const source = a.rows[0];
  assert.equal(key, createHash('sha256').update(JSON.stringify(['5330', 'weekend_cancellation_correction_v1',
    'class_cancellation_policy_v1', source.date, source.startTime, source.staffName, source.lessonType,
    source.category, source.title, source.room, '2026-11-20 21:00:00'])).digest('hex'));
});

for (const [name, change] of [
  ['count mismatch', s => {s.total++;}],
  ['incomplete rows', s => {s.rows = [];}],
  ['range mismatch', s => {s.from = '2026-11-14';}],
  ['duplicate', s => {s.rows.push(clone(s.rows[0])); s.total++;}],
  ['stale', s => {s.observedAt = '2026-11-13T09:54:59+09:00';}],
  ['future', s => {s.observedAt = '2026-11-13T10:00:01+09:00';}],
  ['bad timestamp', s => {s.observedAt = '2026-11-13T24:00:00+09:00';}],
  ['missing hash', s => {delete s.sourceHash;}],
  ['bad hash', s => {s.sourceHash = 'not-file-proof';}],
  ['short cells', s => {s.rows[0].nativeCells.pop();}],
  ['sparse cells', s => {delete s.rows[0].nativeCells[8];}],
  ['noncanonical', s => {s.rows[0].staffName = 'Contradiction';}],
  ['unknown weekend', s => {setCell(s.rows[0], 6, 'Unknown');}],
  ['bad deadline', s => {setCell(s.rows[0], 12, 'bad');}],
  ['bad date', s => {setCell(s.rows[0], 0, '2026-11-31');}],
]) {
  test(`${name} blocks the entire run before claim`, async () => {
    const f = fixture(undefined, {snapshot: s => {change(s); return s;}});
    assert.equal((await run(f.options())).status, 'review');
    assert.equal(f.claims.length, 0);
    assert.equal(f.calls.length, 0);
  });
}

test('empty independently observed full source is valid', async () => {
  const f = fixture([]);
  assert.equal((await run(f.options())).status, 'success');
});

for (const clock of ['2026-11-13T08:59:59+09:00', '2026-11-13T23:00:00+09:00']) {
  test(`quiet window ${clock} defers without claim`, async () => {
    const f = fixture(); f.clock = clock;
    assert.equal((await run(f.options())).status, 'deferred');
    assert.equal(f.claims.length, 0);
  });
}
for (const clock of ['2026-11-13T09:00:00+09:00', '2026-11-13T22:59:59+09:00']) {
  test(`allowed boundary ${clock}`, async () => {
    const f = fixture(); f.clock = clock;
    assert.equal((await run(f.options())).correctedCount, 1);
  });
}
for (const clock of ['2026-11-13T21:00:00+09:00', '2026-11-14T10:00:00+09:00']) {
  test(`past or exact expected cutoff ${clock} is never applied`, async () => {
    const f = fixture([row({date: '2026-11-14'})]); f.clock = clock;
    const result = await run(f.options({from: clock.slice(0, 10)}));
    assert.equal(result.status, 'deferred');
    assert.equal(result.details[0].reason, 'cutoff_not_future');
    assert.equal(f.claims.length, 0);
  });
}

test('crossing 23:00 after intent is blocked at immediate beforeSubmit', async () => {
  const f = fixture(undefined, {beforeGuard: f => {f.clock = '2026-11-13T23:00:00+09:00';}});
  const result = await run(f.options());
  assert.equal(result.status, 'review');
  assert.equal(f.submits, 0);
  assert.deepEqual(statusOf(f), ['unknown']);
});

for (const extra of [{from: '2026-11-14'}, {through: '2026-12-30'}, {through: '2027-01-01'},
  {from: '2026-02-30'}, {maxCorrections: -1}, {maxCorrections: 7}, {maxCorrections: 1.1}, {apply: 'yes'}, {now: new Date('2026-11-13T01:00:00Z')}]) {
  test(`invalid option fails closed ${JSON.stringify(extra)}`, async () => {
    const f = fixture();
    assert.equal((await run(f.options(extra))).status, 'review');
    assert.equal(f.exports, 0);
    assert.equal(f.claims.length, 0);
  });
}

test('horizon supports year crossover and inclusive 62-day bound', async () => {
  const f = fixture([]); f.clock = '2026-12-01T10:00:00+09:00';
  assert.equal((await run(f.options({from: '2026-12-01', through: '2027-01-31'}))).ok, true);
});

for (const at of [2, 3]) {
  test(`whole-table concurrent edit at export ${at} stops save`, async () => {
    const f = fixture([row(), row({title: 'Untouched', date: '2026-11-23'})], {
      export: f => {if (f.exports === at) setCell(f.rows[1], 8, '7');},
    });
    assert.equal((await run(f.options())).status, 'review');
    assert.equal(f.submits, 0);
    assert.equal(f.claims.length, at === 2 ? 0 : 1);
  });
}

test('fresh detail differs from Excel and blocks before claim', async () => {
  const f = fixture(undefined, {read: f => {setCell(f.rows[0], 8, '7');}});
  assert.equal((await run(f.options())).status, 'review');
  assert.equal(f.claims.length, 0);
});

test('slow detail makes source older than five minutes and blocks claim', async () => {
  const f = fixture(undefined, {read: f => {f.clock = '2026-11-13T10:05:01+09:00';}});
  assert.equal((await run(f.options())).status, 'review');
  assert.equal(f.claims.length, 0);
});

test('source export failure does not claim or transport', async () => {
  const f = fixture(undefined, {export: () => {throw Error('synthetic_export_failure');}});
  assert.equal((await run(f.options())).status, 'review');
  assert.equal(f.claims.length, 0);
});

for (const hooks of [{skipGuard: true}, {repeatGuard: true}, {outcome: undefined}, {outcome: {accepted: false}},
  {beforeGuard: () => {throw Error('synthetic_editor_failure');}},
  {afterSave: () => {throw Error('synthetic_transport_failure');}},
  {save: () => {}},
  {save: target => {setCell(target, 12, '2026-11-20 21:00:01');}},
]) {
  test(`partial/unknown/native failure never retries ${Object.keys(hooks).join(',')}`, async () => {
    const f = fixture([row(), row({title: 'Second'})], hooks);
    const result = await run(f.options());
    assert.equal(result.status, 'review');
    assert.equal(result.correctedCount, 0);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(statusOf(f), ['unknown']);
    assert.equal(result.deferredCount, 1);
    assert.equal((await run(f.options())).status, 'review');
    assert.deepEqual(f.calls.map(call => call.target.title), ['Synthetic Group', 'Second']);
    assert.deepEqual(statusOf(f), ['unknown', 'unknown']);
    await run(f.options());
    assert.equal(f.calls.length, 2);
  });
}

for (let column = 0; column < 14; column++) {
  if (column === 12) continue;
  test(`post-save change in column ${column} cannot be verified`, async () => {
    const f = fixture(undefined, {save: (target, policy) => {
      setCell(target, 12, policy.expectedDeadline);
      setCell(target, column, 'Unexpected');
    }});
    assert.equal((await run(f.options())).status, 'review');
    assert.deepEqual(statusOf(f), ['unknown']);
  });
}

test('non-target change visible only in full export prevents verification', async () => {
  const f = fixture([row(), row({title: 'Untouched', date: '2026-11-23'})], {
    afterSave: f => {setCell(f.rows[1], 11, 'Changed');},
  });
  assert.equal((await run(f.options())).status, 'review');
  assert.deepEqual(statusOf(f), ['unknown']);
});

test('DOM booking-change setting is preserved independently from Excel', async () => {
  const f = fixture([row({uiBookingChange: {enabled: true, hours: 2}})], {
    afterSave: f => {f.rows[0].uiBookingChange.hours = 3;},
  });
  assert.equal((await run(f.options())).status, 'review');
  assert.deepEqual(statusOf(f), ['unknown']);
  const good = fixture([row({uiBookingChange: 'unchanged'})]);
  assert.equal((await run(good.options())).ok, true);
});

test('max six per run audits all rows and rebaselines after each edit', async () => {
  const f = fixture(Array.from({length: 8}, (_, i) => row({title: `Synthetic ${i}`})));
  const result = await run(f.options());
  assert.equal(result.status, 'partial');
  assert.equal(result.checkedCount, 8);
  assert.equal(result.mismatchCount, 8);
  assert.equal(result.correctedCount, 6);
  assert.equal(result.deferredCount, 2);
  assert.equal(f.calls.length, 6);
  assert.deepEqual(statusOf(f), Array(6).fill('verified'));
});

test('bound does not hide malformed or duplicate rows after the sixth candidate', async () => {
  const rows = Array.from({length: 7}, (_, i) => row({title: `Synthetic ${i}`}));
  rows.push(clone(rows[6]));
  const f = fixture(rows);
  assert.equal((await run(f.options())).status, 'review');
  assert.equal(f.claims.length, 0);
});

test('zero bound defers every mismatch without claims', async () => {
  const f = fixture();
  const result = await run(f.options({maxCorrections: 0}));
  assert.equal(result.status, 'deferred');
  assert.equal(f.claims.length, 0);
});

test('second native failure reports partial and never repeats the unknown', async () => {
  const f = fixture([row(), row({title: 'Second'})], {
    beforeGuard: f => {if (f.calls.length === 2) throw Error('synthetic_second_failure');},
  });
  const result = await run(f.options());
  assert.equal(result.status, 'partial');
  assert.equal(result.correctedCount, 1);
  assert.deepEqual(statusOf(f), ['verified', 'unknown']);
});

test('final cumulative source comparison catches drift after individual verification', async () => {
  const f = fixture(undefined, {export: f => {if (f.exports === 5) setCell(f.rows[0], 8, '7');}});
  const result = await run(f.options());
  assert.equal(result.status, 'partial');
  assert.ok(result.details.some(detail => detail.reason === 'final_full_range_mismatch'));
  assert.deepEqual(statusOf(f), ['verified']);
  assert.equal(f.updates.length, 2, 'never rewrite a terminal verified claim');
});

test('durable submitted update failure records unknown and stops', async () => {
  const f = fixture(undefined, {update: (_, patch) => {if (patch.status === 'submitted') throw Error('synthetic_disk_failure');}});
  assert.equal((await run(f.options())).status, 'review');
  assert.deepEqual(statusOf(f), ['unknown']);
});

test('unknown persistence failure remains review with intent blocking future replay', async () => {
  const f = fixture(undefined, {beforeGuard: () => {throw Error('synthetic_ui_failure');},
    update: () => {throw Error('synthetic_disk_failure');}});
  const result = await run(f.options());
  assert.equal(result.status, 'review');
  assert.ok(result.details.some(detail => detail.reason === 'ledger_update_failed'));
  assert.deepEqual(statusOf(f), ['intent']);
  await run(f.options());
  assert.equal(f.calls.length, 1);
});

test('input rows are isolated and public result is aggregate except private details', async () => {
  const rows = [row()]; const original = clone(rows);
  const f = fixture(rows);
  const result = await run(f.options());
  assert.deepEqual(rows, original);
  const {details, ...aggregate} = result;
  assert.ok(!JSON.stringify(aggregate).includes('Synthetic'));
  assert.equal(details[0].status, 'verified');
});

for (const stage of [2, 3, 4, 5]) {
  test(`export failure at stage ${stage} stops with exact no-replay state`, async () => {
    const f = fixture(undefined, {export: f => {if (f.exports === stage) throw Error('synthetic_export_failure');}});
    const result = await run(f.options());
    assert.equal(result.status, stage === 5 ? 'partial' : 'review');
    assert.equal(f.submits, stage >= 4 ? 1 : 0);
    assert.deepEqual(statusOf(f), stage === 2 ? [] : stage === 5 ? ['verified'] : ['unknown']);
  });
}

test('exactly five-minute source age is accepted', async () => {
  const f = fixture(undefined, {snapshot: s => ({...s, observedAt: '2026-11-13T09:55:00+09:00'})});
  assert.equal((await run(f.options())).ok, true);
});

test('day rollover or clock regression at beforeSubmit never submits', async () => {
  for (const clock of ['2026-11-14T09:00:00+09:00', '2026-11-13T09:59:59+09:00']) {
    const f = fixture(undefined, {beforeGuard: f => {f.clock = clock;}});
    assert.equal((await run(f.options())).status, 'review');
    assert.equal(f.submits, 0);
    assert.deepEqual(statusOf(f), ['unknown']);
  }
});

test('claim finishing during quiet hours does not enter editor', async () => {
  const f = fixture(undefined, {claim: (key, evidence, f) => {
    f.store.set(key, clone(evidence));
    f.clock = '2026-11-13T23:00:00+09:00';
    return true;
  }});
  assert.equal((await run(f.options())).status, 'review');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(statusOf(f), ['review']);
});

test('ledger read failure and ambiguous claim persistence prevent native entry', async () => {
  const readFailed = fixture();
  readFailed.ledger.read = () => {throw Error('synthetic_read_failure');};
  assert.equal((await run(readFailed.options())).status, 'review');
  assert.equal(readFailed.claims.length, 0);
  const f = fixture(undefined, {claim: (key, evidence, f) => {
    f.store.set(key, clone(evidence));
    throw Error('synthetic_claim_fsync_failure');
  }});
  assert.equal((await run(f.options())).status, 'review');
  assert.deepEqual(statusOf(f), ['intent']);
  await run(f.options());
  assert.equal(f.calls.length, 0);
});

test('verified persistence failure after transport remains unknown, not corrected', async () => {
  const f = fixture(undefined, {update: (_, patch) => {if (patch.status === 'verified') throw Error('synthetic_verify_disk_failure');}});
  const result = await run(f.options());
  assert.equal(result.correctedCount, 0);
  assert.equal(result.status, 'review');
  assert.deepEqual(statusOf(f), ['unknown']);
});

test('non-Error native throw still persists unknown and returns aggregate review', async () => {
  const f = fixture(undefined, {afterSave: () => {throw null;}});
  assert.equal((await run(f.options())).status, 'review');
  assert.deepEqual(statusOf(f), ['unknown']);
});

test('451 independently observed correct rows produce a no-claim no-op', async () => {
  const f = fixture(Array.from({length: 451}, (_, i) => row({title: `Synthetic ${i}`, cancelDeadline: '2026-11-20 21:00:00'})));
  const result = await run(f.options());
  assert.equal(result.checkedCount, 451);
  assert.equal(result.ok, true);
  assert.equal(f.exports, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.claims.length, 0);
});
