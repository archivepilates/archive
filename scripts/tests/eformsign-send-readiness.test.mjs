import test from 'node:test';
import assert from 'node:assert/strict';
import { runEformStage, waitForEformOperatorFields, waitForEformSendReady, resolvedEformErrorPatch, eformNumericPaymentValue } from '../lib/eformsign-send-readiness.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
const workerTree = ts.createSourceFile('instructor-worker.mjs',
  readFileSync(new URL('../process-eformsign-instructor-member-jobs.mjs', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fillDeclaration = workerTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'fillFrameField');
assert.ok(fillDeclaration, 'Missing instructor field writer');

function keyboardFixture(platform, failAt = '') {
  // Extract only the field writer; never import the executable worker or open a browser.
  const write = vm.runInNewContext(`${fillDeclaration.getText(workerTree)}\nfillFrameField`, {
    process: Object.freeze({platform}),
  }, {timeout: 1000});
  const calls = [];
  const failure = new Error(`synthetic ${failAt || 'unused'} failure`);
  const forbidden = () => assert.fail('No fill fallback, page keyboard, browser or send is allowed');
  const field = {
    async waitFor(options) { calls.push(['waitFor', options.state, options.timeout]); },
    async click(options) { assert.equal(options, undefined); calls.push(['click']); },
    async press(key) {
      calls.push(['press', key]);
      if (failAt === 'commit' && key === 'Enter') throw failure;
    },
    async pressSequentially(value, options) {
      calls.push(['pressSequentially', value, options.delay]);
      if (failAt === 'typing') throw failure;
    },
    fill: forbidden,
  };
  const frame = {locator(selector) { calls.push(['locator', selector]); return field; }};
  const page = Object.freeze({keyboard: Object.freeze({press: forbidden, type: forbidden})});
  return {write, calls, failure, frame, page};
}

for (const platform of ['darwin', 'linux']) {
  const selectAll = platform === 'darwin' ? 'Meta+A' : 'Control+A';
  for (const value of [70000, 'Synthetic ticket']) {
    test(`${platform} field writer uses focused keyboard input and one Enter commit for ${typeof value}`, async () => {
      const f = keyboardFixture(platform);
      await f.write(f.page, f.frame, 'synthetic-field', value);
      assert.deepEqual(f.calls, [
        ['locator', '#synthetic-field'], ['waitFor', 'visible', 30000], ['click'],
        ['press', selectAll], ['pressSequentially', String(value), 3], ['press', 'Enter'],
      ]);
    });
  }
  test(`${platform} Enter commit failure propagates without Tab, fallback or retry`, async () => {
    const f = keyboardFixture(platform, 'commit');
    await assert.rejects(f.write(f.page, f.frame, 'synthetic-field', 70000), error => error === f.failure);
    assert.deepEqual(f.calls, [
      ['locator', '#synthetic-field'], ['waitFor', 'visible', 30000], ['click'],
      ['press', selectAll], ['pressSequentially', '70000', 3], ['press', 'Enter'],
    ]);
  });
  test(`${platform} typing failure stops before Enter and retains the stage cause`, async () => {
    const f = keyboardFixture(platform, 'typing');
    const diagnosticPage = {evaluate: async () => ({
      path: '/eform/document/view_service.html', framePresent: true, viewerStatus: '1', processText: 'Next',
    })};
    await assert.rejects(runEformStage(diagnosticPage, 'payment_input', () =>
      f.write(f.page, f.frame, 'synthetic-field', 70000)), error => {
      assert.equal(error.cause, f.failure);
      assert.match(error.message, /^\[eformsign:payment_input\] Error /);
      return true;
    });
    assert.deepEqual(f.calls, [
      ['locator', '#synthetic-field'], ['waitFor', 'visible', 30000], ['click'],
      ['press', selectAll], ['pressSequentially', '70000', 3],
    ]);
  });
}

test('native Send waits for completion notice without changing validation state or clicking twice', async () => {
  const checker={completeToast:true};
  let processText='Send';let loadStatus='1';let callback;
  const context={window:{requiredChecker:checker},document:{querySelector:s=>s==='#viewer_layer'?{getAttribute:()=>loadStatus}:{textContent:processText}}};
  await waitForEformSendReady({waitForFunction:async(fn,arg,options)=>{
    assert.equal(options.timeout,30000);assert.equal(arg,undefined);
    callback=()=>vm.runInNewContext(`(${fn.toString()})()`,context);
    assert.equal(callback(),false);
    assert.equal(checker.completeToast,true);
    checker.completeToast=false;assert.equal(callback(),true);
    processText='Next';assert.equal(callback(),false);
    processText='전송';assert.equal(callback(),true);
    loadStatus='0';assert.equal(callback(),false);
    loadStatus='1';context.window.requiredChecker=undefined;assert.equal(callback(),false);
  }});
  const worker=readFileSync(new URL('../process-eformsign-instructor-member-jobs.mjs',import.meta.url),'utf8');
  const open=worker.slice(worker.indexOf('async function openSendDialog'),worker.indexOf('async function fillFrameField'));
  assert.ok(open.indexOf('await waitForEformSendReady(page)')<open.indexOf('await sendButton.click()'));
  assert.equal(open.match(/sendButton\.click\(\)/g).length,1);
});

test('numeric payment input never contains currency formatting rejected by the field', () => {
  assert.equal(eformNumericPaymentValue(70000), '70000');
  for (const value of [0, -1, NaN, Infinity, 1.5, '70000', null]) assert.throws(() => eformNumericPaymentValue(value));
});
test('worker validates actual values before Next and retains native required-field validation', () => {
  const s=readFileSync(new URL('../process-eformsign-instructor-member-jobs.mjs',import.meta.url),'utf8');
  assert.ok(s.indexOf('"operator_values_ready"') < s.indexOf('await processButton.click()'));
  assert.ok(s.includes('eformNumericPaymentValue(ticketPrice)'));
  assert.equal(s.includes('__checkRequired'),false);
  const fill=s.slice(s.indexOf('async function fillFrameField'),s.indexOf('async function configureSmsRecipient'));
  assert.ok(fill.includes('field.pressSequentially(String(value), { delay: 3 })'));
  assert.ok(fill.includes('await field.press("Enter")'));
  assert.equal(fill.includes('.fill('),false);
  assert.equal(fill.includes('.catch('),false);
});

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
