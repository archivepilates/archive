export const PAYOUT_EXCLUDED_OWNER_NAME = '배민진';
const clean = value => String(value ?? '').trim().normalize('NFC');
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const won = value => `${value.toLocaleString('ko-KR')}원`;
const fail = () => { throw new Error('SETTLEMENT_PAYOUT_INDEX_SOURCE_REVIEW_REQUIRED'); };
function displayedWon(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value))) fail();
  return Math.round(value);
}

export function readSettlementPayoutComponents({regular,freelance,combined,adjustmentText='',columnsPresent}) {
  if (!columnsPresent || typeof freelance !== 'number' || !Number.isFinite(freelance) || freelance < 0) fail();
  // The established ledger writer uses paired blanks for non-applicable salary fields.
  const noSalary = regular === '' && combined === '' && !/정규직\s*급여/.test(clean(adjustmentText));
  if (noSalary) return {regularPayout:0,freelancerPayout:freelance,finalPayout:freelance};
  if ([regular,combined].some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail();
  return {regularPayout:regular,freelancerPayout:freelance,finalPayout:combined || freelance};
}

// Sum already-calculated recipient amounts; never recalculate compensation or execute transfers.
export function buildSettlementPayoutIndex(instructors, month) {
  if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(month) || !Array.isArray(instructors) || !instructors.length) fail();
  const names = new Set(), payees = [], excluded = [];
  for (const row of instructors) {
    if (row.payoutSourceVerified === false) fail();
    const name = clean(row.name);
    if (!name || names.has(name)) fail();
    names.add(name);
    const regular = displayedWon(row.regularPayout), freelance = displayedWon(row.freelancerPayout), total = displayedWon(row.finalPayout);
    if (!Number.isSafeInteger(regular + freelance) || regular + freelance !== total) fail();
    if (name === PAYOUT_EXCLUDED_OWNER_NAME) { excluded.push({name, reason:'사업주 · 송금 제외'}); continue; }
    payees.push({ name, regular, freelance, total,
      regularKey: `${month}:${name}:regular`, freelanceKey: `${month}:${name}:freelance` });
  }
  const totals = payees.reduce((sum, row) => ({regular:sum.regular+row.regular,freelance:sum.freelance+row.freelance,total:sum.total+row.total}), {regular:0,freelance:0,total:0});
  if (Object.values(totals).some(value => !Number.isSafeInteger(value)) || totals.regular + totals.freelance !== totals.total) fail();
  return { month, payees, excluded, totals, bankHistoryVerified:false };
}

export function renderSettlementPayoutIndex(model) {
  if (!model || model.bankHistoryVerified !== false || !Array.isArray(model.payees) || !Array.isArray(model.excluded)) fail();
  const checked = buildSettlementPayoutIndex([
    ...model.payees.map(row => ({name:row.name,regularPayout:row.regular,freelancerPayout:row.freelance,finalPayout:row.total})),
    ...model.excluded.map(row => ({name:row.name,regularPayout:0,freelancerPayout:0,finalPayout:0})),
  ], model.month);
  if (JSON.stringify(checked) !== JSON.stringify(model)) fail();
  const amount = value => value ? won(value) : '해당 없음';
  return `<section class="payout-index" aria-labelledby="payout-title" data-bank-history-verified="false">
<h2 id="payout-title">송금 대조표</h2><p class="payout-status">공제 후 실지급 기준 · 은행 이체내역 미대조</p>
<div class="payout-totals"><div class="payout-total regular"><span>정규직 급여 합계</span><strong>${won(model.totals.regular)}</strong></div><div class="payout-total freelance"><span>프리랜서 보수 합계</span><strong>${won(model.totals.freelance)}</strong></div><div class="payout-total"><span>송금 대상 합계</span><strong>${won(model.totals.total)}</strong></div></div>
<table class="payout-check"><caption>강사별 공제 후 지급 기준액</caption><thead><tr><th scope="col">강사</th><th scope="col">정규직 급여</th><th scope="col">프리랜서 보수</th><th scope="col">합계</th></tr></thead><tbody>${model.payees.map(row => `<tr><th scope="row">${escape(row.name)}</th><td data-payment-type="regular" data-payment-key="${escape(row.regularKey)}"><span class="payout-field">정규직 급여</span><strong>${amount(row.regular)}</strong></td><td data-payment-type="freelance" data-payment-key="${escape(row.freelanceKey)}"><span class="payout-field">프리랜서 보수</span><strong>${amount(row.freelance)}</strong></td><td><span class="payout-field">합계</span><strong>${won(row.total)}</strong></td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">지급 합계</th><td><span class="payout-field">정규직 급여 합계</span><strong>${won(model.totals.regular)}</strong></td><td><span class="payout-field">프리랜서 보수 합계</span><strong>${won(model.totals.freelance)}</strong></td><td><span class="payout-field">송금 대상 합계</span><strong>${won(model.totals.total)}</strong></td></tr></tfoot></table>
${model.excluded.length ? `<p class="payout-excluded">${model.excluded.map(row => `${escape(row.name)}: ${escape(row.reason)}`).join(' · ')} (위 지급 합계에 포함하지 않음)</p>` : ''}</section>`;
}

export function settlementPayoutIndexCss() {
  return `.payout-index{margin:28px 0 32px}.payout-index h2{font-size:23px;margin:0 0 6px}.payout-status,.payout-excluded{font-size:14px;color:var(--muted);line-height:1.65}.payout-totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}.payout-total{min-width:0;padding:16px;border:1px solid var(--line);border-radius:8px;background:#fff}.payout-total.regular{border-top:3px solid #36746b}.payout-total.freelance{border-top:3px solid #a44b45}.payout-total span{display:block;font-size:14px;word-break:keep-all}.payout-total strong{display:block;font-size:22px;margin-top:8px;white-space:nowrap}.payout-check{table-layout:auto;width:100%}.payout-check caption{text-align:left;color:var(--muted);font-size:13px;padding:6px 0}.payout-check th,.payout-check td{text-align:right;font-size:14px;padding:12px 8px}.payout-check th:first-child{text-align:left}.payout-check td strong{white-space:nowrap}.payout-check tbody th{font-size:15px;color:var(--ink)}.payout-check tfoot{font-weight:800}.payout-field{display:none}.payout-excluded{padding-top:10px;border-top:1px solid var(--line)}@media(max-width:760px){.payout-totals{grid-template-columns:minmax(0,1fr)}.payout-total{display:flex;justify-content:space-between;gap:12px;align-items:center}.payout-total strong{font-size:20px;margin:0}.payout-check thead{display:none}.payout-check caption{display:block;width:100%}.payout-check,.payout-check tbody,.payout-check tfoot{display:block}.payout-check tr{display:block;padding:12px 0;border-bottom:1px solid var(--line)}.payout-check th,.payout-check td{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border:0;padding:7px 0;min-width:0}.payout-check td strong{flex-shrink:0}.payout-field{display:block;font-weight:400;color:var(--muted);word-break:keep-all}}@media(max-width:340px){.payout-total{align-items:flex-start;flex-direction:column;gap:4px}.payout-total strong{font-size:21px}}`;
}
