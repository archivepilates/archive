import test from 'node:test';
import assert from 'node:assert/strict';
import { runEformStage, waitForEformOperatorFields, resolvedEformErrorPatch } from '../lib/eformsign-send-readiness.mjs';

test('operator readiness uses visible fields, not vendor load_status', async () => {
  const calls = [];
  const frame = { locator: selector => ({ waitFor: async options => calls.push([selector, options.state]) }) };
  const page = { locator: selector => ({ waitFor: async options => calls.push([selector, options.state]) }), frameLocator: () => frame };
  assert.equal(await waitForEformOperatorFields(page, { ticket: 'ozinput_33', amount: 'ozinput_34' }), frame);
  assert.deepEqual(calls, [['#viewer_frame', 'attached'], ['#ozinput_33', 'visible'], ['#ozinput_34', 'visible']]);
});

for (const stage of ['operator_fields_ready', 'send_transition', 'send_dialog']) {
  test(`${stage} failure names stage and preserves original cause`, async () => {
    const original = new Error('timeout'); original.name = 'TimeoutError';
    const page = { evaluate: async () => ({ path: '/eform/document/view_service.html', framePresent: true, viewerStatus: '0', processText: '다음' }) };
    await assert.rejects(runEformStage(page, stage, async () => { throw original; }), error => {
      assert.equal(error.cause, original);
      assert.match(error.message, new RegExp(stage));
      assert.match(error.message, /TimeoutError/);
      return true;
    });
  });
}

test('missing frame stops before fields and before any send', async () => {
  const page = { locator: () => ({ waitFor: async () => { throw new Error('missing frame'); } }), frameLocator: () => assert.fail('must not enter missing frame') };
  await assert.rejects(waitForEformOperatorFields(page, { ticket: 'a' }), /missing frame/);
});

test('diagnostic failure cannot mask original failure', async () => {
  const original = new Error('failed');
  await assert.rejects(runEformStage({ evaluate: async () => { throw new Error('closed'); } }, 'send_transition', async () => { throw original; }), error => error.cause === original && error.message.includes('unavailable'));
});

test('success clears only matching resolved eform error and keeps audit', () => {
  assert.deepEqual(resolvedEformErrorPatch({ lastError: 'timeout', steps: { ticket: { status: 'verified' } } }, 'timeout'), { lastError: null, lastResolvedEformError: 'timeout' });
  assert.deepEqual(resolvedEformErrorPatch({ lastError: 'another error' }, 'timeout'), {});
  assert.deepEqual(resolvedEformErrorPatch({ lastError: 'timeout', steps: { memo: { status: 'failed' } } }, 'timeout'), {});
  assert.deepEqual(resolvedEformErrorPatch({ lastError: 'timeout' }, null), {});
});

test('successful stage returns value unchanged', async () => {
  assert.equal(await runEformStage({}, 'ready', async () => 42), 42);
});
