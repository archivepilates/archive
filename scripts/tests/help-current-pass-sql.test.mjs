import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import {createSupabaseCurrentPassLookup,createSupabasePassSessionIssuer,currentPassMemberKey} from '../../services/archive-help-member-access/current-pass-snapshot.mjs';

const pilotPackage = '/Users/archivepilates/archive-automation/operations/2026-11-20-supabase-history-pilot/package.json';
const require = createRequire(resolve(process.env.ARCHIVE_HELP_PGLITE_PACKAGE_JSON || pilotPackage));
const { PGlite } = require('@electric-sql/pglite');
const sql = await readFile(new URL('../../services/archivepilates-mcp/sql/help-current-pass.sql', import.meta.url), 'utf8');

const schema = 'archive_help_pass_snapshot';
const writer = 'archive_help_pass_writer';
const reader = 'archive_help_pass_reader';
const issuer = 'archive_help_pass_session_issuer';
const tables = ['snapshot_batch', 'member_projection', 'read_session'];
const functions = [
  ['publish_daily(timestamptz, text, jsonb)', writer],
  ['daily_status()', writer],
  ['issue_read_session(text, text, text, timestamptz)', issuer],
  ['revoke_read_session(text)', issuer],
  ['read_own(text)', reader],
];
const publicRoles = ['anon', 'authenticated', 'service_role', 'help_pass_test_unrelated'];
const digest = (byte) => byte.repeat(64);
const alice = digest('a');
const bob = digest('b');
const revision = digest('c');
const nextRevision = digest('d');
const source = digest('e');
const otherSource = digest('f');
const aliceSession = digest('1');
const bobSession = digest('2');
const absentSession = digest('3');
const mismatchSession = digest('4');
const countCard = {
  category: 'group', type: 'count', status: 'active', startsOn: '2026-11-01', expiresOn: '2026-12-01',
  remaining: 0, bookable: null,
};
const periodCard = {
  category: 'private', type: 'period', status: 'held', startsOn: '2026-02-28', expiresOn: '2026-12-20',
  remaining: null, bookable: null,
};
const member = (memberKey = alice, cards = [countCard], bindingRevision = revision) =>
  ({ memberKey, bindingRevision, cards });
const fixture = () => [member(), member(bob, [periodCard])];

let db;

before(async () => {
  db = await PGlite.create();
  for (const role of publicRoles) {
    if (!(await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rows.length) {
      await db.exec(`CREATE ROLE ${role} NOLOGIN`);
    }
  }
  await db.exec(sql);
});

test('managed non-superuser CREATEROLE bootstrap can install the private schema', async () => {
  const managed=await PGlite.create();
  try{
    await managed.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE help_pass_ddl CREATEROLE");
    await managed.exec("DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO help_pass_ddl', current_database()); END $$; SET ROLE help_pass_ddl");
    await managed.exec(sql);
    await managed.exec('RESET ROLE');
    const meta=await managed.query("select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname=$1",[schema]);
    assert.equal(meta.rows[0]?.owner,'archive_help_pass_owner');
  }finally{await managed.close();}
});

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`TRUNCATE ${tables.map((table) => `${schema}.${table}`).join(', ')}`);
});

async function asRole(role, callback) {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await callback();
  } finally {
    await db.exec('RESET ROLE');
  }
}

async function val(query, params) {
  return (await db.query(query, params)).rows[0]?.result;
}

function publish(members = fixture(), sourceDigest = source, observedAt = null) {
  const timestamp = observedAt === null ? 'clock_timestamp()' : '$3::timestamptz';
  const params = [sourceDigest, JSON.stringify(members)];
  if (observedAt !== null) params.push(observedAt);
  return asRole(writer, () => val(
    `SELECT ${schema}.publish_daily(${timestamp}, $1, $2::jsonb) AS result`, params,
  ));
}

function dailyStatus() {
  return asRole(writer, () => val(`SELECT ${schema}.daily_status() AS result`));
}

function issue(session, memberKey, bindingRevision = revision, expiresAt) {
  const timestamp = expiresAt === undefined ? "clock_timestamp() + interval '10 minutes'" : '$4::timestamptz';
  const params = [session, memberKey, bindingRevision];
  if (expiresAt !== undefined) params.push(expiresAt);
  return asRole(issuer, () => val(
    `SELECT ${schema}.issue_read_session($1, $2, $3, ${timestamp}) AS result`, params,
  ));
}

