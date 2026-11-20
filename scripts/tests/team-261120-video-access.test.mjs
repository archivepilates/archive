import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEAM_IDS } from '../lib/team-261120-scope.mjs';
import { SITE, UNIT, STAFF_GROUP, STAFF_GRADE } from '../lib/imweb-staff-video-policy.mjs';
import { STUDENT_SHARE_SOURCES, firstVerifiedShareWindow, validatedShareEntries } from '../lib/imweb-student-share-policy.mjs';
import { PRIVATE_ROOT, POLICY_ID, LESSON_DATE, LESSON_IDS, requireTeamSource, validateRegisteredRoster,
  validateFreshCore, validateAttendance, validateProtectedDelivery, matchCurrentMember,
  additiveGroups, validateDryRun, parseArguments, runTeamVideoAccess, readPrivate, savePrivate } from '../grant-team-261120-video-access.mjs';

const NOW = Date.parse('2026-11-20T10:00:00Z');
const at = delta => new Date(NOW + delta).toISOString();
const copy = value => structuredClone(value);
// Synthetic identities/proofs only. Never use private attendance, credentials, or live services in tests.
const source = { policyId: POLICY_ID, lessonDate: LESSON_DATE, lessonIds: [...LESSON_IDS],
  groupCode: 'gabc123', lane: 'team-lesson-videos-261120', storage: 'automation_operations', revocation: 'team_group_only' };
const roster = () => ({ lessonDate: LESSON_DATE, lessonIds: [...LESSON_IDS], rows: TEAM_IDS.map((id, i) => ({
  registrationId: id, name: `Test ${String.fromCharCode(65 + i)}`, phone: `0100000000${i}`, sourceMemberId: `native-${i}` })) });
const core = () => roster().rows.map(row => ({ id: row.registrationId, data: {
  studioId: '5330', courseKind: 'team', ticketName: 'Team 강사레슨', lessonDate: LESSON_DATE,
  lessonTime: '14:00', lessonTopic: 'ARCHIVE METHOD #1 직장인 증후군', paymentAmount: 80000,
  paymentMethod: 'wiretransfer', status: 'registered', memberName: row.name, memberPhone: row.phone,
  memberId: row.sourceMemberId } }));
const attendance = () => ({ source: 'StudioMate live lesson-detail DOM', date: LESSON_DATE, verifiedAt: at(0),
  sessions: LESSON_IDS.map(lessonId => ({ lessonId, date: LESSON_DATE, registeredCount: 6,
    rows: roster().rows.map((row, i) => ({ name: row.name, phone: row.phone, attendance: i ? '출석' : '결석' })) })) });
const delivery = () => ({ schema: 'team261120-protected-delivery-v1', policyId: POLICY_ID, siteCode: SITE,
  unitCode: UNIT, date: LESSON_DATE, lessonDate: LESSON_DATE, groupCode: source.groupCode, verifiedAt: at(0),
  videos: LESSON_IDS.map((lessonId, i) => ({ lessonId, youtubeId: `mockvideo${i}A`, groupCode: source.groupCode,
    watchPath: `/team-261120-${i}`, processing: 'succeeded', privacyStatus: 'unlisted', playbackVerified: true,
    playbackVerifiedAt: at(0), nativeAcl: { source: 'Imweb native page ACL', verifiedAt: at(0), published: true,
      mode: 'groups', operator: 'OR', publicAccess: false, groupCodes: [source.groupCode, STAFF_GROUP] },
    catalog: { source: 'Imweb live classroom catalog', verifiedAt: at(0), connectionVerified: true,
      youtubeId: `mockvideo${i}A`, watchPath: `/team-261120-${i}`, groupCode: source.groupCode } })) });
const members = () => roster().rows.map((row, i) => ({ siteCode: SITE, unitCode: UNIT, uid: `uid-${i}`,
  memberCode: `mabc${i}`, name: row.name, callnum: row.phone, group: ['g111'], grade: null,
  custom: { untouched: 'preserve' }, email: `mock${i}@example.invalid` }));
