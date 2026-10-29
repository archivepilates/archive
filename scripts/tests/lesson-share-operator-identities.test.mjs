import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { APPROVED_SET_HASH, validateOperatorIdentities, readOperatorIdentities,
  matchWithOperatorIdentity } from '../lib/lesson-share-operator-identities.mjs';
import { matchLessonShareMember as original } from '../lib/lesson-share-261024.mjs';
import { SITE, UNIT } from '../lib/imweb-staff-video-policy.mjs';

const NOW = Date.parse('2026-10-29T04:00:00Z');
const SCOPE = 'instructor_lesson_video_share';
const APPROVAL = 'operator-chat-20261029-same-person-persistent-matching';
const identity = (changes = {}) => ({ name: 'Synthetic Attendee', phone: '01000000001',
  uid: 'synthetic-uid-1', memberCode: 'm0001', sourceMemberId: '1001', ...changes });
const registry = (changes = {}) => ({ version: 1, approved: true, siteCode: SITE, unitCode: UNIT,
  scope: SCOPE, approvalRef: APPROVAL, confirmedAt: '2026-10-29T03:00:00Z', identities: [identity()], ...changes });
const setHash = value => createHash('sha256').update(JSON.stringify(value.identities.map(entry =>
  [SITE, UNIT, entry.name, entry.phone, entry.uid, entry.memberCode, entry.sourceMemberId])
  .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))))).digest('hex');
const attendee = (changes = {}) => ({ name: 'Synthetic Attendee', phone: '010-0000-0001', attendance: '\uCD9C\uC11D', ...changes });
const member = (changes = {}) => ({ siteCode: SITE, unitCode: UNIT, uid: 'synthetic-uid-1', memberCode: 'm0001',
  name: 'Synthetic Attendee', callnum: '', group: ['synthetic-personal'], grade: 'ordinary', point: 123, ...changes });
const options = (changes = {}) => ({ attendee: attendee(), members: [member()], complete: true, ...changes });
const match = (input = options(), value = registry()) => matchWithOperatorIdentity(input, value, { now: NOW, expectedHash: setHash(value) });
const moduleUrl = new URL('../lib/lesson-share-operator-identities.mjs', import.meta.url).href;

function privateFixture(t, contents = JSON.stringify(registry())) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lesson-operator-test-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'approved.json');
  fs.writeFileSync(file, contents, { mode: 0o600 });
  return { root, file };
}

test('production pin is fixed, and a synthetic set requires an explicit pure-function override', () => {
  assert.equal(APPROVED_SET_HASH, 'd1878adb8f1a5e6c5599e48804da513d2affa342ccf8f3258cf090737c543b47');
  const value = registry(), before = structuredClone(value);
  assert.throws(() => validateOperatorIdentities(value, NOW), /hash mismatch/);
  assert.equal(validateOperatorIdentities(value, NOW, setHash(value)), value);
  assert.deepEqual(value, before);
  for (const field of ['name', 'phone', 'uid', 'memberCode', 'sourceMemberId']) {
    const changed = registry(); changed.identities[0][field] += field === 'phone' ? '' : '1';
    if (field === 'phone') changed.identities[0].phone = '01000000002';
    assert.throws(() => validateOperatorIdentities(changed, NOW, setHash(value)));
  }
});

for (const [label, change] of [
  ['version', value => { value.version = 2; }], ['approval', value => { value.approved = 'true'; }],
  ['site', value => { value.siteCode = 'other'; }], ['unit', value => { value.unitCode = 'other'; }],
  ['scope', value => { value.scope = 'member_message'; }], ['approval ref', value => { value.approvalRef = 'other'; }],
  ['future', value => { value.confirmedAt = new Date(NOW + 1).toISOString(); }],
  ['invalid ISO', value => { value.confirmedAt = '2026-10-29'; }],
  ['invalid calendar', value => { value.confirmedAt = '2026-02-30T00:00:00Z'; }],
  ['empty set', value => { value.identities = []; }], ['duplicate set', value => { value.identities.push(identity()); }],
  ['two identities', value => { value.identities.push(identity({ uid: 'synthetic-other', memberCode: 'm0002' })); }],
  ['null entry', value => { value.identities = [null]; }],
  ['blank name', value => { value.identities[0].name = ''; }],
  ['untrimmed name', value => { value.identities[0].name += ' '; }],
  ['formatted registry phone', value => { value.identities[0].phone = '010-0000-0001'; }],
  ['phone number type', value => { value.identities[0].phone = 1000000001; }],
  ['short phone', value => { value.identities[0].phone = '0001'; }],
  ['blank uid', value => { value.identities[0].uid = ''; }],
  ['untrimmed uid', value => { value.identities[0].uid += ' '; }],
  ['control uid', value => { value.identities[0].uid += '\n'; }],
  ['generated member code', value => { value.identities[0].memberCode = 'excel_1'; }],
  ['numeric source id', value => { value.identities[0].sourceMemberId = 1001; }],
  ['non-native source id', value => { value.identities[0].sourceMemberId = 'source_1'; }],
]) test(`approval fails closed without mutation: ${label}`, () => {
  const value = registry(); change(value); const before = structuredClone(value);
  assert.throws(() => validateOperatorIdentities(value, NOW, 'a'.repeat(64)));
  assert.deepEqual(value, before);
});

