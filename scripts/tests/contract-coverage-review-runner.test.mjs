import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildContractCoverageReview } from '../lib/contract-coverage-review-apply.mjs';
import { validateCoverageReconciliations } from '../lib/studiomate-contract-coverage-reconciliation.mjs';

const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
const sourceUrl = new URL('../apply-contract-coverage-review-20261102.mjs', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const tree = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length, 0);
const code = tree.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(tree)).join('\n');
const LANE = 'workLanes/studiomate-membership-contract-automation';
const BASELINE = `${LANE}/state/excelBaseline`;
const AUDIT = `${LANE}/reports/coverage-reconciliation-20261102-v1`;
const CONFIG = 'systemSettings/membershipContractAutomation';
const IDS = ['3045390', '3513809', '5012352'];
const NOW = '2026-11-02T00:50:00.000Z';
const OLD = '2026-10-29T00:00:00.000Z';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableHash = value => {
  const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return hash(sort(value));
};
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return Date.parse(NOW); }
}
const hintPath = id => `${LANE}/purchaseHints/${id}`;
const contractObservationGroups = rows => rows.map(row => ({ id: hash(row['전화번호']) }));

function fixture() {
  const baseline = { schemaVersion: 1, initializedAt: OLD, updatedAt: OLD,
    downloadedAt: '2026-11-02T00:26:00.000Z', sourceImportId: 'synthetic-import',
    fingerprints: {}, rowCounts: {}, observedAtByMember: {}, coverageLossIds: [] };
  const config = { enabled: false, policy: 'synthetic-read-only-policy' };
  const evidence = { sourceFileHash: hash('synthetic-export'), configHash: hash(config),
    exportStartedAt: '2026-11-02T00:42:00.000Z', exportFinishedAt: '2026-11-02T00:43:00.000Z', records: [] };
  const docs = new Map([[BASELINE, baseline], [CONFIG, config]]);
  for (const [i, memberId] of IDS.entries()) {
    const profile = { memberId, studiomateMemberId: memberId, phone: `0100000000${i}`, memberGrade: '' };
    const fingerprint = hash(profile.phone), priorHints = [{ productName: `old-${i}` }, { productName: `kept-${i}` }];
    const currentHints = i === 2 ? [] : priorHints.slice(1);
    baseline.fingerprints[fingerprint] = hash(priorHints);
    baseline.rowCounts[fingerprint] = priorHints.length;
    baseline.observedAtByMember[fingerprint] = OLD;
    baseline.coverageLossIds.push(fingerprint);
    const record = { profileId: memberId, memberId, name: `Synthetic ${i}`, phoneFingerprint: fingerprint,
      grade: i === 2 ? '강사회원' : '', nativeMemberVerified: true,
      ticketReadStatus: 'verified', contractReadStatus: 'verified', nativeObservedAt: '2026-11-02T00:45:00.000Z',
      profileIdentityHash: hash({ memberId, nativeMemberId: memberId, phoneFingerprint: fingerprint, grade: '' }),
      priorFingerprint: hash(priorHints), priorRows: priorHints.length, priorObservedAt: OLD,
      priorHints, currentHints, currentRows: currentHints.length,
      currentFingerprint: currentHints.length ? hash(currentHints) : null,
      selection: i === 2 ? { status: 'excluded', reason: 'instructor_member_grade_excluded' }
        : { status: 'ignored', reason: 'no_fresh_native_issuance' }, hintDecisions: [] };
    const decisions = i === 0
      ? [['stale-a', 'review', 'stale_issuance'], ['stale-b', 'review', 'stale_issuance']]
      : [[`no-action-${i}`, 'ignored', 'no_fresh_native_issuance']];
    for (const [hintId, status, reason] of decisions) {
      const data = { phoneFingerprint: fingerprint, status: 'native_verification_required',
        reason: 'synthetic-original-hold', previousDownloadedAt: '2026-10-26T00:00:00.000Z',
        sourceDownloadedAt: '2026-10-28T00:00:00.000Z', retained: { audit: hintId } };
      docs.set(hintPath(hintId), data);
      record.hintDecisions.push({ hintId, hintHash: hash(data), previousDownloadedAt: data.previousDownloadedAt, status, reason });
    }
    docs.set(`memberProfiles/${memberId}`, profile);
    evidence.records.push(record);
  }
  docs.set(hintPath('already-accepted'), { phoneFingerprint: evidence.records[0].phoneFingerprint,
    status: 'accepted', reason: 'synthetic-provider-accepted', providerReceipt: 'synthetic-receipt' });
  docs.set(hintPath('unrelated'), { phoneFingerprint: hash('unrelated'), status: 'native_verification_required' });
  docs.set('membershipContracts/synthetic', { status: 'pending', untouched: true });
  docs.set('memberTickets/synthetic', { remaining: 7 });
  docs.set('refunds/synthetic', { status: 'untouched' });
  baseline.fingerprints.unrelated = hash('unrelated');
  baseline.rowCounts.unrelated = 4;
  baseline.observedAtByMember.unrelated = OLD;
  return { docs, evidence };
}

