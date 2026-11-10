import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {buildSettlementPayoutIndex,readSettlementPayoutComponents,renderSettlementPayoutIndex,settlementPayoutIndexCss,PAYOUT_EXCLUDED_OWNER_NAME} from '../lib/settlement-payout-index.mjs';
const row = (name,regular=100,freelance=20) => ({name,regularPayout:regular,freelancerPayout:freelance,finalPayout:regular+freelance});

test('regular and freelance net amounts remain distinct for each payee and in totals',()=>{
  const p=buildSettlementPayoutIndex([row('강사 A'),row('강사 B',0,30)],'202610');
  assert.deepEqual(p.totals,{regular:100,freelance:50,total:150});
  assert.equal(p.payees[0].regular,100);assert.equal(p.payees[0].freelance,20);
  assert.notEqual(p.payees[0].regularKey,p.payees[0].freelanceKey);
  assert.notEqual(p.payees[0].regularKey,buildSettlementPayoutIndex([row('강사 A')],'202611').payees[0].regularKey);
  const h=renderSettlementPayoutIndex(p);for(const t of ['정규직 급여 합계','프리랜서 보수 합계','송금 대상 합계','해당 없음','은행 이체내역 미대조'])assert(h.includes(t));
});
test('only the exact approved owner is excluded from both transfer totals; source amounts stay unchanged',()=>{
  const input=[row(PAYOUT_EXCLUDED_OWNER_NAME,1000,2000),row('강사 A')],before=structuredClone(input);
  const p=buildSettlementPayoutIndex(input,'202610');assert.deepEqual(input,before);
  assert.equal(p.payees.length,1);assert.deepEqual(p.totals,{regular:100,freelance:20,total:120});
  assert.deepEqual(p.excluded,[{name:PAYOUT_EXCLUDED_OWNER_NAME,reason:'사업주 · 송금 제외'}]);
  const h=renderSettlementPayoutIndex(p);assert(!h.includes('2,000원'));assert(!h.includes('3,000원'));assert(h.includes('사업주 · 송금 제외'));
  assert.equal(buildSettlementPayoutIndex([row(PAYOUT_EXCLUDED_OWNER_NAME+'2')],'202610').payees.length,1);
  assert.equal(buildSettlementPayoutIndex([row(PAYOUT_EXCLUDED_OWNER_NAME.normalize('NFD'))],'202610').excluded.length,1);
});
test('displayed recipient KRW are rounded before summing, never the floating aggregate',()=>{
  const p=buildSettlementPayoutIndex([row('강사 A',0,1.4),row('강사 B',0,1.4)],'202610');
  assert.equal(p.totals.freelance,2);assert.equal(p.totals.total,2);
});
test('the established writer blank convention is verified as freelance-only, never missing expected salary',()=>{
  const writerRow=['',30,''];
  const components=readSettlementPayoutComponents({regular:writerRow[0],freelance:writerRow[1],combined:writerRow[2],columnsPresent:true});
  assert.deepEqual(components,{regularPayout:0,freelancerPayout:30,finalPayout:30});
  assert.equal(buildSettlementPayoutIndex([{name:'강사 A',...components}],'202610').totals.total,30);
  for(const fields of [{regular:'',freelance:30,combined:'',adjustmentText:'정규직급여 (100)'},
    {regular:'',freelance:30,combined:130},{regular:100,freelance:30,combined:''},
    {regular:undefined,freelance:30,combined:undefined},{regular:'',freelance:'',combined:''}])
    assert.throws(()=>readSettlementPayoutComponents({...fields,columnsPresent:true}));
  assert.throws(()=>readSettlementPayoutComponents({regular:'',freelance:30,combined:'',columnsPresent:false}));
});
test('missing values, duplicate identities, invalid amounts or conflicting final totals stop the payout view',()=>{
  for(const data of [[],[row('')],[row('강사 A'),row(' 강사 A ')],[{...row('강사 A'),regularPayout:undefined}],
    [{...row('강사 A'),freelancerPayout:'20'}],[row('강사 A',-1,20)],[row('강사 A',NaN,20)],
    [{...row('강사 A'),finalPayout:121}],[{...row('강사 A'),payoutSourceVerified:false}],
    [row('강사 A',Number.MAX_SAFE_INTEGER,1)]])assert.throws(()=>buildSettlementPayoutIndex(data,'202610'));
  for(const month of ['202600','202613','2026-10'])assert.throws(()=>buildSettlementPayoutIndex([row('강사 A')],month));
});
test('no history lookup or payment-completion state is fabricated and tampered render models fail',()=>{
  const p=buildSettlementPayoutIndex([row('강사 A')],'202610');assert.equal(p.bankHistoryVerified,false);
  for(const altered of [{...p,bankHistoryVerified:true},{...p,totals:{regular:100,freelance:100,total:200}},
    {...p,payees:[{...p.payees[0],freelanceKey:p.payees[0].regularKey}]}])assert.throws(()=>renderSettlementPayoutIndex(altered));
  const h=renderSettlementPayoutIndex(p);assert(!h.includes('지급 완료'));assert(!h.includes('미지급'));assert(!/<script|<input|fetch\(/.test(h));
});
test('all dynamic names and payment keys are escaped',()=>{
  const h=renderSettlementPayoutIndex(buildSettlementPayoutIndex([row('<img onerror=1>')],'202610'));
  assert(!h.includes('<img'));assert(h.includes('&lt;img onerror=1&gt;'));
});
test('narrow layouts retain payment type labels and no bank details are embedded',()=>{
  const css=settlementPayoutIndexCss();assert(css.includes('minmax(0,1fr)'));assert(css.includes('@media(max-width:760px)'));assert(css.includes('.payout-field{display:block'));
  assert(css.includes('.payout-check caption{display:block;width:100%}'));
  const h=renderSettlementPayoutIndex(buildSettlementPayoutIndex([row('강사 A')],'202610'));assert(!/계좌|인증서|OTP|bankAccount/.test(h));
});
test('generator separates transfer criteria from whole-studio performance and removes invalid prior-basis comparison',()=>{
  const source=readFileSync(new URL('../generate-monthly-settlement-statements.mjs',import.meta.url),'utf8');
  const start=source.indexOf('function renderIndexHtml('),end=source.indexOf('function renderInstructorHtml(',start),index=source.slice(start,end);
  assert(index.includes('renderSettlementPayoutIndex(payoutIndex)'));
  assert(index.includes('수업 실적 참고 (사업주 포함)'));assert(index.includes('사업주 · 송금 제외'));
  assert(!index.includes('summary.totalPayout'));assert(!index.includes('전월대비'));
  assert(source.includes('readSettlementPayoutComponents({regular:row[regularPayoutIndex]'));
  assert(!source.includes('summary.payoutIndex ='));
});