test('bad approval objects, clocks and expected hashes always reject', () => {
  for (const value of [null, undefined, [], {}, false]) assert.throws(() => validateOperatorIdentities(value, NOW));
  for (const now of [NaN, Infinity, '2026-10-29T04:00:00Z', null]) assert.throws(() => validateOperatorIdentities(registry(), now));
  for (const hash of ['', null, 'A'.repeat(64), 'a'.repeat(63)]) assert.throws(() => validateOperatorIdentities(registry(), NOW, hash));
});

test('missing/null/empty current phone may match only the exact operator-confirmed native account', () => {
  for (const callnum of [undefined, null, '', '01000000001', '010-0000-0001', '+82 10-0000-0001']) {
    const input = options({ members: [member({ callnum })] }), value = registry(), before = structuredClone([input, value]);
    const result = match(input, value);
    assert.deepEqual(result, { status: 'matched', member: { uid: 'synthetic-uid-1', memberCode: 'm0001' },
      identityConfirmation: { source: 'explicit_operator_identity_confirmation', scope: SCOPE,
        approvedSetSha256: setHash(value), confirmedAt: value.confirmedAt, approvalRef: APPROVAL } });
    assert.doesNotMatch(JSON.stringify(result), /Synthetic Attendee|01000000001|sourceMemberId|callnum|group|point/);
    assert.deepEqual([input, value], before);
  }
});

test('identity is reusable across dates/teams, never an attendance or grant-policy override', () => {
  for (const team of ['A', 'B', 'C', 'D', 'future-team']) for (const date of ['2026-10-24', '2027-06-01']) {
    for (const attendance of ['\uCD9C\uC11D', '\uACB0\uC11D']) {
      const input = options({ attendee: attendee({ team, date, attendance }) });
      assert.equal(match(input).status, 'matched');
      assert.deepEqual(input.attendee, attendee({ team, date, attendance }));
    }
    for (const attendance of ['\uCDE8\uC18C', '\uD658\uBD88', '\uC608\uC57D', '', null, undefined, ' \uCD9C\uC11D']) {
      const input = options({ attendee: attendee({ team, date, attendance }) });
      assert.deepEqual(match(input), original(input));
      assert.equal(match(input).status, 'hold');
    }
  }
});

test('NFC name equivalence and normalized full phone are required together', () => {
  const value = registry({ identities: [identity({ name: 'Synthetic \uAC00' })] });
  const input = options({ attendee: attendee({ name: ' Synthetic \u1100\u1161 ', phone: '+82 10-0000-0001' }),
    members: [member({ name: 'Synthetic \u1100\u1161' })] });
  assert.equal(match(input, value).status, 'matched');
  for (const changed of [{ name: 'Synthetic' }, { phone: '0001' }, { phone: '01000000002' },
    { name: 'synthetic \uAC00' }, { phone: '010letters00000001' }]) {
    const other = { ...input, attendee: { ...input.attendee, ...changed } };
    assert.deepEqual(match(other, value), original(other));
  }
});

