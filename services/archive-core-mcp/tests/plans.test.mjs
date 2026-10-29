import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlans } from '../src/plans.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'core-mcp-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = Date.now();
  const plans = await createPlans(directory, { now: () => time });
  const prepare = () => plans.prepare({ operation: 'saveDraft', params: { id: 'test' }, actionKey: 'fixed-test-key-001', actorId: 'owner', actorHash: 'abc', sources: [] });
  return { directory, plans, prepare, advance: n => { time += n; } };
}
test('plans seal inputs and expire after ten minutes', async t => {
  const { plans, prepare, advance } = await fixture(t);
  const plan = await prepare();
  assert.deepEqual(await plans.load(plan.planId, plan.planHash), plan);
  await assert.rejects(plans.load(plan.planId, 'bad'), { code: 'PLAN_CHANGED' });
  advance(600001);
  await assert.rejects(plans.load(plan.planId, plan.planHash), { code: 'PLAN_EXPIRED' });
});
test('intent remains unknown until independent result; repeat claim blocked', async t => {
  const { plans, prepare } = await fixture(t);
  const plan = await prepare(); const intent = await plans.claim(plan);
  assert.equal((await plans.receipt(intent.intentId)).status, 'outcome_unknown');
  await assert.rejects(plans.claim(plan), { code: 'REPLAY_BLOCKED' });
  await plans.complete(intent, { saved: true });
  assert.equal((await plans.receipt(intent.intentId)).status, 'request_completed');
  await assert.rejects(plans.complete(intent, {}));
});
test('global lock serializes processes and is released explicitly', async t => {
  const { directory, plans } = await fixture(t);
  const unlock = await plans.lock();
  const other = await createPlans(directory);
  await assert.rejects(other.lock(), { code: 'WRITE_BUSY' });
  await unlock(); await (await other.lock())();
});
test('actor revocation cannot make an old action key replayable', async t => {
  const { plans, prepare } = await fixture(t); const plan = await prepare();
  assert.equal(plans.intentId(plan), plans.intentId({ ...plan, actorHash: 'revoked' }));
});
test('plans reject unsafe paths and world-readable state', async t => {
  const { directory, plans, prepare } = await fixture(t);
  await assert.rejects(plans.load('../escape', 'x'), { code: 'INVALID_ARGUMENT' });
  const plan = await prepare();
  const file = path.join(directory, plan.planId + '.plan.json');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).planId, plan.planId);
  await chmod(file, 0o644);
  await assert.rejects(plans.load(plan.planId, plan.planHash), { code: 'LOCAL_STATE_UNSAFE' });
});
