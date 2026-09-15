import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ReferralLedger } from '../lib/imweb-referral-ledger.mjs';
import { IMWEB_REFERRAL_SCOPE as scope } from '../lib/imweb-referral-source.mjs';
import { backupLedger, loadConfig, main, parseArgs, validateConfig } from '../run-imweb-referral-worker.mjs';

const NOW = '2026-09-15T06:00:00Z';
const START = '2026-09-15T00:00:00+09:00';
const runnerURL = new URL('../run-imweb-referral-worker.mjs', import.meta.url);
const PRIVATE = 'private-provider-error person@example.test token=secret';
const forbidden = () => { throw new Error('Unexpected provider or ledger access'); };
const empty = { disabled: 0, pages: 1, members: 0, pairs: 0, filtered: 0, simulated: 0,
  reserved: 0, rejected: 0, duplicates: 0, prepared: 0, claimed: 0, sendAttempts: 0,
  paid: 0, reconciled: 0, held: 0, unresolved: 0, failures: 0 };
const inviter = { ...scope, memberCode: 'fixture-inviter', uid: 'inviter@example.test',
  email: 'inviter@example.test', joinTime: '2026-08-01T00:00:00Z', recommendCode: 'FIXTURE' };
const invitee = { ...scope, memberCode: 'fixture-new', uid: 'new@example.test',
  email: 'new@example.test', joinTime: '2026-09-15T05:00:00Z', recommendTargetCode: 'FIXTURE' };

function fixture(t, { initialize = true } = {}) {
  // tmpdir() can include /var -> /private/var on macOS; symlink aliases are
  // deliberately rejected by the runtime, so use the actual parent in tests.
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'imweb-referral-runner-'));
  const configPath = join(directory, 'config.json');
  const ledgerPath = join(directory, 'ledger.sqlite');
  const backupDir = join(directory, 'backups');
  const lockPath = join(directory, 'imweb-referral-worker.lock');
  const statusPath = join(directory, 'imweb-referral-worker-status.json');
  mkdirSync(backupDir, { mode: 0o700 });
  const config = { enabled: true, tested: true, startsAt: START, rewardWon: 3000,
    monthlyLimitWon: 30000, timezone: 'Asia/Seoul', ...scope, ledgerPath, backupDir,
    excludedMemberCodes: ['known-test-inviter', 'known-test-invitee'],
    nativeCampaignDisabled: true, nativeCampaignCheckedAt: '2026-09-14T14:59:00Z' };
  const saveConfig = (changes = {}) => {
    writeFileSync(configPath, JSON.stringify({ ...config, ...changes }), { mode: 0o600 });
  };
  if (initialize) {
    writeFileSync(ledgerPath, '', { mode: 0o600 });
    const ledger = new ReferralLedger(ledgerPath);
    try { ledger.get('initialize-fixture-schema'); } finally { ledger.close(); }
    saveConfig();
  }
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const events = [];
  const lines = [];
  const dependencies = {
    now: () => NOW,
    output: line => lines.push(line),
    createLedger: path => {
      events.push('open');
      const ledger = new ReferralLedger(path);
      return Object.fromEntries(['get', 'unresolvedRecords', 'reserve', 'claim', 'holdUnknown', 'verifyPaid', 'close'].map(name =>
        [name, (...args) => { events.push(name); return ledger[name](...args); }]));
    },
    workerDependencies: {
      readReferralMembers: () => { events.push('read'); return { complete: true, pages: 1, members: [inviter, invitee] }; },
      preparePointAward: (target, key) => {
        events.push('prepare');
        assert.equal(target.memberCode, inviter.memberCode);
        return { reason: `imweb-referral:${key}`, send: () => { events.push('send'); return { acknowledged: true }; } };
      },
      verifier: ({ inviter: member, record }) => {
        events.push('proof');
        return { sourceVerified: true, member, amountWon: 3000, reason: record.providerReason, logId: 'fixture-log' };
      },
    },
  };
  const run = (args = [], overrides = {}) => main(['--config', configPath, ...args], { ...dependencies, ...overrides });
  const status = () => JSON.parse(readFileSync(statusPath, 'utf8'));
  return { directory, configPath, ledgerPath, backupDir, lockPath, statusPath, config,
    saveConfig, run, status, dependencies, events, lines };
}

