import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instructorReminderScheduled, createInstructorReminderTransportGuard } from '../lib/instructor-signature-reminder-runtime.mjs';

const plan = { memberId: '9000001', smsTitle: 'Synthetic', smsMessage: 'Synthetic reminder' };
const request = (method = 'POST', url = 'https://api.studiomate.kr/v2/staff/sms', payload = {
  users: [9000001], title: plan.smsTitle, message: plan.smsMessage,
}) => ({ method: () => method, url: () => url, postDataJSON: () => payload });

test('only ordinary unscoped apply can dispatch; manual target and maintenance remain read-only', () => {
  assert.equal(instructorReminderScheduled({ apply: true }), true);
  for (const patch of [{ apply: false }, { jobId: 'ilr_target' }, { loginOnly: true },
    { refreshCompletedFields: true }, { recheckCompletedDocument: 'a'.repeat(32) }])
    assert.equal(instructorReminderScheduled({ apply: true, ...patch }), false);
});

test('normal worker integrates reminders only after exact pending readback and original lease release', () => {
  const source = readFileSync(new URL('../process-eformsign-instructor-member-jobs.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function inspectCompletion('), end = source.indexOf('async function verifyCompletedOrderContact(');
  const body = source.slice(start, end);
  assert.equal((source.match(/await runInstructorSignatureReminder\(/g) || []).length, 1);
  assert.match(body, /if \(instructorReminderScheduled\(\{ apply, \.\.\.config \}\)\)/);
  assert.ok(body.indexOf('await runInstructorSignatureReminder(') > body.indexOf('missingCheckCount: 0'));
  assert.ok(body.indexOf('await runInstructorSignatureReminder(') > body.lastIndexOf('claimToken: null'));
  assert.ok(body.indexOf('return { status: "completed"') < body.indexOf('await runInstructorSignatureReminder('));
  assert.match(body, /AUTOMATION_REPORT_EVENT_ID: createHash\("sha256"\)/);
  assert.doesNotMatch(body, /signatureReminder.*status.*done/);
});

test('transport denies all writes until final confirmation arms exact one-recipient SMS', () => {
  const guard = createInstructorReminderTransportGuard({ now: () => new Date('2026-10-31T09:00:00+09:00') });
  let marks = 0;
  assert.equal(guard.allows(request()), false);
  guard.arm(plan, () => marks++);
  for (const bad of [request('PUT'), request('DELETE'), request('POST', 'https://api.studiomate.kr/v2/staff/member'),
    request('POST', 'https://api.studiomate.kr/v2/staff/sms?replay=1'),
    request('POST', undefined, { users: [9000002], title: plan.smsTitle, message: plan.smsMessage }),
    request('POST', undefined, { users: [9000001, 9000002], title: plan.smsTitle, message: plan.smsMessage }),
    request('POST', undefined, { users: [9000001], title: 'changed', message: plan.smsMessage }),
    request('POST', undefined, { users: [9000001], title: plan.smsTitle, message: 'changed' }),
    { ...request(), postDataJSON() { throw Error('private data'); } }]) assert.equal(guard.allows(bad), false);
  assert.equal(marks, 0);
  assert.equal(guard.allows(request()), true);
  assert.equal(marks, 1);
  assert.equal(guard.postCount, 1);
  assert.equal(guard.allows(request()), false);
  guard.arm(plan, () => marks++);
  assert.equal(guard.allows(request()), false);
  assert.equal(marks, 1);
});

test('20:00 clock crossing blocks the actual HTTP request with known zero POSTs', () => {
  let now = new Date('2026-10-31T19:59:59.999+09:00'), marks = 0;
  const guard = createInstructorReminderTransportGuard({ now: () => now });
  guard.arm(plan, () => marks++);
  now = new Date('2026-10-31T20:00:00+09:00');
  assert.equal(guard.allows(request()), false);
  assert.equal(guard.windowDenied, true);
  assert.equal(guard.postCount, 0);
  assert.equal(marks, 0);
});

test('disarm preserves reads but blocks writes; real-phone quiet hours have no override', () => {
  for (const clock of ['2026-10-31T08:59:59+09:00', '2026-10-31T23:00:00+09:00']) {
    const guard = createInstructorReminderTransportGuard({ now: () => new Date(clock) });
    guard.arm(plan, () => assert.fail('No transport allowed'));
    assert.equal(guard.allows(request()), false);
    guard.disarm();
    for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(guard.allows(request(method)), true);
    assert.equal(guard.allows(request()), false);
  }
});

test('final freshness or expiry rejection aborts HTTP without counting transport', () => {
  const guard = createInstructorReminderTransportGuard({ now: () => new Date('2026-10-31T09:00:00+09:00') });
  const failure = new Error('instructor_signature_reminder_live_stale');
  guard.arm(plan, () => { throw failure; });
  assert.equal(guard.allows(request()), false);
  assert.equal(guard.error, failure);
  assert.equal(guard.postCount, 0);
});
