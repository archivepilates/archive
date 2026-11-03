import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
const sourceUrl = new URL('../reconcile-notion-cancelled-20261103.mjs', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const tree = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length, 0);
assert.deepEqual(tree.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text),
  ['node:module', 'node:child_process', 'node:path', 'node:os']);
const code = tree.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(tree)).join('\n');
const ID = 'plc_281189166';
const RECORD = `privateLessonChartRecords/${ID}`;
const REQUEST = `privateLessonChartRequests/${ID}`;
const AUDIT = 'workLanes/ops-health-errors-20261103/reports/notion-empty-cancellation';
const NOW = Date.parse('2026-11-03T00:00:00.000Z');
const HEAD = 'b'.repeat(40);
const IDENTITY_ERROR = 'Notion 회원 폴더 자동 연결 확인 필요: 회원·강사·제출 원본 신원이 일치하지 않습니다.';
const clone = value => structuredClone(value);
const stableHash = value => {
  const sort = input => Array.isArray(input) ? input.map(sort) : input && typeof input === 'object'
    ? Object.fromEntries(Object.keys(input).sort().map(key => [key, sort(input[key])])) : input;
  return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
};
const businessFields = record => { const { notionSync, ...fields } = record; return fields; };
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}

// Contract-only stub: exercise the runner without loading compiled Firebase/Notion code.
function cancelledDeferral(record, request) {
  if (!record || !request || !record.cancelledAt || request.status !== 'cancelled' || !request.cancelledAt
    || record.studioId !== '5330' || request.studioId !== '5330' || !record.recordId
    || record.recordId !== record.requestId || !['requestId', 'memberId', 'staffId', 'bookingId'].every(key =>
      Boolean(record[key]) && String(record[key]) === String(request[key]))) return null;
  const sync = record.notionSync || {};
  const submitted = record.preSubmittedAt || record.postSubmittedAt || request.preStatus === 'submitted'
    || request.postStatus === 'submitted' || ['prePlan', 'postRecord', 'preAnswers', 'postAnswers'].some(key =>
      record[key] && (typeof record[key] !== 'object' || Object.keys(record[key]).length > 0));
  if (record.gptStatus !== 'waiting_post' || submitted || record.notionProjectionControl?.aliasOfRecordId
    || record.notionProjectionControl?.memberPageId || record.notionPageId || record.notionPageUrl
    || sync.pageId || sync.pageUrl || sync.instructorPageId || sync.instructorPageUrl || sync.creationTitle
    || sync.syncedAt || sync.sourceVersion || sync.leaseToken || record.notionProjectionLease?.token
    || (sync.error && sync.error !== IDENTITY_ERROR)) return null;
  const deferredSource = doc => {
    const { notionSync, notionProjectionLease, updatedAt, ...fields } = doc;
    return fields;
  };
  return { ...sync, status: 'pending', error: '', deferredReason: 'cancelled_without_submission',
    deferredVersion: stableHash({ record: deferredSource(record), request: deferredSource(request) }),
    sourceVersion: '', leaseToken: '', leaseUntilMs: 0 };
}

function fixture() {
  const identity = { requestId: ID, memberId: '100', staffId: '500', bookingId: 'synthetic-booking', studioId: '5330' };
  return new Map([
    [RECORD, { ...identity, recordId: ID, gptStatus: 'waiting_post', cancelledAt: '2026-11-02T00:00:00.000Z',
      lessonDate: '2026-11-05', untouched: { revision: 1, synthetic: true }, updatedAt: 'synthetic-original-record-update',
      notionSync: { status: 'failed', error: IDENTITY_ERROR, sourceVersion: '',
        attemptedAt: '2026-11-02T01:00:00.000Z', failedAt: '2026-11-02T01:00:01.000Z',
        attemptedVersion: 'synthetic-previous-attempt', targetVersion: 'synthetic-target',
        retainedMetadata: { marker: 'synthetic-preserved' } } }],
    [REQUEST, { ...identity, status: 'cancelled', cancelledAt: '2026-11-02T00:00:00.000Z',
      preStatus: 'pending', postStatus: 'pending', updatedAt: 'synthetic-original-request-update' }],
  ]);
}

