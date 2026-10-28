import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {normalizeInstructorLessonName,INSTRUCTOR_LESSON_TICKET_NAME} from '../lib/instructor-lesson-registration-contract.mjs';
const require=createRequire(new URL('../../firebase/kangsain-functions/functions/package.json',import.meta.url));
const ts=require('typescript');
const tree=ts.createSourceFile('worker.mjs',readFileSync(new URL('../process-instructor-lesson-registration-jobs.mjs',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const source=['findActiveInstructorTicket','ticketDates'].map(name=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree)).join('\n');
const api=vm.runInNewContext(`${source}\n({findActiveInstructorTicket})`,{normalizeInstructorLessonName,INSTRUCTOR_LESSON_TICKET_NAME});
function fixture(before,after=before){
 let phase=0,reloads=0;
 const rows=()=>phase?after:before;
 const cards={count:async()=>rows().length,nth:i=>({isVisible:async()=>rows()[i].visible!==false,evaluate:async()=>!!rows()[i].nested,
 innerText:async()=>rows()[i].text||'2026.11.29 ~ 2026.11.29',locator:()=>({innerText:async()=>INSTRUCTOR_LESSON_TICKET_NAME}),getAttribute:async()=>rows()[i].id||null})};
 const page={locator:selector=>selector==='.member-detail__header'?{waitFor:async()=>{}}:{first:()=>({locator:()=>cards})},reload:async()=>{reloads++;phase++;}};
 return{page,reloads:()=>reloads};
}
test('transient double render is independently reloaded once without issuing',async()=>{const f=fixture([{},{}],[{}]);const t=await api.findActiveInstructorTicket(f.page,'2026-11-29');assert.ok(t);assert.equal(f.reloads(),1);});
test('real repeated duplicates remain blocked after one read-only reload',async()=>{const f=fixture([{},{}]);await assert.rejects(api.findActiveInstructorTicket(f.page,'2026-11-29'),/2개 이상/);assert.equal(f.reloads(),1);});
test('hidden and nested presentations are not separate physical tickets',async()=>{const f=fixture([{visible:false},{nested:true},{id:'123'}]);const t=await api.findActiveInstructorTicket(f.page,'2026-11-29');assert.equal(t.ticketId,'123');assert.equal(f.reloads(),0);});
