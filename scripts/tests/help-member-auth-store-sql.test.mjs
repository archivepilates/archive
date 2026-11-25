import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createPostgresAuthStore } from '../../services/archive-help-member-access/postgres-auth-store.mjs';

const require = createRequire(import.meta.url);
const pilot = '/Users/archivepilates/archive-automation/operations/2026-11-20-supabase-history-pilot/package.json';
function findPGlite() {
  for (const loader of [require, createRequire(resolve(process.env.ARCHIVE_HELP_PGLITE_PACKAGE_JSON || pilot))]) {
    try {
      return loader('@electric-sql/pglite').PGlite;
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'@electric-sql/pglite'")) throw error;
    }
  }
}
const PGlite = findPGlite();
const sqlTest = (name, run) => test(name, { skip: !PGlite && 'Local PGlite is not installed' }, run);
const sqlUrl = new URL('../../services/archivepilates-mcp/sql/', import.meta.url);
const sql = await readFile(new URL('help-member-auth-store.sql', sqlUrl), 'utf8');
const schema = 'archive_help_member_auth';
const owner = schema + '_owner';
const runtime = schema + '_runtime';
const key = 'a'.repeat(64), other = 'b'.repeat(64);
const functions = [
  'read_record(text,text,bigint)', 'put_record(text,text,text,bigint)',
  'remove_record(text,text)', 'prune_records(bigint)',
];

function stub(handle = () => {}) {
  const steps = [];
  const store = createPostgresAuthStore({
    pool: {
      async connect() {
        steps.push(['connect']);
        return {
          async query(command, args) {
            steps.push([command, args]);
            return await handle(command, args) ?? { command: command.split(' ')[0], rows: [{ value: null }] };
          },
          release(discard) { steps.push(['release', discard]); },
        };
      },
    },
  });
  return { store, steps };
}

test('checkout scopes role, timeouts, and the transaction lock before any bound values', async () => {
  const { store, steps } = stub();
  let escaped;
  assert.equal(await store.transaction(async (tx) => {
    escaped = tx;
    await tx.put('session', key, { ok: true }, 42);
    return tx.read('session', key, 41);
  }), null);
  assert.deepEqual(steps.map(([command]) => command), [
    'connect', 'BEGIN ISOLATION LEVEL READ COMMITTED',
    "SET LOCAL statement_timeout = '3s'", "SET LOCAL lock_timeout = '750ms'",
    "SET LOCAL idle_in_transaction_session_timeout = '5s'", 'SET LOCAL search_path = pg_catalog, pg_temp',
    `SET LOCAL ROLE ${runtime}`,
    'SELECT pg_catalog.pg_advisory_xact_lock(1095910216, 1212501072)',
    `SELECT ${schema}.put_record($1::text, $2::text, $3::text, $4::bigint)`,
    `SELECT ${schema}.read_record($1::text, $2::text, $3::bigint) AS value`,
    'COMMIT', 'release',
  ]);
  assert.deepEqual(steps[8][1], ['session', key, '{"ok":true}', 42]);
  assert.deepEqual(steps.at(-1), ['release', false]);
  await assert.rejects(escaped.remove('session', key), { code: 'AUTH_STORE_UNAVAILABLE' });
  assert.equal(await store.read('session', key + '\n', 41), null);
  assert.equal(steps.length, 12);
});

test('lock or callback failure rolls back once; failed rollback discards the checkout', async () => {
  const lock = stub((command) => {
    if (command.includes('pg_advisory_xact_lock')) throw Error('sensitive provider error');
  });
  await assert.rejects(lock.store.transaction(() => assert.fail('callback ran without lock')), {
    code: 'AUTH_STORE_UNAVAILABLE', message: 'Auth store unavailable',
  });
  assert.deepEqual(lock.steps.slice(-2), [['ROLLBACK', undefined], ['release', false]]);

  const broken = stub((command) => {
    if (command === 'ROLLBACK') throw Error('connection lost');
  });
  const domain = new Error('callback aborted');
  await assert.rejects(broken.store.transaction(async () => { throw domain; }), (error) => error === domain);
  assert.deepEqual(broken.steps.slice(-2), [['ROLLBACK', undefined], ['release', true]]);
});

