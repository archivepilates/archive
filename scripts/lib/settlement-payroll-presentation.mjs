import { renderSettlementRecipientDocument } from './settlement-recipient-template.mjs';

export const PAYROLL_TERMS = Object.freeze({
  regularHeading: '정규직 급여', freelanceHeading: '프리랜서 보수', totalsHeading: '지급액 합계',
  regularGross: '급여 지급총액(세전)', regularDeductions: '급여 공제합계', regularNet: '급여 실지급액',
  freelanceGross: '프리랜서 보수총액(세전)', freelanceDeductions: '원천징수 합계', freelanceNet: '프리랜서 실지급액',
  freelanceIncomeTax: '소득세(3%)', freelanceLocalTax: '지방소득세(0.3%)', total: '총 지급액',
});
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

// Values are already formatted canonical inputs. This layer never calculates pay or deductions.
export function renderPayrollTable(title, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !row.label || typeof row.value !== 'string' || !row.value.trim()))
    throw new Error('PAYROLL_PRESENTATION_SOURCE_REQUIRED');
  return `<table aria-label="${escape(title)}"><thead><tr><th>항목</th><th>금액</th></tr></thead><tbody>${rows.map(row =>
    `<tr><td><strong>${escape(row.label)}</strong>${row.description ? `<br><span class="muted">${escape(row.description)}</span>` : ''}</td><td class="amount${row.highlight ? ' accent' : ''}">${escape(row.value)}</td></tr>`
  ).join('')}</tbody></table>`;
}

export function renderStandardPayrollDocument({ regularRows = [], freelanceRows, payoutRows, ...document }) {
  if (!Array.isArray(regularRows) || !Array.isArray(document.metrics) || document.metrics.length !== 4
    || typeof document.payout !== 'string' || !document.payout.trim()
    || !Array.isArray(payoutRows) || payoutRows.at(-1)?.label !== PAYROLL_TERMS.total || payoutRows.at(-1)?.value !== document.payout)
    throw new Error('PAYROLL_PRESENTATION_SOURCE_REQUIRED');
  const sections = [
    ...(regularRows.length ? [{ heading: PAYROLL_TERMS.regularHeading, html: renderPayrollTable(PAYROLL_TERMS.regularHeading, regularRows) }] : []),
    { heading: PAYROLL_TERMS.freelanceHeading, html: renderPayrollTable(PAYROLL_TERMS.freelanceHeading, freelanceRows) },
    { heading: PAYROLL_TERMS.totalsHeading, html: renderPayrollTable(PAYROLL_TERMS.totalsHeading, payoutRows) },
  ];
  return renderSettlementRecipientDocument({ ...document, sections, payoutLabel: PAYROLL_TERMS.total,
    payoutDescription: regularRows.length ? `${PAYROLL_TERMS.regularNet} + ${PAYROLL_TERMS.freelanceNet}` : PAYROLL_TERMS.freelanceNet,
    metrics: document.metrics.map((metric, index) => index === 3 ? { ...metric, label: PAYROLL_TERMS.freelanceGross } : metric),
  });
}
