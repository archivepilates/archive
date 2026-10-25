import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { SITE, UNIT, STAFF_GRADE, assertMemberPreserved } from '../lib/imweb-staff-video-policy.mjs';
import { C261025_SHARE, D261025_SHARE } from '../lib/imweb-student-share-policy.mjs';

const source = readFileSync(new URL('../qa-lesson-261025.mjs', import.meta.url), 'utf8');
const start = source.indexOf('const ROOT =');
const end = source.lastIndexOf('\nmain().catch(');
assert.ok(start >= 0 && end > start, 'Only the bounded runner body may execute with mock IO');
const body = source.slice(start, end);
const ROOT = '/synthetic-home/Library/Application Support/ARCHIVE PILATES/lesson-videos-261025';
const RECEIPT = `${ROOT}/qa-member.json`, SNAPSHOT = `${ROOT}/member-snapshot.json`;
const TEST_MEMBER = 'm20260701062ea69cfb285';
const C = 'g202610257569d3a4255d5', D = 'g202610252ef2256e312c1';
const copy = value => structuredClone(value);

function fixture(options = {}) {
  const baseline = { memberCode: TEST_MEMBER, uid: 'synthetic-qa-uid', name: 'Codex 테스트',
    siteCode: SITE, unitCode: UNIT, grade: 'ordinary', point: 123, coupon: ['baseline-coupon'],
    group: ['paid', 'E-existing', 'A-existing', 'B-existing'] };
  let live = copy({ ...baseline, ...options.member });
  const files = new Map([[SNAPSHOT, JSON.stringify({ list: options.snapshot || [copy(baseline)] })]]);
  if (options.receipt) files.set(RECEIPT, JSON.stringify(options.receipt(copy(baseline))));
  const reads = [], calls = [], saves = [], output = [], events = [], handles = new Map();
  const counters = { acquired: 0, released: 0, writes: 0, dry: 0, detail: 0, closes: 0 };
  let held = false, fd = 0;
  const receipt = () => files.has(RECEIPT) ? JSON.parse(files.get(RECEIPT)) : undefined;
  const fs = {
    existsSync: file => files.has(file),
    lstatSync(file) {
      return { isFile: () => !(options.unsafeReceipt === 'directory' && file === RECEIPT),
        isSymbolicLink: () => file === RECEIPT && options.unsafeReceipt === 'symlink'
          || file === SNAPSHOT && options.unsafeSnapshot === 'symlink',
        uid: file === RECEIPT && options.unsafeReceipt === 'owner'
          || file === SNAPSHOT && options.unsafeSnapshot === 'owner' ? 999 : 123,
        mode: file === RECEIPT && options.unsafeReceipt === 'mode'
          || file === SNAPSHOT && options.unsafeSnapshot === 'mode' ? 0o644 : 0o600 };
    },
    readFileSync(file) {
      assert.ok([RECEIPT, SNAPSHOT].includes(file)); assert.ok(held);
      reads.push(file); return files.get(file);
    },
    openSync(file, flags, mode) {
      if (flags === 'wx') {
        assert.equal(file, `${RECEIPT}.42.tmp`); assert.equal(mode, 0o600);
        assert.ok(!files.has(file)); files.set(file, '');
      } else { assert.equal(file, ROOT); assert.equal(flags, 'r'); }
      handles.set(++fd, file); return fd;
    },
    writeSync(handle, value) {
      const state = JSON.parse(value);
      if (options.failIntent && state.intent) throw Error('Synthetic intent persistence failed');
      files.set(handles.get(handle), value);
    },
    fsyncSync() {}, closeSync(handle) { handles.delete(handle); },
    renameSync(from, to) {
      assert.equal(to, RECEIPT); files.set(to, files.get(from)); files.delete(from);
      saves.push(copy(receipt())); events.push('save');
    },
  };
  const bindings = { fs, os: { homedir: () => '/synthetic-home' }, path,
    isDeepStrictEqual: (a, b) => isDeepStrictEqual(copy(a), copy(b)),
    SITE, UNIT, STAFF_GRADE,
    assertMemberPreserved: (before, after, groups) => assertMemberPreserved(copy(before), copy(after), copy(groups)),
    C261025_SHARE, D261025_SHARE,
    MEMBER_GROUP_LOCK: '/synthetic-shared-member-group.lock',
    process: { argv: ['node', 'synthetic-qa', ...(options.args || ['C'])], pid: 42, getuid: () => 123, stdin: {} },
    console: { log: text => output.push(JSON.parse(text)) },
    acquireStudioMateBrowserLock: async input => {
      counters.acquired++;
      assert.equal(input.lockPath, '/synthetic-shared-member-group.lock');
      assert.equal(input.owner, 'lesson-share-261025-qa');
      if (options.busy) throw Error('Synthetic shared lock busy');
      assert.equal(held, false); held = true; events.push('lock');
      return async () => { assert.ok(held); held = false; counters.released++; events.push('release'); };
    },
    imwebJson: args => {
      assert.ok(held); calls.push(copy(args));
      if (args[0] === 'config') return options.context || { resolved_profile: { site_code: SITE, unit_code: UNIT },
        token: { status: 'healthy' }, remote_context: { write_ready: true } };
      if (args[1] === 'get') {
        counters.detail++; const member = copy(live); options.detail?.(member, counters.detail);
        return { data: member };
      }
      assert.equal(args[1], 'update'); assert.equal(args[2], 'groups');
      const payload = JSON.parse(args[args.indexOf('--data') + 1]);
      if (args.includes('--dry-run')) {
        counters.dry++;
        const result = { confirmation_token: 'synthetic-confirmation', body: payload };
        options.dry?.(result, counters.dry); return result;
      }
      assert.ok(args.includes('--yes'));
      assert.equal(args[args.indexOf('--confirm-token') + 1], 'synthetic-confirmation');
      assert.deepEqual(receipt().intent.afterGroups, payload.groupCodes, 'Persist intent before mock write');
      counters.writes++; events.push(`write:${payload.groupCodes.includes(C) ? 'C' : payload.groupCodes.includes(D) ? 'D' : 'restore'}`);
      if (options.failBefore === counters.writes) throw Error('Synthetic unknown write before mutation');
      live.group = payload.groupCodes;
      if (options.failAfter === counters.writes) throw Error('Synthetic unknown write after mutation');
      return {};
    },
    readline: { createInterface: ({ input }) => {
      assert.equal(input, bindings.process.stdin); assert.ok(held); events.push('reader');
      return {
        async *[Symbol.asyncIterator]() {
          let index = 0;
          for (const command of options.lines || ['C', 'D', 'quit']) {
            assert.ok(held, 'Workflow lock remains held while waiting for browser/operator commands');
            options.between?.(live, index++);
            if (command instanceof Error) throw command;
            yield command;
          }
        },
        close() {
          counters.closes++; events.push('reader-close'); assert.ok(held);
          if (options.failReaderClose) throw Error('Synthetic reader close failed');
        },
      };
    } },
  };
  const main = runInNewContext(`${body}\nmain;`, bindings);
  return { main, baseline, receipt, files, reads, calls, saves, output, events, handles, counters, bindings,
    get live() { return live; }, get held() { return held; },
    run: async mode => { bindings.process.argv = ['node', 'synthetic-qa', mode]; await main(); } };
}

