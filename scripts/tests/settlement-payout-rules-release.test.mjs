import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {assertRecipientRulesScope,recipientRulesManifest,parseRecipientRulesArgs,RECIPIENT_RULES_BASE} from '../release-settlement-payout-rules.mjs';
const before=execFileSync('git',['show',`${RECIPIENT_RULES_BASE}:core/rules/index.html`]).toString();
// Fixed approved policy fixture keeps this one-time release test independent of later rule edits.
const addition="                <li><strong>급여 용어·표 구성 통일 · 2026-11-10</strong>: 정규직 급여, 프리랜서 보수, 지급액 합계 순서로 공통 양식을 사용합니다. 급여 지급총액·급여 공제합계·급여 실지급액과 프리랜서 보수총액·원천징수 합계·프리랜서 실지급액·총 지급액을 구분하며 지방소득세 등 항목명을 통일합니다. 프리랜서 산정의 정규직 급여 반영액은 보험료·세금 공제와 혼용하지 않습니다. 원본에 없는 급여·공제 항목은 추정하지 않고 개별 수당·기존 금액·수업 횟수는 보존합니다. 파일 통일과 생성기 운영 반영·규칙 배포·재조회 검증은 작업 기록에서 구분하며 이체·발송·정산 재계산은 하지 않습니다.</li>\n                <li><strong>송금 대조표 · 2026-11-10</strong>: 인덱스는 강사별 정규직 급여와 프리랜서 보수의 공제 후 실지급액을 나누고 각각의 합계와 송금 대상 합계를 표시합니다. 승인된 사업주 제외 대상은 두 지급 합계에서 제외하되 원래 명세서와 수업 실적은 보존합니다. 개별 표시 금액을 원 단위로 합산하며 합산액을 별도 송금 건으로 더하지 않습니다. 원본 누락·금액 불일치·중복 신원은 보류하고 비교 기준이 다른 전월 증감은 표시하지 않습니다. 은행 이체내역 미대조 상태를 명시하며 실제 지급 여부나 중복 송금 차단을 보장하지 않습니다. 코드·규칙의 운영 반영 상태는 작업 기록에서 구분하며 은행 이체 승인·실행 권한이나 자동 송금을 추가하지 않습니다.</li>\n";
const anchor='                <li>월간 요약';
const after=before.replace(anchor,addition+anchor);
test('only the two approved payroll presentation and payout policies can change',()=>{
  assert.doesNotThrow(()=>assertRecipientRulesScope(before,after));
  for(const s of [before,after+'unrelated',after.replace('은행 이체내역','자동 지급완료'),after.replace('급여 용어·표 구성 통일','다른 규칙')])
    assert.throws(()=>assertRecipientRulesScope(before,s));
});
test('payout rules release preserves unrelated Hosting content and requires a precise guarded baseline',()=>{
  const files=[{path:'/rules/index.html',hash:'a'.repeat(64)},{path:'/assets/app.js',hash:'b'.repeat(64)}];
  assert.equal(recipientRulesManifest(files,'c'.repeat(64))['/assets/app.js'],'b'.repeat(64));
  assert.throws(()=>recipientRulesManifest(files,'a'.repeat(64)));
  for(const args of [['--apply'],['--force'],['--apply','--apply'],['--expected-version=sites/other/versions/test']])
    assert.throws(()=>parseRecipientRulesArgs(args));
  assert.equal(parseRecipientRulesArgs(['--apply','--expected-version=sites/archive-pilates-core/versions/test']).apply,true);
});