function revoke(session) {
  return asRole(issuer, () => val(`SELECT ${schema}.revoke_read_session($1) AS result`, [session]));
}

function read(session) {
  return asRole(reader, () => val(`SELECT ${schema}.read_own($1) AS result`, [session]));
}

test('only intended nonlogin roles have routine grants; PUBLIC and API roles have no privileges', async () => {
  assert.deepEqual((await db.query(
    'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[]) AND (rolcanlogin OR rolbypassrls OR rolsuper)',
    [[writer, reader, issuer, 'archive_help_pass_owner']],
  )).rows, []);

  for (const role of [...publicRoles, writer, reader, issuer]) {
    assert.equal(await val('SELECT has_schema_privilege($1, $2, \'USAGE\') AS result', [role, schema]),
      !publicRoles.includes(role), role);
    assert.equal(await val('SELECT has_schema_privilege($1, $2, \'CREATE\') AS result', [role, schema]), false, role);
    for (const table of tables) {
      assert.equal(await val(
        "SELECT has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS result",
        [role, `${schema}.${table}`],
      ), false, `${role}: ${table}`);
    }
    for (const [signature, grantee] of functions) {
      assert.equal(await val("SELECT has_function_privilege($1, $2, 'EXECUTE') AS result",
        [role, `${schema}.${signature}`]), role === grantee, `${role}: ${signature}`);
    }
  }

  for (const [signature] of functions) {
    assert.deepEqual((await db.query(`
      SELECT owner.rolname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_roles owner ON p.proowner = owner.oid WHERE p.oid = $1::regprocedure
    `, [`${schema}.${signature}`])).rows.map(({ rolname, prosecdef, proconfig }) => [
      rolname, prosecdef, proconfig.includes('search_path=pg_catalog, pg_temp'),
    ]), [['archive_help_pass_owner', true, true]], signature);
  }
});

test('anonymous and wrong-role calls fail; RLS also denies a temporarily granted direct read', async () => {
  await publish();
  await issue(aliceSession, alice);
  for (const role of publicRoles) {
    await assert.rejects(asRole(role, () => val(`SELECT ${schema}.read_own($1) AS result`, [aliceSession])),
      { code: '42501' });
  }
  for (const [role, call] of [
    [writer, `read_own('${aliceSession}')`],
    [reader, 'daily_status()'],
    [reader, "publish_daily(now(), NULL, '[]'::jsonb)"],
    [reader, `issue_read_session('${bobSession}', '${bob}', '${revision}', now())`],
    [writer, `revoke_read_session('${aliceSession}')`],
    [issuer, 'daily_status()'],
    [issuer, `read_own('${aliceSession}')`],
  ]) {
    await assert.rejects(asRole(role, () => db.query(`SELECT ${schema}.${call}`)), { code: '42501' });
  }
  for (const table of tables) {
    const qualified = `${schema}.${table}`;
    const count = () => val(`SELECT count(*)::integer AS result FROM ${qualified}`);
    await assert.rejects(asRole(reader, count), { code: '42501' });
    await db.exec(`GRANT SELECT ON ${qualified} TO ${reader}`);
    try {
      assert.ok(await count() > 0);
      assert.equal(await asRole(reader, count), 0, qualified);
    } finally {
      await db.exec(`REVOKE SELECT ON ${qualified} FROM ${reader}`);
    }
  }
});

test('writer publishes and reads only a KST-day manifest; duplicate day never replaces it', async () => {
  await db.exec("SET timezone = 'Pacific/Honolulu'");
  try {
    assert.equal(await dailyStatus(), null);
    assert.deepEqual(await publish(), { status: 'published', members: 2, cards: 2 });
    const status = await dailyStatus();
    assert.deepEqual(status, { observedAt: status.observedAt, sourceDigest: source, members: 2, cards: 2 });
    assert.equal(await val(`SELECT kst_day = (observed_at AT TIME ZONE 'Asia/Seoul')::date AS result
      FROM ${schema}.snapshot_batch`), true);
    assert.deepEqual(await publish([member(alice, [])], otherSource),
      { status: 'already_published', members: 2, cards: 2 });
    await assert.rejects(publish([member(alice, [{ ...countCard, remaining: -1 }])]), { code: '22023' });
    assert.deepEqual(await dailyStatus(), status);
    await issue(bobSession, bob);
    assert.deepEqual((await read(bobSession)).cards, [periodCard]);
  } finally {
    await db.exec('RESET timezone');
  }
});

