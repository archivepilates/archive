import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Only bounded source fragments run with synthetic bindings. Never import/run either main.
const grant = readFileSync(new URL('../grant-lesson-261024.mjs', import.meta.url), 'utf8');
const qa = readFileSync(new URL('../qa-lesson-261024.mjs', import.meta.url), 'utf8');
function fragment(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0 && source.indexOf(start, from + start.length) < 0, 'Unique source start required');
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, 'Source end required');
  return source.slice(from, to);
}
const writeCall = fragment(grant, 'imwebJson(write, { execute:', '\n        }\n        const after');
const failure = fragment(grant, '        if (quotaBlockedBeforeDispatch) {', '\n      }\n    }\n    const evidenceFile');
const quotaGate = fragment(grant, '      if (!already && (args.includes(', '      const afterGroups');
const quotaStart = fragment(grant, '    let quotaDeferred =', '    for (const target of targets)');
const kstDate = fragment(grant, 'const kstDate =', '\n');
const qaGuard = fragment(qa, '    if (before.memberCode !== TEST_MEMBER', '    let state;');

function clock(at) {
  return class extends Date {
    constructor(...args) { super(...(args.length ? args : [Date.parse(at)])); }
    static now() { return Date.parse(at); }
  };
}
const shareInstant = value => {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw Error('synthetic_invalid_clock');
  return Date.parse(value);
};

function classify(error) {
  let calls = 0;
  const flagged = runInNewContext(`let quotaBlockedBeforeDispatch = false;
    try { ${writeCall} } catch {}
    quotaBlockedBeforeDispatch;`, {
    write: ['synthetic-write'],
    imwebJson: (_args, { execute }) => execute('synthetic-cli'),
    execFileSync: () => { calls++; throw error; },
  });
  assert.equal(calls, 1);
  return flagged;
}

function handleFailure(confirmed) {
  const receipt = { status: 'intent', intentAt: '2026-10-25T00:00:00Z', memberCode: 'synthetic-member' };
  const state = { manualImmediateGrants: { 'synthetic-member': receipt }, entitlements: {} };
  const results = [];
  const saves = [];
  const bindings = { quotaBlockedBeforeDispatch: confirmed, quotaDeferred: false,
    receipt, state, memberCode: 'synthetic-member', stateFile: 'synthetic-only',
    target: { team: 'A' }, results, Date: clock('2026-10-25T01:00:00Z'),
    save: (_file, value) => saves.push(structuredClone(value)),
  };
  let error;
  try { runInNewContext(`for (const unused of [0]) { ${failure} }`, bindings); }
  catch (caught) { error = caught; }
  return { receipt, state, results, saves, bindings, error };
}

function initialQuota(attempts, now) {
  return runInNewContext(`${kstDate}\n${quotaStart}\nquotaDeferred;`, {
    ledgers: new Map([['synthetic-policy', { state: { grantAttempts: attempts } }]]),
    shareInstant, Date: clock(now),
  });
}

function deferGate({ staffOnly = false, quotaDeferred = false, already = false } = {}) {
  const results = [];
  const fallthrough = runInNewContext(`let fallthrough = 0;
    for (const unused of [0]) { ${quotaGate}\nfallthrough++; }
    fallthrough;`, { already, args: staffOnly ? ['--existing-staff-only'] : [], quotaDeferred,
    results, target: { team: 'B' } });
  return { results, fallthrough };
}

test('only exact structured quota errors on either CLI stream classify as undispatched', () => {
  for (const stream of ['stdout', 'stderr']) {
    assert.equal(classify({ [stream]: JSON.stringify({ error: { code: 'write_quota_exceeded' } }) }), true);
  }
});

test('transport, malformed JSON and textual quota mentions never prove non-dispatch', () => {
  for (const error of [Error('write_quota_exceeded'), { stderr: 'write_quota_exceeded' },
    { stdout: '{broken' }, { stdout: JSON.stringify({ code: 'write_quota_exceeded' }) },
    { stderr: JSON.stringify({ error: { code: 'provider_timeout', message: 'write_quota_exceeded' } }) }]) {
    assert.equal(classify(error), false);
  }
});

test('known quota failure archives only an attempt, starts no clock and defers the batch', () => {
  const outcome = handleFailure(true);
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.receipt.status, 'blocked_before_dispatch');
  assert.equal(outcome.receipt.reason, 'write_quota_exceeded');
  assert.equal(outcome.receipt.firstGrantNotStarted, true);
  assert.equal(outcome.receipt.quotaConfirmedAt, '2026-10-25T01:00:00.000Z');
  assert.deepEqual(Object.keys(outcome.state.manualImmediateGrants), []);
  assert.deepEqual(outcome.state.entitlements, {});
  assert.equal(outcome.state.grantAttempts['synthetic-member'], outcome.receipt);
  for (const key of ['grantedAt', 'expiresAt', 'verifiedAt']) assert.equal(Object.hasOwn(outcome.receipt, key), false);
  assert.equal(outcome.bindings.quotaDeferred, true);
  assert.equal(outcome.saves.length, 1);
  assert.equal(outcome.results[0].status, 'deferred');
});

