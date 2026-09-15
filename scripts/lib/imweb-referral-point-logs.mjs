export function readCanonicalPointLogs(inviter, { run, scope, maxPages = 10, pageSize = 50 }) {
  const context = run(['config', 'context']);
  if (context.resolved_profile?.site_code !== scope.siteCode ||
      context.resolved_profile?.unit_code !== scope.unitCode) throw new Error('Unexpected Imweb scope');
  const rows = [];
  const seen = new Set();
  let count;
  let pages;
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
    if (page === 1) { count = data.totalCount; pages = data.totalPage; }
    if (data.totalCount !== count || data.totalPage !== pages) throw new Error('Point logs changed during scan');
    if (pages > maxPages) throw new Error('Point-log scan incomplete');
    for (const row of data.list) {
      if (row?.unitCode !== scope.unitCode || row.memberCode !== inviter.memberCode ||
          row.memberUid !== inviter.uid || typeof row.reason !== 'string' ||
          !Number.isSafeInteger(row.changePoint) || typeof row.time !== 'string' ||
          !/(Z|[+-]\d{2}:\d{2})$/.test(row.time) || !Number.isFinite(Date.parse(row.time))) {
        throw new Error('Unexpected point-log recipient or format');
      }
      const signature = JSON.stringify([row.unitCode, row.memberCode, row.memberUid, row.time,
        row.reason, row.changePoint, row.currency, row.type]);
      if (seen.has(signature)) throw new Error('Duplicate point-log rows; manual reconciliation required');
      seen.add(signature); rows.push(row);
    }
    if (page >= pages) {
      if (rows.length !== count) throw new Error('Point-log scan incomplete');
      return rows;
    }
  }
  throw new Error('Point-log scan incomplete');
}
