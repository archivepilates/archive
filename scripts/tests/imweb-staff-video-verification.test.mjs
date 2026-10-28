import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyStaffVideoAccess } from '../lib/imweb-staff-video-verification.mjs';
import { runStaffVideoVerification, main } from '../verify-imweb-staff-video-sync.mjs';
import { STAFF_VIDEO_POLICY, MEMBER_GROUP_LOCK } from '../lib/imweb-staff-video-sync.mjs';
import { STAFF_GRADE, STAFF_GROUP, SITE, UNIT } from '../lib/imweb-staff-video-policy.mjs';

const codes = Array.from({ length: 30 }, (_, i) => `video-${String(i).padStart(2, '0')}`);
const copy = value => structuredClone(value);
const flag = (args, name) => args[args.indexOf(name) + 1];
function fixture() {
  const member = (memberCode, staff) => ({ siteCode: SITE, unitCode: UNIT, memberCode,
    uid: `synthetic-${memberCode}@example.test`, name: 'PRIVATE_NAME', phone: 'PRIVATE_PHONE',
    grade: staff ? STAFF_GRADE : 'ordinary', group: staff ? ['baseline', ...codes, STAFF_GROUP] : ['baseline'] });
  const f = { members: [member('m001', true), member('m002', true), member('m003', false)],
    groups: [...codes.map((siteGroupCode, i) => ({ siteCode: SITE, siteGroupCode, title: `ARCHIVE METHOD A${i} 40D` })),
      { siteCode: SITE, siteGroupCode: STAFF_GROUP, title: 'ARCHIVE STAFF' }],
    calls: [], afterResponse: null, state: { policyVersion: STAFF_VIDEO_POLICY, approved: true, members: {} } };
  for (const row of f.members) f.state.members[row.memberCode] = { memberCode: row.memberCode, uid: row.uid,
    baselineGroups: ['baseline'], ownedAddedGroups: row.grade === STAFF_GRADE ? [...codes, STAFF_GROUP] : [] };
  const page = (rows, args) => {
    const currentPage = Number(flag(args, '--page')), split = Math.ceil(rows.length / 2), totalPage = rows.length > 1 ? 2 : 1;
    assert.ok(currentPage >= 1 && currentPage <= totalPage);
    assert.equal(flag(args, '--limit'), '100');
    return { data: { list: copy(currentPage === 1 ? rows.slice(0, split) : rows.slice(split)),
      currentPage, totalPage, totalCount: rows.length } };
  };
  f.run = args => {
    f.calls.push([...args]);
    const command = args.slice(0, 3).join(' ');
    let response;
    if (command === 'config context') response = { effective_profile: 'default', resolved_profile: { site_code: SITE, unit_code: UNIT } };
    else if (command === 'member groups list') response = page(f.groups, args);
    else if (command === 'member groups members') {
      assert.equal(flag(args, '--unit-code'), UNIT);
      response = page(f.members.filter(row => row.group.includes(args[3])), args);
    } else if (args[0] === 'member' && args[1] === 'list') {
      assert.equal(flag(args, '--unit-code'), UNIT); assert.equal(flag(args, '--limit'), '50');
      const next = args.includes('--cursor');
      if (next) assert.equal(flag(args, '--cursor'), 'synthetic-next');
      response = { data: { list: copy(next ? f.members.slice(1) : f.members.slice(0, 1)),
        hasNext: !next && f.members.length > 1, ...(!next && f.members.length > 1 ? { nextCursor: 'synthetic-next' } : {}) } };
    } else if (args[0] === 'member' && args[1] === 'get') {
      assert.equal(flag(args, '--unit-code'), UNIT);
      response = { data: copy(f.members.find(row => row.uid === args[2])) };
    } else assert.fail(`Verifier attempted a non-read command: ${args.slice(0, 3).join(' ')}`);
    return f.afterResponse?.(args, response) ?? response;
  };
  f.verify = options => verifyStaffVideoAccess({ run: f.run, state: f.state, ...options });
  return f;
}

test('independent full verification paginates all sources, preserves state and emits hashed metadata only', () => {
  const f = fixture(), before = copy({ state: f.state, members: f.members, groups: f.groups });
  const result = f.verify({ expectedGroupCodes: [codes[29]] });
  assert.equal(result.ok, true); assert.equal(result.scope, 'all_tracked');
  assert.equal(result.catalogGroups, 30); assert.equal(result.staffMembers, 2); assert.equal(result.verifiedMembers, 3);
  assert.equal(result.independentlyVerifiedGroupLists, 31);
  assert.equal(result.ordinaryMemberPlayback, 'not_verified');
  assert.match(result.catalogFingerprint, /^[a-f0-9]{64}$/);
  for (const row of result.memberDetails) {
    assert.match(row.memberKeyHash, /^[a-f0-9]{64}$/); assert.match(row.memberGroupsHash, /^[a-f0-9]{64}$/);
    assert.equal(row.baselinePreserved, true);
  }
  assert.doesNotMatch(JSON.stringify(result), /synthetic-|PRIVATE_|@|m001|m002|m003|"uid"|"phone"|"name"/);
  assert.deepEqual({ state: f.state, members: f.members, groups: f.groups }, before);
  assert.ok(f.calls.some(args => args.includes('--cursor')));
  for (const code of [...codes, STAFF_GROUP]) assert.equal(f.calls.filter(args => args[2] === 'members' && args[3] === code).length, 2);
});

