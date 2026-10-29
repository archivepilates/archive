import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { A261024_SHARE, B261024_SHARE, firstVerifiedShareWindow } from '../lib/imweb-student-share-policy.mjs';
import { STAFF_GRADE } from '../lib/imweb-staff-video-policy.mjs';
import { LESSON_VIDEO_ELIGIBILITY_POLICY_ID, isRegisteredLessonAttendance } from '../lib/lesson-share-registration-policy.mjs';

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
const attendanceBody = fragment(grant, 'function attendance()', '\nasync function main()');
const receiptBody = fragment(grant, '      const receipt =', '      let quotaBlockedBeforeDispatch');
const priorGuard = fragment(grant, '      const prior =', '      const before =');
const SOURCES = { A: A261024_SHARE, B: B261024_SHARE };
const NOW = '2026-10-26T01:00:00Z';
const copy = value => structuredClone(value);

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

function registeredFixture(mutate = () => {}) {
  const evidence = { date: '2026-10-24', source: 'StudioMate live lesson-detail DOM',
    verifiedAt: '2026-10-26T00:59:00Z', sessions: Object.entries(SOURCES).flatMap(([team, source], teamIndex) =>
      source.lessonIds.map(lessonId => ({ team, lessonId, date: '2026-10-24',
        rows: Array.from({ length: 5 }, (_, index) => ({ name: `Registered ${teamIndex * 5 + index}`,
          phone: `010${String(teamIndex * 5 + index).padStart(8, '0')}`, attendance: '출석' })) }))) };
  mutate(evidence);
  const read = () => runInNewContext(`${attendanceBody}\nattendance();`, {
    readPrivate: () => copy(evidence), path: { join: () => 'synthetic-attendance' }, ROOT: 'synthetic',
    SOURCES, Date: clock(NOW), shareInstant, isRegisteredLessonAttendance,
    isDeepStrictEqual: (left, right) => isDeepStrictEqual(copy(left), copy(right)),
  });
  return { evidence, read };
}

test('10/24 includes registered absentees and preserves original attendance', () => {
  const f = registeredFixture(evidence => {
    for (const session of evidence.sessions.filter(row => row.team === 'A')) session.rows[4].attendance = '결석';
  });
  const original = copy(f.evidence), { evidence, targets } = f.read();
  assert.equal(targets.length, 10);
  const absent = targets.find(row => row.name === 'Registered 4');
  assert.equal(absent.attendance, '결석');
  assert.deepEqual(copy(absent.sessionAttendance), A261024_SHARE.lessonIds.map(lessonId => ({ lessonId, status: '결석' })));
  assert.deepEqual(copy(evidence), original);
  assert.deepEqual(f.evidence, original);
});

for (const statuses of [['결석', '결석'], ['출석', '결석'], ['결석', '출석']]) {
  test(`10/24 accepts ${statuses.join('/')} with source-ordered session evidence and forty-day new receipts`, () => {
    const f = registeredFixture(evidence => {
      for (const session of evidence.sessions) {
        const index = SOURCES[session.team].lessonIds.indexOf(session.lessonId);
        for (const row of session.rows) row.attendance = statuses[index];
        session.rows.reverse();
      }
      evidence.sessions.reverse();
    });
    const original = copy(f.evidence), { evidence, targets } = f.read();
    assert.equal(targets.length, 10);
    assert.deepEqual(copy(evidence), original);
    for (const target of targets) {
      const source = SOURCES[target.team];
      assert.equal(target.attendance, statuses[0]);
      assert.deepEqual(copy(target.sessionAttendance), source.lessonIds.map((lessonId, index) => ({ lessonId, status: statuses[index] })));
      for (const already of [false, true]) {
        const memberCode = 'm001', state = { manualImmediateGrants: {} }, saves = [];
        const before = { grade: already ? STAFF_GRADE : 'ordinary',
          group: ['paid', 'unrelated-share', ...(already ? [source.groupCode] : [])] };
        const match = { identityConfirmation: { source: 'synthetic-operator-approval' } };
        runInNewContext(receiptBody, { before, already, memberCode, state, match, stateFile: 'synthetic-only',
          afterGroups: already ? [...before.group] : [...before.group, source.groupCode],
          hash: () => 'synthetic-invariant', Date: clock(NOW), source, target, evidence,
          LESSON_VIDEO_ELIGIBILITY_POLICY_ID, save: (_file, value) => saves.push(copy(value)) });
        const receipt = state.manualImmediateGrants[memberCode];
        assert.equal(saves.length, 1);
        assert.equal(receipt.identityConfirmation, match.identityConfirmation);
        assert.equal(receipt.attendanceEvidence.source, 'studiomate_live_lesson_detail');
        assert.equal(receipt.attendanceEvidence.status, 'both_sessions_registered');
        assert.equal(receipt.attendanceEvidence.eligibilityPolicy, LESSON_VIDEO_ELIGIBILITY_POLICY_ID);
        assert.equal(receipt.attendanceEvidence.sessionAttendance, target.sessionAttendance);
        assert.deepEqual(Array.from(receipt.attendanceEvidence.lessonIds), source.lessonIds);
        assert.equal(receipt.attendanceEvidence.date, '2026-10-24');
        assert.equal(receipt.attendanceEvidence.memberCode, memberCode);
        assert.equal(receipt.attendanceEvidence.verifiedAt, evidence.verifiedAt);
        Object.assign(receipt, { status: 'group_verified', verifiedAt: NOW,
          existingGroupsPreserved: true, afterGrade: before.grade });
        const window = firstVerifiedShareWindow(receipt, source.groupCode, Date.parse(NOW));
        assert.equal(window.grantedAt, new Date(NOW).toISOString());
        assert.equal(Date.parse(window.expiresAt) - Date.parse(window.grantedAt), 40 * 86400000);
        assert.ok(before.group.every(code => receipt.afterGroups.includes(code)));
      }
    }
  });
}

