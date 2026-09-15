import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ReferralLedger } from '../lib/imweb-referral-ledger.mjs';
import { REFERRAL_POLICY, assessReferral, referralKey } from '../lib/imweb-referral-policy.mjs';
import { IMWEB_REFERRAL_SCOPE as scope, preparePointAward } from '../lib/imweb-referral-source.mjs';
import { readPointAwardProof } from '../lib/imweb-referral-proof.mjs';
import { runReferralWorker } from '../lib/imweb-referral-worker.mjs';
import { main, validateConfig } from '../run-imweb-referral-worker.mjs';

const NOW = '2026-09-15T06:00:00Z';
const START = '2026-09-15T00:00:00Z';
const CUTOFF = '2026-09-15T05:00:00Z';
const roles = ['inviter', 'invitee'];
const peerRole = role => role === 'inviter' ? 'invitee' : 'inviter';
// Independent expectations: using awardReason here could mask a shared prefix bug.
const reasonFor = (role, key) => `${role === 'invitee' ? 'imweb-referral-invitee' : 'imweb-referral'}:${key}`;
const policy = { ...REFERRAL_POLICY, enabled: true, startsAt: START };
const inviter = { ...scope, memberCode: 'both-fixture-inviter', uid: 'both-inviter@example.test',
  email: 'both-inviter@example.test', joinTime: '2026-08-01T00:00:00Z', recommendCode: 'BOTH-FIXTURE' };
const member = (id = 1, changes = {}) => ({ ...scope, memberCode: `both-fixture-new-${id}`,
  uid: `both-new-${id}@example.test`, email: `both-new-${id}@example.test`,
  joinTime: CUTOFF, recommendTargetCode: inviter.recommendCode, ...changes });
const reservation = (target = member(), changes = {}) =>
  ({ member: target, inviter, policy, now: NOW, sourceVerified: true, ...changes });
const targetFor = (role, invitee = member()) => role === 'invitee' ? invitee : inviter;
const proofFor = (role, invitee = member()) => ({ sourceVerified: true,
  member: targetFor(role, invitee), amountWon: 3000,
  reason: reasonFor(role, referralKey(invitee)), logId: `fixture-${role}-${referralKey(invitee)}` });
const logRow = (target, reason) => ({ unitCode: scope.unitCode, memberCode: target.memberCode,
  memberUid: target.uid, reason, changePoint: 3000, currency: 'KRW', type: 'etc', time: NOW });