function harness() {
  const docs = fixture(), reads = [], commits = [], logs = [], helperCalls = [], dependencies = [], commands = [];
  const versions = new Map([[RECORD, 1], [REQUEST, 1]]), hooks = {};
  let transactions = 0, initialized = 0, closed = 0, gitState = { branch: 'main', status: '', head: HEAD, remote: HEAD };
  const snapshot = (store, ref, phase) => {
    reads.push({ path: ref.path, phase });
    return { exists: store.has(ref.path), data: () => clone(store.get(ref.path)),
      updateTime: { _seconds: Math.floor(NOW / 1000), _nanoseconds: versions.get(ref.path) || 0 } };
  };
  const db = {
    doc: key => {
      assert.ok([RECORD, REQUEST, AUDIT].includes(key), `Unscoped Firestore path: ${key}`);
      return { path: key, get: async () => snapshot(docs, { path: key }, 'direct') };
    },
    runTransaction: async callback => {
      transactions++;
      hooks.beforeTransaction?.(docs, versions);
      const current = clone(docs), writes = [];
      const result = await callback({
        get: async ref => {
          assert.equal(writes.length, 0, 'all transaction reads must precede writes');
          return snapshot(current, ref, 'transaction');
        },
        create: (ref, data) => {
          assert.equal(current.has(ref.path), false);
          writes.push({ kind: 'create', path: ref.path, data: clone(data) });
        },
        update: (ref, data) => {
          assert.equal(current.has(ref.path), true);
          writes.push({ kind: 'update', path: ref.path, data: clone(data) });
        },
      });
      if (hooks.rejectCommit) throw Error('synthetic_commit_rejected');
      for (const write of writes) current.set(write.path,
        write.kind === 'create' ? write.data : { ...current.get(write.path), ...write.data });
      docs.clear();
      for (const [key, value] of current) docs.set(key, value);
      for (const write of writes) versions.set(write.path, (versions.get(write.path) || 0) + 1);
      commits.push(writes);
      hooks.afterCommit?.(docs);
      if (hooks.unknownOutcome) throw Error('synthetic_unknown_commit_outcome');
      return result;
    },
  };
  const admin = {
    initializeApp: options => { assert.deepEqual(clone(options), { projectId: 'archive-pilates' }); initialized++; },
    firestore: () => db,
    app: () => ({ delete: async () => { closed++; } }),
  };
  const mockedRequire = key => {
    dependencies.push(key);
    if (key === 'firebase-admin') return admin;
    if (key === path.resolve('firebase/kangsain-functions/functions/lib/privateLessonChart/privateLessonNotionSync.js')) {
      return { privateNotionCancelledDeferral: (record, request) => {
        helperCalls.push({ record: clone(record), request: clone(request) });
        const before = clone({ record, request }), result = cancelledDeferral(record, request);
        assert.deepEqual(clone({ record, request }), before, 'pure helper must not mutate its input');
        return result;
      } };
    }
    if (key === path.resolve('firebase/kangsain-functions/functions/lib/utils/hash.js')) return { stableHash };
    assert.fail(`Actual or unmocked module prohibited: ${key}`);
  };
  async function run(args = []) {
    const start = logs.length;
    await runInNewContext(`(async () => { ${code}\n})()`, {
      createRequire: () => mockedRequire, path, os: { homedir: () => '/synthetic-home' },
      execFileSync: (command, args, options) => {
        commands.push([command, ...args]);
        assert.equal(command, 'git'); assert.equal(options.encoding, 'utf8');
        const key = args.join(' ');
        if (key === 'branch --show-current') return gitState.branch;
        if (key === 'status --porcelain') return gitState.status;
        if (key === 'rev-parse HEAD') return gitState.head;
        if (key === 'rev-parse origin/main') return gitState.remote;
        assert.fail(`External command prohibited: ${key}`);
      },
      process: { argv: ['synthetic-node', sourceUrl.pathname, ...args], env: {} },
      console: { log: value => logs.push(JSON.parse(value)) }, Date: Clock,
      fetch: () => assert.fail('Actual network prohibited'),
    }, { timeout: 1000 });
    return logs.slice(start);
  }
  return { docs, versions, reads, commits, logs, helperCalls, dependencies, commands, hooks, run,
    setGit: changes => { gitState = { ...gitState, ...changes }; },
    counts: () => ({ transactions, initialized, closed }),
    plan: async () => (await run())[0].fingerprint,
    apply: expected => run(['--apply', `--expected=${expected}`]),
  };
}

