import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REFERRAL_POLICY } from './lib/imweb-referral-policy.mjs';
import { IMWEB_REFERRAL_SCOPE, readReferralMembers } from './lib/imweb-referral-source.mjs';
import { readPointAwardProof } from './lib/imweb-referral-proof.mjs';
import { runReferralWorker } from './lib/imweb-referral-worker.mjs';

// No arguments: disabled, no files or provider calls. --config FILE: simulation
// (local lock/status only). --config FILE --apply additionally requires approval.
// Local bootstrap, never a history-recovery command:
// --init --config FILE --ledger FILE --backup-dir DIR --starts-at ISO
// Config fields: enabled, tested, startsAt, rewardWon, monthlyLimitWon, timezone,
// siteCode, unitCode, ledgerPath, backupDir; optional maxPages/pageSize and the
// worker's testMode/allowlist/excludedMemberCodes. Production apply also requires
// nativeCampaignDisabled: true and nativeCampaignCheckedAt <= startsAt. This is
// manual evidence, NOT a runtime provider check, and has no automatic expiry.
// The operator must verify absence immediately before activation and must not
// enable the native campaign while the custom worker is on. Main owns that rule.
// Policy/version cannot be overridden by config; no production --now option.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCK_NAME = 'imweb-referral-worker.lock';
const STATUS_NAME = 'imweb-referral-worker-status.json';
const COUNTERS = ['disabled', 'pages', 'members', 'pairs', 'filtered', 'simulated',
  'reserved', 'rejected', 'duplicates', 'prepared', 'claimed', 'sendAttempts',
  'paid', 'reconciled', 'held', 'unresolved', 'failures'];
const CONFIG_KEYS = new Set(['enabled', 'tested', 'startsAt', 'rewardWon',
  'monthlyLimitWon', 'timezone', 'siteCode', 'unitCode', 'ledgerPath', 'backupDir',
  'maxPages', 'pageSize', 'testMode', 'allowlist', 'excludedMemberCodes',
  'nativeCampaignDisabled', 'nativeCampaignCheckedAt', 'inviteeStartsAt', 'inviteeTested']);