function fixture(t, invitees = [member()]) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'imweb-referral-both-'));
  const filename = join(directory, 'ledger.sqlite');
  const ledgers = new Map();
  const open = role => {
    if (!ledgers.has(role)) ledgers.set(role, role === 'inviter'
      ? new ReferralLedger(filename) : new ReferralLedger(filename, role));
    return ledgers.get(role);
  };
  const restart = () => { for (const ledger of ledgers.values()) ledger.close(); ledgers.clear(); };
  t.after(() => { restart(); rmSync(directory, { recursive: true, force: true }); });
  const state = { members: [inviter, ...invitees], logs: [], calls: [], sends: [], scans: 0,
    proofUnavailable: new Set(), ambiguousSend: new Set() };
  const runProvider = args => {
    state.calls.push([...args]);
    if (args[0] === 'config') {
      assert.deepEqual(args, ['config', 'context']);
      return { resolved_profile: { site_code: scope.siteCode, unit_code: scope.unitCode } };
    }
    if (args[2] === 'log') {
      const uid = args[6];
      assert.deepEqual(args, ['promotion', 'point', 'log', '--unit-code', scope.unitCode,
        '--member-uid', uid, '--page', '1', '--limit', '50']);
      assert.ok(state.members.some(target => target.uid === uid), 'Synthetic recipients only');
      const list = state.logs.filter(row => row.memberUid === uid);
      return { data: { list: structuredClone(list), currentPage: 1, pageSize: 50,
        totalCount: list.length, totalPage: Math.ceil(list.length / 50) } };
    }
    assert.deepEqual(args.slice(0, 4), ['promotion', 'point', 'change', 'member']);
    assert.equal(args[5], '--data');
    const target = state.members.find(candidate => candidate.uid === args[4]);
    assert.ok(target, 'Only a synthetic recipient may receive a simulated award');
    const data = JSON.parse(args[6]);
    assert.deepEqual(Object.keys(data).sort(), ['changeType', 'point', 'reason', 'unitCode']);
    assert.equal(data.unitCode, scope.unitCode);
    assert.equal(data.changeType, 'increase');
    assert.equal(data.point, 3000);
    assert.match(data.reason, /^imweb-referral(?:-invitee)?:[a-f0-9]{64}$/);
    if (args[7] === '--dry-run') {
      assert.equal(args.length, 8);
      return { confirmation_token: 'offline-fixture-confirmation' };
    }
    assert.deepEqual(args.slice(7), ['--yes', '--confirm-token', 'offline-fixture-confirmation']);
    const role = data.reason.startsWith('imweb-referral-invitee:') ? 'invitee' : 'inviter';
    state.sends.push({ role, memberCode: target.memberCode, amountWon: data.point, reason: data.reason });
    state.logs.push(logRow(target, data.reason));
    if (state.ambiguousSend.has(role)) throw new Error('Offline acknowledgement lost after award');
    return { acknowledged: true };
  };
  const dependencies = {
    clock: () => NOW,
    readReferralMembers: () => {
      state.scans++;
      return { complete: true, pages: 1, members: state.members };
    },
    preparePointAward: (target, key, options) => preparePointAward(target, key, { ...options, run: runProvider }),
    verifier: input => state.proofUnavailable.has(input.record.role) ? null
      : readPointAwardProof(input, { run: runProvider, now: NOW }),
  };
  const run = (role, changes = {}, overrides = {}) => runReferralWorker({ enabled: true,
    apply: true, tested: true, role, policy, now: NOW, ...changes },
  { ...dependencies, ledger: open(role), ...overrides });
  const runnerConfig = { enabled: true, tested: true, startsAt: START,
    rewardWon: 3000, monthlyLimitWon: 30000, timezone: 'Asia/Seoul', ...scope,
    ledgerPath: filename, backupDir: join(directory, 'backups'), testMode: true,
    allowlist: invitees.map(target => ({ memberCode: target.memberCode, inviterCode: inviter.memberCode })) };
  const runRunner = async (changes = {}, { apply = true } = {}) => {
    restart();
    mkdirSync(runnerConfig.backupDir, { recursive: true, mode: 0o700 });
    const configPath = join(directory, 'config.json');
    writeFileSync(configPath, JSON.stringify({ ...runnerConfig, ...changes }), { mode: 0o600 });
    return main(['--config', configPath, ...(apply ? ['--apply'] : [])], {
      now: () => NOW, output: () => {}, workerDependencies: dependencies,
    });
  };
  closeSync(openSync(filename, 'wx', 0o600));
  open('inviter').get('initialize-empty-fixture');
  return { directory, filename, state, open, restart, run, runProvider, runnerConfig, runRunner };
}

function storedRows(filename, table) {
  assert.ok(['referral_rewards', 'referral_invitee_rewards'].includes(table));
  const db = new DatabaseSync(filename, { readOnly: true });
  try { return db.prepare(`SELECT * FROM ${table} ORDER BY rewardKey`).all().map(row => ({ ...row })); }
  finally { db.close(); }
}

