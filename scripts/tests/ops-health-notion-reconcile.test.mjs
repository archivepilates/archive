import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { INCIDENT_CHART_IDS, notionIncidentDeferral } from '../lib/ops-health-notion-deferral.mjs';

const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
const sourceUrl = new URL('../reconcile-notion-waiting-20261102.mjs', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const tree = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length, 0);
const code = tree.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(tree)).join('\n');
const IDS = ['plc_280084398', 'plc_281189166', 'plc_281189167'];
const AUDIT = 'workLanes/ops-health-errors-20261102/reports/notion-awaiting-submission';
const NOW = Date.parse('2026-11-02T00:00:00Z');
const ROOT = 'a'.repeat(32);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableHash = value => {
  const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return hash(sort(value));
};
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}

function fixture() {
  const docs = new Map();
  IDS.forEach((id, index) => {
    const identity = { requestId: id, memberId: `${100 + index}`, staffId: '500', bookingId: `synthetic-${index}`,
      studioId: '5330', memberPhone: `0100000000${index}` };
    docs.set(`privateLessonChartRecords/${id}`, {
      ...identity, recordId: id, staffName: 'Synthetic Instructor', lessonDate: '2026-11-05',
      gptStatus: 'waiting_post', untouched: { source: 'synthetic', revision: 1 },
      notionSync: { status: 'failed', sourceVersion: '', targetVersion: 'synthetic-version',
        attemptedAt: '2026-11-01T14:30:00Z', syncedAt: '2026-11-01T14:30:01Z', failedAt: 'old',
        retainedMetadata: { synthetic: true },
        error: 'Notion 회원 폴더 자동 연결 확인 필요: 회원·강사·제출 원본 신원이 일치하지 않습니다.' },
    });
    docs.set(`privateLessonChartRequests/${id}`, { ...identity, status: 'pending', preStatus: 'pending', postStatus: 'pending' });
    docs.set(`memberProfiles/${identity.memberId}`, { memberId: identity.memberId, studioId: '5330',
      name: `Synthetic ${index}`, phone: identity.memberPhone });
  });
  docs.set('staffs/500', { staffId: '500', studioId: '5330', active: true, role: 'instructor', name: 'Synthetic Instructor' });
  return docs;
}