class RunnerError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const requireValue = (condition, code) => { if (!condition) throw new RunnerError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

function isoTime(value) {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  requireValue(match && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60,
    'INVALID_TIMESTAMP');
  const wall = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${(match[5] || '').padEnd(3, '0')}Z`;
  const parsed = Date.parse(wall);
  requireValue(Number.isFinite(parsed) && new Date(parsed).toISOString() === wall, 'INVALID_TIMESTAMP');
  const zone = match[6];
  requireValue(zone === 'Z' || (Number(zone.slice(1, 3)) < 24 && Number(zone.slice(4)) < 60), 'INVALID_TIMESTAMP');
  requireValue(Number.isFinite(Date.parse(value)), 'INVALID_TIMESTAMP');
  return new Date(value).toISOString();
}

const kstDay = value => new Date(Date.parse(isoTime(value)) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

export function parseArgs(args) {
  const options = { apply: false, init: false };
  const seen = new Set();
  const flags = { '--config': 'configPath', '--ledger': 'ledgerPath',
    '--backup-dir': 'backupDir', '--starts-at': 'startsAt' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    requireValue(!seen.has(flag), 'INVALID_ARGUMENTS');
    seen.add(flag);
    if (flag === '--apply' || flag === '--init') options[flag.slice(2)] = true;
    else {
      requireValue(Object.hasOwn(flags, flag) && typeof args[i + 1] === 'string' &&
        !args[i + 1].startsWith('--'), 'INVALID_ARGUMENTS');
      options[flags[flag]] = args[++i];
    }
  }
  requireValue(!options.apply || (!!options.configPath && !options.init), 'INVALID_ARGUMENTS');
  requireValue(options.init ? options.configPath && options.ledgerPath && options.backupDir && options.startsAt :
    !options.ledgerPath && !options.backupDir && !options.startsAt, 'INVALID_ARGUMENTS');
  return options;
}

export function validateConfig(input, { apply = false } = {}) {
  requireValue(object(input) && Object.keys(input).every(key => CONFIG_KEYS.has(key)), 'INVALID_CONFIG');
  requireValue(typeof input.enabled === 'boolean' &&
    (input.tested === undefined || typeof input.tested === 'boolean'), 'INVALID_CONFIG');
  requireValue(input.rewardWon === 3000 && input.monthlyLimitWon === 30000 &&
    input.timezone === 'Asia/Seoul', 'POLICY_MISMATCH');
  requireValue(input.siteCode === IMWEB_REFERRAL_SCOPE.siteCode &&
    input.unitCode === IMWEB_REFERRAL_SCOPE.unitCode, 'SCOPE_MISMATCH');
  const startsAt = isoTime(input.startsAt);
  const inviteeStartsAt = input.inviteeStartsAt === undefined ? undefined : isoTime(input.inviteeStartsAt);
  requireValue(input.inviteeTested === undefined || typeof input.inviteeTested === 'boolean', 'INVALID_CONFIG');
  requireValue(!apply || inviteeStartsAt === undefined || input.inviteeTested === true, 'INVITEE_NOT_APPROVED');
  requireValue(inviteeStartsAt === undefined || Date.parse(inviteeStartsAt) >= Date.parse(startsAt), 'INVALID_TIMESTAMP');
  for (const key of ['ledgerPath', 'backupDir']) absolutePath(input[key]);
  requireValue(!apply || (input.enabled === true && input.tested === true), 'APPLY_NOT_APPROVED');
  const maxPages = input.maxPages ?? 10;
  const pageSize = input.pageSize ?? 50;
  requireValue(Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 100 &&
    Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50, 'INVALID_BOUNDS');
  requireValue(input.testMode === undefined || typeof input.testMode === 'boolean', 'INVALID_CONFIG');
  if (input.allowlist !== undefined) {
    requireValue(Array.isArray(input.allowlist) && input.allowlist.length <= 5000 && input.allowlist.every(pair =>
      object(pair) && Object.keys(pair).length === 2 && ['memberCode', 'inviterCode'].every(key =>
        typeof pair[key] === 'string' && pair[key].trim().length > 0 && pair[key].length <= 256)), 'INVALID_ALLOWLIST');
  }
  requireValue(input.testMode !== true || input.allowlist?.length > 0, 'INVALID_ALLOWLIST');
  const excludedMemberCodes = input.excludedMemberCodes ?? [];
  requireValue(input.excludedMemberCodes !== null && Array.isArray(excludedMemberCodes) &&
    excludedMemberCodes.length <= 5000 && excludedMemberCodes.every(code =>
      typeof code === 'string' && code.length > 0 && code.length <= 256 && code.trim() === code) &&
    new Set(excludedMemberCodes).size === excludedMemberCodes.length, 'INVALID_EXCLUSIONS');
  requireValue(input.nativeCampaignDisabled === undefined || typeof input.nativeCampaignDisabled === 'boolean',
    'INVALID_ATTESTATION');
  const nativeCampaignCheckedAt = input.nativeCampaignCheckedAt == null ? null : isoTime(input.nativeCampaignCheckedAt);
  if (apply && input.testMode !== true) {
    requireValue(excludedMemberCodes.length > 0, 'PRODUCTION_EXCLUSIONS_REQUIRED');
    requireValue(input.nativeCampaignDisabled === true && nativeCampaignCheckedAt !== null &&
      Date.parse(nativeCampaignCheckedAt) <= Date.parse(startsAt), 'CAMPAIGN_ATTESTATION_REQUIRED');
  }
  return Object.freeze({ ...input, startsAt, tested: input.tested === true, maxPages, pageSize,
    ...(inviteeStartsAt === undefined ? {} : { inviteeStartsAt }),
    testMode: input.testMode === true, nativeCampaignCheckedAt,
    excludedMemberCodes: Object.freeze([...excludedMemberCodes]),
    ...(input.allowlist === undefined ? {} : {
      allowlist: Object.freeze(input.allowlist.map(pair => Object.freeze({ ...pair }))),
    }) });
}

function absolutePath(filename) {
  requireValue(typeof filename === 'string' && isAbsolute(filename) && normalize(filename) === filename &&
    !filename.includes('\0'), 'INVALID_PATH');
  const root = resolve(REPO_ROOT);
  requireValue(filename !== root && !filename.startsWith(`${root}/`), 'PATH_INSIDE_REPO');
}

function maybeStat(filename) {
  try { return lstatSync(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function privateDirectory(directory) {
  absolutePath(directory);
  let current = parse(directory).root;
  // Check every component, not only the final parent; e.g. macOS /var aliases
  // must be supplied using their real /private/var path.
  for (const part of directory.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    const entry = maybeStat(current);
    requireValue(entry?.isDirectory() && !entry.isSymbolicLink(), 'UNSAFE_DIRECTORY');
    requireValue(!maybeStat(join(current, '.git')), 'PATH_INSIDE_REPO');
  }
  const entry = lstatSync(directory);
  requireValue(typeof process.getuid === 'function' && entry.uid === process.getuid() &&
    !(entry.mode & 0o077), 'UNSAFE_DIRECTORY');
}

function privateFile(filename, { missing = false } = {}) {
  absolutePath(filename);
  privateDirectory(dirname(filename));
  const entry = maybeStat(filename);
  if (!entry && missing) return null;
  requireValue(entry !== null, 'MISSING_FILE');
  requireValue(entry.isFile() && !entry.isSymbolicLink() && entry.nlink === 1 &&
    entry.uid === process.getuid() && !(entry.mode & 0o077), 'UNSAFE_FILE');
  return entry;
}

function runtimePaths(config, configPath, { init = false } = {}) {
  privateDirectory(config.backupDir);
  privateDirectory(dirname(config.ledgerPath));
  const paths = { ledgerPath: config.ledgerPath, backupDir: config.backupDir,
    lockPath: join(dirname(config.ledgerPath), LOCK_NAME),
    statusPath: join(dirname(config.ledgerPath), STATUS_NAME) };
  requireValue(new Set([configPath, paths.ledgerPath, paths.lockPath, paths.statusPath]).size === 4,
    'PATH_COLLISION');
  const existing = privateFile(paths.ledgerPath, { missing: true });
  requireValue(init ? !existing : !!existing, init ? 'INIT_EXISTS' : 'LEDGER_MISSING');
  privateFile(paths.statusPath, { missing: true });
  return paths;
}

export function loadConfig(configPath, options = {}) {
  const entry = privateFile(configPath);
  requireValue(entry.size > 0 && entry.size <= 65536, 'INVALID_CONFIG');
  let fd;
  try {
    fd = openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    requireValue(sameFile(entry, fstatSync(fd)), 'UNSAFE_FILE');
    const config = validateConfig(JSON.parse(readFileSync(fd, 'utf8')), options);
    runtimePaths(config, configPath);
    return config;
  } catch (error) {
    if (error instanceof RunnerError) throw error;
    throw new RunnerError('INVALID_CONFIG');
  } finally { if (fd !== undefined) closeSync(fd); }
}

function acquireLock(paths, startedAt) {
  let fd;
  try { fd = openSync(paths.lockPath, 'wx', 0o600); }
  catch (error) { throw new RunnerError(error.code === 'EEXIST' ? 'LOCKED' : 'LOCK_FAILED'); }
  const identity = fstatSync(fd);
  const assertOwned = () => {
    const current = maybeStat(paths.lockPath);
    requireValue(current && sameFile(current, identity), 'LOCK_CHANGED');
  };
  const release = () => {
    try {
      assertOwned();
      unlinkSync(paths.lockPath);
    } finally { closeSync(fd); }
  };
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt }));
    fsyncSync(fd);
    return { release, assertOwned };
  } catch { release(); throw new RunnerError('LOCK_FAILED'); }
}

async function inspectLedger(filename) {
  privateFile(filename);
  for (const suffix of ['-wal', '-shm', '-journal']) privateFile(`${filename}${suffix}`, { missing: true });
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const checks = db.prepare('PRAGMA quick_check').all();
    requireValue(checks.length === 1 && Object.values(checks[0])[0] === 'ok', 'LEDGER_INVALID');
    db.prepare(`SELECT rewardKey, inviterKey, month, policyVersion, amountWon, status,
      reason, createdAt, updatedAt, providerLogKey FROM referral_rewards LIMIT 0`).all();
  } finally { db.close(); }
}

function syncDirectory(directory) {
  const fd = openSync(directory, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export async function backupLedger(paths, now) {
  const day = kstDay(now);
  const scope = createHash('sha256').update(paths.ledgerPath).digest('hex').slice(0, 24);
  const destination = join(paths.backupDir, `imweb-referral-${scope}-${day}.sqlite`);
  let temporary;
  try {
    privateDirectory(paths.backupDir);
    await inspectLedger(paths.ledgerPath);
    if (privateFile(destination, { missing: true })) {
      await inspectLedger(destination);
      return { day, created: false };
    }
    temporary = join(paths.backupDir, `.imweb-referral-${randomUUID()}.sqlite`);
    const fd = openSync(temporary, 'wx', 0o600);
    closeSync(fd);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(paths.ledgerPath, { readOnly: true });
    try { db.prepare('VACUUM INTO ?').run(temporary); } finally { db.close(); }
    await inspectLedger(temporary);
    const backupFd = openSync(temporary, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(backupFd); } finally { closeSync(backupFd); }
    requireValue(!maybeStat(destination), 'BACKUP_FAILED');
    renameSync(temporary, destination);
    temporary = undefined;
    syncDirectory(paths.backupDir);
    return { day, created: true };
  } catch { throw new RunnerError('BACKUP_FAILED'); }
  finally { if (temporary) unlinkSync(temporary); }
}

function writeStatus(filename, report) {
  privateFile(filename, { missing: true });
  const temporary = join(dirname(filename), `.${STATUS_NAME}.${randomUUID()}`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try { writeFileSync(fd, `${JSON.stringify(report)}\n`); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, filename);
    syncDirectory(dirname(filename));
  } finally { if (maybeStat(temporary)) unlinkSync(temporary); }
}

function aggregate(summary) {
  requireValue(object(summary) && COUNTERS.every(key =>
    Number.isSafeInteger(summary[key]) && summary[key] >= 0), 'INVALID_SUMMARY');
  return Object.fromEntries(COUNTERS.map(key => [key, summary[key]]));
}

async function createLedger(filename, role = 'inviter') {
  const { ReferralLedger } = await import('./lib/imweb-referral-ledger.mjs');
  return new ReferralLedger(filename, role);
}

export async function main(argv = [], dependencies = {}) {
  const clock = dependencies.now ?? (() => new Date().toISOString());
  const output = dependencies.output ?? (line => process.stdout.write(`${line}\n`));
  const runWorker = dependencies.runWorker ?? runReferralWorker;
  let report = { mode: 'disabled', state: 'running', startedAt: null, finishedAt: null,
    errorCode: null, summary: null };
  let lock, ledger, paths;
  const extraLedgers = [];
  let failureCode = 'CONFIG_FAILED';
  const fail = error => {
    report.state = 'failed';
    report.errorCode = error instanceof RunnerError ? error.code : failureCode;
  };
  try {
    report.startedAt = isoTime(clock());
    const options = parseArgs(argv);
    if (!options.configPath) {
      report.summary = aggregate(await runWorker());
    } else {
      let config;
      if (options.init) {
        requireValue(!privateFile(options.configPath, { missing: true }), 'INIT_EXISTS');
        config = validateConfig({ enabled: false, tested: false, startsAt: options.startsAt,
          rewardWon: 3000, monthlyLimitWon: 30000, timezone: 'Asia/Seoul',
          nativeCampaignDisabled: false, nativeCampaignCheckedAt: null, excludedMemberCodes: [],
          ...IMWEB_REFERRAL_SCOPE, ledgerPath: options.ledgerPath, backupDir: options.backupDir });
      } else config = loadConfig(options.configPath, { apply: options.apply });
      report.mode = options.init ? 'init' : options.apply ? 'apply' : config.enabled ? 'simulate' : 'disabled';
      paths = runtimePaths(config, options.configPath, { init: options.init });
      lock = acquireLock(paths, report.startedAt);
      failureCode = 'STATUS_FAILED';
      writeStatus(paths.statusPath, report);
      if (options.init) {
        failureCode = 'INIT_FAILED';
        // The only creation path. get() opens the existing empty file through
        // the canonical adapter, installing its schema without a reservation.
        requireValue(!privateFile(options.configPath, { missing: true }) &&
          !privateFile(paths.ledgerPath, { missing: true }), 'INIT_EXISTS');
        closeSync(openSync(paths.ledgerPath, 'wx', 0o600));
        ledger = await createLedger(paths.ledgerPath);
        ledger.get('runner-initialization');
        const fd = openSync(options.configPath, 'wx', 0o600);
        try { writeFileSync(fd, `${JSON.stringify(config, null, 2)}\n`); fsyncSync(fd); }
        finally { closeSync(fd); }
        report.summary = aggregate(await runReferralWorker());
      } else {
        failureCode = 'LEDGER_INVALID';
        await inspectLedger(paths.ledgerPath);
        let backedUpDay;
        const ensureBackup = async () => {
          const backup = dependencies.backupLedger ?? backupLedger;
          for (let attempt = 0; attempt < 2; attempt++) {
            const before = isoTime(clock());
            if (kstDay(before) !== backedUpDay) await backup(paths, before);
            if (kstDay(before) === kstDay(clock())) { backedUpDay = kstDay(before); return; }
          }
          throw new RunnerError('BACKUP_DAY_CHANGED');
        };
        if (options.apply) {
          requireValue(Date.parse(config.startsAt) <= Date.parse(report.startedAt), 'NOT_STARTED');
          failureCode = 'BACKUP_FAILED';
          await ensureBackup();
          // Recheck after asynchronous backup; never let the lazy adapter
          // recreate a ledger removed between preflight and worker startup.
          requireValue(!!privateFile(paths.ledgerPath, { missing: true }), 'LEDGER_MISSING');
          await inspectLedger(paths.ledgerPath);
          failureCode = 'LEDGER_INVALID';
          ledger = await (dependencies.createLedger ?? createLedger)(paths.ledgerPath);
        }
        failureCode = 'WORKER_FAILED';
        const bounds = { maxPages: config.maxPages, pageSize: config.pageSize };
        const roles = ['inviter'];
        if (config.inviteeStartsAt && Date.parse(config.inviteeStartsAt) <= Date.parse(report.startedAt)) roles.push('invitee');
        let scan;
        const scanMembers = dependencies.workerDependencies?.readReferralMembers ?? (() => readReferralMembers(bounds));
        report.rewards = {};
        for (const role of roles) {
          const roleLedger = role === 'inviter' ? ledger : options.apply
            ? await (dependencies.createLedger ?? createLedger)(paths.ledgerPath, role) : undefined;
          if (role === 'invitee' && roleLedger) extraLedgers.push(roleLedger);
          const policy = Object.freeze({ ...REFERRAL_POLICY, enabled: config.enabled,
            startsAt: role === 'invitee' ? config.inviteeStartsAt : config.startsAt,
            version: role === 'invitee' ? '2026-09-15-invitee-v1' : REFERRAL_POLICY.version });
          report.rewards[role] = aggregate(await runWorker({ enabled: config.enabled, tested: config.tested,
            apply: options.apply, role, policy, testMode: config.testMode, allowlist: config.allowlist,
            excludedMemberCodes: config.excludedMemberCodes }, {
            verifier: input => readPointAwardProof(input, { ...bounds, now: isoTime(clock()) }),
            clock: () => isoTime(clock()),
            ...dependencies.workerDependencies,
            readReferralMembers: async () => (scan ??= await scanMembers()), ledger: roleLedger,
            beforePrepare: options.apply ? async () => { await ensureBackup(); return true; } : undefined,
          }));
        }
        report.summary = Object.fromEntries(COUNTERS.map(key => [key,
          ['disabled', 'pages', 'members', 'pairs'].includes(key) ? report.rewards.inviter[key]
            : Object.values(report.rewards).reduce((sum, result) => sum + result[key], 0)]));
        requireValue(report.summary.failures === 0 && report.summary.held === 0 &&
          report.summary.unresolved === 0, 'WORKER_INCOMPLETE');
      }
    }
    report.state = 'success';
  } catch (error) { fail(error); }
  finally {
    for (const extra of extraLedgers) {
      try { extra.close(); } catch { fail(new RunnerError('LEDGER_CLOSE_FAILED')); }
    }
    try { ledger?.close(); }
    catch { fail(new RunnerError('LEDGER_CLOSE_FAILED')); }
    try { report.finishedAt = isoTime(clock()); }
    catch { fail(new RunnerError('INVALID_TIMESTAMP')); }
    if (lock) {
      try { lock.assertOwned(); writeStatus(paths.statusPath, report); }
      catch { fail(new RunnerError('STATUS_FAILED')); }
      finally {
        try { lock.release(); }
        catch {
          fail(new RunnerError('LOCK_RELEASE_FAILED'));
          // Never overwrite a replacement owner's status. If unlink failed
          // while our lock remains, persist that failure for the operator.
          try { lock.assertOwned(); writeStatus(paths.statusPath, report); } catch { /* Stdout remains authoritative. */ }
        }
      }
    }
  }
  const exitCode = report.state === 'failed' ? 1 : 0;
  output(JSON.stringify(report));
  return { exitCode, ...report };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = (await main(process.argv.slice(2))).exitCode;
}
