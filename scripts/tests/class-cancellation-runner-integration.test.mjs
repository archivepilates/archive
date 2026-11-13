import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {correctionHorizon, shouldRunClassCorrection, notifyClassCorrectionReview, validateClassCorrectionOptions, runNativeClassCorrection} from '../run-class-cancellation-correction.mjs';
import {nativeClassCells, nativeDateTime, classCorrectionTransportAllowed, forwardNativeClassMutation, waitForNativeClassCount} from '../lib/class-cancellation-native-browser.mjs';
import {reportMessageId} from '../../firebase/kangsain-functions/macmini-studiomate/automation-report-delivery.mjs';

test('horizon follows KST today through next calendar month, including December', () => {
  assert.deepEqual(correctionHorizon(new Date('2026-11-13T11:00:00Z')), {from: '2026-11-13', through: '2026-12-31'});
  assert.deepEqual(correctionHorizon(new Date('2026-12-31T15:01:00Z')), {from: '2027-01-01', through: '2027-02-28'});
});

test('invalid recovery approval never falls through into ordinary apply or starts a browser', async () => {
  for (const approval of [undefined, null, false, 0, '', [], 'not-an-approval']) {
    await assert.rejects(runNativeClassCorrection({apply: true, recover: true, approval}), /Explicit recovery mode/);
  }
  for (const approval of [null, false, 0, '', {}]) {
    assert.throws(() => validateClassCorrectionOptions({apply: true, preview: false, recover: false, approval}), /Explicit recovery mode/);
  }
  for (const approval of [{}, {version: 'invalid'}, {date: '2026-12-05'}]) {
    await assert.rejects(runNativeClassCorrection({apply: true, recover: true, approval}), /Pretransport recovery/);
  }
  assert.doesNotThrow(() => validateClassCorrectionOptions({apply: true, preview: false, recover: false, approval: undefined}));
});

test('malformed target or inactive recovery approval rejects before any browser setup', async () => {
  const approval = {version: 'class_cancellation_pretransport_recovery_v1', approvalRef: 'call_test',
    originalKey: 'a'.repeat(64), originalDigest: 'b'.repeat(64), approvedAt: '2026-11-13T10:00:00+09:00',
    expiresAt: '2026-11-13T12:00:00+09:00', proof: 'before_submit_blocked_transport_gate_never_armed',
    date: '2026-12-05', startTime: '09:00', expectedDeadline: '2026-12-04 21:00:00'};
  assert.doesNotThrow(() => validateClassCorrectionOptions({apply: true, preview: false, recover: true, approval}));
  for (const patch of [{date: '2026-02-30'}, {date: '2026-12-07'}, {startTime: '99:00'}, {expectedDeadline: 'wrong'}]) {
    await assert.rejects(runNativeClassCorrection({apply: true, recover: true, approval: {...approval, ...patch}}), /Pretransport recovery/);
  }
  for (const now of [() => new Date('2026-11-13T13:00:00+09:00'), () => new Date(NaN)]) {
    await assert.rejects(runNativeClassCorrection({apply: true, recover: true, approval, now}), /approval not active or expired/);
  }
});

