import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectHealthWorktrees } from '../lib/system-health-worktrees.mjs';

test('auxiliary inventory distinguishes clean dirty timeout and unreadable without exposing stderr', () => {
  const results = [{ status: 0, stdout: '' }, { status: 0, stdout: '?? source.mjs' },
    { status: null, error: { code: 'ETIMEDOUT' }, stderr: 'private' }, { status: 128, stdout: '', stderr: 'private' }];
  const rows = inspectHealthWorktrees(results.map((_, i) => ({ path: `/synthetic/${i}` })), {
    now: () => 0, run: (_cmd, args, options) => {
      assert.deepEqual(args, ['--no-optional-locks', 'status', '--porcelain']);
      assert.equal(options.timeout, 750);
      assert.equal(options.killSignal, 'SIGKILL');
      return results.shift();
    },
  });
  assert.deepEqual(rows.map(r => r.state), ['clean', 'dirty', 'unavailable', 'unavailable']);
  assert.equal(rows[2].reason, 'timeout');
  assert.ok(!JSON.stringify(rows).includes('private'));
});
test('total budget bounds all historical worktrees without claiming skipped rows clean', () => {
  let time = 0, calls = 0;
  const rows = inspectHealthWorktrees(Array.from({ length: 100 }, (_, i) => ({ path: `/synthetic/${i}` })), {
    now: () => time, budgetMs: 20, timeoutMs: 15, run: (_cmd, _args, options) => {
      calls++; time += options.timeout;
      return { status: null, error: { code: 'ETIMEDOUT' } };
    },
  });
  assert.equal(calls, 2);
  assert.equal(time, 20);
  assert.equal(rows.filter(r => r.reason === 'inventory_budget').length, 98);
  assert.ok(rows.every(r => r.state === 'unavailable'));
});
test('throwing and malformed subprocess results remain explicitly unavailable', () => {
  for (const run of [() => { throw Error('private'); }, () => ({ status: 0 }), () => undefined]) {
    assert.equal(inspectHealthWorktrees([{ path: '/synthetic' }], { run })[0].state, 'unavailable');
  }
});
