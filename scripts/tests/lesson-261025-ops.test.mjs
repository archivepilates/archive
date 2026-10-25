import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { matchLessonShareMember } from '../lib/lesson-share-261024.mjs';
import { assertMemberPreserved } from '../lib/imweb-staff-video-policy.mjs';
import { firstVerifiedShareWindow as sharedFirstVerifiedShareWindow } from '../lib/imweb-student-share-policy.mjs';

const sourceText = readFileSync(new URL('../grant-lesson-261025.mjs', import.meta.url), 'utf8');
// Evaluate the runner body with memory-only IO; never import or invoke its live entrypoint.
const body = sourceText.slice(sourceText.indexOf('const ROOT ='), sourceText.indexOf('\nif (process.argv[1]'));
assert.ok(body.startsWith('const ROOT =') && body.endsWith('\n'));
const HOME = '/synthetic-home';
const ROOT = `${HOME}/Library/Application Support/ARCHIVE PILATES/lesson-videos-261025`;
const SITE = 'S20260516852c71a014d08', UNIT = 'u2026051698c99ea234719';
const STAFF_GRADE = 'g2026101335a27ee84d335';
const START = Date.parse('2026-10-26T01:00:00Z');
const copy = value => structuredClone(value);
const makeSource = (team, groupCode, lessonIds) => ({ groupCode, lessonIds,
  policyId: `${team.toLowerCase()}261025-grant-40d-v1`, lane: `student-share-${team.toLowerCase()}-261025`,
  revocation: `${team.toLowerCase()}_team_group_only`, lessonDate: '2026-10-25' });
const C = makeSource('C', 'g202610257569d3a4255d5', ['97134107', '97134122']);
const D = makeSource('D', 'g202610252ef2256e312c1', ['97177137', '97177166']);
const stateFile = source => `${HOME}/Library/Application Support/ARCHIVE PILATES/${source.lane}/state.json`;
const roster = team => Array.from({ length: 5 }, (_, index) => {
  const number = index + (team === 'C' ? 1 : 6);
  return { name: `Attendee ${number}`, phone: `010${String(number).padStart(8, '0')}`, attendance: '출석' };
});
const fourC = evidence => {
  for (const session of evidence.sessions.filter(row => row.team === 'C')) session.rows[4].attendance = '결석';
};
const shareInstant = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw Error('Invalid synthetic timestamp');
  return Date.parse(value);
};

