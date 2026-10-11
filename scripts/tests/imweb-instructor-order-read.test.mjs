import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { imwebOrderRead, readRecentImwebOrders, readImwebOrder, syncImwebInstructorOrders } from '../lib/imweb-instructor-orders.mjs';
import { IMWEB_LESSON_POLICY as policy } from '../lib/imweb-instructor-order-policy.mjs';
import { TRANSIENT_READ_CODE, sanitizeImwebFailureDetails } from '../lib/imweb-read-failure.mjs';

const envelope = status => ({ ok: false, error: { status_code: status, error_code: '30001',
  message: 'private member@example.test token=secret', context: { credential: 'secret' } } });
const cliError = status => Object.assign(new Error('private command output'), { stdout: JSON.stringify(envelope(status)) });
const context = { resolved_profile: { site_code: policy.siteCode, unit_code: policy.unitCode } };
const NOW = new Date('2026-10-11T08:00:00Z');
const order = { orderNo: '209901010000001', wtime: NOW.toISOString(), sections: [] };
const page = (currentPage = 1, totalPage = 1, list = []) => ({ data: { currentPage, totalPage, list } });

test('only order list/get retry once after 500ms for verified transient failures', () => {
  for (const operation of ['list', 'get']) for (const status of [429, 500, 502, 503, 504]) {
    let calls = 0;
    const waits = [];
    const output = imwebOrderRead(['order', operation], {
      execute: (binary, args, options) => {
        assert.deepEqual(args.slice(0, 4), ['--profile', 'default', '--output', 'json']);
        assert.equal(options.timeout, 45000);
        if (++calls === 1) throw cliError(status);
        return JSON.stringify(page());
      }, wait: ms => waits.push(ms),
    });
    assert.equal(calls, 2);
    assert.deepEqual(waits, [500]);
    assert.deepEqual(output, page());
  }
});

test('network errors retry once, and exhausted reads keep sanitized diagnostics', () => {
  for (const error of [cliError(503), Object.assign(new Error('secret'), { code: 'ETIMEDOUT' })]) {
    let calls = 0;
    assert.throws(() => imwebOrderRead(['order', 'get'], {
      execute: () => { calls++; throw error; }, wait: () => {},
    }), failure => {
      assert.equal(failure.code, TRANSIENT_READ_CODE);
      assert.equal(failure.failureDetails.operation, 'order_get');
      assert.equal(failure.failureDetails.readAttempts, 2);
      assert.doesNotMatch(JSON.stringify(failure), /private|secret|credential|@/);
      return true;
    });
    assert.equal(calls, 2);
  }
});

test('auth, conflicting metadata, config and all writes are never retried', () => {
  for (const [args, error] of [
    [['order', 'get'], cliError(401)], [['order', 'list'], cliError(403)],
    [['order', 'get'], { stdout: JSON.stringify(envelope(503)), stderr: JSON.stringify(envelope(401)) }],
    [['config', 'context'], cliError(503)], [['order', 'update'], cliError(503)],
    [['member', 'create'], cliError(503)], [['order', 'list'], new Error('unknown timeout')],
  ]) {
    let calls = 0;
    assert.throws(() => imwebOrderRead(args, {
      execute: () => { calls++; throw error; }, wait: () => assert.fail('unsafe retry'),
    }), { code: 'IMWEB_REQUEST_FAILED' });
    assert.equal(calls, 1);
  }
});

test('an auth failure after a transient read stops immediately with the final cause', () => {
  let calls = 0;
  assert.throws(() => imwebOrderRead(['order', 'list'], {
    execute: () => { throw cliError(++calls === 1 ? 503 : 401); }, wait: () => {},
  }), error => {
    assert.equal(error.code, 'IMWEB_REQUEST_FAILED');
    assert.equal(error.failureDetails.statusCode, 401);
    assert.equal(error.failureDetails.readAttempts, 2);
    return true;
  });
  assert.equal(calls, 2);
});

test('zero-exit failures retain provider metadata; invalid responses cannot pass as success', () => {
  for (const payload of [envelope(403), { statusCode: 403, error: { error_code: '30001' } }]) {
    assert.throws(() => imwebOrderRead(['order', 'list'], {
      execute: () => JSON.stringify(payload), wait: () => assert.fail(),
    }), error => {
      assert.deepEqual(error.failureDetails, { operation: 'order_list', readAttempts: 1, statusCode: 403, providerCode: '30001' });
      return true;
    });
  }
  let calls = 0;
  assert.deepEqual(imwebOrderRead(['order', 'list'], {
    execute: () => JSON.stringify(++calls === 1 ? envelope(503) : page()), wait: () => {},
  }), page());
  assert.equal(calls, 2);
  for (const [output, kind] of [['not JSON private', 'invalid_json'], ['null', 'invalid_envelope'], ['[]', 'invalid_envelope'], ['true', 'invalid_envelope']]) {
    assert.throws(() => imwebOrderRead(['order', 'list'], {
      execute: () => output, wait: () => assert.fail(),
    }), error => {
      assert.equal(error.code, 'IMWEB_REQUEST_FAILED');
      assert.equal(error.failureDetails.failureKind, kind);
      assert.doesNotMatch(JSON.stringify(error), /private/);
      return true;
    });
  }
});

