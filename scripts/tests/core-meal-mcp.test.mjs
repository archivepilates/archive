import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, lstat, readFile, readdir, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  REQUEST_ID, OPERATION, ACTION_KEYS, SUFFIX, digest, responseHash, revisionFor,
  stagedContent, buildParams, assertSourceUnchanged, runMealTest, createAudit,
} from '../test-core-meal-mcp.mjs';

const clone = value => structuredClone(value);
function content() {
  return { title: 'Synthetic draft', summary: 'Synthetic summary', goal: 'Routine', metricsSummary: '',
    principles: ['Regular meals'], days: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, label: `Day ${i + 1}`,
      breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: '', timingTip: '' })),
    hydration: '', exerciseNutrition: '', weekendStrategy: 'Keep the usual routine.', caution: 'General guidance only.' };
}
const original = (() => {
  const response = { requestId: REQUEST_ID, studioId: '5330', memberId: 'synthetic-member',
    answers: { schemaVersion: 'meal-choice-v2' }, reviewReasons: [], submittedAt: null };
  const source = responseHash(response), publicContent = content();
  // Synthetic native revision with the operator-reported baseline prefix, no production fixture.
  let revision;
  for (let i = 0; i < 1000000; i++) {
    publicContent.title = `Synthetic draft ${i}`;
    revision = revisionFor(source, publicContent);
    if (revision.startsWith('0b5e')) break;
  }
  assert.ok(revision.startsWith('0b5e'));
  const shared = { requestId: REQUEST_ID, studioId: '5330', memberId: 'synthetic-member' };
  return { response, request: { ...shared, status: 'submitted', recommendationStatus: 'awaiting_operator_review',
    draftRevision: revision, candidateId: 'prior-synthetic-invite', sendId: 'prior-synthetic-send' },
  draft: { ...shared, sourceResponseHash: source, publicContent, revision, status: 'operator_edited',
    provider: 'operator_assisted', model: 'codex-chat', reviewAcknowledgedAt: null, reviewReasons: [], generationError: null,
    createdAt: 'synthetic-original-created', editedAt: 'old', updatedAt: 'old', editedByUid: 'old', editedByName: 'old' },
  report: { ...shared, reportRevision: revision, approvalStatus: 'draft', publicationStatus: 'draft',
    approvedRevision: '', sentRevision: '', priorCandidateId: 'prior-report-candidate', priorSendId: 'prior-report-send' },
  revisions: {}, updateTimes: {} };
})();

function fixture(options = {}) {
  let current = clone(original), step = 0, reads = 0;
  const calls = [], events = [], plans = new Map();
  return {
    current: () => current, calls, events,
    args: { apply: true,
      review: async () => ({ ok: true, requestId: REQUEST_ID, responseHash: responseHash(current.response),
        draft: clone(current.draft), report: clone(current.report) }),
      readCanonical: async () => {
        reads++;
        if (options.beforeRead) options.beforeRead(current, reads);
        return clone(current);
      },
      write: async (event, data) => { events.push({ event, data: clone(data) }); },
      callTool: async (name, args) => {
        calls.push({ name, args: clone(args) });
        if (name === 'core_action_prepare') {
          assert.equal(args.operation, OPERATION);
          assert.equal(args.params.requestId, REQUEST_ID);
          assert.equal(args.params.authoringMode, 'codex_operator');
          const planId = `fake-plan-${plans.size}`, planHash = digest(args);
          const plan = { planId, planHash, operation: OPERATION, requiredConfirmation: `${OPERATION}:${planHash}`, intentId: digest(planId) };
          plans.set(planId, { plan, params: clone(args.params) });
          return { ok: true, result: plan };
        }
        assert.equal(name, 'core_action_execute');
        const { plan, params } = plans.get(args.planId);
        assert.equal(args.confirmation, plan.requiredConfirmation);
        assert.equal(params.expectedRevision, current.draft.revision);
        assert.equal(params.expectedResponseHash, responseHash(current.response));
        step++;
        if (options.rejectBeforeMutation) throw Error('Uncertain private provider failure');
        const prior = clone(current.draft), revision = revisionFor(params.expectedResponseHash, params.publicContent);
        if (!current.revisions[prior.revision]) current.revisions[prior.revision] = { ...prior,
          preservedAt: `synthetic-${step}`, supersededByRevision: revision };
        Object.assign(current.draft, { publicContent: clone(params.publicContent), revision,
          editedAt: `edit-${step}`, updatedAt: `edit-${step}`, editedByUid: 'test', editedByName: 'test' });
        Object.assign(current.request, { draftRevision: revision, updatedAt: `edit-${step}` });
        Object.assign(current.report, { reportRevision: revision, updatedAt: `edit-${step}` });
        if (options.afterMutation) options.afterMutation(current, step);
        if (options.uncertainAfterMutation) throw Error('Uncertain private provider failure');
        return { ok: true, result: { requestCompleted: true } };
      },
    },
  };
}

