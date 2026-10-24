import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  E261017_SHARE, A261024_SHARE, B261024_SHARE, STUDENT_SHARE_DAYS, STUDENT_SHARE_WINDOW_MS, STUDENT_SHARE_SOURCES,
  firstVerifiedShareWindow, shareInstant, validatedShareEntries, protectedStudentShareGroups,
} from '../lib/imweb-student-share-policy.mjs';
import { SITE, UNIT, STAFF_GRADE } from '../lib/imweb-staff-video-policy.mjs';

const START = '2026-10-18T01:16:33.501Z';
const END = '2026-11-27T01:16:33.501Z';
const START_MS = Date.parse(START);
const END_MS = Date.parse(END);
const NOW = START_MS + 2 * 86400000;
const MEMBER = 'm001';
const OTHER = 'm002';
const GROUP = E261017_SHARE.groupCode;
const copy = value => structuredClone(value);
const STAFF_START = '2026-10-25T01:16:33.501Z';
const STAFF_START_MS = Date.parse(STAFF_START);
const STAFF_END_MS = STAFF_START_MS + 40 * 86400000;
const STAFF_END = new Date(STAFF_END_MS).toISOString();

function staffReceipt(source) {
  return grant({ kind: 'student_share_existing_staff', verifiedAt: STAFF_START,
    beforeGroups: ['synthetic-paid', source.groupCode], afterGroups: ['synthetic-paid', source.groupCode],
    beforeGrade: STAFF_GRADE, afterGrade: STAFF_GRADE,
    attendanceEvidence: { source: 'studiomate_live_lesson_detail', status: 'both_sessions_attended',
      memberCode: MEMBER, date: '2026-10-24', lessonIds: [...(source.lessonIds ?? [])] },
  }, source);
}

function grant(changes = {}, source = E261017_SHARE) {
  return { status: 'group_verified', beforeGroups: ['synthetic-paid'],
    afterGroups: ['synthetic-paid', source.groupCode], existingGroupsPreserved: true,
    verifiedAt: START, ...changes };
}

function entitlement(changes = {}, source = E261017_SHARE) {
  return { memberCode: MEMBER, policyId: source.policyId, groupCode: source.groupCode,
    grantedAt: START, expiresAt: END, status: 'active',
    grantEvidence: 'manualImmediateGrants:first_verified_transition', ...changes };
}

function ledger(changes = {}, source = E261017_SHARE) {
  return { siteCode: SITE, unitCode: UNIT,
    accessPolicy: { id: source.policyId, approved: true, days: 40,
      basis: 'first_verified_grant', revocation: source.revocation },
    manualImmediateGrants: { [MEMBER]: grant({}, source) },
    entitlements: { [MEMBER]: entitlement({}, source) }, ...changes };
}

const sources = (state, selected = E261017_SHARE) => STUDENT_SHARE_SOURCES.map(source => ({
  source: copy(source), state: source === selected ? state
    : ledger({ manualImmediateGrants: {}, entitlements: {} }, source),
}));
const entries = (state, now = NOW) => validatedShareEntries(state, E261017_SHARE, now);
const protectedGroups = (state, now = NOW, code = MEMBER) => protectedStudentShareGroups(sources(state), code, now);

test('registry contains exactly E261017, A261024 and B261024 with isolated forty-day policies', () => {
  assert.deepEqual(STUDENT_SHARE_SOURCES, [E261017_SHARE, A261024_SHARE, B261024_SHARE]);
  assert.equal(E261017_SHARE.lane, 'student-share-e-261017');
  assert.equal(E261017_SHARE.policyId, 'e261017-grant-40d-v1');
  assert.equal(GROUP, 'g2026101715ef28611dff4');
  assert.deepEqual([A261024_SHARE, B261024_SHARE], [
    { policyId: 'a261024-grant-40d-v1', groupCode: 'g20261025ad8ce226150cf',
      revocation: 'a_team_group_only', lane: 'student-share-a-261024', lessonIds: ['97134106', '97134121'] },
    { policyId: 'b261024-grant-40d-v1', groupCode: 'g20261025ee18a8f4e30b9',
      revocation: 'b_team_group_only', lane: 'student-share-b-261024', lessonIds: ['97177049', '97177091'] },
  ]);
  for (const field of ['policyId', 'groupCode', 'lane', 'revocation']) {
    assert.equal(new Set(STUDENT_SHARE_SOURCES.map(source => source[field])).size, 3);
  }
  assert.equal(STUDENT_SHARE_DAYS, 40);
  assert.equal(STUDENT_SHARE_WINDOW_MS, 40 * 86400000);
});

