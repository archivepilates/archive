import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, link, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import pg from 'pg';

const project = 'vrmtkewdqgcrhpbeijhr';
const host = 'aws-0-ap-northeast-2.pooler.supabase.com';
const role = 'archive_history_mcp_reader';
const caUrl = 'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt';
const root = join(homedir(), 'archive-automation');
const dir = join(root, 'secrets', 'supabase');
const file = join(dir, 'mcp-history-reader.json');
const pending = `${file}.pending`;
const dashboardSql = join(dir, 'mcp-history-reader-enroll.sql');

function scramVerifier(password) {
  const salt = randomBytes(16);
  const iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const hmac = label => createHmac('sha256', salted).update(label).digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${createHash('sha256').update(hmac('Client Key')).digest('base64')}:${hmac('Server Key').toString('base64')}`;
}

async function privateDir(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o022)) throw Error('Unsafe local directory');
}

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function saveNew(path, contents) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(contents); await handle.sync(); }
  finally { await handle.close(); }
}

async function readPending() {
  const handle = await open(pending, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 16000)
      throw Error('Invalid pending file');
    const config = JSON.parse(await handle.readFile('utf8'));
    if (config?.project !== project || config.host !== host || !/^[A-Za-z0-9_-]{48}$/.test(config.password)
      || !/^[0-9a-f]{64}$/.test(config.hmacKey) || !config.ca?.startsWith('-----BEGIN CERTIFICATE-----'))
      throw Error('Invalid pending config');
    return config;
  } finally { await handle.close(); }
}

async function prepareConfig() {
  const caResponse = await fetch(caUrl, { signal: AbortSignal.timeout(6000), redirect: 'error' });
  if (!caResponse.ok) throw Error('Certificate unavailable');
  const ca = await caResponse.text();
  if (!ca.startsWith('-----BEGIN CERTIFICATE-----') || ca.length > 8192) throw Error('Invalid certificate');
  return { project, host, ca, password: randomBytes(36).toString('base64url'), hmacKey: randomBytes(32).toString('hex') };
}

function connectOptions(user, password, ca) {
  return { host, port: 5432, database: 'postgres', user: `${user}.${project}`, password,
    ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 6000, query_timeout: 6000,
    application_name: 'archive-history-reader-enrollment' };
}

let stage = 'local preflight', admin, reader, rl;
try {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['--activate-reader','--prepare-dashboard','--verify-dashboard'].includes(mode)) {
    stage = 'missing explicit enrollment mode';
    throw Error('Explicit enrollment option required');
  }
  if (mode === '--activate-reader' && (!process.stdin.isTTY || !process.stdout.isTTY))
    throw Error('Run directly in a local Terminal');
  await privateDir(root);
  await privateDir(join(root, 'secrets'));
  await mkdir(dir, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await privateDir(dir);
  if (await exists(file)) throw Error('Enrollment exists');
  if (mode !== '--verify-dashboard' && (await exists(pending) || await exists(dashboardSql))) throw Error('Pending enrollment exists');
  stage = mode === '--verify-dashboard' ? 'private pending credential' : 'TLS certificate';
  const config = mode === '--verify-dashboard' ? await readPending() : await prepareConfig();
  const preflight = `SELECT
    NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls AS restricted,
    has_function_privilege(rolname,'archive_history_ro.mcp_member_month(text,date)','EXECUTE') AS allowed,
    NOT has_table_privilege(rolname,'archive_history_ro.member_name','SELECT') AS private,
    NOT EXISTS (SELECT FROM archive_history_ro.month_load) AS empty
    FROM pg_catalog.pg_roles WHERE rolname = '${role}'`;

  if (mode === '--activate-reader') {
    stage = 'database password entry';
    const output = new Writable({ write(_chunk, _encoding, cb) { cb(); } });
    rl = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
    rl.on('SIGINT', () => rl.close());
    process.stdout.write('Supabase archive-member-history-pilot existing DB password (hidden): ');
    let adminPassword = await rl.question('');
    rl.close(); rl = null;
    process.stdout.write('\n');
    if (!adminPassword) throw Error('Empty password');
    stage = 'pilot database authentication';
    admin = new pg.Client(connectOptions('postgres', adminPassword, config.ca));
    admin.on('error', () => {});
    adminPassword = '';
    await admin.connect();
    stage = 'pilot database read-only preflight';
    const before = (await admin.query(preflight)).rows[0];
    if (!before?.restricted || !before.allowed || !before.private || !before.empty) throw Error('Unexpected pilot state');
  }
  if (mode !== '--verify-dashboard') {
    stage = 'private pending credential';
    const verifier = scramVerifier(config.password);
    if (!/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier))
      throw Error('Unexpected verifier');
    const activate = `ALTER ROLE archive_history_mcp_reader LOGIN PASSWORD '${verifier}';`;
    await saveNew(pending, JSON.stringify(config) + '\n');
    if (mode === '--prepare-dashboard') {
      await saveNew(dashboardSql, `-- Run only in the archive-member-history-pilot project (${project}).
-- This sets a verifier for the MCP role only. It does not change the postgres password.
BEGIN;
DO $enroll$
BEGIN
  IF NOT EXISTS (SELECT FROM (${preflight}) checked WHERE restricted AND allowed AND private AND empty) THEN
    RAISE EXCEPTION 'Unexpected pilot state; no credential changed';
  END IF;
  ${activate}
END;
$enroll$;
COMMIT;
`);
      console.log('READY: private dashboard SQL generated. No Supabase credential has been changed.');
    } else {
      stage = 'dedicated role authentication';
      await admin.query(activate);
      await admin.end(); admin = null;
    }
  }
  if (mode !== '--prepare-dashboard') {
    stage = 'dedicated TLS readback';
    reader = new pg.Client(connectOptions(role, config.password, config.ca));
    reader.on('error', () => {});
    await reader.connect();
    const proof = (await reader.query(`SELECT current_user AS role,
      NOT has_table_privilege(current_user,'archive_history_ro.member_name','SELECT') AS private,
      NOT has_table_privilege(current_user,'archive_history_ro.booking','INSERT,UPDATE,DELETE') AS no_writes,
      archive_history_ro.mcp_member_month(repeat('a',64),DATE '2026-10-01')->>'state' AS history_state`)).rows[0];
    if (proof?.role !== role || !proof.private || !proof.no_writes || proof.history_state !== 'not_loaded')
      throw Error('Unexpected dedicated reader result');
    stage = 'publish private local config';
    await link(pending, file);
    await unlink(pending).catch(() => process.stderr.write('Credential published; private pending-link cleanup needed.\n'));
    console.log('PASS: dedicated TLS reader verified. No history uploaded. Tell Codex enrollment completed.');
  }
} catch (error) {
  const code = ['28P01', '42501', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(error?.code) ? ` (${error.code})` : '';
  process.stderr.write(`Enrollment stopped at: ${stage}${code}. No retry. Tell Codex the stage only, never the password.\n`);
  process.exitCode = 1;
} finally {
  rl?.close();
  await Promise.allSettled([admin?.end(), reader?.end()]);
}
