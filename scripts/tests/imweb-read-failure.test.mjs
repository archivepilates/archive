import test from 'node:test';
import assert from 'node:assert/strict';
import { imwebRequestFailure, sanitizeImwebFailureDetails, TRANSIENT_READ_CODE,
  LOCAL_WRITE_QUOTA_CODE, isLocalImwebWriteQuotaFailure } from '../lib/imweb-read-failure.mjs';
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

test('referral adapter rejects malformed and snake-case zero-exit envelopes without retaining payloads', () => {
  for (const [payload, failureKind, statusCode] of [
    ['null', 'invalid_envelope'], ['[]', 'invalid_envelope'], ['"private"', 'invalid_envelope'],
    ['not JSON token=secret', 'invalid_json'],
    [JSON.stringify({ status_code: 403, secret: 'private' }), undefined, 403],
    [JSON.stringify({ error: { status_code: 401, message: 'private' } }), undefined, 401],
  ]) {
    let calls = 0;
    assert.throws(() => imwebJson(['member', 'list'], {
      execute: () => { calls++; return payload; }, wait: () => assert.fail('must not retry'),
    }), error => {
      assert.equal(error.code, 'IMWEB_REQUEST_FAILED');
      assert.equal(error.failureDetails.readAttempts, 1);
      assert.equal(error.failureDetails.failureKind, failureKind);
      assert.equal(error.failureDetails.statusCode, statusCode);
      assert.doesNotMatch(JSON.stringify(error), /private|secret|@/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

const quotaEnvelope = () => ({ ok: false, error: { classification: 'write_quota_exceeded',
  message: 'private person@example.test token=secret', context: { credential: 'secret' } } });

test('actual classification envelope and legacy structured code prove local quota on either CLI stream', () => {
  for (const body of [quotaEnvelope(), { error: { code: 'write_quota_exceeded' } }]) {
    for (const stream of ['stdout', 'stderr']) {
      const raw = { [stream]: Buffer.from(JSON.stringify(body)), status: 1, signal: null };
      assert.equal(isLocalImwebWriteQuotaFailure(raw), true);
      const failure = imwebRequestFailure(raw, { operation: 'other_request' });
      assert.equal(failure.code, LOCAL_WRITE_QUOTA_CODE);
      assert.deepEqual(failure.failureDetails, { operation: 'other_request', classification: 'write_quota_exceeded',
        quotaScope: 'local_cli', dispatchState: 'blocked_before_dispatch' });
      assert.equal(isLocalImwebWriteQuotaFailure(failure), true);
      assert.doesNotMatch(JSON.stringify(failure), /private|secret|credential|@/);
    }
    assert.equal(isLocalImwebWriteQuotaFailure(body), true);
  }
});

test('local quota never becomes transient or retried through the shared CLI wrapper', () => {
  let calls = 0;
  assert.throws(() => imwebJson(['member', 'update', 'groups', 'synthetic', '--yes'], {
    execute() { calls++; throw { stdout: JSON.stringify(quotaEnvelope()) }; },
    wait() { assert.fail('No automatic write retry'); },
  }), { code: LOCAL_WRITE_QUOTA_CODE });
  assert.equal(calls, 1);
  assert.equal(imwebRequestFailure(quotaEnvelope(), { readOnly: true }).code, 'IMWEB_REQUEST_FAILED');
});

test('text, malformed JSON, bare codes and untrusted normalized flags do not prove non-dispatch', () => {
  for (const error of [
    Error('write_quota_exceeded'), { stderr: 'write_quota_exceeded' }, { stdout: '{broken' },
    { classification: 'write_quota_exceeded' }, { code: 'write_quota_exceeded' },
    { code: LOCAL_WRITE_QUOTA_CODE }, { error: { message: 'write_quota_exceeded' } },
    { stdout: JSON.stringify(quotaEnvelope()), stderr: 'unstructured diagnostic' },
  ]) assert.equal(isLocalImwebWriteQuotaFailure(error), false);
});

test('auth, API quota, transport, dispatch and conflicting structured metadata override quota hints', () => {
  const cases = [];
  for (const status of [200, 400, 401, 403, 429, 500, 'unknown']) {
    for (const field of ['statusCode', 'status_code', 'httpStatus', 'http_status']) {
      cases.push({ ...quotaEnvelope(), [field]: status });
      const nested = quotaEnvelope(); nested.error[field] = status; cases.push(nested);
    }
  }
  for (const field of ['dispatched', 'requestDispatched', 'request_dispatched', 'providerAttempted',
    'provider_attempted', 'accepted', 'applied', 'requestSent', 'request_sent', 'sent', 'externalEffectStarted',
    'attempted', 'killed', 'timedOut', 'captchaRequired', 'securityWarning', 'authRequired', 'permissionDenied']) {
    const raw = quotaEnvelope(); raw.error.context[field] = true; cases.push(raw);
  }
  for (const patch of [
    { code: 'ECONNRESET' }, { transportCode: 'ETIMEDOUT' }, { signal: 'SIGTERM' },
    { code: 429 }, { name: 'AbortError' },
    { status: 429 }, { success: true }, { ok: true },
    { errno: -110 }, { dispatchStatus: 'accepted' }, { requestId: 'synthetic-provider-receipt' },
    { attemptCount: 1 },
    { error: { classification: 'auth_required', code: 'write_quota_exceeded' } },
    { error: { classification: 'write_quota_exceeded', code: 'provider_timeout' } },
    { error: { classification: 'write_quota_exceeded', error_code: '30001' } },
    { error: { classification: 'write_quota_exceeded', kind: 'imweb_api' } },
    { error: { classification: 'write_quota_exceeded', kind: 'security' } },
    { error: { classification: 'write_quota_exceeded', type: 'captcha' } },
  ]) cases.push({ ...quotaEnvelope(), ...patch });
  cases.push({ stdout: JSON.stringify(quotaEnvelope()), stderr: JSON.stringify(envelope(401)) });
  cases.push({ stdout: JSON.stringify(quotaEnvelope()), stderr: JSON.stringify({ error: { code: 'unknown' } }) });
  cases.push(Object.defineProperty(quotaEnvelope(), 'statusCode', { value: 429 }));
  cases.push(Object.assign(new DOMException('synthetic abort', 'AbortError'), { error: quotaEnvelope().error }));
  for (const raw of cases) {
    assert.equal(isLocalImwebWriteQuotaFailure(raw), false);
    assert.equal(imwebRequestFailure(raw).code, 'IMWEB_REQUEST_FAILED');
  }
});

test('explicit false dispatch evidence is compatible; circular structured evidence fails closed', () => {
  const raw = quotaEnvelope(); raw.error.dispatched = false;
  assert.equal(isLocalImwebWriteQuotaFailure(raw), true);
  raw.error.context.loop = raw;
  assert.equal(isLocalImwebWriteQuotaFailure(raw), false);
});