test('shareInstant accepts explicit offsets and real leap days without changing the instant', () => {
  assert.equal(shareInstant(START), START_MS);
  assert.equal(shareInstant('2026-10-18T10:16:33.501+09:00'), START_MS);
  assert.equal(shareInstant('2024-02-29T23:59:59Z'), Date.parse('2024-02-29T23:59:59Z'));
});

test('shareInstant rejects ambiguous types, missing zones and impossible calendar times', () => {
  for (const value of [undefined, null, NaN, Infinity, START_MS, new Date(START), true, '',
    '2026-10-18', '2026-10-18T01:16:33', '2026-10-18 01:16:33Z', ` ${START}`,
    '2026-02-29T00:00:00Z', '2026-02-30T00:00:00Z', '2026-04-31T00:00:00Z',
    '2026-13-01T00:00:00Z', '2026-10-18T24:00:00Z', '2026-10-18T01:60:00Z',
    '2026-10-18T01:16:60Z', '2026-10-18T01:16:33+25:00']) {
    assert.throws(() => shareInstant(value), `Accepted invalid instant: ${String(value)}`);
  }
});

test('first verified grant fixes an exact forty-day window and never restarts it on replay', () => {
  const original = grant();
  const before = copy(original);
  for (const now of [START_MS, NOW, END_MS, END_MS + 86400000]) {
    assert.deepEqual(firstVerifiedShareWindow(original, GROUP, now), { grantedAt: START, expiresAt: END });
  }
  assert.deepEqual(original, before);
  assert.deepEqual(firstVerifiedShareWindow(grant({ grantedAt: '2026-10-18T10:16:33.501+09:00' }),
    GROUP, NOW), { grantedAt: START, expiresAt: END });
});

test('grant validation rejects invalid clocks, future evidence and conflicting first timestamps', () => {
  for (const now of [NaN, Infinity, -Infinity, String(NOW), undefined, null]) {
    assert.throws(() => firstVerifiedShareWindow(grant(), GROUP, now), `Accepted clock: ${String(now)}`);
  }
  assert.throws(() => firstVerifiedShareWindow(grant(), GROUP, START_MS - 1));
  for (const grantedAt of [new Date(START_MS - 1).toISOString(), new Date(START_MS + 1).toISOString(),
    null, '2026-10-18']) {
    assert.throws(() => firstVerifiedShareWindow(grant({ grantedAt }), GROUP, NOW));
  }
});

test('grant evidence requires a verified absent-to-present transition and genuine preservation', () => {
  for (const value of [null, [], 'grant', grant({ status: 'intent' }), grant({ status: 'result_unknown' }),
    grant({ beforeGroups: ['synthetic-paid', GROUP] }), grant({ afterGroups: ['synthetic-paid'] }),
    grant({ afterGroups: [GROUP] }), grant({ existingGroupsPreserved: false }),
    grant({ existingGroupsPreserved: 'true' }), grant({ verifiedAt: '2026-02-30T00:00:00Z' })]) {
    assert.throws(() => firstVerifiedShareWindow(value, GROUP, NOW));
  }
});

test('grant group collections reject strings and non-array shapes', () => {
  for (const [field, value] of [['beforeGroups', 'synthetic-paid'], ['afterGroups', GROUP],
    ['beforeGroups', null], ['afterGroups', { includes: true }]]) {
    assert.throws(() => firstVerifiedShareWindow(grant({ [field]: value }), GROUP, NOW), field);
  }
});

for (const [field, value] of [
  ['beforeGroups', ['synthetic-paid', 'synthetic-paid']],
  ['afterGroups', ['synthetic-paid', GROUP, GROUP]],
  ['afterGroups', ['synthetic-paid', GROUP, 123]],
  ['beforeGroups', ['']],
  ['afterGroups', ['synthetic-paid', GROUP, '']],
]) {
  test(`grant group arrays reject invalid ${field}: ${JSON.stringify(value)}`, () => {
    const changes = { [field]: value };
    if (field === 'beforeGroups' && value.includes('')) changes.afterGroups = ['', GROUP];
    assert.throws(() => firstVerifiedShareWindow(grant(changes), GROUP, NOW));
  });
}