function fixture(options = {}) {
  let now = START;
  const DateMock = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const c = copy(C), d = copy(D);
  const extra = { policyId: 'prior-policy', groupCode: 'e-group', lane: 'student-share-e-261017' };
  const sources = [extra, c, d];
  const files = new Map();
  const put = (file, value) => files.set(file, JSON.stringify(value));
  const read = file => JSON.parse(files.get(file));
  const evidence = { date: '2026-10-25', source: 'StudioMate live lesson-detail DOM',
    verifiedAt: new Date(START - 60000).toISOString(), sessions: [c, d].flatMap((source, index) =>
      source.lessonIds.map(lessonId => ({ team: index ? 'D' : 'C', lessonId, date: '2026-10-25', rows: roster(index ? 'D' : 'C') }))) };
  const ready = { date: '2026-10-25', nativePagesPublished: true, teamIsolationVerified: true,
    teams: Object.fromEntries(['C', 'D'].map(team => [team, { videos: Array.from({ length: 2 }, () =>
      ({ privacyStatus: 'unlisted', processing: 'succeeded' })) }])) };
  options.evidence?.(evidence);
  options.ready?.(ready);
  put(`${ROOT}/attendance.json`, evidence);
  put(`${ROOT}/delivery-ready.json`, ready);
  for (const source of sources) put(stateFile(source), { manualImmediateGrants: {}, entitlements: {} });
  const live = new Map([...roster('C'), ...roster('D')].map((row, index) => {
    const member = { uid: `uid-${index + 1}`, memberCode: `m${String(index + 1).padStart(3, '0')}`,
      siteCode: SITE, unitCode: UNIT, name: row.name, callnum: row.phone, grade: 'ordinary',
      point: 123, coupon: ['existing-coupon'], group: ['paid', 'E-existing', 'A-existing', 'B-existing'] };
    return [member.uid, member];
  }));
  const calls = [], saves = [], output = [], open = new Map();
  const counters = { executions: 0, writes: 0, scans: 0, released: 0, acquired: 0, windows: 0 };
  let fd = 0;
  const fs = {
    lstatSync(file) {
      if (!files.has(file)) throw Error('Missing synthetic file');
      return { isFile: () => true, isSymbolicLink: () => false, uid: 123, mode: options.unsafeFile ? 0o644 : 0o600 };
    },
    readFileSync(file) { return files.get(file); },
    openSync(file, flags) {
      if (options.failLock && file.endsWith(`${options.failLock}/run.lock`)) throw Error('Held lane lock');
      if (flags === 'wx') {
        if (files.has(file)) throw Error('Synthetic EEXIST');
        files.set(file, '');
      }
      open.set(++fd, { file, flags }); return fd;
    },
    writeSync(handle, data) {
      const { file } = open.get(handle);
      if (options.failIntentSave && file.includes('/student-share-c-261025/state.json.')
          && data.includes('"status": "intent"')) throw Error('Synthetic durable save failed');
      files.set(file, data);
    },
    fsyncSync() {},
    closeSync(handle) { open.delete(handle); },
    renameSync(from, to) {
      files.set(to, files.get(from)); files.delete(from);
      saves.push({ file: to, value: read(to) });
    },
    unlinkSync(file) {
      files.delete(file);
      if (options.failCleanup && file.endsWith('student-share-d-261025/run.lock')) throw Error('Synthetic cleanup failure');
    },
  };
  const execute = (_binary, args) => {
    counters.executions++;
    if (options.failure === 'quota') throw { stderr: JSON.stringify({ error: { code: 'write_quota_exceeded' } }) };
    if (options.failure === 'text-quota') throw { stderr: 'write_quota_exceeded' };
    const member = live.get(args[3]);
    const data = JSON.parse(args[args.indexOf('--data') + 1]);
    member.group = data.groupCodes; counters.writes++;
    if (options.failure === 'unknown') throw Error('Synthetic connection lost after mutation');
    return {};
  };
  const imwebJson = (args, io) => {
    calls.push(copy(args));
    if (args[0] === 'config') return options.context || { resolved_profile: { site_code: SITE, unit_code: UNIT },
      token: { status: 'healthy' }, remote_context: { write_ready: true } };
    if (args[1] === 'get') {
      const member = copy(live.get(args[2]));
      options.detail?.(member, calls);
      return { data: member };
    }
    if (args[1] === 'groups') {
      const list = [...live.values()].filter(member => member.group.includes(args[3])).map(copy);
      return { data: { list, totalCount: options.incompleteGroup ? list.length + 1 : list.length } };
    }
    if (args[1] === 'update') {
      const data = JSON.parse(args[args.indexOf('--data') + 1]);
      if (args.includes('--dry-run')) {
        const result = { confirmation_token: 'synthetic-confirmation', body: data };
        options.dry?.(result);
        return result;
      }
      assert.ok(args.includes('--yes'));
      const intent = read(stateFile(args[3].startsWith('uid-') && Number(args[3].slice(4)) <= 5 ? c : d));
      assert.equal(intent.manualImmediateGrants[live.get(args[3]).memberCode].status, 'intent');
      return io.execute('synthetic-imweb', args);
    }
    throw Error(`Unexpected synthetic operation ${args.slice(0, 3)}`);
  };
  const bindings = { fs, os: { homedir: () => HOME }, path, createHash,
    isDeepStrictEqual: (left, right) => isDeepStrictEqual(copy(left), copy(right)),
    execFileSync: execute, imwebJson, SITE, UNIT, STAFF_GRADE, assertMemberPreserved,
    C261025_SHARE: c, D261025_SHARE: d, STUDENT_SHARE_SOURCES: sources,
    MEMBER_GROUP_LOCK: `${HOME}/shared-member-groups.lock`, shareInstant, matchLessonShareMember,
    Date: DateMock, console: { log: text => output.push(JSON.parse(text)) },
    process: { argv: ['node', 'synthetic-runner', ...(options.args || ['--apply'])], pid: 42, getuid: () => 123 },
    staffMembers: () => {
      counters.scans++;
      options.scan?.(live, counters.scans, () => { now += 2 * 3600000; });
      return [...live.values()].map(copy);
    },
    readStudentShareLedgers: () => options.ledgers ? options.ledgers(sources.map(source => ({ source, state: read(stateFile(source)) })))
      : sources.map(source => ({ source, state: read(stateFile(source)) })),
    validatedShareEntries: (state, source) => {
      options.validate?.(state, source);
      for (const receipt of Object.values(state.manualImmediateGrants)) {
        if (receipt.status !== 'group_verified') throw Error('Unresolved synthetic receipt');
      }
    },
    firstVerifiedShareWindow: (receipt, groupCode, at) => {
      counters.windows++;
      assert.equal(receipt.status, 'group_verified');
      assert.equal(receipt.existingGroupsPreserved, true);
      assert.equal(receipt.attendanceEvidence.date, '2026-10-25');
      const source = [c, d].find(source => source.groupCode === groupCode);
      assert.deepEqual(Array.from(receipt.attendanceEvidence.lessonIds), source.lessonIds);
      assert.ok(receipt.beforeGroups.every(code => receipt.afterGroups.includes(code)));
      if (receipt.kind === 'student_share_existing_staff') {
        assert.equal(receipt.beforeGrade, STAFF_GRADE); assert.equal(receipt.afterGrade, STAFF_GRADE);
        assert.deepEqual(Array.from(receipt.beforeGroups), Array.from(receipt.afterGroups));
      } else assert.ok(!receipt.beforeGroups.includes(groupCode));
      const first = shareInstant(receipt.verifiedAt);
      assert.ok(first <= at);
      return sharedFirstVerifiedShareWindow(receipt, groupCode, at);
    },
    acquireStudioMateBrowserLock: async input => {
      counters.acquired++; assert.equal(input.lockPath, `${HOME}/shared-member-groups.lock`);
      assert.equal(input.owner, 'lesson-share-261025-grant');
      if (options.busy) throw Error('Shared lock busy');
      return async () => { counters.released++; };
    },
  };
  const runner = runInNewContext(`${body}\n({ main, attendance, assertSources });`, bindings);
  return { ...runner, c, d, extra, sources, files, put, read, live, calls, saves, output, counters, open, bindings };
}

