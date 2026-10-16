import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
const base = new URL('../../firebase/kangsain-functions/functions/src/', import.meta.url);
const forbidden = () => { throw new Error('Unexpected side effect'); };
function load(file, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, base), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date, Error, Set, Map, console,
    require: key => Object.hasOwn(dependencies, key) ? dependencies[key] : forbidden(), ...globals });
  return exports;
}
const deps = {
  '../config/firebase': { db: { collection: forbidden } },
  '../utils/date': { todayKst: () => '2026-10-16' },
  '../utils/errors': { AppError: Error },
  './dedupe': { alimtalkDedupeKey: () => 'key' },
  './templates': { alimtalkDedupePolicy: () => ({ windowDays: null }) },
  './holdingNoticeQueue': { isHoldingNoticeCandidate: c => c.type === 'holding_notice' },
  './templateTargetRules': { ALIMTALK_TEMPLATE_TARGET_RULES: Object.fromEntries([
    'reservation_open', 'membership_welcome', 'instructor_lesson_material', 'instructor_lesson_confirmation',
    'private_lesson_report', 'recommended_meal_report', 'inbody_report', 'group_survey',
  ].map(type => [type, {}])) },
  './targetValidationChecks': {},
};
const api = load('alimtalk/targetValidation.ts', deps);
const candidate = { candidateId: 'candidate_1', studioId: '5330', memberId: '1234', type: 'reservation_open', status: 'candidate' };
function fixture(overrides = {}) {
  const calls = [];
  const c = { ...candidate, ...overrides.candidate };
  const run = api.createTargetInspector({
    loadCandidate: async id => { calls.push(['candidate', id]); if (overrides.error) throw new Error('SECRET survey response'); return overrides.absent ? undefined : c; },
    loadSend: async id => { calls.push(['ledger', id]); return overrides.ledger; },
    eligibility: async (_, today) => { calls.push(['eligibility', today]); return overrides.eligibility || ''; },
    source: async () => { calls.push(['source']); return overrides.source || ''; },
    duplicate: async () => { calls.push(['duplicate']); return overrides.duplicate || ''; },
    now: () => new Date('2026-10-16T12:00:00Z'), today: () => '2026-10-16',
  });
  return { run, calls };
}
test('preflight passes without implying approval, live source or permission to send', async () => {
  const f = fixture(), result = await f.run(['candidate_1'], '5330');
  assert.equal(result.results[0].status, 'preflight_passed');
  assert.equal(result.allowedForExternalActions, false);
  assert.equal(result.readOnly, true); assert.equal(result.liveReadback, false);
  assert.ok(result.results[0].remainingChecks.length > 0);
  assert.deepEqual(f.calls.map(x => x[0]), ['candidate', 'ledger', 'eligibility', 'source', 'duplicate']);
});
for (const ids of [null, [], Array(11).fill('x'), ['../path'], ['a/b'], ['a b'], [3], ['a'.repeat(161)]]) {
  test(`reject invalid selection ${JSON.stringify(ids).slice(0, 45)}`, async () => {
    const f = fixture(); await assert.rejects(f.run(ids, '5330')); assert.equal(f.calls.length, 0);
  });
}
test('reject wrong caller studio before reads', async () => {
  const f = fixture(); await assert.rejects(f.run(['candidate_1'], 'other')); assert.equal(f.calls.length, 0);
});
test('duplicate requested IDs are read only once', async () => {
  const f = fixture(), r = await f.run(['candidate_1', 'candidate_1'], '5330');
  assert.equal(r.results.length, 1); assert.equal(f.calls.filter(x => x[0] === 'candidate').length, 1);
});
for (const override of [{ absent: true }, { candidate: { studioId: 'other', memberName: 'SECRET' } }]) {
  test(`absent or foreign studio is not disclosed: ${JSON.stringify(override)}`, async () => {
    const f = fixture(override), r = await f.run(['candidate_1'], '5330');
    assert.equal(r.results[0].status, 'not_found'); assert.equal(f.calls.length, 1);
    assert.ok(!JSON.stringify(r).includes('SECRET'));
  });
}
for (const patch of [{ candidateId: 'other' }, { memberId: '../x' }, { memberId: '' }]) {
  test(`canonical identity fail closed ${JSON.stringify(patch)}`, async () => {
    const f = fixture({ candidate: patch }), r = await f.run(['candidate_1'], '5330');
    assert.equal(r.results[0].status, 'blocked'); assert.equal(f.calls.length, 1);
  });
}
for (const override of [{ ledger: {} }, { ledger: { status: 'failed' } }, { candidate: { status: 'processing' } },
  { candidate: { status: 'sent' } }, { candidate: { status: 'failed' } }, { candidate: { attempts: 1 } }]) {
  test(`never authorizes prior or ambiguous attempts ${JSON.stringify(override)}`, async () => {
    const f = fixture(override), r = await f.run(['candidate_1'], '5330');
    assert.equal(r.results[0].status, 'blocked'); assert.equal(f.calls.length, 2);
  });
}
for (const stage of ['eligibility', 'source', 'duplicate']) {
  test(`existing ${stage} policy blocks, without exposing policy payload`, async () => {
    const f = fixture({ [stage]: 'SECRET survey answer' }), r = await f.run(['candidate_1'], '5330');
    assert.equal(r.results[0].status, 'blocked'); assert.ok(!JSON.stringify(r).includes('SECRET'));
    assert.equal(r.results[0].checks.at(-1).reasonCode, `${stage}_blocked`);
  });
}
test('old template snapshot is unknown not a negative eligibility decision', async () => {
  const f = fixture({ eligibility: '템플릿 상태 확인 일시 실패: template' });
  const r = await f.run(['candidate_1'], '5330');
  assert.equal(r.results[0].status, 'review_required');
  assert.equal(r.results[0].checks.at(-1).reasonCode, 'template_snapshot_unverified');
});
for (const type of ['holding_notice', 'membership_welcome', 'instructor_lesson_material', 'instructor_lesson_confirmation',
  'private_lesson_report', 'recommended_meal_report', 'inbody_report', 'group_survey']) {
  test(`${type} does not claim specialized final runtime verification`, async () => {
    const r = await fixture({ candidate: { type } }).run(['candidate_1'], '5330');
    assert.equal(r.results[0].status, 'review_required'); assert.equal(r.results[0].checks.at(-1).status, 'not_checked');
  });
}
test('source failure is never empty success or raw exception', async () => {
  const r = await fixture({ error: true }).run(['candidate_1'], '5330');
  assert.equal(r.results[0].status, 'review_required'); assert.ok(!JSON.stringify(r).includes('SECRET'));
});
for (const type of ['unknown', 'constructor', 'toString', '__proto__', undefined, null, 'manual_review']) {
  test(`unsupported category cannot inherit a rule: ${type}`, async () => {
    const r = await fixture({ candidate: { type } }).run(['candidate_1'], '5330');
    assert.equal(r.results[0].status, 'review_required');
    assert.equal(r.results[0].checks.at(-1).reasonCode, 'unsupported_candidate_type');
  });
}

