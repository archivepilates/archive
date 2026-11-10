import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {assertRecipientRulesScope,recipientRulesManifest,parseRecipientRulesArgs,RECIPIENT_RULES_BASE} from '../release-settlement-template-rules.mjs';
const before=execFileSync('git',['show',`${RECIPIENT_RULES_BASE}:core/rules/index.html`]);
const after=execFileSync('git',['show','c5aec2b317d8788ecf9bde36d6bbe94020e72383:core/rules/index.html']);
test('only the approved two recipient-rule lines may be added',()=>{
  assert.doesNotThrow(()=>assertRecipientRulesScope(before,after));
  for(const mutated of [after.toString()+'unrelated',after.toString().replace('공통 생성 서식','추가 권한'),before.toString()])assert.throws(()=>assertRecipientRulesScope(before,mutated));
});
test('only rules bytes change in the current Hosting manifest',()=>{
  const files=[{path:'/rules/index.html',hash:'a'.repeat(64)},{path:'/assets/app.js',hash:'b'.repeat(64)},{path:'/inquiries/index.html',hash:'c'.repeat(64)}];
  const manifest=recipientRulesManifest(files,'d'.repeat(64));assert.equal(manifest['/assets/app.js'],'b'.repeat(64));assert.equal(manifest['/inquiries/index.html'],'c'.repeat(64));assert.equal(manifest['/rules/index.html'],'d'.repeat(64));
  assert.throws(()=>recipientRulesManifest(files,'a'.repeat(64)));
});
test('write requires exact site-version binding without unknown flags',()=>{
  assert.deepEqual(parseRecipientRulesArgs([]),{apply:false,expected:undefined});
  assert.equal(parseRecipientRulesArgs(['--apply','--expected-version=sites/archive-pilates-core/versions/test']).apply,true);
  for(const args of [['--apply'],['--force'],['--apply','--expected-version=sites/another/versions/test'],['--apply','--apply']])assert.throws(()=>parseRecipientRulesArgs(args));
});