test('validated entries retain original dates, indicate adoption and leave the ledger unchanged', () => {
  const state = ledger();
  const before = copy(state);
  const result = entries(state);
  assert.ok(result instanceof Map);
  assert.deepEqual(result.get(MEMBER), { ...entitlement(), adopted: true });
  assert.deepEqual(state, before);
});

test('grant-only evidence protects without adopting, saving or resetting its original dates', () => {
  const state = ledger({ entitlements: {} });
  const before = copy(state);
  assert.deepEqual(entries(state).get(MEMBER), {
    grantedAt: START, expiresAt: END, status: 'active', adopted: false,
  });
  assert.deepEqual(protectedGroups(state), [GROUP]);
  assert.deepEqual(protectedGroups(state, END_MS), []);
  assert.deepEqual(state, before);
});

test('protection has an exact exclusive expiry and is scoped to the canonical member', () => {
  const state = ledger();
  assert.deepEqual(protectedGroups(state, START_MS), [GROUP]);
  assert.deepEqual(protectedGroups(state, END_MS - 1), [GROUP]);
  assert.deepEqual(protectedGroups(state, END_MS), []);
  assert.deepEqual(protectedGroups(state, END_MS + 1), []);
  assert.deepEqual(protectedGroups(state, NOW, OTHER), []);
  assert.deepEqual(protectedGroups(ledger({ manualImmediateGrants: {}, entitlements: {} })), []);
});

test('terminal entitlements never resurrect from still-valid manual grant evidence', () => {
  for (const status of ['revoked', 'removed_externally']) {
    const state = ledger({ entitlements: { [MEMBER]: entitlement({ status }) } });
    const before = copy(state);
    assert.equal(entries(state).get(MEMBER).status, status);
    assert.deepEqual(protectedGroups(state), []);
    assert.deepEqual(state, before);
  }
});

test('unapproved or conflicting policies and site/unit scope fail closed', () => {
  const valid = ledger();
  for (const changes of [{ id: 'other-policy' }, { approved: false }, { approved: 'true' },
    { days: 39 }, { days: '40' }, { basis: 'lesson_date' }, { revocation: 'all_groups' }]) {
    assert.throws(() => entries(ledger({ accessPolicy: { ...valid.accessPolicy, ...changes } })));
  }
  for (const state of [null, [], {}, ledger({ accessPolicy: null }), ledger({ accessPolicy: [] }),
    ledger({ siteCode: 'other-site' }), ledger({ unitCode: 'other-unit' })]) {
    assert.throws(() => entries(state));
  }
});

test('missing, null, array and string maps cannot silently become empty evidence', () => {
  for (const field of ['entitlements', 'manualImmediateGrants']) {
    for (const value of [undefined, null, [], 'invalid']) {
      const state = ledger({ [field]: value });
      assert.throws(() => entries(state), `${field}: ${String(value)}`);
      assert.throws(() => protectedGroups(state), `${field}: ${String(value)}`);
    }
  }
});

test('entitlement identity, status, policy and original window must match the grant', () => {
  for (const changes of [{ memberCode: OTHER }, { policyId: 'other-policy' }, { groupCode: 'other-group' },
    { status: 'pending' }, { status: 'result_unknown' },
    { grantedAt: new Date(START_MS + 1).toISOString() },
    { expiresAt: new Date(END_MS + 1).toISOString() }, { expiresAt: null }]) {
    assert.throws(() => entries(ledger({ entitlements: { [MEMBER]: entitlement(changes) } })));
  }
  for (const value of [null, [], 'invalid']) {
    assert.throws(() => entries(ledger({ entitlements: { [MEMBER]: value } })));
  }
  assert.throws(() => entries(ledger({ manualImmediateGrants: {} })));
  assert.throws(() => entries(ledger({ manualImmediateGrants: { 'invalid-member': grant() }, entitlements: {} })));
});

test('invalid clocks and malformed member identities never produce protection', () => {
  for (const now of [NaN, Infinity, String(NOW), undefined, null]) {
    assert.throws(() => protectedStudentShareGroups(sources(ledger()), MEMBER, now));
  }
  for (const code of ['', 'm001 ', 'invalid-member', null, 1]) {
    assert.throws(() => protectedStudentShareGroups(sources(ledger()), code, NOW));
  }
});