test('shared runtime preserves original arguments and exceptions', async () => {
  const calls = [];
  const shared = load('alimtalk/targetValidationChecks.ts', {
    './eligibility': { autoSendabilityIssue: async (...args) => { calls.push(args); return 'original exclusion'; } },
    './dedupe': { findCompletedDuplicateForCandidate: async (...args) => { calls.push(args); return 'original duplicate'; } },
    './privateSurveySendGuard': {}, './renewalSendGuard': {}, './longAbsenceSendGuard': {},
    '../instructorLessonRegistration/instructorLessonConfirmation': {},
  });
  assert.equal(await shared.targetEligibilityIssue(candidate, '2026-10-16'), 'original exclusion');
  assert.equal(await shared.targetDuplicateIssue(candidate, 'key', null), 'original duplicate');
  assert.deepEqual(calls[1], [candidate, 'key', null]);
  assert.equal(calls[0][0], candidate); assert.equal(calls[0][1], '2026-10-16');
});

function templateFixture(state) {
  let writes = 0, reads = 0, fetches = 0;
  const value = load('alimtalk/templateStatus.ts', {
    'node:crypto': require('node:crypto'), 'firebase-functions': { logger: {} },
    '../config/firebase': { db: { collection: () => ({ doc: () => ({
      get: async () => { reads++; return { data: () => state }; }, set: async () => { writes++; },
    }) }) } },
    '../config/secrets': Object.fromEntries(['solapiApiKey', 'solapiApiSecret', 'solapiPfid'].map(k => [k, { value: () => 'synthetic' }])),
    '../utils/date': { nowTimestamp: () => ({}) }, './templates': { ALIMTALK_TEMPLATES: { test: { code: 'T', label: 'test' } } },
  }, { fetch: async () => { fetches++; return { ok: true, json: async () => ({ status: 'APPROVED' }) }; } });
  return { value, counts: () => ({ writes, reads, fetches }) };
}
for (const age of [null, 0, 600_001, -10_000]) {
  test(`read-only template ${age} does not write or fetch`, async () => {
    const f = templateFixture(age === null ? undefined : { source: 'solapi', status: 'APPROVED', syncedAt: { toMillis: () => Date.now() - age } });
    const r = await f.value.alimtalkTemplateReadiness('T', { readOnly: true });
    assert.equal(r.approved, age === 0); assert.equal(f.counts().writes, 0); assert.equal(f.counts().fetches, 0);
  });
}
test('existing sending mode still refreshes an expired template cache', async () => {
  const f = templateFixture(undefined), r = await f.value.alimtalkTemplateReadiness('T');
  assert.equal(r.approved, true); assert.equal(f.counts().writes, 1); assert.equal(f.counts().fetches, 1);
});
