import { REFERRAL_POLICY, assessReferral, kstMonth, referralKey } from './imweb-referral-policy.mjs';
import { readReferralMembers as readMembers, referralPairs as makePairs,
  preparePointAward as prepareAward } from './imweb-referral-source.mjs';

const pairKey = (memberCode, inviterCode) => JSON.stringify([memberCode, inviterCode]);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const hasDispatchWindow = value => {
  const instant = Date.parse(value);
  const offset = 9 * 60 * 60 * 1000;
  const local = new Date(instant + offset);
  const nextMonth = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - offset;
  // Leave room for the provider's 45-second CLI timeout before KST month rollover.
  return nextMonth - instant >= 60000;
};

// No CLI entrypoint. The caller owns the ledger and supplies a verified native-log adapter.
// verifier({ member, inviter, record, sendResult }) returns proof for ledger.verifyPaid.
// clock() returns a timezone-qualified timestamp; config.now is a fixed test-clock fallback.
// Optional beforePrepare({ member, inviter, record }) must return exactly true to permit preparation.
// Simulation ignores the persistent ledger; its counts assume an empty starting budget.
export async function runReferralWorker(config = {}, dependencies = {}) {
  const summary = { disabled: 1, pages: 0, members: 0, pairs: 0, filtered: 0, simulated: 0,
    reserved: 0, rejected: 0, duplicates: 0, prepared: 0, claimed: 0, sendAttempts: 0,
    paid: 0, reconciled: 0, held: 0, unresolved: 0, failures: 0 };
  if (config.enabled !== true) return summary;
  summary.disabled = 0;
  const apply = config.apply === true;
  const policy = { ...REFERRAL_POLICY, ...config.policy };
  const { readReferralMembers = readMembers, referralPairs = makePairs,
    preparePointAward = prepareAward, ledger, verifier, beforePrepare,
    clock = () => config.now ?? new Date().toISOString() } = dependencies;
  if (typeof clock !== 'function') throw new Error('Invalid referral clock');
  if (beforePrepare !== undefined && typeof beforePrepare !== 'function') throw new Error('Invalid referral prepare guard');
  const readNow = () => {
    try { const value = clock(); kstMonth(value); return value; }
    catch { throw new Error('Invalid referral clock'); }
  };
  const now = readNow();
  if (apply) {
    let active = false;
    try {
      kstMonth(policy.startsAt); kstMonth(now);
      active = policy.enabled === true && Date.parse(policy.startsAt) <= Date.parse(now) &&
        policy.rewardWon === 3000 && policy.monthlyLimitWon === 30000 && nonempty(policy.version);
    } catch { /* Invalid activation cannot authorize a scan or payout. */ }
    if (config.tested !== true || !active) throw new Error('Referral apply requires tested approval and an active policy');
    if (typeof verifier !== 'function') throw new Error('Referral apply requires a verified native-log adapter');
    if (!['reserve', 'get', 'unresolvedRecords', 'claim', 'holdUnknown', 'verifyPaid'].every(name => typeof ledger?.[name] === 'function')) {
      throw new Error('Referral apply requires a durable ledger');
    }
  }
  if (config.testMode !== undefined && typeof config.testMode !== 'boolean') throw new Error('Invalid referral test mode');
  const allowlist = config.allowlist;
  if ((config.testMode === true && (!Array.isArray(allowlist) || !allowlist.length)) ||
      (allowlist !== undefined && (!Array.isArray(allowlist) || allowlist.some(pair =>
        !nonempty(pair?.memberCode) || !nonempty(pair?.inviterCode))))) throw new Error('Exact referral test pairs required');
  const allowed = allowlist === undefined ? null : new Set(allowlist.map(pair => pairKey(pair.memberCode, pair.inviterCode)));
  const excludedMemberCodes = config.excludedMemberCodes === undefined ? [] : config.excludedMemberCodes;
  if (!Array.isArray(excludedMemberCodes) || Array.from(excludedMemberCodes).some(code =>
    !nonempty(code) || code !== code.trim())) {
    throw new Error('Invalid referral exclusions');
  }
  const excluded = new Set(excludedMemberCodes);
  const permits = (member, inviter) => !excluded.has(member.memberCode) && !excluded.has(inviter?.memberCode) &&
    (!allowed || allowed.has(pairKey(member.memberCode, inviter?.memberCode)));

  let members, pairs, byKey;
  try {
    const scan = await readReferralMembers();
    if (scan?.complete !== true || !Array.isArray(scan.members) || !Number.isInteger(scan.pages) || scan.pages < 1) throw new Error();
    members = structuredClone(scan.members);
    byKey = new Map(members.map(member => [referralKey(member), member]));
    pairs = await referralPairs(members);
    if (!Array.isArray(pairs)) throw new Error();
    pairs = pairs.map(pair => {
      const member = byKey.get(referralKey(pair.member));
      const inviter = pair.inviter ? byKey.get(referralKey(pair.inviter)) : null;
      if (!member || (pair.inviter && !inviter)) throw new Error();
      return { member, inviter };
    });
    summary.pages = scan.pages; summary.members = members.length; summary.pairs = pairs.length;
  } catch { throw new Error('Complete unambiguous canonical referral scan required; no awards attempted'); }

  const seen = new Set();
  const budgets = new Map();
  const paired = new Set(pairs.map(pair => referralKey(pair.member)));
  // Also find previously dispatched rewards whose native attribution was later removed.
  if (apply) pairs.push(...members.filter(member => !paired.has(referralKey(member))).map(member => ({ member, inviter: null })));
  const hold = key => {
    ledger.holdUnknown(key, readNow());
    const status = ledger.get(key)?.status;
    if (status === 'held') summary.held++;
    else if (status === 'paid') summary.duplicates++;
    else throw new Error('Unable to persist referral hold');
  };
  const reconcile = async (member, inviter, record, sendResult, existing) => {
    try {
      const proof = await verifier({ member, inviter, record, sendResult });
      if (ledger.verifyPaid(record.rewardKey, proof, readNow()) === true) {
        summary.paid++; if (existing) summary.reconciled++;
        return;
      }
    } catch { /* An acknowledgement or unreadable log is not payment proof. */ }
    summary.failures++;
    hold(record.rewardKey);
  };
  const canDispatch = (member, inviter, row, at) => {
    const decision = assessReferral({ member, inviter, now: at, policy, sourceVerified: true });
    return row.status === 'pending' && decision.eligible && decision.month === row.month && decision.rewardWon === row.amountWon;
  };

  try {
    // Ledger rows remain operator-visible even if either canonical member disappears.
    const missingMembers = new Set();
    if (apply) {
      for (const row of ledger.unresolvedRecords()) {
        if (byKey.has(row.rewardKey) && byKey.has(row.inviterKey)) continue;
        missingMembers.add(row.rewardKey);
        summary.unresolved++; summary.failures++;
        if (row.status === 'held') summary.held++;
      }
    }
    for (const pair of pairs) {
      const { member } = pair;
      const key = referralKey(member);
      if (seen.has(key)) { summary.duplicates++; continue; }
      seen.add(key);
      if (missingMembers.has(key)) continue;
      let row = apply ? ledger.get(key) : null;
      if (!row && !member.recommendTargetCode) continue;
      let inviter = row ? byKey.get(row.inviterKey) : pair.inviter;
      if (!permits(member, inviter)) { summary.filtered++; continue; }
      const input = { member, inviter, now: readNow(), policy, sourceVerified: true };
      if (!apply) {
        const initial = assessReferral(input);
        if (!initial.eligible) { summary.rejected++; continue; }
        const budgetKey = `${referralKey(inviter)}:${initial.month}`;
        const total = budgets.get(budgetKey) || 0;
        const decision = assessReferral({ ...input, monthlyReservedWon: total });
        if (decision.eligible) { summary.simulated++; budgets.set(budgetKey, total + decision.rewardWon); }
        else summary.rejected++;
        continue;
      }
      if (!row) {
        const reservation = ledger.reserve(input);
        row = reservation.record;
        if (reservation.eligible) summary.reserved++;
        else if (reservation.reason !== 'already_recorded' || !row) { summary.rejected++; continue; }
      }
      // A competing reservation may have bound a different inviter: never substitute it.
      inviter = byKey.get(row.inviterKey);
      if (!permits(member, inviter)) { summary.filtered++; continue; }
      if (['paid', 'rejected'].includes(row.status)) { summary.duplicates++; continue; }
      if (!inviter) { summary.failures++; continue; }
      if (['dispatching', 'held'].includes(row.status)) {
        await reconcile(member, inviter, row, undefined, true);
        continue;
      }
      if (!canDispatch(member, inviter, row, readNow())) {
        summary.rejected++; continue;
      }
      let prepared;
      try {
        if (beforePrepare && await beforePrepare({ member, inviter, record: row }) !== true) {
          throw new Error('Referral prepare guard did not authorize preparation');
        }
        if (!canDispatch(member, inviter, row, readNow())) { summary.rejected++; continue; }
        prepared = await preparePointAward(inviter, key);
        if (prepared?.reason !== row.providerReason || typeof prepared.send !== 'function') throw new Error();
        summary.prepared++;
      } catch { summary.failures++; continue; }
      const dispatchAt = readNow();
      if (!canDispatch(member, inviter, row, dispatchAt) || !hasDispatchWindow(dispatchAt)) { summary.rejected++; continue; }
      const claimed = ledger.claim(key, dispatchAt);
      if (!claimed) { summary.duplicates++; continue; }
      summary.claimed++;
      // A synchronous SQLite claim can wait for another writer across midnight.
      const sendAt = readNow();
      if (!canDispatch(member, inviter, row, sendAt) || !hasDispatchWindow(sendAt)) {
        summary.rejected++; summary.failures++; hold(key); continue;
      }
      let sendResult;
      try { summary.sendAttempts++; sendResult = await prepared.send(); }
      catch { summary.failures++; hold(key); continue; }
      await reconcile(member, inviter, claimed, sendResult, false);
    }
  } catch { throw new Error('Referral ledger operation failed; stop and reconcile before resuming'); }
  return summary;
}
