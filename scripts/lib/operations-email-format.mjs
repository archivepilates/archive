export function kstTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '확인 불가';
  return `${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(date)} KST`;
}

export function formatOperationsReport({ area, status, title, observedAt, context, conclusion, key = [], verification = [], caution = [], next = [], details = [] }) {
  const subject = `[${area}][${status}] ${title} · ${kstTimestamp(observedAt).slice(0, 10)}`;
  const body = [
    `주체: ARCHIVE CORE / ${context}`,
    `결론: ${conclusion}`,
    `확인: ${kstTimestamp(observedAt)}`,
    ...[['핵심', key], ['검증', verification], ['주의', caution], ['다음', next], ['상세', details]]
      .flatMap(([name, items]) => ['', `${name}:`, ...(items.length ? items : ['없음']).map(item => `- ${item}`)]),
  ].join('\n');
  return { subject, body };
}

export function normalizeOperationsIdentity(body) {
  return String(body).replace(/(^주체:\s*)ARCHIVE IN(?=\s*\/)/gm, '$1ARCHIVE CORE');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function renderOperationsEmail(subject, body) {
  const lines = normalizeOperationsIdentity(body).split('\n');
  const content = lines.map(line => {
    if (!line.trim()) return '';
    const heading = /^(핵심|검증|주의|다음|상세|주요 항목):?$/.test(line.trim());
    const text = escapeHtml(line).replace(/https?:\/\/[^\s<>]+/g, url => `<a href="${url}" style="color:#ae2424;word-break:break-all">${url}</a>`);
    return `<p style="margin:${heading ? '20px 0 6px' : '6px 0'};${heading ? 'font-weight:700;' : ''}word-break:keep-all;overflow-wrap:anywhere">${text}</p>`;
  }).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f4;color:#202020;font:16px/1.65 -apple-system,BlinkMacSystemFont,Arial,sans-serif"><main style="max-width:640px;margin:auto;padding:24px;background:white"><p style="font-size:12px;color:#666;margin:0 0 12px">ARCHIVE PILATES · 운영 알림</p><h1 style="font-size:20px;line-height:1.5;margin:0 0 20px;overflow-wrap:anywhere">${escapeHtml(subject)}</h1>${content}</main></body></html>`;
}

export function operationsReportLabels(subject, statusLabel) {
  const area = subject.match(/^\[([^\]\r\n]+)\]/)?.[1];
  return [...new Set([area ? `${area} 보고` : '', statusLabel].filter(Boolean))];
}

export function buildOperationsReportMime({ from, to, subject, body, messageId = '', boundary }) {
  for (const value of [from, to, subject, messageId, boundary]) {
    if (/[\r\n]/.test(value)) throw new Error('Invalid report header');
  }
  if (!/^[a-zA-Z0-9-]+$/.test(boundary)) throw new Error('Invalid report boundary');
  const encoded = value => Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  const plain = normalizeOperationsIdentity(body);
  return [
    `From: ARCHIVE CORE <${from}>`, `To: ${to}`,
    ...(messageId ? [`Message-ID: <${messageId}>`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encoded(plain),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encoded(renderOperationsEmail(subject, plain)),
    `--${boundary}--`, '',
  ].join('\r\n');
}