test('plan reads only the exact record/request, produces a deterministic fingerprint and makes no writes', async () => {
  const h = harness(), before = clone(h.docs);
  const [plan] = await h.run();
  assert.deepEqual(plan, { mode: 'plan', recordId: ID, eligible: true, fingerprint: plan.fingerprint });
  assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(await h.plan(), plan.fingerprint);
  assert.deepEqual(h.docs, before); assert.equal(h.commits.length, 0);
  assert.deepEqual(h.counts(), { transactions: 0, initialized: 2, closed: 2 });
  assert.deepEqual([...new Set(h.reads.map(read => read.path))].sort(), [RECORD, REQUEST].sort());
  assert.equal(h.reads.every(read => read.phase === 'direct'), true);
  assert.equal(h.commands.length, 0);
  assert.equal(h.docs.has(AUDIT), false);
  assert.ok(h.dependencies.every(key => key === 'firebase-admin' || key.endsWith('/privateLessonNotionSync.js') || key.endsWith('/utils/hash.js')));
});

test('exact approved fingerprint commits only notionSync plus one audit and preserves source/request', async () => {
  const h = harness(), before = clone(h.docs), expected = await h.plan();
  const [result] = await h.apply(expected);
  assert.deepEqual(result, { mode: 'apply', verified: true, recordId: ID,
    businessFieldsUnchanged: true, externalWrites: 0, state: 'cancelled_without_submission' });
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].length, 2);
  assert.deepEqual(h.commits[0].map(({ kind, path }) => ({ kind, path })),
    [{ kind: 'create', path: AUDIT }, { kind: 'update', path: RECORD }]);
  assert.deepEqual(Object.keys(h.commits[0][1].data), ['notionSync']);
  const sync = h.docs.get(RECORD).notionSync, previous = before.get(RECORD).notionSync;
  assert.equal(sync.status, 'pending'); assert.equal(sync.error, '');
  assert.equal(sync.deferredReason, 'cancelled_without_submission'); assert.equal(sync.sourceVersion, '');
  assert.match(sync.deferredVersion, /^[a-f0-9]{64}$/);
  for (const key of ['leaseToken', 'leaseUntilMs', 'syncedAt']) assert.equal(Object.hasOwn(sync, key), false);
  for (const key of ['attemptedAt', 'failedAt', 'attemptedVersion', 'targetVersion', 'retainedMetadata']) assert.deepEqual(sync[key], previous[key]);
  assert.deepEqual(businessFields(h.docs.get(RECORD)), businessFields(before.get(RECORD)));
  assert.deepEqual(h.docs.get(REQUEST), before.get(REQUEST));
  const audit = h.docs.get(AUDIT);
  assert.deepEqual(Object.keys(audit).sort(), ['operation', 'at', 'sourceCommit', 'recordId', 'fingerprint',
    'beforeSync', 'afterSyncHash', 'businessHash', 'requestHash', 'externalWrites'].sort());
  assert.equal(audit.operation, 'metadata_only_empty_cancellation'); assert.equal(audit.sourceCommit, HEAD);
  assert.equal(audit.recordId, ID); assert.equal(audit.fingerprint, expected); assert.equal(audit.externalWrites, 0);
  assert.equal(audit.at, new Date(NOW).toISOString()); assert.deepEqual(audit.beforeSync, previous);
  assert.equal(audit.afterSyncHash, stableHash(sync)); assert.equal(audit.requestHash, stableHash(before.get(REQUEST)));
  assert.equal(audit.businessHash, stableHash(businessFields(before.get(RECORD))));
  assert.deepEqual(h.reads.filter(read => read.phase === 'transaction').map(read => read.path), [AUDIT, RECORD, REQUEST]);
  assert.deepEqual(h.counts(), { transactions: 1, initialized: 2, closed: 2 });
});

