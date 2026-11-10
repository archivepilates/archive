import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PAYROLL_TERMS as T,renderPayrollTable,renderStandardPayrollDocument} from '../lib/settlement-payroll-presentation.mjs';

const sample = changes => ({month:'202610',name:'검증용 강사',totalClasses:'12',paymentDate:'2026.11.10',payout:'1,234,567원',
  metrics:[{label:'그룹',value:'10회',details:['일반 그룹 8회','강사레슨 2회']},{label:'프라이빗',value:'2회',details:['개인 1회 · 듀엣 1회','회원별 정산 3건']},{label:'그룹 평균',value:'3.00명'},{label:'old label',value:'234,567원'}],
  regularRows:[{label:'기본급',value:'1,000,000원'},{label:T.regularNet,value:'900,000원'}],
  freelanceRows:[{label:T.freelanceGross,value:'234,567원'},{label:T.freelanceIncomeTax,value:'7,037원'},{label:T.freelanceLocalTax,value:'703원'},{label:T.freelanceDeductions,value:'7,740원'},{label:T.freelanceNet,value:'226,827원'}],
  payoutRows:[{label:T.regularNet,value:'900,000원'},{label:T.freelanceNet,value:'226,827원'},{label:T.total,value:'1,234,567원'}],...changes});

test('both regular-payroll profiles share terminology, ordered sections and the official layout',()=>{
  for(const name of ['검증용 A','검증용 B']){
    const h=renderStandardPayrollDocument(sample({name}));
    assert.deepEqual([...h.matchAll(/<h2>(.*?)<\/h2>/g)].map(x=>x[1]),[T.regularHeading,T.freelanceHeading,T.totalsHeading]);
    assert(h.includes('data-settlement-template="august-202608-v1"'));assert(h.includes('data:image/png;base64,'));
    for(const term of [T.freelanceGross,T.freelanceDeductions,T.regularNet,T.freelanceNet,T.total])assert(h.includes(term));
    for(const term of ['주민세','정규직 차인지급액','실지급 합산','전달용 HTML','old label'])assert(!h.includes(term));
  }
});
test('all caller values and count descriptions remain exact, including negative adjustments and precision',()=>{
  const input=sample({freelanceRows:[{label:'정규직 급여 반영액',value:'-1,000,000원'},{label:'기존 원본 금액',value:'12.50원'}]});
  const before=structuredClone(input),h=renderStandardPayrollDocument(input);assert.deepEqual(input,before);
  for(const value of ['-1,000,000원','12.50원','1,234,567원','총 수업 12회','강사레슨 2회','회원별 정산 3건'])assert(h.includes(value));
});
test('missing payroll fields are not converted into guessed zero, deductions or gross-minus-net arithmetic',()=>{
  const h=renderStandardPayrollDocument(sample({regularRows:[{label:T.regularNet,value:'900,000원'}]}));
  assert(!h.includes(T.regularGross));assert(!h.includes(T.regularDeductions));assert(!h.includes('100,000원'));
  assert(renderPayrollTable('표',[{label:'명시적 영',value:'0원'}]).includes('0원'));
  for(const row of [{label:'금액 없음'},{label:'금액 없음',value:''},{label:'수치',value:0}])assert.throws(()=>renderPayrollTable('표',[row]));
});
test('private-only instructors omit regular payroll without inventing a salary section',()=>{
  const h=renderStandardPayrollDocument(sample({regularRows:[]}));
  assert.deepEqual([...h.matchAll(/<h2>(.*?)<\/h2>/g)].map(x=>x[1]),[T.freelanceHeading,T.totalsHeading]);
  assert.throws(()=>renderStandardPayrollDocument(sample({freelanceRows:undefined})));
  assert.throws(()=>renderStandardPayrollDocument(sample({payoutRows:undefined})));
  assert.throws(()=>renderStandardPayrollDocument(sample({payout:undefined})));
  assert.throws(()=>renderStandardPayrollDocument(sample({payout:'0원'})));
});
test('all table input fields are escaped and cannot inject markup',()=>{
  const h=renderPayrollTable('<script>',[{label:'<img onerror=1>',description:'<script>x</script>',value:'<b>0</b>'}]);
  assert(!h.includes('<script>'));assert(!h.includes('<img'));assert(h.includes('&lt;script&gt;'));assert(h.includes('&lt;b&gt;'));
});
test('future generator uses canonical values and keeps the salary allocation distinct from payroll withholding',()=>{
  const source=readFileSync(new URL('../generate-monthly-settlement-statements.mjs',import.meta.url),'utf8');
  assert(source.includes('return renderStandardPayrollDocument({'));
  assert(source.includes('payrollRow(PAYROLL_TERMS.total, "", instructor.finalPayout, true)'));
  assert(source.includes('payrollRow("정규직 급여 반영액", "프리랜서 보수 산정 시 반영"'));
  assert(source.includes('const regularRows = instructor.regularPayout ? [payrollRow(PAYROLL_TERMS.regularNet'));
});