for (const first of roles) {
  test(`both recipients paid exactly once when ${first} runs first, including fresh-ledger restart`, async t => {
    const f = fixture(t);
    for (const role of [first, peerRole(first)]) {
      const result = await f.run(role);
      assert.equal(result.paid, 1);
      assert.equal(result.sendAttempts, 1);
      assert.equal(result.failures, 0);
      const row = f.open(role).get(referralKey(member()));
      assert.equal(row.role, role);
      assert.equal(row.status, 'paid');
      assert.equal(row.recipientKey, referralKey(targetFor(role)));
      assert.equal(row.providerReason, reasonFor(role, row.rewardKey));
    }
    const before = roles.map(role => f.open(role).get(referralKey(member())));
    f.restart();
    for (const role of roles) {
      const result = await f.run(role);
      assert.equal(result.sendAttempts, 0);
      assert.equal(result.duplicates, 1);
    }
    assert.deepEqual(roles.map(role => f.open(role).get(referralKey(member()))), before);
    assert.deepEqual(f.state.sends, [first, peerRole(first)].map(role => ({ role,
      memberCode: targetFor(role).memberCode, amountWon: 3000, reason: reasonFor(role, referralKey(member())) })));
    for (const table of ['referral_rewards', 'referral_invitee_rewards']) assert.equal(storedRows(f.filename, table).length, 1);
  });

  test(`${first} partial completion resumes its missing counterpart without another award`, async t => {
    const f = fixture(t);
    assert.equal((await f.run(first)).paid, 1);
    const paid = f.open(first).get(referralKey(member()));
    f.restart();
    assert.equal(f.open(peerRole(first)).get(paid.rewardKey), null);
    for (const role of roles) {
      const result = await f.run(role);
      assert.equal(result.sendAttempts, role === first ? 0 : 1);
      assert.equal(f.open(role).get(paid.rewardKey).status, 'paid');
    }
    assert.deepEqual(f.open(first).get(paid.rewardKey), paid);
    assert.equal(f.state.sends.length, 2);
  });

  test(`${first} crash after dispatch reconciles the persisted claim without resending either role`, async t => {
    const f = fixture(t);
    const ledger = f.open(first);
    const row = ledger.reserve(reservation()).record;
    const prepared = preparePointAward(targetFor(first), row.rewardKey, { role: first, run: f.runProvider });
    assert.equal(ledger.claim(row.rewardKey, NOW).status, 'dispatching');
    prepared.send();
    // Model process loss after provider success, before any local proof or hold.
    f.restart();
    assert.equal(f.open(first).get(row.rewardKey).status, 'dispatching');
    assert.equal((await f.run(peerRole(first))).paid, 1);
    const recovered = await f.run(first);
    assert.equal(recovered.reconciled, 1);
    assert.equal(recovered.sendAttempts, 0);
    f.restart();
    for (const role of roles) {
      assert.equal((await f.run(role)).sendAttempts, 0);
      assert.equal(f.open(role).get(row.rewardKey).status, 'paid');
    }
    assert.equal(f.state.sends.length, 2);
  });

  for (const failure of ['proofUnavailable', 'ambiguousSend']) {
    test(`${first} ${failure} stays held through restart while the other role is paid once`, async t => {
      const f = fixture(t);
      f.state[failure].add(first);
      // An ambiguous send is also unreadable until an explicit later reconciliation.
      f.state.proofUnavailable.add(first);
      assert.equal((await f.run(first)).held, 1);
      assert.equal((await f.run(peerRole(first))).paid, 1);
      const paid = f.open(peerRole(first)).get(referralKey(member()));
      f.restart();
      for (const role of roles) {
        const result = await f.run(role);
        assert.equal(result.sendAttempts, 0);
        assert.equal(f.open(role).get(paid.rewardKey).status, role === first ? 'held' : 'paid');
      }
      f.state.proofUnavailable.clear();
      f.state.ambiguousSend.clear();
      f.restart();
      const recovered = await f.run(first);
      assert.equal(recovered.reconciled, 1);
      assert.equal(recovered.sendAttempts, 0);
      assert.equal(f.open(first).get(paid.rewardKey).status, 'paid');
      assert.deepEqual(f.open(peerRole(first)).get(paid.rewardKey), paid);
      assert.equal(f.state.sends.length, 2);
    });
  }

  test(`${first} ledger rejects wrong recipient and opposite-role reason before accepting exact proof`, t => {
    const f = fixture(t);
    const ledger = f.open(first);
    const row = ledger.reserve(reservation()).record;
    ledger.claim(row.rewardKey, NOW);
    const correct = proofFor(first);
    for (const proof of [{ ...correct, member: targetFor(peerRole(first)) },
      { ...correct, reason: reasonFor(peerRole(first), row.rewardKey) }, proofFor(peerRole(first))]) {
      assert.equal(ledger.verifyPaid(row.rewardKey, proof, NOW), false);
      assert.equal(ledger.get(row.rewardKey).status, 'dispatching');
    }
    assert.equal(ledger.verifyPaid(row.rewardKey, correct, NOW), true);
  });

  test(`${first} proof adapter selects the role recipient and rejects the other role's log`, t => {
    const f = fixture(t);
    const record = f.open(first).reserve(reservation()).record;
    const input = { member: member(), inviter, record };
    f.state.logs.push(logRow(targetFor(first), reasonFor(first, record.rewardKey)));
    const proof = readPointAwardProof(input, { run: f.runProvider, now: NOW });
    assert.equal(proof.member.memberCode, targetFor(first).memberCode);
    assert.equal(proof.reason, reasonFor(first, record.rewardKey));
    assert.deepEqual(f.state.calls.filter(args => args[2] === 'log').map(args => args[6]), [targetFor(first).uid]);
    f.state.logs[0].reason = reasonFor(peerRole(first), record.rewardKey);
    assert.equal(readPointAwardProof(input, { run: f.runProvider, now: NOW }), null);
    f.state.logs[0] = { ...logRow(targetFor(peerRole(first)), record.providerReason), memberUid: targetFor(first).uid };
    assert.throws(() => readPointAwardProof(input, { run: f.runProvider, now: NOW }), /recipient or format/);
    const calls = f.state.calls.length;
    assert.throws(() => readPointAwardProof({ ...input, record: { ...record, role: peerRole(first) } },
      { run: f.runProvider, now: NOW }), /canonical award record/);
    assert.equal(f.state.calls.length, calls);
  });

  test(`${first} preparation refuses its own prior reason but not the other role's reason`, t => {
    const f = fixture(t);
    const target = targetFor(first);
    const key = referralKey(member());
    f.state.logs.push(logRow(target, reasonFor(peerRole(first), key)));
    const prepared = preparePointAward(target, key, { role: first, run: f.runProvider });
    assert.equal(prepared.reason, reasonFor(first, key));
    assert.equal(f.state.sends.length, 0);
    prepared.send();
    assert.equal(f.state.sends.length, 1);
    assert.throws(() => prepared.send(), /already consumed/);
    const dryRuns = f.state.calls.filter(args => args.includes('--dry-run')).length;
    assert.throws(() => preparePointAward(target, key, { role: first, run: f.runProvider }), /Prior provider award/);
    assert.equal(f.state.calls.filter(args => args.includes('--dry-run')).length, dryRuns);
    assert.equal(f.state.sends.length, 1);
  });

  test(`${first} worker rejects the opposite-role prepared reason without claiming or sending`, async t => {
    const f = fixture(t);
    let sends = 0;
    const result = await f.run(first, {}, { preparePointAward: (target, key, options) => {
      assert.equal(target.memberCode, targetFor(first).memberCode);
      assert.deepEqual(options, { role: first });
      return { reason: reasonFor(peerRole(first), key), send: () => { sends++; } };
    } });
    assert.equal(result.failures, 1);
    assert.equal(result.claimed, 0);
    assert.equal(result.sendAttempts, 0);
    assert.equal(sends, 0);
    assert.equal(f.open(first).get(referralKey(member())).status, 'pending');
  });

  test(`${first} attribution binds the counterpart and a changed inviter cannot get its reward`, async t => {
    const f = fixture(t);
    const original = f.open(first).reserve(reservation()).record;
    const other = { ...inviter, memberCode: 'other-fixture-inviter', uid: 'other@example.test',
      email: 'other@example.test', recommendCode: 'OTHER-FIXTURE' };
    const changed = member(1, { recommendTargetCode: other.recommendCode });
    f.restart();
    const peer = f.open(peerRole(first));
    assert.throws(() => peer.reserve(reservation(changed, { inviter: other })), /attribution differs/);
    assert.equal(peer.get(original.rewardKey), null);
    f.state.members = [inviter, other, changed];
    const result = await f.run(peerRole(first));
    assert.equal(result.failures, 1);
    assert.equal(result.unresolved, 1);
    assert.equal(result.sendAttempts, 0);
    assert.equal(peer.get(original.rewardKey), null);
    assert.deepEqual(f.open(first).get(original.rewardKey), original);
    assert.equal(f.state.sends.length, 0);
  });
}