for (const [label, members] of [
  ['missing account', []], ['different uid', [member({ uid: 'synthetic-other' })]],
  ['different native code', [member({ memberCode: 'm0002' })]],
  ['different name', [member({ name: 'Other Synthetic' })]],
  ['same name elsewhere', [member(), member({ uid: 'synthetic-other', memberCode: 'm0002' })]],
  ['same phone elsewhere', [member(), member({ uid: 'synthetic-other', memberCode: 'm0002', name: 'Other Synthetic', callnum: '01000000001' })]],
  ['ordinary matcher selects another account', [member({ name: 'Renamed Synthetic' }), member({ uid: 'synthetic-other', memberCode: 'm0002', callnum: '01000000001' })]],
  ['malformed unrelated member', [member(), null]],
  ['duplicate uid', [member(), member({ memberCode: 'm0002', name: 'Other Synthetic' })]],
  ['duplicate code', [member(), member({ uid: 'synthetic-other', name: 'Other Synthetic' })]],
  ['wrong site', [member({ siteCode: 'other' })]], ['wrong unit', [member({ unitCode: 'other' })]],
]) test(`current native source conflict never overrides: ${label}`, () => {
  const input = options({ members }), before = structuredClone(input);
  assert.equal(match(input).status, 'hold');
  assert.deepEqual(input, before);
});

test('a second same-name account blocks even an otherwise ordinary exact match', () => {
  const input = options({ members: [member({ callnum: '01000000001' }),
    member({ uid: 'synthetic-other', memberCode: 'm0002', callnum: '01000000002' })] });
  assert.equal(original(input).status, 'matched');
  assert.equal(match(input).status, 'hold');
});

test('nonempty changed or malformed native phone cannot be replaced by the registry phone', () => {
  for (const callnum of ['01000000002', ' ', '0001', 'not a phone', '010letters00000001', 1000000001, {}, []]) {
    assert.equal(match(options({ members: [member({ callnum })] })).status, 'hold');
  }
});

test('original invalid, incomplete and ambiguous outcomes are retained exactly', () => {
  const inputs = [options({ complete: false }), options({ complete: 'true' }), options({ complete: undefined }),
    options({ members: null }), options({ members: {} }), options({ members: [null] }),
    options({ attendee: attendee({ attendance: '\uCDE8\uC18C' }) }),
    options({ members: [member({ callnum: '01000000001' }), member({ uid: 'synthetic-other', memberCode: 'm0002', callnum: '01000000001' })] }),
    options({ members: [member(), member()] })];
  for (const input of inputs) assert.deepEqual(match(input), original(input));
});

test('missing registry and all unrelated targets retain every original result', () => {
  const inputs = [options(), options({ members: [] }), options({ complete: false }),
    options({ members: [member({ callnum: '01000000001' })] }), options({ members: [null] })];
  for (const input of inputs) for (const value of [null, undefined]) {
    assert.deepEqual(matchWithOperatorIdentity(input, value), original(input));
  }
  for (const changes of [{ name: 'Other Synthetic' }, { phone: '01000000002' }, { name: 'Other Synthetic', phone: '01000000002' }]) {
    for (const members of [[], [member()], [member({ ...changes, callnum: changes.phone || '01000000001' })]]) {
      const input = options({ attendee: attendee(changes), members });
      assert.deepEqual(match(input), original(input));
    }
  }
});

test('private reader returns null for missing file or missing private directory', t => {
  const { root, file } = privateFixture(t);
  fs.unlinkSync(file);
  assert.equal(readOperatorIdentities(file), null);
  assert.equal(readOperatorIdentities(path.join(root, 'missing', 'approved.json')), null);
});

test('safe synthetic file is read but cannot bypass the fixed production hash', t => {
  const { file } = privateFixture(t);
  assert.throws(() => readOperatorIdentities(file), /hash mismatch/);
});

test('malformed private JSON produces no sensitive JSON excerpt', t => {
  const { file } = privateFixture(t, '{"private":"synthetic-do-not-print"');
  assert.throws(() => readOperatorIdentities(file), error => error.message === 'Invalid operator identity registry JSON');
});