const initialState = () => ({ accessPolicy: { id: POLICY_ID, days: 40, approved: true,
  basis: 'first_verified_grant', revocation: source.revocation }, entitlements: {}, manualImmediateGrants: {} });

// The main lane has not registered the Team constant yet. Use the real window/ledger validators
// with only its registry-dependent attendance branch stripped in this mock adapter; test the
// exact attendance proof separately below. Production defaults are never replaced by the CLI.
function mockWindow(receipt, groupCode, now) {
  assert.equal(receipt.attendanceEvidence.memberCode, receipt.memberCode);
  assert.deepEqual(receipt.attendanceEvidence.lessonIds, LESSON_IDS);
  const standalone = copy(receipt);
  delete standalone.attendanceEvidence;
  if (standalone.kind === 'student_share_existing_staff') {
    delete standalone.kind;
    standalone.beforeGroups = standalone.beforeGroups.filter(code => code !== groupCode);
  }
  return firstVerifiedShareWindow(standalone, groupCode, now);
}
function mockValidate(state, registered, now) {
  const standalone = copy(state);
  for (const receipt of Object.values(standalone.manualImmediateGrants)) {
    delete receipt.attendanceEvidence;
    if (receipt.kind === 'student_share_existing_staff') {
      delete receipt.kind;
      receipt.beforeGroups = receipt.beforeGroups.filter(code => code !== registered.groupCode);
    }
  }
  return validatedShareEntries(standalone, registered, now);
}

function harness() {
  const h = { state: initialState(), members: members(), native: attendance(), ready: delivery(), core: core(),
    events: [], writes: 0, coreReads: 0, directoryReads: 0, gets: 0, saves: [], error: null, afterWrite: null };
  h.options = {
    sources: [source], resolveDirectory: registered => { assert.equal(registered, source); return '/mock-source'; },
    clock: () => NOW, validateEntries: mockValidate, shareWindow: mockWindow,
    acquireShared: async () => { h.events.push('shared-acquired'); return () => h.events.push('shared-released'); },
    acquireSource: directory => { assert.equal(directory, '/mock-source'); h.events.push('source-acquired'); return () => h.events.push('source-released'); },
    readEvidence: file => {
      h.events.push(`evidence:${path.basename(file)}`);
      if (file.endsWith('registered-roster.json')) return roster();
      if (file.endsWith('native-attendance.json')) return copy(h.native);
      if (file.endsWith('protected-delivery-ready.json')) return copy(h.ready);
      throw Error('Unexpected evidence file');
    },
    readCore: async () => { h.coreReads++; h.events.push('core-read'); return copy(h.core); },
    readLedgers: () => [{ source, state: h.state }],
    save: (file, state) => {
      assert.equal(file, '/mock-source/state.json');
      h.events.push('save'); h.saves.push(copy(state));
    },
    run: args => {
      h.events.push(args.slice(0, 3).join(':'));
      if (args[0] === 'config') return { effective_profile: 'default', resolved_profile: { site_code: SITE, unit_code: UNIT },
        token: { status: 'healthy' }, remote_context: { write_ready: true } };
      if (args[1] === 'list') { h.directoryReads++; return { data: { list: copy(h.members), hasNext: false } }; }
      if (args[1] === 'get') { h.gets++; return { data: copy(h.members.find(row => row.uid === args[2])) }; }
      if (args[1] === 'groups') return { data: h.members.filter(row => row.group.includes(args[3])).map(row => ({ memberCode: row.memberCode })) };
      assert.equal(args.slice(0, 3).join(' '), 'member update groups');
      const body = JSON.parse(args[args.indexOf('--data') + 1]);
      if (args.includes('--dry-run')) return { confirmation_token: 'PRIVATE_DRY_TOKEN', body,
        safety: { bulk_confirmation_required_for_execute: true }, bulk_confirmation_token: 'PRIVATE_BULK_TOKEN' };
      assert(args.includes('--yes'));
      assert.equal(args[args.indexOf('--confirm-token') + 1], 'PRIVATE_DRY_TOKEN');
      assert.equal(args[args.indexOf('--bulk-confirm-token') + 1], 'PRIVATE_BULK_TOKEN');
      const member = h.members.find(row => row.uid === args[3]);
      assert.equal(h.saves.at(-1).manualImmediateGrants[member.memberCode].status, 'intent', 'durable intent precedes write');
      h.writes++;
      if (h.error) throw h.error;
      member.group = body.groupCodes;
      h.afterWrite?.(member);
      return { ok: true };
    },
  };
  return h;
}
const runHarness = (h, apply = true, overrides = {}) => runTeamVideoAccess({ ...h.options, apply, ...overrides });