test('validatedShareEntries rejects invalid clocks even when both evidence maps are empty', () => {
  for (const now of [NaN, Infinity, String(NOW), undefined, null]) {
    assert.throws(() => validatedShareEntries(ledger({ manualImmediateGrants: {}, entitlements: {} }),
      E261017_SHARE, now));
  }
});

test('pending or unknown revocation fails closed before and after expiry', () => {
  for (const revocation of [{ status: 'intent' }, { status: 'result_unknown' }, {}, null]) {
    const state = ledger({ entitlements: { [MEMBER]: entitlement({ revocation }) } });
    for (const now of [NOW, END_MS, END_MS + 1]) assert.throws(() => protectedGroups(state, now));
  }
});

test('corrupt or unresolved evidence for another member cannot be hidden by valid target evidence', () => {
  for (const otherEntry of [entitlement({ memberCode: OTHER, expiresAt: START }),
    entitlement({ memberCode: OTHER, revocation: { status: 'result_unknown' } })]) {
    const state = ledger({ manualImmediateGrants: { [MEMBER]: grant(), [OTHER]: grant() },
      entitlements: { [MEMBER]: entitlement(), [OTHER]: otherEntry } });
    assert.throws(() => protectedGroups(state));
  }
});

test('missing, duplicate, unknown and inconsistent registry sources fail closed', () => {
  for (const value of [undefined, null, {}, []]) {
    assert.throws(() => protectedStudentShareGroups(value, MEMBER, NOW));
  }
  for (const [index] of STUDENT_SHARE_SOURCES.entries()) {
    for (const corrupt of [
      value => value.filter((_, i) => i !== index),
      value => { value[index] = copy(value[(index + 1) % value.length]); return value; },
      value => { value[index] = null; return value; },
      ...[{ policyId: 'unregistered' }, { groupCode: 'other-group' }, { revocation: 'all_groups' }]
        .map(change => value => { Object.assign(value[index].source, change); return value; }),
    ]) {
      assert.throws(() => protectedStudentShareGroups(corrupt(sources(ledger())), MEMBER, NOW));
    }
  }
});

test('A and B expiry windows are independent for the same member and retain first grants', () => {
  const laterStart = new Date(START_MS + 86400000).toISOString();
  const laterEnd = new Date(END_MS + 86400000).toISOString();
  const values = sources(ledger({ manualImmediateGrants: {}, entitlements: {} }));
  values[1].state = ledger({}, A261024_SHARE);
  values[2].state = ledger({
    manualImmediateGrants: { [MEMBER]: grant({ verifiedAt: laterStart }, B261024_SHARE) },
    entitlements: { [MEMBER]: entitlement({ grantedAt: laterStart, expiresAt: laterEnd }, B261024_SHARE) },
  }, B261024_SHARE);
  const before = copy(values);
  const both = [A261024_SHARE.groupCode, B261024_SHARE.groupCode].sort();
  assert.deepEqual(protectedStudentShareGroups(values, MEMBER, NOW), both);
  assert.deepEqual(protectedStudentShareGroups(values, MEMBER, END_MS - 1), both);
  assert.deepEqual(protectedStudentShareGroups(values, MEMBER, END_MS), [B261024_SHARE.groupCode]);
  assert.deepEqual(protectedStudentShareGroups(values, MEMBER, END_MS + 86400000), []);
  assert.deepEqual(protectedStudentShareGroups(values, OTHER, NOW), []);
  assert.deepEqual(values, before);
});

for (const source of [A261024_SHARE, B261024_SHARE]) {
  const other = source === A261024_SHARE ? B261024_SHARE : A261024_SHARE;
  test(`${source.policyId} grant-only replay preserves its original clock and no other team access`, () => {
    const state = ledger({ entitlements: {} }, source);
    const before = copy(state);
    for (const now of [NOW, END_MS - 1, END_MS, END_MS + 1]) {
      assert.deepEqual(validatedShareEntries(state, source, now).get(MEMBER),
        { grantedAt: START, expiresAt: END, status: 'active', adopted: false });
      assert.deepEqual(protectedStudentShareGroups(sources(state, source), MEMBER, now),
        now < END_MS ? [source.groupCode] : []);
    }
    assert.deepEqual(state, before);
    assert.throws(() => validatedShareEntries(state, other, NOW));
    for (const changes of [{ groupCode: other.groupCode }, { policyId: other.policyId },
      { grantedAt: new Date(START_MS + 1).toISOString(), expiresAt: new Date(END_MS + 1).toISOString() }]) {
      assert.throws(() => validatedShareEntries(ledger({ entitlements: {
        [MEMBER]: entitlement(changes, source),
      } }, source), source, NOW));
    }
  });
  test(`invalid ${source.policyId} evidence blocks protection from all other sources`, () => {
    const values = sources(ledger());
    const item = values.find(value => value.source.policyId === source.policyId);
    item.state = ledger({ entitlements: {
      [MEMBER]: entitlement({ revocation: { status: 'result_unknown' } }, source),
    } }, source);
    assert.throws(() => protectedStudentShareGroups(values, MEMBER, NOW));
  });
}

