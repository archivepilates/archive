import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {assertRecipientRulesScope,recipientRulesManifest,parseRecipientRulesArgs,RECIPIENT_RULES_BASE} from '../release-settlement-class-counts-rules.mjs';
const before=execFileSync('git',['show',`${RECIPIENT_RULES_BASE}:core/rules/index.html`]);
const after=fs.readFileSync('core/rules/index.html');
test('only the approved class-count policy line can change',()=>{
  assert.doesNotThrow(()=>assertRecipientRulesScope(before,after));
  for(const s of [after+'unrelated',String(after).replace('회원별 정산 건수','회원별 자동 발송'),before])assert.throws(()=>assertRecipientRulesScope(before,s));
});
test('count policy preserves all other Hosting files and requires expected version for writes',()=>{
  const files=[{path:'/rules/index.html',hash:'a'.repeat(64)},{path:'/index.html',hash:'b'.repeat(64)}];
  assert.equal(recipientRulesManifest(files,'c'.repeat(64))['/index.html'],'b'.repeat(64));
  assert.throws(()=>recipientRulesManifest(files,'a'.repeat(64)));
  assert.throws(()=>parseRecipientRulesArgs(['--apply']));
  assert.throws(()=>parseRecipientRulesArgs(['--force']));
  assert.equal(parseRecipientRulesArgs(['--apply','--expected-version=sites/archive-pilates-core/versions/test']).apply,true);
});