test('a well-formed but nonmatching expected fingerprint aborts before transaction', async () => {
  const h = harness(), before = clone(h.docs);
  await assert.rejects(h.apply('a'.repeat(64)), /Source changed or cancellation guard failed/);
  assert.deepEqual(h.docs, before); assert.equal(h.commits.length, 0);
  assert.deepEqual(h.counts(), { transactions: 0, initialized: 1, closed: 1 });
});

for (const args of [['--apply'], ['--apply', '--expected=not-a-hash'], ['--apply', `--expected=${'A'.repeat(64)}`],
  ['--apply', '--apply', `--expected=${'a'.repeat(64)}`], ['--unknown'], ['--apply', '--expected=']]) {
  test(`invalid arguments ${JSON.stringify(args)} fail before SDK, reads or commands`, async () => {
    const h = harness();
    await assert.rejects(h.run(args), /Invalid repair arguments/);
    assert.equal(h.reads.length, 0); assert.equal(h.commits.length, 0); assert.equal(h.dependencies.length, 0);
    assert.equal(h.commands.length, 0); assert.deepEqual(h.counts(), { transactions: 0, initialized: 0, closed: 0 });
  });
}

for (const [name, git] of [
  ['feature branch', { branch: 'codex/synthetic' }], ['dirty main', { status: ' M synthetic.ts\n' }],
  ['main behind origin', { remote: 'c'.repeat(40) }], ['main ahead of origin', { head: 'c'.repeat(40) }],
]) {
  test(`${name} aborts apply before initializing any SDK`, async () => {
    const h = harness(), expected = await h.plan(), before = h.counts(), readCount = h.reads.length;
    h.setGit(git);
    await assert.rejects(h.apply(expected), /Apply requires clean main equal to origin\/main/);
    assert.deepEqual(h.counts(), before); assert.equal(h.reads.length, readCount);
    assert.equal(h.commits.length, 0); assert.equal(h.docs.has(AUDIT), false);
  });
}

for (const key of [RECORD, REQUEST]) {
  for (const timing of ['before apply', 'inside transaction']) {
    for (const change of ['document', 'update time only']) {
      test(`${key} ${change} drift ${timing} aborts without partial audit or metadata write`, async () => {
        const h = harness(), expected = await h.plan(), originalSync = clone(h.docs.get(RECORD).notionSync);
        const drift = () => {
          if (change === 'document') h.docs.get(key).concurrentRevision = 2;
          else h.versions.set(key, h.versions.get(key) + 1);
        };
        if (timing === 'before apply') drift(); else h.hooks.beforeTransaction = drift;
        await assert.rejects(h.apply(expected), timing === 'before apply'
          ? /Source changed or cancellation guard failed/ : /Concurrent source change/);
        assert.equal(h.commits.length, 0); assert.equal(h.docs.has(AUDIT), false);
        assert.deepEqual(h.docs.get(RECORD).notionSync, originalSync);
        assert.equal(h.counts().transactions, timing === 'before apply' ? 0 : 1);
        if (timing === 'inside transaction') assert.ok(h.reads.some(read => read.phase === 'transaction' && read.path === key));
        assert.equal(h.counts().closed, 2);
      });
    }
  }
  test(`missing canonical ${key} aborts even planning with cleanup`, async () => {
    const h = harness(); h.docs.delete(key);
    await assert.rejects(h.plan(), /Canonical incident source unavailable/);
    assert.equal(h.commits.length, 0); assert.equal(h.counts().closed, 1);
  });
}

