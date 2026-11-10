import test from 'node:test';
import assert from 'node:assert/strict';
import {assigneeReleaseManifest,releaseAssignees} from '../release-member-inquiry-assignees.mjs';
test('assignee release changes exactly the two reviewed paths and preserves all others',()=>{
  const files=['/assets/member-inquiries.js','/rules/index.html','/other.js'].map(path=>({path,hash:'a'.repeat(64)}));
  const replacements={'/assets/member-inquiries.js':'b'.repeat(64),'/rules/index.html':'c'.repeat(64)};
  const manifest=assigneeReleaseManifest(files,replacements);
  assert.equal(manifest['/other.js'],'a'.repeat(64));assert.equal(Object.keys(manifest).length,3);
  assert.throws(()=>assigneeReleaseManifest(files,{...replacements,'/other.js':'d'.repeat(64)}));
  assert.throws(()=>assigneeReleaseManifest(files,{'/assets/member-inquiries.js':'a'.repeat(64),'/rules/index.html':'c'.repeat(64)}));
  assert.throws(()=>assigneeReleaseManifest([...files,files[0]],replacements));
});
test('release refuses missing baseline and unknown arguments without auth or network',async()=>{
  for(const args of [[],['--apply'],['--expected-version=foreign'],['--expected-version=sites/archive-pilates-core/versions/example','--bypass']])await assert.rejects(releaseAssignees(args),/Exact baseline/);
});
