import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertContractCoverageRulesScope,contractCoverageManifest,parseContractCoverageReleaseArgs,COVERAGE_RULES_BASE,COVERAGE_RULES_BASE_HASH } from '../release-contract-coverage-rules.mjs';
import { assertManifest } from '../release-e261017-classroom.mjs';

const before=execFileSync('git',['show',`${COVERAGE_RULES_BASE}:core/rules/index.html`],{encoding:'utf8'});
const after=fs.readFileSync(new URL('../../core/rules/index.html',import.meta.url),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');

test('pins the reviewed Git baseline and accepts only the reviewed new section',()=>{
  assert.equal(hash(before),COVERAGE_RULES_BASE_HASH);
  assert.doesNotThrow(()=>assertContractCoverageRulesScope(before,after));
});
test('rejects unchanged, duplicated, modified or unrelated HTML additions',()=>{
  const section=after.match(/^        <section class="panel rule-section" id="contract-source-coverage-review-20261102">\n[\s\S]*?        <\/section>\n\n/m)[0];
  for (const candidate of [before,after+'\n',after+section,after.replace('처음 보는 행','검토 없는 행'),after.replace('<title>','<title>changed'),after.replace('contract-source-coverage-review-20261102','another-section')])
    assert.throws(()=>assertContractCoverageRulesScope(before,candidate));
  assert.throws(()=>assertContractCoverageRulesScope(before+'\n',after));
});
test('argument parser accepts read-only plan and one exact apply version',()=>{
  const version='sites/archive-pilates-core/versions/reviewed';
  assert.deepEqual(parseContractCoverageReleaseArgs([]),{apply:false,expected:undefined});
  assert.deepEqual(parseContractCoverageReleaseArgs(['--apply',`--expected-version=${version}`]),{apply:true,expected:version});
});
test('argument parser rejects missing version, duplicate options and other sites',()=>{
  for (const args of [['--apply'],['--force'],['--apply','--apply'],['--expected-version=sites/archive-pilates/versions/a'],['--expected-version=sites/archive-pilates-core/versions/a?x=1'],['--expected-version=sites/archive-pilates-core/versions/a','--expected-version=sites/archive-pilates-core/versions/b']]) assert.throws(()=>parseContractCoverageReleaseArgs(args));
});
test('manifest preserves every current-live path except canonical rules',()=>{
  const files=[{path:'/rules/index.html',hash:hash('old')},{path:'/index.html',hash:hash('home')},{path:'/assets/app.js',hash:hash('app')}];
  const original=structuredClone(files), replacement=hash('new');
  const manifest=contractCoverageManifest(files,replacement);
  assert.deepEqual(files,original);
  assert.deepEqual(files.filter(f=>f.hash!==manifest[f.path]).map(f=>f.path),['/rules/index.html']);
  assert.equal(Object.keys(manifest).length,3);
  assertManifest(Object.entries(manifest).map(([path,hash])=>({path,hash})),manifest);
  for (const invalid of [files.slice(1),[...files,files[0]],files.map(f=>({...f,hash:'bad'}))]) assert.throws(()=>contractCoverageManifest(invalid,replacement));
  assert.throws(()=>contractCoverageManifest(files,files[0].hash));
  assert.throws(()=>assertManifest(files,manifest));
});


