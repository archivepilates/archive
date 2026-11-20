import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

if (process.argv.length !== 3) throw Error('Usage: node scripts/verify-history-sql.mjs /path/to/local-history-pilot');
const pilot = resolve(process.argv[2]);
const { PGlite } = createRequire(join(pilot, 'package.json'))('@electric-sql/pglite');
const db = new PGlite();
const run = async (text, params) => (await db.query(text, params)).rows[0].result;
const one = 'a'.repeat(64), two = 'b'.repeat(64), missing = 'c'.repeat(64);
const day = '2025-10-01';
const lookup = (key, month = day) => run('SELECT archive_history_ro.mcp_member_month($1,$2) AS result', [key, month]);

try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.no_history_access(id int);');
  await db.exec(await readFile(join(pilot, 'history-mirror.sql'), 'utf8'));
  await db.exec(await readFile(join(pilot, 'history-names.sql'), 'utf8'));
  const migration = await readFile(new URL('../sql/history-read-only.sql', import.meta.url), 'utf8');
  await db.exec('GRANT SELECT ON public.no_history_access TO PUBLIC;');
  await assert.rejects(db.exec(migration), /Unexpected inherited privileges/);
  await db.exec('ROLLBACK; REVOKE SELECT ON public.no_history_access FROM PUBLIC;');
  await db.exec(migration);
  assert.equal(await run("SELECT rolcanlogin AS result FROM pg_roles WHERE rolname='archive_history_mcp_reader'"), false);
  assert.equal((await lookup(one)).state, 'not_loaded');
  await assert.rejects(lookup(one, '2025-10-11'), /Invalid history query/);
  await assert.rejects(lookup('unvalidated'), /Invalid history query/);
  await db.exec(`INSERT INTO archive_history_ro.month_load(month,observed_at,loaded_at,digest,source_receipt)
    VALUES ('2025-10-01','2025-11-01','2025-11-02',repeat('d',64),repeat('e',64));
    INSERT INTO archive_history_ro.member_name VALUES ('2025-10-01',repeat('a',64),'Synthetic Member'),('2025-10-01',repeat('b',64),'Synthetic Member');
    INSERT INTO archive_history_ro.booking VALUES ('2025-10-01',repeat('1',64),repeat('a',64),NULL,'2025-10-04','group','attendance'),
      ('2025-10-01',repeat('2',64),repeat('b',64),NULL,'2025-10-05','private','cancel');
    INSERT INTO archive_history_ro.issued_pass VALUES ('2025-10-01',repeat('3',64),repeat('a',64));
    INSERT INTO archive_history_ro.purchase_event VALUES ('2025-10-01',repeat('4',64),repeat('a',64),repeat('3',64),'2025-10-03','refund');`);
  await db.exec('SET ROLE archive_history_mcp_reader;');
  assert.deepEqual((await lookup(one)).purchaseEvents, [{ day: '2025-10-03', kind: 'refund' }]);
  assert.deepEqual((await lookup(one)).attendance, [{ day: '2025-10-04', status: 'attendance', type: 'group' }]);
  assert.deepEqual((await lookup(two)).attendance, [{ day: '2025-10-05', status: 'cancel', type: 'private' }]);
  assert.equal((await lookup(missing)).state, 'no_member_rows');
  await assert.rejects(db.exec('SELECT * FROM archive_history_ro.member_name;'), /permission denied/);
  await assert.rejects(db.exec('DELETE FROM archive_history_ro.booking;'), /permission denied/);
  await assert.rejects(db.exec("SELECT archive_history_ro.publish_named_month(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);"), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE authenticated;');
  await assert.rejects(lookup(one), /permission denied/);
  console.log('PASS: inherited grant rollback, NOLOGIN, isolation, one member/month, correct source states.');
} finally { await db.close(); }