function harness() {
  const { docs, evidence } = fixture(), logs = [], reads = [], commits = [], hooks = {};
  let transactions = 0, closed = 0;
  const ref = key => ({ path: key, id: key.split('/').at(-1), get: async () => read(docs, ref(key), 'direct'),
    collection: name => collection(`${key}/${name}`) });
  const collection = key => ({
    doc: id => ref(`${key}/${id}`),
    where: (field, op, value) => {
      assert.equal(key, `${LANE}/purchaseHints`); assert.equal(field, 'phoneFingerprint'); assert.equal(op, '==');
      return { limit: limit => ({ path: key, query: { field, value, limit },
        get: async () => read(docs, { path: key, query: { field, value, limit } }, 'direct') }) };
    },
  });
  const read = (store, target, phase) => {
    reads.push({ path: target.path, phase });
    if (target.query) {
      const { field, value, limit } = target.query;
      const entries = [...store].filter(([key, data]) => key.startsWith(`${target.path}/`) && data[field] === value).slice(0, limit);
      return { size: entries.length, docs: entries.map(([key, data]) => ({ id: key.split('/').at(-1),
        ref: ref(key), data: () => structuredClone(data) })) };
    }
    return { exists: store.has(target.path), data: () => structuredClone(store.get(target.path)) };
  };
  const db = { doc: ref, runTransaction: async callback => {
    transactions++; hooks.beforeTransaction?.(docs);
    const current = structuredClone(docs), writes = [];
    const stage = (kind, target, data) => {
      assert.ok(target.path === AUDIT || target.path === BASELINE ||
        ['stale-a', 'stale-b', 'no-action-1', 'no-action-2'].some(id => target.path === hintPath(id)),
      `Forbidden write: ${target.path}`);
      if (kind === 'create') assert.equal(current.has(target.path), false);
      else assert.equal(current.has(target.path), true);
      writes.push({ kind, path: target.path, data: structuredClone(data) });
    };
    const result = await callback({ get: async target => {
      assert.equal(writes.length, 0, 'all transaction reads precede writes');
      return read(current, target, 'transaction');
    }, create: (target, data) => stage('create', target, data),
    set: (target, data) => stage('set', target, data), update: (target, data) => stage('update', target, data) });
    for (const write of writes) current.set(write.path, write.kind === 'update'
      ? { ...current.get(write.path), ...write.data } : write.data);
    docs.clear(); for (const [key, value] of current) docs.set(key, value);
    commits.push(writes); hooks.afterCommit?.(docs);
    if (hooks.unknownOutcome) throw Error('synthetic_unknown_commit_outcome');
    return result;
  } };
  const admin = { initializeApp: options => assert.equal(options.projectId, 'archive-pilates'), firestore: () => db,
    app: () => ({ delete: async () => { closed++; } }) };
  const mockedRequire = id => {
    if (id === 'firebase-admin') return admin;
    if (id.endsWith('/lib/utils/hash.js')) return { stableHash };
    assert.fail(`Unmocked dependency prohibited: ${id}`);
  };
  async function run(args = []) {
    const start = logs.length;
    await runInNewContext(`(async () => { ${code}\n})()`, {
      createRequire: () => mockedRequire, createHash, path, os: { homedir: () => '/synthetic-home' },
      fs: { lstatSync: file => {
        assert.equal(file, '/synthetic-home/ArchiveIN/operations/contract-coverage-review-20261102/native-evidence.json');
        return { isFile: () => true, isSymbolicLink: () => false, uid: 1000, mode: 0o600 };
      }, readFileSync: file => {
        assert.equal(file, '/synthetic-home/ArchiveIN/operations/contract-coverage-review-20261102/native-evidence.json');
        return JSON.stringify(evidence);
      } },
      execFileSync: (command, args) => {
        assert.equal(command, 'git');
        if (args[0] === '-C') {
          assert.equal(args[1], '/Users/archivepilates/dev/archive-in-runtime');
          const key = args.slice(2).join(' ');
          if (key === 'rev-parse HEAD') return hooks.runtimeHead || 'b'.repeat(40);
          if (key === 'status --porcelain') return hooks.runtimeStatus || '';
          assert.fail(`Unexpected runtime command: ${key}`);
        }
        const key = args.join(' ');
        if (key === 'branch --show-current') return 'main';
        if (key === 'status --porcelain') return '';
        if (key === 'rev-parse HEAD' || key === 'rev-parse origin/main') return 'b'.repeat(40);
        assert.fail(`Unexpected command: ${key}`);
      },
      process: { argv: ['synthetic-node', sourceUrl.pathname, ...args], env: {}, getuid: () => 1000 },
      console: { log: value => logs.push(JSON.parse(value)) }, Date: Clock, Buffer,
      buildContractCoverageReview: (baseline, evidence) => buildContractCoverageReview(baseline, evidence, NOW),
      contractObservationGroups, validateCoverageReconciliations,
      fetch: () => assert.fail('External transport prohibited'),
    }, { timeout: 1000 });
    return logs.slice(start);
  }
  return { docs, evidence, logs, reads, commits, hooks, run, counts: () => ({ transactions, closed }),
    plan: async () => (await run())[0].fingerprint, apply: expected => run(['--apply', `--expected=${expected}`]) };
}

