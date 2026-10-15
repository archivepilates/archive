import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApprovals } from '../src/approvals.mjs';
import { createService, hash } from '../src/service.mjs';
import { createStore } from '../src/store.mjs';

const NOW = Date.parse('2026-10-15T03:00:00Z');
const AT = new Date(NOW).toISOString();
const MEMBER = '123';
const PHONE = '01000000001';
const TOKEN = 'review_fixture_token_Ab9:Z-42';
const RANGE = { startDate: '2026-10-15', endDate: '2026-10-15' };
const timestamps = { fromMillis: value => new Date(value), fromDate: value => value };

function comparable(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return Date.parse(value);
  return value;
}

// This adapter has no network client or write methods; unexpected writes fail immediately.
function fixture(records = [], { queryError = () => null } = {}) {
  const data = new Map([
    ['staffs/operator', { studioId: '5330', active: true, role: 'manager', uid: 'fixture-operator' }],
    [`memberProfiles/${MEMBER}`, { memberId: MEMBER, studioId: '5330', name: 'Synthetic Member',
      phone: PHONE, syncedAt: new Date(NOW) }],
    ...records,
  ]);
  const reads = [];
  const nested = (value, key) => key.split('.').reduce((current, part) => current?.[part], value);
  const snapshot = key => ({ id: key.split('/').at(-1), exists: data.has(key),
    data: () => structuredClone(data.get(key)) });
  function matches(value, [key, operator, expected]) {
    const actual = nested(value, key);
    if (actual === undefined || actual === null) return false;
    const left = comparable(actual), right = comparable(expected);
    switch (operator) {
      case '==': return left === right;
      case '>=': return left >= right;
      case '>': return left > right;
      case '<=': return left <= right;
      case '<': return left < right;
      default: assert.fail(`Unsupported fixture query operator: ${operator}`);
    }
  }
  const db = {
    collection(name) {
      const query = (filters = [], cap = Infinity) => ({
        doc: key => ({ get: async () => snapshot(`${name}/${key}`) }),
        where: (key, operator, value) => query([...filters, [key, operator, value]], cap),
        limit: value => query(filters, value),
        async get() {
          assert.ok(Number.isInteger(cap) && cap > 0 && cap <= 201, 'Every list read must remain bounded.');
          const read = { collection: name, filters, cap, size: 0 };
          reads.push(read);
          const error = queryError(read);
          if (error) throw error;
          const docs = [...data].filter(([key, value]) => key.startsWith(`${name}/`)
            && filters.every(filter => matches(value, filter))).slice(0, cap).map(([key]) => snapshot(key));
          read.size = docs.length;
          return { docs, size: docs.length };
        },
      });
      return query();
    },
    runTransaction() { assert.fail('Read regressions must never start a write transaction.'); },
  };
  const store = createStore(db, timestamps);
  const service = createService({ store, approvals: {}, staffId: 'operator', now: () => NOW });
  return { store, service, reads };
}

function contract(receipt = {}) {
  const binding = { studioId: '5330', memberId: MEMBER, contractId: 'contract-fixture',
    userTicketId: 'ticket-fixture', productId: 'product-fixture' };
  return { ...binding, status: 'signed', bindingVerified: true, binding: { ...binding },
    selection: { ...binding }, completion: { ...binding, signedAt: AT, checkedAt: AT },
    signatureReceipt: { ...binding, source: 'studiomate_native_contract', purpose: 'signature_status_only',
      authoritative: true, status: 'signed', memberSigned: true, centerSigned: true,
      signedAt: AT, checkedAt: AT, sendAllowed: false, ...receipt } };
}

test('review: matching contract receipt still reports stored signature evidence', async () => {
  const f = fixture([['studiomateMembershipContracts/contract-fixture', contract()]]);
  const result = await f.service.callTool('contracts_get_progress', { memberId: MEMBER });
  assert.equal(result.ok, true);
  assert.equal(result.contracts.length, 1);
  assert.equal(result.contracts[0].signatureEvidence, 'native_receipt');
  assert.equal(result.contracts[0].signedAt, AT);
  assert.equal(result.contracts[0].source.liveReadback, false);
});

