import { execFileSync } from 'node:child_process';
import { referralKey } from './imweb-referral-policy.mjs';
import { readCanonicalPointLogs } from './imweb-referral-point-logs.mjs';

export const IMWEB_REFERRAL_SCOPE = Object.freeze({
  siteCode: 'S20260516852c71a014d08',
  unitCode: 'u2026051698c99ea234719',
});

export function imwebJson(args) {
  try {
    const result = JSON.parse(execFileSync('imweb', ['--profile', 'default', '--output', 'json', ...args], {
      encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    if (result.statusCode && result.statusCode !== 200) throw new Error();
    return result;
  } catch {
    // Provider responses can contain member identifiers and credentials.
    throw new Error('Imweb request failed; no automatic write retry is allowed.');
  }
}

export function readReferralMembers({ run = imwebJson, maxPages = 10, pageSize = 50 } = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('Invalid scan bounds');
  const context = run(['config', 'context']);
  if (context.resolved_profile?.site_code !== IMWEB_REFERRAL_SCOPE.siteCode ||
      context.resolved_profile?.unit_code !== IMWEB_REFERRAL_SCOPE.unitCode) throw new Error('Unexpected Imweb scope');
  const members = new Map();
  const cursors = new Set();
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const args = ['member', 'list', '--unit-code', IMWEB_REFERRAL_SCOPE.unitCode, '--limit', String(pageSize)];
    if (cursor) args.push('--cursor', cursor);
    const { data } = run(args);
    if (!Array.isArray(data?.list) || typeof data.hasNext !== 'boolean') throw new Error('Invalid member response');
    for (const row of data.list) {
      if (row.siteCode !== IMWEB_REFERRAL_SCOPE.siteCode || row.unitCode !== IMWEB_REFERRAL_SCOPE.unitCode ||
          typeof row.uid !== 'string' || !row.uid) throw new Error('Invalid member scope');
      const key = referralKey(row);
      const selected = Object.fromEntries(['siteCode', 'unitCode', 'memberCode', 'uid', 'email',
        'joinTime', 'recommendCode', 'recommendTargetCode'].map(field => [field, row[field]]));
      if (members.has(key) && JSON.stringify(members.get(key)) !== JSON.stringify(selected)) {
        throw new Error('Conflicting member records; rescan before any awards');
      }
      members.set(key, selected);
    }
    if (!data.hasNext) return { members: [...members.values()], pages: page + 1, complete: true };
    if (typeof data.nextCursor !== 'string' || !data.nextCursor || cursors.has(data.nextCursor)) {
      throw new Error('Invalid member pagination');
    }
    cursor = data.nextCursor;
    cursors.add(cursor);
  }
  throw new Error('Member scan incomplete; no awards allowed');
}

export function referralPairs(members) {
  const codes = new Map();
  for (const member of members) {
    if (!member.recommendCode) continue;
    if (codes.has(member.recommendCode)) throw new Error('Ambiguous inviter code');
    codes.set(member.recommendCode, member);
  }
  return members.filter(member => member.recommendTargetCode).sort((a, b) =>
    Date.parse(a.joinTime) - Date.parse(b.joinTime) || a.memberCode.localeCompare(b.memberCode)
  ).map(member => ({ member, inviter: codes.get(member.recommendTargetCode) || null }));
}

export function preparePointAward(member, rewardKey, { run = imwebJson } = {}) {
  referralKey(member);
  if (member.siteCode !== IMWEB_REFERRAL_SCOPE.siteCode || member.unitCode !== IMWEB_REFERRAL_SCOPE.unitCode ||
      typeof member.uid !== 'string' || !member.uid.trim() ||
      !/^[a-f0-9]{64}$/.test(rewardKey)) throw new Error('Invalid award target');
  // A restored or stale local ledger must never repeat an earlier provider award.
  const prior = readCanonicalPointLogs(member, { run, scope: IMWEB_REFERRAL_SCOPE });
  if (prior.some(row => row.reason === `imweb-referral:${rewardKey}`)) {
    throw new Error('Prior provider award exists; manual reconciliation required');
  }
  const data = JSON.stringify({ unitCode: IMWEB_REFERRAL_SCOPE.unitCode, changeType: 'increase',
    point: 3000, reason: `imweb-referral:${rewardKey}` });
  const args = ['promotion', 'point', 'change', 'member', member.uid, '--data', data];
  const dryRun = run([...args, '--dry-run']);
  if (typeof dryRun.confirmation_token !== 'string' || !dryRun.confirmation_token) throw new Error('Missing provider confirmation');
  let used = false;
  return {
    reason: `imweb-referral:${rewardKey}`,
    send() {
      if (used) throw new Error('Award attempt already consumed');
      used = true;
      return run([...args, '--yes', '--confirm-token', dryRun.confirmation_token]);
    },
  };
}