test('scope pins the separate C/D evidence directory, dedicated member and exact groups', () => {
  assert.match(source, /lesson-videos-261025/);
  assert.match(source, /const TEST_MEMBER = 'm20260701062ea69cfb285'/);
  assert.match(source, /const TEST_GROUPS = \{ C: C261025_SHARE\.groupCode, D: D261025_SHARE\.groupCode \}/);
  assert.equal(C261025_SHARE.groupCode, C); assert.equal(D261025_SHARE.groupCode, D);
});

for (const args of [[], ['A'], ['B'], ['E'], ['c'], ['--apply'], ['C', '--force'], ['restore', 'D']]) {
  test(`invalid CLI scope refuses before lock/IO: ${JSON.stringify(args)}`, async () => {
    const f = fixture({ args }); await assert.rejects(f.main());
    assert.equal(f.counters.acquired, 0); assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0);
  });
}

for (const context of [{}, { resolved_profile: { site_code: SITE, unit_code: 'wrong' } },
  { resolved_profile: { site_code: SITE, unit_code: UNIT }, token: { status: 'expired' }, remote_context: { write_ready: true } }]) {
  test('wrong context refuses before private snapshot reads or writes', async () => {
    const f = fixture({ context }); await assert.rejects(f.main(), /context mismatch/);
    assert.equal(f.reads.length, 0); assert.equal(f.counters.writes, 0); assert.equal(f.counters.released, 1);
  });
}

