import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowManifest,releaseWorkflow} from '../release-member-inquiry-workflow.mjs';
const added='/assets/member-inquiry-guidance.json';
const resources={core:['/assets/member-inquiries.js','/assets/member-inquiries.css',added,'/inquiries/index.html','/rules/index.html'],help:['/assets/app.js','/assets/styles.css',added,'/index.html']};
test('workflow release may add only the reviewed guidance asset and retain all unrelated files',()=>{
  for(const target of ['core','help']){
    const replacements=Object.fromEntries(resources[target].map(resource=>[resource,'b'.repeat(64)]));
    const files=[...resources[target].filter(resource=>resource!==added),'/unrelated.js'].map(path=>({path,hash:'a'.repeat(64)}));
    const manifest=workflowManifest(files,replacements,target);
    assert.equal(manifest['/unrelated.js'],'a'.repeat(64));assert.equal(manifest[added],'b'.repeat(64));assert.equal(Object.keys(manifest).length,files.length+1);
    assert.throws(()=>workflowManifest([...files,{path:added,hash:'c'.repeat(64)}],replacements,target));
    assert.throws(()=>workflowManifest(files,{...replacements,'/unapproved.js':'b'.repeat(64)},target));
    assert.throws(()=>workflowManifest(files.slice(1),replacements,target));
    assert.throws(()=>workflowManifest([...files,files[0]],replacements,target));
  }
});
test('workflow release rejects foreign targets, baselines and options before authentication or network',async()=>{
  for(const args of [[],['--apply'],['--target=core','--expected-version=sites/archive-pilates-help/versions/one'],['--target=help','--expected-version=sites/archive-pilates-help/versions/one','--override']])await assert.rejects(releaseWorkflow(args),/Exact target and version/);
});