test('reader accepts only a session digest and returns exactly its owner cards with session expiry', async () => {
  await publish();
  const observedAt = (await dailyStatus()).observedAt;
  const aliceExpiry = await val("SELECT date_trunc('milliseconds', clock_timestamp()) + interval '8 minutes' AS result");
  const bobExpiry = await val("SELECT date_trunc('milliseconds', clock_timestamp()) + interval '12 minutes' AS result");
  await issue(aliceSession, alice, revision, aliceExpiry);
  await issue(bobSession, bob, revision, bobExpiry);
  assert.deepEqual(await read(aliceSession), { observedAt, expiresAt: +aliceExpiry, cards: [countCard] });
  assert.deepEqual(await read(bobSession), { observedAt, expiresAt: +bobExpiry, cards: [periodCard] });
  await assert.rejects(asRole(reader, () => val(`SELECT ${schema}.read_own($1, $2) AS result`,
    [aliceSession, bob])), { code: '42883' });
  for (const value of [alice, bob, null, 'not-a-digest']) {
    assert.equal(await read(value), null);
  }
});

test('issuer cannot repoint or renew a digest and revocation survives subsequent issue', async () => {
  await publish();
  await issue(aliceSession, alice);
  const original = await read(aliceSession);
  assert.deepEqual(original.cards, [countCard]);
  await issue(aliceSession, bob);
  assert.deepEqual(await read(aliceSession), original);
  await revoke(aliceSession);
  assert.equal(await read(aliceSession), null);
  await issue(aliceSession, bob);
  await revoke(absentSession);
  assert.equal(await read(aliceSession), null);
  await issue(bobSession, bob);
  assert.deepEqual((await read(bobSession)).cards, [periodCard]);
});

test('expired, missing, mismatched, and stale (>26h) reads all return null', async () => {
  await publish();
  await issue(aliceSession, alice);
  await issue(bobSession, bob);
  await issue(absentSession, digest('9'));
  await issue(mismatchSession, alice, nextRevision);
  assert.notEqual(await read(aliceSession), null);
  assert.equal(await read(absentSession), null);
  assert.equal(await read(mismatchSession), null);
  await db.query(`UPDATE ${schema}.read_session SET expires_at = clock_timestamp() - interval '1 second'
    WHERE session_digest = $1`, [aliceSession]);
  assert.equal(await read(aliceSession), null);
  await issue(aliceSession, alice);
  assert.equal(await read(aliceSession), null);
  await db.exec(`UPDATE ${schema}.snapshot_batch SET observed_at = clock_timestamp() - interval '25 hours 59 minutes'`);
  assert.notEqual(await read(bobSession), null);
  await db.exec(`UPDATE ${schema}.snapshot_batch SET observed_at = clock_timestamp() - interval '26 hours 1 minute'`);
  assert.equal(await read(bobSession), null);
});

test('new KST day replaces the projection and invalidates dropped or revised bindings', async () => {
  await publish();
  await issue(aliceSession, alice);
  await issue(bobSession, bob);
  await db.exec(`UPDATE ${schema}.snapshot_batch SET kst_day = kst_day - 1`);
  assert.equal(await dailyStatus(), null);
  assert.deepEqual(await publish([member(alice, [], nextRevision)], otherSource),
    { status: 'published', members: 1, cards: 0 });
  assert.equal(await read(aliceSession), null);
  assert.equal(await read(bobSession), null);
  await issue(absentSession, alice, nextRevision);
  assert.deepEqual((await read(absentSession)).cards, []);
  assert.equal(await val(`SELECT count(*)::integer AS result FROM ${schema}.member_projection`), 1);
});

test('publish rejects stale, future, previous-KST-day, or malformed digests before changing the manifest', async () => {
  const clock = (offset) => val(`SELECT clock_timestamp() + interval '${offset}' AS result`);
  const lastKstDay = await val(`SELECT (
    date_trunc('day', clock_timestamp() AT TIME ZONE 'Asia/Seoul') - interval '1 millisecond'
  ) AT TIME ZONE 'Asia/Seoul' AS result`);
  for (const time of [await clock('-121 minutes'), await clock('5 minutes'), lastKstDay]) {
    await assert.rejects(publish(fixture(), source, time), { code: '22023' });
  }
  await assert.rejects(publish(fixture(), 'bad-digest'), { code: '22023' });
  assert.equal(await dailyStatus(), null);
});