test('missing/unregistered or wrong Team policy fails before locks and external reads', async () => {
  assert.throws(() => requireTeamSource([]));
  for (const patch of [{ lessonDate: '2026-11-21' }, { lessonIds: ['98900618'] }, { groupCode: STAFF_GROUP }, { storage: undefined }]) {
    assert.throws(() => requireTeamSource([{ ...source, ...patch }]));
  }
  assert.throws(() => requireTeamSource([source, source]));
  assert.throws(() => requireTeamSource([source, { ...source, policyId: 'another-policy' }]));
  const h = harness();
  await assert.rejects(runHarness(h, true, { sources: [] }));
  assert.deepEqual(h.events, []);
  // Until the separately owned constant lands, actual defaults remain fail closed.
  if (!STUDENT_SHARE_SOURCES.some(row => row.policyId === POLICY_ID)) await assert.rejects(runTeamVideoAccess());
});

test('prior roster requires exact six IDs, unique names/full phones, date and sessions', () => {
  assert.equal(validateRegisteredRoster(roster()).length, 6);
  for (const change of [p => p.rows.pop(), p => p.rows[0].registrationId = 'other',
    p => p.rows[0].phone = '1234', p => p.rows[0].name = '',
    p => p.rows[0] = copy(p.rows[1]), p => p.rows[0].phone = p.rows[1].phone,
    p => p.lessonDate = '2026-11-21', p => p.lessonIds.reverse().pop()]) {
    const proof = roster(); change(proof); assert.throws(() => validateRegisteredRoster(proof));
  }
});

test('fresh CORE exact-six scope assert rejects cancellations, payment/date/identity drift and missing documents', () => {
  assert.equal(validateFreshCore(core(), roster().rows).length, 6);
  for (const change of [rows => rows.pop(), rows => rows[0].id = rows[1].id,
    rows => rows[0].data.cancellation = {}, rows => rows[0].data.paymentAmount = 0,
    rows => rows[0].data.lessonDate = '2026-11-21', rows => rows[0].data.memberPhone = '01099999999',
    rows => rows[0].data.memberName = 'Other', rows => rows[0].data.memberId = 'other-native']) {
    const rows = core(); change(rows); assert.throws(() => validateFreshCore(rows, roster().rows));
  }
});

test('native DOM attendance includes absentees and must match canonical six in both exact sessions', () => {
  const rows = validateAttendance(attendance(), roster().rows, NOW);
  assert.equal(rows[0].sessionAttendance[0].status, '결석');
  for (const change of [p => p.source = 'CORE export', p => p.date = '2026-11-21',
    p => p.verifiedAt = at(-7200001), p => p.verifiedAt = at(1), p => p.sessions.pop(),
    p => p.sessions[0].lessonId = 'other', p => p.sessions[0].date = '2026-11-21',
    p => p.sessions[0].registeredCount = 5, p => p.sessions[1].rows.pop(),
    p => p.sessions[0].rows[0].attendance = '취소', p => p.sessions[0].rows[0].phone = '01099999999',
    p => p.sessions[1].rows[0] = copy(p.sessions[1].rows[1])]) {
    const proof = attendance(); change(proof); assert.throws(() => validateAttendance(proof, roster().rows, NOW));
  }
});

