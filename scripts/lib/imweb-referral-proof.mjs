import { createHash } from 'node:crypto';
import { imwebJson, IMWEB_REFERRAL_SCOPE as scope } from './imweb-referral-source.mjs';
import { referralKey, awardReason, awardRole } from './imweb-referral-policy.mjs';

const time = value => typeof value === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(value)
  ? Date.parse(value) : NaN;

// Imweb exposes no log ID here. This fingerprint is a derived reference to a
// unique observed row, not a provider-issued ID or proof of current net balance.
export function readPointAwardProof({ member, inviter: sourceInviter, record }, {
  run = imwebJson, maxPages = 10, pageSize = 50, now = new Date().toISOString(),
} = {}) {
  const role = awardRole(record?.role);
  const inviter = role === 'invitee' ? member : sourceInviter;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('Invalid log scan bounds');
  if (inviter?.siteCode !== scope.siteCode || inviter?.unitCode !== scope.unitCode ||
      typeof inviter.uid !== 'string' || !inviter.uid.trim() ||
      (role === 'invitee' ? record?.rewardKey : record?.inviterKey) !== referralKey(inviter) || !/^[a-f0-9]{64}$/.test(record.rewardKey) ||
      record.providerReason !== awardReason(record.rewardKey, role) || record.amountWon !== 3000 ||
      !Number.isFinite(time(record.createdAt)) || !Number.isFinite(time(now))) {
    throw new Error('Invalid canonical award record');
  }
  const context = run(['config', 'context']);
  if (context.resolved_profile?.site_code !== scope.siteCode ||
      context.resolved_profile?.unit_code !== scope.unitCode) throw new Error('Unexpected Imweb scope');
  const rows = [];
  const seen = new Set();
  let expectedCount;
  let expectedPages;
  for (let page = 1; page <= maxPages; page++) {
    const { data } = run(['promotion', 'point', 'log', '--unit-code', scope.unitCode,
      '--member-uid', inviter.uid, '--page', String(page), '--limit', String(pageSize)]);
    if (!Array.isArray(data?.list) || data.currentPage !== page || data.pageSize !== pageSize ||
        !Number.isSafeInteger(data.totalCount) || data.totalCount < 0 ||
        !Number.isSafeInteger(data.totalPage) || data.totalPage < 0 ||
        data.totalPage !== Math.ceil(data.totalCount / pageSize) ||
        data.list.length !== Math.min(pageSize, Math.max(0, data.totalCount - (page - 1) * pageSize))) {
      throw new Error('Invalid point-log response');
    }
    if (page === 1) { expectedCount = data.totalCount; expectedPages = data.totalPage; }
    if (data.totalCount !== expectedCount || data.totalPage !== expectedPages) {
      throw new Error('Point logs changed during scan; reconcile again without a write');
    }
    if (expectedPages > maxPages) throw new Error('Point-log scan incomplete');
    for (const row of data.list) {
      if (row?.unitCode !== scope.unitCode || row.memberCode !== inviter.memberCode ||
          row.memberUid !== inviter.uid || typeof row.reason !== 'string' ||
          !Number.isSafeInteger(row.changePoint) || !Number.isFinite(time(row.time))) {
        throw new Error('Unexpected point-log recipient or format');
      }
      const signature = JSON.stringify([row.unitCode, row.memberCode, row.memberUid, row.time,
        row.reason, row.changePoint, row.currency, row.type]);
      if (seen.has(signature)) throw new Error('Duplicate point-log rows; manual reconciliation required');
      seen.add(signature);
      rows.push(row);
    }
    if (page >= expectedPages) {
      if (rows.length !== expectedCount) throw new Error('Point-log scan incomplete');
      const matches = rows.filter(row => row.reason === record.providerReason);
      if (matches.length !== 1) return null;
      const row = matches[0];
      if (row.changePoint !== record.amountWon || row.currency !== 'KRW' || row.type !== 'etc' ||
          time(row.time) < time(record.createdAt) - 1000 || time(row.time) > time(now) + 1000) return null;
      const fingerprint = createHash('sha256').update(JSON.stringify([
        scope.siteCode, row.unitCode, row.memberCode, row.memberUid, row.time,
        row.reason, row.changePoint, row.currency, row.type,
      ])).digest('hex');
      return { sourceVerified: true, member: inviter, amountWon: row.changePoint,
        reason: row.reason, logId: `imweb-log-fingerprint:${fingerprint}` };
    }
  }
  throw new Error('Point-log scan incomplete');
}
