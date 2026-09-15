import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ReferralLedger } from '../lib/imweb-referral-ledger.mjs';
import { REFERRAL_POLICY, referralKey } from '../lib/imweb-referral-policy.mjs';

const moduleUrl = new URL('../lib/imweb-referral-ledger.mjs', import.meta.url).href;
const policy = { ...REFERRAL_POLICY, enabled: true, startsAt: '2026-09-15T00:00:00+09:00' };
const now = '2026-09-15T06:00:00Z';
const inviter = { siteCode: 'private-site', unitCode: 'private-unit', memberCode: 'private-inviter-code',
  uid: 'inviter@example.test', email: 'inviter@example.test', joinTime: '2026-08-01T00:00:00Z', recommendCode: 'private-invite' };
const input = (id = 1) => ({ inviter, now, policy, sourceVerified: true,
  member: { ...inviter, memberCode: `private-new-code-${id}`, uid: `new${id}@example.test`,
    email: `new${id}@example.test`, name: 'PRIVATE TEST NAME', phone: '01000009999',
    joinTime: '2026-09-15T05:00:00Z', recommendTargetCode: inviter.recommendCode } });
const proof = row => ({ sourceVerified: true, member: inviter, amountWon: 3000,
  reason: row.providerReason, logId: `private-log-${row.rewardKey}` });
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'imweb-referral-ledger-'));
  const filename = join(directory, 'rewards.sqlite');
  const ledgers = [];
  const open = () => { const ledger = new ReferralLedger(filename); ledgers.push(ledger); return ledger; };
  t.after(() => { ledgers.forEach(ledger => ledger.close()); rmSync(directory, { recursive: true, force: true }); });
  return { directory, filename, open, ledger: open() };
}

test('disabled or unverified reserve creates no database and cannot accept caller budget overrides', t => {
  const { ledger, directory } = fixture(t);
  assert.equal(ledger.reserve({ ...input(), policy: REFERRAL_POLICY }).reason, 'not_active');
  for (const sourceVerified of [false, 'true', 1]) {
    assert.equal(ledger.reserve({ ...input(), sourceVerified }).reason, 'source_unverified');
  }
  assert.equal(ledger.get(referralKey(input().member)), null);
  assert.deepEqual(ledger.unresolvedRecords(), []);
  assert.deepEqual(readdirSync(directory), []);
  for (let id = 0; id < 10; id++) ledger.reserve(input(id));
  assert.equal(ledger.reserve({ ...input(11), monthlyReservedWon: 0, existingReward: null }).reason, 'monthly_limit');
});

test('reload persists hashed canonical identity, ignores UID/version changes, and parameterizes SQL', t => {
  const { ledger, filename, open } = fixture(t);
  const row = ledger.reserve(input()).record;
  assert.equal(row.status, 'pending');
  assert.equal(row.inviterKey, referralKey(inviter));
  assert.equal(row.rewardKey, referralKey(input().member));
  ledger.close();
  const reopened = open();
  assert.deepEqual(reopened.get(row.rewardKey), row);
  const duplicate = reopened.reserve({ ...input(), policy: { ...policy, version: "next'policy" },
    member: { ...input().member, uid: 'renamed@example.test' } });
  assert.equal(duplicate.reason, 'already_recorded');
  assert.deepEqual(duplicate.record, row);
  assert.equal(reopened.get("' OR 1=1 --"), null);
  const sqlInput = input("quote' OR 1=1 --");
  assert.equal(reopened.reserve(sqlInput).eligible, true);
  reopened.close();
  assert.equal(statSync(filename).mode & 0o777, 0o600);
  const bytes = readFileSync(filename).toString('utf8');
  for (const raw of ['private-site', 'private-unit', 'private-inviter-code', 'private-new-code',
    '@example.test', 'PRIVATE TEST NAME', '01000009999', 'private-invite']) assert.ok(!bytes.includes(raw), raw);
});

test('disabled reserve leaves an existing database byte-for-byte unchanged', t => {
  const { ledger, filename, open } = fixture(t);
  ledger.reserve(input()); ledger.close();
  const before = readFileSync(filename);
  assert.equal(open().reserve({ ...input(2), policy: REFERRAL_POLICY }).reason, 'not_active');
  assert.deepEqual(readFileSync(filename), before);
});