test('catalog and group fingerprints ignore native ordering but reflect real membership/catalog changes', () => {
  const f = fixture(), first = f.verify();
  f.groups.reverse(); for (const row of f.members) row.group.reverse();
  const reordered = f.verify();
  assert.equal(reordered.catalogFingerprint, first.catalogFingerprint);
  assert.deepEqual(reordered.memberDetails, first.memberDetails);
  f.groups.find(row => row.siteGroupCode === codes[0]).title = 'ARCHIVE METHOD RENAMED 40D';
  assert.notEqual(f.verify().catalogFingerprint, first.catalogFingerprint);
  f.members[0].group.push('unrelated-retained-group');
  assert.notEqual(f.verify().memberDetails[0].memberGroupsHash, first.memberDetails[0].memberGroupsHash);
});

test('targeted staff verification checks only that member in every independent desired-group list', () => {
  const f = fixture(); f.state.members.m002.pending = { status: 'result_unknown' };
  const result = f.verify({ onlyMemberCode: 'm001' });
  assert.equal(result.scope, 'member'); assert.equal(result.verifiedMembers, 1);
  assert.equal(result.independentlyVerifiedGroupLists, 31);
  assert.equal(f.calls.filter(args => args[1] === 'get').length, 1);
});

test('tracked ordinary exits verify preserved baseline and no pending without video/group-list requirements', () => {
  const f = fixture(), result = f.verify({ onlyMemberCode: 'm003' });
  assert.equal(result.ok, true); assert.equal(result.memberDetails[0].staff, false);
  assert.equal(result.memberDetails[0].requiredGroupsVerified, 0);
  assert.equal(result.independentlyVerifiedGroupLists, 0);
  assert.ok(!f.calls.some(args => args[2] === 'members'));
  f.state.members.m003.pending = { status: 'result_unknown' };
  assert.throws(() => f.verify({ onlyMemberCode: 'm003' }), /Pending/);
  delete f.state.members.m003.pending; f.members[2].group = [];
  assert.throws(() => f.verify({ onlyMemberCode: 'm003' }), /baseline/);
});

test('full verification supports all tracked members exiting staff, without falsely requiring video rights', () => {
  const f = fixture(); for (const row of f.members) { row.grade = 'ordinary'; row.group = ['baseline']; }
  const result = f.verify(); assert.equal(result.staffMembers, 0); assert.equal(result.verifiedMembers, 3);
  assert.equal(result.independentlyVerifiedGroupLists, 0);
});

for (const [label, mutate] of [
  ['unapproved', f => { f.state.approved = false; }],
  ['missing tracked ledger', f => { delete f.state.members.m001; }],
  ['pending write', f => { f.state.members.m001.pending = { status: 'result_unknown' }; }],
  ['ledger identity', f => { f.state.members.m001.uid = 'other'; }],
  ['missing baseline', f => { f.members[0].group = f.members[0].group.filter(code => code !== 'baseline'); }],
  ['missing video', f => { f.members[0].group = f.members[0].group.filter(code => code !== codes[29]); }],
  ['missing STAFF', f => { f.members[0].group = f.members[0].group.filter(code => code !== STAFF_GROUP); }],
  ['duplicate groups', f => { f.members[0].group.push(codes[0]); }],
  ['incomplete catalog', f => { f.groups = f.groups.slice(1); }],
  ['wrong STAFF title', f => { f.groups.at(-1).title = 'WRONG'; }],
]) test(`fails closed: ${label}`, () => {
  const f = fixture(); mutate(f); const before = copy(f.state);
  assert.throws(() => f.verify()); assert.deepEqual(f.state, before);
});

for (const [label, mutate] of [
  ['wrong context', (args, r) => { if (args[0] === 'config') r.resolved_profile.site_code = 'wrong'; }],
  ['wrong unit', (args, r) => { if (args[1] === 'get') r.data.unitCode = 'wrong'; }],
  ['wrong detail member', (args, r) => { if (args[1] === 'get') r.data.memberCode = 'mfff'; }],
  ['wrong detail UID', (args, r) => { if (args[1] === 'get') r.data.uid = 'wrong'; }],
  ['grade changed', (args, r) => { if (args[1] === 'get') r.data.grade = 'ordinary'; }],
  ['invalid grade', (args, r) => { if (args[1] === 'get') r.data.grade = []; }],
  ['missing group member', (args, r) => { if (args[2] === 'members') r.data.list = r.data.list.filter(row => row.memberCode !== 'm001'); }],
  ['duplicate group member', (args, r) => { if (args[2] === 'members' && r.data.list[0]?.memberCode === 'm001') { r.data.list.push(copy(r.data.list[0])); r.data.totalCount++; } }],
  ['wrong group identity', (args, r) => { if (args[2] === 'members') for (const row of r.data.list) row.siteCode = 'wrong'; }],
  ['truncated member list', (args, r) => { if (args[1] === 'list' && args.includes('--cursor')) r.data.nextCursor = 'synthetic-next', r.data.hasNext = true; }],
]) test(`native source/readback rejects ${label}`, () => {
  const f = fixture(); f.afterResponse = (args, response) => { mutate(args, response); return response; };
  assert.throws(() => f.verify());
});