test('the existing-STAFF exception is unavailable to E even with otherwise complete evidence', () => {
  assert.throws(() => firstVerifiedShareWindow(staffReceipt(E261017_SHARE), GROUP, STAFF_START_MS),
    /Student-share evidence/);
});

for (const source of [A261024_SHARE, B261024_SHARE]) {
  const other = source === A261024_SHARE ? B261024_SHARE : A261024_SHARE;
  test(`${source.policyId} accepts unchanged STAFF groups only with its own attendance receipt`, () => {
    const receipt = staffReceipt(source);
    const before = copy(receipt);
    const state = ledger({ manualImmediateGrants: { [MEMBER]: receipt }, entitlements: {} }, source);
    assert.deepEqual(firstVerifiedShareWindow(receipt, source.groupCode, STAFF_START_MS),
      { grantedAt: STAFF_START, expiresAt: STAFF_END });
    assert.deepEqual(validatedShareEntries(state, source, STAFF_START_MS).get(MEMBER),
      { grantedAt: STAFF_START, expiresAt: STAFF_END, status: 'active', adopted: false });
    assert.deepEqual(protectedStudentShareGroups(sources(state, source), MEMBER, STAFF_START_MS), [source.groupCode]);
    assert.deepEqual(receipt, before);
    assert.deepEqual(firstVerifiedShareWindow({ ...receipt, afterGroups: [...receipt.afterGroups].reverse() },
      source.groupCode, STAFF_START_MS), { grantedAt: STAFF_START, expiresAt: STAFF_END });
  });

  test(`${source.policyId} rejects incomplete, cross-team or fake-transition STAFF receipts`, () => {
    const mutations = [
      ['unannotated already-present group', value => { delete value.kind; }],
      ['unknown kind', value => { value.kind = 'already_present'; }],
      ['unverified grant', value => { value.status = 'intent'; }],
      ['non-staff before', value => { value.beforeGrade = 'ordinary'; }],
      ['non-staff after', value => { value.afterGrade = 'ordinary'; }],
      ['missing before grade', value => { delete value.beforeGrade; }],
      ['missing after grade', value => { delete value.afterGrade; }],
      ['missing attendance', value => { delete value.attendanceEvidence; }],
      ['null attendance', value => { value.attendanceEvidence = null; }],
      ['array attendance', value => { value.attendanceEvidence = []; }],
      ['untrusted source', value => { value.attendanceEvidence.source = 'cached_attendance'; }],
      ['only one session', value => { value.attendanceEvidence.status = 'one_session_attended'; }],
      ['invalid member', value => { value.attendanceEvidence.memberCode = 'invalid'; }],
      ['missing member', value => { delete value.attendanceEvidence.memberCode; }],
      ['wrong lesson date', value => { value.attendanceEvidence.date = '2026-10-17'; }],
      ['other team lessons', value => { value.attendanceEvidence.lessonIds = [...other.lessonIds]; }],
      ['missing lesson', value => { value.attendanceEvidence.lessonIds = source.lessonIds.slice(0, 1); }],
      ['duplicate lesson', value => { value.attendanceEvidence.lessonIds = [source.lessonIds[0], source.lessonIds[0]]; }],
      ['extra lesson', value => { value.attendanceEvidence.lessonIds.push('synthetic-extra'); }],
      ['missing lesson IDs', value => { delete value.attendanceEvidence.lessonIds; }],
      ['numeric lesson IDs', value => { value.attendanceEvidence.lessonIds = source.lessonIds.map(Number); }],
      ['fake absent-to-present transition', value => { value.beforeGroups = ['synthetic-paid']; }],
      ['added unrelated group', value => { value.afterGroups.push('new-permission'); }],
      ['lost unrelated group', value => { value.afterGroups = [source.groupCode]; }],
      ['replaced unrelated group', value => { value.afterGroups = ['replacement', source.groupCode]; }],
      ['duplicate existing group', value => { value.beforeGroups.push(source.groupCode); value.afterGroups.push(source.groupCode); }],
      ['unverified preservation', value => { value.existingGroupsPreserved = false; }],
      ['conflicting first timestamp', value => { value.grantedAt = new Date(STAFF_START_MS + 1).toISOString(); }],
    ];
    for (const [name, mutate] of mutations) {
      const receipt = staffReceipt(source);
      mutate(receipt);
      assert.throws(() => firstVerifiedShareWindow(receipt, source.groupCode, STAFF_START_MS),
        /Student-share evidence/, name);
    }
    assert.throws(() => firstVerifiedShareWindow(staffReceipt(source), source.groupCode, STAFF_START_MS - 1));
  });

  test(`${source.policyId} binds attendance identity to the ledger key before adoption or protection`, () => {
    for (const adopted of [false, true]) {
      const receipt = staffReceipt(source);
      receipt.attendanceEvidence.memberCode = OTHER;
      const state = ledger({ manualImmediateGrants: { [MEMBER]: receipt },
        entitlements: adopted ? { [MEMBER]: entitlement({ grantedAt: STAFF_START, expiresAt: STAFF_END }, source) } : {},
      }, source);
      const before = copy(state);
      assert.throws(() => validatedShareEntries(state, source, STAFF_START_MS), /Student-share evidence/);
      assert.throws(() => protectedStudentShareGroups(sources(state, source), MEMBER, STAFF_START_MS), /Student-share evidence/);
      assert.deepEqual(state, before);
    }
  });

  test(`${source.policyId} STAFF receipt clock is immutable across replay, adoption and exact expiry`, () => {
    const receipt = staffReceipt(source);
    const state = ledger({ manualImmediateGrants: { [MEMBER]: receipt }, entitlements: {
      [MEMBER]: entitlement({ grantedAt: STAFF_START, expiresAt: STAFF_END,
        grantEvidence: 'manualImmediateGrants:independent_attendance_share_on_staff' }, source),
    } }, source);
    const before = copy(state);
    for (const now of [STAFF_START_MS, STAFF_START_MS + 86400000, STAFF_END_MS - 1, STAFF_END_MS, STAFF_END_MS + 1]) {
      assert.deepEqual(firstVerifiedShareWindow(receipt, source.groupCode, now),
        { grantedAt: STAFF_START, expiresAt: STAFF_END });
      assert.equal(validatedShareEntries(state, source, now).get(MEMBER).grantedAt, STAFF_START);
      assert.deepEqual(protectedStudentShareGroups(sources(state, source), MEMBER, now),
        now < STAFF_END_MS ? [source.groupCode] : []);
    }
    assert.deepEqual(state, before);
    for (const status of ['revoked', 'removed_externally']) {
      const terminal = copy(state); terminal.entitlements[MEMBER].status = status;
      assert.deepEqual(protectedStudentShareGroups(sources(terminal, source), MEMBER, STAFF_START_MS), []);
    }
    const shifted = copy(state);
    shifted.entitlements[MEMBER].grantedAt = new Date(STAFF_START_MS + 86400000).toISOString();
    shifted.entitlements[MEMBER].expiresAt = new Date(STAFF_END_MS + 86400000).toISOString();
    assert.throws(() => validatedShareEntries(shifted, source, STAFF_START_MS + 86400000), /Student-share evidence/);
  });
}