test('delivery proof requires exactly two processed unlisted distinct playable videos, native OR ACL, linked catalog, today <=15m', () => {
  validateProtectedDelivery(delivery(), source, NOW);
  const sharedPage = delivery();
  sharedPage.videos[1].watchPath = sharedPage.videos[0].watchPath;
  sharedPage.videos[1].catalog.watchPath = sharedPage.videos[0].watchPath;
  validateProtectedDelivery(sharedPage, source, NOW);
  const mutations = [p => p.schema = 'other', p => p.policyId = 'other', p => p.siteCode = 'other',
    p => p.unitCode = 'other', p => p.date = '2026-11-19', p => p.lessonDate = '2026-11-19',
    p => p.groupCode = STAFF_GROUP, p => p.verifiedAt = at(-900001), p => p.verifiedAt = at(1),
    p => p.videos.pop(), p => p.videos[1].lessonId = p.videos[0].lessonId,
    p => p.videos[1].youtubeId = p.videos[0].youtubeId, p => p.videos[1].watchPath = p.videos[0].watchPath,
    p => p.videos[0].youtubeId = 'bad', p => p.videos[0].processing = 'processing',
    p => p.videos[0].privacyStatus = 'public', p => p.videos[0].playbackVerified = false,
    p => p.videos[0].playbackVerifiedAt = at(-900001), p => p.videos[0].nativeAcl.operator = 'AND',
    p => p.videos[0].nativeAcl.mode = 'client', p => p.videos[0].nativeAcl.published = false,
    p => p.videos[0].nativeAcl.publicAccess = true, p => p.videos[0].nativeAcl.groupCodes = [STAFF_GROUP],
    p => p.videos[0].nativeAcl.groupCodes.push('g999'), p => p.videos[0].nativeAcl.verifiedAt = at(-900001),
    p => p.videos[0].catalog.connectionVerified = false, p => p.videos[0].catalog.youtubeId = 'wrong',
    p => p.videos[0].catalog.watchPath = '/other', p => p.videos[0].catalog.groupCode = STAFF_GROUP,
    p => p.videos[0].catalog.verifiedAt = at(-900001)];
  for (const mutate of mutations) { const proof = delivery(); mutate(proof); assert.throws(() => validateProtectedDelivery(proof, source, NOW)); }
  const yesterday = delivery();
  const justAfterMidnight = Date.parse('2026-11-20T15:01:00Z');
  yesterday.date = '2026-11-21'; yesterday.verifiedAt = new Date(justAfterMidnight - 120000).toISOString();
  assert.throws(() => validateProtectedDelivery(yesterday, source, justAfterMidnight));
});

test('current Imweb exact full name+phone only; missing deferred, ambiguity held', () => {
  const target = roster().rows[0], list = members();
  assert.equal(matchCurrentMember(target, list).status, 'matched');
  assert.equal(matchCurrentMember(target, list.slice(1)).status, 'no_member');
  list[0].name = 'Mismatch';
  assert.equal(matchCurrentMember(target, list).status, 'hold');
  list[1].callnum = target.phone;
  assert.equal(matchCurrentMember(target, list).status, 'hold');
  list[1].uid = list[0].uid;
  assert.throws(() => matchCurrentMember(target, list));
});

test('additive group plans preserve existing groups and enforce native 50 limit', () => {
  const member = members()[0];
  assert.deepEqual(additiveGroups(member, source.groupCode), ['g111', source.groupCode]);
  assert.deepEqual(member.group, ['g111']);
  member.group = Array.from({ length: 50 }, (_, i) => `g${i.toString(16)}`);
  assert.throws(() => additiveGroups(member, source.groupCode));
  member.group[0] = source.groupCode;
  assert.equal(additiveGroups(member, source.groupCode).length, 50);
  member.group.push(source.groupCode);
  assert.throws(() => additiveGroups(member, source.groupCode));
});

test('dry-run requires exact additive body and both confirmation tokens when bulk-gated', () => {
  const dry = { confirmation_token: 'secret', body: { unitCode: UNIT, groupCodes: ['g1'] } };
  validateDryRun(dry, ['g1']);
  for (const change of [p => p.confirmation_token = '', p => p.body.unitCode = 'other',
    p => p.body.groupCodes = [], p => p.body.grade = STAFF_GRADE,
    p => p.safety = { bulk_confirmation_required_for_execute: true }]) {
    const proof = copy(dry); change(proof); assert.throws(() => validateDryRun(proof, ['g1']));
  }
});

