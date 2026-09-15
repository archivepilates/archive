import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { imwebJson, readReferralMembers, referralPairs, preparePointAward,
  IMWEB_REFERRAL_SCOPE as scope } from './lib/imweb-referral-source.mjs';
import { referralKey, awardReason, REFERRAL_POLICY } from './lib/imweb-referral-policy.mjs';
import { readCanonicalPointLogs } from './lib/imweb-referral-point-logs.mjs';
import { readPointAwardProof } from './lib/imweb-referral-proof.mjs';
import { ReferralLedger } from './lib/imweb-referral-ledger.mjs';
import { runReferralWorker } from './lib/imweb-referral-worker.mjs';

// One approved test pair only. Never use the production ledger or reset paid rows.
const root = '/Users/archivepilates/ArchiveIN/automation/referral-tests';
const original = `${root}/e2e-20260915-32ef405f25cc`;
const directory = `${root}/both-20260916`;
const journalPath = `${directory}/journal.json`;
const ledgerPath = `${original}/ledger.sqlite`;
const old = JSON.parse(fs.readFileSync(`${original}/journal.json`, 'utf8'));
const productionPath = '/Users/archivepilates/ArchiveIN/automation/referral-production/config.json';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const mode = process.argv[2] ?? '--preflight';
assert(['--preflight', '--apply', '--recover'].includes(mode), 'Unsupported mode');
let journal;
function save() {
  const temporary = `${journalPath}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(journal, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, journalPath);
  const parent = fs.openSync(directory, 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
function members() {
  const scan = readReferralMembers();
  if (mode === '--recover') {
    const saved = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    assert(saved.memberKey === old.memberKey && saved.inviterKey === old.inviterKey,
      'Recovery identity mismatch');
    const member = scan.members.find(m => referralKey(m) === saved.memberKey);
    const inviter = scan.members.find(m => referralKey(m) === saved.inviterKey);
    assert(member && inviter, 'Canonical recovery recipients missing');
    return { pair: { member, inviter }, scan };
  }
  const production = JSON.parse(fs.readFileSync(productionPath, 'utf8'));
  const pair = referralPairs(scan.members).find(p => referralKey(p.member) === old.memberKey &&
    p.inviter && referralKey(p.inviter) === old.inviterKey);
  assert(pair && [pair.member, pair.inviter].every(m => production.excludedMemberCodes.includes(m.memberCode)),
    'Exact excluded test pair required');
  assert(old.state === 'verified-restored', 'Historical test not restored');
  return { pair, scan };
}
function detail(member) {
  const { data } = imwebJson(['member', 'get', member.uid, '--unit-code', scope.unitCode]);
  assert(data?.uid === member.uid && referralKey(data) === referralKey(member) &&
    Number.isSafeInteger(data.point) && Array.isArray(data.group), 'Unexpected member response');
  return { point: data.point, groupHash: hash(data.group) };
}
const logs = member => readCanonicalPointLogs(member, { run: imwebJson, scope });
function proof(rows, reason, amount) {
  const matches = rows.filter(row => row.reason === reason);
  assert(matches.length <= 1, 'Duplicate provider reason');
  if (!matches.length) return false;
  assert(matches[0].changePoint === amount && matches[0].currency === 'KRW' &&
    matches[0].type === 'etc', 'Unexpected point-log amount');
  return true;
}
function change(member, role, direction, reason) {
  const stateKey = direction === 'increase' ? 'creditAttempted' : 'reversalAttempted';
  assert(!journal[role][stateKey], 'Prior send attempt exists; reconcile without retry');
  assert(!logs(member).some(row => row.reason === reason), 'Prior native operation exists');
  const args = ['promotion', 'point', 'change', 'member', member.uid, '--data', JSON.stringify({
    unitCode: scope.unitCode, changeType: direction, point: 3000, reason,
  })];
  const preview = imwebJson([...args, '--dry-run']);
  assert(typeof preview.confirmation_token === 'string' && preview.confirmation_token,
    'Missing dry-run confirmation');
  journal[role][stateKey] = true; save();
  imwebJson([...args, '--yes', '--confirm-token', preview.confirmation_token]);
}
async function worker(pair, role, allowSend) {
  const ledger = new ReferralLedger(ledgerPath, role);
  try {
    return await runReferralWorker({ enabled: true, apply: true, tested: true, role,
      policy: { ...REFERRAL_POLICY, enabled: true, startsAt: pair.member.joinTime },
      testMode: true, allowlist: [{ memberCode: pair.member.memberCode, inviterCode: pair.inviter.memberCode }],
    }, { ledger, readReferralMembers, verifier: input => readPointAwardProof(input),
      preparePointAward: (recipient, key, options) => {
        assert(allowSend && role === 'invitee' && key === old.memberKey &&
          referralKey(recipient) === old.memberKey && !journal.invitee.creditAttempted,
        'Unexpected payout preparation');
        const prepared = preparePointAward(recipient, key, options);
        return { reason: prepared.reason, send() {
          journal.invitee.creditAttempted = true; save(); return prepared.send();
        } };
      },
    });
  } finally { ledger.close(); }
}
async function restore(pair) {
  const errors = [];
  for (const [role, member] of [['invitee', pair.member], ['inviter', pair.inviter]]) {
    try {
      const entry = journal[role];
      const rows = logs(member);
      const credited = proof(rows, entry.reason, 3000);
      const reversed = proof(rows, entry.reversalReason, -3000);
      if (credited && !reversed) {
        assert(detail(member).point === entry.baseline.point + 3000, 'Unexpected balance; do not deduct');
        change(member, role, 'decrease', entry.reversalReason);
      }
      const finalRows = logs(member);
      const final = detail(member);
      assert(final.point === entry.baseline.point && final.groupHash === entry.baseline.groupHash,
        'Balance or groups not restored');
      if (entry.creditAttempted) assert(credited && proof(finalRows, entry.reversalReason, -3000),
        'Attempted award needs manual reconciliation');
      entry.final = final; entry.restored = true;
      entry.positiveLogs = finalRows.filter(row => row.reason === entry.reason).length;
      entry.reversalLogs = finalRows.filter(row => row.reason === entry.reversalReason).length;
      save();
    } catch { errors.push(role); }
  }
  assert(!errors.length, `Manual reconciliation required: ${errors.join(',')}`);
}

const { pair, scan } = members();
if (mode === '--preflight') {
  const ledger = new ReferralLedger(ledgerPath, 'inviter');
  try { assert(ledger.get(old.memberKey)?.status === 'paid', 'Historical paid guard missing'); }
  finally { ledger.close(); }
  for (const [role, member] of [['inviter', pair.inviter], ['invitee', pair.member]]) {
    const baseline = detail(member);
    const native = logs(member);
    console.log(role, { balance: baseline.point,
      historicRoleAwards: native.filter(row => row.reason === awardReason(old.memberKey, role)).length });
  }
  console.log(JSON.stringify({ mode, members: scan.members.length, exactExcludedPair: true, sends: 0 }));
} else {
  const lock = `${root}/both-20260916.lock`;
  const fd = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
  try {
    if (mode === '--recover') {
      journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      assert(journal.memberKey === old.memberKey && journal.inviterKey === old.inviterKey,
        'Recovery pair mismatch');
      await restore(pair);
      journal.state = 'restored-after-recovery'; save();
    } else {
      assert(!fs.existsSync(directory), 'Test already started; only recovery is permitted');
      fs.mkdirSync(directory, { mode: 0o700 });
      const db = new DatabaseSync(ledgerPath);
      try { db.exec(`VACUUM INTO '${directory}/ledger-before.sqlite'`); }
      finally { db.close(); }
      fs.chmodSync(`${directory}/ledger-before.sqlite`, 0o600);
      const inviterLedger = new ReferralLedger(ledgerPath, 'inviter');
      const inviteeLedger = new ReferralLedger(ledgerPath, 'invitee');
      try {
        assert(inviterLedger.get(old.memberKey)?.status === 'paid', 'Historical paid guard missing');
        assert(!inviteeLedger.get(old.memberKey), 'Invitee already recorded; no new test payout');
      } finally { inviterLedger.close(); inviteeLedger.close(); }
      assert(!logs(pair.member).some(row => row.reason === awardReason(old.memberKey, 'invitee')),
        'Invitee provider award exists');
      journal = { kind: 'approved-two-account-credit-reversal', state: 'prepared',
        at: new Date().toISOString(), memberKey: old.memberKey, inviterKey: old.inviterKey,
        inviter: { baseline: detail(pair.inviter), reason: 'imweb-referral-test:20260916:inviter',
          reversalReason: 'imweb-referral-test-reversal:20260916:inviter' },
        invitee: { baseline: detail(pair.member), reason: awardReason(old.memberKey, 'invitee'),
          reversalReason: 'imweb-referral-test-reversal:20260916:invitee' },
      }; save();
      let testError;
      try {
        journal.initialInviterDuplicate = await worker(pair, 'inviter', false); save();
        assert(journal.initialInviterDuplicate.duplicates === 1 &&
          journal.initialInviterDuplicate.sendAttempts === 0 && journal.initialInviterDuplicate.failures === 0,
        'Inviter historical duplicate guard failed');
        change(pair.inviter, 'inviter', 'increase', journal.inviter.reason);
        assert(proof(logs(pair.inviter), journal.inviter.reason, 3000), 'Inviter credit not verified');
        journal.inviteeWorker = await worker(pair, 'invitee', true); save();
        assert(journal.inviteeWorker.paid === 1 && journal.inviteeWorker.sendAttempts === 1 &&
          journal.inviteeWorker.failures === 0, 'Invitee worker did not verify exactly one award');
        for (const [role, member] of [['inviter', pair.inviter], ['invitee', pair.member]]) {
          journal[role].afterCredit = detail(member);
          assert(journal[role].afterCredit.point === journal[role].baseline.point + 3000,
            'Award balance mismatch');
          journal[role].duplicate = await worker(pair, role, false); save();
          assert(journal[role].duplicate.sendAttempts === 0 && journal[role].duplicate.duplicates === 1 &&
            journal[role].duplicate.failures === 0, 'Duplicate guard failed');
        }
        journal.state = 'credited-and-duplicates-verified'; save();
      } catch { testError = true; journal.state = 'test-failed'; save(); }
      finally { await restore(pair); }
      assert(!testError, 'Test assertion failed; balances restored; inspect private journal');
      journal.state = 'verified-restored'; journal.completedAt = new Date().toISOString(); save();
    }
    console.log(JSON.stringify({ state: journal.state, creditedPerMember: 3000,
      inviterFinal: journal.inviter.final.point, inviteeFinal: journal.invitee.final.point,
      groupsUnchanged: true, customersTouched: 0 }));
  } finally { fs.unlinkSync(lock); }
}