for (const first of roles) {
test(`monthly cap permits ten inviter awards and eleven invitee awards with ${first} first`, async t => {
  const invitees = Array.from({ length: 11 }, (_, i) => member(i + 1));
  const f = fixture(t, invitees);
  assert.equal(assessReferral({ ...reservation(), role: 'inviter', monthlyReservedWon: 30000 }).reason, 'monthly_limit');
  assert.equal(assessReferral({ ...reservation(), role: 'invitee', monthlyReservedWon: 30000 }).eligible, true);
  for (const role of roles) {
    const simulated = await f.run(role, { apply: false });
    assert.equal(simulated.simulated, role === 'inviter' ? 10 : 11);
    assert.equal(simulated.sendAttempts, 0);
    assert.equal(f.state.sends.length, 0);
  }
  for (const role of [first, peerRole(first)]) {
    assert.equal((await f.run(role)).paid, role === 'inviter' ? 10 : 11);
  }
  const inviters = storedRows(f.filename, 'referral_rewards');
  const inviteeRows = storedRows(f.filename, 'referral_invitee_rewards');
  assert.equal(inviters.filter(row => row.status === 'paid').length, 10);
  assert.equal(inviters.filter(row => row.status === 'rejected' && row.reason === 'monthly_limit').length, 1);
  assert.equal(inviters.reduce((total, row) => total + row.amountWon, 0), 30000);
  assert.equal(inviteeRows.filter(row => row.status === 'paid').length, 11);
  assert.equal(inviteeRows.reduce((total, row) => total + row.amountWon, 0), 33000);
  assert.deepEqual(f.state.sends.filter(row => row.role === 'invitee').map(row => row.memberCode).sort(),
    invitees.map(target => target.memberCode).sort());
  f.restart();
  for (const role of roles) assert.equal((await f.run(role)).sendAttempts, 0);
  assert.equal(f.state.sends.length, 21);
});
}

