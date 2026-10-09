import test from 'node:test';
import assert from 'node:assert/strict';
import { imwebRequestFailure, sanitizeImwebFailureDetails, TRANSIENT_READ_CODE } from '../lib/imweb-read-failure.mjs';
import { imwebJson } from '../lib/imweb-referral-source.mjs';

const envelope = status => ({ ok: false, error: { kind: 'imweb_api', status_code: status,
  error_code: '30001', message: 'private person@example.test token=secret', context: { secret: 'credential' } } });
const cliError = (status, stream = 'stdout') => Object.assign(new Error('private command output'), {
  [stream]: JSON.stringify(envelope(status)), status: 1,
});

test('observed CLI snake-case envelope is classified on stdout and stderr without retaining private output', () => {
  for (const stream of ['stdout', 'stderr']) {
    for (const status of [429, 500, 502, 503, 504]) {
      const error = imwebRequestFailure(cliError(status, stream), { readOnly: true, operation: 'member_list' });
      assert.equal(error.code, TRANSIENT_READ_CODE);
      assert.deepEqual(error.failureDetails, { operation: 'member_list', statusCode: status, providerCode: '30001' });
      assert.doesNotMatch(JSON.stringify(error), /private|secret|credential|@/);
    }
  }
  const error = imwebRequestFailure({ stdout: '{}', stderr: JSON.stringify(envelope(503)) }, { readOnly: true });
  assert.equal(error.code, TRANSIENT_READ_CODE);
});

test('auth, target, malformed and unknown errors stay immediate even with retryable hints or network metadata', () => {
  for (const status of [400, 401, 403, 404, 422]) {
    const error = cliError(status);
    error.code = 'ECONNRESET';
    assert.equal(imwebRequestFailure(error, { readOnly: true }).code, 'IMWEB_REQUEST_FAILED');
  }
  for (const error of [{ stdout: 'not JSON' }, { stdout: JSON.stringify({ error: { retryable: true, code: 'unknown' } }) }]) {
    assert.equal(imwebRequestFailure(error, { readOnly: true }).code, 'IMWEB_REQUEST_FAILED');
  }
  assert.equal(imwebRequestFailure(cliError(503)).code, 'IMWEB_REQUEST_FAILED');
});

test('contradictory CLI streams and direct auth status cannot be overwritten by transient metadata', () => {
  for (const error of [
    { stdout: Buffer.from(JSON.stringify(envelope(503))), stderr: Buffer.from(JSON.stringify(envelope(401))) },
    { statusCode: 401, code: 'ECONNRESET', stdout: JSON.stringify({ error: { retryable: true } }) },
    { stdout: JSON.stringify(envelope(503)), stderr: JSON.stringify(envelope(502)) },
  ]) {
    let calls = 0;
    assert.throws(() => imwebJson(['member', 'list'], {
      execute: () => { calls++; throw error; }, wait: () => assert.fail('contradictory errors cannot retry'),
    }), { code: 'IMWEB_REQUEST_FAILED' });
    assert.equal(calls, 1);
  }
});

test('member list retries just once on verified transient reads; success returns only complete response', () => {
  let calls = 0;
  const waits = [];
  const result = imwebJson(['member', 'list'], {
    execute: () => { if (++calls === 1) throw cliError(503); return JSON.stringify({ data: { list: [], hasNext: false } }); },
    wait: ms => waits.push(ms),
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [500]);
  assert.deepEqual(result.data.list, []);
  calls = 0;
  assert.throws(() => imwebJson(['member', 'list'], {
    execute: () => { calls++; throw cliError(429); }, wait: () => {},
  }), { code: TRANSIENT_READ_CODE });
  assert.equal(calls, 2);
});

test('config, point writes, write dry-run, auth and unrecognized errors never retry', () => {
  for (const [args, error] of [
    [['config', 'context'], cliError(503)],
    [['promotion', 'point', 'change', 'member', 'fixture'], cliError(503)],
    [['promotion', 'point', 'change', 'member', 'fixture', '--dry-run'], cliError(503)],
    [['member', 'list'], cliError(401)],
    [['member', 'list'], new Error('timeout secret')],
  ]) {
    let calls = 0;
    assert.throws(() => imwebJson(args, {
      execute: () => { calls++; throw error; }, wait: () => assert.fail('must not retry'),
    }), { code: 'IMWEB_REQUEST_FAILED' });
    assert.equal(calls, 1);
  }
});

test('zero-exit failure envelope is not mistaken for success and diagnostics are allowlisted', () => {
  let calls = 0;
  assert.throws(() => imwebJson(['member', 'list'], {
    execute: () => { calls++; return JSON.stringify(envelope(403)); }, wait: () => assert.fail(),
  }), { code: 'IMWEB_REQUEST_FAILED' });
  assert.equal(calls, 1);
  assert.deepEqual(sanitizeImwebFailureDetails({ operation: 'private', phase: 'member_scan', statusCode: 503,
    providerCode: 'secret@example.test', transportCode: 'ECONNRESET', token: 'private' }), {
    phase: 'member_scan', statusCode: 503, transportCode: 'ECONNRESET',
  });
});
