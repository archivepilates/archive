import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReferralWorker } from '../lib/imweb-referral-worker.mjs';
import { ReferralLedger } from '../lib/imweb-referral-ledger.mjs';
import { REFERRAL_POLICY, referralKey } from '../lib/imweb-referral-policy.mjs';
import { readReferralMembers, referralPairs, IMWEB_REFERRAL_SCOPE as scope } from '../lib/imweb-referral-source.mjs';

const now = '2026-09-15T06:00:00Z';
const policy = { ...REFERRAL_POLICY, enabled: true, startsAt: '2026-09-15T00:00:00+09:00' };
const config = { enabled: true, apply: true, tested: true, policy, now };
const inviter = { ...scope, memberCode: 'inviter', uid: 'inviter@example.test', email: 'inviter@example.test',
  joinTime: '2026-08-01T00:00:00Z', recommendCode: 'NATIVE-CODE', recommendTargetCode: null };
const member = (id = 1) => ({ ...inviter, memberCode: `new-${id}`, uid: `new${id}@example.test`,
  email: `new${id}@example.test`, joinTime: '2026-09-15T05:00:00Z', recommendCode: null, recommendTargetCode: inviter.recommendCode });
const input = (id = 1) => ({ member: member(id), inviter, policy, now, sourceVerified: true });
const forbidden = () => { throw new Error('Unexpected side effect'); };
const forbiddenLedger = Object.fromEntries(['get', 'unresolvedRecords', 'reserve', 'claim', 'holdUnknown', 'verifyPaid'].map(name => [name, forbidden]));

function fixture(t, count = 1) {
  const directory = mkdtempSync(join(tmpdir(), 'imweb-referral-worker-'));
  const filename = join(directory, 'ledger.sqlite');
  const ledger = new ReferralLedger(filename);
  t.after(() => { ledger.close(); rmSync(directory, { recursive: true, force: true }); });
  const events = [];
  const state = { members: [inviter, ...Array.from({ length: count }, (_, n) => member(n + 1))], sendError: false, proofError: false };
  const dependencies = {
    ledger: Object.fromEntries(['get', 'unresolvedRecords', 'reserve', 'claim', 'holdUnknown', 'verifyPaid'].map(name =>
      [name, (...args) => { events.push(name); return ledger[name](...args); }])),
    readReferralMembers: async () => { events.push('read'); return { members: state.members, pages: 2, complete: true }; },
    referralPairs: members => { events.push('pairs'); return referralPairs(members); },
    preparePointAward: async (target, key) => {
      events.push('prepare'); assert.equal(target.memberCode, inviter.memberCode);
      assert.equal(ledger.get(key).status, 'pending');
      return { reason: `imweb-referral:${key}`, async send() {
        events.push('send'); assert.equal(ledger.get(key).status, 'dispatching');
        if (state.sendError) throw new Error('private provider failure new1@example.test');
        return { opaqueAcknowledgement: true };
      } };
    },
    verifier: async ({ inviter: target, record, sendResult }) => {
      events.push('verify');
      if (state.proofError) throw new Error('private readback failure new1@example.test');
      if (sendResult !== undefined) assert.deepEqual(sendResult, { opaqueAcknowledgement: true });
      return { sourceVerified: true, member: target, reason: record.providerReason,
        amountWon: 3000, logId: `fixture-${record.rewardKey}` };
    },
  };
  return { ledger, filename, directory, events, state, dependencies };
}

test('default disabled has no external calls or ledger access, regardless of apply flag', async () => {
  const dependencies = { readReferralMembers: forbidden, referralPairs: forbidden,
    preparePointAward: forbidden, verifier: forbidden, ledger: forbiddenLedger };
  for (const options of [{}, { apply: true, policy }, { enabled: 'true' }]) {
    const summary = await runReferralWorker(options, dependencies);
    assert.equal(summary.disabled, 1);
    assert.ok(Object.values(summary).every(value => Number.isInteger(value)));
    assert.equal(Object.values(summary).reduce((sum, value) => sum + value, 0), 1);
  }
});

