import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {
 SETTLEMENT_RULES_BASE,
 assertSettlementReferenceRulesScope,
 settlementReferenceManifest,
 parseSettlementReferenceReleaseArgs,
} from '../release-settlement-reference-rules.mjs';

const html=fs.readFileSync(new URL('../../core/rules/index.html',import.meta.url),'utf8');
const agents=fs.readFileSync(new URL('../../AGENTS.md',import.meta.url),'utf8');
const runner=fs.readFileSync(new URL('../generate-monthly-settlement-statements.mjs',import.meta.url),'utf8');
const section=html.match(/<section class="panel rule-section" id="settlement">[\s\S]*?<\/section>/)?.[0];

test('operator and agent rules bind the same two native originals',()=>{
 for(const id of ['1vMCzM58IYdCwEbrHWWhDbYPLT49MHIr6PGWqRm9ogXQ','1_3gthls6B7UnPA1OD-txmvSDB2QmKX2sgxtm2TeG4-E']){
  assert.equal(section.split(id).length-1,1);assert(agents.includes(id));
 }
 assert(section.includes('이번 승인된 중복 기준표 엑셀 2개만 원본 재조회 검증 후 휴지통으로 이동했습니다'));
 assert(section.includes('수업 원본·월별 확정 명세서·변경 전 백업은 삭제 대상이 아닙니다'));
 assert(agents.includes('Do not create another active XLSX copy'));
});
test('contract-update task requires dates and independent reader verification without claiming a background writer',()=>{
 assert(section.includes('적용기간'));assert(section.includes('재조회 검증'));
 assert(section.includes('문서 기간 종료를 자동 갱신으로 보지 않으며'));
 assert(section.includes('별도 계약 자동 감지기나 상시 쓰기 작업을 추가한 것은 아닙니다'));
 assert(agents.includes('missing or conflicting terms must not receive an assumed rate'));
});
test('source selection, finalized-month protection and sensitive-data boundaries remain explicit',()=>{
 assert(runner.includes('findSettlementSheetPointer(settlementDriveRoot, "아카이브 강사 보수기준표")'));
 assert(runner.includes('findSettlementSheetPointer(settlementDriveRoot, "기간권 차감금액표")'));
 assert(section.includes('과거 확정 정산 재계산·이체·명세서 발송 승인이 아닙니다'));
 assert(section.includes('상세 급여·계약 내용은 공개 운영규칙에 기재하지 않습니다'));
 assert(section.includes('보수 원본은 공개 링크를 사용하지 않습니다'));
});

test('scoped Hosting release accepts only the reviewed three policy rows',()=>{
 const before=execFileSync('git',['show',`${SETTLEMENT_RULES_BASE}:core/rules/index.html`]);
 assert.doesNotThrow(()=>assertSettlementReferenceRulesScope(before,html));
 assert.throws(()=>assertSettlementReferenceRulesScope(before,html.replace('별도 계약 자동 감지기','계약 자동 감지기')));
 assert.throws(()=>assertSettlementReferenceRulesScope(before,html+'\n'));
 assert.throws(()=>assertSettlementReferenceRulesScope(before,html.replace('8. 정산·비즈니스 지표','다른 제목')));
});
test('single-file manifest retains every other live file hash',()=>{
 const old='a'.repeat(64),next='b'.repeat(64),other='c'.repeat(64);
 const manifest=settlementReferenceManifest([{path:'/rules/index.html',hash:old},{path:'/assets/app.js',hash:other}],next);
 assert.equal(manifest['/rules/index.html'],next);
 assert.equal(manifest['/assets/app.js'],other);
 assert.throws(()=>settlementReferenceManifest([{path:'/rules/index.html',hash:old}],old));
});
test('apply requires one explicit expected version and rejects extraneous arguments',()=>{
 const v='sites/archive-pilates-core/versions/test';
 assert.deepEqual(parseSettlementReferenceReleaseArgs([]),{apply:false,expected:undefined});
 assert.deepEqual(parseSettlementReferenceReleaseArgs(['--apply',`--expected-version=${v}`]),{apply:true,expected:v});
 assert.throws(()=>parseSettlementReferenceReleaseArgs(['--apply']));
 assert.throws(()=>parseSettlementReferenceReleaseArgs(['--force']));
 assert.throws(()=>parseSettlementReferenceReleaseArgs(['--apply','--apply',`--expected-version=${v}`]));
});