test('caught database and validation failures cannot commit earlier or later operations', async () => {
  for (const invalid of [false, true]) {
    const mock = stub((command) => {
      if (!invalid && command.includes('remove_record')) throw Error('sensitive auth value');
    });
    await assert.rejects(mock.store.transaction(async (tx) => {
      await tx.put('session', key, null);
      if (invalid) await assert.rejects(tx.prune(-1), TypeError);
      else await assert.rejects(tx.remove('session', key), { message: 'Auth store unavailable' });
      await assert.rejects(tx.put('session', other, null), { code: 'AUTH_STORE_UNAVAILABLE' });
    }), { code: 'AUTH_STORE_UNAVAILABLE' });
    assert.equal(mock.steps.filter(([command]) => command.includes('put_record')).length, 1);
    assert.deepEqual(mock.steps.slice(-2), [['ROLLBACK', undefined], ['release', false]]);
  }
});

test('an outstanding operation cannot outlive a committed callback', async () => {
  let complete;
  const mock = stub((command) => {
    if (command.includes('put_record')) return new Promise((resolve) => { complete = resolve; });
    if (command === 'ROLLBACK') complete();
  });
  await assert.rejects(mock.store.transaction(async (tx) => {
    void tx.put('session', key, null);
  }), { code: 'AUTH_STORE_UNAVAILABLE' });
  assert.deepEqual(mock.steps.slice(-2), [['ROLLBACK', undefined], ['release', false]]);
});

test('uncertain COMMIT discards the connection, with no replay or schema creation', async () => {
  for (const response of [null, { command: 'ROLLBACK' }]) {
    const mock = stub((command) => {
      if (command !== 'COMMIT') return;
      if (!response) throw Error('lost commit acknowledgement');
      return response;
    });
    await assert.rejects(mock.store.transaction((tx) => tx.put('session', key, {})), {
      code: 'AUTH_STORE_COMMIT_UNKNOWN',
    });
    assert.equal(mock.steps.filter(([command]) => command === 'connect' || command.includes('put_record')).length, 2);
    assert.equal(mock.steps.some(([command]) => /CREATE/i.test(command)), false);
    assert.deepEqual(mock.steps.slice(-3), [['COMMIT', undefined], ['ROLLBACK', undefined], ['release', true]]);
  }
});

test('failed checkout or missing database objects fail closed without recovery writes', async () => {
  const noPool = createPostgresAuthStore({ pool: { async connect() { throw Error('private connection details'); } } });
  await assert.rejects(noPool.read('session', key, 0), { message: 'Auth store unavailable' });
  const absent = stub((command) => {
    if (command.includes('read_record')) throw Error('schema does not exist');
  });
  await assert.rejects(absent.store.read('session', key, 0), { message: 'Auth store unavailable' });
  assert.equal(absent.steps.filter(([command]) => command === 'connect' || command.includes('read_record')).length, 2);
  assert.equal(absent.steps.some(([command]) => /^(CREATE|COMMIT)\b|put_record/i.test(command)), false);
  assert.deepEqual(absent.steps.slice(-2), [['ROLLBACK', undefined], ['release', false]]);
});

async function withDatabase(run) {
  const db = await PGlite.create();
  try {
    await run(db);
  } finally {
    await db.close();
  }
}