test('CLI only supports dry-run default / --apply and one private ready-file; no override gates', () => {
  assert.equal(parseArguments([]).apply, false);
  assert.equal(parseArguments(['--apply']).apply, true);
  assert.equal(parseArguments([`--ready-file=${PRIVATE_ROOT}/custom.json`]).readyFile, `${PRIVATE_ROOT}/custom.json`);
  for (const args of [['--force'], ['--apply', '--apply'], ['--ready-file=/tmp/fake.json'],
    ['--ready-file=a', '--ready-file=b']]) assert.throws(() => parseArguments(args));
});

test('dry-run performs no grants or ledger saves and never returns confirmation tokens', async () => {
  const h = harness();
  const output = await runHarness(h, false);
  assert.equal(h.writes, 0); assert.equal(h.saves.length, 0);
  assert.equal(output.results.length, 6);
  assert(output.results.every(row => row.status === 'planned_grant'));
  assert(!JSON.stringify(output).includes('PRIVATE_'));
  assert.deepEqual(h.events.slice(-2), ['source-released', 'shared-released']);
});

test('apply revalidates six CORE identities and proofs per recipient; intent then transport then independent readbacks; 40-day original clock', async () => {
  const h = harness();
  const output = await runHarness(h);
  assert.equal(h.writes, 6); assert.equal(h.coreReads, 7); assert.equal(h.directoryReads, 7);
  assert(output.results.every(row => row.status === 'group_verified'));
  for (const member of h.members) {
    assert.deepEqual(member.group, ['g111', source.groupCode]);
    assert.deepEqual(member.custom, { untouched: 'preserve' });
    const entry = h.state.entitlements[member.memberCode];
    assert.equal(entry.grantedAt, at(0));
    assert.equal(entry.expiresAt, at(40 * 86400000));
    const receipt = h.state.manualImmediateGrants[member.memberCode];
    assert.equal(receipt.attendanceEvidence.sessionAttendance.length, 2);
  }
  const previous = copy(h.state);
  await runHarness(h, true, { clock: () => NOW + 1000 });
  assert.equal(h.writes, 6); assert.deepEqual(h.state, previous);
});

test('missing delivery/native attendance and stale proofs block apply before any transport', async () => {
  for (const field of ['native', 'ready']) {
    const h = harness(); h[field] = null;
    await assert.rejects(runHarness(h));
    assert.equal(h.writes, 0); assert.equal(h.saves.length, 0);
    assert.deepEqual(h.events.slice(-2), ['source-released', 'shared-released']);
  }
});

test('fresh CORE cancellation after initial scan blocks before intent and transport', async () => {
  const h = harness();
  const read = h.options.readCore;
  h.options.readCore = async () => { if (h.coreReads) h.core[0].data.cancellation = {}; return read(); };
  await assert.rejects(runHarness(h));
  assert.equal(h.writes, 0); assert.equal(h.saves.length, 0);
});

test('fresh directory duplicate phone and member metadata drift block before transport', async () => {
  for (const kind of ['phone', 'metadata']) {
    const h = harness(), run = h.options.run;
    h.options.run = args => {
      if (kind === 'phone' && args[1] === 'list' && h.directoryReads) h.members[1].callnum = h.members[0].callnum;
      if (kind === 'metadata' && args[1] === 'get' && h.gets) h.members[0].email = 'changed@example.invalid';
      return run(args);
    };
    await assert.rejects(runHarness(h));
    assert.equal(h.writes, 0); assert.equal(h.saves.length, 0);
  }
});

test('no_member is deferred and nonstaff preexisting group is not adopted', async () => {
  const h = harness(); h.members.shift(); h.members[0].group.push(source.groupCode);
  const output = await runHarness(h);
  assert.equal(output.results[0].status, 'deferred_no_member');
  assert.equal(output.results[1].status, 'hold_preexisting_group');
  assert.equal(h.writes, 4);
  assert(!h.state.entitlements.mabc0 && !h.state.entitlements.mabc1);
});