function countRows(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare('SELECT COUNT(*) AS n FROM referral_rewards').get().n; }
  finally { db.close(); }
}

function assertPrivate(path) { assert.equal(statSync(path).mode & 0o777, 0o600); }

test('invitee activation requires its own tested flag and never backdates the inviter start', t => {
  const f = fixture(t);
  assert.throws(() => validateConfig({ ...f.config, inviteeStartsAt: NOW }, { apply: true }), /INVITEE_NOT_APPROVED/);
  assert.throws(() => validateConfig({ ...f.config, inviteeStartsAt: '2026-08-01T00:00:00Z', inviteeTested: true }), /INVALID_TIMESTAMP/);
  assert.equal(validateConfig(f.config).inviteeStartsAt, undefined);
});

test('dual runner shares a scan and lock, closes both ledgers, and reports each recipient separately', async t => {
  const f = fixture(t);
  f.saveConfig({ inviteeStartsAt: '2026-09-15T04:00:00Z', inviteeTested: true });
  const closed = [], sent = [];
  const createLedger = (path, role = 'inviter') => {
    const ledger = new ReferralLedger(path, role);
    const close = ledger.close.bind(ledger);
    ledger.close = () => { closed.push(role); close(); };
    return ledger;
  };
  const workerDependencies = { ...f.dependencies.workerDependencies,
    preparePointAward: (target, key, { role }) => ({
      reason: `imweb-referral${role === 'invitee' ? '-invitee' : ''}:${key}`,
      send: () => { sent.push([role, target.memberCode]); return {}; },
    }),
    verifier: ({ member, inviter: referrer, record }) => ({ sourceVerified: true,
      member: record.role === 'invitee' ? member : referrer, amountWon: 3000,
      reason: record.providerReason, logId: `fixture-${record.role}` }),
  };
  const first = await f.run(['--apply'], { createLedger, workerDependencies });
  assert.equal(first.exitCode, 0);
  assert.equal(first.rewards.inviter.paid, 1);
  assert.equal(first.rewards.invitee.paid, 1);
  assert.equal(first.summary.paid, 2);
  assert.equal(f.events.filter(event => event === 'read').length, 1);
  assert.deepEqual(sent, [['inviter', inviter.memberCode], ['invitee', invitee.memberCode]]);
  assert.deepEqual(closed.sort(), ['invitee', 'inviter']);
  const second = await f.run(['--apply'], { createLedger, workerDependencies });
  assert.equal(second.summary.sendAttempts, 0);
  assert.equal(sent.length, 2);
  assert.equal(existsSync(f.lockPath), false);
});