test('opening the invitee table preserves every legacy inviter column and status', t => {
  const f = fixture(t);
  f.restart();
  const db = new DatabaseSync(f.filename);
  try {
    // Seed the pre-role schema directly: no role/recipient/providerReason columns existed.
    const insert = db.prepare(`INSERT INTO referral_rewards
      (rewardKey, inviterKey, month, policyVersion, amountWon, status, reason, createdAt, updatedAt, providerLogKey)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [i, status] of ['paid', 'held', 'dispatching', 'pending', 'rejected'].entries()) {
      insert.run(referralKey(member(i + 1)), referralKey(inviter), '2026-09', 'legacy-fixture-v1',
        status === 'rejected' ? 0 : 3000, status, `legacy-${status}`, START, START,
        status === 'paid' ? 'legacy-log-fingerprint' : null);
    }
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'referral_invitee_rewards'").get(), undefined);
  } finally { db.close(); }
  const before = storedRows(f.filename, 'referral_rewards');
  assert.equal(f.open('inviter').role, 'inviter');
  const legacyPaid = f.open('inviter').get(referralKey(member()));
  assert.equal(legacyPaid.providerReason, reasonFor('inviter', legacyPaid.rewardKey));
  assert.equal(legacyPaid.providerLogKey, 'legacy-log-fingerprint');
  const row = f.open('invitee').reserve(reservation()).record;
  assert.equal(row.role, 'invitee');
  assert.equal(row.status, 'pending');
  f.restart();
  assert.deepEqual(storedRows(f.filename, 'referral_rewards'), before);
  assert.equal(storedRows(f.filename, 'referral_invitee_rewards').length, 1);
});

test('worker rejects a mismatched ledger role and invalid roles before scanning', async t => {
  const f = fixture(t);
  for (const role of roles) {
    await assert.rejects(f.run(role, {}, { ledger: f.open(peerRole(role)) }), /ledger role mismatch/);
  }
  for (const role of ['both', '', null]) {
    assert.throws(() => new ReferralLedger(f.filename, role), /Invalid reward role/);
    assert.throws(() => assessReferral({ ...reservation(), role }), /Invalid reward role/);
    await assert.rejects(f.run('inviter', { role }), /Invalid reward role/);
    assert.throws(() => preparePointAward(member(), referralKey(member()), { role, run: f.runProvider }), /Invalid reward role/);
  }
  assert.equal(f.state.scans, 0);
  assert.deepEqual(f.state.calls, []);
  assert.deepEqual(storedRows(f.filename, 'referral_rewards'), []);
});

test('runner invitee activation fields are optional, normalized, and separately approval-gated', t => {
  const f = fixture(t);
  const legacy = validateConfig(f.runnerConfig, { apply: true });
  assert.equal(legacy.inviteeStartsAt, undefined);
  const dual = { ...f.runnerConfig, inviteeStartsAt: '2026-09-15T14:00:00+09:00', inviteeTested: true };
  assert.equal(validateConfig(dual, { apply: true }).inviteeStartsAt, '2026-09-15T05:00:00.000Z');
  for (const inviteeTested of [undefined, false]) {
    assert.throws(() => validateConfig({ ...dual, inviteeTested }, { apply: true }), /INVITEE_NOT_APPROVED/);
    assert.doesNotThrow(() => validateConfig({ ...dual, inviteeTested }));
  }
  for (const changes of [{ inviteeTested: 'true' }, { inviteeStartsAt: null },
    { inviteeStartsAt: '2026-09-15' }, { inviteeStartsAt: '2026-02-30T00:00:00Z' },
    { inviteeStartsAt: '2026-09-14T23:59:59Z' }]) {
    assert.throws(() => validateConfig({ ...dual, ...changes }, { apply: true }), /INVALID_CONFIG|INVALID_TIMESTAMP/);
  }
  assert.deepEqual(f.state.calls, []);
});

test('runner preserves inviter-only behavior with no invitee cutoff, even if inviteeTested is true', async t => {
  const f = fixture(t);
  const result = await f.runRunner({ inviteeTested: true });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(Object.keys(result.rewards), ['inviter']);
  assert.equal(result.summary.paid, 1);
  assert.deepEqual(f.state.sends.map(row => row.role), ['inviter']);
});

test('runner cutoff excludes old invitees, includes the exact boundary, and reuses one scan', async t => {
  const old = member('old', { joinTime: '2026-09-15T04:59:59.999Z' });
  const boundary = member('boundary');
  const after = member('after', { joinTime: '2026-09-15T05:00:00.001Z' });
  const f = fixture(t, [old, boundary, after]);
  // The old inviter reward is reserved after rollout: creation time cannot authorize backfill.
  const oldRow = f.open('inviter').reserve(reservation(old)).record;
  f.open('inviter').claim(oldRow.rewardKey, NOW);
  assert.equal(f.open('inviter').verifyPaid(oldRow.rewardKey, proofFor('inviter', old), NOW), true);
  const oldPaid = f.open('inviter').get(oldRow.rewardKey);
  const config = { inviteeStartsAt: CUTOFF, inviteeTested: true };
  const result = await f.runRunner(config);
  assert.equal(result.exitCode, 0);
  assert.equal(result.rewards.inviter.paid, 2);
  assert.equal(result.rewards.invitee.paid, 2);
  assert.equal(result.rewards.invitee.rejected, 1);
  assert.equal(result.summary.sendAttempts, 4);
  assert.equal(f.state.scans, 1);
  assert.equal(f.open('invitee').get(referralKey(old)), null);
  assert.deepEqual(f.open('inviter').get(oldRow.rewardKey), oldPaid);
  assert.deepEqual(f.state.sends.filter(row => row.role === 'invitee').map(row => row.memberCode),
    [boundary.memberCode, after.memberCode]);
  assert.equal((await f.runRunner(config)).summary.sendAttempts, 0);
  assert.equal(f.state.sends.length, 4);
  assert.ok(!readdirSync(f.directory).some(name => name.endsWith('.lock')));
  const saved = JSON.parse(readFileSync(join(f.directory, 'imweb-referral-worker-status.json'), 'utf8'));
  assert.equal(saved.state, 'success');
  assert.equal(saved.summary.sendAttempts, 0);
});

test('future invitee activation cannot pay or create an invitee reward', async t => {
  const f = fixture(t);
  const result = await f.runRunner({ inviteeStartsAt: '2026-09-15T07:00:00Z', inviteeTested: true });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(Object.keys(result.rewards), ['inviter']);
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.open('invitee').get(referralKey(member())), null);
});

test('runner refuses unapproved invitee apply before a scan or provider call', async t => {
  const f = fixture(t);
  const before = readFileSync(f.filename);
  const result = await f.runRunner({ inviteeStartsAt: CUTOFF, inviteeTested: false });
  assert.equal(result.exitCode, 1);
  assert.equal(result.errorCode, 'INVITEE_NOT_APPROVED');
  assert.equal(f.state.scans, 0);
  assert.deepEqual(f.state.calls, []);
  assert.deepEqual(readFileSync(f.filename), before);
});

for (const heldRole of roles) {
  test(`runner reports ${heldRole} held, still awards its peer, and reconciles without repeat sends`, async t => {
    const f = fixture(t);
    const config = { inviteeStartsAt: CUTOFF, inviteeTested: true };
    f.state.proofUnavailable.add(heldRole);
    const first = await f.runRunner(config);
    assert.equal(first.exitCode, 1);
    assert.equal(first.errorCode, 'WORKER_INCOMPLETE');
    assert.equal(first.rewards[heldRole].held, 1);
    assert.equal(first.rewards[peerRole(heldRole)].paid, 1);
    assert.equal(first.summary.sendAttempts, 2);
    const restart = await f.runRunner(config);
    assert.equal(restart.exitCode, 1);
    assert.equal(restart.summary.sendAttempts, 0);
    f.state.proofUnavailable.clear();
    const recovered = await f.runRunner(config);
    assert.equal(recovered.exitCode, 0);
    assert.equal(recovered.rewards[heldRole].reconciled, 1);
    assert.equal(recovered.summary.sendAttempts, 0);
    assert.equal(f.state.sends.length, 2);
    for (const role of roles) assert.equal(f.open(role).get(referralKey(member())).status, 'paid');
    assert.ok(!readdirSync(f.directory).some(name => name.endsWith('.lock')));
  });
}

for (const stage of ['beforePrepare', 'preparePointAward']) {
  test(`month rollover at ${stage} leaves invitee pending and unresolved while inviter stays paid`, async t => {
    const f = fixture(t);
    assert.equal((await f.run('inviter')).paid, 1);
    const key = referralKey(member());
    const paid = f.open('inviter').get(key);
    let moment = '2026-09-30T14:58:00Z';
    let preparations = 0;
    let sends = 0;
    const result = await f.run('invitee', {}, {
      clock: () => moment,
      beforePrepare: () => {
        if (stage === 'beforePrepare') moment = '2026-09-30T15:00:00Z';
        return true;
      },
      preparePointAward: (target, rewardKey, options) => {
        preparations++;
        assert.equal(target.memberCode, member().memberCode);
        assert.deepEqual(options, { role: 'invitee' });
        moment = '2026-09-30T15:00:00Z';
        return { reason: reasonFor('invitee', rewardKey), send: () => { sends++; } };
      },
    });
    assert.equal(preparations, stage === 'beforePrepare' ? 0 : 1);
    assert.equal(result.prepared, preparations);
    assert.equal(result.reserved, 1);
    assert.equal(result.rejected, 1);
    assert.equal(result.unresolved, 1);
    assert.equal(result.failures, 1);
    assert.equal(result.claimed, 0);
    assert.equal(result.sendAttempts, 0);
    assert.equal(sends, 0);
    assert.equal(f.open('invitee').get(key).status, 'pending');
    f.restart();
    const retry = await f.run('invitee', {}, { clock: () => moment });
    assert.equal(retry.unresolved, 1);
    assert.equal(retry.failures, 1);
    assert.equal(retry.sendAttempts, 0);
    assert.equal(f.open('invitee').get(key).status, 'pending');
    assert.equal((await f.run('inviter', {}, { clock: () => moment })).sendAttempts, 0);
    assert.deepEqual(f.open('inviter').get(key), paid);
    assert.equal(f.state.sends.length, 1);
  });
}

for (const first of roles) {
  test(`${first} paid counterpart cannot be hidden by attribution changing to an excluded inviter`, async t => {
    const f = fixture(t);
    assert.equal((await f.run(first)).paid, 1);
    const key = referralKey(member());
    const paid = f.open(first).get(key);
    const excluded = { ...inviter, memberCode: 'excluded-fixture-inviter', uid: 'excluded@example.test',
      email: 'excluded@example.test', recommendCode: 'EXCLUDED-FIXTURE' };
    f.state.members = [inviter, excluded, member(1, { recommendTargetCode: excluded.recommendCode })];
    f.restart();
    const result = await f.run(peerRole(first), { excludedMemberCodes: [excluded.memberCode] });
    assert.equal(result.filtered, 0);
    assert.equal(result.unresolved, 1);
    assert.equal(result.failures, 1);
    assert.equal(result.reserved, 0);
    assert.equal(result.sendAttempts, 0);
    assert.equal(f.open(peerRole(first)).get(key), null);
    assert.deepEqual(f.open(first).get(key), paid);
    assert.equal(f.state.sends.length, 1);
  });
}