test('every unclassified write failure retains a blocking unknown receipt', () => {
  const outcome = handleFailure(false);
  assert.match(outcome.error.message, /reconcile current state before any retry/);
  assert.equal(outcome.receipt.status, 'result_unknown');
  assert.equal(outcome.state.manualImmediateGrants['synthetic-member'], outcome.receipt);
  assert.equal(outcome.state.grantAttempts, undefined);
  assert.deepEqual(outcome.state.entitlements, {});
  assert.equal(outcome.results.length, 0);
});

test('recorded quota hold follows KST midnight rather than UTC midnight', () => {
  const attempts = { synthetic: { status: 'blocked_before_dispatch', reason: 'write_quota_exceeded',
    quotaConfirmedAt: '2026-10-25T00:00:00Z' } };
  assert.equal(initialQuota(attempts, '2026-10-25T14:59:59.999Z'), true);
  assert.equal(initialQuota(attempts, '2026-10-25T15:00:00.000Z'), false);
  assert.equal(initialQuota(attempts, '2026-10-26T00:00:00Z'), false);
  assert.equal(initialQuota({}, '2026-10-25T01:00:00Z'), false);
  attempts.synthetic.status = 'result_unknown';
  assert.equal(initialQuota(attempts, '2026-10-25T01:00:00Z'), false);
  attempts.synthetic.status = 'blocked_before_dispatch';
  attempts.synthetic.quotaConfirmedAt = 'invalid';
  assert.throws(() => initialQuota(attempts, '2026-10-25T01:00:00Z'));
});

test('scope/quota gates skip native writes, while already-present access can continue', () => {
  for (const input of [{ staffOnly: true }, { quotaDeferred: true }]) {
    const result = deferGate(input);
    assert.equal(result.fallthrough, 0);
    assert.equal(result.results[0].status, 'deferred');
    const existing = deferGate({ ...input, already: true });
    assert.equal(existing.fallthrough, 1);
    assert.equal(existing.results.length, 0);
  }
  assert.ok(grant.indexOf('if (!already && (args.includes(') < grant.indexOf('const command ='));
  assert.ok(grant.indexOf('if (!already && (args.includes(') < grant.indexOf('state.manualImmediateGrants[memberCode] = receipt'));
  assert.ok(grant.includes("if (already && before.grade !== STAFF_GRADE)"));
});

test('existing STAFF shares skip the extracted provider-write block', () => {
  let writes = 0;
  runInNewContext(`if (!already) { ${writeCall} }`, {
    already: true, imwebJson: () => { writes++; }, execFileSync: () => { throw Error('Forbidden'); },
  });
  assert.equal(writes, 0);
});

test('fresh attendance validation runs before applying the persisted same-day quota hold', () => {
  assert.ok(grant.indexOf('const { evidence, targets } = attendance();') < grant.indexOf('let quotaDeferred ='));
  assert.ok(grant.includes('Date.now() - shareInstant(evidence.verifiedAt)'));
  assert.ok(grant.includes('age < 0 || age > 2 * 3600000'));
});

test('staff-only selection without confirmed quota must not claim quota exhaustion', () => {
  const result = deferGate({ staffOnly: true });
  assert.equal(result.results[0].status, 'deferred');
  assert.notEqual(result.results[0].reason, 'local_cli_quota_no_provider_attempt');
});

test('QA guard rejects wrong account/site/unit, STAFF and malformed group lists', () => {
  const before = { memberCode: 'synthetic-qa', siteCode: 'site', unitCode: 'unit', grade: 'ordinary', group: [] };
  const check = value => runInNewContext(qaGuard, { before: value, TEST_MEMBER: 'synthetic-qa',
    SITE: 'site', UNIT: 'unit', STAFF_GRADE: 'staff' });
  assert.doesNotThrow(() => check(before));
  for (const changed of [{ memberCode: 'other' }, { siteCode: 'other' }, { unitCode: 'other' },
    { grade: 'staff' }, { group: null }]) assert.throws(() => check({ ...before, ...changed }));
});

test('QA restore targets the saved baseline and unknown intent never retries its write', () => {
  const groupsLine = fragment(qa, '    const groups = mode ===', '\n');
  const groups = runInNewContext(`${groupsLine}\ngroups;`, {
    mode: 'restore', state: { baseline: { group: ['paid', 'unrelated-share'] } }, TEST_GROUPS: {},
  });
  assert.deepEqual(Array.from(groups), ['paid', 'unrelated-share']);
  const reconcile = fragment(qa, '      if (state.intent) {', '\n      if (!isDeepStrictEqual([...before.group].sort(), [...state.lastVerifiedGroups]');
  const state = { intent: { afterGroups: ['paid', 'temporary-a'] }, lastVerifiedGroups: ['paid'] };
  const saved = [];
  assert.throws(() => runInNewContext(reconcile, { state, before: { group: ['paid'] },
    isDeepStrictEqual, save: value => saved.push(value) }), /Unresolved QA write/);
  assert.equal(state.intent.afterGroups[1], 'temporary-a');
  assert.equal(saved.length, 0);
});