for (const kind of ['file mode', 'parent mode', 'file symlink', 'dangling symlink', 'parent symlink', 'directory', 'hardlink', 'oversized']) {
  test(`private reader rejects unsafe ${kind}`, t => {
    const { root, file } = privateFixture(t);
    let target = file;
    if (kind === 'file mode') fs.chmodSync(file, 0o644);
    if (kind === 'parent mode') fs.chmodSync(root, 0o755);
    if (kind === 'file symlink' || kind === 'dangling symlink') {
      fs.unlinkSync(file); fs.symlinkSync(kind === 'file symlink' ? root : path.join(root, 'missing'), file);
    }
    if (kind === 'parent symlink') { fs.symlinkSync(root, path.join(root, 'alias')); target = path.join(root, 'alias', 'approved.json'); }
    if (kind === 'directory') { fs.unlinkSync(file); fs.mkdirSync(file, { mode: 0o700 }); }
    if (kind === 'hardlink') fs.linkSync(file, path.join(root, 'alias.json'));
    if (kind === 'oversized') fs.writeFileSync(file, ' '.repeat(65537));
    assert.throws(() => readOperatorIdentities(target), /Unsafe/);
  });
}

for (const kind of ['file', 'parent']) test(`private reader rejects nonowner ${kind}`, t => {
  const { root, file } = privateFixture(t), originalStat = fs.lstatSync.bind(fs);
  t.mock.method(fs, 'lstatSync', filename => {
    const stat = originalStat(filename);
    return filename === (kind === 'file' ? file : root)
      ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: process.getuid() + 1 }) : stat;
  });
  assert.throws(() => readOperatorIdentities(file), /Unsafe/);
});

test('private reader closes descriptors on file replacement', t => {
  const { file } = privateFixture(t), fstat = fs.fstatSync.bind(fs), close = fs.closeSync.bind(fs);
  let closed = 0;
  t.mock.method(fs, 'fstatSync', descriptor => {
    const stat = fstat(descriptor);
    return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ino: stat.ino + 1 });
  });
  t.mock.method(fs, 'closeSync', descriptor => { closed++; return close(descriptor); });
  assert.throws(() => readOperatorIdentities(file), /file changed/);
  assert.equal(closed, 1);
});

test('module import performs no filesystem, process-spawn or network work', () => {
  const code = `import fs from 'node:fs'; import child from 'node:child_process'; import vm from 'node:vm';
    const url = ${JSON.stringify(moduleUrl)};
    const source = fs.readFileSync(new URL(url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1]);
    const namespaces = new Map(await Promise.all(imports.map(async specifier =>
      [specifier, await import(specifier.startsWith('node:') ? specifier : new URL(specifier, url).href)])));
    const fail = () => { throw Error('Import side effect'); };
    for (const key of ['readFileSync','lstatSync','openSync','writeFileSync','existsSync','mkdirSync','readSync']) fs[key] = fail;
    for (const key of ['spawn','spawnSync','exec','execFile','execFileSync']) child[key] = fail;
    globalThis.fetch = fail;
    const loaded = new vm.SourceTextModule(source, { identifier: url });
    await loaded.link(specifier => {
      const namespace = namespaces.get(specifier);
      return new vm.SyntheticModule(Object.keys(namespace), function() {
        for (const key of Object.keys(namespace)) this.setExport(key, namespace[key]);
      });
    });
    await loaded.evaluate(); console.log('pure-import');`;
  assert.equal(execFileSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', code],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), 'pure-import');
});

test('operational wrapper reads only the private default path and never accepts caller hash overrides', t => {
  const { root } = privateFixture(t);
  const home = path.join(root, 'synthetic-home'); fs.mkdirSync(home, { mode: 0o700 });
  const code = `import { matchLessonShareMember } from ${JSON.stringify(moduleUrl)};
    const result = matchLessonShareMember(${JSON.stringify(options({ members: [member({ callnum: '01000000001' })] }))});
    console.log(JSON.stringify(result));`;
  const run = source => execFileSync(process.execPath, ['--input-type=module', '-e', source],
    { encoding: 'utf8', env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.deepEqual(JSON.parse(run(code)), original(options({ members: [member({ callnum: '01000000001' })] })));
  const directory = path.join(home, 'ArchiveIN/automation/imweb-lesson-identities');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'approved.json'), JSON.stringify(registry()), { mode: 0o600 });
  const failClosed = `import { matchLessonShareMember } from ${JSON.stringify(moduleUrl)};
    try { matchLessonShareMember({ ...${JSON.stringify(options())}, expectedHash: ${JSON.stringify(setHash(registry()))} });
      console.log('unexpected'); } catch (error) { console.log(error.message); }`;
  assert.equal(run(failClosed), 'Operator identity approval hash mismatch');
});
