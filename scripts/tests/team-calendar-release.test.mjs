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
