import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../src/service.mjs';
import { createPlans } from '../src/plans.mjs';
import { ACTIONS } from '../src/actions.mjs';
import { mealReview } from '../src/meal-review.mjs';

async function fixture(t, time = Date.parse('2026-10-29T04:00:00Z')) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'core-service-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const plans = await createPlans(directory, { now: () => time });
  const actor = { bindingHash: 'current', binding: { staffId: '1979746' } };
  let source = 'one', calls = 0, uncertain = false;
  const checks = new Map(), ajv = new Ajv({ strict: true });
  const service = createService({ plans, access: { owner: async () => actor },
    store: { areas: () => [], fingerprints: async () => [{ hash: source }], list: async () => [], get: async () => ({}) },
    now: () => time,
    validate: (name, args) => { if (!checks.get(name)(args)) throw Object.assign(Error('bad'), { code: 'INVALID_ARGUMENT' }); },
    invoke: async (name, params, current, signal, hooks) => {
      await hooks?.beforeDispatch?.(); calls++;
      if (uncertain) throw Object.assign(Error('unknown'), { code: 'OUTCOME_UNKNOWN' });
      return { saved: true };
    } });
  for (const tool of service.listTools()) checks.set(tool.name, ajv.compile(tool.inputSchema));
  const prepare = () => service.callTool('core_action_prepare', { operation: 'saveRecommendedMealProgramDraft',
    params: { requestId: 'test', expectedRevision: 'revision', expectedResponseHash: 'a'.repeat(64), publicContent: {} }, actionKey: 'stable-draft-test-001' });
  const execute = p => service.callTool('core_action_execute', { planId: p.result.planId, planHash: p.result.planHash, confirmation: p.result.requiredConfirmation });
  return { service, actor, plans, prepare, execute, calls: () => calls, change: () => { source = 'two'; }, unknown: () => { uncertain = true; } };
}
test('catalog has unique actions and valid strict tool schemas', async t => {
  const { service } = await fixture(t);
  assert.equal(new Set(ACTIONS.map(a => a.name)).size, ACTIONS.length);
  assert.equal((await service.callTool('core_catalog', {})).ok, true);
  await assert.rejects(service.callTool('core_query', { operation: 'arbitraryURL', params: {} }), { code: 'UNKNOWN_ACTION' });
  await assert.rejects(service.callTool('core_catalog', { extra: true }), { code: 'INVALID_ARGUMENT' });
});
test('prepare does not call handler; execute once and return receipt on repetition', async t => {
  const f = await fixture(t); const plan = await f.prepare();
  assert.equal(f.calls(), 0);
  assert.equal((await f.execute(plan)).result.requestCompleted, true);
  assert.equal((await f.execute(plan)).result.replayed, false);
  assert.equal(f.calls(), 1);
});
test('source or actor changes prevent dispatch', async t => {
  const f = await fixture(t); const plan = await f.prepare(); f.change();
  await assert.rejects(f.execute(plan), { code: 'SOURCE_CHANGED' });
  assert.equal(f.calls(), 0);
  const f2 = await fixture(t); const p2 = await f2.prepare(); f2.actor.bindingHash = 'new';
  await assert.rejects(f2.execute(p2), { code: 'ACTOR_CHANGED' });
  assert.equal(f2.calls(), 0);
});
test('unknown transport outcomes remain blocked without replay', async t => {
  const f = await fixture(t); const plan = await f.prepare(); f.unknown();
  await assert.rejects(f.execute(plan), { code: 'OUTCOME_UNKNOWN' });
  const result = await f.execute(plan);
  assert.equal(result.result.receipt.status, 'outcome_unknown'); assert.equal(f.calls(), 1);
});
test('write endpoint cannot enter read path and raw meal endpoint is projected', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.callTool('core_query', { operation: 'saveRecommendedMealProgramDraft', params: {} }), { code: 'UNKNOWN_ACTION' });
  await assert.rejects(f.service.callTool('core_query', { operation: 'getRecommendedMealProgramReview', params: { requestId: 'test' } }), { code: 'USE_MEAL_REVIEW' });
});
test('member-facing operation cannot dispatch during quiet hours', async t => {
  const f = await fixture(t, Date.parse('2026-10-28T23:59:59Z'));
  const p = await f.service.callTool('core_action_prepare', { operation: 'operatorSendPricingInquiryAlimtalk',
    params: { phone: '01000000000' }, actionKey: 'quiet-window-test-001' });
  await assert.rejects(f.execute(p), { code: 'QUIET_HOURS' });
  assert.equal(f.calls(), 0);
  assert.equal(await f.plans.existingIntent(p.result.intentId), null);
});
test('modification requires exact operation and plan confirmation', async t => {
  const f = await fixture(t); const p = await f.prepare();
  await assert.rejects(f.service.callTool('core_action_execute', { planId: p.result.planId, planHash: p.result.planHash,
    confirmation: 'approved' }), { code: 'CONFIRMATION_REQUIRED' });
  assert.equal(f.calls(), 0);
});
test('meal review omits raw health and phone but returns source hash and public draft', () => {
  const result = mealReview({ request: { requestId: 'r', memberName: 'test', memberPhone: '01012345678', inbody: 'PRIVATE' },
    response: { sourceHash: 'hash', answers: { schemaVersion: 'meal-choice-v2', cookingAccess: '10분 이내 간단 조리', allergies: ['PRIVATE'], healthFlags: ['PRIVATE'] }, reviewReasons: ['allergy_reported'] },
    inbody: { metrics: 'PRIVATE' }, draft: { publicContent: { summary: 'safe summary' } } });
  assert.equal(result.responseHash, 'hash'); assert.equal(result.requestId, 'r');
  assert.equal(result.draft.publicContent.summary, 'safe summary');
  assert.equal(result.reviewRequired, true); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes('01012345678'), false);
});
