import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { digest } from '../../services/archive-help-member-access/accounts.mjs';
import { currentPassMemberKey } from '../../services/archive-help-member-access/current-pass-snapshot.mjs';
import { createCloudEnrollmentAuthority } from '../../services/archive-help-member-access/cloud-enrollment-authority.mjs';
import { sealEnrollmentPhone } from '../../services/archive-help-member-access/phone-box.mjs';
import { createPostgresEnrollmentLoaders } from '../../services/archive-help-member-access/postgres-enrollment-loader.mjs';

const pilot = '/Users/archivepilates/archive-automation/operations/2026-11-20-supabase-history-pilot/package.json';
const localRequire = createRequire(import.meta.url);
const fallbackRequire = createRequire(resolve(process.env.ARCHIVE_HELP_PGLITE_PACKAGE_JSON || pilot));
let PGlite;
try {
  ({ PGlite } = localRequire('@electric-sql/pglite'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'@electric-sql/pglite'")) throw error;
  ({ PGlite } = fallbackRequire('@electric-sql/pglite'));
}

const sqlDir = new URL('../../services/archivepilates-mcp/sql/', import.meta.url);
const sql = await readFile(new URL('help-member-enrollment-authority.sql', sqlDir), 'utf8');
const authSql = await readFile(new URL('help-member-auth-store.sql', sqlDir), 'utf8');
const snapshotSql = await readFile(new URL('help-current-pass.sql', sqlDir), 'utf8');
const schema = 'archive_help_enrollment';
const owner = schema + '_owner';
const writer = schema + '_writer';
const runtime = 'archive_help_member_auth_runtime';
const apiRoles = ['anon', 'authenticated', 'service_role'];
const deniedRoles = [...apiRoles, 'enrollment_unrelated', 'archive_history_mcp_reader',
  'archive_lesson_history_writer', 'archive_help_pass_owner', 'archive_help_pass_reader',
  'archive_help_pass_writer', 'archive_help_pass_session_issuer'];
const tables = ['current_binding', 'revision_tombstones', 'staff_approval'];
const grants = [
  ['read_enrollment(text)', runtime],
  ['read_binding(text,text)', runtime],
  ['publish_binding(text,text,text,timestamptz,text)', writer],
  ['revoke_binding(text,text,text)', writer],
  ['approve_enrollment(text,text,text,text,timestamptz)', writer],
  ['valid_identity(text,text,text)', null],
];
const studio = '5330', member = '79417', otherMember = '79418';
const revision = 'a'.repeat(64), nextRevision = 'b'.repeat(64), thirdRevision = 'c'.repeat(64);
const reference = 'd'.repeat(64), otherReference = 'e'.repeat(64);
const box = 'synthetic_AEAD_envelope-'.repeat(3).slice(0,52);
let db;

async function bootstrap(database) {
  for (const role of deniedRoles.filter((name) => !name.startsWith('archive_help_pass_'))) {
    if (!(await database.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rows.length) {
      await database.exec(`CREATE ROLE ${role} NOLOGIN`);
    }
  }
  await database.exec(authSql);
}

before(async () => {
  db = await PGlite.create();
  await bootstrap(db);
  await db.exec(snapshotSql);
  await db.exec(sql);
});
after(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`TRUNCATE ${tables.map((table) => `${schema}.${table}`).join(', ')}`);
});

async function asRole(role, callback) {
  await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL ROLE ${role}`);
  try {
    const value = await callback();
    await db.exec('COMMIT');
    return value;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function value(query, params) {
  return (await db.query(query, params)).rows[0]?.result;
}

const call = (role, routine, args) => asRole(role, () =>
  value(`SELECT ${schema}.${routine}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS result`, args));
const readBinding = (site = studio, id = member) => call(runtime, 'read_binding', [site, id]);
const readEnrollment = (digest = reference) => call(runtime, 'read_enrollment', [digest]);
const dbTime = (offset) => value(
  'SELECT (clock_timestamp() + $1::interval)::text AS result', [offset]);
async function publish({ studio: site = studio, member: id = member, revision: rev = revision,
  observed, box: phoneBox = box } = {}) {
  return call(writer, 'publish_binding',
    [site, id, rev, observed === undefined ? await dbTime('-2 seconds') : observed, phoneBox]);
}
const revoke = (rev = revision, id = member) => call(writer, 'revoke_binding', [studio, id, rev]);
const approve = async (digest = reference, rev = revision, id = member, expiry) =>
  call(writer, 'approve_enrollment', [digest, studio, id, rev, expiry ?? await dbTime('5 minutes')]);

test('cloud loader uses the actual private routines and denies the formerly approved binding after revoke', async () => {
  const key=randomBytes(32), memberKeySecret=randomBytes(32), operatorRef=randomBytes(32).toString('base64url');
  const phone='01000000018';
  assert.equal(await publish({box:sealEnrollmentPhone({phone,memberId:member,revision,key})}),true);
  assert.equal(await approve(digest(operatorRef)),true);
  const pool={connect:async()=>({query:(command,args)=>command.startsWith('SELECT ')?db.query(command,args):db.exec(command),
    release(){}})};
  const pilotMemberKey=Buffer.from(currentPassMemberKey(memberKeySecret,member),'hex');
  const loaders=createPostgresEnrollmentLoaders({pool,key,memberKeySecret,pilotMemberKey});
  const adapter=createCloudEnrollmentAuthority(loaders);
  const ready=await adapter.verifyEnrollment(operatorRef,{studioId:studio});
  assert.equal(ready.memberId,member);
  assert.ok(!Object.hasOwn(ready,'phone'));
  const selector={studioId:studio,memberId:member,revision};
  assert.equal((await adapter.resolveRecipient(selector)).phone,phone);
  assert.equal(await adapter.resolveRecipient({...selector,memberId:otherMember}),null);
  assert.equal(await revoke(),true);
  assert.equal(await adapter.verifyEnrollment(operatorRef,{studioId:studio}),null);
  assert.equal(await adapter.resolveRecipient(selector),null);
});

test('a managed CREATEROLE installer can install after the existing auth schema', async () => {
  const managed = await PGlite.create();
  try {
    await bootstrap(managed);
    await managed.exec(`CREATE ROLE enrollment_ddl CREATEROLE;
      DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO enrollment_ddl', current_database()); END $$;
      SET ROLE enrollment_ddl`);
    await managed.exec(sql);
    const result = await managed.query('SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = $1', [schema]);
    assert.equal(result.rows[0].owner, owner);
  } finally {
    await managed.close();
  }
});

test('only the exact NOLOGIN roles have access; tables use owner-only forced RLS', async () => {
  const metadata = await db.query(`
    SELECT rolname, rolcanlogin, rolbypassrls, rolsuper, rolcreaterole, rolcreatedb
    FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`, [[owner, writer, runtime]]);
  assert.deepEqual(metadata.rows.map(({ rolname, ...flags }) => [rolname, Object.values(flags)]),
    [owner, writer, runtime].map((role) => [role, [false, false, false, false, false]]));
  const policies = await db.query(`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner,
      p.polroles = ARRAY[c.relowner] AS owner_policy
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_policy p ON p.polrelid = c.oid WHERE n.nspname = $1 ORDER BY c.relname`, [schema]);
  assert.deepEqual(policies.rows, tables.map((relname) => ({
    relname, relrowsecurity: true, relforcerowsecurity: true, owner, owner_policy: true,
  })));
  const routines = await db.query(`
    SELECT p.oid::regprocedure::text AS signature, p.prosecdef, p.proleakproof, p.proconfig,
      pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1`, [schema]);
  assert.equal(routines.rows.length, grants.length);
  for (const [signature, grantee] of grants) {
    const row = routines.rows.find((entry) => entry.signature === `${schema}.${signature.replace('timestamptz', 'timestamp with time zone')}`);
    assert.equal(row?.owner, owner);
    assert.equal(row.prosecdef, Boolean(grantee));
    assert.equal(row.proleakproof, false);
    assert.ok(row.proconfig.includes('search_path=pg_catalog, pg_temp'));
  }
  const publicAcl = await db.query(`
    SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
    WHERE p.pronamespace = $1::regnamespace AND acl.grantee = 0`, [schema]);
  assert.deepEqual(publicAcl.rows, []);
  for (const role of [runtime, writer, ...deniedRoles]) {
    assert.equal(await value("SELECT has_schema_privilege($1, $2, 'USAGE') AS result", [role, schema]),
      [runtime, writer].includes(role), role);
    assert.equal(await value("SELECT has_schema_privilege($1, $2, 'CREATE') AS result", [role, schema]), false, role);
    for (const table of tables) {
      assert.equal(await value("SELECT has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS result",
        [role, `${schema}.${table}`]), false, role);
    }
    for (const [routine, grantee] of grants) {
      assert.equal(await value("SELECT has_function_privilege($1, $2, 'EXECUTE') AS result",
        [role, `${schema}.${routine}`]), role === grantee, `${role}: ${routine}`);
    }
  }
  await assert.rejects(asRole(runtime, () => db.exec(`SELECT * FROM ${schema}.current_binding`)), { code: '42501' });
  await assert.rejects(call(runtime, 'revoke_binding', [studio, member, revision]), { code: '42501' });
  await assert.rejects(call(writer, 'read_binding', [studio, member]), { code: '42501' });
  assert.equal(await value("SELECT has_function_privilege($1, 'archive_help_member_auth.read_record(text,text,bigint)', 'EXECUTE') AS result",
    [runtime]), true);
  for (const role of [runtime, writer]) {
    assert.equal(await value("SELECT has_schema_privilege($1, 'archive_help_pass_snapshot', 'USAGE') AS result", [role]), false);
  }
  assert.equal(await value("SELECT has_schema_privilege($1, 'archive_help_member_auth', 'USAGE') AS result", [writer]), false);
  for (const role of apiRoles) {
    await assert.rejects(call(role, 'read_enrollment', [reference]), { code: '42501' });
  }
});

test('read routines return only the exact binding and approved reference JSON contract', async () => {
  const observed = await dbTime('-2 seconds');
  const expires = await dbTime('10 minutes');
  assert.equal(await publish({ observed }), true);
  assert.equal(await publish({ member: otherMember, revision: nextRevision }), true);
  assert.equal(await approve(reference, revision, member, expires), true);
  assert.deepEqual(await readBinding(), {
    authority: 'verified_studiomate_in_person_signup', signupComplete: true, active: true, revoked: false,
    registeredContactVerified: true, studioId: studio, memberId: member, revision,
    sourceObservedAt: Date.parse(observed), phoneBox: box,
  });
  assert.deepEqual(await readEnrollment(), {
    authority: 'approved_help_enrollment', approved: true, studioId: studio, memberId: member, revision,
    expiresAt: Date.parse(expires),
  });
  for (const [site, id] of [['5331', member], [studio, '0' + member], [studio, member + '\n'], [studio, '79419'], [null, member]]) {
    assert.equal(await readBinding(site, id), null);
  }
  for (const digest of [otherReference, reference.toUpperCase(), reference + '\n', null]) {
    assert.equal(await readEnrollment(digest), null);
  }
  assert.equal(await approve(otherReference, revision, otherMember), false);
  assert.equal(await approve(reference, nextRevision, otherMember), false);
});

test('writer rejects invalid identities, non-finite times, and malformed or plaintext contact', async () => {
  for (const options of [
    { studio: '5331' }, { member: '0' + member }, { member: '1'.repeat(17) }, { member: member + '\n' },
    { revision: null }, { revision: revision.toUpperCase() }, { revision: revision + ' ' },
    { observed: null }, { observed: 'infinity' }, { box: null }, { box: '01000000000' },
    { box: 'x'.repeat(51) }, { box: 'x'.repeat(53) }, { box: box + '=' }, { box: box + '\n' },
  ]) {
    await assert.rejects(publish(options), { code: '22023' });
  }
  assert.equal(await publish({ observed: await dbTime('1 hour') }), false);
  assert.equal(await publish({ observed: await dbTime('-27 hours') }), false);
  assert.equal(await readBinding(), null);
  await assert.rejects(revoke('invalid'), { code: '22023' });
  await assert.rejects(approve('invalid'), { code: '22023' });
  for (const expiry of [await dbTime('-1 second'), await dbTime('11 minutes'), 'infinity']) {
    await assert.rejects(approve(reference, revision, member, expiry), { code: '22023' });
  }
});

test('binding rotation rejects stale input and permanently invalidates prior approvals and revisions', async () => {
  const first = await dbTime('-4 seconds');
  const second = await dbTime('-3 seconds');
  const third = await dbTime('-2 seconds');
  assert.equal(await publish({ observed: first }), true);
  assert.equal(await publish({ observed: first }), true);
  assert.equal(await publish({ observed: second, box: 'x' + box.slice(1) }), false);
  assert.equal(await publish({ observed: second }), true);
  assert.equal(await publish({ observed: first }), false);
  assert.equal(await publish({ revision: nextRevision, observed: second }), false);
  assert.equal(await approve(), true);
  assert.equal(await publish({ revision: nextRevision, observed: third }), true);
  assert.equal(await readEnrollment(), null);
  assert.equal(await approve(otherReference), false);
  assert.equal(await revoke(), false);
  assert.equal((await readBinding()).revision, nextRevision);
  assert.equal(await publish({ observed: await dbTime('-1 second') }), false);
  assert.equal(await approve(otherReference, nextRevision), true);
  assert.equal((await readEnrollment(otherReference)).revision, nextRevision);
});

test('canonical revoke wipes the box, blocks replay, and requires a post-revoke observation for a new revision', async () => {
  const beforeRevoke = await dbTime('-1 second');
  assert.equal(await publish(), true);
  assert.equal(await approve(), true);
  assert.equal(await revoke(), true);
  assert.equal(await revoke(), false);
  assert.equal(await readBinding(), null);
  assert.equal(await readEnrollment(), null);
  assert.equal(await value(`SELECT phone_box AS result FROM ${schema}.current_binding`), null);
  assert.equal(await publish({ revision: nextRevision, observed: beforeRevoke }), false);
  const afterRevoke = await dbTime('0 seconds');
  assert.equal(await publish({ observed: afterRevoke }), false);
  assert.equal(await publish({ revision: nextRevision, observed: afterRevoke }), true);
  assert.equal(await readEnrollment(), null);
  assert.equal(await revoke(thirdRevision), false);
  assert.equal(await publish({ revision: thirdRevision, observed: await dbTime('0 seconds') }), false);
  assert.equal((await readBinding()).revision, nextRevision);
});

test('revocation before first publication prevents delayed publication', async () => {
  assert.equal(await revoke(), true);
  assert.equal(await readBinding(), null);
  assert.equal(await publish({ observed: await dbTime('0 seconds') }), false);
  assert.equal(await publish({ revision: nextRevision }), false);
  assert.equal(await approve(), false);
});

test('the writer can commit or roll back an exact binding and approval together', async () => {
  const observed = await dbTime('-2 seconds');
  const expires = await dbTime('5 minutes');
  const apply = async () => {
    assert.equal(await value(`SELECT ${schema}.publish_binding($1,$2,$3,$4,$5) AS result`,
      [studio, member, revision, observed, box]), true);
    assert.equal(await value(`SELECT ${schema}.approve_enrollment($1,$2,$3,$4,$5) AS result`,
      [reference, studio, member, revision, expires]), true);
  };
  const rollback = Error('intentional rollback');
  await assert.rejects(asRole(writer, async () => {
    await apply();
    throw rollback;
  }), (error) => error === rollback);
  assert.equal(await readBinding(), null);
  assert.equal(await readEnrollment(), null);
  await asRole(writer, apply);
  assert.equal((await readBinding()).revision, revision);
  assert.equal((await readEnrollment()).revision, revision);
});

test('expired approvals and stale observations fail closed without allowing digest reuse', async () => {
  assert.equal(await publish(), true);
  assert.equal(await approve(), true);
  assert.equal(await approve(), false);
  await asRole(owner, () => db.exec(`UPDATE ${schema}.staff_approval
    SET approved_at = clock_timestamp() - interval '2 minutes', expires_at = clock_timestamp() - interval '1 minute'`));
  assert.equal(await readEnrollment(), null);
  assert.equal(await approve(), false);
  assert.equal(await approve(otherReference), true);
  await asRole(owner, () => db.exec(`UPDATE ${schema}.current_binding
    SET source_observed_at = clock_timestamp() - interval '27 hours'`));
  assert.equal(await readBinding(), null);
  assert.equal(await readEnrollment(otherReference), null);
  assert.equal(await approve('f'.repeat(64)), false);
});