for (const kind of ['mode', 'owner', 'symlink']) test(`unsafe ${kind} snapshot refuses before its contents are read`, async () => {
  const f = fixture({ unsafeSnapshot: kind }); await assert.rejects(f.main(), /Unsafe test identity evidence/);
  assert.equal(f.reads.length, 0); assert.equal(f.counters.writes, 0);
});

for (const snapshot of [[], [{ memberCode: 'other', uid: 'other', name: 'Codex 테스트' }],
  [{ memberCode: TEST_MEMBER, uid: 'one', name: 'Codex 테스트' }, { memberCode: TEST_MEMBER, uid: 'two', name: 'Codex 테스트' }]]) {
  test('missing, wrong or duplicated snapshot identity refuses', async () => {
    const f = fixture({ snapshot }); await assert.rejects(f.main(), /Dedicated test identity required/);
    assert.equal(f.counters.detail, 0); assert.equal(f.counters.writes, 0);
  });
}

for (const member of [{ memberCode: 'other' }, { siteCode: 'other' }, { unitCode: 'other' },
  { grade: STAFF_GRADE }, { group: null }, { name: 'Repurposed account' }, { uid: 'other-native-uid' }]) {
  test(`live dedicated identity rejects ${Object.keys(member).join(',')}`, async () => {
    const f = fixture({ member }); await assert.rejects(f.main(), /Invalid test member|identity/i);
    assert.equal(f.counters.writes, 0); assert.equal(f.saves.length, 0);
  });
}

for (const unsafeReceipt of ['mode', 'owner', 'symlink', 'directory']) test(`unsafe ${unsafeReceipt} receipt refuses before its contents are read`, async () => {
  const f = fixture({ unsafeReceipt, receipt: baseline => ({ baseline, lastVerifiedGroups: baseline.group }) });
  await assert.rejects(f.main(), /Unsafe QA receipt/);
  assert.deepEqual(f.reads, [SNAPSHOT]); assert.equal(f.counters.writes, 0);
});

test('single C to D to restore preserves baseline, metadata and unrelated rights', async () => {
  const f = fixture(); await f.run('C');
  assertMemberPreserved(f.baseline, f.live, [...f.baseline.group, C]);
  assert.equal(f.receipt().intent, undefined);
  await f.run('D');
  assertMemberPreserved(f.baseline, f.live, [...f.baseline.group, D]);
  await f.run('restore'); assert.deepEqual(f.live, f.baseline);
  assert.deepEqual(f.receipt().baseline, f.baseline); assert.equal(f.receipt().lastMode, 'restore');
  assert.ok(f.saves.every(state => state.baseline.memberCode === TEST_MEMBER));
  assert.equal(f.counters.writes, 3); assert.equal(f.counters.acquired, 3); assert.equal(f.counters.released, 3);
  assert.equal(f.handles.size, 0);
});

test('repeat C and repeat restore are idempotent without additional writes or dry-runs', async () => {
  const f = fixture(); await f.run('C'); await f.run('C');
  assert.equal(f.counters.writes, 1); assert.equal(f.counters.dry, 1);
  await f.run('restore'); await f.run('restore'); assert.equal(f.counters.writes, 2); assert.equal(f.counters.dry, 2);
});