sqlTest('managed non-superuser installs the private store without changing existing pass roles', () => withDatabase(async (db) => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE ROLE authenticator; CREATE ROLE help_auth_ddl CREATEROLE; CREATE ROLE help_auth_unrelated`);
  await db.exec(await readFile(new URL('help-current-pass.sql', sqlUrl), 'utf8'));
  const prior = () => db.query(`
    SELECT rolname, rolinherit, rolcanlogin, rolbypassrls,
      has_schema_privilege(rolname, 'archive_help_pass_snapshot', 'USAGE') AS pass_usage
    FROM pg_roles WHERE rolname LIKE 'archive_help_pass_%' ORDER BY rolname
  `);
  const before = await prior();
  await db.exec(`DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO help_auth_ddl', current_database()); END $$;
    SET ROLE help_auth_ddl`);
  await db.exec(sql);
  assert.equal((await db.query('SELECT current_user')).rows[0].current_user, 'help_auth_ddl');
  await db.exec('RESET ROLE');
  assert.deepEqual((await prior()).rows, before.rows);

  const acl = await db.query(`
    SELECT rolname, rolcanlogin, rolinherit, rolbypassrls, rolsuper,
      (SELECT rolpassword IS NULL FROM pg_authid WHERE oid = r.oid) AS no_password,
      has_schema_privilege(rolname, $1, 'USAGE') AS usage,
      has_schema_privilege(rolname, $1, 'CREATE') AS create_schema_objects,
      has_table_privilege(rolname, $1 || '.records', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') AS table_access
    FROM pg_roles r WHERE rolname = ANY($2::text[]) ORDER BY rolname
  `, [schema, [owner, runtime]]);
  assert.deepEqual(acl.rows, [true, false].map((isOwner) => ({
    rolname: isOwner ? owner : runtime,
    rolcanlogin: false, rolinherit: false, rolbypassrls: false, rolsuper: false, no_password: true,
    usage: true, create_schema_objects: isOwner, table_access: isOwner,
  })));
  assert.deepEqual((await db.query(`
    SELECT member.rolname AS member, m.inherit_option, m.set_option
    FROM pg_auth_members m JOIN pg_roles role ON role.oid = m.roleid
    JOIN pg_roles member ON member.oid = m.member WHERE role.rolname = $1
  `, [runtime])).rows, [{ member: 'help_auth_ddl', inherit_option: false, set_option: false }]);
  assert.deepEqual((await db.query(`
    SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c WHERE c.oid = $1::regclass
  `, [schema + '.records'])).rows, [{ relrowsecurity: true, relforcerowsecurity: true, owner }]);
  const signatures = [...functions, 'valid_key(text,text)'];
  const procIds = new Map();
  for (const fn of signatures) {
    const { rows: [meta] } = await db.query(`
      SELECT oid::text, prosecdef, proconfig, pg_get_userbyid(proowner) AS owner
      FROM pg_proc WHERE oid = $1::regprocedure
    `, [schema + '.' + fn]);
    assert.equal(meta.owner, owner);
    assert.equal(meta.prosecdef, functions.includes(fn));
    assert.ok(meta.proconfig.includes('search_path=pg_catalog, pg_temp'));
    procIds.set(fn, meta.oid);
  }

  for (const role of [
    'anon', 'authenticated', 'service_role', 'authenticator', 'help_auth_unrelated',
    'archive_help_pass_reader', 'archive_help_pass_writer', 'archive_help_pass_session_issuer', runtime,
  ]) {
    const allowed = role === runtime;
    await db.exec(`SET ROLE ${role}`);
    try {
      const acl = await db.query(`
        SELECT has_schema_privilege(current_user, $1, 'USAGE') AS usage,
          has_function_privilege(current_user, $2::oid, 'EXECUTE') AS helper
      `, [schema, procIds.get('valid_key(text,text)')]);
      assert.deepEqual(acl.rows, [{ usage: allowed, helper: false }], role);
      for (const fn of functions) {
        assert.equal((await db.query('SELECT has_function_privilege(current_user, $1::oid, \'EXECUTE\') AS ok',
          [procIds.get(fn)])).rows[0].ok, allowed, `${role}: ${fn}`);
      }
      await assert.rejects(db.query(`SELECT value FROM ${schema}.records`), { code: '42501' });
      if (!allowed) await assert.rejects(db.query(`SELECT ${schema}.read_record('session', $1, 0)`, [key]), { code: '42501' });
    } finally {
      await db.exec('RESET ROLE');
    }
  }
}));

sqlTest('PGlite round trip preserves exact expiry, put, read, remove, prune, and transaction rollback', () => withDatabase(async (db) => {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role');
  await db.exec(sql);
  const releases = [];
  const store = createPostgresAuthStore({ pool: { async connect() {
    return {
      async query(command, args) {
        if (command.startsWith('SELECT')) return db.query(command, args);
        await db.exec(command);
        return { command: command.split(' ')[0] };
      },
      release: (discard) => releases.push(discard),
    };
  } } });
  const lockCount = async () => (await db.query(`
    SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'
      AND classid = '1095910216'::oid AND objid = '1212501072'::oid
  `)).rows[0].n;
  await store.transaction(async (tx) => {
    assert.equal((await db.query('SELECT current_user')).rows[0].current_user, runtime);
    assert.equal(await lockCount(), 1);
    await tx.put('otp', key, { state: 'synthetic' }, 200);
    await tx.put('session', key, { count: 1 });
    await tx.put('credential', key, 'x'.repeat(11998));
    assert.deepEqual(await tx.read('otp', key, 199), { state: 'synthetic' });
    assert.equal(await tx.read('otp', key, 200), null);
  });
  assert.equal(await lockCount(), 0);
  assert.deepEqual(await store.read('session', key, 300), { count: 1 });
  assert.equal((await store.read('credential', key, 300)).length, 11998);
  await assert.rejects(store.transaction(async (tx) => {
    await tx.put('session', key, { count: 2 });
    await tx.put('session', other, { count: 3 });
    throw Error('abort synthetic writes');
  }), /abort synthetic writes/);
  assert.equal(await lockCount(), 0);
  assert.equal(await store.read('session', other, 300), null);
  assert.deepEqual(await store.read('session', key, 300), { count: 1 });
  await store.transaction(async (tx) => {
    await tx.put('session', key, { count: 2 }, 201);
    await tx.prune(200);
    assert.equal(await tx.read('otp', key, 199), null);
    assert.deepEqual(await tx.read('session', key, 200), { count: 2 });
    await tx.remove('session', key.toUpperCase());
    await tx.remove('session', key);
  });
  assert.equal(await store.read('session', key, 200), null);
  assert.deepEqual([...new Set(releases)], [false]);
}));

sqlTest('direct RPCs enforce input limits and forced RLS denies even an accidental table grant', () => withDatabase(async (db) => {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role');
  await db.exec(sql);
  await db.exec(`GRANT SELECT, DELETE ON ${schema}.records TO ${runtime}; SET ROLE ${runtime}`);
  const put = (kind, hash, value, expiry) =>
    db.query(`SELECT ${schema}.put_record($1, $2, $3, $4)`, [kind, hash, value, expiry]);
  for (const args of [
    ['other', key, '{}', null], [null, key, '{}', null],
    ['session', null, '{}', null], ['session', key + '\n', '{}', null],
    ['session', key.toUpperCase(), '{}', null], ['session', key, null, null],
    ['session', key, '{', null], ['session', key, JSON.stringify('\uac00'.repeat(4000)), null],
    ['session', key, '{}', 0], ['session', key, '{}', '9007199254740992'],
  ]) await assert.rejects(put(...args), { code: '22023' });
  const kinds = [
    'binding', 'member-index', 'invite', 'invite-index', 'challenge', 'flow', 'credential',
    'credential-index', 'session', 'budget', 'otp', 'otp-budget', 'otp-receipt',
  ];
  for (const kind of kinds) await put(kind, key, '{}', null);
  for (const now of [null, -1, '9007199254740992']) {
    await assert.rejects(db.query(`SELECT ${schema}.prune_records($1)`, [now]), { code: '22023' });
    assert.deepEqual((await db.query(`SELECT ${schema}.read_record('session', $1, $2) AS value`,
      [key, now])).rows, [{ value: null }]);
  }
  assert.deepEqual((await db.query(`DELETE FROM ${schema}.records RETURNING value`)).rows, []);
  assert.deepEqual((await db.query(`SELECT value FROM ${schema}.records`)).rows, []);
  assert.deepEqual((await db.query(`SELECT ${schema}.read_record('session', $1, 0) AS value`, [key])).rows,
    [{ value: '{}' }]);
  await db.exec('RESET ROLE');
  await assert.rejects(db.exec(sql), { code: '42710' });
  await db.exec('ROLLBACK');
  assert.deepEqual((await db.query(`SELECT count(*)::int AS n FROM ${schema}.records`)).rows, [{ n: kinds.length }]);
}));