test('expected groups and targeted identity must be canonical and present; never broadens to all', () => {
  const f = fixture();
  for (const expectedGroupCodes of [['missing'], [codes[0], codes[0]], null, 'video']) assert.throws(() => f.verify({ expectedGroupCodes }));
  for (const onlyMemberCode of ['mfff', 'synthetic-m001@example.test', null, false]) assert.throws(() => f.verify({ onlyMemberCode }));
  delete f.state.members.m003;
  assert.throws(() => f.verify({ onlyMemberCode: 'm003' }), /ledger/);
});

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-verification-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}

test('wrapper import has no state/auth/lock/write side effects', t => {
  const dir = directory(t), url = new URL('../verify-imweb-staff-video-sync.mjs', import.meta.url).href;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`],
    { encoding: 'utf8', env: { ...process.env, HOME: dir } }), '');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('wrapper locks before state/source reads, atomically writes private receipt only and releases', async t => {
  const f = fixture(), dir = directory(t), stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify(f.state), { mode: 0o600 });
  const before = fs.readFileSync(stateFile, 'utf8'); let held = false, releases = 0;
  const result = await runStaffVideoVerification({ directory: dir,
    acquireLock: async options => { assert.equal(options.lockPath, MEMBER_GROUP_LOCK); assert.equal(options.waitMs, 0);
      held = true; return async () => { held = false; releases++; }; },
    io: { ...fs, readFileSync(...args) { assert.equal(held, true); return fs.readFileSync(...args); } },
    run: args => { assert.equal(held, true); return f.run(args); }, expectedGroupCodes: [codes[29]] });
  const receiptFile = path.join(dir, 'verification.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(receiptFile, 'utf8')), result);
  assert.equal(fs.statSync(receiptFile).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before); assert.equal(releases, 1); assert.equal(held, false);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['state.json', 'verification.json']);
});

test('held wrapper lock prevents state reads, native access and receipt writes', async () => {
  let calls = 0;
  await assert.rejects(() => runStaffVideoVerification({ acquireLock: async () => { throw Error('synthetic busy'); },
    io: { readFileSync() { calls++; } }, run: () => { calls++; } }), /busy/);
  assert.equal(calls, 0);
});

test('failed verification keeps old receipt untouched and releases caller lock', async t => {
  const f = fixture(), dir = directory(t); let releases = 0;
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(f.state));
  fs.writeFileSync(path.join(dir, 'verification.json'), 'prior-evidence');
  await assert.rejects(() => runStaffVideoVerification({ directory: dir, run: f.run, expectedGroupCodes: ['missing'],
    acquireLock: async () => async () => { releases++; } }));
  assert.equal(fs.readFileSync(path.join(dir, 'verification.json'), 'utf8'), 'prior-evidence');
  assert.equal(releases, 1); assert.equal(fs.readdirSync(dir).length, 2);
});

test('receipt persistence failure removes temporary output and still releases lock', async t => {
  const f = fixture(), dir = directory(t); let releases = 0;
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(f.state));
  await assert.rejects(() => runStaffVideoVerification({ directory: dir, run: f.run,
    acquireLock: async () => async () => { releases++; },
    io: { ...fs, renameSync() { throw Error('synthetic receipt failure'); } } }), /receipt failure/);
  assert.equal(releases, 1); assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});

test('receipt creation failure is not masked by cleanup of an absent temporary file', async t => {
  const f = fixture(), dir = directory(t); let releases = 0;
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(f.state));
  await assert.rejects(() => runStaffVideoVerification({ directory: dir, run: f.run,
    acquireLock: async () => async () => { releases++; },
    io: { ...fs, writeFileSync() { throw Error('synthetic creation failure'); } } }), /creation failure/);
  assert.equal(releases, 1); assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});

test('CLI rejects unsupported or incomplete targets before acquiring a lock', async () => {
  let calls = 0;
  for (const args of [['--apply'], ['--member-code'], ['--member-code', ''], ['--member-code', 'm001', '--member-code', 'm002'], ['--expected-group']]) {
    await assert.rejects(() => main(args, { acquireLock: async () => { calls++; } }), /Unsupported/);
  }
  assert.equal(calls, 0);
});