test('unapproved apply and missing native verifier fail before any scan or writes', async () => {
  const dependencies = { readReferralMembers: forbidden, ledger: forbiddenLedger, verifier: forbidden };
  for (const options of [{ tested: false }, { tested: 'true' }, { policy: REFERRAL_POLICY },
    { policy: { ...policy, startsAt: null } }, { policy: { ...policy, startsAt: '2026-10-01T00:00:00Z' } },
    { policy: { ...policy, startsAt: '2026-09-15' } }, { policy: { ...policy, rewardWon: 9999 } }]) {
    await assert.rejects(runReferralWorker({ ...config, ...options }, dependencies), /tested approval/);
  }
  await assert.rejects(runReferralWorker(config, { ...dependencies, verifier: undefined }), /native-log adapter/);
  await assert.rejects(runReferralWorker(config, { ...dependencies, ledger: undefined }), /durable ledger/);
  await assert.rejects(runReferralWorker(config, { ...dependencies,
    ledger: { ...forbiddenLedger, unresolvedRecords: undefined } }), /durable ledger/);
});

test('complete canonical scan and pair validation precede reserve, dry-run, claim, send and proof', async t => {
  const { ledger, dependencies, events } = fixture(t);
  const summary = await runReferralWorker(config, dependencies);
  assert.deepEqual(events.filter(event => event !== 'get'), ['read', 'pairs', 'unresolvedRecords', 'reserve', 'prepare', 'claim', 'send', 'verify', 'verifyPaid']);
  assert.equal(ledger.get(referralKey(member())).status, 'paid');
  for (const key of ['reserved', 'prepared', 'claimed', 'sendAttempts', 'paid']) assert.equal(summary[key], 1, key);
  assert.equal(summary.failures, 0);
  assert.ok(Object.values(summary).every(Number.isInteger));
  assert.ok(!JSON.stringify(summary).includes('@example.test'));
});

test('partial scans, scanner exceptions, or ambiguous attribution never touch the ledger', async t => {
  const { dependencies, directory, events } = fixture(t);
  const context = { resolved_profile: { site_code: scope.siteCode, unit_code: scope.unitCode } };
  const scans = [
    () => ({ members: [inviter, member()], complete: false, pages: 1 }),
    () => readReferralMembers({ maxPages: 1, run: args => args[0] === 'config' ? context :
      { data: { list: [inviter, member()], hasNext: true, nextCursor: 'more' } } }),
    () => { throw new Error('partial page contains new1@example.test'); },
    () => ({ members: [inviter, { ...inviter, memberCode: 'conflict' }, member()], complete: true, pages: 1 }),
  ];
  for (const read of scans) {
    await assert.rejects(runReferralWorker(config, { ...dependencies, ledger: forbiddenLedger, readReferralMembers: read }),
      error => /canonical referral scan/.test(error.message) && !error.message.includes('@'));
  }
  assert.deepEqual(readdirSync(directory), []);
  assert.ok(!events.includes('prepare'));
});

test('enabled simulation is canonical-read and pure-assess only, with ten-award in-memory cap', async t => {
  const { dependencies, ledger, filename, directory, events } = fixture(t, 11);
  const simulate = () => runReferralWorker({ ...config, apply: false, tested: false },
    { ...dependencies, ledger: forbiddenLedger, preparePointAward: forbidden, verifier: forbidden });
  const summary = await simulate();
  assert.equal(summary.simulated, 10); assert.equal(summary.rejected, 1); assert.equal(summary.reserved, 0);
  assert.deepEqual(readdirSync(directory), []);
  ledger.reserve(input()); ledger.close();
  const before = readFileSync(filename);
  assert.equal((await simulate()).simulated, 10);
  assert.deepEqual(readFileSync(filename), before);
  assert.deepEqual(events, ['read', 'pairs', 'read', 'pairs']);
});