test('preexisting staff group records a verified independent share without a provider write', async () => {
  const h = harness(); h.members[0].grade = STAFF_GRADE; h.members[0].group.push(source.groupCode);
  await runHarness(h);
  assert.equal(h.writes, 5);
  assert.equal(h.state.manualImmediateGrants.mabc0.kind, 'student_share_existing_staff');
  assert.equal(h.state.entitlements.mabc0.grantedAt, at(0));
});

test('durable intent save failure prevents transport; locks still release', async () => {
  const h = harness();
  await assert.rejects(runHarness(h, true, { save: () => { throw Error('disk full'); } }));
  assert.equal(h.writes, 0);
  assert.deepEqual(h.events.slice(-2), ['source-released', 'shared-released']);
});

test('proof expiry while persisting intent blocks provider transport', async () => {
  const h = harness(); let now = NOW;
  const save = h.options.save;
  h.options.clock = () => now;
  h.options.save = (...args) => { save(...args); now = NOW + 900001; };
  await assert.rejects(runHarness(h));
  assert.equal(h.writes, 0);
  assert.equal(h.state.manualImmediateGrants.mabc0.status, 'result_unknown');
  assert.equal(Object.keys(h.state.entitlements).length, 0);
});

test('a registration rebound to a recreated Imweb identity cannot restart its original clock', async () => {
  const h = harness(); await runHarness(h);
  h.members[0].memberCode = 'm999';
  h.members[0].uid = 'recreated-uid';
  h.members[0].group = ['g111'];
  const before = copy(h.state);
  await assert.rejects(runHarness(h));
  assert.equal(h.writes, 6);
  assert.deepEqual(h.state, before);
});

test('prior intent, orphan entitlement and corrupt unrelated ledger fail closed without new grants', async () => {
  for (const kind of ['intent', 'orphan', 'unrelated']) {
    const h = harness();
    if (kind === 'intent') h.state.manualImmediateGrants.mabc0 = { status: 'intent' };
    if (kind === 'orphan') h.state.entitlements.mabc0 = { status: 'active' };
    if (kind === 'unrelated') h.options.readLedgers = () => [{ source: { ...source, policyId: 'other' }, state: {} }, { source, state: h.state }];
    await assert.rejects(runHarness(h));
    assert.equal(h.writes, 0); assert.equal(h.saves.length, 0);
  }
});

test('partial or duplicate independent group readbacks never count as verified', async () => {
  for (const data of [ { list: [{ memberCode: 'mabc0' }], hasNext: true },
    { list: [{ memberCode: 'mabc0' }], totalCount: 2 },
    [{ memberCode: 'mabc0' }, { memberCode: 'mabc0' }] ]) {
    const h = harness(), run = h.options.run;
    h.options.run = args => args[1] === 'groups' ? { data } : run(args);
    await assert.rejects(runHarness(h));
    assert.equal(h.writes, 1);
    assert.equal(h.state.manualImmediateGrants.mabc0.status, 'result_unknown');
    assert(!h.state.entitlements.mabc0);
  }
});

test('accepted/unknown write is durable result_unknown and never replayed', async () => {
  const h = harness(); h.error = Object.assign(Error('timeout'), { code: 'ETIMEDOUT' });
  await assert.rejects(runHarness(h));
  assert.equal(h.writes, 1); assert.equal(h.state.manualImmediateGrants.mabc0.status, 'result_unknown');
  assert.equal(Object.keys(h.state.entitlements).length, 0);
  await assert.rejects(runHarness(h));
  assert.equal(h.writes, 1);
});