test('plan is read-only; stale hints become REVIEW, exact no-fresh hints alone become ignored', async () => {
  const h = harness(), before = structuredClone(h.docs), expected = await h.plan();
  assert.deepEqual(h.docs, before); assert.equal(h.commits.length, 0); assert.equal(h.counts().transactions, 0);
  const [result] = await h.apply(expected);
  assert.equal(result.verified, true); assert.equal(result.hintsRequiringSeparateReview, 2);
  assert.equal(result.reviewedHints, 4); assert.equal(result.memberActions, 0); assert.equal(result.globalBaselineReset, false);
  for (const id of ['stale-a', 'stale-b']) {
    const hint = h.docs.get(hintPath(id));
    assert.equal(hint.status, 'review'); assert.equal(hint.reason, 'stale_issuance');
    assert.equal(hint.nativeSourceReviewStatus, 'review');
    assert.equal(hint.previousDownloadedAt, before.get(hintPath(id)).previousDownloadedAt);
    assert.deepEqual(hint.retained, before.get(hintPath(id)).retained);
  }
  for (const id of ['no-action-1', 'no-action-2']) assert.equal(h.docs.get(hintPath(id)).status, 'ignored');
  for (const [key, value] of before) if (key !== BASELINE &&
    !['stale-a', 'stale-b', 'no-action-1', 'no-action-2'].some(id => key === hintPath(id))) assert.deepEqual(h.docs.get(key), value);
  const baseline = h.docs.get(BASELINE);
  for (const key of ['initializedAt', 'updatedAt', 'downloadedAt', 'sourceImportId']) assert.equal(baseline[key], before.get(BASELINE)[key]);
  const audit = h.docs.get(AUDIT);
  assert.equal(audit.originalEntries.length, 3);
  for (const original of audit.originalEntries) {
    assert.equal(original.fingerprint, before.get(BASELINE).fingerprints[original.phoneFingerprint]);
    assert.equal(original.rowCount, before.get(BASELINE).rowCounts[original.phoneFingerprint]);
    assert.equal(original.observedAt, before.get(BASELINE).observedAtByMember[original.phoneFingerprint]);
  }
  for (const original of audit.hintOriginals) {
    assert.equal(original.status, before.get(hintPath(original.id)).status);
    assert.equal(original.reason, before.get(hintPath(original.id)).reason);
  }
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].length, 6);
  assert.equal(h.commits[0].filter(w => w.kind === 'create' && w.path === AUDIT).length, 1);
  assert.equal(h.counts().closed, 2);
});

