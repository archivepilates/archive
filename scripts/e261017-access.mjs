import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { imwebJson, readReferralMembers, IMWEB_REFERRAL_SCOPE } from './lib/imweb-referral-source.mjs';
import { STAFF_GRADE, protectedPurchaseGroups } from './lib/imweb-staff-video-policy.mjs';
import { MEMBER_GROUP_LOCK, staffPages } from './lib/imweb-staff-video-sync.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';

export const GROUP = 'g2026101715ef28611dff4';
export const POLICY_ID = 'e261017-grant-40d-v1';
export const DAYS = 40;
const DAY_MS = 86400000;
const STATE_DIR = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES/student-share-e-261017');
const MEMBER_FIELDS = ['uid', 'memberCode', 'name', 'unitCode', 'siteCode', 'callnum', 'email', 'grade', 'point', 'coupon'];
const memberHash = member => createHash('sha256').update(JSON.stringify(MEMBER_FIELDS.map(key => member[key]))).digest('hex');

export function groupCodes(member) {
  if (!Array.isArray(member.group)) throw Error('Missing member groups');
  const values = member.group.map(value => typeof value === 'string' ? value : value?.groupCode || value?.code);
  if (values.some(value => typeof value !== 'string' || !value)) throw Error('Invalid member group');
  return [...new Set(values)];
}

function instant(value) {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw Error('Explicit timestamp with timezone required');
  }
  return Date.parse(value);
}

export function entitlementFromGrant(memberCode, grant, now) {
  if (!/^m[0-9a-f]+$/.test(memberCode) || grant.status !== 'group_verified'
      || !Array.isArray(grant.beforeGroups) || grant.beforeGroups.includes(GROUP)
      || !grant.afterGroups?.includes(GROUP) || grant.existingGroupsPreserved !== true) {
    throw Error('First verified E-team grant evidence required');
  }
  const start = instant(grant.verifiedAt);
  if (grant.grantedAt !== undefined && instant(grant.grantedAt) !== start) throw Error('Conflicting first grant timestamps');
  if (start > now) throw Error('Grant timestamp is in the future');
  return { policyId: POLICY_ID, memberCode, groupCode: GROUP,
    grantedAt: new Date(start).toISOString(), expiresAt: new Date(start + DAYS * DAY_MS).toISOString(),
    status: 'active', grantEvidence: 'manualImmediateGrants:first_verified_transition' };
}

export function removalPlan(member, entitlement, now) {
  if (member.memberCode !== entitlement.memberCode || member.siteCode !== IMWEB_REFERRAL_SCOPE.siteCode
      || member.unitCode !== IMWEB_REFERRAL_SCOPE.unitCode || entitlement.policyId !== POLICY_ID
      || entitlement.groupCode !== GROUP || !['active', 'revoked', 'removed_externally'].includes(entitlement.status)
      || instant(entitlement.expiresAt) !== instant(entitlement.grantedAt) + DAYS * DAY_MS) {
    throw Error('Member or entitlement scope mismatch');
  }
  const beforeGroups = groupCodes(member);
  if (entitlement.status === 'revoked' || entitlement.status === 'removed_externally') return { action: 'terminal' };
  if (instant(entitlement.expiresAt) > now) return { action: 'not_due' };
  if (entitlement.revocation?.status === 'intent' || entitlement.revocation?.status === 'result_unknown') {
    if (!beforeGroups.includes(GROUP)) return { action: 'reconcile_absent_unknown' };
    return { action: 'review_unknown_result' };
  }
  if (!beforeGroups.includes(GROUP)) return { action: 'already_absent' };
  if (member.grade === STAFF_GRADE) return { action: 'staff_access_preserved' };
  return { action: 'remove_group_only', beforeGroups, afterGroups: beforeGroups.filter(code => code !== GROUP) };
}

export function verifyRemoval(before, after, expected) {
  if (MEMBER_FIELDS.some(key => !isDeepStrictEqual(before[key], after[key]))) throw Error('Unrelated member field changed');
  if (!isDeepStrictEqual([...groupCodes(after)].sort(), [...expected].sort())) throw Error('Group-only removal readback mismatch');
}