test('positively known local quota is blocked_before_dispatch; next run does not retry CLI or start clock', async () => {
  const h = harness(); h.error = { stderr: JSON.stringify({ error: { code: 'write_quota_exceeded' } }) };
  const output = await runHarness(h);
  assert.equal(h.writes, 1);
  assert(output.results.every(row => row.status === 'deferred_local_quota_before_dispatch'));
  assert.equal(h.state.grantAttempts.mabc0.status, 'blocked_before_dispatch');
  assert.equal(h.state.grantAttempts.mabc0.firstGrantNotStarted, true);
  assert(!h.state.manualImmediateGrants.mabc0 && !h.state.entitlements.mabc0);
  h.error = null;
  await runHarness(h);
  assert.equal(h.writes, 1);
});

test('HTTP 429, contradictory quota and readback errors cannot be classified as local non-dispatch', async () => {
  for (const error of [ { stderr: JSON.stringify({ error: { code: 'write_quota_exceeded', status_code: 429 } }) },
    { stderr: JSON.stringify({ error: { code: 'write_quota_exceeded' } }), stdout: 'timeout' },
    { stderr: JSON.stringify({ error: { code: 'write_quota_exceeded', dispatched: true } }) } ]) {
    const h = harness(); h.error = error;
    await assert.rejects(runHarness(h));
    assert.equal(h.state.manualImmediateGrants.mabc0.status, 'result_unknown');
    assert(!h.state.grantAttempts?.mabc0);
  }
  const h = harness(), run = h.options.run;
  h.options.run = args => {
    if (args[1] === 'groups') throw { stderr: JSON.stringify({ error: { code: 'write_quota_exceeded' } }) };
    return run(args);
  };
  await assert.rejects(runHarness(h));
  assert.equal(h.state.manualImmediateGrants.mabc0.status, 'result_unknown');
});

test('member metadata loss or missing independent group membership leaves unknown, no success clock', async () => {
  for (const kind of ['metadata', 'group']) {
    const h = harness(), run = h.options.run;
    if (kind === 'metadata') h.afterWrite = member => { member.custom.untouched = 'changed'; };
    else h.options.run = args => args[1] === 'groups' ? { data: [] } : run(args);
    await assert.rejects(runHarness(h));
    assert.equal(h.state.manualImmediateGrants.mabc0.status, 'result_unknown');
    assert.equal(Object.keys(h.state.entitlements).length, 0);
  }
});

test('expired/revoked verified grants are never regranted or assigned a new start', async () => {
  const h = harness(); await runHarness(h);
  const previous = copy(h.state.entitlements);
  h.state.entitlements.mabc0.status = 'revoked';
  const output = await runHarness(h);
  assert.equal(output.results[0].status, 'window_closed_no_regrant');
  assert.equal(h.writes, 6);
  assert.equal(h.state.entitlements.mabc0.grantedAt, previous.mabc0.grantedAt);
});

test('lock failure never removes another owner and shared lock releases if source acquisition fails', async () => {
  const h = harness();
  await assert.rejects(runHarness(h, true, { acquireSource: () => { throw Error('busy'); } }));
  assert.deepEqual(h.events, ['shared-acquired', 'shared-released']);
  const other = harness();
  await assert.rejects(runHarness(other, true, { acquireShared: () => { throw Error('busy'); } }));
  assert.deepEqual(other.events, []);
});

test('private proof and durable save enforce permissions/symlinks and clean generated test files', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'team-access-test-'));
  fs.chmodSync(root, 0o700);
  try {
    const file = path.join(root, 'state.json');
    savePrivate(file, { safe: true }); assert.deepEqual(readPrivate(file), { safe: true });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    fs.chmodSync(file, 0o644); assert.throws(() => readPrivate(file));
    assert.throws(() => savePrivate(file, {})); fs.chmodSync(file, 0o600);
    const link = path.join(root, 'linked.json'); fs.symlinkSync(file, link);
    assert.throws(() => readPrivate(link)); assert.throws(() => savePrivate(link, {}));
    const directoryLink = path.join(root, 'linked-directory'); fs.symlinkSync(root, directoryLink);
    assert.throws(() => readPrivate(path.join(directoryLink, 'state.json')));
    assert.deepEqual(fs.readdirSync(root).sort(), ['linked-directory', 'linked.json', 'state.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