test('test mode requires exact member/inviter pairs, not independent code allowlists', async t => {
  const { dependencies, ledger, events } = fixture(t, 2);
  for (const allowlist of [undefined, [], [{ memberCode: 'new-1' }], [{ inviterCode: 'inviter' }]]) {
    await assert.rejects(runReferralWorker({ ...config, testMode: true, allowlist }, dependencies), /Exact referral test pairs/);
  }
  assert.deepEqual(events, []);
  const summary = await runReferralWorker({ ...config, testMode: true,
    allowlist: [{ memberCode: 'new-1', inviterCode: 'wrong' }, { memberCode: 'new-2', inviterCode: 'inviter' }] }, dependencies);
  assert.equal(summary.filtered, 1); assert.equal(summary.paid, 1);
  assert.equal(ledger.get(referralKey(member(1))), null);
  assert.equal(ledger.get(referralKey(member(2))).status, 'paid');
});

test('dry-run failure or mismatched provider reason never claims or sends', async t => {
  const { dependencies, ledger, events } = fixture(t);
  for (const preparePointAward of [() => { throw new Error('dry-run failed'); },
    () => ({ reason: 'old-reason', send: forbidden }), () => ({ reason: `imweb-referral:${referralKey(member())}` })]) {
    const summary = await runReferralWorker(config, { ...dependencies, preparePointAward });
    assert.equal(summary.failures, 1); assert.equal(summary.sendAttempts, 0);
    assert.equal(ledger.get(referralKey(member())).status, 'pending');
  }
  assert.ok(!events.includes('claim')); assert.ok(!events.includes('verify'));
});

for (const failure of ['sendError', 'proofError', 'wrongProof']) {
  test(`${failure} holds the reward without retry or budget release`, async t => {
    const { dependencies, ledger, state, events } = fixture(t);
    state[failure] = true;
    if (failure === 'wrongProof') dependencies.verifier = async () => ({ sourceVerified: true, amountWon: 3000 });
    const summary = await runReferralWorker(config, dependencies);
    assert.equal(summary.held, 1); assert.equal(summary.failures, 1); assert.equal(summary.paid, 0);
    const row = ledger.get(referralKey(member()));
    assert.equal(row.status, 'held'); assert.equal(row.amountWon, 3000);
    assert.equal(events.filter(event => event === 'send').length, 1);
    if (failure === 'sendError') assert.ok(!events.includes('verify'));
    for (let id = 2; id <= 10; id++) ledger.reserve(input(id));
    assert.equal(ledger.reserve(input(11)).reason, 'monthly_limit');
    assert.equal(ledger.claim(row.rewardKey), null);
  });
}

for (const status of ['dispatching', 'held']) {
  test(`existing ${status} reconciles only, including removed attribution and a later month`, async t => {
    const { dependencies, ledger, state, events } = fixture(t);
    const row = ledger.reserve(input()).record;
    ledger.claim(row.rewardKey, now);
    if (status === 'held') ledger.holdUnknown(row.rewardKey, now);
    state.members[1] = { ...member(), recommendTargetCode: null };
    const summary = await runReferralWorker({ ...config, now: '2026-10-01T00:00:00Z' }, dependencies);
    assert.equal(summary.reconciled, 1); assert.equal(summary.paid, 1);
    assert.equal(ledger.get(row.rewardKey).status, 'paid');
    assert.deepEqual(events.filter(event => event !== 'get'), ['read', 'pairs', 'unresolvedRecords', 'verify', 'verifyPaid']);
  });
}