export function reconcile(state, { now = Date.now(), apply = false, adopt = false,
  run = imwebJson, save = () => {} } = {}) {
  if (!apply) state = structuredClone(state);
  if (state.accessPolicy?.id !== POLICY_ID || state.accessPolicy?.approved !== true
      || state.accessPolicy?.days !== DAYS || state.accessPolicy?.basis !== 'first_verified_grant'
      || state.accessPolicy?.revocation !== 'e_team_group_only') throw Error('Approved access policy required');
  const members = readReferralMembers({ run, maxPages: 100 }).members;
  state.entitlements ??= {};
  const outcomes = [];
  const memberFor = code => {
    const matches = members.filter(member => member.memberCode === code);
    if (matches.length !== 1) throw Error('Recorded member not uniquely found');
    const member = run(['member', 'get', matches[0].uid]).data;
    if (member?.memberCode !== code || member.siteCode !== IMWEB_REFERRAL_SCOPE.siteCode
        || member.unitCode !== IMWEB_REFERRAL_SCOPE.unitCode) throw Error('Member detail scope mismatch');
    return member;
  };
  const verifyGroupAbsence = code => {
    const groupMembers = run(['member', 'groups', 'members', GROUP]).data;
    const rows = Array.isArray(groupMembers) ? groupMembers : groupMembers?.list;
    if (!Array.isArray(rows) || (groupMembers?.totalCount !== undefined && groupMembers.totalCount !== rows.length)
        || rows.some(row => row.memberCode === code)) throw Error('Independent group readback failed');
  };
  if (adopt) {
    for (const [code, grant] of Object.entries(state.manualImmediateGrants || {})) {
      if (state.entitlements[code]) continue;
      const entry = entitlementFromGrant(code, grant, now);
      if (!groupCodes(memberFor(code)).includes(GROUP)) throw Error('Recorded grant is not currently present');
      outcomes.push({ memberCode: code, action: 'adopt_verified_grant', expiresAt: entry.expiresAt });
      if (apply) { state.entitlements[code] = entry; save(state); }
    }
  }
  for (const [code, entry] of Object.entries(state.entitlements)) {
    if (code !== entry.memberCode) throw Error('Entitlement key mismatch');
    const before = memberFor(code);
    const plan = removalPlan(before, entry, now);
    outcomes.push({ memberCode: code, action: plan.action, expiresAt: entry.expiresAt });
    if (plan.action === 'review_unknown_result') throw Error('Prior removal result unresolved; do not repeat write');
    if (!apply || ['terminal', 'not_due', 'staff_access_preserved'].includes(plan.action)) continue;
    if (plan.action === 'reconcile_absent_unknown') {
      const receipt = entry.revocation;
      if (!Array.isArray(receipt.beforeGroups) || !Array.isArray(receipt.afterGroups)
          || !isDeepStrictEqual(receipt.beforeGroups.filter(group => group !== GROUP), receipt.afterGroups)
          || receipt.afterGroups.some(group => !groupCodes(before).includes(group))
          || receipt.memberInvariantHash !== memberHash(before)) {
        throw Error('Unknown removal requires preservation reconciliation; unrelated member data may have changed');
      }
      verifyGroupAbsence(code);
      entry.status = 'revoked'; entry.revocation.status = 'verified_reconciled';
      entry.verifiedAt = new Date(now).toISOString(); save(state); continue;
    }
    if (plan.action === 'already_absent') {
      verifyGroupAbsence(code);
      entry.status = 'removed_externally';
      entry.verifiedAt = new Date(now).toISOString(); save(state); continue;
    }
    const args = ['member', 'update', 'groups', before.uid, '--data', JSON.stringify({
      unitCode: IMWEB_REFERRAL_SCOPE.unitCode, groupCodes: plan.afterGroups,
    })];
    const dry = run([...args, '--dry-run']);
    if (typeof dry.confirmation_token !== 'string' || !dry.confirmation_token) throw Error('Missing confirmation token');
    const orders = staffPages(run, ['order', 'list', '--unit-code', IMWEB_REFERRAL_SCOPE.unitCode]);
    if (protectedPurchaseGroups(orders, code, now).includes(GROUP)) {
      outcomes.at(-1).action = 'purchased_access_preserved'; continue;
    }
    const fresh = memberFor(code);
    verifyRemoval(before, fresh, plan.beforeGroups);
    entry.revocation = { status: 'intent', attemptedAt: new Date(now).toISOString(),
      beforeGroups: plan.beforeGroups, afterGroups: plan.afterGroups, memberInvariantHash: memberHash(before) };
    save(state);
    try {
      run([...args, '--yes', '--confirm-token', dry.confirmation_token]);
      const after = memberFor(code);
      verifyRemoval(before, after, plan.afterGroups);
      verifyGroupAbsence(code);
      entry.status = 'revoked'; entry.revocation.status = 'verified';
      entry.verifiedAt = new Date(now).toISOString(); save(state);
    } catch {
      entry.revocation.status = 'result_unknown'; save(state);
      throw Error('Group removal or readback failed; reconcile live state before retry');
    }
  }
  if (apply) {
    state.accessPolicy.lastCheckedAt = new Date(now).toISOString();
    state.accessPolicy.lastRun = { adopted: outcomes.filter(x => x.action === 'adopt_verified_grant').length,
      due: outcomes.filter(x => x.action === 'remove_group_only').length,
      active: Object.values(state.entitlements).filter(x => x.status === 'active').length };
    save(state);
  }
  return outcomes;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--adopt-verified-grants'].includes(arg))) throw Error('Unsupported argument; time override is forbidden');
  const file = path.join(STATE_DIR, 'state.json');
  const lock = path.join(STATE_DIR, 'run.lock');
  const release = await acquireStudioMateBrowserLock({ lockPath: MEMBER_GROUP_LOCK,
    owner: 'imweb-e261017-access', waitMs: 0, staleMs: 600000 });
  let fd;
  try {
    fd = fs.openSync(lock, 'wx', 0o600);
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, operation: 'e261017-access', startedAt: new Date().toISOString() }));
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const save = data => {
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, file);
    };
    console.log(JSON.stringify({ ok: true, mode: args.includes('--apply') ? 'apply' : 'read_only',
      outcomes: reconcile(state, { apply: args.includes('--apply'), adopt: args.includes('--adopt-verified-grants'), save }) }, null, 2));
  } finally {
    try {
      if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(lock); }
    } finally { await release(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