test('preexisting C/D groups without a QA receipt cannot be adopted or removed', async () => {
  for (const code of [C, D]) {
    const f = fixture({ member: { group: ['paid', code] } });
    await assert.rejects(f.run('restore'), /predates this QA/); assert.equal(f.counters.writes, 0);
  }
});

test('concurrent groups or changed baseline metadata refuse restoration', async () => {
  for (const change of [member => member.group.push('new-purchase'), member => member.point++, member => { member.grade = STAFF_GRADE; }]) {
    const f = fixture(); await f.run('C'); change(f.live);
    const before = copy(f.live); await assert.rejects(f.run('restore'));
    assert.deepEqual(f.live, before); assert.equal(f.counters.writes, 1);
  }
});

test('mismatched unknown intent refuses without retry or forced baseline restore', async () => {
  const f = fixture({ receipt: baseline => ({ baseline, lastVerifiedGroups: baseline.group,
    intent: { mode: 'C', afterGroups: [...baseline.group, C] } }) });
  await assert.rejects(f.run('restore'), /Unresolved QA write/);
  assert.equal(f.counters.writes, 0); assert.equal(f.saves.length, 0); assert.equal(f.receipt().intent.mode, 'C');
});

test('known accepted intent reconciles by readback before restoring, never replaying C', async () => {
  const f = fixture({ receipt: baseline => ({ baseline, lastVerifiedGroups: baseline.group,
    intent: { mode: 'C', afterGroups: [...baseline.group, C] } }) });
  f.live.group.push(C); await f.run('restore');
  assert.deepEqual(f.live, f.baseline); assert.equal(f.counters.writes, 1);
  assert.deepEqual(f.events.filter(event => event.startsWith('write:')), ['write:restore']);
});

for (const mode of ['A', 'E', 'unknown', 'C']) test(`out-of-scope ${mode} receipt must not adopt unrelated groups as QA-owned`, async () => {
  const f = fixture({ receipt: baseline => ({ baseline, lastVerifiedGroups: baseline.group,
    intent: { mode, afterGroups: [...baseline.group, 'unrelated-entitlement'] } }) });
  f.live.group.push('unrelated-entitlement'); const before = copy(f.live);
  await assert.rejects(f.run('restore'), /intent|receipt|scope|mode/i);
  assert.deepEqual(f.live, before); assert.equal(f.counters.writes, 0);
});

for (const dry of [value => { delete value.confirmation_token; }, value => { value.body.unitCode = 'wrong'; },
  value => { value.body.groupCodes.push('unrelated'); }]) test('dry-run mismatch refuses before intent/dispatch', async () => {
  const f = fixture({ dry }); await assert.rejects(f.run('C'), /dry-run mismatch/);
  assert.equal(f.counters.writes, 0); assert.equal(f.receipt().intent, undefined);
});

test('fresh member change after dry-run refuses before intent', async () => {
  const f = fixture({ detail(member, count) { if (count === 2) member.group.push('concurrent'); } });
  await assert.rejects(f.run('C')); assert.equal(f.counters.writes, 0); assert.equal(f.receipt().intent, undefined);
});

test('failed intent persistence prevents provider dispatch', async () => {
  const f = fixture({ failIntent: true }); await assert.rejects(f.run('C'), /persistence failed/);
  assert.equal(f.counters.writes, 0); assert.equal(f.counters.released, 1); assert.equal(f.handles.size, 0);
});

test('bulk confirmation is passed along with ordinary confirmation', async () => {
  const f = fixture({ dry(value) { value.safety = { bulk_confirmation_required_for_execute: true, bulk_confirmation_token: 'synthetic-bulk' }; } });
  await f.run('C'); const args = f.calls.find(args => args.includes('--yes'));
  assert.equal(args[args.indexOf('--bulk-confirm-token') + 1], 'synthetic-bulk');
});

