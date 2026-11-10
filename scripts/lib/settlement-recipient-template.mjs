import { readFileSync } from 'node:fs';

export const SETTLEMENT_TEMPLATE = 'august-202608-v1';
export const SETTLEMENT_PAYDAY_RULE = '급여는 매월 10일 지급하며, 공휴일·휴일인 경우 직전 영업일에 지급합니다.';
const logo = readFileSync(new URL('../../core/icons/archive-pilates-icon-192.png', import.meta.url));
export const settlementLogoDataUrl = `data:image/png;base64,${logo.toString('base64')}`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

// Presentation only. Amounts, deductions and class allocation remain with the caller.
export function renderSettlementRecipientDocument({month, name, role='강사', issuedAt,
  paymentDate, totalClasses, payout, payoutLabel='최종 지급 기준액', payoutDescription='지급액',
  metrics=[], sections=[], notes=[]}) {
  if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(month) || !name || metrics.length !== 4)
    throw new Error('Invalid settlement recipient presentation');
  const monthLabel = `${month.slice(0,4)}년 ${Number(month.slice(4))}월`;
  const payday = paymentDate ? `지급일 ${escape(paymentDate)}` : '지급일 익월 10일 (휴일이면 직전 영업일)';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ARCHIVE PILATES 정산명세서 ${escape(month)} ${escape(name)}</title><style>${settlementRecipientCss()}</style></head><body><main>
<article class="statement" data-settlement-template="${SETTLEMENT_TEMPLATE}">
<header class="brand-row"><div><img class="brand-mark" src="${settlementLogoDataUrl}" alt="ARCHIVE PILATES 공식 로고" width="62" height="62"><div class="eyebrow" style="margin-top:18px">ARCHIVE PILATES</div><h1>정산명세서</h1></div>
<div class="meta"><strong>${monthLabel} 정산</strong>${issuedAt ? `작성일 ${escape(issuedAt)}<br>` : ''}${payday}</div></header>
<section class="person"><div class="panel"><div class="label">${escape(role)}</div><div class="name">${escape(name)}</div><div class="role">총 수업 ${escape(totalClasses)}회</div></div>
<div class="panel"><div class="label">${escape(payoutLabel)}</div><div class="total">${escape(payout)}</div><div class="role">${escape(payoutDescription)}</div></div></section>
<section class="grid">${metrics.map(m=>`<div class="metric"><div class="label">${escape(m.label)}</div><div class="value${String(m.value).endsWith('원') ? ' money' : ''}">${escape(m.value)}</div>${(m.details || []).map(detail=>`<div class="metric-detail">${escape(detail)}</div>`).join('')}</div>`).join('')}</section>
${sections.map(s=>`<section>${s.heading ? `<h2>${escape(s.heading)}</h2>` : ''}${s.html}</section>`).join('')}
${notes.length ? `<section><ul class="note-list">${notes.map(n=>`<li>${escape(n)}</li>`).join('')}</ul></section>` : ''}
<footer class="footer"><span>ARCHIVE PILATES</span><span>${SETTLEMENT_PAYDAY_RULE}</span><span>정산 관련 문의는 운영자에게 확인해 주세요.</span></footer>
</article></main></body></html>`;
}

export function settlementRecipientCss() {
  return `
:root{color-scheme:light;--bg:#f7f4ef;--paper:#fffdfa;--ink:#171717;--muted:#726b62;--line:#e6ded3;--soft:#f1ebe3;--accent:#f36b21;--accent-dark:#c84f12}
*{box-sizing:border-box;letter-spacing:0}html{-webkit-text-size-adjust:100%}body{margin:0;min-height:100dvh;background:radial-gradient(circle at 20% 0%,#fff 0,#f7f4ef 36%,#efe7db 100%);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","SF Pro Display","SF Pro Text",sans-serif;line-height:1.55}
main{width:min(960px,calc(100% - 32px));margin:0 auto;padding:34px 0 48px}.statement{background:var(--paper);border:1px solid rgba(55,45,35,.12);border-radius:28px;padding:clamp(24px,4vw,42px);box-shadow:0 24px 70px rgba(48,38,25,.13)}
.brand-row{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:24px}.brand-mark{display:block;width:62px;height:62px;border-radius:50%;object-fit:contain;box-shadow:0 14px 26px rgba(35,28,20,.14)}
.eyebrow{color:var(--accent-dark);font-size:13px;font-weight:900;text-transform:uppercase}h1{margin:8px 0 0;font-size:50px;line-height:1.05}h2{font-size:20px;margin:26px 0 8px}.meta{text-align:right;color:var(--muted);font-size:14px}.meta strong{color:var(--ink);display:block;font-size:18px}
.person{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:18px;margin-top:26px}.panel{min-width:0;background:linear-gradient(180deg,#fff,#fbf7f1);border:1px solid var(--line);border-radius:20px;padding:22px}.label{color:var(--muted);font-size:13px;font-weight:800}.name{margin:4px 0 0;font-size:34px;font-weight:900}.role{margin-top:8px;color:var(--muted)}.total{font-size:36px;font-weight:950;margin-top:5px;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:18px}.metric{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;min-width:0}.metric .value{font-size:22px;font-weight:900;margin-top:4px;overflow-wrap:anywhere}.metric-detail{font-size:12px;color:var(--muted);margin-top:5px;overflow-wrap:anywhere;word-break:keep-all}
table{width:100%;border-collapse:collapse;margin-top:18px;font-size:15px;table-layout:fixed}th,td{padding:13px 10px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere;word-break:keep-all}th{color:var(--muted);text-align:left;font-size:12px;text-transform:uppercase}td:last-child,th:last-child{text-align:right}.amount{font-weight:850}.muted{color:var(--muted)}.accent{color:var(--accent-dark)}.note-list{margin:16px 0 0;padding:0;list-style:none;display:grid;gap:8px}.note-list li{background:var(--soft);border-radius:14px;padding:12px 14px;color:#5f554a}.footer{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:24px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
@media(max-width:760px){main{width:min(100% - 20px,960px);padding-top:16px}.statement{border-radius:22px}.brand-row,.person{grid-template-columns:minmax(0,1fr);display:grid}.meta{text-align:left}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}h1{font-size:30px}.total{font-size:28px}.metric .value.money{font-size:16px;white-space:nowrap}table{font-size:14px}}@media(max-width:340px){.total{font-size:24px}.metric{padding:14px 12px}.metric .value{font-size:18px}.metric .value.money{font-size:14px}}@media print{body{background:#fff}main{width:100%;padding:0}.statement{border:none;border-radius:0;box-shadow:none}}`;
}