function harness() {
  const docs = fixture(), reads = [], commits = [], logs = [], identityCalls = [];
  let transactions = 0, closed = 0;
  const hooks = {};
  const snapshot = (store, key) => ({ exists: store.has(key), data: () => structuredClone(store.get(key)),
    updateTime: { toDate: () => new Date(NOW) } });
  const read = (store, ref, phase) => {
    reads.push({ path: ref.path, phase });
    return snapshot(store, ref.path);
  };
  const db = {
    doc: key => ({ path: key, get: async () => read(docs, { path: key }, 'direct') }),
    runTransaction: async callback => {
      transactions++;
      hooks.beforeTransaction?.(docs);
      const current = structuredClone(docs), writes = [];
      const result = await callback({
        get: async ref => {
          assert.equal(writes.length, 0, 'transaction must finish reading before any write');
          return read(current, ref, 'transaction');
        },
        create: (ref, data) => {
          assert.equal(current.has(ref.path), false);
          writes.push({ kind: 'create', path: ref.path, data: structuredClone(data) });
        },
        update: (ref, data) => {
          assert.equal(current.has(ref.path), true);
          writes.push({ kind: 'update', path: ref.path, data: structuredClone(data) });
        },
      });
      for (const write of writes) current.set(write.path,
        write.kind === 'create' ? write.data : { ...current.get(write.path), ...write.data });
      docs.clear();
      for (const [key, value] of current) docs.set(key, value);
      commits.push(writes);
      hooks.afterCommit?.(docs);
      if (hooks.unknownOutcome) throw Error('synthetic_unknown_commit_outcome');
      return result;
    },
  };
  const admin = {
    initializeApp: options => assert.equal(options.projectId, 'archive-pilates'),
    firestore: () => db,
    app: () => ({ delete: async () => { closed++; } }),
  };
  const identityHelper = (record, request, profile, staff, root, staffRoot, options) => {
    identityCalls.push({ record: structuredClone(record), profile, staff });
    assert.equal(options.deferUnsubmitted, true);
    if (!profile || !staff || !staff.active || profile.memberId !== record.memberId ||
      profile.phone !== record.memberPhone || profile.phone !== request.memberPhone ||
      staff.staffId !== record.staffId || root !== ROOT || staffRoot !== ROOT) throw Error('synthetic_identity_rejected');
    return { rootPageId: root, memberId: profile.memberId, title: `${profile.name}님`, awaitingSubmission: true };
  };
  const mockedRequire = id => {
    if (id === 'firebase-admin') return admin;
    if (id === 'typescript') return ts;
    if (id.endsWith('/lib/privateLessonChart/privateLessonNotionSync.js'))
      return { privateNotionDeferredVersion: (record, request) => stableHash({ record: record.recordId, request }) };
    if (id.endsWith('/lib/privateLessonChart/privateLessonNotionMemberPage.js'))
      return { privateNotionMemberIdentity: identityHelper };
    if (id.endsWith('/lib/utils/hash.js')) return { stableHash };
    assert.fail(`Unmocked dependency prohibited: ${id}`);
  };
  async function run(args = []) {
    const start = logs.length;
    await runInNewContext(`(async () => { ${code}\n})()`, {
      createRequire: () => mockedRequire, createHash, path, os: { homedir: () => '/synthetic-home' },
      readFileSync: file => {
        assert.equal(file, 'firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts');
        return `const NOTION_INSTRUCTOR_CHART_PAGE_IDS = { 'Synthetic Instructor': '${ROOT}' };`;
      },
      execFileSync: (command, args) => {
        assert.equal(command, 'git');
        const key = args.join(' ');
        if (key === 'branch --show-current') return 'main';
        if (key === 'status --porcelain') return '';
        if (key === 'rev-parse HEAD' || key === 'rev-parse origin/main') return 'b'.repeat(40);
        assert.fail(`Unexpected command: ${key}`);
      },
      process: { argv: ['synthetic-node', sourceUrl.pathname, ...args], env: {} },
      console: { log: value => logs.push(JSON.parse(value)) }, Date: Clock,
      INCIDENT_CHART_IDS, notionIncidentDeferral: (record, request) => notionIncidentDeferral(record, request, NOW),
      fetch: () => assert.fail('External transport prohibited'),
    }, { timeout: 1000 });
    return logs.slice(start);
  }
  return { docs, reads, commits, logs, hooks, identityCalls, run,
    counts: () => ({ transactions, closed }),
    plan: async () => (await run())[0].fingerprint,
    apply: expected => run(['--apply', `--expected=${expected}`]),
  };
}

const sourcePaths = [`privateLessonChartRecords/${IDS[0]}`, `privateLessonChartRequests/${IDS[0]}`,
  'memberProfiles/100', 'staffs/500'];

test('approved fingerprint rejects record, request, profile and staff drift before apply', async t => {
  for (const key of sourcePaths) await t.test(key, async () => {
    const h = harness(), fingerprint = await h.plan();
    h.docs.get(key).revision = 2;
    await assert.rejects(h.apply(fingerprint), /Source changed/);
    assert.equal(h.commits.length, 0);
    assert.equal(h.counts().transactions, 0);
    assert.equal(h.docs.has(AUDIT), false);
  });
});

test('transaction rereads every identity source and rejects late drift atomically', async t => {
  for (const key of sourcePaths) await t.test(key, async () => {
    const h = harness(), fingerprint = await h.plan();
    h.hooks.beforeTransaction = docs => { docs.get(key).revision = 2; };
    await assert.rejects(h.apply(fingerprint), /Concurrent source change/);
    assert.ok(h.reads.some(r => r.phase === 'transaction' && r.path === key));
    assert.equal(h.commits.length, 0);
    assert.equal(h.docs.has(AUDIT), false);
  });
});

test('both canonical syncStates binding guards block late claims without writes', async t => {
  const keys = [
    `privateNotionMember_${stableHash({ root: ROOT, memberId: '100' })}`,
    `privateNotionMemberTitle_${stableHash({ root: ROOT, title: 'Synthetic0님' })}`,
  ];
  for (const key of keys) await t.test(key.split('_')[0], async () => {
    const h = harness(), fingerprint = await h.plan(), binding = `syncStates/${key}`;
    h.hooks.beforeTransaction = docs => docs.set(binding, { status: 'review', attemptId: 'synthetic-unknown' });
    await assert.rejects(h.apply(fingerprint), /Existing member-folder binding/);
    assert.ok(h.reads.some(r => r.phase === 'transaction' && r.path === binding));
    assert.equal(h.reads.some(r => r.path.startsWith('syncState/')), false);
    assert.equal(h.commits.length, 0);
    assert.equal(h.docs.has(AUDIT), false);
  });
});