for (const [field, value] of [['memberId', '999'], ['studioId', 'other-studio'], ['contractId', 'other-contract']]) {
  test(`review: contract receipt with conflicting ${field} is rejected`, async () => {
    const f = fixture([['studiomateMembershipContracts/contract-fixture', contract({ [field]: value })]]);
    await assert.rejects(f.service.callTool('contracts_get_progress', { memberId: MEMBER }),
      { code: 'SOURCE_BINDING_MISMATCH' });
  });
}

for (const field of ['reasonCode', 'skipCode', 'blockedReason']) {
  for (const [kind, secret] of [['phone', PHONE], ['token', TOKEN]]) {
    test(`review: ${field} never echoes a private ${kind}`, async () => {
      const f = fixture([['studiomateMemoWriteJobs/job-fixture', { studioId: '5330', memberId: MEMBER,
        status: 'failed', [field]: secret, lastError: `Private source failure: ${secret}` }]]);
      const result = await f.service.callTool('operations_get_job', { kind: 'memo', jobId: 'job-fixture' });
      assert.equal(result.ok, true);
      assert.equal(result.job.status, 'failed');
      assert.equal(result.job.errorPresent, true);
      assert.ok(!JSON.stringify(result).includes(secret), 'Neither structured fields nor operator notes may expose the private reason.');
      assert.ok(!JSON.stringify(result).includes('Private source failure'));
    });
  }
}

async function approvalFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'archive-mcp-review-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const approvals = await createApprovals(directory);
  const prepared = await approvals.prepare({ staffId: 'operator', memberId: MEMBER,
    memberName: 'Synthetic Member', maskedPhone: '010-****-0001', content: 'Synthetic original memo',
    sourceHash: 'fixture-original-source-hash' }, NOW);
  const displayed = await approvals.getPending(prepared.proposalId, NOW + 1);
  return { approvals, prepared, displayed,
    proposalFile: path.join(directory, `${prepared.proposalId}.proposal.json`),
    approvalFile: path.join(directory, `${prepared.proposalId}.approval.json`) };
}

test('review: approval accepts the unchanged full displayed plan hash', async t => {
  const f = await approvalFixture(t);
  await f.approvals.approve(f.prepared.proposalId, NOW + 2, hash(f.displayed));
  const approved = await f.approvals.loadApproved(f.prepared.proposalId, 'operator', NOW + 3);
  assert.deepEqual(approved, f.displayed);
});

for (const [field, replacement] of [
  ['memberId', '999'], ['content', 'Synthetic replacement memo'],
  ['jobId', 'mcp_memo_replacement'], ['sourceHash', 'fixture-replacement-source-hash'],
]) {
  test(`review: approval rejects ${field} changed after the plan was displayed`, async t => {
    const f = await approvalFixture(t);
    await writeFile(f.proposalFile, JSON.stringify({ ...f.displayed, [field]: replacement }),
      { encoding: 'utf8', mode: 0o600 });
    await assert.rejects(f.approvals.approve(f.prepared.proposalId, NOW + 2, hash(f.displayed)),
      error => error?.safe === true && typeof error.code === 'string');
    await assert.rejects(readFile(f.approvalFile, 'utf8'), { code: 'ENOENT' });
    await assert.rejects(f.approvals.loadApproved(f.prepared.proposalId, 'operator', NOW + 3),
      { code: 'APPROVAL_REQUIRED' });
  });
}

for (const mode of ['missing', 'public-preview-only']) {
  test(`review: approval rejects a ${mode} displayed hash without recording consent`, async t => {
    const f = await approvalFixture(t);
    const displayedHash = mode === 'missing' ? undefined : hash(f.prepared);
    await assert.rejects(f.approvals.approve(f.prepared.proposalId, NOW + 2, displayedHash),
      error => error?.safe === true && typeof error.code === 'string');
    await assert.rejects(readFile(f.approvalFile, 'utf8'), { code: 'ENOENT' });
  });
}

