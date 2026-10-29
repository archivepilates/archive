import test from 'node:test';import assert from 'node:assert/strict';
import{teamTestVariables,teamTestReceipt,TEAM_TEST_ID}from'../test-team-261121-confirmation.mjs';
test('Team test is visibly marked and targets only the exact operator identity',()=>{
 const v=teamTestVariables({memberId:'123',name:'김기효',phone:'01086488585'});
 assert.match(v['#{이름}'],/테스트/);assert.equal(v['#{수업일}'],'2026년 11월 21일(토)');assert.equal(v['#{수업시간}'],'13:30~15:20');
 assert.match(v['#{수업구성}'],/리포머/);assert.match(v['#{수업구성}'],/바렐/);assert.equal(v['#{관리번호}'],'team-261121');
 assert.match(TEAM_TEST_ID,/operator/);
 for(const p of[{memberId:'123',name:'Other',phone:'01086488585'},{memberId:'123',name:'김기효',phone:'01000000001'},{memberId:'excel_bad',name:'김기효',phone:'01086488585'}])assert.throws(()=>teamTestVariables(p));
});
test('Team provisional receipt accepts array and keyed maps without assuming identity proof',()=>{
 const row={messageId:'MTEST123'};
 for(const messageList of [[row],{MTEST123:row}])assert.equal(teamTestReceipt({messageList,failedMessageList:{}}),'MTEST123');
 assert.equal(teamTestReceipt({messageList:[{...row,to:'01086488585',kakaoOptions:{templateId:'KA01TP2608241233353269Jgtoiwnzi6'}}],failedMessageList:[]}),'MTEST123');
});
test('Team receipt rejects failures, multiple receipts and contradictory identities',()=>{
 const row={messageId:'MTEST123'};
 for(const response of [null,{messageList:null},{messageList:[row,row]},{messageList:[row],failedMessageList:'unknown'},{messageList:[row],failedMessageList:[{}]},{messageList:[row],failedMessageList:{bad:{}}},{messageList:[{...row,to:'01000000000'}]},{messageList:[{...row,kakaoOptions:{templateId:'other'}}]},{messageList:[{messageId:' invalid '}]}])assert.throws(()=>teamTestReceipt(response));
});