test('wrong hint hash, missing decision and changed original bound block before writes', async t => {
  for (const kind of ['hash', 'missing', 'stored-bound', 'decision-bound']) await t.test(kind, async () => {
    const h = harness(), record = h.evidence.records[0];
    if (kind === 'hash') record.hintDecisions[0].hintHash = hash('wrong');
    if (kind === 'missing') record.hintDecisions.shift();
    if (kind === 'stored-bound') h.docs.get(hintPath('stale-a')).previousDownloadedAt = OLD;
    if (kind === 'decision-bound') record.hintDecisions[0].previousDownloadedAt = OLD;
    await assert.rejects(h.run(), /hint|bound|verification/i);
    assert.equal(h.commits.length, 0); assert.equal(h.docs.has(AUDIT), false);
  });
});

test('baseline CAS aborts both pre-apply and transaction-time source changes', async t => {
  for (const phase of ['before-apply', 'transaction']) await t.test(phase, async () => {
    const h = harness(), expected = await h.plan();
    const drift = docs => { docs.get(BASELINE).sourceImportId = 'synthetic-new-import'; };
    if (phase === 'before-apply') drift(h.docs); else h.hooks.beforeTransaction = drift;
    await assert.rejects(h.apply(expected), phase === 'transaction' ? /Concurrent source change/ : /Changed review plan/);
    assert.equal(h.commits.length, 0); assert.equal(h.docs.has(AUDIT), false);
    if (phase === 'transaction') assert.ok(h.reads.some(r => r.path === BASELINE && r.phase === 'transaction'));
  });
});

test('apply rejects outdated or dirty runtime before any transaction', async t => {
  for (const kind of ['outdated', 'dirty']) await t.test(kind, async () => {
    const h = harness(), expected = await h.plan();
    if (kind === 'outdated') h.hooks.runtimeHead = 'c'.repeat(40);
    else h.hooks.runtimeStatus = ' M synthetic-runtime-file';
    await assert.rejects(h.apply(expected), /Runtime must be clean and on the reviewed implementation/);
    assert.equal(h.counts().transactions, 0); assert.equal(h.commits.length, 0);
    assert.equal(h.docs.has(AUDIT), false);
  });
});

test('full hint after-hash catches changed status or reason even with review marker retained', async t => {
  for (const field of ['status', 'reason']) await t.test(field, async () => {
    const h = harness(), expected = await h.plan();
    h.hooks.afterCommit = docs => { docs.get(hintPath('no-action-1'))[field] = 'synthetic-conflict'; };
    await assert.rejects(h.apply(expected), /Hint review readback mismatch; do not replay/);
    assert.equal(h.docs.get(hintPath('no-action-1')).coverageReviewId, AUDIT.split('/').at(-1));
    assert.equal(h.commits.length, 1); assert.equal(h.docs.has(AUDIT), true);
    assert.equal(h.logs.some(log => log.verified), false);
    await assert.rejects(h.apply(expected)); assert.equal(h.commits.length, 1);
  });
});

test('eligible pending work aborts atomically rather than becoming ignored', async () => {
  const h = harness();
  Object.assign(h.evidence.records[0].hintDecisions[0], { status: 'eligible', reason: 'synthetic-eligible' });
  const expected = await h.plan();
  await assert.rejects(h.apply(expected), /New eligible contract needs separate approval/);
  assert.equal(h.commits.length, 0); assert.equal(h.docs.has(AUDIT), false);
  assert.equal(h.docs.get(hintPath('stale-a')).status, 'native_verification_required');
});

test('existing audit, accepted commit and unknown commit outcome never replay', async t => {
  await t.test('prior intent', async () => {
    const h = harness(), expected = await h.plan();
    h.docs.set(AUDIT, { expected, originalAudit: true });
    await assert.rejects(h.apply(expected), /Prior apply intent exists/);
    assert.equal(h.commits.length, 0); assert.equal(h.docs.get(AUDIT).originalAudit, true);
  });
  for (const unknown of [false, true]) await t.test(unknown ? 'unknown commit' : 'accepted commit', async () => {
    const h = harness(), expected = await h.plan(); h.hooks.unknownOutcome = unknown;
    if (unknown) await assert.rejects(h.apply(expected), /synthetic_unknown_commit_outcome/);
    else await h.apply(expected);
    assert.equal(h.commits.length, 1); const audit = structuredClone(h.docs.get(AUDIT));
    await assert.rejects(h.apply(expected));
    assert.equal(h.commits.length, 1); assert.deepEqual(h.docs.get(AUDIT), audit);
    assert.equal(h.logs.some(log => log.verified), !unknown);
  });
});