test('entrypoint is import-guarded and only allows the existing two flags', async () => {
  assert.match(sourceText, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  for (const flag of ['--team=A', '--root=/tmp', '--now=0', '--force', '--date=2026-10-24']) {
    const f = fixture({ args: [flag] });
    await assert.rejects(f.main(), /Unsupported argument/);
    assert.equal(f.counters.acquired, 0); assert.equal(f.calls.length, 0);
  }
});

test('C/D source registration pins group, policy, lane, revocation and lesson IDs before IO', async () => {
  for (const field of ['groupCode', 'policyId', 'lane', 'revocation', 'lessonIds', 'lessonDate']) {
    const f = fixture(); f.c[field] = field === 'lessonIds' ? ['97134106', '97134121'] : 'wrong';
    await assert.rejects(f.main(), /conflicting 10\/25 source/);
    assert.equal(f.counters.acquired, 0); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.sources.splice(f.sources.indexOf(f.d), 1);
  await assert.rejects(f.main(), /conflicting 10\/25 source/);
});

test('fresh C/D attendance yields exactly ten distinct team-scoped targets', () => {
  const f = fixture(), { targets } = f.attendance();
  assert.equal(targets.length, 10);
  assert.deepEqual(Array.from(new Set(targets.map(row => row.team))), ['C', 'D']);
});

test('five registered per class with four C and five D attended yields nine actual targets', () => {
  const f = fixture({ evidence: fourC }), { evidence, targets } = f.attendance();
  assert.ok(evidence.sessions.every(session => session.rows.length === 5));
  assert.equal(targets.length, 9);
  assert.equal(targets.filter(row => row.team === 'C').length, 4);
  assert.equal(targets.filter(row => row.team === 'D').length, 5);
  assert.ok(targets.every(row => row.attendance === '출석'));
  assert.ok(!targets.some(row => row.phone === roster('C')[4].phone));
});

test('nine-attendee apply never reads, grants or starts a clock for the absent registered member', async () => {
  const f = fixture({ evidence: fourC }), absent = copy(f.live.get('uid-5'));
  const prior = f.files.get(stateFile(f.extra));
  await f.main();
  assert.equal(f.counters.writes, 9); assert.equal(f.counters.windows, 9);
  assert.equal(f.output[0].results.length, 9);
  assert.ok(f.output[0].results.every(row => row.status === 'group_verified'));
  assert.deepEqual(f.live.get('uid-5'), absent);
  assert.ok(!f.calls.some(args => args[0] === 'member'
    && (args[1] === 'get' && args[2] === 'uid-5' || args[1] === 'update' && args[3] === 'uid-5')));
  const c = f.read(stateFile(f.c));
  for (const map of [c.manualImmediateGrants, c.entitlements, c.grantAttempts || {}]) assert.equal(map.m005, undefined);
  assert.equal(Object.keys(c.entitlements).length, 4);
  assert.equal(Object.keys(f.read(stateFile(f.d)).entitlements).length, 5);
  assert.equal(f.files.get(stateFile(f.extra)), prior);
});

test('nine actual attendees still grant only seven unique matches and retain two D identity holds', async () => {
  const f = fixture({ evidence: fourC });
  f.live.set('duplicate-d-uid', { ...copy(f.live.get('uid-9')), uid: 'duplicate-d-uid', memberCode: 'm999' });
  f.live.get('uid-10').callnum = '';
  const withheld = ['uid-5', 'uid-9', 'uid-10', 'duplicate-d-uid'].map(uid => [uid, copy(f.live.get(uid))]);
  await f.main();
  const results = f.output[0].results;
  assert.equal(results.length, 9); assert.equal(f.counters.writes, 7); assert.equal(f.counters.windows, 7);
  assert.equal(results.filter(row => row.status === 'group_verified').length, 7);
  const holds = results.filter(row => row.status === 'hold');
  assert.equal(holds.length, 2); assert.ok(holds.every(row => row.team === 'D'));
  assert.deepEqual(holds.map(row => row.reason).sort(), ['ambiguous_exact_match', 'identity_mismatch']);
  for (const [uid, member] of withheld) assert.deepEqual(f.live.get(uid), member);
  assert.equal(Object.keys(f.read(stateFile(f.c)).entitlements).length, 4);
  const d = f.read(stateFile(f.d));
  assert.equal(Object.keys(d.entitlements).length, 3);
  for (const code of ['m009', 'm010', 'm999']) {
    assert.equal(d.entitlements[code], undefined); assert.equal(d.manualImmediateGrants[code], undefined);
  }
});

test('registered and attended identity sets are order independent across sessions', () => {
  const f = fixture({ evidence(value) { fourC(value); value.sessions[1].rows.reverse(); value.sessions[3].rows.reverse(); } });
  assert.equal(f.attendance().targets.length, 9);
});

for (const [name, mutate] of [
  ['unknown status', value => { value.sessions[0].rows[4].attendance = '대기'; }],
  ['missing status', value => { delete value.sessions[0].rows[4].attendance; }],
  ['padded status', value => { value.sessions[0].rows[4].attendance = '출석 '; }],
  ['one-session absence', value => { value.sessions[0].rows[4].attendance = '결석'; }],
  ['different absentees with equal counts', value => { fourC(value); value.sessions[1].rows[4].attendance = '출석'; value.sessions[1].rows[3].attendance = '결석'; }],
  ['absent registration name mismatch', value => { fourC(value); value.sessions[1].rows[4].name = 'Other registration'; }],
  ['absent registration phone mismatch', value => { fourC(value); value.sessions[1].rows[4].phone = '01099999999'; }],
  ['empty attended set', value => { for (const session of value.sessions.filter(row => row.team === 'C')) for (const row of session.rows) row.attendance = '결석'; }],
  ['six registered rows', value => { value.sessions[0].rows.push({ name: 'Extra registration', phone: '01099999999', attendance: '결석' }); }],
  ['malformed absent name', value => { fourC(value); value.sessions[0].rows[4].name = ''; }],
  ['malformed absent phone', value => { fourC(value); value.sessions[0].rows[4].phone = 'unknown'; }],
  ['duplicate absent registration', value => { fourC(value); value.sessions[0].rows[4] = { ...value.sessions[0].rows[3], attendance: '결석' }; }],
  ['cross-team absent phone', value => { fourC(value); for (const session of value.sessions.filter(row => row.team === 'D')) session.rows[0].phone = value.sessions[0].rows[4].phone; }],
  ['cross-team absent identity', value => { fourC(value); for (const session of value.sessions.filter(row => row.team === 'D')) session.rows[0] = { ...value.sessions[0].rows[4], attendance: '출석' }; }],
]) test(`registered/attended validation rejects ${name} before any scan, intent or write`, async () => {
  const f = fixture({ evidence: mutate }); await assert.rejects(f.main());
  assert.equal(f.counters.scans, 0); assert.equal(f.counters.executions, 0); assert.equal(f.saves.length, 0);
  assert.equal(f.counters.released, 1);
});

for (const [name, mutate] of [
  ['stale', value => { value.verifiedAt = new Date(START - 7200001).toISOString(); }],
  ['future', value => { value.verifiedAt = new Date(START + 1).toISOString(); }],
  ['wrong day', value => { value.date = '2026-10-24'; }],
  ['cached source', value => { value.source = 'cached'; }],
  ['missing class', value => { value.sessions.pop(); }],
  ['A lesson', value => { value.sessions[0].lessonId = '97134106'; }],
  ['duplicate class', value => { value.sessions[1].lessonId = value.sessions[0].lessonId; }],
  ['wrong session date', value => { value.sessions[0].date = '2026-10-24'; }],
  ['short roster', value => { value.sessions[0].rows.pop(); }],
  ['non-attendance', value => { value.sessions[0].rows[0].attendance = '취소'; }],
  ['duplicate attendee', value => { value.sessions[0].rows[1] = copy(value.sessions[0].rows[0]); }],
  ['two-session mismatch', value => { value.sessions[0].rows[0].name = 'Other'; }],
  ['cross-team phone', value => { value.sessions[2].rows[0].phone = value.sessions[3].rows[0].phone = value.sessions[0].rows[0].phone; }],
]) test(`attendance rejects ${name} before any member scan or grant`, async () => {
  const f = fixture({ evidence: mutate });
  await assert.rejects(f.main());
  assert.equal(f.counters.scans, 0); assert.equal(f.counters.executions, 0);
  assert.equal(f.counters.released, 1);
});

test('exact two-hour attendance boundary remains inclusive', () => {
  const f = fixture({ evidence: value => { value.verifiedAt = new Date(START - 7200000).toISOString(); } });
  assert.equal(f.attendance().targets.length, 10);
});

for (const mutate of [value => { value.date = '2026-10-24'; }, value => { value.nativePagesPublished = false; },
  value => { value.teamIsolationVerified = false; }, value => { delete value.teams.D; },
  value => { value.teams.C.videos.pop(); }, value => { value.teams.D.videos[0].privacyStatus = 'public'; },
  value => { value.teams.C.videos[0].processing = 'processing'; }]) {
  test('unready or wrong-team delivery blocks all grants', async () => {
    const f = fixture({ ready: mutate });
    await assert.rejects(f.main(), /Verified protected delivery pages required/);
    assert.equal(f.counters.scans, 0); assert.equal(f.counters.executions, 0);
  });
}

test('unsafe private evidence and wrong site/auth context fail before grants', async () => {
  for (const options of [{ unsafeFile: true }, { context: {} }]) {
    const f = fixture(options); await assert.rejects(f.main());
    assert.equal(f.counters.executions, 0); assert.equal(f.counters.released, 1);
  }
});

test('missing or duplicate C/D ledger blocks before acquiring any lane lock', async () => {
  for (const ledgers of [rows => rows.filter(row => row.source !== rows[1].source), rows => [...rows, rows[1]]]) {
    const f = fixture({ ledgers });
    await assert.rejects(f.main(), /Exactly one ledger/);
    assert.equal(f.counters.scans, 0); assert.equal(f.open.size, 0);
  }
});

test('apply persists intent before each mock write and preserves all prior permissions and metadata', async () => {
  const f = fixture(), before = copy([...f.live.values()]);
  const prior = f.files.get(stateFile(f.extra));
  await f.main();
  assert.equal(f.counters.writes, 10); assert.equal(f.counters.windows, 10);
  for (const [index, member] of [...f.live.values()].entries()) {
    const source = index < 5 ? f.c : f.d;
    assertMemberPreserved(before[index], member, [...before[index].group, source.groupCode]);
    const state = f.read(stateFile(source)), entry = state.entitlements[member.memberCode];
    assert.equal(entry.policyId, source.policyId);
    assert.equal(entry.grantedAt, new Date(START).toISOString());
    assert.equal(Date.parse(entry.expiresAt) - Date.parse(entry.grantedAt), 40 * 86400000);
    assert.equal(state.manualImmediateGrants[member.memberCode].status, 'group_verified');
  }
  assert.equal(f.files.get(stateFile(f.extra)), prior);
  assert.ok(f.saves.every(row => row.file.includes('261025')));
  assert.equal(f.open.size, 0); assert.equal(f.counters.released, 1);
  const firstWindows = [f.files.get(stateFile(f.c)), f.files.get(stateFile(f.d))];
  await f.main();
  assert.equal(f.counters.writes, 10); assert.equal(f.counters.windows, 10);
  assert.deepEqual([f.files.get(stateFile(f.c)), f.files.get(stateFile(f.d))], firstWindows);
  assert.ok(f.output.at(-1).results.every(row => row.status === 'already_verified'));
});

test('plan mode creates only its plan receipt, never a grant/intent or provider apply', async () => {
  const f = fixture({ args: [] }), before = copy([...f.live.values()]);
  await f.main();
  assert.equal(f.counters.executions, 0); assert.deepEqual([...f.live.values()], before);
  assert.deepEqual(f.saves.map(row => row.file), [`${ROOT}/grants-plan.json`]);
});

test('ordinary preexisting groups are held, and existing STAFF shares are recorded without writes', async () => {
  const f = fixture();
  for (const [index, member] of [...f.live.values()].entries()) {
    member.group.push(index < 5 ? f.c.groupCode : f.d.groupCode);
    if (index >= 5) member.grade = STAFF_GRADE;
  }
  await f.main();
  assert.equal(f.counters.executions, 0); assert.equal(f.counters.windows, 5);
  assert.equal(f.output[0].results.filter(row => row.status === 'hold').length, 5);
  assert.equal(Object.keys(f.read(stateFile(f.c)).manualImmediateGrants).length, 0);
  assert.ok(Object.values(f.read(stateFile(f.d)).manualImmediateGrants).every(row => row.kind === 'student_share_existing_staff'));
});

test('staff-only scope defers absent groups without claiming quota exhaustion', async () => {
  const f = fixture({ args: ['--apply', '--existing-staff-only'] });
  await f.main();
  assert.equal(f.counters.executions, 0);
  assert.ok(f.output[0].results.every(row => row.reason === 'existing_staff_only_scope'));
});

test('no member, identity mismatch and shared phones never grant those targets', async () => {
  const f = fixture(); f.live.delete('uid-1'); f.live.get('uid-2').callnum = '';
  f.live.get('uid-4').callnum = f.live.get('uid-3').callnum;
  await f.main();
  const results = f.output[0].results;
  assert.equal(results[0].status, 'no_member');
  assert.equal(results[1].reason, 'identity_mismatch');
  assert.equal(results[2].reason, 'ambiguous_phone');
  assert.equal(results[3].reason, 'identity_mismatch');
  assert.equal(f.counters.writes, 6);
});

test('a newly duplicated identity at final directory recheck stops before intent', async () => {
  const f = fixture({ scan(live, count) {
    if (count === 2) live.set('duplicate', { ...copy(live.get('uid-1')), uid: 'duplicate', memberCode: 'm999' });
  } });
  await assert.rejects(f.main(), /no longer unique/);
  assert.equal(f.counters.executions, 0); assert.equal(f.saves.length, 0);
});

test('changed group metadata or dry-run contents prevents intent and dispatch', async () => {
  for (const options of [{ detail(member, calls) {
    if (calls.filter(args => args[1] === 'get').length === 2) member.group.push('concurrent');
  } }, { detail(member, calls) {
    if (calls.filter(args => args[1] === 'get').length === 2) member.grade = STAFF_GRADE;
  } }, { detail(member, calls) {
    if (calls.filter(args => args[1] === 'get').length === 2) member.point++;
  } }, { dry(value) { value.body.groupCodes = ['wrong']; } },
  { dry(value) { value.safety = { bulk_confirmation_required_for_execute: true }; } }]) {
    const f = fixture(options); await assert.rejects(f.main());
    assert.equal(f.counters.executions, 0); assert.equal(f.saves.length, 0);
  }
});

test('duplicate groups or the fifty-group limit block before intent', async () => {
  for (const group of [['paid', 'paid'], Array.from({ length: 50 }, (_, index) => `existing-${index}`)]) {
    const f = fixture(); f.live.get('uid-1').group = group;
    await assert.rejects(f.main(), /Unsafe member group set/);
    assert.equal(f.counters.executions, 0); assert.equal(f.saves.length, 0);
  }
});

test('bulk confirmation token is passed without bypassing the normal confirmation', async () => {
  const f = fixture({ dry(value) {
    value.safety = { bulk_confirmation_required_for_execute: true, bulk_confirmation_token: 'synthetic-bulk' };
  } });
  await f.main();
  const writes = f.calls.filter(args => args.includes('--yes'));
  assert.equal(writes.length, 10);
  assert.ok(writes.every(args => args[args.indexOf('--bulk-confirm-token') + 1] === 'synthetic-bulk'
    && args[args.indexOf('--confirm-token') + 1] === 'synthetic-confirmation'));
});

test('a previously verified share whose group disappeared is not automatically regranted', async () => {
  const f = fixture();
  f.put(stateFile(f.c), { manualImmediateGrants: { m001: { status: 'group_verified',
    verifiedAt: new Date(START - 86400000).toISOString() } }, entitlements: {} });
  await assert.rejects(f.main(), /no automatic regrant/);
  assert.equal(f.counters.executions, 0); assert.equal(f.saves.length, 0);
});

test('a changed native UID cannot redirect a grant to another account', async () => {
  const f = fixture({ detail(member) { member.uid = 'other-uid'; } });
  await assert.rejects(f.main(), /Member identity changed/);
  assert.equal(f.counters.executions, 0); assert.equal(f.saves.length, 0);
});

test('attendance becoming stale during recheck blocks intent', async () => {
  const f = fixture({ scan(_live, count, advance) { if (count === 2) advance(); } });
  await assert.rejects(f.main(), /Fresh live attendance/);
  assert.equal(f.counters.executions, 0); assert.equal(f.saves.length, 0);
});

test('quota holds from prior sources are respected without touching their ledgers', async () => {
  const f = fixture();
  f.put(stateFile(f.extra), { manualImmediateGrants: {}, entitlements: {}, grantAttempts: { prior: {
    status: 'blocked_before_dispatch', reason: 'write_quota_exceeded', quotaConfirmedAt: new Date(START).toISOString() } } });
  const before = f.files.get(stateFile(f.extra));
  await f.main();
  assert.equal(f.counters.executions, 0);
  assert.ok(f.output[0].results.every(row => row.reason === 'local_cli_quota_no_provider_attempt'));
  assert.equal(f.files.get(stateFile(f.extra)), before);
});

test('structured quota failure starts no clock and defers all following absent groups', async () => {
  const f = fixture({ failure: 'quota' }); await f.main();
  const state = f.read(stateFile(f.c));
  assert.equal(f.counters.executions, 1); assert.equal(f.counters.writes, 0);
  assert.deepEqual(state.manualImmediateGrants, {}); assert.deepEqual(state.entitlements, {});
  assert.equal(state.grantAttempts.m001.firstGrantNotStarted, true);
  assert.equal(state.grantAttempts.m001.verifiedAt, undefined);
  assert.equal(f.output[0].results.length, 10);
  await f.main(); assert.equal(f.counters.executions, 1);
});

test('prior-day quota hold resets at KST midnight, not UTC midnight', async () => {
  const f = fixture();
  f.put(stateFile(f.c), { manualImmediateGrants: {}, entitlements: {}, grantAttempts: { prior: {
    status: 'blocked_before_dispatch', reason: 'write_quota_exceeded', quotaConfirmedAt: '2026-10-25T14:59:59.999Z' } } });
  await f.main(); assert.equal(f.counters.writes, 10);
});

for (const failure of ['unknown', 'text-quota']) test(`${failure} failure remains blocking unknown and is never replayed`, async () => {
  const f = fixture({ failure });
  await assert.rejects(f.main(), /reconcile current state/);
  const receipt = f.read(stateFile(f.c)).manualImmediateGrants.m001;
  assert.equal(receipt.status, 'result_unknown');
  assert.deepEqual(f.read(stateFile(f.c)).entitlements, {});
  assert.equal(f.counters.executions, 1);
  await assert.rejects(f.main(), /Unresolved synthetic receipt/);
  assert.equal(f.counters.executions, 1);
});

test('incomplete independent group readback records unknown rather than an entitlement', async () => {
  const f = fixture({ incompleteGroup: true });
  await assert.rejects(f.main(), /reconcile current state/);
  assert.equal(f.read(stateFile(f.c)).manualImmediateGrants.m001.status, 'result_unknown');
  assert.deepEqual(f.read(stateFile(f.c)).entitlements, {});
});

test('failed durable intent prevents execution and releases shared/lane locks', async () => {
  const f = fixture({ failIntentSave: true });
  await assert.rejects(f.main(), /durable save failed/);
  assert.equal(f.counters.executions, 0); assert.equal(f.open.size, 0); assert.equal(f.counters.released, 1);
  assert.ok(![...f.files.keys()].some(file => file.endsWith('/run.lock')));
});

test('shared lock conflict prevents all context/private reads and lane locks', async () => {
  const f = fixture({ busy: true });
  await assert.rejects(f.main(), /Shared lock busy/);
  assert.equal(f.calls.length, 0); assert.equal(f.open.size, 0); assert.equal(f.counters.released, 0);
});

test('second lane lock failure cleans the first lane and shared lock', async () => {
  const f = fixture({ failLock: 'student-share-d-261025' });
  await assert.rejects(f.main(), /Held lane lock/);
  assert.equal(f.open.size, 0); assert.equal(f.counters.released, 1);
  assert.ok(![...f.files.keys()].some(file => file.endsWith('/run.lock')));
});

test('lane cleanup errors cannot bypass releasing the shared lock', async () => {
  const f = fixture({ failCleanup: true });
  await assert.rejects(f.main(), /C\/D grant lock cleanup incomplete/);
  assert.equal(f.counters.released, 1); assert.equal(f.open.size, 0);
});