for (const [name, mutate] of [
  ['cancelled', evidence => { evidence.sessions[0].rows[4].attendance = '취소'; }],
  ['unknown', evidence => { evidence.sessions[0].rows[4].attendance = '대기'; }],
  ['missing attendance', evidence => { delete evidence.sessions[0].rows[4].attendance; }],
  ['padded attendance', evidence => { evidence.sessions[0].rows[4].attendance = '출석 '; }],
  ['absent name mismatch', evidence => { evidence.sessions[0].rows[4].attendance = '결석'; evidence.sessions[1].rows[4].name = 'Other'; }],
  ['absent phone mismatch', evidence => { evidence.sessions[0].rows[4].attendance = '결석'; evidence.sessions[1].rows[4].phone = '01099999999'; }],
  ['missing registration', evidence => { evidence.sessions[0].rows.pop(); }],
  ['duplicate registration', evidence => { evidence.sessions[0].rows[4] = copy(evidence.sessions[0].rows[3]); }],
  ['invalid name', evidence => { evidence.sessions[0].rows[4].name = ''; }],
  ['invalid phone', evidence => { evidence.sessions[0].rows[4].phone = 'unknown'; }],
  ['cross-team phone', evidence => { for (const session of evidence.sessions.filter(row => row.team === 'B')) session.rows[0].phone = evidence.sessions[0].rows[0].phone; }],
  ['wrong lesson', evidence => { evidence.sessions[0].lessonId = 'other'; }],
  ['duplicate lesson', evidence => { evidence.sessions[1].lessonId = evidence.sessions[0].lessonId; }],
  ['stale evidence', evidence => { evidence.verifiedAt = '2026-10-25T22:59:59Z'; }],
]) test(`10/24 registered selection fails closed for ${name}`, () => {
  assert.throws(() => registeredFixture(mutate).read());
});

test('10/24 verified prior receipts and first timestamps remain unchanged under the new eligibility policy', () => {
  const { targets } = registeredFixture(evidence => {
    for (const session of evidence.sessions) for (const row of session.rows) row.attendance = '결석';
  }).read();
  const source = A261024_SHARE, memberCode = 'm001', results = [];
  const receipt = { status: 'group_verified', memberCode, verifiedAt: '2026-10-25T01:00:00Z',
    beforeGroups: ['paid'], afterGroups: ['paid', source.groupCode], existingGroupsPreserved: true,
    attendanceEvidence: { source: 'studiomate_live_lesson_detail', status: 'both_sessions_attended',
      date: '2026-10-24', lessonIds: [...source.lessonIds], memberCode, verifiedAt: '2026-10-25T00:59:00Z' } };
  const first = firstVerifiedShareWindow(receipt, source.groupCode, Date.parse(NOW));
  const state = { manualImmediateGrants: { [memberCode]: receipt }, entitlements: { [memberCode]: first } };
  const original = copy(state);
  runInNewContext(`for (const unused of [0]) { ${priorGuard}\nthrow Error('Unexpected regrant'); }`, {
    state, memberCode, uid: 'synthetic-uid', UNIT: 'synthetic-unit', source, target: targets[0], results,
    imwebJson: () => ({ data: { memberCode, group: ['paid', source.groupCode] } }),
  });
  assert.deepEqual(state, original);
  assert.equal(results[0].status, 'already_verified');
  assert.equal(state.entitlements[memberCode].grantedAt, '2026-10-25T01:00:00.000Z');
});

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