test('unresolved records include pending, dispatching and held rows without changing stored state', t => {
  const { ledger, open } = fixture(t);
  const rows = Array.from({ length: 10 }, (_, id) => ledger.reserve(input(id)).record);
  ledger.claim(rows[1].rewardKey, now);
  ledger.claim(rows[2].rewardKey, now);
  ledger.holdUnknown(rows[2].rewardKey, now);
  ledger.claim(rows[3].rewardKey, now);
  ledger.verifyPaid(rows[3].rewardKey, proof(rows[3]), now);
  const rejected = ledger.reserve(input(10)).record;
  const before = rows.map(row => ledger.get(row.rewardKey));
  const unresolved = ledger.unresolvedRecords();
  assert.equal(unresolved.length, 9);
  assert.deepEqual(new Set(unresolved.map(row => row.status)), new Set(['pending', 'dispatching', 'held']));
  assert.deepEqual(unresolved.map(row => row.rewardKey), before.filter(row => row.status !== 'paid')
    .map(row => row.rewardKey).sort());
  assert.ok(!unresolved.some(row => row.rewardKey === rejected.rewardKey));
  for (const row of unresolved) assert.equal(row.providerReason, `imweb-referral:${row.rewardKey}`);
  assert.ok(!JSON.stringify(unresolved).includes('@example.test'));
  assert.deepEqual(rows.map(row => ledger.get(row.rewardKey)), before);
  ledger.close();
  const reopened = open();
  assert.deepEqual(reopened.unresolvedRecords(), unresolved);
  const first = reopened.unresolvedRecords()[0];
  const storedStatus = first.status;
  first.status = 'paid';
  assert.equal(reopened.get(first.rewardKey).status, storedStatus);
});

test('monthly cap allows ten; rejection permanently binds inviter across months and versions', t => {
  const { ledger } = fixture(t);
  for (let id = 0; id < 10; id++) assert.equal(ledger.reserve(input(id)).eligible, true);
  const rejected = ledger.reserve(input(10));
  assert.equal(rejected.reason, 'monthly_limit');
  assert.equal(rejected.record.status, 'rejected');
  assert.equal(rejected.record.amountWon, 0);
  assert.equal(ledger.claim(rejected.record.rewardKey), null);
  const next = { ...input(10), now: '2026-09-30T15:01:00Z', policy: { ...policy, version: 'next' },
    inviter: { ...inviter, memberCode: 'different-inviter', uid: 'other@example.test', recommendCode: 'other-code' },
    member: { ...input(10).member, joinTime: '2026-09-30T15:00:00Z', recommendTargetCode: 'other-code' } };
  assert.equal(ledger.reserve(next).reason, 'already_recorded');
  assert.deepEqual(ledger.get(rejected.record.rewardKey), rejected.record);
  const october = { ...input(11), now: next.now, member: { ...input(11).member, joinTime: next.member.joinTime } };
  assert.equal(ledger.reserve(october).record.month, '2026-10');
  assert.equal(ledger.reserve(input(12)).reason, 'monthly_limit');
});

test('dispatching survives reopen; unknown holds never retry or release budget, even after reconciliation', t => {
  const { ledger, open } = fixture(t);
  const row = ledger.reserve(input()).record;
  assert.equal(ledger.claim(row.rewardKey, now).status, 'dispatching');
  ledger.close();
  const reopened = open();
  assert.equal(reopened.claim(row.rewardKey, now), null);
  assert.equal(reopened.holdUnknown(row.rewardKey, now), true);
  assert.equal(reopened.holdUnknown(row.rewardKey, now), false);
  reopened.close();
  const again = open();
  assert.equal(again.get(row.rewardKey).status, 'held');
  assert.equal(again.claim(row.rewardKey), null);
  assert.equal(again.reserve(input()).reason, 'already_recorded');
  for (let id = 2; id <= 10; id++) assert.equal(again.reserve(input(id)).eligible, true);
  assert.equal(again.reserve(input(11)).reason, 'monthly_limit');
  assert.equal(again.verifyPaid(row.rewardKey, proof(row), now), true);
  assert.equal(again.claim(row.rewardKey), null);
  assert.equal(again.reserve(input(12)).reason, 'monthly_limit');
});