function messageRows(collection, count = 250) {
  const row = (key, createdAt, extra = {}) => [`${collection}/${key}`, {
    studioId: '5330', memberId: MEMBER, status: 'pending', createdAt: new Date(createdAt), ...extra,
  }];
  return [
    ...Array.from({ length: count }, (_, index) => row(`old-${index}`, '2025-01-01T00:00:00Z')),
    ...Array.from({ length: count }, (_, index) => row(`future-${index}`, '2027-01-01T00:00:00Z')),
    row('before-start', '2026-10-14T14:59:59.999Z'),
    row('at-start', '2026-10-14T15:00:00.000Z'),
    row('at-last-millisecond', '2026-10-15T14:59:59.999Z'),
    row('at-next-day', '2026-10-15T15:00:00.000Z'),
    row('other-member', AT, { memberId: '999' }),
    row('other-studio', AT, { studioId: 'other-studio' }),
  ];
}

for (const collection of ['alimtalkCandidates', 'alimtalkSends']) {
  test(`review: ${collection} applies KST day bounds before the read cap`, async () => {
    const f = fixture(messageRows(collection));
    const { rows, coverage } = await f.store.getMessageRows(collection, [MEMBER], RANGE);
    assert.deepEqual(rows.map(value => value._id).sort(), ['at-last-millisecond', 'at-start']);
    assert.equal(coverage.queryMode, 'source_date_range');
    assert.equal(coverage.needsIndexDeployment, false);
    assert.ok(f.reads.length > 0);
    for (const read of f.reads) {
      assert.equal(read.collection, collection);
      assert.ok(read.filters.some(([field, operator]) => field === 'createdAt' && operator === '>='));
      assert.ok(read.filters.some(([field, operator]) => field === 'createdAt' && ['<', '<='].includes(operator)));
      assert.ok(read.size <= 2, 'Old and future history must not consume the bounded result budget.');
    }
  });

  test(`review: ${collection} still rejects more than 200 records inside the requested range`, async () => {
    const records = Array.from({ length: 201 }, (_, index) => [`${collection}/in-range-${index}`, {
      studioId: '5330', memberId: MEMBER, createdAt: new Date(AT), status: 'pending',
    }]);
    const f = fixture(records);
    await assert.rejects(f.store.getMessageRows(collection, [MEMBER], RANGE), { code: 'SOURCE_LIMIT' });
  });
}

test('review: message service forwards its date range to both bounded source queries', async () => {
  const f = fixture([...messageRows('alimtalkCandidates'), ...messageRows('alimtalkSends')]);
  const result = await f.service.callTool('messages_get_delivery', { memberId: MEMBER, ...RANGE });
  assert.equal(result.ok, true);
  assert.equal(result.dateBasis, 'createdAt_Asia_Seoul');
  assert.equal(result.providerLiveChecked, false);
  for (const values of [result.candidates, result.sends]) {
    assert.deepEqual(values.map(value => value.recordId).sort(), ['at-last-millisecond', 'at-start']);
  }
  for (const coverage of [result.coverage.candidates, result.coverage.sends]) {
    assert.equal(coverage.queryMode, 'source_date_range');
    assert.equal(coverage.needsIndexDeployment, false);
  }
});

const dateQuery = read => read.filters.some(([field]) => field === 'createdAt');
const missingIndex = () => Object.assign(new Error('Fixture query requires a composite index.'), { code: 9 });