for (const [name, mutate] of [
  ['record alias', record => { record.recordId = 'synthetic-other-record'; }],
  ['request alias', record => { record.requestId = 'synthetic-other-request'; }],
]) {
  test(`${name} fails canonical admission without transaction`, async () => {
    const h = harness(); mutate(h.docs.get(RECORD));
    await assert.rejects(h.plan(), /Canonical incident source unavailable/);
    assert.equal(h.counts().transactions, 0); assert.equal(h.commits.length, 0); assert.equal(h.counts().closed, 1);
  });
}

for (const [name, mutate] of [
  ['request reactivated', h => { h.docs.get(REQUEST).status = 'pending'; }],
  ['request cancellation removed', h => { delete h.docs.get(REQUEST).cancelledAt; }],
  ['submitted content', h => { h.docs.get(RECORD).postRecord = { summary: 'synthetic answer' }; }],
  ['submitted request', h => { h.docs.get(REQUEST).preStatus = 'submitted'; }],
  ['identity mismatch', h => { h.docs.get(REQUEST).memberId = 'other-member'; }],
  ['existing provider page', h => { h.docs.get(RECORD).notionSync.pageId = 'synthetic-page'; }],
  ['uncertain creation', h => { h.docs.get(RECORD).notionSync.creationTitle = 'synthetic-intent'; }],
  ['historical provider success', h => { h.docs.get(RECORD).notionSync.syncedAt = 'synthetic-success'; }],
  ['unknown provider error', h => { h.docs.get(RECORD).notionSync.error = 'synthetic timeout'; }],
  ['unresolved lease token', h => { h.docs.get(RECORD).notionSync.leaseToken = 'synthetic-owner'; }],
]) {
  test(`ineligible ${name} can be planned but cannot be applied even with its exact fingerprint`, async () => {
    const h = harness(); mutate(h);
    const before = clone(h.docs), [plan] = await h.run();
    assert.equal(plan.eligible, false); assert.deepEqual(h.docs, before);
    await assert.rejects(h.apply(plan.fingerprint), /Source changed or cancellation guard failed/);
    assert.equal(h.commits.length, 0); assert.equal(h.counts().transactions, 0); assert.equal(h.counts().closed, 2);
  });
}

for (const [name, mutate] of [
  ['future sync lease', record => { record.notionSync.leaseUntilMs = NOW + 1; }],
  ['future record lease', record => { record.notionProjectionLease = { untilMs: NOW + 1 }; }],
  ['non-finite lease', record => { record.notionSync.leaseUntilMs = 'synthetic-invalid'; }],
]) {
  test(`${name} blocks before the pure helper is called`, async () => {
    const h = harness(); mutate(h.docs.get(RECORD));
    const [plan] = await h.run();
    assert.equal(plan.eligible, false); assert.equal(h.helperCalls.length, 0);
    await assert.rejects(h.apply(plan.fingerprint), /Source changed or cancellation guard failed/);
    assert.equal(h.helperCalls.length, 0); assert.equal(h.commits.length, 0); assert.equal(h.counts().closed, 2);
  });
}

test('expired empty-token lease metadata is removed only from notionSync, never business fields', async () => {
  const h = harness();
  Object.assign(h.docs.get(RECORD).notionSync, { leaseToken: '', leaseUntilMs: NOW - 1 });
  h.docs.get(RECORD).notionProjectionLease = { untilMs: NOW - 1, token: '' };
  const before = clone(h.docs), expected = await h.plan();
  await h.apply(expected);
  assert.equal(Object.hasOwn(h.docs.get(RECORD).notionSync, 'leaseToken'), false);
  assert.equal(Object.hasOwn(h.docs.get(RECORD).notionSync, 'leaseUntilMs'), false);
  assert.deepEqual(businessFields(h.docs.get(RECORD)), businessFields(before.get(RECORD)));
  assert.deepEqual(h.docs.get(REQUEST), before.get(REQUEST));
});