test('failed reconciliation never prepares or resends; stored inviter also controls test allowlist', async t => {
  const { dependencies, ledger, state, events } = fixture(t);
  const row = ledger.reserve(input()).record;
  ledger.claim(row.rewardKey, now);
  state.proofError = true;
  assert.equal((await runReferralWorker(config, dependencies)).held, 1);
  assert.equal((await runReferralWorker(config, dependencies)).held, 1);
  const other = { ...inviter, memberCode: 'other', uid: 'other@example.test', recommendCode: 'OTHER' };
  state.members = [inviter, other, { ...member(), recommendTargetCode: other.recommendCode }];
  const before = events.length;
  const summary = await runReferralWorker({ ...config, testMode: true,
    allowlist: [{ memberCode: 'new-1', inviterCode: 'other' }] }, dependencies);
  assert.equal(summary.filtered, 1); assert.equal(summary.sendAttempts, 0);
  assert.ok(!events.slice(before).includes('verify'));
  assert.ok(!events.includes('prepare')); assert.ok(!events.includes('send'));
});

test('duplicates and monthly cap are enforced before preparation, and repeated runs do not send', async t => {
  const { dependencies, ledger, events } = fixture(t, 11);
  const summary = await runReferralWorker(config, { ...dependencies,
    referralPairs: members => { const pairs = referralPairs(members); return [...pairs, pairs[0]]; } });
  assert.equal(summary.paid, 10); assert.equal(summary.reserved, 10);
  assert.equal(summary.rejected, 1); assert.equal(summary.duplicates, 1);
  assert.equal(events.filter(event => event === 'prepare').length, 10);
  const rejected = Array.from({ length: 11 }, (_, n) => ledger.get(referralKey(member(n + 1)))).filter(row => row.status === 'rejected');
  assert.equal(rejected.length, 1);
  const before = events.length;
  const repeat = await runReferralWorker(config, dependencies);
  assert.equal(repeat.duplicates, 11); assert.equal(repeat.sendAttempts, 0);
  assert.ok(!events.slice(before).includes('prepare'));
});

test('competing workers can prepare but only the claim winner sends once', async t => {
  const { dependencies, ledger, events } = fixture(t);
  const summaries = await Promise.all([runReferralWorker(config, dependencies), runReferralWorker(config, dependencies)]);
  assert.equal(summaries.reduce((sum, item) => sum + item.sendAttempts, 0), 1);
  assert.equal(events.filter(event => event === 'send').length, 1);
  assert.equal(ledger.get(referralKey(member())).status, 'paid');
});

test('pending reservations cannot follow a changed canonical inviter', async t => {
  const { dependencies, ledger, state, events } = fixture(t);
  const row = ledger.reserve(input()).record;
  state.members[1] = { ...member(), recommendTargetCode: 'DIFFERENT' };
  const summary = await runReferralWorker(config, dependencies);
  assert.equal(summary.rejected, 1); assert.equal(summary.sendAttempts, 0);
  assert.equal(ledger.get(row.rewardKey).status, 'pending');
  assert.ok(!events.includes('prepare'));
});

test('invalid exclusions, clocks and prepare guards fail before the canonical scan', async t => {
  const { dependencies, events } = fixture(t);
  for (const excludedMemberCodes of [null, 'new-1', {}, [null], [''], [' '], [' new-1 '], ['inviter', 1], Array(1)]) {
    await assert.rejects(runReferralWorker({ ...config, excludedMemberCodes }, dependencies), /exclusions/);
  }
  for (const clock of [null, now, () => null, () => '2026-09-15', () => { throw new Error('private'); }]) {
    await assert.rejects(runReferralWorker(config, { ...dependencies, clock }), /Invalid referral clock/);
  }
  for (const beforePrepare of [null, true, 'true']) {
    await assert.rejects(runReferralWorker(config, { ...dependencies, beforePrepare }), /prepare guard/);
  }
  assert.deepEqual(events, []);
});