for (const collection of ['alimtalkCandidates', 'alimtalkSends']) {
  test(`review: ${collection} discloses a bounded missing-index history fallback`, async () => {
    const f = fixture(messageRows(collection, 1), {
      queryError: read => dateQuery(read) ? missingIndex() : null,
    });
    const { rows, coverage } = await f.store.getMessageRows(collection, [MEMBER], RANGE);
    assert.equal(coverage.queryMode, 'bounded_member_history_fallback');
    assert.equal(coverage.needsIndexDeployment, true);
    assert.equal(rows.length, 6);
    assert.equal(f.reads.length, 2);
    assert.equal(dateQuery(f.reads[0]), true, 'Try the source date query before considering compatibility reads.');
    assert.equal(dateQuery(f.reads[1]), false);
    assert.ok(rows.every(value => value.studioId === '5330' && value.memberId === MEMBER));
  });

  test(`review: oversized ${collection} fallback asks for index deployment, not a narrower date range`, async () => {
    const f = fixture(messageRows(collection), {
      queryError: read => dateQuery(read) ? missingIndex() : null,
    });
    await assert.rejects(f.store.getMessageRows(collection, [MEMBER], RANGE), error => {
      assert.equal(error.code, 'SOURCE_LIMIT');
      assert.equal(error.safe, true);
      assert.match(error.message, /index|\uC778\uB371\uC2A4/i);
      assert.match(error.message, /deploy|\uBC30\uD3EC/i);
      assert.doesNotMatch(error.message, /\uAE30\uAC04\uC744 \uC881\uD600|\uBC94\uC704\uB97C \uC881\uD600/);
      return true;
    });
    assert.equal(f.reads.length, 2);
    assert.equal(f.reads[1].size, 201, 'The sentinel cap must stop a large fallback history.');
  });
}

for (const [label, code, message] of [
  ['non-index precondition', 9, 'Fixture precondition failure.'],
  ['permission denied', 7, 'Fixture index permission denied.'],
  ['unavailable', 14, 'Fixture index service unavailable.'],
  ['string error code', '9', 'Fixture query requires an index.'],
]) {
  test(`review: ${label} query errors never trigger a history fallback`, async () => {
    const original = Object.assign(new Error(message), { code });
    const f = fixture(messageRows('alimtalkCandidates', 1), { queryError: () => original });
    await assert.rejects(f.store.getMessageRows('alimtalkCandidates', [MEMBER], RANGE),
      error => error === original);
    assert.equal(f.reads.length, 1);
    assert.equal(dateQuery(f.reads[0]), true);
  });
}

test('review: message service filters fallback history and discloses index requirements for both sources', async () => {
  const f = fixture([...messageRows('alimtalkCandidates', 1), ...messageRows('alimtalkSends', 1)], {
    queryError: read => dateQuery(read) ? missingIndex() : null,
  });
  const result = await f.service.callTool('messages_get_delivery', { memberId: MEMBER, ...RANGE });
  assert.equal(result.ok, true);
  assert.equal(result.providerLiveChecked, false);
  for (const values of [result.candidates, result.sends]) {
    assert.deepEqual(values.map(value => value.recordId).sort(), ['at-last-millisecond', 'at-start']);
  }
  for (const coverage of [result.coverage.candidates, result.coverage.sends]) {
    assert.equal(coverage.queryMode, 'bounded_member_history_fallback');
    assert.equal(coverage.needsIndexDeployment, true);
  }
});

test('review: stdio entry point explicitly wires stdin EOF to shutdown (source guard)', async () => {
  const source = await readFile(new URL('../src/index.mjs', import.meta.url), 'utf8');
  const registration = source.match(/process\.stdin\.(?:once|on)\(\s*['"]end['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/);
  assert.ok(registration,
    'The installed SDK does not close its server on stdin EOF; the entry point must wire EOF to shutdown.');
  const handler = registration[1];
  if (handler !== 'shutdown') {
    assert.match(source, new RegExp(`const ${handler}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{?\\s*(?:void\\s+)?shutdown\\s*\\(`),
      'The registered EOF callback must invoke the shutdown path, not only cleanupApp.');
  }
});

test('review: invalid-config stdio startup exits before credential loading and keeps stdout clean', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/index.mjs', import.meta.url))], {
    env: { GOOGLE_CLOUD_PROJECT: 'invalid-review-fixture', ARCHIVE_MCP_OPERATOR_STAFF_ID: 'operator' },
    input: '', encoding: 'utf8', timeout: 5000, maxBuffer: 65536,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr.trim()).code, 'CONFIG_INVALID');
});