for (const timing of ['before apply', 'inside transaction']) {
  test(`existing audit ${timing} blocks replay without replacing the original intent`, async () => {
    const h = harness(), expected = await h.plan(), prior = { marker: 'synthetic-accepted-or-unknown', fingerprint: expected };
    if (timing === 'before apply') h.docs.set(AUDIT, clone(prior));
    else h.hooks.beforeTransaction = docs => docs.set(AUDIT, clone(prior));
    await assert.rejects(h.apply(expected), /Prior recovery exists; read back instead of replay/);
    assert.equal(h.commits.length, 0); assert.deepEqual(h.docs.get(AUDIT), prior);
    assert.equal(h.docs.get(RECORD).notionSync.status, 'failed'); assert.equal(h.counts().closed, 2);
  });
}

test('rejected atomic commit leaves neither audit nor notionSync update', async () => {
  const h = harness(), expected = await h.plan(), before = clone(h.docs);
  h.hooks.rejectCommit = true;
  await assert.rejects(h.apply(expected), /synthetic_commit_rejected/);
  assert.deepEqual(h.docs, before); assert.equal(h.commits.length, 0);
  assert.equal(h.logs.some(log => log.verified), false); assert.equal(h.counts().closed, 2);
});

test('unknown commit outcome retains audit and blocks both stale and freshly replanned replay', async () => {
  const h = harness(), expected = await h.plan(); h.hooks.unknownOutcome = true;
  await assert.rejects(h.apply(expected), /synthetic_unknown_commit_outcome/);
  assert.equal(h.commits.length, 1); assert.equal(h.docs.has(AUDIT), true);
  assert.equal(h.logs.some(log => log.verified), false);
  h.hooks.unknownOutcome = false;
  await assert.rejects(h.apply(expected), /Source changed or cancellation guard failed/);
  const current = await h.plan();
  await assert.rejects(h.apply(current), /Prior recovery exists; read back instead of replay/);
  assert.equal(h.commits.length, 1);
});

for (const [name, mutate] of [
  ['sync error', docs => { docs.get(RECORD).notionSync.error = 'synthetic-conflict'; }],
  ['sync version', docs => { docs.get(RECORD).notionSync.deferredVersion = 'synthetic-conflict'; }],
  ['retained sync metadata', docs => { docs.get(RECORD).notionSync.retainedMetadata.marker = 'synthetic-conflict'; }],
  ['record business fields', docs => { docs.get(RECORD).untouched.revision = 2; }],
  ['request business fields', docs => { docs.get(REQUEST).concurrentRevision = 2; }],
]) {
  test(`post-commit ${name} mismatch is surfaced without claiming verification or replaying writes`, async () => {
    const h = harness(), expected = await h.plan(); h.hooks.afterCommit = mutate;
    await assert.rejects(h.apply(expected), /Recovery readback mismatch; do not replay/);
    assert.equal(h.commits.length, 1); assert.equal(h.docs.has(AUDIT), true);
    assert.equal(h.logs.some(log => log.verified), false); assert.equal(h.counts().closed, 2);
    h.hooks.afterCommit = undefined;
    await assert.rejects(h.apply(expected), /Source changed or cancellation guard failed/);
    const [current] = await h.run();
    assert.equal(current.eligible, name !== 'sync error');
    await assert.rejects(h.apply(current.fingerprint), current.eligible
      ? /Prior recovery exists; read back instead of replay/ : /Source changed or cancellation guard failed/);
    assert.equal(h.commits.length, 1);
  });
}

test('a successful repair cannot be replayed with either old approval or a fresh plan', async () => {
  const h = harness(), expected = await h.plan(); await h.apply(expected);
  const committed = clone(h.docs);
  await assert.rejects(h.apply(expected), /Source changed or cancellation guard failed/);
  const current = await h.plan();
  await assert.rejects(h.apply(current), /Prior recovery exists; read back instead of replay/);
  assert.equal(h.commits.length, 1); assert.deepEqual(h.docs, committed);
});