for (const apply of [false, true]) {
  for (const excludedCode of ['new-1', 'inviter']) {
    test(`${apply ? 'apply' : 'simulation'} excludes ${excludedCode} before reservation`, async t => {
      const { dependencies, ledger, events } = fixture(t, 2);
      const summary = await runReferralWorker({ ...config, apply, excludedMemberCodes: [excludedCode] }, dependencies);
      const expected = excludedCode === 'new-1' ? 1 : 0;
      assert.equal(summary.filtered, 2 - expected);
      assert.equal(summary.paid, apply ? expected : 0);
      assert.equal(summary.simulated, apply ? 0 : expected);
      assert.equal(summary.reserved, apply ? expected : 0);
      assert.equal(ledger.get(referralKey(member(1))), null);
      assert.equal(events.filter(event => event === 'reserve').length, apply ? expected : 0);
      assert.equal(summary.failures, 0);
    });
  }
}

test('exclusions override a test allowlist and block an existing pending reservation', async t => {
  const { dependencies, ledger, events } = fixture(t);
  const row = ledger.reserve(input()).record;
  for (const excludedCode of ['new-1', 'inviter']) {
    const summary = await runReferralWorker({ ...config, testMode: true,
      allowlist: [{ memberCode: 'new-1', inviterCode: 'inviter' }], excludedMemberCodes: [excludedCode] }, dependencies);
    assert.equal(summary.filtered, 1);
    assert.equal(summary.sendAttempts, 0);
    assert.deepEqual(ledger.get(row.rewardKey), row);
  }
  assert.ok(!events.includes('reserve')); assert.ok(!events.includes('prepare')); assert.ok(!events.includes('claim'));
});

test('the inviter bound by a competing reservation is checked against exclusions again', async t => {
  const { dependencies, ledger, state, events } = fixture(t);
  const other = { ...inviter, memberCode: 'excluded-inviter', uid: 'other@example.test', recommendCode: 'OTHER' };
  state.members.push(other);
  dependencies.ledger.reserve = value => ledger.reserve({ ...value, inviter: other,
    member: { ...value.member, recommendTargetCode: other.recommendCode } });
  const summary = await runReferralWorker({ ...config, excludedMemberCodes: [other.memberCode] }, dependencies);
  assert.equal(summary.filtered, 1); assert.equal(summary.sendAttempts, 0);
  assert.equal(ledger.get(referralKey(member())).inviterKey, referralKey(other));
  assert.ok(!events.includes('prepare')); assert.ok(!events.includes('claim'));
});

for (const status of ['pending', 'dispatching', 'held']) {
  for (const absent of ['invitee', 'inviter', 'both']) {
    test(`${status} with absent ${absent} is reported once without preparation, reconciliation or resend`, async t => {
      const { dependencies, ledger, state, events } = fixture(t);
      const reserved = ledger.reserve(input()).record;
      if (status !== 'pending') ledger.claim(reserved.rewardKey, now);
      if (status === 'held') ledger.holdUnknown(reserved.rewardKey, now);
      const before = ledger.get(reserved.rewardKey);
      state.members = absent === 'invitee' ? [inviter] : absent === 'inviter' ? [member()] : [];
      const summary = await runReferralWorker(config, { ...dependencies, beforePrepare: forbidden,
        preparePointAward: forbidden, verifier: forbidden });
      assert.equal(summary.unresolved, 1); assert.equal(summary.failures, 1);
      assert.equal(summary.held, status === 'held' ? 1 : 0);
      assert.equal(summary.sendAttempts, 0); assert.equal(summary.reconciled, 0);
      assert.equal(summary.reserved, 0); assert.equal(summary.claimed, 0);
      assert.deepEqual(ledger.get(reserved.rewardKey), before);
      assert.ok(!events.includes('holdUnknown')); assert.ok(!events.includes('reserve'));
    });
  }
}

test('unresolved scan errors abort before preparation and redact adapter errors', async t => {
  const { dependencies, events } = fixture(t);
  dependencies.ledger.unresolvedRecords = () => { throw new Error('private new1@example.test'); };
  await assert.rejects(runReferralWorker(config, dependencies), error =>
    /ledger operation failed/.test(error.message) && !error.message.includes('@'));
  assert.ok(!events.includes('reserve')); assert.ok(!events.includes('prepare'));
});

