import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertOpsHealthRulesScope,opsHealthManifest,parseOpsHealthReleaseArgs,OPS_RULES_BASE,OPS_RULES_BASE_HASH } from '../release-ops-health-rules.mjs';
import { assertManifest } from '../release-e261017-classroom.mjs';

const before=execFileSync('git',['show',`${OPS_RULES_BASE}:core/rules/index.html`],{encoding:'utf8'});
const after=execFileSync('git',['show','48feed27fd99dd6c7a61b6eb78980520f4679d08:core/rules/index.html'],{encoding:'utf8'});
const hash=text=>createHash('sha256').update(text).digest('hex');

test('pins the reviewed Git baseline and accepts only the reviewed new section',()=>{
  assert.equal(hash(before),OPS_RULES_BASE_HASH);
  assert.doesNotThrow(()=>assertOpsHealthRulesScope(before,after));
});
test('rejects unchanged, duplicated, modified or unrelated HTML additions',()=>{
  const section=after.match(/^        <section class="panel rule-section" id="ops-health-errors-20261102">\n[\s\S]*?        <\/section>\n\n/m)[0];
  for (const candidate of [before,after+'\n',after+section,after.replace('3회 연속','1회 즉시'),after.replace('<title>','<title>changed'),after.replace('ops-health-errors-20261102','another-section')])
    assert.throws(()=>assertOpsHealthRulesScope(before,candidate));
  assert.throws(()=>assertOpsHealthRulesScope(before+'\n',after));
});
test('argument parser accepts read-only plan and one exact apply version',()=>{
  const version='sites/archive-pilates-core/versions/reviewed';
  assert.deepEqual(parseOpsHealthReleaseArgs([]),{apply:false,expected:undefined});
  assert.deepEqual(parseOpsHealthReleaseArgs(['--apply',`--expected-version=${version}`]),{apply:true,expected:version});
});
test('argument parser rejects missing version, duplicate options and other sites',()=>{
  for (const args of [['--apply'],['--force'],['--apply','--apply'],['--expected-version=sites/archive-pilates/versions/a'],['--expected-version=sites/archive-pilates-core/versions/a?x=1'],['--expected-version=sites/archive-pilates-core/versions/a','--expected-version=sites/archive-pilates-core/versions/b']]) assert.throws(()=>parseOpsHealthReleaseArgs(args));
});
test('manifest preserves every current-live path except canonical rules',()=>{
  const files=[{path:'/rules/index.html',hash:hash('old')},{path:'/index.html',hash:hash('home')},{path:'/assets/app.js',hash:hash('app')}];
  const original=structuredClone(files), replacement=hash('new');
  const manifest=opsHealthManifest(files,replacement);
  assert.deepEqual(files,original);
  assert.deepEqual(files.filter(f=>f.hash!==manifest[f.path]).map(f=>f.path),['/rules/index.html']);
  assert.equal(Object.keys(manifest).length,3);
  assertManifest(Object.entries(manifest).map(([path,hash])=>({path,hash})),manifest);
  for (const invalid of [files.slice(1),[...files,files[0]],files.map(f=>({...f,hash:'bad'}))]) assert.throws(()=>opsHealthManifest(invalid,replacement));
  assert.throws(()=>opsHealthManifest(files,files[0].hash));
  assert.throws(()=>assertManifest(files,manifest));
});

