import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderSettlementRecipientDocument, settlementLogoDataUrl, settlementRecipientCss, SETTLEMENT_PAYDAY_RULE } from '../lib/settlement-recipient-template.mjs';

const sample = overrides => renderSettlementRecipientDocument({month:'202610',name:'검증용 강사',
  issuedAt:'2026.11.10',totalClasses:'10',payout:'123,456원',
  metrics:[{label:'그룹',value:'8회'},{label:'프라이빗',value:'2회'},{label:'그룹 평균',value:'3.00명'},{label:'세전 보수',value:'130,000원'}],
  sections:[{heading:'정산 상세',html:'<table><tbody><tr><td>지급액</td><td>123,456원</td></tr></tbody></table>'}],...overrides});

test('approved August layout embeds the exact official logo without external requests',()=>{
  const image=Buffer.from(settlementLogoDataUrl.split(',')[1],'base64');
  assert.equal(createHash('sha256').update(image).digest('hex'),'fd5b39e8f4d547aa1e9a9fe8796b0e12c8a0ed31076d4d49fc7e4ad054e0d53f');
  const html=sample();
  assert.match(html,/data-settlement-template="august-202608-v1"/);
  for(const c of ['brand-row','brand-mark','person','grid','note-list','footer'])if(c!=='note-list')assert(html.includes(`class="${c}"`));
  assert.match(html,/<img class="brand-mark" src="data:image\/png;base64,/);
  assert(!html.includes('>AP<'));assert(!/https?:\/\//.test(html));assert(!/<script/.test(html));
});
test('regular and freelance sections and provided payout remain presentation inputs',()=>{
  const html=sample({payout:'1,234,567원',sections:[{heading:'정규직 급여',html:'<table><tr><td>고정 지급액</td><td>1,200,000원</td></tr></table>'},{heading:'프리랜서 보수',html:'<table><tr><td>별도 지급액</td><td>34,567원</td></tr></table>'}]});
  for(const text of ['1,234,567원','1,200,000원','34,567원','정규직 급여','프리랜서 보수'])assert(html.includes(text));
});
test('recipient copy gives the payday rule but never guesses holiday dates or payment completion',()=>{
  const html=sample();assert(html.includes(SETTLEMENT_PAYDAY_RULE));
  assert(html.includes('지급일 익월 10일 (휴일이면 직전 영업일)'));
  assert(sample({paymentDate:'2026.11.10'}).includes('지급일 2026.11.10'));
  for(const text of ['미실행','미확인','수정 전','보수기준표','검토본','원본 SHA'])assert(!html.includes(text));
});
test('all interpolated recipient fields and note text are escaped',()=>{
  const html=sample({name:'<script>alert(1)</script>',notes:['<img onerror=alert(1)>'],payout:'<b>1</b>'});
  assert(!html.includes('<script>'));assert(!html.includes('<img onerror'));assert(html.includes('&lt;script&gt;'));
});
test('responsive layout retains narrow grid tracks and stable embedded image dimensions',()=>{
  const css=settlementRecipientCss();assert(css.includes('minmax(0,1fr)'));assert(css.includes('@media(max-width:340px)'));
  assert(css.includes('overflow-wrap:anywhere'));assert(!/font-size:[^;}]*vw/.test(css));
  assert.match(sample(),/width="62" height="62"/);
});
test('invalid month or missing summary fields cannot create a misleading statement',()=>{
  for(const month of ['202600','202613','not-a-month'])assert.throws(()=>sample({month}));
  assert.throws(()=>sample({name:''}));assert.throws(()=>sample({metrics:[]}));
});
test('monthly runner uses common presentation and does not print raw adjustment notes',()=>{
  const source=readFileSync(new URL('../generate-monthly-settlement-statements.mjs',import.meta.url),'utf8');
  assert(source.includes('return renderStandardPayrollDocument({'));
  assert(!source.includes('<div class="brand-mark">AP</div>'));
  assert(source.includes('payrollRow("조정금액", "계약 조건에 따른 보수 조정", instructor.adjustmentAmount)'));
});