const septemberEnd = '2026-09-30T14:59:59Z';
const octoberStart = '2026-09-30T15:00:00Z';

test('an injected clock overrides fixed now and rejects old-month awards after the scan', async t => {
  const { dependencies, ledger, events } = fixture(t);
  let at = septemberEnd;
  const read = dependencies.readReferralMembers;
  const summary = await runReferralWorker(config, { ...dependencies, clock: () => at,
    readReferralMembers: async () => { const scan = await read(); at = octoberStart; return scan; } });
  assert.equal(summary.rejected, 1); assert.equal(summary.reserved, 0);
  assert.equal(summary.sendAttempts, 0); assert.equal(ledger.get(referralKey(member())), null);
  assert.ok(!events.includes('prepare'));
});

for (const stage of ['guard', 'prepare']) {
  test(`crossing KST midnight during ${stage} never claims or sends the old-month reservation`, async t => {
    const { dependencies, ledger, state, events } = fixture(t);
    let at = septemberEnd;
    const prepare = dependencies.preparePointAward;
    const guarded = { ...dependencies, clock: () => at,
      beforePrepare: async () => { if (stage === 'guard') at = octoberStart; return true; },
      preparePointAward: async (...args) => { const result = await prepare(...args); at = octoberStart; return result; } };
    const summary = await runReferralWorker(config, guarded);
    assert.equal(summary.reserved, 1); assert.equal(summary.rejected, 1);
    assert.equal(summary.prepared, stage === 'prepare' ? 1 : 0);
    assert.equal(summary.claimed, 0); assert.equal(summary.sendAttempts, 0);
    const row = ledger.get(referralKey(member()));
    assert.equal(row.status, 'pending'); assert.equal(row.month, '2026-09'); assert.equal(row.amountWon, 3000);
    assert.ok(!events.includes('claim')); assert.ok(!events.includes('send'));
    state.members.push(...Array.from({ length: 11 }, (_, n) => ({ ...member(n + 2), joinTime: octoberStart })));
    const october = await runReferralWorker(config, { ...dependencies, clock: () => at });
    assert.equal(october.paid, 10); assert.equal(october.sendAttempts, 10); assert.equal(october.rejected, 2);
    assert.deepEqual(ledger.get(row.rewardKey), row);
    assert.equal(ledger.get(referralKey(member(2))).month, '2026-10');
  });
}

test('fresh dispatch and proof timestamps are persisted while fixed now remains compatible', async t => {
  const { dependencies, ledger } = fixture(t);
  let at = now;
  const dispatchedAt = '2026-09-15T06:01:00Z';
  const verifiedAt = '2026-09-15T06:02:00Z';
  const prepare = dependencies.preparePointAward;
  const verify = dependencies.verifier;
  const summary = await runReferralWorker(config, { ...dependencies, clock: () => at,
    preparePointAward: async (...args) => {
      const prepared = await prepare(...args);
      at = dispatchedAt;
      return { ...prepared, send: async () => {
        assert.equal(ledger.get(referralKey(member())).updatedAt, new Date(dispatchedAt).toISOString());
        return prepared.send();
      } };
    },
    verifier: async value => { at = verifiedAt; return verify(value); },
  });
  assert.equal(summary.paid, 1);
  const row = ledger.get(referralKey(member()));
  assert.equal(row.createdAt, new Date(now).toISOString());
  assert.equal(row.updatedAt, new Date(verifiedAt).toISOString());
});

