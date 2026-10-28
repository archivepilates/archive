import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { referralKey, awardReason } from './imweb-referral-policy.mjs';
import { readCanonicalPointLogs } from './imweb-referral-point-logs.mjs';
import { imwebRequestFailure, isTransientReadFailure, sanitizeImwebFailureDetails } from './imweb-read-failure.mjs';
import { runApprovedImwebWrite } from './imweb-native-followup.mjs';

export const IMWEB_REFERRAL_SCOPE = Object.freeze({
  siteCode: 'S20260516852c71a014d08',
  unitCode: 'u2026051698c99ea234719',
});

export function imwebJson(args, { execute = execFileSync,
  wait = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds) } = {}) {
  const readOnly = args[0] === 'member' && args[1] === 'list';
  const operation = readOnly ? 'member_list' : args[0] === 'config' && args[1] === 'context' ? 'config_context' : 'other_request';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = JSON.parse(execute(process.env.IMWEB_CLI_BIN || path.join(os.homedir(), '.local/bin/imweb'), ['--profile', 'default', '--output', 'json', ...args], {
        encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw Object.assign(new Error(), { failureKind: 'invalid_envelope' });
      }
      if (result.ok === false || result.error != null
        || [result.statusCode, result.status_code].some(status => status !== undefined && Number(status) !== 200)) {
        throw Object.assign(new Error(), { stdout: JSON.stringify(result) });
      }
      return result;
    } catch (error) {
      // Provider responses can contain member identifiers and credentials.
      const failure = imwebRequestFailure(error, { readOnly, operation });
      failure.failureDetails = sanitizeImwebFailureDetails({ ...failure.failureDetails,
        ...(readOnly ? { readAttempts: attempt + 1 } : {}),
        failureKind: error instanceof SyntaxError ? 'invalid_json' : error.failureKind || failure.failureDetails.failureKind });
      if (attempt === 0 && isTransientReadFailure(failure)) { wait(500); continue; }
      throw failure;
    }
  }
}

// Opt-in approved writes share a durable action key across CLI and native admin.
// The caller retains its domain lock and verifies the target identity/readback.
export async function imwebApprovedJson(args, { payload, operation, targetRef, store,
  execute = execFileSync } = {}) {
  if (!Array.isArray(args) || args.length < 3 || args.some(value => typeof value !== 'string' || value.startsWith('--'))
      || args.slice(0, -1).join('.') !== operation?.approvedScope?.action
      || !operation.approvedScope.targetIds.includes(targetRef)
      || args[0] === 'product' && args.at(-1) !== targetRef
      || !['product.update.status', 'product.update.classification', 'member.update.groups'].includes(operation.approvedScope.action)
      || !payload || Object.getPrototypeOf(payload) !== Object.prototype
      || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify([...operation.approvedScope.fields].sort())) {
    throw new Error('Approved Imweb command/scope mismatch');
  }
  const context = imwebJson(['config', 'context'], { execute });
  if (context.resolved_profile?.site_code !== operation.siteCode
      || context.resolved_profile?.unit_code !== operation.unitCode) throw new Error('Approved Imweb site/unit mismatch');
  if (args[0] === 'member') {
    const member = imwebJson(['member', 'get', args.at(-1)], { execute }).data;
    if (member?.memberCode !== targetRef || member.uid !== args.at(-1)
        || member.siteCode !== operation.siteCode || member.unitCode !== operation.unitCode
        || payload.unitCode !== operation.unitCode) throw new Error('Approved Imweb member identity mismatch');
  }
  return runApprovedImwebWrite({ operation, payload, store, execute: body => {
    const command = [...args, '--data', JSON.stringify(body)];
    const dry = imwebJson([...command, '--dry-run'], { execute });
    if (typeof dry.confirmation_token !== 'string' || !dry.confirmation_token) throw new Error('Missing Imweb confirmation');
    return imwebJson([...command, '--yes', '--confirm-token', dry.confirmation_token], { execute });
  } });
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

export function preparePointAward(member, rewardKey, { run = imwebJson, role = 'inviter' } = {}) {
  const reason = awardReason(rewardKey, role);
  referralKey(member);
  if (member.siteCode !== IMWEB_REFERRAL_SCOPE.siteCode || member.unitCode !== IMWEB_REFERRAL_SCOPE.unitCode ||
      typeof member.uid !== 'string' || !member.uid.trim() ||
      !/^[a-f0-9]{64}$/.test(rewardKey)) throw new Error('Invalid award target');
  // A restored or stale local ledger must never repeat an earlier provider award.
  const prior = readCanonicalPointLogs(member, { run, scope: IMWEB_REFERRAL_SCOPE });
  if (prior.some(row => row.reason === reason)) {
    throw new Error('Prior provider award exists; manual reconciliation required');
  }
  const data = JSON.stringify({ unitCode: IMWEB_REFERRAL_SCOPE.unitCode, changeType: 'increase',
    point: 3000, reason });
  const args = ['promotion', 'point', 'change', 'member', member.uid, '--data', data];
  const dryRun = run([...args, '--dry-run']);
  if (typeof dryRun.confirmation_token !== 'string' || !dryRun.confirmation_token) throw new Error('Missing provider confirmation');
  let used = false;
  return {
    reason,
    send() {
      if (used) throw new Error('Award attempt already consumed');
      used = true;
      return run([...args, '--yes', '--confirm-token', dryRun.confirmation_token]);
    },
  };
}