test('import has no execution/output/files and CLI defaults make no calls or writes', async t => {
  const f = fixture(t, { initialize: false });
  const before = readdirSync(f.directory);
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(runnerURL.href)})`],
    { cwd: f.directory, encoding: 'utf8' });
  assert.equal(imported.status, 0); assert.equal(imported.stdout, ''); assert.equal(imported.stderr, '');
  const result = await main([], { ...f.dependencies, createLedger: forbidden, backupLedger: forbidden,
    workerDependencies: { readReferralMembers: forbidden, preparePointAward: forbidden, verifier: forbidden } });
  assert.equal(result.exitCode, 0); assert.equal(result.mode, 'disabled'); assert.equal(result.summary.disabled, 1);
  assert.deepEqual(readdirSync(f.directory), before);
  const child = spawnSync(process.execPath, [fileURLToPath(runnerURL)], { cwd: f.directory, encoding: 'utf8' });
  assert.equal(child.status, 0); assert.equal(JSON.parse(child.stdout).summary.disabled, 1);
  assert.equal(child.stderr, ''); assert.deepEqual(readdirSync(f.directory), before);
});

test('strict argument parsing rejects implicit apply, overrides and incomplete initialization', () => {
  assert.deepEqual(parseArgs([]), { apply: false, init: false });
  assert.deepEqual(parseArgs(['--config', '/private/config.json', '--apply']),
    { apply: true, init: false, configPath: '/private/config.json' });
  for (const args of [['--apply'], ['--config'], ['--config', '--apply'], ['--enabled'],
    ['--config', '/one', '--config', '/two'], ['--ledger', '/one'], ['--init'],
    ['--config', '/one', '--init', '--apply'], ['--reward', '9000'], ['--apply', '--apply'], ['--now', NOW]]) {
    assert.throws(() => parseArgs(args), /INVALID_ARGUMENTS/);
  }
});

test('config validators preserve approved immutable scope/policy and exact test pairs', t => {
  const f = fixture(t);
  const approved = validateConfig({ ...f.config, testMode: true,
    allowlist: [{ memberCode: 'fixture-new', inviterCode: 'fixture-inviter' }] }, { apply: true });
  assert.equal(approved.startsAt, '2026-09-14T15:00:00.000Z');
  assert.equal(approved.maxPages, 10); assert.equal(approved.pageSize, 50);
  assert.ok(Object.isFrozen(approved)); assert.ok(Object.isFrozen(approved.allowlist[0]));
  assert.throws(() => { approved.rewardWon = 9000; }, TypeError);
  for (const changes of [{ enabled: 'true' }, { tested: 'true' }, { rewardWon: '3000' }, { rewardWon: 2999 },
    { monthlyLimitWon: 30001 }, { timezone: 'UTC' }, { siteCode: 'other' }, { unitCode: 'other' },
    { startsAt: null }, { startsAt: '2026-09-15' }, { startsAt: '2026-02-30T00:00:00Z' },
    { startsAt: '2026-09-15T24:00:00Z' }, { startsAt: '2026-09-15T00:00:00+09:99' },
    { ledgerPath: 'relative.sqlite' }, { backupDir: 'relative' }, { ledgerPath: '/tmp/../ledger.sqlite' },
    { maxPages: 101 }, { maxPages: 0 }, { pageSize: 51 }, { pageSize: 1.5 },
    { policy: { enabled: true } }, { version: 'new' }, { apply: true }, { phoneVerificationRequired: true },
    { testMode: true }, { testMode: true, allowlist: [] }, { allowlist: [{ memberCode: 'one' }] },
    { allowlist: [{ memberCode: 'one', inviterCode: 'two', other: true }] }]) {
    assert.throws(() => validateConfig({ ...f.config, ...changes }), JSON.stringify(changes));
  }
  for (const key of Object.keys(f.config).filter(key => !['tested', 'excludedMemberCodes',
    'nativeCampaignDisabled', 'nativeCampaignCheckedAt'].includes(key))) {
    const value = { ...f.config }; delete value[key];
    assert.throws(() => validateConfig(value), key);
  }
  for (const changes of [{ enabled: false }, { tested: false }, { tested: undefined }]) {
    assert.throws(() => validateConfig({ ...f.config, ...changes }, { apply: true }), /APPLY_NOT_APPROVED/);
  }
  assert.deepEqual(loadConfig(f.configPath), validateConfig(f.config));
});

test('disabled config cannot authorize apply and does not scan even with valid approval metadata', async t => {
  const f = fixture(t);
  f.saveConfig({ enabled: false });
  const before = readFileSync(f.ledgerPath);
  const disabled = await f.run();
  assert.equal(disabled.summary.disabled, 1); assert.deepEqual(f.events, []);
  assert.equal((await f.run(['--apply'])).errorCode, 'APPLY_NOT_APPROVED');
  assert.deepEqual(readFileSync(f.ledgerPath), before);
  assert.deepEqual(readdirSync(f.backupDir), []); assert.ok(!existsSync(f.lockPath));
});

test('production apply requires scoped manual campaign attestation without an expiry timer', async t => {
  const f = fixture(t);
  for (const changes of [{ nativeCampaignDisabled: false }, { nativeCampaignDisabled: undefined },
    { nativeCampaignDisabled: 'true' }, { nativeCampaignCheckedAt: null }, { nativeCampaignCheckedAt: undefined },
    { nativeCampaignCheckedAt: 'yesterday' }, { nativeCampaignCheckedAt: '2026-09-15T00:00:00Z' }]) {
    f.saveConfig(changes);
    const result = await f.run(['--apply'], { backupLedger: forbidden });
    assert.equal(result.exitCode, 1); assert.deepEqual(f.events, []);
  }
  f.saveConfig({ nativeCampaignCheckedAt: '2026-09-01T00:00:00Z' });
  // More than 24 hours and more than 14 days old remains an explicit operator
  // attestation. No API is invented to validate native campaign absence.
  const result = await f.run(['--apply'], { now: () => '2026-09-30T00:00:00Z' });
  assert.equal(result.exitCode, 0); assert.equal(result.summary.paid, 1);
  const report = readFileSync(f.statusPath, 'utf8');
  assert.ok(!report.includes('nativeCampaign')); assert.ok(!report.includes(scope.siteCode));
});

test('production exclusions are mandatory, validated, immutable and forwarded for both roles', async t => {
  const f = fixture(t);
  for (const excludedMemberCodes of [undefined, null, [], 'one', [''], [' space '], [123], ['same', 'same']]) {
    f.saveConfig({ excludedMemberCodes });
    assert.equal((await f.run(['--apply'], { backupLedger: forbidden })).exitCode, 1);
  }
  assert.deepEqual(f.events, []);
  for (const code of [inviter.memberCode, invitee.memberCode]) {
    f.saveConfig({ excludedMemberCodes: [code] });
    assert.ok(Object.isFrozen(loadConfig(f.configPath).excludedMemberCodes));
    const result = await f.run(['--apply']);
    assert.equal(result.exitCode, 0); assert.equal(result.summary.filtered, 1);
    assert.equal(result.summary.sendAttempts, 0); assert.equal(countRows(f.ledgerPath), 0);
    assert.ok(!f.lines.at(-1).includes(code)); assert.ok(!readFileSync(f.statusPath, 'utf8').includes(code));
  }
  f.saveConfig({ testMode: true, allowlist: [{ memberCode: invitee.memberCode, inviterCode: inviter.memberCode }],
    excludedMemberCodes: [], nativeCampaignDisabled: false, nativeCampaignCheckedAt: null });
  assert.doesNotThrow(() => loadConfig(f.configPath, { apply: true }));
});

test('runtime passes a live clock, allows trusted fixture clock injection, and rejects config backdating', async t => {
  const f = fixture(t);
  let moment = NOW;
  const result = await f.run([], { now: () => moment, runWorker: (config, dependencies) => {
    assert.equal(config.now, undefined);
    assert.equal(dependencies.clock(), '2026-09-15T06:00:00.000Z');
    moment = '2026-09-15T07:00:00Z';
    assert.equal(dependencies.clock(), '2026-09-15T07:00:00.000Z');
    return empty;
  } });
  assert.equal(result.exitCode, 0);
  const injected = await f.run([], { workerDependencies: { clock: () => 'fixture-clock' },
    runWorker: (config, dependencies) => { assert.equal(dependencies.clock(), 'fixture-clock'); return empty; } });
  assert.equal(injected.exitCode, 0);
  f.saveConfig({ now: '2025-01-01T00:00:00Z' });
  assert.equal((await f.run(['--apply'])).errorCode, 'INVALID_CONFIG');
});

test('enabled default simulates without ledger/provider writes, preparation or backups', async t => {
  const f = fixture(t);
  f.saveConfig({ tested: false });
  const before = readFileSync(f.ledgerPath);
  const result = await f.run([], { createLedger: forbidden, backupLedger: forbidden });
  assert.equal(result.exitCode, 0); assert.equal(result.mode, 'simulate'); assert.equal(result.summary.simulated, 1);
  assert.equal(result.summary.sendAttempts, 0); assert.deepEqual(f.events, ['read']);
  assert.deepEqual(readFileSync(f.ledgerPath), before); assert.deepEqual(readdirSync(f.backupDir), []);
  assertPrivate(f.statusPath); assert.ok(!existsSync(f.lockPath));
  assert.equal(f.status().state, 'success'); assert.equal(f.status().finishedAt, '2026-09-15T06:00:00.000Z');
});

test('init exclusively creates disabled config and canonical empty ledger without provider calls', async t => {
  const f = fixture(t, { initialize: false });
  const args = ['--init', '--config', f.configPath, '--ledger', f.ledgerPath, '--backup-dir', f.backupDir, '--starts-at', START];
  const result = await main(args, { ...f.dependencies, runWorker: forbidden, createLedger: forbidden,
    backupLedger: forbidden, workerDependencies: { readReferralMembers: forbidden, preparePointAward: forbidden } });
  assert.equal(result.exitCode, 0); assert.equal(result.mode, 'init');
  const config = loadConfig(f.configPath);
  assert.equal(config.enabled, false); assert.equal(config.tested, false);
  assert.equal(config.rewardWon, 3000); assert.equal(config.monthlyLimitWon, 30000);
  assert.equal(countRows(f.ledgerPath), 0);
  for (const path of [f.configPath, f.ledgerPath, f.statusPath]) assertPrivate(path);
  assert.deepEqual(readdirSync(f.backupDir), []); assert.ok(!existsSync(f.lockPath)); assert.deepEqual(f.events, []);
  const before = [readFileSync(f.configPath), readFileSync(f.ledgerPath)];
  assert.equal((await main(args, f.dependencies)).errorCode, 'INIT_EXISTS');
  assert.deepEqual([readFileSync(f.configPath), readFileSync(f.ledgerPath)], before);
  unlinkSync(f.configPath);
  assert.equal((await main(args, f.dependencies)).errorCode, 'INIT_EXISTS');
  assert.ok(!existsSync(f.configPath)); assert.deepEqual(readFileSync(f.ledgerPath), before[1]);
});

test('missing historical ledger fails closed in both simulation and apply, never recreating it', async t => {
  const f = fixture(t);
  unlinkSync(f.ledgerPath);
  for (const args of [[], ['--apply']]) {
    const result = await f.run(args, { createLedger: forbidden, backupLedger: forbidden });
    assert.equal(result.exitCode, 1); assert.equal(result.errorCode, 'LEDGER_MISSING');
    assert.ok(!existsSync(f.ledgerPath)); assert.ok(!existsSync(f.lockPath));
  }
  assert.deepEqual(f.events, []); assert.deepEqual(readdirSync(f.backupDir), []);
});

test('corrupt or schema-less existing ledger fails without repairing or reinitializing it', async t => {
  const f = fixture(t);
  for (const contents of ['', 'not a sqlite database']) {
    writeFileSync(f.ledgerPath, contents);
    const result = await f.run(['--apply']);
    assert.equal(result.exitCode, 1); assert.equal(result.errorCode, 'LEDGER_INVALID');
    assert.equal(readFileSync(f.ledgerPath, 'utf8'), contents);
    assert.ok(!existsSync(f.lockPath));
  }
  assert.deepEqual(f.events, []);
});

test('private files and directories reject group/world permissions before any worker calls', async t => {
  const f = fixture(t);
  for (const [path, unsafe, safe] of [[f.configPath, 0o640, 0o600], [f.ledgerPath, 0o644, 0o600],
    [f.directory, 0o750, 0o700], [f.backupDir, 0o755, 0o700]]) {
    chmodSync(path, unsafe);
    try { assert.equal((await f.run(['--apply'])).exitCode, 1); }
    finally { chmodSync(path, safe); }
  }
  assert.deepEqual(f.events, []); assert.ok(!existsSync(f.lockPath));
});

test('config, ledger, ancestor, backup, status and SQLite sidecar symlinks are rejected', async t => {
  const f = fixture(t);
  const target = join(f.directory, 'private-target');
  writeFileSync(target, PRIVATE, { mode: 0o600 });
  const alias = join(f.directory, 'alias');
  symlinkSync(f.directory, alias, 'dir');
  assert.throws(() => loadConfig(join(alias, 'config.json')), /UNSAFE_DIRECTORY/);
  const configAlias = join(f.directory, 'config-alias.json');
  symlinkSync(f.configPath, configAlias);
  assert.throws(() => loadConfig(configAlias), /UNSAFE_FILE/);
  f.saveConfig({ backupDir: alias }); assert.equal((await f.run()).exitCode, 1); f.saveConfig();
  for (const path of [f.statusPath, `${f.ledgerPath}-wal`]) {
    symlinkSync(target, path);
    assert.equal((await f.run(['--apply'])).exitCode, 1);
    unlinkSync(path);
  }
  unlinkSync(f.ledgerPath); symlinkSync(target, f.ledgerPath);
  assert.equal((await f.run(['--apply'])).exitCode, 1);
  assert.equal(readFileSync(target, 'utf8'), PRIVATE); assert.deepEqual(f.events, []);
});

test('hardlinked files, repository paths, collisions and absent backup directory fail validation', async t => {
  const f = fixture(t);
  const hardlink = join(f.directory, 'config-hardlink');
  linkSync(f.configPath, hardlink);
  assert.throws(() => loadConfig(f.configPath), /UNSAFE_FILE/); unlinkSync(hardlink);
  const repo = join(f.directory, 'another-repo');
  mkdirSync(repo, { mode: 0o700 }); mkdirSync(join(repo, '.git'), { mode: 0o700 });
  f.saveConfig({ backupDir: repo }); assert.throws(() => loadConfig(f.configPath), /PATH_INSIDE_REPO/);
  f.saveConfig({ ledgerPath: f.statusPath }); assert.throws(() => loadConfig(f.configPath), /PATH_COLLISION/);
  f.saveConfig({ backupDir: join(f.directory, 'absent') });
  assert.equal((await f.run(['--apply'])).exitCode, 1);
  assert.ok(!existsSync(join(f.directory, 'absent'))); assert.deepEqual(f.events, []);
  assert.throws(() => validateConfig({ ...f.config, ledgerPath: fileURLToPath(runnerURL) }), /PATH_INSIDE_REPO/);
});

test('existing locks, including stale or symbolic locks, are never removed or overwritten', async t => {
  const f = fixture(t);
  for (const symbolic of [false, true]) {
    if (symbolic) symlinkSync(f.configPath, f.lockPath);
    else writeFileSync(f.lockPath, 'stale-lock-1900', { mode: 0o600 });
    const before = readFileSync(f.lockPath);
    const result = await f.run(['--apply']);
    assert.equal(result.exitCode, 1); assert.equal(result.errorCode, 'LOCKED');
    assert.deepEqual(readFileSync(f.lockPath), before); assert.ok(!existsSync(f.statusPath));
    unlinkSync(f.lockPath);
  }
  assert.deepEqual(f.events, []);
});

test('overlapping runs serialize through wx lock, and the loser cannot replace active status', async t => {
  const f = fixture(t);
  let unlock, signal;
  const pause = new Promise(resolve => { unlock = resolve; });
  const entered = new Promise(resolve => { signal = resolve; });
  const active = f.run([], { workerDependencies: { ...f.dependencies.workerDependencies,
    readReferralMembers: async () => { signal(); await pause; return { complete: true, pages: 1, members: [] }; } } });
  try {
    await entered;
    assertPrivate(f.lockPath);
    const before = readFileSync(f.statusPath);
    assert.equal(f.status().state, 'running');
    const contender = await f.run(['--apply']);
    assert.equal(contender.errorCode, 'LOCKED'); assert.deepEqual(readFileSync(f.statusPath), before);
  } finally { unlock(); }
  assert.equal((await active).exitCode, 0); assert.ok(!existsSync(f.lockPath));
});

test('failed scan closes the canonical ledger and releases only the owned lock, sanitizing output', async t => {
  const f = fixture(t);
  const result = await f.run(['--apply'], { workerDependencies: { ...f.dependencies.workerDependencies,
    readReferralMembers: () => { throw new Error(PRIVATE); } } });
  assert.equal(result.exitCode, 1); assert.equal(result.errorCode, 'WORKER_FAILED');
  assert.equal(result.summary, null); assert.equal(f.events.at(-1), 'close');
  assert.ok(!existsSync(f.lockPath)); assert.equal(f.status().state, 'failed');
  for (const value of [...f.lines, readFileSync(f.statusPath, 'utf8')]) {
    assert.ok(!value.includes(PRIVATE)); assert.ok(!value.includes('@')); assert.ok(!value.includes(f.directory));
  }
});

test('lock replacement is preserved and ledger close exceptions still release an owned lock', async t => {
  const f = fixture(t);
  const changed = await f.run([], { runWorker: () => {
    unlinkSync(f.lockPath); writeFileSync(f.lockPath, 'replacement', { mode: 0o600 }); return empty;
  } });
  assert.equal(changed.exitCode, 1); assert.equal(changed.errorCode, 'LOCK_RELEASE_FAILED');
  assert.equal(f.status().state, 'running');
  assert.equal(readFileSync(f.lockPath, 'utf8'), 'replacement'); unlinkSync(f.lockPath);
  const closeFailure = await f.run(['--apply'], { runWorker: () => empty,
    createLedger: () => ({ close: () => { throw new Error(PRIVATE); } }) });
  assert.equal(closeFailure.exitCode, 1); assert.equal(closeFailure.errorCode, 'LEDGER_CLOSE_FAILED');
  assert.equal(f.status().errorCode, 'LEDGER_CLOSE_FAILED'); assert.ok(!existsSync(f.lockPath));
});

test('real SQLite snapshot precedes apply, is scoped per ledger and reused only within its KST day', async t => {
  const f = fixture(t);
  const changes = [];
  const backup = async (paths, now) => {
    f.events.push('backup'); const result = await backupLedger(paths, now); changes.push(result); return result;
  };
  const first = await f.run(['--apply'], { backupLedger: backup });
  assert.equal(first.exitCode, 0); assert.equal(first.summary.paid, 1);
  assert.equal(f.events[0], 'backup'); assert.ok(f.events.indexOf('backup') < f.events.indexOf('open'));
  assert.ok(f.events.indexOf('backup') < f.events.indexOf('send')); assert.equal(f.events.at(-1), 'close');
  const [name] = readdirSync(f.backupDir);
  assert.match(name, /^imweb-referral-[a-f0-9]{24}-2026-09-15\.sqlite$/);
  const destination = join(f.backupDir, name);
  assertPrivate(destination); assert.equal(countRows(destination), 0); assert.equal(countRows(f.ledgerPath), 1);
  const before = readFileSync(destination);
  const repeat = await f.run(['--apply'], { backupLedger: backup, now: () => '2026-09-15T14:59:59Z' });
  assert.equal(repeat.summary.sendAttempts, 0); assert.equal(repeat.summary.duplicates, 1);
  assert.deepEqual(readFileSync(destination), before); assert.equal(readdirSync(f.backupDir).length, 1);
  const next = await f.run(['--apply'], { backupLedger: backup, now: () => '2026-09-15T15:00:00Z' });
  assert.equal(next.exitCode, 0); assert.equal(next.summary.sendAttempts, 0);
  const nextName = readdirSync(f.backupDir).find(file => file.includes('2026-09-16'));
  assert.equal(countRows(join(f.backupDir, nextName)), 1);
  assert.deepEqual(changes.map(value => value.created), [true, false, true]);
  assert.ok(!existsSync(f.lockPath));
});

test('same backup directory keeps distinct ledger snapshots separate', async t => {
  const a = fixture(t); const b = fixture(t);
  b.saveConfig({ backupDir: a.backupDir });
  assert.equal((await a.run(['--apply'])).exitCode, 0);
  assert.equal((await b.run(['--apply'])).exitCode, 0);
  assert.equal(readdirSync(a.backupDir).length, 2);
});

test('backup failures stop before ledger factory, canonical scan or payout and publish a private failure status', async t => {
  const f = fixture(t);
  const before = readFileSync(f.ledgerPath);
  const result = await f.run(['--apply'], { backupLedger: () => { throw new Error(PRIVATE); }, createLedger: forbidden });
  assert.equal(result.exitCode, 1); assert.equal(result.errorCode, 'BACKUP_FAILED');
  assert.deepEqual(f.events, []); assert.deepEqual(readFileSync(f.ledgerPath), before);
  assert.equal(f.status().errorCode, 'BACKUP_FAILED'); assertPrivate(f.statusPath); assert.ok(!existsSync(f.lockPath));
  assert.ok(!f.lines.join('').includes(PRIVATE));
});

test('invalid daily backup is never trusted, overwritten or silently repaired', async t => {
  const f = fixture(t);
  assert.equal((await f.run(['--apply'])).exitCode, 0);
  const path = join(f.backupDir, readdirSync(f.backupDir)[0]);
  writeFileSync(path, 'incomplete backup'); f.events.length = 0;
  const result = await f.run(['--apply']);
  assert.equal(result.errorCode, 'BACKUP_FAILED'); assert.deepEqual(f.events, []);
  assert.equal(readFileSync(path, 'utf8'), 'incomplete backup'); assert.ok(!existsSync(f.lockPath));
});

test('ledger removal during the backup gate cannot trigger lazy recreation', async t => {
  const f = fixture(t);
  const result = await f.run(['--apply'], { backupLedger: () => unlinkSync(f.ledgerPath), createLedger: forbidden });
  assert.equal(result.errorCode, 'LEDGER_MISSING'); assert.equal(result.exitCode, 1);
  assert.ok(!existsSync(f.ledgerPath)); assert.deepEqual(f.events, []); assert.ok(!existsSync(f.lockPath));
});

test('start-time and daily-clock gates stop unstarted or unstable apply runs', async t => {
  const f = fixture(t);
  f.saveConfig({ startsAt: '2026-10-01T00:00:00Z' });
  assert.equal((await f.run(['--apply'], { backupLedger: forbidden })).errorCode, 'NOT_STARTED');
  f.saveConfig();
  let calls = 0;
  const times = [NOW, NOW, '2026-09-15T15:00:00Z', '2026-09-15T15:00:00Z', '2026-09-16T15:00:00Z'];
  const result = await f.run(['--apply'], { now: () => times.shift() ?? NOW, backupLedger: () => { calls++; } });
  assert.equal(result.errorCode, 'BACKUP_DAY_CHANGED'); assert.equal(calls, 2); assert.deepEqual(f.events, []);
  assert.ok(!existsSync(f.lockPath));
});

test('aggregate allowlist strips extra provider data and failures/holds return nonzero', async t => {
  const f = fixture(t);
  for (const partial of [{}, { failures: 1 }, { held: 1 }, { unresolved: 1 }]) {
    const result = await f.run([], { runWorker: () => ({ ...empty, ...partial, raw: PRIVATE, member: invitee }) });
    assert.equal(result.exitCode, partial.failures || partial.held || partial.unresolved ? 1 : 0);
    assert.deepEqual(Object.keys(result.summary), Object.keys(empty));
    assert.ok(!readFileSync(f.statusPath, 'utf8').includes('@'));
    assert.ok(!f.lines.at(-1).includes(PRIVATE));
  }
  const invalid = await f.run([], { runWorker: () => ({ ...empty, paid: PRIVATE }) });
  assert.equal(invalid.exitCode, 1); assert.equal(invalid.errorCode, 'INVALID_SUMMARY');
  assert.equal(invalid.summary, null); assert.ok(!existsSync(f.lockPath));
});

test('status write preflight failure prevents all apply work', async t => {
  const f = fixture(t);
  mkdirSync(f.statusPath, { mode: 0o700 });
  assert.equal((await f.run(['--apply'], { backupLedger: forbidden })).exitCode, 1);
  assert.deepEqual(f.events, []); assert.ok(!existsSync(f.lockPath));
});

test('CLI config failures return nonzero without raw JSON content or stack traces', t => {
  const f = fixture(t);
  writeFileSync(f.configPath, PRIVATE);
  const child = spawnSync(process.execPath, [fileURLToPath(runnerURL), '--config', f.configPath],
    { cwd: f.directory, encoding: 'utf8' });
  assert.equal(child.status, 1); assert.equal(child.stderr, '');
  assert.equal(JSON.parse(child.stdout).errorCode, 'INVALID_CONFIG');
  assert.ok(!child.stdout.includes(PRIVATE)); assert.ok(!existsSync(f.lockPath));
});