// Isolate HOME as well as root so a reader that ignores root cannot reach private state.
const readerScript = `
  import { readStudentShareLedgers } from ${JSON.stringify(new URL('../lib/imweb-student-share-policy.mjs', import.meta.url).href)};
  try {
    const ledgers = await readStudentShareLedgers({ root: process.argv[1] });
    process.stdout.write(JSON.stringify({ ok: true, ledgers }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, name: error.name }));
  }
`;

function readerFixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'student-share-policy-offline-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.chmodSync(base, 0o700);
  const home = path.join(base, 'synthetic-home');
  const root = path.join(base, 'private-state-parent');
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(root, { mode: 0o700 });
  const lanes = sources(ledger()).map(({ source, state }) => {
    const directory = path.join(root, source.lane);
    fs.mkdirSync(directory, { mode: 0o700 });
    const file = path.join(directory, 'state.json');
    fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
    return { source, directory, file };
  });
  const { directory, file } = lanes[0];
  function read(from = root) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', readerScript, from], {
      encoding: 'utf8', timeout: 5000, env: { ...process.env, HOME: home },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  return { base, home, root, directory, file, lanes, read };
}

test('reader uses the explicit private-state parent rather than HOME and does not change files', t => {
  const f = readerFixture(t);
  const before = f.lanes.map(lane => fs.readFileSync(lane.file, 'utf8'));
  const result = f.read();
  assert.equal(result.ok, true);
  assert.deepEqual(result.ledgers, sources(ledger()));
  assert.deepEqual(protectedStudentShareGroups(result.ledgers, MEMBER, NOW), [GROUP]);
  assert.deepEqual(f.lanes.map(lane => fs.readFileSync(lane.file, 'utf8')), before);
  for (const lane of f.lanes) assert.deepEqual(fs.readdirSync(lane.directory), ['state.json']);
  assert.deepEqual(fs.readdirSync(f.home), []);
});