test('only scheduled successful full native imports invoke correction, never notification/manual imports', () => {
  const valid = {apply: true, download: true, scheduledRun: true, notificationRefresh: false, steps: ['download', 'memberProfiles', 'reservations'].map(name => ({name, exitCode: 0, stdoutOk: true}))};
  assert.equal(shouldRunClassCorrection(valid), true);
  for (const name of ['apply', 'download', 'scheduledRun']) assert.equal(shouldRunClassCorrection({...valid, [name]: false}), false);
  assert.equal(shouldRunClassCorrection({...valid, notificationRefresh: true}), false);
  for (const name of ['download', 'memberProfiles', 'reservations']) {
    assert.equal(shouldRunClassCorrection({...valid, steps: valid.steps.filter(s => s.name !== name)}), false);
    assert.equal(shouldRunClassCorrection({...valid, steps: valid.steps.map(s => s.name === name ? {...s, stdoutOk: false} : s)}), false);
  }
  const source = readFileSync(new URL('../run-studiomate-excel-emergency-mode.mjs', import.meta.url), 'utf8');
  assert.match(source, /steps\.push\(runStep\("classCancellationCorrection"/);
  assert.match(source, /new Set\(\["staffEmployment", "holdingSource", "classCancellationCorrection"\]\)/);
});

test('native table parser preserves distinct capacities, deadlines, date and actual start/end', () => {
  const raw = ['', '2026. 11. 21. (토) 09:30~10:20', 'Staff', '그룹', 'Class', '그룹', 'Room', '5/2', '무제한', '2026. 11. 21. 09:29 까지', '2026. 11. 20. 21:00 까지', '2026. 11. 21. 07:30 까지', '2026. 11. 21. 07:30'];
  const result = nativeClassCells(raw);
  assert.deepEqual(result.slice(0, 3), ['2026-11-21', '09:30', '10:20']);
  assert.deepEqual(result.slice(8, 10), ['5', '2']);
  assert.equal(result[12], '2026-11-20 21:00:00 까지');
  assert.equal(result[13], '2026-11-21 07:30:00');
  assert.equal(nativeDateTime('-'), '');
  assert.throws(() => nativeDateTime('21:00'), /Unrecognized/);
  assert.throws(() => nativeClassCells(raw.slice(1)), /column/);
});

test('final transport budget checks actual time, proof expiry, native origin and owning editor', () => {
  const now = new Date('2026-11-13T13:59:59.999Z');
  const input = {method: 'POST', origin: 'https://api.studiomate.kr', isEditor: true, used: false,
    armed: {deadline: '2026-11-20 21:00:00', expiresAt: now.getTime() + 60000}, now};
  assert.equal(classCorrectionTransportAllowed(input), true);
  for (const patch of [{method: 'DELETE'}, {origin: 'https://unexpected.example'}, {isEditor: false}, {used: true},
    {armed: null}, {armed: {}}, {armed: {...input.armed, expiresAt: now.getTime() - 1}},
    {armed: {...input.armed, deadline: '2026-11-13 22:59:59'}}, {now: new Date('2026-11-13T14:00:00Z')}]) {
    assert.equal(classCorrectionTransportAllowed({...input, ...patch}), false);
  }
  const runner = readFileSync(new URL('../run-class-cancellation-correction.mjs', import.meta.url), 'utf8');
  const adapter = readFileSync(new URL('../lib/class-cancellation-native-browser.mjs', import.meta.url), 'utf8');
  assert.match(runner, /serviceWorkers: 'block'/);
  assert.match(adapter, /context\(\)\.route\('\*\*\/\*'/);
  assert.match(adapter, /Native class ordering changed during pagination/);
  assert.match(adapter, /await assertSelected\(\)/);
  assert.match(adapter, /origin !== 'https:\/\/api\.studiomate\.kr'\) return route\.abort/);
});

test('native mutation forwards one UI request only, rejects redirects without following or retrying', async () => {
  for (const status of [200, 302, 307, 308, 400, 500]) {
    const calls = [];
    const response = {status: () => status};
    const route = {fetch: async options => {calls.push(['fetch', options]); return response;},
      fulfill: async value => {assert.equal(value.response, response); calls.push(['fulfill']);},
      abort: async () => calls.push(['abort'])};
    const result = await forwardNativeClassMutation(route);
    assert.deepEqual(calls[0], ['fetch', {maxRedirects: 0, maxRetries: 0, timeout: 20000}]);
    assert.equal(calls.filter(c => c[0] === 'fetch').length, 1);
    assert.deepEqual(calls[1], [status === 200 ? 'fulfill' : 'abort']);
    assert.equal(result.ok, status === 200);
  }
  const result = await forwardNativeClassMutation({fetch: async () => {throw Error('unknown');}, abort: async () => {}});
  assert.equal(result.ok, false); assert.equal(result.status, 'unknown');
});

test('internal review mail is one-shot per incident; deferred and uncertain receipts never resend', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'class-alert-'));
  let calls = 0;
  const send = async value => {
    calls++; assert.match(value.subject, /^\[주말 수업 취소마감\]\[확인필요\]/);
    assert.equal(reportMessageId(value.eventId), `automation-${value.eventId}@archivepilates.com`);
    assert.match(value.body, /#class-cancellation-guard-20261113/); return false;
  };
  try {
    const result = {status: 'review', reviewCount: 1, details: [{status: 'review', key: 'a'.repeat(64), reason: 'unknown'}]};
    assert.equal(await notifyClassCorrectionReview(result, root, '/private/report.json', send), 'unknown');
    assert.equal(await notifyClassCorrectionReview(result, root, '/private/new-report.json', send), 'already_reported_or_unknown');
    assert.equal(await notifyClassCorrectionReview({status: 'deferred', reviewCount: 0}, root, '/private/deferred.json', send), 'not_needed');
    assert.equal(calls, 1);
  } finally {await fs.rm(root, {recursive: true, force: true});}
});

test('settled UI count works on paragraph counters and rejects provisional prior counts', async () => {
  const page = {async waitForFunction(fn, total) {
    let current = '필터된 수업 3 개';
    const predicate = vm.runInNewContext(`(${fn.toString()})`, {document: {querySelectorAll: selector => {
      assert.equal(selector, '*'); return [{tagName: 'P', innerText: current}];
    }}});
    assert.equal(predicate(total), false);
    current = '필터된 수업 451 개'; assert.equal(predicate(total), true);
  }};
  await waitForNativeClassCount(page, 451);
});