test('publish rejects invalid members, extra fields, dates, and unsafe quantities', async () => {
  const { remaining: _remaining, ...missingQuantity } = countCard;
  const badCards = [
    null, [], missingQuantity, { ...countCard, memo: 'synthetic' },
    { ...countCard, category: 'other' }, { ...countCard, type: null }, { ...countCard, status: 'expired' },
    { ...countCard, startsOn: '2026-11-1' }, { ...countCard, expiresOn: '2026-02-30' },
    { ...countCard, expiresOn: '2026-10-30' }, { ...countCard, remaining: null },
    { ...countCard, remaining: -1 }, { ...countCard, remaining: 1.5 },
    { ...countCard, remaining: '0' }, { ...countCard, remaining: 100001 },
    { ...countCard, bookable: false }, { ...countCard, bookable: 2.9 },
    { ...periodCard, remaining: 0 }, { ...periodCard, bookable: 0 },
  ];
  const badPayloads = [
    null, {}, [], Array(5001).fill(member()), [null],
    [{ ...member(), name: 'synthetic' }], [member(alice.toUpperCase())],
    [member(alice, [], null)], [member(alice, {})], [member(alice, Array(101).fill(countCard))],
    [member(), member(alice, [], nextRevision)],
    ...badCards.map((card) => [member(alice, [card])]),
  ];
  for (const payload of badPayloads) {
    await assert.rejects(publish(payload), { code: '22023' });
  }
  assert.equal(await dailyStatus(), null);

  const futureCount = {
    ...countCard, category: 'duet', status: 'future', remaining: 100000, bookable: 0,
  };
  assert.deepEqual(await publish([member(alice, [futureCount])]), { status: 'published', members: 1, cards: 1 });
  await issue(aliceSession, alice);
  assert.deepEqual((await read(aliceSession)).cards, [futureCount]);
});

test('publish accepts exactly 5000 members and 100 cards on one member', async () => {
  const cards = Array(100).fill({ ...countCard, category: 'triple' });
  const members = Array.from({ length: 5000 }, (_, index) =>
    member(index.toString(16).padStart(64, '0'), index === 0 ? cards : []));
  assert.deepEqual(await publish(members), { status: 'published', members: 5000, cards: 100 });
  await issue(aliceSession, members[0].memberKey);
  assert.deepEqual((await read(aliceSession)).cards, cards);
});

test('issuer rejects malformed digests and out-of-window expiries', async () => {
  await publish();
  const past = await val("SELECT clock_timestamp() - interval '1 second' AS result");
  const tooFar = await val("SELECT clock_timestamp() + interval '20 minutes 30 seconds' AS result");
  for (const args of [
    [aliceSession, alice, revision, past], [aliceSession, alice, revision, tooFar],
    [aliceSession, alice, revision, null], [aliceSession.toUpperCase().slice(1), alice],
    [aliceSession, 'bad-member-key'], [aliceSession, alice, 'bad-revision'],
  ]) {
    await assert.rejects(issue(...args), { code: '22023' });
  }
  assert.equal(await read(aliceSession), null);
});

test('hosted lookup adapter and private SQL work end to end with no Mac reader', async () => {
  const secret=Buffer.alloc(32,42);
  const aliceToken='A'.repeat(43),bobToken='B'.repeat(43);
  const aliceMember='201',bobMember='202';
  await publish([member(currentPassMemberKey(secret,aliceMember),[countCard]),
    member(currentPassMemberKey(secret,bobMember),[periodCard])]);
  const cloud=role=>(query,args)=>asRole(role,()=>db.query(query,args));
  const mint=createSupabasePassSessionIssuer({query:cloud(issuer),secret});
  const lookup=createSupabaseCurrentPassLookup({query:cloud(reader)});
  const binding=memberId=>({memberId,studioId:'5330',revision,expiresAt:Date.now()+9*60_000});
  await mint.issue({token:aliceToken,binding:binding(aliceMember)});
  await mint.issue({token:bobToken,binding:binding(bobMember)});
  assert.deepEqual((await lookup(aliceToken,'cards')).cards,[countCard]);
  assert.deepEqual((await lookup(bobToken,'cards')).cards,[periodCard]);
  assert.equal(await lookup('C'.repeat(43),'cards'),null);
  assert.equal(await lookup(aliceToken,'history'),null);
  await mint.revoke(aliceToken);
  assert.equal(await lookup(aliceToken,'cards'),null);
  assert.deepEqual((await lookup(bobToken,'cards')).cards,[periodCard]);
});
