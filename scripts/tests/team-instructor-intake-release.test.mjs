import assert from 'node:assert/strict';
import test from 'node:test';
import { MEAL_RELEASE_TARGETS, mealReleaseManifest } from '../release-team-instructor-intake-20261029.mjs';
const hash = 'a'.repeat(64), old = 'b'.repeat(64);
test('capacity repair rule release preserves every non-rule asset',()=>{
  const files=[{path:'/rules/index.html',hash:old},{path:'/assets/app.js',hash:old}];
  assert.deepEqual(MEAL_RELEASE_TARGETS.capacityRepairVerification.files,{'/rules/index.html':'core/rules/index.html'});
  assert.equal(mealReleaseManifest(files,{'/rules/index.html':hash},'capacityRepairVerification')['/assets/app.js'],old);
  assert.throws(()=>mealReleaseManifest(files,{'/rules/index.html':hash,'/assets/app.js':hash},'capacityRepairVerification'));
});
test('schedule display replaces exactly app, interface CSS and rules', () => {
  const expected = {'/assets/app.js':'core/assets/app.js','/assets/interface.css':'core/assets/interface.css','/rules/index.html':'core/rules/index.html'};
  assert.deepEqual(MEAL_RELEASE_TARGETS.scheduleDisplay.files, expected);
  const files = [...Object.keys(expected).map(path => ({path,hash:old})),{path:'/unrelated.html',hash:old}];
  const replacements = Object.fromEntries(Object.keys(expected).map(path => [path,hash]));
  const manifest = mealReleaseManifest(files,replacements,'scheduleDisplay');
  assert.equal(manifest['/unrelated.html'],old);
  assert.equal(Object.keys(manifest).length,files.length);
  assert.throws(() => mealReleaseManifest(files,{...replacements,'/unrelated.html':hash},'scheduleDisplay'));
  assert.throws(() => mealReleaseManifest(files.slice(1),replacements,'scheduleDisplay'));
});
test('Team release replaces only four CORE assets and preserves all other paths', () => {
  assert.deepEqual(Object.keys(MEAL_RELEASE_TARGETS), ['core', 'verification', 'fulfillment', 'fulfillmentVerification', 'scheduleDisplay', 'capacityRepairVerification', 'signupProfileV2', 'signupProfileV2Verification', 'instructorSignatureReminder', 'coreMcpFastDiscovery']);
  const expected = ['/instructor-lessons/index.html', '/assets/app.js', '/rules/index.html', '/assets/alimtalk-catalog.json'];
  assert.deepEqual(Object.keys(MEAL_RELEASE_TARGETS.core.files), expected);
  const replacements = Object.fromEntries(expected.map(f => [f, hash]));
  const files = [...expected.map(path => ({ path, hash: old })), { path: '/unrelated.html', hash: old }];
  const manifest = mealReleaseManifest(files, replacements, 'core');
  assert.equal(manifest['/unrelated.html'], old);
  assert.equal(Object.keys(manifest).length, files.length);
  assert.throws(() => mealReleaseManifest(files, { ...replacements, '/unrelated.html': hash }, 'core'));
  assert.throws(() => mealReleaseManifest(files.slice(1), replacements, 'core'));
  assert.throws(() => mealReleaseManifest(files, replacements, 'member'));
});
test('signup profile release changes only the operating rules',()=>{
  assert.deepEqual(MEAL_RELEASE_TARGETS.signupProfileV2.files,{'/rules/index.html':'core/rules/index.html'});
  const files=[{path:'/rules/index.html',hash:old},{path:'/assets/app.js',hash:old}];
  assert.equal(mealReleaseManifest(files,{'/rules/index.html':hash},'signupProfileV2')['/assets/app.js'],old);
  assert.throws(()=>mealReleaseManifest(files,{'/rules/index.html':hash,'/assets/app.js':hash},'signupProfileV2'));
});
test('profile completion separation release remains rules-only',()=>{
  assert.deepEqual(MEAL_RELEASE_TARGETS.signupProfileV2Verification.files,{'/rules/index.html':'core/rules/index.html'});
  const files=[{path:'/rules/index.html',hash:old},{path:'/assets/app.js',hash:old}];
  assert.equal(mealReleaseManifest(files,{'/rules/index.html':hash},'signupProfileV2Verification')['/assets/app.js'],old);
  assert.throws(()=>mealReleaseManifest(files,{'/rules/index.html':hash,'/assets/app.js':hash},'signupProfileV2Verification'));
});
test('instructor reminder release cannot replace app assets or configuration',()=>{
  assert.deepEqual(MEAL_RELEASE_TARGETS.instructorSignatureReminder.files,{'/rules/index.html':'core/rules/index.html'});
  const files=[{path:'/rules/index.html',hash:old},{path:'/assets/app.js',hash:old},{path:'/climate/index.html',hash:old}];
  const manifest=mealReleaseManifest(files,{'/rules/index.html':hash},'instructorSignatureReminder');
  assert.equal(manifest['/assets/app.js'],old);
  assert.equal(manifest['/climate/index.html'],old);
  assert.equal(Object.keys(manifest).length,files.length);
  assert.throws(()=>mealReleaseManifest(files,{'/rules/index.html':hash,'/assets/app.js':hash},'instructorSignatureReminder'));
});
test('MCP fast discovery release preserves every non-rules path', () => {
  assert.deepEqual(MEAL_RELEASE_TARGETS.coreMcpFastDiscovery.files, {'/rules/index.html':'core/rules/index.html'});
  const files = [{path:'/rules/index.html',hash:old},{path:'/assets/app.js',hash:old},{path:'/climate/index.html',hash:old}];
  const manifest = mealReleaseManifest(files, {'/rules/index.html':hash}, 'coreMcpFastDiscovery');
  assert.equal(manifest['/assets/app.js'], old);
  assert.equal(manifest['/climate/index.html'], old);
  assert.equal(Object.keys(manifest).length, files.length);
  assert.throws(() => mealReleaseManifest(files, {'/rules/index.html':hash,'/assets/app.js':hash}, 'coreMcpFastDiscovery'));
});
test('Team fulfillment replaces only app and rules without changing other assets', () => {
  assert.deepEqual(MEAL_RELEASE_TARGETS.fulfillment.files, {'/assets/app.js':'core/assets/app.js','/rules/index.html':'core/rules/index.html'});
  const files=[{path:'/assets/app.js',hash:old},{path:'/rules/index.html',hash:old},{path:'/instructor-lessons/index.html',hash:old}];
  const manifest=mealReleaseManifest(files,{'/assets/app.js':hash,'/rules/index.html':hash},'fulfillment');
  assert.equal(manifest['/instructor-lessons/index.html'],old);
  assert.throws(()=>mealReleaseManifest(files,{'/assets/app.js':hash,'/rules/index.html':hash,'/instructor-lessons/index.html':hash},'fulfillment'));
});
test('post-verification release cannot change app or other assets', () => {
  assert.deepEqual(MEAL_RELEASE_TARGETS.verification.files, { '/rules/index.html': 'core/rules/index.html' });
  const files = [{ path: '/rules/index.html', hash: old }, { path: '/assets/app.js', hash: old }];
  assert.equal(mealReleaseManifest(files, { '/rules/index.html': hash }, 'verification')['/assets/app.js'], old);
  assert.throws(() => mealReleaseManifest(files, { '/rules/index.html': hash, '/assets/app.js': hash }, 'verification'));
});
test('Team final verification is rules-only and preserves the deployed app',()=>{
  assert.deepEqual(MEAL_RELEASE_TARGETS.fulfillmentVerification.files,{'/rules/index.html':'core/rules/index.html'});
  const files=[{path:'/rules/index.html',hash:old},{path:'/assets/app.js',hash:old}];
  assert.equal(mealReleaseManifest(files,{'/rules/index.html':hash},'fulfillmentVerification')['/assets/app.js'],old);
  assert.throws(()=>mealReleaseManifest(files,{'/rules/index.html':hash,'/assets/app.js':hash},'fulfillmentVerification'));
});
