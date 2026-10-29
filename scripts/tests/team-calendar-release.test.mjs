import test from 'node:test';
import assert from 'node:assert/strict';
import { teamCalendarManifest, TEAM_CALENDAR_FILES as paths } from '../release-team-261121-calendar.mjs';
test('calendar release is strictly additive and preserves every baseline hash',()=>{
 const old=[{path:'/old.js',hash:'a'.repeat(64)}],hashes=Object.fromEntries(paths.map(f=>[f,'b'.repeat(64)]));
 const next=teamCalendarManifest(old,hashes);assert.equal(next['/old.js'],old[0].hash);assert.equal(Object.keys(next).length,3);
 assert.throws(()=>teamCalendarManifest([...old,{path:paths[0],hash:'a'.repeat(64)}],hashes));
 assert.throws(()=>teamCalendarManifest(old,{...hashes,'/unapproved.js':'c'.repeat(64)}));
 assert.throws(()=>teamCalendarManifest(old,{[paths[0]]:'b'.repeat(64)}));
 assert.throws(()=>teamCalendarManifest([...old,...old],hashes));
});
test('calendar update replaces exactly two known hashes and nothing else',()=>{
 const old=[{path:'/old.js',hash:'a'.repeat(64)},...paths.map(path=>({path,hash:'b'.repeat(64)}))],before=Object.fromEntries(paths.map(f=>[f,'b'.repeat(64)])),after=Object.fromEntries(paths.map(f=>[f,'c'.repeat(64)]));
 const next=teamCalendarManifest(old,after,before);assert.equal(next['/old.js'],'a'.repeat(64));assert.equal(Object.keys(next).length,3);for(const f of paths)assert.equal(next[f],'c'.repeat(64));
 assert.throws(()=>teamCalendarManifest(old,after,{...before,[paths[0]]:'d'.repeat(64)}));
 assert.throws(()=>teamCalendarManifest(old.slice(0,2),after,before));
 assert.throws(()=>teamCalendarManifest([...old,{path:'/method/team-261121/unapproved.html',hash:'b'.repeat(64)}],after,before));
});