test('import has no authentication, dependencies, server spawn or main side effects', () => {
  const url = new URL('../test-core-meal-mcp.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`],
    { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: '/nonexistent/synthetic-home' } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('default mode reviews the native draft without prepare/execute or a model call', async () => {
  const f = fixture();
  delete f.args.apply;
  const result = await runMealTest(f.args);
  assert.equal(result.mode, 'read-only');
  assert.equal(result.responseHash, responseHash(original.response));
  assert.equal(result.revision, original.draft.revision);
  assert.equal(result.writesAttempted, false);
  assert.deepEqual(f.calls, []);
});

test('full schema is preserved and suffix is strictly below the native field limit', () => {
  const next = stagedContent(original.draft.publicContent);
  assert.equal(next.weekendStrategy, original.draft.publicContent.weekendStrategy + SUFFIX);
  assert.deepEqual({ ...next, weekendStrategy: original.draft.publicContent.weekendStrategy }, original.draft.publicContent);
  const params = buildParams(original, next);
  assert.equal(params.expectedRevision, original.draft.revision);
  assert.equal(params.expectedResponseHash, responseHash(original.response));
  assert.deepEqual(params.publicContent, next);
  assert.throws(() => stagedContent({ ...next, weekendStrategy: 'x'.repeat(600 - SUFFIX.length) }), /NO_NATIVE_FIELD_HEADROOM/);
  assert.throws(() => stagedContent(next), /TEST_SUFFIX_ALREADY_PRESENT/);
  assert.throws(() => stagedContent({ ...content(), futureField: 'must not disappear' }), /PUBLIC_SCHEMA_CHANGED/);
  assert.throws(() => stagedContent({ ...content(), summary: ' trimmed ' }), /PUBLIC_TEXT_INVALID/);
});

test('apply uses only exact save plans, distinct fixed keys and current revision restore', async () => {
  const f = fixture();
  const result = await runMealTest(f.args);
  assert.equal(result.restored, true);
  assert.equal(result.published, false);
  assert.equal(result.sent, false);
  assert.deepEqual(f.calls.map(c => c.name), ['core_action_prepare', 'core_action_execute', 'core_action_prepare', 'core_action_execute']);
  const saves = f.calls.filter(c => c.name === 'core_action_prepare').map(c => c.args);
  assert.deepEqual(saves.map(s => s.actionKey), [ACTION_KEYS.stage, ACTION_KEYS.restore]);
  assert.equal(saves[1].params.expectedRevision, revisionFor(responseHash(original.response), saves[0].params.publicContent));
  assert.deepEqual(saves[1].params.publicContent, original.draft.publicContent);
  assert.deepEqual(f.current().response, original.response);
  assert.equal(f.current().request.candidateId, original.request.candidateId);
  assert.equal(f.current().request.sendId, original.request.sendId);
  assert.deepEqual(f.current().draft.publicContent, original.draft.publicContent);
  assert.equal(Object.keys(f.current().revisions).length, 2);
  assert.ok(f.events.some(e => e.event === 'complete'));
});

test('uncertain stage is read back, never executed again, then independently restored', async () => {
  const f = fixture({ uncertainAfterMutation: true });
  assert.equal((await runMealTest(f.args)).restored, true);
  assert.equal(f.calls.filter(c => c.name === 'core_action_execute').length, 2);
  assert.ok(f.events.some(e => e.event === 'stage-transport' && e.data.outcome === 'uncertain_no_retry'));
});

test('uncertain write without matching canonical mutation leaves an explicit audit block', async () => {
  const f = fixture({ rejectBeforeMutation: true });
  await assert.rejects(runMealTest(f.args), /CURRENT_CONTENT_NOT_EXACT_TEST/);
  assert.equal(f.calls.filter(c => c.name === 'core_action_execute').length, 1);
  assert.equal(f.events.at(-1).event, 'blocked');
  assert.equal(f.events.at(-1).data.automaticRetry, false);
});

test('changed source at execute freshness check blocks all writes', async () => {
  const f = fixture({ beforeRead: (current, count) => { if (count === 2) current.response.answers.changed = true; } });
  await assert.rejects(runMealTest(f.args));
  assert.equal(f.calls.filter(c => c.name === 'core_action_execute').length, 0);
});

for (const [label, mutate] of [
  ['response', b => { b.response.answers.changed = true; }],
  ['request send identity', b => { b.request.sendId = 'concurrent-send'; }],
  ['report send identity', b => { b.report.priorSendId = 'concurrent-send'; }],
  ['approval', b => { b.report.approvalStatus = 'approved'; }],
  ['concurrent content', b => { b.draft.publicContent.goal = 'concurrent'; }],
  ['archive', b => { b.revisions[original.draft.revision].model = 'concurrent'; }],
]) test(`changed ${label} after stage blocks restore`, async () => {
  const f = fixture({ afterMutation: (bundle, step) => { if (step === 1) mutate(bundle); } });
  await assert.rejects(runMealTest(f.args));
  assert.equal(f.calls.filter(c => c.name === 'core_action_prepare').length, 1);
  assert.equal(f.events.at(-1).event, 'blocked');
});

test('change between staged proof and restore execute is not overwritten', async () => {
  const f = fixture({ beforeRead: (bundle, count) => {
    if (count === 4) bundle.request.candidateId = 'concurrent-candidate';
  } });
  await assert.rejects(runMealTest(f.args), /REQUEST_SOURCE_CHANGED/);
  assert.equal(f.calls.filter(c => c.name === 'core_action_execute').length, 1);
});

test('pre-existing immutable history remains intact when its revision is revisited', async () => {
  const f = fixture();
  const prior = clone(original.draft);
  prior.editedByName = 'Earlier author';
  prior.updatedAt = 'earlier-update';
  f.current().revisions[prior.revision] = { ...prior, preservedAt: 'earlier', supersededByRevision: digest('earlier') };
  const history = clone(f.current().revisions);
  assert.equal((await runMealTest(f.args)).restored, true);
  assert.deepEqual(f.current().revisions[prior.revision], history[prior.revision]);
});

test('unapproved baseline and mismatched MCP response hash stop before prepare', async () => {
  const f = fixture();
  f.args.review = async () => ({ ok: true, requestId: REQUEST_ID, responseHash: digest('changed'),
    draft: clone(f.current().draft), report: clone(f.current().report) });
  await assert.rejects(runMealTest(f.args), /MCP_NATIVE_REVIEW_MISMATCH/);
  assert.equal(f.calls.length, 0);
  const g = fixture();
  g.current().draft.publicContent.title = 'Different valid native draft';
  g.current().draft.revision = revisionFor(responseHash(g.current().response), g.current().draft.publicContent);
  g.current().request.draftRevision = g.current().draft.revision;
  g.current().report.reportRevision = g.current().draft.revision;
  await assert.rejects(runMealTest(g.args), /APPROVED_BASELINE_CHANGED/);
  assert.equal(g.calls.length, 0);
});

test('restore failure records a block and leaves the verified staged draft without replay', async () => {
  const f = fixture();
  const callTool = f.args.callTool;
  let executes = 0;
  f.args.callTool = async (name, args) => {
    if (name === 'core_action_execute' && ++executes === 2) throw Error('private restore error must not escape');
    return callTool(name, args);
  };
  await assert.rejects(runMealTest(f.args), /CURRENT_CONTENT_NOT_EXACT_TEST/);
  assert.equal(executes, 2);
  assert.deepEqual(f.current().draft.publicContent, stagedContent(original.draft.publicContent));
  assert.equal(f.events.at(-1).event, 'blocked');
  assert.doesNotMatch(JSON.stringify(f.events), /private restore error/);
});

test('source guard preserves all unrelated fields, including private original response', () => {
  const bundle = clone(original);
  bundle.request.sendId = 'changed';
  assert.throws(() => assertSourceUnchanged(original, bundle), /REQUEST_SOURCE_CHANGED/);
});

test('audit is append-only, exclusive, private, and reruns cannot overwrite it', async () => {
  const tmp = await mkdtemp(path.join(await realpath(os.tmpdir()), 'meal-mcp-unit-'));
  try {
    const directory = path.join(tmp, 'audit');
    const write = await createAudit(directory);
    await write('proof', { hash: digest('synthetic') });
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
    for (const file of await readdir(directory)) assert.equal((await lstat(path.join(directory, file))).mode & 0o777, 0o600);
    const baseline = await readFile(path.join(directory, '000-run.json'), 'utf8');
    await assert.rejects(createAudit(directory), { code: 'EEXIST' });
    assert.equal(await readFile(path.join(directory, '000-run.json'), 'utf8'), baseline);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