test('failed write or post-write readback retains intent and never reports verified success', async () => {
  for (const options of [{ failBefore: 1 }, { detail(member, count) { if (count === 3) member.point++; } }]) {
    const f = fixture(options); await assert.rejects(f.run('C'));
    assert.equal(f.receipt().intent.mode, 'C'); assert.equal(f.output.length, 0); assert.equal(f.counters.released, 1);
  }
});

test('interactive workflow holds one lock across C/D and restores before releasing on quit', async () => {
  const f = fixture({ args: ['--interactive'] }); await f.main();
  assert.deepEqual(f.live, f.baseline); assert.equal(f.counters.acquired, 1); assert.equal(f.counters.released, 1);
  assert.equal(f.counters.closes, 1); assert.equal(f.held, false);
  assert.deepEqual(f.events.filter(event => event.startsWith('write:')), ['write:C', 'write:D', 'write:restore']);
  assert.ok(f.events.indexOf('write:restore') < f.events.indexOf('release'));
  assert.equal(f.output[0].workflowLockHeld, true); assert.equal(f.receipt().intent, undefined);
});

for (const lines of [['C'], ['C', 'restore'], ['C', Error('Synthetic input failed')], ['C', 'invalid-command']]) {
  test('interactive EOF, explicit restore, input error or command error runs guarded finally restore', async () => {
    const f = fixture({ args: ['--interactive'], lines });
    if (lines.some(line => line instanceof Error || line === 'invalid-command')) await assert.rejects(f.main());
    else await f.main();
    assert.deepEqual(f.live, f.baseline); assert.equal(f.counters.writes, 2); assert.equal(f.counters.released, 1);
    assert.equal(f.receipt().intent, undefined); assert.equal(f.receipt().lastMode, 'restore');
  });
}

test('interactive quit before any command does not invent a baseline or mutate groups', async () => {
  const f = fixture({ args: ['--interactive'], lines: ['quit'] }); await f.main();
  assert.equal(f.counters.writes, 0); assert.equal(f.receipt(), undefined); assert.equal(f.counters.released, 1);
});

test('finally reconciles an accepted unknown D by readback then restores once', async () => {
  const f = fixture({ args: ['--interactive'], failAfter: 2 }); await assert.rejects(f.main(), /unknown write after mutation/);
  assert.deepEqual(f.live, f.baseline); assert.equal(f.counters.writes, 3);
  assert.deepEqual(f.events.filter(event => event.startsWith('write:')), ['write:C', 'write:D', 'write:restore']);
  assert.equal(f.counters.released, 1); assert.equal(f.receipt().intent, undefined);
});

test('finally does not overwrite unresolved intent or concurrently added purchases', async () => {
  for (const options of [{ failBefore: 2 }, { between(member, index) { if (index === 1) member.group.push('new-purchase'); } }]) {
    const f = fixture({ args: ['--interactive'], ...options }); await assert.rejects(f.main());
    assert.ok(f.live.group.includes(C)); assert.equal(f.counters.released, 1); assert.equal(f.held, false);
    assert.ok(!f.events.includes('write:restore'));
  }
});

test('failed final restore leaves recoverable intent and releases the workflow lock', async () => {
  const f = fixture({ args: ['--interactive'], lines: ['C', 'quit'], failBefore: 2 });
  await assert.rejects(f.main()); assert.ok(f.live.group.includes(C));
  assert.equal(f.receipt().intent.mode, 'restore'); assert.equal(f.counters.released, 1);
});

test('reader close failure must not skip guarded finally restoration', async () => {
  const f = fixture({ args: ['--interactive'], lines: ['C', 'quit'], failReaderClose: true });
  await assert.rejects(f.main(), /reader close failed/);
  assert.deepEqual(f.live, f.baseline); assert.equal(f.counters.released, 1);
});

test('shared lock conflict prevents every private read and provider operation', async () => {
  const f = fixture({ busy: true }); await assert.rejects(f.run('C'), /lock busy/);
  assert.equal(f.calls.length, 0); assert.equal(f.reads.length, 0); assert.equal(f.counters.released, 0);
});