test('source mismatch and incomplete pagination fail closed with the source phase', () => {
  assert.throws(() => readImwebOrder(order.orderNo, args => args[0] === 'config' ? context : { data: { orderNo: 'wrong' } }), {
    code: 'IMWEB_ORDER_SOURCE_INVALID', failureDetails: { phase: 'order_readback', operation: 'order_get', failureKind: 'source_validation' },
  });
  for (const data of [page(2), page(1, -1), page(1, 0, [order]), page(1, 11, [order])]) {
    assert.throws(() => readRecentImwebOrders(args => {
      if (args[0] === 'config') return context;
      if (data.data.totalPage === 11) return page(Number(args[args.indexOf('--page') + 1]), 11, [order]);
      return data;
    }, NOW), { code: 'IMWEB_ORDER_SOURCE_INVALID' });
  }
  assert.deepEqual(readRecentImwebOrders(args => args[0] === 'config' ? context : page(1, 0), NOW), []);
});

test('single-order source recheck preserves sanitized provider failure and readback stage', () => {
  assert.throws(() => readImwebOrder(order.orderNo, args => {
    if (args[0] === 'config') return context;
    return imwebOrderRead(args, { execute: () => { throw cliError(401); }, wait: () => assert.fail() });
  }), error => {
    assert.deepEqual(error.failureDetails, { operation: 'order_get', phase: 'order_readback',
      readAttempts: 1, statusCode: 401, providerCode: '30001' });
    return true;
  });
});

test('partial scan makes no registration writes and preserves failure details in alert and status', async t => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'imweb-order-read-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const baseline = { fingerprints: { retained: 'fingerprint' }, watch: {}, issues: {} };
  await writeFile(path.join(stateDir, 'state.json'), JSON.stringify(baseline), { mode: 0o600 });
  const notifications = [];
  const statuses = [];
  const db = { collection: () => assert.fail('partial scan cannot create member-facing jobs'),
    runTransaction: () => assert.fail('partial scan cannot write registrations') };
  const notify = async event => { notifications.push(event); return { messageId: 'fixture' }; };
  const read = args => {
    if (args[0] === 'config') return context;
    if (args.includes('1')) return page(1, 2, [order]);
    return imwebOrderRead(args, { execute: () => { throw cliError(503); }, wait: () => {} });
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    await assert.rejects(syncImwebInstructorOrders(db, { apply: true, force: true, stateDir, read, notify,
      recordStatus: async (_db, status) => statuses.push(status), attention: () => assert.fail() }), { code: TRANSIENT_READ_CODE });
    const state = JSON.parse(await readFile(path.join(stateDir, 'state.json'), 'utf8'));
    assert.deepEqual(state.fingerprints, baseline.fingerprints);
    const alert = JSON.parse(await readFile(path.join(stateDir, 'query-alert-state.json'), 'utf8'));
    assert.equal(alert.consecutiveFailures, attempt);
    assert.deepEqual(alert.failureDetails, { operation: 'order_list', phase: 'order_scan', readAttempts: 2, statusCode: 503, providerCode: '30001' });
    assert.equal(notifications.length, attempt < 3 ? 0 : 1);
    await assert.rejects(access(path.join(stateDir, 'scan.lock')), { code: 'ENOENT' });
  }
  assert.match(statuses.at(-1).warnings.join(' '), /order_scan.*readAttempts: 2.*503/);
  const skipped = await syncImwebInstructorOrders(db, { apply: true, stateDir, read: () => assert.fail('throttle must not scan'), notify });
  assert.equal(skipped.skipped, 'throttled');
  assert.equal(notifications.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(stateDir, 'query-alert-state.json'), 'utf8')).consecutiveFailures, 3);
  const completeRead = args => args[0] === 'config' ? context : page();
  await syncImwebInstructorOrders(db, { apply: true, force: true, stateDir, read: completeRead, notify, recordStatus: async () => {} });
  await syncImwebInstructorOrders(db, { apply: true, force: true, stateDir, read: completeRead, notify, recordStatus: async () => {} });
  assert.deepEqual(notifications.map(event => event.type), ['failure', 'recovery']);
});

test('order failure diagnostics discard arbitrary values and secrets', () => {
  assert.deepEqual(sanitizeImwebFailureDetails({ operation: 'order_get', phase: 'order_readback', readAttempts: 2,
    failureKind: 'invalid_json', token: 'secret', providerCode: 'private@email.test', raw: 'member private' }), {
    operation: 'order_get', phase: 'order_readback', failureKind: 'invalid_json', readAttempts: 2,
  });
  assert.deepEqual(sanitizeImwebFailureDetails({ readAttempts: 999, failureKind: 'private', phase: 'private' }), {});
});
