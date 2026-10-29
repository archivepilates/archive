import test from 'node:test';import assert from 'node:assert/strict';
import{teamTestVariables,TEAM_TEST_ID}from'../test-team-261121-confirmation.mjs';
test('Team test is visibly marked and targets only the exact operator identity',()=>{
 const v=teamTestVariables({memberId:'123',name:'김기효',phone:'01086488585'});
 assert.match(v['#{이름}'],/테스트/);assert.equal(v['#{수업일}'],'2026년 11월 21일(토)');assert.equal(v['#{수업시간}'],'13:30~15:20');
 assert.match(v['#{수업구성}'],/리포머/);assert.match(v['#{수업구성}'],/바렐/);assert.equal(v['#{관리번호}'],'team-261121');
 assert.match(TEAM_TEST_ID,/operator/);
 for(const p of[{memberId:'123',name:'Other',phone:'01086488585'},{memberId:'123',name:'김기효',phone:'01000000001'},{memberId:'excel_bad',name:'김기효',phone:'01086488585'}])assert.throws(()=>teamTestVariables(p));
});