test('a claim that waits across midnight is held without sending or allowing a later resend', async t => {
  const { dependencies, ledger, events } = fixture(t);
  let at = '2026-09-30T14:58:59Z';
  const claim = dependencies.ledger.claim;
  dependencies.ledger.claim = (...args) => { const row = claim(...args); at = octoberStart; return row; };
  const summary = await runReferralWorker(config, { ...dependencies, clock: () => at });
  assert.equal(summary.claimed, 1); assert.equal(summary.held, 1);
  assert.equal(summary.rejected, 1); assert.equal(summary.failures, 1); assert.equal(summary.sendAttempts, 0);
  const row = ledger.get(referralKey(member()));
  assert.equal(row.status, 'held'); assert.equal(row.amountWon, 3000); assert.equal(row.month, '2026-09');
  assert.equal(row.updatedAt, new Date(octoberStart).toISOString());
  assert.ok(!events.includes('send')); assert.ok(!events.includes('verify'));
  const resumed = await runReferralWorker(config, { ...dependencies, clock: () => at,
    preparePointAward: forbidden, verifier: async () => null });
  assert.equal(resumed.sendAttempts, 0); assert.equal(resumed.held, 1);
  assert.equal(ledger.claim(row.rewardKey, octoberStart), null);
});

test('less than 60 seconds before KST month end rejects before claim; exactly 60 seconds permits dispatch', async t => {
  for (const remainingMs of [1, 59999, 60000]) {
    const { dependencies, ledger, events } = fixture(t);
    const at = new Date(Date.parse(octoberStart) - remainingMs).toISOString();
    const summary = await runReferralWorker({ ...config, now: at }, dependencies);
    const allowed = remainingMs === 60000;
    assert.equal(summary.rejected, allowed ? 0 : 1);
    assert.equal(summary.prepared, 1);
    assert.equal(summary.claimed, allowed ? 1 : 0);
    assert.equal(summary.sendAttempts, allowed ? 1 : 0);
    assert.equal(summary.failures, 0);
    const row = ledger.get(referralKey(member()));
    assert.equal(row.status, allowed ? 'paid' : 'pending');
    assert.equal(row.amountWon, 3000); assert.equal(row.month, '2026-09');
    assert.equal(events.includes('claim'), allowed); assert.equal(events.includes('send'), allowed);
  }
});

test('an invalid fresh clock after preparation aborts without claim or send', async t => {
  const { dependencies, ledger, events } = fixture(t);
  let at = now;
  const prepare = dependencies.preparePointAward;
  await assert.rejects(runReferralWorker(config, { ...dependencies, clock: () => at,
    preparePointAward: async (...args) => { const prepared = await prepare(...args); at = 'invalid'; return prepared; },
  }), /ledger operation failed/);
  assert.equal(ledger.get(referralKey(member())).status, 'pending');
  assert.ok(!events.includes('claim')); assert.ok(!events.includes('send'));
});

test('prepare guard requires exact approval and leaves denied or unreadable prior outcomes unsent', async t => {
  const { dependencies, ledger, events } = fixture(t);
  for (const beforePrepare of [() => false, () => undefined, () => null, () => 'true',
    () => ({ sourceVerified: true }), () => { throw new Error('private new1@example.test'); }]) {
    const summary = await runReferralWorker(config, { ...dependencies, beforePrepare });
    assert.equal(summary.failures, 1); assert.equal(summary.prepared, 0);
    assert.equal(summary.claimed, 0); assert.equal(summary.sendAttempts, 0);
    assert.equal(ledger.get(referralKey(member())).status, 'pending');
    assert.ok(!JSON.stringify(summary).includes('@'));
  }
  assert.ok(!events.includes('prepare'));
  const summary = await runReferralWorker(config, { ...dependencies, beforePrepare: async value => {
    events.push('guard');
    assert.equal(value.member.memberCode, member().memberCode);
    assert.equal(value.inviter.memberCode, inviter.memberCode);
    assert.equal(value.record.rewardKey, referralKey(member()));
    assert.equal(value.record.status, 'pending');
    return true;
  } });
  assert.equal(summary.paid, 1);
  assert.ok(events.indexOf('guard') < events.indexOf('prepare'));
  assert.equal((await runReferralWorker(config, { ...dependencies, beforePrepare: forbidden })).sendAttempts, 0);
});