test('accepted repair commits exactly three metadata-only updates and one audit atomically', async () => {
  assert.deepEqual(INCIDENT_CHART_IDS, IDS);
  const h = harness(), before = structuredClone(h.docs), fingerprint = await h.plan();
  assert.equal(h.commits.length, 0, 'planning is read-only');
  const [result] = await h.apply(fingerprint);
  assert.deepEqual(result, { mode: 'apply', count: 3, verified: true, businessFieldsUnchanged: true,
    externalWrites: 0, state: 'awaiting_submission' });
  assert.equal(h.commits.length, 1);
  assert.equal(h.commits[0].length, 4);
  assert.equal(h.commits[0][0].kind, 'create');
  assert.equal(h.commits[0][0].path, AUDIT);
  const updates = h.commits[0].slice(1);
  assert.deepEqual(updates.map(w => w.path), IDS.map(id => `privateLessonChartRecords/${id}`));
  for (const write of updates) {
    assert.equal(write.kind, 'update');
    assert.deepEqual(Object.keys(write.data), ['notionSync']);
    const { notionSync: priorSync, ...prior } = before.get(write.path);
    const { notionSync: next, ...after } = h.docs.get(write.path);
    assert.deepEqual(after, prior);
    assert.equal(next.status, 'pending');
    assert.equal(next.error, '');
    assert.equal(next.deferredReason, 'awaiting_submission');
    assert.match(next.deferredVersion, /^[a-f0-9]{64}$/);
    for (const key of ['targetVersion', 'attemptedAt', 'failedAt', 'retainedMetadata']) assert.deepEqual(next[key], priorSync[key]);
    assert.equal(Object.hasOwn(next, 'syncedAt'), false);
    const audit = h.docs.get(AUDIT).records.find(r => r.id === after.recordId);
    assert.equal(audit.beforeSyncHash, hash(priorSync));
    assert.equal(audit.afterSyncHash, hash(next));
  }
  for (const [key, value] of before) if (!key.startsWith('privateLessonChartRecords/')) assert.deepEqual(h.docs.get(key), value);
  assert.ok(h.reads.some(r => r.phase === 'transaction' && r.path === 'staffs/500'));
  assert.equal(h.reads.some(r => r.path.startsWith('staff/')), false);
  assert.equal(h.counts().closed, 2);
});

test('full metadata readback rejects conflicts without replaying the committed repair', async t => {
  for (const key of ['error', 'deferredVersion', 'creationTitle']) await t.test(key, async () => {
    const h = harness(), fingerprint = await h.plan();
    h.hooks.afterCommit = docs => { docs.get(`privateLessonChartRecords/${IDS[0]}`).notionSync[key] = 'synthetic-conflict'; };
    await assert.rejects(h.apply(fingerprint), /Repair readback mismatch; do not replay/);
    assert.equal(h.commits.length, 1);
    assert.equal(h.docs.has(AUDIT), true);
    assert.equal(h.logs.some(log => log.verified), false);
    await assert.rejects(h.apply(fingerprint), /Source changed/);
    assert.equal(h.commits.length, 1);
  });
});

test('existing audit intent and unknown commit outcome cannot be replayed', async () => {
  const blocked = harness(), expected = await blocked.plan();
  blocked.docs.set(AUDIT, { expected, operation: 'synthetic-prior-intent' });
  await assert.rejects(blocked.apply(expected), /Prior repair intent exists/);
  assert.equal(blocked.commits.length, 0);
  const unknown = harness(), fingerprint = await unknown.plan();
  unknown.hooks.unknownOutcome = true;
  await assert.rejects(unknown.apply(fingerprint), /synthetic_unknown_commit_outcome/);
  assert.equal(unknown.docs.has(AUDIT), true);
  assert.equal(unknown.commits.length, 1);
  assert.equal(unknown.logs.some(log => log.verified), false);
  await assert.rejects(unknown.apply(fingerprint), /Source changed/);
  assert.equal(unknown.commits.length, 1);
});