test('paid requires exact verified recipient, reason, amount and unique provider log proof', t => {
  const { ledger } = fixture(t);
  const row = ledger.reserve(input()).record;
  assert.equal(ledger.verifyPaid(row.rewardKey, proof(row), now), false);
  ledger.claim(row.rewardKey, now);
  const before = ledger.get(row.rewardKey);
  const wrongProofs = [null, {}, ...[{ sourceVerified: false }, { sourceVerified: 'true' }, { amountWon: '3000' },
    { amountWon: -3000 }, { amountWon: 6000 }, { reason: 'wrong' }, { logId: '' }, { member: input().member },
    { member: { ...inviter, siteCode: 'other-site' } }, { member: {} }].map(change => ({ ...proof(row), ...change }))];
  for (const wrong of wrongProofs) {
    assert.equal(ledger.verifyPaid(row.rewardKey, wrong, now), false);
    assert.deepEqual(ledger.get(row.rewardKey), before);
  }
  assert.equal(ledger.verifyPaid(row.rewardKey, proof(row), now), true);
  const paid = ledger.get(row.rewardKey);
  assert.equal(paid.status, 'paid');
  assert.match(paid.providerLogKey, /^[a-f0-9]{64}$/);
  assert.equal(ledger.verifyPaid(row.rewardKey, proof(row), now), true);
  assert.equal(ledger.verifyPaid(row.rewardKey, { ...proof(row), logId: 'other-log' }, now), false);
  assert.equal(ledger.holdUnknown(row.rewardKey), false);
  const second = ledger.reserve(input(2)).record;
  ledger.claim(second.rewardKey, now);
  assert.equal(ledger.verifyPaid(second.rewardKey, { ...proof(second), logId: proof(row).logId }, now), false);
});

test('failed insert rolls back and releases the writer lock without consuming budget', t => {
  const { ledger, filename } = fixture(t);
  ledger.reserve(input(0));
  const db = new DatabaseSync(filename);
  try {
    db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON referral_rewards BEGIN SELECT RAISE(ABORT, 'forced failure'); END;");
    assert.throws(() => ledger.reserve(input(1)), /forced failure/);
    assert.equal(ledger.get(referralKey(input(1).member)), null);
    db.exec('DROP TRIGGER fail_insert');
    for (let id = 1; id < 10; id++) assert.equal(ledger.reserve(input(id)).eligible, true);
    assert.equal(ledger.reserve({ ...input(10), policy: { ...policy, version: 'next' } }).reason, 'monthly_limit');
  } finally { db.close(); }
});

async function race(t, filename, operation, batches) {
  const code = `const { ReferralLedger } = await import(${JSON.stringify(moduleUrl)});
    const ledger = new ReferralLedger(process.argv[1]);
    process.send('ready'); await new Promise(resolve => process.once('message', resolve));
    try { console.log(JSON.stringify(JSON.parse(process.argv[3]).map(value => ledger[process.argv[2]](value)))); }
    finally { ledger.close(); process.disconnect(); }`;
  const workers = batches.map(batch => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, filename, operation, JSON.stringify(batch)],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const ready = new Promise((resolve, reject) => {
      child.once('message', resolve); child.once('error', reject);
      child.once('exit', () => reject(new Error(`Worker exited before readiness: ${stderr}`)));
    });
    const result = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', status => { try {
        assert.equal(status, 0, stderr); resolve(JSON.parse(stdout));
      } catch (error) { reject(error); } });
    });
    return { child, ready, result };
  });
  await Promise.all(workers.map(worker => worker.ready));
  workers.forEach(worker => worker.child.send('go'));
  return (await Promise.all(workers.map(worker => worker.result))).flat();
}

test('separate processes atomically dedupe, reserve ten total, and grant each claim only once', { timeout: 30000 }, async t => {
  const { ledger, filename } = fixture(t);
  const batches = Array.from({ length: 6 }, (_, n) => [input(100), input(n * 2), input(n * 2 + 1)]);
  const results = await race(t, filename, 'reserve', batches);
  assert.equal(results.filter(result => result.eligible).length, 10);
  assert.equal(results.filter(result => result.reason === 'already_recorded').length, 5);
  assert.equal(results.filter(result => result.reason === 'monthly_limit').length, 3);
  const key = referralKey(input(100).member);
  const claims = await race(t, filename, 'claim', Array.from({ length: 6 }, () => [key]));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(ledger.get(key).status, 'dispatching');
  assert.equal(ledger.reserve(input(999)).reason, 'monthly_limit');
});