for (const missing of ['root', 'directory', 'file']) {
  test(`reader rejects missing ${missing} without recreating it`, t => {
    const f = readerFixture(t);
    fs.rmSync(f[missing], { recursive: true });
    assert.equal(f.read().ok, false);
    assert.equal(fs.existsSync(f[missing]), false);
  });
}

test('reader rejects malformed JSON without overwriting the source', t => {
  const f = readerFixture(t);
  fs.writeFileSync(f.file, '{ malformed synthetic JSON');
  assert.equal(f.read().ok, false);
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{ malformed synthetic JSON');
});

for (const target of ['root', 'directory', 'file']) {
  test(`reader rejects a symlinked ${target}`, t => {
    const f = readerFixture(t);
    const original = f[target];
    const moved = path.join(f.base, `synthetic-${target}-target`);
    fs.renameSync(original, moved);
    fs.symlinkSync(moved, original);
    assert.equal(f.read().ok, false);
    assert.equal(fs.lstatSync(original).isSymbolicLink(), true);
  });
}

for (const mode of [0o755, 0o711]) {
  test(`reader permits shared root permissions ${mode.toString(8)} without changing them`, t => {
    const f = readerFixture(t);
    fs.chmodSync(f.root, mode);
    const result = f.read();
    assert.equal(result.ok, true);
    assert.deepEqual(result.ledgers, sources(ledger()));
    assert.equal(fs.lstatSync(f.root).mode & 0o777, mode);
    assert.equal(fs.lstatSync(f.directory).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(f.file).mode & 0o777, 0o600);
  });
}

for (const [target, mode] of [['root', 0o775], ['root', 0o777], ['directory', 0o750], ['file', 0o640], ['file', 0o606]]) {
  test(`reader rejects unsafe ${target} permissions ${mode.toString(8)}`, t => {
    const f = readerFixture(t);
    fs.chmodSync(f[target], mode);
    assert.equal(f.read().ok, false);
    assert.equal(fs.lstatSync(f[target]).mode & 0o777, mode);
  });
}

test('reader rejects a state path that is a directory', t => {
  const f = readerFixture(t);
  fs.unlinkSync(f.file);
  fs.mkdirSync(f.file, { mode: 0o700 });
  assert.equal(f.read().ok, false);
});

for (const source of [A261024_SHARE, B261024_SHARE]) {
  for (const corrupt of ['missing', 'malformed', 'directory-mode', 'file-mode', 'symlink']) {
    test(`reader fails closed for ${source.policyId}: ${corrupt}`, t => {
      const f = readerFixture(t);
      const lane = f.lanes.find(value => value.source.policyId === source.policyId);
      const before = fs.readFileSync(f.file, 'utf8');
      if (corrupt === 'missing') fs.unlinkSync(lane.file);
      if (corrupt === 'malformed') fs.writeFileSync(lane.file, '{ invalid synthetic JSON');
      if (corrupt === 'directory-mode') fs.chmodSync(lane.directory, 0o750);
      if (corrupt === 'file-mode') fs.chmodSync(lane.file, 0o640);
      if (corrupt === 'symlink') {
        const moved = path.join(f.base, 'synthetic-share-target');
        fs.renameSync(lane.file, moved);
        fs.symlinkSync(moved, lane.file);
      }
      assert.equal(f.read().ok, false);
      assert.equal(fs.readFileSync(f.file, 'utf8'), before);
      if (corrupt === 'missing') assert.equal(fs.existsSync(lane.file), false);
    });
  }
}
