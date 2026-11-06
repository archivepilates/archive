import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const config=JSON.parse(fs.readFileSync('firebase.json','utf8'));
test('both existing member hosts route only the new private self-service API and assets',()=>{
  for(const [site,prefix]of [['archive-pilates','/archivein'],['archive-pilates-in','']]){
    const host=config.hosting.find(h=>h.site===site);assert.ok(host);
    const api=host.rewrites.filter(x=>x.source===`${prefix}/api/instructorWaitlist`);
    assert.equal(api.length,1);assert.deepEqual(api[0].function,{functionId:'instructorLessonWaitlistApi',region:'asia-northeast3'});
    for(const file of['app.js','styles.css'])assert.deepEqual(host.rewrites.find(x=>x.source===`${prefix}/instructor-waitlist/${file}`),
      {source:`${prefix}/instructor-waitlist/${file}`,destination:`${prefix}/instructorWaitlist/${file}`});
    assert.equal(host.rewrites.find(x=>x.source===`${prefix}/instructor-waitlist/**`).destination,`${prefix}/instructorWaitlist/index.html`);
    const headers=host.headers.find(x=>x.source===`${prefix}/instructor{Waitlist,-waitlist}/**`).headers;
    assert.match(headers.find(x=>x.key==='Cache-Control').value,/no-store/);
    assert.equal(headers.find(x=>x.key==='Referrer-Policy').value,'no-referrer');
  }
});

test('new HTTP export has one owner, one scoped secret and no callable or scheduled trigger',()=>{
  const manifest=JSON.parse(fs.readFileSync('firebase/codebase-boundaries.json','utf8'));
  const owners=Object.entries(manifest.targetCodebases).filter(([,v])=>v.owns.includes('instructorLessonWaitlistApi')).map(([k])=>k);
  assert.deepEqual(owners,['functions-app']);
  const source=fs.readFileSync('firebase/kangsain-functions/functions/src/exports/app.ts','utf8');
  assert.match(source,/export const instructorLessonWaitlistApi = onRequest\([\s\S]*?secrets: \[privateSurveyWebhookSecret\][\s\S]*?createInstructorWaitlistApi/);
  const api=fs.readFileSync('firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonWaitlistPublic.ts','utf8');
  assert.doesNotMatch(api,/alimtalkCandidates|alimtalkSends|sendMessage|fetch\(|logger\.|console\.|createUser|tx\.delete\(/);
  const rules=fs.readFileSync('core/rules/index.html','utf8');
  assert.match(rules,/id="instructor-waitlist-links-20261106"/);
  assert.match(rules,/접수 안내 본문은 수업명·주제·수강일만 표시하고 순번은 넣지 않습니다/);
});
